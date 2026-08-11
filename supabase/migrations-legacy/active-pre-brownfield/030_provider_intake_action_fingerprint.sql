-- Flux Operadora - Migration 030
-- Material idempotency for provider-intake transitions and internal notes.
-- This migration does not edit Migration 029, mutate intakes, or alter the audit ledger.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regprocedure(
    'public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)'
  ) is null then
    v_missing := array_append(v_missing, 'public.transition_provider_intake');
  end if;
  if to_regprocedure(
    'public.add_provider_intake_note(uuid,timestamptz,text,uuid)'
  ) is null then
    v_missing := array_append(v_missing, 'public.add_provider_intake_note');
  end if;
  if to_regclass('public.payment_intake_events_action_id_uidx') is null then
    v_missing := array_append(v_missing, 'public.payment_intake_events_action_id_uidx');
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    v_missing := array_append(v_missing, 'extensions.digest(bytea,text)');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception '030_precheck: missing required objects: %',
      array_to_string(v_missing, ', ');
  end if;

  if to_regprocedure(
    'public.provider_intake_action_fingerprint(integer,text,uuid,uuid,text,timestamptz,text,text)'
  ) is not null then
    raise exception '030_precheck: action fingerprint helper already exists';
  end if;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        (
          p.proname = 'transition_provider_intake'
          and pg_get_function_identity_arguments(p.oid) =
            'p_payment_intake_id uuid, p_expected_status text, p_expected_updated_at timestamp with time zone, p_to_status text, p_notes text, p_action_id uuid'
        )
        or (
          p.proname = 'add_provider_intake_note'
          and pg_get_function_identity_arguments(p.oid) =
            'p_payment_intake_id uuid, p_expected_updated_at timestamp with time zone, p_notes text, p_action_id uuid'
        )
      )
  ) <> 2 then
    raise exception '030_precheck: RPC signatures differ from Migration 029';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'transition_provider_intake',
        'add_provider_intake_note'
      )
      and (
        not p.prosecdef
        or p.provolatile <> 'v'
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting = 'search_path=public, pg_temp'
        )
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(
            coalesce(p.proacl, acldefault('f', p.proowner))
          ) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '030_precheck: RPC security contract differs from Migration 029';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '030_precheck: append-only event trigger is missing';
  end if;
end
$$;

create function public.provider_intake_action_fingerprint(
  p_contract_version integer,
  p_action_kind text,
  p_payment_intake_id uuid,
  p_actor_profile_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_to_status text,
  p_notes text
)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        jsonb_build_object(
          'actor_profile_id', p_actor_profile_id::text,
          'contract_version', p_contract_version,
          'expected_status', p_expected_status,
          'expected_updated_at', case
            when p_expected_updated_at is null then null
            else pg_catalog.to_char(
              p_expected_updated_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
            )
          end,
          'notes', p_notes,
          'operation', p_action_kind,
          'payment_intake_id', p_payment_intake_id::text,
          'to_status', p_to_status
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.transition_provider_intake(
  p_payment_intake_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_to_status text,
  p_notes text,
  p_action_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_actor_type text;
  v_intake public.payment_intake%rowtype;
  v_notes text;
  v_event_type text;
  v_action_fingerprint text;
  v_existing_event record;
begin
  if p_payment_intake_id is null
     or p_expected_status is null
     or p_expected_updated_at is null
     or p_to_status is null
     or p_action_id is null then
    raise exception 'provider_intake_transition_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  v_action_fingerprint := public.provider_intake_action_fingerprint(
    2,
    'transition',
    p_payment_intake_id,
    v_actor_profile_id,
    p_expected_status,
    p_expected_updated_at,
    p_to_status,
    v_notes
  );

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for update;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.id,
    pie.actor_profile_id,
    pie.metadata ->> 'action_fingerprint' as action_fingerprint,
    pie.metadata ->> 'action_kind' as action_kind,
    pie.metadata ->> 'contract_version' as contract_version
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'transition'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'public_folio', v_intake.public_folio,
      'status', v_intake.status,
      'updated_at', v_intake.updated_at,
      'idempotent', true
    );
  end if;

  if v_intake.status is distinct from p_expected_status
     or v_intake.updated_at is distinct from p_expected_updated_at then
    raise exception 'provider_intake_conflict';
  end if;

  if not (
    (v_intake.status = 'received' and p_to_status = 'in_review')
    or (v_intake.status = 'in_review' and p_to_status in ('needs_correction', 'rejected'))
    or (v_intake.status = 'needs_correction' and p_to_status in ('in_review', 'rejected'))
  ) then
    raise exception 'provider_intake_invalid_transition';
  end if;

  if p_to_status in ('needs_correction', 'rejected') then
    if v_notes is null or length(v_notes) < 10 or length(v_notes) > 2000 then
      raise exception 'provider_intake_comment_length';
    end if;
    if v_notes ~ '[[:cntrl:]]' or v_notes ~ '<[^>]*>' then
      raise exception 'provider_intake_comment_invalid';
    end if;
  elsif v_notes is not null then
    if length(v_notes) > 2000 or v_notes ~ '[[:cntrl:]]' or v_notes ~ '<[^>]*>' then
      raise exception 'provider_intake_comment_invalid';
    end if;
  end if;

  v_event_type := case p_to_status
    when 'needs_correction' then 'correction_requested'
    when 'rejected' then 'rejected'
    else 'status_changed'
  end;

  update public.payment_intake
     set status = p_to_status,
         triaged_by = coalesce(triaged_by, v_actor_profile_id),
         triaged_at = coalesce(triaged_at, now()),
         rejection_reason = case when p_to_status = 'rejected' then v_notes else null end,
         updated_at = now()
   where id = v_intake.id
     and status = p_expected_status
     and updated_at = p_expected_updated_at
  returning * into v_intake;

  if not found then
    raise exception 'provider_intake_conflict';
  end if;

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_profile_id,
    actor_type,
    from_status,
    to_status,
    notes,
    metadata
  ) values (
    v_intake.id,
    v_event_type,
    v_actor_profile_id,
    v_actor_type,
    p_expected_status,
    p_to_status,
    v_notes,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', 'transition',
      'contract_version', 2
    )
  );

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'public_folio', v_intake.public_folio,
    'status', v_intake.status,
    'updated_at', v_intake.updated_at,
    'idempotent', false
  );
