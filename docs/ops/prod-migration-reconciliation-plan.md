# Supabase PROD migration reconciliation plan

## Resumen ejecutivo

La auditoria fina read-only de Supabase PROD ya se ejecuto correctamente contra el proyecto PROD `ucantptjhwttexzmslvm`.

Fuente:

- Workflow: `Supabase PROD Read-only Schema Audit`
- Run: `#11 / 28717477643`
- Artifact: `supabase-prod-fine-audit-evidence`
- Artifact ID: `8084830344`
- Resultado: `success`

Clasificacion global: **B - PROD tiene esquema parcial, pero sin historial CLI**.

El hallazgo central es que PROD no esta vacia, pero tampoco tiene historial CLI:

- `supabase_migrations`: no existe.
- `supabase_migrations.schema_migrations`: no existe.
- Hay objetos productivos relevantes ya creados fuera del historial CLI.
- Algunas migraciones estan reflejadas, otras estan ausentes y otras estan parcialmente representadas.

Por este motivo siguen bloqueados:

- `supabase db push` real.
- `supabase migration repair`.
- aplicacion de migraciones.
- merge de #147 a `main`.
- pruebas productivas de notificaciones.

Este documento no autoriza ejecucion. Formaliza la foto real de PROD y prepara la decision tecnica para Carlos/Ramon.

## Controles de la auditoria fina

La auditoria fina:

- uso el GitHub Environment `supabase-production`;
- uso el secret `SUPABASE_PROD_AUDIT_DB_URL`;
- conecto por pooler/session;
- termino en `success`;
- ejecuto consultas de metadata/catalogo;
- no ejecuto `db push`;
- no ejecuto `migration repair`;
- no aplico migraciones;
- no ejecuto DDL/DML;
- no toco n8n;
- no cambio secrets ni variables.

Nota de guardrail: el run #11 reporto `default_transaction_read_only = off` en la consulta de identidad. Aunque el workflow no ejecuto escrituras, el workflow debe endurecerse para forzar/verificar transacciones read-only antes de reutilizarlo como patron permanente.

## Matriz fina por migracion

| Migracion | Estado PROD | Objetos encontrados | Objetos faltantes | Riesgo de aplicar directo | Recomendacion tecnica | Revision humana |
| --- | --- | --- | --- | --- | --- | --- |
| `00110_number_sequences.sql` | Aplicada | `payment_request_number_seq` existe; `payment_layout_number_seq` existe | Ninguno detectado en la auditoria fina | Medio: no debe marcarse en historial sin confirmar equivalencia completa | Candidata a `supabase migration repair` o baseline selectivo, solo si Carlos/Ramon aceptan que las secuencias coinciden con el ledger | Si |
| `00401_historical_actuals.sql` | No aplicada | Ninguno | `historical_actuals`, columnas, constraints, RLS/policies | Medio: aplicar antes de ordenar historial perpetua el desfase CLI | Pendiente real. No aplicar hasta decidir baseline/repair y revisar ventana | Si |
| `00402_payment_receipts_policies.sql` | Parcial | `payment_receipts` existe; RLS activo; `flux_member_roles()` y `flux_approver_roles()` existen | policies `payment_receipts_select` y `payment_receipts_write_authorized`; grants/policies versionadas equivalentes | Alto funcional: comprobantes pueden fallar por RLS; tambien hay grants amplios a `anon` detectados y requieren revision cuidadosa | Revisar si conviene aplicar 00402 idempotente o preparar patch especifico de policies/grants despues de reconciliar historial | Si |
| `00403_fase2_payment_method_closure.sql` | Parcial | `payment_requests.request_type` existe; enum `payment_request_type` existe; `create_payment_layout(date,date,uuid,text,uuid,uuid)` existe | `payment_requests.payment_method`; constraint `payment_requests_payment_method_check`; indice `idx_payment_requests_payment_method`; enum `online_purchase`; guard backend `payment_method=transfer` en `create_payment_layout` | Alto para release: sin esto PROD no garantiza separacion de tipo/metodo ni filtro de transferencias en backend | Revisar si 00403 puede ejecutarse idempotente sin fallar por objetos existentes; probablemente requiere aplicacion controlada despues de ordenar historial | Si |
| `007_notifications.sql` | No aplicada | Ninguno | `notification_events`; `notification_delivery_attempts`; 8 funciones; trigger; RLS/policies/grants | Medio: no bloquea si notificaciones quedan inactivas, pero no debe probarse en PROD | Pendiente real. Aplicar solo despues de resolver historial y validar primero en DEV; no activar n8n real | Si |

## Lectura tecnica por migracion

### `00110_number_sequences.sql`

La auditoria fina encontro ambas secuencias:

- `public.payment_request_number_seq`
- `public.payment_layout_number_seq`

Lectura: la migracion esta representada en PROD a nivel de objetos principales, pero no existe historial CLI. Es candidata a marcarse como aplicada mediante `supabase migration repair` o baseline selectivo, si se valida que no hay diferencias relevantes.

### `00401_historical_actuals.sql`

