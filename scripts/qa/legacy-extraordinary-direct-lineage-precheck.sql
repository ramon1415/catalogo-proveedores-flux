-- Read-only DEV precheck for migration 036.
-- It emits no UUIDs, banking identifiers or document metadata.
begin transaction read only;

do $precheck$
declare
  v_total integer;
  v_active integer;
  v_revoked integer;
  v_consumed integer;
  v_quarantined integer;
begin
  select
    count(*),
    count(*) filter (where status = 'active'),
    count(*) filter (where status = 'revoked')
  into v_total, v_active, v_revoked
  from public.payment_request_extraordinary_authorizations;

  select count(*) into v_consumed
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  join public.payment_requests request
    on request.id = extraordinary_auth.payment_request_id
  where extraordinary_auth.status = 'active'
    and request.status::text = 'paid'
    and (
      select count(*)
      from public.payment_request_receipt_links receipt_link
      where receipt_link.payment_request_id = request.id
    ) = 1
    and (
      select count(*)
      from public.payment_request_receipt_links receipt_link
      join public.payment_operation_evidence evidence
        on evidence.id = receipt_link.evidence_id
      join public.payable_snapshots snapshot
        on snapshot.id = receipt_link.snapshot_id
      where receipt_link.payment_request_id = request.id
        and evidence.status = 'shareable'
        and evidence.single_operation_attested
        and evidence.page_count = 1
        and snapshot.payment_request_id = request.id
        and snapshot.source_type = 'extraordinary_authorization'
        and snapshot.source_id = extraordinary_auth.id
        and snapshot.amount_minor = round(request.amount_requested * 100)::bigint
        and snapshot.currency = request.currency
        and receipt_link.amount_minor = snapshot.amount_minor
        and receipt_link.currency = snapshot.currency
    ) = 1
    and not exists (
      select 1
      from public.payment_allocation_items allocation_item
      join public.payable_snapshots allocation_snapshot
        on allocation_snapshot.id = allocation_item.snapshot_id
      where allocation_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_movements movement
      join public.payable_snapshots movement_snapshot
        on movement_snapshot.id = movement.snapshot_id
      where movement_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1 from public.payment_layout_lines layout_line
      where layout_line.payment_request_id = request.id
    )
    and not exists (
      select 1 from public.cash_funds cash_fund
      where cash_fund.payment_request_id = request.id
    );

  select count(*) into v_quarantined
  from public.payment_request_extraordinary_authorizations extraordinary_auth
  join public.payment_requests request
    on request.id = extraordinary_auth.payment_request_id
  where extraordinary_auth.status = 'active'
    and request.status::text <> 'paid'
    and not exists (
      select 1 from public.payment_request_receipt_links receipt_link
      where receipt_link.payment_request_id = request.id
    )
    and not exists (
      select 1 from public.payment_receipts receipt
      where receipt.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_items allocation_item
      join public.payable_snapshots allocation_snapshot
        on allocation_snapshot.id = allocation_item.snapshot_id
      where allocation_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.payment_allocation_movements movement
      join public.payable_snapshots movement_snapshot
        on movement_snapshot.id = movement.snapshot_id
      where movement_snapshot.payment_request_id = request.id
    )
    and not exists (
      select 1 from public.payment_layout_lines layout_line
      where layout_line.payment_request_id = request.id
    )
    and not exists (
      select 1 from public.cash_funds cash_fund
      where cash_fund.payment_request_id = request.id
    )
    and not exists (
      select 1
      from public.approval_batch_items batch_item
      join public.approval_batches batch
        on batch.id = batch_item.batch_id
      where batch_item.payment_request_id = request.id
        and batch.status in ('draft', 'submitted')
    );

  if v_total <> 9
     or v_active <> 8
     or v_revoked <> 1
     or v_consumed <> 7
     or v_quarantined <> 1 then
    raise exception
      'BLOCKED_DIRECT_LEGACY_LINEAGE_MISMATCH total=% active=% revoked=% consumed=% quarantined=%',
      v_total, v_active, v_revoked, v_consumed, v_quarantined;
  end if;
  raise notice 'LEGACY_DIRECT_LINEAGE_PRECHECK_PASS';
end
$precheck$;

with ranked as (
  select
    extraordinary_auth.*,
    row_number() over (
      order by extraordinary_auth.authorized_at, extraordinary_auth.id
    ) as legacy_sequence
  from public.payment_request_extraordinary_authorizations extraordinary_auth
)
select
  'LEG-' || lpad(ranked.legacy_sequence::text, 3, '0') as legacy_case,
  request.status::text as request_status,
  request.amount_requested as amount,
  request.currency,
  left(coalesce(request.request_number, ''), 4) || '-***-' ||
    right(coalesce(request.request_number, ''), 4) as request_folio,
  (
    select count(*)
    from public.payment_request_receipt_links receipt_link
    where receipt_link.payment_request_id = request.id
  ) as direct_receipt_link_count,
  (
    select count(*)
    from public.payment_request_receipt_links receipt_link
    join public.payment_operation_evidence evidence
      on evidence.id = receipt_link.evidence_id
    where receipt_link.payment_request_id = request.id
      and evidence.status = 'shareable'
  ) as shareable_evidence_count,
  (
    select count(*)
    from public.payment_allocation_items allocation_item
    join public.payable_snapshots snapshot
      on snapshot.id = allocation_item.snapshot_id
    where snapshot.payment_request_id = request.id
  ) as direct_allocation_item_count,
  case
    when ranked.status = 'revoked' then 'revoked'
    when request.status::text = 'paid' then 'legacy_consumed_unverified'
    else 'legacy_quarantined'
  end as proposed_classification
from ranked
join public.payment_requests request
  on request.id = ranked.payment_request_id
order by ranked.legacy_sequence;

rollback;
