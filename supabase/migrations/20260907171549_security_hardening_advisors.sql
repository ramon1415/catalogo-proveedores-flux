-- Hardening de seguridad a partir de los advisors de Supabase (04-sep-2026).
-- NO cambia la lógica de ninguna función ni vista: solo ajusta propiedades de
-- seguridad. Idempotente y seguro de correr en dev y prod:
--   - dev ya tiene la vista en security_invoker y las 10 funciones con
--     search_path fijado (no se tocan: se actúa solo donde falta).
--   - prod es donde viven los hallazgos (vista SECURITY DEFINER, 10 funciones
--     con search_path mutable, btree_gist en public).

-- 1) Vista con SECURITY INVOKER: respeta el RLS del usuario que la consulta,
--    en vez de ejecutarse con los permisos del creador. (lint 0010)
--    NOTA (acceso intencional): la tabla base `celebration_events` tiene RLS
--    activo y CERO políticas (deny-all). Con SECURITY INVOKER, un usuario normal
--    no verá filas — es el bloqueo esperado. Verificado en prod: base 0 filas,
--    vista 0 filas, sin consumidores en la app (grep app/src). Si en el futuro
--    se necesita exponerla, la vía correcta es una POLICY en `celebration_events`,
--    no reabrir la vista como SECURITY DEFINER.
alter view if exists public.celebration_events_with_dates set (security_invoker = on);

-- 2) Fijar search_path SOLO en las funciones a las que les FALTA search_path.
--    Se comprueba específicamente la ausencia de un `search_path=` en proconfig
--    (no `proconfig IS NULL`, que se saltaría una función con OTRA config —p.ej.
--    statement_timeout— pero sin search_path). Se elige `pg_catalog, public`
--    (pin no disruptivo): mitiga el secuestro sin reescribir los cuerpos y
--    PRESERVA cualquier config existente. En dev estas ya lo tienen, así que el
--    bloque las salta; en prod las 10 lo reciben. (lint 0011)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
        where cfg like 'search_path=%'
      )
      and p.proname in (
        'payment_request_approver_role_names', 'set_updated_at', 'update_updated_at_column',
        'flux_sysadmin_roles', 'flux_finance_roles', 'flux_approver_roles', 'flux_member_roles',
        'generate_payment_request_number', 'notification_decision_label', 'dashboard_assert_access'
      )
  loop
    execute format('alter function %s set search_path = pg_catalog, public', r.sig);
    raise notice 'search_path fijado en %', r.sig;
  end loop;
end $$;

-- 3) Mover btree_gist fuera de public a un schema `extensions` dedicado.
--    (lint 0014). Los índices/constraints existentes que usan sus operadores
--    siguen funcionando (referencian la opclass por oid, no por search_path).
create schema if not exists extensions;
grant usage on schema extensions to public;
do $$
begin
  if exists (
    select 1 from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'public'
  ) then
    execute 'alter extension btree_gist set schema extensions';
    raise notice 'btree_gist movido a schema extensions';
  end if;
end $$;
