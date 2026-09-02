-- Reembolsos, lado servidor. Sin esto el flujo no existe: create_payment_request
-- aborta con 'proveedor_id es obligatorio' y el validador de layout exige
-- proveedor + sus datos bancarios. Aquí el beneficiario empleado se vuelve un
-- destinatario de primera clase.

-- 1) create_payment_request: acepta beneficiario y tipo -----------------------
-- El proveedor deja de ser obligatorio SOLO en reembolsos (donde el
-- destinatario es una persona). El beneficiario se persiste en la MISMA
-- transacción que la solicitud: antes el cliente lo escribía con un UPDATE
-- posterior, así que una solicitud podía quedar sin destinatario si ese
-- segundo viaje fallaba.
drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid, uuid, numeric, numeric, numeric, text
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
  p_invoice_uuid text default null,
  p_beneficiary_profile_id uuid default null,
  p_request_type text default null
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
  v_request_type public.payment_request_type;
  v_is_reimbursement boolean;
begin
  if v_current_profile_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Tipo de solicitud: si no viene, se conserva el default histórico.
  v_request_type := coalesce(
    nullif(btrim(coalesce(p_request_type, '')), '')::public.payment_request_type,
    'provider_payment'::public.payment_request_type
  );
  -- Un beneficiario explícito también marca la solicitud como reembolso: el
  -- cliente viejo no manda p_request_type y no queremos dos fuentes de verdad.
  v_is_reimbursement := v_request_type = 'reimbursement'::public.payment_request_type
    or p_beneficiary_profile_id is not null;
  if v_is_reimbursement then
    v_request_type := 'reimbursement'::public.payment_request_type;
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

  -- Destinatario del dinero: proveedor (normal) o empleado (reembolso).
  if v_is_reimbursement then
    if p_beneficiary_profile_id is null then
      raise exception 'beneficiary_profile_id_required';
    end if;
    if not exists (
      select 1 from public.profiles
      where id = p_beneficiary_profile_id and coalesce(active, true)
    ) then
      raise exception 'beneficiary_not_found_or_inactive';
    end if;
    -- Un reembolso puede referenciar al comercio como proveedor informativo,
    -- pero nunca es el destinatario; si viene, al menos debe existir.
    if p_proveedor_id is not null
       and not exists (select 1 from public.proveedores where id = p_proveedor_id) then
      raise exception 'El proveedor indicado no existe en public.proveedores';
    end if;
  else
    if p_proveedor_id is null then
      raise exception 'proveedor_id es obligatorio';
    end if;
    if not exists (select 1 from public.proveedores where id = p_proveedor_id) then
      raise exception 'El proveedor indicado no existe en public.proveedores';
    end if;
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
    provider_id, proveedor_id, beneficiary_profile_id,
    company_id, cost_center_id, budget_category_id,
    budget_month, request_type, requested_by, approver_id, approver_assignment_id,
    approver_selection_source,
    amount_requested, currency, exchange_rate, requires_invoice, invoice_received,
    subtotal_amount, tax_amount, withholding_amount, invoice_uuid,
    status, concept, description, notes, submitted_at, request_number,
    budget_decision, budget_block_reason, budget_available_before,
    budget_available_after, budget_shortfall, budget_checked_at, budget_result,
    is_extraordinary_adjustment, created_at, updated_at
  ) values (
    null, p_proveedor_id, p_beneficiary_profile_id,
    p_company_id, p_cost_center_id, p_budget_category_id,
    v_budget_month, v_request_type, v_requester_id,
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
    'request_type', v_request_type,
    'beneficiary_profile_id', p_beneficiary_profile_id,
    'budget_decision', v_budget_decision,
    'budget_block_reason', v_budget_block_reason,
    'budget_result', v_budget_result,
    'approver_id', p_approver_id,
    'approver_assignment_id', p_approver_assignment_id,
    'approver_source', case when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end
  );
end;
$function$;

-- 2) Validador de layout: en reembolso se valida al EMPLEADO ------------------
-- Antes exigía proveedor y sus datos bancarios siempre, así que un reembolso
-- nunca podía completar su línea. Ahora la rama de reembolso valida contra
-- employee_bank_accounts (que es de donde saldrá la CLABE de la dispersión).
create or replace function public.payment_request_layout_missing_fields(p_request payment_requests)
 returns text[]
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_company public.companies%rowtype;
  v_company_found boolean := false;
  v_company_account public.company_bank_accounts%rowtype;
  v_company_account_found boolean := false;
  v_provider public.proveedores%rowtype;
  v_provider_found boolean := false;
  v_is_reimbursement boolean := p_request.request_type = 'reimbursement'::public.payment_request_type;
  v_beneficiary public.employee_bank_accounts%rowtype;
  v_beneficiary_found boolean := false;
  v_clabe text;
  v_cuenta text;
  v_source_normalized text;
  v_payment_concept text := coalesce(
    nullif(btrim(p_request.payment_concept), ''),
    nullif(btrim(p_request.concept), ''),
    nullif(btrim(p_request.description), '')
  );
  v_missing text[];
