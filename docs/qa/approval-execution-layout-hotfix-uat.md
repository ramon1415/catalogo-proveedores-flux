# Hotfix de aprobación, ejecución y layout — plan de QA/UAT

## Control de cambio

- Repositorio: `ramon1415/catalogo-proveedores-flux`.
- Base exacta: `origin/dev` en `fc3d703baa6f8ab71134012d3f54756575005ee0`.
- Rama: `hotfix/ramon-client-demo-approval-execution-layout`.
- Migraciones forward-only:
  - `033_separate_approval_material_from_payment_execution_data.sql`, ya aplicada una sola vez en DEV;
  - `034_support_multiple_active_company_directors.sql`, preparada y todavía no aplicada.
- SHA-256 aplicado de 033: `629081c0c25d2cbd43214f92ffd03a9f4ec1f27c84bc33694e05a913a63084dc`.
- SHA-256 preparado de 034: `e4ffc2e4e0425b9325fcc37d10261c1b90f9e18bb7874f65cc9ced82476a33e8`.
- SHA-256 anterior invalidado y prohibido para LOAD: `da310d7a8113a94b79dc2c3cfb7a42439047e61fd86df745473a0782b1019e21`.
- Target autorizado para una fase posterior: Supabase DEV `scsirgbuqjcwoaxfacth`.
- Estado de este documento: 033 aplicada y verificada en DEV; 034 pendiente de precheck, backup y aplicación única.

`CLAUDE.md` no existe en la base registrada de `origin/dev`; por ello no fue posible leerlo. No se sustituyó por instrucciones inventadas.

La primera ejecución real del precheck se detuvo antes de consultar DEV con
`ERROR 42601` porque PostgreSQL no admite `position(needle, haystack)`. La
auditoría exhaustiva encontró 33 expresiones: 14 en el precheck independiente,
14 en el precheck embebido de la migración y 5 adicionales en su postcheck. Las
33 conservan la misma semántica mediante `strpos(haystack, needle)` y la prueba
contractual exige cero llamadas inválidas, paridad exacta de los 14 tokens de
precheck y los conteos 14/19.

## Diagnóstico técnico

El defecto nace en `mark_payment_request_material_change()` de la migración 022. La versión vigente antes del hotfix incluye como materiales `provider_bank_account_id`, `company_bank_account_id`, `due_date`, `scheduled_payment_date`, `payment_reference` y `payment_concept`. Al cambiar cualquiera de ellos, adelanta `approval_material_updated_at`.

La misma migración propaga a solicitudes los cambios bancarios hechos sobre `proveedores` mediante `mark_provider_payment_material_change()`. La clasificación redefinida en 023 compara la decisión del Director contra `approval_material_updated_at`; cuando el timestamp queda posterior a la decisión, clasifica la solicitud como `direction_reapproval_required`.

El resultado incorrecto es, por tanto:

1. Dirección aprueba y Finanzas cierra el corte.
2. Finanzas completa datos necesarios para ejecutar el pago.
3. El trigger trata esos datos como una nueva decisión económica.
4. El clasificador considera obsoleta la aprobación de Dirección.

La migración 033 reemplaza esas funciones sin modificar migraciones aplicadas. No reconcilia solicitudes históricas ni altera decisiones, batches, layouts o pagos existentes.

Los updates operativos directos quedan cerrados por guards con contexto transaccional. La solicitud se completa mediante `complete_payment_request_layout_data`; los datos bancarios del mismo proveedor se completan mediante `complete_provider_payment_execution_data`. Los formularios integrales de proveedor —catálogo y altas rápidas en Solicitudes— se enrutan desde `config.js`, sin modificar sus callers históricos, a `save_provider_catalog_with_payment_execution_data`; la RPC conserva la autorización histórica del catálogo para campos no bancarios, pero exige Finanzas/SysAdmin cuando crea, cambia o limpia datos bancarios. Un guard adicional cubre INSERT para impedir que esos campos omitan la frontera RPC. Las escrituras estrechas de estado y metadatos CSF siguen su ruta existente porque no contienen datos de ejecución.

No se consultaron ni modificaron filas reales durante este diagnóstico. La evidencia anterior/posterior con IDs y timestamps sanitizados debe obtenerse con la fixture sintética descrita abajo, después del precheck, backup, revisión y aplicación controlada en DEV.

## Contrato definitivo de materialidad

