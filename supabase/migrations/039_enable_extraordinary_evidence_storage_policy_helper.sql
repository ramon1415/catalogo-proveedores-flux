-- Flux Operadora - Migration 039
-- Allow authenticated Storage RLS evaluation of the side-effect-free
-- extraordinary evidence authorization helper. No business data is changed.

begin;

do $precheck$
declare
  v_function_oid oid;
  v_function_source text;
  v_function_language name;
  v_function_owner name;
  v_function_result text;
  v_function_volatility "char";
  v_function_security_definer boolean;
  v_function_config text[];
  v_function_acl aclitem[];
  v_insert_policy record;
  v_select_policy record;
begin
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
    pg_get_function_result(function_info.oid),
    function_info.provolatile,
    function_info.prosecdef,
    function_info.proconfig,
    function_info.proacl
  into strict
    v_function_source,
    v_function_language,
    v_function_owner,
    v_function_result,
    v_function_volatility,
    v_function_security_definer,
    v_function_config,
    v_function_acl
  from pg_proc function_info
  join pg_language language_info on language_info.oid = function_info.prolang
  where function_info.oid = v_function_oid;

  if v_function_owner <> 'postgres'
     or v_function_language <> 'plpgsql'
     or v_function_result <> 'boolean'
     or v_function_volatility <> 's'
     or not v_function_security_definer
     or v_function_config is distinct from
       array['search_path=public, pg_temp']::text[] then
    raise exception '039_precheck: evidence Storage helper attributes drifted';
  end if;

  if md5(v_function_source) <>
       '9295f516acb33ab9a9f9e5df67ce707b'
     or encode(
       sha256(convert_to(v_function_source, 'UTF8')),
       'hex'
     ) <> '6e7db4df1e8f4aa44ffd2cc710ee49823761b7f801975616945cfb81c9dd475d' then
    raise exception '039_precheck: evidence Storage helper body drifted';
  end if;

  if lower(v_function_source) ~
       '\m(insert|update|delete|truncate|merge|execute|format)\M'
     or position('set_config' in lower(v_function_source)) > 0
     or position('signed' in lower(v_function_source)) > 0 then
    raise exception '039_precheck: helper is not side-effect-free';
  end if;

  if position(
       'p_name !~ ''^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}$'''
       in v_function_source
     ) = 0
     or position(
       'evidence_storage_path = p_name'
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
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee <> (
           select role.oid
           from pg_roles role
           where role.rolname = 'postgres'
         )
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

  if v_insert_policy.cmd <> 'INSERT'
     or v_insert_policy.roles is distinct from
       array['authenticated']::name[]
     or v_insert_policy.qual is not null
     or position(
       'extraordinary-approval-evidence'
       in coalesce(v_insert_policy.with_check, '')
     ) = 0
     or position(
       'extraordinary_evidence_storage_allowed(name, true)'
       in coalesce(v_insert_policy.with_check, '')
     ) = 0 then
    raise exception '039_precheck: insert policy drifted';
  end if;

  select *
  into strict v_select_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'extraordinary_evidence_select';

  if v_select_policy.cmd <> 'SELECT'
     or v_select_policy.roles is distinct from
       array['authenticated']::name[]
     or v_select_policy.with_check is not null
     or position(
       'extraordinary-approval-evidence'
       in coalesce(v_select_policy.qual, '')
     ) = 0
     or position(
       'extraordinary_evidence_storage_allowed(name, false)'
       in coalesce(v_select_policy.qual, '')
     ) = 0 then
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
         where status = 'revoked'
       ) <> 1
       or count(*) filter (
         where status = 'active'
           and evidence_verified_at is null
       ) <> 0
    from public.payment_request_extraordinary_authorizations
  ) then
    raise exception '039_precheck: legacy 7/1/1 contract drifted';
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

revoke execute
on function public.extraordinary_evidence_storage_allowed(text,boolean)
from public, anon;

grant execute
on function public.extraordinary_evidence_storage_allowed(text,boolean)
to authenticated;

comment on function
  public.extraordinary_evidence_storage_allowed(text,boolean)
is 'Authenticated requires EXECUTE because Storage RLS policies invoke this side-effect-free boolean helper. Authorization remains enforced inside the function and the policies.';

