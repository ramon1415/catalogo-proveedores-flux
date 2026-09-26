begin;

-- Forward fix for the already-applied multipartida hardening.
-- Keep payroll obligation settings private; authorize before checking eligibility.
create or replace function private.lock_and_check_obligation_budget(
  p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid,
  p_budget_month date, p_amount numeric
) returns void
language plpgsql security definer
set search_path to ''
as $function$
declare v_avail numeric; v_prof uuid := public.current_profile_id();
begin
  -- Autorización por empresa (defensa en profundidad; el RPC ya validó membresía).
  if v_prof is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_company_membership(v_prof, p_company_id)
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'company_authorization_required';
  end if;
  -- Esta configuración es privada: authenticated no tiene SELECT. Resolver
  -- también la elegibilidad aquí, después de autorizar, nunca en el RPC invoker.
  if not exists (
    select 1 from public.payroll_obligation_settings s
    where s.company_id = p_company_id
      and s.budget_category_id = p_budget_category_id and s.enabled
  ) then
    return;
  end if;
  -- Lock REAL de la(s) budget_line(s) de la partida (definer => sin RLS).
  perform 1 from public.budget_lines bl
    join public.budget_versions bv on bv.id = bl.budget_version_id and bv.active
   where bl.company_id = p_company_id and bl.cost_center_id = p_cost_center_id
     and bl.budget_category_id = p_budget_category_id and bl.budget_month = p_budget_month
   order by bl.id for update of bl;
  if not found then raise exception 'OBLIGATION_BUDGET_LINE_REQUIRED'; end if;
  -- Revalida disponibilidad bajo el lock (la solicitud aún no se insertó).
  select b.available into v_avail from public.budget_availability b
   where b.company_id = p_company_id and b.cost_center_id = p_cost_center_id
     and b.budget_category_id = p_budget_category_id and b.budget_month = p_budget_month;
  if v_avail is null or v_avail < p_amount then
    raise exception using errcode = '40001',
      message = 'El presupuesto cambió por otra solicitud. Actualiza y vuelve a revisar el monto.';
  end if;
end;
$function$;

create or replace function public.create_payment_request(
  p_proveedor_id uuid, p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid,
  p_budget_month date, p_amount_requested numeric, p_currency text default 'MXN'::text,
  p_exchange_rate numeric default 1, p_description text default null::text, p_notes text default null::text,
  p_requested_by uuid default null::uuid, p_is_extraordinary_adjustment boolean default false,
  p_approver_id uuid default null::uuid, p_approver_assignment_id uuid default null::uuid,
  p_subtotal_amount numeric default null::numeric, p_tax_amount numeric default null::numeric,
  p_withholding_amount numeric default null::numeric, p_invoice_uuid text default null::text,
  p_beneficiary_profile_id uuid default null::uuid, p_request_type text default null::text,
  p_partida_unsure boolean default false, p_distributions jsonb default null::jsonb
)
returns jsonb language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current_profile_id uuid := public.current_profile_id();
  v_requester_id uuid; v_assignment public.approver_assignments%rowtype; v_has_pool boolean;
  v_budget_month date; v_currency text; v_exchange_rate numeric; v_budget_amount numeric;
  v_budget_result jsonb; v_budget_decision text; v_budget_block_reason text;
  v_available_before numeric; v_available_after numeric; v_shortfall numeric;
  v_request_number text; v_payment_request_id uuid; v_year integer; v_concept text;
  v_invoice_uuid text; v_request_type public.payment_request_type; v_is_reimbursement boolean;
  v_sin_partida boolean := false;
  v_dist_count int := 0; v_dist_elem jsonb; v_dist_cat uuid; v_dist_cc uuid; v_dist_amt numeric;
  v_dist_sum numeric := 0; v_dist_base numeric; v_line_result jsonb; v_lines_detail jsonb := '[]'::jsonb;
  v_overall text := 'aprobable'; v_seen uuid[] := array[]::uuid[];
  v_all_np boolean := true; v_line_np boolean; v_is_multi boolean := false;
