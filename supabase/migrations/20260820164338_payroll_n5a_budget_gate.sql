-- N5A: payroll budget gate between materialization and approval.
-- Flux does not calculate payroll or invent provision rates. This slice reuses the
-- existing budget_lines / budget_availability model and serializes payroll submit
-- against the selected active budget line.

begin;

do $precheck$
begin
  if to_regclass('public.payment_requests') is null
     or to_regclass('public.budget_lines') is null
     or to_regclass('public.budget_versions') is null
     or to_regclass('public.company_cost_center_budget_categories') is null
     or to_regprocedure('public.verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean)') is null
     or to_regprocedure('public.submit_payroll_for_approval(uuid,uuid,uuid)') is null
     or to_regprocedure('public.payroll_request_has_valid_materialization(uuid)') is null then
    raise exception 'payroll_n5a_prerequisite_missing';
  end if;
end;
$precheck$;

-- Preserve all materialized payroll immutability, with one narrow exception:
-- Finance may change only budget_category_id / budget_month while the request is
-- still draft and only through the N5A context RPC token.
create or replace function public.guard_payroll_materialized_request_immutable()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_budget_context_allowed boolean := false;
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id) then
    return new;
  end if;

  v_budget_context_allowed := old.status::text='draft'
    and current_setting('app.payroll_n5a_budget_context',true) is not distinct from old.id::text
    and v_actor is not null
    and v_actor is not distinct from old.requested_by
    and public.payroll_has_finance_pii_access();

  -- Every non-budget material field remains frozen without exception.
  if new.request_type is distinct from old.request_type
     or new.company_id is distinct from old.company_id
     or new.company_bank_account_id is distinct from old.company_bank_account_id
     or new.cost_center_id is distinct from old.cost_center_id
     or new.amount_requested is distinct from old.amount_requested
     or new.currency is distinct from old.currency
     or new.exchange_rate is distinct from old.exchange_rate
     or new.requested_by is distinct from old.requested_by
     or new.payroll_subtype is distinct from old.payroll_subtype
     or new.payroll_period_start is distinct from old.payroll_period_start
     or new.payroll_period_end is distinct from old.payroll_period_end
     or new.provider_id is distinct from old.provider_id
     or new.proveedor_id is distinct from old.proveedor_id
     or new.provider_bank_account_id is distinct from old.provider_bank_account_id
     or new.payment_method is distinct from old.payment_method
     or new.is_extraordinary_adjustment is distinct from old.is_extraordinary_adjustment
     or new.concept is distinct from old.concept
     or new.description is distinct from old.description
     or new.notes is distinct from old.notes then
    raise exception 'PAYROLL_MATERIALIZED_REQUEST_IMMUTABLE';
  end if;

  if new.budget_category_id is distinct from old.budget_category_id
     or new.budget_month is distinct from old.budget_month then
    if not v_budget_context_allowed then
      raise exception 'PAYROLL_BUDGET_CONTEXT_RPC_REQUIRED';
    end if;
  end if;

  return new;
end;
$$;

-- Budget validation snapshot fields are server-owned for materialized payroll.
create or replace function public.guard_payroll_budget_snapshot_immutable()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id) then
    return new;
  end if;

  if current_setting('app.payroll_n5a_budget_snapshot',true) is distinct from old.id::text then
    raise exception 'PAYROLL_BUDGET_SNAPSHOT_RPC_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_payroll_budget_snapshot_immutable on public.payment_requests;
create trigger guard_payroll_budget_snapshot_immutable
before update of budget_decision,budget_block_reason,budget_available_before,
  budget_available_after,budget_shortfall,budget_checked_at,budget_result
on public.payment_requests
for each row
when (old.request_type::text='nomina')
execute function public.guard_payroll_budget_snapshot_immutable();

