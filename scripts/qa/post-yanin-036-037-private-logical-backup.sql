-- Private logical backup for DEV immediately before migrations 036/037.
-- Run as a read-only transaction and export the single JSONB cell privately.
begin transaction read only;

with
legacy_requests as (
  select payment_request_id
  from public.payment_request_extraordinary_authorizations
),
legacy_links as (
  select receipt_link.*
  from public.payment_request_receipt_links receipt_link
  where receipt_link.payment_request_id in (
    select payment_request_id from legacy_requests
  )
),
replaced_functions as (
  select procedure.oid
  from pg_proc procedure
  where procedure.oid = any(array_remove(array[
    to_regprocedure(
      'public.authorize_payment_request_extraordinary(uuid,text,text)'
    ),
    to_regprocedure('public.get_payment_request_execution_context(uuid)'),
    to_regprocedure('public.close_approval_batch(uuid)'),
    to_regprocedure(
      'public.approval_batch_request_has_current_direction_approval(uuid)'
    ),
    to_regprocedure('public.approval_batch_payment_layout_candidates(uuid)'),
    to_regprocedure(
      'public.preview_payment_layout_eligibility(uuid,uuid[],date)'
    )
  ], null))
),
affected_triggers as (
  select trigger.oid
  from pg_trigger trigger
  where not trigger.tgisinternal
    and trigger.tgrelid in (
      'public.payment_request_extraordinary_authorizations'::regclass,
      'public.payment_requests'::regclass,
      'public.payment_receipts'::regclass,
      'public.payment_layout_lines'::regclass,
      'public.approval_batch_items'::regclass
    )
)
select jsonb_build_object(
  'backup_contract', 'pre_036_037_private_logical_v1',
  'captured_at', clock_timestamp(),
  'database', current_database(),
  'legacy_authorizations', coalesce((
    select jsonb_agg(to_jsonb(extraordinary_auth) order by extraordinary_auth.authorized_at, extraordinary_auth.id)
    from public.payment_request_extraordinary_authorizations extraordinary_auth
  ), '[]'::jsonb),
  'legacy_requests', coalesce((
    select jsonb_agg(to_jsonb(request) order by request.id)
    from public.payment_requests request
    where request.id in (select payment_request_id from legacy_requests)
  ), '[]'::jsonb),
  'direct_receipt_links', coalesce((
    select jsonb_agg(to_jsonb(receipt_link) order by receipt_link.id)
    from legacy_links receipt_link
  ), '[]'::jsonb),
  'direct_evidence', coalesce((
    select jsonb_agg(to_jsonb(evidence) order by evidence.id)
    from public.payment_operation_evidence evidence
    where evidence.id in (select evidence_id from legacy_links)
  ), '[]'::jsonb),
  'direct_snapshots', coalesce((
    select jsonb_agg(to_jsonb(snapshot) order by snapshot.id)
    from public.payable_snapshots snapshot
    where snapshot.id in (select snapshot_id from legacy_links)
       or snapshot.payment_request_id in (
         select payment_request_id from legacy_requests
       )
  ), '[]'::jsonb),
  'approval_batch_items', coalesce((
    select jsonb_agg(to_jsonb(batch_item) order by batch_item.id)
    from public.approval_batch_items batch_item
  ), '[]'::jsonb),
  'approval_batches', coalesce((
    select jsonb_agg(to_jsonb(batch) order by batch.id)
    from public.approval_batches batch
  ), '[]'::jsonb),
  'allocation_items', coalesce((
    select jsonb_agg(to_jsonb(allocation_item) order by allocation_item.id)
    from public.payment_allocation_items allocation_item
  ), '[]'::jsonb),
  'allocation_plans', coalesce((
    select jsonb_agg(to_jsonb(plan) order by plan.id)
    from public.payment_allocation_plans plan
  ), '[]'::jsonb),
  'allocation_reservations', coalesce((
    select jsonb_agg(to_jsonb(reservation) order by reservation.id)
    from public.payment_allocation_reservations reservation
  ), '[]'::jsonb),
  'bank_operations', coalesce((
    select jsonb_agg(to_jsonb(operation) order by operation.id)
    from public.bank_payment_operations operation
  ), '[]'::jsonb),
  'allocation_movements', coalesce((
    select jsonb_agg(to_jsonb(movement) order by movement.id)
    from public.payment_allocation_movements movement
  ), '[]'::jsonb),
  'linked_payment_receipts', coalesce((
    select jsonb_agg(to_jsonb(receipt) order by receipt.id)
    from public.payment_receipts receipt
    where receipt.payment_request_id in (
      select payment_request_id from legacy_requests
    )
  ), '[]'::jsonb),
  'linked_legacy_receipts', coalesce((
    select jsonb_agg(to_jsonb(legacy_link) order by legacy_link.id)
    from public.legacy_payment_receipt_links legacy_link
  ), '[]'::jsonb),
  'linked_layouts', coalesce((
    select jsonb_agg(to_jsonb(layout_line) order by layout_line.id)
    from public.payment_layout_lines layout_line
    where layout_line.payment_request_id in (
      select payment_request_id from legacy_requests
    )
  ), '[]'::jsonb),
  'linked_cash_funds', coalesce((
    select jsonb_agg(to_jsonb(cash_fund) order by cash_fund.id)
    from public.cash_funds cash_fund
    where cash_fund.payment_request_id in (
      select payment_request_id from legacy_requests
    )
  ), '[]'::jsonb),
  'replaced_function_definitions', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'identity', procedure.oid::regprocedure::text,
        'definition', pg_get_functiondef(procedure.oid)
      )
      order by procedure.oid::regprocedure::text
    )
    from pg_proc procedure
    where procedure.oid in (select oid from replaced_functions)
  ), '[]'::jsonb),
  'affected_trigger_definitions', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'table', trigger.tgrelid::regclass::text,
        'name', trigger.tgname,
        'definition', pg_get_triggerdef(trigger.oid, true)
      )
      order by trigger.tgrelid::regclass::text, trigger.tgname
    )
    from pg_trigger trigger
    where trigger.oid in (select oid from affected_triggers)
  ), '[]'::jsonb)
) as private_logical_backup;

rollback;
