-- 033_payment_batch_final_reconciliation.sql
-- Final, operation-atomic reconciliation cutover and private single-page evidence.
-- This migration is versioned only by this change. Applying it requires a separate
-- environment authorization.

begin;

do $precheck$
begin
  if to_regclass('public.payment_allocation_movements') is null
     or to_regclass('public.financial_command_receipts') is null
     or to_regclass('public.financial_outbox_events') is null
     or to_regclass('public.payment_receipts') is null
     or to_regprocedure(
       'public.payment_reconciliation_command_replay(uuid,text,text,text,uuid)'
     ) is null
     or to_regprocedure(
       'public.append_financial_outbox_event_internal(text,text,uuid,uuid,uuid,jsonb,uuid,uuid,text)'
     ) is null then
    raise exception 'payment_batch_032_required';
  end if;

  if to_regclass('public.payment_operation_evidence') is not null
     or to_regclass('public.payment_movement_evidence_links') is not null then
    raise exception 'payment_batch_033_objects_already_exist';
  end if;
end
$precheck$;

alter table public.bank_payment_operations
  drop constraint bank_payment_operations_status_check;
alter table public.bank_payment_operations
  add constraint bank_payment_operations_status_check
  check (status in ('available', 'reserved', 'reconciled', 'cancelled'));

alter table public.payment_allocation_plans
  drop constraint payment_allocation_plans_status_check;
alter table public.payment_allocation_plans
  add constraint payment_allocation_plans_status_check
  check (status in ('draft', 'reserved', 'confirmed', 'cancelled'));

alter table public.payment_allocation_reservations
  drop constraint payment_allocation_reservations_status_check;
alter table public.payment_allocation_reservations
  add constraint payment_allocation_reservations_status_check
  check (status in ('active', 'released', 'cancelled', 'expired', 'consumed'));

