-- Migration 025 manual gate - consolidated read-only postcheck.
-- Every row must be PASS or an explicitly reviewed INFO row.

begin transaction read only;

with
intake_tables(table_name) as (
  values
    ('intake_links'),
    ('payment_intake'),
    ('payment_intake_files'),
    ('payment_intake_events')
),
expected_columns(table_name, column_name) as (
  values
    ('intake_links', 'id'),
    ('intake_links', 'company_id'),
    ('intake_links', 'label'),
    ('intake_links', 'token_hash'),
    ('intake_links', 'token_prefix'),
    ('intake_links', 'status'),
    ('intake_links', 'expires_at'),
    ('intake_links', 'max_submissions_per_day'),
    ('intake_links', 'allowed_file_types'),
    ('intake_links', 'max_file_mb'),
    ('intake_links', 'created_by'),
    ('intake_links', 'created_at'),
    ('intake_links', 'updated_at'),
    ('intake_links', 'revoked_by'),
    ('intake_links', 'revoked_at'),
    ('intake_links', 'regenerated_from_id'),
    ('payment_intake', 'id'),
    ('payment_intake', 'public_folio'),
    ('payment_intake', 'intake_link_id'),
    ('payment_intake', 'company_id'),
    ('payment_intake', 'status'),
    ('payment_intake', 'provider_name'),
    ('payment_intake', 'provider_rfc'),
    ('payment_intake', 'provider_email'),
    ('payment_intake', 'provider_phone'),
    ('payment_intake', 'concept'),
    ('payment_intake', 'description'),
    ('payment_intake', 'amount_requested'),
    ('payment_intake', 'currency'),
    ('payment_intake', 'requested_payment_date'),
    ('payment_intake', 'invoice_folio'),
    ('payment_intake', 'invoice_uuid'),
    ('payment_intake', 'invoice_date'),
    ('payment_intake', 'bank_name'),
    ('payment_intake', 'bank_account'),
    ('payment_intake', 'bank_clabe'),
    ('payment_intake', 'beneficiary_name'),
    ('payment_intake', 'submission_fingerprint'),
    ('payment_intake', 'idempotency_key'),
    ('payment_intake', 'client_ip_hash'),
    ('payment_intake', 'user_agent_hash'),
    ('payment_intake', 'payload_version'),
    ('payment_intake', 'captcha_provider'),
    ('payment_intake', 'captcha_verified_at'),
    ('payment_intake', 'matched_proveedor_id'),
    ('payment_intake', 'created_payment_request_id'),
    ('payment_intake', 'triaged_by'),
    ('payment_intake', 'triaged_at'),
    ('payment_intake', 'rejection_reason'),
    ('payment_intake', 'retention_until'),
    ('payment_intake', 'created_at'),
    ('payment_intake', 'updated_at'),
    ('payment_intake_files', 'id'),
    ('payment_intake_files', 'payment_intake_id'),
    ('payment_intake_files', 'bucket_id'),
    ('payment_intake_files', 'storage_path'),
    ('payment_intake_files', 'original_filename'),
    ('payment_intake_files', 'mime_type'),
    ('payment_intake_files', 'size_bytes'),
    ('payment_intake_files', 'file_kind'),
    ('payment_intake_files', 'quarantine_status'),
    ('payment_intake_files', 'sha256'),
    ('payment_intake_files', 'created_at'),
    ('payment_intake_files', 'reviewed_by'),
    ('payment_intake_files', 'reviewed_at'),
    ('payment_intake_files', 'rejection_reason'),
    ('payment_intake_events', 'id'),
    ('payment_intake_events', 'payment_intake_id'),
    ('payment_intake_events', 'event_type'),
    ('payment_intake_events', 'actor_profile_id'),
    ('payment_intake_events', 'actor_type'),
    ('payment_intake_events', 'from_status'),
    ('payment_intake_events', 'to_status'),
    ('payment_intake_events', 'notes'),
    ('payment_intake_events', 'metadata'),
    ('payment_intake_events', 'created_at')
),
expected_constraints(constraint_name) as (
  values
    ('intake_links_pkey'),
    ('intake_links_revocation_check'),
    ('payment_intake_pkey'),
    ('payment_intake_link_company_fkey'),
    ('payment_intake_conversion_check'),
    ('payment_intake_rejection_check'),
    ('payment_intake_files_pkey'),
    ('payment_intake_files_storage_path_check'),
    ('payment_intake_files_review_check'),
    ('payment_intake_events_pkey'),
    ('payment_intake_events_actor_check'),
    ('payment_intake_events_metadata_check'),
    ('payment_intake_events_metadata_sensitive_keys_check')
),
expected_indexes(index_name) as (
  values
    ('intake_links_token_hash_uidx'),
    ('intake_links_id_company_uidx'),
    ('intake_links_company_status_idx'),
    ('intake_links_one_active_per_company_uidx'),
    ('intake_links_expires_at_idx'),
    ('payment_intake_public_folio_uidx'),
    ('payment_intake_link_id_idx'),
    ('payment_intake_company_status_created_idx'),
    ('payment_intake_provider_rfc_idx'),
    ('payment_intake_submission_fingerprint_created_idx'),
    ('payment_intake_idempotency_uidx'),
    ('payment_intake_created_request_uidx'),
    ('payment_intake_files_intake_id_idx'),
    ('payment_intake_files_storage_path_uidx'),
    ('payment_intake_files_quarantine_status_idx'),
    ('payment_intake_events_intake_created_idx'),
    ('payment_intake_events_type_created_idx')
),
expected_functions(function_name) as (
  values
    ('next_payment_intake_public_folio'),
    ('normalize_payment_intake_foundation'),
    ('protect_payment_intake_events_immutable')
),
expected_policies(table_name, policy_name) as (
  values
    ('intake_links', 'intake_links_select_admins'),
    ('payment_intake', 'payment_intake_select_finance_company'),
    ('payment_intake_files', 'payment_intake_files_select_finance_company'),
    ('payment_intake_events', 'payment_intake_events_select_finance_company')
),
expected_triggers(table_name, trigger_name) as (
  values
    ('intake_links', 'intake_links_updated_at'),
    ('payment_intake', 'payment_intake_normalize_before_write'),
    ('payment_intake', 'payment_intake_updated_at'),
    ('payment_intake_events', 'payment_intake_events_immutable')
),
expected_mimes(mime_type) as (
  values
    ('application/pdf'),
    ('application/xml'),
    ('text/xml'),
    ('image/jpeg'),
    ('image/png'),
    ('image/webp')
),
function_acl_exposure as (
  select count(*)::integer as exposed_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  left join pg_roles r on r.oid = acl.grantee
  where n.nspname = 'public'
    and p.proname in (select function_name from expected_functions)
    and acl.privilege_type = 'EXECUTE'
    and (acl.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
checks as (
  select
    'intake_tables_exist'::text as check_name,
    case when count(*) filter (
      where to_regclass('public.' || table_name) is not null
    ) = 4 then 'PASS' else 'FAIL' end as check_status,
    format('Found %s of 4 tables', count(*) filter (
      where to_regclass('public.' || table_name) is not null
    )) as detail
  from intake_tables

  union all

  select
    'intake_columns_exist',
    case when count(*) filter (where c.column_name is null) = 0 then 'PASS' else 'FAIL' end,
    coalesce(
      string_agg(ec.table_name || '.' || ec.column_name, ', ' order by ec.table_name, ec.column_name)
        filter (where c.column_name is null),
      format('All %s expected columns exist', count(*))
    )
  from expected_columns ec
  left join information_schema.columns c
    on c.table_schema = 'public'
   and c.table_name = ec.table_name
   and c.column_name = ec.column_name

  union all

  select
    'intake_constraints_exist',
    case when count(*) filter (where pc.conname is null) = 0 then 'PASS' else 'FAIL' end,
    coalesce(
      string_agg(ec.constraint_name, ', ' order by ec.constraint_name)
        filter (where pc.conname is null),
      format('All %s required constraints exist', count(*))
    )
  from expected_constraints ec
  left join (
    select pc.conname
    from pg_constraint pc
    join pg_class tbl on tbl.oid = pc.conrelid
    join pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'public'
      and tbl.relname in (select table_name from intake_tables)
  ) pc on pc.conname = ec.constraint_name

  union all

  select
    'intake_indexes_exist',
    case when count(*) filter (where pi.indexname is null) = 0 then 'PASS' else 'FAIL' end,
    coalesce(
      string_agg(ei.index_name, ', ' order by ei.index_name)
        filter (where pi.indexname is null),
      format('All %s required indexes exist', count(*))
    )
  from expected_indexes ei
  left join pg_indexes pi
    on pi.schemaname = 'public'
   and pi.indexname = ei.index_name

  union all

  select
    'intake_triggers_exist',
    case when count(*) filter (where t.tgname is null) = 0 then 'PASS' else 'FAIL' end,
    coalesce(
      string_agg(et.table_name || '.' || et.trigger_name, ', ' order by et.table_name, et.trigger_name)
        filter (where t.tgname is null),
      format('All %s expected triggers exist', count(*))
    )
  from expected_triggers et
  left join (
    select tbl.relname as table_name, t.tgname
    from pg_trigger t
    join pg_class tbl on tbl.oid = t.tgrelid
    join pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'public'
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  ) t
    on t.table_name = et.table_name
   and t.tgname = et.trigger_name

  union all

  select
    'intake_select_policies_exist',
    case when count(*) filter (where p.policyname is null) = 0 then 'PASS' else 'FAIL' end,
    coalesce(
      string_agg(ep.table_name || '.' || ep.policy_name, ', ' order by ep.table_name)
        filter (where p.policyname is null),
      format('All %s expected SELECT policies exist', count(*))
    )
  from expected_policies ep
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = ep.table_name
   and p.policyname = ep.policy_name
   and p.cmd = 'SELECT'

  union all

  select
    'internal_functions_exist',
    case when count(*) filter (where p.proname is null) = 0 then 'PASS' else 'FAIL' end,
    coalesce(
      string_agg(ef.function_name, ', ' order by ef.function_name)
        filter (where p.proname is null),
      format('All %s internal functions exist', count(*))
    )
  from expected_functions ef
  left join (
    select p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ) p on p.proname = ef.function_name

  union all

  select
    'intake_rls_enabled',
    case when count(*) filter (where c.relrowsecurity) = 4 then 'PASS' else 'FAIL' end,
    format('RLS enabled on %s of 4 tables', count(*) filter (where c.relrowsecurity))
  from intake_tables it
  left join pg_class c on c.oid = to_regclass('public.' || it.table_name)

  union all

  select
    'anon_table_grants_zero',
    case when count(g.*) = 0 then 'PASS' else 'FAIL' end,
    format('anon/PUBLIC table grants: %s', count(g.*))
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in (select table_name from intake_tables)
    and g.grantee in ('anon', 'PUBLIC')

  union all

  select
    'anon_policies_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('anon/PUBLIC intake policies: %s', count(*))
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (select table_name from intake_tables)
    and p.roles && array['anon', 'public']::name[]

  union all

  select
    'authenticated_mutation_grants_minimal',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('Direct authenticated mutation grants: %s', count(*))
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in (select table_name from intake_tables)
    and g.grantee = 'authenticated'
    and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')

  union all

  select
    'authenticated_select_grants_present',
    case when count(*) = 4 and count(distinct g.table_name) = 4 then 'PASS' else 'FAIL' end,
    format('Direct authenticated SELECT grants: %s across %s tables', count(*), count(distinct g.table_name))
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in (select table_name from intake_tables)
    and g.grantee = 'authenticated'
    and g.privilege_type = 'SELECT'

  union all

  select
    'security_definer_search_path_fixed',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    format('Fixed SECURITY DEFINER intake helpers: %s of 1', count(*))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'next_payment_intake_public_folio'
    and p.prosecdef
    and exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) setting
      where replace(setting, ' ', '') = 'search_path=public,pg_temp'
    )

  union all

  select
    'internal_function_search_paths_fixed',
    case when count(*) = 3 then 'PASS' else 'FAIL' end,
    format('Internal functions with fixed search_path: %s of 3', count(*))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (select function_name from expected_functions)
    and exists (
      select 1
      from unnest(coalesce(p.proconfig, array[]::text[])) setting
      where replace(setting, ' ', '') = 'search_path=public,pg_temp'
    )

  union all

  select
    'internal_functions_not_public',
    case when exposed_count = 0 then 'PASS' else 'FAIL' end,
    format('PUBLIC/anon/authenticated EXECUTE grants: %s', exposed_count)
  from function_acl_exposure

  union all

  select
    'token_plaintext_column_absent',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('Plaintext token columns found: %s', count(*))
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'intake_links'
    and c.column_name in ('token', 'raw_token', 'plaintext_token', 'token_plaintext')

  union all

  select
    'active_link_unique_index_present',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    format('Matching unique partial indexes: %s', count(*))
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class tbl on tbl.oid = i.indrelid
  join pg_namespace n on n.oid = tbl.relnamespace
  where n.nspname = 'public'
    and tbl.relname = 'intake_links'
    and idx.relname = 'intake_links_one_active_per_company_uidx'
    and i.indisunique
    and i.indpred is not null

  union all

  select
    'bucket_exists',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    format('intake-uploads bucket rows: %s', count(*))
  from storage.buckets b
  where b.id = 'intake-uploads'

  union all

  select
    'bucket_private',
    case when count(*) = 1 then 'PASS' else 'FAIL' end,
    coalesce(
      max(jsonb_build_object(
        'public', b.public,
        'file_size_limit', b.file_size_limit,
        'allowed_mime_types', b.allowed_mime_types
      )::text),
      'Bucket missing'
    )
  from storage.buckets b
  where b.id = 'intake-uploads'
    and b.public = false
    and b.file_size_limit = 10485760
    and b.allowed_mime_types is not null
    and not exists (
      select 1 from expected_mimes em
      where not em.mime_type = any (b.allowed_mime_types)
    )
    and cardinality(b.allowed_mime_types) = 6

  union all

  select
    'bucket_anon_policies_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('anon/PUBLIC storage policies for intake-uploads: %s', count(*))
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.roles && array['anon', 'public']::name[]
    and position(
      'intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
    ) > 0

  union all

  select
    'bucket_direct_policies_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('All direct storage policies for intake-uploads: %s', count(*))
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and position(
      'intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
    ) > 0

  union all

  select
    'storage_objects_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('Objects in intake-uploads: %s', count(*))
  from storage.objects o
  where o.bucket_id = 'intake-uploads'

  union all

  select
    'intake_rows_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('intake_links + payment_intake rows: %s', count(*))
  from (
    select id from public.intake_links
    union all
    select id from public.payment_intake
  ) rows_found

  union all

  select
    'intake_file_rows_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('payment_intake_files rows: %s', count(*))
  from public.payment_intake_files

  union all

  select
    'intake_event_rows_zero',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('payment_intake_events rows: %s', count(*))
  from public.payment_intake_events

  union all

  select
    'notification_events_unchanged',
    'INFO',
    format('Current rows: %s; compare with 02_BACKUP_DEV.sql export', count(*))
  from public.notification_events

  union all

  select
    'payment_requests_unchanged',
    'INFO',
    format('Current rows: %s; compare with 02_BACKUP_DEV.sql export', count(*))
  from public.payment_requests

  union all

  select
    'proveedores_unchanged',
    'INFO',
    format('Current rows: %s; compare with 02_BACKUP_DEV.sql export', count(*))
  from public.proveedores
)
select check_name, check_status, detail
from checks
order by check_name;

commit;
