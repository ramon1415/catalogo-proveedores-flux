-- Align cash/check fund creation with canonical batch execution readiness.
-- This migration changes function contracts only; it does not create funds or mutate request status.

begin;

do $$
declare
  v_source text;
begin
  if to_regclass('public.payment_requests') is null
     or to_regclass('public.cash_funds') is null
     or to_regclass('public.approval_batches') is null
     or to_regclass('public.approval_batch_items') is null
     or to_regclass('public.approval_batch_company_settings') is null
     or to_regclass('public.payment_request_extraordinary_authorizations') is null then
    raise exception '028_precheck: required payment, cash-fund, batch or extraordinary relations are missing';
  end if;

  if to_regclass('public.intake_links') is null
     or to_regprocedure('public.next_payment_intake_public_folio()') is null then
    raise exception '028_precheck: migration 025 semantic baseline is missing';
  end if;

  if to_regprocedure('public.create_cash_fund(uuid,uuid,date,text,uuid,text)') is null
     or to_regprocedure('public.approval_batch_assert_execution_authorized()') is null
     or to_regprocedure('public.approval_batch_request_has_current_direction_approval(uuid)') is null
     or to_regprocedure('public.approval_batch_request_has_active_extraordinary(uuid)') is null
     or to_regprocedure('public.approval_batch_request_has_any_execution_record(uuid)') is null
     or to_regprocedure('public.get_payment_request_execution_context(uuid)') is null
     or to_regprocedure('public.approval_batch_require_finance()') is null then
    raise exception '028_precheck: migration 026 or canonical batch helpers are missing';
  end if;

  select lower(p.prosrc)
    into v_source
  from pg_proc p
  where p.oid = 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)'::regprocedure;

  if position('v_request.payment_method' in v_source) = 0
     or position('v_request.request_type::text' in v_source) = 0
     or position('payment_request_must_be_approved' in v_source) = 0
     or position('cash_fund_already_exists' in v_source) = 0
     or position('approval_batch_require_finance' in v_source) = 0 then
    raise exception '028_precheck: create_cash_fund no longer matches the inspected 026 baseline';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'cash_funds'
      and t.tgname = 'require_batch_for_cash_fund'
      and p.proname = 'approval_batch_assert_execution_authorized'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception '028_precheck: require_batch_for_cash_fund is missing or disabled';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception '028_precheck: required Supabase roles are missing';
  end if;
end
$$;

