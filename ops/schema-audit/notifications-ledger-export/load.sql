-- Flux Operadora - notifications ledger export
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT de catalogos. No imprime filas de negocio y no modifica datos ni esquema.
-- Objetivo: obtener DDL real para construir supabase/migrations/007_notifications.sql sin inventar definiciones.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as exported_at,
  'source material for future 007_notifications.sql' as purpose;

-- 1) Presencia de tablas base reportadas por Carlos.
with expected_tables(table_schema, table_name) as (
  values
    ('public', 'notification_events'),
    ('public', 'notification_delivery_attempts')
)
select
  table_schema,
  table_name,
  to_regclass(format('%I.%I', table_schema, table_name)) is not null as exists_in_target
from expected_tables
order by table_schema, table_name;

-- 2) Columnas, tipos, defaults y nulabilidad. No lee filas de negocio.
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_schema,
  udt_name,
  is_nullable,
  column_default,
  character_maximum_length,
  numeric_precision,
  numeric_scale
from information_schema.columns
where table_schema = 'public'
  and table_name in ('notification_events', 'notification_delivery_attempts')
order by table_schema, table_name, ordinal_position;

-- 3) Tipos enum usados por columnas de notificaciones.
with notification_column_types as (
  select distinct a.atttypid
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('notification_events', 'notification_delivery_attempts')
    and a.attnum > 0
    and not a.attisdropped
)
select
  tn.nspname as type_schema,
  t.typname as type_name,
  e.enumsortorder,
  e.enumlabel
from notification_column_types nct
join pg_type t on t.oid = nct.atttypid
join pg_namespace tn on tn.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
order by tn.nspname, t.typname, e.enumsortorder;

-- 4) Constraints con definicion completa.
select
  ns.nspname as table_schema,
  cls.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  con.convalidated as validated,
  pg_get_constraintdef(con.oid, true) as constraint_definition
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relname in ('notification_events', 'notification_delivery_attempts')
order by ns.nspname, cls.relname, con.conname;

-- 5) Indices.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('notification_events', 'notification_delivery_attempts')
order by schemaname, tablename, indexname;

-- 6) RLS por tabla.
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('notification_events', 'notification_delivery_attempts')
  and c.relkind in ('r', 'p')
order by n.nspname, c.relname;

-- 7) Policies RLS.
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
  and tablename in ('notification_events', 'notification_delivery_attempts')
order by schemaname, tablename, policyname;

-- 8) Grants de tablas.
select
  table_schema,
  table_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('notification_events', 'notification_delivery_attempts')
order by table_schema, table_name, grantee, privilege_type;

-- 9) Triggers con definicion completa y funcion asociada.
select
  n.nspname as table_schema,
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as trigger_definition,
  pn.nspname as trigger_function_schema,
  p.proname as trigger_function_name,
  pg_get_function_identity_arguments(p.oid) as trigger_function_arguments,
  pg_get_functiondef(p.oid) as trigger_function_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid and p.prokind = 'f'
join pg_namespace pn on pn.oid = p.pronamespace
where not t.tgisinternal
  and n.nspname = 'public'
  and (
    c.relname in ('notification_events', 'notification_delivery_attempts')
    or t.tgname ilike '%notification%'
    or pg_get_triggerdef(t.oid, true) ilike '%notification%'
  )
order by n.nspname, c.relname, t.tgname;

-- 10) Funciones/RPCs de notificaciones. Incluye funciones nombradas notification/notify/delivery y funciones cuyo cuerpo toca las tablas.
with normal_public_functions as materialized (
  select
    n.nspname as function_schema,
    p.oid,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_get_function_result(p.oid) as result_type,
    l.lanname as language_name,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    p.proconfig as function_config,
    pg_get_functiondef(p.oid) as function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind = 'f'
)
select
  function_schema,
  function_name,
  identity_arguments,
  result_type,
  language_name,
  security_definer,
  volatility,
  function_config,
  function_definition
from normal_public_functions
where function_name ilike '%notification%'
  or function_name ilike '%notify%'
  or function_name ilike '%delivery%'
  or function_definition ilike '%notification_events%'
  or function_definition ilike '%notification_delivery_attempts%'
order by function_schema, function_name, identity_arguments;

-- 11) Grants de funciones relacionadas.
with normal_public_functions as materialized (
  select
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
), notification_function_names as (
  select distinct function_name
  from normal_public_functions
  where function_name ilike '%notification%'
    or function_name ilike '%notify%'
    or function_name ilike '%delivery%'
    or function_definition ilike '%notification_events%'
    or function_definition ilike '%notification_delivery_attempts%'
)
select
  routine_schema,
  routine_name,
  grantee,
  privilege_type,
  is_grantable
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (select function_name from notification_function_names)
order by routine_schema, routine_name, grantee, privilege_type;

-- 12) Dependencias directas de funciones contra tablas de notificaciones, si PostgreSQL las registra.
select
  pn.nspname as dependent_function_schema,
  p.proname as dependent_function_name,
  pg_get_function_identity_arguments(p.oid) as dependent_function_arguments,
  rn.nspname as referenced_schema,
  rc.relname as referenced_object,
  d.deptype
from pg_depend d
join pg_proc p on p.oid = d.objid and p.prokind = 'f'
join pg_namespace pn on pn.oid = p.pronamespace
join pg_class rc on rc.oid = d.refobjid
join pg_namespace rn on rn.oid = rc.relnamespace
where pn.nspname = 'public'
  and rn.nspname = 'public'
  and rc.relname in ('notification_events', 'notification_delivery_attempts')
order by pn.nspname, p.proname, referenced_object, d.deptype;

-- 13) Estimado de filas, sin leer datos.
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.reltuples::bigint as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('notification_events', 'notification_delivery_attempts')
  and c.relkind in ('r', 'p')
order by n.nspname, c.relname;

-- 14) Resumen para decidir si hay material suficiente para redactar 007_notifications.sql.
with table_counts as (
  select count(*) as table_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('notification_events', 'notification_delivery_attempts')
    and c.relkind in ('r', 'p')
), normal_public_functions as materialized (
  select
    p.proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
), function_counts as (
  select count(*) as function_count
  from normal_public_functions
  where function_name ilike '%notification%'
    or function_name ilike '%notify%'
    or function_name ilike '%delivery%'
    or function_definition ilike '%notification_events%'
    or function_definition ilike '%notification_delivery_attempts%'
), trigger_counts as (
  select count(*) as trigger_count
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and (
      c.relname in ('notification_events', 'notification_delivery_attempts')
      or t.tgname ilike '%notification%'
      or pg_get_triggerdef(t.oid, true) ilike '%notification%'
    )
), policy_counts as (
  select count(*) as policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('notification_events', 'notification_delivery_attempts')
)
select
  table_count,
  function_count,
  trigger_count,
  policy_count,
  case
    when table_count = 2 and function_count >= 8 and trigger_count >= 1 and policy_count >= 1
      then 'NOTIFICATIONS_LEDGER_EXPORT_READY_FOR_007_SOURCE'
    when table_count = 2
      then 'NOTIFICATIONS_LEDGER_EXPORT_INCOMPLETE_REVIEW_REQUIRED'
    else 'NOTIFICATIONS_TABLES_NOT_FOUND_IN_TARGET'
  end as result
from table_counts
cross join function_counts
cross join trigger_counts
cross join policy_counts;
