set lock_timeout = '5s';
set statement_timeout = '60s';

create or replace function public.approval_batch_promote_request_approved(
  p_payment_request_id uuid,
  p_actor uuid,
  p_batch_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_role_id uuid;
  v_action text;
  v_comments text;
begin
  if p_actor is null then
    raise exception 'batch_approval_actor_required';
  end if;

  select *
    into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;

  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if v_request.status::text in (
    'approved', 'finance_validation', 'scheduled', 'paid'
  ) then
    return false;
  end if;

  if v_request.status::text not in (
    'submitted', 'pending_approval', 'rejected', 'changes_requested'
  ) then
    raise exception 'payment_request_not_approvable_from_batch:%',
      v_request.status::text;
  end if;

  -- Payroll keeps its stricter selected-approver and materialization guards.
  -- The email quick-approval service cannot impersonate a payroll approver.
  if v_request.request_type::text = 'nomina' then
    if public.current_profile_id() is distinct from p_actor
       or v_request.approver_id is distinct from p_actor then
      raise exception 'payroll_batch_requires_authenticated_selected_approver';
    end if;
    if v_request.status::text <> 'submitted' then
      raise exception 'payroll_batch_request_must_be_submitted';
    end if;
  end if;

  select r.id
    into v_role_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = p_actor
    and lower(btrim(r.name)) = any (
      public.payment_request_approver_role_names()
    )
  order by lower(btrim(r.name)), r.id
  limit 1;

  if v_role_id is null then
    raise exception 'batch_actor_has_no_approval_role';
  end if;

  v_action := case
    when v_request.budget_decision = 'bloqueado'
      or coalesce(v_request.is_extraordinary_adjustment, false)
      then 'exception_approved'
    else 'approved'
  end;
  v_comments := format(
    'Aprobada por Dirección mediante corte semanal %s.',
    p_batch_id
  );

  insert into public.payment_request_approvals (
    payment_request_id,
    actor_profile_id,
    role_id,
    action,
    from_status,
    to_status,
    comments,
    approval_level,
    budget_decision_snapshot,
    budget_block_reason_snapshot,
    budget_result_snapshot
  ) values (
    v_request.id,
    p_actor,
    v_role_id,
    v_action,
    v_request.status::text,
    'approved',
    v_comments,
    0,
    v_request.budget_decision,
    v_request.budget_block_reason,
    v_request.budget_result
  );

  update public.payment_requests
  set status = 'approved'::public.payment_request_status,
      exception_status = case
        when v_action = 'exception_approved' then 'approved'
        else exception_status
      end,
      exception_action = case
        when v_action = 'exception_approved' then v_action
        else exception_action
      end,
      exception_reason = case
        when v_action = 'exception_approved' then v_comments
        else exception_reason
      end,
      exception_approved_by = case
        when v_action = 'exception_approved' then p_actor
        else exception_approved_by
      end,
      exception_approved_at = case
        when v_action = 'exception_approved' then now()
        else exception_approved_at
      end,
      operational_comments = coalesce(operational_comments, v_comments),
      updated_at = now()
  where id = v_request.id;

  return true;
end;
$$;

comment on function public.approval_batch_promote_request_approved(uuid,uuid,uuid) is
  'Private transactional bridge: an approved weekly-cut item promotes its payment request to approved and records the decision audit. It never creates a payment layout.';

revoke all on function public.approval_batch_promote_request_approved(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;

create or replace function public.approve_entire_batch_internal(
  p_batch_id uuid,
  p_actor uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_batch public.approval_batches%rowtype;
  v_count integer;
  v_rejected integer;
  v_final_status text;
  v_request_id uuid;
  v_promoted integer := 0;
begin
  select *
    into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> p_actor then
    raise exception 'batch_director_required';
  end if;
  if v_batch.status <> 'submitted' then
    raise exception 'batch_must_be_submitted';
  end if;

  select count(*)::integer
    into v_count
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'pending';

  if v_count = 0 then
    raise exception 'batch_has_no_pending_items';
  end if;

  for v_request_id in
    select item.payment_request_id
    from public.approval_batch_items item
    where item.batch_id = p_batch_id
      and item.removed_at is null
      and item.director_status = 'pending'
    order by item.payment_request_id
    for update of item
  loop
    if public.approval_batch_promote_request_approved(
      v_request_id,
      p_actor,
      p_batch_id
    ) then
      v_promoted := v_promoted + 1;
    end if;
  end loop;

  update public.approval_batch_items
  set director_status = 'approved',
      director_reject_reason = null,
      rebatch_status = 'not_applicable',
      rebatch_released_by = null,
      rebatch_released_at = null,
      rebatch_release_note = null,
      decided_by = p_actor,
      decided_at = now()
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'pending';
  get diagnostics v_count = row_count;

  select count(*)
    into v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null
    and director_status = 'rejected';

  v_final_status := case
    when v_rejected > 0 then 'partially_approved'
    else 'approved'
  end;

  update public.approval_batches
  set status = v_final_status,
      decided_by = p_actor,
      decided_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_final_status,
    'approved_items', v_count,
    'promoted_requests', v_promoted,
    'rejected_items', v_rejected,
    'approval_model', 'single_direction'
  );
end;
$$;

comment on function public.approve_entire_batch_internal(uuid, uuid) is
  'Shared approval core. It atomically approves pending cut items, promotes eligible payment requests to approved and records their decision audit. Callers must validate the actor first.';

revoke all on function public.approve_entire_batch_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.decide_approval_batch_items(
  p_batch_id uuid,
  p_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid;
  v_batch public.approval_batches%rowtype;
  v_decision jsonb;
  v_item_id uuid;
  v_request_id uuid;
  v_status text;
  v_reason text;
  v_updated integer := 0;
  v_promoted integer := 0;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_final_status text;
begin
  v_actor := public.approval_batch_require_active_direction();

  select *
    into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;

  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.director_id <> v_actor then
    raise exception 'batch_director_required';
  end if;
  if v_batch.status <> 'submitted' then
    raise exception 'batch_must_be_submitted';
  end if;
  if jsonb_typeof(p_decisions) <> 'array'
     or jsonb_array_length(p_decisions) = 0 then
    raise exception 'decisions_array_required';
  end if;

  if exists (
    select 1
    from (
      select nullif(value ->> 'item_id', '') as item_id
      from jsonb_array_elements(p_decisions)
    ) decisions
    group by decisions.item_id
    having decisions.item_id is null or count(*) > 1
  ) then
    raise exception 'duplicate_or_missing_item_decision';
  end if;

  for v_decision in
    select value from jsonb_array_elements(p_decisions)
  loop
    v_item_id := nullif(v_decision ->> 'item_id', '')::uuid;
    v_status := lower(btrim(coalesce(v_decision ->> 'status', '')));
    v_reason := nullif(
      btrim(coalesce(v_decision ->> 'reject_reason', '')),
      ''
    );

    if v_status not in ('approved', 'rejected') then
      raise exception 'invalid_item_decision';
    end if;
    if v_status = 'rejected' and v_reason is null then
      raise exception 'reject_reason_required';
    end if;

    select item.payment_request_id
      into v_request_id
    from public.approval_batch_items item
    where item.id = v_item_id
      and item.batch_id = p_batch_id
      and item.removed_at is null
      and item.director_status = 'pending'
    for update;

    if not found then
      raise exception 'pending_batch_item_not_found:%', v_item_id;
    end if;

    if v_status = 'approved'
       and public.approval_batch_promote_request_approved(
         v_request_id,
         v_actor,
         p_batch_id
       ) then
      v_promoted := v_promoted + 1;
    end if;

    update public.approval_batch_items
    set director_status = v_status,
        director_reject_reason = case
          when v_status = 'rejected' then v_reason
          else null
        end,
        rebatch_status = case
          when v_status = 'rejected' then 'blocked'
          else 'not_applicable'
        end,
        rebatch_released_by = null,
        rebatch_released_at = null,
        rebatch_release_note = null,
        decided_by = v_actor,
        decided_at = now()
    where id = v_item_id;

    v_updated := v_updated + 1;
  end loop;

  select
    count(*) filter (where director_status = 'pending'),
    count(*) filter (where director_status = 'approved'),
    count(*) filter (where director_status = 'rejected')
    into v_pending, v_approved, v_rejected
  from public.approval_batch_items
  where batch_id = p_batch_id
    and removed_at is null;

  if v_pending = 0 then
    v_final_status := case
      when v_rejected > 0 then 'partially_approved'
      else 'approved'
    end;

    update public.approval_batches
    set status = v_final_status,
        decided_by = v_actor,
        decided_at = now()
    where id = p_batch_id;
  else
    v_final_status := 'submitted';
  end if;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_final_status,
    'updated_items', v_updated,
    'promoted_requests', v_promoted,
    'pending_items', v_pending,
    'approved_items', v_approved,
    'rejected_items', v_rejected,
    'approval_model', 'single_direction'
  );
end;
$$;

comment on function public.decide_approval_batch_items(uuid,jsonb) is
  'Allows the active Direction profile stored on the batch to decide items. Every approved item atomically promotes its eligible payment request to approved and records the decision audit.';

revoke all on function public.decide_approval_batch_items(uuid,jsonb)
  from public, anon, service_role;
grant execute on function public.decide_approval_batch_items(uuid,jsonb)
  to authenticated;

do $$
begin
  if has_function_privilege(
       'public',
       'public.approval_batch_promote_request_approved(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.approval_batch_promote_request_approved(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.approval_batch_promote_request_approved(uuid,uuid,uuid)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.approval_batch_promote_request_approved(uuid,uuid,uuid)',
       'execute'
     ) then
    raise exception 'approval_batch_promote_helper_must_remain_private';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.decide_approval_batch_items(uuid,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.decide_approval_batch_items(uuid,jsonb)',
       'execute'
     ) then
    raise exception 'decide_approval_batch_items_grants_invalid';
  end if;
end;
$$;
