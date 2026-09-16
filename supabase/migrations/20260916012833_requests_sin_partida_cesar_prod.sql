begin;

-- Promote only SIN_PARTIDA onto the verified production functions.
-- Fail before any change if production drifted; keep document, tenant and reimbursement controls.
do $baseline$
begin
  if md5(pg_get_functiondef(to_regprocedure('public.create_payment_request(uuid,uuid,uuid,uuid,date,numeric,text,numeric,text,text,uuid,boolean,uuid,uuid,numeric,numeric,numeric,text,uuid,text)'))) is distinct from '9c51585ec1d8f25ffc367f1bb4351c63' then
    raise exception 'sin_partida_production_baseline_changed: create_payment_request';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.validate_payment_request_approver_scope()'))) is distinct from '426a1b4584ad912f2b756f9d826f8ca3' then
    raise exception 'sin_partida_production_baseline_changed: validate_payment_request_approver_scope';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.verify_budget_availability(uuid,uuid,uuid,date,numeric,boolean)'))) is distinct from 'fe3e2bc92f53cd58ae33349a21a40a19' then
    raise exception 'sin_partida_production_baseline_changed: verify_budget_availability';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.create_reimbursement_request_with_documents(uuid,uuid,date,text,numeric,text,text,uuid,boolean,uuid,uuid,uuid,text,jsonb)'))) is distinct from 'f83f08aa2141b8717bc39a96b7aa62d9' then
    raise exception 'sin_partida_production_baseline_changed: create_reimbursement_request_with_documents';
  end if;
  if md5(pg_get_functiondef(to_regprocedure('public.update_reimbursement_request(uuid,uuid,uuid,date,text,numeric,text,text,text,boolean,jsonb)'))) is distinct from '6fd51f948a97666daaddfc2394f49676' then
    raise exception 'sin_partida_production_baseline_changed: update_reimbursement_request';
  end if;
end $baseline$;


-- One classification for both companies. Descriptions belong to requests,
-- never to catalog rows. No historical requests are reclassified.
insert into public.budget_categories(code, name, no_presupuestal, active)
values ('SIN_PARTIDA', 'Sin partida', true, true)
on conflict (code) do nothing;

create table private.sin_partida_approval_policy (
  company_id uuid primary key references public.companies(id),
  approver_id uuid not null references public.profiles(id)
);
alter table private.sin_partida_approval_policy enable row level security;
revoke all on private.sin_partida_approval_policy from public, anon, authenticated;

-- Resolve the verified business identity, never environment-specific UUIDs.
insert into private.sin_partida_approval_policy(company_id, approver_id)
select c.id, p.id
from public.companies c cross join public.profiles p
where c.rfc in ('AFE190704UE0', 'SFE100825TM9') and c.active
  and lower(btrim(p.email)) = 'cesar@quantta.mx' and coalesce(p.active, true)
  and public.is_payment_request_approver_for_company(p.id, c.id);

do $$ begin
  if (select count(*) from private.sin_partida_approval_policy) <> 2
     or not exists (select 1 from public.budget_categories
                    where code = 'SIN_PARTIDA' and active and no_presupuestal) then
    raise exception 'sin_partida_configuration_invalid';
  end if;
end $$;

alter table public.payment_requests add column sin_partida_description text;
comment on column public.payment_requests.sin_partida_description is
  'Description captured on Cesar approval of SIN_PARTIDA; label only, one shared classification.';
alter table public.payment_requests drop constraint payment_requests_approver_selection_source_check;
alter table public.payment_requests add constraint payment_requests_approver_selection_source_check
  check (approver_selection_source is null or approver_selection_source in ('assigned', 'approval_rules', 'sin_partida'));

create function private.sin_partida_approver(p_company_id uuid)
returns uuid language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare v_actor uuid := public.current_profile_id(); v_approver uuid;
begin
  if v_actor is null then raise exception 'not_authenticated'; end if;
  if not public.has_active_company_membership(v_actor, p_company_id) then
    raise exception 'company_scope_required';
  end if;
  select policy.approver_id into v_approver
  from private.sin_partida_approval_policy policy
  join public.companies c on c.id = policy.company_id and c.active
  where policy.company_id = p_company_id;
  if v_approver is null or not public.is_payment_request_approver_for_company(v_approver, p_company_id) then
    raise exception 'sin_partida_approver_unavailable';
  end if;
  return v_approver;
