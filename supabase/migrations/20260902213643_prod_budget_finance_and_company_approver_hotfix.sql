-- PROD hotfix: multi-responsible budget visibility + company-scoped approver routing.
--
-- Forward-only. Preserves the legacy primary responsible while allowing shared
-- category responsibility. The company membership role is authoritative;
-- legacy global roles are consulted only for memberships that predate role_key.

begin;

create table if not exists public.company_cost_center_budget_category_responsibles (
  company_id uuid not null,
  cost_center_id uuid not null,
  budget_category_id uuid not null,
  responsible_email text not null,
  created_at timestamptz not null default now(),
  created_by uuid null references public.profiles(id),
  constraint cccbc_responsibles_pkey primary key (
    company_id, cost_center_id, budget_category_id, responsible_email
  ),
  constraint cccbc_responsibles_category_fkey foreign key (
    company_id, cost_center_id, budget_category_id
  ) references public.company_cost_center_budget_categories (
    company_id, cost_center_id, budget_category_id
  ) on delete cascade,
  constraint cccbc_responsibles_email_normalized check (
    responsible_email = lower(btrim(responsible_email))
    and responsible_email <> ''
  )
);

alter table public.company_cost_center_budget_category_responsibles enable row level security;

drop policy if exists "company members can read budget category responsibles"
  on public.company_cost_center_budget_category_responsibles;
create policy "company members can read budget category responsibles"
  on public.company_cost_center_budget_category_responsibles
  for select
  to authenticated
  using (
    public.current_user_has_role(public.flux_sysadmin_roles())
    or public.has_active_company_membership(public.current_profile_id(), company_id)
  );

revoke all on table public.company_cost_center_budget_category_responsibles
  from public, anon, authenticated;
grant select on table public.company_cost_center_budget_category_responsibles
  to authenticated;
grant all on table public.company_cost_center_budget_category_responsibles
  to service_role;

-- Preserve every existing single-responsible assignment in the shared model.
insert into public.company_cost_center_budget_category_responsibles (
  company_id, cost_center_id, budget_category_id, responsible_email
)
select
  relation.company_id,
  relation.cost_center_id,
  relation.budget_category_id,
  lower(btrim(relation.responsible_email))
from public.company_cost_center_budget_categories relation
where nullif(btrim(relation.responsible_email), '') is not null
on conflict do nothing;

-- Araceli shares Yulma's current Fersana distribution; Yulma remains assigned.
insert into public.company_cost_center_budget_category_responsibles (
  company_id, cost_center_id, budget_category_id, responsible_email, created_by
)
select
  relation.company_id,
  relation.cost_center_id,
  relation.budget_category_id,
  'agalvan@fluxfinanciera.com',
  araceli.id
from public.company_cost_center_budget_categories relation
join public.companies company_row on company_row.id = relation.company_id
join public.profiles araceli
  on lower(btrim(araceli.email)) = 'agalvan@fluxfinanciera.com'
where lower(btrim(company_row.name)) = 'soporte fersana'
  and lower(btrim(relation.responsible_email)) = 'ychavez@fluxfinanciera.com'
on conflict do nothing;

