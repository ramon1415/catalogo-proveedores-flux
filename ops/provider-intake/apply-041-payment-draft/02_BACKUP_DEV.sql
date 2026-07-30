\set ON_ERROR_STOP on

begin transaction read only;

with source_functions as (
  select
    p.proname,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,
    pg_get_functiondef(p.oid) as definition,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    p.proacl,
    obj_description(p.oid, 'pg_proc') as comment
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'provider_intake_actor_context',
      'provider_intake_assert_company_access',
      'provider_intake_mask_value',
      'list_payment_request_approver_options',
      'payment_request_has_active_approver_pool',
      'payment_request_rule_allows'
    )
),
draft_metadata as (
  select jsonb_build_object(
    'present', to_regclass('public.payment_intake_conversion_drafts') is not null,
    'columns', case
      when to_regclass('public.payment_intake_conversion_drafts') is null then '[]'::jsonb
      else (
        select jsonb_agg(jsonb_build_object(
          'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull
        ) order by a.attnum)
        from pg_attribute a
        where a.attrelid = to_regclass('public.payment_intake_conversion_drafts')
          and a.attnum > 0
          and not a.attisdropped
      )
    end,
    'rls_enabled', case
      when to_regclass('public.payment_intake_conversion_drafts') is null then null
      else (
        select c.relrowsecurity
        from pg_class c
        where c.oid = to_regclass('public.payment_intake_conversion_drafts')
      )
    end
  ) as snapshot
)
select jsonb_pretty(jsonb_build_object(
  'backup', 'provider-intake-migration-041-pre-apply',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'source_functions', (
    select jsonb_agg(to_jsonb(f) order by f.proname)
    from source_functions f
  ),
  'draft_metadata', (select snapshot from draft_metadata),
  'event_constraint', (
    select pg_get_constraintdef(c.oid)
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
  ),
  'event_grants', (
    select jsonb_agg(to_jsonb(g) order by g.grantee, g.privilege_type)
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = 'payment_intake_events'
  ),
  'event_rls', (
    select jsonb_build_object(
      'enabled', c.relrowsecurity,
      'forced', c.relforcerowsecurity
    )
    from pg_class c
    where c.oid = 'public.payment_intake_events'::regclass
  ),
  'event_policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.polname,
      'command', p.polcmd,
      'roles', p.polroles
    ) order by p.polname), '[]'::jsonb)
    from pg_policy p
    where p.polrelid = 'public.payment_intake_events'::regclass
  ),
  'append_only_trigger', (
    select pg_get_triggerdef(t.oid)
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
  ),
  'business_counts', jsonb_build_object(
    'payment_intake', (select count(*) from public.payment_intake),
    'payment_intake_events', (select count(*) from public.payment_intake_events),
    'payment_requests', (select count(*) from public.payment_requests),
    'proveedores', (select count(*) from public.proveedores),
    'approval_batches', (select count(*) from public.approval_batches),
    'notification_events', (select count(*) from public.notification_events)
  ),
  'contains_record_data', false,
  'database_writes', false
));

commit;
