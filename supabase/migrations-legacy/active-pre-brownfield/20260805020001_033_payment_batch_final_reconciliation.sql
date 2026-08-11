-- 033_payment_batch_final_reconciliation.sql
-- One accepted bank receipt links to exactly one approved payment request.
-- Versioned only. Applying this migration requires separate authorization.

begin;

do $precheck$
begin
  if to_regclass('public.payment_document_extractions') is null
     or to_regclass('public.bank_payment_operations') is null
     or to_regclass('public.payable_snapshots') is null
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
     or to_regclass('public.payment_request_receipt_links') is not null
     or to_regclass('public.payment_extraction_corrections') is not null then
    raise exception 'payment_batch_033_objects_already_exist';
  end if;
end
$precheck$;

create table public.payment_extraction_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  extraction_id uuid not null references public.payment_document_extractions(id),
  previous_values jsonb not null,
  corrected_values jsonb not null,
  reason text not null,
  corrected_by uuid not null references public.profiles(id),
  corrected_at timestamptz not null default now(),
  constraint payment_extraction_corrections_reason_check check (
    char_length(btrim(reason)) between 10 and 500
    and reason !~ '[[:cntrl:]]'
  ),
  constraint payment_extraction_corrections_values_check check (
    jsonb_typeof(previous_values) = 'object'
    and jsonb_typeof(corrected_values) = 'object'
  )
);

