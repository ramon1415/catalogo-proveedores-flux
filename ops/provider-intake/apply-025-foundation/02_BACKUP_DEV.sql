-- Migration 025 manual gate - read-only evidence snapshot.
-- Export every result grid before running the load file.

begin transaction read only;

select
  now() as captured_at,
  current_database() as database_name,
  current_user as database_role,
  current_setting('transaction_read_only') as transaction_read_only,
  version() as postgres_version;

select
  b.id,
  b.name,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types,
  b.created_at,
  b.updated_at
from storage.buckets b
where b.id = 'intake-uploads';

select
  n.nspname as schema_name,
  c.relname as object_name,
  c.relkind,
  c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'storage')
  and (
    c.relname ilike '%intake%'
    or c.relname = 'payment_intake_public_folio_seq'
  )
order by n.nspname, c.relname;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname ilike '%intake%'
order by p.proname, pg_get_function_identity_arguments(p.oid);

select
  p.schemaname,
  p.tablename,
  p.policyname,
  p.permissive,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_policies p
where (
    p.schemaname = 'public'
    and p.tablename in (
      'intake_links',
      'payment_intake',
      'payment_intake_files',
      'payment_intake_events'
    )
  )
  or (
    p.schemaname = 'storage'
    and p.tablename = 'objects'
    and position(
      'intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
    ) > 0
  )
order by p.schemaname, p.tablename, p.policyname;

select
  g.grantee,
  g.table_schema,
  g.table_name,
  g.privilege_type,
  g.is_grantable
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.table_name in (
    'intake_links',
    'payment_intake',
    'payment_intake_files',
    'payment_intake_events'
  )
order by g.table_name, g.grantee, g.privilege_type;

select
  'companies'::text as object_name,
  count(*)::bigint as row_count
from public.companies
union all
select 'profiles', count(*) from public.profiles
union all
select 'proveedores', count(*) from public.proveedores
union all
select 'payment_requests', count(*) from public.payment_requests
union all
select 'notification_events', count(*) from public.notification_events
order by object_name;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_settings,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    (p.proname = 'current_profile_id' and pg_get_function_identity_arguments(p.oid) = '')
    or (p.proname = 'current_user_has_role' and pg_get_function_identity_arguments(p.oid) = 'p_roles text[]')
    or (p.proname = 'flux_sysadmin_roles' and pg_get_function_identity_arguments(p.oid) = '')
    or (p.proname = 'flux_finance_roles' and pg_get_function_identity_arguments(p.oid) = '')
    or (
      p.proname = 'has_active_company_membership'
      and pg_get_function_identity_arguments(p.oid) = 'p_profile_id uuid, p_company_id uuid'
    )
    or (p.proname = 'set_updated_at' and pg_get_function_identity_arguments(p.oid) = '')
  )
order by p.proname;

commit;
