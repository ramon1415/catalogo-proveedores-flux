# Supabase migrations package - Flux Operadora

Este paquete prepara la reconstruccion futura de una base Supabase prod limpia para Flux Operadora.

Estado de esta tanda:

- No se ejecuto SQL.
- No se creo Supabase prod.
- No se tocaron `main`, backend, n8n ni Vercel Production.
- No se incluyen secrets, tokens ni `service_role`.
- No se incluyen datos operativos de dev.
- Los SQL son estructura versionada y checklist tecnico. El DDL real debe extraerse desde Supabase dev con acceso autorizado.

## Archivos

| Orden | Archivo | Contenido esperado |
|---|---|---|
| 1 | `migrations/001_schema.sql` | Extensiones, tablas, columnas, tipos base, defaults, PK y FK base. |
| 2 | `migrations/002_enums_triggers_indexes.sql` | Enums, indices, triggers y funciones auxiliares de `updated_at`. |
| 3 | `migrations/003_functions_rpcs.sql` | Helper functions, RPCs de negocio y RPCs del dashboard. |
| 4 | `migrations/004_rls_policies_grants.sql` | RLS, policies, grants de tablas y grants de ejecucion. |
| 5 | `migrations/005_storage.sql` | Buckets requeridos y policies de Storage. |
| 6 | `migrations/006_seed_base.sql` | Seed minimo seguro: roles y catalogos aprobados. |

## Inventario esperado

Tablas base:

- `profiles`
- `roles`
- `user_roles`
- `companies`
- `cost_centers`
- `budget_categories`
- `budget_availability`
- `proveedores`
- `company_bank_accounts`

Egresos:

- `payment_requests`
- `payment_request_approvals`
- `payment_layouts`
- `payment_layout_lines`
- `payment_receipts`

Efectivo y comprobaciones:

- `cash_funds`
- `cash_reconciliations`
- `cash_reconciliation_items`

Ingresos, cuotas e incidencias:

- `members`
- `billing_periods`
- `maintenance_fee_charges`
- `maintenance_fee_payments`
- `incident_charges`
- `invoices`

Cierre mensual:

- `monthly_closures`
- `monthly_closure_exports`
- `monthly_closure_comments`

Funciones/RPCs:

- `current_profile_id`
- `current_user_has_role`
- `create_payment_request`
- `verify_budget_availability`
- `decide_payment_request`
- `create_payment_layout`
- `mark_payment_layout_uploaded`
- `confirm_payment_layout`
- `reject_payment_layout_line`
- `verify_cash_block`
- `create_cash_fund`
- `create_cash_reconciliation`
- `submit_cash_reconciliation`
- `review_cash_reconciliation`
- `generate_maintenance_fees_for_period`
- `register_maintenance_fee_payment`
- `create_incident_charge`
- `create_invoice_record`
- `mark_invoice_paid`
- `dashboard_kpis`
- `dashboard_export_payload`
- `dashboard_closure_checklist`

Tambien deben migrarse enums, constraints, indexes, triggers, RLS policies, grants, storage buckets y storage policies.

## Extraccion desde Supabase dev

No ejecutar sin autorizacion humana y acceso al proyecto Supabase dev.

Supabase CLI:

```bash
supabase login
supabase link --project-ref <DEV_PROJECT_REF>
supabase db dump --schema public --file supabase/migrations/dev_schema_dump.sql
```

`pg_dump` schema-only:

```bash
pg_dump "$DEV_DATABASE_URL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema public \
  --file supabase/migrations/dev_schema_dump.sql
```

Despues de extraer, separar manualmente el dump en los archivos numerados.

## Aplicacion futura en Supabase prod limpio

1. Crear proyecto Supabase prod limpio.
2. Confirmar URL distinta a dev.
3. Aplicar `001_schema.sql`.
4. Aplicar `002_enums_triggers_indexes.sql`.
5. Aplicar `003_functions_rpcs.sql`.
6. Aplicar `004_rls_policies_grants.sql`.
7. Aplicar `005_storage.sql`.
8. Revisar y aplicar `006_seed_base.sql` solo con datos aprobados.
9. Crear usuario admin inicial en Supabase Auth.
10. Vincular usuario a `profiles` y `user_roles`.
11. Validar modulos.
12. Configurar Vercel Production con `FLUX_ENV=prod`, `FLUX_SUPABASE_URL` y `FLUX_SUPABASE_ANON_KEY`.

## Seed base seguro

Debe ser minimo:

- Roles base.
- Perfil admin inicial, despues de crear usuario Auth prod.
- Empresas limpias aprobadas.
- Centros de costo aprobados.
- Partidas presupuestales aprobadas.
- Cuentas origen aprobadas.

No incluir solicitudes, pagos, layouts, fondos, comprobaciones, incidencias, facturas, cierres de prueba, correos personales sin autorizacion, tokens, secrets ni `service_role`.

## Validacion previa a produccion

- Revisar que no haya `service_role`.
- Revisar que no haya secrets.
- Revisar que no haya datos personales innecesarios.
- Revisar que no haya inserts operativos de dev.
- Revisar que RLS quede activo.
- Revisar que grants sean minimos.
- Probar login admin.
- Probar Proveedores, Solicitudes, Layouts, Efectivo, Ingresos y Dashboard.
- Probar `/api/runtime-config` en prod con `source=vercel-env` y `env=prod`.

## Reglas

- Nunca usar `service_role` en frontend.
- Nunca subir secrets al repo.
- Nunca copiar dev hacia prod.
- Solo copiar prod hacia dev, con sanitizacion si aplica.
- No ejecutar migraciones en produccion sin respaldo y autorizacion humana.
- No configurar Vercel Production hasta que Supabase prod exista y este validado.
