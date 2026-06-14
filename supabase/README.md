# Supabase migrations package - Flux Operadora

Paquete generado desde exports completos de Supabase dev para preparar un proyecto Supabase prod limpio.

## Orden de ejecucion propuesto

1. `001a_extensions_and_types.sql` - extensiones y tipos/enums.
2. `001b_core_tables.sql` - perfiles, roles, empresas, centros, proveedores, cuentas y documentos base.
3. `001c_budget_tables.sql` - tablas presupuestales e importacion.
4. `001d_payment_tables.sql` - solicitudes, aprobaciones y comprobantes de pago.
5. `001e_layout_tables.sql` - layouts y lineas de layout.
6. `001f_cash_tables.sql` - efectivo, comprobaciones y tickets.
7. `001g_income_tables.sql` - socios, cuotas, cobros, incidencias, facturas y entidades comerciales/eventos.
8. `001h_closure_dashboard_tables.sql` - cierre mensual y foreign keys finales.
9. `001i_views.sql` - indice/TODO de vistas faltantes.
10. `002_enums_triggers_indexes.sql` - funciones de soporte para triggers, indices y triggers.
11. `003a_helper_functions.sql` - helpers de perfil/roles.
12. `003b_budget_rpcs.sql` - RPCs de presupuesto.
13. `003c_payment_request_rpcs.sql` - RPCs de solicitudes/aprobaciones.
14. `003d_layout_rpcs.sql` - RPCs de layouts.
15. `003e_cash_rpcs.sql` - RPCs de efectivo/comprobaciones.
16. `003f_income_invoice_rpcs.sql` - RPCs de ingresos, incidencias y facturas.
17. `003g_dashboard_rpcs.sql` - RPCs de dashboard/cierre.
18. `004_rls_policies_grants.sql` - RLS, policies y grants para `anon`/`authenticated`.
19. `005_storage.sql` - buckets y policies de Storage.
20. `006_seed_base.sql` - seed minimo seguro de roles.

`001_schema.sql` y `003_functions_rpcs.sql` quedan como indices. Se dividieron por tamano para evitar truncamiento del conector.

## Contenido incluido

- Tablas publicas: 59.
- Enums publicos: 27.
- Foreign keys: 154.
- Indices no constraint: 62.
- Triggers: 34.
- Funciones/RPCs de aplicacion: 36 en chunks 003a-003g, mas 2 funciones de soporte en 002.
- Buckets de Storage: 3.

## Pendientes detectados

Los siguientes objetos aparecen en metadata de columnas, pero el export disponible no trae su DDL. Probablemente son vistas o vistas materializadas y deben exportarse por separado antes de considerar lista una migracion productiva:

- `public.budget_availability`
- `public.budget_exceptions`
- `public.celebration_events_with_dates`

Riesgo principal: algunas RPCs de presupuesto dependen de `public.budget_availability`; si esa vista no existe en prod, esas validaciones fallaran al ejecutarse.

## Seguridad

- No se incluyen llaves privilegiadas.
- No se incluyen cadenas de conexion.
- No se incluyen contrasenas.
- No se copian solicitudes, pagos, facturas, fondos ni datos operativos de dev.
- Los grants se limitaron a `anon` y `authenticated`; los roles internos/plataforma no se replican.

## Revision requerida antes de prod

- Revisar las policies temporales de Storage para `anon` sobre `payment-receipts`.
- Validar el paquete en un proyecto Supabase temporal antes de prod.
- Exportar y agregar el DDL faltante de vistas.
- Cargar seed operativo minimo manualmente despues del usuario admin inicial.
