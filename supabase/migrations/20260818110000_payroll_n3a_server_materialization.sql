-- N3A: server-verified payroll materialization. Draft only: do not apply in this gate.
-- Browser attestations remain diagnostic. Only the service-role Edge Function may
-- call the internal transaction after downloading, hashing, parsing and validating.

begin;

do $precheck$
begin
  if to_regclass('public.payroll_capture_sessions') is null
     or to_regclass('public.payroll_capture_files') is null
     or to_regclass('public.payroll_channels') is null
     or to_regclass('public.payroll_run_files') is null
     or to_regclass('public.payroll_run_lines') is null then
    raise exception 'payroll_n3a_foundation_missing';
  end if;
  if exists (select 1 from public.payroll_capture_sessions)
     or exists (select 1 from public.payroll_capture_files) then
    raise exception 'payroll_n3a_requires_empty_capture_staging';
  end if;
end;
$precheck$;

alter table public.payroll_capture_sessions
  add column cost_center_id uuid references public.cost_centers(id) on delete restrict,
  add column budget_category_id uuid references public.budget_categories(id) on delete restrict,
  add column budget_month date,
  add column materialized_payment_request_id uuid unique
    references public.payment_requests(id) on delete restrict,
  add column materialized_at timestamptz,
  add column materialized_by uuid references public.profiles(id) on delete restrict,
  add column materialization_idempotency_hash text,
  add column server_verification_summary jsonb;

alter table public.payroll_capture_sessions
  drop constraint payroll_capture_sessions_state_check,
  add constraint payroll_capture_sessions_state_check check (
    capture_state in ('draft','files_pending','validation_pending','ready_for_submission','materialized')
  ),
  add constraint payroll_capture_sessions_budget_month_check check (
    budget_month is null or date_trunc('month', budget_month::timestamp)::date = budget_month
  ),
  add constraint payroll_capture_sessions_materialized_check check (
    (capture_state <> 'materialized'
      and materialized_payment_request_id is null
      and materialized_at is null
      and materialized_by is null
      and materialization_idempotency_hash is null
      and server_verification_summary is null)
    or
    (capture_state = 'materialized'
      and validation_status = 'valid'
      and materialized_payment_request_id is not null
      and materialized_at is not null
      and materialized_by is not null
      and materialization_idempotency_hash ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(server_verification_summary) = 'object'
      and server_verification_summary - array[
        'contract_version','file_count','line_count','parser_versions','verified_at'
      ]::text[] = '{}'::jsonb)
  );

create index payroll_capture_sessions_cost_center_idx
  on public.payroll_capture_sessions(cost_center_id)
  where cost_center_id is not null;
create index payroll_capture_sessions_budget_category_idx
  on public.payroll_capture_sessions(budget_category_id)
  where budget_category_id is not null;

