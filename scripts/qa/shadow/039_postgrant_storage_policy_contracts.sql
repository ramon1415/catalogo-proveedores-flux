\set ON_ERROR_STOP on

do $postgrant$
declare
  v_invalid_path_result boolean;
  v_wrong_company_result boolean;
  v_known_path text;
begin
  if not has_function_privilege(
       'authenticated',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     )
     or has_function_privilege(
       'public',
       'public.extraordinary_evidence_storage_allowed(text,boolean)',
       'EXECUTE'
     ) then
    raise exception 'shadow 039 postgrant: ACL is not least privilege';
  end if;

  if md5(pg_get_functiondef(
       'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
     )) <> '4cf587cd26796af6bb9f75c36002757a'
     or encode(sha256(convert_to(pg_get_functiondef(
       'public.extraordinary_evidence_storage_allowed(text,boolean)'::regprocedure
     ), 'UTF8')), 'hex') <>
       '978d2cdac722a202389e151250c5b972a0e1bec43a74e0f5ae59fd1996174cdb' then
    raise exception 'shadow 039 postgrant: helper definition changed';
  end if;

  perform set_config(
    'request.jwt.claim.sub',
    '01000000-0000-4000-8000-000000000003',
    true
  );
  set local role authenticated;

  select public.extraordinary_evidence_storage_allowed(
    'not/a/valid/evidence/path',
    true
  ) into v_invalid_path_result;

  reset role;
  select authorization_row.evidence_storage_path
  into v_known_path
  from public.payment_request_extraordinary_authorizations authorization_row
  where authorization_row.company_id =
      '02000000-0000-4000-8000-000000000001'
    and authorization_row.evidence_storage_path is not null
  order by authorization_row.authorized_at
  limit 1;

  set local role authenticated;
  select public.extraordinary_evidence_storage_allowed(
    v_known_path,
    false
  ) into v_wrong_company_result;
  reset role;

  if v_invalid_path_result is distinct from false
     or v_wrong_company_result is distinct from false then
    raise exception 'shadow 039 postgrant: unauthorized helper call was allowed';
  end if;

  begin
    set local role anon;
    perform public.extraordinary_evidence_storage_allowed(
      'not/a/valid/evidence/path',
      false
    );
    reset role;
    raise exception 'shadow 039 postgrant: anon helper call was not denied';
  exception
    when insufficient_privilege then
      reset role;
  end;

  if (
    select count(*)
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'extraordinary_evidence_insert',
        'extraordinary_evidence_select'
      )
  ) <> 2 then
    raise exception 'shadow 039 postgrant: policies changed';
  end if;

  if not exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'extraordinary-approval-evidence'
      and not bucket.public
      and bucket.file_size_limit = 5242880
  ) then
    raise exception 'shadow 039 postgrant: evidence bucket changed';
  end if;
end
$postgrant$;

select 'SHADOW_039_STORAGE_POLICY_PASS' as result;
