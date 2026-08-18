\set ON_ERROR_STOP on
do $$
declare v_count integer;
begin
  if public.provider_intake_runtime_mode() <> 'disabled' then raise exception 'default mode is not disabled'; end if;
  perform set_config('app.test_profile_id','11111111-1111-4111-8111-111111111111',false);
  perform set_config('app.test_roles','sysadmin',false);
  if public.provider_intake_internal_access_allowed(null) then raise exception 'disabled mode allowed internal access'; end if;
  if public.provider_intake_public_access_allowed() then raise exception 'disabled mode allowed public access'; end if;

  begin
    update public.provider_intake_runtime_control set mode='unknown' where singleton;
    raise exception 'unknown mode was accepted';
  exception when check_violation then null;
  end;

  update public.provider_intake_runtime_control set mode='sysadmin_only' where singleton;
  if not public.provider_intake_internal_access_allowed(null) then raise exception 'sysadmin denied in pilot'; end if;
  if not public.provider_intake_public_access_allowed() then raise exception 'public token boundary denied in pilot'; end if;

  foreach v_count in array array[1,2,3,4] loop
    perform set_config('app.test_roles', case v_count when 1 then 'finance' when 2 then 'director' when 3 then 'admin' else 'operativo' end, false);
    if public.provider_intake_internal_access_allowed(null) then raise exception 'non-sysadmin allowed in pilot'; end if;
  end loop;
  perform set_config('app.test_roles','',false);
  if public.provider_intake_internal_access_allowed(null) then raise exception 'anonymous-like context allowed internally'; end if;

  update public.provider_intake_runtime_control set mode='disabled' where singleton;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='payment_intake_conversion_drafts') then
    raise exception 'draft table missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='intake_links' and column_name='proveedor_id') then
    raise exception 'provider-aware link column missing';
  end if;
  if to_regprocedure('public.create_provider_intake_link(uuid,text,integer,integer,integer)') is not null
     or to_regprocedure('public.regenerate_provider_intake_link(uuid,boolean,integer)') is not null
     or to_regprocedure('public.resolve_provider_intake_link_internal(text)') is not null then
    raise exception 'obsolete V1 overload present';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname ilike '%notification%' or p.proname ilike '%notify%')) then
    raise exception 'notification delta detected';
  end if;
  if (select count(*) from public.intake_links) <> 0 or (select count(*) from public.payment_intake) <> 0
     or (select count(*) from public.payment_requests) <> 0 or (select count(*) from storage.objects) <> 0 then
    raise exception 'shadow chain created business or storage data';
  end if;
  if (select count(*) from storage.buckets where id='intake-uploads' and public is false and file_size_limit=10485760) <> 1 then
    raise exception 'storage material contract changed';
  end if;
end
$$;

select 'FRESH_PROD_FORWARD_CHAIN_PASS=true' as result;
select 'SYSADMIN_ONLY_GATE_PROVEN=true' as result;
select 'PUBLIC_PROVIDER_LINK_BOUNDARY_PROVEN=true' as result;
select 'PROVIDER_INTAKE_NOTIFICATION_RELEASE_DELTA=0' as result;
