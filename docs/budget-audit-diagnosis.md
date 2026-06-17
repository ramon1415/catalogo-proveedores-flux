# Diagnostico: validacion viva de presupuesto y audit log de aprobaciones

## 1. Resumen ejecutivo

El flujo actual de Flux Operadora ya valida presupuesto al crear una solicitud y conserva datos presupuestales en `payment_requests`, como decision, disponible antes/despues, faltante y fecha de revision. Tambien existe un historial de decisiones en `payment_request_approvals` y las aprobaciones pasan por la RPC `decide_payment_request`.

La brecha principal es que la validacion presupuestal no esta garantizada como validacion viva en todos los momentos criticos. La creacion usa `create_payment_request`, pero la edicion de una solicitud puede actualizar directamente `payment_requests` desde frontend. Ademas, desde el codigo frontend no se observa una revalidacion visual obligatoria justo antes de aprobar.

La conclusion tecnica es clara: el frontend puede mejorar mensajes, alertas y revalidacion visual, pero el bloqueo real contra sobreconsumo requiere backend/RPC transaccional. Si varias solicitudes compiten por el mismo presupuesto, solo una validacion atomica en base de datos puede evitar carreras.

## 2. Estado actual de validacion presupuestal

### Creacion de solicitud

En `solicitudes.js`, el formulario de nueva solicitud llama la RPC `create_payment_request`. Esa RPC devuelve o alimenta campos como:

- `budget_decision`
- `budget_block_reason`
- `budget_available_before`
- `budget_available_after`
- `budget_shortfall`
- `budget_checked_at`
- `budget_result`

Esto indica que la validacion presupuestal existe al momento de crear la solicitud.

### Consulta de disponibilidad

La pantalla consulta la vista `budget_availability` para cargar partidas disponibles segun empresa, centro de costo y mes. Esa vista alimenta la experiencia de seleccion presupuestal, pero por si sola no bloquea escenarios concurrentes.

### Edicion de solicitud

En el flujo de editar solicitud, el frontend arma un `payload` y actualiza directamente `payment_requests`. Esa ruta no parece llamar `create_payment_request` ni una RPC especifica de revalidacion. Por eso, si se modifica monto, partida, centro de costo o mes, la decision presupuestal puede quedar desactualizada.

Riesgo: una solicitud creada como aprobable puede editarse y conservar un estado presupuestal anterior aunque ya no corresponda.

### Aprobacion

El modulo `aprobaciones.js` llama la RPC `decide_payment_request` con:

- `p_payment_request_id`
- `p_actor_profile_id`
- `p_action`
- `p_comments`

Tambien existe una llamada similar desde el detalle en `solicitudes.js`.

Desde frontend no se ve una prevalidacion obligatoria de presupuesto justo antes de aprobar. Puede existir dentro de la RPC, pero eso debe verificarse en backend antes de afirmar que ya esta blindado.

## 3. Estado actual de audit log

El sistema ya tiene la tabla `payment_request_approvals`, y `solicitudes.js` la consulta para mostrar historial. Los campos usados en frontend incluyen:

- `id`
- `action`
- `from_status`
- `to_status`
- `comments`
- `approval_level`
- `created_at`
- `actor_profile_id`
- `role_id`

Esto cubre una base razonable de auditoria: quien decidio, cuando, que accion hizo y con que comentario.

La brecha es que el historial todavia no parece guardar ni mostrar un snapshot presupuestal de la decision. Para auditoria financiera real conviene registrar el contexto exacto al aprobar o rechazar, no solo el cambio de estado.

Campos recomendados para robustecer auditoria:

- `metadata jsonb`
- presupuesto disponible antes de aprobar
- monto solicitado al momento de aprobar
- presupuesto disponible despues de aprobar
- resultado de revalidacion
- version o timestamp de presupuesto usado
- motivo automatico de bloqueo si ya no alcanza
- informacion de excepcion presupuestal si aplica

## 4. Riesgos actuales

1. **Presupuesto stale al editar**
   Una solicitud puede cambiar monto, partida o mes sin recalcular su decision presupuestal.

2. **Aprobaciones competidas**
   Varias solicitudes pueden verse como aprobables, pero al aprobar una o dos, el presupuesto restante puede dejar sin fondos a las demas.

3. **Solicitud vieja**
   Una solicitud puede permanecer abierta varios dias y el presupuesto disponible puede cambiar por pagos, layouts u otras aprobaciones.

4. **Auditoria incompleta**
   Puede saberse quien aprobo y cuando, pero no necesariamente con que presupuesto disponible se aprobo.

5. **Confianza excesiva en frontend**
   El frontend puede advertir, pero no debe ser la fuente final para bloquear consumo presupuestal.

## 5. Casos de negocio que hoy pueden fallar

### Caso 1: edicion aumenta monto

Una solicitud nace con presupuesto suficiente por $3,000. Despues se edita a $30,000. Si la edicion no revalida, podria conservar una decision aprobable previa.

### Caso 2: varias solicitudes compiten

Tres solicitudes se crean como aprobables contra la misma partida. Si las primeras dos consumen el presupuesto, la tercera debe bloquearse al intentar aprobarse. Esto requiere revalidacion justo antes de aprobar.

### Caso 3: presupuesto cambia por operacion posterior

Una solicitud queda pendiente varios dias. Durante ese tiempo se pagan layouts o se aprueban otras solicitudes. La solicitud no debe aprobarse con una foto presupuestal vieja.

### Caso 4: falta evidencia de decision

Un aprobador aprueba una solicitud. Meses despues se revisa el cierre y se necesita saber cuanto presupuesto habia disponible al momento exacto de aprobar. El audit log actual podria no tener ese snapshot.

## 6. Que se puede hacer solo frontend