create table public.payment_operation_evidence (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  batch_id uuid not null references public.payment_ingestion_batches(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  source_document_id uuid not null references public.payment_documents(id),
  source_page_number integer not null,
  version integer not null,
  status text not null default 'pending_upload',
  storage_bucket text not null default 'payment-batch-documents',
  storage_path text not null,
  source_document_sha256 text not null,
  individual_sha256 text,
  mime_type text not null default 'application/pdf',
  file_size_bytes bigint,
  page_count integer,
  single_operation_attested boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  constraint payment_operation_evidence_page_check check (
    source_page_number between 1 and 500
  ),
  constraint payment_operation_evidence_version_check check (version > 0),
  constraint payment_operation_evidence_status_check check (
    status in ('pending_upload', 'pending_review', 'shareable', 'not_shareable')
  ),
  constraint payment_operation_evidence_bucket_check check (
    storage_bucket = 'payment-batch-documents'
  ),
  constraint payment_operation_evidence_path_check check (
    storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
  ),
  constraint payment_operation_evidence_hash_check check (
    source_document_sha256 ~ '^[0-9a-f]{64}$'
    and (individual_sha256 is null or individual_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint payment_operation_evidence_pdf_check check (
    mime_type = 'application/pdf'
    and (file_size_bytes is null or file_size_bytes between 1 and 26214400)
    and (page_count is null or page_count = 1)
  ),
  constraint payment_operation_evidence_lifecycle_check check (
    (
      status = 'pending_upload'
      and individual_sha256 is null
      and file_size_bytes is null
      and page_count is null
      and uploaded_by is null
      and uploaded_at is null
      and reviewed_by is null
      and reviewed_at is null
    )
    or (
      status = 'pending_review'
      and individual_sha256 is not null
      and file_size_bytes is not null
      and page_count = 1
      and uploaded_by is not null
      and uploaded_at is not null
      and reviewed_by is null
      and reviewed_at is null
    )
    or (
      status in ('shareable', 'not_shareable')
      and individual_sha256 is not null
      and file_size_bytes is not null
      and page_count = 1
      and uploaded_by is not null
      and uploaded_at is not null
      and reviewed_by is not null
      and reviewed_at is not null
      and nullif(btrim(review_reason), '') is not null
    )
  ),
  constraint payment_operation_evidence_attestation_check check (
    status <> 'shareable' or single_operation_attested
  ),
  constraint payment_operation_evidence_operation_version_key unique (
    operation_id, version
  ),
  constraint payment_operation_evidence_storage_key unique (
    storage_bucket, storage_path
  ),
  constraint payment_operation_evidence_hash_key unique (individual_sha256)
);

create unique index payment_operation_evidence_shareable_operation_key
  on public.payment_operation_evidence(operation_id)
  where status = 'shareable';

create table public.payment_request_receipt_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  payment_request_id uuid not null references public.payment_requests(id),
  snapshot_id uuid not null references public.payable_snapshots(id),
  evidence_id uuid not null references public.payment_operation_evidence(id),
  amount_minor bigint not null,
  currency text not null,
  payment_date date not null,
  reference_hint text not null,
  linked_by uuid not null references public.profiles(id),
  linked_at timestamptz not null default now(),
  constraint payment_request_receipt_links_amount_check check (
    amount_minor between 1 and 9007199254740991
  ),
  constraint payment_request_receipt_links_currency_check check (
    currency = upper(currency) and currency ~ '^[A-Z]{3}$'
  ),
  constraint payment_request_receipt_links_reference_check check (
    reference_hint ~ '^[A-Z0-9-]{1,12}$'
  ),
  constraint payment_request_receipt_links_operation_key unique (operation_id),
  constraint payment_request_receipt_links_request_key unique (payment_request_id),
  constraint payment_request_receipt_links_evidence_key unique (evidence_id)
);

create index payment_extraction_corrections_extraction_idx
  on public.payment_extraction_corrections(extraction_id, corrected_at);
create index payment_request_receipt_links_company_idx
  on public.payment_request_receipt_links(company_id, linked_at);

create function public.payment_receipt_protect_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'payment_receipt_history_is_append_only';
end
$$;

create trigger payment_extraction_corrections_immutable
before update or delete on public.payment_extraction_corrections
for each row execute function public.payment_receipt_protect_append_only();

create trigger payment_request_receipt_links_immutable
before update or delete on public.payment_request_receipt_links
for each row execute function public.payment_receipt_protect_append_only();

create function public.payment_receipt_validate_evidence_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.id <> new.id
     or old.company_id <> new.company_id
     or old.batch_id <> new.batch_id
     or old.operation_id <> new.operation_id
     or old.source_document_id <> new.source_document_id
     or old.source_page_number <> new.source_page_number
     or old.version <> new.version
     or old.storage_bucket <> new.storage_bucket
     or old.storage_path <> new.storage_path
     or old.source_document_sha256 <> new.source_document_sha256
     or old.created_by <> new.created_by
     or old.created_at <> new.created_at then
    raise exception 'payment_evidence_identity_is_immutable';
  end if;

  if old.status = 'pending_upload' and new.status = 'pending_review' then
    if new.individual_sha256 is null
       or new.file_size_bytes is null
       or new.page_count <> 1
       or new.uploaded_by is null
       or new.uploaded_at is null then
      raise exception 'single_page_upload_attestation_required';
    end if;
  elsif old.status = 'pending_review'
        and new.status in ('shareable', 'not_shareable') then
    if new.reviewed_by is null
       or new.reviewed_at is null
       or nullif(btrim(new.review_reason), '') is null then
      raise exception 'payment_evidence_human_review_required';
    end if;
    if new.status = 'shareable' and not new.single_operation_attested then
      raise exception 'single_operation_attestation_required';
    end if;
  else
    raise exception 'payment_evidence_transition_not_allowed';
  end if;
  return new;
end
$$;

create trigger payment_operation_evidence_transition
before update on public.payment_operation_evidence
for each row execute function public.payment_receipt_validate_evidence_transition();

create function public.payment_receipt_normalize_match_text(p_value text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]', '', 'g')
$$;

alter table public.payment_extraction_corrections enable row level security;
alter table public.payment_operation_evidence enable row level security;
alter table public.payment_request_receipt_links enable row level security;

revoke all on table public.payment_extraction_corrections from anon, authenticated;
revoke all on table public.payment_operation_evidence from anon, authenticated;
revoke all on table public.payment_request_receipt_links from anon, authenticated;

create policy payment_receipt_evidence_finance_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-batch-documents'
  and exists (
    select 1
    from public.payment_operation_evidence evidence
    where evidence.storage_bucket = storage.objects.bucket_id
      and evidence.storage_path = storage.objects.name
      and public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.has_active_company_membership(
          public.current_profile_id(),
          evidence.company_id
        )
      )
  )
);

create policy payment_receipt_evidence_finance_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-batch-documents'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/evidence/[0-9a-f-]{36}\.pdf$'
  and metadata ->> 'mimetype' = 'application/pdf'
  and exists (
    select 1
    from public.payment_operation_evidence evidence
    where evidence.storage_bucket = storage.objects.bucket_id
      and evidence.storage_path = storage.objects.name
      and evidence.status = 'pending_upload'
      and evidence.created_by = public.current_profile_id()
      and public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.has_active_company_membership(
          public.current_profile_id(),
          evidence.company_id
        )
      )
  )
);

