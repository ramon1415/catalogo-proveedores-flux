\set ON_ERROR_STOP on

do $pregrant$
declare
  v_denied boolean := false;
  v_function_oid oid := to_regprocedure(
    'public.extraordinary_evidence_storage_allowed(text,boolean)'
  );
  v_function_source text;
  v_function_acl aclitem[];
begin
  if v_function_oid is null then
    raise exception 'shadow 039 pregrant: helper is missing';
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
    raise exception 'shadow 039 pregrant: live CRLF representation drifted';
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
    raise exception 'shadow 039 pregrant: canonical helper body drifted';
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
    raise exception 'shadow 039 pregrant: helper attributes drifted';
  end if;

  if has_function_privilege(
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
    raise exception 'shadow 039 pregrant: initial privileges drifted';
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
            (select oid from pg_roles where rolname = 'service_role')
          )
     )
     or (
       select count(*)
       from aclexplode(v_function_acl)
     ) <> 2
     or not exists (
       select 1
       from aclexplode(v_function_acl) acl
       join pg_roles role on role.oid = acl.grantee
       where role.rolname = 'postgres'
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     )
     or not exists (
       select 1
       from aclexplode(v_function_acl) acl
       join pg_roles role on role.oid = acl.grantee
       where role.rolname = 'service_role'
         and acl.privilege_type = 'EXECUTE'
         and not acl.is_grantable
     ) then
    raise exception 'shadow 039 pregrant: initial ACL drifted';
  end if;

  if obj_description(v_function_oid, 'pg_proc') is not null then
    raise exception 'shadow 039 pregrant: helper already has 039 comment';
  end if;

  begin
    execute 'set local role authenticated';
    perform public.extraordinary_evidence_storage_allowed(
      'not/a/valid/evidence/path',
      true
    );
  exception
    when insufficient_privilege then
      v_denied := true;
  end;
  reset role;

  if not v_denied then
    raise exception 'shadow 039 pregrant: direct helper call was not denied';
  end if;
end
$pregrant$;

select 'SHADOW_039_PREGRANT_LIVE_BODY_PASS' as result;
