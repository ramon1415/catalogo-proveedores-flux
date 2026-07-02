-- Flux Operadora - DEV ops precheck for migration 007 notifications ledger
-- Scope: validate Supabase DEV prerequisites before applying supabase/migrations/007_notifications.sql.
-- Safety: catalog checks only; does not modify operational data.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

do $$
declare
  missing_tables text[];
  missing_support_functions text[];
  incompatible_relations text[];
  missing_base_columns text[];
  missing_notification_columns text[];
  mismatched_notification_columns text[];
  dangerous_policy_count integer := 0;
begin
  if not exists (select 1 from pg_namespace where nspname = 'public') then
    raise exception 'PRECHECK_FAILED: schema public does not exist.';
  end if;

  select array_agg(object_name order by object_name)
  into missing_tables
  from (
    values
      ('public.profiles'),
      ('public.roles'),
      ('public.user_roles'),
      ('public.payment_requests')
  ) as required(object_name)
  where to_regclass(object_name) is null;

  if missing_tables is not null then
    raise exception 'PRECHECK_FAILED: missing required base tables: %.', array_to_string(missing_tables, ', ');
  end if;

  select array_agg(function_name order by function_name)
  into missing_support_functions
  from (
    values
      ('gen_random_uuid'),
      ('auth.uid'),
      ('auth.jwt')
  ) as required(function_name)
  where not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.pronargs = 0
      and (
        (required.function_name = 'gen_random_uuid' and p.proname = 'gen_random_uuid')
        or (required.function_name = 'auth.uid' and n.nspname = 'auth' and p.proname = 'uid')
        or (required.function_name = 'auth.jwt' and n.nspname = 'auth' and p.proname = 'jwt')
      )
  );

  if missing_support_functions is not null then
    raise exception 'PRECHECK_FAILED: missing required support functions: %.', array_to_string(missing_support_functions, ', ');
  end if;

  select array_agg(table_name || '.' || column_name order by table_name, column_name)
  into missing_base_columns
  from (
    values
      ('profiles', 'id'),
      ('profiles', 'auth_user_id'),
      ('profiles', 'email'),
      ('roles', 'id'),
      ('roles', 'name'),
      ('user_roles', 'profile_id'),
      ('user_roles', 'role_id'),
      ('payment_requests', 'id')
  ) as expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.table_name
      and c.column_name = expected.column_name
  );

  if missing_base_columns is not null then
    raise exception 'PRECHECK_FAILED: missing required base columns for notifications runtime: %.', array_to_string(missing_base_columns, ', ');
  end if;

  select array_agg(relname order by relname)
  into incompatible_relations
  from (
    values
      ('notification_events'),
      ('notification_delivery_attempts')
  ) as expected(relname)
  join pg_class c on c.oid = to_regclass(format('public.%I', expected.relname))
  where c.relkind not in ('r', 'p');

  if incompatible_relations is not null then
    raise exception 'PRECHECK_FAILED: notification object names exist but are not tables/partitioned tables: %.', array_to_string(incompatible_relations, ', ');
  end if;

  select array_agg(table_name || '.' || column_name order by table_name, column_name)
  into missing_notification_columns
  from (
    values
      ('notification_events', 'id', 'uuid'),
      ('notification_events', 'event_type', 'text'),
      ('notification_events', 'source_table', 'text'),
      ('notification_events', 'source_id', 'uuid'),
      ('notification_events', 'source_folio', 'text'),
      ('notification_events', 'recipient_type', 'text'),
      ('notification_events', 'recipient_profile_id', 'uuid'),
      ('notification_events', 'recipient_email', 'text'),
      ('notification_events', 'recipient_role', 'text'),
      ('notification_events', 'channel', 'text'),
      ('notification_events', 'priority', 'text'),
      ('notification_events', 'subject', 'text'),
      ('notification_events', 'payload', 'jsonb'),
      ('notification_events', 'idempotency_key', 'text'),
      ('notification_events', 'status', 'text'),
      ('notification_events', 'attempt_count', 'int4'),
      ('notification_events', 'max_attempts', 'int4'),
      ('notification_events', 'locked_at', 'timestamptz'),
      ('notification_events', 'locked_by', 'text'),
      ('notification_events', 'processed_at', 'timestamptz'),
      ('notification_events', 'last_error', 'text'),
      ('notification_events', 'last_attempt_at', 'timestamptz'),
      ('notification_events', 'next_attempt_at', 'timestamptz'),
      ('notification_events', 'created_at', 'timestamptz'),
      ('notification_events', 'updated_at', 'timestamptz'),
      ('notification_delivery_attempts', 'id', 'uuid'),
      ('notification_delivery_attempts', 'notification_event_id', 'uuid'),
      ('notification_delivery_attempts', 'attempt_number', 'int4'),
      ('notification_delivery_attempts', 'status', 'text'),
      ('notification_delivery_attempts', 'provider_message_id', 'text'),
      ('notification_delivery_attempts', 'error_message', 'text'),
      ('notification_delivery_attempts', 'n8n_execution_id', 'text'),
      ('notification_delivery_attempts', 'worker_id', 'text'),
      ('notification_delivery_attempts', 'created_at', 'timestamptz')
  ) as expected(table_name, column_name, udt_name)
  where to_regclass(format('public.%I', expected.table_name)) is not null
    and not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = expected.table_name
        and c.column_name = expected.column_name
    );

  if missing_notification_columns is not null then
    raise exception 'PRECHECK_FAILED: existing notification tables are partial and miss columns: %. Stop before applying 007.', array_to_string(missing_notification_columns, ', ');
  end if;

  select array_agg(expected.table_name || '.' || expected.column_name || ' expected ' || expected.udt_name || ' got ' || c.udt_name order by expected.table_name, expected.column_name)
  into mismatched_notification_columns
  from (
    values
      ('notification_events', 'id', 'uuid'),
      ('notification_events', 'event_type', 'text'),
      ('notification_events', 'source_table', 'text'),
      ('notification_events', 'source_id', 'uuid'),
      ('notification_events', 'source_folio', 'text'),
      ('notification_events', 'recipient_type', 'text'),
      ('notification_events', 'recipient_profile_id', 'uuid'),
      ('notification_events', 'recipient_email', 'text'),
      ('notification_events', 'recipient_role', 'text'),
      ('notification_events', 'channel', 'text'),
      ('notification_events', 'priority', 'text'),
      ('notification_events', 'subject', 'text'),
      ('notification_events', 'payload', 'jsonb'),
      ('notification_events', 'idempotency_key', 'text'),
      ('notification_events', 'status', 'text'),
      ('notification_events', 'attempt_count', 'int4'),
      ('notification_events', 'max_attempts', 'int4'),
      ('notification_events', 'locked_at', 'timestamptz'),
      ('notification_events', 'locked_by', 'text'),
      ('notification_events', 'processed_at', 'timestamptz'),
      ('notification_events', 'last_error', 'text'),
      ('notification_events', 'last_attempt_at', 'timestamptz'),
      ('notification_events', 'next_attempt_at', 'timestamptz'),
      ('notification_events', 'created_at', 'timestamptz'),
      ('notification_events', 'updated_at', 'timestamptz'),
      ('notification_delivery_attempts', 'id', 'uuid'),
      ('notification_delivery_attempts', 'notification_event_id', 'uuid'),
      ('notification_delivery_attempts', 'attempt_number', 'int4'),
      ('notification_delivery_attempts', 'status', 'text'),
      ('notification_delivery_attempts', 'provider_message_id', 'text'),
      ('notification_delivery_attempts', 'error_message', 'text'),
      ('notification_delivery_attempts', 'n8n_execution_id', 'text'),
      ('notification_delivery_attempts', 'worker_id', 'text'),
      ('notification_delivery_attempts', 'created_at', 'timestamptz')
  ) as expected(table_name, column_name, udt_name)
  join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = expected.table_name
   and c.column_name = expected.column_name
  where to_regclass(format('public.%I', expected.table_name)) is not null
    and c.udt_name <> expected.udt_name;

  if mismatched_notification_columns is not null then
    raise exception 'PRECHECK_FAILED: existing notification columns have incompatible types: %. Stop before applying 007.', array_to_string(mismatched_notification_columns, ', ');
  end if;

  select count(*)
  into dangerous_policy_count
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('notification_events', 'notification_delivery_attempts')
    and (
      array_position(pol.polroles, 0::oid) is not null
      or exists (
        select 1
        from unnest(pol.polroles) as pr(role_oid)
        join pg_roles r on r.oid = pr.role_oid
        where r.rolname = 'anon'
      )
    );

  if dangerous_policy_count > 0 then
    raise exception 'PRECHECK_FAILED: notification tables have PUBLIC/anon policies before 007. Review before applying.';
  end if;
