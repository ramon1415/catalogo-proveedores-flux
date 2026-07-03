# DB ledger reconciliation 007

Documento historico de reconciliacion del ledger de base de datos antes de iniciar F1 nivel company.

## Estado actual

Los hallazgos de este documento ya fueron atendidos en migraciones versionadas:

- `001j_number_sequences.sql` versiona las secuencias faltantes.
- `004a_historical_actuals.sql` versiona `public.historical_actuals`.
- `007_notifications.sql` versiona el ledger de notificaciones.

Las referencias antiguas a paquetes `ops/schema-audit/**` documentan como se obtuvo evidencia read-only en DEV. Esos paquetes fueron parte de la investigacion, no del flujo vigente de aplicacion.

El flujo vigente para aplicar migraciones es Supabase CLI:

```text
docs/ops/supabase-cli-migrations.md
```

## Hallazgo 1: secuencias faltantes en el ledger

Las migraciones usaban secuencias que no estaban declaradas antes en el paquete:

- `003c_payment_request_rpcs.sql` usa `nextval('public.payment_request_number_seq')`.
- `003d_layout_rpcs.sql` usa `nextval('public.payment_layout_number_seq')`.

Decision aplicada:

- Agregar `001j_number_sequences.sql` con `CREATE SEQUENCE IF NOT EXISTS` para ambas secuencias.
- Colocarlo despues de `001i_views.sql` y antes de `002_enums_triggers_indexes.sql` / `003c` / `003d`.
- No reescribir las migraciones antiguas 003c/003d para reducir riesgo y mantener trazabilidad.

## Hallazgo 2: notificaciones existian fuera del ledger

El repo contenia referencias a:

- `public.notification_events`
- `public.notification_delivery_attempts`

Decision aplicada:

- No se invento una migracion de notificaciones con esquema inferido.
- Se exporto evidencia real de DEV.
- Se versiono `supabase/migrations/007_notifications.sql` con DDL real, hardening de grants y sin datos operativos.

## Hallazgo 3: historical_actuals existia fuera del ledger

`historical_actuals` fue reportada como objeto ad-hoc en DEV.

Decision aplicada:

- No se inventaron columnas ni constraints.
- Se uso evidencia real de DEV.
- Se versiono `supabase/migrations/004a_historical_actuals.sql`.
- `company_id` se dejo nullable porque DEV lo reporto nullable.

## Hallazgo 4: payment_receipts.notes

La auditoria reporto que `payment_receipts.notes` no existe en DEV.

Decision pendiente:

- Crear una migracion formal de columna, o
- Ajustar codigo para no depender de esa columna.

Este pendiente queda separado y no debe mezclarse con ledger 007 ni con F1 company-level.

## Orden recomendado actual

1. Mantener `supabase/migrations/` como fuente de verdad.
2. Retirar paquetes operativos custom si la limpieza #155 se aprueba.
3. Revisar historial remoto en `supabase_migrations.schema_migrations` antes de aplicar con CLI.
4. Usar `supabase db push --dry-run` antes de aplicar.
5. Ejecutar `supabase db push` solo con autorizacion por ambiente.
6. Iniciar F1 como `008_company_level` solo cuando el release y el historial de migraciones queden claros.

## Validacion esperada

- No tocar `main` sin autorizacion de release.
- No tocar produccion sin ventana y backup.
- No tocar Supabase PROD sin autorizacion.
- No tocar n8n real.
- No modificar app/frontend desde este frente.
- No configurar secrets.
- No crear datos operativos.
