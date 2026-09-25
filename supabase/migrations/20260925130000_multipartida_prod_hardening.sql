begin;

-- MULTI-PARTIDA · endurecimiento para PROD (revisión de Ramón, PR #697).
-- Corrige 5 bloqueos detectados antes de liberar a main:
--   1. La vista podía omitir consumo de líneas presupuestales secundarias cuando
--      la partida dominante era no_presupuestal, y el trigger de snapshot
--      sobrescribía budget_decision a 'aprobable'.
--   2. El guard de presupuesto compartido con obligaciones de nómina solo
--      protegía la partida dominante, no las secundarias del reparto.
--   4. PROD tiene firmas de 20 y 21 args; se eliminan ambas (la de 22 es la única).
--   5. La función advisory omitía autorización por empresa.
-- (El bloqueo 3 —orden de migraciones— se resuelve en el paquete de release, no en SQL.)

-- ── Bloqueo 4: eliminar la firma de 20 args (PROD). Idempotente en dev. ──
drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean,
  uuid, uuid, numeric, numeric, numeric, text, uuid, text
);

-- ── Bloqueo 1a: vista distribution-aware con no_presupuestal POR LÍNEA ──
-- Una línea a partida presupuestal SIEMPRE consume su base, sin importar si la
-- partida dominante de la solicitud es no_presupuestal.
create or replace view public.budget_availability as
with consumption as (
  -- Solicitudes SIN distribución: base -> partida única (flag a nivel solicitud).
  select
    pr.company_id, pr.cost_center_id, pr.budget_category_id, pr.budget_month,
    coalesce(pr.subtotal_amount, pr.amount_requested) * coalesce(pr.exchange_rate, 1::numeric) as base,
    pr.status::text as status, pr.budget_decision, pr.no_presupuestal
  from public.payment_requests pr
  where not exists (
    select 1 from public.payment_request_distributions d where d.payment_request_id = pr.id
  )
  union all
  -- Solicitudes CON distribución: una fila por línea; no_presupuestal POR LÍNEA
  -- (de la partida de la línea, no de la solicitud).
  select
    pr.company_id, coalesce(d.cost_center_id, pr.cost_center_id), d.budget_category_id, pr.budget_month,
    d.amount * coalesce(pr.exchange_rate, 1::numeric) as base,
    pr.status::text, pr.budget_decision,
    (coalesce(bc.no_presupuestal, false) or bc.code = 'SIN_PARTIDA') as no_presupuestal
  from public.payment_request_distributions d
  join public.payment_requests pr on pr.id = d.payment_request_id
  join public.budget_categories bc on bc.id = d.budget_category_id
),
original as (
  select
    bl.company_id, bl.cost_center_id, bl.budget_category_id, bl.budget_month,
    bl.amount as budgeted,
    coalesce(sum(c.base) filter (
      where c.status = any (array['submitted','pending_approval','approved','finance_validation','scheduled','paid'])
        and c.budget_decision = 'aprobable'::text), 0::numeric) as committed,
    coalesce(sum(c.base) filter (
      where c.status = 'paid'::text and c.budget_decision = 'aprobable'::text), 0::numeric) as executed,
    bl.amount - coalesce(sum(c.base) filter (
      where c.status = any (array['submitted','pending_approval','approved','finance_validation','scheduled','paid'])
        and c.budget_decision = 'aprobable'::text), 0::numeric) as available
  from public.budget_lines bl
  join public.budget_versions bv on bv.id = bl.budget_version_id and bv.active = true
  left join consumption c
    on c.company_id = bl.company_id and c.cost_center_id = bl.cost_center_id
   and c.budget_category_id = bl.budget_category_id and c.budget_month = bl.budget_month
   and not c.no_presupuestal
   and c.status <> all (array['rejected','cancelled'])
  group by bl.company_id, bl.cost_center_id, bl.budget_category_id, bl.budget_month, bl.amount
)
select
  b.company_id, b.cost_center_id, b.budget_category_id, b.budget_month, b.budgeted,
  b.committed + coalesce(o.committed, 0::numeric) as committed,
  b.executed + coalesce(o.executed, 0::numeric) as executed,
  b.available - coalesce(o.committed, 0::numeric) as available
