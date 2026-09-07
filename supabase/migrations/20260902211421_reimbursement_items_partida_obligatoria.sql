-- Regla contable: incluso un gasto no deducible debe atribuirse a una
-- partida/departamento. La tabla estaba vacía al aplicar esta versión en DEV.
alter table public.reimbursement_items
  alter column budget_category_id set not null;

comment on column public.reimbursement_items.budget_category_id is
  'Obligatoria SIEMPRE, incluso en renglones no deducibles: es la que atribuye el gasto a su departamento/centro de costo (regla de contabilidad).';
