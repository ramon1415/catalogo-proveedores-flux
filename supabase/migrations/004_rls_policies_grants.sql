-- Tanda 0C - 004_rls_policies_grants.sql
-- Flux Operadora - RLS, policies y grants
-- Estado: PENDIENTE DE EXTRACCION DESDE SUPABASE DEV.
-- No ejecutar en produccion hasta que haya revision humana.

-- Debe incluir:
-- - alter table ... enable row level security.
-- - Policies por tabla.
-- - Grants a authenticated/anon si aplican.
-- - Grants de execute para RPCs.
-- - Permisos sobre sequences si existieran.

-- Modelo esperado:
-- - profiles.auth_user_id se relaciona con auth.uid().
-- - current_profile_id() resuelve el profile actual.
-- - current_user_has_role(text[]) valida roles.
-- - roles/user_roles gobiernan accesos admin, finance, finanzas, approver_2,
--   aprobador_2, solicitante, operator, sysadmin y system_admin.

-- Reglas por modulo a preservar:
-- - Usuarios autenticados solo ven/operan lo permitido por RLS.
-- - Finanzas/admin/direccion tienen visibilidad ampliada donde el flujo lo requiere.
-- - Solicitantes no deben poder aprobar ni revisar fuera de permisos.
-- - Fondos/comprobaciones respetan responsable y roles financieros.
-- - Ingresos/facturas se restringen a roles autorizados.
-- - Dashboard/cierres se restringen a roles autorizados.

-- Validaciones sugeridas despues de llenar:
-- select schemaname, tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;
-- select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname;
-- select grantee, table_schema, table_name, privilege_type from information_schema.role_table_grants where table_schema = 'public' order by table_name, grantee, privilege_type;
-- select routine_schema, routine_name, privilege_type, grantee from information_schema.routine_privileges where routine_schema = 'public' order by routine_name, grantee;

-- Seguridad:
-- - No incluir service_role.
-- - No otorgar permisos excesivos sin revision.
-- - No usar comparaciones directas a auth.uid() si el modelo real usa profiles.auth_user_id, salvo que esa sea la policy real validada.