from original b
  left join payroll_obligation_budget_totals() o(company_id, cost_center_id, budget_category_id, budget_month, committed, executed)
    using (company_id, cost_center_id, budget_category_id, budget_month);

-- ── Bloqueo 1b: snapshot trigger consciente de multi-partida ──
-- En multi-partida el RPC ya fijó no_presupuestal (por línea) y budget_decision
-- (agregado por línea); el trigger NO debe sobrescribirlos. Se señaliza con el
-- GUC transaccional flux.mp_active='1' que pone el RPC alrededor del insert.
create or replace function public.set_payment_request_no_presupuestal_snapshot()
 returns trigger language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_no_presupuestal boolean;
begin
  if coalesce(current_setting('flux.mp_active', true), '') = '1' then
    -- multi-partida: respetar lo que fijó create_payment_request.
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.budget_category_id is not distinct from old.budget_category_id then
    if new.no_presupuestal is distinct from old.no_presupuestal then
      raise exception 'no_presupuestal_snapshot_immutable';
    end if;
    return new;
  end if;

  select coalesce(category.no_presupuestal, false) into v_no_presupuestal
  from public.budget_categories category where category.id = new.budget_category_id;

  new.no_presupuestal := coalesce(v_no_presupuestal, false);
  if new.no_presupuestal then
    new.budget_decision := 'aprobable';
    new.budget_block_reason := 'no_presupuestal';
    new.budget_available_before := null;
    new.budget_available_after := null;
    new.budget_shortfall := 0;
    new.budget_checked_at := now();
    new.budget_result := jsonb_build_object(
      'status', 'aprobable', 'motivo', 'no_presupuestal',
      'disponible_actual', null, 'disponible_despues', null, 'faltante', 0, 'no_presupuestal', true);
  end if;
  return new;
end;
$function$;

-- ── Bloqueo 2: guard de obligación compartida consciente de multi-partida ──
-- En multi-partida el guard por partida ÚNICA no aplica (mediría la base
-- completa contra la partida dominante). El RPC hace el lock + re-check por
-- CADA línea con obligación. Se salta con el mismo GUC.
create or replace function private.guard_request_shared_obligation_budget()
 returns trigger language plpgsql security definer
 set search_path to ''
as $function$
declare new_commit numeric; old_commit numeric:=0; available_now numeric;
begin
 if coalesce(current_setting('flux.mp_active', true), '') = '1' then return new; end if;
 if new.no_presupuestal or new.budget_decision is distinct from 'aprobable'
 or new.status::text not in('submitted','pending_approval','approved','finance_validation','scheduled','paid')
 or not exists(select 1 from public.payroll_obligation_settings s where s.company_id=new.company_id
   and s.budget_category_id=new.budget_category_id and s.enabled) then return new; end if;
 new_commit:=coalesce(new.subtotal_amount,new.amount_requested)*coalesce(new.exchange_rate,1);
 if tg_op='UPDATE' and not old.no_presupuestal and old.budget_decision='aprobable'
 and old.status::text in('submitted','pending_approval','approved','finance_validation','scheduled','paid')
 and (old.company_id,old.cost_center_id,old.budget_category_id,old.budget_month)
   is not distinct from (new.company_id,new.cost_center_id,new.budget_category_id,new.budget_month) then
  old_commit:=coalesce(old.subtotal_amount,old.amount_requested)*coalesce(old.exchange_rate,1);
 end if;
 if new_commit<=old_commit then return new; end if;
 perform 1 from public.budget_lines bl join public.budget_versions bv on bv.id=bl.budget_version_id and bv.active
 where bl.company_id=new.company_id and bl.cost_center_id=new.cost_center_id
 and bl.budget_category_id=new.budget_category_id and bl.budget_month=new.budget_month
 order by bl.id for update of bl;
 if not found then raise exception 'OBLIGATION_BUDGET_LINE_REQUIRED'; end if;
 select b.available into available_now from public.budget_availability b
 where b.company_id=new.company_id and b.cost_center_id=new.cost_center_id
 and b.budget_category_id=new.budget_category_id and b.budget_month=new.budget_month;
 if available_now is null or available_now+old_commit<new_commit then
  raise exception using errcode='40001',message='El presupuesto cambió por otra solicitud. Actualiza y vuelve a revisar el monto.';
 end if;
 return new;
