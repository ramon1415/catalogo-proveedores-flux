-- Flux Operadora - Migration 032
-- Canonical payment-batch ingestion, payable snapshots, review and reservations.
-- Deliberately excludes payment confirmation and the payment_receipts cutover.

begin;

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'companies', 'company_bank_accounts', 'profiles', 'roles', 'user_roles',
    'profile_company_memberships',
    'payment_requests', 'proveedores', 'approval_batches', 'approval_batch_items',
    'payment_request_extraordinary_authorizations'
  ] loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, 'public.' || v_name);
    end if;
  end loop;

  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    v_missing := array_append(v_missing, 'storage schema');
  end if;
  if to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.current_user_has_role(text[])') is null
     or to_regprocedure('public.flux_finance_roles()') is null
     or to_regprocedure('public.flux_sysadmin_roles()') is null
     or to_regprocedure('public.has_active_company_membership(uuid,uuid)') is null
     or to_regprocedure('public.get_payment_request_execution_readiness(uuid)') is null then
    v_missing := array_append(v_missing, 'identity and company access helpers');
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    v_missing := array_append(v_missing, 'extensions.digest(bytea,text)');
  end if;
  if cardinality(v_missing) > 0 then
    raise exception '032_precheck: missing required objects: %', array_to_string(v_missing, ', ');
  end if;

  if not exists (
    select 1
    from information_schema.columns column_info
    where column_info.table_schema = 'public'
      and column_info.table_name = 'payment_requests'
      and column_info.column_name = 'approval_material_updated_at'
  ) then
    raise exception '032_precheck: payment_requests.approval_material_updated_at is required';
  end if;

  foreach v_name in array array[
    'company_id', 'account_number', 'clabe', 'active', 'bank_name', 'currency'
  ]
  loop
    if not exists (
      select 1
      from information_schema.columns column_info
      where column_info.table_schema = 'public'
        and column_info.table_name = 'company_bank_accounts'
        and column_info.column_name = v_name
    ) then
      v_missing := array_append(v_missing, 'company_bank_accounts.' || v_name);
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    raise exception '032_precheck: missing required objects: %', array_to_string(v_missing, ', ');
  end if;

  if to_regclass('public.payment_ingestion_batches') is not null
     or to_regclass('public.payable_snapshots') is not null
     or to_regclass('public.bank_payment_operations') is not null then
    raise exception '032_precheck: payment batch domain already exists';
  end if;

  if exists (
    select 1 from storage.buckets bucket
    where bucket.id = 'payment-batch-documents'
       or bucket.name = 'payment-batch-documents'
  ) then
    raise exception '032_precheck: payment-batch-documents bucket already exists; inspect before applying';
  end if;
  if exists (
    select 1
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and (
        policy.policyname in (
          'Finance can upload payment batch documents',
          'Finance can read payment batch documents'
        )
        or position(
          'payment-batch-documents' in
          coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, '')
        ) > 0
      )
  ) then
    raise exception '032_precheck: storage.objects already has a payment-batch-documents policy';
  end if;
end
$$;

create table public.payment_matching_policy_versions (
  id uuid primary key default gen_random_uuid(),
  currency text not null,
  version integer not null,
  minor_unit_scale smallint not null,
  tolerance_minor bigint not null default 0,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_by uuid references public.profiles(id),
  retired_by uuid references public.profiles(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint payment_matching_policy_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payment_matching_policy_version_check check (version > 0),
  constraint payment_matching_policy_scale_check check (minor_unit_scale between 0 and 6),
  constraint payment_matching_policy_tolerance_check check (
    tolerance_minor between 0 and 9007199254740991
  ),
  constraint payment_matching_policy_validity_check check (valid_to is null or valid_to > valid_from),
  constraint payment_matching_policy_retirement_check check (
    (valid_to is null and retired_by is null)
    or (valid_to is not null and retired_by is not null)
  ),
  constraint payment_matching_policy_idempotency_check check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint payment_matching_policy_currency_version_key unique (currency, version),
  constraint payment_matching_policy_idempotency_key unique (currency, idempotency_key)
);

create unique index payment_matching_policy_active_uidx
  on public.payment_matching_policy_versions(currency)
  where valid_to is null;

insert into public.payment_matching_policy_versions(
  currency, version, minor_unit_scale, tolerance_minor, valid_from, idempotency_key
) values
  ('MXN', 1, 2, 0, now(), 'migration-032-mxn-v1'),
  ('USD', 1, 2, 0, now(), 'migration-032-usd-v1'),
  ('EUR', 1, 2, 0, now(), 'migration-032-eur-v1');

create table public.payable_snapshots (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id),
  company_id uuid not null references public.companies(id),
  version integer not null,
  amount_minor bigint not null,
  currency text not null,
  source_type text not null,
  source_id uuid not null,
  source_status text not null,
  source_approval_material_updated_at timestamptz not null,
  authorized_by uuid not null references public.profiles(id),
  authorized_at timestamptz not null,
  materialized_by uuid not null references public.profiles(id),
  materialized_at timestamptz not null default now(),
  reason text,
  constraint payable_snapshots_version_check check (version > 0),
  constraint payable_snapshots_amount_check check (
    amount_minor between 1 and 9007199254740991
  ),
  constraint payable_snapshots_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payable_snapshots_source_check check (source_type in ('approval_batch_item', 'extraordinary_authorization', 'legacy_backfill')),
  constraint payable_snapshots_request_version_key unique (payment_request_id, version),
  constraint payable_snapshots_source_key unique (source_type, source_id)
);

create index payable_snapshots_company_idx
  on public.payable_snapshots(company_id, materialized_at desc);
create index payable_snapshots_request_latest_idx
  on public.payable_snapshots(payment_request_id, version desc);

create table public.payment_ingestion_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_type text not null default 'bbva_net_cash',
  status text not null default 'awaiting_upload',
  -- Client-computed upload fingerprint. This is not a server-side attestation of
  -- the bytes stored in Storage and must not be treated as bank identity.
  document_sha256 text not null,
  original_file_name text not null,
  file_size_bytes bigint not null,
  idempotency_key text not null,
  page_count integer,
  extraction_count integer not null default 0,
  operation_count integer not null default 0,
  error_code text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_ingestion_batches_source_check check (source_type = 'bbva_net_cash'),
  constraint payment_ingestion_batches_status_check check (
    status in ('awaiting_upload', 'extracting', 'review_required', 'ready', 'failed', 'cancelled')
  ),
  constraint payment_ingestion_batches_sha_check check (document_sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_ingestion_batches_file_name_check check (
    char_length(original_file_name) between 1 and 255
    and original_file_name !~ '[/\\]'
    and original_file_name !~ '[[:cntrl:]]'
    and original_file_name !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
    and original_file_name !~* '[A-Z0-9]{24,}'
  ),
  constraint payment_ingestion_batches_size_check check (file_size_bytes between 1 and 26214400),
  constraint payment_ingestion_batches_page_count_check check (page_count is null or page_count between 1 and 500),
  constraint payment_ingestion_batches_idempotency_check check (char_length(idempotency_key) between 8 and 200),
  constraint payment_ingestion_batches_company_key unique (company_id, idempotency_key),
  constraint payment_ingestion_batches_document_key unique (company_id, document_sha256)
);

create index payment_ingestion_batches_company_status_idx
  on public.payment_ingestion_batches(company_id, status, created_at desc);

create table public.payment_documents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payment_ingestion_batches(id),
  company_id uuid not null references public.companies(id),
  document_kind text not null default 'source_pdf',
  storage_bucket text not null default 'payment-batch-documents',
  storage_path text not null,
  mime_type text not null default 'application/pdf',
  -- Mirrors the client-computed upload fingerprint until a separately
  -- authorized server-side object attestation exists.
  sha256 text not null,
  file_size_bytes bigint not null,
  page_count integer,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint payment_documents_kind_check check (document_kind = 'source_pdf'),
  constraint payment_documents_bucket_check check (storage_bucket = 'payment-batch-documents'),
  constraint payment_documents_mime_check check (mime_type = 'application/pdf'),
  constraint payment_documents_sha_check check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_documents_size_check check (file_size_bytes between 1 and 26214400),
  constraint payment_documents_page_count_check check (page_count is null or page_count between 1 and 500),
  constraint payment_documents_upload_actor_check check (
    (uploaded_by is null and uploaded_at is null)
    or (uploaded_by is not null and uploaded_at is not null)
  ),
  constraint payment_documents_batch_key unique (batch_id),
  constraint payment_documents_storage_key unique (storage_bucket, storage_path),
  constraint payment_documents_company_sha_key unique (company_id, sha256)
);

comment on column public.payment_documents.uploaded_by is
  'Authenticated finance actor who finalized the private Storage upload; not a server-side byte attestation.';