begin
  if v_current_profile_id is null then raise exception 'not_authenticated'; end if;

  v_request_type := coalesce(nullif(btrim(coalesce(p_request_type, '')), '')::public.payment_request_type,
    'provider_payment'::public.payment_request_type);
  v_is_reimbursement := v_request_type = 'reimbursement'::public.payment_request_type or p_beneficiary_profile_id is not null;
  if v_is_reimbursement then v_request_type := 'reimbursement'::public.payment_request_type; end if;

  v_requester_id := coalesce(p_requested_by, v_current_profile_id);
  if v_requester_id <> v_current_profile_id and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'requested_by_must_match_current_profile';
  end if;
  if not exists (select 1 from public.profiles where id = v_requester_id and coalesce(active, true)) then
    raise exception 'requested_by_not_found_or_inactive';
  end if;

  if v_is_reimbursement then
    if p_beneficiary_profile_id is null then raise exception 'beneficiary_profile_id_required'; end if;
    if not exists (select 1 from public.profiles where id = p_beneficiary_profile_id and coalesce(active, true)) then
      raise exception 'beneficiary_not_found_or_inactive'; end if;
    if p_proveedor_id is not null and not exists (select 1 from public.proveedores where id = p_proveedor_id) then
      raise exception 'El proveedor indicado no existe en public.proveedores'; end if;
  else
    if p_proveedor_id is null then raise exception 'proveedor_id es obligatorio'; end if;
    if not exists (select 1 from public.proveedores where id = p_proveedor_id) then
      raise exception 'El proveedor indicado no existe en public.proveedores'; end if;
  end if;

  if p_company_id is null or not exists (select 1 from public.companies where id = p_company_id and coalesce(active, true)) then
    raise exception 'La empresa indicada no existe'; end if;
  if not public.has_active_company_membership(v_requester_id, p_company_id) then
    raise exception 'requester_company_membership_required'; end if;
  if p_cost_center_id is null or not exists (select 1 from public.cost_centers where id = p_cost_center_id) then
    raise exception 'El centro de costo indicado no existe'; end if;
  if p_budget_category_id is null or not exists (select 1 from public.budget_categories where id = p_budget_category_id) then
    raise exception 'La partida presupuestal indicada no existe'; end if;
  if p_budget_month is null then raise exception 'budget_month es obligatorio'; end if;
  if p_amount_requested is null or p_amount_requested <= 0 then raise exception 'amount_requested debe ser mayor a 0'; end if;

  select coalesce(code = 'SIN_PARTIDA', false) into v_sin_partida from public.budget_categories where id = p_budget_category_id;
  if v_sin_partida then
    p_approver_id := private.sin_partida_approver(p_company_id);
    p_approver_assignment_id := null;
    if nullif(btrim(p_description), '') is null then raise exception 'sin_partida_description_required'; end if;
    p_partida_unsure := false;
    p_distributions := null;
  end if;
  if p_approver_id is null then raise exception 'approver_id_required'; end if;
  if p_approver_id = v_requester_id then raise exception 'requester_cannot_be_own_approver'; end if;

  if p_subtotal_amount is not null then
    if p_subtotal_amount <= 0 then raise exception 'fiscal_subtotal_invalid'; end if;
    if coalesce(p_tax_amount, 0) < 0 or coalesce(p_withholding_amount, 0) < 0 then raise exception 'fiscal_breakdown_invalid'; end if;
    if abs((p_subtotal_amount + coalesce(p_tax_amount, 0) - coalesce(p_withholding_amount, 0)) - p_amount_requested) > 0.01 then
      raise exception 'fiscal_breakdown_mismatch'; end if;
  elsif p_tax_amount is not null or p_withholding_amount is not null then raise exception 'fiscal_subtotal_required'; end if;

  v_invoice_uuid := nullif(upper(trim(coalesce(p_invoice_uuid, ''))), '');
  if v_invoice_uuid is not null then
    if v_invoice_uuid !~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' then raise exception 'invoice_uuid_invalid'; end if;
    if exists (select 1 from public.payment_requests pr where pr.company_id = p_company_id
        and upper(pr.invoice_uuid) = v_invoice_uuid and pr.status not in ('rejected', 'cancelled')) then
      raise exception 'invoice_uuid_duplicate'; end if;
  end if;

  v_has_pool := not v_sin_partida and public.payment_request_has_active_approver_pool(v_requester_id, p_company_id);
  if v_has_pool then
    if p_approver_assignment_id is null then raise exception 'approver_assignment_id_required'; end if;
    select * into v_assignment from public.approver_assignments aa
    where aa.id = p_approver_assignment_id and aa.company_id = p_company_id and aa.requester_id = v_requester_id
      and aa.approver_id = p_approver_id and aa.active;
    if not found then raise exception 'approver_not_in_configured_pool'; end if;
    if not public.is_payment_request_approver_for_company(p_approver_id, p_company_id) then
      raise exception 'configured_approver_no_longer_eligible'; end if;
  else
    if p_approver_assignment_id is not null then raise exception 'approver_assignment_not_allowed_without_pool'; end if;
    if not public.payment_request_rule_allows(p_approver_id, p_company_id, p_cost_center_id, p_amount_requested, 'approved') then
      raise exception 'approver_not_allowed_by_approval_rules'; end if;
  end if;

  v_currency := upper(coalesce(nullif(trim(p_currency), ''), 'MXN'));
  v_exchange_rate := coalesce(p_exchange_rate, 1);
  if v_exchange_rate <= 0 then raise exception 'exchange_rate debe ser mayor a 0'; end if;
  v_budget_month := date_trunc('month', p_budget_month)::date;
  v_budget_amount := round(coalesce(p_subtotal_amount, p_amount_requested) * v_exchange_rate, 2);
  v_year := extract(year from v_budget_month)::integer;
  v_concept := coalesce(nullif(trim(p_description), ''), 'Solicitud de pago');

  v_is_multi := p_distributions is not null and jsonb_typeof(p_distributions) = 'array' and jsonb_array_length(p_distributions) > 0;

  if v_is_multi then
    v_dist_base := coalesce(p_subtotal_amount, p_amount_requested);

    -- Concurrencia (bloqueo 2): por CADA partida del reparto con obligación
    -- compartida, adquiere el lock REAL + revalida disponibilidad vía la función
    -- interna DEFINER (bajo RLS el FOR UPDATE del rol de la app bloquea 0 filas).
    -- Orden determinista por budget_category_id para evitar deadlocks. Se corre
    -- ANTES de insertar (la solicitud aún no existe => la vista no se auto-cuenta).
    for v_dist_elem in
      select je.value from jsonb_array_elements(p_distributions) je
      order by je.value->>'budget_category_id'
    loop
      perform private.lock_and_check_obligation_budget(
        p_company_id,
        coalesce(nullif(v_dist_elem->>'cost_center_id','')::uuid, p_cost_center_id),
        (v_dist_elem->>'budget_category_id')::uuid,
        v_budget_month,
        round((v_dist_elem->>'amount')::numeric * v_exchange_rate, 2)
      );
    end loop;

    for v_dist_elem in select * from jsonb_array_elements(p_distributions) loop
      v_dist_cat := nullif(v_dist_elem->>'budget_category_id', '')::uuid;
      v_dist_cc := coalesce(nullif(v_dist_elem->>'cost_center_id', '')::uuid, p_cost_center_id);
      v_dist_amt := round((v_dist_elem->>'amount')::numeric, 2);
      if v_dist_cat is null then raise exception 'distribution_category_required'; end if;
      if not exists (select 1 from public.budget_categories where id = v_dist_cat) then raise exception 'distribution_category_not_found'; end if;
      if v_dist_amt is null or v_dist_amt <= 0 then raise exception 'distribution_amount_invalid'; end if;
      if v_dist_cat = any (v_seen) then raise exception 'distribution_duplicate_category'; end if;
      if not exists (select 1 from public.cost_centers where id = v_dist_cc) then raise exception 'distribution_cost_center_not_found'; end if;
      v_seen := v_seen || v_dist_cat;
      v_dist_sum := v_dist_sum + v_dist_amt;
      v_dist_count := v_dist_count + 1;

      select coalesce(bc.no_presupuestal, false) or bc.code = 'SIN_PARTIDA' into v_line_np
      from public.budget_categories bc where bc.id = v_dist_cat;
      v_all_np := v_all_np and coalesce(v_line_np, false);

      v_line_result := public.verify_budget_availability(
        p_company_id, v_dist_cc, v_dist_cat, v_budget_month,
        round(v_dist_amt * v_exchange_rate, 2), coalesce(p_is_extraordinary_adjustment, false));
      if coalesce(v_line_result->>'status', 'bloqueado') = 'bloqueado' then v_overall := 'bloqueado'; end if;
      v_lines_detail := v_lines_detail || jsonb_build_array(jsonb_build_object(
        'budget_category_id', v_dist_cat, 'cost_center_id', v_dist_cc, 'amount', v_dist_amt, 'result', v_line_result));
    end loop;

    if abs(v_dist_sum - v_dist_base) > 0.01 then raise exception 'distribution_sum_mismatch'; end if;

    v_budget_decision := v_overall;
    v_budget_block_reason := case when v_overall = 'bloqueado' then 'sin_disponible_por_partida' else null end;
    v_budget_result := jsonb_build_object('status', v_overall, 'multipartida', true, 'no_presupuestal', v_all_np, 'lineas', v_lines_detail);
    v_available_before := null; v_available_after := null; v_shortfall := null;
  else
    v_budget_result := public.verify_budget_availability(
      p_company_id, p_cost_center_id, p_budget_category_id, v_budget_month, v_budget_amount,
      coalesce(p_is_extraordinary_adjustment, false));
    v_budget_decision := coalesce(v_budget_result ->> 'status', 'bloqueado');
    if v_budget_decision not in ('aprobable', 'bloqueado') then v_budget_decision := 'bloqueado'; end if;
    v_budget_block_reason := v_budget_result ->> 'motivo';
    v_available_before := nullif(v_budget_result ->> 'disponible_actual', '')::numeric;
    v_available_after := nullif(v_budget_result ->> 'disponible_despues', '')::numeric;
    v_shortfall := nullif(v_budget_result ->> 'faltante', '')::numeric;
  end if;

  v_request_number := public.generate_payment_request_number(v_year);

  -- multi-partida: señaliza a los triggers que respeten decision/no_presupuestal.
  if v_is_multi then perform set_config('flux.mp_active', '1', true); end if;

  insert into public.payment_requests (
    provider_id, proveedor_id, beneficiary_profile_id, company_id, cost_center_id, budget_category_id,
    budget_month, request_type, requested_by, approver_id, approver_assignment_id, approver_selection_source,
    amount_requested, currency, exchange_rate, requires_invoice, invoice_received,
    subtotal_amount, tax_amount, withholding_amount, invoice_uuid,
    status, concept, description, notes, submitted_at, request_number,
    budget_decision, budget_block_reason, budget_available_before, budget_available_after, budget_shortfall,
    budget_checked_at, budget_result, no_presupuestal, is_extraordinary_adjustment, partida_unsure, created_at, updated_at
  ) values (
    null, p_proveedor_id, p_beneficiary_profile_id, p_company_id, p_cost_center_id, p_budget_category_id,
    v_budget_month, v_request_type, v_requester_id, p_approver_id, p_approver_assignment_id,
    case when v_sin_partida then 'sin_partida' when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
    p_amount_requested, v_currency, v_exchange_rate, false, false,
    p_subtotal_amount, p_tax_amount, p_withholding_amount, v_invoice_uuid,
    'submitted'::payment_request_status, v_concept, p_description, p_notes, now(), v_request_number,
    v_budget_decision, v_budget_block_reason, v_available_before, v_available_after, v_shortfall,
    now(), v_budget_result, case when v_is_multi then v_all_np else false end,
    coalesce(p_is_extraordinary_adjustment, false), coalesce(p_partida_unsure, false), now(), now()
  ) returning id into v_payment_request_id;

  if v_is_multi then perform set_config('flux.mp_active', '', true); end if;

  if v_dist_count > 0 then
    insert into public.payment_request_distributions (payment_request_id, budget_category_id, cost_center_id, amount)
    select v_payment_request_id, nullif(elem->>'budget_category_id', '')::uuid,
      coalesce(nullif(elem->>'cost_center_id', '')::uuid, p_cost_center_id), round((elem->>'amount')::numeric, 2)
    from jsonb_array_elements(p_distributions) elem;
  end if;

  return jsonb_build_object(
    'payment_request_id', v_payment_request_id, 'request_number', v_request_number, 'status', 'submitted',
    'request_type', v_request_type, 'beneficiary_profile_id', p_beneficiary_profile_id,
    'budget_decision', v_budget_decision, 'budget_block_reason', v_budget_block_reason, 'budget_result', v_budget_result,
    'distribution_count', v_dist_count, 'approver_id', p_approver_id, 'approver_assignment_id', p_approver_assignment_id,
    'approver_source', case when v_sin_partida then 'sin_partida' when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
    'partida_unsure', coalesce(p_partida_unsure, false)
  );
end;
$function$;

commit;
