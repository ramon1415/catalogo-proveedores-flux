begin;

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

-- Updated creation / approver guards follow. Their existing RLS, fiscal,
-- beneficiary, company and approval-rule validation remains authoritative.
CREATE OR REPLACE FUNCTION public.create_payment_request(p_proveedor_id uuid, p_company_id uuid, p_cost_center_id uuid, p_budget_category_id uuid, p_budget_month date, p_amount_requested numeric, p_currency text DEFAULT 'MXN'::text, p_exchange_rate numeric DEFAULT 1, p_description text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_requested_by uuid DEFAULT NULL::uuid, p_is_extraordinary_adjustment boolean DEFAULT false, p_approver_id uuid DEFAULT NULL::uuid, p_approver_assignment_id uuid DEFAULT NULL::uuid, p_subtotal_amount numeric DEFAULT NULL::numeric, p_tax_amount numeric DEFAULT NULL::numeric, p_withholding_amount numeric DEFAULT NULL::numeric, p_invoice_uuid text DEFAULT NULL::text, p_beneficiary_profile_id uuid DEFAULT NULL::uuid, p_request_type text DEFAULT NULL::text, p_partida_unsure boolean DEFAULT false)
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

  v_request_type := coalesce(
    nullif(btrim(coalesce(p_request_type, '')), '')::public.payment_request_type,
    'provider_payment'::public.payment_request_type
  );
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
    p_partida_unsure := false;
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
    is_extraordinary_adjustment, partida_unsure, created_at, updated_at
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
    coalesce(p_is_extraordinary_adjustment, false), coalesce(p_partida_unsure, false), now(), now()
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
    'approver_source', case when v_sin_partida then 'sin_partida' when p_approver_assignment_id is null then 'approval_rules' else 'assigned' end,
    'partida_unsure', coalesce(p_partida_unsure, false)
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


notify pgrst, 'reload schema';
commit;
