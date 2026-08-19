-- N3B: explicit payroll submission into the existing individual approval flow.
-- Draft only in this gate. Do not apply to DEV until separately authorized.
--
-- Contract:
--   N3A materialized payroll = draft, no approver, no submission notification.
--   N3B submit = one-time approver snapshot + draft -> submitted + exactly-one
--                payment_request.created notification to that approver.
--   Decision = existing decide_payment_request() and payment_request_approvals.
--   Weekly approval batches and normal bank layouts remain excluded.

begin;

do $precheck$
begin
  if to_regclass('public.payment_requests') is null
     or to_regclass('public.payment_request_approvals') is null
     or to_regclass('public.payroll_capture_sessions') is null then
    raise exception 'payroll_n3b_foundation_missing';
  end if;

  if to_regprocedure('public.materialize_payroll_capture_internal(uuid,integer,text,jsonb)') is null
     or to_regprocedure('public.decide_payment_request(uuid,uuid,text,text)') is null
     or to_regprocedure('public.validate_payment_request_approver_scope()') is null then
    raise exception 'payroll_n3b_required_contract_missing';
  end if;
end;
$precheck$;

-- Every payroll request after draft must carry the immutable submission snapshot.
alter table public.payment_requests
  add constraint payment_requests_payroll_submission_snapshot_check check (
    request_type::text <> 'nomina'
    or status::text = 'draft'
    or (
      approver_id is not null
      and approver_selection_source in ('assigned','approval_rules')
      and submitted_at is not null
    )
  ) not valid;

alter table public.payment_requests
  validate constraint payment_requests_payroll_submission_snapshot_check;

create function public.payroll_request_has_valid_materialization(p_payment_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payroll_capture_sessions s
    where s.materialized_payment_request_id = p_payment_request_id
      and s.capture_state = 'materialized'
      and s.validation_status = 'valid'
      and s.materialized_at is not null
      and s.materialized_by is not null
      and s.server_verification_summary is not null
  );
$$;

revoke all on function public.payroll_request_has_valid_materialization(uuid)
  from public, anon, authenticated;
grant execute on function public.payroll_request_has_valid_materialization(uuid)
  to service_role;

-- Dedicated validation for the only approver mutation payroll is allowed to make:
-- materialized draft/no approver -> submitted/validated approver snapshot.
create function public.validate_payroll_submit_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_assignment public.approver_assignments%rowtype;
begin
  if old.request_type::text <> 'nomina'
     or new.request_type::text <> 'nomina'
     or old.status::text <> 'draft'
     or new.status::text <> 'submitted' then
    raise exception 'PAYROLL_INVALID_SUBMISSION_TRANSITION';
  end if;

  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;
  if old.requested_by is distinct from v_actor then
    raise exception 'PAYROLL_SUBMIT_REQUESTER_REQUIRED';
  end if;
  if not public.has_active_company_membership(v_actor, old.company_id) then
    raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED';
  end if;
  if not public.payroll_request_has_valid_materialization(old.id) then
    raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
  end if;

  if old.approver_id is not null
     or old.approver_assignment_id is not null
     or old.approver_selection_source is not null
     or old.submitted_at is not null then
    raise exception 'PAYROLL_APPROVER_ALREADY_SELECTED';
  end if;
  if new.approver_id is null
     or new.approver_selection_source is null
     or new.submitted_at is null then
    raise exception 'PAYROLL_APPROVER_SNAPSHOT_REQUIRED';
  end if;
  if new.approver_id = v_actor then
    raise exception 'requester_cannot_be_own_approver';
  end if;
  if new.approved_by is not null or new.approved_at is not null then
    raise exception 'PAYROLL_APPROVAL_TIMESTAMPS_NOT_ALLOWED_AT_SUBMIT';
  end if;

  -- N3B submission may not alter the server-verified payroll materialization.
  if new.company_id is distinct from old.company_id
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
     or new.concept is distinct from old.concept
     or new.description is distinct from old.description
     or new.notes is distinct from old.notes then
    raise exception 'PAYROLL_MATERIALIZATION_IMMUTABLE_AT_SUBMIT';
  end if;

  if new.approver_assignment_id is not null then
    if new.approver_selection_source is distinct from 'assigned' then
      raise exception 'approver_assignment_source_mismatch';
    end if;
    select * into v_assignment
    from public.approver_assignments aa
    where aa.id = new.approver_assignment_id
      and aa.company_id = old.company_id
      and aa.requester_id = old.requested_by
      and aa.approver_id = new.approver_id
      and aa.active;
    if not found then
      raise exception 'approver_not_in_configured_pool';
    end if;
    if not public.is_payment_request_approver_for_company(new.approver_id, old.company_id) then
      raise exception 'configured_approver_no_longer_eligible';
    end if;
  else
    if new.approver_selection_source is distinct from 'approval_rules' then
      raise exception 'approver_selection_source_required';
    end if;
    if public.payment_request_has_active_approver_pool(old.requested_by, old.company_id) then
      raise exception 'approver_must_come_from_configured_pool';
    end if;
    if not public.is_payment_request_approver_for_company(new.approver_id, old.company_id) then
      raise exception 'approver_not_eligible_for_company';
    end if;
    if not public.payment_request_rule_allows(
      new.approver_id,
      old.company_id,
      old.cost_center_id,
      old.amount_requested,
      'approved'
    ) then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_payroll_submit_transition()
  from public, anon, authenticated;

