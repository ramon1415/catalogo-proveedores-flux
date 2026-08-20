-- N3F: certify real payroll physical formats and model TOKA treasury funding separately
-- from the employee voucher benefit. Forward-only; no business data backfill.

begin;

do $precheck$
begin
  if to_regclass('public.payroll_capture_files') is null
     or to_regclass('public.payroll_channels') is null
     or to_regclass('public.payroll_run_lines') is null
     or to_regprocedure('public.materialize_payroll_capture_internal(uuid,integer,text,jsonb)') is null
     or to_regprocedure('public.submit_payroll_for_approval(uuid,uuid,uuid)') is null then
    raise exception 'payroll_n3f_prerequisite_missing';
  end if;
  if exists(select 1 from public.payroll_capture_sessions)
     or exists(select 1 from public.payroll_capture_files)
     or exists(select 1 from public.payment_requests where request_type::text='nomina') then
    raise exception 'payroll_n3f_requires_zero_payroll_state';
  end if;
end;
$precheck$;

alter table public.payroll_run_lines drop constraint payroll_run_lines_amounts_check;
alter table public.payroll_run_lines add constraint payroll_run_lines_amounts_check check (
  net_amount >= 0 and bank_amount >= 0 and spei_amount >= 0 and vouchers_amount >= 0
  and net_amount = bank_amount + spei_amount + vouchers_amount
  and (net_amount > 0 or (bank_amount = 0 and spei_amount = 0 and vouchers_amount = 0))
);

alter table public.payroll_channels
  add column benefit_amount numeric,
  add column fee_amount numeric,
  add column tax_amount numeric,
  add column expected_funding_amount numeric,
  add column funding_variance_acknowledged_at timestamptz,
  add column funding_variance_acknowledged_by uuid references public.profiles(id),
  add column funding_variance_note text;

alter table public.payroll_channels add constraint payroll_channels_vales_breakdown_check check (
  (channel <> 'vales' and benefit_amount is null and fee_amount is null and tax_amount is null
    and expected_funding_amount is null and funding_variance_acknowledged_at is null
    and funding_variance_acknowledged_by is null and funding_variance_note is null)
  or
  (channel = 'vales'
    and benefit_amount is not null and benefit_amount >= 0
    and fee_amount is not null and fee_amount >= 0
    and tax_amount is not null and tax_amount >= 0
    and expected_funding_amount is not null and expected_funding_amount > 0
    and expected_funding_amount = benefit_amount + fee_amount + tax_amount
    and (
      (amount = expected_funding_amount and funding_variance_acknowledged_at is null
        and funding_variance_acknowledged_by is null and funding_variance_note is null)
      or
      (amount <> expected_funding_amount and (
        (funding_variance_acknowledged_at is null and funding_variance_acknowledged_by is null and funding_variance_note is null)
        or
        (funding_variance_acknowledged_at is not null and funding_variance_acknowledged_by is not null
          and nullif(btrim(funding_variance_note),'') is not null)
      ))
    )
  )
);

create function public.guard_payroll_channel_financial_snapshot()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.payroll_request_has_valid_materialization(old.payment_request_id)
     and (new.amount is distinct from old.amount or new.currency is distinct from old.currency
       or new.benefit_amount is distinct from old.benefit_amount or new.fee_amount is distinct from old.fee_amount
       or new.tax_amount is distinct from old.tax_amount or new.expected_funding_amount is distinct from old.expected_funding_amount) then
    raise exception 'PAYROLL_CHANNEL_FINANCIAL_SNAPSHOT_IMMUTABLE';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_payroll_channel_financial_snapshot() from public,anon,authenticated;
create trigger guard_payroll_channel_financial_snapshot
before update of amount,currency,benefit_amount,fee_amount,tax_amount,expected_funding_amount
on public.payroll_channels for each row execute function public.guard_payroll_channel_financial_snapshot();

alter table public.payroll_capture_files drop constraint payroll_capture_files_capability_check;
alter table public.payroll_capture_files drop constraint payroll_capture_files_channel_check;
alter table public.payroll_capture_files drop constraint payroll_capture_files_extension_check;
alter table public.payroll_capture_files drop constraint payroll_capture_files_kind_check;
alter table public.payroll_capture_files drop constraint payroll_capture_files_media_contract_check;
alter table public.payroll_capture_files drop constraint payroll_capture_files_parser_check;

