begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.payment_requests in share row exclusive mode;
lock table public.zzbackup_proveedores_20260709 in access exclusive mode;

do $precheck$
declare
  v_request_number_attnum smallint;
  v_generator_definition text;
  v_dependency_count integer;
begin
  if to_regclass('public.payment_requests') is null then
    raise exception 'payment_requests_missing';
  end if;

  if to_regclass('public.zzbackup_proveedores_20260709') is null then
    raise exception 'legacy_provider_backup_missing';
  end if;

  select a.attnum
  into v_request_number_attnum
  from pg_attribute a
  where a.attrelid = 'public.payment_requests'::regclass
    and a.attname = 'request_number'
    and a.atttypid = 'text'::regtype
    and a.attnotnull is false
    and a.attisdropped is false;

  if v_request_number_attnum is null then
    raise exception 'payment_requests_request_number_contract_drift';
  end if;

  if exists (
    select 1
    from public.payment_requests
    where request_number is not null
    group by request_number
    having count(*) > 1
  ) then
    raise exception 'payment_requests_request_number_duplicates_present';
  end if;

  if exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.payment_requests'::regclass
      and i.indisunique
      and i.indisvalid
      and i.indpred is null
      and i.indexprs is null
      and i.indnkeyatts = 1
      and i.indkey::smallint[] = array[v_request_number_attnum]::smallint[]
  ) then
    raise exception 'payment_requests_request_number_unique_already_exists';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'payment_requests_request_number_key'
  ) then
    raise exception 'payment_requests_request_number_constraint_name_taken';
  end if;

  if to_regclass('public.payment_request_number_seq') is null
     or to_regprocedure('public.generate_payment_request_number(integer)') is null then
    raise exception 'payment_request_number_generator_contract_missing';
  end if;

  select lower(pg_get_functiondef('public.generate_payment_request_number(integer)'::regprocedure))
  into v_generator_definition;

  if position('nextval(' in v_generator_definition) = 0
     or position('payment_request_number_seq' in v_generator_definition) = 0 then
    raise exception 'payment_request_number_generator_is_not_sequence_backed';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_roles r on r.oid = c.relowner
    where c.oid = 'public.zzbackup_proveedores_20260709'::regclass
      and c.relkind = 'r'
      and r.rolname = 'postgres'
      and c.relrowsecurity is false
      and c.relforcerowsecurity is false
  ) then
    raise exception 'legacy_provider_backup_relation_contract_drift';
  end if;

  if exists (
    select 1
    from pg_policy
    where polrelid = 'public.zzbackup_proveedores_20260709'::regclass
  ) then
    raise exception 'legacy_provider_backup_policy_drift';
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.zzbackup_proveedores_20260709'::regclass
      and not tgisinternal
  ) then
    raise exception 'legacy_provider_backup_trigger_dependency_present';
  end if;

  if exists (
    select 1
    from pg_constraint
    where contype = 'f'
      and (
        conrelid = 'public.zzbackup_proveedores_20260709'::regclass
        or confrelid = 'public.zzbackup_proveedores_20260709'::regclass
      )
  ) then
    raise exception 'legacy_provider_backup_foreign_key_dependency_present';
  end if;

  select count(*)::integer
  into v_dependency_count
  from pg_depend d
  left join pg_rewrite rw
    on d.classid = 'pg_rewrite'::regclass
   and d.objid = rw.oid
  where d.refobjid = 'public.zzbackup_proveedores_20260709'::regclass
    and d.deptype = 'n'
    and (
      d.classid = 'pg_proc'::regclass
      or (d.classid = 'pg_rewrite'::regclass and rw.ev_class <> d.refobjid)
    );

  if v_dependency_count <> 0 or exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and p.prosrc ilike '%zzbackup_proveedores_20260709%'
  ) then
    raise exception 'legacy_provider_backup_runtime_dependency_present';
  end if;

  if not exists (
    select 1
    from pg_roles
    where rolname = 'service_role'
      and rolbypassrls
  ) then
    raise exception 'service_role_bypass_contract_missing';
  end if;

  if not has_table_privilege('service_role', 'public.zzbackup_proveedores_20260709', 'SELECT')
     or not has_table_privilege('anon', 'public.zzbackup_proveedores_20260709', 'SELECT')
     or not has_table_privilege('authenticated', 'public.zzbackup_proveedores_20260709', 'SELECT') then
    raise exception 'legacy_provider_backup_expected_pre_grants_drift';
  end if;
end
$precheck$;

alter table public.payment_requests
  add constraint payment_requests_request_number_key unique (request_number);

alter table public.zzbackup_proveedores_20260709 enable row level security;
revoke all privileges on table public.zzbackup_proveedores_20260709 from public, anon, authenticated;

do $postcheck$
declare
  v_privilege text;
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = c.conkey[1]
    where c.conrelid = 'public.payment_requests'::regclass
      and c.conname = 'payment_requests_request_number_key'
      and c.contype = 'u'
      and c.convalidated
      and not c.condeferrable
      and cardinality(c.conkey) = 1
      and a.attname = 'request_number'
  ) then
    raise exception 'payment_requests_request_number_unique_postcheck_failed';
  end if;

  if exists (
    select 1
    from public.payment_requests
    where request_number is not null
    group by request_number
    having count(*) > 1
  ) then
    raise exception 'payment_requests_request_number_duplicates_after_constraint';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_roles r on r.oid = c.relowner
    where c.oid = 'public.zzbackup_proveedores_20260709'::regclass
      and r.rolname = 'postgres'
      and c.relrowsecurity
      and not c.relforcerowsecurity
  ) then
    raise exception 'legacy_provider_backup_rls_postcheck_failed';
  end if;

  if exists (
    select 1
    from pg_policy
    where polrelid = 'public.zzbackup_proveedores_20260709'::regclass
  ) then
    raise exception 'legacy_provider_backup_unexpected_policy_after_hardening';
  end if;

  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.zzbackup_proveedores_20260709', v_privilege)
       or has_table_privilege('authenticated', 'public.zzbackup_proveedores_20260709', v_privilege) then
      raise exception 'legacy_provider_backup_application_privilege_remains: %', v_privilege;
    end if;

    if not has_table_privilege('service_role', 'public.zzbackup_proveedores_20260709', v_privilege) then
      raise exception 'legacy_provider_backup_service_role_privilege_lost: %', v_privilege;
    end if;
  end loop;

  if exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid = 'public.zzbackup_proveedores_20260709'::regclass
      and acl.grantee = 0
  ) then
    raise exception 'legacy_provider_backup_public_grant_remains';
  end if;
end
$postcheck$;

commit;
