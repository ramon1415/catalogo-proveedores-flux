-- READ ONLY. Provider intake triage 029 precheck for DEV.

select
  current_database() as database_name,
  current_user as database_user,
  now() as checked_at;

select
  to_regclass('public.payment_intake') as payment_intake,
  to_regclass('public.payment_intake_files') as payment_intake_files,
  to_regclass('public.payment_intake_events') as payment_intake_events,
  to_regprocedure('public.current_profile_id()') as current_profile_id,
  to_regprocedure('public.current_user_has_role(text[])') as current_user_has_role,
  to_regprocedure('public.has_active_company_membership(uuid,uuid)') as company_membership;

select
  n.nspname as schema_name,
  p.proname as existing_triage_function
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'provider_intake_actor_context',
    'provider_intake_assert_company_access',
    'provider_intake_mask_value',
    'list_provider_intakes',
    'get_provider_intake_detail',
    'transition_provider_intake',
    'add_provider_intake_note'
  )
order by p.proname;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    'payment_intake',
    'payment_intake_files',
    'payment_intake_events'
  )
order by tablename, policyname;

select status, count(*) as row_count
from public.payment_intake
group by status
order by status;

select event_type, count(*) as row_count
from public.payment_intake_events
group by event_type
order by event_type;

select
  b.id,
  b.public,
  b.file_size_limit,
  b.allowed_mime_types
from storage.buckets b
where b.id = 'intake-uploads';

select count(*) as direct_intake_storage_policies
from pg_policies p
where p.schemaname = 'storage'
  and p.tablename = 'objects'
  and position(
    'intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
  ) > 0;
