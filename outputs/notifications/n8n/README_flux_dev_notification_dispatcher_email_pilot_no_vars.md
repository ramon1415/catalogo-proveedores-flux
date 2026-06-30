# Flux DEV - Notification Dispatcher EMAIL PILOT

Fecha: 2026-06-30

Este workflow es la version piloto con envio real de email controlado para DEV.

A diferencia del workflow `DRY_RUN`, este si incluye nodo `Email Send`, pero inicia en modo piloto:

- sin schedule;
- `active = false`;
- ejecucion manual;
- maximo 1 evento por ejecucion;
- envio inicial solo a correo interno de prueba;
- sin variables globales de n8n;
- sin credenciales reales en el JSON.

## Archivos

- `outputs/notifications/n8n/flux_dev_notification_dispatcher_email_pilot_no_vars.json`
- `outputs/notifications/sql/phase3_dev/post_email_pilot_validation_queries.sql`
- `outputs/notifications/sql/phase3_dev/cleanup_email_pilot_events.sql`

## Eventos incluidos

Solo procesa:

- `payment_request.created`
- `payment_request.approved`
- `payment_request.rejected`
- `payment_request.changes_requested`
- `payment_request.exception_approved`
- `payment_request.exception_rejected`

No procesa layouts, pagos, comprobaciones, proveedores, presupuesto bajo, WhatsApp, Google Chat ni digests.

## Importar en n8n

1. Abrir n8n Cloud.
2. Ir a `Workflows`.
3. Elegir `Import from File`.
4. Importar `flux_dev_notification_dispatcher_email_pilot_no_vars.json`.
5. Confirmar que el workflow se llama `Flux DEV - Notification Dispatcher EMAIL PILOT`.
6. Mantenerlo inactivo.

## Configurar Set Config

Abrir el nodo `Set Config` y reemplazar placeholders:

```json
{
  "FLUX_DEV_SUPABASE_URL": "PEGAR_SUPABASE_DEV_URL",
  "FLUX_DEV_SUPABASE_ANON_KEY": "PEGAR_SUPABASE_DEV_ANON_KEY",
  "FLUX_DEV_DISPATCHER_EMAIL": "PEGAR_EMAIL_ADMIN_DEV",
  "FLUX_DEV_DISPATCHER_PASSWORD": "PEGAR_PASSWORD_ADMIN_DEV",
  "FLUX_DEV_MIN_CREATED_AT": "2026-06-30T04:00:00.000Z",
  "FLUX_DEV_WORKER_ID": "n8n-dev-dispatcher-email-pilot",
  "EMAIL_FROM": "PEGAR_CORREO_REMITENTE_DEV",
  "EMAIL_PILOT_MODE": true,
  "SEND_TO_TEST_EMAIL_ONLY": true,
  "TEST_RECIPIENT_EMAIL": "PEGAR_CORREO_INTERNO_DE_PRUEBA",
  "SEND_TO_REAL_RECIPIENT": false,
  "MAX_EVENTS_PER_RUN": 1
}
```

Notas:

- `FLUX_DEV_DISPATCHER_EMAIL` debe ser usuario DEV con rol `admin` o `sysadmin`.
- `FLUX_DEV_MIN_CREATED_AT` debe ser una fecha/hora posterior a eventos historicos que no quieras procesar.
- `TEST_RECIPIENT_EMAIL` debe ser un correo interno controlado.
- No usar valores de produccion.

## Configurar nodo Email

Abrir `Email Send Pilot` y seleccionar o crear una credencial SMTP/Gmail.

Nombre sugerido:

```text
Flux DEV Email SMTP
```

El JSON no contiene usuario SMTP, password SMTP ni credenciales reales.

## Primera prueba

1. Ejecutar primero el precheck existente:
   - `outputs/notifications/sql/phase3_dev/precheck_dev_notification_n8n_dispatcher.sql`
2. Confirmar que no hay eventos pending inseguros.
3. Confirmar que existen eventos pending validos posteriores a `FLUX_DEV_MIN_CREATED_AT`.
4. Ejecutar workflow manualmente.
5. Revisar que el correo llegue a `TEST_RECIPIENT_EMAIL`.
6. Ejecutar:
   - `outputs/notifications/sql/phase3_dev/post_email_pilot_validation_queries.sql`

## Safety incluido

Antes del claim:

- consulta eventos pending;
- bloquea si encuentra `dev-test:%`;
- bloquea eventos con tipo no permitido;
- bloquea eventos anteriores a `FLUX_DEV_MIN_CREATED_AT`;
- bloquea eventos sin `recipient_email`;
- bloquea eventos con `channel <> email`.

Despues del claim:

- valida evento reclamado;
- valida tipo permitido;
- valida destinatario;
- valida canal email;
- valida fecha de corte;
- bloquea payload con indicios de datos sensibles;
- si falla, llama `mark_notification_failed`.

## Cambiar a destinatario real

No hacerlo sin autorizacion.

Cuando se autorice:

```json
{
  "SEND_TO_TEST_EMAIL_ONLY": false,
  "SEND_TO_REAL_RECIPIENT": true
}
```

Mantener:

```json
{
  "MAX_EVENTS_PER_RUN": 1
}
```

Primero probar con una sola notificacion real controlada.

## Pausa y limpieza

Para detener:

1. Dejar workflow inactivo.
2. Ejecutar postcheck.
3. Si hay eventos piloto pendientes/processing/failed que deban cancelarse, usar:
   - `outputs/notifications/sql/phase3_dev/cleanup_email_pilot_events.sql`

Ese script no borra historico; solo cancela eventos controlados bajo los criterios documentados.

## Nota sobre pipeline GitHub Actions PR #124

El PR #124 agrega un importador seguro para n8n DEV. Por diseno, ese pipeline importa workflows como inactive y puede deshabilitar nodos de email conocidos, incluido `Email Send Pilot`, para evitar envios accidentales.

Para la primera prueba de conexion/importacion eso esta bien: el objetivo es validar que el JSON entra a n8n DEV sin ejecutar correos. Para probar el EMAIL PILOT real, se debe habilitar manualmente el nodo `Email Send Pilot` en n8n o crear en una fase posterior un importador con confirmacion fuerte, por ejemplo `allow_email_nodes=true`.

No activar destinatarios reales hasta que `SEND_TO_TEST_EMAIL_ONLY=false` y `SEND_TO_REAL_RECIPIENT=true` sean autorizados explicitamente.

## Confirmaciones del paquete

- No usa variables globales de n8n.
- No contiene llaves privilegiadas.
- No contiene host de produccion.
- No contiene secretos reales.
- No contiene credenciales SMTP reales.
- No tiene schedule.
- Tiene nodo de email real, pero requiere credencial manual en n8n.
- El workflow inicia con `active = false`.