create table public.payment_document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.payment_documents(id),
  batch_id uuid not null references public.payment_ingestion_batches(id),
  company_id uuid not null references public.companies(id),
  page_number integer not null,
  status text not null default 'review_required',
  parser_version text not null,
  parser_confidence numeric(5,4),
  bank_name text not null default 'BBVA',
  bank_status text,
  bank_unique_folio text,
  application_date date,
  amount_minor bigint,
  currency text,
  source_account_hash text,
  source_account_last4 text,
  destination_account_hash text,
  destination_account_last4 text,
  beneficiary_name text,
  payment_reason text,
  extracted_evidence jsonb not null default '{}'::jsonb,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_document_extractions_page_check check (page_number between 1 and 500),
  constraint payment_document_extractions_status_check check (status in ('review_required', 'accepted', 'rejected', 'blocked')),
  constraint payment_document_extractions_confidence_check check (parser_confidence is null or parser_confidence between 0 and 1),
  constraint payment_document_extractions_bank_fields_check check (
    char_length(bank_name) between 1 and 80
    and bank_name !~ '[[:cntrl:]]'
    and (
      bank_status is null
      or (char_length(bank_status) between 1 and 40 and bank_status !~ '[[:cntrl:]]')
    )
    and (
      bank_unique_folio is null
      or (
        char_length(bank_unique_folio) between 8 and 120
        and bank_unique_folio = upper(bank_unique_folio)
        and bank_unique_folio ~ '^[A-Z0-9-]+$'
        and bank_unique_folio !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint payment_document_extractions_amount_check check (
    amount_minor is null or amount_minor between 1 and 9007199254740991
  ),
  constraint payment_document_extractions_currency_check check (currency is null or (currency = upper(currency) and currency ~ '^[A-Z]{3}$')),
  constraint payment_document_extractions_hash_check check (
    (source_account_hash is null or source_account_hash ~ '^[0-9a-f]{64}$')
    and (destination_account_hash is null or destination_account_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint payment_document_extractions_last4_check check (
    (source_account_last4 is null or source_account_last4 ~ '^[A-Z0-9]{1,4}$')
    and (destination_account_last4 is null or destination_account_last4 ~ '^[A-Z0-9]{1,4}$')
  ),
  constraint payment_document_extractions_free_text_check check (
    (
      beneficiary_name is null
      or (
        char_length(beneficiary_name) <= 180
        and beneficiary_name !~ '[[:cntrl:]]'
        and beneficiary_name !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
        and beneficiary_name !~* '[A-Z0-9]{24,}'
      )
    )
    and (
      payment_reason is null
      or (
        char_length(payment_reason) <= 500
        and payment_reason !~ '[[:cntrl:]]'
        and payment_reason !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
        and payment_reason !~* '[A-Z0-9]{24,}'
      )
    )
    and (
      rejection_reason is null
      or (
        char_length(rejection_reason) <= 500
        and rejection_reason !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
        and rejection_reason !~* '[A-Z0-9]{24,}'
        and rejection_reason !~ '[[:cntrl:]]'
      )
    )
  ),
  constraint payment_document_extractions_review_check check (
    (status in ('review_required', 'blocked') and reviewed_by is null and reviewed_at is null)
    or (status = 'accepted' and reviewed_by is not null and reviewed_at is not null and rejection_reason is null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and nullif(btrim(rejection_reason), '') is not null)
  ),
  constraint payment_document_extractions_page_key unique (document_id, page_number)
);

create index payment_document_extractions_batch_status_idx
  on public.payment_document_extractions(batch_id, status, page_number);

create table public.bank_payment_operations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  source_company_bank_account_id uuid not null references public.company_bank_accounts(id),
  extraction_id uuid not null references public.payment_document_extractions(id),
  bank_name text not null,
  fingerprint_version integer not null default 1,
  operation_fingerprint text not null,
  bank_unique_folio text not null,
  application_date date not null,
  amount_minor bigint not null,
  currency text not null,
  source_account_hash text not null,
  source_account_last4 text not null,
  destination_account_hash text,
  destination_account_last4 text,
  beneficiary_name text,
  payment_reason text,
  status text not null default 'available',
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint bank_payment_operations_bank_check check (upper(btrim(bank_name)) = 'BBVA'),
  constraint bank_payment_operations_bank_fields_check check (
    char_length(bank_name) between 1 and 80
    and bank_name !~ '[[:cntrl:]]'
    and char_length(bank_unique_folio) between 8 and 120
    and bank_unique_folio = upper(bank_unique_folio)
    and bank_unique_folio ~ '^[A-Z0-9-]+$'
    and bank_unique_folio !~ '[[:cntrl:]]'
  ),
  constraint bank_payment_operations_fingerprint_version_check check (fingerprint_version = 1),
  constraint bank_payment_operations_fingerprint_check check (operation_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint bank_payment_operations_folio_check check (
    bank_unique_folio = btrim(bank_unique_folio)
  ),
  constraint bank_payment_operations_hash_check check (
    source_account_hash ~ '^[0-9a-f]{64}$'
    and (destination_account_hash is null or destination_account_hash ~ '^[0-9a-f]{64}$')
  ),
  constraint bank_payment_operations_last4_check check (
    (source_account_last4 is null or source_account_last4 ~ '^[A-Z0-9]{1,4}$')
    and (destination_account_last4 is null or destination_account_last4 ~ '^[A-Z0-9]{1,4}$')
  ),
  constraint bank_payment_operations_free_text_check check (
    (
      beneficiary_name is null
      or (
        char_length(beneficiary_name) <= 180
        and beneficiary_name !~ '[[:cntrl:]]'
        and beneficiary_name !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
        and beneficiary_name !~* '[A-Z0-9]{24,}'
      )
    )
    and (
      payment_reason is null
      or (
        char_length(payment_reason) <= 500
        and payment_reason !~ '[[:cntrl:]]'
        and payment_reason !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
        and payment_reason !~* '[A-Z0-9]{24,}'
      )
    )
  ),
  constraint bank_payment_operations_amount_check check (
    amount_minor between 1 and 9007199254740991
  ),
  constraint bank_payment_operations_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint bank_payment_operations_status_check check (status in ('available', 'reserved', 'cancelled')),
  constraint bank_payment_operations_extraction_key unique (extraction_id),
  constraint bank_payment_operations_fingerprint_key unique (operation_fingerprint),
  constraint bank_payment_operations_company_folio_key unique (
    company_id, bank_unique_folio
  )
);

create index bank_payment_operations_company_status_idx
  on public.bank_payment_operations(company_id, status, application_date desc);

create table public.payment_operation_documents (
  operation_id uuid not null references public.bank_payment_operations(id),
  document_id uuid not null references public.payment_documents(id),
  page_number integer not null,
  created_at timestamptz not null default now(),
  primary key (operation_id, document_id, page_number),
  constraint payment_operation_documents_page_check check (page_number between 1 and 500)
);

create table public.payment_allocation_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  status text not null default 'draft',
  total_amount_minor bigint not null,
  currency text not null,
  proposed_by uuid not null references public.profiles(id),
  proposed_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_allocation_plans_status_check check (status in ('draft', 'reserved', 'cancelled')),
  constraint payment_allocation_plans_amount_check check (
    total_amount_minor between 1 and 9007199254740991
  ),
  constraint payment_allocation_plans_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payment_allocation_plans_cancel_check check (
    (status <> 'cancelled' and cancelled_by is null and cancelled_at is null and cancel_reason is null)
    or (status = 'cancelled' and cancelled_by is not null and cancelled_at is not null and nullif(btrim(cancel_reason), '') is not null)
  ),
  constraint payment_allocation_plans_reason_check check (
    cancel_reason is null
    or (
      char_length(cancel_reason) <= 500
      and cancel_reason !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
      and cancel_reason !~* '[A-Z0-9]{24,}'
      and cancel_reason !~ '[[:cntrl:]]'
    )
  )
);

create unique index payment_allocation_plans_open_operation_uidx
  on public.payment_allocation_plans(operation_id)
  where status in ('draft', 'reserved');

create table public.payment_allocation_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.payment_allocation_plans(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  snapshot_id uuid not null references public.payable_snapshots(id),
  amount_minor bigint not null,
  currency text not null,
  position integer not null,
  note text,
  created_at timestamptz not null default now(),
  constraint payment_allocation_items_amount_check check (
    amount_minor between 1 and 9007199254740991
  ),
  constraint payment_allocation_items_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payment_allocation_items_position_check check (position > 0),
  constraint payment_allocation_items_note_check check (
    note is null
    or (
      char_length(note) <= 300
      and note !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
      and note !~* '[A-Z0-9]{24,}'
      and note !~ '[[:cntrl:]]'
    )
  ),
  constraint payment_allocation_items_plan_snapshot_key unique (plan_id, snapshot_id),
  constraint payment_allocation_items_plan_position_key unique (plan_id, position)
);

create index payment_allocation_items_snapshot_idx
  on public.payment_allocation_items(snapshot_id);

create table public.payment_allocation_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  plan_id uuid not null references public.payment_allocation_plans(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  amount_minor bigint not null,
  currency text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  close_reason text,
  constraint payment_allocation_reservations_amount_check check (
    amount_minor between 1 and 9007199254740991
  ),
  constraint payment_allocation_reservations_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payment_allocation_reservations_status_check check (status in ('active', 'released', 'cancelled', 'expired')),
  constraint payment_allocation_reservations_expiry_check check (expires_at > created_at),
  constraint payment_allocation_reservations_close_check check (
    (
      status = 'active'
      and closed_by is null
      and closed_at is null
      and close_reason is null
    )
    or (
      status <> 'active'
      and closed_by is not null
      and closed_at is not null
      and nullif(btrim(close_reason), '') is not null
    )
  ),
  constraint payment_allocation_reservations_reason_check check (
    close_reason is null
    or (
      char_length(close_reason) <= 500
      and close_reason !~ '([0-9][^[:alnum:]]*){9,19}[0-9]'
      and close_reason !~* '[A-Z0-9]{24,}'
      and close_reason !~ '[[:cntrl:]]'
    )
  )
);

create unique index payment_allocation_reservations_active_plan_uidx
  on public.payment_allocation_reservations(plan_id)
  where status = 'active';
create index payment_allocation_reservations_operation_idx
  on public.payment_allocation_reservations(operation_id, status, expires_at);

create table public.payment_allocation_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  operation_id uuid not null references public.bank_payment_operations(id),
  snapshot_id uuid not null references public.payable_snapshots(id),
  plan_item_id uuid references public.payment_allocation_items(id),
  movement_type text not null,
  original_movement_id uuid references public.payment_allocation_movements(id),
  amount_minor bigint not null,
  currency text not null,
  actor_profile_id uuid not null references public.profiles(id),
  reason text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint payment_allocation_movements_type_check check (movement_type in ('confirmation', 'reversal')),
  constraint payment_allocation_movements_amount_check check (
    amount_minor between 1 and 9007199254740991
  ),
  constraint payment_allocation_movements_currency_check check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint payment_allocation_movements_original_check check (
    (movement_type = 'confirmation' and original_movement_id is null)
    or (movement_type = 'reversal' and original_movement_id is not null and nullif(btrim(reason), '') is not null)
  ),
  constraint payment_allocation_movements_idempotency_check check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint payment_allocation_movements_idempotency_key unique (company_id, idempotency_key)
);

create index payment_allocation_movements_operation_idx
  on public.payment_allocation_movements(operation_id, created_at);
create index payment_allocation_movements_snapshot_idx
  on public.payment_allocation_movements(snapshot_id, created_at);

create table public.financial_command_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  command_scope text not null,
  idempotency_key text not null,
  payload_hash text not null,
  actor_profile_id uuid not null references public.profiles(id),
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint financial_command_receipts_scope_check check (command_scope ~ '^[a-z0-9_.-]{3,80}$'),
  constraint financial_command_receipts_key_check check (char_length(idempotency_key) between 8 and 200),
  constraint financial_command_receipts_hash_check check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint financial_command_receipts_scope_key unique (company_id, command_scope, idempotency_key)
);

create table public.financial_outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_version integer not null default 1,
  aggregate_type text not null,
  aggregate_id uuid not null,
  company_id uuid not null references public.companies(id),
  actor_profile_id uuid not null references public.profiles(id),
  correlation_id uuid,
  causation_id uuid,
  idempotency_key text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  constraint financial_outbox_events_type_check check (event_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint financial_outbox_events_version_check check (event_version = 1),
  constraint financial_outbox_events_idempotency_check check (
    char_length(idempotency_key) between 8 and 200
  ),
  constraint financial_outbox_events_payload_object_check check (jsonb_typeof(payload) = 'object'),
  constraint financial_outbox_events_idempotency_key unique (
    company_id, event_type, idempotency_key
  )
);

create index financial_outbox_events_aggregate_idx
  on public.financial_outbox_events(aggregate_type, aggregate_id, occurred_at);
create index financial_outbox_events_occurred_idx
  on public.financial_outbox_events(occurred_at);

create table public.financial_outbox_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.financial_outbox_events(id),
  consumer_name text not null,
  attempt_number integer not null,
  status text not null,
  attempted_at timestamptz not null default now(),
  next_attempt_at timestamptz,
  error_code text,
  constraint financial_outbox_delivery_attempts_number_check check (attempt_number > 0),
  constraint financial_outbox_delivery_attempts_status_check check (status in ('claimed', 'delivered', 'failed', 'dead_letter')),
  constraint financial_outbox_delivery_attempts_event_consumer_key unique (event_id, consumer_name, attempt_number)
);

create table public.financial_break_glass_audit (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  actor_profile_id uuid not null references public.profiles(id),
  capability text not null,
  reason text not null,
  scope jsonb not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint financial_break_glass_reason_check check (char_length(btrim(reason)) >= 20),
  constraint financial_break_glass_window_check check (ends_at > starts_at),
  constraint financial_break_glass_scope_check check (jsonb_typeof(scope) = 'object')
);

create table public.legacy_payment_receipt_links (
  id uuid primary key default gen_random_uuid(),
  legacy_payment_receipt_id uuid not null,
  movement_id uuid references public.payment_allocation_movements(id),
  link_status text not null,
  review_reason text,
  linked_by uuid references public.profiles(id),
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint legacy_payment_receipt_links_status_check check (link_status in ('pending_review', 'linked', 'quarantined')),
  constraint legacy_payment_receipt_links_legacy_key unique (legacy_payment_receipt_id),
  constraint legacy_payment_receipt_links_link_check check (
    (link_status = 'linked' and movement_id is not null and linked_by is not null and linked_at is not null)
    or (link_status <> 'linked' and movement_id is null)
  )
);

create function public.payment_reconciliation_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end
$$;

create trigger payment_ingestion_batches_set_updated_at
  before update on public.payment_ingestion_batches
  for each row execute function public.payment_reconciliation_set_updated_at();
create trigger payment_document_extractions_set_updated_at
  before update on public.payment_document_extractions
  for each row execute function public.payment_reconciliation_set_updated_at();
create trigger payment_allocation_plans_set_updated_at
  before update on public.payment_allocation_plans
  for each row execute function public.payment_reconciliation_set_updated_at();

create function public.payment_reconciliation_normalize_currency(p_currency text)
returns text
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_currency text := upper(nullif(btrim(p_currency), ''));
begin
  if v_currency = 'MXP' then
    v_currency := 'MXN';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_currency';
  end if;
  return v_currency;
end
$$;