exception
  when unique_violation then
    select
      pie.id,
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'transition'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;

    select *
      into v_intake
    from public.payment_intake
    where id = p_payment_intake_id;

    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'public_folio', v_intake.public_folio,
      'status', v_intake.status,
      'updated_at', v_intake.updated_at,
      'idempotent', true
    );
end
$$;

create or replace function public.add_provider_intake_note(
  p_payment_intake_id uuid,
  p_expected_updated_at timestamptz,
  p_notes text,
  p_action_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor jsonb;
  v_actor_profile_id uuid;
  v_actor_type text;
  v_intake public.payment_intake%rowtype;
  v_notes text;
  v_action_fingerprint text;
  v_event_id uuid;
  v_existing_event record;
begin
  if p_payment_intake_id is null
     or p_expected_updated_at is null
     or p_action_id is null then
    raise exception 'provider_intake_note_fields_required';
  end if;

  v_actor := public.provider_intake_actor_context();
  v_actor_profile_id := (v_actor ->> 'profile_id')::uuid;
  v_actor_type := v_actor ->> 'actor_type';
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  if v_notes is null or length(v_notes) < 3 or length(v_notes) > 2000 then
    raise exception 'provider_intake_note_length';
  end if;
  if v_notes ~ '[[:cntrl:]]' or v_notes ~ '<[^>]*>' then
    raise exception 'provider_intake_note_invalid';
  end if;

  v_action_fingerprint := public.provider_intake_action_fingerprint(
    2,
    'internal_note',
    p_payment_intake_id,
    v_actor_profile_id,
    null,
    p_expected_updated_at,
    null,
    v_notes
  );

  select *
    into v_intake
  from public.payment_intake
  where id = p_payment_intake_id
  for share;

  if not found then
    raise exception 'provider_intake_not_found';
  end if;

  perform public.provider_intake_assert_company_access(v_intake.company_id);

  select
    pie.id,
    pie.actor_profile_id,
    pie.metadata ->> 'action_fingerprint' as action_fingerprint,
    pie.metadata ->> 'action_kind' as action_kind,
    pie.metadata ->> 'contract_version' as contract_version
    into v_existing_event
  from public.payment_intake_events pie
  where pie.payment_intake_id = p_payment_intake_id
    and pie.metadata ->> 'action_id' = p_action_id::text
  limit 1;

  if found then
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'internal_note'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;
    return jsonb_build_object(
      'payment_intake_id', v_intake.id,
      'event_id', v_existing_event.id,
      'idempotent', true
    );
  end if;

  if v_intake.updated_at is distinct from p_expected_updated_at then
    raise exception 'provider_intake_conflict';
  end if;

  insert into public.payment_intake_events (
    payment_intake_id,
    event_type,
    actor_profile_id,
    actor_type,
    from_status,
    to_status,
    notes,
    metadata
  ) values (
    v_intake.id,
    'internal_note',
    v_actor_profile_id,
    v_actor_type,
    v_intake.status,
    v_intake.status,
    v_notes,
    jsonb_build_object(
      'action_id', p_action_id,
      'action_fingerprint', v_action_fingerprint,
      'action_kind', 'internal_note',
      'contract_version', 2
    )
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'payment_intake_id', v_intake.id,
    'event_id', v_event_id,
    'idempotent', false
  );
exception
  when unique_violation then
    select
      pie.id,
      pie.actor_profile_id,
      pie.metadata ->> 'action_fingerprint' as action_fingerprint,
      pie.metadata ->> 'action_kind' as action_kind,
      pie.metadata ->> 'contract_version' as contract_version
      into v_existing_event
    from public.payment_intake_events pie
    where pie.payment_intake_id = p_payment_intake_id
      and pie.metadata ->> 'action_id' = p_action_id::text
    limit 1;

    if not found then
      raise;
    end if;
    if v_existing_event.actor_profile_id is distinct from v_actor_profile_id then
      raise exception 'provider_intake_action_id_conflict';
    end if;
    if v_existing_event.action_fingerprint is null
       or v_existing_event.action_kind is null
       or v_existing_event.contract_version is null then
      raise exception 'provider_intake_action_id_legacy_conflict';
    end if;
    if v_existing_event.action_kind is distinct from 'internal_note'
       or v_existing_event.contract_version is distinct from '2'
       or v_existing_event.action_fingerprint is distinct from v_action_fingerprint then
      raise exception 'provider_intake_action_id_material_conflict';
    end if;

    return jsonb_build_object(
      'payment_intake_id', p_payment_intake_id,
      'event_id', v_existing_event.id,
      'idempotent', true
    );
end
$$;

revoke all on function public.provider_intake_action_fingerprint(
  integer, text, uuid, uuid, text, timestamptz, text, text
)
  from public, anon, authenticated, service_role;
revoke all on function public.transition_provider_intake(
  uuid, text, timestamptz, text, text, uuid
)
  from public, anon, authenticated, service_role;
revoke all on function public.add_provider_intake_note(
  uuid, timestamptz, text, uuid
)
  from public, anon, authenticated, service_role;

grant execute on function public.transition_provider_intake(
  uuid, text, timestamptz, text, text, uuid
)
  to authenticated;
grant execute on function public.add_provider_intake_note(
  uuid, timestamptz, text, uuid
)
  to authenticated;

comment on function public.provider_intake_action_fingerprint(
  integer, text, uuid, uuid, text, timestamptz, text, text
) is
  'Internal SHA-256 fingerprint over canonical provider-intake action material. It stores no source payload and has no application-role grant.';
comment on function public.transition_provider_intake(
  uuid, text, timestamptz, text, text, uuid
) is
  'Allowlisted optimistic transition with one append-only event and contract-v2 material idempotency. Conversion remains unsupported.';
comment on function public.add_provider_intake_note(
  uuid, timestamptz, text, uuid
) is
  'Append-only internal note with contract-v2 material idempotency; it never edits submitted payload or status.';

do $$
declare
  v_fingerprint text;
begin
  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        (
          p.proname = 'transition_provider_intake'
          and pg_get_function_identity_arguments(p.oid) =
            'p_payment_intake_id uuid, p_expected_status text, p_expected_updated_at timestamp with time zone, p_to_status text, p_notes text, p_action_id uuid'
        )
        or (
          p.proname = 'add_provider_intake_note'
          and pg_get_function_identity_arguments(p.oid) =
            'p_payment_intake_id uuid, p_expected_updated_at timestamp with time zone, p_notes text, p_action_id uuid'
        )
      )
      and pg_get_function_result(p.oid) = 'jsonb'
      and p.prosecdef
      and p.provolatile = 'v'
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
  ) <> 2 then
    raise exception '030_postcheck: RPC signatures or security attributes changed';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'transition_provider_intake',
        'add_provider_intake_note'
      )
      and (
        has_function_privilege('anon', p.oid, 'EXECUTE')
        or not has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
        or exists (
          select 1
          from aclexplode(
            coalesce(p.proacl, acldefault('f', p.proowner))
          ) privilege
          where privilege.grantee = 0
            and privilege.privilege_type = 'EXECUTE'
        )
      )
  ) then
    raise exception '030_postcheck: RPC grants changed';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.proname = 'provider_intake_action_fingerprint'
      and pg_get_function_identity_arguments(p.oid) =
        'p_contract_version integer, p_action_kind text, p_payment_intake_id uuid, p_actor_profile_id uuid, p_expected_status text, p_expected_updated_at timestamp with time zone, p_to_status text, p_notes text'
      and pg_get_function_result(p.oid) = 'text'
      and l.lanname = 'sql'
      and not p.prosecdef
      and p.provolatile = 's'
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(
          coalesce(p.proacl, acldefault('f', p.proowner))
        ) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
  ) then
    raise exception '030_postcheck: fingerprint helper contract is unsafe';
  end if;

  v_fingerprint := public.provider_intake_action_fingerprint(
    2,
    'transition',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'received',
    '2026-01-01T12:34:56.123456Z'::timestamptz,
    'in_review',
    null
  );
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception '030_postcheck: fingerprint is not lowercase SHA-256 hex';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'payment_intake_events_action_id_uidx'
  ) then
    raise exception '030_postcheck: action ID unique index is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '030_postcheck: append-only event trigger is missing';
  end if;
end
$$;

commit;
