-- Hardening de seguridad a partir de los advisors de Supabase (04-sep-2026).
-- NO cambia la lógica de ninguna función ni vista: solo ajusta propiedades de
-- seguridad. Idempotente y seguro de correr en dev y prod:
--   - dev ya tiene la vista en security_invoker y las 10 funciones con
--     search_path fijado (no se tocan: se actúa solo donde falta).
--   - prod es donde viven los hallazgos (vista SECURITY DEFINER, 10 funciones
--     con search_path mutable, btree_gist en public).

-- 1) Vista con SECURITY INVOKER: respeta el RLS del usuario que la consulta,
--    en vez de ejecutarse con los permisos del creador. (lint 0010)
alter view if exists public.celebration_events_with_dates set (security_invoker = on);

-- 2) Fijar search_path SOLO en las funciones que no lo tienen (proconfig null).
--    Se elige `pg_catalog, public` (pin no disruptivo): mitiga el secuestro de
--    search_path sin reescribir los cuerpos. En dev estas ya lo tienen fijado,
--    así que el bloque las salta. (lint 0011)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proconfig is null
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
