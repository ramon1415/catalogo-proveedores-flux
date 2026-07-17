-- READ ONLY. Provider intake triage 029 postcheck for DEV.

select
  p.proname,
  p.prosecdef as security_definer,
  p.provolatile,
  p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
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
  c.conname,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.payment_intake_events'::regclass
  and c.conname = 'payment_intake_events_event_type_check';

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'payment_intake_company_created_idx',
    'payment_intake_events_action_id_uidx'
  )
order by indexname;

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
