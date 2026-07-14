-- Consolidated read-only postcheck for migration 027.

begin transaction read only;

with expected_functions(function_name, signature) as (
  values
    ('resolve_provider_intake_link_internal', 'public.resolve_provider_intake_link_internal(text)'),
    ('create_provider_intake_internal', 'public.create_provider_intake_internal(text,jsonb,text,text,text,text,text,integer)'),
    ('attach_provider_intake_files_internal', 'public.attach_provider_intake_files_internal(uuid,jsonb)'),
    ('mark_provider_intake_upload_issue_internal', 'public.mark_provider_intake_upload_issue_internal(uuid,text)')
), function_rows as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (select function_name from expected_functions)
), checks as (
  select
    'migration_025_foundation_present'::text as check_name,
    case when to_regclass('public.payment_intake') is not null
      and to_regprocedure('public.next_payment_intake_public_folio()') is not null
    then 'PASS' else 'FAIL' end as check_status,
    'migration 025 table and folio helper'::text as detail

  union all
  select 'edge_support_functions_exist',
    case when (select count(*) from function_rows) = 4 then 'PASS' else 'FAIL' end,
    format('count=%s', (select count(*) from function_rows))

  union all
  select 'function_signatures_expected',
    case when not exists (
      select 1 from expected_functions e where to_regprocedure(e.signature) is null
    ) then 'PASS' else 'FAIL' end,
    'four canonical signatures'

  union all
  select 'security_definer_preserved',
    case when not exists (select 1 from function_rows f where not f.prosecdef)
      and (select count(*) from function_rows) = 4 then 'PASS' else 'FAIL' end,
    'all four functions are SECURITY DEFINER'

  union all
  select 'search_paths_fixed',
    case when not exists (
      select 1 from function_rows f
      where not exists (
        select 1 from unnest(coalesce(f.proconfig, array[]::text[])) setting
        where setting = 'search_path=public, pg_temp'
      )
    ) and (select count(*) from function_rows) = 4 then 'PASS' else 'FAIL' end,
    'search_path=public, pg_temp'

  union all
  select 'public_execute_zero',
    case when not exists (
      select 1 from function_rows f
      cross join lateral aclexplode(coalesce(
        (select p.proacl from pg_proc p where p.oid = f.oid),
        acldefault('f', (select p.proowner from pg_proc p where p.oid = f.oid))
      )) privilege
      where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
    ) then 'PASS' else 'FAIL' end,
    'PUBLIC execute grants=0'

  union all
  select 'anon_execute_zero',
    case when not exists (
      select 1 from function_rows f
      where has_function_privilege('anon', f.oid, 'EXECUTE')
    ) then 'PASS' else 'FAIL' end,
    'anon execute grants=0'

  union all
  select 'authenticated_execute_zero',
    case when not exists (
      select 1 from function_rows f
      where has_function_privilege('authenticated', f.oid, 'EXECUTE')
    ) then 'PASS' else 'FAIL' end,
    'authenticated execute grants=0'

  union all
  select 'service_role_execute_present',
    case when not exists (
      select 1 from function_rows f
      where not has_function_privilege('service_role', f.oid, 'EXECUTE')
    ) and (select count(*) from function_rows) = 4 then 'PASS' else 'FAIL' end,
    'service_role can execute all four functions'

  union all
  select 'token_plaintext_absent',
    case when not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name in ('intake_links', 'payment_intake', 'payment_intake_files', 'payment_intake_events')
        and c.column_name in ('public_token', 'token', 'captcha_token', 'client_ip', 'user_agent')
    ) then 'PASS' else 'FAIL' end,
    'no plaintext token, CAPTCHA, IP, or User-Agent column'

  union all
  select 'link_lock_present',
    case when exists (
      select 1 from function_rows f
      where f.proname = 'create_provider_intake_internal'
        and lower(f.definition) like '%for update of il%'
    ) then 'PASS' else 'FAIL' end,
    'create RPC serializes on the link row'

  union all
  select 'rate_limit_guard_present',
    case when exists (
      select 1 from function_rows f
      where f.proname = 'create_provider_intake_internal'
        and lower(f.definition) like '%max_submissions_per_day%'
        and lower(f.definition) like '%v_day_start%'
        and lower(f.definition) like '%for update of il%'
    ) then 'PASS' else 'FAIL' end,
    'link daily count occurs under the link lock'

  union all
  select 'ip_rate_limit_guard_present',
    case when exists (
      select 1 from function_rows f
      where f.proname = 'create_provider_intake_internal'
        and lower(f.definition) like '%client_ip_hash%'
        and lower(f.definition) like '%v_ip_submission_count%'
        and lower(f.definition) like '%v_fingerprint_window_start%'
    ) then 'PASS' else 'FAIL' end,
    'HMAC client IP receives a rolling-window cap when available'

  union all
  select 'idempotency_guard_present',
    case when exists (
      select 1 from function_rows f
      where f.proname = 'create_provider_intake_internal'
        and lower(f.definition) like '%idempotency_key%'
        and lower(f.definition) like '%submission_fingerprint%'
    ) then 'PASS' else 'FAIL' end,
    'idempotency hash and fingerprint are both checked'

  union all
  select 'folio_helper_used',
    case when exists (
      select 1 from function_rows f
      where f.proname = 'create_provider_intake_internal'
        and lower(f.definition) like '%next_payment_intake_public_folio()%'
    ) then 'PASS' else 'FAIL' end,
    'canonical folio helper used'

  union all
  select 'intake_tables_unchanged',
    case when (
      select count(*) from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name in ('intake_links', 'payment_intake', 'payment_intake_files', 'payment_intake_events')
    ) = 76 then 'PASS' else 'FAIL' end,
    format('column_count=%s', (
      select count(*) from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name in ('intake_links', 'payment_intake', 'payment_intake_files', 'payment_intake_events')
    ))

  union all
  select 'intake_rls_enabled',
    case when (
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('intake_links', 'payment_intake', 'payment_intake_files', 'payment_intake_events')
        and c.relrowsecurity
    ) = 4 then 'PASS' else 'FAIL' end,
    'RLS enabled on four intake tables'

  union all
  select 'intake_rows_unchanged',
    case when (select count(*) from public.intake_links) = 0
      and (select count(*) from public.payment_intake) = 0 then 'PASS' else 'FAIL' end,
    format('links=%s,intakes=%s', (select count(*) from public.intake_links), (select count(*) from public.payment_intake))

  union all
  select 'intake_files_unchanged',
    case when (select count(*) from public.payment_intake_files) = 0 then 'PASS' else 'FAIL' end,
    format('files=%s', (select count(*) from public.payment_intake_files))

  union all
  select 'intake_events_unchanged',
    case when (select count(*) from public.payment_intake_events) = 0 then 'PASS' else 'FAIL' end,
    format('events=%s', (select count(*) from public.payment_intake_events))

  union all
  select 'bucket_private',
    case when exists (
      select 1
      from storage.buckets b
      where b.id = 'intake-uploads'
        and b.public is false
        and b.file_size_limit = 10485760
        and b.allowed_mime_types @> array[
          'application/pdf', 'application/xml', 'text/xml',
          'image/jpeg', 'image/png', 'image/webp'
        ]::text[]
        and array[
          'application/pdf', 'application/xml', 'text/xml',
          'image/jpeg', 'image/png', 'image/webp'
        ]::text[] @> b.allowed_mime_types
        and cardinality(b.allowed_mime_types) = 6
    ) then 'PASS' else 'FAIL' end,
    'intake-uploads remains private with the six expected MIME types'

  union all
  select 'storage_direct_policy_absent',
    case when not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'storage'
        and p.tablename = 'objects'
        and position('intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0
    ) then 'PASS' else 'FAIL' end,
    'no direct browser policy exists for intake-uploads'

  union all
  select 'storage_object_guard_present',
    case when exists (
      select 1 from function_rows f
      where f.proname = 'attach_provider_intake_files_internal'
        and lower(f.definition) like '%storage.objects%'
        and lower(f.definition) like '%provider_intake_storage_object_missing%'
    ) then 'PASS' else 'FAIL' end,
    'metadata attachment requires an existing private Storage object'

  union all
  select 'storage_objects_unchanged',
    case when not exists (
      select 1 from storage.objects o where o.bucket_id = 'intake-uploads'
    ) then 'PASS' else 'FAIL' end,
    format('objects=%s', (select count(*) from storage.objects o where o.bucket_id = 'intake-uploads'))

  union all
  select 'notification_events_unchanged', 'INFO', format('current=%s; compare with backup', (select count(*) from public.notification_events))
  union all
  select 'payment_requests_unchanged', 'INFO', format('current=%s; compare with backup', (select count(*) from public.payment_requests))
  union all
  select 'proveedores_unchanged', 'INFO', format('current=%s; compare with backup', (select count(*) from public.proveedores))
  union all
  select 'approval_batches_unchanged', 'INFO', format('current=%s; compare with backup', (select count(*) from public.approval_batches))
  union all
  select 'provider_intake_notification_contract', 'INFO', 'BLOCKED/N/A: no notification_events enqueue until dispatcher support is reviewed'
)
select check_name, check_status, detail
from checks
order by check_name;

commit;