create or replace function public.get_payment_request_execution_readiness(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_latest record;
  v_extra record;
  v_request_status text;
  v_payment_method text;
  v_enforced boolean := false;
  v_has_execution boolean := false;
  v_has_cash_fund boolean := false;
  v_has_batch_item boolean := false;
  v_has_open_batch boolean := false;
  v_has_direction_rejection boolean := false;
  v_direction_current boolean := false;
  v_extraordinary_current boolean := false;
  v_is_finance boolean := false;
  v_can_execute boolean := false;
  v_can_create_cash_fund boolean := false;
  v_authorization_source text;
  v_block_reason text;
  v_cash_fund_block_reason text;
begin
  if p_payment_request_id is null then
    raise exception 'payment_request_required';
  end if;

  select *
    into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  if not found then
    raise exception 'payment_request_not_found';
  end if;

  v_request_status := v_request.status::text;
  v_payment_method := lower(
    coalesce(
      nullif(btrim(v_request.payment_method), ''),
      nullif(btrim(v_request.request_type::text), '')
    )
  );
  v_payment_method := case v_payment_method
    when 'efectivo' then 'cash'
    when 'cheque' then 'check'
    else v_payment_method
  end;

  v_is_finance := public.current_user_has_role(public.flux_finance_roles());
  v_has_execution := public.approval_batch_request_has_any_execution_record(v_request.id);
  v_has_cash_fund := exists (
    select 1
    from public.cash_funds cf
    where cf.payment_request_id = v_request.id
  );

  select coalesce(
    settings.regular_payments_require_closed_batch
      and settings.enforcement_started_at is not null
      and v_request.created_at >= settings.enforcement_started_at,
    false
  )
    into v_enforced
  from public.approval_batch_company_settings settings
  where settings.company_id = v_request.company_id;
  v_enforced := coalesce(v_enforced, false);

  select
    abi.id as item_id,
    abi.director_status,
    abi.decided_at,
    abi.review_sequence,
    abi.rebatch_status,
    ab.id as batch_id,
    ab.status as batch_status,
    ab.closed_at
    into v_latest
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;
  v_has_batch_item := found;

  select prea.id, prea.authorized_at
    into v_extra
  from public.payment_request_extraordinary_authorizations prea
  where prea.payment_request_id = v_request.id
    and prea.status = 'active'
  order by prea.authorized_at desc, prea.id desc
  limit 1;

  v_extraordinary_current := coalesce(
    v_extra.id is not null
      and v_extra.authorized_at >= v_request.approval_material_updated_at,
    false
  );
  v_direction_current := public.approval_batch_request_has_current_direction_approval(v_request.id);
  v_has_open_batch := exists (
    select 1
    from public.approval_batch_items abi
    join public.approval_batches ab on ab.id = abi.batch_id
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and ab.status in ('draft', 'submitted')
  );
  v_has_direction_rejection := exists (
    select 1
    from public.approval_batch_items abi
    where abi.payment_request_id = v_request.id
      and abi.removed_at is null
      and abi.director_status = 'rejected'
  );

  if v_has_execution then
    v_block_reason := 'payment_request_already_executed';
  elsif v_request_status not in ('submitted', 'pending_approval', 'approved') then
    v_block_reason := 'request_status_not_executable';
  elsif v_extra.id is not null then
    if not v_extraordinary_current then
      v_block_reason := 'extraordinary_not_current';
    elsif v_has_direction_rejection then
      v_block_reason := 'direction_rejected';
    elsif v_has_open_batch then
      v_block_reason := 'batch_not_closed';
    else
      v_authorization_source := 'extraordinary';
    end if;
  elsif v_has_batch_item then
    if v_latest.director_status = 'rejected' then
      v_block_reason := 'direction_rejected';
    elsif v_latest.director_status = 'pending'
       or v_latest.batch_status = 'submitted' then
      v_block_reason := 'direction_pending';
    elsif v_latest.director_status = 'approved'
       and (
         v_latest.decided_at is null
         or v_latest.decided_at < v_request.approval_material_updated_at
       ) then
      v_block_reason := 'material_change_requires_reapproval';
    elsif v_latest.director_status = 'approved'
       and v_latest.batch_status <> 'closed' then
      v_block_reason := 'batch_not_closed';
    elsif v_latest.director_status = 'approved'
       and (
         v_latest.closed_at is null
         or v_latest.closed_at < v_latest.decided_at
       ) then
      v_block_reason := 'batch_not_closed';
    elsif v_latest.director_status = 'approved'
       and not v_direction_current then
      v_block_reason := 'material_change_requires_reapproval';
    elsif v_latest.director_status = 'approved'
       and v_latest.batch_status = 'closed'
       and v_direction_current then
      v_authorization_source := 'closed_batch';
    else
      v_block_reason := 'execution_not_authorized';
    end if;
  elsif not v_enforced and v_request_status = 'approved' then
    v_authorization_source := 'legacy_approved';
  elsif v_enforced then
    v_block_reason := 'direction_pending';
  else
    v_block_reason := 'execution_not_authorized';
  end if;

  v_can_execute := v_block_reason is null and v_authorization_source is not null;
  v_cash_fund_block_reason := case
    when not v_is_finance then 'finance_role_required'
    when v_payment_method not in ('cash', 'check') then 'payment_request_must_be_cash_or_check'
    when v_has_cash_fund then 'cash_fund_already_exists'
    when v_can_execute then null
    when v_block_reason = 'direction_pending' then 'cash_fund_direction_pending'
    when v_block_reason = 'direction_rejected' then 'cash_fund_direction_rejected'
    when v_block_reason = 'batch_not_closed' then 'cash_fund_batch_not_closed'
    when v_block_reason = 'material_change_requires_reapproval'
      then 'cash_fund_material_change_requires_reapproval'
    when v_block_reason = 'extraordinary_not_current'
      then 'cash_fund_extraordinary_not_current'
    else 'cash_fund_execution_not_authorized'
  end;
  v_can_create_cash_fund := v_cash_fund_block_reason is null;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'request_status', v_request_status,
    'payment_method', v_payment_method,
    'can_execute', v_can_execute,
    'can_create_cash_fund', v_can_create_cash_fund,
    'authorization_source', v_authorization_source,
    'block_reason', v_block_reason,
    'cash_fund_block_reason', v_cash_fund_block_reason,
    'finance_actor', v_is_finance,
    'direction_approval_current', v_direction_current,
    'batch_closed', coalesce(v_latest.batch_status = 'closed' and v_latest.closed_at is not null, false),
    'extraordinary_current', v_extraordinary_current,
    'execution_exists', v_has_execution,
    'cash_fund_exists', v_has_cash_fund,
    'enforcement_required', v_enforced,
    'latest_batch_id', v_latest.batch_id,
    'latest_batch_status', v_latest.batch_status,
    'latest_item_id', v_latest.item_id,
    'latest_director_status', v_latest.director_status,
    'direction_decided_at', v_latest.decided_at,
    'batch_closed_at', v_latest.closed_at
  );