create or replace function private.profile_company_approver_roles(
  p_profile_id uuid,
  p_company_id uuid
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(array_agg(candidate.role_name order by candidate.role_name), array[]::text[])
  from (
    select distinct lower(trim(
      case
        when nullif(btrim(pcm.role_key), '') is not null then pcm.role_key
        else role_row.name
      end
    )) as role_name
    from public.profile_company_memberships pcm
    left join public.user_roles legacy
      on legacy.profile_id = pcm.profile_id
     and nullif(btrim(pcm.role_key), '') is null
    left join public.roles role_row on role_row.id = legacy.role_id
    where pcm.profile_id = p_profile_id
      and pcm.company_id = p_company_id
      and pcm.active
  ) candidate
  where candidate.role_name = any (public.payment_request_approver_role_names());
$function$;

revoke all on function private.profile_company_approver_roles(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.is_payment_request_approver_for_company(
  p_profile_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select cardinality(
    private.profile_company_approver_roles(p_profile_id, p_company_id)
  ) > 0;
$function$;

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
set search_path = ''
as $function$
  select public.is_payment_request_approver_for_company(p_profile_id, p_company_id)
    and exists (
      select 1
      from public.approval_rules ar
      join public.roles rule_role on rule_role.id = ar.role_id
      where ar.active
        and lower(trim(rule_role.name)) = any (
          private.profile_company_approver_roles(p_profile_id, p_company_id)
        )
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
$function$;

create or replace function public.list_company_approver_candidates(
  p_company_id uuid,
  p_requester_id uuid
)
returns table(
  profile_id uuid,
  display_name text,
  email text,
  eligible_roles text[]
)
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
begin
  if not public.current_user_has_role(public.flux_sysadmin_roles()) then
    raise exception 'routing_admin_required';
  end if;

  return query
  select
    profile_row.id,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
    profile_row.email,
    private.profile_company_approver_roles(profile_row.id, p_company_id)
  from public.profile_company_memberships membership
  join public.profiles profile_row on profile_row.id = membership.profile_id
  where membership.company_id = p_company_id
    and membership.active
    and coalesce(profile_row.active, true)
    and profile_row.id <> p_requester_id
    and cardinality(private.profile_company_approver_roles(profile_row.id, p_company_id)) > 0
    and not exists (
      select 1
      from public.approver_assignments assignment
      where assignment.company_id = p_company_id
        and assignment.requester_id = p_requester_id
        and assignment.approver_id = profile_row.id
        and assignment.active
    )
  order by coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email);
end;
$function$;

create or replace function public.add_approver_assignment(
  p_company_id uuid,
  p_requester_id uuid,
  p_approver_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
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
  if not public.has_active_company_membership(p_approver_id, p_company_id) then
    raise exception 'approver_company_membership_required';
  end if;
  if cardinality(private.profile_company_approver_roles(p_approver_id, p_company_id)) = 0 then
    raise exception 'approver_role_required';
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
$function$;

create or replace function public.validate_approver_assignment()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if new.requester_id = new.approver_id then
    raise exception 'requester_cannot_be_own_pool_approver';
  end if;
  if new.active then
    if not public.has_active_company_membership(new.requester_id, new.company_id) then
      raise exception 'requester_company_membership_required';
    end if;
    if not public.has_active_company_membership(new.approver_id, new.company_id) then
      raise exception 'approver_company_membership_required';
    end if;
    if cardinality(private.profile_company_approver_roles(new.approver_id, new.company_id)) = 0 then
      raise exception 'approver_role_required';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.list_payment_request_approver_options(
  p_company_id uuid,
  p_cost_center_id uuid,
  p_amount numeric
)
returns table(
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
set search_path = 'public'
as $function$
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
      profile_row.id,
      coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
      profile_row.email,
      private.profile_company_approver_roles(profile_row.id, p_company_id),
      'assigned'::text,
      assignment.id,
      coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email)
        || ' - ' || array_to_string(
          private.profile_company_approver_roles(profile_row.id, p_company_id), ', '
        )
    from public.approver_assignments assignment
    join public.profiles profile_row on profile_row.id = assignment.approver_id
    join public.profile_company_memberships membership
      on membership.profile_id = profile_row.id
     and membership.company_id = assignment.company_id
     and membership.active
    where assignment.requester_id = v_requester_id
      and assignment.company_id = p_company_id
      and assignment.active
      and coalesce(profile_row.active, true)
      and cardinality(private.profile_company_approver_roles(profile_row.id, p_company_id)) > 0
    order by coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email);
    return;
  end if;

  if p_cost_center_id is null or p_amount is null or p_amount <= 0 then
    return;
  end if;

  return query
  select
    profile_row.id,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
    profile_row.email,
    private.profile_company_approver_roles(profile_row.id, p_company_id),
    'approval_rules'::text,
    null::uuid,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email)
      || ' - ' || array_to_string(
        private.profile_company_approver_roles(profile_row.id, p_company_id), ', '
      )
  from public.profile_company_memberships membership
  join public.profiles profile_row on profile_row.id = membership.profile_id
  where membership.company_id = p_company_id
    and membership.active
    and coalesce(profile_row.active, true)
    and profile_row.id <> v_requester_id
    and cardinality(private.profile_company_approver_roles(profile_row.id, p_company_id)) > 0
    and public.payment_request_rule_allows(
      profile_row.id, p_company_id, p_cost_center_id, p_amount, 'approved'
    )
  order by coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email);
end;
$function$;

create or replace function public.get_payment_request_approver_details(
  p_payment_request_id uuid
)
returns table(
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
set search_path = 'public'
as $function$
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
      private.current_profile_has_company_role(
        v_request.company_id, array['finance','director']::text[]
      )
      and public.has_active_company_membership(v_actor_id, v_request.company_id)
    )
  ) then
    raise exception 'payment_request_not_visible';
  end if;

  return query
  select
    profile_row.id,
    coalesce(nullif(btrim(profile_row.full_name), ''), profile_row.email),
    profile_row.email,
    v_request.approver_assignment_id is not null,
    coalesce(v_request.approver_selection_source, 'historical'),
    coalesce(
      private.profile_company_approver_roles(profile_row.id, v_request.company_id),
      array[]::text[]
    )
  from (select 1) seed
  left join public.profiles profile_row on profile_row.id = v_request.approver_id;
