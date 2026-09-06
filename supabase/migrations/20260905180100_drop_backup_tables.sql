-- Limpieza de tablas de respaldo/scratch en public (reduce superficie y ~17
-- hallazgos de ruido rls_enabled_no_policy). DESTRUCTIVO pero acotado: solo
-- tablas cuyo nombre es de backup (`zzbackup%` / `_backup%`).
--
-- Verificado (05-sep-2026): la única en prod (`zzbackup_proveedores_20260709`)
-- no tiene FKs entrantes ni vistas dependientes (solo su TOAST). Las de dev
-- son respaldos de migraciones 022/029 y saneos de proveedores/tickets.
-- DROP IF EXISTS => no-op donde la tabla no exista.

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and (tablename like 'zzbackup%' or tablename like '\_backup%')
  loop
    execute format('drop table if exists public.%I', r.tablename);
    raise notice 'drop table public.%', r.tablename;
  end loop;
end $$;