end
$$;

comment on function public.get_payment_request_execution_readiness(uuid) is
  'Internal canonical readiness for closed-batch, current-extraordinary and legacy-approved execution paths; returns no banking data.';

create or replace function public.approval_batch_assert_execution_authorized()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_readiness jsonb;
  v_reason text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.payment_request_id::text, 21021));
  v_readiness := public.get_payment_request_execution_readiness(new.payment_request_id);

  if coalesce((v_readiness ->> 'can_execute')::boolean, false) then
    return new;
  end if;

  v_reason := coalesce(v_readiness ->> 'block_reason', 'execution_not_authorized');
  case v_reason
    when 'payment_request_already_executed' then
      raise exception 'payment_request_already_executed';
    when 'extraordinary_not_current' then
      raise exception 'extraordinary_reauthorization_required';
    when 'direction_rejected' then
      raise exception 'direction_rejected_request_cannot_execute';
    when 'material_change_requires_reapproval' then
      raise exception 'direction_reapproval_required';
    when 'direction_pending' then
      raise exception 'closed_batch_authorization_required';
    when 'batch_not_closed' then
      raise exception 'closed_batch_authorization_required';
    else
      if coalesce((v_readiness ->> 'enforcement_required')::boolean, false) then
        raise exception 'closed_batch_authorization_required';
      end if;
      raise exception 'batch_authorization_required';
  end case;
end
$$;

