-- Read-only gate for Supabase DEV scsirgbuqjcwoaxfacth.
begin;
set transaction read only;

do $$
declare
  v_source text;
begin
  if to_regprocedure(
    'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)'
  ) is null then
    raise exception 'PRECHECK_035_FAIL: provider catalog RPC is missing';
  end if;

  select lower(function_info.prosrc)
    into v_source
  from pg_proc function_info
  where function_info.oid =
    'public.save_provider_catalog_with_payment_execution_data(uuid,jsonb)'
      ::regprocedure;

  if position(
    'coalesce(v_after.metodo_pago, '''')' in v_source
  ) = 0
     or position(
       'coalesce(v_after.metodo_pago::text, '''')' in v_source
     ) > 0 then
    raise exception 'PRECHECK_035_FAIL: unexpected function fingerprint';
  end if;

  if to_regprocedure(
       'public.add_company_director_for_future_batches(uuid,uuid)'
     ) is null
     or to_regprocedure(
       'public.remove_company_director_for_future_batches(uuid,uuid)'
     ) is null then
    raise exception 'PRECHECK_035_FAIL: migration 034 objects are missing';
  end if;
end
$$;

select
  'PRECHECK_035_PASS' as check_name,
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