-- Preserve the existing approver immutability trigger for every path except the
-- one validated payroll draft -> submitted transition above.
drop trigger validate_payment_request_approver_scope_update on public.payment_requests;
create trigger validate_payment_request_approver_scope_update
before update of approver_id, approver_assignment_id, approver_selection_source,
  company_id, requested_by, cost_center_id, amount_requested
on public.payment_requests
for each row
when (not (
  old.request_type::text = 'nomina'
  and new.request_type::text = 'nomina'
  and old.status::text = 'draft'
  and new.status::text = 'submitted'
  and old.approver_id is null
  and old.approver_assignment_id is null
  and old.approver_selection_source is null
  and old.submitted_at is null
))
execute function public.validate_payment_request_approver_scope();

create trigger validate_payroll_submit_transition
before update of status, approver_id, approver_assignment_id,
  approver_selection_source, submitted_at
on public.payment_requests
for each row
when (
  old.request_type::text = 'nomina'
  and new.request_type::text = 'nomina'
  and old.status::text = 'draft'
  and new.status::text = 'submitted'
)
execute function public.validate_payroll_submit_transition();

-- Guard the direct table UPDATE surface as well as the RPC path. Authenticated
-- users currently have UPDATE privileges subject to RLS, so payroll status must
-- not be able to skip submission or an approval record in the same transaction.
create function public.guard_payroll_request_status_transition()
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

  return new;
end;
$$;

revoke all on function public.guard_payroll_request_status_transition()
  from public, anon, authenticated;

create trigger guard_payroll_request_status_transition
before update of status on public.payment_requests
for each row
when (old.request_type::text = 'nomina')
execute function public.guard_payroll_request_status_transition();

-- Any payroll approval record, including one created by decide_payment_request(),
-- must belong to a submitted, materialized request and the selected approver.
create function public.guard_payroll_approval_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
begin
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id;

  if not found or v_request.request_type::text <> 'nomina' then
    return new;
  end if;

  if v_request.status::text <> 'submitted'
     or v_request.approver_id is null
     or v_request.submitted_at is null
     or not public.payroll_request_has_valid_materialization(v_request.id) then
    raise exception 'PAYROLL_NOT_SUBMITTED_FOR_APPROVAL';
  end if;
  if new.actor_profile_id is distinct from v_request.approver_id then
    raise exception 'selected_approver_only';
  end if;
  if new.action not in ('approved','rejected','changes_requested')
     or new.from_status is distinct from 'submitted'
     or new.to_status is distinct from case new.action
       when 'approved' then 'approved'
       when 'rejected' then 'rejected'
       when 'changes_requested' then 'changes_requested'
     end then
    raise exception 'PAYROLL_INVALID_APPROVAL_DECISION';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_payroll_approval_insert()
  from public, anon, authenticated;

