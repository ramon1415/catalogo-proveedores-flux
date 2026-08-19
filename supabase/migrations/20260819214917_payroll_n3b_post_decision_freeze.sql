-- N3B forward hardening: freeze server-verified payroll request material and
-- block post-decision lifecycle transitions until a later dispersion phase
-- explicitly introduces them. Normal payment requests are unchanged.

begin;

do $precheck$
begin
  if to_regprocedure('public.payroll_request_has_valid_materialization(uuid)') is null
     or to_regprocedure('public.guard_payroll_request_status_transition()') is null then
    raise exception 'payroll_n3b_freeze_prerequisite_missing';
  end if;
end;
$precheck$;

create function public.guard_payroll_materialized_request_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id) then
    return new;
  end if;

  if new.request_type is distinct from old.request_type
     or new.company_id is distinct from old.company_id
     or new.company_bank_account_id is distinct from old.company_bank_account_id
     or new.cost_center_id is distinct from old.cost_center_id
     or new.budget_category_id is distinct from old.budget_category_id
     or new.budget_month is distinct from old.budget_month
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

  return new;
end;
$$;

revoke all on function public.guard_payroll_materialized_request_immutable()
  from public, anon, authenticated;

create trigger guard_payroll_materialized_request_immutable
before update of request_type, company_id, company_bank_account_id, cost_center_id,
  budget_category_id, budget_month, amount_requested, currency, exchange_rate,
  requested_by, payroll_subtype, payroll_period_start, payroll_period_end,
  provider_id, proveedor_id, provider_bank_account_id, payment_method,
  is_extraordinary_adjustment, concept, description, notes
on public.payment_requests
for each row
when (old.request_type::text = 'nomina')
execute function public.guard_payroll_materialized_request_immutable();

create function public.guard_payroll_submitted_at_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.request_type::text <> 'nomina'
     or not public.payroll_request_has_valid_materialization(old.id)
     or new.submitted_at is not distinct from old.submitted_at then
    return new;
  end if;

  if old.status::text = 'draft'
     and new.status::text = 'submitted'
     and old.submitted_at is null
     and new.submitted_at is not null then
    return new;
  end if;

  raise exception 'PAYROLL_SUBMITTED_AT_IMMUTABLE';
end;
$$;

revoke all on function public.guard_payroll_submitted_at_immutable()
  from public, anon, authenticated;

create trigger guard_payroll_submitted_at_immutable
before update of submitted_at on public.payment_requests
for each row
when (old.request_type::text = 'nomina')
execute function public.guard_payroll_submitted_at_immutable();

create or replace function public.guard_payroll_request_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if old.request_type::text <> 'nomina' or new.status is not distinct from old.status then
    return new;
  end if;

  if old.status::text = 'draft' then
    if new.status::text <> 'submitted'
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

  if old.status::text = 'submitted' then
    if new.status::text not in ('approved','rejected','changes_requested') then
      raise exception 'PAYROLL_INVALID_APPROVAL_STATUS_TRANSITION';
    end if;
    if v_actor is null or old.approver_id is distinct from v_actor then
      raise exception 'selected_approver_only';
    end if;
    if not exists (
      select 1
      from public.payment_request_approvals a
      where a.payment_request_id = old.id
        and a.actor_profile_id = v_actor
        and a.from_status = 'submitted'
        and a.to_status = new.status::text
        and a.created_at >= transaction_timestamp()
    ) then
      raise exception 'PAYROLL_DECISION_RECORD_REQUIRED';
    end if;
    return new;
  end if;

  if old.status::text in ('approved','rejected','changes_requested') then
    raise exception 'PAYROLL_POST_DECISION_TRANSITION_NOT_ENABLED';
  end if;

  raise exception 'PAYROLL_STATUS_TRANSITION_NOT_ENABLED';
end;
$$;

revoke all on function public.guard_payroll_request_status_transition()
  from public, anon, authenticated;

do $postcheck$
begin
  if to_regprocedure('public.guard_payroll_materialized_request_immutable()') is null
     or to_regprocedure('public.guard_payroll_submitted_at_immutable()') is null then
    raise exception 'payroll_n3b_freeze_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
