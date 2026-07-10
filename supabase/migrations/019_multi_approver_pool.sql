-- Flux Operadora - Migration 019
-- Multiple approvers per requester with request-level selection snapshots.

alter table public.approver_assignments
  add column if not exists active boolean not null default true,
  add column if not exists created_by uuid,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.approver_assignments'::regclass
      and conname = 'approver_assignments_created_by_fkey'
  ) then
    alter table public.approver_assignments
      add constraint approver_assignments_created_by_fkey
      foreign key (created_by) references public.profiles(id) on delete set null;
  end if;
end
$$;

alter table public.approver_assignments
  drop constraint if exists approver_assignments_company_requester_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.approver_assignments'::regclass
      and conname = 'approver_assignments_company_requester_approver_key'
  ) then
    alter table public.approver_assignments
      add constraint approver_assignments_company_requester_approver_key
      unique (company_id, requester_id, approver_id);
  end if;
end
$$;

create index if not exists approver_assignments_active_pool_idx
  on public.approver_assignments(company_id, requester_id, active);

alter table public.payment_requests
  add column if not exists approver_assignment_id uuid,
  add column if not exists approver_selection_source text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_approver_selection_source_check'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_approver_selection_source_check
      check (approver_selection_source is null or approver_selection_source in ('assigned', 'approval_rules'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_requests'::regclass
      and conname = 'payment_requests_approver_assignment_id_fkey'
  ) then
    alter table public.payment_requests
      add constraint payment_requests_approver_assignment_id_fkey
      foreign key (approver_assignment_id)
      references public.approver_assignments(id) on delete restrict;
  end if;
end
$$;

create index if not exists payment_requests_approver_assignment_id_idx
  on public.payment_requests(approver_assignment_id);

create or replace function public.payment_request_has_active_approver_pool(
  p_requester_id uuid,
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
    from public.approver_assignments aa
    where aa.requester_id = p_requester_id
      and aa.company_id = p_company_id
      and aa.active
  );
$$;

create or replace function public.payment_request_rule_allows(
  p_profile_id uuid,
  p_company_id uuid,
  p_cost_center_id uuid,
  p_amount numeric,
  p_action text default 'approved'
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_payment_request_approver_for_company(p_profile_id, p_company_id)
    and exists (
      select 1
      from public.approval_rules ar
      join public.user_roles ur
        on ur.role_id = ar.role_id
       and ur.profile_id = p_profile_id
      join public.roles rule_role on rule_role.id = ar.role_id
      where ar.active
        and lower(trim(rule_role.name)) = any (public.payment_request_approver_role_names())
        and (ar.company_id is null or ar.company_id = p_company_id)
        and (ar.cost_center_id is null or ar.cost_center_id = p_cost_center_id)
        and coalesce(p_amount, 0) >= ar.amount_min
        and (ar.amount_max is null or coalesce(p_amount, 0) <= ar.amount_max)
        and case p_action
          when 'approved' then ar.can_approve
          when 'exception_approved' then ar.can_approve and ar.can_approve_exception
          when 'rejected' then ar.can_reject
          when 'exception_rejected' then ar.can_reject
          when 'changes_requested' then ar.can_request_changes
          when 'amount_change_requested' then ar.can_request_changes
          when 'category_change_requested' then ar.can_request_changes
          when 'budget_adjustment_requested' then ar.can_request_budget_adjustment
          else false
        end
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
    raise exception 'requester_cannot_be_own_pool_approver';
  end if;

  if new.active then
    if not public.has_active_company_membership(new.requester_id, new.company_id) then
      raise exception 'requester_company_membership_required';
    end if;
    if not public.is_payment_request_approver_for_company(new.approver_id, new.company_id) then
      raise exception 'approver_not_eligible_for_company';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

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
    v_deactivating := (old.active and not new.active)
      or new.profile_id is distinct from old.profile_id
      or new.company_id is distinct from old.company_id;
  end if;

  if v_deactivating and exists (
    select 1
    from public.approver_assignments aa
    where aa.company_id = v_company_id
      and aa.active
      and (aa.requester_id = v_profile_id or aa.approver_id = v_profile_id)
  ) then
    raise exception 'membership_used_by_active_approver_pool';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.validate_payment_request_approver_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

drop trigger if exists validate_payment_request_approver_scope_update on public.payment_requests;
create trigger validate_payment_request_approver_scope_update
  before update of approver_id, approver_assignment_id, approver_selection_source, company_id, requested_by, cost_center_id, amount_requested
  on public.payment_requests
  for each row execute function public.validate_payment_request_approver_scope();

revoke insert, update, delete on table public.profile_company_memberships from authenticated;
revoke insert, update, delete on table public.approver_assignments from authenticated;

drop function if exists public.list_payment_request_approvers(uuid);

create or replace function public.list_payment_request_approver_options(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_amount numeric
)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  eligible_roles text[],
  source text,
  assignment_id uuid,
  option_label text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_requester_id uuid := public.current_profile_id();
  v_has_pool boolean;
begin
  if v_requester_id is null then
    raise exception 'not_authenticated';
  end if;
  if not public.has_active_company_membership(v_requester_id, p_company_id)
     and not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'company_scope_required';
  end if;

  v_has_pool := public.payment_request_has_active_approver_pool(v_requester_id, p_company_id);

  if v_has_pool then
    return query
    select
      p.id,
      coalesce(nullif(btrim(p.full_name), ''), p.email),
      p.email,
      array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))),
      'assigned'::text,
      aa.id,
      coalesce(nullif(btrim(p.full_name), ''), p.email)
        || ' - '
        || array_to_string(array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))), ', ')
    from public.approver_assignments aa
    join public.profiles p on p.id = aa.approver_id
    join public.profile_company_memberships pcm
      on pcm.profile_id = p.id and pcm.company_id = aa.company_id and pcm.active
    join public.user_roles ur on ur.profile_id = p.id
    join public.roles r on r.id = ur.role_id
    where aa.requester_id = v_requester_id
      and aa.company_id = p_company_id
      and aa.active
      and coalesce(p.active, true)
      and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    group by aa.id, p.id, p.full_name, p.email
    order by coalesce(nullif(btrim(p.full_name), ''), p.email);
    return;
  end if;

  if p_cost_center_id is null or p_amount is null or p_amount <= 0 then
    return;
  end if;

  return query
  select
    p.id,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    p.email,
    array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))),
    'approval_rules'::text,
    null::uuid,
    coalesce(nullif(btrim(p.full_name), ''), p.email)
      || ' - '
      || array_to_string(array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))), ', ')
  from public.profile_company_memberships pcm
  join public.profiles p on p.id = pcm.profile_id
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where pcm.company_id = p_company_id
    and pcm.active
    and coalesce(p.active, true)
    and p.id <> v_requester_id
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    and public.payment_request_rule_allows(
      p.id, p_company_id, p_cost_center_id, p_amount, 'approved'
    )
  group by p.id, p.full_name, p.email
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

