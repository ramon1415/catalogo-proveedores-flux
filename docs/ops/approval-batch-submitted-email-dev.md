# DEV — correo de corte semanal al Director

## Función

Un corte nuevo que pasa a `submitted` genera el evento `approval_batch.submitted`. La ruta dedicada prepara un correo con diseño Flux, resumen, botón al corte en DEV y un PDF paginado con folio, proveedor, concepto, centro/partida e importe.

La autorización oficial se conserva dentro de Flux; el PDF es informativo.

## Estado certificado — 24 de agosto de 2026

- Proyecto DEV: `scsirgbuqjcwoaxfacth`.
- Edge Function: `approval-batch-submitted-dispatcher`, versión 1, ACTIVE.
- Migración: `20260824204217_approval_batch_submitted_email_pdf_dev.sql`.
- Cutoff exclusivo: `2026-08-24T20:43:14.805243Z`.
- Modo: `test_only`.
- Wake-up inmediato: activo.
- Recovery cada cinco minutos: activo.
- Smoke: HTTP 200; processed 0; sent 0; failed 0; cancelled 0.
- Históricos preservados: 26 pending y 0 intentos.
- Dos cortes que ya estaban submitted antes del cutoff quedan excluidos.
- Botón: `https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/approval_batches.html?batch_id=...`.

## Destinatarios en DEV

El evento conserva al Director seleccionado como destinatario funcional, pero el modo `test_only` sustituye el destinatario final por el correo configurado para pruebas. El asunto incluye `[DEV TEST]` y el cuerpo muestra el banner de prueba. DEV no envía este correo al Director real.

## Controles

- Solo procesa `approval_batch.submitted`.
- Exige `event.created_at > activation_cutoff`.
- Cero backfill y cero replay histórico.
- El corte debe seguir submitted.
- El Director del evento debe seguir siendo el Director vigente del corte.
- Claim, documento y cancelación son service-role-only.
- Idempotencia: `approval-batch-submitted/<notification_event_id>`.
- PDF generado en memoria; no se publica en Storage.
- Máximo cinco eventos por ejecución.

## Componentes

- `supabase/functions/approval-batch-submitted-dispatcher/index.ts`
- `supabase/migrations/20260824204217_approval_batch_submitted_email_pdf_dev.sql`
- `scripts/qa/approval-batch-submitted-email-dev-contract.test.mjs`
- `.github/workflows/approval-batch-submitted-email-dev-contract.yml`
- Recovery: `.github/workflows/supabase-dev-approval-batch-submitted-recovery.yml` en main.

## UAT

Crear un corte DEV nuevo después del cutoff, agregar al menos una solicitud y enviarlo a autorización. Validar el correo de prueba, el botón hacia DEV, el PDF y un único intento de entrega.

## Rollback

Desactivar los flags de wake-up y recovery. Conservar el ledger sin borrar ni reenviar históricos y corregir hacia adelante.
