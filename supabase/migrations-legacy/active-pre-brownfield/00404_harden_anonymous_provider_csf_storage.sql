begin;

do $migration$
declare
  v_read_policy record;
  v_upload_policy record;
  v_auth_read_before text;
  v_auth_upload_before text;
  v_auth_read_after text;
  v_auth_upload_after text;
  v_read_shape text;
  v_upload_shape text;
  v_read_qual text;
  v_upload_with_check text;
  v_read_non_csf_allowed boolean;
  v_upload_non_csf_allowed boolean;
  v_read_csf_allowed boolean;
  v_upload_csf_allowed boolean;
  v_unknown_count integer;
  v_bucket_public boolean;
begin
  if to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    raise exception '00404_precheck: Supabase Storage objects are unavailable';
  end if;

  lock table storage.objects in share row exclusive mode;

  select "public"
    into v_bucket_public
  from storage.buckets
  where id = 'payment-receipts';

  if not found then
    raise exception '00404_precheck: payment-receipts bucket is missing';
  end if;
  if v_bucket_public then
    raise exception '00404_precheck: payment-receipts bucket must remain private';
  end if;

  select *
    into v_read_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Anon can read payment receipts temporarily';

  if not found then
    raise exception '00404_precheck: exact legacy anon read policy is missing';
  end if;

  select *
    into v_upload_policy
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Anon can upload payment receipts temporarily';

  if not found then
    raise exception '00404_precheck: exact legacy anon upload policy is missing';
  end if;

  if upper(v_read_policy.cmd) <> 'SELECT'
     or upper(v_read_policy.permissive) <> 'PERMISSIVE'
     or v_read_policy.roles <> array['anon']::name[]
     or v_read_policy.with_check is not null then
    raise exception '00404_precheck: legacy anon read policy contract is custom or unknown';
  end if;

  if upper(v_upload_policy.cmd) <> 'INSERT'
     or upper(v_upload_policy.permissive) <> 'PERMISSIVE'
     or v_upload_policy.roles <> array['anon']::name[]
     or v_upload_policy.qual is not null then
    raise exception '00404_precheck: legacy anon upload policy contract is custom or unknown';
  end if;

  v_read_shape := regexp_replace(lower(coalesce(v_read_policy.qual, '')), '[[:space:]()]', '', 'g');
  v_upload_shape := regexp_replace(lower(coalesce(v_upload_policy.with_check, '')), '[[:space:]()]', '', 'g');

  if v_read_shape not in (
       'bucket_id=''payment-receipts''::text',
       'bucket_id=''payment-receipts''::textandname!~~''csf/%''::text'
     ) then
    raise exception '00404_precheck: legacy anon read policy semantics are custom or unknown';
  end if;

  if v_upload_shape not in (
       'bucket_id=''payment-receipts''::text',
       'bucket_id=''payment-receipts''::textandname!~~''csf/%''::text'
     ) then
    raise exception '00404_precheck: legacy anon upload policy semantics are custom or unknown';
  end if;

  select count(*)
    into v_unknown_count
  from pg_policies as policy
  where policy.schemaname = 'storage'
    and policy.tablename = 'objects'
    and policy.policyname not in (
      'Anon can read payment receipts temporarily',
      'Anon can upload payment receipts temporarily'
    )
    and exists (
      select 1
      from unnest(policy.roles) as granted_role(role_name)
      where case
        when granted_role.role_name = 'public' then true
        else pg_has_role('anon', granted_role.role_name, 'member')
      end
    );

  if v_unknown_count <> 0 then
    raise exception '00404_precheck: custom or unknown anon Storage policy can affect provider CSF';
  end if;

  select md5(cmd || '|' || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''))
    into v_auth_read_before
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Authenticated can read provider CSF'
    and upper(cmd) = 'SELECT'
    and roles = array['authenticated']::name[];

  select md5(cmd || '|' || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''))
    into v_auth_upload_before
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Authenticated can upload provider CSF'
    and upper(cmd) = 'INSERT'
    and roles = array['authenticated']::name[];

  if v_auth_read_before is null or v_auth_upload_before is null then
    raise exception '00404_precheck: canonical authenticated CSF policies are missing';
  end if;

  if v_read_shape = 'bucket_id=''payment-receipts''::text' then
    alter policy "Anon can read payment receipts temporarily"
      on storage.objects
      to anon
      using (
        bucket_id = 'payment-receipts'
        and name not like 'csf/%'
      );
  end if;

  if v_upload_shape = 'bucket_id=''payment-receipts''::text' then
    alter policy "Anon can upload payment receipts temporarily"
      on storage.objects
      to anon
      with check (
        bucket_id = 'payment-receipts'
        and name not like 'csf/%'
      );
  end if;

  select qual,
         regexp_replace(lower(coalesce(qual, '')), '[[:space:]()]', '', 'g')
    into v_read_qual, v_read_shape
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Anon can read payment receipts temporarily';

  select with_check,
         regexp_replace(lower(coalesce(with_check, '')), '[[:space:]()]', '', 'g')
    into v_upload_with_check, v_upload_shape
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Anon can upload payment receipts temporarily';

  if v_read_shape <> 'bucket_id=''payment-receipts''::textandname!~~''csf/%''::text'
     or v_upload_shape <> 'bucket_id=''payment-receipts''::textandname!~~''csf/%''::text' then
    raise exception '00404_postcheck: anon provider CSF access was not denied canonically';
  end if;

  execute format(
    'select (%s) is true from (values ($1::text, $2::text)) as policy_row(bucket_id, name)',
    v_read_qual
  ) into v_read_non_csf_allowed using 'payment-receipts', 'legacy/00404.pdf';

  execute format(
    'select (%s) is true from (values ($1::text, $2::text)) as policy_row(bucket_id, name)',
    v_upload_with_check
  ) into v_upload_non_csf_allowed using 'payment-receipts', 'legacy/00404.pdf';

  execute format(
    'select (%s) is true from (values ($1::text, $2::text)) as policy_row(bucket_id, name)',
    v_read_qual
  ) into v_read_csf_allowed using 'payment-receipts', 'csf/00404.pdf';

  execute format(
    'select (%s) is true from (values ($1::text, $2::text)) as policy_row(bucket_id, name)',
    v_upload_with_check
  ) into v_upload_csf_allowed using 'payment-receipts', 'csf/00404.pdf';

  if v_read_non_csf_allowed is not true
     or v_upload_non_csf_allowed is not true
     or v_read_csf_allowed is not false
     or v_upload_csf_allowed is not false then
    raise exception '00404_selftest: expected four policy-expression assertions to pass';
  end if;

  raise notice '00404_selftest: PASS 4/4';

  select md5(cmd || '|' || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''))
    into v_auth_read_after
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Authenticated can read provider CSF';

  select md5(cmd || '|' || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, ''))
    into v_auth_upload_after
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'Authenticated can upload provider CSF';

  if v_auth_read_after is distinct from v_auth_read_before
     or v_auth_upload_after is distinct from v_auth_upload_before then
    raise exception '00404_postcheck: canonical authenticated CSF policies changed unexpectedly';
  end if;

  select "public"
    into v_bucket_public
  from storage.buckets
  where id = 'payment-receipts';

  if v_bucket_public then
    raise exception '00404_postcheck: payment-receipts bucket became public';
  end if;
end
$migration$;

comment on policy "Anon can read payment receipts temporarily" on storage.objects is
  'Legacy payment-receipts compatibility outside csf/. Anonymous provider CSF reads are denied.';

comment on policy "Anon can upload payment receipts temporarily" on storage.objects is
  'Legacy payment-receipts compatibility outside csf/. Anonymous provider CSF uploads are denied.';

commit;
