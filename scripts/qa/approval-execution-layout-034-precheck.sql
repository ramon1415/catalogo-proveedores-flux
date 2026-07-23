-- Run only in Supabase DEV project scsirgbuqjcwoaxfacth.
-- Read-only gate immediately before applying migration 034 exactly once.
begin;
set transaction read only;

do $$
declare
  v_pair_index_definition text;
begin
  if to_regclass('public.company_directors_one_active_per_company_uidx') is null then
    raise exception 'PRECHECK_034_FAIL: 033 one-active-per-company index is missing';
  end if;

  if to_regclass('public.company_directors_active_uidx') is null then
    raise exception 'PRECHECK_034_FAIL: active company/Director pair index is missing';
  end if;

  select pg_get_indexdef('public.company_directors_active_uidx'::regclass)
    into v_pair_index_definition;

  if v_pair_index_definition not ilike '%unique index%'
     or v_pair_index_definition not ilike '%(company_id, director_profile_id)%'
     or v_pair_index_definition not ilike '%where active%' then
    raise exception 'PRECHECK_034_FAIL: active pair protection drifted: %',
      v_pair_index_definition;
  end if;

  if to_regprocedure('public.set_company_director_for_future_batches(uuid,uuid)') is null
     or to_regprocedure('public.complete_payment_request_layout_data(uuid,uuid,text,text,date)') is null
     or to_regprocedure('public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)') is null then
    raise exception 'PRECHECK_034_FAIL: required 033 functions are missing';
  end if;

  if to_regprocedure('public.add_company_director_for_future_batches(uuid,uuid)') is not null
     or to_regprocedure('public.remove_company_director_for_future_batches(uuid,uuid)') is not null then
    raise exception 'PRECHECK_034_FAIL: migration 034 objects already exist';
  end if;

  if exists (
    select 1
    from public.company_directors director_assignment
    where director_assignment.active
    group by
      director_assignment.company_id,
      director_assignment.director_profile_id
    having count(*) > 1
  ) then
    raise exception 'PRECHECK_034_FAIL: duplicate active company/Director pairs exist';
  end if;

  if exists (
    select 1
    from public.approval_batches batch
    where batch.director_id is null
  ) then
    raise exception 'PRECHECK_034_FAIL: a historical batch lost its Director snapshot';
  end if;
end
$$;

with target_company as (
  select company.id
  from public.companies company
  where lower(
    coalesce(nullif(btrim(company.legal_name), ''), company.name)
  ) like '%operadora tlacatecpan%'
),
active_directors as (
  select
    director_assignment.director_profile_id,
    profile.full_name
  from public.company_directors director_assignment
  join target_company company on company.id = director_assignment.company_id
  join public.profiles profile
    on profile.id = director_assignment.director_profile_id
  where director_assignment.active
),
denise_assignments as (
  select director_assignment.active
  from public.company_directors director_assignment
  join target_company company on company.id = director_assignment.company_id
  join public.profiles profile
    on profile.id = director_assignment.director_profile_id
  where translate(
    lower(coalesce(profile.full_name, '')),
    'áéíóúüñ',
    'aeiouun'
  ) like 'denise%'
)
select
  'PRECHECK_034_DIRECTOR_RECONCILIATION' as check_name,
  (select count(*) from target_company) as target_company_count,
  (select count(*) from active_directors) as active_director_count,
  (
    select count(*)
    from active_directors director
    where translate(
      lower(coalesce(director.full_name, '')),
      'áéíóúüñ',
      'aeiouun'
    ) like 'ramon%'
  ) as active_ramon_count,
  (select count(*) from denise_assignments where active) as active_denise_count,
  (select count(*) from denise_assignments where not active) as inactive_denise_count;

select
  'PRECHECK_034_OBJECTS' as check_name,
  'scsirgbuqjcwoaxfacth'::text as expected_dev_project_ref,
  '629081c0c25d2cbd43214f92ffd03a9f4ec1f27c84bc33694e05a913a63084dc'::text
    as expected_migration_033_sha256,
  to_regclass('public.company_directors_one_active_per_company_uidx')
    is not null as one_active_index_present,
  to_regclass('public.company_directors_active_uidx')
    is not null as active_pair_index_present,
  to_regprocedure('public.set_company_director_for_future_batches(uuid,uuid)')
    is not null as replacement_rpc_present,
  to_regprocedure('public.add_company_director_for_future_batches(uuid,uuid)')
    is null as add_rpc_absent,
  to_regprocedure('public.remove_company_director_for_future_batches(uuid,uuid)')
    is null as remove_rpc_absent;

select
  'PRECHECK_034_MANIFEST' as check_name,
  (select count(*) from public.approval_batches) as approval_batches_count,
  (
    select md5(coalesce(string_agg(
      concat_ws(
        '|',
        batch.id,
        batch.company_id,
        batch.director_id,
        batch.status,
        batch.created_by,
        batch.submitted_by,
        batch.decided_by,
        batch.closed_by,
        batch.created_at,
        batch.submitted_at,
        batch.decided_at,
        batch.closed_at
      ),
      E'\n'
      order by batch.id
    ), ''))
    from public.approval_batches batch
  ) as approval_batches_manifest,
  (select count(*) from public.approval_batch_items) as approval_batch_items_count,
  (
    select md5(coalesce(string_agg(
      concat_ws(
        '|',
        batch_item.id,
        batch_item.batch_id,
        batch_item.payment_request_id,
        batch_item.director_status,
        batch_item.decided_by,
        batch_item.decided_at,
        batch_item.removed_at
      ),
      E'\n'
      order by batch_item.id
    ), ''))
    from public.approval_batch_items batch_item
  ) as approval_batch_items_manifest,
  (select count(*) from public.payment_receipts) as payment_receipts_count,
  (
    select md5(coalesce(string_agg(
      concat_ws(
        '|',
        receipt.id,
        receipt.payment_request_id,
        receipt.created_at
      ),
      E'\n'
      order by receipt.id
    ), ''))
    from public.payment_receipts receipt
  ) as payment_receipts_manifest,
  (select count(*) from public.approval_batch_company_settings)
    as enforcement_settings_count,
  (
    select md5(coalesce(string_agg(
      concat_ws(
        '|',
        setting.company_id,
        setting.regular_payments_require_closed_batch,
        setting.enforcement_started_at,
        setting.updated_at
      ),
      E'\n'
      order by setting.company_id
    ), ''))
    from public.approval_batch_company_settings setting
  ) as enforcement_settings_manifest;

rollback;
