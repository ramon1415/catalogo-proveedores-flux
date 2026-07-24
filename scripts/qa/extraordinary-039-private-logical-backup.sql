\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

\pset format unaligned
\pset tuples_only on

with helper_catalog as (
  select
    function_info.oid,
    namespace_info.nspname as schema_name,
    function_info.proname as function_name,
    function_info.prosrc,
    pg_get_functiondef(function_info.oid) as definition,
    pg_get_function_arguments(function_info.oid) as arguments,
    pg_get_function_identity_arguments(
      function_info.oid
    ) as identity_arguments,
    pg_get_function_result(function_info.oid) as result_type,
    language_info.lanname as language_name,
    pg_get_userbyid(function_info.proowner) as owner_name,
    function_info.provolatile,
    function_info.proparallel,
    function_info.proleakproof,
    function_info.prosecdef,
    function_info.proisstrict,
    function_info.prokind,
    function_info.proretset,
    function_info.pronargs,
    function_info.pronargdefaults,
    function_info.proargnames,
    function_info.proargmodes,
    function_info.proconfig,
    function_info.procost,
    function_info.prorows,
    function_info.proacl,
    function_info.xmin::text as catalog_xmin,
    obj_description(function_info.oid, 'pg_proc') as function_comment
  from pg_proc function_info
  join pg_namespace namespace_info
    on namespace_info.oid = function_info.pronamespace
  join pg_language language_info
    on language_info.oid = function_info.prolang
  where function_info.oid =
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
),
helper as (
  select
    helper_catalog.*,
    btrim(
      replace(helper_catalog.prosrc, E'\r\n', E'\n'),
      E' \t\n\r'
    ) as source_canonical,
    btrim(
      replace(helper_catalog.definition, E'\r\n', E'\n'),
      E' \t\n\r'
    ) as definition_canonical
  from helper_catalog
)
select jsonb_build_object(
  'backup_kind', 'EXTRAORDINARY_039_PRIVATE_LOGICAL_BACKUP',
  'helper', jsonb_build_object(
    -- Backward-compatible keys consumed by the one-shot workflow.
    'definition', helper.definition,
    'definition_md5', md5(helper.definition),
    'definition_sha256', encode(
      sha256(convert_to(helper.definition, 'UTF8')),
      'hex'
    ),
    'body_md5', md5(helper.prosrc),
    'body_sha256', encode(
      sha256(convert_to(helper.prosrc, 'UTF8')),
      'hex'
    ),
    'acl', coalesce(helper.proacl::text, '<default>'),
    'owner', helper.owner_name,
    -- Complete private source material and its narrowly canonicalized form.
    'prosrc', helper.prosrc,
    'source_canonical', helper.source_canonical,
    'source_raw_facts', jsonb_build_object(
      'character_length', length(helper.prosrc),
      'octet_length', octet_length(helper.prosrc),
      'crlf_count', (
        length(helper.prosrc) -
        length(replace(helper.prosrc, E'\r\n', ''))
      ) / 2,
      'bare_lf_count', (
        length(replace(helper.prosrc, E'\r\n', '')) -
        length(replace(
          replace(helper.prosrc, E'\r\n', ''),
          E'\n',
          ''
        ))
      ),
      'bare_cr_count', (
        length(replace(helper.prosrc, E'\r\n', '')) -
        length(replace(
          replace(helper.prosrc, E'\r\n', ''),
          E'\r',
          ''
        ))
      ),
      'md5', md5(helper.prosrc),
      'sha256', encode(
        sha256(convert_to(helper.prosrc, 'UTF8')),
        'hex'
      )
    ),
    'source_canonical_facts', jsonb_build_object(
      'canonicalization',
        'CRLF_TO_LF_THEN_OUTER_WHITESPACE_ONLY',
      'character_length', length(helper.source_canonical),
      'octet_length', octet_length(helper.source_canonical),
      'md5', md5(helper.source_canonical),
      'sha256', encode(
        sha256(convert_to(helper.source_canonical, 'UTF8')),
        'hex'
      )
    ),
    'definition_raw_facts', jsonb_build_object(
      'character_length', length(helper.definition),
      'octet_length', octet_length(helper.definition),
      'crlf_count', (
        length(helper.definition) -
        length(replace(helper.definition, E'\r\n', ''))
      ) / 2,
      'bare_lf_count', (
        length(replace(helper.definition, E'\r\n', '')) -
        length(replace(
          replace(helper.definition, E'\r\n', ''),
          E'\n',
          ''
        ))
      ),
      'bare_cr_count', (
        length(replace(helper.definition, E'\r\n', '')) -
        length(replace(
          replace(helper.definition, E'\r\n', ''),
          E'\r',
          ''
        ))
      ),
      'md5', md5(helper.definition),
      'sha256', encode(
        sha256(convert_to(helper.definition, 'UTF8')),
        'hex'
      )
    ),
    'definition_canonical_facts', jsonb_build_object(
      'canonicalization',
        'CRLF_TO_LF_THEN_OUTER_WHITESPACE_ONLY',
      'text', helper.definition_canonical,
      'character_length', length(helper.definition_canonical),
      'octet_length', octet_length(helper.definition_canonical),
      'md5', md5(helper.definition_canonical),
      'sha256', encode(
        sha256(convert_to(helper.definition_canonical, 'UTF8')),
        'hex'
      )
    ),
    'identity', jsonb_build_object(
      'oid', helper.oid,
      'schema', helper.schema_name,
      'name', helper.function_name,
      'signature',
        'public.extraordinary_evidence_storage_allowed(text,boolean)',
      'arguments', helper.arguments,
      'identity_arguments', helper.identity_arguments,
      'result', helper.result_type,
      'language', helper.language_name,
      'owner', helper.owner_name,
      'catalog_xmin', helper.catalog_xmin
    ),
    'attributes', jsonb_build_object(
      'volatility_code', helper.provolatile,
      'volatility', case helper.provolatile
        when 'i' then 'IMMUTABLE'
        when 's' then 'STABLE'
        when 'v' then 'VOLATILE'
      end,
      'parallelism_code', helper.proparallel,
      'parallelism', case helper.proparallel
        when 's' then 'SAFE'
        when 'r' then 'RESTRICTED'
        when 'u' then 'UNSAFE'
      end,
      'leakproof', helper.proleakproof,
      'security_definer', helper.prosecdef,
      'strict', helper.proisstrict,
      'kind_code', helper.prokind,
      'kind', case helper.prokind
        when 'f' then 'FUNCTION'
        when 'p' then 'PROCEDURE'
        when 'a' then 'AGGREGATE'
        when 'w' then 'WINDOW'
      end,
      'returns_set', helper.proretset,
      'argument_count', helper.pronargs,
      'argument_default_count', helper.pronargdefaults,
      'argument_names', helper.proargnames,
      'argument_modes', helper.proargmodes,
      'config', helper.proconfig,
      'cost', helper.procost,
      'rows', helper.prorows,
      'comment', helper.function_comment
    ),
    'acl_entries', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'grantor', grantor_role.rolname,
            'grantee', case
              when acl.grantee = 0 then 'PUBLIC'
              else grantee_role.rolname
            end,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          order by
            acl.grantee,
            acl.privilege_type,
            acl.grantor
        ),
        '[]'::jsonb
      )
      from aclexplode(helper.proacl) acl
      left join pg_roles grantor_role
        on grantor_role.oid = acl.grantor
      left join pg_roles grantee_role
        on grantee_role.oid = acl.grantee
    ),
    'effective_execute', jsonb_build_object(
      'postgres',
        has_function_privilege('postgres', helper.oid, 'EXECUTE'),
      'service_role',
        has_function_privilege('service_role', helper.oid, 'EXECUTE'),
      'authenticated',
        has_function_privilege('authenticated', helper.oid, 'EXECUTE'),
      'anon',
        has_function_privilege('anon', helper.oid, 'EXECUTE'),
      'public_acl_entry', exists (
        select 1
        from aclexplode(helper.proacl) acl
        where acl.grantee = 0
          and acl.privilege_type = 'EXECUTE'
      )
    )
  ),
  'policies', (
    select jsonb_agg(
      jsonb_build_object(
        'name', policy.policyname,
        'permissive', policy.permissive,
        'command', policy.cmd,
        'roles', policy.roles,
        'qual', policy.qual,
        'with_check', policy.with_check
      )
      order by policy.policyname
    )
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'extraordinary_evidence_insert',
        'extraordinary_evidence_select'
      )
  ),
  'bucket', (
    select jsonb_build_object(
      'id', bucket.id,
      'name', bucket.name,
      'public', bucket.public,
      'file_size_limit', bucket.file_size_limit,
      'allowed_mime_types', bucket.allowed_mime_types,
      'object_count', (
        select count(*)
        from storage.objects object
        where object.bucket_id = bucket.id
      )
    )
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
  ),
  'authorization_status_counts', (
    select jsonb_object_agg(status_rows.status, status_rows.row_count)
    from (
      select authorization_row.status, count(*) as row_count
      from public.payment_request_extraordinary_authorizations authorization_row
      group by authorization_row.status
      order by authorization_row.status
    ) status_rows
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
  ),
  'extraordinary_policy_counts', jsonb_build_object(
    'enabled', (
      select count(*)
      from public.extraordinary_payment_policies
      where enabled
    ),
    'operadora_enabled', (
      select count(*)
      from public.extraordinary_payment_policies policy
      join public.companies company on company.id = policy.company_id
      where policy.enabled
        and lower(coalesce(company.name, '')) like '%operadora%'
    )
  ),
  'transaction_read_only',
    current_setting('transaction_read_only')
)
from helper;

rollback;