create table public.payment_operation_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  batch_id uuid not null references public.payment_ingestion_batches(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  source_document_id uuid not null references public.payment_documents(id),
  source_page_number integer not null,
  version integer not null,
  evidence_kind text not null default 'derived_single_page_pdf',
  status text not null default 'pending_upload',
  storage_bucket text not null default 'payment-batch-documents',
  storage_path text not null,
  source_document_sha256 text not null,
  derived_sha256 text,
  mime_type text not null default 'application/pdf',
  file_size_bytes bigint,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  single_operation_attested boolean not null default false,
  review_reason text,
  constraint payment_operation_evidence_page_check
    check (source_page_number between 1 and 500),
  constraint payment_operation_evidence_version_check check (version > 0),
  constraint payment_operation_evidence_kind_check
    check (evidence_kind = 'derived_single_page_pdf'),
  constraint payment_operation_evidence_status_check
    check (status in ('pending_upload', 'pending_review', 'shareable', 'not_shareable')),
  constraint payment_operation_evidence_bucket_check
    check (storage_bucket = 'payment-batch-documents'),
  constraint payment_operation_evidence_path_check
    check (
      storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
    ),
  constraint payment_operation_evidence_source_sha_check
    check (source_document_sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_operation_evidence_derived_sha_check
    check (derived_sha256 is null or derived_sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_operation_evidence_mime_check check (mime_type = 'application/pdf'),
  constraint payment_operation_evidence_size_check
    check (file_size_bytes is null or file_size_bytes between 1 and 26214400),
  constraint payment_operation_evidence_review_reason_check
    check (
      review_reason is null
      or (
        char_length(review_reason) between 10 and 500
        and review_reason !~ '[[:cntrl:]]'
        and review_reason !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
        and review_reason !~* '[A-Z0-9]{24,}'
      )
    ),
  constraint payment_operation_evidence_lifecycle_check
    check (
      (
        status = 'pending_upload'
        and derived_sha256 is null
        and file_size_bytes is null
        and uploaded_by is null
        and uploaded_at is null
        and reviewed_by is null
        and reviewed_at is null
        and not single_operation_attested
        and review_reason is null
      )
      or (
        status = 'pending_review'
        and derived_sha256 is not null
        and file_size_bytes is not null
        and uploaded_by is not null
        and uploaded_at is not null
        and reviewed_by is null
        and reviewed_at is null
        and not single_operation_attested
        and review_reason is null
      )
      or (
        status = 'shareable'
        and derived_sha256 is not null
        and file_size_bytes is not null
        and uploaded_by is not null
        and uploaded_at is not null
        and reviewed_by is not null
        and reviewed_at is not null
        and single_operation_attested
      )
      or (
        status = 'not_shareable'
        and derived_sha256 is not null
        and file_size_bytes is not null
        and uploaded_by is not null
        and uploaded_at is not null
        and reviewed_by is not null
        and reviewed_at is not null
        and not single_operation_attested
        and review_reason is not null
      )
    ),
  constraint payment_operation_evidence_operation_version_key
    unique (operation_id, version),
  constraint payment_operation_evidence_storage_path_key unique (storage_path)
);

create unique index payment_operation_evidence_open_operation_uidx
  on public.payment_operation_evidence(operation_id)
  where status in ('pending_upload', 'pending_review', 'shareable');

create index payment_operation_evidence_request_lookup_idx
  on public.payment_operation_evidence(operation_id, created_at desc);

create table public.payment_movement_evidence_links (
  movement_id uuid primary key references public.payment_allocation_movements(id),
  evidence_id uuid not null references public.payment_operation_evidence(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  company_id uuid not null references public.companies(id),
  created_at timestamptz not null default now(),
  constraint payment_movement_evidence_operation_key
    unique (movement_id, evidence_id, operation_id)
);

create index payment_movement_evidence_links_evidence_idx
  on public.payment_movement_evidence_links(evidence_id, created_at);

create function public.payment_reconciliation_validate_evidence_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.bank_payment_operations operation
    join public.payment_operation_documents operation_document
      on operation_document.operation_id = operation.id
    join public.payment_documents document
      on document.id = operation_document.document_id
    join public.payment_ingestion_batches batch
      on batch.id = document.batch_id
    where operation.id = new.operation_id
      and operation.company_id = new.company_id
      and operation_document.document_id = new.source_document_id
      and operation_document.page_number = new.source_page_number
      and document.company_id = new.company_id
      and batch.id = new.batch_id
      and batch.company_id = new.company_id
      and batch.document_sha256 = new.source_document_sha256
  ) then
    raise exception 'payment_evidence_scope_mismatch';
  end if;
  return new;
end
$$;

create trigger payment_operation_evidence_validate_scope
  before insert on public.payment_operation_evidence
  for each row execute function public.payment_reconciliation_validate_evidence_scope();

create function public.payment_reconciliation_validate_evidence_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment_operation_evidence_is_append_only';
  end if;

  if new.id is distinct from old.id
     or new.company_id is distinct from old.company_id
     or new.batch_id is distinct from old.batch_id
     or new.operation_id is distinct from old.operation_id
     or new.source_document_id is distinct from old.source_document_id
     or new.source_page_number is distinct from old.source_page_number
     or new.version is distinct from old.version
     or new.evidence_kind is distinct from old.evidence_kind
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.source_document_sha256 is distinct from old.source_document_sha256
     or new.mime_type is distinct from old.mime_type
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_evidence_identity_is_immutable';
  end if;

  if old.status = 'pending_upload' and new.status = 'pending_review' then
    if new.derived_sha256 is null
       or new.file_size_bytes is null
       or new.uploaded_by is null
       or new.uploaded_at is null
       or new.reviewed_by is not null
       or new.reviewed_at is not null then
      raise exception 'payment_evidence_upload_transition_invalid';
    end if;
    return new;
  end if;

  if old.status = 'pending_review'
     and new.status in ('shareable', 'not_shareable') then
    if new.derived_sha256 is distinct from old.derived_sha256
       or new.file_size_bytes is distinct from old.file_size_bytes
       or new.uploaded_by is distinct from old.uploaded_by
       or new.uploaded_at is distinct from old.uploaded_at
       or new.reviewed_by is null
       or new.reviewed_at is null then
      raise exception 'payment_evidence_review_transition_invalid';
    end if;
    return new;
  end if;

  raise exception 'payment_evidence_transition_not_allowed';
end
$$;

create trigger payment_operation_evidence_controlled_updates
  before update or delete on public.payment_operation_evidence
  for each row execute function public.payment_reconciliation_validate_evidence_transition();

create function public.payment_reconciliation_validate_movement_evidence_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.payment_allocation_movements movement
    join public.payment_operation_evidence evidence
      on evidence.id = new.evidence_id
    where movement.id = new.movement_id
      and movement.movement_type = 'confirmation'
      and movement.operation_id = new.operation_id
      and movement.company_id = new.company_id
      and evidence.operation_id = new.operation_id
      and evidence.company_id = new.company_id
      and evidence.status = 'shareable'
  ) then
    raise exception 'payment_movement_evidence_scope_mismatch';
  end if;
  return new;
end
$$;

create trigger payment_movement_evidence_links_validate_scope
  before insert on public.payment_movement_evidence_links
  for each row execute function public.payment_reconciliation_validate_movement_evidence_scope();

create trigger payment_movement_evidence_links_immutable
  before update or delete on public.payment_movement_evidence_links
  for each row execute function public.payment_reconciliation_protect_immutable();

create function public.payment_receipts_reconciliation_cutover_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'legacy_payment_receipts_read_only_after_cutover';
end
$$;

create trigger payment_receipts_read_only_after_reconciliation_cutover
  before insert or update or delete on public.payment_receipts
  for each statement execute function public.payment_receipts_reconciliation_cutover_guard();

create function public.payment_request_confirmed_minor(p_payment_request_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    case movement.movement_type
      when 'confirmation' then movement.amount_minor
      else -movement.amount_minor
    end
  ), 0)::bigint
  from public.payment_allocation_movements movement
  join public.payable_snapshots snapshot on snapshot.id = movement.snapshot_id
  where snapshot.payment_request_id = p_payment_request_id;
$$;

create function public.payment_reconciliation_evidence_storage_path_allowed(
  p_storage_path text,
  p_for_upload boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.payment_operation_evidence evidence
    where evidence.storage_bucket = 'payment-batch-documents'
      and evidence.storage_path = p_storage_path
      and public.current_profile_id() is not null
      and public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.has_active_company_membership(
          public.current_profile_id(),
          evidence.company_id
        )
      )
      and (
        not p_for_upload
        or (
          evidence.status = 'pending_upload'
          and evidence.uploaded_at is null
        )
      )
  );
$$;

