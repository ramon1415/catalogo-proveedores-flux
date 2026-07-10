-- Flux Operadora - Migration 018
-- Company-scoped approver routing, fixed assignments, and notification recipients.

create table if not exists public.profile_company_memberships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profile_company_memberships_profile_company_key unique (profile_id, company_id)
);

create index if not exists profile_company_memberships_profile_id_idx
  on public.profile_company_memberships(profile_id);
create index if not exists profile_company_memberships_company_id_idx
  on public.profile_company_memberships(company_id);
create index if not exists profile_company_memberships_active_idx
  on public.profile_company_memberships(active) where active;

create table if not exists public.approver_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  approver_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint approver_assignments_company_requester_key unique (company_id, requester_id),
  constraint approver_assignments_distinct_profiles_check check (requester_id <> approver_id)
);

create index if not exists approver_assignments_company_id_idx
  on public.approver_assignments(company_id);
create index if not exists approver_assignments_requester_id_idx
  on public.approver_assignments(requester_id);
create index if not exists approver_assignments_approver_id_idx
  on public.approver_assignments(approver_id);

alter table public.payment_requests
  add column if not exists approver_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_approver_id_fkey'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_approver_id_fkey
      foreign key (approver_id) references public.profiles(id) on delete set null;
  end if;
end
$$;

create index if not exists payment_requests_approver_id_idx
  on public.payment_requests(approver_id);

create or replace function public.payment_request_approver_role_names()
returns text[]
language sql
immutable
as $$
  select array['finance','finanzas','director','direccion','approver_2','aprobador_2']::text[];
$$;

create or replace function public.has_active_company_membership(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profile_company_memberships pcm
    join public.profiles p on p.id = pcm.profile_id
    join public.companies c on c.id = pcm.company_id
    where pcm.profile_id = p_profile_id
      and pcm.company_id = p_company_id
      and pcm.active
      and coalesce(p.active, true)
      and coalesce(c.active, true)
  );
$$;

create or replace function public.is_payment_request_approver_for_company(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_active_company_membership(p_profile_id, p_company_id)
    and exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = p_profile_id
        and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    );
$$;

create or replace function public.validate_approver_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requester_id = new.approver_id then
    raise exception 'requester_cannot_be_own_fixed_approver';
  end if;

  if not public.has_active_company_membership(new.requester_id, new.company_id) then
    raise exception 'requester_company_membership_required';
  end if;

  if not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
    raise exception 'approver_not_eligible_for_company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_approver_assignment on public.approver_assignments;
create trigger validate_approver_assignment
  before insert or update on public.approver_assignments
  for each row execute function public.validate_approver_assignment();

create or replace function public.protect_assigned_company_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := old.profile_id;
  v_company_id uuid := old.company_id;
  v_deactivating boolean;
begin
  v_deactivating := tg_op = 'DELETE';
  if tg_op = 'UPDATE' then
    v_deactivating := old.active and not new.active;
  end if;

  if v_deactivating and exists (
    select 1
    from public.approver_assignments aa
    where aa.company_id = v_company_id
      and (aa.requester_id = v_profile_id or aa.approver_id = v_profile_id)
  ) then
    raise exception 'membership_used_by_approver_assignment';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_assigned_company_membership on public.profile_company_memberships;
create trigger protect_assigned_company_membership
  before update of active or delete on public.profile_company_memberships
  for each row execute function public.protect_assigned_company_membership();

create or replace function public.validate_payment_request_approver_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixed_approver_id uuid;
begin
  if new.approver_id is null then
    if tg_op = 'INSERT' then
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

  if not public.has_active_company_membership(new.requested_by, new.company_id) then
    raise exception 'requester_company_membership_required';
  end if;

  if not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
    raise exception 'approver_not_eligible_for_company';
  end if;

  select aa.approver_id into v_fixed_approver_id
  from public.approver_assignments aa
  where aa.company_id = new.company_id
    and aa.requester_id = new.requested_by;

  if found and new.approver_id <> v_fixed_approver_id then
    raise exception 'fixed_approver_mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_payment_request_approver_scope on public.payment_requests;
drop trigger if exists validate_payment_request_approver_scope_insert on public.payment_requests;
drop trigger if exists validate_payment_request_approver_scope_update on public.payment_requests;
create trigger validate_payment_request_approver_scope_insert
  before insert on public.payment_requests
  for each row execute function public.validate_payment_request_approver_scope();