Frontend puede mejorar la operacion y reducir errores visibles:

- Recalcular disponibilidad al cambiar monto, empresa, centro de costo, partida o mes.
- Mostrar banner de advertencia si `budget_checked_at` esta viejo.
- Mostrar estado claro: Presupuesto disponible, Presupuesto insuficiente, Validacion cambiada.
- Antes de aprobar, consultar una RPC/vista de disponibilidad y pedir confirmacion si el resultado cambio.
- Bloquear visualmente el boton Aprobar cuando la validacion frontend detecte insuficiencia.
- Mejorar el historial visible de decisiones, mostrando actor, fecha, rol y comentario.

Limitacion: todo esto es preventivo. No evita carreras si dos usuarios aprueban al mismo tiempo.

## 7. Que requiere backend/RPC/SQL

Para blindaje real se requiere backend:

- Una RPC de revalidacion presupuestal de una solicitud antes de aprobar.
- Que `decide_payment_request` revalide presupuesto dentro de la misma transaccion antes de cambiar estado a `approved`.
- Bloqueo/serializacion de la partida presupuestal afectada o estrategia equivalente para evitar sobreconsumo concurrente.
- Actualizar `payment_requests` con la nueva foto presupuestal al revalidar.
- Insertar un registro de auditoria con snapshot presupuestal.
- Definir reglas de excepcion cuando no haya presupuesto suficiente.

Recomendacion tecnica: no depender de `budget_availability` en frontend para el bloqueo final. Usarlo para UX, pero hacer el bloqueo definitivo dentro de RPC.

## 8. Plan recomendado por fases

### Fase B1: diagnostico y mensajes frontend

Objetivo: mejorar visibilidad sin cambiar backend.

Cambios:

- Mostrar antiguedad de la validacion presupuestal.
- Mostrar mensaje si la solicitud fue editada despues de `budget_checked_at`.
- Mostrar advertencias en detalle y aprobaciones.
- Mejorar copy de estados presupuestales.

Riesgo: bajo. No cambia reglas de negocio.

### Fase B2: revalidacion visual antes de aprobar

Objetivo: que el aprobador vea el presupuesto actualizado antes de decidir.

Cambios:

- Antes de aprobar, consultar disponibilidad vigente.
- Comparar contra monto solicitado.
- Si cambio la decision, bloquear visualmente y mostrar mensaje.
- Si sigue aprobable, permitir continuar.

Riesgo: medio. Mejora UX, pero aun no es blindaje transaccional.

### Fase B3: RPC/transaccion segura

Objetivo: evitar sobreconsumo real.

Cambios backend propuestos, no autorizados todavia:

- Ajustar `decide_payment_request` o crear RPC nueva para revalidar y aprobar atomicamente.
- Registrar snapshot presupuestal en la misma transaccion.
- Rechazar aprobacion si ya no hay presupuesto, salvo excepcion autorizada.

Riesgo: alto. Requiere pruebas controladas con concurrencia.

### Fase B4: audit log robusto

Objetivo: trazabilidad completa.

Cambios:

- Extender `payment_request_approvals` con `metadata jsonb` o crear tabla complementaria si no conviene modificar la existente.
- Guardar snapshot presupuestal al aprobar/rechazar/solicitar cambios.
- Mostrar historial enriquecido en solicitud y aprobaciones.

Riesgo: medio/alto por migracion y compatibilidad con RLS/RPC.

## 9. Archivos que se tocarian

Frontend probable:

- `solicitudes.js`
- `solicitudes.html`
- `aprobaciones.js`
- `aprobaciones.html`
- extensiones de solicitudes/aprobaciones si se mantiene arquitectura de parches
- `config.js` solo si se requiere exponer helper comun o permisos visuales

Backend probable, solo con autorizacion futura:

- RPC `decide_payment_request`
- posible RPC nueva de revalidacion presupuestal
- `payment_request_approvals`
- grants/RLS relacionados

## 10. Riesgos de implementacion

- Cambiar aprobacion sin transaccion puede dar falsa sensacion de seguridad.
- Bloquear aprobaciones solo en frontend no evita aprobaciones simultaneas.
- Tocar `decide_payment_request` puede afectar todo el flujo de aprobaciones.
- Agregar metadata de auditoria requiere revisar RLS y permisos.
- Si la edicion sigue haciendo update directo a `payment_requests`, la validacion puede volver a quedar vieja.

## 11. Plan de PRs hacia dev

### PR B1: UX de presupuesto vivo sin backend

- Rama: `feature/ramon-budget-live-frontend`
- Base: `dev`
- Sin SQL
- Mensajes, banners, antiguedad de validacion y advertencias de stale data.

### PR B2: prevalidacion visual antes de aprobar

- Rama: `feature/ramon-budget-precheck-approval`
- Base: `dev`
- Sin SQL si se puede usar vistas/RPC existentes.
- Si no hay RPC suficiente, detenerse y pedir autorizacion para backend.

### PR B3: backend transaccional

- Rama: `feature/ramon-budget-approval-rpc`
- Base: `dev`
- Requiere autorizacion explicita para SQL/RPC.
- Pruebas controladas obligatorias.

### PR B4: audit log enriquecido

- Rama: `feature/ramon-approval-audit-log`
- Base: `dev`
- Requiere decidir si se extiende `payment_request_approvals` o se crea tabla complementaria.

## Conclusion

El sistema ya tiene una base funcional de validacion presupuestal y auditoria de aprobaciones. Lo que falta para el siguiente nivel es convertir esa validacion en una regla viva, especialmente en edicion y aprobacion, y guardar evidencia presupuestal de cada decision.

La recomendacion es avanzar primero con visibilidad frontend y diagnostico operativo, pero no declarar blindaje financiero hasta implementar la revalidacion transaccional en backend/RPC.