alter table public.payroll_capture_files add constraint payroll_capture_files_kind_check check (
  kind in ('caratula','layout_mismo_banco','layout_spei','layout_toka','cfdi_vales')
);
alter table public.payroll_capture_files add constraint payroll_capture_files_extension_check check (extension in ('xlsx','txt','xml'));
alter table public.payroll_capture_files add constraint payroll_capture_files_channel_check check (
  (kind='caratula' and channel is null)
  or (kind='layout_mismo_banco' and channel is not distinct from 'banco')
  or (kind='layout_spei' and channel is not distinct from 'spei')
  or (kind in ('layout_toka','cfdi_vales') and channel is not distinct from 'vales')
);
alter table public.payroll_capture_files add constraint payroll_capture_files_media_contract_check check (
  (kind='caratula' and extension='xlsx' and mime_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  or (kind in ('layout_mismo_banco','layout_spei','layout_toka') and extension='txt' and mime_type='text/plain')
  or (kind='cfdi_vales' and extension='xml' and mime_type in ('application/xml','text/xml'))
);
alter table public.payroll_capture_files add constraint payroll_capture_files_capability_check check (
  capability_code='supported_certified' and parsing_status='client_parsed_unverified' and validation_authority='browser_client_attested'
);
alter table public.payroll_capture_files add constraint payroll_capture_files_parser_check check (
  issue_codes=array[]::text[] and record_count is not null and record_count>0
  and total_amount_minor is not null and total_amount_minor>0
  and (
    (kind='caratula' and parser_version='payroll-real-physical-v1' and parser_contract='operadora-tlacatecpan-cover-v1')
    or (kind='layout_mismo_banco' and parser_version='payroll-real-physical-v1' and parser_contract='bbva-payroll-nomina108-v1')
    or (kind='cfdi_vales' and parser_version='payroll-real-physical-v1' and parser_contract='toka-cfdi-vales-v1')
    or (kind in ('layout_spei','layout_toka') and parser_version='payroll-normalized-v1' and parser_contract='bbva-simulator-pagos-interbancarios-128-v1')
  )
);

create or replace function public.reserve_payroll_capture_file(
  p_session_id uuid,p_expected_version integer,p_kind text,p_extension text,p_mime_type text,
  p_size_bytes bigint,p_sha256 text,p_parser_version text,p_parser_contract text,p_record_count integer,p_total_amount_minor bigint
)
returns jsonb language plpgsql security definer set search_path=public,storage,pg_temp as $$
declare v_actor uuid:=public.current_profile_id(); v_session public.payroll_capture_sessions%rowtype;
  v_file_id uuid:=gen_random_uuid(); v_channel text; v_path text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'payroll_capture_finance_required'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_session_id for update;
  if not found then raise exception 'payroll_capture_session_not_found'; end if;
  if v_session.expires_at<=now() then raise exception 'payroll_capture_session_expired'; end if;
  if p_expected_version is null or v_session.version<>p_expected_version then raise exception 'payroll_capture_version_conflict'; end if;
  if p_size_bytes not between 1 and 26214400 or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'payroll_capture_file_metadata_invalid'; end if;
  if coalesce(p_record_count,0)<=0 or coalesce(p_total_amount_minor,0)<=0 then raise exception 'payroll_capture_parser_validation_required'; end if;
  case p_kind
    when 'caratula' then
      if p_extension<>'xlsx' or p_mime_type<>'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
         or p_parser_version is distinct from 'payroll-real-physical-v1' or p_parser_contract is distinct from 'operadora-tlacatecpan-cover-v1'
      then raise exception 'payroll_capture_cover_validation_required'; end if; v_channel:=null;
    when 'layout_mismo_banco' then
      if not ('banco'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain'
         or p_parser_version is distinct from 'payroll-real-physical-v1' or p_parser_contract is distinct from 'bbva-payroll-nomina108-v1'
      then raise exception 'payroll_capture_same_bank_validation_required'; end if; v_channel:='banco';
    when 'layout_spei' then
      if not ('spei'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain'
         or p_parser_version is distinct from 'payroll-normalized-v1' or p_parser_contract is distinct from 'bbva-simulator-pagos-interbancarios-128-v1'
      then raise exception 'payroll_capture_spei_validation_required'; end if; v_channel:='spei';
    when 'layout_toka' then
      if not ('vales'=any(v_session.expected_channels)) or p_extension<>'txt' or p_mime_type<>'text/plain'
         or p_parser_version is distinct from 'payroll-normalized-v1' or p_parser_contract is distinct from 'bbva-simulator-pagos-interbancarios-128-v1'
      then raise exception 'payroll_capture_toka_funding_validation_required'; end if; v_channel:='vales';
    when 'cfdi_vales' then
      if not ('vales'=any(v_session.expected_channels)) or p_extension<>'xml' or p_mime_type not in ('application/xml','text/xml')
         or p_parser_version is distinct from 'payroll-real-physical-v1' or p_parser_contract is distinct from 'toka-cfdi-vales-v1'
      then raise exception 'payroll_capture_toka_cfdi_validation_required'; end if; v_channel:='vales';
    else raise exception 'payroll_capture_file_kind_unsupported';
  end case;
  v_path:=concat(v_session.company_id::text,'/',v_session.reserved_payment_request_id::text,'/',v_file_id::text,'.',p_extension);
  insert into public.payroll_capture_files(id,session_id,kind,channel,storage_path,extension,mime_type,size_bytes,sha256,
    capability_code,parsing_status,validation_authority,parser_version,parser_contract,record_count,total_amount_minor,issue_codes,reserved_by)
  values(v_file_id,v_session.id,p_kind,v_channel,v_path,p_extension,p_mime_type,p_size_bytes,p_sha256,
    'supported_certified','client_parsed_unverified','browser_client_attested',p_parser_version,p_parser_contract,p_record_count,p_total_amount_minor,array[]::text[],v_actor);
  return jsonb_build_object('file_id',v_file_id,'storage_bucket','payroll-private','storage_path',v_path);
end;
$$;
revoke all on function public.reserve_payroll_capture_file(uuid,integer,text,text,text,bigint,text,text,text,integer,bigint) from public,anon;
grant execute on function public.reserve_payroll_capture_file(uuid,integer,text,text,text,bigint,text,text,text,integer,bigint) to authenticated,service_role;

create or replace function public.payroll_capture_refresh_state(p_session_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.payroll_capture_sessions%rowtype; v_missing boolean;
begin
  select * into v_session from public.payroll_capture_sessions where id=p_session_id for update;
  if not found then raise exception 'payroll_capture_session_not_found'; end if;
  v_missing:=not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='caratula' and f.upload_state='uploaded' and f.is_current)
    or ('banco'=any(v_session.expected_channels) and not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='layout_mismo_banco' and f.upload_state='uploaded' and f.is_current))
    or ('spei'=any(v_session.expected_channels) and not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='layout_spei' and f.upload_state='uploaded' and f.is_current))
    or ('vales'=any(v_session.expected_channels) and (
      not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='layout_toka' and f.upload_state='uploaded' and f.is_current)
      or not exists(select 1 from public.payroll_capture_files f where f.session_id=v_session.id and f.kind='cfdi_vales' and f.upload_state='uploaded' and f.is_current)
    ));
  update public.payroll_capture_sessions set capture_state=case when v_missing then 'files_pending' else 'validation_pending' end,
    validation_status=case when v_missing then 'incomplete' else 'blocked' end,updated_at=now() where id=v_session.id;