create or replace function public.get_payment_request_execution_context(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_request public.payment_requests%rowtype;
  v_extra record;
  v_batch record;
  v_is_finance boolean;
  v_executed boolean;
  v_budget jsonb;
  v_budget_current boolean;
  v_direction_current boolean;
  v_direction_stale boolean;
  v_can_authorize boolean;
  v_block_reason text;
  v_history jsonb;
  v_readiness jsonb;
begin
  v_actor := public.approval_batch_require_actor();
  v_is_finance := public.current_user_has_role(public.flux_finance_roles());
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then raise exception 'payment_request_not_found'; end if;

  if not v_is_finance
     and v_request.requested_by <> v_actor
     and not exists (
       select 1
       from public.company_directors cd
       where cd.company_id = v_request.company_id
         and cd.director_profile_id = v_actor
         and cd.active
     ) then
    raise exception 'payment_request_execution_context_denied';
  end if;

  select prea.*, p.full_name as authorized_by_name
    into v_extra
  from public.payment_request_extraordinary_authorizations prea
  join public.profiles p on p.id = prea.authorized_by
  where prea.payment_request_id = v_request.id
    and prea.status = 'active'
  order by prea.authorized_at desc
  limit 1;

  select
    abi.id as item_id,
    abi.director_status,
    abi.director_reject_reason,
    abi.rebatch_status,
    abi.rebatch_release_note,
    abi.decided_at,
    abi.review_sequence,
    abi.previous_item_id,
    abi.resubmitted_at,
    abi.resubmission_note,
    ab.id as batch_id,
    ab.label as batch_label,
    ab.status as batch_status,
    ab.closed_at
  into v_batch
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null
  order by abi.review_sequence desc, abi.created_at desc, abi.id desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', abi.id,
    'batch_id', ab.id,
    'batch_label', ab.label,
    'batch_status', ab.status,
    'review_sequence', abi.review_sequence,
    'director_status', abi.director_status,
    'reject_reason', abi.director_reject_reason,
    'decided_at', abi.decided_at,
    'decided_by_name', decider.full_name,
    'rebatch_status', abi.rebatch_status,
    'correction_note', abi.rebatch_release_note,
    'resubmitted_at', abi.resubmitted_at,
    'resubmitted_by_name', resubmitter.full_name,
    'resubmission_note', abi.resubmission_note,
    'closed_at', ab.closed_at
  ) order by abi.review_sequence, abi.created_at), '[]'::jsonb)
    into v_history
  from public.approval_batch_items abi
  join public.approval_batches ab on ab.id = abi.batch_id
  left join public.profiles decider on decider.id = abi.decided_by
  left join public.profiles resubmitter on resubmitter.id = abi.resubmitted_by
  where abi.payment_request_id = v_request.id
    and abi.removed_at is null;

  v_executed := public.approval_batch_request_has_any_execution_record(v_request.id);
  v_budget := public.approval_batch_budget_validation(v_request.id);
  v_budget_current := coalesce(v_budget ->> 'status', 'bloqueado') = 'aprobable';
  v_direction_current := public.approval_batch_request_has_current_direction_approval(v_request.id);
  v_readiness := public.get_payment_request_execution_readiness(v_request.id);
  v_direction_stale := coalesce(
    v_batch.director_status = 'approved'
    and (
      v_batch.decided_at is null
      or v_batch.decided_at < v_request.approval_material_updated_at
    ),
    false
  );

  v_block_reason := case
    when not v_is_finance then 'finance_role_required'
    when v_request.status::text not in ('submitted', 'pending_approval', 'approved')
      then 'payment_request_not_available_for_extraordinary'
    when v_executed then 'payment_request_already_executed'
    when v_extra.id is not null then 'extraordinary_authorization_already_active'
    when exists (
      select 1
      from public.approval_batch_items abi
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and abi.director_status = 'rejected'
    ) then 'direction_rejected_request_cannot_be_extraordinary'
    when exists (
      select 1
      from public.approval_batch_items abi
      join public.approval_batches ab on ab.id = abi.batch_id
      where abi.payment_request_id = v_request.id
        and abi.removed_at is null
        and ab.status in ('draft', 'submitted')
    ) then 'remove_request_from_open_batch_first'
    when v_direction_current then 'batch_approved_request_cannot_be_extraordinary'
    else null
  end;
  v_can_authorize := v_block_reason is null;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'is_finance', v_is_finance,
    'approval_model', 'single_direction',
    'budget_validation_current', v_budget_current,
    'budget_status', v_budget ->> 'status',
    'budget_reason', v_budget ->> 'motivo',
    'budget_available', nullif(v_budget ->> 'disponible_actual', '')::numeric,
    'finance_approval_current', v_budget_current,
    'compatibility_field_semantics', 'finance_approval_current_maps_to_budget_validation_in_023',
    'direction_approval_current', v_direction_current,
    'direction_approval_stale', v_direction_stale,
    'execution_block_reason', case
      when v_extra.id is not null
        and v_extra.authorized_at < v_request.approval_material_updated_at
        then 'extraordinary_reauthorization_required'
      when v_direction_stale then 'direction_reapproval_required'
      when v_executed then 'payment_request_already_executed'
      when v_batch.item_id is not null and not v_direction_current then 'closed_batch_authorization_required'
      else null
    end,
    'executed', v_executed,
    'can_execute', coalesce((v_readiness ->> 'can_execute')::boolean, false),
    'can_create_cash_fund', coalesce((v_readiness ->> 'can_create_cash_fund')::boolean, false),
    'cash_fund_block_reason', v_readiness ->> 'cash_fund_block_reason',
    'execution_authorization_source', v_readiness ->> 'authorization_source',
    'execution_readiness_block_reason', v_readiness ->> 'block_reason',
    'request_status', v_readiness ->> 'request_status',
    'payment_method', v_readiness ->> 'payment_method',
    'can_authorize_extraordinary', v_can_authorize,
    'authorization_block_reason', v_block_reason,
    'extraordinary', case when v_extra.id is null then null else jsonb_build_object(
      'id', v_extra.id,
      'category', v_extra.category,
      'reason', v_extra.reason,
      'authorized_by', v_extra.authorized_by,
      'authorized_by_name', v_extra.authorized_by_name,
      'authorized_at', v_extra.authorized_at,
      'authorization_current', v_extra.authorized_at >= v_request.approval_material_updated_at,
      'can_revoke', v_is_finance and not v_executed,
      'revoke_block_reason', case when v_executed then 'extraordinary_already_materialized' else null end
    ) end,
    'latest_batch', case when v_batch.item_id is null then null else jsonb_build_object(
      'item_id', v_batch.item_id,
      'batch_id', v_batch.batch_id,
      'batch_label', v_batch.batch_label,
      'batch_status', v_batch.batch_status,
      'director_status', v_batch.director_status,
      'direction_approval_current', v_direction_current,
      'direction_decided_at', v_batch.decided_at,
      'closed_at', v_batch.closed_at,
      'reject_reason', v_batch.director_reject_reason,
      'rebatch_status', v_batch.rebatch_status,
      'correction_note', v_batch.rebatch_release_note,
      'review_sequence', v_batch.review_sequence,
      'previous_item_id', v_batch.previous_item_id,
      'resubmitted_at', v_batch.resubmitted_at,
      'resubmission_note', v_batch.resubmission_note
    ) end,
    'approval_history', v_history
  );
