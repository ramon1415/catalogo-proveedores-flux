-- Flux Operadora - notifications ledger export precheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos ni esquema.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  now() as checked_at,
  'notifications ledger export for future 007_notifications.sql' as purpose;

with expected_tables(table_schema, table_name) as (
  values
    ('public', 'notification_events'),
    ('public', 'notification_delivery_attempts')
), table_presence as (
  select
    table_schema,
    table_name,
    to_regclass(format('%I.%I', table_schema, table_name)) is not null as exists_in_target
  from expected_tables
), function_inventory as (
  select count(*) as notification_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname ilike '%notification%'
      or pg_get_functiondef(p.oid) ilike '%notification_events%'
      or pg_get_functiondef(p.oid) ilike '%notification_delivery_attempts%'
    )
), trigger_inventory as (
  select count(*) as notification_trigger_count
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
), policy_inventory as (
  select count(*) as notification_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('notification_events', 'notification_delivery_attempts')
)
select
  tp.table_schema,
  tp.table_name,
  tp.exists_in_target,
  fi.notification_function_count,
  ti.notification_trigger_count,
  pi.notification_policy_count
from table_presence tp
cross join function_inventory fi
cross join trigger_inventory ti
cross join policy_inventory pi
order by tp.table_schema, tp.table_name;

select
  'NOTIFICATIONS_LEDGER_EXPORT_PRECHECK_READ_ONLY' as result,
  'No DDL/DML executed. If tables/functions/triggers are missing, stop and do not invent 007_notifications.sql.' as detail;
