\set ON_ERROR_STOP on

begin;

do $assertions$
declare
  v_privilege text;
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_request_number_key'
      and contype = 'u'
      and convalidated
      and not condeferrable
  ) then
    raise exception 'request number unique constraint missing';
  end if;

  begin
    insert into public.payment_requests (request_number) values ('SOL-2099-0001');
    raise exception 'duplicate request number was accepted';
  exception
    when unique_violation then null;
  end;

  insert into public.payment_requests (request_number)
  values ('SOL-2099-0003'), (null), (null);

  if (select count(*) from public.payment_requests where request_number is null) <> 3 then
    raise exception 'nullable request number lifecycle changed';
  end if;

  if not exists (
    select 1
    from pg_class
    where oid = 'public.zzbackup_proveedores_20260709'::regclass
      and relrowsecurity
      and not relforcerowsecurity
  ) then
    raise exception 'legacy backup RLS contract missing';
  end if;

  if exists (
    select 1
    from pg_policy
    where polrelid = 'public.zzbackup_proveedores_20260709'::regclass
  ) then
    raise exception 'legacy backup unexpectedly has policies';
  end if;

  foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
    if has_table_privilege('anon', 'public.zzbackup_proveedores_20260709', v_privilege)
       or has_table_privilege('authenticated', 'public.zzbackup_proveedores_20260709', v_privilege) then
      raise exception 'application privilege remains: %', v_privilege;
    end if;

    if not has_table_privilege('service_role', 'public.zzbackup_proveedores_20260709', v_privilege) then
      raise exception 'service role privilege lost: %', v_privilege;
    end if;
  end loop;

  if (select count(*) from public.zzbackup_proveedores_20260709) <> 2 then
    raise exception 'legacy backup rows changed';
  end if;

  if (select count(*) from public.notification_events) <> 1
     or (select min(status) from public.notification_events) <> 'synthetic-baseline' then
    raise exception 'notification baseline changed';
  end if;
end
$assertions$;

rollback;

select 'PAYMENT_REQUEST_NUMBER_UNIQUE_PASS=true' as result;
select 'LEGACY_PROVIDER_BACKUP_RLS_PASS=true' as result;
select 'NULL_REQUEST_NUMBER_LIFECYCLE_PRESERVED=true' as result;
select 'NOTIFICATION_REGRESSION_DELTA=0' as result;
