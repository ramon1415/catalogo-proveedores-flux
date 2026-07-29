\set ON_ERROR_STOP on

select set_config(
  'request.jwt.claim.sub',
  '01000000-0000-4000-8000-000000000001',
  false
);

do $mixed_close$
declare
  v_result jsonb;
  v_snapshot_count bigint;
begin
  v_result := public.close_approval_batch(
    '38200000-0000-4000-8000-000000000001'::uuid
  );

  if v_result->>'status' <> 'closed'
     or (v_result->>'approved_released_count')::integer <> 2
     or (v_result->>'blocked_count')::integer <> 1 then
    raise exception '038_shadow case A: mixed close result is unexpected';
  end if;

  if (
    select status <> 'closed'
    from public.approval_batches
    where id = '38200000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception '038_shadow case A: batch did not close';
  end if;

  if (
    select count(*) filter (
      where finance_release_status = 'released'
    ) <> 2
       or count(*) filter (
         where finance_release_status = 'blocked'
       ) <> 1
    from public.approval_batch_items
    where batch_id = '38200000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception '038_shadow case A: release classification is not 2/1';
  end if;

  select count(*) into v_snapshot_count
  from public.payable_snapshots snapshot
  join public.approval_batch_items item
    on item.id = snapshot.source_id
   and snapshot.source_type = 'approval_batch_item'
  where item.batch_id = '38200000-0000-4000-8000-000000000001'::uuid;
  if v_snapshot_count <> 2 then
    raise exception '038_shadow case A: expected two snapshots';
  end if;

  if exists (
    select 1
    from public.payable_snapshots snapshot
    join public.approval_batch_items item
      on item.id = snapshot.source_id
     and snapshot.source_type = 'approval_batch_item'
    where item.batch_id =
      '38200000-0000-4000-8000-000000000001'::uuid
      and item.finance_release_status = 'blocked'
  ) then
    raise exception '038_shadow case A/H: blocked item created a snapshot';
  end if;

  update public.approval_batches
  set status = 'closed'
  where id = '38200000-0000-4000-8000-000000000001'::uuid;

  if (
    select count(*) <> v_snapshot_count
    from public.payable_snapshots snapshot
    join public.approval_batch_items item
      on item.id = snapshot.source_id
     and snapshot.source_type = 'approval_batch_item'
    where item.batch_id =
      '38200000-0000-4000-8000-000000000001'::uuid
  ) then
    raise exception '038_shadow case E: idempotent update duplicated snapshots';
  end if;
end
$mixed_close$;

do $all_ready$
declare
  v_result jsonb;
begin
  v_result := public.close_approval_batch(
    '38200000-0000-4000-8000-000000000002'::uuid
  );
  if v_result->>'status' <> 'closed'
     or (v_result->>'approved_released_count')::integer <> 3
     or (v_result->>'blocked_count')::integer <> 0 then
    raise exception '038_shadow case B: all-ready close result is unexpected';
  end if;

  if (
    select count(*) <> 3
    from public.payable_snapshots snapshot
    join public.approval_batch_items item
      on item.id = snapshot.source_id
     and snapshot.source_type = 'approval_batch_item'
    where item.batch_id =
      '38200000-0000-4000-8000-000000000002'::uuid
  ) then
    raise exception '038_shadow case B: expected three snapshots';
  end if;
end
$all_ready$;

do $zero_ready$
begin
  begin
    perform public.close_approval_batch(
      '38200000-0000-4000-8000-000000000003'::uuid
    );
    raise exception '038_shadow case C: zero-ready batch unexpectedly closed';
  exception
    when others then
      if sqlerrm <> 'batch_no_releasable_items' then
        raise;
      end if;
  end;

  if (
    select status <> 'partially_approved'
    from public.approval_batches
    where id = '38200000-0000-4000-8000-000000000003'::uuid
  ) then
    raise exception '038_shadow case C: batch mutation was not rolled back';
  end if;

  if exists (
    select 1
    from public.payable_snapshots snapshot
    join public.approval_batch_items item
      on item.id = snapshot.source_id
     and snapshot.source_type = 'approval_batch_item'
    where item.batch_id =
      '38200000-0000-4000-8000-000000000003'::uuid
  ) then
    raise exception '038_shadow case C: zero-ready batch created snapshots';
  end if;
end
$zero_ready$;

do $released_inconsistent$
begin
  begin
    update public.approval_batches
    set status = 'closed',
        closed_by = '03000000-0000-4000-8000-000000000001'::uuid,
        closed_at = now()
    where id = '38200000-0000-4000-8000-000000000004'::uuid;
    raise exception '038_shadow case D: inconsistent released item was accepted';
  exception
    when others then
      if sqlerrm <> 'snapshot_source_not_currently_payable' then
        raise;
      end if;
  end;

  if (
    select status <> 'approved'
    from public.approval_batches
    where id = '38200000-0000-4000-8000-000000000004'::uuid
  ) then
    raise exception '038_shadow case D: inconsistent release did not roll back';
  end if;

  if exists (
    select 1
    from public.payable_snapshots
    where source_type = 'approval_batch_item'
      and source_id = '38300000-0000-4000-8000-000000000009'::uuid
  ) then
    raise exception '038_shadow case D: inconsistent release created a snapshot';
  end if;
end
$released_inconsistent$;

do $removed_item$
begin
  update public.approval_batches
  set status = 'closed',
      closed_by = '03000000-0000-4000-8000-000000000001'::uuid,
      closed_at = now()
  where id = '38200000-0000-4000-8000-000000000005'::uuid;

  if not exists (
    select 1
    from public.payable_snapshots
    where source_type = 'approval_batch_item'
      and source_id = '38300000-0000-4000-8000-000000000010'::uuid
  ) then
    raise exception '038_shadow case F: active released item was not materialized';
  end if;

  if exists (
    select 1
    from public.payable_snapshots
    where source_type = 'approval_batch_item'
      and source_id = '38300000-0000-4000-8000-000000000011'::uuid
  ) then
    raise exception '038_shadow case F: removed item created a snapshot';
  end if;
end
$removed_item$;

begin;
set local session_replication_role = replica;

insert into public.approval_batches(
  id,
  company_id,
  label,
  period_start,
  period_end,
  status,
  director_id,
  created_by,
  submitted_by,
  submitted_at,
  decided_by,
  decided_at,
  notes
) values (
  '38200000-0000-4000-8000-000000000006',
  '02000000-0000-4000-8000-000000000001',
  'Shadow 038 rejected-release defense',
  current_date - 7,
  current_date + 7,
  'partially_approved',
  '03000000-0000-4000-8000-000000000002',
  '03000000-0000-4000-8000-000000000001',
  '03000000-0000-4000-8000-000000000001',
  now() - interval '2 hours 30 minutes',
  '03000000-0000-4000-8000-000000000002',
  now() - interval '2 hours',
  'Synthetic rejected release defense'
);

alter table public.approval_batch_items
  drop constraint approval_batch_items_finance_release_lifecycle_check;

insert into public.approval_batch_items(
  id,
  batch_id,
  payment_request_id,
  finance_reviewed_by,
  finance_reviewed_at,
  director_status,
  director_reject_reason,
  rebatch_status,
  decided_by,
  decided_at,
  finance_release_status,
  finance_release_reason,
  finance_released_by,
  finance_released_at
) values
  (
    '38300000-0000-4000-8000-000000000012',
    '38200000-0000-4000-8000-000000000006',
    '38100000-0000-4000-8000-000000000012',
    '03000000-0000-4000-8000-000000000001',
    now() - interval '2 hours 15 minutes',
    'approved',
    null,
    'not_applicable',
    '03000000-0000-4000-8000-000000000002',
    now() - interval '2 hours',
    'released',
    null,
    '03000000-0000-4000-8000-000000000001',
    now() - interval '1 hour'
  ),
  (
    '38300000-0000-4000-8000-000000000013',
    '38200000-0000-4000-8000-000000000006',
    '38100000-0000-4000-8000-000000000013',
    '03000000-0000-4000-8000-000000000001',
    now() - interval '2 hours 15 minutes',
    'rejected',
    'Synthetic Direction rejection',
    'blocked',
    '03000000-0000-4000-8000-000000000002',
    now() - interval '2 hours',
    'released',
    null,
    '03000000-0000-4000-8000-000000000001',
    now() - interval '1 hour'
  );

set local session_replication_role = origin;
commit;

do $rejected_defense$
begin
  update public.approval_batches
  set status = 'closed',
      closed_by = '03000000-0000-4000-8000-000000000001'::uuid,
      closed_at = now()
  where id = '38200000-0000-4000-8000-000000000006'::uuid;

  if not exists (
    select 1
    from public.payable_snapshots
    where source_type = 'approval_batch_item'
      and source_id = '38300000-0000-4000-8000-000000000012'::uuid
  ) then
    raise exception '038_shadow case G: valid released item was not materialized';
  end if;

  if exists (
    select 1
    from public.payable_snapshots
    where source_type = 'approval_batch_item'
      and source_id = '38300000-0000-4000-8000-000000000013'::uuid
  ) then
    raise exception '038_shadow case G: rejected item created a snapshot';
  end if;
end
$rejected_defense$;

do $final_assertions$
begin
  if exists (
    select 1
    from public.payment_requests request
    where request.request_number like 'SHADOW-038-%'
      and (request.status::text = 'paid' or request.paid_at is not null)
  ) then
    raise exception '038_shadow: a synthetic request was paid';
  end if;

  if exists (
    select 1
    from public.payment_receipts receipt
    join public.payment_requests request
      on request.id = receipt.payment_request_id
    where request.request_number like 'SHADOW-038-%'
  ) then
    raise exception '038_shadow: a receipt was created';
  end if;
end
$final_assertions$;

select
  'SHADOW_038_MIXED_CLOSE_PASS' as result,
  (
    select count(*)
    from public.payable_snapshots snapshot
    join public.approval_batch_items item
      on item.id = snapshot.source_id
     and snapshot.source_type = 'approval_batch_item'
    join public.payment_requests request
      on request.id = item.payment_request_id
    where request.request_number like 'SHADOW-038-%'
  ) as synthetic_snapshot_count,
  (
    select count(*)
    from public.payment_receipts receipt
    join public.payment_requests request
      on request.id = receipt.payment_request_id
    where request.request_number like 'SHADOW-038-%'
  ) as synthetic_receipt_count;
