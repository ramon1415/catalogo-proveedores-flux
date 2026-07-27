\set ON_ERROR_STOP on

do $postcheck$
declare
  v_distribution jsonb;
begin
  select jsonb_object_agg(status, row_count)
  into v_distribution
  from (
    select status, count(*) as row_count
    from public.payment_request_extraordinary_authorizations
    group by status
  ) status_rows;

  if v_distribution is distinct from
      '{"legacy_consumed_unverified": 7, "legacy_quarantined": 1, "revoked": 1}'::jsonb then
    raise exception 'shadow 036 distribution mismatch: %', v_distribution;
  end if;

  if (select count(*) from public.payment_request_extraordinary_events) <> 10 then
    raise exception 'shadow 036 event ledger mismatch';
  end if;

  if (
    select count(*)
    from pg_constraint constraint_info
    where constraint_info.conrelid =
        'public.payment_request_extraordinary_authorizations'::regclass
      and constraint_info.conname like '%status_check'
  ) <> 1
  or not exists (
    select 1
    from pg_constraint constraint_info
    where constraint_info.conrelid =
        'public.payment_request_extraordinary_authorizations'::regclass
      and constraint_info.conname =
        'payment_request_extraordinary_status_check'
  ) then
    raise exception 'shadow 036 canonical status check mismatch';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'execute'
     )
     or has_function_privilege(
       'public',
       'public.authorize_payment_request_extraordinary(uuid,text,text)',
       'execute'
     ) then
    raise exception 'shadow 036 legacy RPC remains executable';
  end if;

  if (
    select status
    from public.payment_allocation_plans
    where id = 'e0000000-0000-4000-8000-000000000001'
  ) is distinct from 'reserved'
  or (
    select status
    from public.payment_allocation_reservations
    where id = '11000000-0000-4000-8000-000000000001'
  ) is distinct from 'active'
  or (
    select status
    from public.bank_payment_operations
    where id = 'c0000000-0000-4000-8000-000000000001'
  ) is distinct from 'reserved'
  or (select count(*) from public.payment_allocation_movements) <> 0 then
    raise exception 'shadow 036 ALLOC-001 changed';
  end if;

  if (select count(*) from public.payment_receipts) <> 0 then
    raise exception 'shadow 036 wrote payment receipts';
  end if;
end
$postcheck$;

select 'SHADOW_036_PASS' as result;
