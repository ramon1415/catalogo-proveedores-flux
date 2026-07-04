# Supabase PROD migration reconciliation plan

## Resumen ejecutivo

La auditoria read-only de Supabase PROD ya pudo ejecutarse correctamente contra el proyecto `ucantptjhwttexzmslvm` usando el workflow `Supabase PROD Read-only Schema Audit`.

El hallazgo central es que PROD no esta vacia: tiene tablas, funciones, RLS, policies y buckets de Storage. Sin embargo, no existe `supabase_migrations.schema_migrations`. Eso significa que Supabase CLI no tiene historial registrado para saber que migraciones ya estan representadas en la base.

Por ese motivo no se debe ejecutar `supabase db push` todavia. Si el historial CLI esta vacio pero los objetos ya existen, el CLI podria intentar aplicar migraciones que ya estan reflejadas total o parcialmente en PROD, provocando errores por objetos duplicados o un historial inconsistente.

Este documento no autoriza ejecucion. Su objetivo es dar a Carlos y Ramon una base clara para decidir entre `migration repair`, baseline, aplicacion controlada de faltantes o reconciliacion manual.

## Resultado de auditoria

Fuente: GitHub Actions run `28715226383`, artifact `supabase-prod-readonly-audit-evidence` (`8084209519`).

Resultado resumido:

- PROD accesible por workflow: si.
- Conexion: pooler/session, TCP reachable.
- Auditoria read-only: success.
- `db push`: no ejecutado.
- `migration repair`: no ejecutado.
- DDL/DML: no ejecutado.
- n8n: no tocado.
- `supabase_migrations.schema_migrations`: missing.
- Tablas publicas encontradas: 62.
- Funciones publicas encontradas: 226.
- Tablas publicas con RLS activo: 59.
- Policies publicas encontradas: 71.
- Buckets Storage privados: `celebration-contracts`, `company-receipts`, `payment-receipts`.

Clasificacion preliminar: PROD tiene esquema aplicado fuera del flujo CLI o sin historial registrado.

## Objetos criticos encontrados

| Objeto | PROD |
| --- | --- |
| `public.profiles` | presente |
| `public.roles` | presente |
| `public.user_roles` | presente |
| `public.payment_requests` | presente |
| `public.payment_layouts` | presente |
| `public.payment_layout_lines` | presente |
| `public.payment_receipts` | presente |
| `public.historical_actuals` | faltante |
| `public.notification_events` | faltante |
| `public.notification_delivery_attempts` | faltante |
| `public.suppliers` | faltante |

Nota: la auditoria actual valida presencia de objetos, RLS y policies generales. No valida todavia todas las columnas, constraints, indices, enum values ni el cuerpo exacto de cada funcion.

## Riesgo principal

`supabase db push` calcula que aplicar con base en `supabase_migrations.schema_migrations`. Si esa tabla no existe o no tiene registros, el CLI puede interpretar que debe aplicar todo el ledger disponible en `supabase/migrations`.

En PROD ya existen objetos base como `profiles`, `roles`, `user_roles`, `payment_requests`, `payment_layouts`, `payment_layout_lines` y `payment_receipts`. Si se ejecuta `db push` sin reconciliar historial, el resultado puede ser:

- fallas por objetos ya existentes;
- migraciones parcialmente aplicadas;
- historial CLI incorrecto;
- necesidad posterior de reparacion con mas riesgo;
- interrupcion de la ventana de release.

Por eso el siguiente paso debe ser decision de reconciliacion, no ejecucion.

## Matriz migraciones vs PROD

