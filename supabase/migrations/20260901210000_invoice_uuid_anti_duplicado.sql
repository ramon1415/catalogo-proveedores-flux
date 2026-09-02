-- UUID del CFDI (folio fiscal) en la solicitud + candado anti doble pago:
-- la misma factura no puede presentarse dos veces en la misma empresa
-- mientras la solicitud original siga viva (rechazadas/canceladas liberan
-- el UUID para reingreso).
alter table public.payment_requests
  add column if not exists invoice_uuid text;

comment on column public.payment_requests.invoice_uuid is
  'Folio fiscal (UUID del TimbreFiscalDigital del CFDI). Candado anti doble pago por empresa.';

create unique index if not exists payment_requests_invoice_uuid_unique
  on public.payment_requests (company_id, upper(invoice_uuid))
  where invoice_uuid is not null
    and status not in ('rejected', 'cancelled');

-- create_payment_request: acepta p_invoice_uuid y valida el duplicado ANTES
-- del insert para devolver un código operable (el índice queda de respaldo
-- contra carreras). Se agrega el parámetro con default null: los callers
-- existentes (vanilla y React sin XML) siguen funcionando sin cambios.
-- La firma de 17 params se dropea explícitamente para no dejar un overload
-- ambiguo en PostgREST.
drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid, uuid, numeric, numeric, numeric
);