create function public.get_payment_operation_confirmation_preview(
  p_operation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.bank_payment_operations%rowtype;
  v_plan public.payment_allocation_plans%rowtype;
  v_reservation public.payment_allocation_reservations%rowtype;
  v_evidence public.payment_operation_evidence%rowtype;
  v_actor uuid;
  v_source record;
  v_confirmed bigint;
  v_remaining bigint;
  v_plan_items integer;
  v_invalid_items integer;
  v_block_reason text;
begin
  select operation.*
    into v_operation
  from public.bank_payment_operations operation
  where operation.id = p_operation_id
     or operation.extraction_id = p_operation_id
  order by case when operation.id = p_operation_id then 0 else 1 end
  limit 1;

  if not found then
    raise exception 'bank_payment_operation_not_found';
  end if;

  v_actor := public.payment_reconciliation_require_finance(v_operation.company_id);

  select *
    into v_plan
  from public.payment_allocation_plans
  where operation_id = v_operation.id
  order by created_at desc, id desc
  limit 1;

  if v_plan.id is not null then
    select *
      into v_reservation
    from public.payment_allocation_reservations
    where plan_id = v_plan.id
    order by created_at desc, id desc
    limit 1;
  end if;

  select *
    into v_evidence
  from public.payment_operation_evidence
  where operation_id = v_operation.id
  order by version desc
  limit 1;

  select
    document.id as document_id,
    document.storage_bucket,
    document.storage_path,
    operation_document.page_number,
    batch.id as batch_id,
    batch.document_sha256
    into v_source
  from public.payment_operation_documents operation_document
  join public.payment_documents document
    on document.id = operation_document.document_id
  join public.payment_ingestion_batches batch
    on batch.id = document.batch_id
  where operation_document.operation_id = v_operation.id
  order by operation_document.page_number, document.id
  limit 1;

  v_confirmed := public.payment_operation_confirmed_minor(v_operation.id);
  v_remaining := v_operation.amount_minor - v_confirmed;

  select count(*)::integer,
    count(*) filter (
      where item.amount_minor <= 0
         or item.currency <> v_operation.currency
         or snapshot.currency <> v_operation.currency
         or snapshot.company_id <> v_operation.company_id
         or item.amount_minor >
           snapshot.amount_minor
             - public.payment_request_confirmed_minor(snapshot.payment_request_id)
         or not public.payment_reconciliation_snapshot_is_payable(snapshot.id)
         or exists (
           select 1
           from public.payable_snapshots newer
           where newer.payment_request_id = snapshot.payment_request_id
             and newer.version > snapshot.version
         )
    )::integer
    into v_plan_items, v_invalid_items
  from public.payment_allocation_items item
  join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
  where item.plan_id = v_plan.id;

  v_block_reason := case
    when v_operation.status = 'reconciled' then 'bank_operation_already_reconciled'
    when v_operation.status <> 'reserved' then 'bank_operation_not_reserved'
    when v_plan.id is null or v_plan.status <> 'reserved'
      then 'payment_allocation_plan_not_reserved'
    when coalesce(v_plan_items, 0) = 0 then 'payment_allocation_items_required'
    when coalesce(v_invalid_items, 0) > 0 then 'payment_allocation_items_stale'
    when v_plan.total_amount_minor <> v_remaining
      then 'operation_requires_full_atomic_allocation'
    when v_reservation.id is null or v_reservation.status <> 'active'
      then 'payment_reservation_not_active'
    when v_reservation.expires_at <= now() then 'payment_reservation_expired'
    when v_reservation.created_by <> v_actor
      then 'payment_reservation_owned_by_another_actor'
    when v_reservation.amount_minor <> v_plan.total_amount_minor
      then 'payment_reservation_amount_mismatch'
    when v_evidence.id is null or v_evidence.status <> 'shareable'
      then 'shareable_single_page_evidence_required'
    else null
  end;

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'operation_status', v_operation.status,
    'amount_minor', v_operation.amount_minor,
    'confirmed_minor', v_confirmed,
    'remaining_minor', v_remaining,
    'currency', v_operation.currency,
    'application_date', v_operation.application_date,
    'reference_hint', right(v_operation.bank_unique_folio, 6),
    'plan', case when v_plan.id is null then null else jsonb_build_object(
      'id', v_plan.id,
      'status', v_plan.status,
      'total_amount_minor', v_plan.total_amount_minor,
      'currency', v_plan.currency,
      'items', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', item.id,
          'position', item.position,
          'snapshot_id', item.snapshot_id,
          'payment_request_id', snapshot.payment_request_id,
          'request_number', request.request_number,
          'amount_minor', item.amount_minor,
          'currency', item.currency
        ) order by item.position)
        from public.payment_allocation_items item
        join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
        join public.payment_requests request on request.id = snapshot.payment_request_id
        where item.plan_id = v_plan.id
      ), '[]'::jsonb)
    ) end,
    'reservation', case when v_reservation.id is null then null else jsonb_build_object(
      'id', v_reservation.id,
      'status', case
        when v_reservation.status = 'active' and v_reservation.expires_at <= now()
          then 'expired'
        else v_reservation.status
      end,
      'expires_at', v_reservation.expires_at,
      'owned_by_current_actor', v_reservation.created_by = v_actor
    ) end,
    'source_document', case when v_source.document_id is null then null else jsonb_build_object(
      'id', v_source.document_id,
      'batch_id', v_source.batch_id,
      'storage_bucket', v_source.storage_bucket,
      'storage_path', v_source.storage_path,
      'page_number', v_source.page_number,
      'document_sha256', v_source.document_sha256
    ) end,
    'evidence', case when v_evidence.id is null then null else jsonb_build_object(
      'id', v_evidence.id,
      'version', v_evidence.version,
      'status', v_evidence.status,
      'storage_bucket', v_evidence.storage_bucket,
      'storage_path', v_evidence.storage_path,
      'derived_sha256', v_evidence.derived_sha256,
      'file_size_bytes', v_evidence.file_size_bytes,
      'single_operation_attested', v_evidence.single_operation_attested,
      'reviewed_at', v_evidence.reviewed_at,
      'review_reason', v_evidence.review_reason
    ) end,
    'can_prepare_evidence',
      v_operation.status = 'reserved'
      and v_plan.status = 'reserved'
      and v_reservation.status = 'active'
      and v_reservation.expires_at > now()
      and v_reservation.created_by = v_actor
      and (
        v_evidence.id is null
        or v_evidence.status in ('pending_upload', 'not_shareable')
      ),
    'can_confirm', v_block_reason is null,
    'confirmation_block_reason', v_block_reason,
    'external_provider_access', false,
    'external_provider_block_reason', 'provider_identity_link_not_implemented'
  );