-- Internal check. The active budget line is row-locked so concurrent payroll submit
-- operations for the same scope serialize; the second transaction sees the first
-- committed request through budget_availability before it may submit.
create or replace function public.payroll_budget_check_internal(
  p_payment_request_id uuid,
  p_persist_snapshot boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_result jsonb;
  v_checked_at timestamptz := now();
begin
  select * into v_request
  from public.payment_requests
  where id=p_payment_request_id
  for update;

  if not found or v_request.request_type::text<>'nomina' then
    raise exception 'PAYROLL_REQUEST_REQUIRED';
  end if;
  if v_request.status::text<>'draft' then
    raise exception 'PAYROLL_BUDGET_DRAFT_REQUIRED';
  end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then
    raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
  end if;
  if v_request.budget_category_id is null or v_request.budget_month is null then
    raise exception 'PAYROLL_BUDGET_CONTEXT_REQUIRED: Configura mes y partida en Presupuesto de Nómina antes de enviar.';
  end if;

  -- Lock every active budget line matching the selected scope. No row is also a
  -- valid result: verify_budget_availability will return the canonical blocked reason.
  perform line.id
  from public.budget_lines line
  join public.budget_versions version on version.id=line.budget_version_id
  where version.active
    and line.company_id=v_request.company_id
    and line.cost_center_id=v_request.cost_center_id
    and line.budget_category_id=v_request.budget_category_id
    and line.budget_month=v_request.budget_month
  for update of line;

  v_result := public.verify_budget_availability(
    v_request.company_id,
    v_request.cost_center_id,
    v_request.budget_category_id,
    v_request.budget_month,
    v_request.amount_requested,
    false
  );

  if p_persist_snapshot then
    perform set_config('app.payroll_n5a_budget_snapshot',v_request.id::text,true);
    update public.payment_requests
    set budget_decision=coalesce(v_result->>'status','bloqueado'),
        budget_block_reason=nullif(v_result->>'motivo',''),
        budget_available_before=nullif(v_result->>'disponible_actual','')::numeric,
        budget_available_after=nullif(v_result->>'disponible_despues','')::numeric,
        budget_shortfall=coalesce(nullif(v_result->>'faltante','')::numeric,0),
        budget_checked_at=v_checked_at,
        budget_result=v_result,
        updated_at=now()
    where id=v_request.id;
  end if;

  return v_result || jsonb_build_object(
    'payment_request_id',v_request.id,
    'budget_category_id',v_request.budget_category_id,
    'budget_month',v_request.budget_month,
    'budget_checked_at',v_checked_at
  );
end;
$$;

revoke all on function public.payroll_budget_check_internal(uuid,boolean) from public,anon,authenticated;

create or replace function public.set_payroll_budget_context(
  p_payment_request_id uuid,
  p_budget_category_id uuid,
  p_budget_month date
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_month date;
  v_result jsonb;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;
  if p_budget_category_id is null or p_budget_month is null then
    raise exception 'PAYROLL_BUDGET_CONTEXT_REQUIRED: Selecciona mes y partida presupuestal.';
  end if;

  select * into v_request
  from public.payment_requests
  where id=p_payment_request_id
  for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'draft' then raise exception 'PAYROLL_BUDGET_DRAFT_REQUIRED'; end if;
  if v_request.requested_by is distinct from v_actor then raise exception 'PAYROLL_BUDGET_REQUESTER_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_BUDGET_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED'; end if;

  if not exists (
    select 1
    from public.company_cost_center_budget_categories map
    join public.budget_categories category on category.id=map.budget_category_id
    where map.company_id=v_request.company_id
      and map.cost_center_id=v_request.cost_center_id
      and map.budget_category_id=p_budget_category_id
      and map.active
      and category.active
  ) then
    raise exception 'PAYROLL_BUDGET_CATEGORY_NOT_ALLOWED';
  end if;

  v_month := date_trunc('month',p_budget_month)::date;
  perform set_config('app.payroll_n5a_budget_context',v_request.id::text,true);
  update public.payment_requests
  set budget_category_id=p_budget_category_id,
      budget_month=v_month,
      updated_at=now()
  where id=v_request.id;

  v_result := public.payroll_budget_check_internal(v_request.id,true);
  return v_result;
end;
$$;

revoke all on function public.set_payroll_budget_context(uuid,uuid,date) from public,anon;
grant execute on function public.set_payroll_budget_context(uuid,uuid,date) to authenticated;

create or replace function public.refresh_payroll_budget_validation(p_payment_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'draft' then raise exception 'PAYROLL_BUDGET_DRAFT_REQUIRED'; end if;
  if v_request.requested_by is distinct from v_actor then raise exception 'PAYROLL_BUDGET_REQUESTER_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_BUDGET_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  return public.payroll_budget_check_internal(v_request.id,true);
end;
$$;

revoke all on function public.refresh_payroll_budget_validation(uuid) from public,anon;
grant execute on function public.refresh_payroll_budget_validation(uuid) to authenticated;

create or replace function public.get_payroll_budget_context_options(
  p_payment_request_id uuid,
  p_budget_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_month date;
  v_options jsonb;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  if p_budget_month is null then raise exception 'PAYROLL_BUDGET_MONTH_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.status::text<>'draft' or v_request.requested_by is distinct from v_actor then raise exception 'PAYROLL_BUDGET_DRAFT_REQUESTER_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_BUDGET_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED'; end if;

  v_month := date_trunc('month',p_budget_month)::date;
  select coalesce(jsonb_agg(jsonb_build_object(
    'budget_category_id',category.id,
    'code',category.code,
    'name',category.name,
    'category',category.category,
    'budget_type',category.budget_type,
    'budget_month',v_month,
    'budgeted',coalesce(availability.budgeted,0),
    'committed',coalesce(availability.committed,0),
    'executed',coalesce(availability.executed,0),
    'available',coalesce(availability.available,0),
    'has_active_budget_line',(availability.budget_category_id is not null)
  ) order by category.code,category.name),'[]'::jsonb)
  into v_options
  from public.company_cost_center_budget_categories map
  join public.budget_categories category on category.id=map.budget_category_id and category.active
  left join public.budget_availability availability
    on availability.company_id=v_request.company_id
   and availability.cost_center_id=v_request.cost_center_id
   and availability.budget_category_id=category.id
   and availability.budget_month=v_month
  where map.company_id=v_request.company_id
    and map.cost_center_id=v_request.cost_center_id
    and map.active;

  return v_options;
end;
$$;

revoke all on function public.get_payroll_budget_context_options(uuid,date) from public,anon;
grant execute on function public.get_payroll_budget_context_options(uuid,date) to authenticated;

create or replace function public.get_payroll_budget_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'payment_request_id',request.id,
      'request_number',request.request_number,
      'company_id',request.company_id,
      'company_name',company.name,
      'cost_center_id',request.cost_center_id,
      'cost_center_name',center.name,
      'amount_requested',request.amount_requested,
      'currency',request.currency,
      'period_start',request.payroll_period_start,
      'period_end',request.payroll_period_end,
      'budget_category_id',request.budget_category_id,
      'budget_month',request.budget_month,
      'budget_decision',request.budget_decision,
      'budget_available_before',request.budget_available_before,
      'budget_available_after',request.budget_available_after,
      'budget_shortfall',request.budget_shortfall,
      'budget_checked_at',request.budget_checked_at
    ) order by request.created_at desc,request.id)
    from public.payment_requests request
    join public.companies company on company.id=request.company_id
    join public.cost_centers center on center.id=request.cost_center_id
    where request.request_type::text='nomina'
      and request.status::text='draft'
      and request.requested_by=v_actor
      and public.payroll_request_has_valid_materialization(request.id)
      and public.has_active_company_membership(v_actor,request.company_id)
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_payroll_budget_queue() from public,anon;
grant execute on function public.get_payroll_budget_queue() to authenticated;

-- Extend the aggregate Finance summary. Existing N3G callers may ignore the added fields.
create or replace function public.get_payroll_submission_summary(p_payment_request_id uuid)
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
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
  select * into v_request from public.payment_requests where id=p_payment_request_id;
  if not found or v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED'; end if;

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
    'budget_category_id',v_request.budget_category_id,
    'budget_month',v_request.budget_month,
    'budget_decision',v_request.budget_decision,
    'budget_block_reason',v_request.budget_block_reason,
    'budget_available_before',v_request.budget_available_before,
    'budget_available_after',v_request.budget_available_after,
    'budget_shortfall',v_request.budget_shortfall,
    'budget_checked_at',v_request.budget_checked_at,
    'budget_ready',(v_request.budget_decision='aprobable' and v_request.budget_category_id is not null and v_request.budget_month is not null),
    'channels',v_channels
  );
end;
$$;

-- Replace submit with the same N3B routing contract plus mandatory, locked budget
-- revalidation immediately before the draft -> submitted write.
create or replace function public.submit_payroll_for_approval(
  p_payment_request_id uuid,
  p_approver_id uuid,
  p_approver_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_assignment public.approver_assignments%rowtype;
  v_source text;
  v_budget jsonb;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;

  select * into v_request from public.payment_requests where id=p_payment_request_id for update;
  if not found then raise exception 'PAYROLL_REQUEST_NOT_FOUND'; end if;
  if v_request.request_type::text<>'nomina' then raise exception 'PAYROLL_REQUEST_REQUIRED'; end if;
  if v_request.requested_by is distinct from v_actor then raise exception 'PAYROLL_SUBMIT_REQUESTER_REQUIRED'; end if;
  if not public.has_active_company_membership(v_actor,v_request.company_id) then raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED'; end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED'; end if;

  if v_request.status::text='submitted' then
    if v_request.approver_id is not distinct from p_approver_id
       and v_request.approver_assignment_id is not distinct from p_approver_assignment_id
       and v_request.submitted_at is not null then
      return jsonb_build_object(
        'status','already_submitted','payment_request_id',v_request.id,
        'approver_id',v_request.approver_id,'approver_assignment_id',v_request.approver_assignment_id,
        'approver_source',v_request.approver_selection_source
      );
    end if;
    raise exception 'PAYROLL_ALREADY_SUBMITTED';
  end if;

  if v_request.status::text<>'draft'
     or v_request.approver_id is not null
     or v_request.approver_assignment_id is not null
     or v_request.approver_selection_source is not null
     or v_request.submitted_at is not null then
    raise exception 'PAYROLL_DRAFT_REQUIRED';
  end if;
  if p_approver_id is null or p_approver_id=v_actor then raise exception 'PAYROLL_APPROVER_REQUIRED'; end if;

  if public.payment_request_has_active_approver_pool(v_actor,v_request.company_id) then
    if p_approver_assignment_id is null then raise exception 'approver_assignment_id_required'; end if;
    select * into v_assignment
    from public.approver_assignments aa
    where aa.id=p_approver_assignment_id
      and aa.company_id=v_request.company_id
      and aa.requester_id=v_actor
      and aa.approver_id=p_approver_id
      and aa.active;
    if not found then raise exception 'approver_not_in_configured_pool'; end if;
    v_source := 'assigned';
  else
    if p_approver_assignment_id is not null then raise exception 'approver_assignment_not_allowed_without_pool'; end if;
    if not public.is_payment_request_approver_for_company(p_approver_id,v_request.company_id)
       or not public.payment_request_rule_allows(
         p_approver_id,v_request.company_id,v_request.cost_center_id,v_request.amount_requested,'approved'
       ) then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
    v_source := 'approval_rules';
  end if;

  -- This call locks the budget row until transaction end and persists a fresh
  -- snapshot only if the transaction succeeds.
  v_budget := public.payroll_budget_check_internal(v_request.id,true);
  if coalesce(v_budget->>'status','bloqueado')<>'aprobable' then
    raise exception 'PAYROLL_BUDGET_NOT_APPROVABLE: %. Revalida en Presupuesto de Nómina.',
      coalesce(v_budget->>'motivo','presupuesto no disponible');
  end if;

  perform set_config('app.payroll_n5a_submit',v_request.id::text,true);
  update public.payment_requests
  set approver_id=p_approver_id,
      approver_assignment_id=p_approver_assignment_id,
      approver_selection_source=v_source,
      submitted_at=now(),
      status='submitted'::public.payment_request_status,
      updated_at=now()
  where id=v_request.id;

  insert into public.activity_log(entity_type,entity_id,action,old_values,new_values,performed_by,notes)
  values(
    'payroll_submission',v_request.id,'submit_for_approval',null,
    jsonb_build_object('redacted',true,'operation','payroll_submit_for_approval','budget_gate','aprobable'),
    v_actor,
    'Payroll submission audit excludes employee, bank, salary and raw-file data.'
  );

  return jsonb_build_object(
    'status','submitted','payment_request_id',v_request.id,
    'approver_id',p_approver_id,'approver_assignment_id',p_approver_assignment_id,
    'approver_source',v_source,'budget_decision','aprobable'
  );
end;
$$;

revoke all on function public.submit_payroll_for_approval(uuid,uuid,uuid) from public,anon;
grant execute on function public.submit_payroll_for_approval(uuid,uuid,uuid) to authenticated;

-- Preserve N4B paid close and add a dedicated N5A token/budget gate to draft submit.
create or replace function public.guard_payroll_request_status_transition()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_channel_count integer;
  v_ready_count integer;
begin
  if old.request_type::text<>'nomina' or new.status is not distinct from old.status then return new; end if;

  if old.status::text='draft' then
    if current_setting('app.payroll_n5a_submit',true) is distinct from old.id::text then
      raise exception 'PAYROLL_BUDGET_SUBMIT_RPC_REQUIRED';
    end if;
    if old.budget_category_id is null
       or old.budget_month is null
       or old.budget_decision<>'aprobable'
       or old.budget_checked_at is null then
      raise exception 'PAYROLL_BUDGET_NOT_APPROVABLE';
    end if;
    if new.status::text<>'submitted'
       or v_actor is null
       or not public.payroll_has_finance_pii_access()
       or old.requested_by is distinct from v_actor
       or new.approver_id is null
       or new.approver_selection_source is null
       or new.submitted_at is null
       or not public.payroll_request_has_valid_materialization(old.id) then
      raise exception 'PAYROLL_NOT_READY_FOR_SUBMISSION';
    end if;
    return new;
  end if;

  if old.status::text='submitted' then
    if new.status::text not in ('approved','rejected','changes_requested') then raise exception 'PAYROLL_INVALID_APPROVAL_STATUS_TRANSITION'; end if;
    if v_actor is null or old.approver_id is distinct from v_actor then raise exception 'selected_approver_only'; end if;
    if not exists (
      select 1 from public.payment_request_approvals a
      where a.payment_request_id=old.id
        and a.actor_profile_id=v_actor
        and a.from_status='submitted'
        and a.to_status=new.status::text
        and a.created_at>=transaction_timestamp()
    ) then raise exception 'PAYROLL_DECISION_RECORD_REQUIRED'; end if;
    return new;
  end if;

  if old.status::text='approved' then
    if new.status::text<>'paid' then raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED'; end if;
    if current_setting('app.payroll_n4b_close_request',true) is distinct from old.id::text then raise exception 'PAYROLL_PAID_CLOSE_RPC_REQUIRED'; end if;
    if v_actor is null or not public.payroll_has_finance_pii_access() then raise exception 'PAYROLL_FINANCE_REQUIRED'; end if;
    if not public.has_active_company_membership(v_actor,old.company_id) then raise exception 'PAYROLL_PAID_COMPANY_MEMBERSHIP_REQUIRED'; end if;
    if not public.payroll_request_has_valid_materialization(old.id) then raise exception 'PAYROLL_PAID_MATERIALIZATION_REQUIRED'; end if;

    select count(*)::integer,
           count(*) filter(where channel.dispersion_status='dispersed'
                              and channel.reconciliation_status='reconciled'
                              and channel.receipt_file_id is not null
                              and file.id is not null
                              and file.parsing_status='parsed'
                              and file.parsing_version='payroll-channel-receipt-v1')::integer
      into v_channel_count,v_ready_count
    from public.payroll_channels channel
    left join public.payroll_run_files file on file.id=channel.receipt_file_id
    where channel.payment_request_id=old.id;

    if v_channel_count=0 or v_ready_count<>v_channel_count then raise exception 'PAYROLL_PAID_RECONCILIATION_REQUIRED'; end if;
    if new.paid_at is null or new.paid_by is distinct from v_actor then raise exception 'PAYROLL_PAID_SNAPSHOT_REQUIRED'; end if;
    return new;
  end if;

  if old.status::text in ('rejected','changes_requested') then raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED'; end if;
  raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
end;
$$;

do $postcheck$
begin
  if to_regprocedure('public.set_payroll_budget_context(uuid,uuid,date)') is null
     or to_regprocedure('public.refresh_payroll_budget_validation(uuid)') is null
     or to_regprocedure('public.get_payroll_budget_context_options(uuid,date)') is null
     or to_regprocedure('public.get_payroll_budget_queue()') is null
     or to_regprocedure('public.payroll_budget_check_internal(uuid,boolean)') is null then
    raise exception 'payroll_n5a_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