create function public.correct_payment_document_extraction(
  p_extraction_id uuid,
  p_expected_updated_at timestamptz,
  p_application_date date,
  p_amount_minor bigint,
  p_currency text,
  p_bank_unique_folio text,
  p_beneficiary_name text,
  p_payment_reason text,
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
  v_extraction public.payment_document_extractions%rowtype;
  v_actor uuid;
  v_currency text;
  v_folio text;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_corrected_at timestamptz;
  v_result jsonb;
begin
  select * into v_extraction
  from public.payment_document_extractions
  where id = p_extraction_id
  for update;
  if not found then raise exception 'payment_extraction_not_found'; end if;

  v_actor := public.payment_reconciliation_require_finance(v_extraction.company_id);
  v_currency := public.payment_reconciliation_normalize_currency(p_currency);
  v_folio := upper(btrim(coalesce(p_bank_unique_folio, '')));
  v_payload := jsonb_build_object(
    'application_date', p_application_date,
    'amount_minor', p_amount_minor,
    'beneficiary_name', nullif(btrim(p_beneficiary_name), ''),
    'currency', v_currency,
    'extraction_id', p_extraction_id,
    'payment_reason', nullif(btrim(p_payment_reason), ''),
    'reason', nullif(btrim(p_reason), ''),
    'reference', v_folio
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_extraction.company_id,
    'payment_extraction.correct',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  if v_extraction.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_payment_extraction';
  end if;
  if v_extraction.status not in ('review_required', 'blocked') then
    raise exception 'payment_extraction_not_correctable';
  end if;
  if p_application_date is null
     or p_amount_minor is null
     or p_amount_minor not between 1 and 9007199254740991
     or v_currency is null
     or v_folio !~ '^[A-Z0-9-]{8,120}$'
     or nullif(btrim(p_beneficiary_name), '') is null
     or char_length(btrim(p_beneficiary_name)) > 180
     or char_length(btrim(coalesce(p_payment_reason, ''))) > 500
     or char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception 'invalid_payment_extraction_correction';
  end if;

  v_corrected_at := clock_timestamp();
  insert into public.payment_extraction_corrections(
    company_id, extraction_id, previous_values, corrected_values,
    reason, corrected_by, corrected_at
  ) values (
    v_extraction.company_id,
    v_extraction.id,
    jsonb_build_object(
      'application_date', v_extraction.application_date,
      'amount_minor', v_extraction.amount_minor,
      'bank_unique_folio', v_extraction.bank_unique_folio,
      'beneficiary_name', v_extraction.beneficiary_name,
      'currency', v_extraction.currency,
      'payment_reason', v_extraction.payment_reason
    ),
    v_payload - 'extraction_id' - 'reason',
    btrim(p_reason),
    v_actor,
    v_corrected_at
  );

  update public.payment_document_extractions
  set application_date = p_application_date,
      amount_minor = p_amount_minor,
      currency = v_currency,
      bank_unique_folio = v_folio,
      beneficiary_name = btrim(p_beneficiary_name),
      payment_reason = nullif(btrim(p_payment_reason), ''),
      status = 'review_required',
      reviewed_by = null,
      reviewed_at = null,
      rejection_reason = null,
      updated_at = v_corrected_at
  where id = v_extraction.id;

  perform public.append_financial_outbox_event_internal(
    'payment_extraction.corrected',
    'payment_document_extraction',
    v_extraction.id,
    v_extraction.company_id,
    v_actor,
    jsonb_build_object(
      'corrected_fields',
      jsonb_build_array(
        'application_date', 'amount_minor', 'currency',
        'bank_unique_folio', 'beneficiary_name', 'payment_reason'
      ),
      'extraction_id', v_extraction.id
    ),
    v_extraction.batch_id,
    null,
    'extraction-corrected:' || v_payload_hash
  );

  v_result := jsonb_build_object(
    'extraction_id', v_extraction.id,
    'status', 'review_required',
    'updated_at', v_corrected_at
  );
  return public.payment_reconciliation_store_command(
    v_extraction.company_id,
    'payment_extraction.correct',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$$;

create function public.get_payment_receipt_link_preview(
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
  v_evidence public.payment_operation_evidence%rowtype;
  v_link record;
begin
  select operation.* into v_operation
  from public.bank_payment_operations operation
  where operation.id = p_operation_id
     or operation.extraction_id = p_operation_id
  order by case when operation.id = p_operation_id then 0 else 1 end
  limit 1;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_operation.company_id);

  select * into v_evidence
  from public.payment_operation_evidence
  where operation_id = v_operation.id
  order by version desc
  limit 1;

  select link.*, request.request_number into v_link
  from public.payment_request_receipt_links link
  join public.payment_requests request on request.id = link.payment_request_id
  where link.operation_id = v_operation.id;

  return jsonb_build_object(
    'operation_id', v_operation.id,
    'amount_minor', v_operation.amount_minor,
    'currency', v_operation.currency,
    'payment_date', v_operation.application_date,
    'reference_hint', right(v_operation.bank_unique_folio, 6),
    'evidence', case when v_evidence.id is null then null else jsonb_build_object(
      'id', v_evidence.id,
      'status', v_evidence.status,
      'version', v_evidence.version,
      'storage_bucket', v_evidence.storage_bucket,
      'storage_path', v_evidence.storage_path,
      'individual_sha256', v_evidence.individual_sha256,
      'file_size_bytes', v_evidence.file_size_bytes,
      'page_count', v_evidence.page_count,
      'single_operation_attested', v_evidence.single_operation_attested
    ) end,
    'link', case when v_link.id is null then null else jsonb_build_object(
      'id', v_link.id,
      'payment_request_id', v_link.payment_request_id,
      'request_number', v_link.request_number,
      'evidence_id', v_link.evidence_id,
      'amount_minor', v_link.amount_minor,
      'currency', v_link.currency,
      'payment_date', v_link.payment_date,
      'reference_hint', v_link.reference_hint,
      'linked_at', v_link.linked_at
    ) end,
    'can_search',
      v_link.id is null
      and v_evidence.status = 'shareable'
      and v_evidence.page_count = 1,
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
  v_actor uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_source record;
  v_existing public.payment_operation_evidence%rowtype;
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

  if exists (
    select 1 from public.payment_request_receipt_links
    where operation_id = v_operation.id
  ) then
    raise exception 'bank_receipt_already_linked';
  end if;

  select * into v_existing
  from public.payment_operation_evidence
  where operation_id = v_operation.id
    and status in ('pending_upload', 'pending_review', 'shareable')
  order by version desc
  limit 1
  for update;

  if v_existing.id is not null then
    v_result := jsonb_build_object(
      'evidence_id', v_existing.id,
      'operation_id', v_existing.operation_id,
      'status', v_existing.status,
      'storage_bucket', v_existing.storage_bucket,
      'storage_path', v_existing.storage_path,
      'version', v_existing.version
    );
    return public.payment_reconciliation_store_command(
      v_operation.company_id,
      'payment_evidence.prepare',
      p_idempotency_key,
      v_payload_hash,
      v_actor,
      v_result
    );
  end if;

  select
    document.id as document_id,
    extraction.batch_id,
    extraction.page_number,
    document.sha256
    into v_source
  from public.payment_document_extractions extraction
  join public.payment_documents document on document.id = extraction.document_id
  where extraction.id = v_operation.extraction_id
    and extraction.status = 'accepted';
  if not found then raise exception 'accepted_payment_extraction_required'; end if;

  select coalesce(max(version), 0) + 1 into v_version
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
    v_source.sha256, v_actor
  );

  v_result := jsonb_build_object(
    'evidence_id', v_evidence_id,
    'operation_id', v_operation.id,
    'status', 'pending_upload',
    'storage_bucket', 'payment-batch-documents',
    'storage_path', v_storage_path,
    'version', v_version
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
  p_page_count integer,
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
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_uploaded_at timestamptz;
  v_result jsonb;
begin
  select * into v_evidence
  from public.payment_operation_evidence
  where id = p_evidence_id
  for update;
  if not found then raise exception 'payment_evidence_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_evidence.company_id);
  v_payload := jsonb_build_object(
    'derived_sha256', p_derived_sha256,
    'evidence_id', p_evidence_id,
    'file_size_bytes', p_file_size_bytes,
    'page_count', p_page_count
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

  if p_derived_sha256 !~ '^[0-9a-f]{64}$'
     or p_file_size_bytes not between 1 and 26214400
     or p_page_count <> 1 then
    raise exception 'individual_receipt_must_have_one_page';
  end if;
  if v_evidence.status <> 'pending_upload' then
    raise exception 'payment_evidence_not_pending_upload';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = v_evidence.storage_bucket
      and object.name = v_evidence.storage_path
  ) then
    raise exception 'payment_evidence_object_not_found';
  end if;

  v_uploaded_at := clock_timestamp();
  update public.payment_operation_evidence
  set status = 'pending_review',
      individual_sha256 = p_derived_sha256,
      file_size_bytes = p_file_size_bytes,
      page_count = 1,
      uploaded_by = v_actor,
      uploaded_at = v_uploaded_at
  where id = v_evidence.id;

  v_result := jsonb_build_object(
    'evidence_id', v_evidence.id,
    'operation_id', v_evidence.operation_id,
    'status', 'pending_review',
    'storage_bucket', v_evidence.storage_bucket,
    'storage_path', v_evidence.storage_path
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
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_status text;
  v_reviewed_at timestamptz;
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
    'reason', nullif(btrim(p_reason), ''),
    'shareable', p_shareable,
    'single_operation_attested', p_single_operation_attested
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
  if char_length(btrim(coalesce(p_reason, ''))) not between 10 and 500 then
    raise exception 'payment_evidence_review_reason_required';
  end if;
  if p_shareable and not p_single_operation_attested then
    raise exception 'single_operation_attestation_required';
  end if;
  if v_evidence.page_count <> 1 then
    raise exception 'individual_receipt_must_have_one_page';
  end if;

  v_status := case when p_shareable then 'shareable' else 'not_shareable' end;
  v_reviewed_at := clock_timestamp();
  update public.payment_operation_evidence
  set status = v_status,
      single_operation_attested = p_single_operation_attested,
      reviewed_by = v_actor,
      reviewed_at = v_reviewed_at,
      review_reason = btrim(p_reason)
  where id = v_evidence.id;

  v_event_id := public.append_financial_outbox_event_internal(
    'payment_evidence.reviewed',
    'payment_operation_evidence',
    v_evidence.id,
    v_evidence.company_id,
    v_actor,
    jsonb_build_object(
      'evidence_id', v_evidence.id,
      'operation_id', v_evidence.operation_id,
      'page_count', 1,
      'status', v_status
    ),
    v_evidence.operation_id,
    null,
    'evidence-reviewed:' || v_payload_hash
  );

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'evidence_id', v_evidence.id,
    'operation_id', v_evidence.operation_id,
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

create function public.find_payment_receipt_candidates(
  p_operation_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.bank_payment_operations%rowtype;
  v_items jsonb;
begin
  select * into v_operation
  from public.bank_payment_operations
  where id = p_operation_id;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_operation.company_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid_limit';
  end if;
  if exists (
    select 1 from public.payment_request_receipt_links
    where operation_id = v_operation.id
  ) then
    raise exception 'bank_receipt_already_linked';
  end if;
  if not exists (
    select 1 from public.payment_operation_evidence
    where operation_id = v_operation.id
      and status = 'shareable'
      and page_count = 1
      and single_operation_attested
  ) then
    raise exception 'shareable_single_page_evidence_required';
  end if;

  with latest_snapshots as (
    select distinct on (snapshot.payment_request_id) snapshot.*
    from public.payable_snapshots snapshot
    where snapshot.company_id = v_operation.company_id
    order by snapshot.payment_request_id, snapshot.version desc
  ), exact_candidates as (
    select
      snapshot.id as snapshot_id,
      request.id as payment_request_id,
      request.request_number,
      request.concept,
      request.status::text as request_status,
      coalesce(proveedor.alias, proveedor.nombre_completo, 'Proveedor') as proveedor_name,
      snapshot.amount_minor,
      snapshot.currency,
      v_operation.beneficiary_name as receipt_beneficiary,
      v_operation.payment_reason as receipt_reference,
      (
        v_operation.destination_account_hash is not null
        and (
          v_operation.destination_account_hash =
            public.payment_reconciliation_account_hash(proveedor.clabe)
          or v_operation.destination_account_hash =
            public.payment_reconciliation_account_hash(proveedor.cuenta_bancaria)
        )
      ) as account_match,
      (
        nullif(public.payment_receipt_normalize_match_text(v_operation.beneficiary_name), '') is not null
        and (
          (
            nullif(public.payment_receipt_normalize_match_text(proveedor.alias), '') is not null
            and public.payment_receipt_normalize_match_text(v_operation.beneficiary_name)
              like '%' || public.payment_receipt_normalize_match_text(proveedor.alias) || '%'
          )
          or (
            nullif(public.payment_receipt_normalize_match_text(proveedor.nombre_completo), '') is not null
            and public.payment_receipt_normalize_match_text(v_operation.beneficiary_name)
              like '%' || public.payment_receipt_normalize_match_text(proveedor.nombre_completo) || '%'
          )
        )
      ) as name_match
    from latest_snapshots snapshot
    join public.payment_requests request on request.id = snapshot.payment_request_id
    join public.proveedores proveedor on proveedor.id = request.proveedor_id
    where request.company_id = v_operation.company_id
      and request.status::text = 'approved'
      and snapshot.amount_minor = v_operation.amount_minor
      and snapshot.currency = v_operation.currency
      and public.payment_reconciliation_snapshot_is_payable(snapshot.id)
      and not exists (
        select 1 from public.payment_request_receipt_links link
        where link.payment_request_id = request.id
      )
      and not exists (
        select 1 from public.payment_receipts legacy
        where legacy.payment_request_id = request.id
      )
  )
  select coalesce(jsonb_agg(to_jsonb(candidate)
    order by candidate.account_match desc, candidate.name_match desc,
      candidate.request_number, candidate.payment_request_id), '[]'::jsonb)
    into v_items
  from (
    select *
    from exact_candidates
    where account_match or name_match
    order by account_match desc, name_match desc, payment_request_id
    limit p_limit
  ) candidate;

  return jsonb_build_object(
    'items', v_items,
    'outcome', case jsonb_array_length(v_items)
      when 0 then 'none'
      when 1 then 'exact'
      else 'multiple'
    end,
    'read_only', true
  );
end
$$;

create function public.link_payment_receipt_to_request(
  p_operation_id uuid,
  p_payment_request_id uuid,
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
  v_request public.payment_requests%rowtype;
  v_snapshot public.payable_snapshots%rowtype;
  v_evidence public.payment_operation_evidence%rowtype;
  v_provider record;
  v_actor uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_provider_match boolean;
  v_link_id uuid;
  v_event_id uuid;
  v_linked_at timestamptz;
  v_result jsonb;
  v_updated integer;
begin
  select * into v_initial
  from public.bank_payment_operations
  where id = p_operation_id;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_initial.company_id);
  v_payload := jsonb_build_object(
    'operation_id', p_operation_id,
    'payment_request_id', p_payment_request_id
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_initial.company_id,
    'payment_receipt.link',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_operation
  from public.bank_payment_operations
  where id = p_operation_id
  for update;
  if v_operation.company_id <> v_initial.company_id then
    raise exception 'bank_payment_operation_company_changed';
  end if;
  if v_operation.status = 'cancelled' then
    raise exception 'bank_payment_operation_not_linkable';
  end if;
  if exists (
    select 1 from public.payment_request_receipt_links
    where operation_id = v_operation.id
  ) then
    raise exception 'bank_receipt_already_linked';
  end if;
  if not exists (
    select 1 from public.payment_document_extractions extraction
    where extraction.id = v_operation.extraction_id
      and extraction.status = 'accepted'
  ) then
    raise exception 'accepted_payment_extraction_required';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_request.company_id <> v_operation.company_id then
    raise exception 'payment_request_company_mismatch';
  end if;
  if v_request.status::text <> 'approved' then
    raise exception 'payment_request_must_be_approved';
  end if;
  if exists (
    select 1 from public.payment_request_receipt_links
    where payment_request_id = v_request.id
  ) or exists (
    select 1 from public.payment_receipts legacy
    where legacy.payment_request_id = v_request.id
  ) then
    raise exception 'payment_request_already_has_receipt';
  end if;

  select * into v_snapshot
  from public.payable_snapshots
  where payment_request_id = v_request.id
  order by version desc
  limit 1
  for update;
  if not found or not public.payment_reconciliation_snapshot_is_payable(v_snapshot.id) then
    raise exception 'payment_request_not_payable';
  end if;
  if v_snapshot.amount_minor <> v_operation.amount_minor then
    raise exception 'receipt_request_amount_mismatch';
  end if;
  if v_snapshot.currency <> v_operation.currency then
    raise exception 'receipt_request_currency_mismatch';
  end if;

  select
    proveedor.alias,
    proveedor.nombre_completo,
    proveedor.clabe,
    proveedor.cuenta_bancaria
    into v_provider
  from public.proveedores proveedor
  where proveedor.id = v_request.proveedor_id;
  if not found then raise exception 'payment_request_provider_not_found'; end if;

  v_provider_match := (
    v_operation.destination_account_hash is not null
    and (
      v_operation.destination_account_hash =
        public.payment_reconciliation_account_hash(v_provider.clabe)
      or v_operation.destination_account_hash =
        public.payment_reconciliation_account_hash(v_provider.cuenta_bancaria)
    )
  ) or (
    nullif(public.payment_receipt_normalize_match_text(v_operation.beneficiary_name), '') is not null
    and (
      (
        nullif(public.payment_receipt_normalize_match_text(v_provider.alias), '') is not null
        and public.payment_receipt_normalize_match_text(v_operation.beneficiary_name)
          like '%' || public.payment_receipt_normalize_match_text(v_provider.alias) || '%'
      )
      or (
        nullif(public.payment_receipt_normalize_match_text(v_provider.nombre_completo), '') is not null
        and public.payment_receipt_normalize_match_text(v_operation.beneficiary_name)
          like '%' || public.payment_receipt_normalize_match_text(v_provider.nombre_completo) || '%'
      )
    )
  );
  if not v_provider_match then
    raise exception 'receipt_request_provider_mismatch';
  end if;

  select * into v_evidence
  from public.payment_operation_evidence
  where operation_id = v_operation.id
    and status = 'shareable'
    and page_count = 1
    and single_operation_attested
  for update;
  if not found then
    raise exception 'shareable_single_page_evidence_required';
  end if;

  v_linked_at := clock_timestamp();
  begin
    insert into public.payment_request_receipt_links(
      company_id, operation_id, payment_request_id, snapshot_id, evidence_id,
      amount_minor, currency, payment_date, reference_hint, linked_by, linked_at
    ) values (
      v_operation.company_id, v_operation.id, v_request.id, v_snapshot.id,
      v_evidence.id, v_operation.amount_minor, v_operation.currency,
      v_operation.application_date, right(v_operation.bank_unique_folio, 6),
      v_actor, v_linked_at
    ) returning id into v_link_id;
  exception when unique_violation then
    raise exception 'receipt_or_request_already_linked';
  end;

  update public.payment_requests
  set status = 'paid'::public.payment_request_status,
      paid_by = v_actor,
      paid_at = v_linked_at,
      updated_at = v_linked_at
  where id = v_request.id
    and status::text = 'approved';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'payment_request_changed_during_link';
  end if;

  v_event_id := public.append_financial_outbox_event_internal(
    'payment_receipt.linked',
    'payment_request_receipt_link',
    v_link_id,
    v_operation.company_id,
    v_actor,
    jsonb_build_object(
      'amount_minor', v_operation.amount_minor,
      'currency', v_operation.currency,
      'evidence_id', v_evidence.id,
      'operation_id', v_operation.id,
      'payment_request_id', v_request.id
    ),
    v_operation.id,
    null,
    'receipt-linked:' || v_payload_hash
  );

  v_result := jsonb_build_object(
    'amount_minor', v_operation.amount_minor,
    'currency', v_operation.currency,
    'evidence_id', v_evidence.id,
    'event_id', v_event_id,
    'link_id', v_link_id,
    'operation_id', v_operation.id,
    'payment_date', v_operation.application_date,
    'payment_request_id', v_request.id,
    'reference_hint', right(v_operation.bank_unique_folio, 6),
    'request_number', v_request.request_number,
    'request_status', 'paid'
  );
  return public.payment_reconciliation_store_command(
    v_operation.company_id,
    'payment_receipt.link',
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
  if v_evidence.status <> 'shareable'
     or v_evidence.page_count <> 1
     or not v_evidence.single_operation_attested then
    raise exception 'payment_evidence_not_shareable';
  end if;
  return jsonb_build_object(
    'evidence_id', v_evidence.id,
    'storage_bucket', v_evidence.storage_bucket,
    'storage_path', v_evidence.storage_path,
    'url_ttl_seconds', 300,
    'page_count', 1,
    'external_provider_access', false
  );
end
$$;

create function public.get_payment_request_receipt_summary(
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
  v_link record;
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

  select
    link.*,
    request.request_number,
    evidence.status as evidence_status,
    evidence.page_count
    into v_link
  from public.payment_request_receipt_links link
  join public.payment_requests request on request.id = link.payment_request_id
  join public.payment_operation_evidence evidence on evidence.id = link.evidence_id
  where link.payment_request_id = v_request.id;

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'request_number', v_request.request_number,
    'request_status', v_request.status::text,
    'authorized_minor', v_snapshot.amount_minor,
    'currency', coalesce(v_snapshot.currency, v_request.currency),
    'link', case when v_link.id is null then null else jsonb_build_object(
      'id', v_link.id,
      'request_number', v_link.request_number,
      'amount_minor', v_link.amount_minor,
      'currency', v_link.currency,
      'payment_date', v_link.payment_date,
      'reference_hint', v_link.reference_hint,
      'evidence_id', v_link.evidence_id,
      'evidence_status', v_link.evidence_status,
      'page_count', v_link.page_count,
      'linked_at', v_link.linked_at
    ) end,
    'external_provider_access', false,
    'external_provider_block_reason', 'provider_identity_link_not_implemented'
  );
end
$$;

create function public.get_payment_batch_receipt_summary(
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
  v_linked integer;
begin
  select * into v_batch
  from public.payment_ingestion_batches
  where id = p_batch_id;
  if not found then raise exception 'payment_batch_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_batch.company_id);

  select
    count(operation.id)::integer,
    count(link.id)::integer
    into v_total, v_linked
  from public.bank_payment_operations operation
  join public.payment_document_extractions extraction
    on extraction.id = operation.extraction_id
  left join public.payment_request_receipt_links link
    on link.operation_id = operation.id
  where extraction.batch_id = v_batch.id;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'accepted_receipts', v_total,
    'linked_receipts', v_linked,
    'derived_link_status', case
      when v_total > 0 and v_linked = v_total then 'completed'
      when v_linked > 0 then 'partially_completed'
      else 'pending'
    end
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
  if v_actor is null then raise exception 'not_authenticated'; end if;
  v_is_finance := public.current_user_has_role(public.flux_finance_roles());
  v_is_sysadmin := public.current_user_has_role(public.flux_sysadmin_roles());
  return jsonb_build_object(
    'actor_profile_id', v_actor,
    'can_access', v_is_finance,
    'capabilities', jsonb_build_object(
      'can_ingest', v_is_finance,
      'can_review', v_is_finance,
      'can_match', v_is_finance,
      'can_link', v_is_finance,
      'can_propose', false,
      'can_reserve', false,
      'can_confirm', false,
      'can_reverse', false
    ),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object('id', company.id, 'name', company.name)
        order by company.name)
      from public.companies company
      where coalesce(company.active, true)
        and v_is_finance
        and (
          v_is_sysadmin
          or public.has_active_company_membership(v_actor, company.id)
        )
    ), '[]'::jsonb),
    'upload_policy', jsonb_build_object(
      'allowed_mime_types', jsonb_build_array('application/pdf'),
      'max_file_bytes', 26214400,
      'max_pages', 500
    ),
    'matching_model', 'one_receipt_to_one_approved_request',
    'amount_source', 'accepted_bank_extraction'
  );
end
$$;

revoke all on function public.payment_receipt_protect_append_only() from public, anon, authenticated;
revoke all on function public.payment_receipt_validate_evidence_transition() from public, anon, authenticated;
revoke all on function public.payment_receipt_normalize_match_text(text) from public, anon, authenticated;

revoke all on function public.correct_payment_document_extraction(
  uuid,timestamptz,date,bigint,text,text,text,text,text,text
) from public, anon, authenticated;
revoke all on function public.get_payment_receipt_link_preview(uuid)
  from public, anon, authenticated;
revoke all on function public.prepare_payment_operation_evidence(uuid,text)
  from public, anon, authenticated;
revoke all on function public.finalize_payment_operation_evidence(
  uuid,text,bigint,integer,text
) from public, anon, authenticated;
revoke all on function public.review_payment_operation_evidence(
  uuid,boolean,boolean,text,text
) from public, anon, authenticated;
revoke all on function public.find_payment_receipt_candidates(uuid,integer)
  from public, anon, authenticated;
revoke all on function public.link_payment_receipt_to_request(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.get_payment_operation_evidence_access(uuid)
  from public, anon, authenticated;
revoke all on function public.get_payment_request_receipt_summary(uuid)
  from public, anon, authenticated;
revoke all on function public.get_payment_batch_receipt_summary(uuid)
  from public, anon, authenticated;

grant execute on function public.correct_payment_document_extraction(
  uuid,timestamptz,date,bigint,text,text,text,text,text,text
) to authenticated;
grant execute on function public.get_payment_receipt_link_preview(uuid)
  to authenticated;
grant execute on function public.prepare_payment_operation_evidence(uuid,text)
  to authenticated;
grant execute on function public.finalize_payment_operation_evidence(
  uuid,text,bigint,integer,text
) to authenticated;
grant execute on function public.review_payment_operation_evidence(
  uuid,boolean,boolean,text,text
) to authenticated;
grant execute on function public.find_payment_receipt_candidates(uuid,integer)
  to authenticated;
grant execute on function public.link_payment_receipt_to_request(uuid,uuid,text)
  to authenticated;
grant execute on function public.get_payment_operation_evidence_access(uuid)
  to authenticated;
grant execute on function public.get_payment_request_receipt_summary(uuid)
  to authenticated;
grant execute on function public.get_payment_batch_receipt_summary(uuid)
  to authenticated;

do $postcheck$
begin
  if not has_function_privilege(
       'authenticated',
       'public.link_payment_receipt_to_request(uuid,uuid,text)',
       'EXECUTE'
     )
     or has_function_privilege(
       'anon',
       'public.link_payment_receipt_to_request(uuid,uuid,text)',
       'EXECUTE'
     )
     or has_table_privilege(
       'authenticated',
       'public.payment_request_receipt_links',
       'INSERT'
     )
     or has_table_privilege(
       'authenticated',
       'public.payment_operation_evidence',
       'UPDATE'
     ) then
    raise exception 'payment_batch_033_privilege_postcheck_failed';
  end if;
end
$postcheck$;

commit;