| Migracion | Objetivo | Objetos esperados | Objetos encontrados en PROD | Estado aparente | Riesgo | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| Base ledger `00101` a `00109` y `00301` a `00307` | Crear estructura base: tablas core, budget, pagos, layouts, efectivo, ingresos, dashboard, vistas y RPCs | `profiles`, `roles`, `user_roles`, `payment_requests`, `payment_layouts`, `payment_layout_lines`, funciones como `create_payment_layout`, `create_payment_request`, `confirm_payment_layout`, `decide_payment_request` | Muchos objetos base existen: 62 tablas, 226 funciones, 71 policies. Objetos criticos base presentes: `profiles`, `roles`, `user_roles`, `payment_requests`, `payment_layouts`, `payment_layout_lines` | Ya aplicada manualmente o parcialmente, pero sin historial CLI | Alto si se hace `db push` completo: podria intentar recrear objetos base | Hacer matriz detallada por archivo base antes de cualquier repair. Probable baseline/repair parcial para migraciones confirmadas |
| `00110_number_sequences.sql` | Versionar secuencias `payment_request_number_seq` y `payment_layout_number_seq` | `public.payment_request_number_seq`, `public.payment_layout_number_seq` | La auditoria confirmo funcion `generate_payment_request_number` y `create_payment_layout`, pero no consulto secuencias directamente. `payment_layout_number_seq` era requisito del dry-run/release, pero no queda probado por esta auditoria | No concluyente | Medio: si faltan secuencias, RPCs pueden fallar; si existen y CLI aplica `CREATE SEQUENCE IF NOT EXISTS`, el riesgo tecnico es menor | Ejecutar auditoria read-only especifica de secuencias. Solo marcar/aplicar despues de confirmar |
| `00401_historical_actuals.sql` | Versionar tabla `historical_actuals`, unique, FK, RLS y policies | `public.historical_actuals`, policies `historical_actuals_select`, `historical_actuals_write` | `public.historical_actuals` faltante | No aplicada | Bajo/medio: aplicar podria ser necesario, pero no debe hacerse antes de resolver baseline/historial | Mantener como pendiente real. Aplicar solo despues de estrategia de historial aprobada |
| `00402_payment_receipts_policies.sql` | Agregar/ajustar policies RLS para escritura de `payment_receipts` | Tabla `payment_receipts`, RLS activo, policy `payment_receipts_select`, policy `payment_receipts_write_authorized`, grants a authenticated | `payment_receipts` presente y RLS activo. En la lista de policies no aparece `payment_receipts_write_authorized` ni `payment_receipts_select` | Parcialmente aplicada: tabla/RLS existen; policies versionadas parecen faltantes | Alto funcional: comprobantes de transferencia pueden fallar por RLS si falta policy de escritura | Confirmar con auditoria read-only especifica de policies/grants. Si falta, preparar aplicacion controlada de 00402 despues de reconciliacion |
| `00403_fase2_payment_method_closure.sql` | Separar `request_type` de `payment_method`, agregar `online_purchase`, constraint, indice y actualizar `create_payment_layout` para incluir solo transferencias | Columna `payment_requests.payment_method`, constraint `payment_requests_payment_method_check`, enum value `online_purchase`, indice `idx_payment_requests_payment_method`, funcion `create_payment_layout` con filtro `payment_method = transfer` | `payment_requests` existe y `create_payment_layout(date,date,uuid,text,uuid,uuid)` existe. La auditoria no reviso columnas, enum values, constraints, indices ni cuerpo de la funcion | No concluyente | Alto para release: layout bancario podria incluir metodos no transferencia si la funcion no esta actualizada | Hacer auditoria read-only especifica de columnas/constraints/enum/functiondef antes de decidir repair o aplicacion |
| `007_notifications.sql` | Versionar ledger de notificaciones: tablas, funciones, trigger, RLS, policies y grants | `notification_events`, `notification_delivery_attempts`, funciones `enqueue/claim/mark`, trigger `set_updated_at_notification_events`, RLS/policies | `notification_events` faltante y `notification_delivery_attempts` faltante | No aplicada | Medio: no debe bloquear Fase 2 si la feature queda inactiva; alto si se intenta probar notificaciones en PROD sin migracion | No probar notificaciones en PROD todavia. Aplicar 007 solo cuando historial este reconciliado y con autorizacion separada |

## Clasificacion por migracion

- Migraciones base: no concluyente a nivel archivo, pero los objetos principales indican que una parte importante del esquema ya existe fuera del historial CLI.
- `00110_number_sequences.sql`: no concluyente hasta auditar secuencias.
- `00401_historical_actuals.sql`: no aplicada segun presencia de tabla.
- `00402_payment_receipts_policies.sql`: parcialmente aplicada o incompleta; tabla/RLS existen, policies versionadas aparentan faltar.
- `00403_fase2_payment_method_closure.sql`: no concluyente; se requiere auditoria especifica de columna, enum, constraint, indice y cuerpo de funcion.
- `007_notifications.sql`: no aplicada segun presencia de tablas.

## Opciones de reconciliacion

### Opcion A - `supabase migration repair`

Marcar como aplicadas solo las migraciones cuyos objetos ya existen correctamente en PROD.

Condiciones previas:

- Auditoria read-only por migracion confirma equivalencia suficiente.
- Carlos/Ramon autorizan explicitamente los repair exactos.
- Se documentan los ids/versiones a reparar.
- Se ejecuta primero en una ventana controlada.