create trigger validate_payment_request_approver_scope_update
  before update of approver_id, company_id, requested_by on public.payment_requests
  for each row execute function public.validate_payment_request_approver_scope();

alter table public.profile_company_memberships enable row level security;
alter table public.approver_assignments enable row level security;

drop policy if exists profile_company_memberships_select on public.profile_company_memberships;
create policy profile_company_memberships_select
  on public.profile_company_memberships
  for select to authenticated
  using (
    profile_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  );

drop policy if exists profile_company_memberships_admin_write on public.profile_company_memberships;
create policy profile_company_memberships_admin_write
  on public.profile_company_memberships
  for all to authenticated
  using (public.current_user_has_role(public.flux_sysadmin_roles()))
  with check (public.current_user_has_role(public.flux_sysadmin_roles()));

drop policy if exists approver_assignments_select on public.approver_assignments;
create policy approver_assignments_select
  on public.approver_assignments
  for select to authenticated
  using (
    requester_id = public.current_profile_id()
    or approver_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
  );

drop policy if exists approver_assignments_admin_write on public.approver_assignments;
create policy approver_assignments_admin_write
  on public.approver_assignments
  for all to authenticated
  using (public.current_user_has_role(public.flux_sysadmin_roles()))
  with check (public.current_user_has_role(public.flux_sysadmin_roles()));

grant select, insert, update, delete on table public.profile_company_memberships to authenticated;
grant select, insert, update, delete on table public.approver_assignments to authenticated;

drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select
  on public.payment_requests
  for select to authenticated
  using (
    requested_by = public.current_profile_id()
    or approver_id = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
    or (
      public.current_user_has_role(public.flux_approver_roles())
      and public.has_active_company_membership(public.current_profile_id(), company_id)
    )
  );

drop policy if exists payment_requests_update on public.payment_requests;
create policy payment_requests_update
  on public.payment_requests
  for update to authenticated
  using (
    requested_by = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
    or (
      public.current_user_has_role(public.flux_approver_roles())
      and public.has_active_company_membership(public.current_profile_id(), company_id)
    )
  )
  with check (
    requested_by = public.current_profile_id()
    or public.current_user_has_role(public.flux_sysadmin_roles())
    or (
      public.current_user_has_role(public.flux_approver_roles())
      and public.has_active_company_membership(public.current_profile_id(), company_id)
    )
  );

create or replace function public.list_payment_request_approvers(p_company_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  eligible_roles text[],
  is_fixed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_profile_id();
  v_fixed_approver_id uuid;
  v_has_fixed boolean := false;
begin
  if v_actor_id is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id and coalesce(c.active, true)) then
    raise exception 'company_not_found_or_inactive';
  end if;

  if not public.current_user_has_role(public.flux_sysadmin_roles())
     and not public.has_active_company_membership(v_actor_id, p_company_id) then
    raise exception 'company_scope_required';
  end if;

  select aa.approver_id
  into v_fixed_approver_id
  from public.approver_assignments aa
  where aa.company_id = p_company_id
    and aa.requester_id = v_actor_id;
  v_has_fixed := found;

  if v_has_fixed and not public.is_payment_request_approver_for_company(v_fixed_approver_id, p_company_id) then
    raise exception 'fixed_approver_assignment_invalid';
  end if;

  return query
  select
    p.id,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    p.email,
    array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))),
    v_has_fixed and p.id = v_fixed_approver_id
  from public.profile_company_memberships pcm
  join public.profiles p on p.id = pcm.profile_id
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where pcm.company_id = p_company_id
    and pcm.active
    and coalesce(p.active, true)
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
  group by p.id, p.full_name, p.email
  order by v_has_fixed and p.id = v_fixed_approver_id desc,
           coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

