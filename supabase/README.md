# Supabase migrations package - Flux Operadora

Paquete generado desde exports completos de Supabase dev para preparar un proyecto Supabase prod limpio.

## Orden de ejecucion propuesto

1. `001_schema.sql` - extensiones requeridas, enums, tablas y foreign keys.
2. `002_enums_triggers_indexes.sql` - funciones de soporte para triggers, indices y triggers.
3. `003_functions_rpcs.sql` - funciones/RPCs de aplicacion.
4. `004_rls_policies_grants.sql` - RLS, policies y grants para `anon`/`authenticated`.
5. `005_storage.sql` - buckets y policies de Storage.
6. `006_seed_base.sql` - seed minimo seguro de roles.

## Contenido incluido

- Tablas publicas: 59.
- Enums publicos: 27.
- Foreign keys: 154.
- Indices no constraint: 62.
- Triggers: 34.
- Funciones/RPCs de aplicacion: 38.
- Buckets de Storage: 3.

## Pendientes detectados

Los siguientes objetos aparecen en metadata de columnas, pero el export disponible no trae su DDL. Probablemente son vistas o vistas materializadas y deben exportarse por separado antes de considerar lista una migracion productiva:

- `public.budget_availability`
- `public.budget_exceptions`
- `public.celebration_events_with_dates`


Riesgo principal: algunas RPCs de presupuesto dependen de `public.budget_availability`; si esa vista no existe en prod, esas validaciones fallaran al ejecutarse.

## Seguridad

- No se incluyen llaves privilegiadas.
- No se incluyen cadenas de conexion.
- No se incluyen contrasenas.
- No se copian solicitudes, pagos, facturas, fondos ni datos operativos de dev.
- Los grants se limitaron a `anon` y `authenticated`; los roles internos/plataforma no se replican.

## Revision requerida antes de prod

- Revisar las policies temporales de Storage para `anon` sobre `payment-receipts`.
- Validar el paquete en un proyecto Supabase temporal antes de prod.
- Exportar y agregar el DDL faltante de vistas.
- Cargar seed operativo minimo manualmente despues del usuario admin inicial.
