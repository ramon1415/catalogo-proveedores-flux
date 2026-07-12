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

La elegibilidad se vuelve a validar al agregar y al enviar el corte. No depende de campos o tablas creados por 018/019.

## Modelo y controles

- `company_directors`: configuracion activa de directores por empresa.
- `approval_batches`: snapshot del director, periodo, estado y auditoria del corte.
- `approval_batch_items`: historial no destructivo de participacion y decision por solicitud.
- RLS: lectura para Finanzas o el director snapshot.
- Escritura: solo mediante RPCs autenticados con validacion server-side.
- Eliminacion fisica: no permitida. Quitar una solicitud del borrador deja evidencia de remocion.
- Ejecucion: triggers bloquean nuevas lineas de layout o fondos de efectivo sin una partida aprobada por Direccion.

## RPCs

- Configuracion: `list_company_directors`, `set_company_director`.
- Preparacion: `create_approval_batch`, `list_batch_eligible_requests`, `add_request_to_approval_batch`, `remove_request_from_approval_batch`, `submit_approval_batch`.
- Decision: `approve_entire_batch`, `decide_approval_batch_items`.
- Operacion y consulta: `close_approval_batch`, `get_approval_batch_detail`, `list_finance_approval_batches`, `list_director_approval_batches`.

La identidad del actor siempre se deriva de la sesion autenticada. El director autorizado es el perfil copiado al batch cuando se crea.

## Notificaciones

La migracion genera eventos separados para envio al director, resultado a Finanzas y rechazo de partidas a solicitante mas Finanzas. Incluye deduplicacion por correo, claves de idempotencia y `dead_letter` cuando no existe destinatario.

La funcion `notification-dispatcher` incorpora plantillas para esos eventos. El envio real sigue dependiendo de la configuracion operativa del dispatcher.

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
8. Validar aprobar todo y decision partida por partida con motivo obligatorio.
9. Confirmar bloqueo de layout/efectivo antes de aprobacion y continuidad despues de aprobar.
10. Validar eventos, CSV, PDF, RLS y auditoria.

No hay scheduler, nomina especial, extraordinarios, autoaprobacion ni WhatsApp en este MVP.

## Rollout y rollback

El SQL no se ejecuta desde este PR. La aplicacion debe hacerse primero en DEV con evidencia. Para PROD se requiere una autorizacion separada, backup confirmado, dry-run del conjunto aislado y smoke test controlado.

Como 021 crea un gate de ejecucion, el rollback no debe improvisarse. Si una validacion falla, se detiene la liberacion antes de producir layouts o fondos y se prepara una migracion compensatoria revisada; no se eliminan tablas ni historial manualmente.
