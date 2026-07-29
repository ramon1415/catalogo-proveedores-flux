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
  v_status_constraint text;
  v_revoke_constraint text;
  v_category_constraint text;
  v_reason_constraint text;
  v_status_reference_count integer;
  v_active_index text;
  v_trigger_names text[];
  v_partial_column_count integer;
begin
  if to_regclass('public.payment_request_extraordinary_authorizations') is null
     or to_regclass('public.payment_request_receipt_links') is null
     or to_regclass('public.payment_operation_evidence') is null
     or to_regclass('public.payable_snapshots') is null
     or to_regclass('public.payment_allocation_items') is null
     or to_regprocedure(
       'public.approval_batch_request_has_active_extraordinary(uuid)'
     ) is null
     or to_regprocedure(
       'public.authorize_payment_request_extraordinary(uuid,text,text)'
     ) is null then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT required objects missing';
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_status_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_status_check';

  if v_status_constraint is distinct from
      'CHECK (status = ANY (ARRAY[''active''::text, ''revoked''::text]))' then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT status=%',
      v_status_constraint;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_revoke_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_revoke_check';

  if v_revoke_constraint is distinct from
      'CHECK (status = ''active''::text AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL OR status = ''revoked''::text AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND NULLIF(btrim(revoke_reason), ''''::text) IS NOT NULL)' then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT revoke=%',
      v_revoke_constraint;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_category_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_category_check';

  if v_category_constraint is distinct from
      'CHECK (category = ANY (ARRAY[''operational_emergency''::text, ''urgent_reimbursement''::text, ''urgent_termination''::text, ''critical_service''::text, ''other''::text]))' then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT category=%',
      v_category_constraint;
  end if;

  select pg_get_constraintdef(constraint_info.oid, true)
  into v_reason_constraint
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.conname =
      'payment_request_extraordinary_reason_check';

  if v_reason_constraint is distinct from
      'CHECK (char_length(btrim(reason)) >= 20)' then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT reason=%',
      v_reason_constraint;
  end if;

  select count(*)
  into v_status_reference_count
  from pg_constraint constraint_info
  where constraint_info.conrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and constraint_info.contype = 'c'
    and pg_get_constraintdef(constraint_info.oid, true) ilike '%status%';

  if v_status_reference_count <> 2 then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT status_references=%',
      v_status_reference_count;
  end if;

  select pg_get_indexdef(index_info.indexrelid)
  into v_active_index
  from pg_index index_info
  join pg_class index_class on index_class.oid = index_info.indexrelid
  where index_info.indrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and index_class.relname =
      'payment_request_extraordinary_active_uidx';

  if v_active_index is distinct from
      'CREATE UNIQUE INDEX payment_request_extraordinary_active_uidx ON public.payment_request_extraordinary_authorizations USING btree (payment_request_id) WHERE (status = ''active''::text)' then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT active_index=%',
      v_active_index;
  end if;

  select array_agg(trigger_info.tgname order by trigger_info.tgname)
  into v_trigger_names
  from pg_trigger trigger_info
  where trigger_info.tgrelid =
      'public.payment_request_extraordinary_authorizations'::regclass
    and not trigger_info.tgisinternal;

  if v_trigger_names is distinct from array[
      'enqueue_extraordinary_payment_notification',
      'materialize_extraordinary_payable_snapshot',
      'set_payment_request_extraordinary_updated_at'
    ]::text[] then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT triggers=%',
      v_trigger_names;
  end if;

  select count(*)
  into v_partial_column_count
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payment_request_extraordinary_authorizations'
    and column_name in (
      'legacy_previous_status',
      'legacy_classified_at',
      'legacy_classified_by',
      'legacy_classification_reason',
      'company_id',
      'external_director_profile_id',
      'evidence_storage_path',
      'idempotency_key',
      'consumed_at',
      'ratified_at',
      'disputed_at'
    );

  if v_partial_column_count <> 0
     or to_regclass('public.payment_request_extraordinary_events') is not null
     or to_regclass('public.extraordinary_payment_policies') is not null
     or to_regprocedure(
       'public.begin_extraordinary_authorization(uuid,text,text,uuid,timestamp with time zone,text)'
     ) is not null
     or to_regprocedure(
       'public.finalize_extraordinary_authorization(uuid,text,text,text,bigint,boolean,text)'
     ) is not null then
    raise exception
      'BLOCKED_EXTRAORDINARY_CATALOG_DRIFT partial 036/037 objects';
  end if;

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
  raise notice 'EXTRAORDINARY_CATALOG_INVENTORY_PASS';
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
