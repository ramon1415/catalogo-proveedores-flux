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
    obj_description(p.oid, 'pg_proc') as comment
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'provider_intake_actor_context',
      'provider_intake_assert_company_access',
      'provider_intake_mask_value',
      'provider_intake_action_fingerprint'
    )
)
select jsonb_pretty(jsonb_build_object(
  'backup', 'provider-intake-migration-031-pre-apply',
  'environment', 'DEV',
  'project_ref', 'scsirgbuqjcwoaxfacth',
  'source_functions', (
    select jsonb_agg(to_jsonb(f) order by f.proname)
    from source_functions f
  ),
  'matched_proveedor_column', (
    select jsonb_build_object(
      'type', format_type(a.atttypid, a.atttypmod),
      'nullable', not a.attnotnull
    )
    from pg_attribute a
    where a.attrelid = 'public.payment_intake'::regclass
      and a.attname = 'matched_proveedor_id'
      and not a.attisdropped
  ),
  'event_constraint', (
    select pg_get_constraintdef(c.oid)
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
  ),
  'append_only_trigger', (
    select pg_get_triggerdef(t.oid)
    from pg_trigger t
    where t.tgrelid = 'public.payment_intake_events'::regclass
      and t.tgname = 'payment_intake_events_immutable'
  ),
  'business_counts', jsonb_build_object(
    'payment_intake', (select count(*) from public.payment_intake),
    'matched_intakes', (
      select count(*) from public.payment_intake where matched_proveedor_id is not null
    ),
    'payment_intake_events', (select count(*) from public.payment_intake_events),
    'proveedores', (select count(*) from public.proveedores),
    'payment_requests', (select count(*) from public.payment_requests),
    'approval_batches', (select count(*) from public.approval_batches)
  ),
  'contains_record_data', false,
  'database_writes', false
));

commit;

