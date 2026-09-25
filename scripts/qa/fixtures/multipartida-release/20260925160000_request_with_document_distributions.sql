begin;

-- MULTI-PARTIDA · ruta con comprobante adjunto (create_payment_request_with_document).
--
-- La solicitud normal CON archivo adjunto (main) usa
-- create_payment_request_with_document, que llama a create_payment_request y
-- enlaza el documento en la MISMA transacción — pero sus firmas no reciben
-- p_distributions, así que una solicitud multi-partida con comprobante perdía el
-- reparto. Se agrega p_distributions y se pasa a create_payment_request (que ya
-- inserta las líneas en su propia transacción = la misma). Resultado: solicitud
-- + líneas + enlace del comprobante quedan atómicos. Single-partida: p_distributions
-- null => passthrough null => comportamiento idéntico.
--
-- PROD tiene firmas de 21 (base+storage) y 22 (base+storage+partida_unsure); se
-- eliminan ambas y se recrean con p_distributions al final (22 y 23 args).

drop function if exists public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean,
  uuid, uuid, numeric, numeric, numeric, text, uuid, text, text
);
drop function if exists public.create_payment_request_with_document(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean,
  uuid, uuid, numeric, numeric, numeric, text, uuid, text, text, boolean
);

-- Wrapper interno: valida el documento, crea la solicitud (con reparto) y enlaza
-- el comprobante en la misma transacción.
create or replace function public.create_payment_request_with_document(
  p_proveedor_id uuid, p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid,
  p_budget_month date, p_amount_requested numeric, p_currency text default 'MXN'::text,
  p_exchange_rate numeric default 1, p_description text default null::text, p_notes text default null::text,
  p_requested_by uuid default null::uuid, p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null::uuid, p_approver_assignment_id uuid default null::uuid,
  p_subtotal_amount numeric default null::numeric, p_tax_amount numeric default null::numeric,
  p_withholding_amount numeric default null::numeric, p_invoice_uuid text default null::text,
  p_beneficiary_profile_id uuid default null::uuid, p_request_type text default null::text,
  p_invoice_storage_path text default null::text, p_distributions jsonb default null::jsonb
)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'storage', 'pg_temp'
as $function$
declare
  v_profile_id uuid := public.current_profile_id();
  v_result jsonb;
  v_request_id uuid;
  v_storage_path text := nullif(btrim(p_invoice_storage_path), '');
begin
  if v_profile_id is null then raise exception 'not_authenticated'; end if;
  if lower(coalesce(nullif(btrim(p_request_type), ''), 'provider_payment')) = 'reimbursement' then
    raise exception 'request_document_wrapper_not_for_reimbursement';
  end if;
  if v_storage_path is null then raise exception 'request_document_required'; end if;
  if v_storage_path !~* '^solicitudes/drafts/[0-9a-f-]{36}/[^/]+\.(jpg|jpeg|png|webp|pdf|xml)$'
     or split_part(v_storage_path, '/', 3) <> v_profile_id::text then
    raise exception 'request_document_path_invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'payment-receipts'
      and object.name = v_storage_path and object.owner = auth.uid()
  ) then
    raise exception 'request_document_not_found_or_not_owned';
  end if;

  v_result := public.create_payment_request(
    p_proveedor_id => p_proveedor_id,
    p_company_id => p_company_id,
    p_cost_center_id => p_cost_center_id,
    p_budget_category_id => p_budget_category_id,
    p_budget_month => p_budget_month,
    p_amount_requested => p_amount_requested,
    p_currency => p_currency,
    p_exchange_rate => p_exchange_rate,
    p_description => p_description,
    p_notes => p_notes,
    p_requested_by => p_requested_by,
    p_is_extraordinary_adjustment => p_is_extraordinary_adjustment,
    p_approver_id => p_approver_id,
    p_approver_assignment_id => p_approver_assignment_id,
    p_subtotal_amount => p_subtotal_amount,
    p_tax_amount => p_tax_amount,
    p_withholding_amount => p_withholding_amount,
    p_invoice_uuid => p_invoice_uuid,
    p_beneficiary_profile_id => p_beneficiary_profile_id,
    p_request_type => p_request_type,
    p_distributions => p_distributions
  );

  v_request_id := coalesce(
    nullif(v_result ->> 'payment_request_id', '')::uuid,
    nullif(v_result ->> 'id', '')::uuid);
  if v_request_id is null then raise exception 'request_document_payment_request_id_missing'; end if;

  update public.payment_requests
     set invoice_storage_path = v_storage_path, updated_at = now()
   where id = v_request_id and requested_by = v_profile_id;
  if not found then raise exception 'request_document_link_failed'; end if;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('invoice_storage_path', v_storage_path);
end;
$function$;

-- Wrapper externo: añade partida_unsure (y propaga el reparto al interno).
create or replace function public.create_payment_request_with_document(
  p_proveedor_id uuid, p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid,
  p_budget_month date, p_amount_requested numeric, p_currency text, p_exchange_rate numeric,
  p_description text, p_notes text, p_requested_by uuid, p_is_extraordinary_adjustment boolean,
  p_approver_id uuid, p_approver_assignment_id uuid, p_subtotal_amount numeric, p_tax_amount numeric,
  p_withholding_amount numeric, p_invoice_uuid text, p_beneficiary_profile_id uuid, p_request_type text,
  p_invoice_storage_path text, p_partida_unsure boolean, p_distributions jsonb default null::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_result jsonb;
  v_request_id uuid;
begin
  v_result := public.create_payment_request_with_document(
    p_proveedor_id => p_proveedor_id,
    p_company_id => p_company_id,
    p_cost_center_id => p_cost_center_id,
    p_budget_category_id => p_budget_category_id,
    p_budget_month => p_budget_month,
    p_amount_requested => p_amount_requested,
    p_currency => p_currency,
    p_exchange_rate => p_exchange_rate,
    p_description => p_description,
    p_notes => p_notes,
    p_requested_by => p_requested_by,
    p_is_extraordinary_adjustment => p_is_extraordinary_adjustment,
    p_approver_id => p_approver_id,
    p_approver_assignment_id => p_approver_assignment_id,
    p_subtotal_amount => p_subtotal_amount,
    p_tax_amount => p_tax_amount,
    p_withholding_amount => p_withholding_amount,
    p_invoice_uuid => p_invoice_uuid,
    p_beneficiary_profile_id => p_beneficiary_profile_id,
    p_request_type => p_request_type,
    p_invoice_storage_path => p_invoice_storage_path,
    p_distributions => p_distributions
  );

  v_request_id := coalesce(
    nullif(v_result ->> 'payment_request_id', '')::uuid,
    nullif(v_result ->> 'id', '')::uuid);
  if v_request_id is null then raise exception 'partida_unsure_document_request_id_missing'; end if;

  update public.payment_requests
     set partida_unsure = coalesce(p_partida_unsure, false), updated_at = now()
   where id = v_request_id;
  if not found then raise exception 'partida_unsure_document_link_failed'; end if;

  return coalesce(v_result, '{}'::jsonb)
    || jsonb_build_object('partida_unsure', coalesce(p_partida_unsure, false));
end;
$function$;

commit;
