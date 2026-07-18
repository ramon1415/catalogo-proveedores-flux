\set ON_ERROR_STOP on

begin transaction read only;

do $$
begin
  if to_regprocedure(
    'public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)'
  ) is null
     or to_regprocedure(
       'public.add_provider_intake_note(uuid,timestamptz,text,uuid)'
     ) is null
     or to_regclass('public.payment_intake_events_action_id_uidx') is null then
    raise exception '030_precheck: Migration 029 contract is incomplete';
  end if;

  if to_regprocedure(
    'public.provider_intake_action_fingerprint(integer,text,uuid,uuid,text,timestamptz,text,text)'
  ) is not null then
    raise exception '030_precheck: Migration 030 is already applied';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception '030_precheck: extensions.digest(bytea,text) is unavailable';
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
    raise exception '030_precheck: Migration 029 RPC signatures changed';
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
    raise exception '030_precheck: Migration 029 RPC grants changed';
  end if;

  if not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
      and t.tgenabled <> 'D'
  ) then
    raise exception '030_precheck: append-only trigger is inactive';
  end if;

  if (select count(*) from public.payment_intake) <> 13
     or (select count(*) from public.payment_intake_events) <> 20
     or (select count(*) from public.payment_intake_files) <> 6
     or (
       select count(*)
       from storage.objects
       where bucket_id = 'intake-uploads'
     ) <> 6 then
    raise exception '030_precheck: provider-intake baseline drifted';
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
),
baseline as (
  select
    (select count(*)::integer from public.payment_intake) as payment_intake,
    (select count(*)::integer from public.payment_intake_events) as payment_intake_events,
    (select count(*)::integer from public.payment_intake_files) as payment_intake_files,
    (
      select count(*)::integer
      from storage.objects
      where bucket_id = 'intake-uploads'
    ) as storage_private,
    (select count(*)::integer from public.payment_requests) as payment_requests,
    (select count(*)::integer from public.proveedores) as proveedores,
    (select count(*)::integer from public.providers) as providers,
    (select count(*)::integer from public.approval_batches) as approval_batches,
    (select count(*)::integer from public.payment_layouts) as payment_layouts,
    (select count(*)::integer from public.payment_layout_lines) as payment_layout_lines,
    (select count(*)::integer from public.cash_funds) as cash_funds,
    (select count(*)::integer from public.notification_events) as notification_events,
    (select count(*)::integer from public.intake_links) as intake_links,
    (select count(*)::integer from public.profiles) as profiles,
    (select count(*)::integer from public.user_roles) as user_roles,
    (
      select count(*)::integer
      from public.profile_company_memberships
    ) as memberships
)
select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-1d-migration-030-precheck',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'migration_029_applied', true,
  'migration_030_applied', false,
  'digest_schema', 'extensions',
  'rpc_signatures', 'PASS',
  'action_id_unique_index', 'PASS',
  'append_only', 'PASS',
  'grants', 'PASS',
  'action_metadata_counts', to_jsonb(a),
  'legacy_policy', 'fail_closed_no_rewrite',
  'baseline', to_jsonb(b),
  'record_identifiers_emitted', false,
  'database_writes', false
))
from action_metadata a
cross join baseline b;

commit;
