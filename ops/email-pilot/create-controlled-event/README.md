# DEV email pilot controlled event

Este paquete prepara un evento controlado para probar el workflow `Flux DEV - Notification Dispatcher EMAIL PILOT` en DEV.

El paquete crea como maximo 1 evento `pending` en `public.notification_events`, con llave idempotente `phase3-dev:email-pilot:*`. No envia correos, no ejecuta n8n y no activa workflows.

## Archivos

- `precheck.sql`: valida ambiente esperado, tablas, columnas, pendientes actuales, solicitud usable y admin/sysadmin con email.
- `load.sql`: inserta 1 evento `payment_request.created` pendiente, con `on conflict (idempotency_key) do nothing`.
- `postcheck.sql`: valida que el evento este listo para ser reclamado por el EMAIL PILOT.

## Ejecucion manual con GitHub Actions

Usar el workflow manual ya validado:

```text
Action: Deploy Supabase DEV Manual
Branch: dev
script_path: ops/email-pilot/create-controlled-event
confirm_dev: scsirgbuqjcwoaxfacth
```

## Seguridad

- Solo DEV.
- No envia correos.
- No ejecuta n8n.
- No activa workflows.
- No borra historico.
- No modifica delivery attempts.
- No incluye credenciales.
- No incluye datos bancarios.
- Inserta maximo 1 evento pendiente con idempotencia.

## Validacion esperada

Despues de ejecutar el Action, revisar el log y confirmar que `postcheck.sql` termine con uno de estos resultados:

```text
PHASE3_EMAIL_PILOT_EVENT_READY
PHASE3_EMAIL_PILOT_EVENT_ALREADY_EXISTS_READY
```

Tambien validar antes de ejecutar el workflow en n8n:

- Existe 1 evento `pending` con `idempotency_key` prefijo `phase3-dev:email-pilot:`.
- El workflow EMAIL PILOT esta configurado en n8n.
- `Set Config` y la credencial de email estan listos.
- El workflow se ejecutara manualmente solo cuando la configuracion este revisada.

## Limpieza

Si se necesita limpiar el evento piloto no finalizado, usar el paquete existente:

```text
outputs/notifications/sql/phase3_dev/cleanup_email_pilot_events.sql
```
