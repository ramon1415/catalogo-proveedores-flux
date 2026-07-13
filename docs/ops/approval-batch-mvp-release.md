# MVP de cortes semanales de aprobacion

## Proposito

El modulo agrega una autorizacion semanal de erogaciones por empresa. Finanzas prepara el corte y el director configurado decide el conjunto. Esta autorizacion ocurre despues de la revision operativa y antes de crear lineas de layout o fondos de efectivo.

El corte es independiente del enrutamiento individual de solicitudes. No consulta la seleccion de revisor de una solicitud ni necesita las migraciones 018 y 019.

## Elegibilidad confirmada

La inspeccion del esquema anterior a 018/019 encontro una senal estable y auditable. Una solicitud es elegible cuando:

1. `payment_requests.status = approved`.
2. Existe una decision en `payment_request_approvals` con accion `approved` o `exception_approved`, destino `approved` y un rol incluido en `flux_finance_roles()`.
3. No existe una linea de layout ni un fondo de efectivo para la solicitud.
4. No esta activa en otro corte y no fue aprobada en un corte anterior.
5. Su rechazo batch mas reciente no permanece bloqueado para correccion.

La elegibilidad se vuelve a validar al agregar y al enviar el corte. No depende de campos o tablas creados por 018/019.

## Modelo y controles

- `company_directors`: configuracion activa de directores por empresa.
- `approval_batches`: snapshot del director, periodo, estado y auditoria del corte.
- `approval_batch_items`: historial no destructivo de participacion y decision por solicitud.
- RLS: lectura para Finanzas o el director snapshot.
- Escritura: solo mediante RPCs autenticados con validacion server-side.
- Eliminacion fisica: no permitida. Quitar una solicitud del borrador deja evidencia de remocion.
- Reingreso: un rechazo queda `blocked` hasta que Finanzas registra una nota y lo cambia a `released` mediante RPC.
- Ejecucion gradual: los triggers solo intervienen en solicitudes inscritas activamente en un corte. Una solicitud nunca inscrita conserva el flujo existente del MVP.
- Ejecucion batch: una participacion pendiente o rechazada bloquea layout y efectivo; la participacion mas reciente debe estar aprobada dentro de un batch decidido.
- Direccion: solo perfiles activos con un rol versionado de Direccion pueden configurarse como director.
- Monedas: todos los totales se agrupan por moneda; nunca se suman importes de monedas distintas.

## RPCs

- Configuracion: `list_company_directors`, `list_approval_batch_director_candidates`, `set_company_director`.
- Preparacion: `create_approval_batch`, `list_batch_eligible_requests`, `add_request_to_approval_batch`, `remove_request_from_approval_batch`, `submit_approval_batch`.
- Decision: `approve_entire_batch`, `decide_approval_batch_items`.
- Operacion y consulta: `close_approval_batch`, `release_rejected_batch_item_for_rebatch`, `get_approval_batch_detail`, `list_finance_approval_batches`, `list_director_approval_batches`.

La identidad del actor siempre se deriva de la sesion autenticada. El director autorizado es el perfil copiado al batch cuando se crea.

Un batch final debe conservar al menos una partida aprobada. `approved` no admite partidas rechazadas; `partially_approved` exige al menos una aprobada y una rechazada. Rechazar todo el corte no forma parte del MVP y el servidor revierte esa operacion.

## Paridad de roles

La UI y la base usan la misma matriz versionada:

- Sysadmin: `sysadmin`, `system_admin`, `admin`, `superadmin`.
- Finanzas: `finance`, `finanzas`, `treasury`, `tesoreria`, `administracion`.
- Direccion: `director`, `direccion`, `approver_2`, `aprobador_2`.

`FluxAuth.isAdminFinance()` habilita acciones de preparacion solamente a los grupos Sysadmin y Finanzas. `flux_finance_roles()` incluye exactamente esos roles de Sysadmin y Finanzas, por lo que un boton visible no termina rechazado por discrepancia de roles. Direccion sin rol financiero solo ve y decide los batches donde es el director snapshot; Operacion no administra batches.

## Superficies de ejecucion