end
$$;

create function public.prepare_payment_operation_evidence(
  p_operation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.bank_payment_operations%rowtype;
  v_plan public.payment_allocation_plans%rowtype;
  v_reservation public.payment_allocation_reservations%rowtype;
  v_actor uuid;
  v_source record;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_evidence_id uuid := gen_random_uuid();
  v_version integer;
  v_storage_path text;
  v_result jsonb;
begin
  select * into v_operation
  from public.bank_payment_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;

  v_actor := public.payment_reconciliation_require_finance(v_operation.company_id);
  v_payload := jsonb_build_object('operation_id', v_operation.id);
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_operation.company_id,
    'payment_evidence.prepare',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_plan
  from public.payment_allocation_plans
  where operation_id = v_operation.id and status = 'reserved'
  order by proposed_at desc, id desc
  limit 1
  for update;
  if not found then raise exception 'payment_allocation_plan_not_reserved'; end if;

  select * into v_reservation
  from public.payment_allocation_reservations
  where plan_id = v_plan.id and status = 'active'
  order by created_at desc, id desc
  limit 1
  for update;
  if not found then raise exception 'payment_reservation_not_active'; end if;
  if v_reservation.expires_at <= clock_timestamp() then
    raise exception 'payment_reservation_expired';
  end if;
  if v_reservation.created_by <> v_actor then
    raise exception 'payment_reservation_owned_by_another_actor';
  end if;

  if exists (
    select 1 from public.payment_operation_evidence
    where operation_id = v_operation.id
      and status in ('pending_upload', 'pending_review', 'shareable')
  ) then
    raise exception 'payment_evidence_open_version_exists';
  end if;

  select
    document.id as document_id,
    operation_document.page_number,
    batch.id as batch_id,
    batch.document_sha256
    into v_source
  from public.payment_operation_documents operation_document
  join public.payment_documents document
    on document.id = operation_document.document_id
  join public.payment_ingestion_batches batch
    on batch.id = document.batch_id
  where operation_document.operation_id = v_operation.id
  order by operation_document.page_number, document.id
  limit 1;
  if not found then raise exception 'payment_operation_source_document_not_found'; end if;

  select coalesce(max(version), 0) + 1
    into v_version
  from public.payment_operation_evidence
  where operation_id = v_operation.id;

  v_storage_path := v_operation.company_id::text || '/' || v_source.batch_id::text
    || '/evidence/' || v_evidence_id::text || '.pdf';

  insert into public.payment_operation_evidence(
    id, company_id, batch_id, operation_id, source_document_id,
    source_page_number, version, storage_path, source_document_sha256,
    created_by
  ) values (
    v_evidence_id, v_operation.company_id, v_source.batch_id, v_operation.id,
    v_source.document_id, v_source.page_number, v_version, v_storage_path,
    v_source.document_sha256, v_actor
  );

  v_result := jsonb_build_object(
    'evidence_id', v_evidence_id,
    'operation_id', v_operation.id,
    'version', v_version,
    'status', 'pending_upload',
    'storage_bucket', 'payment-batch-documents',
    'storage_path', v_storage_path,
    'source_page_number', v_source.page_number
  );

  return public.payment_reconciliation_store_command(
    v_operation.company_id,
    'payment_evidence.prepare',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$$;

create function public.finalize_payment_operation_evidence(
  p_evidence_id uuid,
  p_derived_sha256 text,
  p_file_size_bytes bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_evidence public.payment_operation_evidence%rowtype;
  v_actor uuid;
  v_sha text := lower(btrim(p_derived_sha256));
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_event_id uuid;
  v_result jsonb;
begin
  select * into v_evidence
  from public.payment_operation_evidence
  where id = p_evidence_id
  for update;
  if not found then raise exception 'payment_evidence_not_found'; end if;

  v_actor := public.payment_reconciliation_require_finance(v_evidence.company_id);
  v_payload := jsonb_build_object(
    'derived_sha256', v_sha,
    'evidence_id', p_evidence_id,
    'file_size_bytes', p_file_size_bytes
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_evidence.company_id,
    'payment_evidence.finalize',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  if v_evidence.status <> 'pending_upload' then
    raise exception 'payment_evidence_not_pending_upload';
  end if;
  if v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_evidence_sha256';
  end if;
  if p_file_size_bytes not between 1 and 26214400 then
    raise exception 'invalid_evidence_file_size';
  end if;

  update public.payment_operation_evidence
  set status = 'pending_review',
      derived_sha256 = v_sha,
      file_size_bytes = p_file_size_bytes,
      uploaded_by = v_actor,
      uploaded_at = clock_timestamp()
  where id = v_evidence.id;

  v_event_id := public.append_financial_outbox_event_internal(
    'payment.evidence_generated',
    'bank_payment_operation',
    v_evidence.operation_id,
    v_evidence.company_id,
    v_actor,
    jsonb_build_object(
      'evidence_id', v_evidence.id,
      'evidence_version', v_evidence.version,
      'operation_id', v_evidence.operation_id,
      'source_page_number', v_evidence.source_page_number
    ),
    v_evidence.operation_id,
    null,
    'evidence-generated:' || public.payment_reconciliation_payload_hash(v_payload)
  );

  v_result := jsonb_build_object(
    'evidence_id', v_evidence.id,
    'event_id', v_event_id,
    'status', 'pending_review'
  );
  return public.payment_reconciliation_store_command(
    v_evidence.company_id,
    'payment_evidence.finalize',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$$;

create function public.review_payment_operation_evidence(
  p_evidence_id uuid,
  p_shareable boolean,
  p_single_operation_attested boolean,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_evidence public.payment_operation_evidence%rowtype;
  v_actor uuid;
  v_reason text := public.payment_reconciliation_redact_free_text(p_reason, 500);
  v_status text;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_event_id uuid;
  v_result jsonb;
begin
  select * into v_evidence
  from public.payment_operation_evidence
  where id = p_evidence_id
  for update;
  if not found then raise exception 'payment_evidence_not_found'; end if;

  v_actor := public.payment_reconciliation_require_finance(v_evidence.company_id);
  v_payload := jsonb_build_object(
    'evidence_id', p_evidence_id,
    'shareable', p_shareable,
    'single_operation_attested', p_single_operation_attested,
    'reason', coalesce(v_reason, '')
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_evidence.company_id,
    'payment_evidence.review',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  if v_evidence.status <> 'pending_review' then
    raise exception 'payment_evidence_not_pending_review';
  end if;
  if p_shareable and not coalesce(p_single_operation_attested, false) then
    raise exception 'single_operation_attestation_required';
  end if;
  if not p_shareable and char_length(coalesce(v_reason, '')) < 10 then
    raise exception 'evidence_rejection_reason_required';
  end if;

  v_status := case when p_shareable then 'shareable' else 'not_shareable' end;
  update public.payment_operation_evidence
  set status = v_status,
      reviewed_by = v_actor,
      reviewed_at = clock_timestamp(),
      single_operation_attested =
        p_shareable and coalesce(p_single_operation_attested, false),
      review_reason = case when p_shareable then null else v_reason end
  where id = v_evidence.id;

  v_event_id := public.append_financial_outbox_event_internal(
    'payment.evidence_reviewed',
    'bank_payment_operation',
    v_evidence.operation_id,
    v_evidence.company_id,
    v_actor,
    jsonb_build_object(
      'evidence_id', v_evidence.id,
      'evidence_status', v_status,
      'evidence_version', v_evidence.version,
      'operation_id', v_evidence.operation_id
    ),
    v_evidence.operation_id,
    null,
    'evidence-reviewed:' || public.payment_reconciliation_payload_hash(v_payload)
  );

  v_result := jsonb_build_object(
    'evidence_id', v_evidence.id,
    'event_id', v_event_id,
    'status', v_status
  );
  return public.payment_reconciliation_store_command(
    v_evidence.company_id,
    'payment_evidence.review',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$$;

create function public.confirm_payment_operation(
  p_operation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_initial public.bank_payment_operations%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_plan public.payment_allocation_plans%rowtype;
  v_reservation public.payment_allocation_reservations%rowtype;
  v_evidence public.payment_operation_evidence%rowtype;
  v_actor uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_request_ids uuid[];
  v_request_id uuid;
  v_item record;
  v_item_count integer := 0;
  v_item_total bigint := 0;
  v_operation_confirmed bigint;
  v_request_confirmed bigint;
  v_request_authorized bigint;
  v_movement_id uuid;
  v_movement_ids uuid[] := array[]::uuid[];
  v_event_id uuid;
  v_result jsonb;
begin
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into v_initial
  from public.bank_payment_operations
  where id = p_operation_id;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;

  v_actor := public.payment_reconciliation_require_finance(v_initial.company_id);
  v_payload := jsonb_build_object('operation_id', p_operation_id);
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_initial.company_id,
    'payment_operation.confirm',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  -- Canonical lock order: plan -> operation -> reservation -> requests -> snapshots.
  select * into v_plan
  from public.payment_allocation_plans
  where operation_id = p_operation_id and status = 'reserved'
  order by proposed_at desc, id desc
  limit 1
  for update;
  if not found then raise exception 'payment_allocation_plan_not_reserved'; end if;

  select * into v_operation
  from public.bank_payment_operations
  where id = p_operation_id
  for update;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  if v_operation.company_id <> v_initial.company_id then
    raise exception 'bank_payment_operation_company_changed';
  end if;
  if v_operation.status = 'reconciled' then
    raise exception 'bank_operation_already_reconciled';
  end if;
  if v_operation.status <> 'reserved' then
    raise exception 'bank_operation_not_reserved';
  end if;

  select * into v_reservation
  from public.payment_allocation_reservations
  where plan_id = v_plan.id and status = 'active'
  order by created_at desc, id desc
  limit 1
  for update;
  if not found then raise exception 'payment_reservation_not_active'; end if;
  if v_reservation.expires_at <= clock_timestamp() then
    raise exception 'payment_reservation_expired';
  end if;
  if v_reservation.created_by <> v_actor then
    raise exception 'payment_reservation_owned_by_another_actor';
  end if;
  if v_reservation.operation_id <> v_operation.id
     or v_reservation.company_id <> v_operation.company_id
     or v_reservation.currency <> v_operation.currency
     or v_reservation.amount_minor <> v_plan.total_amount_minor then
    raise exception 'payment_reservation_scope_mismatch';
  end if;

  select array_agg(distinct snapshot.payment_request_id order by snapshot.payment_request_id)
    into v_request_ids
  from public.payment_allocation_items item
  join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
  where item.plan_id = v_plan.id;
  if coalesce(cardinality(v_request_ids), 0) = 0 then
    raise exception 'payment_allocation_items_required';
  end if;

  perform request.id
  from public.payment_requests request
  where request.id = any(v_request_ids)
  order by request.id
  for update;

  perform snapshot.id
  from public.payable_snapshots snapshot
  where snapshot.id in (
    select item.snapshot_id
    from public.payment_allocation_items item
    where item.plan_id = v_plan.id
  )
  order by snapshot.id
  for update;

  select * into v_evidence
  from public.payment_operation_evidence
  where operation_id = v_operation.id and status = 'shareable'
  order by version desc
  limit 1
  for update;
  if not found or not v_evidence.single_operation_attested then
    raise exception 'shareable_single_page_evidence_required';
  end if;

  v_operation_confirmed :=
    public.payment_operation_confirmed_minor(v_operation.id);
  if v_operation_confirmed < 0
     or v_operation_confirmed > v_operation.amount_minor then
    raise exception 'bank_operation_confirmed_balance_invalid';
  end if;
  if v_plan.total_amount_minor <>
     v_operation.amount_minor - v_operation_confirmed then
    raise exception 'operation_requires_full_atomic_allocation';
  end if;

  for v_item in
    select
      item.*,
      snapshot.payment_request_id,
      snapshot.company_id as snapshot_company_id,
      snapshot.amount_minor as snapshot_amount_minor,
      snapshot.currency as snapshot_currency,
      snapshot.version as snapshot_version
    from public.payment_allocation_items item
    join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
    where item.plan_id = v_plan.id
    order by item.position, item.id
  loop
    v_item_count := v_item_count + 1;
    v_item_total := v_item_total + v_item.amount_minor;

    if v_item.operation_id <> v_operation.id
       or v_item.snapshot_company_id <> v_operation.company_id
       or v_item.currency <> v_operation.currency
       or v_item.snapshot_currency <> v_operation.currency
       or v_item.amount_minor <= 0 then
      raise exception 'payment_allocation_item_scope_mismatch';
    end if;
    if exists (
      select 1
      from public.payable_snapshots newer
      where newer.payment_request_id = v_item.payment_request_id
        and newer.version > v_item.snapshot_version
    ) then
      raise exception 'payable_snapshot_not_latest';
    end if;
    if not public.payment_reconciliation_snapshot_is_payable(v_item.snapshot_id) then
      raise exception 'payable_snapshot_not_payable';
    end if;

    v_request_confirmed :=
      public.payment_request_confirmed_minor(v_item.payment_request_id);
    if v_request_confirmed < 0
       or v_item.amount_minor >
         v_item.snapshot_amount_minor - v_request_confirmed then
      raise exception 'payable_snapshot_capacity_exceeded';
    end if;

    insert into public.payment_allocation_movements(
      company_id, operation_id, snapshot_id, plan_item_id, movement_type,
      original_movement_id, amount_minor, currency, actor_profile_id, reason,
      idempotency_key
    ) values (
      v_operation.company_id, v_operation.id, v_item.snapshot_id, v_item.id,
      'confirmation', null, v_item.amount_minor, v_operation.currency, v_actor,
      'Atomic bank operation confirmation',
      'confirm:' || public.payment_reconciliation_payload_hash(
        jsonb_build_object(
          'command_key', p_idempotency_key,
          'operation_id', v_operation.id,
          'plan_item_id', v_item.id
        )
      )
    )
    returning id into v_movement_id;

    insert into public.payment_movement_evidence_links(
      movement_id, evidence_id, operation_id, company_id
    ) values (
      v_movement_id, v_evidence.id, v_operation.id, v_operation.company_id
    );

    v_movement_ids := array_append(v_movement_ids, v_movement_id);
  end loop;

  if v_item_count = 0 or v_item_total <> v_plan.total_amount_minor then
    raise exception 'payment_allocation_plan_total_mismatch';
  end if;

  foreach v_request_id in array v_request_ids
  loop
    select snapshot.amount_minor
      into v_request_authorized
    from public.payable_snapshots snapshot
    where snapshot.payment_request_id = v_request_id
    order by snapshot.version desc
    limit 1;

    v_request_confirmed :=
      public.payment_request_confirmed_minor(v_request_id);
    if v_request_confirmed > v_request_authorized then
      raise exception 'payment_request_overpayment_blocked';
    end if;

    if v_request_confirmed = v_request_authorized then
      update public.payment_requests
      set status = 'paid',
          paid_by = v_actor,
          paid_at = coalesce(paid_at, clock_timestamp()),
          updated_at = clock_timestamp()
      where id = v_request_id
        and status::text <> 'paid';
    end if;
  end loop;

  update public.payment_allocation_reservations
  set status = 'consumed',
      closed_by = v_actor,
      closed_at = clock_timestamp(),
      close_reason = 'Consumed by atomic bank operation confirmation'
  where id = v_reservation.id;

  update public.payment_allocation_plans
  set status = 'confirmed',
      updated_at = clock_timestamp()
  where id = v_plan.id;

  update public.bank_payment_operations
  set status = 'reconciled'
  where id = v_operation.id;

  v_event_id := public.append_financial_outbox_event_internal(
    'payment.operation_confirmed',
    'bank_payment_operation',
    v_operation.id,
    v_operation.company_id,
    v_actor,
    jsonb_build_object(
      'amount_minor', v_plan.total_amount_minor,
      'currency', v_operation.currency,
      'evidence_id', v_evidence.id,
      'movement_ids', to_jsonb(v_movement_ids),
      'operation_id', v_operation.id,
      'payment_request_ids', to_jsonb(v_request_ids),
      'plan_id', v_plan.id
    ),
    v_operation.id,
    null,
    'operation-confirmed:' || public.payment_reconciliation_payload_hash(v_payload)
  );

  v_result := jsonb_build_object(
    'amount_minor', v_plan.total_amount_minor,
    'currency', v_operation.currency,
    'evidence_id', v_evidence.id,
    'event_id', v_event_id,
    'movement_ids', to_jsonb(v_movement_ids),
    'operation_id', v_operation.id,
    'operation_status', 'reconciled',
    'payment_requests', (
      select jsonb_agg(jsonb_build_object(
        'confirmed_minor', public.payment_request_confirmed_minor(request.id),
        'id', request.id,
        'request_number', request.request_number,
        'status', request.status::text
      ) order by request.id)
      from public.payment_requests request
      where request.id = any(v_request_ids)
    ),
    'plan_id', v_plan.id,
    'plan_status', 'confirmed',
    'reservation_status', 'consumed'
  );

  return public.payment_reconciliation_store_command(
    v_operation.company_id,
    'payment_operation.confirm',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$$;

create function public.get_payment_operation_evidence_access(
  p_evidence_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_evidence public.payment_operation_evidence%rowtype;
begin
  select * into v_evidence
  from public.payment_operation_evidence
  where id = p_evidence_id;
  if not found then raise exception 'payment_evidence_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_evidence.company_id);
  if v_evidence.status not in ('pending_review', 'shareable', 'not_shareable') then
    raise exception 'payment_evidence_not_uploaded';
  end if;
  return jsonb_build_object(
    'evidence_id', v_evidence.id,
    'mime_type', v_evidence.mime_type,
    'status', v_evidence.status,
    'storage_bucket', v_evidence.storage_bucket,
    'storage_path', v_evidence.storage_path,
    'url_ttl_seconds', 300
  );
end
$$;

create function public.get_payment_request_reconciliation_summary(
  p_payment_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_snapshot public.payable_snapshots%rowtype;
  v_confirmed bigint;
  v_balance bigint;
  v_state text;
begin
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;
  if not found then raise exception 'payment_request_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_request.company_id);

  select * into v_snapshot
  from public.payable_snapshots
  where payment_request_id = v_request.id
  order by version desc
  limit 1;

  v_confirmed := public.payment_request_confirmed_minor(v_request.id);
  v_balance := greatest(coalesce(v_snapshot.amount_minor, 0) - v_confirmed, 0);
  v_state := case
    when v_snapshot.id is null then 'not_payable'
    when v_confirmed = 0 then 'unpaid'
    when v_balance = 0 then 'paid'
    else 'partially_paid'
  end;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'request_number', v_request.request_number,
    'request_status', v_request.status::text,
    'reconciliation_state', v_state,
    'authorized_minor', coalesce(v_snapshot.amount_minor, 0),
    'confirmed_minor', v_confirmed,
    'balance_minor', v_balance,
    'currency', coalesce(v_snapshot.currency, upper(v_request.currency)),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'amount_minor', movement.amount_minor,
        'confirmed_at', movement.created_at,
        'currency', movement.currency,
        'evidence_id', evidence.id,
        'evidence_status', evidence.status,
        'movement_id', movement.id,
        'movement_type', movement.movement_type,
        'operation_date', operation.application_date,
        'operation_id', operation.id,
        'reference_hint', right(operation.bank_unique_folio, 6)
      ) order by movement.created_at desc, movement.id desc)
      from public.payment_allocation_movements movement
      join public.payable_snapshots snapshot on snapshot.id = movement.snapshot_id
      join public.bank_payment_operations operation on operation.id = movement.operation_id
      left join public.payment_movement_evidence_links link
        on link.movement_id = movement.id
      left join public.payment_operation_evidence evidence
        on evidence.id = link.evidence_id
      where snapshot.payment_request_id = v_request.id
    ), '[]'::jsonb),
    'external_provider_access', false,
    'external_provider_block_reason', 'provider_identity_link_not_implemented'
  );
end
$$;

create function public.get_payment_batch_reconciliation_summary(
  p_batch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.payment_ingestion_batches%rowtype;
  v_total integer;
  v_reconciled integer;
  v_cancelled integer;
  v_derived_status text;
begin
  select * into v_batch
  from public.payment_ingestion_batches
  where id = p_batch_id;
  if not found then raise exception 'payment_batch_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_batch.company_id);

  select
    count(operation.id)::integer,
    count(operation.id) filter (where operation.status = 'reconciled')::integer,
    count(operation.id) filter (where operation.status = 'cancelled')::integer
    into v_total, v_reconciled, v_cancelled
  from public.bank_payment_operations operation
  join public.payment_document_extractions extraction
    on extraction.id = operation.extraction_id
  where extraction.batch_id = v_batch.id;

  v_derived_status := case
    when coalesce(v_batch.page_count, 0) > 0
      and v_reconciled = v_batch.page_count then 'completed'
    when v_reconciled > 0 then 'partially_completed'
    when v_batch.status in ('failed', 'cancelled')
      or (v_total > 0 and v_cancelled = v_total) then 'failed'
    else 'pending'
  end;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'batch_status', v_batch.status,
    'derived_reconciliation_status', v_derived_status,
    'expected_operations', coalesce(v_batch.page_count, 0),
    'accepted_operations', v_total,
    'reconciled_operations', v_reconciled,
    'cancelled_operations', v_cancelled,
    'operation_results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'amount_minor', operation.amount_minor,
        'confirmed_minor', public.payment_operation_confirmed_minor(operation.id),
        'currency', operation.currency,
        'operation_id', operation.id,
        'page_number', extraction.page_number,
        'status', operation.status
      ) order by extraction.page_number, operation.id)
      from public.bank_payment_operations operation
      join public.payment_document_extractions extraction
        on extraction.id = operation.extraction_id
      where extraction.batch_id = v_batch.id
    ), '[]'::jsonb)
  );
end
$$;

create or replace function public.get_payment_batch_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_is_finance boolean;
  v_is_sysadmin boolean;
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  v_is_finance := public.current_user_has_role(public.flux_finance_roles());
  v_is_sysadmin := public.current_user_has_role(public.flux_sysadmin_roles());
  return jsonb_build_object(
    'actor_profile_id', v_actor,
    'can_access', v_is_finance,
    'capabilities', jsonb_build_object(
      'can_ingest', v_is_finance,
      'can_review', v_is_finance,
      'can_propose', v_is_finance,
      'can_reserve', v_is_finance,
      'can_expire', v_is_finance,
      'can_generate_evidence', v_is_finance,
      'can_view_evidence', v_is_finance,
      'can_confirm', v_is_finance,
      'can_reverse', false
    ),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
      from public.companies c
      where coalesce(c.active, true)
        and v_is_finance
        and (
          v_is_sysadmin
          or public.has_active_company_membership(v_actor, c.id)
        )
    ), '[]'::jsonb),
    'upload_policy', jsonb_build_object(
      'allowed_mime_types', jsonb_build_array('application/pdf'),
      'max_file_bytes', 26214400,
      'max_pages', 500
    ),
    'confirmation_block_reason',
      case when v_is_finance then null else 'finance_role_required' end,
    'external_provider_access', false,
    'external_provider_block_reason', 'provider_identity_link_not_implemented'
  );
end
$$;

alter table public.payment_operation_evidence enable row level security;
alter table public.payment_movement_evidence_links enable row level security;

revoke all on table public.payment_operation_evidence
  from public, anon, authenticated, service_role;
revoke all on table public.payment_movement_evidence_links
  from public, anon, authenticated, service_role;

create policy "Finance can upload derived payment evidence"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-batch-documents'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
    and public.payment_reconciliation_evidence_storage_path_allowed(name, true)
  );

