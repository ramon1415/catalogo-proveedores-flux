# Supabase migrations package - Flux Operadora

Paquete generado desde exports completos de Supabase dev para preparar un proyecto Supabase prod limpio.

## Orden de ejecucion propuesto

1. `001a_extensions_and_types.sql` - extensiones y tipos/enums.
2. `001b_core_tables.sql` - perfiles, roles, empresas, centros, proveedores, cuentas y documentos base.
3. `001c_budget_tables.sql` - tablas presupuestales e importacion.
4. `001d_payment_tables.sql` - solicitudes, aprobaciones y comprobantes de pago.
5. `001e_layout_tables.sql` - layouts y lineas de layout.
6. `001f_cash_tables.sql` - efectivo, comprobaciones y tickets.
7. `001g_income_tables.sql` - socios, cuotas, cobros, incidencias, facturas y entidades comerciales/eventos.
8. `001h_closure_dashboard_tables.sql` - cierre mensual y foreign keys finales.
9. `001i_views.sql` - views presupuestales y de eventos.
10. `001j_number_sequences.sql` - secuencias numericas usadas por RPCs de solicitudes y layouts.
11. `002_enums_triggers_indexes.sql` - funciones de soporte para triggers, indices y triggers.
12. `003a_helper_functions.sql` - helpers de perfil/roles.
13. `003b_budget_rpcs.sql` - RPCs de presupuesto.
14. `003c_payment_request_rpcs.sql` - RPCs de solicitudes/aprobaciones.
15. `003d_layout_rpcs.sql` - RPCs de layouts.
16. `003e_cash_rpcs.sql` - RPCs de efectivo/comprobaciones.
17. `003f_income_invoice_rpcs.sql` - RPCs de ingresos, incidencias y facturas.
18. `003g_dashboard_rpcs.sql` - RPCs de dashboard/cierre.
19. `004_rls_policies_grants.sql` - RLS, policies y grants para `anon`/`authenticated`.
20. `005_storage.sql` - buckets y policies de Storage.
21. `006_seed_base.sql` - seed minimo seguro de roles.

`001_schema.sql` y `003_functions_rpcs.sql` quedan como indices. Se dividieron por tamano para evitar truncamiento del conector.

## Contenido incluido

- Tablas publicas: 59.
- Enums publicos: 27.
- Secuencias publicas incluidas: 2.
- Foreign keys: 154.
- Indices no constraint: 62.
- Triggers: 34.
- Funciones/RPCs de aplicacion: 36 en chunks 003a-003g, mas 2 funciones de soporte en 002.
- Views publicas incluidas:
  - `public.budget_availability`
  - `public.budget_exceptions`
  - `public.celebration_events_with_dates`
- Buckets de Storage: 3.

## Seguridad

- No se incluyen llaves privilegiadas.
- No se incluyen cadenas de conexion.
- No se incluyen contrasenas.
- No se copian solicitudes, pagos, facturas, fondos ni datos operativos de dev.
- Los grants se limitaron a `anon` y `authenticated`; los roles internos/plataforma no se replican.

## Smoke tests de dashboard

Las RPCs de dashboard ejecutan `public.dashboard_assert_access()` al inicio.

Esto significa que estas funciones requieren un usuario autenticado con perfil y rol autorizado:

- `admin`
- `superadmin`
- `sysadmin`
- `system_admin`
- `finance`
- `finanzas`
- `treasury`
- `tesoreria`
- `administracion`
- `approver_2`
- `aprobador_2`
- `direccion`
- `director`

Si se ejecutan desde Supabase SQL Editor sin contexto de autenticacion de la app, sin `auth.uid()` o sin profile/rol asociado, es esperado que fallen con:

```text
not_allowed_to_view_dashboard
```

Ese resultado no bloquea la migracion si las funciones fueron creadas correctamente y las validaciones de tablas, views, funciones, RLS, policies, grants, buckets y seed pasaron.

Para validar dashboard en un Supabase temporal hay que crear un usuario temporal desde **Authentication > Users**, crear su `profile`, asignarle un rol autorizado y probar desde la app con sesion real. Alternativamente, se puede hacer una prueba SQL avanzada simulando `request.jwt.claim.sub`, pero no debe usarse con datos reales ni llaves privilegiadas.

## Resultado de prueba temporal / Fase 0E

Fecha de validacion: 2026-06-15.

La Fase 0E fue validada manualmente en un proyecto Supabase temporal, separado de dev y prod.

Resultado reportado:

- Los archivos de migracion del PR #92 fueron ejecutados en orden hasta el final en Supabase temporal.
- No se usaron datos reales.
- No se toco Supabase dev.
- No se toco Supabase prod.
- No se toco `main`.
- No se toco n8n.
- Las views fueron creadas correctamente:
  - `budget_availability`
  - `budget_exceptions`
  - `celebration_events_with_dates`
- `information_schema.tables` puede mostrar mas objetos que el conteo de tablas base porque incluye tablas y views segun la consulta usada; en la validacion manual aparecieron 62 objetos y `information_schema.views` mostro las 3 views esperadas.
- El unico fallo observado en smoke tests fue `not_allowed_to_view_dashboard` al ejecutar `dashboard_kpis` y `dashboard_closure_checklist` desde SQL Editor sin sesion/auth/profile/rol.
- Ese fallo es esperado porque `dashboard_assert_access()` requiere contexto de usuario autenticado con profile y rol autorizado.
- Un intento de crear `profile` temporal con UUID manual fallo por foreign key contra `auth.users`; eso tambien es esperado porque `profiles.auth_user_id` referencia `auth.users.id`.
- Para validacion avanzada de dashboard, primero debe crearse un usuario temporal desde **Authentication > Users** y despues crear el `profile` usando el `auth.users.id` real.

Con esta prueba, el paquete puede considerarse validado como base para crear un Supabase prod limpio. El PR #92 ya fue mergeado a `dev`; antes de ejecutar en prod real todavia se requiere revision humana final, definicion del seed operativo minimo y validacion de variables/ambientes.

## Revision requerida antes de prod

- Revisar las policies temporales de Storage para `anon` sobre `payment-receipts`.
- Crear usuario admin inicial desde Authentication > Users y asignar profile/rol autorizado antes de validar dashboard desde la app.
- Cargar seed operativo minimo manualmente despues del usuario admin inicial.
- Configurar variables de Vercel Production solo cuando el Supabase prod limpio ya tenga esquema, roles base y admin inicial validados.
