begin;

do $certify$
begin
  if to_regprocedure('public.materialize_closed_batch_payable_snapshots()') is null then
    raise exception '038_applied_equivalent: materializer missing';
  end if;
  if position('item.director_status = ''approved''' in pg_get_functiondef('public.materialize_closed_batch_payable_snapshots()'::regprocedure)) = 0
     or position('item.finance_release_status = ''released''' in pg_get_functiondef('public.materialize_closed_batch_payable_snapshots()'::regprocedure)) = 0
     or position('create_payable_snapshot_internal' in pg_get_functiondef('public.materialize_closed_batch_payable_snapshots()'::regprocedure)) = 0 then
    raise exception '038_applied_equivalent: released-only contract incomplete';
  end if;
  if has_function_privilege('public','public.materialize_closed_batch_payable_snapshots()','EXECUTE')
     or has_function_privilege('anon','public.materialize_closed_batch_payable_snapshots()','EXECUTE')
     or has_function_privilege('authenticated','public.materialize_closed_batch_payable_snapshots()','EXECUTE')
     or has_function_privilege('service_role','public.materialize_closed_batch_payable_snapshots()','EXECUTE') then
    raise exception '038_applied_equivalent: unexpected grants';
  end if;
  if (select count(*) from public.payable_snapshots) <> 0
     or (select count(*) from public.approval_batches) <> 0
     or (select count(*) from public.approval_batch_items) <> 0
     or (select count(*) from public.payment_layouts) <> 1
     or (select count(*) from public.payment_layout_lines) <> 1
     or (select count(*) from public.payment_receipts) <> 0
     or (select count(*) from public.notification_events) <> 0
     or (select count(*) from public.notification_delivery_attempts) <> 0 then
    raise exception '038_applied_equivalent: business baseline changed';
  end if;
end
$certify$;

commit;
