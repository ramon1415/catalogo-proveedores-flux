\set ON_ERROR_STOP on

set session characteristics as transaction read only;
begin transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $precheck$
declare
  v_function_oid oid;
  v_function_source text;
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
  v_function_source_canonical text;
  v_function_raw_md5 text;
  v_function_raw_sha256 text;
  v_function_canonical_md5 text;
  v_function_canonical_sha256 text;
  v_insert_policy record;
  v_select_policy record;
begin
  if current_setting('transaction_read_only') <> 'on' then
    raise exception '039_precheck: transaction is not read only';
  end if;

  v_function_oid :=
    to_regprocedure(
      'public.extraordinary_evidence_storage_allowed(text,boolean)'
    );
  if v_function_oid is null then
    raise exception '039_precheck: evidence Storage helper is missing';
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

  v_function_source_canonical := btrim(
    replace(v_function_source, E'\r\n', E'\n'),
    E' \t\n\r'
  );
  v_function_raw_md5 := md5(v_function_source);
  v_function_raw_sha256 := encode(
    sha256(convert_to(v_function_source, 'UTF8')),
    'hex'
  );
  v_function_canonical_md5 := md5(v_function_source_canonical);
  v_function_canonical_sha256 := encode(
    sha256(convert_to(v_function_source_canonical, 'UTF8')),
    'hex'
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
    raise exception '039_precheck: evidence Storage helper attributes drifted';
  end if;

  if v_function_canonical_md5 <>
       '1cdbbec6f293ca5a546e3fb993f1a4c4'
     or v_function_canonical_sha256 <>
       '53042a2a564b84c8e19620bbbd487b8e3f33b9a47cc31faadedda992918e978c' then
    raise exception '039_precheck: evidence Storage helper body drifted';
  end if;

  raise notice
    '039_precheck: classification B raw_md5=% raw_sha256=% canonical_md5=% canonical_sha256=%',
    v_function_raw_md5,
    v_function_raw_sha256,
    v_function_canonical_md5,
    v_function_canonical_sha256;

  if lower(v_function_source) ~
       '\m(insert|update|delete|truncate|merge|execute|format)\M'
     or position('set_config' in lower(v_function_source)) > 0
     or position('signed' in lower(v_function_source)) > 0 then
    raise exception '039_precheck: helper is not side-effect-free';
  end if;

  if position(
       'v_actor uuid := public.current_profile_id()'
       in v_function_source
     ) = 0
     or position(
       'if v_actor is null'
       in v_function_source
     ) = 0
     or position(
       'p_name !~ ''^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}$'''
       in v_function_source
     ) = 0
     or position(
       'v_company_id := split_part(p_name, ''/'', 1)::uuid'
       in v_function_source
     ) = 0
     or position(
       'v_authorization_id := split_part(p_name, ''/'', 2)::uuid'
       in v_function_source
     ) = 0
     or position(
       'where id = v_authorization_id'
       in v_function_source
     ) = 0
     or position(
       'company_id = v_company_id'
       in v_function_source
     ) = 0
     or position(
       'evidence_storage_path = p_name'
       in v_function_source
     ) = 0
     or position(
       'if not found then return false; end if'
       in v_function_source
     ) = 0
     or position(
       'if p_write then'
       in v_function_source
     ) = 0
     or position(
       'v_authorization.status = ''draft'''
       in v_function_source
     ) = 0
     or position(
       'v_authorization.authorized_by = v_actor'
       in v_function_source
     ) = 0
     or position(
       'extraordinary_profile_is_active_member'
       in v_function_source
     ) = 0
     or position(
       'v_actor = v_authorization.external_director_profile_id'
       in v_function_source
     ) = 0
     or position(
       'current_user_has_role(public.flux_finance_roles())'
       in v_function_source
     ) = 0
     or position(
       'current_user_has_role(public.flux_sysadmin_roles())'
       in v_function_source
     ) = 0 then
    raise exception '039_precheck: helper authorization contract drifted';
  end if;

  if has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     ) then
    raise exception '039_precheck: authenticated already has EXECUTE';
  end if;
  if has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('public', v_function_oid, 'EXECUTE') then
    raise exception '039_precheck: anon or PUBLIC unexpectedly has EXECUTE';
  end if;

  if v_function_acl is null
     or exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantor <> (
            select role.oid
            from pg_roles role
            where role.rolname = 'postgres'
          )
          or acl.grantee not in (
            (
              select role.oid
              from pg_roles role
              where role.rolname = 'postgres'
            ),
            (
              select role.oid
              from pg_roles role
              where role.rolname = 'service_role'
            )
          )
     )
     or (
       select count(*)
       from aclexplode(v_function_acl) acl
       where acl.privilege_type = 'EXECUTE'
     ) <> 2
     or not exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee = (
           select role.oid
           from pg_roles role
           where role.rolname = 'postgres'
         )
         and not acl.is_grantable
     )
     or not exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee = (
           select role.oid
           from pg_roles role
           where role.rolname = 'service_role'
         )
         and not acl.is_grantable
     ) then
    raise exception '039_precheck: helper ACL contains an unexpected grant';
  end if;

  if obj_description(v_function_oid, 'pg_proc') is not null then
    raise exception '039_precheck: partial 039 function comment already exists';
  end if;

  select *
  into strict v_insert_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'extraordinary_evidence_insert';

  if v_insert_policy.permissive <> 'PERMISSIVE'
     or v_insert_policy.cmd <> 'INSERT'
     or v_insert_policy.roles is distinct from
       array['authenticated']::name[]
     or v_insert_policy.qual is not null
     or v_insert_policy.with_check is distinct from
       '((bucket_id = ''extraordinary-approval-evidence''::text) AND extraordinary_evidence_storage_allowed(name, true))' then
    raise exception '039_precheck: insert policy drifted';
  end if;

  select *
  into strict v_select_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'extraordinary_evidence_select';

  if v_select_policy.permissive <> 'PERMISSIVE'
     or v_select_policy.cmd <> 'SELECT'
     or v_select_policy.roles is distinct from
       array['authenticated']::name[]
     or v_select_policy.with_check is not null
     or v_select_policy.qual is distinct from
       '((bucket_id = ''extraordinary-approval-evidence''::text) AND extraordinary_evidence_storage_allowed(name, false))' then
    raise exception '039_precheck: select policy drifted';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ||
        coalesce(with_check, '')
      ) like '%extraordinary-approval-evidence%'
  ) <> 2 then
    raise exception '039_precheck: unexpected policy targets evidence bucket';
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
  ) then
    raise exception '039_precheck: private evidence bucket drifted';
  end if;

  if exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'extraordinary-approval-evidence'
  ) then
    raise exception '039_precheck: residual evidence objects exist';
  end if;

  if to_regclass(
       'public.payment_request_extraordinary_events'
     ) is null
     or to_regclass(
       'public.extraordinary_payment_policies'
     ) is null
     or to_regprocedure(
       'public.authorize_payment_request_extraordinary(uuid,text,text)'
     ) is null
     or to_regprocedure(
       'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamptz,text)'
     ) is null
     or to_regprocedure(
       'public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)'
     ) is null
     or to_regprocedure(
       'public.assert_extraordinary_payment_confirmation_allowed(uuid,uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.materialize_closed_batch_payable_snapshots()'
  ) is null then
    raise exception '039_precheck: 036-038 object contract is incomplete';
  end if;

  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure(
       'public.current_user_has_role(text[])'
     ) is null
     or to_regprocedure('public.flux_finance_roles()') is null
     or to_regprocedure('public.flux_sysadmin_roles()') is null
     or to_regprocedure(
       'public.extraordinary_profile_is_active_member(uuid,uuid)'
     ) is null then
    raise exception '039_precheck: helper dependency is missing';
  end if;

  if public.flux_sysadmin_roles() is distinct from
       array['sysadmin','system_admin','admin','superadmin']::text[]
     or public.flux_finance_roles() is distinct from
       array[
         'sysadmin',
         'system_admin',
         'admin',
         'superadmin',
         'finance',
         'finanzas',
         'treasury',
         'tesoreria',
         'administracion'
       ]::text[] then
    raise exception '039_precheck: helper role functions drifted';
  end if;

  if exists (
    select 1
    from (
      values
        (to_regprocedure('public.current_profile_id()')),
        (to_regprocedure('public.current_user_has_role(text[])')),
        (to_regprocedure('public.flux_finance_roles()')),
        (to_regprocedure('public.flux_sysadmin_roles()')),
        (
          to_regprocedure(
            'public.extraordinary_profile_is_active_member(uuid,uuid)'
          )
        )
    ) dependency(function_oid)
    join pg_proc dependency_info
      on dependency_info.oid = dependency.function_oid
    join pg_proc helper_info
      on helper_info.oid = v_function_oid
    where age(dependency_info.xmin) < age(helper_info.xmin)
  ) then
    raise exception '039_precheck: helper dependency is newer than 037';
  end if;

  if (
    select dependency_info.xmin
    from pg_proc dependency_info
    where dependency_info.oid =
      'public.extraordinary_profile_is_active_member(uuid,uuid)'::regprocedure
  ) <> (
    select helper_info.xmin
    from pg_proc helper_info
    where helper_info.oid = v_function_oid
  ) then
    raise exception '039_precheck: 037 membership helper transaction drifted';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'EXECUTE'
     ) then
    raise exception '039_precheck: legacy extraordinary RPC is executable';
  end if;

  if (
    select count(*) filter (
      where status = 'legacy_consumed_unverified'
    ) <> 7
       or count(*) filter (
         where status = 'legacy_quarantined'
       ) <> 1
       or count(*) filter (
         where status = 'active'
           and evidence_verified_at is null
       ) <> 0
    from public.payment_request_extraordinary_authorizations
  ) then
    raise exception '039_precheck: legacy classified cohort drifted';
  end if;

  if (
    select count(*)
    from public.payment_request_extraordinary_events event
    where event.event_type = 'legacy_revoked_preserved'
  ) <> 1
  or (
    select count(*)
    from public.payment_request_extraordinary_events event
    join public.payment_request_extraordinary_authorizations authorization_row
      on authorization_row.id = event.authorization_id
    where event.event_type = 'legacy_revoked_preserved'
      and event.idempotency_key =
        'migration-036:revoked:' || authorization_row.id::text
      and event.metadata ->> 'classification_source' =
        'migration_036_governance'
      and event.metadata ->> 'status' = 'revoked'
      and authorization_row.status = 'revoked'
  ) <> 1 then
    raise exception '039_precheck: legacy revoked provenance drifted';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgname =
      'guard_extraordinary_payment_receipt_insert'
      and not trigger_info.tgisinternal
  )
  or not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgname =
      'guard_extraordinary_request_paid'
      and not trigger_info.tgisinternal
  )
  or not exists (
    select 1
    from pg_trigger trigger_info
    where trigger_info.tgname =
      'guard_extraordinary_layout_line_paid'
      and not trigger_info.tgisinternal
  ) then
    raise exception '039_precheck: ratification guard is incomplete';
  end if;

  if position(
       'item.finance_release_status = ''released'''
       in pg_get_functiondef(
         'public.materialize_closed_batch_payable_snapshots()'::regprocedure
       )
     ) = 0 then
    raise exception '039_precheck: migration 038 correction is absent';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception '039_precheck: Operadora extraordinary policy is enabled';
  end if;
