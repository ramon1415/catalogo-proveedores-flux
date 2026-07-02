-- Flux Operadora - DEV ops postcheck for migration 007 notifications ledger
-- Scope: validate the result of applying supabase/migrations/007_notifications.sql.
-- Safety: catalog checks only; does not execute notification runtime functions or n8n flows.

select
  'DEV' as expected_environment,
  'scsirgbuqjcwoaxfacth.supabase.co' as expected_supabase_host,
  current_database() as database_name,
  now() as checked_at;

do $$
declare
  missing_tables text[];
  missing_columns text[];
  missing_functions text[];
  non_normal_functions text[];
  rls_missing text[];
  missing_policies text[];
  protected_execute_grants text[];
  missing_authenticated_execute text[];
  missing_service_execute text[];
  missing_table_grants text[];
  anon_table_grants text[];
  dangerous_policy_count integer := 0;
  trigger_exists boolean := false;
begin
  select array_agg(object_name order by object_name)
  into missing_tables
  from (
    values
      ('public.notification_events'),
      ('public.notification_delivery_attempts')
  ) as expected(object_name)
  where to_regclass(object_name) is null;

  if missing_tables is not null then
    raise exception 'POSTCHECK_FAILED: missing notification tables: %.', array_to_string(missing_tables, ', ');
  end if;

  select array_agg(table_name || '.' || column_name order by table_name, column_name)
  into missing_columns
  from (
    values
      ('notification_events', 'id'),
      ('notification_events', 'event_type'),
      ('notification_events', 'source_table'),
      ('notification_events', 'source_id'),
      ('notification_events', 'source_folio'),
      ('notification_events', 'recipient_type'),
      ('notification_events', 'recipient_profile_id'),
      ('notification_events', 'recipient_email'),
      ('notification_events', 'recipient_role'),
      ('notification_events', 'channel'),
      ('notification_events', 'priority'),
      ('notification_events', 'subject'),
      ('notification_events', 'payload'),
      ('notification_events', 'idempotency_key'),
      ('notification_events', 'status'),
      ('notification_events', 'attempt_count'),
      ('notification_events', 'max_attempts'),
      ('notification_events', 'locked_at'),
      ('notification_events', 'locked_by'),
      ('notification_events', 'processed_at'),
      ('notification_events', 'last_error'),
      ('notification_events', 'last_attempt_at'),
      ('notification_events', 'next_attempt_at'),
      ('notification_events', 'created_at'),
      ('notification_events', 'updated_at'),
      ('notification_delivery_attempts', 'id'),
      ('notification_delivery_attempts', 'notification_event_id'),
      ('notification_delivery_attempts', 'attempt_number'),
      ('notification_delivery_attempts', 'status'),
      ('notification_delivery_attempts', 'provider_message_id'),
      ('notification_delivery_attempts', 'error_message'),
      ('notification_delivery_attempts', 'n8n_execution_id'),
      ('notification_delivery_attempts', 'worker_id'),
      ('notification_delivery_attempts', 'created_at')
  ) as expected(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = expected.table_name
      and c.column_name = expected.column_name
  );

  if missing_columns is not null then
    raise exception 'POSTCHECK_FAILED: missing notification columns: %.', array_to_string(missing_columns, ', ');
  end if;

  select array_agg(signature order by signature)
  into missing_functions
  from (
    values
      ('public.claim_pending_notification_events(integer,text)'),
      ('public.enqueue_notification_event(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
      ('public.enqueue_notification_event_internal(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
      ('public.mark_notification_failed(uuid,text,text,text)'),
      ('public.mark_notification_processed(uuid,text,text,text)'),
      ('public.notification_current_profile_id()'),
      ('public.notification_current_user_has_role(text[])'),
      ('public.set_updated_at_notification_events()')
  ) as expected(signature)
  where to_regprocedure(expected.signature) is null;

  if missing_functions is not null then
    raise exception 'POSTCHECK_FAILED: missing notification functions: %.', array_to_string(missing_functions, ', ');
  end if;

  select array_agg(expected.signature order by expected.signature)
  into non_normal_functions
  from (
    values
      ('public.claim_pending_notification_events(integer,text)'),
      ('public.enqueue_notification_event(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
      ('public.enqueue_notification_event_internal(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
      ('public.mark_notification_failed(uuid,text,text,text)'),
      ('public.mark_notification_processed(uuid,text,text,text)'),
      ('public.notification_current_profile_id()'),
      ('public.notification_current_user_has_role(text[])'),
      ('public.set_updated_at_notification_events()')
  ) as expected(signature)
  join pg_proc p on p.oid = to_regprocedure(expected.signature)
  where p.prokind <> 'f';

  if non_normal_functions is not null then
    raise exception 'POSTCHECK_FAILED: expected normal functions but found other prokind for: %.', array_to_string(non_normal_functions, ', ');
  end if;

  select exists (
    select 1
    from pg_trigger t
    where t.tgrelid = 'public.notification_events'::regclass
      and t.tgname = 'set_updated_at_notification_events'
      and not t.tgisinternal
  ) into trigger_exists;

  if not trigger_exists then
    raise exception 'POSTCHECK_FAILED: trigger set_updated_at_notification_events on public.notification_events does not exist.';
  end if;

  select array_agg(c.relname order by c.relname)
  into rls_missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('notification_events', 'notification_delivery_attempts')
    and not c.relrowsecurity;

  if rls_missing is not null then
    raise exception 'POSTCHECK_FAILED: RLS is not active on notification tables: %.', array_to_string(rls_missing, ', ');
  end if;

  select array_agg(table_name || '.' || policy_name order by table_name, policy_name)
  into missing_policies
  from (
    values
      ('notification_events', 'notification_events_select_self_or_admin'),
      ('notification_delivery_attempts', 'notification_delivery_attempts_select_self_or_admin')
  ) as expected(table_name, policy_name)
  where not exists (
    select 1
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = expected.table_name
      and pol.polname = expected.policy_name
  );

  if missing_policies is not null then
    raise exception 'POSTCHECK_FAILED: missing notification policies: %.', array_to_string(missing_policies, ', ');
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
    raise exception 'POSTCHECK_FAILED: notification tables have PUBLIC/anon policies.';
  end if;

  select array_agg(protected.signature || ' -> ' || coalesce(r.rolname, case when acl.grantee = 0::oid then 'PUBLIC' else acl.grantee::text end) order by protected.signature)
  into protected_execute_grants
  from (
    values
      ('public.enqueue_notification_event_internal(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
      ('public.set_updated_at_notification_events()')
  ) as protected(signature)
  join pg_proc p on p.oid = to_regprocedure(protected.signature)
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl
  left join pg_roles r on r.oid = acl.grantee
  where acl.privilege_type = 'EXECUTE'
    and (
      acl.grantee = 0::oid
      or r.rolname in ('anon', 'authenticated')
    );

  if protected_execute_grants is not null then
    raise exception 'POSTCHECK_FAILED: protected internal/trigger functions still expose EXECUTE: %.', array_to_string(protected_execute_grants, ', ');
  end if;

  select array_agg(signature order by signature)
  into missing_authenticated_execute
  from (
    values
      ('public.claim_pending_notification_events(integer,text)'),
      ('public.enqueue_notification_event(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
      ('public.mark_notification_failed(uuid,text,text,text)'),
      ('public.mark_notification_processed(uuid,text,text,text)'),
      ('public.notification_current_profile_id()'),
      ('public.notification_current_user_has_role(text[])')
  ) as expected(signature)
  where not has_function_privilege('authenticated', to_regprocedure(expected.signature), 'EXECUTE');

  if missing_authenticated_execute is not null then
    raise exception 'POSTCHECK_FAILED: authenticated is missing expected EXECUTE grants: %.', array_to_string(missing_authenticated_execute, ', ');
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    select array_agg(signature order by signature)
    into missing_service_execute
    from (
      values
        ('public.claim_pending_notification_events(integer,text)'),
        ('public.enqueue_notification_event(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
        ('public.enqueue_notification_event_internal(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'),
        ('public.mark_notification_failed(uuid,text,text,text)'),
        ('public.mark_notification_processed(uuid,text,text,text)'),
        ('public.notification_current_profile_id()'),
        ('public.notification_current_user_has_role(text[])'),
        ('public.set_updated_at_notification_events()')
    ) as expected(signature)
    where not has_function_privilege('service_role', to_regprocedure(expected.signature), 'EXECUTE');

    if missing_service_execute is not null then
      raise exception 'POSTCHECK_FAILED: service_role is missing expected EXECUTE grants: %.', array_to_string(missing_service_execute, ', ');
    end if;
  end if;

  select array_agg(role_name || ':' || table_name || ':' || privilege_name order by role_name, table_name, privilege_name)
  into missing_table_grants
  from (
    values
      ('authenticated', 'public.notification_events', 'SELECT'),
      ('authenticated', 'public.notification_delivery_attempts', 'SELECT'),
      ('service_role', 'public.notification_events', 'SELECT'),
      ('service_role', 'public.notification_events', 'INSERT'),
      ('service_role', 'public.notification_events', 'UPDATE'),
      ('service_role', 'public.notification_events', 'DELETE'),
      ('service_role', 'public.notification_delivery_attempts', 'SELECT'),
      ('service_role', 'public.notification_delivery_attempts', 'INSERT'),
      ('service_role', 'public.notification_delivery_attempts', 'UPDATE'),
      ('service_role', 'public.notification_delivery_attempts', 'DELETE')
  ) as expected(role_name, table_name, privilege_name)
  where exists (select 1 from pg_roles where rolname = expected.role_name)
    and not has_table_privilege(expected.role_name, expected.table_name, expected.privilege_name);

  if missing_table_grants is not null then
    raise exception 'POSTCHECK_FAILED: missing expected table grants: %.', array_to_string(missing_table_grants, ', ');
  end if;

  select array_agg(table_name || ':' || privilege_name order by table_name, privilege_name)
  into anon_table_grants
  from (
    values
      ('public.notification_events', 'SELECT'),
      ('public.notification_events', 'INSERT'),
      ('public.notification_events', 'UPDATE'),
      ('public.notification_events', 'DELETE'),
      ('public.notification_delivery_attempts', 'SELECT'),
      ('public.notification_delivery_attempts', 'INSERT'),
      ('public.notification_delivery_attempts', 'UPDATE'),
      ('public.notification_delivery_attempts', 'DELETE')
  ) as expected(table_name, privilege_name)
  where exists (select 1 from pg_roles where rolname = 'anon')
    and has_table_privilege('anon', expected.table_name, expected.privilege_name);

  if anon_table_grants is not null then
    raise exception 'POSTCHECK_FAILED: anon has unexpected notification table privileges: %.', array_to_string(anon_table_grants, ', ');
  end if;
end $$;

select
  c.relname as notification_table,
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
  p.proconfig as function_config,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute
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
  array_agg(coalesce(r.rolname, case when pr.role_oid = 0::oid then 'public' else pr.role_oid::text end) order by coalesce(r.rolname, case when pr.role_oid = 0::oid then 'public' else pr.role_oid::text end)) as roles,
  pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
  pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expression
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
left join lateral unnest(pol.polroles) as pr(role_oid) on true
left join pg_roles r on r.oid = pr.role_oid
where n.nspname = 'public'
  and c.relname in ('notification_events', 'notification_delivery_attempts')
group by c.relname, pol.oid, pol.polname, pol.polcmd, pol.polqual, pol.polwithcheck, pol.polrelid
order by c.relname, pol.polname;

select
  t.tgname as trigger_name,
  c.relname as table_name,
  p.proname as function_name,
  not t.tgisinternal as user_defined
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'notification_events'
  and t.tgname = 'set_updated_at_notification_events';

select
  'NOTIFICATIONS_007_POSTCHECK_OK' as result,
  '007 notifications ledger is applied in DEV with tables, functions, trigger, RLS, policies, and hardened EXECUTE grants validated.' as detail;
