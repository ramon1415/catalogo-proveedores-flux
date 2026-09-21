-- DRAFT (para revisión de Ramón) — bloque de backfill del dashboard operativo
-- con el histórico contable, por partida. NO modifica `budget_availability`;
-- es una vista independiente que budget_availability puede blend-ear.
--
-- Contexto: el operativo calcula "usado" desde payment_requests (Flux), que
-- solo tiene datos desde ~jun-2026. El gasto real de los meses anteriores vive
-- en historical_actuals (CONTPAQ). Este bloque lo expone por partida.
--
-- Atribución (validada en dev, Operadora ene-jul 2026):
--   - Formato: historical_actuals.account_code trae guiones (602-01-001-000);
--     budget_account_mappings NO (60201001000). `replace(...,'-','')` los empata.
--   - Se atribuye a la partida SOLO cuando la cuenta mapea a UNA partida
--     (68.7% del gasto = $4,713,565). Lo ambiguo (cuenta a varias partidas) y
--     lo sin mapeo (31% = $2,149,065) cae en budget_category_id NULL =
--     "Por clasificar". Total = $6,862,629 (cuadra con el histórico real).
--   - Sin doble conteo: agrega por cuenta antes de mapear.
--
-- BLEND propuesto para budget_availability (decisión de Ramón):
--   - Mes CERRADO (existe historical_actuals para ese company+month): usar el
--     `historical_executed` de esta vista como ejecutado/usado por partida.
--   - Mes EN CURSO (sin histórico aún): seguir con payment_requests (Flux).
--   - NUNCA sumar ambas fuentes para el mismo mes (jun/jul tienen datos en las
--     dos). El "Por clasificar" (partida NULL) se muestra como renglón propio
--     en la tabla del dashboard y se achica al ampliar budget_account_mappings.

create or replace view public.budget_historical_by_partida
with (security_invoker = true) as
with hist as (
  select ha.company_id,
         replace(ha.account_code, '-', '') as code,
         date_trunc('month', ha.period_month)::date as period_month,
         sum(ha.amount) as monto
  from public.historical_actuals ha
  where ha.account_code like '6%'   -- egresos / gasto
  group by ha.company_id,
           replace(ha.account_code, '-', ''),
           date_trunc('month', ha.period_month)::date
),
map1 as (   -- cuentas que mapean EXACTAMENTE a una partida (atribución limpia)
  select company_id, contpaq_account_code,
         (array_agg(distinct budget_category_id))[1] as budget_category_id
  from public.budget_account_mappings
  group by company_id, contpaq_account_code
  having count(distinct budget_category_id) = 1
)
select h.company_id,
       m.budget_category_id,        -- NULL = "Por clasificar" (ambiguo o sin mapeo)
       h.period_month,
       sum(h.monto) as historical_executed
from hist h
left join map1 m
  on m.company_id = h.company_id and m.contpaq_account_code = h.code
group by h.company_id, m.budget_category_id, h.period_month;

comment on view public.budget_historical_by_partida is
'DRAFT backfill: gasto historico (historical_actuals 6xx) por partida para meses cerrados. budget_category_id NULL = Por clasificar (cuenta ambigua o sin mapeo). Blend en budget_availability: mes cerrado usa esto; mes en curso usa Flux; nunca sumar ambos.';