end
$precheck$;

\pset format unaligned
\pset tuples_only on

select jsonb_build_object(
  'result', 'MEJ05_039_RECONCILED_PRECHECK_PASS',
  'session_read_only',
    current_setting('default_transaction_read_only'),
  'transaction_read_only',
    current_setting('transaction_read_only'),
  'helper', jsonb_build_object(
    'oid',
      'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure::oid,
    'owner', (
      select pg_get_userbyid(function_info.proowner)
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'identity_arguments', (
      select pg_get_function_identity_arguments(function_info.oid)
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'result', 'boolean',
    'volatility', 'STABLE',
    'parallel', 'UNSAFE',
    'leakproof', false,
    'security_definer', true,
    'strict', false,
    'returns_set', false,
    'search_path', 'public, pg_temp',
    'classification', 'B_LINE_ENDING_OR_OUTER_WHITESPACE_ONLY',
    'raw_body_md5', (
      select md5(function_info.prosrc)
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'raw_body_sha256', (
      select encode(
        sha256(convert_to(function_info.prosrc, 'UTF8')),
        'hex'
      )
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'raw_character_length', (
      select length(function_info.prosrc)
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'raw_octet_length', (
      select octet_length(function_info.prosrc)
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'crlf_count', (
      select (
        length(function_info.prosrc) -
        length(replace(function_info.prosrc, E'\r\n', ''))
      ) / 2
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'canonical_md5', (
      select md5(
        btrim(
          replace(function_info.prosrc, E'\r\n', E'\n'),
          E' \t\n\r'
        )
      )
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'canonical_sha256', (
      select encode(
        sha256(
          convert_to(
            btrim(
              replace(function_info.prosrc, E'\r\n', E'\n'),
              E' \t\n\r'
            ),
            'UTF8'
          )
        ),
        'hex'
      )
      from pg_proc function_info
      where function_info.oid =
        'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
    ),
    'postgres_execute', true,
    'service_role_execute', true,
    'authenticated_execute', false,
    'anon_execute', false,
    'public_execute', false
  ),
  'policies', jsonb_build_object(
    'expected_count', 2,
    'insert_helper_mode', true,
    'select_helper_mode', false
  ),
  'bucket', jsonb_build_object(
    'public', false,
    'file_size_limit', 5242880,
    'mime_count', 4,
    'object_count', (
      select count(*)
      from storage.objects object
      where object.bucket_id = 'extraordinary-approval-evidence'
    )
  ),
  'legacy_distribution', (
    select jsonb_build_object(
      'legacy_consumed_unverified',
        count(*) filter (where status = 'legacy_consumed_unverified'),
      'legacy_quarantined',
        count(*) filter (where status = 'legacy_quarantined'),
      'revoked_total',
        count(*) filter (where status = 'revoked'),
      'legacy_revoked_preserved', (
        select count(*)
        from public.payment_request_extraordinary_events event
        where event.event_type = 'legacy_revoked_preserved'
      ),
      'legacy_active',
        count(*) filter (
          where status = 'active'
            and evidence_verified_at is null
        )
    )
    from public.payment_request_extraordinary_authorizations
  ),
  'baseline_counts', jsonb_build_object(
    'authorizations', (
      select count(*)
      from public.payment_request_extraordinary_authorizations
    ),
    'enabled_policies', (
      select count(*)
      from public.extraordinary_payment_policies
      where enabled
    ),
    'bucket_objects', (
      select count(*)
      from storage.objects
      where bucket_id = 'extraordinary-approval-evidence'
    ),
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
  'dml', 0,
  'ddl', 0,
  'mutable_calls', 0,
  'operational_writes', 0
);

rollback;