end;
$$;
revoke all on function public.payroll_capture_refresh_state(uuid) from public,anon,authenticated;
grant execute on function public.payroll_capture_refresh_state(uuid) to service_role;

alter table public.payroll_capture_sessions drop constraint payroll_capture_sessions_materialized_check;
alter table public.payroll_capture_sessions add constraint payroll_capture_sessions_materialized_check check (
  (capture_state<>'materialized' and materialized_payment_request_id is null and materialized_at is null and materialized_by is null
    and materialization_idempotency_hash is null and server_verification_summary is null)
  or
  (capture_state='materialized' and validation_status='valid' and materialized_payment_request_id is not null and materialized_at is not null
    and materialized_by is not null and materialization_idempotency_hash ~ '^[0-9a-f]{64}$'
    and jsonb_typeof(server_verification_summary)='object'
    and server_verification_summary-array['contract_version','file_count','line_count','parser_versions','verified_at','warning_codes','finance_review_required']::text[]='{}'::jsonb)
);

create or replace function public.materialize_payroll_capture_internal(
  p_capture_session_id uuid,p_expected_version integer,p_idempotency_key_hash text,p_server_result jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.payroll_capture_sessions%rowtype; v_actor uuid; v_request_id uuid; v_channel jsonb; v_file jsonb; v_line jsonb;
  v_channel_ids jsonb:='{}'::jsonb; v_file_ids jsonb:='{}'::jsonb; v_amount_minor bigint:=0; v_count integer; v_warning_codes jsonb;
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
  v_actor:=(p_server_result->>'actor_profile_id')::uuid;
  if v_actor is null then raise exception 'payroll_materialization_actor_required'; end if;
  if not exists(select 1 from public.profiles p join public.user_roles ur on ur.profile_id=p.id join public.roles r on r.id=ur.role_id
      where p.id=v_actor and p.active and lower(btrim(r.name))=any(array['finance','finanzas','treasury','tesoreria','administracion']))
     or not public.has_active_company_membership(v_actor,v_session.company_id) then raise exception 'payroll_materialization_finance_required'; end if;
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

  v_request_id:=v_session.reserved_payment_request_id;
  insert into public.payment_requests(id,request_type,requested_by,company_id,company_bank_account_id,cost_center_id,budget_category_id,budget_month,
    amount_requested,currency,exchange_rate,status,concept,description,notes,payroll_subtype,payroll_period_start,payroll_period_end,
    provider_id,proveedor_id,provider_bank_account_id,approver_id,submitted_at)
  values(v_request_id,'nomina',v_actor,v_session.company_id,v_session.company_bank_account_id,v_session.cost_center_id,v_session.budget_category_id,v_session.budget_month,
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

  select coalesce(jsonb_agg(w->>'code'),'[]'::jsonb) into v_warning_codes
  from jsonb_array_elements(coalesce(p_server_result->'warnings','[]'::jsonb)) w;
  update public.payroll_capture_sessions set capture_state='materialized',validation_status='valid',materialized_payment_request_id=v_request_id,
    materialized_at=now(),materialized_by=(p_server_result->>'actor_profile_id')::uuid,materialization_idempotency_hash=p_idempotency_key_hash,
    server_verification_summary=jsonb_build_object('contract_version','payroll-normalized-v1','file_count',jsonb_array_length(p_server_result->'files'),
      'line_count',jsonb_array_length(p_server_result->'lines'),'parser_versions',p_server_result->'parser_versions','verified_at',p_server_result->>'verified_at',
      'warning_codes',v_warning_codes,'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false)),
    version=version+1,updated_at=now(),updated_by=(p_server_result->>'actor_profile_id')::uuid where id=v_session.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_materialization',v_session.id,'materialize',null,jsonb_build_object('redacted',true,'operation','server_verified_materialization'),
    (p_server_result->>'actor_profile_id')::uuid,'Server verification audit contains no employee, identifier, bank account, salary, or raw-byte values.');
  if exists(select 1 from public.notification_events where source_id=v_request_id)
     or exists(select 1 from public.payment_request_approvals where payment_request_id=v_request_id)
     or exists(select 1 from public.approval_batch_items where payment_request_id=v_request_id)
  then raise exception 'payroll_materialization_side_effect_detected'; end if;
  return jsonb_build_object('status','materialized','payment_request_id',v_request_id,
    'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false));
end;
$$;
revoke all on function public.materialize_payroll_capture_internal(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.materialize_payroll_capture_internal(uuid,integer,text,jsonb) to service_role;

create function public.acknowledge_payroll_toka_funding_variance(p_payment_request_id uuid,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_actor uuid:=public.current_profile_id(); v_request public.payment_requests%rowtype; v_channel public.payroll_channels%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'draft' or v_request.requested_by is distinct from v_actor
     or not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_TOKA_VARIANCE_REVIEW_NOT_ALLOWED'; end if;
  select * into v_channel from public.payroll_channels where payment_request_id=v_request.id and channel='vales' for update;
  if not found then raise exception 'PAYROLL_TOKA_CHANNEL_REQUIRED'; end if;
  if v_channel.amount is not distinct from v_channel.expected_funding_amount then return jsonb_build_object('status','no_variance','payment_request_id',v_request.id); end if;
  if v_channel.funding_variance_acknowledged_at is not null then return jsonb_build_object('status','already_acknowledged','payment_request_id',v_request.id); end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null or char_length(btrim(p_note))>500 then raise exception 'PAYROLL_TOKA_VARIANCE_NOTE_REQUIRED'; end if;
  update public.payroll_channels set funding_variance_acknowledged_at=now(),funding_variance_acknowledged_by=v_actor,
    funding_variance_note=btrim(p_note),updated_at=now() where id=v_channel.id;
  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values('payroll_toka_variance',v_request.id,'acknowledge_funding_variance',null,
    jsonb_build_object('redacted',true,'operation','toka_funding_variance_acknowledged'),v_actor,
    'Funding variance acknowledgement excludes employee and bank values.');
  return jsonb_build_object('status','acknowledged','payment_request_id',v_request.id);
end;
$$;
revoke all on function public.acknowledge_payroll_toka_funding_variance(uuid,text) from public,anon;
grant execute on function public.acknowledge_payroll_toka_funding_variance(uuid,text) to authenticated,service_role;

create function public.guard_payroll_toka_variance_before_submit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.payroll_channels c where c.payment_request_id=old.id and c.channel='vales'
      and c.amount is distinct from c.expected_funding_amount and c.funding_variance_acknowledged_at is null)
  then raise exception 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'; end if;
  return new;
end;
$$;
revoke all on function public.guard_payroll_toka_variance_before_submit() from public,anon,authenticated;
create trigger guard_payroll_toka_variance_before_submit
before update of status on public.payment_requests
for each row when (old.request_type::text='nomina' and old.status::text='draft' and new.status::text='submitted')
execute function public.guard_payroll_toka_variance_before_submit();

do $postcheck$
begin
  if to_regprocedure('public.acknowledge_payroll_toka_funding_variance(uuid,text)') is null
     or to_regprocedure('public.guard_payroll_toka_variance_before_submit()') is null
  then raise exception 'payroll_n3f_contract_incomplete'; end if;
end;
$postcheck$;

commit;