create or replace function public.list_company_approver_candidates(
  p_company_id uuid,
  p_requester_id uuid
)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  eligible_roles text[]
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
  select
    p.id,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    p.email,
    array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name)))
  from public.profile_company_memberships pcm
  join public.profiles p on p.id = pcm.profile_id
  join public.user_roles ur on ur.profile_id = p.id
  join public.roles r on r.id = ur.role_id
  where pcm.company_id = p_company_id
    and pcm.active
    and coalesce(p.active, true)
    and p.id <> p_requester_id
    and lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    and not exists (
      select 1
      from public.approver_assignments aa
      where aa.company_id = p_company_id
        and aa.requester_id = p_requester_id
        and aa.approver_id = p.id
        and aa.active
    )
  group by p.id, p.full_name, p.email
  order by coalesce(nullif(btrim(p.full_name), ''), p.email);
end;
$$;

drop function if exists public.list_approver_assignments();
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
  approver_roles text[],
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
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
  select
    aa.id,
    c.id,
    coalesce(nullif(btrim(c.legal_name), ''), c.name),
    requester.id,
    requester.full_name,
    requester.email,
    approver.id,
    approver.full_name,
    approver.email,
    coalesce(array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))) filter (
      where lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    ), array[]::text[]),
    aa.active,
    aa.created_at,
    aa.updated_at
  from public.approver_assignments aa
  join public.companies c on c.id = aa.company_id
  join public.profiles requester on requester.id = aa.requester_id
  join public.profiles approver on approver.id = aa.approver_id
  left join public.user_roles ur on ur.profile_id = approver.id
  left join public.roles r on r.id = ur.role_id
  group by aa.id, c.id, c.legal_name, c.name, requester.id, approver.id
  order by coalesce(nullif(btrim(c.legal_name), ''), c.name),
           coalesce(nullif(btrim(requester.full_name), ''), requester.email),
           aa.active desc,
           coalesce(nullif(btrim(approver.full_name), ''), approver.email);
