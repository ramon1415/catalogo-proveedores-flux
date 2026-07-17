-- READ ONLY. Provider intake triage 029 postcheck for DEV.

do $postcheck$
declare
  v_function_count bigint;
  v_public_function_count bigint;
  v_internal_function_count bigint;
  v_index_count bigint;
  v_backup_count bigint;
  v_policy_count bigint;
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

  select count(*)
    into v_public_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'list_provider_intakes',
      'get_provider_intake_detail',
      'transition_provider_intake',
      'add_provider_intake_note'
    );

  select count(*)
    into v_internal_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'provider_intake_actor_context',
      'provider_intake_assert_company_access',
      'provider_intake_mask_value'
    );

  if (v_function_count, v_public_function_count, v_internal_function_count)
    is distinct from (7::bigint, 4::bigint, 3::bigint)
  then
    raise exception
      '029_postcheck_function_count: total %, public %, internal %',
      v_function_count,
      v_public_function_count,
      v_internal_function_count;
  end if;

  if exists (
    select 1
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
      and (
        not p.prosecdef
        or not exists (
          select 1
          from unnest(coalesce(p.proconfig, array[]::text[])) setting
          where setting = 'search_path=public, pg_temp'
        )
        or has_function_privilege('anon', p.oid, 'EXECUTE')
      )
  ) then
    raise exception '029_postcheck_function_security';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'list_provider_intakes',
        'get_provider_intake_detail',
        'transition_provider_intake',
        'add_provider_intake_note'
      )
      and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ) then
    raise exception '029_postcheck_public_rpc_grants';
  end if;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'provider_intake_actor_context',
        'provider_intake_assert_company_access',
        'provider_intake_mask_value'
      )
      and (
        has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or has_function_privilege('service_role', p.oid, 'EXECUTE')
      )
  ) then
    raise exception '029_postcheck_internal_helper_grants';
  end if;

  select count(*)
    into v_index_count
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'payment_intake_company_created_idx',
      'payment_intake_events_action_id_uidx'
    );

  if v_index_count <> 2 then
    raise exception '029_postcheck_index_count: expected 2, found %', v_index_count;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.payment_intake_events'::regclass
      and c.conname = 'payment_intake_events_event_type_check'
      and position('internal_note' in pg_get_constraintdef(c.oid)) > 0
  ) then
    raise exception '029_postcheck_internal_note_constraint';
  end if;

  if (
    (select count(*) from public.payment_intake) <> 13
    or (select count(*) from public.payment_intake_files) <> 6
    or (select count(*) from public.payment_intake_events) <> 20
  ) then
    raise exception '029_postcheck_business_count_mismatch';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'payment_intake',
        'payment_intake_files',
        'payment_intake_events'
      )
      and not c.relrowsecurity
  ) then
    raise exception '029_postcheck_live_rls_mismatch';
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
    raise exception '029_postcheck_backup_count: expected 3, found %', v_backup_count;
  end if;

  if (
    (select count(*) from public._backup_029_payment_intake) <> 13
    or (select count(*) from public._backup_029_payment_intake_files) <> 6
    or (select count(*) from public._backup_029_payment_intake_events) <> 20
  ) then
    raise exception '029_postcheck_backup_row_count_mismatch';
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
      '029_postcheck_backup_integrity: intake %, files %, events %',
      v_intake_mismatch,
      v_files_mismatch,
      v_events_mismatch;
  end if;

  select count(*)
    into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      '_backup_029_payment_intake',
      '_backup_029_payment_intake_files',
      '_backup_029_payment_intake_events'
    );

  if v_policy_count <> 0 then
    raise exception '029_postcheck_backup_policies: expected zero, found %', v_policy_count;
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        '_backup_029_payment_intake',
        '_backup_029_payment_intake_files',
        '_backup_029_payment_intake_events'
      )
      and not c.relrowsecurity
  ) then
    raise exception '029_postcheck_backup_rls_mismatch';
  end if;

  if exists (
    select 1
    from (
      values
        ('anon'),
        ('authenticated'),
        ('service_role')
    ) application_role(role_name)
    cross join (
      values
        ('public._backup_029_payment_intake'),
        ('public._backup_029_payment_intake_files'),
        ('public._backup_029_payment_intake_events')
    ) backup_table(table_name)
    where has_table_privilege(
      application_role.role_name,
      backup_table.table_name,
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) then
    raise exception '029_postcheck_backup_application_grants';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(
      coalesce(c.relacl, acldefault('r', c.relowner))
    ) privilege
    where n.nspname = 'public'
      and c.relname in (
        '_backup_029_payment_intake',
        '_backup_029_payment_intake_files',
        '_backup_029_payment_intake_events'
      )
      and privilege.grantee = 0
  ) then
    raise exception '029_postcheck_backup_public_grants';
  end if;
end
$postcheck$;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_get_function_result(p.oid) as return_type,
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

