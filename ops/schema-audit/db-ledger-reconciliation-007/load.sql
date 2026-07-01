-- Flux Operadora - DB ledger reconciliation 007 metadata export
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No muestra filas de negocio; solo metadatos y estimados.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as exported_at;

-- Tablas y secuencias relevantes para reconciliacion.
with expected_objects(object_kind, object_schema, object_name) as (
  values
    ('sequence', 'public', 'payment_request_number_seq'),
    ('sequence', 'public', 'payment_layout_number_seq'),
    ('table', 'public', 'notification_events'),
    ('table', 'public', 'notification_delivery_attempts'),
    ('table', 'public', 'historical_actuals'),
    ('table', 'public', 'payment_receipts')
)
select
  object_kind,
  object_schema,
  object_name,
  to_regclass(format('%I.%I', object_schema, object_name)) is not null as exists_in_target
from expected_objects
order by object_kind, object_schema, object_name;

-- Columnas, defaults y nulabilidad. No lee datos de las tablas.
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
order by table_schema, table_name, ordinal_position;

-- Constraints y columnas asociadas.
select
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  kcu.ordinal_position
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_schema = tc.constraint_schema
 and kcu.constraint_name = tc.constraint_name
 and kcu.table_schema = tc.table_schema
 and kcu.table_name = tc.table_name
where tc.table_schema = 'public'
  and tc.table_name in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position;

-- Indices declarados.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
order by schemaname, tablename, indexname;

-- RLS por tabla.
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
  and c.relkind in ('r', 'p')
order by n.nspname, c.relname;

-- Policies RLS.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
order by schemaname, tablename, policyname;

-- Grants de tablas.
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
order by table_schema, table_name, grantee, privilege_type;

-- Secuencias existentes del ledger numerico.
select
  sequence_schema,
  sequence_name,
  data_type,
  start_value,
  minimum_value,
  maximum_value,
  increment
from information_schema.sequences
where sequence_schema = 'public'
  and sequence_name in ('payment_request_number_seq', 'payment_layout_number_seq')
order by sequence_schema, sequence_name;

-- Funciones de notificaciones. Extrae definicion para construir migracion posterior sin inventar firmas.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as result_type,
  l.lanname as language_name,
  p.prosecdef as security_definer,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
  and (
    p.proname in (
      'enqueue_notification_event',
      'claim_pending_notification_events',
      'mark_notification_processed',
      'mark_notification_failed'
    )
    or p.proname ilike '%notification%'
  )
order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid);

-- Grants de funciones relacionadas con notificaciones.
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name ilike '%notification%'
order by routine_schema, routine_name, grantee, privilege_type;

-- Triggers de tablas auditadas o relacionados con notificaciones.
select
  trigger_schema,
  trigger_name,
  event_object_schema,
  event_object_table,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and (
    event_object_table in (
      'notification_events',
      'notification_delivery_attempts',
      'historical_actuals',
      'payment_receipts'
    )
    or trigger_name ilike '%notification%'
    or action_statement ilike '%notification%'
  )
order by event_object_schema, event_object_table, trigger_name, event_manipulation;

-- Estimado de filas, sin leer datos de negocio.
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.reltuples::bigint as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'notification_events',
    'notification_delivery_attempts',
    'historical_actuals',
    'payment_receipts'
  )
  and c.relkind in ('r', 'p')
order by n.nspname, c.relname;

-- Resultado de bloqueo controlado: estos objetos requieren export real antes de migrar.
with presence as (
  select
    to_regclass('public.notification_events') is not null as has_notification_events,
    to_regclass('public.notification_delivery_attempts') is not null as has_notification_delivery_attempts,
    to_regclass('public.historical_actuals') is not null as has_historical_actuals,
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'payment_receipts'
        and column_name = 'notes'
    ) as payment_receipts_has_notes
)
select
  case
    when has_notification_events and has_notification_delivery_attempts
      then 'NOTIFICATIONS_BLOCKED_NEEDS_DB_INTROSPECTION'
    else 'NOTIFICATIONS_NOT_FOUND_OR_INCOMPLETE_IN_TARGET'
  end as notifications_result,
  case
    when has_historical_actuals
      then 'HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT'
    else 'HISTORICAL_ACTUALS_NOT_FOUND_IN_TARGET'
  end as historical_actuals_result,
  case
    when payment_receipts_has_notes
      then 'PR_134_PAYMENT_RECEIPTS_NOTES_COLUMN_EXISTS_IN_TARGET'
    else 'PR_134_PAYMENT_RECEIPTS_REVIEWED_NO_NOTES_COLUMN_FOUND_IN_TARGET'
  end as pr_134_payment_receipts_result
from presence;
