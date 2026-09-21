-- Payment batch hotfix: BBVA receipts may left-pad the 9/10 digit source
-- account to 18 digits. Match that representation without rewriting stored
-- extractions, weakening company/currency/bank checks, or changing hashes used
-- by any other reconciliation contract.

do $$
begin
  if to_regprocedure('public.payment_reconciliation_account_hash(text)') is null
     or to_regprocedure('public.payment_reconciliation_account_material(text)') is null
     or to_regprocedure('public.accept_payment_document_extraction(uuid,timestamptz,text)') is null
     or to_regprocedure('public.payment_reconciliation_validate_operation_scope()') is null then
    raise exception 'payment_batch_padded_account_precheck: required reconciliation contract is missing';
  end if;

  if to_regprocedure('public.payment_reconciliation_source_account_hash_matches(text,text)') is not null then
    raise exception 'payment_batch_padded_account_precheck: helper already exists';
  end if;
end
$$;

create function public.payment_reconciliation_source_account_hash_matches(
  p_source_account_hash text,
  p_company_account text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = public, pg_temp
as $$
  with account_material as (
    select public.payment_reconciliation_account_material(p_company_account) as value
  ), candidate_material as (
    select value
    from account_material
    where value ~ '^[0-9]{10,18}$'

    union

    select lpad(value, width, '0')
    from account_material
    cross join lateral generate_series(greatest(char_length(value), 10), 18) as width
    where value ~ '^[0-9]{9,10}$'
  )
  select exists (
    select 1
    from candidate_material candidate
    where public.payment_reconciliation_account_hash(candidate.value) = p_source_account_hash
  );
$$;

revoke all on function public.payment_reconciliation_source_account_hash_matches(text,text)
  from public, anon, authenticated, service_role;

create or replace function public.accept_payment_document_extraction(
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
      and (
        public.payment_reconciliation_source_account_hash_matches(
          v_extraction.source_account_hash, account.account_number
        )
        or public.payment_reconciliation_source_account_hash_matches(
          v_extraction.source_account_hash, account.clabe
        )
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

create or replace function public.payment_reconciliation_validate_operation_scope()
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
      and (
        public.payment_reconciliation_source_account_hash_matches(
          new.source_account_hash, account.account_number
        )
        or public.payment_reconciliation_source_account_hash_matches(
          new.source_account_hash, account.clabe
        )
      )
  ) then raise exception 'bank_payment_operation_scope_mismatch'; end if;
  return new;
end
$$;

do $$
declare
  v_helper record;
  v_accept record;
  v_scope record;
begin
  select prosecdef, provolatile into v_helper
  from pg_proc where oid = 'public.payment_reconciliation_source_account_hash_matches(text,text)'::regprocedure;
  select prosecdef, provolatile into v_accept
  from pg_proc where oid = 'public.accept_payment_document_extraction(uuid,timestamptz,text)'::regprocedure;
  select prosecdef, provolatile into v_scope
  from pg_proc where oid = 'public.payment_reconciliation_validate_operation_scope()'::regprocedure;

  if v_helper.prosecdef or v_helper.provolatile <> 'i'
     or not v_accept.prosecdef or v_accept.provolatile <> 'v'
     or not v_scope.prosecdef or v_scope.provolatile <> 'v' then
    raise exception 'payment_batch_padded_account_postcheck: function security contract changed';
  end if;

  if not public.payment_reconciliation_source_account_hash_matches(
       public.payment_reconciliation_account_hash('000000000113509621'), '0113509621'
     )
     or not public.payment_reconciliation_source_account_hash_matches(
       public.payment_reconciliation_account_hash('0113509621'), '0113509621'
     )
     or public.payment_reconciliation_source_account_hash_matches(
       public.payment_reconciliation_account_hash('000000000113509622'), '0113509621'
     ) then
    raise exception 'payment_batch_padded_account_postcheck: BBVA account equivalence failed';
  end if;
end
$$;
