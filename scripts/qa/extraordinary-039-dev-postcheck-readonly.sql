\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $postcheck$
declare
  v_function_oid oid :=
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure;
  v_function_source text;
  v_function_source_canonical text;
  v_function_language name;
  v_function_owner name;
  v_function_identity_arguments text;
  v_function_result text;
  v_function_volatility "char";
  v_function_parallelism "char";
  v_function_leakproof boolean;
  v_function_security_definer boolean;
  v_function_strict boolean;
  v_function_kind "char";
  v_function_returns_set boolean;
  v_function_config text[];
  v_function_acl aclitem[];
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception '039_remote_postcheck: transaction is not read only';
  end if;

  select
    function_info.prosrc,
    language_info.lanname,
    pg_get_userbyid(function_info.proowner),
    pg_get_function_identity_arguments(function_info.oid),
    pg_get_function_result(function_info.oid),
    function_info.provolatile,
    function_info.proparallel,
    function_info.proleakproof,
    function_info.prosecdef,
    function_info.proisstrict,
    function_info.prokind,
    function_info.proretset,
    function_info.proconfig,
    function_info.proacl
  into strict
    v_function_source,
    v_function_language,
    v_function_owner,
    v_function_identity_arguments,
    v_function_result,
    v_function_volatility,
    v_function_parallelism,
    v_function_leakproof,
    v_function_security_definer,
    v_function_strict,
    v_function_kind,
    v_function_returns_set,
    v_function_config,
    v_function_acl
  from pg_proc function_info
  join pg_language language_info on language_info.oid = function_info.prolang
  where function_info.oid = v_function_oid;

  -- Canonicalization is intentionally limited to the observed SQL Editor
  -- CRLF transport and outer whitespace. Interior bytes remain significant.
  v_function_source_canonical := btrim(
    replace(v_function_source, E'\r\n', E'\n'),
    E' \t\n\r'
  );

  if v_function_owner <> 'postgres'
     or v_function_language <> 'plpgsql'
     or v_function_identity_arguments <>
       'p_name text, p_write boolean'
     or v_function_result <> 'boolean'
     or v_function_volatility <> 's'
     or v_function_parallelism <> 'u'
     or v_function_leakproof
     or not v_function_security_definer
     or v_function_strict
     or v_function_kind <> 'f'
     or v_function_returns_set
     or v_function_config is distinct from
       array['search_path=public, pg_temp']::text[] then
    raise exception
      '039_remote_postcheck: helper attributes changed';
  end if;

  if md5(v_function_source_canonical) <>
       '1cdbbec6f293ca5a546e3fb993f1a4c4'
     or encode(
       sha256(convert_to(v_function_source_canonical, 'UTF8')),
       'hex'
     ) <> '53042a2a564b84c8e19620bbbd487b8e3f33b9a47cc31faadedda992918e978c' then
    raise exception
      '039_remote_postcheck: canonical helper body changed';
  end if;

  if not has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       v_function_oid,
       'EXECUTE'
     )
     or not has_function_privilege(
       'postgres',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('public', v_function_oid, 'EXECUTE') then
    raise exception
      '039_remote_postcheck: helper effective ACL is invalid';
  end if;

  if v_function_acl is null
     or exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or not exists (
            select 1
            from pg_roles grantee_role
            where grantee_role.oid = acl.grantee
              and grantee_role.rolname in (
                'postgres',
                'service_role',
                'authenticated'
              )
          )
          or not exists (
            select 1
            from pg_roles grantor_role
            where grantor_role.oid = acl.grantor
              and grantor_role.rolname = 'postgres'
          )
     )
     or (
       select count(*)
       from aclexplode(v_function_acl) acl
     ) <> 3
     or exists (
       select expected_role.rolname
       from (
         values
           ('postgres'::name),
           ('service_role'::name),
           ('authenticated'::name)
       ) expected_role(rolname)
       where not exists (
         select 1
         from aclexplode(v_function_acl) acl
         join pg_roles grantee_role on grantee_role.oid = acl.grantee
         join pg_roles grantor_role on grantor_role.oid = acl.grantor
         where grantee_role.rolname = expected_role.rolname
           and grantor_role.rolname = 'postgres'
           and acl.privilege_type = 'EXECUTE'
           and not acl.is_grantable
       )
     ) then
    raise exception
      '039_remote_postcheck: helper catalog ACL is not exact';
  end if;

  if obj_description(v_function_oid, 'pg_proc') is distinct from
    'Authenticated requires EXECUTE because Storage RLS policies invoke this side-effect-free boolean helper. Authorization remains enforced inside the function and the policies.' then
    raise exception
      '039_remote_postcheck: helper rationale comment is missing';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname = 'extraordinary_evidence_insert'
      and policy.permissive = 'PERMISSIVE'
      and policy.cmd = 'INSERT'
      and policy.roles = array['authenticated']::name[]
      and policy.qual is null
      and policy.with_check =
        '((bucket_id = ''extraordinary-approval-evidence''::text) AND extraordinary_evidence_storage_allowed(name, true))'
  )
  or not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname = 'extraordinary_evidence_select'
      and policy.permissive = 'PERMISSIVE'
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[]
      and policy.with_check is null
      and policy.qual =
        '((bucket_id = ''extraordinary-approval-evidence''::text) AND extraordinary_evidence_storage_allowed(name, false))'
  )
  or (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and lower(
        coalesce(policy.qual, '') ||
        coalesce(policy.with_check, '')
      ) like '%extraordinary-approval-evidence%'
  ) <> 2 then
    raise exception
      '039_remote_postcheck: evidence policies changed';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
      and bucket.name = 'extraordinary-approval-evidence'
      and not bucket.public
      and bucket.file_size_limit = 5242880
      and cardinality(bucket.allowed_mime_types) = 4
      and bucket.allowed_mime_types @> array[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
      ]::text[]
  )
  or exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'extraordinary-approval-evidence'
  ) then
    raise exception
      '039_remote_postcheck: evidence bucket or objects changed';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception
      '039_remote_postcheck: Operadora policy is enabled';
  end if;
