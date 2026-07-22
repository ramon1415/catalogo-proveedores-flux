# Conciliacion de comprobantes en batch

## Estado de esta entrega

Esta entrega inicia la implementacion del diseno B1 en una rama y un PR separados
del alta y matching de proveedores. Su alcance termina en la revision y reserva
de capacidad; no habilita todavia la confirmacion financiera ni cambia la
autoridad legacy de `payment_receipts`.

La migracion se numera como `032_payment_batch_reconciliation.sql` porque el PR
Draft de provider intake reserva `031_provider_intake_matching.sql`. La migracion
032 no debe aplicarse en DEV hasta reconciliar y verificar por separado el orden
real de migraciones.

## Autoridades del dominio

| Hecho | Autoridad de esta implementacion | Regla |
|---|---|---|
| Autorizacion pagable | `payable_snapshots` | Snapshot inmutable creado al cerrar el corte o autorizar una excepcion vigente. |
| Evidencia documental | `payment_documents` y `payment_document_extractions` | La extraccion es una propuesta revisable, no un movimiento financiero. |
| Operacion bancaria | `bank_payment_operations` | Se crea al aceptar expresamente una extraccion y se deduplica con fingerprint versionado. |
| Propuesta N:M | `payment_allocation_plans` y `payment_allocation_items` | Una operacion puede distribuirse entre varias solicitudes y viceversa. |
| Capacidad temporal | `payment_allocation_reservations` | Consume capacidad en ambos lados sin confirmar un pago. |
| Eventos del dominio | `financial_outbox_events` | Se escriben en la misma transaccion que el hecho; no se despachan en esta entrega. |

`proveedores` sigue siendo el catalogo canonico para matching. Esta entrega no
crea dependencias hacia `providers`, `provider_intakes` ni las tablas propuestas
por el PR de intake.

## Dinero y concurrencia

- Los montos persistidos por el dominio nuevo usan unidades menores enteras.
- El rango del corte browser-first se limita a enteros seguros de JavaScript
  (`1..9007199254740991`) para no perder precision en JSON/PostgREST.
- `MXP` se normaliza a `MXN`; no implica conversion de divisa.
- La escala queda fija por moneda; una nueva version de politica puede cambiar
  tolerancia o vigencia, pero no reinterpretar montos historicos.
- La tolerancia inicial es cero y solo podra influir en ranking o revision.
- Proponer y reservar bloquean las solicitudes pagables y sus snapshots en orden
  determinista, vuelven a calcular saldos dentro de la transaccion y rechazan
  snapshots obsoletos, reaprobaciones concurrentes y sobreasignaciones.
- Liberar o cancelar una reserva es terminal e idempotente; libera capacidad una
  sola vez.
- El vencimiento se materializa con un comando explicito que usa el reloj de la
  base de datos; liberar o cancelar no puede reclasificar una reserva ya vencida.
- La idempotencia compara una llave estable y el hash canonico del payload. La
  misma llave con material distinto falla de forma determinista y su alcance
  incluye la empresa.

## Flujo incluido

1. Finanzas crea un batch para una empresa y recibe una ruta privada de carga.
2. El navegador calcula una huella SHA-256 y carga un unico PDF BBVA en el bucket
   privado. Esa huella es evidencia declarada por el cliente, no una atestacion
   server-side del contenido del objeto.
3. PDF.js separa el texto por pagina y el parser determinista BBVA v1 propone los
   campos estructurados. La evaluacion dinamica de PDF.js queda deshabilitada al
   abrir contenido no confiable.
4. El servidor normaliza moneda y montos, acepta como identidad fuerte de cuenta
   BBVA solo material numerico de 10 a 18 digitos, lo hashea y conserva solo sus
   ultimos cuatro digitos en el modelo de revision.
5. Finanzas abre una URL privada de cinco minutos para comparar la pagina fuente
   y acepta o rechaza cada extraccion. Aceptar exige un Folio unico BBVA y que la
   cuenta origen corresponda de forma univoca a una cuenta bancaria activa de la
   empresa, con `bank_name` canonico `BBVA` y la misma moneda; cero coincidencias
   o mas de una bloquean la aceptacion. Crea la operacion bancaria canonica y su
   evento de outbox en una sola transaccion. El Folio unico se normaliza y no
   puede identificar dos operaciones de la misma empresa.
6. El matcher consulta snapshots pagables y el catalogo `proveedores`; puede
   sugerir por importe, cuenta y beneficiario, pero nunca auto-confirma.
7. Finanzas propone asignaciones N:M y puede reservar capacidad.

La extraccion en navegador se trata expresamente como entrada no confiable. La
aceptacion humana y las guardas de servidor son obligatorias. Un parser server-side
puede sustituirla despues sin cambiar los contratos del dominio.

## Limites deliberados

- No existe grant autenticado para confirmar asignaciones.
- No se marca una solicitud como pagada.
- No se escribe, actualiza ni proyecta `payment_receipts`.
- No se crea dual-write ni segunda autoridad.
- No se activa dispatcher, notificaciones, n8n, cron ni workflows.
- No hay backfill ni cutover legacy.
- No se divide ni publica todavia una pagina individual como comprobante externo.
- No existe todavia una atestacion server-side que recalcule el SHA-256 del blob;
  la deduplicacion financiera se protege aparte con la identidad fuerte de la
  operacion bancaria.
- La politica documental D-08 debe resolverse antes de desplegar el bucket.

## Siguiente corte con autorizacion separada

Antes de habilitar **Confirmar**, la implementacion debe completar en una sola
frontera revisable:

1. ledger append-only de confirmaciones y reversos;
2. atomicidad de todas las asignaciones de una operacion bancaria, conforme a
   Q-B1-01: todas las asignaciones de esa operacion o ninguna;
3. segregacion entre proponente y confirmador, con break-glass auditado;
4. proyeccion de saldos y estados derivados;
5. cutover que deshabilite los writers financieros legacy;
6. compatibilidad de lectores sin convertir `payment_receipts` en autoridad;
7. pruebas transaccionales y de concurrencia sobre un Supabase local autorizado.

Hasta que ese corte exista, la UI debe explicar que confirmar esta bloqueado por
el cutover y el servidor debe mantener cerrados los permisos correspondientes.

## Activacion y validacion

Esta rama solo prepara codigo revisable. Para cualquier aplicacion en DEV se
requiere una autorizacion separada y un preflight read-only que confirme:

- historial y orden real de migraciones 031/032;
- presencia de dependencias del esquema versionado;
- cuentas origen activas con `bank_name` canonico `BBVA`, moneda coherente y una
  sola coincidencia por empresa y material de cuenta/CLABE;
- roles y memberships reales;
- politica D-08 para almacenamiento y retencion;
- mecanismo autorizado para atestar el contenido real del objeto almacenado;
- inventario y allowlist de todas las policies efectivas sobre `storage.objects`,
  incluidos grants globales que pudieran alcanzar el bucket nuevo;
- ausencia de writers no inventariados que generen dual autoridad.

Las pruebas Node de esta entrega validan contratos estaticos y el parser puro. No
sustituyen pruebas de PostgreSQL, RLS ni carreras reales y no deben presentarse
como evidencia de despliegue.