end $$;

select
  c.relname as notification_table,
  c.relkind,
  c.relrowsecurity as rls_active,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('notification_events', 'notification_delivery_attempts')
order by c.relname;

select
  p.proname as notification_function,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prokind,
  p.prosecdef as security_definer,
  p.proconfig as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_pending_notification_events',
    'enqueue_notification_event',
    'enqueue_notification_event_internal',
    'mark_notification_failed',
    'mark_notification_processed',
    'notification_current_profile_id',
    'notification_current_user_has_role',
    'set_updated_at_notification_events'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

select
  c.relname as table_name,
  pol.polname as policy_name,
  case pol.polcmd
    when 'r' then 'select'
    when 'a' then 'insert'
    when 'w' then 'update'
    when 'd' then 'delete'
    when '*' then 'all'
    else pol.polcmd::text
  end as command,
  array_agg(coalesce(r.rolname, case when pr.role_oid = 0::oid then 'public' else pr.role_oid::text end) order by coalesce(r.rolname, case when pr.role_oid = 0::oid then 'public' else pr.role_oid::text end)) as roles
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
left join lateral unnest(pol.polroles) as pr(role_oid) on true
left join pg_roles r on r.oid = pr.role_oid
where n.nspname = 'public'
  and c.relname in ('notification_events', 'notification_delivery_attempts')
group by c.relname, pol.oid, pol.polname, pol.polcmd
order by c.relname, pol.polname;

select
  'NOTIFICATIONS_007_PRECHECK_OK' as result,
  'Prerequisites validated. load.sql can apply 007_notifications.sql in DEV only.' as detail;