Riesgo: marcar como aplicada una migracion que no esta realmente completa puede ocultar faltantes y romper futuros `db push`.

### Opcion B - baseline formal

Crear una linea base si PROD ya tiene una estructura equivalente al estado inicial del ledger, evitando que CLI intente recrear objetos base.

Condiciones previas:

- Se identifica que las migraciones base estan representadas de forma suficiente.
- Se separan migraciones realmente faltantes (`00401`, `00402`, `00403`, `007`, segun auditoria especifica).
- Se documenta el punto exacto de baseline.

Riesgo: requiere precision para no saltar cambios importantes.

### Opcion C - aplicar faltantes

Aplicar solo objetos realmente faltantes, despues de repair/baseline o como migracion controlada si se decide no usar `db push` completo todavia.

Ejemplos probables segun auditoria actual:

- `historical_actuals` parece faltante.
- policies de `payment_receipts` parecen faltantes.
- notificaciones 007 parecen faltantes.
- Fase 2 `payment_method` requiere auditoria adicional.

Riesgo: aplicar faltantes sin ordenar historial puede perpetuar el desfase CLI.

### Opcion D - recrear PROD limpio

Recrear PROD desde cero con `supabase/migrations` como fuente unica.

Esta opcion solo debe considerarse si se detecta inconsistencia grave y si negocio autoriza un plan completo de backup, restauracion, carga de datos y corte. No se recomienda como primer camino.

## Recomendacion inicial

No ejecutar todavia:

- `supabase db push`.
- `supabase migration repair`.
- migraciones manuales.
- pruebas productivas de notificaciones.
- merge de #147.

Camino recomendado:

1. Revisar este documento con Carlos/Ramon.
2. Preparar auditoria read-only especifica para columnas, constraints, indices, secuencias y cuerpos de funciones criticas.
3. Confirmar equivalencia de migraciones base.
4. Decidir si conviene repair, baseline o aplicacion controlada de faltantes.
5. Documentar comandos exactos antes de ejecutarlos.
6. Autorizar cada ejecucion por separado.

## Plan de autorizacion requerido

Cada paso siguiente requiere autorizacion explicita y separada:

- Autorizar auditoria read-only adicional.
- Autorizar `supabase migration repair` con versiones exactas.
- Autorizar `supabase db push --dry-run`.
- Autorizar `supabase db push` real.
- Autorizar merge de #147.
- Autorizar smoke test productivo.
- Autorizar pruebas de notificaciones en PROD.

Sin esas autorizaciones, el estado debe permanecer detenido.

## Orden sugerido posterior

1. Revisar este documento de reconciliacion.
2. Carlos/Ramon aprueban estrategia.
3. Ejecutar auditoria read-only de detalle para:
   - secuencias;
   - columnas de `payment_requests`;
   - enum `payment_request_type`;
   - constraints e indices;
   - policies/grants de `payment_receipts`;
   - cuerpo de `create_payment_layout`;
   - objetos de notificaciones.
4. Si aplica, ejecutar `supabase migration repair` solo para migraciones confirmadas.
5. Ejecutar `supabase db push --dry-run`.
6. Revisar salida del dry-run.
7. Si no hay riesgos, autorizar `supabase db push`.
8. Smoke test PROD.
9. Solo despues decidir merge #147 o release correspondiente.

## Notificaciones

La feature de notificaciones se queda versionada en `supabase/migrations/007_notifications.sql`, pero no debe probarse en PROD hasta reconciliar historial/migraciones.

Orden sugerido para notificaciones:

1. Validar estructura despues de reconciliacion.
2. Probar primero en DEV o entorno controlado:
   - crear evento;
   - `claim_pending`;
   - `mark processed` / `mark failed`;
   - n8n manual;
   - Resend controlado.
3. No activar n8n real, cron, schedule ni envios reales hasta autorizacion separada.
4. Probar PROD solo despues de historial consistente y ventana autorizada.

## Controles de este PR

Este PR debe ser solo documental.

Confirmaciones esperadas:

- No toca `main`.
- No toca `dev` directo.
- No mergea #147.
- No ejecuta SQL.
- No ejecuta Actions.
- No ejecuta `db push`.
- No ejecuta `migration repair`.
- No aplica migraciones.
- No toca Supabase PROD.
- No toca Supabase DEV.
- No toca n8n.
- No cambia variables ni secrets.
- No modifica frontend.
- No modifica migraciones.
- No borra nada.
