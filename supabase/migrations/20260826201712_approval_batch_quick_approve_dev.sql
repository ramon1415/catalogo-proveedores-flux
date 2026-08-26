set lock_timeout = '5s';
set statement_timeout = '60s';

create table public.approval_batch_quick_approval_uses (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_event_id uuid not null references public.notification_events(id),
  batch_id uuid not null references public.approval_batches(id),
  director_id uuid not null references public.profiles(id),
  token_jti_hash text not null,
  snapshot_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  outcome text not null,
  created_at timestamptz not null default now(),
  constraint approval_batch_quick_approval_uses_event_uidx unique (notification_event_id),
  constraint approval_batch_quick_approval_uses_jti_uidx unique (token_jti_hash),
  constraint approval_batch_quick_approval_uses_jti_hash_check
    check (token_jti_hash ~ '^[0-9a-f]{64}$'),
  constraint approval_batch_quick_approval_uses_snapshot_hash_check
    check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint approval_batch_quick_approval_uses_outcome_check
    check (outcome in ('processing', 'approved')),
  constraint approval_batch_quick_approval_uses_used_check
    check (
      (outcome = 'processing' and used_at is null)
      or (outcome = 'approved' and used_at is not null)
    )
);

comment on table public.approval_batch_quick_approval_uses is
  'One-time ledger for HMAC-bound weekly-cut approvals. Raw tokens are never stored.';

alter table public.approval_batch_quick_approval_uses enable row level security;
alter table public.approval_batch_quick_approval_uses force row level security;

revoke all on table public.approval_batch_quick_approval_uses
  from public, anon, authenticated;
grant all on table public.approval_batch_quick_approval_uses to service_role;

create or replace function public.approval_batch_quick_require_service_role()
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

revoke all on function public.approval_batch_quick_require_service_role()
  from public, anon, authenticated, service_role;

create or replace function public.approval_batch_quick_snapshot(p_batch_id uuid)
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
          'batch_id', batch.id,
          'director_id', batch.director_id,
          'submitted_at', batch.submitted_at,
          'status', batch.status,
          'items', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'item_id', item.id,
                'payment_request_id', item.payment_request_id,
                'director_status', item.director_status,
                'amount', request.amount_requested,
                'currency', coalesce(nullif(upper(btrim(request.currency)), ''), 'MXN')
              ) order by item.id
            )
            from public.approval_batch_items item
            join public.payment_requests request on request.id = item.payment_request_id
            where item.batch_id = batch.id
              and item.removed_at is null
          ), '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.approval_batches batch
  where batch.id = p_batch_id;
$$;

revoke all on function public.approval_batch_quick_snapshot(uuid)
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

  if v_count = 0 then
    raise exception 'batch_has_no_pending_items';
  end if;

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
    'rejected_items', v_rejected,
    'approval_model', 'single_direction'
  );
end;
$$;

comment on function public.approve_entire_batch_internal(uuid, uuid) is
  'Shared approval core. Callers must authenticate and validate the supplied actor first.';

