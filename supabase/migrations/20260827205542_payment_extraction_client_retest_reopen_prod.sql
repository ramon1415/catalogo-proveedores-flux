
create or replace function public.payment_reconciliation_reactivate_cancelled_operation(
  p_extraction_id uuid,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $helper$
declare
  v_extraction public.payment_document_extractions%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_actor uuid;
  v_payload jsonb;
  v_payload_hash text;
  v_replay jsonb;
  v_event_id uuid;
  v_result jsonb;
  v_reviewed_at timestamptz;
begin
  select * into v_extraction
  from public.payment_document_extractions
  where id = p_extraction_id
  for update;
  if not found then raise exception 'payment_extraction_not_found'; end if;

  v_actor := public.payment_reconciliation_require_finance(v_extraction.company_id);
  v_payload := jsonb_build_object(
    'expected_updated_at', p_expected_updated_at,
    'extraction_id', p_extraction_id,
    'operation', 'accept'
  );
  v_payload_hash := public.payment_reconciliation_payload_hash(v_payload);
  v_replay := public.payment_reconciliation_command_replay(
    v_extraction.company_id,
    'payment_extraction.accept',
    p_idempotency_key,
    v_payload_hash,
    v_actor
  );
  if v_replay is not null then return v_replay; end if;

  if v_extraction.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_payment_extraction';
  end if;
  if v_extraction.status <> 'review_required' then
    raise exception 'payment_extraction_not_reviewable';
  end if;

  select * into v_operation
  from public.bank_payment_operations
  where extraction_id = v_extraction.id
    and status = 'cancelled'
  for update;
  if not found then return null; end if;

  if v_operation.company_id is distinct from v_extraction.company_id
     or v_operation.bank_name is distinct from v_extraction.bank_name
     or v_operation.bank_unique_folio is distinct from v_extraction.bank_unique_folio
     or v_operation.application_date is distinct from v_extraction.application_date
     or v_operation.amount_minor is distinct from v_extraction.amount_minor
     or v_operation.currency is distinct from v_extraction.currency
     or v_operation.source_account_hash is distinct from v_extraction.source_account_hash
     or v_operation.destination_account_hash is distinct from v_extraction.destination_account_hash
     or v_operation.operation_fingerprint is distinct from public.payment_operation_fingerprint_v1(
       v_extraction.company_id,
       v_extraction.bank_name,
       v_extraction.bank_unique_folio,
       v_extraction.application_date,
       v_extraction.amount_minor,
       v_extraction.currency,
       v_extraction.source_account_hash,
       v_extraction.destination_account_hash
     ) then
    raise exception 'cancelled_payment_operation_snapshot_mismatch';
  end if;

  if not exists (
    select 1
    from public.company_bank_accounts account
    where account.id = v_operation.source_company_bank_account_id
      and account.company_id = v_extraction.company_id
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
  ) then
    raise exception 'bank_payment_operation_company_account_mismatch';
  end if;

  if exists (select 1 from public.payment_request_receipt_links where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_plans where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_items where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_reservations where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_movements where operation_id = v_operation.id) then
    raise exception 'cancelled_payment_operation_has_business_dependencies';
  end if;

  v_reviewed_at := clock_timestamp();

  update public.bank_payment_operations
  set status = 'available'
  where id = v_operation.id
    and status = 'cancelled';
  if not found then raise exception 'cancelled_payment_operation_changed'; end if;

  update public.payment_document_extractions
  set status = 'accepted',
      reviewed_by = v_actor,
      reviewed_at = v_reviewed_at,
      rejection_reason = null,
      updated_at = v_reviewed_at
  where id = v_extraction.id;

  update public.payment_ingestion_batches batch
  set operation_count = (
        select count(*)
        from public.bank_payment_operations operation
        join public.payment_document_extractions extraction
          on extraction.id = operation.extraction_id
        where extraction.batch_id = batch.id
          and operation.status <> 'cancelled'
      ),
      status = case when not exists (
        select 1
        from public.payment_document_extractions pending
        where pending.batch_id = batch.id
          and pending.status in ('review_required', 'blocked')
      ) then 'ready' else 'review_required' end,
      updated_at = v_reviewed_at
  where id = v_extraction.batch_id;

  v_event_id := public.append_financial_outbox_event_internal(
    'payment_operation.reactivated',
    'bank_payment_operation',
    v_operation.id,
    v_extraction.company_id,
    v_actor,
    jsonb_build_object(
      'amount_minor', v_extraction.amount_minor,
      'application_date', v_extraction.application_date,
      'currency', v_extraction.currency,
      'destination_account_last4', v_extraction.destination_account_last4,
      'operation_id', v_operation.id
    ),
    v_extraction.batch_id,
    null,
    'payment-operation-reactivated:' || v_payload_hash
  );

  v_result := jsonb_build_object(
    'event_id', v_event_id,
    'extraction_id', v_extraction.id,
    'operation_id', v_operation.id,
    'status', 'accepted'
  );

  return public.payment_reconciliation_store_command(
    v_extraction.company_id,
    'payment_extraction.accept',
    p_idempotency_key,
    v_payload_hash,
    v_actor,
    v_result
  );
end
$helper$;

revoke all on function public.payment_reconciliation_reactivate_cancelled_operation(
  uuid, timestamptz, text
) from public, anon, authenticated, service_role;

do $patch$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(
    'public.accept_payment_document_extraction(uuid,timestamptz,text)'::regprocedure
  ) into v_definition;

  if position('v_reactivated jsonb;' in v_definition) = 0 then
    v_patched := replace(
      v_definition,
      '  v_reviewed_at timestamptz;',
      E'  v_reviewed_at timestamptz;\n  v_reactivated jsonb;'
    );
    if v_patched = v_definition then
      raise exception 'accept_function_declaration_patch_failed';
    end if;

    v_definition := v_patched;
    v_patched := replace(
      v_definition,
      E'  if v_extraction.status <> ''review_required'' then\n    raise exception ''payment_extraction_not_reviewable'';\n  end if;',
      E'  if v_extraction.status <> ''review_required'' then\n    raise exception ''payment_extraction_not_reviewable'';\n  end if;\n  v_reactivated := public.payment_reconciliation_reactivate_cancelled_operation(\n    p_extraction_id, p_expected_updated_at, p_idempotency_key\n  );\n  if v_reactivated is not null then return v_reactivated; end if;'
    );
    if v_patched = v_definition then
      raise exception 'accept_function_reactivation_patch_failed';
    end if;

    v_definition := v_patched;
  end if;

  if position('and operation.status <> ''cancelled''' in v_definition) = 0 then
    v_patched := replace(
      v_definition,
      E'        where extraction.batch_id = batch.id\n      ),',
      E'        where extraction.batch_id = batch.id\n          and operation.status <> ''cancelled''\n      ),'
    );
    if v_patched = v_definition then
      raise exception 'accept_function_count_patch_failed';
    end if;
    v_definition := v_patched;
  end if;

  execute v_definition;

  select pg_get_functiondef(
    'public.get_payment_ingestion_batch_detail(uuid)'::regprocedure
  ) into v_definition;

  if position(
    'left join public.bank_payment_operations operation on operation.extraction_id = extraction.id and operation.status <> ''cancelled'''
    in v_definition
  ) = 0 then
    v_patched := replace(
      v_definition,
      'left join public.bank_payment_operations operation on operation.extraction_id = extraction.id',
      'left join public.bank_payment_operations operation on operation.extraction_id = extraction.id and operation.status <> ''cancelled'''
    );
    if v_patched = v_definition then
      raise exception 'batch_detail_cancelled_filter_patch_failed';
    end if;
    v_definition := v_patched;
  end if;

  execute v_definition;
end
$patch$;

do $reset$
declare
  v_batch public.payment_ingestion_batches%rowtype;
  v_extraction public.payment_document_extractions%rowtype;
  v_other public.payment_document_extractions%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_reset_at timestamptz := clock_timestamp();
begin
  select * into v_batch
  from public.payment_ingestion_batches
  where id = 'b3ae1413-e772-44f8-a456-7876dc2a0206'::uuid
  for update;
  if not found
     or v_batch.status <> 'review_required'
     or v_batch.operation_count <> 1
     or v_batch.original_file_name <> 'operadora 270826.pdf'
     or v_batch.page_count <> 2
     or v_batch.extraction_count <> 2 then
    raise exception 'target_batch_precondition_failed';
  end if;

  select * into v_extraction
  from public.payment_document_extractions
  where id = 'a13ee2ce-28fe-481f-a79e-a0e48f07b8aa'::uuid
    and batch_id = v_batch.id
    and page_number = 1
  for update;
  if not found
     or v_extraction.status <> 'accepted'
     or v_extraction.amount_minor <> 6520732
     or v_extraction.currency <> 'MXN'
     or v_extraction.bank_unique_folio <> 'I333202608271152210010426550' then
    raise exception 'target_extraction_precondition_failed';
  end if;

  select * into v_other
  from public.payment_document_extractions
  where id = '51a45c37-7ae3-4f18-ae08-1109df2d4ac5'::uuid
    and batch_id = v_batch.id
    and page_number = 2
  for update;
  if not found
     or v_other.status <> 'review_required'
     or v_other.amount_minor <> 14899504
     or v_other.currency <> 'MXN' then
    raise exception 'untargeted_extraction_precondition_failed';
  end if;

  select * into v_operation
  from public.bank_payment_operations
  where id = '92c0452d-2cfa-42d4-8337-fed3838b663d'::uuid
    and extraction_id = v_extraction.id
  for update;
  if not found or v_operation.status <> 'available' then
    raise exception 'target_operation_precondition_failed';
  end if;

  if exists (select 1 from public.payment_request_receipt_links where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_plans where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_items where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_reservations where operation_id = v_operation.id)
     or exists (select 1 from public.payment_allocation_movements where operation_id = v_operation.id) then
    raise exception 'target_operation_has_business_dependencies';
  end if;

  update public.bank_payment_operations
  set status = 'cancelled'
  where id = v_operation.id;

  update public.payment_document_extractions
  set status = 'review_required',
      reviewed_by = null,
      reviewed_at = null,
      rejection_reason = null,
      updated_at = v_reset_at
  where id = v_extraction.id;

  update public.payment_ingestion_batches batch
  set operation_count = (
        select count(*)
        from public.bank_payment_operations operation
        join public.payment_document_extractions extraction
          on extraction.id = operation.extraction_id
        where extraction.batch_id = batch.id
          and operation.status <> 'cancelled'
      ),
      status = 'review_required',
      updated_at = v_reset_at
  where id = v_batch.id;

  insert into public.financial_break_glass_audit(
    company_id,
    actor_profile_id,
    capability,
    reason,
    scope,
    starts_at,
    ends_at
  ) values (
    v_extraction.company_id,
    v_operation.reviewed_by,
    'payment_extraction_client_retest',
    'Reapertura compensatoria solicitada por Ramón para que el cliente repita la revisión en PROD; sin vínculo, pago, reserva ni movimiento.',
    jsonb_build_object(
      'batch_id', v_batch.id,
      'extraction_id', v_extraction.id,
      'operation_id', v_operation.id,
      'page_number', v_extraction.page_number,
      'previous_extraction_status', 'accepted',
      'new_extraction_status', 'review_required',
      'previous_operation_status', 'available',
      'new_operation_status', 'cancelled'
    ),
    v_reset_at,
    v_reset_at + interval '5 minutes'
  );
end
$reset$;

do $postcheck$
begin
  if not exists (
    select 1
    from public.payment_ingestion_batches
    where id = 'b3ae1413-e772-44f8-a456-7876dc2a0206'::uuid
      and status = 'review_required'
      and operation_count = 0
  ) then
    raise exception 'batch_reset_postcheck_failed';
  end if;

  if not exists (
    select 1
    from public.payment_document_extractions
    where id = 'a13ee2ce-28fe-481f-a79e-a0e48f07b8aa'::uuid
      and status = 'review_required'
      and reviewed_by is null
      and reviewed_at is null
  ) then
    raise exception 'target_extraction_reset_postcheck_failed';
  end if;

  if not exists (
    select 1
    from public.payment_document_extractions
    where id = '51a45c37-7ae3-4f18-ae08-1109df2d4ac5'::uuid
      and status = 'review_required'
      and reviewed_by is null
      and reviewed_at is null
  ) then
    raise exception 'untargeted_extraction_changed';
  end if;

  if not exists (
    select 1
    from public.bank_payment_operations
    where id = '92c0452d-2cfa-42d4-8337-fed3838b663d'::uuid
      and status = 'cancelled'
  ) then
    raise exception 'operation_cancel_postcheck_failed';
  end if;

  if position(
    'payment_reconciliation_reactivate_cancelled_operation'
    in pg_get_functiondef(
      'public.accept_payment_document_extraction(uuid,timestamptz,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'accept_reactivation_postcheck_failed';
  end if;

  if position(
    'operation.status <> ''cancelled'''
    in pg_get_functiondef(
      'public.get_payment_ingestion_batch_detail(uuid)'::regprocedure
    )
  ) = 0 then
    raise exception 'batch_detail_filter_postcheck_failed';
  end if;
end
$postcheck$;
