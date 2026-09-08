-- Responsable por partida presupuestal (per empresa).
-- Habilita el scoping "solo el responsable ve/usa su partida" (Fersana).
-- Aditivo: nullable. Empresas sin responsables (Operadora) no se ven afectadas.
alter table public.company_cost_center_budget_categories
  add column if not exists responsible_email text;
create index if not exists cccbc_responsible_email_idx
  on public.company_cost_center_budget_categories(responsible_email);