end
$$;

create or replace function public.create_cash_fund(
  p_payment_request_id uuid,
  p_responsible_profile_id uuid,
  p_due_date date,
  p_delivery_method text,
  p_delivered_by uuid default null::uuid,
  p_notes text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_fund_id uuid;
  v_delivery_method text;
  v_request_payment_method text;
  v_readiness jsonb;
  v_cash_fund_block_reason text;
begin
  perform public.approval_batch_require_finance();

  if p_payment_request_id is null then
    raise exception 'payment_request_required';
  end if;
  if p_responsible_profile_id is null then
    raise exception 'responsible_profile_required';
  end if;
  if p_due_date is null then
    raise exception 'due_date_required';
  end if;

  v_delivery_method := lower(nullif(btrim(coalesce(p_delivery_method, '')), ''));
  if v_delivery_method not in ('cash', 'check') then
    raise exception 'invalid_delivery_method';
  end if;

  select *
    into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then
    raise exception 'payment_request_not_found';
  end if;

  v_request_payment_method := lower(
    coalesce(
      nullif(btrim(v_request.payment_method), ''),
      nullif(btrim(v_request.request_type::text), '')
    )
  );
  v_request_payment_method := case v_request_payment_method
    when 'efectivo' then 'cash'
    when 'cheque' then 'check'
    else v_request_payment_method
  end;

  if v_request_payment_method not in ('cash', 'check') then
    raise exception 'payment_request_must_be_cash_or_check';
  end if;
  if v_delivery_method <> v_request_payment_method then
    raise exception 'delivery_method_must_match_payment_request';
  end if;
  if coalesce(v_request.amount_requested, 0) <= 0 then
    raise exception 'invalid_request_amount';
  end if;
  if not exists (
    select 1
    from public.profiles
    where id = p_responsible_profile_id
      and coalesce(active, true) = true
  ) then
    raise exception 'responsible_profile_not_found';
  end if;
  if p_delivered_by is not null and not exists (
    select 1
    from public.profiles
    where id = p_delivered_by
      and coalesce(active, true) = true
  ) then
    raise exception 'delivered_by_profile_not_found';
  end if;
  if exists (
    select 1
    from public.cash_funds
    where payment_request_id = p_payment_request_id
  ) then
    raise exception 'cash_fund_already_exists';
  end if;

  v_readiness := public.get_payment_request_execution_readiness(v_request.id);
  if not coalesce((v_readiness ->> 'can_create_cash_fund')::boolean, false) then
    v_cash_fund_block_reason := coalesce(
      v_readiness ->> 'cash_fund_block_reason',
      'cash_fund_execution_not_authorized'
    );
    raise exception '%', v_cash_fund_block_reason;
  end if;

  insert into public.cash_funds (
    company_id,
    payment_request_id,
    responsible_profile_id,
    assigned_amount,
    verified_amount,
    assignment_date,
    due_date,
    status,
    delivery_method,
    delivered_by,
    delivered_at,
    notes
  ) values (
    v_request.company_id,
    p_payment_request_id,
    p_responsible_profile_id,
    v_request.amount_requested,
    0,
    current_date,
    p_due_date,
    'pending_receipt',
    v_delivery_method,
    p_delivered_by,
    case when p_delivered_by is not null then now() else null end,
    p_notes
  )
  returning id into v_fund_id;

  update public.payment_requests
  set operational_comments = concat_ws(
        E'\n',
        nullif(operational_comments, ''),
        'Fondo de ' || v_delivery_method || ' creado. Pendiente de comprobacion.'
      ),
      updated_at = now()
  where id = p_payment_request_id;

  return jsonb_build_object(
    'message', 'cash_fund_created',
    'cash_fund_id', v_fund_id,
    'payment_request_id', p_payment_request_id,
    'responsible_profile_id', p_responsible_profile_id,
    'assigned_amount', v_request.amount_requested,
    'due_date', p_due_date,
    'delivery_method', v_delivery_method,
    'status', 'pending_receipt'
  );
end
$$;

revoke all on function public.get_payment_request_execution_readiness(uuid)
  from public, anon, authenticated;
revoke all on function public.approval_batch_assert_execution_authorized()
  from public, anon, authenticated;
revoke all on function public.get_payment_request_execution_context(uuid)
  from public, anon, authenticated;
revoke all on function public.create_cash_fund(uuid,uuid,date,text,uuid,text)
  from public, anon, authenticated;

grant execute on function public.get_payment_request_execution_context(uuid)
  to authenticated;
grant execute on function public.create_cash_fund(uuid,uuid,date,text,uuid,text)
  to authenticated;

comment on function public.get_payment_request_execution_context(uuid) is
  'Returns the existing execution context plus canonical cash-fund readiness without exposing banking secrets.';
comment on function public.create_cash_fund(uuid,uuid,date,text,uuid,text) is
  'Creates one cash/check fund for Finance when canonical closed-batch, current-extraordinary or compatible legacy readiness permits execution.';

do $$
declare
  v_readiness record;
  v_context record;
  v_cash record;
begin
  select p.prosecdef, p.proconfig, lower(p.prosrc) as source
    into v_readiness
  from pg_proc p
  where p.oid = 'public.get_payment_request_execution_readiness(uuid)'::regprocedure;

  if not v_readiness.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_readiness.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('closed_batch' in v_readiness.source) = 0
     or position('extraordinary' in v_readiness.source) = 0
     or position('legacy_approved' in v_readiness.source) = 0
     or position('material_change_requires_reapproval' in v_readiness.source) = 0 then
    raise exception '028_postcheck: canonical readiness helper is incomplete';
  end if;

  select p.prosecdef, p.proconfig, lower(p.prosrc) as source
    into v_context
  from pg_proc p
  where p.oid = 'public.get_payment_request_execution_context(uuid)'::regprocedure;

  if not v_context.prosecdef
     or position('can_create_cash_fund' in v_context.source) = 0
     or position('cash_fund_block_reason' in v_context.source) = 0
     or position('execution_authorization_source' in v_context.source) = 0 then
    raise exception '028_postcheck: execution context was not extended compatibly';
  end if;

  select p.prosecdef, p.proconfig, lower(p.prosrc) as source
    into v_cash
  from pg_proc p
  where p.oid = 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)'::regprocedure;

  if not v_cash.prosecdef
     or not exists (
       select 1
       from unnest(coalesce(v_cash.proconfig, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     )
     or position('get_payment_request_execution_readiness' in v_cash.source) = 0
     or position('payment_request_must_be_approved' in v_cash.source) > 0
     or position('cash_fund_already_exists' in v_cash.source) = 0
     or position('approval_batch_require_finance' in v_cash.source) = 0
     or position('insert into public.cash_funds' in v_cash.source) = 0 then
    raise exception '028_postcheck: create_cash_fund readiness contract is incomplete';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'cash_funds'
      and t.tgname = 'require_batch_for_cash_fund'
      and p.proname = 'approval_batch_assert_execution_authorized'
      and position('get_payment_request_execution_readiness' in lower(p.prosrc)) > 0
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) then
    raise exception '028_postcheck: cash-fund execution trigger is missing, disabled or inconsistent';
  end if;

  if has_function_privilege('authenticated', 'public.get_payment_request_execution_readiness(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_payment_request_execution_readiness(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_payment_request_execution_context(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_payment_request_execution_context(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_cash_fund(uuid,uuid,date,text,uuid,text)', 'EXECUTE') then
    raise exception '028_postcheck: function grants do not match the least-privilege contract';
  end if;
end
$$;

commit;
