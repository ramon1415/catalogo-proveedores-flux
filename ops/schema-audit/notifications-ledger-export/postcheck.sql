-- Flux Operadora - notifications ledger export postcheck
-- Ambiente esperado: DEV / scsirgbuqjcwoaxfacth.supabase.co
-- Seguridad: solo SELECT. No modifica datos ni esquema.

with table_counts as (
  select count(*) as table_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('notification_events', 'notification_delivery_attempts')
    and c.relkind in ('r', 'p')
), function_counts as (
  select count(*) as function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (
      p.proname ilike '%notification%'
      or pg_get_functiondef(p.oid) ilike '%notification_events%'
      or pg_get_functiondef(p.oid) ilike '%notification_delivery_attempts%'
    )
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
), rls_counts as (
  select
    count(*) filter (where c.relrowsecurity) as rls_enabled_table_count,
    count(*) as notification_table_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('notification_events', 'notification_delivery_attempts')
    and c.relkind in ('r', 'p')
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
  rls_enabled_table_count,
  policy_count,
  case
    when table_count = 2 and function_count >= 8 and trigger_count >= 1 and rls_enabled_table_count = 2 and policy_count >= 1
      then 'NOTIFICATIONS_LEDGER_EXPORT_READY_FOR_007_SOURCE'
    when table_count = 2
      then 'NOTIFICATIONS_LEDGER_EXPORT_INCOMPLETE_REVIEW_REQUIRED'
    else 'NOTIFICATIONS_TABLES_NOT_FOUND_IN_TARGET'
  end as result,
  'Use the load.sql evidence to create 007_notifications.sql in a separate reviewed PR. Do not infer missing objects.' as next_step
from table_counts
cross join function_counts
cross join trigger_counts
cross join rls_counts
cross join policy_counts;