create function public.set_payroll_capture_accounting_context(
  p_capture_session_id uuid,
  p_expected_version integer,
  p_cost_center_id uuid,
  p_budget_category_id uuid default null,
  p_budget_month date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_session public.payroll_capture_sessions%rowtype; v_actor uuid;
begin
  v_actor:=public.current_profile_id();
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'payroll_capture_finance_required';
  end if;
  select * into v_session from public.payroll_capture_sessions
    where id=p_capture_session_id for update;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if v_session.expires_at<=now() or v_session.capture_state='materialized' then
    raise exception 'payroll_capture_not_editable';
  end if;
  if not exists(select 1 from public.cost_centers where id=p_cost_center_id and active) then
    raise exception 'payroll_capture_cost_center_invalid';
  end if;
  if p_budget_category_id is not null and not exists(
    select 1 from public.budget_categories where id=p_budget_category_id and active
  ) then raise exception 'payroll_capture_budget_category_invalid'; end if;
  if p_budget_month is not null and date_trunc('month',p_budget_month::timestamp)::date<>p_budget_month then
    raise exception 'payroll_capture_budget_month_invalid';
  end if;
  update public.payroll_capture_sessions set cost_center_id=p_cost_center_id,
    budget_category_id=p_budget_category_id,budget_month=p_budget_month,
    version=version+1,updated_by=v_actor,updated_at=now() where id=v_session.id;
  return jsonb_build_object('session_id',v_session.id,'version',v_session.version+1);
end;
$$;

revoke all on function public.set_payroll_capture_accounting_context(uuid,integer,uuid,uuid,date)
  from public, anon;
grant execute on function public.set_payroll_capture_accounting_context(uuid,integer,uuid,uuid,date)
  to authenticated, service_role;

alter table public.payroll_run_files
  add column capture_file_id uuid unique
    references public.payroll_capture_files(id) on delete restrict;

alter table public.payroll_run_files
  drop constraint payroll_run_files_path_check,
  add constraint payroll_run_files_path_check check (
    (
      capture_file_id is null
      and storage_path like payment_request_id::text || '/%'
      and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'
    )
    or
    (
      capture_file_id is not null
      and split_part(storage_path, '/', 2) = payment_request_id::text
      and storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.[a-z0-9]{1,10}$'
    )
  );

create or replace function public.payroll_validate_materialized_capture_file()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_capture public.payroll_capture_files%rowtype;
  v_session public.payroll_capture_sessions%rowtype;
  v_request public.payment_requests%rowtype;
begin
  if new.capture_file_id is null then return new; end if;
  select * into v_capture from public.payroll_capture_files where id = new.capture_file_id;
  select * into v_session from public.payroll_capture_sessions where id = v_capture.session_id;
  select * into v_request from public.payment_requests where id = new.payment_request_id;
  if not found
     or v_capture.upload_state <> 'uploaded' or not v_capture.is_current
     or v_capture.storage_bucket <> new.storage_bucket
     or v_capture.storage_path <> new.storage_path
     or v_capture.size_bytes <> new.size_bytes
     or v_capture.sha256 <> new.sha256
     or v_session.reserved_payment_request_id <> new.payment_request_id
     or v_session.company_id <> v_request.company_id
     or split_part(new.storage_path,'/',1) <> v_session.company_id::text
     or split_part(new.storage_path,'/',2) <> new.payment_request_id::text then
    raise exception 'payroll_capture_file_provenance_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function public.payroll_validate_materialized_capture_file() from public, anon, authenticated;
grant execute on function public.payroll_validate_materialized_capture_file() to service_role;

create trigger payroll_run_files_capture_provenance_guard
before insert or update of capture_file_id,storage_path,sha256,size_bytes on public.payroll_run_files
for each row execute function public.payroll_validate_materialized_capture_file();

-- A materialized payroll request is deliberately a draft: no approver snapshot,
-- no submission timestamp, and no creation notification.
alter table public.payment_requests
  add constraint payment_requests_payroll_draft_no_submission_check check (
    request_type::text <> 'nomina' or status::text <> 'draft' or (
      approver_id is null and approver_assignment_id is null
      and approver_selection_source is null and submitted_at is null
      and approved_by is null and approved_at is null
    )
  ) not valid;
alter table public.payment_requests
  validate constraint payment_requests_payroll_draft_no_submission_check;

drop trigger payment_request_created_notification_event on public.payment_requests;
create trigger payment_request_created_notification_event
after insert on public.payment_requests
for each row
when (not (new.request_type::text = 'nomina' and new.status::text = 'draft'))
execute function public.enqueue_payment_request_created_notification();

drop trigger validate_payment_request_approver_scope_insert on public.payment_requests;
create trigger validate_payment_request_approver_scope_insert
before insert on public.payment_requests
for each row
when (not (new.request_type::text = 'nomina' and new.status::text = 'draft'))
execute function public.validate_payment_request_approver_scope();

create function public.get_payroll_materialization_context_internal(
  p_capture_session_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare v_session public.payroll_capture_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'payroll_materialization_service_role_required';
  end if;
  select * into v_session from public.payroll_capture_sessions where id=p_capture_session_id;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.version <> p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  return jsonb_build_object(
    'id',v_session.id,'version',v_session.version,
    'reserved_payment_request_id',v_session.reserved_payment_request_id,
    'company_id',v_session.company_id,'company_bank_account_id',v_session.company_bank_account_id,
    'cost_center_id',v_session.cost_center_id,'budget_category_id',v_session.budget_category_id,
    'budget_month',v_session.budget_month,'payroll_subtype',v_session.payroll_subtype,
    'period_start',v_session.period_start,'period_end',v_session.period_end,
    'concept',v_session.concept,'notes',v_session.notes,
    'expected_channels',v_session.expected_channels,'capture_state',v_session.capture_state,
    'validation_status',v_session.validation_status,'expires_at',v_session.expires_at,
    'source_accounts',(select jsonb_build_array(a.account_number,a.clabe)
      from public.company_bank_accounts a where a.id=v_session.company_bank_account_id
        and a.company_id=v_session.company_id and a.active and a.account_type::text='bank'
        and upper(a.currency) in ('MXN','MXP')),
    'files',coalesce((select jsonb_agg(jsonb_build_object(
      'id',f.id,'kind',f.kind,'channel',f.channel,'storage_bucket',f.storage_bucket,
      'storage_path',f.storage_path,'mime_type',f.mime_type,'size_bytes',f.size_bytes,
      'sha256',f.sha256,'upload_state',f.upload_state,'capability_code',f.capability_code,
      'parsing_status',f.parsing_status,'validation_authority',f.validation_authority,
      'parser_version',f.parser_version,'parser_contract',f.parser_contract,
      'record_count',f.record_count,'total_amount_minor',f.total_amount_minor,
      'object_size',nullif(o.metadata->>'size','')::bigint,'object_mime',o.metadata->>'mimetype'
    ) order by f.kind) from public.payroll_capture_files f
      left join storage.objects o on o.bucket_id=f.storage_bucket and o.name=f.storage_path
      where f.session_id=v_session.id and f.is_current and f.upload_state='uploaded'),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_payroll_materialization_context_internal(uuid,integer)
  from public, anon, authenticated;
grant execute on function public.get_payroll_materialization_context_internal(uuid,integer)
  to service_role;

create or replace function public.payroll_capture_storage_select_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.payroll_has_finance_pii_access() and exists (
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
$$;

-- Trusted internal transaction. The browser never calls this function. The Edge
-- Function alone supplies the normalized result produced from downloaded bytes.
create function public.materialize_payroll_capture_internal(
  p_capture_session_id uuid,
  p_expected_version integer,
  p_idempotency_key_hash text,
  p_server_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.payroll_capture_sessions%rowtype;
  v_actor uuid;
  v_request_id uuid;
  v_channel jsonb;
  v_file jsonb;
  v_line jsonb;
  v_channel_ids jsonb := '{}'::jsonb;
  v_file_ids jsonb := '{}'::jsonb;
  v_amount_minor bigint := 0;
  v_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'payroll_materialization_service_role_required';
  end if;
  if p_idempotency_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'payroll_materialization_idempotency_invalid';
  end if;
  select * into v_session from public.payroll_capture_sessions
    where id=p_capture_session_id for update;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.capture_state='materialized' then
    if v_session.materialization_idempotency_hash=p_idempotency_key_hash then
      return jsonb_build_object('status','already_materialized','payment_request_id',v_session.materialized_payment_request_id);
    end if;
    raise exception 'payroll_capture_already_materialized';
  end if;
  if v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_expired'; end if;
  if v_session.capture_state not in ('validation_pending','ready_for_submission') then
    raise exception 'payroll_capture_not_materializable';
  end if;
  if v_session.cost_center_id is null then raise exception 'payroll_capture_accounting_context_required'; end if;
  if p_server_result->>'contract_version' <> 'payroll-normalized-v1'
     or coalesce((p_server_result->>'valid')::boolean,false) is not true
     or jsonb_array_length(coalesce(p_server_result->'issues','[]'::jsonb))<>0 then
    raise exception 'payroll_server_validation_required';
  end if;
  v_actor := (p_server_result->>'actor_profile_id')::uuid;
  if v_actor is null then raise exception 'payroll_materialization_actor_required'; end if;
  if not exists(
    select 1 from public.profiles p
    join public.user_roles ur on ur.profile_id=p.id
    join public.roles r on r.id=ur.role_id
    where p.id=v_actor and p.active
      and lower(btrim(r.name))=any(array['finance','finanzas','treasury','tesoreria','administracion'])
  ) or not public.has_active_company_membership(v_actor,v_session.company_id) then
    raise exception 'payroll_materialization_finance_required';
  end if;
  if (p_server_result->>'capture_session_id')::uuid <> v_session.id
     or (p_server_result->>'capture_version')::integer <> v_session.version then
    raise exception 'payroll_server_result_binding_mismatch';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_server_result->'files') x where x->>'kind'='caratula' and x->>'authority'='server_verified') then
    raise exception 'PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED';
  end if;

  select coalesce(sum((x->>'amount_minor')::bigint),0),count(*)
    into v_amount_minor,v_count from jsonb_array_elements(p_server_result->'channels') x
    where (x->>'amount_minor')::bigint>0;
  if v_count=0 or v_amount_minor<=0 then raise exception 'payroll_channel_totals_invalid'; end if;
  if v_count<>cardinality(v_session.expected_channels)
     or exists(select 1 from unnest(v_session.expected_channels) expected
       where not exists(select 1 from jsonb_array_elements(p_server_result->'channels') x
         where x->>'channel'=expected and (x->>'amount_minor')::bigint>0)) then
    raise exception 'payroll_channel_inventory_mismatch';
  end if;
  select count(*) into v_count from public.payroll_capture_files
    where session_id=v_session.id and is_current and upload_state='uploaded';
  if v_count<>jsonb_array_length(p_server_result->'files') then
    raise exception 'payroll_file_inventory_mismatch';
  end if;
  if jsonb_array_length(p_server_result->'lines')=0 then
    raise exception 'payroll_server_lines_required';
  end if;

  v_request_id := v_session.reserved_payment_request_id;
  insert into public.payment_requests(
    id,request_type,requested_by,company_id,company_bank_account_id,cost_center_id,
    budget_category_id,budget_month,amount_requested,currency,exchange_rate,
    status,concept,description,notes,payroll_subtype,payroll_period_start,payroll_period_end,
    provider_id,proveedor_id,provider_bank_account_id,approver_id,submitted_at
  ) values (
    v_request_id,'nomina',v_actor,v_session.company_id,v_session.company_bank_account_id,
    v_session.cost_center_id,v_session.budget_category_id,v_session.budget_month,
    v_amount_minor/100.0,'MXN',1,'draft',v_session.concept,v_session.concept,v_session.notes,
    v_session.payroll_subtype,v_session.period_start,v_session.period_end,
    null,null,null,null,null
  );

  for v_channel in select value from jsonb_array_elements(p_server_result->'channels') loop
    if v_channel->>'channel' <> all(v_session.expected_channels) then raise exception 'payroll_channel_inventory_mismatch'; end if;
    v_actor:=null;
    insert into public.payroll_channels(payment_request_id,channel,amount,currency)
      values(v_request_id,v_channel->>'channel',(v_channel->>'amount_minor')::bigint/100.0,'MXN')
      returning id into v_actor;
    v_channel_ids:=v_channel_ids||jsonb_build_object(v_channel->>'channel',v_actor);
  end loop;

  for v_file in select value from jsonb_array_elements(p_server_result->'files') loop
    v_actor:=null;
    insert into public.payroll_run_files(
      payment_request_id,payroll_channel_id,kind,storage_bucket,storage_path,
      original_filename,mime_type,size_bytes,sha256,uploaded_by,uploaded_at,
      parsing_status,parsing_version,parsing_metadata,capture_file_id
    ) select v_request_id,
      case when f.channel is null then null else (v_channel_ids->>f.channel)::uuid end,
      f.kind,f.storage_bucket,f.storage_path,f.kind||'.'||f.extension,f.mime_type,
      f.size_bytes,v_file->>'sha256',f.uploaded_by,f.uploaded_at,'parsed',
      v_file->>'parser_version',jsonb_build_object(
        'evidence_class','SERVER_VERIFIED','parser_version',v_file->>'parser_version',
        'row_count',coalesce((v_file->>'record_count')::integer,0),'issue_codes','[]'::jsonb
      ),f.id
    from public.payroll_capture_files f
    where f.id=(v_file->>'capture_file_id')::uuid and f.session_id=v_session.id
      and f.sha256=v_file->>'sha256' and f.is_current and f.upload_state='uploaded'
    returning id into v_actor;
    if v_actor is null then raise exception 'payroll_server_file_binding_mismatch'; end if;
    v_file_ids:=v_file_ids||jsonb_build_object(v_file->>'capture_file_id',v_actor);
  end loop;

  for v_line in select value from jsonb_array_elements(p_server_result->'lines') loop
    insert into public.payroll_run_lines(
      payment_request_id,source_file_id,source_sheet,source_row_number,extraction_version,
      employee_name,rfc,curp,nss,bank_name,bank_account,clabe,
      net_amount,bank_amount,spei_amount,vouchers_amount
    ) values (
      v_request_id,(v_file_ids->>(v_line->>'source_capture_file_id'))::uuid,
      v_line->>'source_sheet',(v_line->>'source_row_number')::integer,
      v_line->>'extraction_version',v_line->>'employee_name',v_line->>'rfc',v_line->>'curp',v_line->>'nss',
      v_line->>'bank_name',v_line->>'bank_account',v_line->>'clabe',
      (v_line->>'net_amount_minor')::bigint/100.0,(v_line->>'bank_amount_minor')::bigint/100.0,
      (v_line->>'spei_amount_minor')::bigint/100.0,(v_line->>'vouchers_amount_minor')::bigint/100.0
    );
  end loop;

  update public.payroll_channels c set layout_file_id=f.id
  from public.payroll_run_files f where c.payment_request_id=v_request_id
    and f.payroll_channel_id=c.id and f.kind=case c.channel when 'banco' then 'layout_mismo_banco' when 'spei' then 'layout_spei' else 'layout_toka' end;

  update public.payroll_capture_sessions set capture_state='materialized',validation_status='valid',
    materialized_payment_request_id=v_request_id,materialized_at=now(),materialized_by=(p_server_result->>'actor_profile_id')::uuid,
    materialization_idempotency_hash=p_idempotency_key_hash,
    server_verification_summary=jsonb_build_object(
      'contract_version','payroll-normalized-v1','file_count',jsonb_array_length(p_server_result->'files'),
      'line_count',jsonb_array_length(p_server_result->'lines'),'parser_versions',p_server_result->'parser_versions',
      'verified_at',p_server_result->>'verified_at'
    ),version=version+1,updated_at=now(),updated_by=(p_server_result->>'actor_profile_id')::uuid
  where id=v_session.id;

  insert into public.activity_log(
    entity_type,entity_id,action,old_values,new_values,performed_by,notes
  ) values (
    'payroll_materialization',v_session.id,'materialize',null,
    jsonb_build_object('redacted',true,'operation','server_verified_materialization'),
    (p_server_result->>'actor_profile_id')::uuid,
    'Server verification audit contains no employee, identifier, bank account, salary, or raw-byte values.'
  );

  if exists(select 1 from public.notification_events where source_id=v_request_id)
     or exists(select 1 from public.payment_request_approvals where payment_request_id=v_request_id)
     or exists(select 1 from public.approval_batch_items where payment_request_id=v_request_id) then
    raise exception 'payroll_materialization_side_effect_detected';
  end if;
  return jsonb_build_object('status','materialized','payment_request_id',v_request_id);
end;
$$;

revoke all on function public.materialize_payroll_capture_internal(uuid,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.materialize_payroll_capture_internal(uuid,integer,text,jsonb)
  to service_role;

do $postcheck$
begin
  if to_regprocedure('public.get_payroll_materialization_context_internal(uuid,integer)') is null
     or to_regprocedure('public.materialize_payroll_capture_internal(uuid,integer,text,jsonb)') is null then
    raise exception 'payroll_n3a_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