El esquema base no tiene una tabla de ejecucion exclusiva para cheques. Efectivo y Cheque comparten `cash_funds`; el campo `delivery_method` distingue `cash` de `check`, y el RPC de creacion acepta ambos tipos de solicitud. Por eso el trigger sobre `cash_funds` protege tanto efectivo como cheque.

Cheque puede formar parte del corte y queda bloqueado mientras su item batch no este aprobado. La migracion tambien protege transferencias persistidas en `payment_layout_lines`. No se crea una entidad adicional para cheques en este MVP.

## Notificaciones

La migracion genera eventos separados para envio al director, resultado a Finanzas y rechazo de partidas a solicitante mas Finanzas. Incluye deduplicacion por correo, claves de idempotencia y `dead_letter` cuando no existe destinatario.

La funcion `notification-dispatcher` incorpora plantillas para esos eventos. El envio real sigue dependiendo de la configuracion operativa del dispatcher.

Como el esquema base no contiene una relacion financiera por empresa y el MVP no usa las membresias de 018/019, los resultados `approval_batch.approved` y `approval_batch.partially_approved` se envian a todos los perfiles activos con rol de Finanzas o Sysadmin. `approval_batch.item_rejected` se envia al solicitante y al mismo grupo financiero global, con deduplicacion por correo. Si el negocio requiere equipos financieros separados por empresa, esa segmentacion debe definirse y aprobarse antes de PROD mediante un modelo independiente; no se tomaran las membresias de 018/019 como atajo.

## Dependencias reales para un release aislado

El release necesita:

1. El esquema productivo base anterior a 018/019.
2. El ledger `notification_events` y sus restricciones, actualmente introducido por la migracion 007.
3. Los RPC de servicio y la Edge Function del dispatcher, actualmente introducidos por la migracion 011 y su codigo versionado.
4. La migracion `021_approval_batches_mvp.sql`.
5. `approval_batches.html`, `approval_batches.js`, `config.js` y la actualizacion del dispatcher.

No se debe hacer merge general de `dev` hacia `main`. El release de batch debe partir de `main` y tomar solo el commit del MVP, junto con las dependencias de notificaciones que aun no existan en produccion. Antes de aplicar, se debe verificar que los contratos de 007/011 siguen siendo compatibles con 021.

## Plan DEV

1. Revisar y mergear el PR a `dev`.
2. Confirmar backup y aplicar unicamente 021 en Supabase DEV mediante un procedimiento autorizado.
3. Desplegar la version actualizada de `notification-dispatcher` solo en DEV.
4. Configurar un director de prueba por empresa.
5. Crear un corte manual con cierre por defecto en miercoles.
6. Agregar solicitudes elegibles de transferencia, efectivo o cheque.
7. Confirmar que un request no puede vivir en dos cortes abiertos.
8. Validar aprobar todo y decision partida por partida con resumen y confirmacion explicita.
9. Confirmar que solicitudes nunca inscritas mantienen el flujo actual.
10. Confirmar bloqueo de layout/efectivo para items draft, submitted o rejected y continuidad despues de aprobar.
11. Confirmar que un rechazo no reingresa hasta que Finanzas registra una nota de liberacion.
12. Validar cortes de una moneda y multimoneda sin sumar monedas distintas.
13. Confirmar que un perfil sin rol de Direccion no puede configurarse.
14. Validar eventos, CSV, PDF, RLS y auditoria.

No hay scheduler, nomina especial, extraordinarios, autoaprobacion ni WhatsApp en este MVP.

## Rollout y rollback

El SQL no se ejecuta desde este PR. La aplicacion debe hacerse primero en DEV con evidencia. Para PROD se requiere una autorizacion separada, backup confirmado, dry-run del conjunto aislado y smoke test controlado.

El MVP aplica el gate unicamente a solicitudes inscritas en un corte. La obligatoriedad global por empresa queda para una fase posterior que incluya nomina, extraordinarios y activacion formal. Si una validacion falla, se detiene la liberacion y se prepara una migracion compensatoria revisada; no se eliminan tablas ni historial manualmente.
