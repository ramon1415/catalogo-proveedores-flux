-- Payroll pilot: explicit RH capture access; payment and employee PII permissions stay separate.
begin;

create table public.payroll_capture_grants (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (profile_id, company_id)
);
alter table public.payroll_capture_grants enable row level security;
revoke all on public.payroll_capture_grants from public, anon, authenticated;
grant select,insert,update,delete on public.payroll_capture_grants to service_role;
comment on table public.payroll_capture_grants is 'Service-managed capture access only; requires active company membership. Does not grant payment or employee-row access.';

create or replace function private.payroll_profile_can_capture(p_profile_id uuid, p_company_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id=p_profile_id and p.active)
    and (
      private.profile_has_company_role(p_profile_id,p_company_id,array['finance']::text[])
      or (
        public.has_active_company_membership(p_profile_id,p_company_id)
        and exists (select 1 from public.payroll_capture_grants g
          where g.profile_id=p_profile_id and g.company_id=p_company_id and g.active)
      )
    );
$$;
revoke all on function private.payroll_profile_can_capture(uuid,uuid) from public,anon,authenticated;

create or replace function public.payroll_capture_company_access(p_company_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.payroll_profile_can_capture(public.current_profile_id(),p_company_id); $$;
revoke all on function public.payroll_capture_company_access(uuid) from public,anon;
grant execute on function public.payroll_capture_company_access(uuid) to authenticated,service_role;

create or replace function public.payroll_has_capture_access()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.companies c
    where public.payroll_capture_company_access(c.id));
$$;
revoke all on function public.payroll_has_capture_access() from public,anon;
grant execute on function public.payroll_has_capture_access() to authenticated,service_role;

create or replace function public.get_my_payroll_access(p_company_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'can_capture',public.payroll_capture_company_access(p_company_id),
    'can_pay',public.payroll_has_finance_pii_access() and public.payroll_active_company_access(p_company_id)
  );
$$;
revoke all on function public.get_my_payroll_access(uuid) from public,anon;
grant execute on function public.get_my_payroll_access(uuid) to authenticated;

