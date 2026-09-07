-- Extiende FONACOT no presupuestal a Soporte Fersana.
-- La categoría y sus reglas fueron creadas por
-- 20260903041213_fonacot_no_presupuestal.sql.
do $function$
declare
  v_company_id uuid;
  v_cost_center_id uuid;
  v_budget_category_id uuid;
begin
  select company.id, cost_center.id, category.id
    into strict v_company_id, v_cost_center_id, v_budget_category_id
  from public.companies company
  join public.company_cost_centers company_cost_center
    on company_cost_center.company_id = company.id
   and company_cost_center.active
  join public.cost_centers cost_center
    on cost_center.id = company_cost_center.cost_center_id
  cross join public.budget_categories category
  where company.active
    and cost_center.active
    and lower(btrim(company.name)) = 'soporte fersana'
    and lower(btrim(cost_center.name)) = 'soporte fersana'
    and category.code = 'FONACOT'
    and category.no_presupuestal;

  insert into public.company_cost_center_budget_categories (
    company_id, cost_center_id, budget_category_id, active
  ) values (
    v_company_id, v_cost_center_id, v_budget_category_id, true
  )
  on conflict (company_id, cost_center_id, budget_category_id)
  do update set active = true;
end;
$function$;