create policy "Finance can read derived payment evidence"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-batch-documents'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
    and public.payment_reconciliation_evidence_storage_path_allowed(name, false)
  );

do $grants$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'payment_reconciliation_validate_evidence_scope',
        'payment_reconciliation_validate_evidence_transition',
        'payment_reconciliation_validate_movement_evidence_scope',
        'payment_receipts_reconciliation_cutover_guard',
        'payment_request_confirmed_minor',
        'payment_reconciliation_evidence_storage_path_allowed',
        'get_payment_operation_confirmation_preview',
        'prepare_payment_operation_evidence',
        'finalize_payment_operation_evidence',
        'review_payment_operation_evidence',
        'confirm_payment_operation',
        'get_payment_operation_evidence_access',
        'get_payment_request_reconciliation_summary',
        'get_payment_batch_reconciliation_summary'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      v_function.signature
    );
  end loop;
end
$grants$;

grant execute on function
  public.payment_reconciliation_evidence_storage_path_allowed(text,boolean)
  to authenticated;
grant execute on function
  public.get_payment_operation_confirmation_preview(uuid)
  to authenticated;
grant execute on function
  public.prepare_payment_operation_evidence(uuid,text)
  to authenticated;
grant execute on function
  public.finalize_payment_operation_evidence(uuid,text,bigint,text)
  to authenticated;