end $$;
revoke all on function private.sin_partida_approver(uuid) from public, anon;
grant execute on function private.sin_partida_approver(uuid) to authenticated;

create function public.get_sin_partida_approver(p_company_id uuid)
returns table(profile_id uuid, display_name text, email text, source text, assignment_id uuid, option_label text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_approver uuid := private.sin_partida_approver(p_company_id);
begin
  return query select p.id, coalesce(nullif(btrim(p.full_name), ''), p.email), p.email,
    'sin_partida'::text, null::uuid, coalesce(nullif(btrim(p.full_name), ''), p.email)
  from public.profiles p where p.id = v_approver;
end $$;
revoke all on function public.get_sin_partida_approver(uuid) from public, anon;
grant execute on function public.get_sin_partida_approver(uuid) to authenticated;

create function private.guard_sin_partida_request()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sin boolean;
  v_was_sin boolean := false;
  v_entering boolean;
  v_material_change boolean := false;
  v_count integer;
  v_total numeric;
begin
  select code = 'SIN_PARTIDA' into v_sin from public.budget_categories where id = new.budget_category_id;
  if tg_op = 'UPDATE' then
    select code = 'SIN_PARTIDA' into v_was_sin from public.budget_categories where id = old.budget_category_id;
  end if;
  if coalesce(v_was_sin, false) and not coalesce(v_sin, false) then
    raise exception 'sin_partida_classification_immutable';
  end if;
  if not coalesce(v_sin, false) then
    new.sin_partida_description := null;
    return new;
  end if;
  if nullif(btrim(new.description), '') is null then raise exception 'sin_partida_description_required'; end if;
  if new.is_extraordinary_adjustment then raise exception 'sin_partida_extraordinary_not_allowed'; end if;
  v_entering := tg_op = 'INSERT' or not coalesce(v_was_sin, false);
  if tg_op = 'UPDATE' then
    v_material_change := row(new.company_id, new.requested_by, new.cost_center_id, new.budget_month,
      new.amount_requested, new.currency, new.exchange_rate, new.description, new.proveedor_id,
      new.beneficiary_profile_id, new.request_type, new.subtotal_amount, new.tax_amount, new.withholding_amount)
      is distinct from row(old.company_id, old.requested_by, old.cost_center_id, old.budget_month,
      old.amount_requested, old.currency, old.exchange_rate, old.description, old.proveedor_id,
      old.beneficiary_profile_id, old.request_type, old.subtotal_amount, old.tax_amount, old.withholding_amount);
    if (v_entering or v_material_change) and old.status::text in ('scheduled', 'paid') then
      raise exception 'sin_partida_executed_request_immutable';
    end if;
  end if;
  if v_entering then
    new.approver_id := private.sin_partida_approver(new.company_id);
    new.approver_assignment_id := null;
    new.approver_selection_source := 'sin_partida';
    if tg_op = 'INSERT' and new.status::text not in ('draft', 'submitted') then
      raise exception 'sin_partida_approval_required';
    end if;
  elsif new.approver_id is distinct from old.approver_id
     or new.approver_assignment_id is distinct from old.approver_assignment_id
     or new.approver_selection_source is distinct from old.approver_selection_source then
    raise exception 'payment_request_approver_selection_immutable';
  end if;
  if new.requested_by = new.approver_id then raise exception 'requester_cannot_be_own_approver'; end if;
  new.partida_unsure := false;
  if v_entering or v_material_change then
    if tg_op = 'UPDATE' then new.status := 'submitted'; end if;
    new.sin_partida_description := null;
    new.approved_by := null;
    new.approved_at := null;
    if v_material_change then
      if new.approver_id is distinct from private.sin_partida_approver(new.company_id) then
        raise exception 'sin_partida_approver_unavailable';
      end if;
      new.submitted_at := now();
    end if;
  elsif tg_op = 'UPDATE' then
    new.sin_partida_description := old.sin_partida_description;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    if new.status::text = 'approved' and old.status::text not in ('approved', 'finance_validation', 'scheduled', 'paid') then
      -- The existing decision RPC writes its audit event before this update.
      -- A direct status edit or an automatic approval cannot replace Cesar.
      if public.current_profile_id() is distinct from old.approver_id
         or not public.is_payment_request_approver_for_company(old.approver_id, old.company_id)
         or not exists (select 1 from public.payment_request_approvals a
           where a.payment_request_id = old.id and a.actor_profile_id = old.approver_id
             and a.action = 'approved' and a.to_status = 'approved'
             and a.created_at >= greatest(old.updated_at, old.approval_material_updated_at)) then
        raise exception 'sin_partida_cesar_approval_required';
      end if;
      if new.request_type::text = 'reimbursement' then
        select count(*), coalesce(sum(amount), 0) into v_count, v_total
        from public.reimbursement_items where payment_request_id = new.id;
        if v_count = 0 or abs(v_total - new.amount_requested) > 0.01
          or exists (select 1 from public.reimbursement_items where payment_request_id = new.id
                     and budget_category_id is distinct from new.budget_category_id) then
          raise exception 'sin_partida_reimbursement_incomplete';
        end if;
      end if;
      new.sin_partida_description := btrim(new.description);
      new.approved_by := old.approver_id;
      new.approved_at := now();
    elsif new.status::text in ('draft', 'submitted', 'changes_requested', 'rejected') then
      new.sin_partida_description := null;
      new.approved_by := null;
      new.approved_at := null;
    elsif new.status::text in ('approved', 'finance_validation', 'scheduled', 'paid')
      and old.sin_partida_description is null then
      raise exception 'sin_partida_approval_required';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_sin_partida_request() from public, anon, authenticated;
create trigger aa_sin_partida_request before insert or update on public.payment_requests
for each row execute function private.guard_sin_partida_request();

create function private.guard_sin_partida_reimbursement_item()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_request public.payment_requests%rowtype; v_is_sin boolean; v_item_sin boolean;
begin
  if tg_op = 'UPDATE' and new.payment_request_id is distinct from old.payment_request_id
    and exists (select 1 from public.payment_requests r join public.budget_categories c on c.id = r.budget_category_id
                where r.id in (old.payment_request_id, new.payment_request_id) and c.code = 'SIN_PARTIDA') then
    raise exception 'reimbursement_parent_immutable';
  end if;
  select * into v_request from public.payment_requests
  where id = case when tg_op = 'DELETE' then old.payment_request_id else new.payment_request_id end for update;
  select code = 'SIN_PARTIDA' into v_is_sin from public.budget_categories where id = v_request.budget_category_id;
  if tg_op <> 'DELETE' then
    select code = 'SIN_PARTIDA' into v_item_sin from public.budget_categories where id = new.budget_category_id;
    if (coalesce(v_is_sin, false) or coalesce(v_item_sin, false))
      and new.budget_category_id is distinct from v_request.budget_category_id then
      raise exception 'sin_partida_reimbursement_mixed_categories';
    end if;
  end if;
  if coalesce(v_is_sin, false) and v_request.status::text not in ('draft', 'submitted', 'changes_requested') then
    raise exception 'sin_partida_reimbursement_approved_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.guard_sin_partida_reimbursement_item() from public, anon, authenticated;
create trigger sin_partida_reimbursement_item before insert or update or delete on public.reimbursement_items
for each row execute function private.guard_sin_partida_reimbursement_item();


-- Preserve production overloads/wrappers; adapt its existing core and reimbursement RPCs.
CREATE OR REPLACE FUNCTION public.create_payment_request(p_proveedor_id uuid, p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid, p_budget_month date, p_amount_requested numeric, p_currency text DEFAULT 'MXN'::text, p_exchange_rate numeric DEFAULT 1, p_description text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_requested_by uuid DEFAULT NULL::uuid, p_is_extraordinary_adjustment boolean DEFAULT false, p_approver_id uuid DEFAULT NULL::uuid, p_approver_assignment_id uuid DEFAULT NULL::uuid, p_subtotal_amount numeric DEFAULT NULL::numeric, p_tax_amount numeric DEFAULT NULL::numeric, p_withholding_amount numeric DEFAULT NULL::numeric, p_invoice_uuid text DEFAULT NULL::text, p_beneficiary_profile_id uuid DEFAULT NULL::uuid, p_request_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_sin_partida boolean := false;
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
  select coalesce(code = 'SIN_PARTIDA', false) into v_sin_partida
  from public.budget_categories where id = p_budget_category_id;
  if v_sin_partida then
    p_approver_id := private.sin_partida_approver(p_company_id);
    p_approver_assignment_id := null;
    if nullif(btrim(p_description), '') is null then raise exception 'sin_partida_description_required'; end if;
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

  v_has_pool := not v_sin_partida and public.payment_request_has_active_approver_pool(v_requester_id, p_company_id);
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
    case when v_sin_partida then 'sin_partida' when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
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
    'approver_source', case when v_sin_partida then 'sin_partida' when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.validate_payment_request_approver_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_assignment public.approver_assignments%rowtype;
  v_assignment_changed boolean;
  v_legacy_assignment_snapshot boolean := false;
begin
  if new.approver_id is null then
    if tg_op = 'INSERT' then
      raise exception 'payment_request_approver_required';
    end if;
    if old.approver_id is not null
       or new.company_id is distinct from old.company_id
       or new.requested_by is distinct from old.requested_by then
      raise exception 'payment_request_approver_required';
    end if;
    return new;
  end if;

  if new.requested_by is null then
    raise exception 'payment_request_requester_required';
  end if;
  if new.requested_by = new.approver_id then
    raise exception 'requester_cannot_be_own_approver';
  end if;
  if exists (select 1 from public.budget_categories where id = new.budget_category_id and code = 'SIN_PARTIDA') then
    if new.approver_id is distinct from private.sin_partida_approver(new.company_id)
       or new.approver_selection_source is distinct from 'sin_partida'
       or new.approver_assignment_id is not null then
      raise exception 'sin_partida_cesar_approval_required';
    end if;
    if not public.has_active_company_membership(new.requested_by, new.company_id) then
      raise exception 'requester_company_membership_required';
    end if;
    if not public.payment_request_rule_allows(new.approver_id, new.company_id, new.cost_center_id, new.amount_requested, 'approved') then
      raise exception 'approver_not_allowed_by_approval_rules';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and (
    new.approver_id is distinct from old.approver_id
    or new.approver_assignment_id is distinct from old.approver_assignment_id
    or new.approver_selection_source is distinct from old.approver_selection_source
  ) then
    raise exception 'payment_request_approver_selection_immutable';
  end if;
  v_assignment_changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    v_assignment_changed := new.approver_assignment_id is distinct from old.approver_assignment_id;
  end if;

  if new.approver_assignment_id is not null then
    if new.approver_selection_source is distinct from 'assigned' then
      raise exception 'approver_assignment_source_mismatch';
    end if;
    select * into v_assignment
    from public.approver_assignments aa
    where aa.id = new.approver_assignment_id;

    if not found
       or v_assignment.company_id <> new.company_id
       or v_assignment.requester_id <> new.requested_by
       or v_assignment.approver_id <> new.approver_id then
      raise exception 'approver_assignment_snapshot_mismatch';
    end if;
    if v_assignment_changed and not v_assignment.active then
      raise exception 'approver_assignment_not_active';
    end if;
    if v_assignment_changed then
      if not public.has_active_company_membership(new.requested_by, new.company_id) then
        raise exception 'requester_company_membership_required';
      end if;
      if not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
        raise exception 'approver_not_eligible_for_company';
      end if;
    end if;
  else
    if new.approver_selection_source = 'assigned' then
      raise exception 'approver_assignment_id_required';
    end if;
    if tg_op = 'INSERT' and new.approver_selection_source is distinct from 'approval_rules' then
      raise exception 'approver_selection_source_required';
    end if;
    if new.approver_selection_source = 'approval_rules'
       and public.payment_request_has_active_approver_pool(new.requested_by, new.company_id) then
      raise exception 'approver_must_come_from_configured_pool';
    end if;

    -- Migration 018 stored only approver_id. If the same assignment already
    -- existed when the request was created, preserve that historical snapshot
    -- when other editable request fields change.
    if tg_op = 'UPDATE'
       and new.approver_selection_source is null
       and new.company_id is not distinct from old.company_id
       and new.requested_by is not distinct from old.requested_by then
      select exists (
        select 1
        from public.approver_assignments aa
        where aa.company_id = new.company_id
          and aa.requester_id = new.requested_by
          and aa.approver_id = new.approver_id
          and aa.created_at <= old.created_at
      ) into v_legacy_assignment_snapshot;
    end if;

    if not v_legacy_assignment_snapshot then
      if not public.has_active_company_membership(new.requested_by, new.company_id) then
        raise exception 'requester_company_membership_required';
      end if;
      if not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
        raise exception 'approver_not_eligible_for_company';
      end if;
      if not public.payment_request_rule_allows(
        new.approver_id,
        new.company_id,
        new.cost_center_id,
        new.amount_requested,
        'approved'
      ) then
        raise exception 'approver_not_allowed_by_approval_rules';
      end if;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.verify_budget_availability(p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid, p_budget_month date, p_amount numeric, p_is_extraordinary_adjustment boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_no_presupuestal boolean := false;
begin
  if exists (select 1 from public.budget_categories where id = p_budget_category_id and code = 'SIN_PARTIDA' and active) then
    perform private.sin_partida_approver(p_company_id);
    if p_amount is null or p_amount <= 0 or p_budget_month is null
       or not exists (select 1 from public.cost_centers where id = p_cost_center_id) then
      raise exception 'sin_partida_budget_context_invalid';
    end if;
    if p_is_extraordinary_adjustment then raise exception 'sin_partida_extraordinary_not_allowed'; end if;
    return jsonb_build_object('status', 'aprobable', 'motivo', 'no_presupuestal',
      'disponible_actual', null, 'disponible_despues', null, 'faltante', 0, 'no_presupuestal', true);
  end if;
  select category.no_presupuestal
    into v_no_presupuestal
  from public.budget_categories category
  where category.id = p_budget_category_id;

  return public.verify_budget_availability(
    p_company_id,
    p_cost_center_id,
    p_budget_category_id,
    p_budget_month,
    p_amount,
    p_is_extraordinary_adjustment,
    coalesce(v_no_presupuestal, false)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_reimbursement_request_with_documents(p_company_id uuid, p_cost_center_id uuid, p_budget_month date, p_currency text, p_exchange_rate numeric, p_description text, p_notes text, p_requested_by uuid, p_is_extraordinary_adjustment boolean, p_approver_id uuid, p_approver_assignment_id uuid, p_beneficiary_profile_id uuid, p_payment_method text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
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
    ) and not exists (
      select 1 from public.budget_categories category
      where category.id = v_category_id and category.code = 'SIN_PARTIDA'
        and category.active and category.no_presupuestal
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

CREATE OR REPLACE FUNCTION public.update_reimbursement_request(p_payment_request_id uuid, p_beneficiary_profile_id uuid, p_cost_center_id uuid, p_budget_month date, p_currency text, p_exchange_rate numeric, p_description text, p_notes text, p_payment_method text, p_is_extraordinary_adjustment boolean, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_actor uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_item jsonb;
  v_category_id uuid;
  v_dominant_category_id uuid;
  v_amount numeric;
  v_total numeric := 0;
  v_dominant_amount numeric := -1;
  v_item_subtotal numeric;
  v_item_tax numeric;
  v_deducible boolean;
  v_deducible_total numeric := 0;
  v_deducible_subtotal numeric := 0;
  v_tax numeric := 0;
  v_has_fiscal boolean := false;
  v_fiscal_ok boolean := false;
  v_subtotal numeric;
  v_invoice_uuid text;
  v_invoice_uuids text[] := array[]::text[];
  v_storage_path text;
  v_budget_month date;
  v_currency text;
  v_exchange_rate numeric;
  v_budget_amount numeric;
  v_old_budget_amount numeric;
  v_budget_result jsonb;
  v_budget_decision text;
  v_budget_block_reason text;
  v_available_before numeric;
  v_available_after numeric;
  v_shortfall numeric;
  v_old_counts boolean;
begin
  if auth.uid() is null or v_actor is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_request
  from public.payment_requests request
  where request.id = p_payment_request_id
  for update;
  if not found then
    raise exception 'reimbursement_request_not_found';
  end if;
  if v_request.request_type::text <> 'reimbursement'
     and v_request.beneficiary_profile_id is null then
    raise exception 'request_is_not_reimbursement';
  end if;
  if not private.current_profile_has_company_role(
    v_request.company_id, array['finance','sysadmin']::text[]
  ) then
    raise exception 'reimbursement_finance_role_required_for_edit';
  end if;
  if v_request.status::text in ('approved','scheduled','paid','rejected','cancelled') then
    raise exception 'reimbursement_terminal_request_immutable';
  end if;

  if p_beneficiary_profile_id is null
     or not public.has_active_company_membership(
       p_beneficiary_profile_id,
       v_request.company_id
     ) then
    raise exception 'beneficiary_company_membership_required';
  end if;
  if not exists (
    select 1
    from public.employee_bank_accounts account
    where account.profile_id = p_beneficiary_profile_id
      and account.company_id = v_request.company_id
      and nullif(btrim(account.beneficiary_name), '') is not null
      and nullif(btrim(account.banco), '') is not null
      and (
        coalesce(account.clabe, '') ~ '^[0-9]{18}$'
        or nullif(btrim(account.cuenta), '') is not null
      )
  ) then
    raise exception 'beneficiary_bank_account_required';
  end if;

  v_budget_month := date_trunc('month', p_budget_month)::date;
  v_currency := upper(coalesce(nullif(btrim(p_currency), ''), 'MXN'));
  v_exchange_rate := coalesce(p_exchange_rate, 1);
  if p_cost_center_id is null or v_budget_month is null then
    raise exception 'reimbursement_budget_scope_required';
  end if;
  if v_currency not in ('MXN','USD') or v_exchange_rate <= 0 then
    raise exception 'reimbursement_currency_invalid';
  end if;
  if coalesce(nullif(btrim(p_description), ''), '') = '' then
    raise exception 'reimbursement_description_required';
  end if;
  if p_payment_method not in ('transfer','cash','check','other') then
    raise exception 'reimbursement_payment_method_invalid';
  end if;
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'reimbursement_items_required';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_category_id := nullif(v_item ->> 'budget_category_id', '')::uuid;
    v_amount := nullif(v_item ->> 'amount', '')::numeric;
    v_item_subtotal := nullif(v_item ->> 'subtotal_amount', '')::numeric;
    v_item_tax := nullif(v_item ->> 'tax_amount', '')::numeric;
    v_deducible := coalesce((v_item ->> 'deducible')::boolean, true);
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
      where relation.company_id = v_request.company_id
        and relation.cost_center_id = p_cost_center_id
        and relation.budget_category_id = v_category_id
        and relation.active
    ) and not exists (
      select 1 from public.budget_categories category
      where category.id = v_category_id and category.code = 'SIN_PARTIDA'
        and category.active and category.no_presupuestal
    ) then
      raise exception 'reimbursement_item_budget_category_invalid';
    end if;
    if v_deducible and v_storage_path is null then
      raise exception 'reimbursement_item_receipt_required';
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
  v_fiscal_ok := v_has_fiscal
    and abs((v_deducible_subtotal + v_tax) - v_deducible_total) <= 0.01;
  v_subtotal := case when v_fiscal_ok then round(v_total - v_tax, 2) else null end;
  v_tax := case when v_fiscal_ok then round(v_tax, 2) else null end;
  v_budget_amount := round(coalesce(v_subtotal, v_total) * v_exchange_rate, 2);

  v_budget_result := public.verify_budget_availability(
    v_request.company_id,
    p_cost_center_id,
    v_dominant_category_id,
    v_budget_month,
    v_budget_amount,
    coalesce(p_is_extraordinary_adjustment, false)
  );

  -- La vista ya descuenta la solicitud vigente. Si la edición conserva su
  -- misma línea presupuestal, se devuelve temporalmente ese compromiso antes
  -- de evaluar el nuevo monto para evitar contarlo dos veces.
  v_old_counts := v_request.status::text in (
      'submitted','pending_approval','approved','finance_validation','scheduled','paid'
    ) and v_request.budget_decision = 'aprobable';
  if v_old_counts
     and v_request.cost_center_id = p_cost_center_id
     and v_request.budget_category_id = v_dominant_category_id
     and date_trunc('month', v_request.budget_month)::date = v_budget_month
     and not coalesce(p_is_extraordinary_adjustment, false)
     and coalesce(v_budget_result ->> 'motivo', 'sin_disponible') in ('sin_disponible','') then
    v_old_budget_amount := round(
      coalesce(v_request.subtotal_amount, v_request.amount_requested)
      * coalesce(v_request.exchange_rate, 1),
      2
    );
    v_available_before := coalesce((v_budget_result ->> 'disponible_actual')::numeric, 0)
      + v_old_budget_amount;
    v_available_after := v_available_before - v_budget_amount;
    v_shortfall := greatest(v_budget_amount - v_available_before, 0);
    v_budget_result := jsonb_build_object(
      'status', case when v_shortfall = 0 then 'aprobable' else 'bloqueado' end,
      'motivo', case when v_shortfall = 0 then null else 'sin_disponible' end,
      'disponible_actual', v_available_before,
      'disponible_despues', v_available_after,
      'faltante', v_shortfall
    );
  end if;

  v_budget_decision := coalesce(v_budget_result ->> 'status', 'bloqueado');
  v_budget_block_reason := v_budget_result ->> 'motivo';
  v_available_before := nullif(v_budget_result ->> 'disponible_actual', '')::numeric;
  v_available_after := nullif(v_budget_result ->> 'disponible_despues', '')::numeric;
  v_shortfall := nullif(v_budget_result ->> 'faltante', '')::numeric;

  update public.payment_requests request
  set beneficiary_profile_id = p_beneficiary_profile_id,
      cost_center_id = p_cost_center_id,
      budget_category_id = v_dominant_category_id,
      budget_month = v_budget_month,
      amount_requested = v_total,
      currency = v_currency,
      exchange_rate = v_exchange_rate,
      description = btrim(p_description),
      concept = btrim(p_description),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      payment_method = p_payment_method,
      is_extraordinary_adjustment = coalesce(p_is_extraordinary_adjustment, false),
      subtotal_amount = v_subtotal,
      tax_amount = v_tax,
      withholding_amount = null,
      invoice_uuid = null,
      budget_decision = v_budget_decision,
      budget_block_reason = v_budget_block_reason,
      budget_available_before = v_available_before,
      budget_available_after = v_available_after,
      budget_shortfall = v_shortfall,
      budget_checked_at = now(),
      budget_result = v_budget_result,
      updated_at = now()
  where request.id = v_request.id;

  delete from public.reimbursement_items item
  where item.payment_request_id = v_request.id
    and item.company_id = v_request.company_id;

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
      v_request.id,
      v_request.company_id,
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

  return jsonb_build_object(
    'payment_request_id', v_request.id,
    'beneficiary_profile_id', p_beneficiary_profile_id,
    'amount_requested', v_total,
    'budget_category_id', v_dominant_category_id,
    'budget_decision', v_budget_decision,
    'budget_result', v_budget_result
  );
end;
$function$;

notify pgrst, 'reload schema';
commit;
