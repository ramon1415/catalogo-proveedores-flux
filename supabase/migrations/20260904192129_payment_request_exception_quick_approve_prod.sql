-- PROD forward migration for PR #529.
-- Generated with Supabase CLI v2.116.0; activation remains a separate gate.

set lock_timeout = '5s';
set statement_timeout = '120s';

-- =====================================================================
-- Payment-request EXCEPTION quick approval (approve-from-email)
-- Mirror of the weekly-cut quick-approve family
-- (20260826201712_approval_batch_quick_approve_dev.sql), adapted for the
-- single-request budget-exception decision path.
--
-- Key divergence from the weekly-cut mirror:
--   public.decide_payment_request() hard-binds the actor to
--   public.current_profile_id() (the caller's JWT), so it cannot be
--   invoked by service_role acting as another approver. We therefore
--   split it exactly like the weekly-cut code split approve_entire_batch
--   into approve_entire_batch_internal (actor as a parameter) + a thin
--   authenticated wrapper. The quick-approve RPC calls the *_internal core.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Enrich the created-notification payload with budget_shortfall so the
--    dispatcher can render the "faltante de presupuesto" callout.
--    Additive only: jsonb_strip_nulls drops it when null.
-- ---------------------------------------------------------------------
create or replace function public.notification_payment_request_payload(p_payment_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_payload jsonb;
begin
  select jsonb_strip_nulls(jsonb_build_object(
    'folio', pr.request_number,
    'provider', coalesce(p.alias, p.nombre_completo),
    'amount', pr.amount_requested,
    'currency', pr.currency,
    'company', c.name,
    'cost_center', cc.name,
    'budget_category', bc.name,
    'requester', rp.full_name,
    'status', pr.status::text,
    'budget_decision', pr.budget_decision,
    'budget_shortfall', pr.budget_shortfall,
    'is_extraordinary_adjustment', pr.is_extraordinary_adjustment,
    'path', '/solicitudes.html'
  ))
    into v_payload
  from public.payment_requests pr
  left join public.proveedores p on p.id = pr.proveedor_id
  left join public.companies c on c.id = pr.company_id
  left join public.cost_centers cc on cc.id = pr.cost_center_id
  left join public.budget_categories bc on bc.id = pr.budget_category_id
  left join public.profiles rp on rp.id = pr.requested_by
  where pr.id = p_payment_request_id;

  return coalesce(v_payload, '{}'::jsonb);
end;
$function$;

-- ---------------------------------------------------------------------
-- 1) Split decide_payment_request into an actor-parameter core + wrapper.
--    The _internal core is byte-for-byte identical to the current public
--    body EXCEPT it does not read public.current_profile_id(); the caller
--    supplies (and MUST authorize) the actor. Revoked from every client
--    role: only postgres-owned SECURITY DEFINER callers reach it.
-- ---------------------------------------------------------------------
create or replace function public.decide_payment_request_internal(
  p_payment_request_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_comments text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.payment_requests%rowtype;
  v_assignment public.approver_assignments%rowtype;
  v_previous_status text;
  v_new_status text;
  v_role_id uuid;
  v_rule_id uuid;
  v_approval_level integer;
  v_is_exception boolean;
  v_clean_comments text;
  v_uses_assignment_snapshot boolean := false;
  v_legacy_assignment_override boolean := false;
begin
  -- No session binding here: the actor is supplied by the (trusted) caller.
  if p_actor_profile_id is null then
    raise exception 'actor_profile_required';
  end if;

  v_clean_comments := nullif(btrim(coalesce(p_comments, '')), '');
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and coalesce(p.active, true)
  ) then
    raise exception 'actor_profile_not_found';
  end if;

  if p_action not in (
    'approved', 'rejected', 'changes_requested', 'exception_approved',
    'exception_rejected', 'amount_change_requested', 'category_change_requested',
    'budget_adjustment_requested'
  ) then
    raise exception 'invalid_action';
  end if;

  v_is_exception := (
    v_request.budget_decision = 'bloqueado'
    or coalesce(v_request.is_extraordinary_adjustment, false)
  );
  if p_action in (
    'exception_approved', 'exception_rejected', 'amount_change_requested',
    'category_change_requested', 'budget_adjustment_requested'
  ) and v_clean_comments is null then
    raise exception 'comments_required_for_exception_action';
  end if;
  if p_action = 'changes_requested' and v_clean_comments is null then
    raise exception 'comments_required_for_changes_requested';
  end if;
  if not v_is_exception and p_action not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'exception_action_not_allowed_for_approvable_request';
  end if;
  if v_is_exception and p_action = 'approved' then
    raise exception 'normal_approval_not_allowed_for_budget_exception';
  end if;
  if v_is_exception and p_action not in (
    'exception_approved', 'exception_rejected', 'amount_change_requested',
    'category_change_requested', 'budget_adjustment_requested'
  ) then
    raise exception 'invalid_exception_action';
  end if;

  if v_request.approver_id is not null
     and p_actor_profile_id <> v_request.approver_id then
    raise exception 'selected_approver_only';
  end if;

  -- Migration 018 did not store the assignment id. Preserve its override only
  -- when the same assignment already existed when the request was created.
  if v_request.approver_assignment_id is null
     and v_request.approver_selection_source is null
     and v_request.approver_id is not null then
    select * into v_assignment
    from public.approver_assignments aa
    where aa.company_id = v_request.company_id
      and aa.requester_id = v_request.requested_by
      and aa.approver_id = v_request.approver_id
      and aa.created_at <= v_request.created_at
    order by aa.created_at desc
    limit 1;
    v_legacy_assignment_override := found;
  end if;

  if v_request.approver_assignment_id is not null or v_legacy_assignment_override then
    if v_request.approver_assignment_id is not null then
      select * into v_assignment
      from public.approver_assignments aa
      where aa.id = v_request.approver_assignment_id;
    end if;
    if not found
       or v_assignment.company_id <> v_request.company_id
       or v_assignment.requester_id <> v_request.requested_by
       or v_assignment.approver_id <> v_request.approver_id then
      raise exception 'approver_assignment_snapshot_invalid';
    end if;

    select r.id into v_role_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.profile_id = p_actor_profile_id
    order by
      case when lower(trim(r.name)) = any (public.payment_request_approver_role_names()) then 0 else 1 end,
      lower(trim(r.name))
    limit 1;
    v_rule_id := null;
    v_approval_level := 0;
    v_uses_assignment_snapshot := true;
  else
    if not exists (
      select 1 from public.user_roles ur where ur.profile_id = p_actor_profile_id
    ) then
      raise exception 'actor_has_no_role';
    end if;

    select ar.id, ar.role_id, ar.approval_level
    into v_rule_id, v_role_id, v_approval_level
    from public.approval_rules ar
    join public.user_roles ur
      on ur.role_id = ar.role_id and ur.profile_id = p_actor_profile_id
    join public.roles rule_role on rule_role.id = ar.role_id
    where ar.active
      and (
        v_request.approver_id is null
        or lower(trim(rule_role.name)) = any (public.payment_request_approver_role_names())
      )
      and (ar.company_id is null or ar.company_id = v_request.company_id)
      and (ar.cost_center_id is null or ar.cost_center_id = v_request.cost_center_id)
      and coalesce(v_request.amount_requested, 0) >= ar.amount_min
      and (ar.amount_max is null or coalesce(v_request.amount_requested, 0) <= ar.amount_max)
      and (
        (p_action = 'approved' and ar.can_approve)
        or (p_action = 'exception_approved' and ar.can_approve and ar.can_approve_exception)
        or (p_action in ('rejected', 'exception_rejected') and ar.can_reject)
        or (p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') and ar.can_request_changes)
        or (p_action = 'budget_adjustment_requested' and ar.can_request_budget_adjustment)
      )
    order by
      case when ar.company_id is not null then 0 else 1 end,
      case when ar.cost_center_id is not null then 0 else 1 end,
      ar.approval_level asc
    limit 1;

    if v_rule_id is null then
      if p_action = 'exception_approved' then
        raise exception 'selected_approver_cannot_approve_exception';
      elsif p_action = 'approved' then
        raise exception 'selected_approver_cannot_approve';
      elsif p_action in ('rejected', 'exception_rejected') then
        raise exception 'selected_approver_cannot_reject';
      elsif p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') then
        raise exception 'selected_approver_cannot_request_changes';
      elsif p_action = 'budget_adjustment_requested' then
        raise exception 'selected_approver_cannot_request_budget_adjustment';
      else
        raise exception 'approval_rule_not_found';
      end if;
    end if;
  end if;

  v_previous_status := v_request.status::text;
  v_new_status := case p_action
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    when 'changes_requested' then 'changes_requested'
    when 'exception_approved' then 'approved'
    when 'exception_rejected' then 'rejected'
    when 'amount_change_requested' then 'changes_requested'
    when 'category_change_requested' then 'changes_requested'
    when 'budget_adjustment_requested' then 'changes_requested'
  end;

  insert into public.payment_request_approvals (
    payment_request_id, actor_profile_id, role_id, action, from_status,
    to_status, comments, approval_level, budget_decision_snapshot,
    budget_block_reason_snapshot, budget_result_snapshot
  ) values (
    p_payment_request_id, p_actor_profile_id, v_role_id, p_action,
    v_previous_status, v_new_status, v_clean_comments, v_approval_level,
    v_request.budget_decision, v_request.budget_block_reason, v_request.budget_result
  );

  update public.payment_requests
  set status = v_new_status::public.payment_request_status,
      exception_status = case
        when p_action = 'exception_approved' then 'approved'
        when p_action = 'exception_rejected' then 'rejected'
        when p_action in ('amount_change_requested','category_change_requested','budget_adjustment_requested') then 'changes_requested'
        else exception_status
      end,
      exception_action = case when v_is_exception then p_action else exception_action end,
      exception_reason = case when v_is_exception then v_clean_comments else exception_reason end,
      exception_approved_by = case when p_action = 'exception_approved' then p_actor_profile_id else exception_approved_by end,
      exception_approved_at = case when p_action = 'exception_approved' then now() else exception_approved_at end,
      requires_budget_adjustment = case when p_action = 'budget_adjustment_requested' then true else requires_budget_adjustment end,
      operational_comments = coalesce(v_clean_comments, operational_comments),
      updated_at = now()
  where id = p_payment_request_id;

  return jsonb_build_object(
    'payment_request_id', p_payment_request_id,
    'previous_status', v_previous_status,
    'new_status', v_new_status,
    'action', p_action,
    'actor_profile_id', p_actor_profile_id,
    'budget_decision', v_request.budget_decision,
    'is_exception', v_is_exception,
    'assignment_snapshot_override', v_uses_assignment_snapshot,
    'legacy_assignment_override', v_legacy_assignment_override,
    'message', 'decision_registered'
  );
end;
$function$;

comment on function public.decide_payment_request_internal(uuid, uuid, text, text) is
  'Shared decision core. Callers must authenticate and validate the supplied actor first. Not granted to any client role.';

revoke all on function public.decide_payment_request_internal(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;

-- Thin authenticated wrapper: identical external behaviour to the pre-split
-- decide_payment_request (session-bound actor), now delegating to the core.
create or replace function public.decide_payment_request(
  p_payment_request_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_comments text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current_profile_id uuid := public.current_profile_id();
begin
  if v_current_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_actor_profile_id is null or p_actor_profile_id <> v_current_profile_id then
    raise exception 'actor_profile_must_match_current_profile';
  end if;
  return public.decide_payment_request_internal(
    p_payment_request_id, p_actor_profile_id, p_action, p_comments
  );
end;
$function$;

-- Preserve the original grants on the public wrapper.
revoke all on function public.decide_payment_request(uuid, uuid, text, text) from public, anon;
grant execute on function public.decide_payment_request(uuid, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2) service_role guard (mirror of approval_batch_quick_require_service_role)
-- ---------------------------------------------------------------------
create or replace function public.payment_request_exception_quick_require_service_role()
returns void
language plpgsql
stable
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'service_role' then
    raise exception 'quick_approval_service_role_required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.payment_request_exception_quick_require_service_role()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) Snapshot hash: invalidates the token if amount / partida / exception
--    flags / status change after the email was sent.
-- ---------------------------------------------------------------------
create or replace function public.payment_request_exception_quick_snapshot(p_payment_request_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'payment_request_id', pr.id,
          'approver_id', pr.approver_id,
          'submitted_at', pr.submitted_at,
          'status', pr.status::text,
          'amount_requested', pr.amount_requested,
          'currency', coalesce(nullif(upper(btrim(pr.currency)), ''), 'MXN'),
          'budget_category_id', pr.budget_category_id,
          'is_extraordinary_adjustment', coalesce(pr.is_extraordinary_adjustment, false),
          'budget_decision', pr.budget_decision
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.payment_requests pr
  where pr.id = p_payment_request_id;
$$;

revoke all on function public.payment_request_exception_quick_snapshot(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4) One-time anti-replay ledger
-- ---------------------------------------------------------------------
create table public.payment_request_exception_quick_approval_uses (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_event_id uuid not null references public.notification_events(id),
  payment_request_id uuid not null references public.payment_requests(id),
  approver_profile_id uuid not null references public.profiles(id),
  token_jti_hash text not null,
  snapshot_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  outcome text not null,
  created_at timestamptz not null default now(),
  constraint pr_exception_quick_uses_event_uidx unique (notification_event_id),
  constraint pr_exception_quick_uses_jti_uidx unique (token_jti_hash),
  constraint pr_exception_quick_uses_jti_hash_check
    check (token_jti_hash ~ '^[0-9a-f]{64}$'),
  constraint pr_exception_quick_uses_snapshot_hash_check
    check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint pr_exception_quick_uses_outcome_check
    check (outcome in ('processing', 'approved')),
  constraint pr_exception_quick_uses_used_check
    check (
      (outcome = 'processing' and used_at is null)
      or (outcome = 'approved' and used_at is not null)
    )
);

comment on table public.payment_request_exception_quick_approval_uses is
  'One-time ledger for HMAC-bound payment-request exception approvals. Raw tokens are never stored.';

alter table public.payment_request_exception_quick_approval_uses enable row level security;
alter table public.payment_request_exception_quick_approval_uses force row level security;

revoke all on table public.payment_request_exception_quick_approval_uses
  from public, anon, authenticated;
grant all on table public.payment_request_exception_quick_approval_uses to service_role;

-- ---------------------------------------------------------------------
-- 5) Runtime config (vault secret + flag) — mirror of the weekly-cut one
-- ---------------------------------------------------------------------
create or replace function public.get_payment_request_exception_quick_approval_runtime_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
declare
  v_secret text;
  v_enabled text;
begin
  perform public.payment_request_exception_quick_require_service_role();

  select
    max(secret.decrypted_secret) filter (
      where secret.name = 'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_SECRET'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED'
    )
    into v_secret, v_enabled
  from vault.decrypted_secrets secret
  where secret.name in (
    'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_SECRET',
    'PAYMENT_REQUEST_EXCEPTION_QUICK_APPROVE_ENABLED'
  );

  return jsonb_build_object(
    'enabled', lower(coalesce(v_enabled, 'false')) = 'true',
    'secret', v_secret
  );
end;
$$;

revoke all on function public.get_payment_request_exception_quick_approval_runtime_config()
  from public, anon, authenticated;
grant execute on function public.get_payment_request_exception_quick_approval_runtime_config()
  to service_role;

-- ---------------------------------------------------------------------
-- 6) Token material (called by the dispatcher while the event is claimed)
-- ---------------------------------------------------------------------
create or replace function public.get_payment_request_exception_quick_approval_token_material(
  p_notification_event_id uuid,
  p_worker_id text,
  p_ttl_seconds integer default 259200
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_request public.payment_requests%rowtype;
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), 'edge-notification-dispatcher-dev'), 120);
  v_expires_at timestamptz;
  v_jti text;
begin
  perform public.payment_request_exception_quick_require_service_role();

  if p_ttl_seconds < 1 or p_ttl_seconds > 604800 then
    raise exception 'quick_approval_ttl_invalid';
  end if;

  select * into v_event
  from public.notification_events event
  where event.id = p_notification_event_id;

  if not found
     or v_event.event_type <> 'payment_request.created'
     or v_event.source_table <> 'payment_requests'
     or v_event.source_id is null
     or v_event.recipient_profile_id is null then
    raise exception 'quick_approval_event_invalid';
  end if;
  if v_event.status <> 'processing'
     or v_event.locked_by is distinct from v_worker_id then
    raise exception 'quick_approval_event_not_claimed';
  end if;

  select * into v_request
  from public.payment_requests pr
  where pr.id = v_event.source_id;

  if not found
     or v_request.status <> 'submitted'::public.payment_request_status
     or v_request.submitted_at is null then
    raise exception 'quick_approval_request_not_eligible';
  end if;

  -- Only budget exceptions are eligible for approve-from-email.
  if not (
    v_request.budget_decision = 'bloqueado'
    or coalesce(v_request.is_extraordinary_adjustment, false)
  ) then
    raise exception 'quick_approval_request_not_exception';
  end if;

  if v_request.approver_id is null
     or v_event.recipient_profile_id is distinct from v_request.approver_id then
    raise exception 'quick_approval_approver_drift';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = v_request.approver_id
      and coalesce(profile.active, true)
  ) or not public.is_payment_request_approver_for_company(v_request.approver_id, v_request.company_id) then
    raise exception 'quick_approval_approver_not_eligible';
  end if;

  v_expires_at := v_event.created_at + make_interval(secs => p_ttl_seconds);
  if v_expires_at <= now() then
    raise exception 'quick_approval_link_expired_before_send';
  end if;

  v_jti := encode(extensions.digest(
    convert_to(
      'payment-request-exception-quick-v1|' || v_event.id::text || '|' || v_request.id::text || '|'
      || v_request.approver_id::text || '|' || v_event.created_at::text,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  return jsonb_build_object(
    'version', 1,
    'notification_event_id', v_event.id,
    'payment_request_id', v_request.id,
    'approver_profile_id', v_request.approver_id,
    'submitted_at', v_request.submitted_at,
    'snapshot_hash', public.payment_request_exception_quick_snapshot(v_request.id),
    'expires_at', v_expires_at,
    'jti', v_jti
  );
end;
$$;

revoke all on function public.get_payment_request_exception_quick_approval_token_material(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_payment_request_exception_quick_approval_token_material(uuid, text, integer)
  to service_role;

-- ---------------------------------------------------------------------
-- 7) preview_payment_request_exception_quick
-- ---------------------------------------------------------------------
create or replace function public.preview_payment_request_exception_quick(
  p_notification_event_id uuid,
  p_payment_request_id uuid,
  p_approver_profile_id uuid,
  p_submitted_at timestamptz,
  p_snapshot_hash text,
  p_expires_at timestamptz,
  p_token_jti_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_request public.payment_requests%rowtype;
  v_current_snapshot text;
  v_used public.payment_request_exception_quick_approval_uses%rowtype;
  v_provider text;
  v_company text;
  v_cost_center text;
  v_budget_category text;
  v_requester text;
  v_is_exception boolean;
  v_review_url text := 'https://flux.quantta.mx/aprobaciones.html';
begin
  perform public.payment_request_exception_quick_require_service_role();

  if p_expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'expires_at', p_expires_at);
  end if;

  select * into v_event from public.notification_events where id = p_notification_event_id;
  if not found
     or v_event.event_type <> 'payment_request.created'
     or v_event.source_table <> 'payment_requests'
     or v_event.source_id is distinct from p_payment_request_id
     or v_event.recipient_profile_id is distinct from p_approver_profile_id
     or p_expires_at <= v_event.created_at
     or p_expires_at > v_event.created_at + interval '7 days' then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_request from public.payment_requests where id = p_payment_request_id;
  if not found or v_request.submitted_at is distinct from p_submitted_at then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_used
  from public.payment_request_exception_quick_approval_uses ledger
  where ledger.notification_event_id = p_notification_event_id
     or ledger.token_jti_hash = p_token_jti_hash
  limit 1;

  if found and v_used.notification_event_id = p_notification_event_id
     and v_used.token_jti_hash = p_token_jti_hash
     and v_used.outcome = 'approved' then
    return jsonb_build_object('state', 'already_approved', 'expires_at', p_expires_at, 'review_url', v_review_url);
  elsif found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_request.status = 'approved'::public.payment_request_status then
    return jsonb_build_object('state', 'already_approved', 'expires_at', p_expires_at, 'review_url', v_review_url);
  end if;
  if v_request.status <> 'submitted'::public.payment_request_status then
    return jsonb_build_object('state', 'changed');
  end if;

  v_is_exception := (
    v_request.budget_decision = 'bloqueado'
    or coalesce(v_request.is_extraordinary_adjustment, false)
  );
  if not v_is_exception then
    return jsonb_build_object('state', 'changed');
  end if;

  if v_request.approver_id is distinct from p_approver_profile_id
     or not exists (
       select 1 from public.profiles profile
       where profile.id = p_approver_profile_id and coalesce(profile.active, true)
     )
     or not public.is_payment_request_approver_for_company(p_approver_profile_id, v_request.company_id) then
    return jsonb_build_object('state', 'changed');
  end if;

  v_current_snapshot := public.payment_request_exception_quick_snapshot(p_payment_request_id);
  if v_current_snapshot is distinct from p_snapshot_hash then
    return jsonb_build_object('state', 'changed');
  end if;

  select coalesce(p.alias, p.nombre_completo) into v_provider
    from public.proveedores p where p.id = v_request.proveedor_id;
  select c.name into v_company from public.companies c where c.id = v_request.company_id;
  select cc.name into v_cost_center from public.cost_centers cc where cc.id = v_request.cost_center_id;
  select bc.name into v_budget_category from public.budget_categories bc where bc.id = v_request.budget_category_id;
  select rp.full_name into v_requester from public.profiles rp where rp.id = v_request.requested_by;

  return jsonb_build_object(
    'state', 'ready',
    'folio', v_request.request_number,
    'provider', v_provider,
    'company', v_company,
    'amount', v_request.amount_requested,
    'currency', coalesce(nullif(upper(btrim(v_request.currency)), ''), 'MXN'),
    'cost_center', v_cost_center,
    'budget_category', v_budget_category,
    'requester', v_requester,
    'budget_decision', v_request.budget_decision,
    'budget_shortfall', v_request.budget_shortfall,
    'is_extraordinary_adjustment', coalesce(v_request.is_extraordinary_adjustment, false),
    'block_reason', v_request.budget_block_reason,
    'expires_at', p_expires_at,
    'review_url', v_review_url
  );
end;
$$;

revoke all on function public.preview_payment_request_exception_quick(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.preview_payment_request_exception_quick(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 8) approve_payment_request_exception_quick
-- ---------------------------------------------------------------------
create or replace function public.approve_payment_request_exception_quick(
  p_notification_event_id uuid,
  p_payment_request_id uuid,
  p_approver_profile_id uuid,
  p_submitted_at timestamptz,
  p_snapshot_hash text,
  p_expires_at timestamptz,
  p_token_jti_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.notification_events%rowtype;
  v_request public.payment_requests%rowtype;
  v_current_snapshot text;
  v_used public.payment_request_exception_quick_approval_uses%rowtype;
  v_is_exception boolean;
  v_result jsonb;
  v_quick_comment constant text :=
    'Autorizacion de excepcion registrada via aprobacion rapida por correo (Direccion).';
begin
  perform public.payment_request_exception_quick_require_service_role();

  select * into v_event
  from public.notification_events
  where id = p_notification_event_id
  for update;

  if not found
     or v_event.event_type <> 'payment_request.created'
     or v_event.source_table <> 'payment_requests'
     or v_event.source_id is distinct from p_payment_request_id
     or v_event.recipient_profile_id is distinct from p_approver_profile_id
     or p_expires_at <= v_event.created_at
     or p_expires_at > v_event.created_at + interval '7 days' then
    return jsonb_build_object('state', 'invalid');
  end if;
  if p_expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'expires_at', p_expires_at);
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;

  if not found or v_request.submitted_at is distinct from p_submitted_at then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_used
  from public.payment_request_exception_quick_approval_uses ledger
  where ledger.notification_event_id = p_notification_event_id
     or ledger.token_jti_hash = p_token_jti_hash
  limit 1;

  if found and v_used.notification_event_id = p_notification_event_id
     and v_used.token_jti_hash = p_token_jti_hash
     and v_used.outcome = 'approved' then
    return jsonb_build_object('state', 'already_approved');
  elsif found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_request.status = 'approved'::public.payment_request_status then
    return jsonb_build_object('state', 'already_approved');
  end if;
  if v_request.status <> 'submitted'::public.payment_request_status then
    return jsonb_build_object('state', 'changed');
  end if;

  v_is_exception := (
    v_request.budget_decision = 'bloqueado'
    or coalesce(v_request.is_extraordinary_adjustment, false)
  );
  if not v_is_exception then
    return jsonb_build_object('state', 'changed');
  end if;

  if v_request.approver_id is distinct from p_approver_profile_id
     or not exists (
       select 1 from public.profiles profile
       where profile.id = p_approver_profile_id and coalesce(profile.active, true)
     )
     or not public.is_payment_request_approver_for_company(p_approver_profile_id, v_request.company_id) then
    return jsonb_build_object('state', 'changed');
  end if;

  v_current_snapshot := public.payment_request_exception_quick_snapshot(p_payment_request_id);
  if v_current_snapshot is distinct from p_snapshot_hash then
    return jsonb_build_object('state', 'changed');
  end if;

  insert into public.payment_request_exception_quick_approval_uses (
    notification_event_id, payment_request_id, approver_profile_id, token_jti_hash,
    snapshot_hash, expires_at, outcome
  ) values (
    p_notification_event_id, p_payment_request_id, p_approver_profile_id, p_token_jti_hash,
    p_snapshot_hash, p_expires_at, 'processing'
  );

  -- Apply the exception approval acting as the selected approver.
  -- exception_approved requires a non-null comment (see
  -- comments_required_for_exception_action inside the core).
  v_result := public.decide_payment_request_internal(
    p_payment_request_id, p_approver_profile_id, 'exception_approved', v_quick_comment
  );

  update public.payment_request_exception_quick_approval_uses
  set outcome = 'approved', used_at = now()
  where notification_event_id = p_notification_event_id;

  return jsonb_build_object(
    'state', 'approved',
    'payment_request_id', p_payment_request_id,
    'status', v_result->>'new_status'
  );
end;
$$;

revoke all on function public.approve_payment_request_exception_quick(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.approve_payment_request_exception_quick(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 9) Postcheck
-- ---------------------------------------------------------------------
do $postcheck$
begin
  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.payment_request_exception_quick_approval_uses'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'pr_exception_quick_rls_postcheck_failed'; end if;

  if has_table_privilege('anon', 'public.payment_request_exception_quick_approval_uses', 'select')
     or has_table_privilege('authenticated', 'public.payment_request_exception_quick_approval_uses', 'select')
     or has_function_privilege('anon', 'public.approve_payment_request_exception_quick(uuid,uuid,uuid,timestamptz,text,timestamptz,text)', 'execute')
     or has_function_privilege('authenticated', 'public.approve_payment_request_exception_quick(uuid,uuid,uuid,timestamptz,text,timestamptz,text)', 'execute')
     or has_function_privilege('anon', 'public.decide_payment_request_internal(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.decide_payment_request_internal(uuid,uuid,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.decide_payment_request_internal(uuid,uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.decide_payment_request(uuid,uuid,text,text)', 'execute') then
    raise exception 'pr_exception_quick_privilege_postcheck_failed';
  end if;
end;
$postcheck$;

-- Folded forward fix: effective PostgREST service_role guard.
-- Forward fix for PR #529: service-role calls made through PostgREST enter
-- SECURITY DEFINER functions with current_user set to the function owner, while
-- current_setting('role') preserves the effective API role. The original guard
-- checked only the legacy JWT claim/session_user paths and rejected legitimate
-- service_role traffic from the Edge Function.
--
-- Keep the helper itself private. Only the public preview/approve RPCs remain
-- executable by service_role; anon and authenticated keep no direct access.

create or replace function public.payment_request_exception_quick_require_service_role()
returns void
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if coalesce(current_setting('role', true), '') <> 'service_role'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and session_user <> 'service_role'
     and current_user <> 'service_role' then
    raise exception 'quick_approval_service_role_required' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function public.payment_request_exception_quick_require_service_role()
  from public, anon, authenticated, service_role;
