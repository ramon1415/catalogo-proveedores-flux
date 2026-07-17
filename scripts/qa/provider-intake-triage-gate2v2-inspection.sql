\set ON_ERROR_STOP on

begin transaction read only;

with
crypto as (
  select
    e.extname,
    n.nspname as extension_schema,
    (
      select pn.nspname
      from pg_proc p
      join pg_namespace pn on pn.oid = p.pronamespace
      where p.proname = 'digest'
        and pg_get_function_identity_arguments(p.oid) = 'bytea, text'
      order by (pn.nspname = n.nspname) desc, pn.nspname
      limit 1
    ) as digest_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto'
),
rpcs as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute,
    exists (
      select 1
      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) as public_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('transition_provider_intake', 'add_provider_intake_note')
),
event_metadata as (
  select
    count(*) filter (where metadata ? 'action_id')::integer as with_action_id,
    count(*) filter (where metadata ? 'action_fingerprint')::integer as with_fingerprint,
    count(*) filter (
      where metadata ? 'action_id'
        and not metadata ? 'action_fingerprint'
    )::integer as legacy_without_fingerprint
  from public.payment_intake_events
),
event_constraints as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', c.conname,
      'type', c.contype,
      'definition', pg_get_constraintdef(c.oid)
    )
    order by c.conname
  ), '[]'::jsonb) as value
  from pg_constraint c
  where c.conrelid = 'public.payment_intake_events'::regclass
    and (
      c.contype = 'c'
      or pg_get_constraintdef(c.oid) ilike '%metadata%'
    )
),
append_only as (
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', t.tgname,
      'enabled', t.tgenabled,
      'definition', pg_get_triggerdef(t.oid)
    )
    order by t.tgname
  ), '[]'::jsonb) as value
  from pg_trigger t
  where t.tgrelid = 'public.payment_intake_events'::regclass
    and not t.tgisinternal
),
baseline as (
  select
    (select count(*)::integer from public.payment_intake) as intakes,
    (select count(*)::integer from public.payment_intake_events) as events,
    (select count(*)::integer from public.payment_intake_files) as files,
    (select count(*)::integer from storage.objects where bucket_id = 'intake-uploads') as storage_objects,
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
    (select count(*)::integer from public.profile_company_memberships) as memberships
),
migration_state as (
  select
    to_regclass('public._backup_029_payment_intake') is not null
      and to_regprocedure(
        'public.transition_provider_intake(uuid,text,timestamptz,text,text,uuid)'
      ) is not null
      and to_regprocedure(
        'public.add_provider_intake_note(uuid,timestamptz,text,uuid)'
      ) is not null as migration_029_applied,
    to_regprocedure(
      'public.provider_intake_action_fingerprint(integer,text,uuid,uuid,text,timestamptz,text,text)'
    ) is not null as migration_030_applied
)
select jsonb_pretty(jsonb_build_object(
  'gate', 'phase-1d-gate-2-v2-read-only-inspection',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'database_writes', false,
  'record_identifiers_emitted', false,
  'migration_029', jsonb_build_object(
    'applied', m.migration_029_applied
  ),
  'migration_030', jsonb_build_object(
    'applied', m.migration_030_applied
  ),
  'crypto', jsonb_build_object(
    'extension', c.extname,
    'extension_schema', c.extension_schema,
    'digest_schema', c.digest_schema
  ),
  'rpcs', (
    select jsonb_agg(to_jsonb(r) order by r.proname)
    from rpcs r
  ),
  'action_metadata_counts', to_jsonb(em),
  'event_constraints', ec.value,
  'append_only_triggers', ao.value,
  'action_id_unique_index_present', to_regclass(
    'public.payment_intake_events_action_id_uidx'
  ) is not null,
  'baseline', to_jsonb(b)
))
from crypto c
cross join event_metadata em
cross join event_constraints ec
cross join append_only ao
cross join baseline b
cross join migration_state m;

commit;
