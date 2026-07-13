# Ejecucion de cortes, reingresos y pagos extraordinarios

## Alcance

La migracion `022_batch_execution_resubmission_extraordinary.sql` convierte el cierre del corte en una autorizacion operativa de pago. Extiende el MVP de la migracion 021 sin modificarla y conserva independencia total de las migraciones 018 y 019.

El release aislado requiere el esquema base, las migraciones de notificaciones ya usadas por 021, la migracion 021 y la migracion 022. No consulta asignaciones individuales de aprobador ni membresias introducidas por 018/019. `solicitudes.js` queda fuera del release: la integracion usa `solicitudes_batch_execution.js` como adaptador DOM desacoplado.

## Manifest de release aislado

Commits de origen del batch:

- `af44677caa67d5f6ceadbed92f3a38cd3af499ef`: MVP independiente de cortes (migration 021 y frontend base).
- `a6a3f3b3fc878bf59788d039428b7e15a4ab242f`: hardening de migration 021.
- `3c9af6ce235557b5f8ffcbb997caea21213b7747`: flujo masivo y UX del frontend de cortes.
- `872724f577e53f25c95bad459c2a6941ee3c114d`: guard de acceso por rol del frontend de cortes.
- `ce55a03790538f70a417d9d0fb38c8e09938ccd5`: migration 022 y experiencia de ejecucion.
- `1684f766d29ff8f3d07e1f8e256781f6b723079d`: vigencia, locks, configuracion atomica, independencia y notificaciones.

Archivos runtime exactos:

- `config.js`;
- `approval_batches.html`;
- `approval_batches.js`;
- `layouts.html`;
- `layouts.js`;
- `solicitudes.html`;
- `solicitudes_batch_execution.js`;
- `supabase/functions/notification-dispatcher/index.ts`;
- `supabase/migrations/021_approval_batches_mvp.sql`;
- `supabase/migrations/022_batch_execution_resubmission_extraordinary.sql`.

La validacion aislada parte de `origin/main`, incorpora solo esos commits/archivos y ejecuta sintaxis, parser y guard de contratos sin 018/019. `solicitudes.js`, `create_payment_request`, `approver_id`, `approver_assignment_id` y `list_payment_request_approver_options` no forman parte del manifest.

### Resultado de la validacion aislada

Se probo desde `origin/main` en `034a89d699f155c93ba918baa3be7e4055b73b1b`. El dispatcher no existia en esa base, por lo que se incorporo como archivo runtime declarado por el batch. `solicitudes.html` conservo los scripts y cache-busters de `main` y agrego solo `solicitudes_batch_execution.js`; `solicitudes.js` quedo sin diferencias contra `main`.

El arbol aislado paso:

- parser PostgreSQL para 021 y 022;
- `node --check` en todo el JavaScript del batch;
- TypeScript del dispatcher;
- guard en modo `isolated-main`;
- HTML sin IDs duplicados;
- `git diff --check`;
- cero cambios en migrations 018/019;
- cero cambios en `solicitudes.js`.

## Diagnostico previo

Antes de 022:

- Un item aprobado podia ejecutarse con el batch en `approved`, `partially_approved` o `closed`.
- Una solicitud nunca inscrita en un corte conservaba el flujo legacy.
- Un rechazo solo podia marcarse como liberado; no existia un RPC atomico que creara la nueva participacion.
- Layouts no separaba rechazadas, pendientes de Direccion, pendientes de cierre y extraordinarias.
- El scroll de la tabla dependia de `items.length > 10`, por lo que la altura disponible podia ocultar filas aun con pocos registros.

## Modelo de enforcement

`approval_batch_company_settings` permite activar por empresa `regular_payments_require_closed_batch`. La primera activacion registra actor y fecha en servidor y es irreversible dentro del MVP. Solo las solicitudes creadas desde el primer `enforcement_started_at` quedan obligadas; las historicas conservan compatibilidad legacy.

La transicion permitida es `false -> true`; `true -> true` es idempotente y cualquier intento posterior de desactivar falla con `batch_enforcement_cannot_be_disabled_in_mvp`. `enforcement_started_at`, `enabled_by` y `enabled_at` nunca se reinician.

