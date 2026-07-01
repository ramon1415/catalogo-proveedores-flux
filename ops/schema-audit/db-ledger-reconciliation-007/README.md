# DB ledger reconciliation 007 - DEV metadata audit

Paquete read-only para auditar la deriva detectada antes de iniciar F1 nivel company.

## Objetivo

- Confirmar presencia de las secuencias usadas por `003c_payment_request_rpcs.sql` y `003d_layout_rpcs.sql`.
- Exportar metadatos reales de `notification_events` y `notification_delivery_attempts` en DEV antes de crear una migracion de notificaciones.
- Exportar metadatos reales de `historical_actuals` en DEV antes de crear cualquier DDL.
- Revisar `payment_receipts` por el frente de PR #134, especialmente si existe o no una columna formal `notes`.

## Seguridad

- `precheck.sql`, `load.sql` y `postcheck.sql` contienen solo `SELECT`.
- No leen filas de negocio ni muestras de datos.
- No modifican datos ni esquema.
- No requieren llaves productivas.
- Deben ejecutarse solo en DEV cuando el PR este mergeado a `dev` y exista aprobacion operativa.

## Ejecucion manual futura

No ejecutar este paquete desde este PR.

Cuando se autorice, usar:

```text
Actions -> Deploy Supabase DEV Manual -> Run workflow
Branch: dev
script_path: ops/schema-audit/db-ledger-reconciliation-007
confirm_dev: scsirgbuqjcwoaxfacth
```

## Resultados esperados

- `NOTIFICATIONS_BLOCKED_NEEDS_DB_INTROSPECTION` si las tablas de notificaciones existen en DEV.
- `HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT` si `historical_actuals` existe en DEV.
- `PR_134_PAYMENT_RECEIPTS_REVIEWED_NO_NOTES_COLUMN_FOUND_IN_TARGET` o `PR_134_PAYMENT_RECEIPTS_NOTES_COLUMN_EXISTS_IN_TARGET` segun el estado real de DEV.

Estos resultados no son fallas tecnicas; son evidencia para decidir la migracion posterior sin inventar esquema.
