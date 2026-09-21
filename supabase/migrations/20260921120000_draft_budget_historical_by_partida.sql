-- DRAFT (para revisión de Ramón) — v2 — histórico contable por partida, SOLO LECTURA.
-- NO modifica `budget_availability` ni `dashboard_global_budget_report`. Es una vista
-- independiente para revisar totales en DEV antes de decidir la integración aislada.
--
-- Contexto: el operativo calcula "usado" desde payment_requests (Flux), con datos solo
-- desde ~jun-2026. El gasto real de meses anteriores vive en historical_actuals (CONTPAQ).
-- Ramón pidió: (a) NO tocar budget_availability (participa en validaciones de solicitudes
-- y nómina); integrar en la capa de reportes (dashboard_global_budget_report) más adelante;
-- (b) filtro de egreso propio por empresa (OPT egresos=6xxx, Fersana=5xxx); (c) validación
-- de cobertura mensual; (d) distinguir "Por clasificar" (ambiguo) de "Sin partida" (sin mapeo).
--
-- CAMBIOS v1→v2:
--   1) Universo de egreso robusto por empresa: en vez de `account_code like '6%'`
--      (rompía Fersana), se usa contpaq_accounts.tipo = 'G' (RESULTADO DEUDOR). Cubre
--      OPT (6/5/7xxx) y Fersana (5xxx) sin hardcodear prefijo. Verificado en DEV.
--   2) Se distinguen 3 buckets (columna `clasificacion`):
--        - 'partida'        : cuenta mapea a EXACTAMENTE una partida (atribución limpia)
--        - 'por_clasificar' : cuenta mapea a >1 partida (ambiguo, requiere desambiguar)
--        - 'sin_partida'    : cuenta egreso SIN ningún mapeo (gap de mapeo)
--   3) Bandera `es_nomina` (cuenta en payroll_contpaq_role_mappings) para hacer VISIBLE
--      el riesgo de doble conteo: la nómina/cargas ya la suma el reporte vía
--      payroll_obligations. NO se filtra aquí (queda a decisión de Ramón en la integración),
--      pero se marca para poder excluirla al blend-ear.
--
-- Formato de código: historical_actuals.account_code trae guiones (602-01-001-000);
-- contpaq_accounts.code y budget_account_mappings NO (60201001000). replace(...,'-','') empata.
-- Sin doble conteo interno: agrega por cuenta antes de mapear.

create or replace view public.budget_historical_by_partida
with (security_invoker = true) as
with hist as (
  select ha.company_id,
         replace(ha.account_code, '-', '') as code,
         date_trunc('month', ha.period_month)::date as period_month,
         sum(ha.amount) as monto
  from public.historical_actuals ha
  group by ha.company_id,
           replace(ha.account_code, '-', ''),
           date_trunc('month', ha.period_month)::date
),
egreso as (   -- universo de egreso por empresa vía naturaleza contable (no por prefijo)
  select h.*
  from hist h
  join public.contpaq_accounts a
    on a.company_id = h.company_id and a.code = h.code
  where a.tipo = 'G'                      -- 'G' = resultado deudor (gasto/costo/egreso)
),
mapcount as (   -- clasificación por nº de partidas a las que mapea la cuenta
  select company_id, contpaq_account_code,
         count(distinct budget_category_id) as nparts,
         (array_agg(distinct budget_category_id))[1] as one_cat
  from public.budget_account_mappings
  group by company_id, contpaq_account_code
),
nomina as (   -- cuentas de nómina (para marcar doble conteo con payroll_obligations)
  select distinct company_id, contpaq_account_code
  from public.payroll_contpaq_role_mappings
)
select e.company_id,
       e.period_month,
       case
         when m.nparts = 1 then 'partida'
         when m.nparts > 1 then 'por_clasificar'
         else 'sin_partida'
       end as clasificacion,
       case when m.nparts = 1 then m.one_cat else null end as budget_category_id,
       (n.contpaq_account_code is not null) as es_nomina,
       sum(e.monto) as historical_executed,
       count(distinct e.code) as cuentas
from egreso e
left join mapcount m
  on m.company_id = e.company_id and m.contpaq_account_code = e.code
left join nomina n
  on n.company_id = e.company_id and n.contpaq_account_code = e.code
group by e.company_id, e.period_month, clasificacion, budget_category_id, es_nomina;

comment on view public.budget_historical_by_partida is
'DRAFT solo-lectura (v2). Gasto historico (historical_actuals, tipo=G resultado deudor) por partida y mes cerrado. clasificacion: partida (1 mapeo) / por_clasificar (mapeo ambiguo) / sin_partida (sin mapeo). es_nomina marca cuentas ya cubiertas por payroll_obligations (riesgo doble conteo). NO toca budget_availability ni dashboard_global_budget_report.';