end; $function$;

-- ── Bloqueo 5: advisory con autorización por empresa ──
create or replace function public.verify_payment_request_distribution_budget(
  p_payment_request_id uuid
)
returns jsonb language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_request public.payment_requests%rowtype;
  v_line record; v_line_result jsonb; v_lines jsonb := '[]'::jsonb;
  v_overall text := 'aprobable'; v_count int := 0;
begin
  select * into v_request from public.payment_requests where id = p_payment_request_id;
  if not found then
    return jsonb_build_object('status', 'bloqueado', 'motivo', 'payment_request_not_found');
  end if;

  -- Autorización: el llamador debe tener acceso a la solicitud (mismo criterio
  -- que la RLS de payment_request_distributions: dueño con rol, o finanzas/dirección).
  if not (
     (select private.current_profile_has_company_role(v_request.company_id, array['finance','director']))
     or (v_request.requested_by = (select public.current_profile_id())
         and (select private.current_profile_has_company_role(v_request.company_id, array['operator','finance','director'])))
  ) then
    return jsonb_build_object('status', 'no_autorizado', 'motivo', 'forbidden');
  end if;

  if v_request.company_id is null or v_request.cost_center_id is null or v_request.budget_month is null then
    return jsonb_build_object('status', 'bloqueado', 'motivo', 'budget_validation_data_missing');
  end if;

  for v_line in
    select id, budget_category_id, coalesce(cost_center_id, v_request.cost_center_id) as cost_center_id, amount
    from public.payment_request_distributions where payment_request_id = p_payment_request_id
    order by created_at asc
  loop
    v_count := v_count + 1;
    v_line_result := public.verify_budget_availability(
      v_request.company_id, v_line.cost_center_id, v_line.budget_category_id,
      v_request.budget_month, v_line.amount, coalesce(v_request.is_extraordinary_adjustment, false));
    if coalesce(v_line_result->>'status', 'bloqueado') = 'bloqueado' then v_overall := 'bloqueado'; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'distribution_id', v_line.id, 'budget_category_id', v_line.budget_category_id,
      'cost_center_id', v_line.cost_center_id, 'amount', v_line.amount, 'result', v_line_result));
  end loop;

  if v_count = 0 then return jsonb_build_object('status', 'sin_distribucion', 'lineas', v_lines); end if;
  return jsonb_build_object('status', v_overall, 'lineas', v_lines);
end;
$function$;
revoke all on function public.verify_payment_request_distribution_budget(uuid) from public, anon;
grant execute on function public.verify_payment_request_distribution_budget(uuid) to authenticated;

-- ── Bloqueo 2 (corrección): lock + revalidación en función interna DEFINER ──
-- Bajo RLS el rol de la app puede LEER budget_lines pero un `FOR UPDATE` bloquea
-- 0 filas (no hay política de escritura), así que el lock del RPC (INVOKER) era
-- un no-op. Se mueve a una función privada SECURITY DEFINER que sí adquiere el
-- lock real (bypass RLS como owner) y revalida disponibilidad, con autorización
-- por empresa. Es private (no expuesta por PostgREST) y valida membresía.
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
revoke all on function private.lock_and_check_obligation_budget(uuid,uuid,uuid,date,numeric) from public, anon;
grant execute on function private.lock_and_check_obligation_budget(uuid,uuid,uuid,date,numeric) to authenticated;

-- ── Bloqueos 1b + 2: create_payment_request con hardening multi-partida ──
-- Multi-partida: (a) fija budget_decision por agregado de líneas y no_presupuestal
-- por línea (todas no_presupuestal => solicitud no_presupuestal); (b) señaliza a
-- los triggers con flux.mp_active para que respeten esos valores; (c) protege la
-- concurrencia bloqueando FOR UPDATE las budget_lines de CADA partida secundaria
-- con obligación compartida antes de insertar (orden determinista por bl.id).
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
      where exists (select 1 from public.payroll_obligation_settings s
        where s.company_id = p_company_id
          and s.budget_category_id = (je.value->>'budget_category_id')::uuid and s.enabled)
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
