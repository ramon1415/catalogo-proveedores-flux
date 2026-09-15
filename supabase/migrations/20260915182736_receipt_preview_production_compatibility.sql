-- Preserve PROD's employee reimbursements and explicitly reopened receipts.
-- Optional paths activate only where their existing command handlers exist.
-- Read-only suggestions before Finance's single confirmation. This does not
-- accept an extraction, attest evidence, approve a request or record a payment.
-- The existing accept/evidence/link commands remain the final write boundary.
create or replace function public.preview_payment_receipt_candidates(
  p_extraction_id uuid,
  p_expected_updated_at timestamptz,
  p_limit integer default 20
) returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_extraction public.payment_document_extractions%rowtype;
  v_operation public.bank_payment_operations%rowtype;
  v_base jsonb;
  v_items jsonb;
  v_account_count integer;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_extraction from public.payment_document_extractions
  where id = p_extraction_id;
  if not found then raise exception 'payment_extraction_not_found'; end if;
  perform public.payment_reconciliation_require_finance(v_extraction.company_id);
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'invalid_limit';
  end if;
  if v_extraction.updated_at is distinct from p_expected_updated_at then
    raise exception 'stale_payment_extraction';
  end if;
  if not exists (
    select 1 from public.payment_ingestion_batches batch
    where batch.id = v_extraction.batch_id
      and batch.company_id = v_extraction.company_id
      and batch.status not in ('cancelled', 'failed')
  ) then raise exception 'payment_batch_scope_mismatch'; end if;

  select * into v_operation from public.bank_payment_operations
  where extraction_id = v_extraction.id;
  v_base := jsonb_build_object(
    'items', '[]'::jsonb, 'read_only', true,
    'extraction_updated_at', v_extraction.updated_at,
    'needs_acceptance', v_extraction.status = 'review_required',
    'operation_id', v_operation.id,
    'link_preview', case when v_operation.id is null then null
      else public.get_payment_receipt_link_preview(v_operation.id) end
  );
  if exists (select 1 from public.payment_request_receipt_links
    where operation_id = v_operation.id) then
    return v_base || jsonb_build_object('outcome', 'linked');
  end if;
  if v_extraction.status not in ('review_required', 'accepted')
     or upper(btrim(v_extraction.bank_name)) <> 'BBVA'
     or lower(coalesce(v_extraction.bank_status, '')) <> 'operado'
     or v_extraction.application_date is null
     or coalesce(v_extraction.amount_minor, 0) <= 0
     or v_extraction.currency is null
     or coalesce(v_extraction.bank_unique_folio, '') !~ '^[A-Z0-9-]{8,120}$'
     or v_extraction.source_account_hash is null
     or (v_extraction.status = 'accepted' and v_operation.id is null)
     or (v_operation.status = 'cancelled' and (
       v_extraction.status <> 'review_required'
       or to_regprocedure('public.payment_reconciliation_reactivate_cancelled_operation(uuid,timestamptz,text)') is null
     )) then
    return v_base || jsonb_build_object('outcome', 'blocked',
      'block_reason', 'payment_extraction_not_conciliable');
  end if;
  if v_operation.status = 'cancelled' and (
    v_operation.company_id is distinct from v_extraction.company_id
    or v_operation.bank_name is distinct from v_extraction.bank_name
    or v_operation.bank_unique_folio is distinct from v_extraction.bank_unique_folio
    or v_operation.application_date is distinct from v_extraction.application_date
    or v_operation.amount_minor is distinct from v_extraction.amount_minor
    or v_operation.currency is distinct from v_extraction.currency
    or v_operation.source_account_hash is distinct from v_extraction.source_account_hash
    or v_operation.destination_account_hash is distinct from v_extraction.destination_account_hash
  ) then
    return v_base || jsonb_build_object('outcome', 'blocked',
      'block_reason', 'cancelled_payment_operation_snapshot_mismatch');
  end if;
  if exists (
    select 1 from public.bank_payment_operations operation
    where operation.company_id = v_extraction.company_id
      and operation.bank_unique_folio = v_extraction.bank_unique_folio
      and operation.extraction_id <> v_extraction.id
  ) then
    return v_base || jsonb_build_object('outcome', 'blocked',
      'block_reason', 'bank_payment_operation_folio_duplicate');
  end if;
  if v_operation.id is null or v_operation.status = 'cancelled' then
    select count(*) into v_account_count from public.company_bank_accounts account
    where account.company_id = v_extraction.company_id
      and coalesce(account.active, true)
      and (v_operation.id is null or account.id = v_operation.source_company_bank_account_id)
      and public.payment_reconciliation_normalize_bank_name(account.bank_name) = 'BBVA'
      and case upper(btrim(account.currency)) when 'MXP' then 'MXN'
        else upper(btrim(account.currency)) end = v_extraction.currency
      and (public.payment_reconciliation_source_account_hash_matches(
        v_extraction.source_account_hash, account.account_number)
        or public.payment_reconciliation_source_account_hash_matches(
          v_extraction.source_account_hash, account.clabe));
    if v_account_count <> 1 then
      return v_base || jsonb_build_object('outcome', 'blocked', 'block_reason',
        case when v_account_count = 0 then 'bank_payment_operation_company_account_mismatch'
          else 'bank_payment_operation_company_account_ambiguous' end);
    end if;
  end if;

  -- Same eligibility predicates as find_payment_receipt_candidates. The
  -- extraction's amount/name/account replace the as-yet unaccepted operation.
  with latest_snapshots as (
    select distinct on (snapshot.payment_request_id) snapshot.*
    from public.payable_snapshots snapshot
    where snapshot.company_id = v_extraction.company_id
    order by snapshot.payment_request_id, snapshot.version desc
  ), exact_candidates as (
    select snapshot.id as snapshot_id, request.id as payment_request_id,
      request.request_number, request.concept, request.status::text as request_status,
      coalesce(proveedor.alias, proveedor.nombre_completo, 'Proveedor') as proveedor_name,
      snapshot.amount_minor, snapshot.currency,
      request.request_type::text as request_type, 'provider'::text as payee_kind,
      (v_extraction.destination_account_hash is not null and (
        v_extraction.destination_account_hash = public.payment_reconciliation_account_hash(proveedor.clabe)
        or v_extraction.destination_account_hash = public.payment_reconciliation_account_hash(proveedor.cuenta_bancaria)
      )) as account_match,
      (nullif(public.payment_receipt_normalize_match_text(v_extraction.beneficiary_name), '') is not null and (
        (nullif(public.payment_receipt_normalize_match_text(proveedor.alias), '') is not null
          and public.payment_receipt_normalize_match_text(v_extraction.beneficiary_name)
            like '%' || public.payment_receipt_normalize_match_text(proveedor.alias) || '%')
        or (nullif(public.payment_receipt_normalize_match_text(proveedor.nombre_completo), '') is not null
          and public.payment_receipt_normalize_match_text(v_extraction.beneficiary_name)
            like '%' || public.payment_receipt_normalize_match_text(proveedor.nombre_completo) || '%')
      )) as name_match
    from latest_snapshots snapshot
    join public.payment_requests request on request.id = snapshot.payment_request_id
    join public.proveedores proveedor on proveedor.id = request.proveedor_id
    where request.company_id = v_extraction.company_id
      and not (coalesce(request.request_type::text = 'reimbursement', false)
        or request.beneficiary_profile_id is not null)
      and request.status::text in ('approved', 'finance_validation', 'paid')
      and snapshot.amount_minor = v_extraction.amount_minor
      and snapshot.currency = v_extraction.currency
      and public.payment_reconciliation_snapshot_is_receipt_matchable(snapshot.id)
      and not exists (select 1 from public.payment_request_receipt_links link
        where link.payment_request_id = request.id)
      and (request.status::text = 'paid' or not exists (
        select 1 from public.payment_receipts legacy where legacy.payment_request_id = request.id))
  ), employee_candidates as (
    select snapshot.id as snapshot_id, request.id as payment_request_id,
      request.request_number, request.concept, request.status::text as request_status,
      coalesce(nullif(btrim(account.beneficiary_name), ''),
        nullif(btrim(profile.full_name), ''), 'Beneficiario') as proveedor_name,
      snapshot.amount_minor, snapshot.currency,
      'reimbursement'::text as request_type, 'employee_beneficiary'::text as payee_kind,
      (v_extraction.destination_account_hash is not null and (
        v_extraction.destination_account_hash = public.payment_reconciliation_account_hash(account.clabe)
        or v_extraction.destination_account_hash = public.payment_reconciliation_account_hash(account.cuenta)
      )) as account_match,
      (nullif(public.payment_receipt_normalize_match_text(v_extraction.beneficiary_name), '') is not null and (
        (nullif(public.payment_receipt_normalize_match_text(account.beneficiary_name), '') is not null
          and public.payment_receipt_normalize_match_text(v_extraction.beneficiary_name)
            like '%' || public.payment_receipt_normalize_match_text(account.beneficiary_name) || '%')
        or (nullif(public.payment_receipt_normalize_match_text(profile.full_name), '') is not null
          and public.payment_receipt_normalize_match_text(v_extraction.beneficiary_name)
            like '%' || public.payment_receipt_normalize_match_text(profile.full_name) || '%')
      )) as name_match
    from latest_snapshots snapshot
    join public.payment_requests request on request.id = snapshot.payment_request_id
    join public.employee_bank_accounts account on account.profile_id = request.beneficiary_profile_id
      and account.company_id = request.company_id
    join public.profiles profile on profile.id = request.beneficiary_profile_id
      and coalesce(profile.active, true)
    where to_regprocedure('public.find_payment_receipt_candidates_pre_reimb(uuid,integer)') is not null
      and request.company_id = v_extraction.company_id
      and (coalesce(request.request_type::text = 'reimbursement', false)
        or request.beneficiary_profile_id is not null)
      and public.has_active_company_membership(request.beneficiary_profile_id, request.company_id)
      and request.status::text in ('approved', 'finance_validation', 'paid')
      and snapshot.amount_minor = v_extraction.amount_minor
      and snapshot.currency = v_extraction.currency
      and public.payment_reconciliation_snapshot_is_receipt_matchable(snapshot.id)
      and not exists (select 1 from public.payment_request_receipt_links link
        where link.payment_request_id = request.id)
      and (request.status::text = 'paid' or not exists (
        select 1 from public.payment_receipts legacy where legacy.payment_request_id = request.id))
  ), all_candidates as (
    select * from exact_candidates
    union all
    select * from employee_candidates
  )
  select coalesce(jsonb_agg(to_jsonb(candidate)
    order by candidate.account_match desc, candidate.name_match desc,
      candidate.request_number, candidate.payment_request_id), '[]'::jsonb)
  into v_items from (
    select * from all_candidates where account_match or name_match
    order by account_match desc, name_match desc, payment_request_id limit p_limit
  ) candidate;
  return v_base || jsonb_build_object('items', v_items, 'outcome',
    case jsonb_array_length(v_items) when 0 then 'none' when 1 then 'exact' else 'multiple' end);
end
$$;

revoke all on function public.preview_payment_receipt_candidates(uuid, timestamptz, integer) from public, anon;
grant execute on function public.preview_payment_receipt_candidates(uuid, timestamptz, integer) to authenticated;
comment on function public.preview_payment_receipt_candidates(uuid, timestamptz, integer)
  is 'Finance/company-scoped read-only suggestions from an unchanged extraction. No acceptance, evidence attestation or payment before explicit confirmation.';
notify pgrst, 'reload schema';