create or replace function public.get_payment_request_approver_details(p_payment_request_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  is_fixed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
  v_effective_approver_id uuid;
  v_is_fixed boolean := false;
begin
  if v_actor_id is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id;

  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if not (
    v_request.requested_by = v_actor_id
    or v_request.approver_id = v_actor_id
    or public.current_user_has_role(public.flux_sysadmin_roles())
    or (
      public.current_user_has_role(public.flux_approver_roles())
      and public.has_active_company_membership(v_actor_id, v_request.company_id)
    )
  ) then
    raise exception 'payment_request_not_visible';
  end if;

  select aa.approver_id into v_effective_approver_id
  from public.approver_assignments aa
  where aa.company_id = v_request.company_id
    and aa.requester_id = v_request.requested_by;
  v_is_fixed := found;
  if not v_is_fixed then
    v_effective_approver_id := v_request.approver_id;
  end if;

  return query
  select
    p.id,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    p.email,
    v_is_fixed
  from (select 1) seed
  left join public.profiles p on p.id = v_effective_approver_id;
end;
$$;

create or replace function public.list_profile_company_memberships()
returns table (
  id uuid,
  profile_id uuid,
  profile_name text,
  profile_email text,
  company_id uuid,
  company_name text,
  active boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select pcm.id, p.id, p.full_name, p.email, c.id,
         coalesce(nullif(btrim(c.legal_name), ''), c.name), pcm.active, pcm.created_at
  from public.profile_company_memberships pcm
  join public.profiles p on p.id = pcm.profile_id
  join public.companies c on c.id = pcm.company_id
  order by coalesce(nullif(btrim(p.full_name), ''), p.email),
           coalesce(nullif(btrim(c.legal_name), ''), c.name);
end;
$$;

create or replace function public.set_profile_company_membership(
  p_profile_id uuid,
  p_company_id uuid,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile_id and coalesce(active, true)) then
    raise exception 'profile_not_found_or_inactive';
  end if;
  if not exists (select 1 from public.companies where id = p_company_id and coalesce(active, true)) then
    raise exception 'company_not_found_or_inactive';
  end if;

  insert into public.profile_company_memberships(profile_id, company_id, active)
  values (p_profile_id, p_company_id, coalesce(p_active, true))
  on conflict (profile_id, company_id)
  do update set active = excluded.active
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.list_approver_assignments()
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  requester_id uuid,
  requester_name text,
  requester_email text,
  approver_id uuid,
  approver_name text,
  approver_email text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select aa.id, c.id, coalesce(nullif(btrim(c.legal_name), ''), c.name),
         requester.id, requester.full_name, requester.email,
         approver.id, approver.full_name, approver.email, aa.created_at
  from public.approver_assignments aa
  join public.companies c on c.id = aa.company_id
  join public.profiles requester on requester.id = aa.requester_id
  join public.profiles approver on approver.id = aa.approver_id
  order by coalesce(nullif(btrim(c.legal_name), ''), c.name),
           coalesce(nullif(btrim(requester.full_name), ''), requester.email);
end;
$$;

create or replace function public.set_approver_assignment(
  p_company_id uuid,
  p_requester_id uuid,
  p_approver_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  insert into public.approver_assignments(company_id, requester_id, approver_id)
  values (p_company_id, p_requester_id, p_approver_id)
  on conflict (company_id, requester_id)
  do update set approver_id = excluded.approver_id
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.remove_approver_assignment(
  p_company_id uuid,
  p_requester_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  delete from public.approver_assignments
  where company_id = p_company_id
    and requester_id = p_requester_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean
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
  p_approver_id uuid default null::uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_current_profile_id uuid := public.current_profile_id();
  v_requester_id uuid;
  v_assignment_approver_id uuid;
  v_effective_approver_id uuid;
  v_has_fixed_assignment boolean := false;
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
  if p_cost_center_id is null or not exists (select 1 from public.cost_centers where id = p_cost_center_id) then
    raise exception 'El centro de costo indicado no existe';
  end if;
  if p_budget_category_id is null or not exists (select 1 from public.budget_categories where id = p_budget_category_id) then
    raise exception 'La partida presupuestal indicada no existe';
  end if;
  if p_budget_month is null then
    raise exception 'budget_month es obligatorio';
  end if;
  if p_amount_requested is null or p_amount_requested <= 0 then
    raise exception 'amount_requested debe ser mayor a 0';
  end if;

  select aa.approver_id
  into v_assignment_approver_id
  from public.approver_assignments aa
  where aa.company_id = p_company_id
    and aa.requester_id = v_requester_id;
  v_has_fixed_assignment := found;

  if v_has_fixed_assignment then
    if not public.is_payment_request_approver_for_company(v_assignment_approver_id, p_company_id) then
      raise exception 'fixed_approver_assignment_invalid';
    end if;
    if p_approver_id is not null and p_approver_id <> v_assignment_approver_id then
      raise exception 'fixed_approver_mismatch';
    end if;
    v_effective_approver_id := v_assignment_approver_id;
  else
    if p_approver_id is null then
      raise exception 'approver_id_required';
    end if;
    v_effective_approver_id := p_approver_id;
  end if;

  if v_effective_approver_id = v_requester_id then
    raise exception 'requester_cannot_be_own_approver';
  end if;
  if not public.is_payment_request_approver_for_company(v_effective_approver_id, p_company_id) then
    raise exception 'approver_not_eligible_for_company';
  end if;

  v_currency := upper(coalesce(nullif(trim(p_currency), ''), 'MXN'));
  v_exchange_rate := coalesce(p_exchange_rate, 1);
  if v_exchange_rate <= 0 then
    raise exception 'exchange_rate debe ser mayor a 0';
  end if;

  v_budget_month := date_trunc('month', p_budget_month)::date;
  v_budget_amount := round(p_amount_requested * v_exchange_rate, 2);
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
    budget_month, request_type, requested_by, approver_id, amount_requested,
    currency, exchange_rate, requires_invoice, invoice_received, status,
    concept, description, notes, submitted_at, request_number, budget_decision,
    budget_block_reason, budget_available_before, budget_available_after,
    budget_shortfall, budget_checked_at, budget_result,
    is_extraordinary_adjustment, created_at, updated_at
  ) values (
    null, p_proveedor_id, p_company_id, p_cost_center_id, p_budget_category_id,
    v_budget_month, 'provider_payment'::payment_request_type, v_requester_id,
    v_effective_approver_id, p_amount_requested, v_currency, v_exchange_rate,
    false, false, 'submitted'::payment_request_status, v_concept, p_description,
    p_notes, now(), v_request_number, v_budget_decision, v_budget_block_reason,
    v_available_before, v_available_after, v_shortfall, now(), v_budget_result,
    coalesce(p_is_extraordinary_adjustment, false), now(), now()
  ) returning id into v_payment_request_id;

  return jsonb_build_object(
    'payment_request_id', v_payment_request_id,
    'request_number', v_request_number,
    'status', 'submitted',
    'budget_decision', v_budget_decision,
    'budget_block_reason', v_budget_block_reason,
    'budget_result', v_budget_result,
    'approver_id', v_effective_approver_id,
    'fixed_approver', v_has_fixed_assignment
  );
end;
$$;

create or replace function public.decide_payment_request(
  p_payment_request_id uuid,
  p_actor_profile_id uuid,
  p_action text,
  p_comments text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.payment_requests%rowtype;
  v_current_profile_id uuid := public.current_profile_id();
  v_assigned_approver_id uuid;
  v_has_fixed_assignment boolean := false;
  v_previous_status text;
  v_new_status text;
  v_role_id uuid;
  v_rule_id uuid;
  v_approval_level integer;
  v_is_exception boolean;
  v_clean_comments text;
begin
  if v_current_profile_id is null then
    raise exception 'not_authenticated';
  end if;
  if p_actor_profile_id is null or p_actor_profile_id <> v_current_profile_id then
    raise exception 'actor_profile_must_match_current_profile';
  end if;

  v_clean_comments := nullif(btrim(coalesce(p_comments, '')), '');
  select * into v_request
  from public.payment_requests
  where id = p_payment_request_id
  for update;
  if not found then
    raise exception 'payment_request_not_found';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_actor_profile_id and coalesce(p.active, true)
  ) then
    raise exception 'actor_profile_not_found';
  end if;

  if p_action not in (
    'approved', 'rejected', 'changes_requested', 'exception_approved',
    'exception_rejected', 'amount_change_requested', 'category_change_requested',
    'budget_adjustment_requested'
  ) then
    raise exception 'invalid_action';
  end if;

  v_is_exception := (
    v_request.budget_decision = 'bloqueado'
    or coalesce(v_request.is_extraordinary_adjustment, false)
  );

  if p_action in (
    'exception_approved', 'exception_rejected', 'amount_change_requested',
    'category_change_requested', 'budget_adjustment_requested'
  ) and v_clean_comments is null then
    raise exception 'comments_required_for_exception_action';
  end if;
  if p_action = 'changes_requested' and v_clean_comments is null then
    raise exception 'comments_required_for_changes_requested';
  end if;
  if not v_is_exception and p_action not in ('approved', 'rejected', 'changes_requested') then
    raise exception 'exception_action_not_allowed_for_approvable_request';
  end if;
  if v_is_exception and p_action = 'approved' then
    raise exception 'normal_approval_not_allowed_for_budget_exception';
  end if;
  if v_is_exception and p_action not in (
    'exception_approved', 'exception_rejected', 'amount_change_requested',
    'category_change_requested', 'budget_adjustment_requested'
  ) then
    raise exception 'invalid_exception_action';
  end if;

  select aa.approver_id
  into v_assigned_approver_id
  from public.approver_assignments aa
  where aa.company_id = v_request.company_id
    and aa.requester_id = v_request.requested_by;
  v_has_fixed_assignment := found;

  if v_has_fixed_assignment then
    if not public.has_active_company_membership(v_request.requested_by, v_request.company_id)
       or not public.is_payment_request_approver_for_company(v_assigned_approver_id, v_request.company_id) then
      raise exception 'fixed_approver_assignment_invalid';
    end if;
    if p_actor_profile_id <> v_assigned_approver_id then
      raise exception 'fixed_approver_only';
    end if;

    select r.id
    into v_role_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.profile_id = p_actor_profile_id
      and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    order by lower(trim(r.name))
    limit 1;
    if v_role_id is null then
      raise exception 'fixed_approver_assignment_invalid';
    end if;
    v_rule_id := null;
    v_approval_level := 0;
  else
    if not exists (select 1 from public.user_roles ur where ur.profile_id = p_actor_profile_id) then
      raise exception 'actor_has_no_role';
    end if;

    select ar.id, ar.role_id, ar.approval_level
    into v_rule_id, v_role_id, v_approval_level
    from public.approval_rules ar
    join public.user_roles ur
      on ur.role_id = ar.role_id and ur.profile_id = p_actor_profile_id
    where ar.active = true
      and (ar.company_id is null or ar.company_id = v_request.company_id)
      and (ar.cost_center_id is null or ar.cost_center_id = v_request.cost_center_id)
      and coalesce(v_request.amount_requested, 0) >= ar.amount_min
      and (ar.amount_max is null or coalesce(v_request.amount_requested, 0) <= ar.amount_max)
      and (
        (p_action = 'approved' and ar.can_approve)
        or (p_action = 'exception_approved' and ar.can_approve and ar.can_approve_exception)
        or (p_action in ('rejected', 'exception_rejected') and ar.can_reject)
        or (p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') and ar.can_request_changes)
        or (p_action = 'budget_adjustment_requested' and ar.can_request_budget_adjustment)
      )
    order by
      case when ar.company_id is not null then 0 else 1 end,
      case when ar.cost_center_id is not null then 0 else 1 end,
      ar.approval_level asc
    limit 1;

    if v_rule_id is null then
      if p_action = 'exception_approved' then
        raise exception 'actor_cannot_approve_exception';
      elsif p_action = 'approved' then
        raise exception 'actor_cannot_approve';
      elsif p_action in ('rejected', 'exception_rejected') then
        raise exception 'actor_cannot_reject';
      elsif p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') then
        raise exception 'actor_cannot_request_changes';
      elsif p_action = 'budget_adjustment_requested' then
        raise exception 'actor_cannot_request_budget_adjustment';
      else
        raise exception 'approval_rule_not_found';
      end if;
    end if;
  end if;

  v_previous_status := v_request.status::text;
  v_new_status := case p_action
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    when 'changes_requested' then 'changes_requested'
    when 'exception_approved' then 'approved'
    when 'exception_rejected' then 'rejected'
    when 'amount_change_requested' then 'changes_requested'
    when 'category_change_requested' then 'changes_requested'
    when 'budget_adjustment_requested' then 'changes_requested'
  end;

  insert into public.payment_request_approvals (
    payment_request_id, actor_profile_id, role_id, action, from_status,
    to_status, comments, approval_level, budget_decision_snapshot,
    budget_block_reason_snapshot, budget_result_snapshot
  ) values (
    p_payment_request_id, p_actor_profile_id, v_role_id, p_action,
    v_previous_status, v_new_status, v_clean_comments, v_approval_level,
    v_request.budget_decision, v_request.budget_block_reason, v_request.budget_result
  );

  update public.payment_requests
  set status = v_new_status::public.payment_request_status,
      exception_status = case
        when p_action = 'exception_approved' then 'approved'
        when p_action = 'exception_rejected' then 'rejected'
        when p_action in ('amount_change_requested','category_change_requested','budget_adjustment_requested') then 'changes_requested'
        else exception_status
      end,
      exception_action = case when v_is_exception then p_action else exception_action end,
      exception_reason = case when v_is_exception then v_clean_comments else exception_reason end,
      exception_approved_by = case when p_action = 'exception_approved' then p_actor_profile_id else exception_approved_by end,
      exception_approved_at = case when p_action = 'exception_approved' then now() else exception_approved_at end,
      requires_budget_adjustment = case when p_action = 'budget_adjustment_requested' then true else requires_budget_adjustment end,
      operational_comments = coalesce(v_clean_comments, operational_comments),
      updated_at = now()
  where id = p_payment_request_id;

  return jsonb_build_object(
    'payment_request_id', p_payment_request_id,
    'previous_status', v_previous_status,
    'new_status', v_new_status,
    'action', p_action,
    'actor_profile_id', p_actor_profile_id,
    'budget_decision', v_request.budget_decision,
    'is_exception', v_is_exception,
    'fixed_approver_override', v_has_fixed_assignment,
    'message', 'decision_registered'
  );
end;
$$;

create or replace function public.enqueue_payment_request_created_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_role_name text;
  v_status text := 'pending';
  v_last_error text;
  v_payload jsonb;
begin
  if new.approver_id is null then
    v_status := 'dead_letter';
    v_last_error := 'missing_approver_profile_id';
  else
    select * into v_profile
    from public.profiles
    where id = new.approver_id and coalesce(active, true);

    if not found then
      v_status := 'dead_letter';
      v_last_error := 'approver_profile_not_found';
    elsif not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
      v_status := 'dead_letter';
      v_last_error := 'approver_not_eligible_for_company';
    elsif nullif(btrim(coalesce(v_profile.email, '')), '') is null then
      v_status := 'dead_letter';
      v_last_error := 'recipient_email_missing';
    end if;
  end if;

  select lower(trim(r.name)) into v_role_name
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = new.approver_id
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
  order by lower(trim(r.name))
  limit 1;

  v_payload := public.notification_payment_request_payload_with_extra(
    new.id,
    jsonb_build_object(
      'approver', coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email),
      'approver_profile_id', new.approver_id
    )
  );

  insert into public.notification_events (
    event_type, source_table, source_id, source_folio, recipient_type,
    recipient_profile_id, recipient_email, recipient_role, channel, priority,
    subject, payload, idempotency_key, status, last_error, next_attempt_at
  ) values (
    'payment_request.created', 'payment_requests', new.id, new.request_number,
    'administrador_sistema',
    case when v_profile.id is not null then v_profile.id else null end,
    case when v_status = 'pending' then nullif(btrim(v_profile.email), '') else null end,
    v_role_name, 'email', 'normal',
    'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
    v_payload,
    'payment_request.created:' || new.id::text || ':approver',
    v_status, v_last_error,
    case when v_status = 'pending' then now() else null end
  )
  on conflict (idempotency_key) do nothing;

  return new;
exception
  when others then
    insert into public.notification_events (
      event_type, source_table, source_id, source_folio, recipient_type,
      channel, priority, subject, payload, idempotency_key, status, last_error
    ) values (
      'payment_request.created', 'payment_requests', new.id, new.request_number,
      'administrador_sistema', 'email', 'normal',
      'Nueva solicitud de pago: ' || coalesce(new.request_number, new.id::text),
      jsonb_build_object('folio', new.request_number, 'path', '/solicitudes.html'),
      'payment_request.created:' || new.id::text || ':enqueue-error',
      'dead_letter', 'created_notification_enqueue_failed'
    )
    on conflict (idempotency_key) do nothing;
    return new;
end;
$$;

create or replace function public.enqueue_payment_request_decision_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
  v_request public.payment_requests%rowtype;
  v_subject text;
  v_idempotency_prefix text;
  v_decision_label text;
  v_payload jsonb;
  v_priority text;
  v_role_names text[] := array[]::text[];
begin
  select * into v_request
  from public.payment_requests
  where id = new.payment_request_id;
  if not found then
    return new;
  end if;

  v_event_type := case new.action
    when 'approved' then 'payment_request.approved'
    when 'rejected' then 'payment_request.rejected'
    when 'changes_requested' then 'payment_request.changes_requested'
    when 'amount_change_requested' then 'payment_request.changes_requested'
    when 'category_change_requested' then 'payment_request.changes_requested'
    when 'budget_adjustment_requested' then 'payment_request.changes_requested'
    when 'exception_approved' then 'payment_request.exception_approved'
    when 'exception_rejected' then 'payment_request.exception_rejected'
    else null
  end;
  if v_event_type is null then
    return new;
  end if;

  v_priority := case when v_event_type like 'payment_request.exception_%' then 'high' else 'normal' end;
  v_decision_label := public.notification_decision_label(v_event_type);
  v_payload := public.notification_payment_request_payload_with_extra(
    v_request.id,
    jsonb_build_object(
      'decision_action', new.action,
      'decision_comment', nullif(btrim(coalesce(new.comments, '')), ''),
      'decision_label', v_decision_label
    )
  );
  v_idempotency_prefix := v_event_type || ':' || new.payment_request_id::text || ':' || new.id::text;
  v_subject := case v_event_type
    when 'payment_request.approved' then 'Solicitud aprobada: '
    when 'payment_request.rejected' then 'Solicitud rechazada: '
    when 'payment_request.changes_requested' then 'Cambios solicitados: '
    when 'payment_request.exception_approved' then 'Excepcion presupuestal aprobada: '
    when 'payment_request.exception_rejected' then 'Excepcion presupuestal rechazada: '
    else 'Actualizacion de solicitud: '
  end || coalesce(v_request.request_number, new.payment_request_id::text);

  if v_event_type in ('payment_request.approved', 'payment_request.exception_approved') then
    v_role_names := array['finance', 'finanzas'];
  end if;

  with requester_candidate as (
    select
      10 as sort_rank,
      'usuario_solicitante'::text as recipient_type,
      p.id as recipient_profile_id,
      null::text as recipient_role,
      nullif(btrim(coalesce(p.email, '')), '') as recipient_email,
      case
        when v_request.requested_by is null then 'dead_letter'
        when p.id is null then 'dead_letter'
        when nullif(btrim(coalesce(p.email, '')), '') is null then 'dead_letter'
        else 'pending'
      end as status,
      case
        when v_request.requested_by is null then 'missing_recipient_profile_id'
        when p.id is null then 'recipient_profile_not_found'
        when nullif(btrim(coalesce(p.email, '')), '') is null then 'recipient_email_missing'
        else null::text
      end as last_error,
      v_payload as payload,
      v_idempotency_prefix || ':requester' as idempotency_key
    from (select 1) seed
    left join public.profiles p
      on p.id = v_request.requested_by and coalesce(p.active, true)
  ),
  role_candidates as (
    select distinct on (p.id)
      20 as sort_rank,
      'administrador_sistema'::text as recipient_type,
      p.id as recipient_profile_id,
      lower(trim(r.name)) as recipient_role,
      nullif(btrim(coalesce(p.email, '')), '') as recipient_email,
      case when nullif(btrim(coalesce(p.email, '')), '') is null then 'dead_letter' else 'pending' end as status,
      case when nullif(btrim(coalesce(p.email, '')), '') is null then 'recipient_email_missing' else null::text end as last_error,
      v_payload as payload,
      v_idempotency_prefix || ':role:' || p.id::text as idempotency_key
    from public.profile_company_memberships pcm
    join public.profiles p on p.id = pcm.profile_id
    join public.user_roles ur on ur.profile_id = p.id
    join public.roles r on r.id = ur.role_id
    where pcm.company_id = v_request.company_id
      and pcm.active
      and coalesce(p.active, true)
      and lower(trim(r.name)) = any (
        select lower(trim(role_name))
        from unnest(coalesce(v_role_names, array[]::text[])) as expected_roles(role_name)
      )
    order by p.id, lower(trim(r.name))
  ),
  role_missing_candidate as (
    select
      30 as sort_rank,
      'administrador_sistema'::text as recipient_type,
      null::uuid as recipient_profile_id,
      array_to_string(v_role_names, ',') as recipient_role,
      null::text as recipient_email,
      'dead_letter'::text as status,
      'role_recipient_missing'::text as last_error,
      v_payload as payload,
      v_idempotency_prefix || ':role:none' as idempotency_key
    where array_length(v_role_names, 1) is not null
      and not exists (select 1 from role_candidates)
  ),
  candidates as (
    select * from requester_candidate
    union all select * from role_candidates
    union all select * from role_missing_candidate
  ),
  ranked_candidates as (
    select candidates.*,
      row_number() over (
        partition by v_event_type, v_request.id, 'email',
          coalesce(
            nullif(lower(trim(candidates.recipient_email)), ''),
            case when candidates.recipient_profile_id is not null then 'profile:' || candidates.recipient_profile_id::text end,
            candidates.recipient_type || ':' || coalesce(candidates.recipient_role, '')
          )
        order by
          case when nullif(candidates.payload->>'decision_comment', '') is not null then 0 else 1 end,
          case when candidates.idempotency_key like '%:requester' then 0 else 1 end,
          candidates.sort_rank,
          candidates.idempotency_key
      ) as recipient_rank
    from candidates
  )
  insert into public.notification_events (
    event_type, source_table, source_id, source_folio, recipient_type,
    recipient_profile_id, recipient_email, recipient_role, channel, priority,
    subject, payload, idempotency_key, status, last_error, next_attempt_at
  )
  select v_event_type, 'payment_requests', v_request.id, v_request.request_number,
    recipient_type, recipient_profile_id,
    case when status = 'pending' then recipient_email else null end,
    recipient_role, 'email', v_priority, v_subject, payload, idempotency_key,
    status, last_error, case when status = 'pending' then now() else null end
  from ranked_candidates
  where recipient_rank = 1
  on conflict (idempotency_key) do nothing;

  return new;
exception
  when others then
    insert into public.notification_events (
      event_type, source_table, source_id, source_folio, recipient_type,
      channel, priority, subject, payload, idempotency_key, status, last_error
    ) values (
      coalesce(v_event_type, 'payment_request.notification_failed'),
      'payment_requests', new.payment_request_id, v_request.request_number,
      'administrador_sistema', 'email', coalesce(v_priority, 'normal'),
      coalesce(v_subject, 'Actualizacion de solicitud'),
      jsonb_build_object('folio', v_request.request_number, 'path', '/solicitudes.html'),
      'payment_request.notification_failed:' || new.payment_request_id::text || ':' || new.id::text,
      'dead_letter', 'decision_notification_enqueue_failed'
    )
    on conflict (idempotency_key) do nothing;
    return new;
end;
$$;

revoke all on function public.payment_request_approver_role_names() from public, anon;
revoke all on function public.has_active_company_membership(uuid, uuid) from public, anon;
revoke all on function public.is_payment_request_approver_for_company(uuid, uuid) from public, anon;
revoke all on function public.list_payment_request_approvers(uuid) from public, anon;
revoke all on function public.get_payment_request_approver_details(uuid) from public, anon;
revoke all on function public.list_profile_company_memberships() from public, anon;
revoke all on function public.set_profile_company_membership(uuid, uuid, boolean) from public, anon;
revoke all on function public.list_approver_assignments() from public, anon;
revoke all on function public.set_approver_assignment(uuid, uuid, uuid) from public, anon;
revoke all on function public.remove_approver_assignment(uuid, uuid) from public, anon;
revoke all on function public.create_payment_request(uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid) from public, anon;
revoke all on function public.decide_payment_request(uuid, uuid, text, text) from public, anon;

grant execute on function public.payment_request_approver_role_names() to authenticated;
grant execute on function public.has_active_company_membership(uuid, uuid) to authenticated;
grant execute on function public.is_payment_request_approver_for_company(uuid, uuid) to authenticated;
grant execute on function public.list_payment_request_approvers(uuid) to authenticated;
grant execute on function public.get_payment_request_approver_details(uuid) to authenticated;
grant execute on function public.list_profile_company_memberships() to authenticated;
grant execute on function public.set_profile_company_membership(uuid, uuid, boolean) to authenticated;
grant execute on function public.list_approver_assignments() to authenticated;
grant execute on function public.set_approver_assignment(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_approver_assignment(uuid, uuid) to authenticated;
grant execute on function public.create_payment_request(uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid) to authenticated;
grant execute on function public.decide_payment_request(uuid, uuid, text, text) to authenticated;

revoke all on function public.validate_approver_assignment() from public, anon, authenticated;
revoke all on function public.protect_assigned_company_membership() from public, anon, authenticated;
revoke all on function public.validate_payment_request_approver_scope() from public, anon, authenticated;
revoke all on function public.enqueue_payment_request_created_notification() from public, anon, authenticated;
revoke all on function public.enqueue_payment_request_decision_notification() from public, anon, authenticated;

grant execute on function public.validate_approver_assignment() to service_role, postgres;
grant execute on function public.protect_assigned_company_membership() to service_role, postgres;
grant execute on function public.validate_payment_request_approver_scope() to service_role, postgres;
grant execute on function public.enqueue_payment_request_created_notification() to service_role, postgres;
grant execute on function public.enqueue_payment_request_decision_notification() to service_role, postgres;

notify pgrst, 'reload schema';
