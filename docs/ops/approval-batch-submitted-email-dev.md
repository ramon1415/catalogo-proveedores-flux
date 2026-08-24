# DEV — correo de corte semanal al Director

## Función

Cuando un corte nuevo pasa a `submitted`, Flux genera `approval_batch.submitted` y la ruta dedicada envía al correo vigente del Director seleccionado:

- correo con diseño Flux y etiqueta visual `[DEV TEST]`;
- botón al corte exacto en la interfaz DEV;
- el mismo PDF disponible en el botón **PDF** de `approval_batches.html`.

La autorización oficial se conserva dentro de Flux; el PDF es informativo.

## Contrato único del PDF

El adjunto ya no usa un renderer alterno. La Edge Function replica exactamente el contrato de `approval_batches.js::exportPdf`:

- `jsPDF 2.5.2`;
- `jspdf-autotable 3.8.4`;
- carta horizontal;
- mismo wordmark Flux;
- mismo título, empresa, periodo y estado;
- mismas columnas: Folio, Proveedor, Centro / partida, Metodo, Monto, Solicitante, Decision y Motivo;
- mismos estilos de tabla y pie `Flux Operadora — corte semanal`;
- mismo nombre de archivo: `corte-semanal-<empresa>-<periodo_fin>.pdf`.

La función de documento devuelve los mismos campos que consume el PDF del sistema, incluyendo `company_name`, `status`, `provider_name`, `requester_name`, `director_status`, `reject_reason` y `rebatch_release_note`.

## Estado operativo

- Proyecto DEV: `scsirgbuqjcwoaxfacth`.
- Edge Function: `approval-batch-submitted-dispatcher`.
- Cutoff exclusivo: `2026-08-24T20:43:14.805243Z`.
- Modo visual: `test_only`.
- Delivery mode: `director`.
- Wake-up inmediato: activo.
- Recovery cada cinco minutos: activo.
- Históricos anteriores al cutoff: excluidos.
- PROD: sin cambios.

## Destinatarios en DEV

El evento conserva al Director seleccionado como destinatario funcional y la ruta dedicada entrega al correo vigente de ese Director. La etiqueta `[DEV TEST]` y el aviso de entorno DEV se mantienen para evitar confundir la prueba con PRODUCCIÓN.

La variable global `NOTIFICATION_TEST_EMAIL` no redirige esta ruta exclusiva mientras el valor por defecto sea:

```text
APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=director
```

Para una contingencia controlada puede cambiarse a:

```text
APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=test_recipient
```

## Controles

- Solo procesa `approval_batch.submitted`.
- Exige `event.created_at > activation_cutoff`.
- El corte debe continuar `submitted`.
- El Director del evento debe seguir siendo el Director vigente del corte.
- Claim, documento y cancelación son `service_role`-only.
- Idempotencia Resend: `approval-batch-submitted/<notification_event_id>`.
- PDF generado en memoria; no se publica en Storage.
- Límite máximo: cinco eventos por ejecución.
- Cero backfill y cero replay histórico.

## Componentes

- `supabase/functions/approval-batch-submitted-dispatcher/index.ts`
- `supabase/functions/approval-batch-submitted-dispatcher/system_pdf.ts`
- `supabase/functions/approval-batch-submitted-dispatcher/deno.json`
- `supabase/migrations/20260824215919_approval_batch_submitted_system_pdf_parity_dev.sql`
- `scripts/qa/approval-batch-submitted-email-dev-contract.test.mjs`
- `.github/workflows/approval-batch-submitted-email-dev-contract.yml`
- Recovery: `.github/workflows/supabase-dev-approval-batch-submitted-recovery.yml` en `main`.

## UAT posterior a la liberación

Crear un corte DEV nuevo después del cutoff, agregar al menos una solicitud y enviarlo a autorización. Validar que:

1. llegue al correo del Director seleccionado;
2. conserve `[DEV TEST]`;
3. el botón abra el corte exacto en DEV;
4. el PDF adjunto tenga el mismo diseño, columnas, datos y nombre que el PDF descargado desde el sistema;
5. exista un único intento de entrega.

No se reutilizan eventos ya marcados `sent`.

## Rollback

1. Desactivar wake-up y recovery o configurar `APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=test_recipient`.
2. Conservar el ledger; no borrar ni reenviar históricos.
3. Corregir hacia adelante y desplegar una nueva versión de la función.

No se modifica PROD ni las rutas de comprobantes o solicitudes nuevas.
