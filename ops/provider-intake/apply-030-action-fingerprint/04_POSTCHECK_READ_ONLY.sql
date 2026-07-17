\set ON_ERROR_STOP on

begin transaction read only;

do $$
declare
  v_base text;
  v_same text;
begin
  if to_regprocedure(
    'public.provider_intake_action_fingerprint(integer,text,uuid,uuid,text,timestamptz,text,text)'
  ) is null then
    raise exception '030_postcheck: helper is missing';
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
    select count(*)
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

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'provider_intake_action_fingerprint'
      and (
        p.prosecdef
        or p.provolatile <> 's'
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE')
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
    raise exception '030_postcheck: helper privileges are unsafe';
  end if;

  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'transition_provider_intake',
        'add_provider_intake_note'
      )
      and pg_get_functiondef(p.oid) like '%action_fingerprint%'
      and pg_get_functiondef(p.oid) like '%action_kind%'
      and pg_get_functiondef(p.oid) like '%contract_version%'
      and pg_get_functiondef(p.oid) like '%provider_intake_action_id_material_conflict%'
      and pg_get_functiondef(p.oid) like '%provider_intake_action_id_legacy_conflict%'
  ) <> 2 then
    raise exception '030_postcheck: material replay contract is incomplete';
  end if;

  v_base := public.provider_intake_action_fingerprint(
    2,
    'transition',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'received',
    '2026-01-01T12:34:56.123456Z'::timestamptz,
    'in_review',
    'nota'
  );
  v_same := public.provider_intake_action_fingerprint(
    2,
    'transition',
    '11111111-1111-4111-8111-111111111111'::uuid,
    '22222222-2222-4222-8222-222222222222'::uuid,
    'received',
    '2026-01-01T06:34:56.123456-06:00'::timestamptz,
    'in_review',
    'nota'
  );

  if v_base !~ '^[0-9a-f]{64}$' or v_base is distinct from v_same then
    raise exception '030_postcheck: SHA-256 or UTC normalization failed';
  end if;

  if v_base = public.provider_intake_action_fingerprint(
       2, 'transition',
       '11111111-1111-4111-8111-111111111111'::uuid,
       '22222222-2222-4222-8222-222222222222'::uuid,
       'in_review',
       '2026-01-01T12:34:56.123456Z'::timestamptz,
       'in_review',
       'nota'
     )
     or v_base = public.provider_intake_action_fingerprint(
       2, 'transition',
       '11111111-1111-4111-8111-111111111111'::uuid,
       '22222222-2222-4222-8222-222222222222'::uuid,
       'received',
       '2026-01-01T12:34:56.123457Z'::timestamptz,
       'in_review',
       'nota'
     )
     or v_base = public.provider_intake_action_fingerprint(
       2, 'transition',
       '11111111-1111-4111-8111-111111111111'::uuid,
       '22222222-2222-4222-8222-222222222222'::uuid,
       'received',
       '2026-01-01T12:34:56.123456Z'::timestamptz,
       'rejected',
       'nota'
     )
     or v_base = public.provider_intake_action_fingerprint(
       2, 'transition',
       '11111111-1111-4111-8111-111111111111'::uuid,
       '22222222-2222-4222-8222-222222222222'::uuid,
       'received',
       '2026-01-01T12:34:56.123456Z'::timestamptz,
       'in_review',
       'otra nota'
     )
     or v_base = public.provider_intake_action_fingerprint(
       2, 'internal_note',
       '11111111-1111-4111-8111-111111111111'::uuid,
       '22222222-2222-4222-8222-222222222222'::uuid,
       null,
       '2026-01-01T12:34:56.123456Z'::timestamptz,
       null,
       'nota'
     )
     or v_base = public.provider_intake_action_fingerprint(
       2, 'transition',
       '11111111-1111-4111-8111-111111111111'::uuid,
       '33333333-3333-4333-8333-333333333333'::uuid,
       'received',
       '2026-01-01T12:34:56.123456Z'::timestamptz,
       'in_review',
       'nota'
     ) then
    raise exception '030_postcheck: material change did not change fingerprint';
  end if;

  if (select count(*) from public.payment_intake) <> 13
     or (select count(*) from public.payment_intake_events) <> 20
     or (select count(*) from public.payment_intake_files) <> 6
     or (
       select count(*)
       from storage.objects
       where bucket_id = 'intake-uploads'
     ) <> 6 then
    raise exception '030_postcheck: business baseline drifted before UAT';
  end if;

  if to_regclass('public.payment_intake_events_action_id_uidx') is null then
    raise exception '030_postcheck: action ID unique index is missing';
  end if;
  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '030_postcheck: append-only trigger is inactive';
  end if;
end
$$;

with
action_metadata as (
  select
    count(*) filter (where metadata ? 'action_id')::integer as with_action_id,
    count(*) filter (
      where metadata ? 'action_fingerprint'
    )::integer as with_fingerprint,
    count(*) filter (
      where metadata ? 'action_id'
        and not metadata ? 'action_fingerprint'
    )::integer as legacy_without_fingerprint
  from public.payment_intake_events
)
select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-1d-migration-030-postcheck',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'helper', 'PASS',
  'rpc_replacements', 2,
  'signatures', 'PASS',
  'security_definer', 'PASS',
  'search_path', 'PASS',
  'grants', 'PASS',
  'metadata_v2', 'PASS',
  'sha256_lowercase_hex', 'PASS',
  'material_conflict', 'PASS',
  'action_id_unique_index', 'PASS',
  'append_only', 'PASS',
  'action_metadata_counts', to_jsonb(a),
  'pre_uat_business_delta', 0,
  'record_identifiers_emitted', false,
  'database_writes', false
))
from action_metadata a;

commit;
