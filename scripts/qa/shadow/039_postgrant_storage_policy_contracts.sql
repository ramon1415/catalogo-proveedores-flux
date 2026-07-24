\set ON_ERROR_STOP on

begin;

set local session_replication_role = replica;

insert into auth.users(id, email)
values (
  '01000000-0000-4000-8000-000000000004',
  'requester-039@example.invalid'
);

insert into public.profiles(
  id,
  auth_user_id,
  full_name,
  email
) values (
  '03000000-0000-4000-8000-000000000004',
  '01000000-0000-4000-8000-000000000004',
  'Shadow Requester 039',
  'requester-039@example.invalid'
);

update public.payment_requests
set requested_by = '03000000-0000-4000-8000-000000000004'
where id = '10000000-0000-4000-8000-000000000008';

update public.payment_request_extraordinary_authorizations
set status = 'draft',
    legacy_previous_status = null,
    legacy_classified_at = null,
    legacy_classified_by = null,
    legacy_classification_reason = null,
    authorized_by = '03000000-0000-4000-8000-000000000001',
    authorized_at = now(),
    revoked_by = null,
    revoked_at = null,
    revoke_reason = null,
    company_id = '02000000-0000-4000-8000-000000000001',
    external_director_profile_id =
      '03000000-0000-4000-8000-000000000002',
    evidence_type = null,
    evidence_storage_bucket = 'extraordinary-approval-evidence',
    evidence_storage_path =
      '02000000-0000-4000-8000-000000000001/' ||
      '20000000-0000-4000-8000-000000000008/evidence/' ||
      '39000000-0000-4000-8000-000000000008',
    evidence_sha256 = null,
    evidence_mime_type = null,
    evidence_size_bytes = null,
    evidence_verified_at = null,
    evidence_match_attested_by = null,
    evidence_match_attested_at = null,
    external_authorized_at = now() - interval '10 minutes',
    valid_until = now() + interval '12 hours',
    ratification_due_at = now() + interval '36 hours',
    idempotency_key = 'shadow-039-helper-fixture'
where id = '20000000-0000-4000-8000-000000000008';

set local session_replication_role = origin;

do $postgrant$
declare
  v_function_oid oid := to_regprocedure(
    'public.extraordinary_evidence_storage_allowed(text,boolean)'
  );
  v_function_source text;
  v_function_acl aclitem[];
  v_valid_path text :=
    '02000000-0000-4000-8000-000000000001/' ||
    '20000000-0000-4000-8000-000000000008/evidence/' ||
    '39000000-0000-4000-8000-000000000008';
  v_wrong_company_path text :=
    '02000000-0000-4000-8000-000000000002/' ||
    '20000000-0000-4000-8000-000000000008/evidence/' ||
    '39000000-0000-4000-8000-000000000008';
  v_wrong_object_path text :=
    '02000000-0000-4000-8000-000000000001/' ||
    '20000000-0000-4000-8000-000000000008/evidence/' ||
    '39000000-0000-4000-8000-000000000009';
  v_actor_null boolean;
  v_invalid_path boolean;
  v_wrong_company boolean;
  v_wrong_object boolean;
  v_finance_write boolean;
  v_director_write boolean;
  v_director_read boolean;
  v_finance_read boolean;
  v_wrong_director_read boolean;
  v_requester_read boolean;
  v_finance_non_owner_write boolean;
  v_inactive_membership_write boolean;
  v_inactive_membership_read boolean;
  v_inactive_profile_write boolean;
  v_inactive_profile_read boolean;
  v_sysadmin_read boolean;
  v_non_draft_write boolean;
  v_anon_denied boolean := false;
