-- Tanda 0C - 002_enums_triggers_indexes.sql
-- Flux Operadora - Enums, triggers e indexes
-- Estado: PENDIENTE DE EXTRACCION DESDE SUPABASE DEV.
-- No ejecutar en produccion hasta que haya revision humana.

-- Debe incluir:
-- - Enums del esquema public.
-- - Indexes no incluidos automaticamente con PK/FK.
-- - Triggers.
-- - Funciones auxiliares de triggers, por ejemplo set_updated_at si aplica.
-- - Constraints que se hayan separado del schema base por claridad.

-- Enums/estados a revisar:
-- - payment_request_status y estados relacionados.
-- - request_type si existe como enum.
-- - status de layouts, fondos, comprobaciones, cuotas, incidencias, facturas y cierres.
-- - Tipos de cuenta/destino si existen como enum.

-- Triggers a revisar:
-- - updated_at en tablas operativas.
-- - triggers de recalculo si existen.
-- - triggers de auditoria si existen.

-- Indexes esperados por modulo:
-- - payment_requests por status, request_type, company_id, requested_by, created_at.
-- - payment_layout_lines por layout_id y payment_request_id.
-- - cash_funds por payment_request_id, responsible_profile_id y status.
-- - cash_reconciliations por cash_fund_id y status.
-- - maintenance_fee_charges por member_id, billing_period_id y status.
-- - incident_charges por member_id, status e incident_date.
-- - invoices por invoice_type, status, charge_id e incident_charge_id.
-- - monthly_closures por period_key y status.

-- Validaciones sugeridas despues de llenar:
-- select t.typname, e.enumlabel from pg_type t join pg_enum e on e.enumtypid = t.oid order by t.typname, e.enumsortorder;
-- select schemaname, tablename, indexname from pg_indexes where schemaname = 'public' order by tablename, indexname;
-- select event_object_table, trigger_name from information_schema.triggers where trigger_schema = 'public' order by event_object_table, trigger_name;
