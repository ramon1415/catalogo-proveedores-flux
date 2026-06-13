-- Tanda 0C - 001_schema.sql
-- Flux Operadora - Schema base
-- Estado: PENDIENTE DE EXTRACCION DESDE SUPABASE DEV.
--
-- Este archivo no contiene DDL inventado. Debe llenarse con el esquema real
-- extraido desde Supabase dev antes de crear Supabase prod limpio.
-- No ejecutar en produccion hasta que haya revision humana.

-- Debe incluir:
-- - Extensiones necesarias.
-- - Tablas publicas.
-- - Columnas.
-- - Tipos base.
-- - Defaults.
-- - Primary keys.
-- - Foreign keys base.
-- - Generated columns.
-- - Check constraints base.

-- Tablas base esperadas:
-- profiles, roles, user_roles, companies, cost_centers, budget_categories,
-- budget_availability, proveedores, company_bank_accounts.

-- Egresos:
-- payment_requests, payment_request_approvals, payment_layouts,
-- payment_layout_lines, payment_receipts.

-- Efectivo y comprobaciones:
-- cash_funds, cash_reconciliations, cash_reconciliation_items.

-- Ingresos, cuotas e incidencias:
-- members, billing_periods, maintenance_fee_charges,
-- maintenance_fee_payments, incident_charges, invoices.

-- Cierre mensual:
-- monthly_closures, monthly_closure_exports, monthly_closure_comments.

-- Extraccion sugerida:
-- supabase db dump --schema public --file supabase/migrations/dev_schema_dump.sql
-- pg_dump "$DEV_DATABASE_URL" --schema-only --no-owner --no-privileges --schema public --file supabase/migrations/dev_schema_dump.sql

-- Despues de extraer:
-- 1. Separar tablas y constraints base en este archivo.
-- 2. Mover enums, triggers e indexes a 002_enums_triggers_indexes.sql.
-- 3. Mover funciones/RPCs a 003_functions_rpcs.sql.
-- 4. Mover RLS/policies/grants a 004_rls_policies_grants.sql.
-- 5. Revisar que no haya datos operativos ni secrets.
