-- Migration 027 precheck. Read-only and DEV-only.

begin transaction read only;

select check_name, check_status, detail
from (
  select
    'migration_025_foundation_present'::text as check_name,
    case when
      to_regclass('public.intake_links') is not null
      and to_regclass('public.payment_intake') is not null
      and to_regclass('public.payment_intake_files') is not null
      and to_regclass('public.payment_intake_events') is not null
      and to_regprocedure('public.next_payment_intake_public_folio()') is not null
    then 'PASS' else 'STOP' end as check_status,
    'four intake tables and folio helper must exist'::text as detail

  union all

  select
    'edge_support_functions_absent',
    case when not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any (array[
          'resolve_provider_intake_link_internal',
          'create_provider_intake_internal',
          'attach_provider_intake_files_internal',
          'mark_provider_intake_upload_issue_internal'
        ]::text[])
    ) then 'PASS' else 'STOP' end,
    'migration 027 must not already exist'

  union all

  select
    'required_roles_present',
    case when not exists (
      select 1
      from unnest(array['anon', 'authenticated', 'service_role']::text[]) expected(role_name)
      where not exists (select 1 from pg_roles r where r.rolname = expected.role_name)
    ) then 'PASS' else 'STOP' end,
    'anon, authenticated, and service_role must exist'

  union all

  select
    'foundation_columns_compatible',
    case when not exists (
      select 1
      from (values
        ('intake_links', 'token_hash'),
        ('intake_links', 'max_submissions_per_day'),
        ('intake_links', 'allowed_file_types'),
        ('intake_links', 'max_file_mb'),
        ('payment_intake', 'submission_fingerprint'),
        ('payment_intake', 'idempotency_key'),
        ('payment_intake', 'client_ip_hash'),
        ('payment_intake', 'captcha_verified_at'),
        ('payment_intake_files', 'storage_path'),
        ('payment_intake_files', 'quarantine_status'),
        ('payment_intake_files', 'sha256'),
        ('payment_intake_events', 'event_type'),
        ('payment_intake_events', 'metadata')
      ) expected(table_name, column_name)
      where not exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = expected.table_name
          and c.column_name = expected.column_name
      )
    ) then 'PASS' else 'STOP' end,
    'columns used by the four service-only RPCs must match migration 025'

  union all

  select
    'foundation_indexes_compatible',
    case when
      to_regclass('public.intake_links_token_hash_uidx') is not null
      and to_regclass('public.payment_intake_idempotency_uidx') is not null
      and to_regclass('public.payment_intake_submission_fingerprint_created_idx') is not null
      and to_regclass('public.payment_intake_files_storage_path_uidx') is not null
    then 'PASS' else 'STOP' end,
    'token, idempotency, fingerprint, and Storage path indexes must exist'

  union all

  select
    'intake_foundation_empty',
    case when
      (select count(*) from public.intake_links) = 0
      and (select count(*) from public.payment_intake) = 0
      and (select count(*) from public.payment_intake_files) = 0
      and (select count(*) from public.payment_intake_events) = 0
    then 'PASS' else 'STOP' end,
    format(
      'links=%s,intakes=%s,files=%s,events=%s',
      (select count(*) from public.intake_links),
      (select count(*) from public.payment_intake),
      (select count(*) from public.payment_intake_files),
      (select count(*) from public.payment_intake_events)
    )

  union all

  select
    'bucket_private_and_empty',
    case when exists (
      select 1 from storage.buckets b
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
    ) and not exists (
      select 1 from storage.objects o where o.bucket_id = 'intake-uploads'
    ) and not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'storage'
        and p.tablename = 'objects'
        and position('intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0
    ) then 'PASS' else 'STOP' end,
    format(
      'bucket_exists=%s,objects=%s',
      exists (select 1 from storage.buckets b where b.id = 'intake-uploads'),
      (select count(*) from storage.objects o where o.bucket_id = 'intake-uploads')
    )

  union all

  select
    'notification_contract_inspected',
    case when to_regprocedure(
      'public.enqueue_notification_event_internal(text,text,uuid,text,text,uuid,text,text,jsonb,text,text)'
    ) is not null then 'INFO' else 'STOP' end,
    'provider_intake.received remains deferred because the current helper accepts only payment request events'
) checks
order by check_name;

commit;
