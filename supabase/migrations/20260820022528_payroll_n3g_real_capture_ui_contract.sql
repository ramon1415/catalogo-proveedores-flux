-- N3G: wire the certified N3F backend to a Finance-facing real capture flow.
-- Adds accounting-context save, aggregate submission summary and materialization
-- retry compatibility. No business-data backfill and no dispersion semantics.

begin;

do $precheck$
begin
  if to_regclass('public.payroll_capture_sessions') is null
     or to_regprocedure('public.save_payroll_capture_session(uuid,integer,uuid,uuid,text,date,date,text,text,text[])') is null
     or to_regprocedure('public.get_payroll_materialization_context_internal(uuid,integer)') is null
     or to_regprocedure('public.submit_payroll_for_approval(uuid,uuid,uuid)') is null
     or to_regprocedure('public.acknowledge_payroll_toka_funding_variance(uuid,text)') is null then
    raise exception 'payroll_n3g_prerequisite_missing';
  end if;
end;
$precheck$;

create or replace function public.save_payroll_capture_session_n3g(
  p_session_id uuid,
  p_expected_version integer,
  p_company_id uuid,
  p_company_bank_account_id uuid,
  p_cost_center_id uuid,
  p_payroll_subtype text,
  p_period_start date,
  p_period_end date,
  p_concept text,
  p_notes text,
  p_expected_channels text[]
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_existing public.payroll_capture_sessions%rowtype;
  v_result jsonb;
  v_id uuid;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
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
$$;
revoke all on function public.save_payroll_capture_session_n3g(uuid,integer,uuid,uuid,uuid,text,date,date,text,text,text[]) from public,anon;
grant execute on function public.save_payroll_capture_session_n3g(uuid,integer,uuid,uuid,uuid,text,date,date,text,text,text[]) to authenticated,service_role;

create or replace function public.get_payroll_capture_sessions(p_session_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if public.current_profile_id() is null or not public.payroll_has_finance_pii_access() then
    raise exception 'payroll_capture_finance_required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',session.id,
        'company_id',session.company_id,
        'company_bank_account_id',session.company_bank_account_id,
        'cost_center_id',session.cost_center_id,
        'budget_category_id',session.budget_category_id,
        'budget_month',session.budget_month,
        'payroll_subtype',session.payroll_subtype,
        'period_start',session.period_start,
        'period_end',session.period_end,
        'concept',session.concept,
        'notes',session.notes,
        'expected_channels',session.expected_channels,
        'capture_state',session.capture_state,
        'validation_status',session.validation_status,
        'version',session.version,
        'expires_at',session.expires_at,
        'updated_at',session.updated_at,
        'materialized_payment_request_id',session.materialized_payment_request_id,
        'materialized_at',session.materialized_at,
        'server_verification_summary',session.server_verification_summary,
        'files',coalesce((
          select jsonb_agg(jsonb_build_object(
            'id',file.id,'kind',file.kind,'channel',file.channel,
            'capability_code',file.capability_code,'parsing_status',file.parsing_status,
            'validation_authority',file.validation_authority,'parser_version',file.parser_version,
            'parser_contract',file.parser_contract,'record_count',file.record_count,
            'total_amount_minor',file.total_amount_minor,'issue_codes',file.issue_codes,
            'uploaded_at',file.uploaded_at
          ) order by file.uploaded_at desc)
          from public.payroll_capture_files file
          where file.session_id=session.id and file.upload_state='uploaded' and file.is_current
        ),'[]'::jsonb)
      ) order by session.updated_at desc
    )
    from (
      select * from public.payroll_capture_sessions
      where (p_session_id is null or id=p_session_id) and expires_at>now()
      order by updated_at desc limit 50
    ) session
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.get_payroll_capture_sessions(uuid) from public,anon;
grant execute on function public.get_payroll_capture_sessions(uuid) to authenticated,service_role;

create function public.get_payroll_submission_summary(p_payment_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_employee_net numeric;
  v_channels jsonb;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then
    raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED';
  end if;

  select coalesce(sum(net_amount),0) into v_employee_net
  from public.payroll_run_lines where payment_request_id=v_request.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'channel',c.channel,
    'amount',c.amount,
    'benefit_amount',c.benefit_amount,
    'fee_amount',c.fee_amount,
    'tax_amount',c.tax_amount,
    'expected_funding_amount',c.expected_funding_amount,
    'funding_variance',case when c.channel='vales' then c.amount-c.expected_funding_amount else null end,
    'funding_variance_acknowledged',c.funding_variance_acknowledged_at is not null,
    'funding_variance_acknowledged_at',c.funding_variance_acknowledged_at
  ) order by c.channel),'[]'::jsonb) into v_channels
  from public.payroll_channels c where c.payment_request_id=v_request.id;

  return jsonb_build_object(
    'payment_request_id',v_request.id,
    'status',v_request.status,
    'company_id',v_request.company_id,
    'cost_center_id',v_request.cost_center_id,
    'amount_requested',v_request.amount_requested,
    'employee_net',v_employee_net,
    'currency',v_request.currency,
    'payroll_subtype',v_request.payroll_subtype,
    'period_start',v_request.payroll_period_start,
    'period_end',v_request.payroll_period_end,
    'approver_id',v_request.approver_id,
    'approver_assignment_id',v_request.approver_assignment_id,
    'approver_selection_source',v_request.approver_selection_source,
    'submitted_at',v_request.submitted_at,
    'channels',v_channels
  );
end;
$$;
revoke all on function public.get_payroll_submission_summary(uuid) from public,anon;
grant execute on function public.get_payroll_submission_summary(uuid) to authenticated,service_role;

-- Allow an Edge retry with the pre-materialization version after a successful
-- materialization. The internal materializer still authorizes the retry only by
-- exact idempotency hash; no stale write path is opened.
create or replace function public.get_payroll_materialization_context_internal(
  p_capture_session_id uuid,p_expected_version integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,storage,pg_temp
as $$
declare v_session public.payroll_capture_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'payroll_materialization_service_role_required'; end if;
  select * into v_session from public.payroll_capture_sessions where id=p_capture_session_id;
  if not found then raise exception 'payroll_capture_not_found'; end if;
  if v_session.capture_state='materialized' then
    if p_expected_version not in (v_session.version,v_session.version-1) then raise exception 'payroll_capture_version_conflict'; end if;
  elsif v_session.version<>p_expected_version then
    raise exception 'payroll_capture_version_conflict';
  end if;

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
revoke all on function public.get_payroll_materialization_context_internal(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_payroll_materialization_context_internal(uuid,integer) to service_role;

do $postcheck$
begin
  if to_regprocedure('public.save_payroll_capture_session_n3g(uuid,integer,uuid,uuid,uuid,text,date,date,text,text,text[])') is null
     or to_regprocedure('public.get_payroll_submission_summary(uuid)') is null
     or position('materialized_payment_request_id' in pg_get_functiondef('public.get_payroll_capture_sessions(uuid)'::regprocedure))=0
     or position('v_session.version-1' in pg_get_functiondef('public.get_payroll_materialization_context_internal(uuid,integer)'::regprocedure))=0 then
    raise exception 'payroll_n3g_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