| Campo | Tipo | Efecto después de una aprobación vigente |
| --- | --- | --- |
| `company_id` | Material | Requiere nueva autorización |
| `requested_by` | Material | Requiere nueva autorización |
| `proveedor_id` | Material | Requiere nueva autorización |
| `provider_id` (legacy) | Material | Requiere nueva autorización |
| `cost_center_id` | Material | Requiere nueva autorización |
| `budget_category_id` | Material | Requiere nueva autorización |
| `budget_month` | Material | Requiere nueva autorización |
| `amount_requested` | Material | Requiere nueva autorización |
| `currency` | Material | Requiere nueva autorización |
| `exchange_rate` | Material | Requiere nueva autorización |
| `request_type` | Material | Requiere nueva autorización |
| `payment_method` | Material | Requiere nueva autorización |
| `is_extraordinary_adjustment` | Material | Requiere nueva autorización |
| `concept` | Material | Requiere nueva autorización |
| `description` | Material | Requiere nueva autorización |
| `provider_bank_account_id` | Operativo | Conserva la autorización |
| `company_bank_account_id` | Operativo | Conserva la autorización |
| `due_date` | Operativo | Conserva la autorización |
| `scheduled_payment_date` | Operativo | Conserva la autorización |
| `payment_reference` | Operativo | Conserva la autorización |
| `payment_concept` | Operativo | Conserva la autorización |
| `destination_type` del mismo proveedor | Operativo | Conserva la autorización |
| `clabe` del mismo proveedor | Operativo | Conserva la autorización |
| `cuenta_bancaria` del mismo proveedor | Operativo | Conserva la autorización |
| `convenio_number` del mismo proveedor | Operativo | Conserva la autorización |
| `beneficiary_name` del mismo proveedor | Operativo | Conserva la autorización |
| `banco` del mismo proveedor | Operativo | Conserva la autorización |

Cambiar la identidad del proveedor nunca se considera un cambio operativo.

## Gate previo a la aplicación única de 034 en DEV

La aplicación se detiene si cualquiera de estos pasos no termina en PASS:

1. Confirmar que el proyecto destino es exactamente `scsirgbuqjcwoaxfacth`.
2. Confirmar que 033 está aplicada y que su SHA local continúa siendo el aceptado.
3. Ejecutar `scripts/qa/approval-execution-layout-034-precheck.sql`, que abre una transacción `READ ONLY` y termina en `ROLLBACK`:
   - índice temporal de un solo Director presente;
   - índice único por pareja empresa+Director presente;
   - Ramón único activo actual en Operadora;
   - Denise inactiva;
   - cero parejas activas duplicadas;
   - snapshots históricos con `director_id`;
   - manifests de batches, items, enforcement y receipts.
4. Guardar privadamente el resultado y los manifests del precheck, sin datos bancarios.
5. Obtener backup lógico de los objetos y datos de control afectados.
6. Comparar el SHA-256 del archivo local, del blob Git versionado y del archivo que se cargará; los tres deben ser idénticos.
7. Contar con revisión expresa de Ramón sobre PR, diff, pruebas, precheck y backup.
8. Cargar el archivo exacto una sola vez, sin `db push` y sin `migration repair`.
9. Ejecutar `scripts/qa/approval-execution-layout-034-postcheck.sql`, comparar los manifests con el backup y detenerse ante el primer error; no reintentar.

Después de 034 pueden coexistir varios Directores activos por empresa. Cada
corte exige seleccionar exactamente uno y conserva ese `director_id`.

## UAT sintética posterior a la aplicación

### Principales y datos

Crear o confirmar únicamente identidades QA activas:

- un solicitante;
- un perfil Finanzas/SysAdmin;
- un perfil Dirección;
- una empresa QA;
- un proveedor QA del que se pueda demostrar la identidad;
- cuentas y números completamente sintéticos.

No usar, reactivar ni asignar membresías a:

- `QA_TRIAGE_FINANCE_1`;
- `QA_TRIAGE_FINANCE_2`.

No usar datos, cuentas, CLABE, comprobantes o pagos reales.

### Caso A — completar datos conserva Dirección

1. Crear una solicitud nueva de transferencia con monto sintético.
2. Incluirla en un corte nuevo.
3. Aprobarla por Dirección y cerrar el corte por Finanzas.
4. Registrar de forma sanitizada:
   - ID de solicitud y batch;
   - `approval_material_updated_at`;
   - `decided_at`;
   - clasificación.
5. Completar mediante la RPC autorizada de la solicitud:
   - cuenta origen;
   - fecha programada;
   - referencia;
   - concepto bancario.