select
  c.relname as backup_table,
  c.relrowsecurity as rls_enabled,
  (
    select count(*)
    from pg_policies p
    where p.schemaname = n.nspname
      and p.tablename = c.relname
  ) as policy_count,
  has_table_privilege(
    'anon',
    c.oid,
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) as anon_has_privilege,
  has_table_privilege(
    'authenticated',
    c.oid,
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) as authenticated_has_privilege,
  has_table_privilege(
    'service_role',
    c.oid,
    'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
  ) as service_role_has_privilege
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    '_backup_029_payment_intake',
    '_backup_029_payment_intake_files',
    '_backup_029_payment_intake_events'
  )
order by c.relname;

select
  'payment_intake' as object_name,
  (select count(*) from public.payment_intake) as rows_live,
  (select count(*) from public._backup_029_payment_intake) as rows_backup,
  (
    with live_hashes as (
      select md5(to_jsonb(live_row)::text) as row_hash, count(*) as row_count
      from public.payment_intake live_row
      group by md5(to_jsonb(live_row)::text)
    ),
    backup_hashes as (
      select md5(to_jsonb(backup_row)::text) as row_hash, count(*) as row_count
      from public._backup_029_payment_intake backup_row
      group by md5(to_jsonb(backup_row)::text)
    )
    select coalesce(sum(abs(coalesce(l.row_count, 0) - coalesce(b.row_count, 0))), 0)
    from live_hashes l
    full join backup_hashes b using (row_hash)
  ) as mismatch_count,
  (
    with live_hashes as (
      select md5(to_jsonb(live_row)::text) as row_hash, count(*) as row_count
      from public.payment_intake live_row
      group by md5(to_jsonb(live_row)::text)
    ),
    backup_hashes as (
      select md5(to_jsonb(backup_row)::text) as row_hash, count(*) as row_count
      from public._backup_029_payment_intake backup_row
      group by md5(to_jsonb(backup_row)::text)
    )
    select coalesce(bool_and(coalesce(l.row_count, 0) = coalesce(b.row_count, 0)), true)
    from live_hashes l
    full join backup_hashes b using (row_hash)
  ) as digest_equal
union all
select
  'payment_intake_files',
  (select count(*) from public.payment_intake_files),
  (select count(*) from public._backup_029_payment_intake_files),
  (
    with live_hashes as (
      select md5(to_jsonb(live_row)::text) as row_hash, count(*) as row_count
      from public.payment_intake_files live_row
      group by md5(to_jsonb(live_row)::text)
    ),
    backup_hashes as (
      select md5(to_jsonb(backup_row)::text) as row_hash, count(*) as row_count
      from public._backup_029_payment_intake_files backup_row
      group by md5(to_jsonb(backup_row)::text)
    )
    select coalesce(sum(abs(coalesce(l.row_count, 0) - coalesce(b.row_count, 0))), 0)
    from live_hashes l
    full join backup_hashes b using (row_hash)
  ),
  (
    with live_hashes as (
      select md5(to_jsonb(live_row)::text) as row_hash, count(*) as row_count
      from public.payment_intake_files live_row
      group by md5(to_jsonb(live_row)::text)
    ),
    backup_hashes as (
      select md5(to_jsonb(backup_row)::text) as row_hash, count(*) as row_count
      from public._backup_029_payment_intake_files backup_row
      group by md5(to_jsonb(backup_row)::text)
    )
    select coalesce(bool_and(coalesce(l.row_count, 0) = coalesce(b.row_count, 0)), true)
    from live_hashes l
    full join backup_hashes b using (row_hash)
  )
union all
select
  'payment_intake_events',
  (select count(*) from public.payment_intake_events),
  (select count(*) from public._backup_029_payment_intake_events),
  (
    with live_hashes as (
      select md5(to_jsonb(live_row)::text) as row_hash, count(*) as row_count
      from public.payment_intake_events live_row
      group by md5(to_jsonb(live_row)::text)
    ),
    backup_hashes as (
      select md5(to_jsonb(backup_row)::text) as row_hash, count(*) as row_count
      from public._backup_029_payment_intake_events backup_row
      group by md5(to_jsonb(backup_row)::text)
    )
    select coalesce(sum(abs(coalesce(l.row_count, 0) - coalesce(b.row_count, 0))), 0)
    from live_hashes l
    full join backup_hashes b using (row_hash)
  ),
  (
    with live_hashes as (
      select md5(to_jsonb(live_row)::text) as row_hash, count(*) as row_count
      from public.payment_intake_events live_row
      group by md5(to_jsonb(live_row)::text)
    ),
    backup_hashes as (
      select md5(to_jsonb(backup_row)::text) as row_hash, count(*) as row_count
      from public._backup_029_payment_intake_events backup_row
      group by md5(to_jsonb(backup_row)::text)
    )
    select coalesce(bool_and(coalesce(l.row_count, 0) = coalesce(b.row_count, 0)), true)
    from live_hashes l
    full join backup_hashes b using (row_hash)
  )
order by object_name;
