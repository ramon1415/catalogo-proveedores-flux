-- Hotfix: allow receipt matching for requests already materialized into a bank layout.
-- Scope is deliberately narrow: finance_validation is matchable only when there is exactly
-- one included line in a generated/uploaded layout and the payable snapshot remains current.

create or replace function public.payment_reconciliation_snapshot_is_receipt_matchable(
  p_snapshot_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_snapshot public.payable_snapshots%rowtype;
  v_request public.payment_requests%rowtype;
  v_currency text;
  v_amount_minor bigint;
  v_live_layout_lines integer := 0;
  v_source_current boolean := false;
begin
  select * into v_snapshot
  from public.payable_snapshots
  where id = p_snapshot_id;
  if not found then return false; end if;

  select * into v_request
  from public.payment_requests
  where id = v_snapshot.payment_request_id;
  if not found then return false; end if;

  -- Preserve the original contract for requests that have not entered a layout yet.
  if v_request.status::text = 'approved' then
    return public.payment_reconciliation_snapshot_is_payable(v_snapshot.id);
  end if;

  -- finance_validation is receipt-matchable only as the consequence of a live bank layout.
  if v_request.status::text <> 'finance_validation' then
    return false;
  end if;

  if v_snapshot.company_id <> v_request.company_id
     or v_snapshot.source_approval_material_updated_at is distinct from v_request.approval_material_updated_at
     or v_snapshot.authorized_at < v_request.approval_material_updated_at then
    return false;
  end if;

  v_currency := public.payment_reconciliation_normalize_currency(v_request.currency);
  v_amount_minor := public.payment_amount_to_minor(v_request.amount_requested, v_currency);
  if v_snapshot.currency is distinct from v_currency
     or v_snapshot.amount_minor is distinct from v_amount_minor then
    return false;
  end if;

  select count(*) into v_live_layout_lines
  from public.payment_layout_lines line
  join public.payment_layouts layout on layout.id = line.layout_id
  where line.payment_request_id = v_request.id
    and line.company_id = v_request.company_id
    and line.proveedor_id = v_request.proveedor_id
    and line.status = 'included'
    and layout.status in ('generated', 'uploaded')
    and public.payment_amount_to_minor(line.amount, v_currency) = v_snapshot.amount_minor;

  if v_live_layout_lines <> 1 then
    return false;
  end if;

  if v_snapshot.source_type = 'approval_batch_item' then
    select exists (
      select 1
      from public.approval_batch_items item
      join public.approval_batches batch on batch.id = item.batch_id
      where item.id = v_snapshot.source_id
        and item.payment_request_id = v_request.id
        and item.removed_at is null
        and item.director_status = 'approved'
        and item.finance_release_status = 'released'
        and item.decided_by = v_snapshot.authorized_by
        and item.decided_at is not distinct from v_snapshot.authorized_at
        and batch.status = 'closed'
        and batch.closed_at is not null
        and v_snapshot.source_status = 'closed'
        and public.approval_batch_request_has_current_direction_approval(v_request.id)
    ) into v_source_current;
  elsif v_snapshot.source_type = 'extraordinary_authorization' then
    select exists (
      select 1
      from public.payment_request_extraordinary_authorizations extra_auth
      where extra_auth.id = v_snapshot.source_id
        and extra_auth.payment_request_id = v_request.id
        and extra_auth.status = 'active'
        and extra_auth.authorized_by = v_snapshot.authorized_by
        and extra_auth.authorized_at is not distinct from v_snapshot.authorized_at
        and v_snapshot.source_status = 'active'
    ) into v_source_current;
  else
    v_source_current := false;
  end if;

  return coalesce(v_source_current, false);
end
$function$;

revoke all on function public.payment_reconciliation_snapshot_is_receipt_matchable(uuid)
  from public, anon, authenticated;

create or replace function public.find_payment_receipt_candidates(
  p_operation_id uuid,
  p_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
      and request.status::text in ('approved', 'finance_validation')
      and snapshot.amount_minor = v_operation.amount_minor
      and snapshot.currency = v_operation.currency
      and public.payment_reconciliation_snapshot_is_receipt_matchable(snapshot.id)
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
$function$;

create or replace function public.link_payment_receipt_to_request(
  p_operation_id uuid,
  p_payment_request_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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
  v_notification jsonb;
  v_updated integer;
  v_layout_line_count integer := 0;
  v_layout_line public.payment_layout_lines%rowtype;
  v_layout public.payment_layouts%rowtype;
  v_layout_final_status text;
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
  if v_request.status::text not in ('approved', 'finance_validation') then
    raise exception 'payment_request_must_be_approved_or_in_layout';
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

  if v_request.status::text = 'finance_validation' then
    select count(*) into v_layout_line_count
    from public.payment_layout_lines line
    join public.payment_layouts layout on layout.id = line.layout_id
    where line.payment_request_id = v_request.id
      and line.company_id = v_request.company_id
      and line.proveedor_id = v_request.proveedor_id
      and line.status = 'included'
      and layout.status in ('generated', 'uploaded');

    if v_layout_line_count <> 1 then
      raise exception 'payment_request_live_layout_line_required';
    end if;

    select line.* into v_layout_line
    from public.payment_layout_lines line
    join public.payment_layouts layout on layout.id = line.layout_id
    where line.payment_request_id = v_request.id
      and line.company_id = v_request.company_id
      and line.proveedor_id = v_request.proveedor_id
      and line.status = 'included'
      and layout.status in ('generated', 'uploaded')
    for update of line;

    select * into v_layout
    from public.payment_layouts
    where id = v_layout_line.layout_id
    for update;

    if v_layout.status not in ('generated', 'uploaded')
       or v_layout_line.status <> 'included' then
      raise exception 'payment_request_live_layout_line_changed';
    end if;
  end if;

  select * into v_snapshot
  from public.payable_snapshots
  where payment_request_id = v_request.id
  order by version desc
  limit 1
  for update;
  if not found or not public.payment_reconciliation_snapshot_is_receipt_matchable(v_snapshot.id) then
    raise exception 'payment_request_not_payable';
  end if;
  if v_snapshot.amount_minor <> v_operation.amount_minor then
    raise exception 'receipt_request_amount_mismatch';
  end if;
  if v_snapshot.currency <> v_operation.currency then
    raise exception 'receipt_request_currency_mismatch';
  end if;
  if v_layout_line.id is not null
     and public.payment_amount_to_minor(v_layout_line.amount, v_snapshot.currency) <> v_snapshot.amount_minor then
    raise exception 'layout_line_snapshot_amount_mismatch';
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
    and status::text = v_request.status::text;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'payment_request_changed_during_link';
  end if;

  if v_layout_line.id is not null then
    update public.payment_layout_lines
    set status = 'paid',
        updated_at = v_linked_at
    where id = v_layout_line.id
      and status = 'included';
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'payment_layout_line_changed_during_link';
    end if;

    update public.payment_layouts layout
    set status = case
          when not exists (
            select 1
            from public.payment_layout_lines pending
            where pending.layout_id = layout.id
              and pending.status = 'included'
          ) then 'confirmed'
          else layout.status
        end,
        updated_at = v_linked_at
    where layout.id = v_layout.id
      and layout.status in ('generated', 'uploaded')
    returning layout.status into v_layout_final_status;

    if v_layout_final_status is null then
      raise exception 'payment_layout_changed_during_link';
    end if;
  end if;

  v_notification :=
    public.enqueue_payment_receipt_linked_notifications_internal(v_link_id);

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
    )
    || case when v_layout_line.id is not null then jsonb_build_object(
      'layout_id', v_layout.id,
      'layout_line_id', v_layout_line.id,
      'layout_status', v_layout_final_status
    ) else '{}'::jsonb end
    || jsonb_build_object(
      'notification_resolution', v_notification -> 'notification_resolution'
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
    'request_status', 'paid',
    'layout_id', v_layout.id,
    'layout_line_id', v_layout_line.id,
    'layout_status', v_layout_final_status
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
$function$;
