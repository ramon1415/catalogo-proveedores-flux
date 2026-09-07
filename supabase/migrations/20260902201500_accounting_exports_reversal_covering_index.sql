-- FB-Integración · forward-fix 2 (advisor de rendimiento tras 20260902200000).
-- La FK compuesta accounting_exports_reversal_same_company_fkey (company_id,
-- reversal_of) necesita un índice cuyo prefijo sean ESAS dos columnas; el
-- índice parcial sobre reversal_of solo no la cubre (unindexed_foreign_keys).
-- Se reemplaza por el compuesto y se retira el parcial para no dejar un
-- índice redundante (unused_index).
create index if not exists accounting_exports_company_reversal_of_idx
  on public.accounting_exports (company_id, reversal_of);
drop index if exists public.accounting_exports_reversal_of_idx;

do $post$
begin
  if not exists (select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'accounting_exports_company_reversal_of_idx') then
    raise exception 'fb_forward_fix_2: falta accounting_exports_company_reversal_of_idx';
  end if;
end
$post$;