6. Completar mediante `complete_provider_payment_execution_data` la CLABE/cuenta/convenio, banco y beneficiario sintéticos que falten, sin cambiar la identidad del proveedor.
7. Confirmar:
   - `approval_material_updated_at` es byte-a-byte el timestamp anterior;
   - no existe un nuevo item o decisión de Dirección;
   - la RPC devuelve `direction_reapproval_required=false`;
   - la RPC devuelve `approval_preserved=true`;
   - la RPC devuelve `execution_data_updated=true`;
   - el audit solo contiene actor, timestamp, nombres de campos y completitud;
   - el audit no contiene CLABE ni cuenta completas;
   - la clasificación fresca es `ready_regular`.
8. Crear el layout con esa solicitud.
9. No confirmar el pago y no escribir en `payment_receipts`.

### Caso B — un cambio económico sí invalida Dirección

Desde solicitudes nuevas aprobadas, repetir individualmente para:

- monto;
- proveedor;
- centro de costo;
- partida presupuestal;
- moneda;
- método de pago.

Confirmar que `approval_material_updated_at` avanza y que la clasificación es `direction_reapproval_required`.

### Caso C — múltiples Directores por empresa

1. Registrar los manifests de batches, items y enforcement.
2. Abrir `Directores activos para futuros cortes`.
3. Agregar Director A y luego Director B.
4. Confirmar dos asignaciones activas simultáneas; agregar B no desactiva A.
5. Abrir Crear corte y confirmar que aparecen A y B.
6. Crear un corte asignado exclusivamente a A.
7. Confirmar que B no puede decidirlo y A sí.
8. Quitar B y reactivarlo, conservando A activo.
9. Confirmar que el corte de A, sus items y decisiones no cambian.
10. Confirmar que no se puede quitar al último Director activo.
11. Confirmar que enforcement y `payment_receipts` conservan sus manifests.

### Caso D — perfiles

1. Confirmar que la tabla Usuarios separa estado, rol, grupo y membresías.
2. Confirmar que un perfil inactivo se conserva en Usuarios con badge `Inactivo`.
3. Confirmar que no aparece en el selector de Membresías ni en candidatos de aprobación/Director.
4. Asignarle un rol y confirmar que `profiles.active` continúa en `false`.
5. Intentar acceder con un perfil inactivo y confirmar que:
   - no aparecen módulos operativos;
   - se elimina cualquier cache de rol o navegación;
   - se muestra `Perfil inactivo`;
   - la única acción disponible es cerrar sesión.
6. Confirmar por separado que un perfil activo sin rol queda pendiente.

### Caso E — preview y creación

1. Ejecutar una primera revisión y, antes de que responda, cambiar filtros.
2. Confirmar que la respuesta vieja no repuebla el modal.
3. Ejecutar dos revisiones consecutivas y confirmar que solo se representa la más nueva.
4. Cambiar fecha inicio, fecha fin, empresa y cuenta origen; en cada caso confirmar:
   - preview limpiado;
   - scroll principal e interno en cero;
   - Crear deshabilitado;
   - mensaje `Los filtros cambiaron. Revisa nuevamente las solicitudes.`
5. Completar datos de una solicitud y confirmar una sola reevaluación fresca y el mensaje:
   `Datos de ejecución completados. La autorización de Dirección se conserva.`
6. Preparar una lista con una solicitud `ready_regular` y 48 incompletas.
7. Confirmar que el botón permite crear un layout con la única lista y que las 48 incompletas no se incluyen.
8. Confirmar los estados específicos:
   - `Completa los datos pendientes`;
   - `Finanzas debe cerrar el corte`;
   - `Pendiente de decisión de Dirección`;
   - `Requiere nueva autorización de Dirección`;
   - `No hay pagos liberados`.

### Caso F — frontera RPC del catálogo de proveedores

1. Con Finanzas/SysAdmin y un proveedor completamente sintético, guardar el formulario normal cambiando un dato bancario.
2. Confirmar una sola operación atómica mediante `save_provider_catalog_with_payment_execution_data`, sin error `provider_payment_execution_rpc_required`.
3. Confirmar que un INSERT o UPDATE bancario directo sin marcador es rechazado, y que la respuesta RPC solo devuelve `id`.
4. Confirmar que cambiar únicamente `activo` conserva la ruta estrecha existente y no genera un evento con valores bancarios.

## Matriz visual y accesibilidad

Validar el modal en tema claro y oscuro:

| Viewport | Zoom |
| --- | --- |
| 1920×1080 | 100 %, 150 %, 200 % |
| 1440×900 | 100 %, 150 %, 200 % |
| 768×1024 | 100 %, 150 %, 200 % |
| 412×915 | 100 %, 150 %, 200 % |
| 390×844 | 100 %, 150 %, 200 % |

En cada combinación confirmar:

- header y footer visibles;
- botones completos y alcanzables;
- contenido sin superposición ni recorte;
- scroll dentro del contenedor correcto;
- foco visible y orden de teclado coherente;
- cierre con Escape;
- Axe `critical=0`;
- Axe `serious=0`.

### Resultado local antes de DEV

- Harness aislado que carga el diálogo y estilos reales de `layouts.html`, sin iniciar Supabase ni la aplicación.
- Fixture visual: una solicitud lista y 14 incompletas.
- Treinta combinaciones automatizadas: cinco resoluciones, tres equivalencias de zoom y dos temas.
- Se validan el diálogo Nuevo layout y el diálogo Completar datos en cada combinación.
- Resultado: 30/30 sin overflow horizontal, recorte, botones fuera del viewport ni superposición de header/footer.
- La equivalencia obligatoria de 390×844 al 200 % usa viewport CSS 195×422 y pasa.
- Axe 4.10.3: `critical=0`, `serious=0`.

## Verificación estática y de regresión

- `node --check`: PASS en los cuatro JavaScript modificados.
- Contrato focal: 20/20 PASS, incluidos 033, 034, pool multidirector, snapshot de decisión, precheck y postcheck read-only.
- IDs únicos y `git diff --check`: PASS.
- Parser PostgreSQL (`pglast`): PASS para migración 034, precheck 034 y postcheck 034.
- Suite completa bajo `scripts/qa/`: 155/157 PASS.
- Los dos fallos restantes pertenecen a archivos byte-idénticos al SHA base `fc3d703baa6f8ab71134012d3f54756575005ee0`:
  - `PostgREST P0001 errors preserve actionable domain messages`;
  - `Migration 029 remains byte-identical to the applied contract`.
- Esos dos defectos de baseline están fuera de los archivos y del alcance autorizado para este hotfix.

## Guion breve para la demostración

1. Mostrar una solicitud sintética ya aprobada en un corte cerrado.
2. Abrir el preview: está en Datos por completar.
3. Completar cuenta origen, fecha, referencia y concepto.
4. Mostrar el mensaje de autorización conservada y la solicitud en Listas para layout.
5. Mostrar que otras solicitudes incompletas no bloquean la lista.
6. Crear el layout con una solicitud.
7. Mostrar Director A y Director B activos simultáneamente en una empresa QA.
8. Crear un corte para A, comprobar que B no puede decidirlo y mostrar que quitar B no altera el corte.
9. Mostrar estado Activo/Inactivo separado del rol.
10. Terminar antes de confirmar el pago.

## Riesgos y límites conocidos antes de DEV

- P0: ninguno identificado en revisión estática.
- P1: ninguno después del PASS visual 30/30; la aplicación y UAT siguen siendo gates obligatorios.
- P2: los casos históricos stale no se reconcilian automáticamente. Algunos pueden seguir requiriendo análisis por falta de historial demostrable.
- P2: la prueba end-to-end, evidencia de timestamps y postcheck sobre datos sintéticos quedan pendientes hasta aplicar en DEV con la fixture autorizada.
- P2: Escape y recorrido completo de teclado se reconfirman en UAT; reflow y axe ya tienen cobertura automatizada.
- P2: la suite heredada conserva dos fallos reproducibles en el SHA base, documentados arriba; el hotfix no los modifica.
- P3: `pending.html` se reutiliza como pantalla neutral para el perfil inactivo y su contenido se adapta después de resolver el perfil.

## Confirmaciones de alcance

Este hotfix no autoriza ni realiza:

- cambios en PROD, `main` o `dev`;
- merge;
- cambios en PR #258 o PR #147;
- cambios en n8n, cron, Database Webhooks, notification-dispatcher o Edge Functions;
- cambios en secrets, variables o Environment;
- activación o desactivación de enforcement;
- uso de los principales QA protegidos;
- confirmaciones de pago;
- escrituras en `payment_receipts`;
- reconciliación masiva de solicitudes históricas.

## Runbook futuro de PROD — no ejecutar en este hotfix

Requiere autorización separada después de la sesión y aceptación del cliente:

1. Abrir un release independiente `dev → main`.
2. Ejecutar precheck y backup privado de PROD.
3. Aplicar 033 sólo si no existe y validar su SHA/objetos.
4. Aplicar 034 inmediatamente después, una sola vez.
5. No copiar fixture ni usuarios QA.
6. Configurar Directores humanos reales desde la interfaz; permitir varios activos y seleccionar uno por corte.
7. Comparar manifests históricos, enforcement y `payment_receipts`.
8. Ejecutar smoke con una solicitud controlada sin confirmar pago, crear receipt ni enviar al banco.
