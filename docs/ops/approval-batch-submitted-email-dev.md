# DEV — correo de corte semanal al Director

## Función

Un corte nuevo que pasa a `submitted` genera el evento `approval_batch.submitted`. La ruta dedicada prepara un correo con diseño Flux, resumen, botón al corte en DEV y un PDF paginado con folio, proveedor, concepto, centro/partida e importe.

La autorización oficial se conserva dentro de Flux; el PDF es informativo.

## Estado certificado — 24 de agosto de 2026

- Proyecto DEV: `scsirgbuqjcwoaxfacth`.
- Edge Function: `approval-batch-submitted-dispatcher`, versión 1, ACTIVE antes del hotfix de routing.
- Migración: `20260824204217_approval_batch_submitted_email_pdf_dev.sql`.
- Cutoff exclusivo: `2026-08-24T20:43:14.805243Z`.
- Modo visual: `test_only`; asunto y aviso conservan la identificación `[DEV TEST]`.
- Delivery mode: `director`; el destinatario final es el correo vigente del Director seleccionado.
- Wake-up inmediato: activo.
- Recovery cada cinco minutos: activo.
- Smoke de activación: HTTP 200; processed 0; sent 0; failed 0; cancelled 0.
- Históricos preservados: 26 pending y 0 intentos.
- Dos cortes que ya estaban submitted antes del cutoff quedan excluidos.
- Botón: `https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/approval_batches.html?batch_id=...`.

## Destinatarios en DEV

El evento conserva al Director seleccionado como destinatario funcional y la ruta dedicada entrega al correo vigente de ese Director. El asunto conserva `[DEV TEST]` y el cuerpo muestra un aviso de entorno DEV para evitar confundirlo con PRODUCCIÓN.

La variable global `NOTIFICATION_TEST_EMAIL` continúa aplicando a otras notificaciones DEV, pero ya no redirige esta ruta exclusiva. Para restablecer temporalmente el desvío controlado puede configurarse:

```text
APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=test_recipient
```

El valor por defecto es:

```text
APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=director
```

## Controles

- Solo procesa `approval_batch.submitted`.
- Delivery mode por defecto: `director`; conserva etiqueta visual `[DEV TEST]`.
- Exige `event.created_at > activation_cutoff`.
- Cero backfill y cero replay histórico.
- El corte debe seguir submitted.
- El Director del evento debe seguir siendo el Director vigente del corte.
- Claim, documento y cancelación son service-role-only.
- Idempotencia: `approval-batch-submitted/<notification_event_id>`.
- PDF generado en memoria; no se publica en Storage.
- Máximo cinco eventos por ejecución.
- La respuesta del dispatcher reporta `delivery_mode` y los destinatarios enmascarados.

## Componentes

- `supabase/functions/approval-batch-submitted-dispatcher/index.ts`
- `supabase/migrations/20260824204217_approval_batch_submitted_email_pdf_dev.sql`
- `scripts/qa/approval-batch-submitted-email-dev-contract.test.mjs`
- `.github/workflows/approval-batch-submitted-email-dev-contract.yml`
- Recovery: `.github/workflows/supabase-dev-approval-batch-submitted-recovery.yml` en main.

## UAT

Crear un corte DEV nuevo después del cutoff, agregar al menos una solicitud y enviarlo a autorización. Validar que:

1. el correo llegue al correo configurado en el perfil del Director seleccionado;
2. el asunto conserve `[DEV TEST]`;
3. el botón abra el corte exacto en DEV;
4. el PDF esté adjunto y contenga el detalle correcto;
5. exista un único intento de entrega.

Un evento que ya quedó `sent` no debe reutilizarse para la nueva prueba; se debe crear un corte nuevo para conservar idempotencia y trazabilidad.

## Rollback

1. Configurar `APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE=test_recipient`, o desactivar los flags de wake-up y recovery.
2. Conservar el ledger sin borrar ni reenviar históricos.
3. Corregir hacia adelante y desplegar una nueva versión de la función.

No se modifica PROD ni las rutas de comprobantes o solicitudes nuevas.
