-- Flux Operadora - Migracion 001i
-- Views detectadas en metadata pero sin DDL en los exports disponibles.
-- No se inventa SQL para estas vistas. Exportar su definicion real antes de ejecutar prod.

-- TODO missing DDL: public.budget_availability
-- TODO missing DDL: public.budget_exceptions
-- TODO missing DDL: public.celebration_events_with_dates

-- Query sugerido para obtener vistas:
-- select schemaname, viewname, definition from pg_views where schemaname = 'public' order by viewname;

-- Query sugerido para obtener vistas materializadas:
-- select schemaname, matviewname, definition from pg_matviews where schemaname = 'public' order by matviewname;

-- Queries especificos:
-- select pg_get_viewdef('public.budget_availability'::regclass, true) as view_sql;
-- select pg_get_viewdef('public.budget_exceptions'::regclass, true) as view_sql;
-- select pg_get_viewdef('public.celebration_events_with_dates'::regclass, true) as view_sql;
