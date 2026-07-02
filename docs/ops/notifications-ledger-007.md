# Notifications ledger 007

## Fuente

Esta migracion se construyo a partir del export read-only de Supabase DEV:

- Workflow: Deploy Supabase DEV Manual #8
- Run: https://github.com/ramon1415/catalogo-proveedores-flux/actions/runs/28571934235
- Artifact: supabase-dev-deployment-evidence
- Artifact ID: 8031309875
- Resultado: NOTIFICATIONS_LEDGER_EXPORT_READY_FOR_007_SOURCE

El artifact confirmo 2 tablas, 8 funciones, 1 trigger, RLS activo y 2 policies.

## Problema que resuelve

El esquema real de DEV tenia objetos de notificaciones fuera del ledger de migraciones. Sin este versionado, un release hacia main/produccion podria depender de tablas, funciones, trigger o policies que no existen en ambientes nuevos.

supabase/migrations/007_notifications.sql versiona esos objetos usando el DDL exportado desde DEV, sin copiar datos operativos.

## Objetos versionados

Tablas:

- public.notification_events
- public.notification_delivery_attempts

Funciones:

- public.claim_pending_notification_events(integer, text)
- public.enqueue_notification_event(text, text, uuid, text, text, uuid, text, text, jsonb, text, text)
- public.enqueue_notification_event_internal(text, text, uuid, text, text, uuid, text, text, jsonb, text, text)
- public.mark_notification_failed(uuid, text, text, text)
- public.mark_notification_processed(uuid, text, text, text)
- public.notification_current_profile_id()
- public.notification_current_user_has_role(text[])
- public.set_updated_at_notification_events()

Trigger:

- set_updated_at_notification_events sobre public.notification_events

RLS / policies:

- RLS activo en public.notification_events
- RLS activo en public.notification_delivery_attempts
- notification_events_select_self_or_admin
- notification_delivery_attempts_select_self_or_admin

Grants:

- Tablas: authenticated recibe select; postgres y service_role reciben permisos completos como en el artifact.
- Funciones: execute segun el artifact.
- La funcion trigger set_updated_at_notification_events() conserva grants exportados para PUBLIC, anon, authenticated, postgres y service_role porque asi aparece en DEV. Esto debe revisarse humanamente antes de produccion; puede venir de defaults de PostgreSQL o de grants previos.

## Seguridad

- La migracion no inserta datos operativos.
- La migracion no importa workflows de n8n.
- La migracion no activa schedules, cron ni envios reales por si misma.
- La migracion no contiene secrets ni llaves.
- service_role aparece solo como rol DB en grants exportados, no como secret/key de frontend.

Nota: los cuerpos de funciones contienen logica con insert/update porque eso forma parte del DDL real exportado por pg_get_functiondef. Crear o reemplazar la funcion no ejecuta esos cuerpos.

## Idempotencia

La migracion usa:

- create table if not exists
- constraints protegidas por checks en pg_constraint
- create index if not exists
- create or replace function
- drop trigger if exists seguido de create trigger
- alter table ... enable row level security
- drop policy if exists seguido de create policy
- grants repetibles

Debe funcionar en PROD donde los objetos aun no existen y en DEV donde ya existen ad-hoc.

## Riesgos conocidos

- Los grants PUBLIC/anon sobre la funcion trigger se mantienen porque fueron exportados desde DEV. Requieren revision humana antes de PROD.
- Las funciones SECURITY DEFINER deben revisarse con especial cuidado antes de ejecucion productiva.
- La funcion claim_pending_notification_events conserva default manual-dev exportado desde DEV. No activa ejecuciones por si misma, pero conviene revisar si debe ajustarse en una migracion posterior.
- Este PR no resuelve n8n ni envio real de correos.

## Validacion posterior sugerida

Despues de mergear a dev, preparar/aplicar un paquete operativo controlado para ejecutar solo 007_notifications.sql en Supabase DEV.

Precheck sugerido:

- Confirmar que se ejecuta contra Supabase DEV.
- Confirmar existencia de prerequisitos: profiles, roles, user_roles y gen_random_uuid().
- Confirmar que no se ejecutara contra PROD.

Postcheck sugerido:

- Confirmar existencia de las 2 tablas.
- Confirmar 8 funciones.
- Confirmar 1 trigger.
- Confirmar RLS activo en ambas tablas.
- Confirmar 2 policies.
- Confirmar grants esperados.
- Confirmar que no se copiaron datos operativos.

## Relacion con release

Esta migracion es prerequisito para desbloquear el ledger de notificaciones antes de avanzar con Fase 1 compania / 008_company_level y antes de revalidar el release #147.