La UI guarda director y enforcement mediante `set_company_batch_configuration`, una sola transaccion que valida Finanzas, empresa, perfil, rol, configuracion y ledger. Si falla cualquier paso, no persiste un estado parcial. Cada configuracion atomica se agrega a `approval_batch_company_setting_events` con director, estado, actor y fecha.

Con enforcement activo, un pago regular nuevo solo puede materializarse si:

1. La aprobacion de Finanzas es posterior al ultimo cambio material.
2. Existe un item activo aprobado por Direccion despues del ultimo cambio material.
3. El batch esta `closed` y su `closed_at` es posterior a la decision.
4. No existe una participacion posterior pendiente o rechazada.

Los estados `draft`, `submitted`, `approved` y `partially_approved` no habilitan ejecucion. En UI, `closed` se presenta como **Liberado para pago**.

El gate server-side protege `payment_layout_lines` y `cash_funds`. El esquema no tiene una entidad separada para cheques; efectivo y cheque se materializan en `cash_funds` mediante `delivery_method`.

## Cambios materiales

`payment_requests.approval_material_updated_at` registra cambios financieros relevantes. Se actualiza al cambiar empresa, proveedor, cuenta de proveedor, centro, partida, importe, moneda, tipo de cambio, `request_type`, `payment_method`, cuenta origen, vencimiento, fecha programada, referencia o concepto. Cambios en tipo de destino, CLABE, cuenta, convenio, beneficiario o banco del proveedor actualizan el marcador de solicitudes aun no ejecutadas.

El esquema de `payment_requests` no contiene `delivery_method`, datos propios de cheque ni un `request_subtype` separado. `delivery_method` vive en `cash_funds`; para la solicitud, el metodo efectivo se determina con `payment_method` y `request_type`. La migration hace precheck de todas las columnas materiales que usa y no crea columnas hipoteticas.

La elegibilidad exige decisiones validas de Finanzas y Direccion posteriores a ese marcador. Una aprobacion vieja queda como historial, se clasifica como `direction_reapproval_required` con razon `stale_direction_approval` y la solicitud puede volver a Finanzas y a un corte nuevo. El backfill usa `created_at`, por lo que una aprobacion historica posterior sigue siendo valida y no se invalida indiscriminadamente.

`close_approval_batch` toma locks por solicitud en orden, bloquea `payment_requests` con `FOR UPDATE` y revalida Finanzas, Direccion, cambios materiales, extraordinarios y ejecucion previa. El cierre es todo o nada; `approved_released_count` solo cuenta pagos efectivamente liberados.

## Reingreso de rechazados

`release_and_rebatch_rejected_request` ejecuta en una transaccion:

1. Valida actor de Finanzas, rechazo bloqueado y batch fuente decidido.
2. Revalida ejecucion, extraordinario activo, concurrencia y aprobacion financiera vigente.
3. Conserva sin cambios el item, motivo, director, fecha y batch anteriores.
4. Registra la correccion y cambia el item anterior a `released`.
5. Opcionalmente crea un nuevo `approval_batch_item` pendiente en un batch `draft` de la misma empresa.

No crea otra `payment_request`, no borra historial y no permite reingresar si un cambio material requiere nueva revision de Finanzas.

## Pagos extraordinarios

`payment_request_extraordinary_authorizations` conserva categoria, motivo, actor, fecha y revocacion. Solo Finanzas puede mutarla mediante RPC.

Una autorizacion extraordinaria requiere:

- solicitud aprobada por Finanzas y aprobacion vigente;
- datos aun no ejecutados;
- ausencia de rechazo o aprobacion previa de Direccion;
- ausencia de batch `submitted`;
- retiro previo si esta en un batch `draft`;
- categoria valida y motivo de al menos 20 caracteres.

Nomina queda fuera del alcance. Una autorizacion activa puede revocarse solo antes de incorporarse a `payment_layout_lines`, `cash_funds` o `payment_receipts`. Una vez materializada, falla con `extraordinary_already_materialized`; no se eliminan lineas automaticamente. Si cambian datos materiales, deja de habilitar el pago y exige nueva revision, pero permanece como historial hasta ser revocada.

