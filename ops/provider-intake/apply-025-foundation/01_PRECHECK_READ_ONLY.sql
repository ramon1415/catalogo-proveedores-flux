-- Migration 025 manual gate - read-only precheck.
-- Run only in Supabase DEV project scsirgbuqjcwoaxfacth.

begin transaction read only;

with
required_relations(object_name) as (
  values
    ('public.companies'),
    ('public.profiles'),
    ('public.proveedores'),
    ('public.payment_requests'),
    ('public.notification_events'),
    ('storage.buckets'),
    ('storage.objects')
),
required_functions(object_name) as (
  values
    ('public.current_profile_id()'),
    ('public.current_user_has_role(text[])'),
    ('public.flux_sysadmin_roles()'),
    ('public.flux_finance_roles()'),
    ('public.has_active_company_membership(uuid,uuid)'),
    ('public.set_updated_at()')
),
intake_tables(table_name) as (
  values
    ('intake_links'),
    ('payment_intake'),
    ('payment_intake_files'),
    ('payment_intake_events')
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
checks as (
  select
    'required_relations_exist'::text as check_name,
    case when count(*) filter (where to_regclass(object_name) is null) = 0
      then 'PASS' else 'STOP' end as check_status,
    coalesce(
      string_agg(object_name, ', ' order by object_name)
        filter (where to_regclass(object_name) is null),
      'All required relations exist'
    ) as detail
  from required_relations

  union all

  select
    'required_functions_exist',
    case when count(*) filter (where to_regprocedure(object_name) is null) = 0
      then 'PASS' else 'STOP' end,
    coalesce(
      string_agg(object_name, ', ' order by object_name)
        filter (where to_regprocedure(object_name) is null),
      'All canonical helpers exist'
    )
  from required_functions

  union all

  select
    'supabase_roles_exist',
    case when count(*) = 3 then 'PASS' else 'STOP' end,
    format('Found %s of 3 required roles', count(*))
  from pg_roles
  where rolname in ('anon', 'authenticated', 'service_role')

  union all

  select
    'gen_random_uuid_available',
    case when exists (
      select 1
      from pg_proc p
      where p.proname = 'gen_random_uuid'
        and pg_get_function_identity_arguments(p.oid) = ''
    ) then 'PASS' else 'STOP' end,
    'pgcrypto/gen_random_uuid must be available'

  union all

  select
    'intake_tables_absent',
    case when count(*) filter (
      where to_regclass('public.' || table_name) is not null
    ) = 0 then 'PASS' else 'STOP' end,
    coalesce(
      string_agg(table_name, ', ' order by table_name)
        filter (where to_regclass('public.' || table_name) is not null),
      'No intake tables exist before migration 025'
    )
  from intake_tables

  union all

  select
    'intake_helpers_absent',
    case when
      to_regclass('public.payment_intake_public_folio_seq') is null
      and to_regprocedure('public.next_payment_intake_public_folio()') is null
      and to_regprocedure('public.normalize_payment_intake_foundation()') is null
      and to_regprocedure('public.protect_payment_intake_events_immutable()') is null
      then 'PASS' else 'STOP' end,
    'Migration 025 helper names must be unused'

  union all

  select
    'bucket_absent_or_compatible',
    case
      when not exists (
        select 1 from storage.buckets b where b.id = 'intake-uploads'
      ) then 'PASS'
      when exists (
        select 1
        from storage.buckets b
        where b.id = 'intake-uploads'
          and b.name = 'intake-uploads'
          and b.public = false
          and b.file_size_limit = 10485760
          and b.allowed_mime_types is not null
          and not exists (
            select 1
            from expected_mimes em
            where not em.mime_type = any (b.allowed_mime_types)
          )
          and cardinality(b.allowed_mime_types) = 6
      ) then 'PASS'
      else 'STOP'
    end,
    coalesce(
      (
        select jsonb_build_object(
          'exists', true,
          'public', b.public,
          'file_size_limit', b.file_size_limit,
          'allowed_mime_types', b.allowed_mime_types
        )::text
        from storage.buckets b
        where b.id = 'intake-uploads'
      ),
      'Bucket does not exist and can be created by migration 025'
    )

  union all

  select
    'bucket_objects_zero',
    case when count(*) = 0 then 'PASS' else 'STOP' end,
    format('Existing intake-uploads objects: %s', count(*))
  from storage.objects o
  where o.bucket_id = 'intake-uploads'

  union all

  select
    'bucket_policies_zero',
    case when count(*) = 0 then 'PASS' else 'STOP' end,
    format('Existing storage.objects policies that reference intake-uploads: %s', count(*))
  from pg_policies p
  where p.schemaname = 'storage'
    and p.tablename = 'objects'
    and position(
      'intake-uploads' in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
    ) > 0
)
select check_name, check_status, detail
from checks
order by check_name;

commit;