La tabla `public.historical_actuals` no existe en PROD. Tampoco existen columnas, constraints ni policies asociadas.

Lectura: es pendiente real. No aplicar hasta ordenar historial CLI.

### `00402_payment_receipts_policies.sql`

La tabla `public.payment_receipts` existe y RLS esta activo, pero no aparecen las policies versionadas:

- `payment_receipts_select`
- `payment_receipts_write_authorized`

Tambien se observaron privilegios amplios para `anon` y `authenticated` sobre `payment_receipts`; esto requiere revision humana antes de tocar permisos.

Lectura: la migracion esta parcial. Hay que decidir si se aplica 00402 tal cual o si conviene un patch especifico de policies/grants.

### `00403_fase2_payment_method_closure.sql`

PROD tiene `payment_requests.request_type`, pero no tiene:

- `payment_requests.payment_method`
- constraint `payment_requests_payment_method_check`
- indice `idx_payment_requests_payment_method`
- enum value `online_purchase`
- guard de `create_payment_layout` basado en `payment_method` y `transfer`

Lectura: la migracion esta parcial. Este punto bloquea release funcional completo a PROD porque layouts y metodo de pago no quedan cerrados desde backend.

### `007_notifications.sql`

PROD no tiene:

- `notification_events`
- `notification_delivery_attempts`
- funciones de notificaciones
- trigger de notificaciones
- RLS/policies de notificaciones

Lectura: no aplicada. No probar notificaciones en PROD hasta reconciliar historial y aplicar 007 con autorizacion separada.

## Opciones de reconciliacion

### Opcion A - `supabase migration repair` selectivo

Marcar como aplicada solo una migracion cuyos objetos ya existen correctamente en PROD.

Candidata actual:

- `00110_number_sequences.sql`, si Carlos/Ramon aceptan la equivalencia de las secuencias.

No candidatas todavia:

- `00401`: no aplicada.
- `00402`: parcial.
- `00403`: parcial.
- `007`: no aplicada.

Riesgo: marcar como aplicada una migracion incompleta oculta faltantes y complica futuros `db push`.

### Opcion B - baseline controlado

Definir una linea base del estado real de PROD para no intentar recrear objetos ya existentes.

Condiciones:

- Inventario de objetos base suficiente.
- Aprobacion Carlos/Ramon.
- Lista clara de migraciones realmente faltantes o parciales.

Riesgo: si el baseline cubre objetos incompletos, el CLI dejara de aplicar cambios necesarios.

### Opcion C - patches para migraciones parciales

Preparar migraciones o pasos especificos para completar objetos parciales sin recrear lo que ya existe.

Posibles candidatos:

- policies/grants de `payment_receipts`.
- `payment_method`, constraint, indice, enum `online_purchase` y funcion `create_payment_layout`.

Riesgo: si se hace fuera del historial CLI, se perpetua el desfase. Debe ir coordinado con repair/baseline.

### Opcion D - `supabase db push --dry-run` despues de repair/baseline

Solo despues de resolver el historial, correr dry-run para confirmar que el CLI ya no intenta reaplicar objetos existentes indebidamente.

Riesgo: correrlo antes de reconciliar no modifica datos, pero puede seguir mostrando un plan inutil o confuso.

### Opcion E - recrear PROD limpio

Solo si se detecta inconsistencia grave y negocio autoriza backup, restauracion/carga de datos y ventana extendida.

No se recomienda como primer camino.

## Plan recomendado

No ejecutar nada todavia.

Propuesta de orden:

1. Revisar este plan con Carlos/Ramon.
2. Endurecer el workflow read-only para que valide transaccion `READ ONLY` y falle si no queda activa.
3. Preparar, en PR separado, comandos propuestos de `migration repair` o baseline sin ejecutarlos.
4. Si se autoriza, ejecutar solo repair/baseline especifico.
5. Ejecutar `supabase db push --dry-run`.
6. Revisar salida del dry-run.
7. Si queda limpio, pedir autorizacion explicita para aplicar faltantes.
8. Solo despues retomar merge/release #147.

## Notificaciones

`007_notifications.sql` no esta aplicada en PROD.

No probar notificaciones en PROD todavia.

La prueba de notificaciones debe hacerse primero en DEV/controlado:

1. verificar `notification_events`;
2. verificar `notification_delivery_attempts`;
3. crear evento controlado;
4. `claim_pending`;
5. `mark processed` / `mark failed`;
6. n8n manual;
7. Resend con destinatarios controlados.

No activar n8n real ni envios reales en PROD hasta autorizacion separada.

## Estado bloqueado

Siguen bloqueados hasta autorizacion explicita:

- `supabase db push`;
- `supabase migration repair`;
- aplicacion de migraciones;
- merge de #147;
- pruebas PROD de notificaciones;
- cambios en secrets/variables;
- cambios en n8n real.

## Confirmaciones de este plan

Este documento es de reconciliacion. No ejecuta nada y no autoriza ejecucion.

Cualquier paso operativo posterior debe tener PR/orden separados y autorizacion explicita de Carlos/Ramon.