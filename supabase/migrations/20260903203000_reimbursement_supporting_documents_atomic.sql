begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
begin
  if to_regclass('storage.objects') is null
     or to_regclass('public.payment_requests') is null
     or to_regclass('public.reimbursement_items') is null
     or to_regprocedure('public.current_profile_id()') is null
     or to_regprocedure('public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text)') is null then
    raise exception 'reimbursement_document_atomic_prerequisites_missing';
  end if;
end
$precheck$;

create or replace function public.create_reimbursement_request_with_documents(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_month date,
  p_currency text,
  p_exchange_rate numeric,
  p_description text,
  p_notes text,
  p_requested_by uuid,
  p_is_extraordinary_adjustment boolean,
  p_approver_id uuid,
  p_approver_assignment_id uuid,
  p_beneficiary_profile_id uuid,
  p_payment_method text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $function$
declare
  v_profile_id uuid := public.current_profile_id();
  v_auth_user_id uuid := auth.uid();
  v_item jsonb;
  v_category_id uuid;
  v_amount numeric;
  v_total numeric := 0;
  v_dominant_amount numeric := -1;
  v_dominant_category_id uuid;
  v_deducible boolean;
  v_item_subtotal numeric;
  v_item_tax numeric;
  v_deducible_total numeric := 0;
  v_deducible_subtotal numeric := 0;
  v_tax numeric := 0;
  v_has_fiscal boolean := false;
  v_fiscal_ok boolean := false;
  v_subtotal numeric;
  v_storage_path text;
  v_storage_paths text[] := array[]::text[];
  v_invoice_uuid text;
  v_invoice_uuids text[] := array[]::text[];
  v_payment_method text := lower(coalesce(nullif(btrim(p_payment_method), ''), 'transfer'));
  v_result jsonb;
  v_request_id uuid;
begin
  if v_auth_user_id is null or v_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_requested_by is null or p_requested_by <> v_profile_id then
    raise exception 'requester_profile_must_match_current_profile';
  end if;
  if p_company_id is null or p_cost_center_id is null or p_budget_month is null then
    raise exception 'reimbursement_budget_scope_required';
  end if;
  if p_beneficiary_profile_id is null then
    raise exception 'beneficiary_company_membership_required';
  end if;
  if v_payment_method not in ('transfer','cash','check','other') then
    raise exception 'reimbursement_payment_method_invalid';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'reimbursement_items_required';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_category_id := nullif(v_item ->> 'budget_category_id', '')::uuid;
      v_amount := nullif(v_item ->> 'amount', '')::numeric;
      v_item_subtotal := nullif(v_item ->> 'subtotal_amount', '')::numeric;
      v_item_tax := nullif(v_item ->> 'tax_amount', '')::numeric;
      v_deducible := coalesce((v_item ->> 'deducible')::boolean, true);
    exception when others then
      raise exception 'reimbursement_item_payload_invalid';
    end;

    v_invoice_uuid := nullif(upper(btrim(coalesce(v_item ->> 'invoice_uuid', ''))), '');
    v_storage_path := nullif(btrim(coalesce(v_item ->> 'storage_path', '')), '');

    if nullif(btrim(coalesce(v_item ->> 'descripcion', '')), '') is null then
      raise exception 'reimbursement_item_description_required';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'reimbursement_item_amount_invalid';
    end if;
    if v_category_id is null or not exists (
      select 1
      from public.company_cost_center_budget_categories relation
      where relation.company_id = p_company_id
        and relation.cost_center_id = p_cost_center_id
        and relation.budget_category_id = v_category_id
        and relation.active
    ) then
      raise exception 'reimbursement_item_budget_category_invalid';
    end if;
    if v_item_subtotal is not null and v_item_subtotal <= 0 then
      raise exception 'reimbursement_item_subtotal_invalid';
    end if;
    if coalesce(v_item_tax, 0) < 0 then
      raise exception 'reimbursement_item_tax_invalid';
    end if;
    if v_invoice_uuid is not null then
      if v_invoice_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
        raise exception 'reimbursement_item_invoice_uuid_invalid';
      end if;
      if v_invoice_uuid = any(v_invoice_uuids) then
        raise exception 'reimbursement_item_invoice_uuid_duplicate';
      end if;
      v_invoice_uuids := array_append(v_invoice_uuids, v_invoice_uuid);
    end if;

    if v_deducible and v_storage_path is null then
      raise exception 'reimbursement_item_receipt_required';
    end if;
    if v_storage_path is not null then
      if v_storage_path !~* '^solicitudes/drafts/[0-9a-f-]{36}/[^/]+\.(jpg|jpeg|png|webp|pdf|xml)$'
         or split_part(v_storage_path, '/', 3) <> v_profile_id::text then
        raise exception 'reimbursement_document_path_invalid';
      end if;
      if v_storage_path = any(v_storage_paths) then
        raise exception 'reimbursement_document_path_duplicate';
      end if;
      if not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'payment-receipts'
          and object.name = v_storage_path
          and object.owner = v_auth_user_id
      ) then
        raise exception 'reimbursement_document_not_found_or_not_owned';
      end if;
      if exists (
        select 1 from public.payment_requests request
        where request.invoice_storage_path = v_storage_path
      ) or exists (
        select 1 from public.reimbursement_items item
        where item.storage_path = v_storage_path
      ) then
        raise exception 'reimbursement_document_already_linked';
      end if;
      v_storage_paths := array_append(v_storage_paths, v_storage_path);
    end if;

    v_total := v_total + v_amount;
    if v_amount > v_dominant_amount then
      v_dominant_amount := v_amount;
      v_dominant_category_id := v_category_id;
    end if;
    if v_deducible and v_item_subtotal is not null then
      v_has_fiscal := true;
      v_deducible_total := v_deducible_total + v_amount;
      v_deducible_subtotal := v_deducible_subtotal + v_item_subtotal;
      v_tax := v_tax + coalesce(v_item_tax, 0);
    end if;
  end loop;

  v_total := round(v_total, 2);
  if v_total <= 0 or v_dominant_category_id is null then
    raise exception 'reimbursement_items_required';
  end if;
  v_fiscal_ok := v_has_fiscal
    and abs((v_deducible_subtotal + v_tax) - v_deducible_total) <= 0.01;
  v_subtotal := case when v_fiscal_ok then round(v_total - v_tax, 2) else null end;
  v_tax := case when v_fiscal_ok then round(v_tax, 2) else null end;

  v_result := public.create_payment_request(
    p_proveedor_id => null,
    p_company_id => p_company_id,
    p_cost_center_id => p_cost_center_id,
    p_budget_category_id => v_dominant_category_id,
    p_budget_month => p_budget_month,
    p_amount_requested => v_total,
    p_currency => p_currency,
    p_exchange_rate => p_exchange_rate,
    p_description => p_description,
    p_notes => p_notes,
    p_requested_by => p_requested_by,
    p_is_extraordinary_adjustment => p_is_extraordinary_adjustment,
    p_approver_id => p_approver_id,
    p_approver_assignment_id => p_approver_assignment_id,
    p_subtotal_amount => v_subtotal,
    p_tax_amount => v_tax,
    p_withholding_amount => case when v_subtotal is null then null else 0 end,
    p_invoice_uuid => null,
    p_beneficiary_profile_id => p_beneficiary_profile_id,
    p_request_type => 'reimbursement'
  );

  v_request_id := coalesce(
    nullif(v_result ->> 'payment_request_id', '')::uuid,
    nullif(v_result ->> 'id', '')::uuid
  );
  if v_request_id is null then
    raise exception 'reimbursement_payment_request_id_missing';
  end if;

  update public.payment_requests
     set payment_method = v_payment_method,
         updated_at = now()
   where id = v_request_id
     and requested_by = v_profile_id
     and request_type::text = 'reimbursement';
  if not found then
    raise exception 'reimbursement_payment_method_link_failed';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.reimbursement_items (
      payment_request_id,
      company_id,
      budget_category_id,
      descripcion,
      amount,
      subtotal_amount,
      tax_amount,
      deducible,
      invoice_uuid,
      cfdi_data,
      storage_path
    ) values (
      v_request_id,
      p_company_id,
      (v_item ->> 'budget_category_id')::uuid,
      btrim(v_item ->> 'descripcion'),
      (v_item ->> 'amount')::numeric,
      nullif(v_item ->> 'subtotal_amount', '')::numeric,
      nullif(v_item ->> 'tax_amount', '')::numeric,
      coalesce((v_item ->> 'deducible')::boolean, true),
      nullif(upper(btrim(coalesce(v_item ->> 'invoice_uuid', ''))), ''),
      v_item -> 'cfdi_data',
      nullif(btrim(coalesce(v_item ->> 'storage_path', '')), '')
    );
  end loop;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'payment_request_id', v_request_id,
    'beneficiary_profile_id', p_beneficiary_profile_id,
    'payment_method', v_payment_method,
    'reimbursement_item_count', jsonb_array_length(p_items),
    'supporting_documents_linked', coalesce(array_length(v_storage_paths, 1), 0)
  );
