-- Read-only logical evidence before migration 027. Export every result set privately.

begin transaction read only;

select
  now() at time zone 'utc' as captured_at_utc,
  current_database() as database_name,
  current_setting('transaction_read_only') as transaction_read_only;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('intake_links', 'payment_intake', 'payment_intake_files', 'payment_intake_events')
order by c.relname;

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'next_payment_intake_public_folio',
    'normalize_payment_intake_foundation',
    'protect_payment_intake_events_immutable',
    'enqueue_notification_event_internal',
    'resolve_provider_intake_link_internal',
    'create_provider_intake_internal',
    'attach_provider_intake_files_internal',
    'mark_provider_intake_upload_issue_internal'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  coalesce(grantee.rolname, 'PUBLIC') as grantee,
  privilege.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) privilege
left join pg_roles grantee on grantee.oid = privilege.grantee
where n.nspname = 'public'
  and p.proname in (
    'next_payment_intake_public_folio',
    'enqueue_notification_event_internal',
    'resolve_provider_intake_link_internal',
    'create_provider_intake_internal',
    'attach_provider_intake_files_internal',
    'mark_provider_intake_upload_issue_internal'
  )
order by p.proname, grantee;

select 'intake_links' as object_name, count(*) as row_count from public.intake_links
union all select 'payment_intake', count(*) from public.payment_intake
union all select 'payment_intake_files', count(*) from public.payment_intake_files
union all select 'payment_intake_events', count(*) from public.payment_intake_events
union all select 'notification_events', count(*) from public.notification_events
union all select 'payment_requests', count(*) from public.payment_requests
union all select 'proveedores', count(*) from public.proveedores
union all select 'approval_batches', count(*) from public.approval_batches
order by object_name;

select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'intake-uploads';

select bucket_id, count(*) as object_count
from storage.objects
where bucket_id = 'intake-uploads'
group by bucket_id;

commit;