grant execute on function
  public.review_payment_operation_evidence(uuid,boolean,boolean,text,text)
  to authenticated;
grant execute on function
  public.confirm_payment_operation(uuid,text)
  to authenticated;
grant execute on function
  public.get_payment_operation_evidence_access(uuid)
  to authenticated;
grant execute on function
  public.get_payment_request_reconciliation_summary(uuid)
  to authenticated;
grant execute on function
  public.get_payment_batch_reconciliation_summary(uuid)
  to authenticated;
grant execute on function public.get_payment_batch_context() to authenticated;

comment on table public.payment_operation_evidence is
  'Private, versioned single-page evidence. Shareable means Finance attested one bank operation; it does not grant provider access.';
comment on table public.payment_movement_evidence_links is
  'Append-only association between the canonical financial movement and its reviewed evidence.';
comment on function public.confirm_payment_operation(uuid,text) is
  'Operation-atomic confirmation: all N:M allocations for one bank operation commit with request state, audit ledger and outbox, or all roll back.';
comment on function public.get_payment_request_reconciliation_summary(uuid) is
  'Finance-only request balance and evidence view. External provider access remains disabled until a trusted auth-to-provider link exists.';
comment on trigger payment_receipts_read_only_after_reconciliation_cutover
  on public.payment_receipts is
  'Prevents payment_receipts from remaining a second writable financial authority after the reconciliation cutover.';

commit;
