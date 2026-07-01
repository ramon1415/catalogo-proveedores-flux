# DB ledger reconciliation 007

Documento operativo para reconciliar el ledger de base de datos antes de iniciar F1 nivel company.

## Alcance de este PR

Este PR prepara la reconciliacion tecnica del paquete Supabase sin ejecutar nada:

- Agrega `supabase/migrations/001j_number_sequences.sql` para declarar dos secuencias que ya eran usadas por RPCs existentes.
- Actualiza el orden operativo de `supabase/README.md` para que las secuencias queden antes de las RPCs que las consumen.
- Agrega paquetes read-only de auditoria para notificaciones, `historical_actuals` y `payment_receipts`.
- Documenta el bloqueo de notificaciones e `historical_actuals` hasta contar con introspeccion real de DEV.

No inicia F1 008 y no crea DDL para objetos cuyo esquema real no esta en el repo.

## Hallazgo 1: secuencias faltantes en el ledger

Las migraciones actuales usan secuencias que no estaban declaradas antes en el paquete:

- `003c_payment_request_rpcs.sql` usa `nextval('public.payment_request_number_seq')`.
- `003d_layout_rpcs.sql` usa `nextval('public.payment_layout_number_seq')`.

Si esas secuencias existen por creacion manual en un ambiente vivo, las RPCs funcionan ahi. Pero un rebuild limpio desde el paquete versionado puede fallar al ejecutar esas funciones o al usarlas despues del despliegue.

Decision de este PR:

- Agregar `001j_number_sequences.sql` con `CREATE SEQUENCE IF NOT EXISTS` para ambas secuencias.
- Colocarlo despues de `001i_views.sql` y antes de `002_enums_triggers_indexes.sql` / `003c` / `003d`.
- No reescribir las migraciones antiguas 003c/003d para reducir riesgo y mantener trazabilidad.

## Hallazgo 2: notificaciones existen fuera del ledger

El repo contiene paquetes operativos que usan:

- `public.notification_events`
- `public.notification_delivery_attempts`

Tambien hay flujos n8n y SQL DEV que dependen de esas tablas. Sin embargo, no se encontro DDL exacto de notificaciones dentro de `supabase/migrations/`.

Decision de este PR:

- No crear una migracion de notificaciones con esquema inferido.
- Marcar el frente como bloqueado hasta exportar metadatos reales de DEV.
- Agregar `ops/schema-audit/db-ledger-reconciliation-007/` para extraer columnas, constraints, indices, RLS, policies, grants, funciones y triggers relacionados.

Resultado esperado cuando se ejecute la auditoria autorizada en DEV:

```text
NOTIFICATIONS_BLOCKED_NEEDS_DB_INTROSPECTION
```

Con esa evidencia se podra construir una migracion posterior de notificaciones con firmas reales.

## Hallazgo 3: historical_actuals existe fuera del ledger

`historical_actuals` fue reportada como objeto ad-hoc en DEV, pero no hay DDL exacto versionado en el paquete actual.

Decision de este PR:

- No inventar columnas ni constraints.
- Agregar `ops/schema-audit/historical-actuals/` para exportar metadatos read-only.
- Mantener bloqueada cualquier migracion de `historical_actuals` hasta obtener el esquema real.

Resultado esperado cuando se ejecute la auditoria autorizada en DEV:

```text
HISTORICAL_ACTUALS_BLOCKED_NEEDS_SCHEMA_EXPORT
```

## Hallazgo 4: PR #134 y payment_receipts

PR #134 es un frente frontend/UX para comprobantes de transferencia. La revision de patch muestra que usa la tabla existente `payment_receipts` mediante insert/update y no agrega migraciones.

El ledger actual define `payment_receipts` con estas columnas base:

- `id`
- `payment_request_id`
- `layout_id`
- `payment_date`
- `amount`
- `bank_reference`
- `storage_path`
- `registered_by`
- `created_at`

El patch de PR #134 intenta guardar `notes` en `payment_receipts` dentro de una ruta tolerante a fallo, y tambien conserva notas en almacenamiento local del navegador. Como `notes` no esta en el ledger actual, este PR no agrega esa columna sin confirmar el estado real de DEV.

Decision de este PR:

- No modificar PR #134.
- No tocar archivos frontend.
- Auditar si `payment_receipts.notes` existe en DEV mediante el paquete read-only.
- Reportar uno de estos resultados:

```text
PR_134_PAYMENT_RECEIPTS_REVIEWED_NO_NOTES_COLUMN_FOUND_IN_TARGET
PR_134_PAYMENT_RECEIPTS_NOTES_COLUMN_EXISTS_IN_TARGET
```

## Orden recomendado despues de este PR

1. Mergear este PR a `dev` si la revision lo aprueba.
2. Ejecutar auditorias read-only en DEV solo cuando se autorice.
3. Con los logs de auditoria, construir migracion real de notificaciones si aplica.
4. Con los logs de auditoria, construir migracion real de `historical_actuals` si aplica.
5. Revisar si `payment_receipts.notes` requiere migracion formal o si debe permanecer solo como fallback local.
6. Iniciar F1 como `008_company_level` solo cuando el ledger 007 quede reconciliado.

## Validacion esperada de este PR

- No ejecuta Actions.
- No toca Supabase.
- No toca n8n.
- No toca produccion.
- No toca `main`.
- No modifica app/frontend.
- No configura secrets.
- No crea datos operativos.
- No inventa DDL de notificaciones ni de `historical_actuals`.