end
$postcheck$;

\pset format unaligned
\pset tuples_only on

with helper_catalog as (
  select
    function_info.oid,
    function_info.prosrc,
    language_info.lanname as language_name,
    pg_get_userbyid(function_info.proowner) as owner_name,
    pg_get_function_identity_arguments(
      function_info.oid
    ) as identity_arguments,
    pg_get_function_result(function_info.oid) as result_type,
    function_info.provolatile,
    function_info.proparallel,
    function_info.proleakproof,
    function_info.prosecdef,
    function_info.proisstrict,
    function_info.prokind,
    function_info.proretset,
    function_info.proconfig,
    function_info.proacl
  from pg_proc function_info
  join pg_language language_info on language_info.oid = function_info.prolang
  where function_info.oid =
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
),
helper as (
  select
    helper_catalog.*,
    btrim(
      replace(helper_catalog.prosrc, E'\r\n', E'\n'),
      E' \t\n\r'
    ) as source_canonical
  from helper_catalog
)
select jsonb_build_object(
  'result', 'MIGRATION_039_POSTCHECK_PASS',
  'transaction_read_only',
    current_setting('transaction_read_only'),
  'authenticated_execute',
    has_function_privilege('authenticated', helper.oid, 'EXECUTE'),
  'service_role_execute',
    has_function_privilege('service_role', helper.oid, 'EXECUTE'),
  'postgres_execute',
    has_function_privilege('postgres', helper.oid, 'EXECUTE'),
  'anon_execute',
    has_function_privilege('anon', helper.oid, 'EXECUTE'),
  'public_execute', exists (
    select 1
    from aclexplode(helper.proacl) acl
    where acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'helper_body_md5', md5(helper.prosrc),
  'helper_body_sha256', encode(
    sha256(convert_to(helper.prosrc, 'UTF8')),
    'hex'
  ),
  'helper_body_character_length', length(helper.prosrc),
  'helper_body_octet_length', octet_length(helper.prosrc),
  'helper_body_crlf_count', (
    length(helper.prosrc) -
    length(replace(helper.prosrc, E'\r\n', ''))
  ) / 2,
  'helper_body_bare_lf_count', (
    length(replace(helper.prosrc, E'\r\n', '')) -
    length(replace(
      replace(helper.prosrc, E'\r\n', ''),
      E'\n',
      ''
    ))
  ),
  'helper_canonical_md5', md5(helper.source_canonical),
  'helper_canonical_sha256', encode(
    sha256(convert_to(helper.source_canonical, 'UTF8')),
    'hex'
  ),
  'helper_canonical_character_length',
    length(helper.source_canonical),
  'helper_canonical_octet_length',
    octet_length(helper.source_canonical),
  'helper_reconciliation_classification', case
    when encode(
      sha256(convert_to(helper.prosrc, 'UTF8')),
      'hex'
    ) = '6e7db4df1e8f4aa44ffd2cc710ee49823761b7f801975616945cfb81c9dd475d'
      then 'A_LIVE_MATCHES_APPLIED_RAW'
    else 'B_LINE_ENDING_OR_OUTER_WHITESPACE_ONLY'
  end,
  'helper_attributes', jsonb_build_object(
    'owner', helper.owner_name,
    'language', helper.language_name,
    'identity_arguments', helper.identity_arguments,
    'result', helper.result_type,
    'volatility', helper.provolatile,
    'parallelism', helper.proparallel,
    'leakproof', helper.proleakproof,
    'security_definer', helper.prosecdef,
    'strict', helper.proisstrict,
    'kind', helper.prokind,
    'returns_set', helper.proretset,
    'config', helper.proconfig,
    'acl', helper.proacl::text,
    'comment', obj_description(helper.oid, 'pg_proc')
  ),
  'policy_count', (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and lower(
        coalesce(policy.qual, '') ||
        coalesce(policy.with_check, '')
      ) like '%extraordinary-approval-evidence%'
  ),
  'bucket_private', (
    select not bucket.public
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
  ),
  'bucket_file_size_limit', (
    select bucket.file_size_limit
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
  ),
  'bucket_allowed_mime_types', (
    select bucket.allowed_mime_types
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
  ),
  'bucket_object_count', (
    select count(*)
    from storage.objects
    where bucket_id = 'extraordinary-approval-evidence'
  ),
  'business_counts', jsonb_build_object(
    'payment_requests', (
      select count(*) from public.payment_requests
    ),
    'payment_layouts', (
      select count(*) from public.payment_layouts
    ),
    'payment_layout_lines', (
      select count(*) from public.payment_layout_lines
    ),
    'payment_receipts', (
      select count(*) from public.payment_receipts
    ),
    'paid_requests', (
      select count(*) from public.payment_requests
      where status::text = 'paid'
    ),
    'notification_events', (
      select count(*) from public.notification_events
    ),
    'financial_outbox_events', (
      select count(*) from public.financial_outbox_events
    ),
    'financial_outbox_delivery_attempts', (
      select count(*)
      from public.financial_outbox_delivery_attempts
    )
  ),
  'allocation_integrity', jsonb_build_object(
    'plans_hash', md5(coalesce((
      select string_agg(to_jsonb(plan)::text, '' order by plan.id)
      from public.payment_allocation_plans plan
    ), '')),
    'reservations_hash', md5(coalesce((
      select string_agg(
        to_jsonb(reservation)::text,
        ''
        order by reservation.id
      )
      from public.payment_allocation_reservations reservation
    ), '')),
    'operations_hash', md5(coalesce((
      select string_agg(to_jsonb(operation)::text, '' order by operation.id)
      from public.bank_payment_operations operation
    ), ''))
  )
)
from helper;

rollback;