create function public.payment_reconciliation_normalize_bank_name(p_bank_name text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select upper(nullif(regexp_replace(btrim(p_bank_name), '[[:space:]]+', ' ', 'g'), ''));
$$;

create function public.payment_amount_to_minor(p_amount numeric, p_currency text)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_currency text := public.payment_reconciliation_normalize_currency(p_currency);
  v_scale smallint;
  v_factor numeric;
  v_scaled numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_must_be_positive';
  end if;
  select policy.minor_unit_scale
    into v_scale
  from public.payment_matching_policy_versions policy
  where policy.currency = v_currency
    and policy.valid_from <= now()
    and (policy.valid_to is null or policy.valid_to > now())
  order by policy.version desc
  limit 1;
  if v_scale is null then
    raise exception 'currency_policy_not_found';
  end if;
  v_factor := power(10::numeric, v_scale);
  v_scaled := p_amount * v_factor;
  if v_scaled <> trunc(v_scaled) then
    raise exception 'amount_exceeds_currency_precision';
  end if;
  if v_scaled > 9007199254740991::numeric then
    raise exception 'amount_out_of_range';
  end if;
  return v_scaled::bigint;
end
$$;

create function public.rotate_payment_matching_policy(
  p_currency text,
  p_minor_unit_scale smallint,
  p_tolerance_minor bigint,
  p_effective_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_currency text := public.payment_reconciliation_normalize_currency(p_currency);
  v_effective_at timestamptz;
  v_current public.payment_matching_policy_versions%rowtype;
  v_existing public.payment_matching_policy_versions%rowtype;
  v_new public.payment_matching_policy_versions%rowtype;
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'sysadmin_role_required';
  end if;
  if p_minor_unit_scale is null or p_minor_unit_scale not between 0 and 6
     or p_tolerance_minor is null
     or p_tolerance_minor not between 0 and 9007199254740991 then
    raise exception 'invalid_payment_matching_policy';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'invalid_idempotency_key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('payment_matching_policy:' || v_currency, 32032));
  select * into v_existing
  from public.payment_matching_policy_versions policy
  where policy.currency = v_currency
    and policy.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.currency <> v_currency
       or v_existing.minor_unit_scale <> p_minor_unit_scale
       or v_existing.tolerance_minor <> p_tolerance_minor
       or v_existing.created_by is distinct from v_actor
       or (p_effective_at is not null and v_existing.valid_from <> p_effective_at) then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object(
      'currency', v_existing.currency,
      'policy_id', v_existing.id,
      'valid_from', v_existing.valid_from,
      'version', v_existing.version
    );
  end if;

  v_effective_at := coalesce(p_effective_at, clock_timestamp());
  if v_effective_at < clock_timestamp() - interval '1 minute'
     or v_effective_at > clock_timestamp() + interval '1 year' then
    raise exception 'invalid_policy_effective_at';
  end if;
  select * into v_current
  from public.payment_matching_policy_versions policy
  where policy.currency = v_currency and policy.valid_to is null
  for update;
  if not found then raise exception 'active_currency_policy_not_found'; end if;
  if p_minor_unit_scale <> v_current.minor_unit_scale then
    raise exception 'currency_minor_unit_scale_is_immutable';
  end if;
  if v_effective_at <= v_current.valid_from then
    raise exception 'policy_effective_at_must_advance';
  end if;

  update public.payment_matching_policy_versions
  set valid_to = v_effective_at, retired_by = v_actor
  where id = v_current.id;
  insert into public.payment_matching_policy_versions(
    currency, version, minor_unit_scale, tolerance_minor, valid_from,
    created_by, idempotency_key
  ) values (
    v_currency, v_current.version + 1, p_minor_unit_scale,
    p_tolerance_minor, v_effective_at, v_actor, p_idempotency_key
  ) returning * into v_new;
  return jsonb_build_object(
    'currency', v_new.currency,
    'policy_id', v_new.id,
    'valid_from', v_new.valid_from,
    'version', v_new.version
  );
end
$$;

create function public.payment_reconciliation_hash_text(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(coalesce(p_value, ''), 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create function public.payment_reconciliation_account_material(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select nullif(regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

create function public.payment_reconciliation_account_hash(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when public.payment_reconciliation_account_material(p_value) is null
      or public.payment_reconciliation_account_material(p_value) !~ '^[0-9]{10,18}$'
      then null
    else public.payment_reconciliation_hash_text(public.payment_reconciliation_account_material(p_value))
  end;
$$;

create function public.payment_reconciliation_account_last4(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select right(public.payment_reconciliation_account_material(p_value), 4);
$$;

create function public.payment_reconciliation_redact_free_text(
  p_value text,
  p_max_length integer
)
returns text
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_value text := nullif(btrim(p_value), '');
begin
  if v_value is null then return null; end if;
  if p_max_length is null or p_max_length not between 1 and 1000 then
    raise exception 'invalid_free_text_limit';
  end if;
  if v_value ~ '[[:cntrl:]]' then
    raise exception 'invalid_free_text_control_character';
  end if;
  v_value := regexp_replace(
    v_value,
    '([0-9][^[:alnum:]]*){9,19}[0-9]',
    '[DATO BANCARIO REDACTADO]',
    'g'
  );
  v_value := regexp_replace(v_value, '[A-Z0-9]{24,}', '[TOKEN REDACTADO]', 'gi');
  return nullif(btrim(left(v_value, p_max_length)), '');
end
$$;

create function public.payment_reconciliation_payload_hash(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select public.payment_reconciliation_hash_text(coalesce(p_payload, '{}'::jsonb)::text);
$$;

create function public.payment_reconciliation_require_finance(p_company_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
begin
  if v_actor is null then
    raise exception 'not_authenticated';
  end if;
  if not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception 'finance_role_required';
  end if;
  if p_company_id is null or not exists (
    select 1 from public.companies c where c.id = p_company_id and coalesce(c.active, true)
  ) then
    raise exception 'company_not_found';
  end if;
  if not public.current_user_has_role(public.flux_sysadmin_roles())
     and not public.has_active_company_membership(v_actor, p_company_id) then
    raise exception 'company_access_denied';
  end if;
  return v_actor;
end
$$;

create function public.payment_reconciliation_storage_path_allowed(
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
    from public.payment_documents document
    join public.payment_ingestion_batches batch on batch.id = document.batch_id
    where document.storage_bucket = 'payment-batch-documents'
      and document.storage_path = p_storage_path
      and batch.company_id = document.company_id
      and public.current_profile_id() is not null
      and public.current_user_has_role(public.flux_finance_roles())
      and (
        public.current_user_has_role(public.flux_sysadmin_roles())
        or public.has_active_company_membership(
          public.current_profile_id(),
          document.company_id
        )
      )
      and (
        not p_for_upload
        or (
          batch.status = 'awaiting_upload'
          and document.uploaded_at is null
        )
      )
  );
$$;

create function public.payment_reconciliation_command_replay(
  p_company_id uuid,
  p_scope text,
  p_idempotency_key text,
  p_payload_hash text,
  p_actor_profile_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_receipt public.financial_command_receipts%rowtype;
begin
  if p_company_id is null
     or p_scope is null or p_scope !~ '^[a-z0-9_.-]{3,80}$'
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 200
     or p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_idempotency_material';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_company_id::text || chr(31) || p_scope || chr(31) || p_idempotency_key,
    0
  ));
  select * into v_receipt
  from public.financial_command_receipts receipt
  where receipt.company_id = p_company_id
    and receipt.command_scope = p_scope
    and receipt.idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;
  if v_receipt.payload_hash <> p_payload_hash
     or v_receipt.actor_profile_id <> p_actor_profile_id then
    raise exception 'idempotency_key_conflict';
  end if;
  return v_receipt.result;
end
$$;

create function public.payment_reconciliation_store_command(
  p_company_id uuid,
  p_scope text,
  p_idempotency_key text,
  p_payload_hash text,
  p_actor_profile_id uuid,
  p_result jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.financial_command_receipts(
    company_id, command_scope, idempotency_key, payload_hash, actor_profile_id, result
  ) values (
    p_company_id, p_scope, p_idempotency_key, p_payload_hash, p_actor_profile_id, p_result
  );
  return p_result;
end
$$;

create function public.append_financial_outbox_event_internal(
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_company_id uuid,
  p_actor_profile_id uuid,
  p_payload jsonb,
  p_correlation_id uuid default null,
  p_causation_id uuid default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_idempotency_key text := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    p_event_type || ':' || p_aggregate_id::text
  );
begin
  if char_length(v_idempotency_key) not between 8 and 200 then
    raise exception 'invalid_outbox_idempotency_key';
  end if;
  if p_payload::text ~* '(account|cuenta|clabe)[^,}]*[0-9]{5,}' then
    raise exception 'outbox_payload_contains_unmasked_bank_data';
  end if;
  insert into public.financial_outbox_events(
    event_type, event_version, aggregate_type, aggregate_id, company_id,
    actor_profile_id, correlation_id, causation_id, idempotency_key, payload,
    occurred_at
  ) values (
    p_event_type, 1, p_aggregate_type, p_aggregate_id, p_company_id,
    p_actor_profile_id, p_correlation_id, p_causation_id, v_idempotency_key,
    p_payload, clock_timestamp()
  ) returning id into v_id;
  return v_id;
end
$$;

create function public.payment_reconciliation_protect_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception '%_is_append_only', tg_table_name;
end
$$;

create function public.payment_reconciliation_protect_policy_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'payment_matching_policy_versions_is_append_only';
  end if;
  if old.valid_to is not null
     or new.valid_to is null
     or new.valid_to <= old.valid_from
     or new.retired_by is null
     or new.retired_by is distinct from public.current_profile_id()
     or not public.current_user_has_role(public.flux_sysadmin_roles())
     or new.id is distinct from old.id
     or new.currency is distinct from old.currency
     or new.version is distinct from old.version
     or new.minor_unit_scale is distinct from old.minor_unit_scale
     or new.tolerance_minor is distinct from old.tolerance_minor
     or new.valid_from is distinct from old.valid_from
     or new.created_by is distinct from old.created_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'payment_matching_policy_version_update_forbidden';
  end if;
  return new;
end
$$;

create trigger payable_snapshots_immutable
  before update or delete on public.payable_snapshots
  for each row execute function public.payment_reconciliation_protect_immutable();
create trigger payment_allocation_movements_immutable
  before update or delete on public.payment_allocation_movements
  for each row execute function public.payment_reconciliation_protect_immutable();
create trigger financial_command_receipts_immutable
  before update or delete on public.financial_command_receipts
  for each row execute function public.payment_reconciliation_protect_immutable();
create trigger financial_outbox_events_immutable
  before update or delete on public.financial_outbox_events
  for each row execute function public.payment_reconciliation_protect_immutable();
create trigger financial_break_glass_audit_immutable
  before update or delete on public.financial_break_glass_audit
  for each row execute function public.payment_reconciliation_protect_immutable();

create function public.create_payable_snapshot_internal(
  p_payment_request_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_source_status text,
  p_authorized_by uuid,
  p_authorized_at timestamptz,
  p_materialized_by uuid,
  p_reason text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.payment_requests%rowtype;
  v_existing public.payable_snapshots%rowtype;
  v_currency text;
  v_amount_minor bigint;
  v_version integer;
  v_id uuid;
  v_readiness jsonb;
  v_expected_authorization_source text;
begin
  if p_source_type not in ('approval_batch_item', 'extraordinary_authorization', 'legacy_backfill')
     or p_source_id is null or p_authorized_by is null or p_authorized_at is null
     or p_materialized_by is null then
    raise exception 'invalid_snapshot_source';
  end if;
  select * into v_request
  from public.payment_requests pr
  where pr.id = p_payment_request_id
  for update;
  if not found or v_request.company_id is null then
    raise exception 'payment_request_not_found';
  end if;

  if p_source_type = 'approval_batch_item' then
    if p_source_status is distinct from 'closed' or not exists (
      select 1
      from public.approval_batch_items item
      join public.approval_batches batch on batch.id = item.batch_id
      where item.id = p_source_id
        and item.payment_request_id = v_request.id
        and item.removed_at is null
        and item.director_status = 'approved'
        and item.decided_by = p_authorized_by
        and item.decided_at is not distinct from p_authorized_at
        and batch.status = 'closed'
        and batch.closed_by = p_materialized_by
        and batch.closed_at is not null
    ) then
      raise exception 'invalid_closed_batch_snapshot_source';
    end if;
    v_expected_authorization_source := 'closed_batch';
  elsif p_source_type = 'extraordinary_authorization' then
    if p_source_status is distinct from 'active' or not exists (
      select 1
      from public.payment_request_extraordinary_authorizations extraordinary_authorization
      where extraordinary_authorization.id = p_source_id
        and extraordinary_authorization.payment_request_id = v_request.id
        and extraordinary_authorization.status = 'active'
        and extraordinary_authorization.authorized_by = p_authorized_by
        and extraordinary_authorization.authorized_at is not distinct from p_authorized_at
        and p_materialized_by = extraordinary_authorization.authorized_by
    ) then
      raise exception 'invalid_extraordinary_snapshot_source';
    end if;
    v_expected_authorization_source := 'extraordinary';
  else
    raise exception 'legacy_snapshot_backfill_not_enabled';
  end if;

  v_readiness := public.get_payment_request_execution_readiness(v_request.id);
  if not coalesce((v_readiness->>'can_execute')::boolean, false)
     or v_readiness->>'authorization_source' is distinct from v_expected_authorization_source
     or p_authorized_at < v_request.approval_material_updated_at then
    raise exception 'snapshot_source_not_currently_payable';
  end if;
  v_currency := public.payment_reconciliation_normalize_currency(v_request.currency);
  v_amount_minor := public.payment_amount_to_minor(v_request.amount_requested, v_currency);

  select * into v_existing
  from public.payable_snapshots snapshot
  where snapshot.source_type = p_source_type and snapshot.source_id = p_source_id;
  if found then
    if v_existing.payment_request_id <> p_payment_request_id
       or v_existing.amount_minor <> v_amount_minor
       or v_existing.currency <> v_currency
       or v_existing.authorized_by <> p_authorized_by
       or v_existing.authorized_at <> p_authorized_at then
      raise exception 'payable_snapshot_source_conflict';
    end if;
    return v_existing.id;
  end if;

  if exists (
    select 1
    from public.payment_allocation_reservations reservation
    join public.payment_allocation_items item on item.plan_id = reservation.plan_id
    join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
    where snapshot.payment_request_id = p_payment_request_id
      and reservation.status = 'active' and reservation.expires_at > now()
  ) then
    raise exception 'payable_snapshot_reapproval_blocked_by_active_reservation';
  end if;
  if exists (
    select 1
    from public.payment_allocation_movements movement
    join public.payable_snapshots snapshot on snapshot.id = movement.snapshot_id
    where snapshot.payment_request_id = p_payment_request_id
    group by movement.snapshot_id
    having sum(case movement.movement_type when 'confirmation' then movement.amount_minor else -movement.amount_minor end) <> 0
  ) then
    raise exception 'payable_snapshot_reapproval_blocked_by_confirmed_allocations';
  end if;

  select coalesce(max(snapshot.version), 0) + 1 into v_version
  from public.payable_snapshots snapshot
  where snapshot.payment_request_id = p_payment_request_id;

  insert into public.payable_snapshots(
    payment_request_id, company_id, version, amount_minor, currency,
    source_type, source_id, source_status, source_approval_material_updated_at,
    authorized_by, authorized_at, materialized_by, materialized_at, reason
  ) values (
    v_request.id, v_request.company_id, v_version, v_amount_minor, v_currency,
    p_source_type, p_source_id, p_source_status, v_request.approval_material_updated_at,
    p_authorized_by, p_authorized_at, p_materialized_by, clock_timestamp(),
    nullif(btrim(p_reason), '')
  ) returning id into v_id;
  perform public.append_financial_outbox_event_internal(
    'payable_snapshot.created',
    'payable_snapshot',
    v_id,
    v_request.company_id,
    p_materialized_by,
    jsonb_build_object(
      'amount_minor', v_amount_minor,
      'currency', v_currency,
      'payment_request_id', v_request.id,
      'snapshot_id', v_id,
      'source_id', p_source_id,
      'source_type', p_source_type,
      'version', v_version
    ),
    v_request.id,
    p_source_id,
    'payable_snapshot.created:' || p_source_type || ':' || p_source_id::text
  );
  return v_id;
end
$$;

create function public.materialize_closed_batch_payable_snapshots()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_item record;
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;
  if new.closed_by is null or new.closed_at is null then
    raise exception 'closed_batch_actor_required';
  end if;
  for v_item in
    select item.id, item.payment_request_id, item.decided_by, item.decided_at
    from public.approval_batch_items item
    where item.batch_id = new.id
      and item.removed_at is null
      and item.director_status = 'approved'
    order by item.payment_request_id, item.id
  loop
    perform public.create_payable_snapshot_internal(
      v_item.payment_request_id,
      'approval_batch_item',
      v_item.id,
      'closed',
      v_item.decided_by,
      v_item.decided_at,
      new.closed_by,
      'Authorized by closed approval batch ' || new.id::text
    );
  end loop;
  return new;
end
$$;

create trigger materialize_closed_batch_payable_snapshots
  after update of status on public.approval_batches
  for each row execute function public.materialize_closed_batch_payable_snapshots();

create function public.materialize_extraordinary_payable_snapshot()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' then
    return new;
  end if;
  perform public.create_payable_snapshot_internal(
    new.payment_request_id,
    'extraordinary_authorization',
    new.id,
    'active',
    new.authorized_by,
    new.authorized_at,
    new.authorized_by,
    new.category || ': ' || new.reason
  );
  return new;
end
$$;

create trigger materialize_extraordinary_payable_snapshot
  after insert or update of status on public.payment_request_extraordinary_authorizations
  for each row execute function public.materialize_extraordinary_payable_snapshot();

create function public.payment_operation_confirmed_minor(p_operation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case movement.movement_type when 'confirmation' then movement.amount_minor else -movement.amount_minor end), 0)::bigint
  from public.payment_allocation_movements movement
  where movement.operation_id = p_operation_id;
$$;

create function public.payable_snapshot_confirmed_minor(p_snapshot_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case movement.movement_type when 'confirmation' then movement.amount_minor else -movement.amount_minor end), 0)::bigint
  from public.payment_allocation_movements movement
  where movement.snapshot_id = p_snapshot_id;
$$;

create function public.payment_operation_reserved_minor(p_operation_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(reservation.amount_minor), 0)::bigint
  from public.payment_allocation_reservations reservation
  where reservation.operation_id = p_operation_id
    and reservation.status = 'active'
    and reservation.expires_at > now();
$$;

create function public.payable_snapshot_reserved_minor(p_snapshot_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(item.amount_minor), 0)::bigint
  from public.payment_allocation_reservations reservation
  join public.payment_allocation_items item on item.plan_id = reservation.plan_id
  where item.snapshot_id = p_snapshot_id
    and reservation.status = 'active'
    and reservation.expires_at > now();
$$;

create function public.payment_reconciliation_snapshot_is_payable(p_snapshot_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_snapshot public.payable_snapshots%rowtype;
  v_readiness jsonb;
  v_authorization_source text;
begin
  select * into v_snapshot from public.payable_snapshots where id = p_snapshot_id;
  if not found then return false; end if;
  v_readiness := public.get_payment_request_execution_readiness(v_snapshot.payment_request_id);
  if not coalesce((v_readiness->>'can_execute')::boolean, false) then return false; end if;
  v_authorization_source := v_readiness->>'authorization_source';
  return case v_snapshot.source_type
    when 'approval_batch_item' then v_authorization_source = 'closed_batch'
    when 'extraordinary_authorization' then v_authorization_source = 'extraordinary'
    when 'legacy_backfill' then v_authorization_source = 'legacy_approved'
    else false
  end;
end
$$;

create function public.payment_operation_fingerprint_v1(
  p_company_id uuid,
  p_bank_name text,
  p_bank_unique_folio text,
  p_application_date date,
  p_amount_minor bigint,
  p_currency text,
  p_source_account_hash text,
  p_destination_account_hash text
)
returns text
language sql
immutable
security invoker
set search_path = public, pg_temp
as $$
  select public.payment_reconciliation_payload_hash(
    jsonb_build_object(
      'amount_minor', p_amount_minor,
      'application_date', p_application_date,
      'bank', upper(btrim(p_bank_name)),
      'bank_unique_folio', upper(btrim(coalesce(p_bank_unique_folio, ''))),
      'company_id', p_company_id,
      'currency', public.payment_reconciliation_normalize_currency(p_currency),
      'destination_account_hash', coalesce(p_destination_account_hash, ''),
      'fingerprint_version', 1,
      'source_account_hash', coalesce(p_source_account_hash, '')
    )
  );
$$;

create function public.get_payment_batch_context()
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
      'can_confirm', false,
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
    'confirmation_block_reason', 'legacy_payment_receipts_cutover_required'
  );
end
$$;

create function public.create_payment_ingestion_batch(
  p_company_id uuid,
  p_file_name text,
  p_file_size_bytes bigint,
  p_document_sha256 text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.payment_reconciliation_require_finance(p_company_id);
  v_sha text := lower(btrim(p_document_sha256));
  v_file_name text := public.payment_reconciliation_redact_free_text(p_file_name, 255);
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_existing record;
  v_batch_id uuid := gen_random_uuid();
  v_document_id uuid := gen_random_uuid();
  v_storage_path text;
  v_result jsonb;
begin
  v_payload := jsonb_build_object(
    'company_id', p_company_id,
    'document_sha256', v_sha,
    'file_name', v_file_name,
    'file_size_bytes', p_file_size_bytes
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    p_company_id, 'payment_batch.create', p_idempotency_key, v_payload_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;

  if v_sha !~ '^[0-9a-f]{64}$' then raise exception 'invalid_document_sha256'; end if;
  if v_file_name is null or char_length(v_file_name) not between 1 and 255
     or v_file_name ~ '[/\\]' or v_file_name ~ '[[:cntrl:]]'
     or lower(v_file_name) !~ '\.pdf$' then
    raise exception 'invalid_pdf_file_name';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes not between 1 and 26214400 then
    raise exception 'invalid_pdf_file_size';
  end if;

  select batch.id, batch.status, document.id as document_id, document.storage_bucket, document.storage_path
    into v_existing
  from public.payment_ingestion_batches batch
  join public.payment_documents document on document.batch_id = batch.id
  where batch.company_id = p_company_id and batch.document_sha256 = v_sha;
  if found then
    v_result := jsonb_build_object(
      'batch_id', v_existing.id,
      'document_id', v_existing.document_id,
      'storage_bucket', v_existing.storage_bucket,
      'storage_path', v_existing.storage_path,
      'status', v_existing.status,
      'duplicate', true
    );
    return public.payment_reconciliation_store_command(
      p_company_id, 'payment_batch.create', p_idempotency_key, v_payload_hash, v_actor, v_result
    );
  end if;

  v_storage_path := p_company_id::text || '/' || v_batch_id::text || '/source.pdf';
  insert into public.payment_ingestion_batches(
    id, company_id, document_sha256, original_file_name, file_size_bytes,
    idempotency_key, created_by
  ) values (
    v_batch_id, p_company_id, v_sha, v_file_name, p_file_size_bytes,
    p_idempotency_key, v_actor
  );
  insert into public.payment_documents(
    id, batch_id, company_id, storage_path, sha256, file_size_bytes
  ) values (
    v_document_id, v_batch_id, p_company_id, v_storage_path, v_sha,
    p_file_size_bytes
  );
  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'document_id', v_document_id,
    'storage_bucket', 'payment-batch-documents',
    'storage_path', v_storage_path,
    'duplicate', false
  );
  return public.payment_reconciliation_store_command(
    p_company_id, 'payment_batch.create', p_idempotency_key, v_payload_hash, v_actor, v_result
  );
end
$$;

create function public.finalize_payment_ingestion_upload(
  p_batch_id uuid,
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
  v_batch public.payment_ingestion_batches%rowtype;
  v_document public.payment_documents%rowtype;
  v_actor uuid;
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_storage_metadata jsonb;
  v_result jsonb;
begin
  select * into v_batch from public.payment_ingestion_batches where id = p_batch_id for update;
  if not found then raise exception 'payment_batch_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_batch.company_id);
  v_payload := jsonb_build_object('batch_id', p_batch_id, 'page_count', p_page_count);
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_batch.company_id, 'payment_batch.finalize_upload', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if p_page_count is null or p_page_count not between 1 and 500 then
    raise exception 'invalid_page_count';
  end if;
  select * into v_document from public.payment_documents where batch_id = p_batch_id;
  select object.metadata into v_storage_metadata
  from storage.objects object
  where object.bucket_id = v_document.storage_bucket and object.name = v_document.storage_path;
  if not found then
    raise exception 'payment_batch_upload_not_found';
  end if;
  if coalesce(v_storage_metadata->>'mimetype', '') <> 'application/pdf'
     or coalesce((v_storage_metadata->>'size')::bigint, 0) <> v_document.file_size_bytes then
    raise exception 'payment_batch_upload_metadata_mismatch';
  end if;
  if v_batch.status not in ('awaiting_upload', 'extracting') then
    raise exception 'payment_batch_not_uploadable';
  end if;
  if v_batch.status = 'extracting' then
    if v_document.uploaded_at is null
       or v_document.uploaded_by is null
       or v_document.page_count is distinct from p_page_count then
      raise exception 'payment_batch_finalize_conflict';
    end if;
    v_result := jsonb_build_object(
      'batch_id', p_batch_id,
      'page_count', v_document.page_count,
      'status', 'extracting'
    );
    return public.payment_reconciliation_store_command(
      v_batch.company_id, 'payment_batch.finalize_upload',
      p_idempotency_key, v_hash, v_actor, v_result
    );
  end if;
  update public.payment_documents
  set page_count = p_page_count, uploaded_by = v_actor,
      uploaded_at = clock_timestamp()
  where id = v_document.id;
  update public.payment_ingestion_batches
  set status = 'extracting', page_count = p_page_count, error_code = null
  where id = p_batch_id;
  v_result := jsonb_build_object('batch_id', p_batch_id, 'status', 'extracting', 'page_count', p_page_count);
  return public.payment_reconciliation_store_command(
    v_batch.company_id, 'payment_batch.finalize_upload', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.submit_payment_document_extractions(
  p_batch_id uuid,
  p_parser_version text,
  p_pages jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.payment_ingestion_batches%rowtype;
  v_document public.payment_documents%rowtype;
  v_actor uuid;
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_page jsonb;
  v_page_number integer;
  v_amount numeric;
  v_amount_minor bigint;
  v_currency text;
  v_currency_input text;
  v_application_date date;
  v_source_account text;
  v_destination_account text;
  v_source_account_material text;
  v_destination_account_material text;
  v_source_account_hash text;
  v_source_account_last4 text;
  v_destination_account_hash text;
  v_destination_account_last4 text;
  v_bank_name text;
  v_bank_unique_folio text;
  v_bank_status text;
  v_status text;
  v_count integer := 0;
  v_result jsonb;
begin
  select * into v_batch from public.payment_ingestion_batches where id = p_batch_id for update;
  if not found then raise exception 'payment_batch_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_batch.company_id);
  v_payload := jsonb_build_object(
    'batch_id', p_batch_id,
    'pages', p_pages,
    'parser_version', nullif(btrim(p_parser_version), '')
  );
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_batch.company_id, 'payment_batch.submit_extractions', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if p_parser_version is null or char_length(btrim(p_parser_version)) not between 3 and 80 then
    raise exception 'invalid_parser_version';
  end if;
  if p_pages is null
     or jsonb_typeof(p_pages) is distinct from 'array'
     or coalesce(jsonb_array_length(p_pages), 0) not between 1 and 500 then
    raise exception 'invalid_extraction_pages';
  end if;
  if v_batch.page_count is null or jsonb_array_length(p_pages) <> v_batch.page_count then
    raise exception 'extraction_page_count_mismatch';
  end if;
  if v_batch.status <> 'extracting' then raise exception 'payment_batch_not_extracting'; end if;
  select * into v_document from public.payment_documents where batch_id = p_batch_id;

  for v_page in select value from jsonb_array_elements(p_pages)
  loop
    v_page_number := coalesce((v_page->>'page_number')::integer, (v_page->>'pagina')::integer);
    if v_page_number is null or v_page_number not between 1 and v_batch.page_count then
      raise exception 'invalid_extraction_page_number';
    end if;
    v_amount := coalesce((v_page->>'amount')::numeric, (v_page->>'importe')::numeric);
    v_currency_input := nullif(btrim(coalesce(v_page->>'currency', v_page->>'moneda')), '');
    v_currency := case when v_currency_input is null then null
      else public.payment_reconciliation_normalize_currency(v_currency_input) end;
    v_amount_minor := case when v_amount is null or v_amount <= 0 or v_currency is null then null
      else public.payment_amount_to_minor(v_amount, v_currency) end;
    v_application_date := case
      when coalesce(v_page->>'application_date', v_page->>'fecha_aplicacion') ~ '^\d{4}-\d{2}-\d{2}$'
        then coalesce(v_page->>'application_date', v_page->>'fecha_aplicacion')::date
      else null
    end;
    v_source_account := coalesce(v_page->>'source_account', v_page->>'cuenta_retiro');
    v_destination_account := coalesce(v_page->>'destination_account', v_page->>'cuenta_deposito');
    if char_length(coalesce(v_source_account, '')) > 100
       or char_length(coalesce(v_destination_account, '')) > 100 then
      raise exception 'invalid_extracted_account_length';
    end if;
    v_source_account_material := public.payment_reconciliation_account_material(v_source_account);
    v_destination_account_material := public.payment_reconciliation_account_material(v_destination_account);
    v_source_account_hash := null;
    v_destination_account_hash := null;
    if v_source_account_material ~ '^[0-9]{10,18}$' then
      v_source_account_hash := public.payment_reconciliation_account_hash(v_source_account);
    end if;
    if v_destination_account_material ~ '^[0-9]{10,18}$' then
      v_destination_account_hash := public.payment_reconciliation_account_hash(v_destination_account);
    end if;
    v_source_account_last4 := case
      when v_source_account_hash is not null then right(v_source_account_material, 4)
      else upper(nullif(btrim(coalesce(
        v_page->>'source_account_last4',
        public.payment_reconciliation_account_last4(v_source_account)
      )), ''))
    end;
    v_destination_account_last4 := case
      when v_destination_account_hash is not null then right(v_destination_account_material, 4)
      else upper(nullif(btrim(coalesce(
        v_page->>'destination_account_last4',
        public.payment_reconciliation_account_last4(v_destination_account)
      )), ''))
    end;
    if (v_source_account_last4 is not null and v_source_account_last4 !~ '^[A-Z0-9]{1,4}$')
       or (v_destination_account_last4 is not null and v_destination_account_last4 !~ '^[A-Z0-9]{1,4}$') then
      raise exception 'invalid_extracted_account_last4';
    end if;
    v_bank_unique_folio := upper(nullif(btrim(coalesce(
      v_page->>'bank_unique_folio',
      v_page->>'folio_unico'
    )), ''));
    v_bank_name := upper(coalesce(nullif(btrim(coalesce(
      v_page->>'bank_name',
      v_page->>'banco_origen'
    )), ''), 'UNKNOWN'));
    if char_length(v_bank_name) > 80 or v_bank_name ~ '[[:cntrl:]]' then
      raise exception 'invalid_extracted_bank_name';
    end if;
    v_bank_status := nullif(btrim(coalesce(v_page->>'bank_status', v_page->>'estado')), '');
    if (v_bank_status is not null and (
      char_length(v_bank_status) > 40 or v_bank_status ~ '[[:cntrl:]]'
    )) or (v_bank_unique_folio is not null and (
      char_length(v_bank_unique_folio) > 120 or v_bank_unique_folio ~ '[[:cntrl:]]'
    )) then
      raise exception 'invalid_extracted_bank_field';
    end if;
    if v_bank_unique_folio !~ '^[A-Z0-9-]{8,120}$' then
      v_bank_unique_folio := null;
    end if;
    v_status := case
      when v_bank_name = 'BBVA'
        and lower(coalesce(v_bank_status, '')) = 'operado'
        and v_amount_minor is not null and v_currency is not null and v_application_date is not null
        and v_bank_unique_folio is not null
        and v_source_account_hash is not null
        then 'review_required'
      else 'blocked'
    end;

    insert into public.payment_document_extractions(
      document_id, batch_id, company_id, page_number, status, parser_version,
      parser_confidence, bank_name, bank_status, bank_unique_folio,
      application_date, amount_minor, currency, source_account_hash,
      source_account_last4, destination_account_hash, destination_account_last4,
      beneficiary_name, payment_reason, extracted_evidence
    ) values (
      v_document.id, v_batch.id, v_batch.company_id, v_page_number, v_status,
      btrim(p_parser_version), nullif(v_page->>'confidence', '')::numeric,
      v_bank_name,
      v_bank_status, v_bank_unique_folio,
      v_application_date,
      v_amount_minor, v_currency,
      v_source_account_hash,
      v_source_account_last4,
      v_destination_account_hash,
      v_destination_account_last4,
      public.payment_reconciliation_redact_free_text(
        coalesce(v_page->>'beneficiary_name', v_page->>'beneficiario'), 180
      ),
      public.payment_reconciliation_redact_free_text(
        coalesce(v_page->>'payment_reason', v_page->>'motivo_pago'), 500
      ),
      jsonb_strip_nulls(jsonb_build_object(
        'amount_minor', v_amount_minor,
        'application_date', v_application_date,
        'bank_status', v_bank_status,
        'beneficiary_name', public.payment_reconciliation_redact_free_text(
          coalesce(v_page->>'beneficiary_name', v_page->>'beneficiario'), 180
        ),
        'currency', v_currency,
        'destination_account_last4', v_destination_account_last4,
        'page_number', v_page_number,
        'payment_reason', public.payment_reconciliation_redact_free_text(
          coalesce(v_page->>'payment_reason', v_page->>'motivo_pago'), 500
        ),
        'source_account_last4', v_source_account_last4
      ))
    );
    v_count := v_count + 1;
  end loop;

  update public.payment_ingestion_batches
  set status = 'review_required', extraction_count = v_count, error_code = null
  where id = p_batch_id;
  v_result := jsonb_build_object('batch_id', p_batch_id, 'status', 'review_required', 'extraction_count', v_count);
  return public.payment_reconciliation_store_command(
    v_batch.company_id, 'payment_batch.submit_extractions', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.list_payment_ingestion_batches(
  p_company_id uuid default null,
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := public.current_profile_id();
  v_is_sysadmin boolean;
begin
  if v_actor is null or not public.current_user_has_role(public.flux_finance_roles()) then
    raise exception 'finance_role_required';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then raise exception 'invalid_limit'; end if;
  if p_status is not null and p_status not in ('awaiting_upload', 'extracting', 'review_required', 'ready', 'failed', 'cancelled') then
    raise exception 'invalid_batch_status';
  end if;
  v_is_sysadmin := public.current_user_has_role(public.flux_sysadmin_roles());
  if p_company_id is not null then perform public.payment_reconciliation_require_finance(p_company_id); end if;
  return coalesce((
    select jsonb_agg(to_jsonb(row_data) order by row_data.created_at desc)
    from (
      select batch.id, batch.company_id, company.name as company_name, batch.status,
        batch.original_file_name, batch.page_count, batch.extraction_count,
        batch.operation_count, batch.created_at, batch.updated_at
      from public.payment_ingestion_batches batch
      join public.companies company on company.id = batch.company_id
      where (p_company_id is null or batch.company_id = p_company_id)
        and (p_status is null or batch.status = p_status)
        and (v_is_sysadmin or public.has_active_company_membership(v_actor, batch.company_id))
      order by batch.created_at desc
      limit p_limit
    ) row_data
  ), '[]'::jsonb);
end
$$;

create function public.get_payment_ingestion_batch_detail(p_batch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_batch public.payment_ingestion_batches%rowtype;
begin
  select * into v_batch from public.payment_ingestion_batches where id = p_batch_id;
  if not found then raise exception 'payment_batch_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_batch.company_id);
  return jsonb_build_object(
    'batch', (select to_jsonb(data) from (
      select batch.id, batch.company_id, company.name as company_name, batch.status,
        batch.original_file_name, batch.page_count, batch.extraction_count,
        batch.operation_count, batch.error_code, batch.created_at, batch.updated_at
      from public.payment_ingestion_batches batch
      join public.companies company on company.id = batch.company_id
      where batch.id = p_batch_id
    ) data),
    'document', (select to_jsonb(data) from (
      select document.id, document.storage_bucket, document.storage_path,
        document.mime_type, document.file_size_bytes, document.page_count,
        document.uploaded_by, document.uploaded_at
      from public.payment_documents document where document.batch_id = p_batch_id
    ) data),
    'extractions', coalesce((
      select jsonb_agg(to_jsonb(data) order by data.page_number)
      from (
        select extraction.id, extraction.page_number, extraction.status,
          extraction.parser_version, extraction.parser_confidence, extraction.bank_name,
          extraction.bank_status, extraction.bank_unique_folio, extraction.application_date,
          extraction.amount_minor, extraction.currency, extraction.source_account_last4,
          extraction.destination_account_last4, extraction.beneficiary_name,
          extraction.payment_reason, extraction.rejection_reason, extraction.updated_at
        from public.payment_document_extractions extraction
        where extraction.batch_id = p_batch_id
      ) data
    ), '[]'::jsonb),
    'operations', coalesce((
      select jsonb_agg(to_jsonb(data) order by data.page_number)
      from (
        select coalesce(operation.id, extraction.id) as id,
          operation.id as bank_operation_id, extraction.id as extraction_id,
          extraction.page_number, extraction.status as extraction_status,
          coalesce(operation.status, extraction.status) as status,
          extraction.bank_name, extraction.bank_status, extraction.bank_unique_folio,
          extraction.application_date, extraction.amount_minor, extraction.currency,
          extraction.source_account_last4, extraction.destination_account_last4,
          extraction.beneficiary_name, extraction.payment_reason, extraction.rejection_reason,
          array_remove(array[
            case when upper(btrim(extraction.bank_name)) <> 'BBVA'
              then 'bank_not_identified' end,
            case when lower(coalesce(extraction.bank_status, '')) <> 'operado'
              then 'bank_status_not_operated' end,
            case when extraction.application_date is null
              then 'operation_date_missing' end,
            case when extraction.amount_minor is null
              then 'amount_missing_or_invalid' end,
            case when extraction.currency is null
              then 'currency_missing_or_invalid' end,
            case when nullif(btrim(extraction.bank_unique_folio), '') is null
              then 'bank_unique_folio_missing' end,
            case when extraction.source_account_hash is null
              then 'strong_bank_identity_missing' end,
            case when nullif(btrim(extraction.beneficiary_name), '') is null
              then 'beneficiary_missing' end
          ]::text[], null) as review_issues,
          extraction.updated_at as extraction_updated_at,
          coalesce(operation.created_at, extraction.created_at) as created_at,
          case when operation.id is null then extraction.amount_minor
            else operation.amount_minor - public.payment_operation_confirmed_minor(operation.id) end as financial_remainder_minor,
          case when operation.id is null then extraction.amount_minor
            else operation.amount_minor - public.payment_operation_confirmed_minor(operation.id)
              - public.payment_operation_reserved_minor(operation.id) end as available_minor,
          'unreconciled'::text as reconciliation_status,
          jsonb_build_array(
            'Página ' || extraction.page_number::text,
            'Cuenta destino ••••' || coalesce(extraction.destination_account_last4, '—'),
            'Estado bancario ' || coalesce(extraction.bank_status, 'no identificado')
          ) as evidence_excerpt,
          (
            select to_jsonb(plan_data)
            from (
              select plan.id, plan.status, plan.total_amount_minor, plan.currency,
                plan.cancel_reason,
                coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'amount_minor', item.amount_minor,
                    'currency', item.currency,
                    'id', item.id,
                    'note', item.note,
                    'payment_request_id', snapshot.payment_request_id,
                    'position', item.position,
                    'proveedor_name', coalesce(
                      proveedor.alias, proveedor.nombre_completo, 'Proveedor'
                    ),
                    'request_number', request.request_number,
                    'snapshot_id', item.snapshot_id
                  ) order by item.position)
                  from public.payment_allocation_items item
                  join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
                  join public.payment_requests request on request.id = snapshot.payment_request_id
                  left join public.proveedores proveedor on proveedor.id = request.proveedor_id
                  where item.plan_id = plan.id
                ), '[]'::jsonb) as items,
                reservation.id as reservation_id,
                case
                  when reservation.status = 'active' and reservation.expires_at <= now()
                    then 'expired'
                  else reservation.status
                end as reservation_status,
                coalesce(
                  reservation.status = 'active' and reservation.expires_at <= now(),
                  false
                ) as reservation_expired,
                reservation.expires_at, reservation.close_reason, reservation.closed_at
              from public.payment_allocation_plans plan
              left join lateral (
                select candidate.*
                from public.payment_allocation_reservations candidate
                where candidate.plan_id = plan.id
                order by candidate.created_at desc, candidate.id desc
                limit 1
              ) reservation on true
              where plan.operation_id = operation.id
              order by plan.created_at desc
              limit 1
            ) plan_data
          ) as plan
        from public.payment_document_extractions extraction
        left join public.bank_payment_operations operation on operation.extraction_id = extraction.id
        where extraction.batch_id = p_batch_id
      ) data
    ), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(to_jsonb(data) order by data.created_at desc)
      from (
        select plan.id, plan.operation_id, plan.status, plan.total_amount_minor,
          plan.currency, plan.proposed_by, plan.proposed_at, plan.cancel_reason,
          plan.created_at,
          coalesce((
            select jsonb_agg(jsonb_build_object(
              'amount_minor', item.amount_minor,
              'currency', item.currency,
              'id', item.id,
              'note', item.note,
              'payment_request_id', snapshot.payment_request_id,
              'position', item.position,
              'proveedor_name', coalesce(
                proveedor.alias, proveedor.nombre_completo, 'Proveedor'
              ),
              'request_number', request.request_number,
              'snapshot_id', item.snapshot_id
            ) order by item.position)
            from public.payment_allocation_items item
            join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
            join public.payment_requests request on request.id = snapshot.payment_request_id
            left join public.proveedores proveedor on proveedor.id = request.proveedor_id
            where item.plan_id = plan.id
          ), '[]'::jsonb) as items,
          reservation.id as reservation_id,
          case
            when reservation.status = 'active' and reservation.expires_at <= now()
              then 'expired'
            else reservation.status
          end as reservation_status,
          coalesce(
            reservation.status = 'active' and reservation.expires_at <= now(),
            false
          ) as reservation_expired,
          reservation.expires_at, reservation.close_reason, reservation.closed_at
        from public.payment_allocation_plans plan
        left join lateral (
          select candidate.*
          from public.payment_allocation_reservations candidate
          where candidate.plan_id = plan.id
          order by candidate.created_at desc, candidate.id desc
          limit 1
        ) reservation on true
        where exists (
          select 1 from public.bank_payment_operations operation
          join public.payment_document_extractions extraction on extraction.id = operation.extraction_id
          where operation.id = plan.operation_id and extraction.batch_id = p_batch_id
        )
      ) data
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(to_jsonb(data) order by data.created_at desc)
      from (
        select event.id, event.event_type, event.aggregate_type, event.aggregate_id,
          event.actor_profile_id, profile.full_name as actor_name,
          event.occurred_at as created_at
        from public.financial_outbox_events event
        left join public.profiles profile on profile.id = event.actor_profile_id
        where event.company_id = v_batch.company_id
          and (
            event.correlation_id = p_batch_id
            or event.correlation_id in (
              select operation.id
              from public.bank_payment_operations operation
              join public.payment_document_extractions extraction on extraction.id = operation.extraction_id
              where extraction.batch_id = p_batch_id
            )
            or event.aggregate_id in (
              select operation.id
              from public.bank_payment_operations operation
              join public.payment_document_extractions extraction on extraction.id = operation.extraction_id
              where extraction.batch_id = p_batch_id
            )
          )
        order by event.occurred_at desc
      ) data
    ), '[]'::jsonb)
  );
end
$$;

create function public.accept_payment_document_extraction(
  p_extraction_id uuid,
  p_expected_updated_at timestamptz,
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
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_fingerprint text;
  v_company_bank_account_id uuid;
  v_company_bank_account_ids uuid[];
  v_operation_id uuid;
  v_event_id uuid;
  v_result jsonb;
  v_reviewed_at timestamptz;
begin
  select * into v_extraction
  from public.payment_document_extractions where id = p_extraction_id for update;
  if not found then raise exception 'payment_extraction_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_extraction.company_id);
  v_payload := jsonb_build_object(
    'expected_updated_at', p_expected_updated_at,
    'extraction_id', p_extraction_id,
    'operation', 'accept'
  );
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_extraction.company_id, 'payment_extraction.accept', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if v_extraction.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_payment_extraction';
  end if;
  if v_extraction.status <> 'review_required' then
    raise exception 'payment_extraction_not_reviewable';
  end if;
  if upper(btrim(v_extraction.bank_name)) <> 'BBVA'
     or lower(coalesce(v_extraction.bank_status, '')) <> 'operado'
     or v_extraction.application_date is null
     or v_extraction.amount_minor is null
     or v_extraction.currency is null
     or v_extraction.bank_unique_folio !~ '^[A-Z0-9-]{8,120}$'
     or v_extraction.source_account_hash is null then
    raise exception 'payment_extraction_not_conciliable';
  end if;
  perform 1
  from public.payment_ingestion_batches batch
  where batch.id = v_extraction.batch_id
    and batch.company_id = v_extraction.company_id
  for update;
  if not found then raise exception 'payment_batch_scope_mismatch'; end if;
  select coalesce(array_agg(matched.id order by matched.id), '{}'::uuid[])
    into v_company_bank_account_ids
  from (
    select account.id
    from public.company_bank_accounts account
    where account.company_id = v_extraction.company_id
      and coalesce(account.active, true)
      and public.payment_reconciliation_normalize_bank_name(account.bank_name) = 'BBVA'
      and case upper(btrim(account.currency)) when 'MXP' then 'MXN'
            else upper(btrim(account.currency)) end = v_extraction.currency
      and v_extraction.source_account_hash in (
        public.payment_reconciliation_account_hash(account.account_number),
        public.payment_reconciliation_account_hash(account.clabe)
      )
    order by account.id
    for share
  ) matched;
  if cardinality(v_company_bank_account_ids) = 0 then
    raise exception 'bank_payment_operation_company_account_mismatch';
  end if;
  if cardinality(v_company_bank_account_ids) <> 1 then
    raise exception 'bank_payment_operation_company_account_ambiguous';
  end if;
  v_company_bank_account_id := v_company_bank_account_ids[1];
  perform pg_advisory_xact_lock(hashtextextended(
    'bbva_folio:' || v_extraction.company_id::text || ':' || v_extraction.bank_unique_folio,
    32032
  ));
  v_fingerprint := public.payment_operation_fingerprint_v1(
    v_extraction.company_id, v_extraction.bank_name, v_extraction.bank_unique_folio,
    v_extraction.application_date, v_extraction.amount_minor, v_extraction.currency,
    v_extraction.source_account_hash, v_extraction.destination_account_hash
  );
  if exists (
    select 1 from public.bank_payment_operations operation
    where operation.company_id = v_extraction.company_id
      and operation.bank_unique_folio = v_extraction.bank_unique_folio
  ) then
    raise exception 'bank_payment_operation_folio_duplicate';
  end if;
  if exists (
    select 1 from public.bank_payment_operations operation
    where operation.operation_fingerprint = v_fingerprint
  ) then
    raise exception 'bank_payment_operation_duplicate';
  end if;
  v_reviewed_at := clock_timestamp();

  insert into public.bank_payment_operations(
    company_id, source_company_bank_account_id, extraction_id, bank_name,
    operation_fingerprint,
    bank_unique_folio, application_date, amount_minor, currency,
    source_account_hash, source_account_last4, destination_account_hash,
    destination_account_last4, beneficiary_name, payment_reason, reviewed_by,
    reviewed_at
  ) values (
    v_extraction.company_id, v_company_bank_account_id, v_extraction.id,
    v_extraction.bank_name, v_fingerprint,
    v_extraction.bank_unique_folio, v_extraction.application_date,
    v_extraction.amount_minor, v_extraction.currency, v_extraction.source_account_hash,
    v_extraction.source_account_last4, v_extraction.destination_account_hash,
    v_extraction.destination_account_last4, v_extraction.beneficiary_name,
    v_extraction.payment_reason, v_actor, v_reviewed_at
  ) returning id into v_operation_id;
  insert into public.payment_operation_documents(operation_id, document_id, page_number)
  values (v_operation_id, v_extraction.document_id, v_extraction.page_number);
  update public.payment_document_extractions
  set status = 'accepted', reviewed_by = v_actor, reviewed_at = v_reviewed_at,
      rejection_reason = null
  where id = v_extraction.id;
  update public.payment_ingestion_batches batch
  set operation_count = (
        select count(*) from public.bank_payment_operations operation
        join public.payment_document_extractions extraction on extraction.id = operation.extraction_id
        where extraction.batch_id = batch.id
      ),
      status = case when not exists (
        select 1 from public.payment_document_extractions pending
        where pending.batch_id = batch.id and pending.status in ('review_required', 'blocked')
      ) then 'ready' else 'review_required' end
  where batch.id = v_extraction.batch_id;
  v_event_id := public.append_financial_outbox_event_internal(
    'payment_operation.ingested', 'bank_payment_operation', v_operation_id,
    v_extraction.company_id, v_actor,
    jsonb_build_object(
      'amount_minor', v_extraction.amount_minor,
      'application_date', v_extraction.application_date,
      'currency', v_extraction.currency,
      'destination_account_last4', v_extraction.destination_account_last4,
      'operation_id', v_operation_id
    ), v_extraction.batch_id, null
  );
  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'extraction_id', v_extraction.id,
    'operation_id', v_operation_id,
    'status', 'accepted'
  );
  return public.payment_reconciliation_store_command(
    v_extraction.company_id, 'payment_extraction.accept', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.reject_payment_document_extraction(
  p_extraction_id uuid,
  p_expected_updated_at timestamptz,
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
  v_reason text := public.payment_reconciliation_redact_free_text(p_reason, 500);
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_extraction
  from public.payment_document_extractions where id = p_extraction_id for update;
  if not found then raise exception 'payment_extraction_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_extraction.company_id);
  v_payload := jsonb_build_object(
    'expected_updated_at', p_expected_updated_at,
    'extraction_id', p_extraction_id,
    'operation', 'reject',
    'reason', v_reason
  );
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_extraction.company_id, 'payment_extraction.reject', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason) < 10 then raise exception 'rejection_reason_too_short'; end if;
  if v_extraction.updated_at is distinct from p_expected_updated_at then raise exception 'stale_payment_extraction'; end if;
  if v_extraction.status not in ('review_required', 'blocked') then raise exception 'payment_extraction_not_reviewable'; end if;
  perform 1
  from public.payment_ingestion_batches batch
  where batch.id = v_extraction.batch_id
    and batch.company_id = v_extraction.company_id
  for update;
  if not found then raise exception 'payment_batch_scope_mismatch'; end if;
  update public.payment_document_extractions
  set status = 'rejected', reviewed_by = v_actor,
      reviewed_at = clock_timestamp(), rejection_reason = v_reason
  where id = v_extraction.id;
  update public.payment_ingestion_batches batch
  set status = case when not exists (
    select 1 from public.payment_document_extractions pending
    where pending.batch_id = batch.id and pending.status in ('review_required', 'blocked')
  ) then 'ready' else 'review_required' end
  where batch.id = v_extraction.batch_id;
  v_result := jsonb_build_object('extraction_id', v_extraction.id, 'status', 'rejected');
  return public.payment_reconciliation_store_command(
    v_extraction.company_id, 'payment_extraction.reject', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.find_payment_allocation_candidates(
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
begin
  select * into v_operation from public.bank_payment_operations where id = p_operation_id;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_operation.company_id);
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_limit'; end if;
  return coalesce((
    with latest_snapshots as (
      select distinct on (snapshot.payment_request_id) snapshot.*
      from public.payable_snapshots snapshot
      where snapshot.company_id = v_operation.company_id
      order by snapshot.payment_request_id, snapshot.version desc
    ), candidates as (
      select snapshot.id as snapshot_id, request.id as payment_request_id,
        request.request_number, request.concept, request.proveedor_id,
        coalesce(proveedor.alias, proveedor.nombre_completo, 'Proveedor') as proveedor_name,
        snapshot.amount_minor, snapshot.currency,
        snapshot.amount_minor - public.payable_snapshot_confirmed_minor(snapshot.id) as confirmed_balance_minor,
        snapshot.amount_minor - public.payable_snapshot_confirmed_minor(snapshot.id)
          - public.payable_snapshot_reserved_minor(snapshot.id) as available_minor,
        (
          case when snapshot.amount_minor - public.payable_snapshot_confirmed_minor(snapshot.id) = v_operation.amount_minor then 50 else 0 end
          + case when v_operation.destination_account_hash is not null and (
              v_operation.destination_account_hash = public.payment_reconciliation_account_hash(proveedor.clabe)
              or v_operation.destination_account_hash = public.payment_reconciliation_account_hash(proveedor.cuenta_bancaria)
            ) then 35 else 0 end
          + case when v_operation.beneficiary_name is not null and (
              lower(v_operation.beneficiary_name) like '%' || lower(coalesce(nullif(proveedor.alias, ''), '---')) || '%'
              or lower(v_operation.beneficiary_name) like '%' || lower(coalesce(nullif(proveedor.nombre_completo, ''), '---')) || '%'
            ) then 15 else 0 end
        )::integer as match_score
      from latest_snapshots snapshot
      join public.payment_requests request on request.id = snapshot.payment_request_id
      left join public.proveedores proveedor on proveedor.id = request.proveedor_id
      where snapshot.currency = v_operation.currency
        and public.payment_reconciliation_snapshot_is_payable(snapshot.id)
        and snapshot.amount_minor - public.payable_snapshot_confirmed_minor(snapshot.id)
          - public.payable_snapshot_reserved_minor(snapshot.id) > 0
    )
    select jsonb_agg(to_jsonb(candidate) order by candidate.match_score desc, candidate.request_number nulls last, candidate.payment_request_id)
    from (select * from candidates order by match_score desc, payment_request_id limit p_limit) candidate
  ), '[]'::jsonb);
end
$$;

create function public.propose_payment_allocations(
  p_operation_id uuid,
  p_allocations jsonb,
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
  v_hash text;
  v_replay jsonb;
  v_allocation jsonb;
  v_snapshot public.payable_snapshots%rowtype;
  v_snapshot_id uuid;
  v_amount_minor bigint;
  v_total bigint := 0;
  v_position integer := 0;
  v_plan_id uuid;
  v_event_id uuid;
  v_result jsonb;
begin
  select * into v_operation from public.bank_payment_operations where id = p_operation_id for update;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_operation.company_id);
  v_payload := jsonb_build_object('allocations', p_allocations, 'operation_id', p_operation_id);
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_operation.company_id, 'payment_allocation.propose', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if v_operation.status <> 'available' then raise exception 'bank_payment_operation_not_available'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) not between 1 and 100 then
    raise exception 'invalid_allocations';
  end if;
  if exists (
    select 1 from public.payment_allocation_plans plan
    where plan.operation_id = p_operation_id and plan.status in ('draft', 'reserved')
  ) then raise exception 'open_allocation_plan_exists'; end if;

  -- Serialize against snapshot materialization, then lock snapshots deterministically.
  perform 1
  from public.payment_requests request
  where request.id in (
    select distinct snapshot.payment_request_id
    from jsonb_array_elements(p_allocations) allocation
    join public.payable_snapshots snapshot
      on snapshot.id = (allocation.value->>'snapshot_id')::uuid
  )
  order by request.id
  for update;
  perform 1
  from public.payable_snapshots snapshot
  where snapshot.id in (
    select distinct (value->>'snapshot_id')::uuid from jsonb_array_elements(p_allocations)
  )
  order by snapshot.id
  for update;

  insert into public.payment_allocation_plans(
    company_id, operation_id, total_amount_minor, currency, proposed_by
  ) values (
    v_operation.company_id, v_operation.id, 1, v_operation.currency, v_actor
  ) returning id into v_plan_id;

  for v_allocation in select value from jsonb_array_elements(p_allocations)
  loop
    v_position := v_position + 1;
    v_snapshot_id := (v_allocation->>'snapshot_id')::uuid;
    v_amount_minor := (v_allocation->>'amount_minor')::bigint;
    if v_amount_minor is null or v_amount_minor <= 0 then raise exception 'allocation_amount_must_be_positive'; end if;
    select * into v_snapshot from public.payable_snapshots where id = v_snapshot_id;
    if not found or v_snapshot.company_id <> v_operation.company_id then raise exception 'payable_snapshot_not_found'; end if;
    if v_snapshot.currency <> v_operation.currency then raise exception 'allocation_currency_mismatch'; end if;
    if exists (
      select 1 from public.payable_snapshots newer
      where newer.payment_request_id = v_snapshot.payment_request_id and newer.version > v_snapshot.version
    ) then raise exception 'payable_snapshot_not_latest'; end if;
    if not public.payment_reconciliation_snapshot_is_payable(v_snapshot.id) then
      raise exception 'payable_snapshot_not_currently_payable';
    end if;
    if v_amount_minor > v_snapshot.amount_minor
      - public.payable_snapshot_confirmed_minor(v_snapshot.id)
      - public.payable_snapshot_reserved_minor(v_snapshot.id) then
      raise exception 'payable_snapshot_capacity_exceeded';
    end if;
    insert into public.payment_allocation_items(
      plan_id, operation_id, snapshot_id, amount_minor, currency, position, note
    ) values (
      v_plan_id, v_operation.id, v_snapshot.id, v_amount_minor, v_operation.currency,
      v_position, public.payment_reconciliation_redact_free_text(
        v_allocation->>'note', 300
      )
    );
    if v_total > 9007199254740991 - v_amount_minor then
      raise exception 'allocation_total_out_of_range';
    end if;
    v_total := v_total + v_amount_minor;
  end loop;
  if v_total > v_operation.amount_minor
      - public.payment_operation_confirmed_minor(v_operation.id)
      - public.payment_operation_reserved_minor(v_operation.id) then
    raise exception 'bank_payment_operation_capacity_exceeded';
  end if;
  update public.payment_allocation_plans set total_amount_minor = v_total where id = v_plan_id;
  v_event_id := public.append_financial_outbox_event_internal(
    'payment_allocation.proposed', 'payment_allocation_plan', v_plan_id,
    v_operation.company_id, v_actor,
    jsonb_build_object(
      'allocation_count', v_position,
      'currency', v_operation.currency,
      'operation_id', v_operation.id,
      'plan_id', v_plan_id,
      'total_amount_minor', v_total
    ), v_operation.id, null
  );
  v_result := jsonb_build_object(
    'allocation_count', v_position, 'event_id', v_event_id,
    'plan_id', v_plan_id, 'status', 'draft', 'total_amount_minor', v_total
  );
  return public.payment_reconciliation_store_command(
    v_operation.company_id, 'payment_allocation.propose', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.reserve_payment_allocations(
  p_plan_id uuid,
  p_expires_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.payment_allocation_plans%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_actor uuid;
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_item record;
  v_reservation_id uuid;
  v_event_id uuid;
  v_result jsonb;
  v_reserved_at timestamptz;
begin
  select * into v_plan from public.payment_allocation_plans where id = p_plan_id for update;
  if not found then raise exception 'payment_allocation_plan_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_plan.company_id);
  v_payload := jsonb_build_object('expires_at', p_expires_at, 'plan_id', p_plan_id);
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_plan.company_id, 'payment_allocation.reserve', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if v_plan.status <> 'draft' then raise exception 'payment_allocation_plan_not_draft'; end if;
  if p_expires_at is null then raise exception 'invalid_reservation_expiry'; end if;
  select * into v_operation from public.bank_payment_operations where id = v_plan.operation_id for update;
  if v_operation.status <> 'available' then raise exception 'bank_payment_operation_not_available'; end if;

  -- Snapshot creation locks the same requests, closing the reapproval/reservation race.
  perform 1
  from public.payment_requests request
  where request.id in (
    select snapshot.payment_request_id
    from public.payment_allocation_items item
    join public.payable_snapshots snapshot on snapshot.id = item.snapshot_id
    where item.plan_id = p_plan_id
  )
  order by request.id
  for update;

  perform 1 from public.payable_snapshots snapshot
  where snapshot.id in (
    select item.snapshot_id from public.payment_allocation_items item where item.plan_id = p_plan_id
  ) order by snapshot.id for update;

  if v_plan.total_amount_minor > v_operation.amount_minor
      - public.payment_operation_confirmed_minor(v_operation.id)
      - public.payment_operation_reserved_minor(v_operation.id) then
    raise exception 'bank_payment_operation_capacity_exceeded';
  end if;
  for v_item in
    select item.snapshot_id, item.amount_minor
    from public.payment_allocation_items item
    where item.plan_id = p_plan_id
    order by item.snapshot_id
  loop
    if exists (
      select 1
      from public.payable_snapshots newer
      join public.payable_snapshots current_snapshot
        on current_snapshot.id = v_item.snapshot_id
      where newer.payment_request_id = current_snapshot.payment_request_id
        and newer.version > current_snapshot.version
    ) then
      raise exception 'payable_snapshot_not_latest';
    end if;
    if not public.payment_reconciliation_snapshot_is_payable(v_item.snapshot_id) then
      raise exception 'payable_snapshot_not_currently_payable';
    end if;
    if v_item.amount_minor > (
      select snapshot.amount_minor
        - public.payable_snapshot_confirmed_minor(snapshot.id)
        - public.payable_snapshot_reserved_minor(snapshot.id)
      from public.payable_snapshots snapshot where snapshot.id = v_item.snapshot_id
    ) then raise exception 'payable_snapshot_capacity_exceeded'; end if;
  end loop;

  -- Evaluate the lease against a fresh database clock after every contended
  -- lock. A transaction-start timestamp could create an already-expired lease.
  v_reserved_at := clock_timestamp();
  if p_expires_at <= v_reserved_at
     or p_expires_at > v_reserved_at + interval '24 hours' then
    raise exception 'invalid_reservation_expiry';
  end if;

  insert into public.payment_allocation_reservations(
    company_id, plan_id, operation_id, amount_minor, currency,
    expires_at, created_by, created_at
  ) values (
    v_plan.company_id, v_plan.id, v_plan.operation_id, v_plan.total_amount_minor,
    v_plan.currency, p_expires_at, v_actor, v_reserved_at
  ) returning id into v_reservation_id;
  update public.payment_allocation_plans set status = 'reserved' where id = v_plan.id;
  update public.bank_payment_operations set status = 'reserved' where id = v_operation.id;
  v_event_id := public.append_financial_outbox_event_internal(
    'payment_allocation.reserved', 'payment_allocation_reservation', v_reservation_id,
    v_plan.company_id, v_actor,
    jsonb_build_object(
      'amount_minor', v_plan.total_amount_minor, 'currency', v_plan.currency,
      'expires_at', p_expires_at, 'operation_id', v_plan.operation_id,
      'plan_id', v_plan.id, 'reservation_id', v_reservation_id
    ), v_plan.operation_id, null
  );
  v_result := jsonb_build_object(
    'event_id', v_event_id, 'expires_at', p_expires_at,
    'plan_id', v_plan.id, 'reservation_id', v_reservation_id, 'status', 'active'
  );
  return public.payment_reconciliation_store_command(
    v_plan.company_id, 'payment_allocation.reserve', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.expire_payment_reservation(
  p_reservation_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_initial public.payment_allocation_reservations%rowtype;
  v_reservation public.payment_allocation_reservations%rowtype;
  v_plan public.payment_allocation_plans%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_actor uuid;
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_event_id uuid;
  v_result jsonb;
  v_decided_at timestamptz;
begin
  select * into v_initial
  from public.payment_allocation_reservations
  where id = p_reservation_id;
  if not found then raise exception 'payment_reservation_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_initial.company_id);
  v_payload := jsonb_build_object(
    'operation', 'expire',
    'reservation_id', p_reservation_id
  );
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_initial.company_id, 'payment_allocation.expire',
    p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;

  -- All reservation terminal transitions use plan -> operation -> reservation.
  select * into v_plan
  from public.payment_allocation_plans
  where id = v_initial.plan_id
  for update;
  if not found then raise exception 'payment_allocation_plan_not_found'; end if;
  select * into v_operation
  from public.bank_payment_operations
  where id = v_initial.operation_id
  for update;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  select * into v_reservation
  from public.payment_allocation_reservations
  where id = p_reservation_id
  for update;
  if v_reservation.plan_id <> v_plan.id
     or v_reservation.operation_id <> v_operation.id
     or v_reservation.company_id <> v_plan.company_id then
    raise exception 'payment_reservation_scope_mismatch';
  end if;
  if v_reservation.status <> 'active' then
    raise exception 'payment_reservation_not_active';
  end if;
  v_decided_at := clock_timestamp();
  if v_reservation.expires_at > v_decided_at then
    raise exception 'payment_reservation_not_expired';
  end if;

  update public.payment_allocation_reservations
  set status = 'expired', closed_by = v_actor, closed_at = v_decided_at,
      close_reason = 'Expiration materialized against authoritative database clock'
  where id = v_reservation.id;
  update public.payment_allocation_plans
  set status = 'draft'
  where id = v_plan.id and status = 'reserved';
  update public.bank_payment_operations
  set status = 'available'
  where id = v_operation.id and status = 'reserved';
  v_event_id := public.append_financial_outbox_event_internal(
    'payment_allocation.expired',
    'payment_allocation_reservation',
    v_reservation.id,
    v_reservation.company_id,
    v_actor,
    jsonb_build_object(
      'expired_at', v_reservation.expires_at,
      'operation_id', v_reservation.operation_id,
      'plan_id', v_reservation.plan_id,
      'reservation_id', v_reservation.id
    ),
    v_reservation.operation_id,
    null,
    'payment_allocation.expired:' || v_reservation.id::text
  );
  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'plan_id', v_reservation.plan_id,
    'reservation_id', v_reservation.id,
    'status', 'expired'
  );
  return public.payment_reconciliation_store_command(
    v_reservation.company_id, 'payment_allocation.expire',
    p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.release_payment_reservation(
  p_reservation_id uuid,
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
  v_initial public.payment_allocation_reservations%rowtype;
  v_reservation public.payment_allocation_reservations%rowtype;
  v_plan public.payment_allocation_plans%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_actor uuid;
  v_reason text := public.payment_reconciliation_redact_free_text(p_reason, 500);
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_event_id uuid;
  v_result jsonb;
  v_decided_at timestamptz;
begin
  select * into v_initial
  from public.payment_allocation_reservations where id = p_reservation_id;
  if not found then raise exception 'payment_reservation_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_initial.company_id);
  v_payload := jsonb_build_object('reason', v_reason, 'reservation_id', p_reservation_id);
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_initial.company_id, 'payment_allocation.release', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason) < 10 then raise exception 'release_reason_too_short'; end if;

  -- Match expiration/cancellation ordering: plan -> operation -> reservation.
  select * into v_plan
  from public.payment_allocation_plans
  where id = v_initial.plan_id
  for update;
  if not found then raise exception 'payment_allocation_plan_not_found'; end if;
  select * into v_operation
  from public.bank_payment_operations
  where id = v_initial.operation_id
  for update;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  select * into v_reservation
  from public.payment_allocation_reservations
  where id = p_reservation_id
  for update;
  if v_reservation.plan_id <> v_plan.id
     or v_reservation.operation_id <> v_operation.id
     or v_reservation.company_id <> v_plan.company_id then
    raise exception 'payment_reservation_scope_mismatch';
  end if;
  if v_reservation.status <> 'active' then raise exception 'payment_reservation_not_active'; end if;
  v_decided_at := clock_timestamp();
  if v_reservation.expires_at <= v_decided_at then
    raise exception 'payment_reservation_expired_use_expire';
  end if;
  update public.payment_allocation_reservations
  set status = 'released', closed_by = v_actor, closed_at = v_decided_at, close_reason = v_reason
  where id = v_reservation.id;
  update public.payment_allocation_plans set status = 'draft'
  where id = v_reservation.plan_id and status = 'reserved';
  update public.bank_payment_operations set status = 'available'
  where id = v_reservation.operation_id and status = 'reserved';
  v_event_id := public.append_financial_outbox_event_internal(
    'payment_allocation.released', 'payment_allocation_reservation', v_reservation.id,
    v_reservation.company_id, v_actor,
    jsonb_build_object('operation_id', v_reservation.operation_id, 'plan_id', v_reservation.plan_id, 'reservation_id', v_reservation.id),
    v_reservation.operation_id, null
  );
  v_result := jsonb_build_object('event_id', v_event_id, 'reservation_id', v_reservation.id, 'status', 'released');
  return public.payment_reconciliation_store_command(
    v_reservation.company_id, 'payment_allocation.release', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.cancel_payment_allocation_plan(
  p_plan_id uuid,
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
  v_plan public.payment_allocation_plans%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_reservation public.payment_allocation_reservations%rowtype;
  v_actor uuid;
  v_reason text := public.payment_reconciliation_redact_free_text(p_reason, 500);
  v_payload jsonb;
  v_hash text;
  v_replay jsonb;
  v_reservation_id uuid;
  v_event_id uuid;
  v_result jsonb;
  v_decided_at timestamptz;
begin
  select * into v_plan from public.payment_allocation_plans where id = p_plan_id for update;
  if not found then raise exception 'payment_allocation_plan_not_found'; end if;
  v_actor := public.payment_reconciliation_require_finance(v_plan.company_id);
  v_payload := jsonb_build_object('plan_id', p_plan_id, 'reason', v_reason);
  v_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_plan.company_id, 'payment_allocation.cancel', p_idempotency_key, v_hash, v_actor
  );
  if v_replay is not null then return v_replay; end if;
  if v_reason is null or char_length(v_reason) < 10 then raise exception 'cancel_reason_too_short'; end if;
  if v_plan.status not in ('draft', 'reserved') then raise exception 'payment_allocation_plan_not_cancellable'; end if;
  select * into v_operation
  from public.bank_payment_operations
  where id = v_plan.operation_id
  for update;
  if not found then raise exception 'bank_payment_operation_not_found'; end if;
  select * into v_reservation
  from public.payment_allocation_reservations
  where plan_id = v_plan.id and status = 'active'
  for update;
  v_decided_at := clock_timestamp();
  if found and v_reservation.expires_at <= v_decided_at then
    raise exception 'payment_reservation_expired_use_expire';
  end if;
  update public.payment_allocation_reservations
  set status = 'cancelled', closed_by = v_actor, closed_at = v_decided_at, close_reason = v_reason
  where plan_id = v_plan.id and status = 'active'
  returning id into v_reservation_id;
  update public.payment_allocation_plans
  set status = 'cancelled', cancelled_by = v_actor, cancelled_at = v_decided_at, cancel_reason = v_reason
  where id = v_plan.id;
  update public.bank_payment_operations set status = 'available'
  where id = v_plan.operation_id and status = 'reserved';
  v_event_id := public.append_financial_outbox_event_internal(
    'payment_allocation.cancelled', 'payment_allocation_plan', v_plan.id,
    v_plan.company_id, v_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'operation_id', v_plan.operation_id, 'plan_id', v_plan.id,
      'reservation_id', v_reservation_id
    )), v_plan.operation_id, null
  );
  v_result := jsonb_build_object('event_id', v_event_id, 'plan_id', v_plan.id, 'status', 'cancelled');
  return public.payment_reconciliation_store_command(
    v_plan.company_id, 'payment_allocation.cancel', p_idempotency_key, v_hash, v_actor, v_result
  );
end
$$;

create function public.payment_reconciliation_validate_document_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.payment_ingestion_batches batch
    where batch.id = new.batch_id and batch.company_id = new.company_id
  ) then raise exception 'payment_document_scope_mismatch'; end if;
  return new;
end
$$;

create trigger payment_documents_validate_scope
  before insert or update of batch_id, company_id on public.payment_documents
  for each row execute function public.payment_reconciliation_validate_document_scope();

create function public.payment_reconciliation_validate_extraction_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.payment_documents document
    where document.id = new.document_id and document.batch_id = new.batch_id
      and document.company_id = new.company_id
  ) then raise exception 'payment_extraction_scope_mismatch'; end if;
  return new;
end
$$;

create trigger payment_document_extractions_validate_scope
  before insert or update of document_id, batch_id, company_id on public.payment_document_extractions
  for each row execute function public.payment_reconciliation_validate_extraction_scope();

create function public.payment_reconciliation_validate_operation_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.payment_document_extractions extraction
    join public.company_bank_accounts account
      on account.id = new.source_company_bank_account_id
    where extraction.id = new.extraction_id and extraction.company_id = new.company_id
      and extraction.status = 'review_required'
      and account.company_id = new.company_id
      and coalesce(account.active, true)
      and public.payment_reconciliation_normalize_bank_name(account.bank_name) = 'BBVA'
      and case upper(btrim(account.currency)) when 'MXP' then 'MXN'
            else upper(btrim(account.currency)) end = new.currency
      and new.source_account_hash in (
        public.payment_reconciliation_account_hash(account.account_number),
        public.payment_reconciliation_account_hash(account.clabe)
      )
  ) then raise exception 'bank_payment_operation_scope_mismatch'; end if;
  return new;
end
$$;

create trigger bank_payment_operations_validate_scope
  before insert on public.bank_payment_operations
  for each row execute function public.payment_reconciliation_validate_operation_scope();

create function public.payment_reconciliation_protect_operation_fact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then raise exception 'bank_payment_operations_is_append_only'; end if;
  if new.company_id is distinct from old.company_id
     or new.source_company_bank_account_id is distinct from old.source_company_bank_account_id
     or new.extraction_id is distinct from old.extraction_id
     or new.bank_name is distinct from old.bank_name
     or new.fingerprint_version is distinct from old.fingerprint_version
     or new.operation_fingerprint is distinct from old.operation_fingerprint
     or new.bank_unique_folio is distinct from old.bank_unique_folio
     or new.application_date is distinct from old.application_date
     or new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.source_account_hash is distinct from old.source_account_hash
     or new.source_account_last4 is distinct from old.source_account_last4
     or new.destination_account_hash is distinct from old.destination_account_hash
     or new.destination_account_last4 is distinct from old.destination_account_last4
     or new.beneficiary_name is distinct from old.beneficiary_name
     or new.payment_reason is distinct from old.payment_reason
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'bank_payment_operation_fact_is_immutable';
  end if;
  return new;
end
$$;

create trigger bank_payment_operations_protect_fact
  before update or delete on public.bank_payment_operations
  for each row execute function public.payment_reconciliation_protect_operation_fact();

create function public.payment_reconciliation_validate_plan_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.bank_payment_operations operation
    where operation.id = new.operation_id and operation.company_id = new.company_id
      and operation.currency = new.currency
  ) then raise exception 'payment_allocation_plan_scope_mismatch'; end if;
  return new;
end
$$;

create trigger payment_allocation_plans_validate_scope
  before insert or update of company_id, operation_id, currency on public.payment_allocation_plans
  for each row execute function public.payment_reconciliation_validate_plan_scope();

create function public.payment_reconciliation_validate_item_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.payment_allocation_plans plan
    join public.payable_snapshots snapshot on snapshot.id = new.snapshot_id
    where plan.id = new.plan_id and plan.operation_id = new.operation_id
      and plan.company_id = snapshot.company_id and plan.currency = new.currency
      and snapshot.currency = new.currency
  ) then raise exception 'payment_allocation_item_scope_mismatch'; end if;
  return new;
end
$$;

create trigger payment_allocation_items_validate_scope
  before insert or update on public.payment_allocation_items
  for each row execute function public.payment_reconciliation_validate_item_scope();
create trigger payment_allocation_items_immutable
  before update or delete on public.payment_allocation_items
  for each row execute function public.payment_reconciliation_protect_immutable();

create function public.payment_reconciliation_validate_reservation_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.payment_allocation_plans plan
    where plan.id = new.plan_id and plan.operation_id = new.operation_id
      and plan.company_id = new.company_id and plan.currency = new.currency
      and plan.total_amount_minor = new.amount_minor
  ) then raise exception 'payment_reservation_scope_mismatch'; end if;
  return new;
end
$$;

create trigger payment_allocation_reservations_validate_scope
  before insert or update of company_id, plan_id, operation_id, amount_minor, currency
  on public.payment_allocation_reservations
  for each row execute function public.payment_reconciliation_validate_reservation_scope();

create function public.payment_reconciliation_validate_movement_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original public.payment_allocation_movements%rowtype;
  v_reversed bigint;
begin
  if not exists (
    select 1 from public.bank_payment_operations operation
    join public.payable_snapshots snapshot on snapshot.id = new.snapshot_id
    where operation.id = new.operation_id and operation.company_id = new.company_id
      and snapshot.company_id = new.company_id and operation.currency = new.currency
      and snapshot.currency = new.currency
  ) then raise exception 'payment_movement_scope_mismatch'; end if;
  if new.movement_type = 'reversal' then
    select * into v_original from public.payment_allocation_movements
    where id = new.original_movement_id for update;
    if not found or v_original.movement_type <> 'confirmation'
       or v_original.operation_id <> new.operation_id
       or v_original.snapshot_id <> new.snapshot_id
       or v_original.currency <> new.currency then
      raise exception 'payment_reversal_original_mismatch';
    end if;
    select coalesce(sum(movement.amount_minor), 0)::bigint into v_reversed
    from public.payment_allocation_movements movement
    where movement.original_movement_id = v_original.id and movement.movement_type = 'reversal';
    if v_reversed + new.amount_minor > v_original.amount_minor then
      raise exception 'payment_reversal_amount_exceeded';
    end if;
  end if;
  return new;
end
$$;

create trigger payment_allocation_movements_validate_scope
  before insert on public.payment_allocation_movements
  for each row execute function public.payment_reconciliation_validate_movement_scope();

create trigger payment_matching_policy_versions_immutable
  before update or delete on public.payment_matching_policy_versions
  for each row execute function public.payment_reconciliation_protect_policy_version();

alter table public.payment_matching_policy_versions enable row level security;
alter table public.payable_snapshots enable row level security;
alter table public.payment_ingestion_batches enable row level security;
alter table public.payment_documents enable row level security;
alter table public.payment_document_extractions enable row level security;
alter table public.bank_payment_operations enable row level security;
alter table public.payment_operation_documents enable row level security;
alter table public.payment_allocation_plans enable row level security;
alter table public.payment_allocation_items enable row level security;
alter table public.payment_allocation_reservations enable row level security;
alter table public.payment_allocation_movements enable row level security;
alter table public.financial_command_receipts enable row level security;
alter table public.financial_outbox_events enable row level security;
alter table public.financial_outbox_delivery_attempts enable row level security;
alter table public.financial_break_glass_audit enable row level security;
alter table public.legacy_payment_receipt_links enable row level security;

revoke all on table public.payment_matching_policy_versions from public, anon, authenticated, service_role;
revoke all on table public.payable_snapshots from public, anon, authenticated, service_role;
revoke all on table public.payment_ingestion_batches from public, anon, authenticated, service_role;
revoke all on table public.payment_documents from public, anon, authenticated, service_role;
revoke all on table public.payment_document_extractions from public, anon, authenticated, service_role;
revoke all on table public.bank_payment_operations from public, anon, authenticated, service_role;
revoke all on table public.payment_operation_documents from public, anon, authenticated, service_role;
revoke all on table public.payment_allocation_plans from public, anon, authenticated, service_role;
revoke all on table public.payment_allocation_items from public, anon, authenticated, service_role;
revoke all on table public.payment_allocation_reservations from public, anon, authenticated, service_role;
revoke all on table public.payment_allocation_movements from public, anon, authenticated, service_role;
revoke all on table public.financial_command_receipts from public, anon, authenticated, service_role;
revoke all on table public.financial_outbox_events from public, anon, authenticated, service_role;
revoke all on table public.financial_outbox_delivery_attempts from public, anon, authenticated, service_role;
revoke all on table public.financial_break_glass_audit from public, anon, authenticated, service_role;
revoke all on table public.legacy_payment_receipt_links from public, anon, authenticated, service_role;

insert into storage.buckets(id, name, "public", file_size_limit, allowed_mime_types)
values (
  'payment-batch-documents', 'payment-batch-documents', false, 26214400,
  array['application/pdf']::text[]
);

create policy "Finance can upload payment batch documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-batch-documents'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/source\.pdf$'
    and public.payment_reconciliation_storage_path_allowed(name, true)
  );

create policy "Finance can read payment batch documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-batch-documents'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/source\.pdf$'
    and public.payment_reconciliation_storage_path_allowed(name, false)
  );

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proname like 'payment_reconciliation_%'
        or p.proname in (
          'payment_amount_to_minor', 'append_financial_outbox_event_internal',
          'rotate_payment_matching_policy',
          'create_payable_snapshot_internal', 'materialize_closed_batch_payable_snapshots',
          'materialize_extraordinary_payable_snapshot', 'payment_operation_confirmed_minor',
          'payable_snapshot_confirmed_minor', 'payment_operation_reserved_minor',
          'payable_snapshot_reserved_minor', 'payment_operation_fingerprint_v1',
          'get_payment_batch_context', 'create_payment_ingestion_batch',
          'finalize_payment_ingestion_upload', 'submit_payment_document_extractions',
          'list_payment_ingestion_batches', 'get_payment_ingestion_batch_detail',
          'accept_payment_document_extraction', 'reject_payment_document_extraction',
          'find_payment_allocation_candidates', 'propose_payment_allocations',
          'reserve_payment_allocations', 'expire_payment_reservation',
          'release_payment_reservation',
          'cancel_payment_allocation_plan'
        )
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_function.signature);
  end loop;
end
$$;

grant execute on function public.get_payment_batch_context() to authenticated;
grant execute on function public.payment_reconciliation_storage_path_allowed(text,boolean) to authenticated;
grant execute on function public.rotate_payment_matching_policy(text,smallint,bigint,timestamptz,text) to authenticated;
grant execute on function public.create_payment_ingestion_batch(uuid,text,bigint,text,text) to authenticated;
grant execute on function public.finalize_payment_ingestion_upload(uuid,integer,text) to authenticated;
grant execute on function public.submit_payment_document_extractions(uuid,text,jsonb,text) to authenticated;
grant execute on function public.list_payment_ingestion_batches(uuid,text,integer) to authenticated;
grant execute on function public.get_payment_ingestion_batch_detail(uuid) to authenticated;
grant execute on function public.accept_payment_document_extraction(uuid,timestamptz,text) to authenticated;
grant execute on function public.reject_payment_document_extraction(uuid,timestamptz,text,text) to authenticated;
grant execute on function public.find_payment_allocation_candidates(uuid,integer) to authenticated;
grant execute on function public.propose_payment_allocations(uuid,jsonb,text) to authenticated;
grant execute on function public.reserve_payment_allocations(uuid,timestamptz,text) to authenticated;
grant execute on function public.expire_payment_reservation(uuid,text) to authenticated;
grant execute on function public.release_payment_reservation(uuid,text,text) to authenticated;
grant execute on function public.cancel_payment_allocation_plan(uuid,text,text) to authenticated;

comment on table public.payment_allocation_movements is
  'Append-only confirmation/reversal ledger. Migration 032 creates the authority but intentionally grants no writer or confirmation RPC before legacy cutover.';
comment on table public.legacy_payment_receipt_links is
  'Quarantine and traceability scaffold only. Migration 032 performs no payment_receipts backfill, projection or dual-write.';
comment on function public.get_payment_batch_context() is
  'Finance-scoped module context. Confirmation and reversal remain false until a separate cutover implementation.';

commit;
