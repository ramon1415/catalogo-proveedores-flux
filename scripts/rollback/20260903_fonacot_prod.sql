-- Rollback operativo y no destructivo del release FONACOT PROD.
-- Conserva columnas/snapshots históricos y revoca únicamente la exposición
-- del catálogo en Operadora Tlacatecpan y Soporte Fersana.
begin;

update public.company_cost_center_budget_categories relation
set active = false
from public.companies company,
     public.cost_centers cost_center,
     public.budget_categories category
where relation.company_id = company.id
  and relation.cost_center_id = cost_center.id
  and relation.budget_category_id = category.id
  and category.code = 'FONACOT'
  and (
    (
      lower(btrim(company.name)) = 'operadora tlacatecpan'
      and lower(btrim(cost_center.name)) = 'rancho san juan tlacatecpan'
    )
    or (
      lower(btrim(company.name)) = 'soporte fersana'
      and lower(btrim(cost_center.name)) = 'soporte fersana'
    )
  );

update public.budget_categories
set active = false,
    updated_at = now()
where code = 'FONACOT';

commit;
