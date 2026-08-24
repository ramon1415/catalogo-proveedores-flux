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

## Orden de liberación

1. Ejecutar contrato focal y validar visualmente un PDF de varias páginas.
2. Desplegar la Edge Function con `verify_jwt=false`; la función valida el secreto interno.
3. Aplicar la migración forward-only con los nuevos RPC/trigger, aún sin flags de activación.
4. Crear un cutoff fresco posterior a todos los eventos históricos.
5. Configurar URL, cutoff y flags inicialmente en `false`.
6. Invocar la función una vez y comprobar `processed=0`.
7. Activar `immediate_enabled=true` y `recovery_enabled=true`.
8. Verificar que los siete eventos históricos permanezcan sin intento.
9. El siguiente corte real enviado por Finanzas debe producir exactamente un correo al Director seleccionado.

## Rollback operativo

1. Cambiar `notification_approval_batch_submitted_immediate_enabled=false`.
2. Cambiar `notification_approval_batch_submitted_recovery_enabled=false`.
3. Conservar el ledger; no borrar, reenviar ni reclasificar eventos automáticamente.
4. Corregir hacia adelante y desplegar una nueva versión de la función.

No se revierte ni se modifica el funcionamiento de comprobantes o solicitudes nuevas.
