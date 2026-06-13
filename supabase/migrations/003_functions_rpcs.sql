-- Tanda 0C - 003_functions_rpcs.sql
-- Flux Operadora - Helper functions y RPCs
-- Estado: PENDIENTE DE EXTRACCION DESDE SUPABASE DEV.
-- No ejecutar en produccion hasta que haya revision humana.

-- Helper functions:
-- - current_profile_id
-- - current_user_has_role

-- Solicitudes, presupuesto y aprobaciones:
-- - create_payment_request
-- - verify_budget_availability
-- - decide_payment_request

-- Layouts/pagos:
-- - create_payment_layout
-- - mark_payment_layout_uploaded
-- - confirm_payment_layout
-- - reject_payment_layout_line

-- Efectivo y comprobaciones:
-- - verify_cash_block
-- - create_cash_fund
-- - create_cash_reconciliation
-- - submit_cash_reconciliation
-- - review_cash_reconciliation

-- Ingresos, cuotas, incidencias y facturas:
-- - generate_maintenance_fees_for_period
-- - register_maintenance_fee_payment
-- - create_incident_charge
-- - resolve_invoice_receiver, si existe en dev
-- - create_invoice_record
-- - mark_invoice_paid
-- - close_incident_charge, si existe en dev

-- Dashboard operativo/cierre:
-- - dashboard_kpis
-- - dashboard_budget_comparison, si existe en dev
-- - dashboard_ytd, si existe en dev
-- - dashboard_income_members, si existe en dev
-- - dashboard_closure_checklist
-- - dashboard_export_payload

-- Reglas:
-- - Usar definiciones reales de Supabase dev.
-- - Mantener SECURITY DEFINER solo donde ya exista y haya sido revisado.
-- - Mantener set search_path = public donde aplique.
-- - No incluir service_role.
-- - No incluir secretos.
-- - No modificar logica de negocio durante la extraccion.

-- Validaciones sugeridas despues de llenar:
-- select n.nspname, p.proname, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)
-- from pg_proc p join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public'
-- order by p.proname;

-- select routine_name, security_type
-- from information_schema.routines
-- where specific_schema = 'public'
-- order by routine_name;
