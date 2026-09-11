-- Capture CIE data with the request, preserving existing approval, budget,
-- document ownership and tenant RLS. No historical requests are rewritten.
create or replace function private.convenio_request_data_error(
  p_provider public.proveedores, p_reference text, p_concept text,
  p_method text, p_currency text, p_beneficiary uuid
)
returns text language sql stable security invoker set search_path = '' as $function$
  select case
    when p_provider.id is null or not coalesce(p_provider.activo, false)
      or p_provider.destination_type is distinct from 'convenio'
      or coalesce(btrim(p_provider.convenio_number), '') !~ '^[0-9]{6,7}$'
      then 'convenio_provider_required'
    when p_method is distinct from 'transfer' then 'convenio_transfer_required'
    when p_currency is distinct from 'MXN' then 'convenio_mxn_required'
    when p_beneficiary is not null then 'convenio_provider_required'
    when private.cie_reference_error(p_reference, p_provider.convenio_number) is not null
      then private.cie_reference_error(p_reference, p_provider.convenio_number)
    when nullif(btrim(p_concept), '') is null then 'cie_concept_required'
    when char_length(btrim(p_concept)) > 30 then 'cie_concept_too_long'
    when btrim(p_concept) !~ '^[ -~]+$' or position('|' in p_concept) > 0
      then 'cie_concept_invalid'
    else null
  end;
$function$;
revoke all on function private.convenio_request_data_error(public.proveedores,text,text,text,text,uuid) from public, anon;
grant execute on function private.convenio_request_data_error(public.proveedores,text,text,text,text,uuid) to authenticated, service_role;

-- A deferred constraint checks the final row, after the existing creator has
-- inserted it and this RPC has saved its bank fields in the SAME transaction.
-- It also prevents incomplete requests through older RPCs or direct writes.
create or replace function private.validate_convenio_request()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare
  v_request public.payment_requests%rowtype;
  v_provider public.proveedores%rowtype;
  v_error text;
begin
  select * into v_request from public.payment_requests where id = new.id;
  if not found or v_request.request_type::text <> 'convenio' then return null; end if;
  select * into v_provider from public.proveedores where id = v_request.proveedor_id;
  v_error := private.convenio_request_data_error(v_provider, v_request.payment_reference,
    v_request.payment_concept, v_request.payment_method, v_request.currency, v_request.beneficiary_profile_id);
  if v_error is not null then raise exception using message = v_error; end if;
  return null;
end;
$function$;
revoke all on function private.validate_convenio_request() from public, anon, authenticated;
create constraint trigger validate_convenio_request
after insert or update on public.payment_requests
deferrable initially deferred for each row
when (new.request_type::text = 'convenio')
execute function private.validate_convenio_request();

-- Editing a request must not silently leave an already generated bank file
-- with different payment instructions. Existing line correction is separate.
create or replace function private.guard_convenio_request_bank_edit()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if old.request_type::text = 'convenio'
    and row(new.request_type,new.company_id,new.proveedor_id,new.amount_requested,new.currency,
      new.payment_method,new.payment_reference,new.payment_concept)
      is distinct from row(old.request_type,old.company_id,old.proveedor_id,old.amount_requested,old.currency,
      old.payment_method,old.payment_reference,old.payment_concept)
    and (old.status::text in ('paid','cancelled','rejected') or exists (
      select 1 from public.payment_layout_lines l where l.payment_request_id = old.id
        and l.status::text in ('included','paid')
    )) then raise exception 'convenio_request_locked'; end if;
  return new;
end;
$function$;
revoke all on function private.guard_convenio_request_bank_edit() from public, anon, authenticated;
create trigger guard_convenio_request_bank_edit
before update on public.payment_requests for each row
when (old.request_type::text = 'convenio')
execute function private.guard_convenio_request_bank_edit();

