-- DEV hotfix: Yanin comparte exactamente las partidas activas de Lis en
-- Soporte Fersana, sin sustituir responsables primarios ni retirar accesos.
do $$
declare
  v_company_id uuid;
  v_cost_center_id uuid;
  v_yanin_profile_id uuid;
  v_lis_profile_id uuid;
  v_source_count integer;
  v_target_count integer;
begin
  select distinct relation.company_id, relation.cost_center_id
    into strict v_company_id, v_cost_center_id
  from public.company_cost_center_budget_categories relation
  join public.companies company on company.id = relation.company_id
  join public.cost_centers cost_center on cost_center.id = relation.cost_center_id
  where relation.active
    and lower(btrim(company.name)) = 'soporte fersana'
    and lower(btrim(cost_center.name)) = 'soporte fersana';

  select profile.id
    into strict v_yanin_profile_id
  from public.profiles profile
  join public.profile_company_memberships membership
    on membership.profile_id = profile.id
   and membership.company_id = v_company_id
   and membership.active
  where profile.active is distinct from false
    and lower(btrim(profile.email)) = 'ynavarrete@soportef.com';

  select profile.id
    into strict v_lis_profile_id
  from public.profiles profile
  join public.profile_company_memberships membership
    on membership.profile_id = profile.id
   and membership.company_id = v_company_id
   and membership.active
  where profile.active is distinct from false
    and lower(btrim(profile.email)) = 'lisette@dezdez.earth';

  select count(*)
    into v_source_count
  from public.company_cost_center_budget_categories relation
  where relation.company_id = v_company_id
    and relation.cost_center_id = v_cost_center_id
    and relation.active
    and lower(btrim(relation.responsible_email)) = 'lisette@dezdez.earth';

  if v_source_count <> 11 then
    raise exception 'Expected 11 active Lis categories in Soporte Fersana, found %', v_source_count;
  end if;

  insert into public.budget_category_access_grants (
    company_id,
    cost_center_id,
    budget_category_id,
    profile_id,
    active
  )
  select
    relation.company_id,
    relation.cost_center_id,
    relation.budget_category_id,
    v_yanin_profile_id,
    true
  from public.company_cost_center_budget_categories relation
  where relation.company_id = v_company_id
    and relation.cost_center_id = v_cost_center_id
    and relation.active
    and lower(btrim(relation.responsible_email)) = 'lisette@dezdez.earth'
  on conflict (company_id, cost_center_id, budget_category_id, profile_id)
  do update set active = true, updated_at = now();

  select count(*)
    into v_target_count
  from public.company_cost_center_budget_categories source
  join public.budget_category_access_grants target
    on target.company_id = source.company_id
   and target.cost_center_id = source.cost_center_id
   and target.budget_category_id = source.budget_category_id
   and target.profile_id = v_yanin_profile_id
   and target.active
  where source.company_id = v_company_id
    and source.cost_center_id = v_cost_center_id
    and source.active
    and lower(btrim(source.responsible_email)) = 'lisette@dezdez.earth';

  if v_target_count <> v_source_count then
    raise exception 'Yanin/Lis parity failed: expected %, found %', v_source_count, v_target_count;
  end if;
end
$$;