begin
  if p_request.company_id is not null then
    select * into v_company from public.companies company where company.id = p_request.company_id;
    v_company_found := found;
  end if;

  if p_request.company_bank_account_id is not null then
    select * into v_company_account from public.company_bank_accounts company_account
    where company_account.id = p_request.company_bank_account_id;
    v_company_account_found := found;
  end if;

  if p_request.proveedor_id is not null then
    select * into v_provider from public.proveedores provider where provider.id = p_request.proveedor_id;
    v_provider_found := found;
  end if;

  if v_is_reimbursement and p_request.beneficiary_profile_id is not null then
    select * into v_beneficiary from public.employee_bank_accounts eba
    where eba.profile_id = p_request.beneficiary_profile_id;
    v_beneficiary_found := found;
  end if;

  v_clabe := regexp_replace(coalesce(v_beneficiary.clabe, ''), '[[:space:]-]', '', 'g');
  v_cuenta := regexp_replace(coalesce(v_beneficiary.cuenta, ''), '[[:space:]-]', '', 'g');

  v_source_normalized := regexp_replace(
    coalesce(v_company_account.account_number, ''), '[[:space:]-]', '', 'g'
  );

  v_missing := array_remove(array[
    case when p_request.scheduled_payment_date is null then 'scheduled_payment_date' end,
    case when p_request.company_id is null then 'company_id' end,
    case when p_request.company_id is not null and not v_company_found then 'company_not_found' end,
    case when v_company_found and not coalesce(v_company.active, false) then 'company_inactive' end,
    case
      when v_company_found
        and coalesce(nullif(btrim(v_company.legal_name), ''), nullif(btrim(v_company.name), '')) is null
        then 'company_name'
    end,
    case when p_request.company_bank_account_id is null then 'company_bank_account_id' end,
    case
      when p_request.company_bank_account_id is not null and not v_company_account_found
        then 'company_bank_account_id_not_found'
    end,
    case
      when v_company_account_found and v_company_account.company_id is distinct from p_request.company_id
        then 'company_bank_account_company_mismatch'
    end,
    case
      when v_company_account_found and not coalesce(v_company_account.active, false)
        then 'company_bank_account_inactive'
    end,
    case
      when v_company_account_found and nullif(btrim(v_company_account.account_number), '') is null
        then 'source_account_number'
    end,
    case
      when v_company_account_found
        and nullif(btrim(v_company_account.account_number), '') is not null
        and v_source_normalized !~ '^[0-9]{1,18}$'
        then 'source_account_number_invalid'
    end,
    -- Destinatario: proveedor en el flujo normal, empleado en reembolso.
    case when not v_is_reimbursement and p_request.proveedor_id is null then 'proveedor_id' end,
    case
      when p_request.proveedor_id is not null and not v_provider_found then 'proveedor_not_found'
    end,
    case
      when not v_is_reimbursement and v_provider_found and not coalesce(v_provider.activo, false)
        then 'proveedor_inactive'
    end,
    case when v_is_reimbursement and p_request.beneficiary_profile_id is null then 'beneficiary_profile_id' end,
    case
      when v_is_reimbursement and p_request.beneficiary_profile_id is not null and not v_beneficiary_found
        then 'beneficiary_bank_account_missing'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and nullif(btrim(v_beneficiary.beneficiary_name), '') is null
        then 'beneficiary_name'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found and nullif(btrim(v_beneficiary.banco), '') is null
        then 'beneficiary_bank'
    end,
    case
      when v_is_reimbursement and v_beneficiary_found
        and v_clabe = '' and v_cuenta = ''
        then 'beneficiary_destination'
    end,
    case
      when v_is_reimbursement and v_clabe <> '' and v_clabe !~ '^[0-9]{18}$'
        then 'beneficiary_clabe_invalid'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is null then 'payment_reference'
    end,
    case
      when nullif(btrim(p_request.payment_reference), '') is not null
        and btrim(p_request.payment_reference) !~ '^[0-9]{1,5}$'
        then 'payment_reference_invalid'
    end,
    case when v_payment_concept is null then 'payment_concept' end,
    case
      when v_payment_concept is not null
        and (char_length(v_payment_concept) > 120 or v_payment_concept ~ '[[:cntrl:]]')
        then 'payment_concept_invalid'
    end,
    case
      when coalesce(nullif(upper(btrim(p_request.currency)), ''), 'MXN') <> 'MXN'
        then 'unsupported_layout_currency'
    end,
    case when coalesce(p_request.amount_requested, 0) <= 0 then 'invalid_amount' end
  ]::text[], null);

  -- Los requisitos bancarios del proveedor solo aplican cuando ÉL cobra.
  if v_provider_found and not v_is_reimbursement then
    v_missing := v_missing || public.provider_payment_execution_missing_fields(v_provider);
  end if;

  select coalesce(
    array_agg(distinct missing_field.field_name order by missing_field.field_name),
    array[]::text[]
  ) into v_missing
  from unnest(v_missing) as missing_field(field_name);

  return v_missing;
end
$function$;
