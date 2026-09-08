-- Payroll materialization: assign request_number (folio) on the materialized
-- payment_requests row. The normal create_payment_request path assigns a folio
-- via public.generate_payment_request_number(v_year); the payroll server-side
-- materialization was inserting the request WITHOUT request_number, leaving it
-- NULL. This recreates the vigente function (RC1 provisions version) BYTE-IDENTICAL
-- except: declare v_year and add request_number to the payment_requests INSERT.
-- Also backfills existing nomina requests whose folio is NULL (idempotent).

begin;

create or replace function public.materialize_payroll_capture_internal(p_capture_session_id uuid, p_expected_version integer, p_idempotency_key_hash text, p_server_result jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
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
  if exists(select 1 from public.notification_events where source_id=v_request_id)
     or exists(select 1 from public.payment_request_approvals where payment_request_id=v_request_id)
     or exists(select 1 from public.approval_batch_items where payment_request_id=v_request_id)
  then raise exception 'payroll_materialization_side_effect_detected'; end if;
  return jsonb_build_object('status','materialized','payment_request_id',v_request_id,
    'finance_review_required',coalesce((p_server_result->>'finance_review_required')::boolean,false),
    'provision_status',v_provision->>'status','provision_calculation_policy',v_provision->>'calculation_policy');
end;
$function$;

-- Backfill: existing nomina requests without folio. Idempotent (only touches NULL).
-- Ordered by created_at so the sequence follows chronological order.
do $backfill$
declare r record;
begin
  for r in
    select id, coalesce(budget_month, created_at::date) as ref_date
    from public.payment_requests
    where request_type::text = 'nomina' and request_number is null
    order by created_at asc
  loop
    update public.payment_requests
      set request_number = public.generate_payment_request_number(extract(year from r.ref_date)::int)
      where id = r.id and request_number is null;
  end loop;
end;
$backfill$;

commit;
