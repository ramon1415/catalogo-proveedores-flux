# DEV — correo de corte semanal al Director

## Función

Un corte nuevo que pasa a `submitted` genera `approval_batch.submitted`. La ruta dedicada envía al Director seleccionado un correo Flux con el botón al corte exacto en DEV y adjunta el mismo **formato de PDF del botón `PDF` de Cortes semanales**.

La autorización oficial se conserva dentro de Flux; el PDF es informativo.

## Contrato del PDF del sistema

El adjunto replica el contrato de `approval_batches.js`:

- `jsPDF 2.5.2`;
- `jsPDF-AutoTable 3.8.4`;
- carta horizontal;
- encabezado con nombre del corte;
- empresa, periodo y estado del corte;
- columnas: `Folio`, `Proveedor`, `Centro / partida`, `Metodo`, `Monto`, `Solicitante`, `Decision`, `Motivo`;
- mismos campos y etiquetas de estado que usa la interfaz;
- mismo footer `Flux Operadora — corte semanal`;
- mismo naming: `corte-semanal-<empresa>-<period_end>.pdf`;
- logo del sistema obtenido desde `/assets/logo-flux-verde.webp`; si el asset no pudiera cargarse, el PDF conserva el resto del contrato.

La Edge Function ya no mantiene un segundo diseño de PDF. El adjunto y el PDF descargable desde la UI representan el mismo corte con la misma estructura visual y datos.

## Estado DEV

- Proyecto: `scsirgbuqjcwoaxfacth`.
- Edge Function: `approval-batch-submitted-dispatcher`.
- Migración base: `20260824204217_approval_batch_submitted_email_pdf_dev.sql`.
- Migración de paridad PDF, ledger autoritativo: `20260824224716_approval_batch_submitted_system_pdf_fields_dev.sql`.
- Cutoff exclusivo: `2026-08-24T20:43:14.805243Z`.
- Modo visual: `test_only`; asunto conserva `[DEV TEST]`.
- Delivery mode: `director`; destinatario final = correo vigente del Director seleccionado.
- Wake-up inmediato: activo.
- Recovery cada cinco minutos: activo.
- Históricos previos al cutoff permanecen excluidos.

## Destinatarios en DEV

La variable global `NOTIFICATION_TEST_EMAIL` no redirige esta ruta exclusiva mientras el delivery mode sea `director`. Para una desviación controlada se puede configurar:

```text
APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=test_recipient
```

Valor por defecto:

```text
APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=director
```

## Controles

- Solo procesa `approval_batch.submitted`.
- Exige `event.created_at > activation_cutoff`.
- Cero backfill y cero replay histórico.
- El corte debe continuar `submitted` al reclamar y construir el adjunto.
- El Director del evento debe seguir siendo el Director vigente.
- Claim, documento y cancelación son service-role-only.
- Idempotencia Resend: `approval-batch-submitted/<notification_event_id>`.
- PDF generado en memoria; no se publica en Storage.
- Máximo cinco eventos por ejecución.
- La respuesta reporta `delivery_mode`, destinatarios enmascarados, filename, SHA-256, tamaño y páginas del adjunto.

## Componentes

- `supabase/functions/approval-batch-submitted-dispatcher/index.ts`
- `supabase/functions/approval-batch-submitted-dispatcher/deno.json`
- `supabase/migrations/20260824204217_approval_batch_submitted_email_pdf_dev.sql`
- `supabase/migrations/20260824224716_approval_batch_submitted_system_pdf_fields_dev.sql`
- `scripts/qa/approval-batch-submitted-email-dev-contract.test.mjs`
- `.github/workflows/approval-batch-submitted-email-dev-contract.yml`
- Recovery: `.github/workflows/supabase-dev-approval-batch-submitted-recovery.yml` en `main`.

## UAT

Crear un corte DEV **nuevo** después del despliegue, agregar al menos una solicitud y enviarlo a autorización. Validar:

1. correo al Director seleccionado;
2. asunto `[DEV TEST]`;
3. botón al corte exacto en DEV;
4. nombre del PDF igual al que usa el botón `PDF` del sistema;
5. encabezado, 8 columnas, datos, estado y footer equivalentes al PDF descargable de la UI;
6. un único intento de entrega.

No reutilizar un evento ya `sent`; crear un corte nuevo preserva idempotencia y trazabilidad.

## Rollback

1. Desactivar los flags de wake-up/recovery o usar `APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=test_recipient` para aislar destinatarios.
2. Conservar el ledger sin borrar ni reenviar históricos.
3. Corregir hacia adelante y desplegar una nueva versión.

No se modifica PROD ni las rutas de comprobantes o solicitudes nuevas.
