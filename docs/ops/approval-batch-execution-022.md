# Ejecucion de cortes, reingresos y pagos extraordinarios

## Alcance

La migracion `022_batch_execution_resubmission_extraordinary.sql` convierte el cierre del corte en una autorizacion operativa de pago. Extiende el MVP de la migracion 021 sin modificarla y conserva independencia total de las migraciones 018 y 019.

El release aislado requiere el esquema base, las migraciones de notificaciones ya usadas por 021, la migracion 021 y la migracion 022. No consulta asignaciones individuales de aprobador ni membresias introducidas por 018/019.

## Diagnostico previo

Antes de 022:

- Un item aprobado podia ejecutarse con el batch en `approved`, `partially_approved` o `closed`.
- Una solicitud nunca inscrita en un corte conservaba el flujo legacy.
- Un rechazo solo podia marcarse como liberado; no existia un RPC atomico que creara la nueva participacion.
- Layouts no separaba rechazadas, pendientes de Direccion, pendientes de cierre y extraordinarias.
- El scroll de la tabla dependia de `items.length > 10`, por lo que la altura disponible podia ocultar filas aun con pocos registros.

## Modelo de enforcement

`approval_batch_company_settings` permite activar por empresa `regular_payments_require_closed_batch`. La activacion registra actor y fecha en servidor. Solo las solicitudes creadas desde `enforcement_started_at` quedan obligadas; las historicas conservan compatibilidad legacy.

Cada cambio se agrega a `approval_batch_company_setting_events` con valor anterior, valor nuevo, actor y fecha. La tabla es inmutable desde frontend y permite auditar activaciones y desactivaciones sucesivas.

Con enforcement activo, un pago regular nuevo solo puede materializarse si:

1. La aprobacion de Finanzas es posterior al ultimo cambio material.
2. Existe un item activo aprobado por Direccion.
3. El batch esta `closed`.

Los estados `draft`, `submitted`, `approved` y `partially_approved` no habilitan ejecucion. En UI, `closed` se presenta como **Liberado para pago**.

El gate server-side protege `payment_layout_lines` y `cash_funds`. El esquema no tiene una entidad separada para cheques; efectivo y cheque se materializan en `cash_funds` mediante `delivery_method`.

## Cambios materiales

`payment_requests.approval_material_updated_at` registra solo cambios financieros relevantes. Se actualiza al cambiar empresa, proveedor, cuenta de proveedor, centro, partida, importe, moneda, metodo, cuenta origen, fecha programada, referencia o concepto. Cambios en los datos bancarios canonicos del proveedor actualizan el marcador de solicitudes aun no ejecutadas.

La elegibilidad exige una decision valida de Finanzas posterior a ese marcador. El backfill usa `created_at`, por lo que una aprobacion historica posterior sigue siendo valida y no se invalida indiscriminadamente.

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

Nomina queda fuera del alcance. Una autorizacion activa puede revocarse solo antes de cualquier ejecucion. Si cambian datos materiales, deja de habilitar el pago y exige nueva revision, pero permanece como historial hasta ser revocada.

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
- `pending_finance_close`;
- `invalid_data`;
- `already_executed`.

El frontend no envia IDs para forzar inclusiones. `create_payment_layout` vuelve a clasificar en servidor, bloquea las solicitudes elegibles en orden estable y solo inserta regulares liberadas, extraordinarias vigentes y legacy elegibles. Los totales se mantienen separados por moneda en el preview; el layout BBVA actual conserva su soporte operativo MXN.

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
- Ambos eventos usan el ledger e idempotencia existentes; no requieren desplegar de nuevo el dispatcher.

## Plan DEV

1. Mergear el PR a `dev` solo despues de revision.
2. Confirmar backup de Supabase DEV.
3. Aplicar unicamente la migracion 022 mediante un procedimiento autorizado.
4. Activar enforcement solo para una empresa de prueba.
5. Validar regular sin batch, draft, submitted, aprobado sin cierre y closed.
6. Validar rechazo, correccion y reingreso a un nuevo corte.
7. Validar cambio material y nueva revision de Finanzas.
8. Validar autorizacion y revocacion extraordinaria, excluyendo nomina.
9. Validar layout, efectivo y cheque, junto con concurrencia.
10. Revisar eventos del ledger y responsive en 390, 768 y 1366 px.

La migracion no se ejecuta desde el PR. PROD, `main`, cron, Database Webhooks, n8n, secrets y variables quedan fuera de este cambio.
