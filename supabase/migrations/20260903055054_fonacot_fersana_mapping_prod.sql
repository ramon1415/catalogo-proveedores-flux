-- Compatibilidad PROD: Fersana existe, pero su relación empresa-centro no fue
-- materializada. Se asegura por claves naturales antes de asignar FONACOT.
do $function$
declare
  v_company_id uuid;
  v_cost_center_id uuid;
  v_budget_category_id uuid;
begin
  select id into strict v_company_id
  from public.companies
  where active and lower(btrim(name)) = 'soporte fersana';

  select id into strict v_cost_center_id
  from public.cost_centers
  where active and lower(btrim(name)) = 'soporte fersana';

  select id into strict v_budget_category_id
  from public.budget_categories
  where code = 'FONACOT' and active and no_presupuestal;

  update public.company_cost_centers
  set active = true
  where company_id = v_company_id
    and cost_center_id = v_cost_center_id;

  if not found then
    insert into public.company_cost_centers (
      company_id, cost_center_id, active
    ) values (
      v_company_id, v_cost_center_id, true
    );
  end if;

  insert into public.company_cost_center_budget_categories (
    company_id, cost_center_id, budget_category_id, active
  ) values (
    v_company_id, v_cost_center_id, v_budget_category_id, true
  )
  on conflict (company_id, cost_center_id, budget_category_id)
  do update set active = true;
end;
$function$;