end;
$$;

drop function if exists public.set_approver_assignment(uuid, uuid, uuid);
create or replace function public.add_approver_assignment(
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
  if p_requester_id = p_approver_id then
    raise exception 'requester_cannot_be_own_pool_approver';
  end if;
  if not public.has_active_company_membership(p_requester_id, p_company_id) then
    raise exception 'requester_company_membership_required';
  end if;
  if not public.is_payment_request_approver_for_company(p_approver_id, p_company_id) then
    raise exception 'approver_not_eligible_for_company';
  end if;

  insert into public.approver_assignments (
    company_id, requester_id, approver_id, active, created_by, updated_at
  ) values (
    p_company_id, p_requester_id, p_approver_id, true,
    public.current_profile_id(), now()
  )
  on conflict (company_id, requester_id, approver_id)
  do update set active = true, updated_at = now()
  where not approver_assignments.active
  returning id into v_id;

  if v_id is null then
    raise exception 'approver_already_configured';
  end if;

  return v_id;
end;
$$;

drop function if exists public.remove_approver_assignment(uuid, uuid);
create or replace function public.remove_approver_assignment(p_assignment_id uuid)
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

  update public.approver_assignments
  set active = false, updated_at = now()
  where id = p_assignment_id
    and active;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

drop function if exists public.get_payment_request_approver_details(uuid);
create or replace function public.get_payment_request_approver_details(p_payment_request_id uuid)
returns table (
  profile_id uuid,
  display_name text,
  email text,
  is_fixed boolean,
  source text,
  eligible_roles text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.current_profile_id();
  v_request public.payment_requests%rowtype;
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

  return query
  select
    p.id,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    p.email,
    v_request.approver_assignment_id is not null,
    coalesce(v_request.approver_selection_source, 'historical'),
    coalesce(array_agg(distinct lower(trim(r.name)) order by lower(trim(r.name))) filter (
      where lower(trim(r.name)) = any (public.payment_request_approver_role_names())
    ), array[]::text[])
  from (select 1) seed
  left join public.profiles p on p.id = v_request.approver_id
  left join public.user_roles ur on ur.profile_id = p.id
  left join public.roles r on r.id = ur.role_id
  group by p.id, p.full_name, p.email;
end;
$$;

drop function if exists public.create_payment_request(
  uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid
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
  p_approver_assignment_id uuid default null::uuid
)
returns jsonb
language plpgsql
as $$
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
    budget_month, request_type, requested_by, approver_id, approver_assignment_id,
    approver_selection_source,
    amount_requested, currency, exchange_rate, requires_invoice, invoice_received,
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
    v_exchange_rate, false, false, 'submitted'::payment_request_status,
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
  v_assignment public.approver_assignments%rowtype;
  v_current_profile_id uuid := public.current_profile_id();
  v_previous_status text;
  v_new_status text;
  v_role_id uuid;
  v_rule_id uuid;
  v_approval_level integer;
  v_is_exception boolean;
  v_clean_comments text;
  v_uses_assignment_snapshot boolean := false;
  v_legacy_assignment_override boolean := false;
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

  if v_request.approver_id is not null
     and p_actor_profile_id <> v_request.approver_id then
    raise exception 'selected_approver_only';
  end if;

  -- Migration 018 did not store the assignment id. Preserve its override only
  -- when the same assignment already existed when the request was created.
  if v_request.approver_assignment_id is null
     and v_request.approver_selection_source is null
     and v_request.approver_id is not null then
    select * into v_assignment
    from public.approver_assignments aa
    where aa.company_id = v_request.company_id
      and aa.requester_id = v_request.requested_by
      and aa.approver_id = v_request.approver_id
      and aa.created_at <= v_request.created_at
    order by aa.created_at desc
    limit 1;
    v_legacy_assignment_override := found;
  end if;

  if v_request.approver_assignment_id is not null or v_legacy_assignment_override then
    if v_request.approver_assignment_id is not null then
      select * into v_assignment
      from public.approver_assignments aa
      where aa.id = v_request.approver_assignment_id;
    end if;
    if not found
       or v_assignment.company_id <> v_request.company_id
       or v_assignment.requester_id <> v_request.requested_by
       or v_assignment.approver_id <> v_request.approver_id then
      raise exception 'approver_assignment_snapshot_invalid';
    end if;

    select r.id into v_role_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.profile_id = p_actor_profile_id
    order by
      case when lower(trim(r.name)) = any (public.payment_request_approver_role_names()) then 0 else 1 end,
      lower(trim(r.name))
    limit 1;
    v_rule_id := null;
    v_approval_level := 0;
    v_uses_assignment_snapshot := true;
  else
    if not exists (
      select 1 from public.user_roles ur where ur.profile_id = p_actor_profile_id
    ) then
      raise exception 'actor_has_no_role';
    end if;

    select ar.id, ar.role_id, ar.approval_level
    into v_rule_id, v_role_id, v_approval_level
    from public.approval_rules ar
    join public.user_roles ur
      on ur.role_id = ar.role_id and ur.profile_id = p_actor_profile_id
    join public.roles rule_role on rule_role.id = ar.role_id
    where ar.active
      and (
        v_request.approver_id is null
        or lower(trim(rule_role.name)) = any (public.payment_request_approver_role_names())
      )
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
        raise exception 'selected_approver_cannot_approve_exception';
      elsif p_action = 'approved' then
        raise exception 'selected_approver_cannot_approve';
      elsif p_action in ('rejected', 'exception_rejected') then
        raise exception 'selected_approver_cannot_reject';
      elsif p_action in ('changes_requested', 'amount_change_requested', 'category_change_requested') then
        raise exception 'selected_approver_cannot_request_changes';
      elsif p_action = 'budget_adjustment_requested' then
        raise exception 'selected_approver_cannot_request_budget_adjustment';
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
    'assignment_snapshot_override', v_uses_assignment_snapshot,
    'legacy_assignment_override', v_legacy_assignment_override,
    'message', 'decision_registered'
  );
end;
$$;

revoke all on function public.payment_request_has_active_approver_pool(uuid, uuid) from public, anon;
revoke all on function public.payment_request_rule_allows(uuid, uuid, uuid, numeric, text) from public, anon;
revoke all on function public.list_payment_request_approver_options(uuid, uuid, numeric) from public, anon;
revoke all on function public.list_company_approver_candidates(uuid, uuid) from public, anon;
revoke all on function public.list_approver_assignments() from public, anon;
revoke all on function public.add_approver_assignment(uuid, uuid, uuid) from public, anon;
revoke all on function public.remove_approver_assignment(uuid) from public, anon;
revoke all on function public.get_payment_request_approver_details(uuid) from public, anon;
revoke all on function public.create_payment_request(uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid, uuid) from public, anon;
revoke all on function public.decide_payment_request(uuid, uuid, text, text) from public, anon;

grant execute on function public.payment_request_has_active_approver_pool(uuid, uuid) to authenticated;
grant execute on function public.payment_request_rule_allows(uuid, uuid, uuid, numeric, text) to authenticated;
grant execute on function public.list_payment_request_approver_options(uuid, uuid, numeric) to authenticated;
grant execute on function public.list_company_approver_candidates(uuid, uuid) to authenticated;
grant execute on function public.list_approver_assignments() to authenticated;
grant execute on function public.add_approver_assignment(uuid, uuid, uuid) to authenticated;
grant execute on function public.remove_approver_assignment(uuid) to authenticated;
grant execute on function public.get_payment_request_approver_details(uuid) to authenticated;
grant execute on function public.create_payment_request(uuid, uuid, uuid, uuid, date, numeric, text, numeric, text, text, uuid, boolean, uuid, uuid) to authenticated;
grant execute on function public.decide_payment_request(uuid, uuid, text, text) to authenticated;

revoke all on function public.validate_approver_assignment() from public, anon, authenticated;
revoke all on function public.protect_assigned_company_membership() from public, anon, authenticated;
revoke all on function public.validate_payment_request_approver_scope() from public, anon, authenticated;
grant execute on function public.validate_approver_assignment() to service_role, postgres;
grant execute on function public.protect_assigned_company_membership() to service_role, postgres;
grant execute on function public.validate_payment_request_approver_scope() to service_role, postgres;

notify pgrst, 'reload schema';