begin
  if v_function_oid is null then
    raise exception 'shadow 039 postgrant: helper is missing';
  end if;

  select
    function_info.prosrc,
    function_info.proacl
  into strict
    v_function_source,
    v_function_acl
  from pg_proc function_info
  where function_info.oid = v_function_oid;

  if md5(v_function_source) <>
       'a7879f8dcc683cb5b552387bedb0d499'
     or encode(
       sha256(convert_to(v_function_source, 'UTF8')),
       'hex'
     ) <> 'c3a6a4d1b447323a320f5663bef28a201b420826485f47eba41c0118faf0d86e'
     or octet_length(v_function_source) <> 1289
     or (
       length(v_function_source) -
       length(replace(v_function_source, E'\r\n', ''))
     ) / 2 <> 42
     or position(
       E'\n'
       in replace(v_function_source, E'\r\n', '')
     ) > 0 then
    raise exception 'shadow 039 postgrant: live CRLF representation changed';
  end if;

  if md5(
       btrim(
         replace(v_function_source, E'\r\n', E'\n'),
         E' \t\n\r'
       )
     ) <> '1cdbbec6f293ca5a546e3fb993f1a4c4'
     or encode(
       sha256(
         convert_to(
           btrim(
             replace(v_function_source, E'\r\n', E'\n'),
             E' \t\n\r'
           ),
           'UTF8'
         )
       ),
       'hex'
     ) <> '53042a2a564b84c8e19620bbbd487b8e3f33b9a47cc31faadedda992918e978c' then
    raise exception 'shadow 039 postgrant: canonical helper body changed';
  end if;

  if not exists (
    select 1
    from pg_proc function_info
    join pg_language language_info
      on language_info.oid = function_info.prolang
    where function_info.oid = v_function_oid
      and pg_get_userbyid(function_info.proowner) = 'postgres'
      and language_info.lanname = 'plpgsql'
      and pg_get_function_identity_arguments(function_info.oid) =
        'p_name text, p_write boolean'
      and pg_get_function_result(function_info.oid) = 'boolean'
      and function_info.provolatile = 's'
      and function_info.proparallel = 'u'
      and not function_info.proleakproof
      and function_info.prosecdef
      and not function_info.proisstrict
      and function_info.prokind = 'f'
      and not function_info.proretset
      and function_info.proconfig is not distinct from
        array['search_path=public, pg_temp']::text[]
  ) then
    raise exception 'shadow 039 postgrant: helper attributes changed';
  end if;

  if not has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('public', v_function_oid, 'EXECUTE')
     or not has_function_privilege(
       'service_role',
       v_function_oid,
       'EXECUTE'
     )
     or not has_function_privilege(
       'postgres',
       v_function_oid,
       'EXECUTE'
     ) then
    raise exception 'shadow 039 postgrant: privileges are not exact';
  end if;

  if v_function_acl is null
     or exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type <> 'EXECUTE'
          or acl.is_grantable
          or acl.grantor <> (
            select oid from pg_roles where rolname = 'postgres'
          )
          or acl.grantee not in (
            (select oid from pg_roles where rolname = 'postgres'),
            (select oid from pg_roles where rolname = 'service_role'),
            (select oid from pg_roles where rolname = 'authenticated')
          )
     )
     or (
       select count(*)
       from aclexplode(v_function_acl)
     ) <> 3
     or (
       select count(*)
       from aclexplode(v_function_acl) acl
       join pg_roles role on role.oid = acl.grantee
       where role.rolname in (
         'postgres',
         'service_role',
         'authenticated'
       )
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     ) <> 3 then
    raise exception 'shadow 039 postgrant: ACL is not exact';
  end if;

  if obj_description(v_function_oid, 'pg_proc') is distinct from
    'Authenticated requires EXECUTE because Storage RLS policies invoke this side-effect-free boolean helper. Authorization remains enforced inside the function and the policies.' then
    raise exception 'shadow 039 postgrant: rationale comment changed';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_actor_null;
  reset role;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000001',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    'not/a/valid/evidence/path',
    true
  ) into v_invalid_path;
  select public.extraordinary_evidence_storage_allowed(
    v_wrong_company_path,
    false
  ) into v_wrong_company;
  select public.extraordinary_evidence_storage_allowed(
    v_wrong_object_path,
    false
  ) into v_wrong_object;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    true
  ) into v_finance_write;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_finance_read;
  reset role;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000002',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    true
  ) into v_director_write;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_director_read;
  reset role;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000003',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_wrong_director_read;
  reset role;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000004',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_requester_read;
  reset role;

  if v_actor_null is distinct from false
     or v_invalid_path is distinct from false
     or v_wrong_company is distinct from false
     or v_wrong_object is distinct from false
     or v_finance_write is distinct from true
     or v_finance_read is distinct from true
     or v_director_write is distinct from false
     or v_director_read is distinct from true
     or v_wrong_director_read is distinct from false
     or v_requester_read is distinct from false then
    raise exception 'shadow 039 postgrant: actor/path/mode matrix failed';
  end if;

  set local session_replication_role = replica;
  update public.payment_request_extraordinary_authorizations
  set authorized_by = '03000000-0000-4000-8000-000000000002'
  where id = '20000000-0000-4000-8000-000000000008';
  set local session_replication_role = origin;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000001',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    true
  ) into v_finance_non_owner_write;
  reset role;

  set local session_replication_role = replica;
  update public.payment_request_extraordinary_authorizations
  set authorized_by = '03000000-0000-4000-8000-000000000001'
  where id = '20000000-0000-4000-8000-000000000008';
  update public.profile_company_memberships
  set active = false
  where profile_id = '03000000-0000-4000-8000-000000000001'
    and company_id = '02000000-0000-4000-8000-000000000001';
  set local session_replication_role = origin;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000001',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    true
  ) into v_inactive_membership_write;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_inactive_membership_read;
  reset role;

  if v_finance_non_owner_write is distinct from false
     or v_inactive_membership_write is distinct from false
     or v_inactive_membership_read is distinct from false then
    raise exception 'shadow 039 postgrant: ownership/membership matrix failed';
  end if;

  set local session_replication_role = replica;
  update public.profile_company_memberships
  set active = true
  where profile_id = '03000000-0000-4000-8000-000000000001'
    and company_id = '02000000-0000-4000-8000-000000000001';
  update public.profiles
  set active = false
  where id = '03000000-0000-4000-8000-000000000001';
  set local session_replication_role = origin;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000001',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    true
  ) into v_inactive_profile_write;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_inactive_profile_read;
  reset role;

  if v_inactive_profile_write is distinct from false
     or v_inactive_profile_read is distinct from false then
    raise exception 'shadow 039 postgrant: inactive profile was allowed';
  end if;

  set local session_replication_role = replica;
  update public.profiles
  set active = true
  where id = '03000000-0000-4000-8000-000000000001';
  set local session_replication_role = origin;

  insert into public.user_roles(profile_id, role_id)
  select
    '03000000-0000-4000-8000-000000000003'::uuid,
    role.id
  from public.roles role
  where role.name = 'sysadmin'
  on conflict do nothing;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000003',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    false
  ) into v_sysadmin_read;
  reset role;

  if v_sysadmin_read is distinct from true then
    raise exception 'shadow 039 postgrant: sysadmin read bypass failed';
  end if;

  set local session_replication_role = replica;
  update public.payment_request_extraordinary_authorizations
  set status = 'active',
      evidence_type = 'signed_document',
      evidence_sha256 = repeat('a', 64),
      evidence_mime_type = 'application/pdf',
      evidence_size_bytes = 1024,
      evidence_verified_at = now(),
      evidence_match_attested_by =
        '03000000-0000-4000-8000-000000000001',
      evidence_match_attested_at = now()
  where id = '20000000-0000-4000-8000-000000000008';
  set local session_replication_role = origin;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000001',
    true
  );
  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_valid_path,
    true
  ) into v_non_draft_write;
  reset role;

  if v_non_draft_write is distinct from false then
    raise exception 'shadow 039 postgrant: non-draft write was allowed';
  end if;

  begin
    set local role anon;
    perform public.extraordinary_evidence_storage_allowed(
      v_valid_path,
      false
    );
    reset role;
  exception
    when insufficient_privilege then
      reset role;
      v_anon_denied := true;
  end;

  if not v_anon_denied then
    raise exception 'shadow 039 postgrant: anon helper call was not denied';
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
      and (
        coalesce(policy.qual, '') ||
        coalesce(policy.with_check, '')
      ) like '%extraordinary-approval-evidence%'
  ) <> 2 then
    raise exception 'shadow 039 postgrant: policies changed';
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
    raise exception 'shadow 039 postgrant: bucket or objects changed';
  end if;
end
$postgrant$;

rollback;

select 'SHADOW_039_LIVE_BODY_CONTRACT_PASS' as result;