## Preview y creacion de layouts

`approval_batch_payment_layout_candidates` es el clasificador compartido por:

- `preview_payment_layout_eligibility`;
- `create_payment_layout`.

Las categorias son:

- `ready_regular`;
- `ready_extraordinary`;
- `legacy_eligible`;
- `rejected_by_direction`;
- `pending_director`;
- `direction_reapproval_required` (`stale_direction_approval`);
- `pending_finance_close`;
- `invalid_data`;
- `already_executed`.

El frontend no envia IDs para forzar inclusiones. `create_payment_layout` hace una clasificacion preliminar, toma el advisory lock compartido 21021, bloquea cada `payment_requests` con `FOR UPDATE` y captura un unico snapshot post-lock. Conteos, totales, insercion y respuesta reutilizan ese snapshot; no se reclasifica entre conteo e insercion. Los updates bancarios del proveedor esperan el mismo row lock porque actualizan el marcador en `payment_requests`.

Solo se insertan regulares liberadas, extraordinarias vigentes y legacy elegibles. Los totales se mantienen separados por moneda en el preview; el layout BBVA actual conserva su soporte operativo MXN.

## UX

- **Cortes:** paneles con scroll independiente por altura disponible, tabla con encabezado sticky, cierre descrito como liberacion y reingreso con motivo original mas corte destino.
- **Layouts:** revision obligatoria antes de crear, desglose visible de listas, rechazadas, pendientes e invalidas, y reingreso desde el mismo preview.
- **Solicitudes:** badge extraordinario, contexto de batch y modales auditados para autorizar o revocar. No se usa `confirm()` nativo.

## Seguridad y notificaciones

- RLS de solo lectura para roles autorizados.
- Todas las mutaciones pasan por RPC `SECURITY DEFINER` con `search_path = public, pg_temp`.
- Ejecucion publica y anonima revocada; grants minimos a `authenticated`.
- Locks transaccionales por solicitud, compartidos con los RPC de la migracion 021, evitan carreras entre alta en corte, extraordinario, reingreso y doble layout.
- No existe `DELETE` fisico.
- `payment_request.extraordinary_authorized` informa a Finanzas y Direccion sin solicitar una decision.
- `approval_batch.item_rebatched` informa a Finanzas y solicitante; Direccion recibe el flujo normal solo cuando el nuevo corte se envia.
- Ambos eventos usan el ledger e idempotencia existentes. El dispatcher incluye casos explicitos de subject, accion y etiqueta de comentario; el deploy se hara por separado y no forma parte de este PR.

## Plan DEV

1. Mergear el PR a `dev` solo despues de revision.
2. Confirmar backup de Supabase DEV.
3. Aplicar unicamente la migracion 022 mediante un procedimiento autorizado.
4. Activar enforcement solo para una empresa de prueba.
5. Validar el ciclo irreversible `activar -> intentar desactivar -> reactivar idempotente`, conservando siempre la primera fecha y actor.
6. Validar regular sin batch, draft, submitted, aprobado sin cierre y closed.
7. Validar rechazo, correccion y reingreso a un nuevo corte.
8. Cambiar importe, moneda, tipo de cambio, metodo, proveedor, cuenta y beneficiario despues de Finanzas y despues de Direccion; confirmar `direction_reapproval_required`, nueva revision de Finanzas y nuevo corte.
9. Validar autorizacion y revocacion extraordinaria, excluyendo nomina, antes y despues de materializar en layout draft, efectivo y comprobante.
10. Validar concurrencia: dos layouts simultaneos, cambio de importe o CLABE durante layout, extraordinario simultaneo y reingreso simultaneo. Ninguna solicitud puede materializarse dos veces.
11. Revisar eventos del ledger y responsive en 390, 768 y 1366 px.
12. Desplegar el dispatcher actualizado en DEV mediante el procedimiento separado autorizado y validar los textos explicitos de extraordinario y reingreso; el PR no realiza ese deploy.

La migracion no se ejecuta desde el PR. PROD, `main`, cron, Database Webhooks, n8n, secrets y variables quedan fuera de este cambio.