create or replace function public.get_payroll_capture_context(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.payroll_capture_company_access(p_company_id) then
    raise exception 'PAYROLL_CAPTURE_ACCESS_REQUIRED';
  end if;
  return jsonb_build_object(
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'company_id',a.company_id,'name',a.name,'bank_name',a.bank_name,
      'currency',a.currency,'account_type',a.account_type,'last4',a.last4,
      'account_number',a.account_number,'clabe',a.clabe,'active',a.active) order by a.name)
      from public.company_bank_accounts a where a.company_id=p_company_id and a.active
        and a.account_type::text='bank' and upper(a.currency) in ('MXN','MXP')),'[]'::jsonb),
    'costCenters',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'active',c.active) order by c.name)
      from public.cost_centers c where c.active and exists (select 1 from public.company_cost_centers m
        where m.cost_center_id=c.id and m.company_id=p_company_id and m.active)),'[]'::jsonb),
    'mappings',coalesce((select jsonb_agg(jsonb_build_object('company_id',m.company_id,'cost_center_id',m.cost_center_id,'active',m.active))
      from public.company_cost_centers m where m.company_id=p_company_id and m.active),'[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_payroll_capture_context(uuid) from public,anon;
grant execute on function public.get_payroll_capture_context(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.get_payroll_capture_file_url(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_is_service boolean := coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
  v_file record;
begin
  if p_file_id is null then
    raise exception 'PAYROLL_CAPTURE_FILE_ID_REQUIRED';
  end if;

  select
    f.id,
    f.kind,
    f.storage_bucket,
    f.storage_path,
    f.extension,
    f.upload_state,
    f.is_current,
    s.id as session_id,
    s.company_id,
    s.capture_state,
    s.expires_at
  into v_file
  from public.payroll_capture_files f
  join public.payroll_capture_sessions s on s.id = f.session_id
  where f.id = p_file_id
    and f.upload_state = 'uploaded'
    and f.is_current;

  if not found then
    raise exception 'PAYROLL_CAPTURE_FILE_NOT_FOUND';
  end if;

  if not v_is_service then
    if v_actor is null or not public.payroll_has_capture_access() then
      raise exception 'PAYROLL_CAPTURE_FINANCE_REQUIRED';
    end if;

    if not public.payroll_capture_company_access(v_file.company_id) then
      raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
    end if;

    if not (
      (v_file.expires_at > now() and v_file.capture_state <> 'materialized')
      or
      (
        v_file.capture_state = 'materialized'
        and exists (
          select 1
          from public.payroll_run_files rf
          where rf.capture_file_id = v_file.id
        )
      )
    ) then
      raise exception 'PAYROLL_CAPTURE_FILE_NOT_DOWNLOADABLE';
    end if;
  end if;

  if v_file.storage_bucket <> 'payroll-private' then
    raise exception 'PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH';
  end if;

  if v_file.storage_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$' then
    raise exception 'PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH';
  end if;

  return jsonb_build_object(
    'file_id', v_file.id,
    'storage_bucket', v_file.storage_bucket,
    'storage_path', v_file.storage_path,
    'download_name', v_file.kind || '.' || v_file.extension
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_capture_sessions_unscoped_internal(p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if public.current_profile_id() is null or not public.payroll_has_capture_access() then raise exception 'payroll_capture_finance_required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',session.id,'company_id',session.company_id,'company_bank_account_id',session.company_bank_account_id,'cost_center_id',session.cost_center_id,'budget_category_id',session.budget_category_id,'budget_month',session.budget_month,'payroll_subtype',session.payroll_subtype,'period_start',session.period_start,'period_end',session.period_end,'concept',session.concept,'notes',session.notes,'expected_channels',session.expected_channels,'capture_state',session.capture_state,'validation_status',session.validation_status,'version',session.version,'expires_at',session.expires_at,'updated_at',session.updated_at,'materialized_payment_request_id',session.materialized_payment_request_id,'materialized_at',session.materialized_at,'server_verification_summary',session.server_verification_summary,'payment_request_number',request.request_number,'payment_request_status',request.status::text,'finance_confirmation_pending',coalesce(request.request_type::text='nomina' and request.status::text='draft' and request.no_presupuestal and request.approver_id is null and request.submitted_at is null,false),'payment_ready',case when request.id is null then false else public.payroll_ready_for_dispersion(request.id) end,'payment_flow_state',case when request.id is null then null when request.status::text='draft' and request.no_presupuestal and request.approver_id is null then 'pending_finance_confirmation' when public.payroll_ready_for_dispersion(request.id) then 'ready_for_payment' when request.status::text='approved' then 'payment_blocked' else request.status::text end,'files',coalesce((select jsonb_agg(jsonb_build_object('id',file.id,'kind',file.kind,'channel',file.channel,'capability_code',file.capability_code,'parsing_status',file.parsing_status,'validation_authority',file.validation_authority,'parser_version',file.parser_version,'parser_contract',file.parser_contract,'record_count',file.record_count,'total_amount_minor',file.total_amount_minor,'issue_codes',file.issue_codes,'uploaded_at',file.uploaded_at) order by file.uploaded_at desc) from public.payroll_capture_files file where file.session_id=session.id and file.upload_state='uploaded' and file.is_current),'[]'::jsonb)) order by session.updated_at desc) from (select * from public.payroll_capture_sessions where (p_session_id is null or id=p_session_id) and (expires_at>now() or (capture_state='materialized' and materialized_payment_request_id is not null)) and public.payroll_capture_company_access(company_id) order by updated_at desc limit 50) session left join public.payment_requests request on request.id=session.materialized_payment_request_id),'[]'::jsonb);
end; $function$;

CREATE OR REPLACE FUNCTION public.save_payroll_capture_session_n3g(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_cost_center_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_existing public.payroll_capture_sessions%rowtype;
  v_result jsonb;
  v_id uuid;
begin
  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;
  if p_cost_center_id is null or not exists (
    select 1
    from public.company_cost_centers ccc
    join public.cost_centers cc on cc.id=ccc.cost_center_id
    where ccc.company_id=p_company_id
      and ccc.cost_center_id=p_cost_center_id
      and ccc.active and cc.active
  ) then
    raise exception 'payroll_capture_cost_center_invalid';
  end if;

  if p_session_id is not null then
    select * into v_existing from public.payroll_capture_sessions where id=p_session_id for update;
    if not found then raise exception 'payroll_capture_session_not_found'; end if;
    if v_existing.capture_state='materialized' then raise exception 'payroll_capture_materialized_locked'; end if;
  end if;

  v_result := public.save_payroll_capture_session(
    p_session_id,p_expected_version,p_company_id,p_company_bank_account_id,
    p_payroll_subtype,p_period_start,p_period_end,p_concept,p_notes,p_expected_channels
  );
  v_id := (v_result->>'id')::uuid;

  update public.payroll_capture_sessions
  set cost_center_id=p_cost_center_id,
      updated_by=v_actor,
      updated_at=now()
  where id=v_id;

  return v_result || jsonb_build_object('cost_center_id',p_cost_center_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_submission_summary(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_employee_net numeric; v_channels jsonb; v_category_code text; v_direct_flow boolean:=false; v_payment_ready boolean:=false; v_flow_state text;
begin
  if v_actor is null or not public.payroll_has_capture_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.payroll_capture_company_access(v_request.company_id) then raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select code into v_category_code from public.budget_categories where id=v_request.budget_category_id;
  v_direct_flow:=coalesce(v_request.no_presupuestal,false) and v_category_code='PAYROLL_NON_BUDGET' and v_request.approver_id is null and v_request.submitted_at is null;
  v_payment_ready:=public.payroll_ready_for_dispersion(v_request.id);
  v_flow_state:=case when v_direct_flow and v_request.status::text='draft' then 'pending_finance_confirmation' when v_payment_ready then 'ready_for_payment' when v_request.status::text='approved' then 'payment_blocked' else v_request.status::text end;
  select coalesce(sum(net_amount),0) into v_employee_net from public.payroll_run_lines where payment_request_id=v_request.id;
  select coalesce(jsonb_agg(jsonb_build_object('channel',channel.channel,'amount',channel.amount,'benefit_amount',channel.benefit_amount,'fee_amount',channel.fee_amount,'tax_amount',channel.tax_amount,'expected_funding_amount',channel.expected_funding_amount,'funding_variance',case when channel.channel='vales' then channel.amount-channel.expected_funding_amount else null end,'funding_variance_acknowledged',channel.funding_variance_acknowledged_at is not null,'funding_variance_acknowledged_at',channel.funding_variance_acknowledged_at) order by channel.channel),'[]'::jsonb) into v_channels from public.payroll_channels channel where channel.payment_request_id=v_request.id;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'status',v_request.status,'company_id',v_request.company_id,'cost_center_id',v_request.cost_center_id,'amount_requested',v_request.amount_requested,'employee_net',v_employee_net,'currency',v_request.currency,'payroll_subtype',v_request.payroll_subtype,'period_start',v_request.payroll_period_start,'period_end',v_request.payroll_period_end,'approver_id',v_request.approver_id,'approver_assignment_id',v_request.approver_assignment_id,'approver_selection_source',v_request.approver_selection_source,'submitted_at',v_request.submitted_at,'budget_category_id',v_request.budget_category_id,'budget_month',v_request.budget_month,'budget_decision',v_request.budget_decision,'budget_block_reason',v_request.budget_block_reason,'budget_available_before',v_request.budget_available_before,'budget_available_after',v_request.budget_available_after,'budget_shortfall',v_request.budget_shortfall,'budget_checked_at',v_request.budget_checked_at,'budget_ready',(coalesce(v_request.no_presupuestal,false) or (v_request.budget_decision='aprobable' and v_request.budget_category_id is not null and v_request.budget_month is not null)),'finance_confirmation_pending',(v_direct_flow and v_request.status::text='draft'),'payment_ready',v_payment_ready,'payment_flow_state',v_flow_state,'channels',v_channels);
end; $function$;

CREATE OR REPLACE FUNCTION public.save_payroll_capture_session_unscoped_internal(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
begin
  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  if p_company_id is null
     or p_company_bank_account_id is null
     or p_payroll_subtype not in ('ordinaria', 'extraordinaria')
     or p_period_start is null
     or p_period_end is null
     or p_period_start > p_period_end
     or char_length(btrim(coalesce(p_concept, ''))) not between 3 and 500
     or char_length(coalesce(p_notes, '')) > 2000
     or not public.payroll_capture_channels_valid(p_expected_channels) then
    raise exception 'payroll_capture_metadata_invalid';
  end if;

  if not exists (
    select 1
    from public.companies company
    where company.id = p_company_id
      and coalesce(company.active, true)
  ) or not exists (
    select 1
    from public.company_bank_accounts account
    where account.id = p_company_bank_account_id
      and account.company_id = p_company_id
      and coalesce(account.active, true)
      and account.account_type::text = 'bank'
      and account.currency = 'MXN'
  ) then
    raise exception 'payroll_capture_source_account_invalid';
  end if;

  if p_session_id is null then
    if p_expected_version is not null then
      raise exception 'payroll_capture_version_must_be_null_for_create';
    end if;

    insert into public.payroll_capture_sessions (
      company_id,
      company_bank_account_id,
      payroll_subtype,
      period_start,
      period_end,
      concept,
      notes,
      expected_channels,
      created_by,
      updated_by
    ) values (
      p_company_id,
      p_company_bank_account_id,
      p_payroll_subtype,
      p_period_start,
      p_period_end,
      btrim(p_concept),
      nullif(btrim(coalesce(p_notes, '')), ''),
      p_expected_channels,
      v_actor,
      v_actor
    ) returning * into v_session;
  else
    select * into v_session
    from public.payroll_capture_sessions
    where id = p_session_id
    for update;

    if not found then
      raise exception 'payroll_capture_session_not_found';
    end if;
    if p_expected_version is null or v_session.version <> p_expected_version then
      raise exception 'payroll_capture_version_conflict';
    end if;
    if v_session.expires_at <= now() then
      raise exception 'payroll_capture_session_expired';
    end if;
    if p_company_id <> v_session.company_id
       and exists (
         select 1 from public.payroll_capture_files file
         where file.session_id = v_session.id
       ) then
      raise exception 'payroll_capture_company_locked_after_file_reservation';
    end if;
    if p_company_bank_account_id <> v_session.company_bank_account_id
       and exists (
         select 1 from public.payroll_capture_files file
         where file.session_id = v_session.id
           and file.kind = 'layout_spei'
       ) then
      raise exception 'payroll_capture_source_account_locked_after_spei';
    end if;
    if exists (
      select 1
      from public.payroll_capture_files file
      where file.session_id = v_session.id
        and file.channel is not null
        and not (file.channel = any(p_expected_channels))
    ) then
      raise exception 'payroll_capture_channel_locked_after_file_reservation';
    end if;

    update public.payroll_capture_sessions
    set company_id = p_company_id,
        company_bank_account_id = p_company_bank_account_id,
        payroll_subtype = p_payroll_subtype,
        period_start = p_period_start,
        period_end = p_period_end,
        concept = btrim(p_concept),
        notes = nullif(btrim(coalesce(p_notes, '')), ''),
        expected_channels = p_expected_channels,
        updated_by = v_actor,
        updated_at = now(),
        version = version + 1
    where id = p_session_id
    returning * into v_session;
  end if;

  perform public.payroll_capture_refresh_state(v_session.id);

  select * into v_session
  from public.payroll_capture_sessions
  where id = v_session.id;

  return jsonb_build_object(
    'id', v_session.id,
    'capture_state', v_session.capture_state,
    'validation_status', v_session.validation_status,
    'version', v_session.version
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_payroll_capture_file(p_file_id uuid, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
begin
  select session.company_id into v_company_id
  from public.payroll_capture_files file
  join public.payroll_capture_sessions session on session.id = file.session_id
  where file.id = p_file_id;

  if v_company_id is null then
    raise exception 'PAYROLL_CAPTURE_FILE_RESERVATION_NOT_FOUND';
  end if;
  if not public.payroll_capture_company_access(v_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  return public.confirm_payroll_capture_file_unscoped_internal(p_file_id, p_sha256);
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_payroll_capture_file_unscoped_internal(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_actor uuid:=public.current_profile_id();
  v_session public.payroll_capture_sessions%rowtype;
  v_file_id uuid:=gen_random_uuid();
  v_channel text;
  v_path text;
  v_server_only boolean:=false;
begin
  if v_actor is null or not public.payroll_has_capture_access() then raise exception 'payroll_capture_finance_required'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_session_id for update;
  if not found then raise exception 'payroll_capture_session_not_found'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_session_expired'; end if;
  if p_expected_version is null or v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if p_size_bytes not between 1 and 26214400 or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'payroll_capture_file_metadata_invalid'; end if;

  case p_kind
    when 'caratula' then
      if p_extension<>'xlsx' or p_mime_type<>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then
        raise exception 'payroll_capture_cover_validation_required';
      end if;
      v_channel:=null; v_server_only:=true;
    when 'layout_mismo_banco' then
      if not ('banco'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain' then
        raise exception 'payroll_capture_same_bank_validation_required';
      end if;
      v_channel:='banco'; v_server_only:=true;
    when 'layout_spei' then
      if not ('spei'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain'
         or p_parser_version is distinct from 'payroll-normalized-v1'
         or p_parser_contract is distinct from 'bbva-simulator-pagos-interbancarios-128-v1'
         or coalesce(p_record_count,0)<=0 or coalesce(p_total_amount_minor,0)<=0 then
        raise exception 'payroll_capture_spei_validation_required';
      end if;
      v_channel:='spei';
    when 'layout_toka' then
      if not ('vales'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain' then
        raise exception 'payroll_capture_toka_funding_validation_required';
      end if;
      v_channel:='vales'; v_server_only:=true;
    when 'cfdi_vales' then
      if not ('vales'=any(v_session.expected_channels)) or p_extension<>'xml' or p_mime_type not in ('application/xml','text/xml') then
        raise exception 'payroll_capture_toka_cfdi_validation_required';
      end if;
      v_channel:='vales'; v_server_only:=true;
    else
      raise exception 'payroll_capture_file_kind_unsupported';
  end case;

  if v_server_only and (
    p_parser_version is not null or p_parser_contract is not null
    or p_record_count is not null or p_total_amount_minor is not null
  ) then
    raise exception 'payroll_capture_server_only_parser_metadata_forbidden';
  end if;

  v_path:=concat(v_session.company_id::text,'/',v_session.reserved_payment_request_id::text,'/',v_file_id::text,'.',p_extension);
  insert into public.payroll_capture_files(
    id,session_id,kind,channel,storage_path,extension,mime_type,size_bytes,sha256,
    capability_code,parsing_status,validation_authority,parser_version,parser_contract,
    record_count,total_amount_minor,issue_codes,reserved_by
  ) values(
    v_file_id,v_session.id,p_kind,v_channel,v_path,p_extension,p_mime_type,p_size_bytes,p_sha256,
    'supported_certified',
    case when v_server_only then 'server_verification_pending' else 'client_parsed_unverified' end,
    case when v_server_only then 'server_only' else 'browser_client_attested' end,
    case when v_server_only then null else p_parser_version end,
    case when v_server_only then null else p_parser_contract end,
    case when v_server_only then null else p_record_count end,
    case when v_server_only then null else p_total_amount_minor end,
    array[]::text[],v_actor
  );

  return jsonb_build_object('file_id',v_file_id,'storage_bucket','payroll-private','storage_path',v_path);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_payroll_capture_file_unscoped_internal(p_file_id uuid, p_sha256 text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_file public.payroll_capture_files%rowtype;
  v_session public.payroll_capture_sessions%rowtype;
  v_object storage.objects%rowtype;
begin
  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  select * into v_file
  from public.payroll_capture_files
  where id = p_file_id
  for update;

  if not found or v_file.upload_state <> 'reserved' then
    raise exception 'payroll_capture_file_reservation_not_found';
  end if;
  if p_sha256 is distinct from v_file.sha256 then
    raise exception 'payroll_capture_file_hash_mismatch';
  end if;

  select * into v_session
  from public.payroll_capture_sessions
  where id = v_file.session_id
  for update;

  if not found or v_session.expires_at <= now() then
    raise exception 'payroll_capture_session_expired';
  end if;

  select * into v_object
  from storage.objects object
  where object.bucket_id = v_file.storage_bucket
    and object.name = v_file.storage_path;

  if not found
     or coalesce((v_object.metadata ->> 'size')::bigint, -1) <> v_file.size_bytes
     or coalesce(v_object.metadata ->> 'mimetype', '') <> v_file.mime_type then
    raise exception 'payroll_capture_storage_object_mismatch';
  end if;

  update public.payroll_capture_files
  set is_current = false,
      updated_at = now()
  where session_id = v_file.session_id
    and kind = v_file.kind
    and is_current;

  update public.payroll_capture_files
  set upload_state = 'uploaded',
      is_current = true,
      uploaded_by = v_actor,
      uploaded_at = now(),
      updated_at = now()
  where id = v_file.id;

  update public.payroll_capture_sessions
  set updated_by = v_actor,
      version = version + 1,
      updated_at = now()
  where id = v_session.id;

  perform public.payroll_capture_refresh_state(v_session.id);

  return (
    select jsonb_build_object(
      'session_id', session.id,
      'capture_state', session.capture_state,
      'validation_status', session.validation_status,
      'version', session.version
    )
    from public.payroll_capture_sessions session
    where session.id = v_session.id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_insert_allowed_unscoped_internal(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.payroll_has_capture_access()
    and p_name ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,10}$'
    and exists (
      select 1
      from public.payroll_capture_files file
      join public.payroll_capture_sessions session on session.id = file.session_id
      where file.storage_path = p_name
        and file.storage_bucket = 'payroll-private'
        and file.upload_state = 'reserved'
        and session.company_id::text = split_part(p_name, '/', 1)
        and session.reserved_payment_request_id::text = split_part(p_name, '/', 2)
        and session.expires_at > now()
        and session.capture_state in ('draft', 'files_pending', 'validation_pending')
    );
$function$;

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_select_allowed_unscoped_internal(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.payroll_has_capture_access() and exists (
    select 1 from public.payroll_capture_files f
    join public.payroll_capture_sessions s on s.id=f.session_id
    where f.storage_path=p_name and f.storage_bucket='payroll-private'
      and f.upload_state='uploaded' and f.is_current
      and (
        (s.expires_at>now() and s.capture_state<>'materialized')
        or (s.capture_state='materialized' and exists(
          select 1 from public.payroll_run_files rf where rf.capture_file_id=f.id
        ))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_reconciliation_summary(p_payment_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_company_name text; v_channels jsonb; v_count integer; v_dispersed integer; v_reconciled integer;
begin
  if v_actor is null or not public.payroll_has_capture_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.payroll_capture_company_access(v_request.company_id) then raise exception 'PAYROLL_RECONCILIATION_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  select name into v_company_name from public.companies where id=v_request.company_id;
  select count(*)::integer,count(*) filter(where channel.dispersion_status='dispersed')::integer,count(*) filter(where channel.reconciliation_status='reconciled')::integer,
    coalesce(jsonb_agg(jsonb_build_object('id',channel.id,'channel',channel.channel,'amount',channel.amount,'currency',channel.currency,'dispersion_status',channel.dispersion_status,'reconciliation_status',channel.reconciliation_status,'receipt_verified',(file.id is not null and file.parsing_status='parsed' and file.parsing_version='payroll-channel-receipt-v1'),'receipt_file_id',channel.receipt_file_id,'receipt_amount',channel.receipt_amount,'receipt_payment_date',channel.receipt_payment_date,'reference_hint',case when channel.receipt_reference_hint is null then null else '••••'||right(channel.receipt_reference_hint,4) end) order by case channel.channel when 'banco' then 1 when 'spei' then 2 else 3 end),'[]'::jsonb)
  into v_count,v_dispersed,v_reconciled,v_channels
  from public.payroll_channels channel left join public.payroll_run_files file on file.id=channel.receipt_file_id where channel.payment_request_id=v_request.id;
  return jsonb_build_object('payment_request_id',v_request.id,'request_number',v_request.request_number,'company_name',v_company_name,'request_status',v_request.status::text,'amount_requested',v_request.amount_requested,'currency',v_request.currency,'channel_count',v_count,'dispersed_count',v_dispersed,'reconciled_count',v_reconciled,'all_dispersed',(v_count>0 and v_dispersed=v_count),'all_reconciled',(v_count>0 and v_reconciled=v_count),'can_close_paid',(public.payroll_has_finance_pii_access() and public.payroll_active_company_access(v_request.company_id) and v_request.status::text='approved' and v_count>0 and v_dispersed=v_count and v_reconciled=v_count),'channels',v_channels);
end; $function$;

CREATE OR REPLACE FUNCTION public.materialize_payroll_capture_internal(p_capture_session_id uuid, p_expected_version integer, p_idempotency_key_hash text, p_server_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_session public.payroll_capture_sessions%rowtype; v_actor uuid; v_request_id uuid; v_channel jsonb; v_file jsonb; v_line jsonb;
  v_channel_ids jsonb:='{}'::jsonb; v_file_ids jsonb:='{}'::jsonb; v_amount_minor bigint:=0; v_count integer; v_warning_codes jsonb; v_provision jsonb;
  v_year integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'payroll_materialization_service_role_required'; end if;
  if p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then raise exception 'payroll_materialization_idempotency_invalid'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_capture_session_id for update;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.capture_state='materialized' then
    if v_session.materialization_idempotency_hash=p_idempotency_key_hash then return jsonb_build_object('status','already_materialized','payment_request_id',v_session.materialized_payment_request_id); end if;
    raise exception 'payroll_capture_already_materialized';
  end if;
  if v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_expired'; end if;
  if v_session.capture_state not in ('validation_pending','ready_for_submission') then raise exception 'payroll_capture_not_materializable'; end if;
  if v_session.cost_center_id is null then raise exception 'payroll_capture_accounting_context_required'; end if;
  if p_server_result->>'contract_version'<>'payroll-normalized-v1' or coalesce((p_server_result->>'valid')::boolean,false) is not true
     or jsonb_array_length(coalesce(p_server_result->'issues','[]'::jsonb))<>0 then raise exception 'payroll_server_validation_required'; end if;
  if coalesce((p_server_result->>'provision_base_amount_minor')::bigint,0)<=0 then raise exception 'PAYROLL_PROVISION_BASE_REQUIRED'; end if;
  v_actor:=(p_server_result->>'actor_profile_id')::uuid;
  if v_actor is null then raise exception 'payroll_materialization_actor_required'; end if;
  if not private.payroll_profile_can_capture(v_actor,v_session.company_id) then raise exception 'payroll_materialization_finance_required'; end if;
  if (p_server_result->>'capture_session_id')::uuid<>v_session.id or (p_server_result->>'capture_version')::integer<>v_session.version then raise exception 'payroll_server_result_binding_mismatch'; end if;
  if not exists(select 1 from jsonb_array_elements(p_server_result->'files') x where x->>'kind'='caratula' and x->>'authority'='server_verified') then raise exception 'PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED'; end if;

  select coalesce(sum((x->>'amount_minor')::bigint),0),count(*) into v_amount_minor,v_count
  from jsonb_array_elements(p_server_result->'channels') x where (x->>'amount_minor')::bigint>0;
  if v_count=0 or v_amount_minor<=0 then raise exception 'payroll_channel_totals_invalid'; end if;
  if v_count<>cardinality(v_session.expected_channels) or exists(select 1 from unnest(v_session.expected_channels) expected where not exists(
      select 1 from jsonb_array_elements(p_server_result->'channels') x where x->>'channel'=expected and (x->>'amount_minor')::bigint>0))
  then raise exception 'payroll_channel_inventory_mismatch'; end if;
  select count(*) into v_count from public.payroll_capture_files where session_id=v_session.id and is_current and upload_state='uploaded';
  if v_count<>jsonb_array_length(p_server_result->'files') then raise exception 'payroll_file_inventory_mismatch'; end if;
  if jsonb_array_length(p_server_result->'lines')=0 then raise exception 'payroll_server_lines_required'; end if;

  v_year:=coalesce(extract(year from v_session.budget_month)::int, extract(year from now())::int);
  v_request_id:=v_session.reserved_payment_request_id;
  insert into public.payment_requests(id,request_number,request_type,requested_by,company_id,company_bank_account_id,cost_center_id,budget_category_id,budget_month,
    amount_requested,currency,exchange_rate,status,concept,description,notes,payroll_subtype,payroll_period_start,payroll_period_end,
    provider_id,proveedor_id,provider_bank_account_id,approver_id,submitted_at)
  values(v_request_id,public.generate_payment_request_number(v_year),'nomina',v_actor,v_session.company_id,v_session.company_bank_account_id,v_session.cost_center_id,v_session.budget_category_id,v_session.budget_month,
    v_amount_minor/100.0,'MXN',1,'draft',v_session.concept,v_session.concept,v_session.notes,v_session.payroll_subtype,v_session.period_start,v_session.period_end,
    null,null,null,null,null);

  for v_channel in select value from jsonb_array_elements(p_server_result->'channels') loop
    if v_channel->>'channel'<>all(v_session.expected_channels) then raise exception 'payroll_channel_inventory_mismatch'; end if;
    v_actor:=null;
    insert into public.payroll_channels(payment_request_id,channel,amount,currency,benefit_amount,fee_amount,tax_amount,expected_funding_amount)
    values(v_request_id,v_channel->>'channel',(v_channel->>'amount_minor')::bigint/100.0,'MXN',
      case when v_channel->>'channel'='vales' then (v_channel->>'benefit_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'fee_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'tax_amount_minor')::bigint/100.0 else null end,
      case when v_channel->>'channel'='vales' then (v_channel->>'expected_funding_amount_minor')::bigint/100.0 else null end)
    returning id into v_actor;
    v_channel_ids:=v_channel_ids||jsonb_build_object(v_channel->>'channel',v_actor);
  end loop;

  for v_file in select value from jsonb_array_elements(p_server_result->'files') loop
    v_actor:=null;
    insert into public.payroll_run_files(payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,original_filename,mime_type,size_bytes,sha256,
      uploaded_by,uploaded_at,parsing_status,parsing_version,parsing_metadata,capture_file_id)
    select v_request_id,case when f.channel is null then null else (v_channel_ids->>f.channel)::uuid end,f.kind,f.storage_bucket,f.storage_path,
      f.kind||'.'||f.extension,f.mime_type,f.size_bytes,v_file->>'sha256',f.uploaded_by,f.uploaded_at,'parsed',v_file->>'parser_version',
      jsonb_build_object('evidence_class','SERVER_VERIFIED','parser_version',v_file->>'parser_version','row_count',coalesce((v_file->>'record_count')::integer,0),'issue_codes','[]'::jsonb),f.id
    from public.payroll_capture_files f where f.id=(v_file->>'capture_file_id')::uuid and f.session_id=v_session.id
      and f.sha256=v_file->>'sha256' and f.is_current and f.upload_state='uploaded' returning id into v_actor;
    if v_actor is null then raise exception 'payroll_server_file_binding_mismatch'; end if;
    v_file_ids:=v_file_ids||jsonb_build_object(v_file->>'capture_file_id',v_actor);
  end loop;

  for v_line in select value from jsonb_array_elements(p_server_result->'lines') loop
    insert into public.payroll_run_lines(payment_request_id,source_file_id,source_sheet,source_row_number,extraction_version,employee_name,rfc,curp,nss,
      bank_name,bank_account,clabe,net_amount,bank_amount,spei_amount,vouchers_amount)
    values(v_request_id,(v_file_ids->>(v_line->>'source_capture_file_id'))::uuid,v_line->>'source_sheet',(v_line->>'source_row_number')::integer,
      v_line->>'extraction_version',v_line->>'employee_name',nullif(v_line->>'rfc',''),nullif(v_line->>'curp',''),nullif(v_line->>'nss',''),
      nullif(v_line->>'bank_name',''),nullif(v_line->>'bank_account',''),nullif(v_line->>'clabe',''),
      (v_line->>'net_amount_minor')::bigint/100.0,(v_line->>'bank_amount_minor')::bigint/100.0,
      (v_line->>'spei_amount_minor')::bigint/100.0,(v_line->>'vouchers_amount_minor')::bigint/100.0);
  end loop;

  update public.payroll_channels c set layout_file_id=f.id from public.payroll_run_files f
  where c.payment_request_id=v_request_id and f.payroll_channel_id=c.id
    and f.kind=case c.channel when 'banco' then 'layout_mismo_banco' when 'spei' then 'layout_spei' else 'layout_toka' end;

  v_provision:=public.post_payroll_provision_internal(
    v_request_id,
    (p_server_result->>'provision_base_amount_minor')::bigint,
    nullif(p_server_result->>'provision_aguinaldo_factor','')::numeric,
    nullif(p_server_result->>'provision_vacation_premium_factor','')::numeric,
    nullif(p_server_result->>'provision_policy_version','')
  );

  select coalesce(jsonb_agg(w->>'code'),'[]'::jsonb) into v_warning_codes
  from jsonb_array_elements(coalesce(p_server_result->'warnings','[]'::jsonb)) w;
  update public.payroll_capture_sessions set capture_state='materialized',validation_status='valid',materialized_payment_request_id=v_request_id,
    materialized_at=now(),materialized_by=(p_server_result->>'actor_profile_id')::uuid,materialization_idempotency_hash=p_idempotency_key_hash,
    server_verification_summary=jsonb_build_object('contract_version','payroll-normalized-v1','file_count',jsonb_array_length(p_server_result->'files'),
      'line_count',jsonb_array_length(p_server_result->'lines'),'parser_versions',p_server_result->'parser_versions','verified_at',p_server_result->>'verified_at',
      'warning_codes',v_warning_codes,'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
      'provision_base_amount_minor',(p_server_result->>'provision_base_amount_minor')::bigint,'provision_status',v_provision->>'status',
      'provision_calculation_policy',v_provision->>'calculation_policy','provision_policy_version',v_provision->>'policy_version'),
    version=version+1,updated_at=now(),updated_by=(p_server_result->>'actor_profile_id')::uuid where id=v_session.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_materialization',v_session.id,'materialize',null,jsonb_build_object('redacted',true,'operation','server_verified_materialization'),
    (p_server_result->>'actor_profile_id')::uuid,'Server verification audit contains no employee, identifier, bank account, salary, or raw-byte values.');
  if exists(select 1 from public.notification_events where source_id=v_request_id and event_type<>'payroll.registered')
     or exists(select 1 from public.payment_request_approvals where payment_request_id=v_request_id)
     or exists(select 1 from public.approval_batch_items where payment_request_id=v_request_id)
  then raise exception 'payroll_materialization_side_effect_detected'; end if;
  return jsonb_build_object('status','materialized','payment_request_id',v_request_id,
    'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
    'provision_status',v_provision->>'status','provision_calculation_policy',v_provision->>'calculation_policy');
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_capture_sessions(p_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_unscoped jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') = 'service_role' then
    return public.get_payroll_capture_sessions_unscoped_internal(p_session_id);
  end if;

  if v_actor is null or not public.payroll_has_capture_access() then
    raise exception 'PAYROLL_CAPTURE_FINANCE_REQUIRED';
  end if;

  v_unscoped := public.get_payroll_capture_sessions_unscoped_internal(p_session_id);

  return coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(v_unscoped) item
    where public.payroll_capture_company_access((item ->> 'company_id')::uuid)
  ), '[]'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_insert_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.payroll_capture_company_access(case when p_name ~ '^[0-9a-f-]{36}/' then split_part(p_name,'/',1)::uuid else null end)
    and public.payroll_capture_storage_insert_allowed_unscoped_internal(p_name);
$function$;

CREATE OR REPLACE FUNCTION public.payroll_capture_storage_select_allowed(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.payroll_capture_company_access(case when p_name ~ '^[0-9a-f-]{36}/' then split_part(p_name,'/',1)::uuid else null end)
    and public.payroll_capture_storage_select_allowed_unscoped_internal(p_name);
$function$;

CREATE OR REPLACE FUNCTION public.save_payroll_capture_session(p_session_id uuid, p_expected_version integer, p_company_id uuid, p_company_bank_account_id uuid, p_payroll_subtype text, p_period_start date, p_period_end date, p_concept text, p_notes text, p_expected_channels text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing_company_id uuid;
begin
  if not public.payroll_capture_company_access(p_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  if p_session_id is not null then
    select company_id into v_existing_company_id
    from public.payroll_capture_sessions
    where id = p_session_id;

    if v_existing_company_id is null then
      raise exception 'PAYROLL_CAPTURE_SESSION_NOT_FOUND';
    end if;
    if not public.payroll_capture_company_access(v_existing_company_id) then
      raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
    end if;
  end if;

  return public.save_payroll_capture_session_unscoped_internal(
    p_session_id,
    p_expected_version,
    p_company_id,
    p_company_bank_account_id,
    p_payroll_subtype,
    p_period_start,
    p_period_end,
    p_concept,
    p_notes,
    p_expected_channels
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_payroll_capture_file(p_session_id uuid, p_expected_version integer, p_kind text, p_extension text, p_mime_type text, p_size_bytes bigint, p_sha256 text, p_parser_version text, p_parser_contract text, p_record_count integer, p_total_amount_minor bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_company_id uuid;
begin
  select company_id into v_company_id
  from public.payroll_capture_sessions
  where id = p_session_id;

  if v_company_id is null then
    raise exception 'PAYROLL_CAPTURE_SESSION_NOT_FOUND';
  end if;
  if not public.payroll_capture_company_access(v_company_id) then
    raise exception 'PAYROLL_CAPTURE_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  return public.reserve_payroll_capture_file_unscoped_internal(
    p_session_id,
    p_expected_version,
    p_kind,
    p_extension,
    p_mime_type,
    p_size_bytes,
    p_sha256,
    p_parser_version,
    p_parser_contract,
    p_record_count,
    p_total_amount_minor
  );
end;
$function$;

-- No generic Storage or payroll_run_lines policies are broadened.
create or replace function public.get_payroll_receipt_file_url(p_file_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_file record;
begin
  select f.id,f.storage_bucket,f.storage_path,c.channel,p.company_id into v_file
    from public.payroll_run_files f
    join public.payroll_channels c on c.receipt_file_id=f.id and c.id=f.payroll_channel_id and c.payment_request_id=f.payment_request_id
    join public.payment_requests p on p.id=c.payment_request_id
    where f.id=p_file_id and p.request_type::text='nomina'
      and c.reconciliation_status='reconciled' and f.parsing_status='parsed'
      and f.parsing_version='payroll-channel-receipt-v1'
      and f.kind='comprobante' and f.storage_bucket='payroll-private';
  if not found then raise exception 'PAYROLL_RECEIPT_FILE_NOT_FOUND'; end if;
  if not public.payroll_capture_company_access(v_file.company_id) then
    raise exception 'PAYROLL_CAPTURE_ACCESS_REQUIRED';
  end if;
  return jsonb_build_object('file_id',v_file.id,'storage_bucket',v_file.storage_bucket,
    'storage_path',v_file.storage_path,'download_name',v_file.channel||'.pdf');
end;
$$;
revoke all on function public.get_payroll_receipt_file_url(uuid) from public,anon;
grant execute on function public.get_payroll_receipt_file_url(uuid) to authenticated;
commit;
