-- READ ONLY. Provider intake triage 029 precheck for DEV.

do $precheck$
declare
  v_function_count bigint;
  v_index_count bigint;
  v_backup_count bigint;
  v_intake_mismatch bigint;
  v_files_mismatch bigint;
  v_events_mismatch bigint;
begin
  select count(*)
    into v_function_count
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
    );

  if v_function_count <> 0 then
    raise exception '029_precheck_partial_application: found % triage functions', v_function_count;
  end if;

  select count(*)
    into v_index_count
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'payment_intake_company_created_idx',
      'payment_intake_events_action_id_uidx'
    );

  if v_index_count <> 0 then
    raise exception '029_precheck_partial_application: found % triage indexes', v_index_count;
  end if;

  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
      and position('internal_note' in pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception '029_precheck_partial_application: internal_note already allowed';
  end if;

  select count(*)
    into v_backup_count
  from (
    values
      ('_backup_029_payment_intake'),
      ('_backup_029_payment_intake_files'),
      ('_backup_029_payment_intake_events')
  ) expected(table_name)
  where to_regclass('public.' || expected.table_name) is not null;

  if v_backup_count <> 3 then
    raise exception '029_precheck_backup_state: expected three backup tables, found %', v_backup_count;
  end if;

  if (
    (select count(*) from public.payment_intake) <> 13
    or (select count(*) from public._backup_029_payment_intake) <> 13
    or (select count(*) from public.payment_intake_files) <> 6
    or (select count(*) from public._backup_029_payment_intake_files) <> 6
    or (select count(*) from public.payment_intake_events) <> 20
    or (select count(*) from public._backup_029_payment_intake_events) <> 20
  ) then
    raise exception '029_precheck_count_mismatch';
  end if;

  select count(*)
    into v_intake_mismatch
  from (
    (
      select to_jsonb(live_row) as row_value
      from public.payment_intake live_row
      except all
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake backup_row
    )
    union all
    (
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake backup_row
      except all
      select to_jsonb(live_row)
      from public.payment_intake live_row
    )
  ) differences;

  select count(*)
    into v_files_mismatch
  from (
    (
      select to_jsonb(live_row) as row_value
      from public.payment_intake_files live_row
      except all
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_files backup_row
    )
    union all
    (
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_files backup_row
      except all
      select to_jsonb(live_row)
      from public.payment_intake_files live_row
    )
  ) differences;

  select count(*)
    into v_events_mismatch
  from (
    (
      select to_jsonb(live_row) as row_value
      from public.payment_intake_events live_row
      except all
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_events backup_row
    )
    union all
    (
      select to_jsonb(backup_row)
      from public._backup_029_payment_intake_events backup_row
      except all
      select to_jsonb(live_row)
      from public.payment_intake_events live_row
    )
  ) differences;

  if v_intake_mismatch <> 0 or v_files_mismatch <> 0 or v_events_mismatch <> 0 then
    raise exception
      '029_precheck_backup_mismatch: intake %, files %, events %',
      v_intake_mismatch,
      v_files_mismatch,
      v_events_mismatch;
  end if;
end
$precheck$;

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