-- SECURITY INVOKER: the existing creator and table policies retain ownership
-- and company checks. Whitelist every payload field; clients cannot supply a
-- status, source bank account, approval decision or arbitrary table columns.
create or replace function public.create_convenio_payment_request(
  p_request jsonb, p_invoice_storage_path text default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $function$
declare
  v_actor uuid := public.current_profile_id();
  v_provider public.proveedores%rowtype;
  v_reference text := btrim(p_request ->> 'payment_reference');
  v_concept text := btrim(p_request ->> 'payment_concept');
  v_error text;
  v_result jsonb;
  v_id uuid;
begin
  if auth.uid() is null or v_actor is null then raise exception 'not_authenticated'; end if;
  if not coalesce(private.current_profile_has_company_role((p_request ->> 'company_id')::uuid, public.flux_member_roles()), false) then
    raise exception 'convenio_company_not_authorized';
  end if;
  if p_request ->> 'request_type' is distinct from 'convenio' then raise exception 'convenio_request_type_required'; end if;
  if (p_request ->> 'requested_by')::uuid is distinct from v_actor then raise exception 'requested_by_must_match_current_profile'; end if;
  select * into v_provider from public.proveedores where id = (p_request ->> 'proveedor_id')::uuid;
  v_error := private.convenio_request_data_error(v_provider, v_reference, v_concept,
    p_request ->> 'payment_method', p_request ->> 'currency', (p_request ->> 'beneficiary_profile_id')::uuid);
  if v_error is not null then raise exception using message = v_error; end if;
  if btrim(p_request ->> 'convenio_number') is distinct from btrim(v_provider.convenio_number) then
    raise exception 'convenio_provider_changed';
  end if;

  if nullif(btrim(p_invoice_storage_path), '') is not null then
    v_result := public.create_payment_request_with_document(
      p_proveedor_id => v_provider.id,
      p_company_id => (p_request ->> 'company_id')::uuid,
      p_cost_center_id => (p_request ->> 'cost_center_id')::uuid,
      p_budget_category_id => (p_request ->> 'budget_category_id')::uuid,
      p_budget_month => (p_request ->> 'budget_month')::date,
      p_amount_requested => (p_request ->> 'amount_requested')::numeric,
      p_currency => 'MXN', p_exchange_rate => 1,
      p_description => p_request ->> 'description', p_notes => p_request ->> 'notes',
      p_requested_by => v_actor,
      p_is_extraordinary_adjustment => coalesce((p_request ->> 'is_extraordinary_adjustment')::boolean, false),
      p_approver_id => (p_request ->> 'approver_id')::uuid,
      p_approver_assignment_id => (p_request ->> 'approver_assignment_id')::uuid,
      p_subtotal_amount => (p_request ->> 'subtotal_amount')::numeric,
      p_tax_amount => (p_request ->> 'tax_amount')::numeric,
      p_withholding_amount => (p_request ->> 'withholding_amount')::numeric,
      p_invoice_uuid => p_request ->> 'invoice_uuid',
      p_beneficiary_profile_id => null, p_request_type => 'convenio',
      p_invoice_storage_path => p_invoice_storage_path,
      p_partida_unsure => coalesce((p_request ->> 'partida_unsure')::boolean, false)
    );
  else
    v_result := public.create_payment_request(
      p_proveedor_id => v_provider.id,
      p_company_id => (p_request ->> 'company_id')::uuid,
      p_cost_center_id => (p_request ->> 'cost_center_id')::uuid,
      p_budget_category_id => (p_request ->> 'budget_category_id')::uuid,
      p_budget_month => (p_request ->> 'budget_month')::date,
      p_amount_requested => (p_request ->> 'amount_requested')::numeric,
      p_currency => 'MXN', p_exchange_rate => 1,
      p_description => p_request ->> 'description', p_notes => p_request ->> 'notes',
      p_requested_by => v_actor,
      p_is_extraordinary_adjustment => coalesce((p_request ->> 'is_extraordinary_adjustment')::boolean, false),
      p_approver_id => (p_request ->> 'approver_id')::uuid,
      p_approver_assignment_id => (p_request ->> 'approver_assignment_id')::uuid,
      p_subtotal_amount => (p_request ->> 'subtotal_amount')::numeric,
      p_tax_amount => (p_request ->> 'tax_amount')::numeric,
      p_withholding_amount => (p_request ->> 'withholding_amount')::numeric,
      p_invoice_uuid => p_request ->> 'invoice_uuid',
      p_beneficiary_profile_id => null, p_request_type => 'convenio',
      p_partida_unsure => coalesce((p_request ->> 'partida_unsure')::boolean, false)
    );
  end if;
  v_id := (v_result ->> 'payment_request_id')::uuid;
  update public.payment_requests
     set payment_reference = v_reference, payment_concept = v_concept,
         payment_method = 'transfer', updated_at = now()
   where id = v_id and requested_by = v_actor
     and company_id = (p_request ->> 'company_id')::uuid
     and request_type::text = 'convenio';
  if not found then raise exception 'convenio_request_save_failed'; end if;
  return v_result || jsonb_build_object('payment_reference', v_reference, 'payment_concept', v_concept,
    'payment_method', 'transfer', 'convenio_number', v_provider.convenio_number);
end;
$function$;
revoke all on function public.create_convenio_payment_request(jsonb,text) from public, anon;
grant execute on function public.create_convenio_payment_request(jsonb,text) to authenticated;
notify pgrst, 'reload schema';
