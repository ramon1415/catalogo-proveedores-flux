# PROD - correo al Director al enviar un corte semanal

## Resultado de producto

Cuando Finanzas cambia un corte semanal a `submitted`, Flux genera el evento
`approval_batch.submitted` para el `director_id` seleccionado en ese corte.
La nueva ruta exclusiva envía al correo vigente de ese Director:

- diseño oficial Flux;
- resumen del corte, empresa, periodo, número de pagos y total por moneda;
- botón absoluto al corte exacto en `approval_batches.html?batch_id=...`;
- PDF horizontal paginado con folio, proveedor, concepto, centro/partida e importe.

La decisión oficial continúa registrándose dentro de Flux. El PDF es informativo
y no sustituye la autorización en el sistema.

## Estado PROD certificado — 24 de agosto de 2026

- Supabase PROD: `ucantptjhwttexzmslvm` / `financieraflux`.
- Edge Function: `approval-batch-submitted-dispatcher`, versión `1`, `ACTIVE`, `verify_jwt=false` con secreto interno obligatorio.
- Migración autoritativa: `20260824200842_approval_batch_submitted_email_pdf_prod.sql`, aplicada exactamente una vez.
- Cutoff exclusivo: `2026-08-24T20:09:43.572799Z`.
- Wake-up inmediato: `true`.
- Recovery de cinco minutos: `true`.
- Smoke autenticado: HTTP `200`, `processed=0`, `sent=0`, `failed=0`, `cancelled=0`.
- Históricos preservados: `7 pending`, `0 delivery attempts`, `0` filas posteriores al cutoff.
- Cortes actualmente en `submitted`: `0`; el siguiente corte real será el primer E2E productivo.
- `payment_receipt.linked` y `payment_request.created`: sin cambios.

## Seguridad y aislamiento

- Evento permitido: únicamente `approval_batch.submitted`.
- Destinatario: únicamente el Director actualmente seleccionado en el corte.
- Estado requerido: el corte debe continuar `submitted` al reclamar y al armar el PDF.
- Cutoff: estricto y exclusivo (`event.created_at > activation_cutoff`).
- Backfill: cero.
- Replay histórico: cero.
- Idempotencia Resend: `approval-batch-submitted/<notification_event_id>`.
- Reintento determinista: el mismo snapshot produce exactamente los mismos bytes del PDF.
- Límite por ejecución: cinco eventos.
- Adjuntos: se generan en memoria; no se publican en Storage ni se registran en logs.
- El dispatcher existente de `payment_receipt.linked` no cambia.
- La ruta exclusiva de `payment_request.created` no cambia.

## Componentes

- Edge Function: `approval-batch-submitted-dispatcher`.
- Claim RPC: `claim_approval_batch_submitted_events_for_dispatcher`.
- Documento RPC: `get_approval_batch_submitted_notification_document`.
- Cancelación segura: `cancel_approval_batch_submitted_event_for_dispatcher`.
- Wake-up post-COMMIT: `notification_approval_batch_submitted_dispatch_after_insert`.
- Recovery: `.github/workflows/supabase-prod-approval-batch-submitted-recovery.yml`.

## Variables protegidas en Vault

- `notification_approval_batch_submitted_dispatcher_url`
- `notification_approval_batch_submitted_cutoff_at`
- `notification_approval_batch_submitted_immediate_enabled`
- `notification_approval_batch_submitted_recovery_enabled`

Se reutiliza `notification_dispatcher_secret`, ya existente, únicamente como
secreto HMAC/API interno entre PostgreSQL/GitHub Actions y la Edge Function.

## Orden de liberación ejecutado

1. Contrato focal y PDF de varias páginas: PASS.
2. Edge Function desplegada con `verify_jwt=false` y secreto interno: PASS.
3. Migración forward-only aplicada mediante Supabase: PASS.
4. Cutoff fresco posterior a todos los eventos históricos: PASS.
5. URL y flags creados inicialmente en `false`: PASS.
6. Smoke con `processed=0`: PASS.
7. `immediate_enabled=true` y `recovery_enabled=true`: PASS.
8. Siete eventos históricos sin intento: PASS.
9. Pendiente operativo: enviar el siguiente corte real y confirmar recepción del Director.

## Rollback operativo

1. Cambiar `notification_approval_batch_submitted_immediate_enabled=false`.
2. Cambiar `notification_approval_batch_submitted_recovery_enabled=false`.
3. Conservar el ledger; no borrar, reenviar ni reclasificar eventos automáticamente.
4. Corregir hacia adelante y desplegar una nueva versión de la función.

No se revierte ni se modifica el funcionamiento de comprobantes o solicitudes nuevas.