end;
$function$;

alter function public.create_reimbursement_request_with_documents(
  uuid, uuid, date, text, numeric, text, text, uuid, boolean,
  uuid, uuid, uuid, text, jsonb
) owner to postgres;

revoke all on function public.create_reimbursement_request_with_documents(
  uuid, uuid, date, text, numeric, text, text, uuid, boolean,
  uuid, uuid, uuid, text, jsonb
) from public, anon;

grant execute on function public.create_reimbursement_request_with_documents(
  uuid, uuid, date, text, numeric, text, text, uuid, boolean,
  uuid, uuid, uuid, text, jsonb
) to authenticated, service_role;

comment on function public.create_reimbursement_request_with_documents(
  uuid, uuid, date, text, numeric, text, text, uuid, boolean,
  uuid, uuid, uuid, text, jsonb
) is 'Crea un reembolso y todos sus renglones/comprobantes dentro de una sola transacción de BD; los archivos deben existir previamente en staging y pertenecer a la sesión.';

do $postcheck$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
    into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_reimbursement_request_with_documents'
  limit 1;

  if v_definition is null
     or v_definition not like '%reimbursement_document_not_found_or_not_owned%'
     or v_definition not like '%public.create_payment_request(%'
     or v_definition not like '%insert into public.reimbursement_items%'
     or v_definition not like '%object.owner = v_auth_user_id%' then
    raise exception 'reimbursement_document_atomic_contract_invalid';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.create_reimbursement_request_with_documents(uuid,uuid,date,text,numeric,text,text,uuid,boolean,uuid,uuid,uuid,text,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.create_reimbursement_request_with_documents(uuid,uuid,date,text,numeric,text,text,uuid,boolean,uuid,uuid,uuid,text,jsonb)',
       'execute'
     ) then
    raise exception 'reimbursement_document_atomic_acl_invalid';
  end if;
end
$postcheck$;

notify pgrst, 'reload schema';

commit;
