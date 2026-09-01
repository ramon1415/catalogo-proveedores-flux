-- Backport desde prod (20260901080146). Hardening: evita asignaciones duplicadas
-- de la misma partida a la misma empresa+centro de costo.
alter table public.company_cost_center_budget_categories
  add constraint company_cost_center_budget_categories_company_cost_category_key
  unique (company_id, cost_center_id, budget_category_id);
