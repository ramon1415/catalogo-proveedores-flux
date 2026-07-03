# Notifications ledger 007

## Estado actual

`supabase/migrations/007_notifications.sql` ya esta versionado en `dev` como fuente de verdad del ledger de notificaciones.

La migracion se queda. La feature de notificaciones se queda. Lo que se retiro fue el ceremonial operativo basado en paquetes `ops/precheck/load/postcheck` y workflows custom.

La aplicacion futura de migraciones debe seguir el flujo Supabase CLI documentado en:

```text
docs/ops/supabase-cli-migrations.md
```

## Fuente historica

Esta migracion se construyo a partir del export read-only de Supabase DEV:

- Run: https://github.com/ramon1415/catalogo-proveedores-flux/actions/runs/28571934235
- Artifact: supabase-dev-deployment-evidence
- Artifact ID: 8031309875
- Resultado: `NOTIFICATIONS_LEDGER_EXPORT_READY_FOR_007_SOURCE`

Ese workflow/export fue evidencia historica para construir el DDL. No es el procedimiento vigente para aplicar migraciones.

## Problema que resuelve

El esquema real de DEV tenia objetos de notificaciones fuera del ledger de migraciones. Sin este versionado, un release hacia `main`/produccion podria depender de tablas, funciones, trigger o policies que no existen en ambientes nuevos.

`supabase/migrations/007_notifications.sql` versiona esos objetos usando el DDL exportado desde DEV, sin copiar datos operativos.

## Objetos versionados

Tablas:

- `public.notification_events`
- `public.notification_delivery_attempts`

Funciones:

- `public.claim_pending_notification_events(integer, text)`
- `public.enqueue_notification_event(text, text, uuid, text, text, uuid, text, text, jsonb, text, text)`
- `public.enqueue_notification_event_internal(text, text, uuid, text, text, uuid, text, text, jsonb, text, text)`
- `public.mark_notification_failed(uuid, text, text, text)`
- `public.mark_notification_processed(uuid, text, text, text)`
- `public.notification_current_profile_id()`
- `public.notification_current_user_has_role(text[])`
- `public.set_updated_at_notification_events()`

Trigger:

- `set_updated_at_notification_events` sobre `public.notification_events`

RLS / policies:

- RLS activo en `public.notification_events`
- RLS activo en `public.notification_delivery_attempts`
- `notification_events_select_self_or_admin`
- `notification_delivery_attempts_select_self_or_admin`

## Hardening aplicado

La estructura funcional viene del artifact DEV `8031309875`. El ajuste intencional esta en permisos `EXECUTE`:

- Se agregaron `REVOKE EXECUTE` explicitos para `PUBLIC`, `anon` y `authenticated` en las 8 funciones.
- Se evita que PostgreSQL deje `EXECUTE` a `PUBLIC` por default en funciones `SECURITY DEFINER`.
- `enqueue_notification_event_internal(...)` queda limitado a `service_role` y `postgres` porque es interna.
- `set_updated_at_notification_events()` queda limitado a `service_role` y `postgres` porque es funcion trigger.

## Seguridad

- La migracion no inserta datos operativos.
- La migracion no importa workflows de n8n.
- La migracion no activa schedules, cron ni envios reales por si misma.
- La migracion no contiene secrets ni llaves.
- `service_role` aparece solo como rol DB en grants exportados, no como secret/key de frontend.

Nota: los cuerpos de funciones contienen logica con insert/update porque eso forma parte del DDL real exportado por `pg_get_functiondef`. Crear o reemplazar la funcion no ejecuta esos cuerpos.

## Validacion vigente

No preparar paquetes operativos por migracion.

Para DEV/PROD, usar Supabase CLI con revision humana:

```bash
supabase db push --dry-run
supabase db push
```

Antes de aplicar, revisar el historial remoto en `supabase_migrations.schema_migrations`, porque parte del esquema fue aplicado previamente con workflows custom. Si el historial no coincide con la realidad de la base, documentar un plan separado de `supabase migration repair`; no ejecutarlo sin autorizacion.

Validaciones manuales esperadas despues de aplicar:

- Confirmar existencia de las 2 tablas.
- Confirmar 8 funciones.
- Confirmar 1 trigger.
- Confirmar RLS activo en ambas tablas.
- Confirmar 2 policies.
- Confirmar grants esperados.
- Confirmar que `enqueue_notification_event_internal` no tiene `EXECUTE` para `PUBLIC`, `anon` ni `authenticated`.
- Confirmar que `set_updated_at_notification_events` no tiene `EXECUTE` para `PUBLIC`, `anon` ni `authenticated`.
- Confirmar que no se copiaron datos operativos.

## Relacion con release

Esta migracion es prerequisito de ledger para notificaciones y debe viajar como migracion versionada, no como paquete operativo. Antes de release, actualizar la descripcion de PR #147 para reflejar Supabase CLI y retirar referencias a `ops` como flujo vigente.
