-- Read-only postcheck for Supabase DEV scsirgbuqjcwoaxfacth.
begin;
set transaction read only;

do $$
declare
  v_source text;
  v_security_definer boolean;
  v_config text[];
begin
  select
    lower(function_info.prosrc),
    function_info.prosecdef,
    function_info.proconfig
    into v_source, v_security_definer, v_config
  from pg_proc function_info
  where function_info.oid =
    'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)'
      ::regprocedure;

  if position(
    'coalesce(v_after.metodo_pago, '''')' in v_source
  ) > 0
     or position(
       'coalesce(v_after.metodo_pago::text, '''')' in v_source
     ) = 0 then
    raise exception 'POSTCHECK_035_FAIL: enum validation fix is absent';
  end if;

  if not v_security_definer
     or not exists (
       select 1
       from unnest(coalesce(v_config, array[]::text[])) setting
       where replace(setting, ' ', '') = 'search_path=public,pg_temp'
     ) then
    raise exception 'POSTCHECK_035_FAIL: function security drifted';
  end if;

  if has_function_privilege(
       'public',
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)',
       'execute'
     ) then
    raise exception 'POSTCHECK_035_FAIL: function ACL drifted';
  end if;
end
$$;

select
  'POSTCHECK_035_PASS' as check_name,
  (select count(*) from public.payment_receipts) as payment_receipts_count,
  (select count(*) from public.notification_events) as notification_events_count,
  (
    select count(*)
    from public.notification_delivery_attempts
  ) as delivery_attempts_count,
  (select count(*) from public.approval_batches) as approval_batches_count,
  (
    select count(*)
    from public.approval_batch_items
  ) as approval_batch_items_count,
  (select count(*) from public.payment_layouts) as payment_layouts_count,
  (
    select count(*)
    from public.payment_layout_lines
  ) as payment_layout_lines_count,
  (
    select count(*)
    from public.approval_batch_company_settings
  ) as enforcement_settings_count;

rollback;