create trigger guard_payroll_approval_insert
before insert on public.payment_request_approvals
for each row
execute function public.guard_payroll_approval_insert();

-- Reuse the existing payment_request.created event contract at submission time.
-- N3A deliberately skipped this event during materialization INSERT.
create function public.enqueue_payroll_submission_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_role_name text;
  v_status text := 'pending';
  v_last_error text;
  v_payload jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = new.approver_id and coalesce(active, true);

  if not found then
    v_status := 'dead_letter';
    v_last_error := 'approver_profile_not_found';
  elsif not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
    v_status := 'dead_letter';
    v_last_error := 'approver_not_eligible_for_company';
  elsif nullif(btrim(coalesce(v_profile.email, '')), '') is null then
    v_status := 'dead_letter';
    v_last_error := 'recipient_email_missing';
  end if;

  select lower(trim(r.name)) into v_role_name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = new.approver_id
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
  order by lower(trim(r.name))
  limit 1;

  v_payload := public.notification_payment_request_payload_with_extra(
    new.id,
    jsonb_build_object(
      'approver', coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
      'approver_profile_id', new.approver_id,
      'submission_source', 'payroll_n3b'
    )
  );

  insert into public.notification_events (
    event_type, source_table, source_id, source_folio, recipient_type,
    recipient_profile_id, recipient_email, recipient_role, channel, priority,
    subject, payload, idempotency_key, status, last_error, next_attempt_at
  ) values (
    'payment_request.created', 'payment_requests', new.id, new.request_number,
    'administrador_sistema',
    case when v_profile.id is not null then v_profile.id else null end,
    case when v_status = 'pending' then nullif(btrim(v_profile.email), '') else null end,
    v_role_name, 'email', 'normal',
    'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
    v_payload,
    'payment_request.created:' || new.id::text || ':approver',
    v_status, v_last_error,
    case when v_status = 'pending' then now() else null end
  )
  on conflict (idempotency_key) do nothing;

  return new;
exception
  when others then
    insert into public.notification_events (
      event_type, source_table, source_id, source_folio, recipient_type,
      channel, priority, subject, payload, idempotency_key, status, last_error
    ) values (
      'payment_request.created', 'payment_requests', new.id, new.request_number,
      'administrador_sistema', 'email', 'normal',
      'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
      jsonb_build_object('folio', new.request_number, 'path', '/solicitudes.html'),
      'payment_request.created:' || new.id::text || ':enqueue-error',
      'dead_letter', 'created_notification_enqueue_failed'
    )
    on conflict (idempotency_key) do nothing;
    return new;
end;
$$;

revoke all on function public.enqueue_payroll_submission_notification()
  from public, anon, authenticated;
grant execute on function public.enqueue_payroll_submission_notification()
  to service_role;

create trigger payroll_submission_notification_event
after update of status on public.payment_requests
for each row
when (
  old.request_type::text = 'nomina'
  and new.request_type::text = 'nomina'
  and old.status::text = 'draft'
  and new.status::text = 'submitted'
)
execute function public.enqueue_payroll_submission_notification();