end;
$function$;

-- The decision RPC is large and independently hardened. Replace only its three
-- legacy role lookups, with exact count gates so unexpected PROD drift aborts.
do $rewrite_decision$
declare
  v_target regprocedure := to_regprocedure('public.decide_payment_request(uuid,uuid,text,text)');
  v_definition text;
  v_old text;
  v_new text;
begin
  if v_target is null then
    raise exception 'decide_payment_request_missing';
  end if;
  v_definition := pg_get_functiondef(v_target);

  v_old := $old$
    select r.id into v_role_id
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.profile_id = p_actor_profile_id
    order by
      case when lower(trim(r.name)) = any (public.payment_request_approver_role_names()) then 0 else 1 end,
      lower(trim(r.name))
    limit 1;$old$;
  v_new := $new$
    select r.id into v_role_id
    from public.roles r
    where lower(trim(r.name)) = any (
      private.profile_company_approver_roles(p_actor_profile_id, v_request.company_id)
    )
    order by lower(trim(r.name))
    limit 1;$new$;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'decide_payment_request_assignment_role_drift';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
    if not exists (
      select 1 from public.user_roles ur where ur.profile_id = p_actor_profile_id
    ) then
      raise exception 'actor_has_no_role';
    end if;$old$;
  v_new := $new$
    if cardinality(
      private.profile_company_approver_roles(p_actor_profile_id, v_request.company_id)
    ) = 0 then
      raise exception 'actor_has_no_role';
    end if;$new$;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'decide_payment_request_actor_role_drift';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$
    from public.approval_rules ar
    join public.user_roles ur
      on ur.role_id = ar.role_id and ur.profile_id = p_actor_profile_id
    join public.roles rule_role on rule_role.id = ar.role_id$old$;
  v_new := $new$
    from public.approval_rules ar
    join public.roles rule_role on rule_role.id = ar.role_id
      and lower(trim(rule_role.name)) = any (
        private.profile_company_approver_roles(p_actor_profile_id, v_request.company_id)
      )$new$;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'decide_payment_request_rule_role_drift';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$rewrite_decision$;

-- Preserve the existing public RPC privilege surface after CREATE OR REPLACE.
revoke all on function public.is_payment_request_approver_for_company(uuid, uuid) from public, anon;
revoke all on function public.payment_request_rule_allows(uuid, uuid, uuid, numeric, text) from public, anon;
revoke all on function public.list_company_approver_candidates(uuid, uuid) from public, anon;
revoke all on function public.add_approver_assignment(uuid, uuid, uuid) from public, anon;
revoke all on function public.list_payment_request_approver_options(uuid, uuid, numeric) from public, anon;
revoke all on function public.get_payment_request_approver_details(uuid) from public, anon;

grant execute on function public.is_payment_request_approver_for_company(uuid, uuid) to authenticated, service_role;
grant execute on function public.payment_request_rule_allows(uuid, uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.list_company_approver_candidates(uuid, uuid) to authenticated, service_role;
grant execute on function public.add_approver_assignment(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.list_payment_request_approver_options(uuid, uuid, numeric) to authenticated, service_role;
grant execute on function public.get_payment_request_approver_details(uuid) to authenticated, service_role;

commit;