revoke all on function public.approve_entire_batch_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.approve_entire_batch(p_batch_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.approval_batch_require_active_direction();
  return public.approve_entire_batch_internal(p_batch_id, v_actor);
end;
$$;

comment on function public.approve_entire_batch(uuid) is
  'Allows only the active Direction profile stored on the batch to approve it; future-pool membership is intentionally ignored.';

revoke all on function public.approve_entire_batch(uuid) from public, anon;
grant execute on function public.approve_entire_batch(uuid) to authenticated;
revoke all on function public.approve_entire_batch(uuid) from service_role;

create or replace function public.get_approval_batch_quick_approval_runtime_config()
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
  perform public.approval_batch_quick_require_service_role();

  select
    max(secret.decrypted_secret) filter (
      where secret.name = 'APPROVAL_BATCH_QUICK_APPROVE_SECRET'
    ),
    max(secret.decrypted_secret) filter (
      where secret.name = 'APPROVAL_BATCH_QUICK_APPROVE_ENABLED'
    )
    into v_secret, v_enabled
  from vault.decrypted_secrets secret
  where secret.name in (
    'APPROVAL_BATCH_QUICK_APPROVE_SECRET',
    'APPROVAL_BATCH_QUICK_APPROVE_ENABLED'
  );

  return jsonb_build_object(
    'enabled', lower(coalesce(v_enabled, 'false')) = 'true',
    'secret', v_secret
  );
end;
$$;

revoke all on function public.get_approval_batch_quick_approval_runtime_config()
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_quick_approval_runtime_config()
  to service_role;

create or replace function public.get_approval_batch_quick_approval_token_material(
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
  v_batch public.approval_batches%rowtype;
  v_item_count integer;
  v_non_pending_count integer;
  v_worker_id text := left(coalesce(nullif(btrim(p_worker_id), ''), 'edge-approval-batch-submitted-dev'), 120);
  v_expires_at timestamptz;
  v_jti text;
begin
  perform public.approval_batch_quick_require_service_role();

  if p_ttl_seconds < 1 or p_ttl_seconds > 604800 then
    raise exception 'quick_approval_ttl_invalid';
  end if;

  select * into v_event
  from public.notification_events event
  where event.id = p_notification_event_id;

  if not found
     or v_event.event_type <> 'approval_batch.submitted'
     or v_event.source_table <> 'approval_batches'
     or v_event.source_id is null then
    raise exception 'quick_approval_event_invalid';
  end if;
  if v_event.status <> 'processing'
     or v_event.locked_by is distinct from v_worker_id then
    raise exception 'quick_approval_event_not_claimed';
  end if;

  select * into v_batch
  from public.approval_batches batch
  where batch.id = v_event.source_id;

  if not found or v_batch.status <> 'submitted' or v_batch.submitted_at is null then
    raise exception 'quick_approval_batch_not_eligible';
  end if;
  if v_event.recipient_profile_id is distinct from v_batch.director_id then
    raise exception 'quick_approval_director_drift';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    join public.user_roles assignment on assignment.profile_id = profile.id
    join public.roles role on role.id = assignment.role_id
    where profile.id = v_batch.director_id
      and profile.active = true
      and role.name = any(public.approval_batch_direction_roles())
  ) then
    raise exception 'quick_approval_director_not_eligible';
  end if;

  select count(*)::integer,
         count(*) filter (where item.director_status <> 'pending')::integer
    into v_item_count, v_non_pending_count
  from public.approval_batch_items item
  where item.batch_id = v_batch.id and item.removed_at is null;

  if v_item_count < 1 or v_non_pending_count > 0 then
    raise exception 'quick_approval_items_not_eligible';
  end if;

  v_expires_at := v_event.created_at + make_interval(secs => p_ttl_seconds);
  if v_expires_at <= now() then
    raise exception 'quick_approval_link_expired_before_send';
  end if;

  v_jti := encode(extensions.digest(
    convert_to(
      'approval-batch-quick-v1|' || v_event.id::text || '|' || v_batch.id::text || '|'
      || v_batch.director_id::text || '|' || v_event.created_at::text,
      'UTF8'
    ),
    'sha256'
  ), 'hex');

  return jsonb_build_object(
    'version', 1,
    'notification_event_id', v_event.id,
    'batch_id', v_batch.id,
    'director_id', v_batch.director_id,
    'submitted_at', v_batch.submitted_at,
    'snapshot_hash', public.approval_batch_quick_snapshot(v_batch.id),
    'expires_at', v_expires_at,
    'jti', v_jti
  );
end;
$$;

revoke all on function public.get_approval_batch_quick_approval_token_material(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_approval_batch_quick_approval_token_material(uuid, text, integer)
  to service_role;

create or replace function public.preview_approval_batch_quick_approval(
  p_notification_event_id uuid,
  p_batch_id uuid,
  p_director_id uuid,
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
  v_batch public.approval_batches%rowtype;
  v_company text;
  v_item_count integer;
  v_non_pending_count integer;
  v_current_snapshot text;
  v_used public.approval_batch_quick_approval_uses%rowtype;
begin
  perform public.approval_batch_quick_require_service_role();

  if p_expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'expires_at', p_expires_at);
  end if;

  select * into v_event from public.notification_events where id = p_notification_event_id;
  if not found
     or v_event.event_type <> 'approval_batch.submitted'
     or v_event.source_table <> 'approval_batches'
     or v_event.source_id is distinct from p_batch_id
     or v_event.recipient_profile_id is distinct from p_director_id
     or p_expires_at <= v_event.created_at
     or p_expires_at > v_event.created_at + interval '7 days' then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_batch from public.approval_batches where id = p_batch_id;
  if not found or v_batch.submitted_at is distinct from p_submitted_at then
    return jsonb_build_object('state', 'invalid');
  end if;

  select * into v_used
  from public.approval_batch_quick_approval_uses ledger
  where ledger.notification_event_id = p_notification_event_id
     or ledger.token_jti_hash = p_token_jti_hash
  limit 1;

  if found and v_used.notification_event_id = p_notification_event_id
     and v_used.token_jti_hash = p_token_jti_hash
     and v_used.outcome = 'approved' then
    return jsonb_build_object(
      'state', 'already_approved',
      'expires_at', p_expires_at,
      'review_url', 'https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/approval_batches.html?batch_id=' || p_batch_id::text
    );
  elsif found then
    return jsonb_build_object('state', 'invalid');
  end if;

  if v_batch.status = 'approved' then
    return jsonb_build_object(
      'state', 'already_approved',
      'expires_at', p_expires_at,
      'review_url', 'https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/approval_batches.html?batch_id=' || p_batch_id::text
    );
  end if;
  if v_batch.status <> 'submitted' then
    return jsonb_build_object('state', 'changed');
  end if;
  if v_batch.director_id is distinct from p_director_id
     or not exists (
       select 1
       from public.profiles profile
       join public.user_roles assignment on assignment.profile_id = profile.id
       join public.roles role on role.id = assignment.role_id
       where profile.id = p_director_id
         and profile.active = true
         and role.name = any(public.approval_batch_direction_roles())
     ) then
    return jsonb_build_object('state', 'changed');
  end if;

  select count(*)::integer,
         count(*) filter (where item.director_status <> 'pending')::integer
    into v_item_count, v_non_pending_count
  from public.approval_batch_items item
  where item.batch_id = p_batch_id and item.removed_at is null;

  if v_item_count < 1 then return jsonb_build_object('state', 'changed'); end if;
  if v_non_pending_count > 0 then
    return jsonb_build_object('state', 'decisions_recorded');
  end if;

  v_current_snapshot := public.approval_batch_quick_snapshot(p_batch_id);
  if v_current_snapshot is distinct from p_snapshot_hash then
    return jsonb_build_object('state', 'changed');
  end if;

  select coalesce(nullif(btrim(company.legal_name), ''), company.name)
    into v_company
  from public.companies company
  where company.id = v_batch.company_id;

  return jsonb_build_object(
    'state', 'ready',
    'label', v_batch.label,
    'company', v_company,
    'period_start', v_batch.period_start,
    'period_end', v_batch.period_end,
    'item_count', v_item_count,
    'totals_by_currency', coalesce(public.approval_batch_totals_by_currency(p_batch_id), '[]'::jsonb),
    'expires_at', p_expires_at,
    'review_url', 'https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/approval_batches.html?batch_id=' || p_batch_id::text
  );
end;
$$;

revoke all on function public.preview_approval_batch_quick_approval(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.preview_approval_batch_quick_approval(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  to service_role;

create or replace function public.approve_approval_batch_quick(
  p_notification_event_id uuid,
  p_batch_id uuid,
  p_director_id uuid,
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
  v_batch public.approval_batches%rowtype;
  v_item_count integer;
  v_non_pending_count integer;
  v_current_snapshot text;
  v_used public.approval_batch_quick_approval_uses%rowtype;
  v_result jsonb;
begin
  perform public.approval_batch_quick_require_service_role();

  select * into v_event
  from public.notification_events
  where id = p_notification_event_id
  for update;

  if not found
     or v_event.event_type <> 'approval_batch.submitted'
     or v_event.source_table <> 'approval_batches'
     or v_event.source_id is distinct from p_batch_id
     or v_event.recipient_profile_id is distinct from p_director_id
     or p_expires_at <= v_event.created_at
     or p_expires_at > v_event.created_at + interval '7 days' then
    return jsonb_build_object('state', 'invalid');
  end if;
  if p_expires_at <= now() then
    return jsonb_build_object('state', 'expired', 'expires_at', p_expires_at);
  end if;

  select * into v_batch
  from public.approval_batches
  where id = p_batch_id
  for update;

  if not found or v_batch.submitted_at is distinct from p_submitted_at then
    return jsonb_build_object('state', 'invalid');
  end if;

  perform 1
  from public.approval_batch_items item
  join public.payment_requests request on request.id = item.payment_request_id
  where item.batch_id = p_batch_id and item.removed_at is null
  for update of item, request;

  select * into v_used
  from public.approval_batch_quick_approval_uses ledger
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

  if v_batch.status = 'approved' then
    return jsonb_build_object('state', 'already_approved');
  end if;
  if v_batch.status <> 'submitted' then
    return jsonb_build_object('state', 'changed');
  end if;
  if v_batch.director_id is distinct from p_director_id
     or not exists (
       select 1
       from public.profiles profile
       join public.user_roles assignment on assignment.profile_id = profile.id
       join public.roles role on role.id = assignment.role_id
       where profile.id = p_director_id
         and profile.active = true
         and role.name = any(public.approval_batch_direction_roles())
     ) then
    return jsonb_build_object('state', 'changed');
  end if;

  select count(*)::integer,
         count(*) filter (where item.director_status <> 'pending')::integer
    into v_item_count, v_non_pending_count
  from public.approval_batch_items item
  where item.batch_id = p_batch_id and item.removed_at is null;

  if v_item_count < 1 then return jsonb_build_object('state', 'changed'); end if;
  if v_non_pending_count > 0 then
    return jsonb_build_object('state', 'decisions_recorded');
  end if;

  v_current_snapshot := public.approval_batch_quick_snapshot(p_batch_id);
  if v_current_snapshot is distinct from p_snapshot_hash then
    return jsonb_build_object('state', 'changed');
  end if;

  insert into public.approval_batch_quick_approval_uses (
    notification_event_id, batch_id, director_id, token_jti_hash,
    snapshot_hash, expires_at, outcome
  ) values (
    p_notification_event_id, p_batch_id, p_director_id, p_token_jti_hash,
    p_snapshot_hash, p_expires_at, 'processing'
  );

  v_result := public.approve_entire_batch_internal(p_batch_id, p_director_id);

  update public.approval_batch_quick_approval_uses
  set outcome = 'approved', used_at = now()
  where notification_event_id = p_notification_event_id;

  return jsonb_build_object(
    'state', 'approved',
    'batch_id', p_batch_id,
    'status', v_result->>'status',
    'approved_items', (v_result->>'approved_items')::integer
  );
end;
$$;

revoke all on function public.approve_approval_batch_quick(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.approve_approval_batch_quick(uuid, uuid, uuid, timestamptz, text, timestamptz, text)
  to service_role;

do $postcheck$
begin
  if not exists (
    select 1 from pg_class relation
    where relation.oid = 'public.approval_batch_quick_approval_uses'::regclass
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'quick_approval_rls_postcheck_failed'; end if;

  if has_table_privilege('anon', 'public.approval_batch_quick_approval_uses', 'select')
     or has_table_privilege('authenticated', 'public.approval_batch_quick_approval_uses', 'select')
     or has_function_privilege('anon', 'public.approve_approval_batch_quick(uuid,uuid,uuid,timestamptz,text,timestamptz,text)', 'execute')
     or has_function_privilege('authenticated', 'public.approve_approval_batch_quick(uuid,uuid,uuid,timestamptz,text,timestamptz,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.approve_entire_batch(uuid)', 'execute') then
    raise exception 'quick_approval_privilege_postcheck_failed';
  end if;
end;
$postcheck$;