-- Explicit Finance action. Approver selection is resolved using the same pool /
-- approval_rules contract as normal requests. Retrying the same submitted request
-- is idempotent and does not fire another status transition or notification.
create function public.submit_payroll_for_approval(
  p_payment_request_id uuid,
  p_approver_id uuid,
  p_approver_assignment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_assignment public.approver_assignments%rowtype;
  v_source text;
begin
  if v_actor is null or not public.payroll_has_finance_pii_access() then
    raise exception 'PAYROLL_FINANCE_REQUIRED';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then
    raise exception 'PAYROLL_REQUEST_NOT_FOUND';
  end if;
  if v_request.request_type::text <> 'nomina' then
    raise exception 'PAYROLL_REQUEST_REQUIRED';
  end if;
  if v_request.requested_by is distinct from v_actor then
    raise exception 'PAYROLL_SUBMIT_REQUESTER_REQUIRED';
  end if;
  if not public.has_active_company_membership(v_actor, v_request.company_id) then
    raise exception 'PAYROLL_SUBMIT_COMPANY_MEMBERSHIP_REQUIRED';
  end if;
  if not public.payroll_request_has_valid_materialization(v_request.id) then
    raise exception 'PAYROLL_VALID_MATERIALIZATION_REQUIRED';
  end if;

  if v_request.status::text = 'submitted' then
    if v_request.approver_id is not distinct from p_approver_id
       and v_request.approver_assignment_id is not distinct from p_approver_assignment_id
       and v_request.submitted_at is not null then
      return jsonb_build_object(
        'status', 'already_submitted',
        'payment_request_id', v_request.id,
        'approver_id', v_request.approver_id,
        'approver_assignment_id', v_request.approver_assignment_id,
        'approver_source', v_request.approver_selection_source
      );
    end if;
    raise exception 'PAYROLL_ALREADY_SUBMITTED';
  end if;

  if v_request.status::text <> 'draft'
     or v_request.approver_id is not null
     or v_request.approver_assignment_id is not null
     or v_request.approver_selection_source is not null
     or v_request.submitted_at is not null then
    raise exception 'PAYROLL_DRAFT_REQUIRED';
  end if;
  if p_approver_id is null or p_approver_id = v_actor then
    raise exception 'PAYROLL_APPROVER_REQUIRED';
  end if;

  if public.payment_request_has_active_approver_pool(v_actor, v_request.company_id) then
    if p_approver_assignment_id is null then
      raise exception 'approver_assignment_id_required';
    end if;
    select * into v_assignment
    from public.approver_assignments aa
    where aa.id = p_approver_assignment_id
      and aa.company_id = v_request.company_id
      and aa.requester_id = v_actor
      and aa.approver_id = p_approver_id
      and aa.active;
    if not found then
      raise exception 'approver_not_in_configured_pool';
    end if;
    v_source := 'assigned';
  else
    if p_approver_assignment_id is not null then
      raise exception 'approver_assignment_not_allowed_without_pool';
    end if;
    if not public.is_payment_request_approver_for_company(p_approver_id, v_request.company_id)
       or not public.payment_request_rule_allows(
         p_approver_id,
         v_request.company_id,
         v_request.cost_center_id,
         v_request.amount_requested,
         'approved'
       ) then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
    v_source := 'approval_rules';
  end if;

  update public.payment_requests
  set approver_id = p_approver_id,
      approver_assignment_id = p_approver_assignment_id,
      approver_selection_source = v_source,
      submitted_at = now(),
      status = 'submitted'::public.payment_request_status,
      updated_at = now()
  where id = v_request.id;

  insert into public.activity_log(
    entity_type, entity_id, action, old_values, new_values, performed_by, notes
  ) values (
    'payroll_submission', v_request.id, 'submit_for_approval', null,
    jsonb_build_object('redacted', true, 'operation', 'payroll_submit_for_approval'),
    v_actor,
    'Payroll submission audit excludes employee, bank, salary and raw-file data.'
  );

  return jsonb_build_object(
    'status', 'submitted',
    'payment_request_id', v_request.id,
    'approver_id', p_approver_id,
    'approver_assignment_id', p_approver_assignment_id,
    'approver_source', v_source
  );
end;
$$;

revoke all on function public.submit_payroll_for_approval(uuid,uuid,uuid)
  from public, anon;
grant execute on function public.submit_payroll_for_approval(uuid,uuid,uuid)
  to authenticated, service_role;

-- N3B must never move payroll into weekly batches. This assertion documents the
-- dependency without redefining approval_batch_request_eligibility().
do $postcheck$
begin
  if to_regprocedure('public.submit_payroll_for_approval(uuid,uuid,uuid)') is null
     or to_regprocedure('public.payroll_request_has_valid_materialization(uuid)') is null then
    raise exception 'payroll_n3b_contract_incomplete';
  end if;
end;
$postcheck$;

commit;