create or replace function public.create_payment_request(
  p_proveedor_id uuid,
  p_company_id uuid,
  p_cost_center_id uuid,
  p_budget_category_id uuid,
  p_budget_month date,
  p_amount_requested numeric,
  p_currency text default 'MXN'::text,
  p_exchange_rate numeric default 1,
  p_description text default null::text,
  p_notes text default null::text,
  p_requested_by uuid default null::uuid,
  p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null::uuid,
  p_approver_assignment_id uuid default null::uuid,
  p_subtotal_amount numeric default null,
  p_tax_amount numeric default null,
  p_withholding_amount numeric default null,
  p_invoice_uuid text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current_profile_id uuid := public.current_profile_id();
  v_requester_id uuid;
  v_assignment public.approver_assignments%rowtype;
  v_has_pool boolean;
  v_budget_month date;
  v_currency text;
  v_exchange_rate numeric;
  v_budget_amount numeric;
  v_budget_result jsonb;
  v_budget_decision text;
  v_budget_block_reason text;
  v_available_before numeric;
  v_available_after numeric;
  v_shortfall numeric;
  v_request_number text;
  v_payment_request_id uuid;
  v_year integer;
  v_concept text;
  v_invoice_uuid text;
begin
  if v_current_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  v_requester_id := coalesce(p_requested_by, v_current_profile_id);
  if v_requester_id <> v_current_profile_id
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'requested_by_must_match_current_profile';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_requester_id and coalesce(active, true)
  ) then
    raise exception 'requested_by_not_found_or_inactive';
  end if;

  if p_proveedor_id is null then
    raise exception 'proveedor_id es obligatorio';
  end if;
  if not exists (select 1 from public.proveedores where id = p_proveedor_id) then
    raise exception 'El proveedor indicado no existe en public.proveedores';
  end if;
  if p_company_id is null or not exists (
    select 1 from public.companies where id = p_company_id and coalesce(active, true)
  ) then
    raise exception 'La empresa indicada no existe';
  end if;
  if not public.has_active_company_membership(v_requester_id, p_company_id) then
    raise exception 'requester_company_membership_required';
  end if;
  if p_cost_center_id is null or not exists (
    select 1 from public.cost_centers where id = p_cost_center_id
  ) then
    raise exception 'El centro de costo indicado no existe';
  end if;
  if p_budget_category_id is null or not exists (
    select 1 from public.budget_categories where id = p_budget_category_id
  ) then
    raise exception 'La partida presupuestal indicada no existe';
  end if;
  if p_budget_month is null then
    raise exception 'budget_month es obligatorio';
  end if;
  if p_amount_requested is null or p_amount_requested <= 0 then
    raise exception 'amount_requested debe ser mayor a 0';
  end if;
  if p_approver_id is null then
    raise exception 'approver_id_required';
  end if;
  if p_approver_id = v_requester_id then
    raise exception 'requester_cannot_be_own_approver';
  end if;

  -- Desglose fiscal: si viene, debe ser coherente con el total.
  if p_subtotal_amount is not null then
    if p_subtotal_amount <= 0 then
      raise exception 'fiscal_subtotal_invalid';
    end if;
    if coalesce(p_tax_amount, 0) < 0 or coalesce(p_withholding_amount, 0) < 0 then
      raise exception 'fiscal_breakdown_invalid';
    end if;
    if abs((p_subtotal_amount + coalesce(p_tax_amount, 0) - coalesce(p_withholding_amount, 0)) - p_amount_requested) > 0.01 then
      raise exception 'fiscal_breakdown_mismatch';
    end if;
  elsif p_tax_amount is not null or p_withholding_amount is not null then
    raise exception 'fiscal_subtotal_required';
  end if;

  -- Anti doble pago: el folio fiscal no puede repetirse en una solicitud viva.
  v_invoice_uuid := nullif(upper(trim(coalesce(p_invoice_uuid, ''))), '');
  if v_invoice_uuid is not null then
    if v_invoice_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then
      raise exception 'invoice_uuid_invalid';
    end if;
    if exists (
      select 1 from public.payment_requests pr
      where pr.company_id = p_company_id
        and upper(pr.invoice_uuid) = v_invoice_uuid
        and pr.status not in ('rejected', 'cancelled')
    ) then
      raise exception 'invoice_uuid_duplicate';
    end if;
  end if;

  v_has_pool := public.payment_request_has_active_approver_pool(v_requester_id, p_company_id);
  if v_has_pool then
    if p_approver_assignment_id is null then
      raise exception 'approver_assignment_id_required';
    end if;

    select * into v_assignment
    from public.approver_assignments aa
    where aa.id = p_approver_assignment_id
      and aa.company_id = p_company_id
      and aa.requester_id = v_requester_id
      and aa.approver_id = p_approver_id
      and aa.active;
    if not found then
      raise exception 'approver_not_in_configured_pool';
    end if;
    if not public.is_payment_request_approver_for_company(p_approver_id, p_company_id) then
      raise exception 'configured_approver_no_longer_eligible';
    end if;
  else
    if p_approver_assignment_id is not null then
      raise exception 'approver_assignment_not_allowed_without_pool';
    end if;
    if not public.payment_request_rule_allows(
      p_approver_id, p_company_id, p_cost_center_id, p_amount_requested, 'approved'
    ) then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
  end if;

  v_currency := upper(coalesce(nullif(trim(p_currency), ''), 'MXN'));
  v_exchange_rate := coalesce(p_exchange_rate, 1);
  if v_exchange_rate <= 0 then
    raise exception 'exchange_rate debe ser mayor a 0';
  end if;

  v_budget_month := date_trunc('month', p_budget_month)::date;
  v_budget_amount := round(coalesce(p_subtotal_amount, p_amount_requested) * v_exchange_rate, 2);
  v_year := extract(year from v_budget_month)::integer;
  v_concept := coalesce(nullif(trim(p_description), ''), 'Solicitud de pago');

  v_budget_result := public.verify_budget_availability(
    p_company_id,
    p_cost_center_id,
    p_budget_category_id,
    v_budget_month,
    v_budget_amount,
    coalesce(p_is_extraordinary_adjustment, false)
  );
  v_budget_decision := coalesce(v_budget_result ->> 'status', 'bloqueado');
  if v_budget_decision not in ('aprobable', 'bloqueado') then
    v_budget_decision := 'bloqueado';
  end if;
  v_budget_block_reason := v_budget_result ->> 'motivo';
  v_available_before := nullif(v_budget_result ->> 'disponible_actual', '')::numeric;
  v_available_after := nullif(v_budget_result ->> 'disponible_despues', '')::numeric;
  v_shortfall := nullif(v_budget_result ->> 'faltante', '')::numeric;
  v_request_number := public.generate_payment_request_number(v_year);

  insert into public.payment_requests (
    provider_id, proveedor_id, company_id, cost_center_id, budget_category_id,
    budget_month, request_type, requested_by, approver_id, approver_assignment_id,
    approver_selection_source,
    amount_requested, currency, exchange_rate, requires_invoice, invoice_received,
    subtotal_amount, tax_amount, withholding_amount, invoice_uuid,
    status, concept, description, notes, submitted_at, request_number,
    budget_decision, budget_block_reason, budget_available_before,
    budget_available_after, budget_shortfall, budget_checked_at, budget_result,
    is_extraordinary_adjustment, created_at, updated_at
  ) values (
    null, p_proveedor_id, p_company_id, p_cost_center_id, p_budget_category_id,
    v_budget_month, 'provider_payment'::payment_request_type, v_requester_id,
    p_approver_id, p_approver_assignment_id,
    case when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
    p_amount_requested, v_currency,
    v_exchange_rate, false, false,
    p_subtotal_amount, p_tax_amount, p_withholding_amount, v_invoice_uuid,
    'submitted'::payment_request_status,
    v_concept, p_description, p_notes, now(), v_request_number,
    v_budget_decision, v_budget_block_reason, v_available_before,
    v_available_after, v_shortfall, now(), v_budget_result,
    coalesce(p_is_extraordinary_adjustment, false), now(), now()
  ) returning id into v_payment_request_id;

  return jsonb_build_object(
    'payment_request_id', v_payment_request_id,
    'request_number', v_request_number,
    'status', 'submitted',
    'budget_decision', v_budget_decision,
    'budget_block_reason', v_budget_block_reason,
    'budget_result', v_budget_result,
    'approver_id', p_approver_id,
    'approver_assignment_id', p_approver_assignment_id,
    'approver_source', case when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end
  );
end;
$function$;