do $postcheck$
declare
  v_function_oid oid :=
    'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure;
  v_function_source text;
  v_function_language name;
  v_function_owner name;
  v_function_result text;
  v_function_volatility "char";
  v_function_security_definer boolean;
  v_function_config text[];
  v_function_acl aclitem[];
begin
  select
    function_info.prosrc,
    language_info.lanname,
    pg_get_userbyid(function_info.proowner),
    pg_get_function_result(function_info.oid),
    function_info.provolatile,
    function_info.prosecdef,
    function_info.proconfig,
    function_info.proacl
  into strict
    v_function_source,
    v_function_language,
    v_function_owner,
    v_function_result,
    v_function_volatility,
    v_function_security_definer,
    v_function_config,
    v_function_acl
  from pg_proc function_info
  join pg_language language_info on language_info.oid = function_info.prolang
  where function_info.oid = v_function_oid;

  if v_function_owner <> 'postgres'
     or v_function_language <> 'plpgsql'
     or v_function_result <> 'boolean'
     or v_function_volatility <> 's'
     or not v_function_security_definer
     or v_function_config is distinct from
       array['search_path=public, pg_temp']::text[]
     or md5(v_function_source) <>
       '9295f516acb33ab9a9f9e5df67ce707b'
     or encode(
       sha256(convert_to(v_function_source, 'UTF8')),
       'hex'
     ) <> '6e7db4df1e8f4aa44ffd2cc710ee49823761b7f801975616945cfb81c9dd475d' then
    raise exception '039_postcheck: helper body or attributes changed';
  end if;

  if not has_function_privilege(
       'authenticated',
       v_function_oid,
       'EXECUTE'
     )
     or has_function_privilege('anon', v_function_oid, 'EXECUTE')
     or has_function_privilege('public', v_function_oid, 'EXECUTE') then
    raise exception '039_postcheck: helper ACL is not least privilege';
  end if;

  if v_function_acl is null
     or exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee not in (
           (
             select role.oid
             from pg_roles role
             where role.rolname = 'postgres'
           ),
           (
             select role.oid
             from pg_roles role
             where role.rolname = 'authenticated'
           )
         )
     )
     or not exists (
       select 1
       from aclexplode(v_function_acl) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee = (
           select role.oid
           from pg_roles role
           where role.rolname = 'authenticated'
         )
         and not acl.is_grantable
     ) then
    raise exception '039_postcheck: helper ACL contains an unexpected grant';
  end if;

  if obj_description(v_function_oid, 'pg_proc') is distinct from
    'Authenticated requires EXECUTE because Storage RLS policies invoke this side-effect-free boolean helper. Authorization remains enforced inside the function and the policies.' then
    raise exception '039_postcheck: helper rationale comment is missing';
  end if;

  if not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname = 'extraordinary_evidence_insert'
      and policy.cmd = 'INSERT'
      and policy.roles = array['authenticated']::name[]
      and policy.qual is null
      and position(
        'extraordinary_evidence_storage_allowed(name, true)'
        in coalesce(policy.with_check, '')
      ) > 0
  )
  or not exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname = 'extraordinary_evidence_select'
      and policy.cmd = 'SELECT'
      and policy.roles = array['authenticated']::name[]
      and policy.with_check is null
      and position(
        'extraordinary_evidence_storage_allowed(name, false)'
        in coalesce(policy.qual, '')
      ) > 0
  ) then
    raise exception '039_postcheck: evidence policies changed';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
      and bucket.name = 'extraordinary-approval-evidence'
      and not bucket.public
      and bucket.file_size_limit = 5242880
      and cardinality(bucket.allowed_mime_types) = 4
  )
  or exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'extraordinary-approval-evidence'
  ) then
    raise exception '039_postcheck: evidence bucket or objects changed';
  end if;

  if exists (
    select 1
    from pg_stat_xact_user_tables table_stats
    where table_stats.n_tup_ins > 0
       or table_stats.n_tup_upd > 0
       or table_stats.n_tup_del > 0
  ) then
    raise exception '039_postcheck: business rows changed during migration';
  end if;

  if exists (
    select 1
    from public.extraordinary_payment_policies policy
    join public.companies company on company.id = policy.company_id
    where policy.enabled
      and lower(coalesce(company.name, '')) like '%operadora%'
  ) then
    raise exception '039_postcheck: Operadora extraordinary policy is enabled';
  end if;
end
$postcheck$;

commit;

select 'MIGRATION_039_POSTCHECK_PASS' as result;
