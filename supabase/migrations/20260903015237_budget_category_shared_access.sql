-- Permite responsables adicionales por partida sin sustituir al responsable
-- principal de company_cost_center_budget_categories.responsible_email.
-- El acceso queda ligado a una membresía activa de la misma empresa.

create table public.budget_category_access_grants (
  company_id uuid not null,
  cost_center_id uuid not null,
  budget_category_id uuid not null,
  profile_id uuid not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, cost_center_id, budget_category_id, profile_id),
  constraint budget_category_access_grants_assignment_fkey
    foreign key (company_id, cost_center_id, budget_category_id)
    references public.company_cost_center_budget_categories (
      company_id, cost_center_id, budget_category_id
    ) on delete cascade,
  constraint budget_category_access_grants_membership_fkey
    foreign key (profile_id, company_id)
    references public.profile_company_memberships (profile_id, company_id)
    on delete cascade
);

create index budget_category_access_grants_profile_active_idx
  on public.budget_category_access_grants (
    profile_id, company_id, cost_center_id, budget_category_id
  )
  where active;

alter table public.budget_category_access_grants enable row level security;
alter table public.budget_category_access_grants force row level security;

revoke all on table public.budget_category_access_grants
  from public, anon, authenticated;
grant select on table public.budget_category_access_grants to authenticated;
grant select, insert, update, delete on table public.budget_category_access_grants
  to service_role;

create policy budget_category_access_grants_select_own
  on public.budget_category_access_grants
  for select
  to authenticated
  using (
    profile_id = (select public.current_profile_id())
    and active
    and public.has_active_company_membership(
      (select public.current_profile_id()), company_id
    )
  );

-- Concesión solicitada: Alfredo conserva responsible_email y Yanin obtiene
-- acceso adicional únicamente a Enseres de Soporte Fersana.
do $$
declare
  v_company_id uuid;
  v_cost_center_id uuid;
  v_budget_category_id uuid;
  v_profile_id uuid;
begin
  select relation.company_id, relation.cost_center_id, relation.budget_category_id
    into strict v_company_id, v_cost_center_id, v_budget_category_id
  from public.company_cost_center_budget_categories relation
  join public.companies company on company.id = relation.company_id
  join public.cost_centers cost_center on cost_center.id = relation.cost_center_id
  join public.budget_categories category on category.id = relation.budget_category_id
  where relation.active
    and lower(btrim(company.name)) = 'soporte fersana'
    and lower(btrim(cost_center.name)) = 'soporte fersana'
    and lower(btrim(category.name)) = 'enseres';

  select profile.id into strict v_profile_id
  from public.profiles profile
  join public.profile_company_memberships membership
    on membership.profile_id = profile.id
   and membership.company_id = v_company_id
   and membership.active
  where profile.active is distinct from false
    and lower(btrim(profile.email)) = 'ynavarrete@soportef.com';

  insert into public.budget_category_access_grants (
    company_id, cost_center_id, budget_category_id, profile_id, active
  )
  values (
    v_company_id, v_cost_center_id, v_budget_category_id, v_profile_id, true
  )
  on conflict (company_id, cost_center_id, budget_category_id, profile_id)
  do update set active = true, updated_at = now();
end
$$;

