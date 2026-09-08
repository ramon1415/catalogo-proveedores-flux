# IMSS dentro de Nómina; ISN como siguiente entrega

Fecha: 2026-09-08. Estado: **lector de documentos implementado y probado;
flujo de captura/pago todavía no integrado ni desplegado**.

Ramón autorizó continuar con IMSS y después ISN. Este documento concreta esa
entrega a partir de la tarea [86bbw5mff](https://app.clickup.com/t/86bbw5mff)
y de una inspección de solo lectura de DEV. No cambia la nómina de sueldos
publicada mediante #575–#577 ni acredita la primera corrida real en PROD.

## Objetivo y alcance

Registrar una obligación IMSS dentro de Nómina, conservar el documento de
origen, solicitar el pago a Tesorería, registrar el comprobante y avisar a la
persona que capturó. Flux registra los importes del documento; no calcula
cuotas, bases, tasas, recargos ni fechas legales de vencimiento.

IMSS comparte la entrada de Nómina, la privacidad, la presentación de
archivos, el scroll interno y el estilo de los correos. Su periodo y sus
documentos son propios: no se fuerzan a una quincena ni a los cinco archivos
Buk ni a los canales BBVA/SPEI/TOKA de la corrida de sueldos.

La cola independiente de comprobaciones significa una bandeja donde
Tesorería puede atender pendientes de varias solicitudes desde un solo
lugar. No es un requisito de esta entrega: las acciones de pago estarán
disponibles desde la solicitud IMSS correspondiente.

## Evidencia y consecuencias del diseño

| Hallazgo verificado | Consecuencia |
| --- | --- |
| No hay implementación IMSS en `app/src/features/nomina` ni migración dedicada en `origin/dev` (`4339b09`). La búsqueda de PRs encontró referencias de presupuesto/proveedores, no un flujo IMSS reutilizable. | Se requiere una implementación nueva; no basta activar un botón. |
| `20260903041213_fonacot_no_presupuestal.sql` mantiene expresamente IMSS/INFONAVIT/AFORES e ISN presupuestales. | No copiar `PAYROLL_NON_BUDGET` ni `no_presupuestal=true` de la nómina de sueldos. |
| DEV tiene las partidas `Carga Social (IMSS, Infonavit, AFORES)` e `ISN`, ambas con `no_presupuestal=false`. | Reutilizar el catálogo autorizado; no crear partidas duplicadas por nombre. |
| En DEV ambas están asignadas a Operadora Tlacatecpan / Rancho San Juan Tlacatecpan, con 12 meses en versiones activas de presupuesto. | Existe una base de asignación para esta empresa. Esto no certifica disponibilidad para un importe específico ni configuración de PROD. |
| La misma consulta no encontró asignación IMSS/ISN para Soporte Fersana en DEV. | Falta determinar su centro/partida y presupuesto antes de habilitar envío en esa empresa. No copiar la asignación de Operadora. |
| `budget_availability` calcula comprometido y ejercido desde `payment_requests` y usa `security_invoker=true`. | Una tabla privada adicional, por sí sola, no reserva presupuesto. Resolver el vínculo presupuestal antes de permitir enviar/pagar. |
| Los grants de captura y los helpers de acceso difieren entre DEV y PROD. | Validar una matriz por ambiente; nunca copiar IDs o inferir acceso PROD desde DEV. |
| El worker de nómina valida eventos, canales y evidencia exclusivos de corridas de sueldos. | Reutilizar su presentación y patrón de entrega, pero crear un contrato IMSS explícito; no fingir un canal bancario. |
| ClickUp describe IMSS, pero no define documentos, entidad ni operación ISN. | ISN necesita definición propia antes de desarrollar extracción o reglas. |

## Flujo propuesto para IMSS

| Etapa | Quién actúa | Datos y condición para avanzar |
| --- | --- | --- |
| Borrador | Capturista con permiso IMSS en la empresa | Empresa activa, inicio/fin del periodo según documento, importe MXN, documento oficial PDF y referencia/línea de captura si existe. Guardado recuperable. |
| Revisión de captura | Capturista | Contrastar datos leídos contra el documento. Lecturas dudosas quedan pendientes de confirmar; nunca sustituir una fecha faltante por hoy ni un importe faltante por cero. |
| Envío a Tesorería | Capturista | Documento persistido y validado en servidor; campos requeridos completos; asignación y control presupuestal resueltos. Un envío repetido devuelve la misma solicitud. |
| Confirmación de montos | Finanzas de la empresa | Mostrar total, periodo y documento para la acción de pago. Esta confirmación no debe eliminar una autorización presupuestal vigente de forma implícita. |
| Registro del pago | Finanzas de la empresa | Adjuntar el comprobante real y confirmar importe pagado, fecha y referencia. Flux no ejecuta la transferencia. |
| Cierre | Finanzas de la empresa | Comprobante validado en servidor y monto conciliado. Si difiere, queda pendiente de aclaración; no cerrar automáticamente. Registrar actor y fecha de cierre. |
| Aviso e historial | Sistema | Un aviso a la persona capturista después del cierre. La solicitud queda pagada y sus documentos disponibles según permisos. |

La política específica de autorización IMSS debe documentarse al integrar el
presupuesto. La eliminación de aprobación individual de la nómina de sueldos
no constituye una decisión sobre IMSS. No habilitar el envío con este punto
sin resolver.

## Contrato de captura y documentos

- Empresa: la del contexto autorizado, inmutable después de crear la captura.
- Periodo: inicio y fin explícitos; no asumir mensual/bimestral hasta revisar
  los documentos usados por el equipo. Debe poder distinguir obligaciones
  del mismo periodo por registro patronal o referencia cuando corresponda.
- Importe: decimal en MXN, positivo, sin cálculo fiscal dentro de Flux.
- Documento de origen: conservar los bytes originales en almacenamiento
  privado, con tamaño, MIME, SHA-256 y versión. Acordar con la muestra si es
  suficiente un PDF o hay documentos complementarios.
- Referencia/línea de captura y registro patronal: extraer solo cuando estén
  presentes en el formato confirmado. No incluirlos completos en el listado
  ni en correos de resumen.
- Vencimiento: copiar únicamente el que indique el documento, si se necesita
  operativamente; no calcular plazos fiscales.
- Datos de pago: importe, fecha y referencia del comprobante. La extracción
  automática se revisa antes de cerrar y debe conservar su procedencia.
- Duplicados: advertir por empresa, periodo y referencia/registro patronal;
  bloquear repetición del mismo documento o envío. Permitir aclarar una
  obligación complementaria legítima sin marcarla como duplicado arbitrario.

Las validaciones de tamaño, firma PDF, hash y pertenencia al expediente no
certifican que el importe esté pagado. Mantener separada la integridad del
archivo de la conciliación financiera confirmada por Finanzas.

## Permisos propuestos para la nueva función

Esta es la matriz objetivo de IMSS, no una descripción de los permisos
actuales de la nómina de sueldos. No cambiar el rol global de Ara o Yulma para
darles acceso a IMSS; conservar sus capacidades en los demás módulos.

| Capacidad | Captura IMSS/RH | Finanzas de la empresa | SysAdmin autorizado |
| --- | --- | --- | --- |
| Crear/editar borrador y enviar | Sí | Solo con permiso adicional de captura | Sí |
| Historial de captura de la empresa autorizada | Sí | Superficie acotada a su acción de pago | Sí |
| Abrir documento para atender el pago | Sí | Sí, con acción explícita y auditada | Sí |
| Confirmar monto, subir comprobante y cerrar | No | Sí | Sí |
| Dar permisos o modificar la configuración | No | No por el solo hecho de ser Finanzas | Sí, mediante administración controlada |

Cada RPC y acceso a documentos exige perfil activo, alcance de empresa y
capacidad correspondiente. Dirección y Operación no obtienen acceso por
su rol general; una concesión de captura IMSS es explícita y no da permiso
de pago. Revocar una membresía/grant debe surtir efecto también en servidor.

Separar capacidades a nivel módulo permite que una persona conserve
Finanzas en otros módulos. La creación del rol global `rh` y el retiro de la
vista general de sueldos a Finanzas, pedidos en la spec amplia, requieren una
entrega de permisos con prueba de regresión propia; no van implícitos en IMSS.

## Integración técnica y presupuesto

1. Mantener expediente, documentos y auditoría privados en Nómina. Usar
   reserva → carga → validación en servidor; URL firmada temporal para
   descargar, sin adjuntar documentos sensibles a listados generales.
2. Resolver la reserva presupuestal contra el modelo canónico, preferiblemente
   con un vínculo único al registro monetario correspondiente. Antes de elegir
   `payment_requests`, revisar sus RLS, triggers y vistas para que IMSS no
   aparezca en consultas, layouts o correos generales indebidamente.
3. No crear una segunda disponibilidad presupuestal. La misma reserva debe
   verse en solicitudes normales y en IMSS, incluso cuando el usuario no tiene
   permiso de leer el expediente confidencial. Evitar doble contabilización
   al cerrar como pagada. Probar competencia por el mismo presupuesto.
4. Encapsular transiciones en RPCs: lock del expediente, versión esperada,
   idempotencia, validación de pertenencia de archivos y auditoría. No permitir
   `UPDATE status='paid'` ni reemplazar evidencia de un expediente pagado desde
   el navegador.
5. La información quedará trazable para una integración contable posterior.
   No declarar un asiento exportado ni activar CONTPAQ con esta entrega.

## Notificaciones

| Momento | Destinatario | Contenido |
| --- | --- | --- |
| Solicitud enviada y lista para atender | Responsable de Tesorería configurado para esa empresa | Folio IMSS, empresa, periodo, total y botón para abrir la acción. |
| Pago conciliado y cerrado | Perfil creador de la captura | Confirmación de pago, resumen y acceso privado al comprobante. |

Usar el estilo Flux ya publicado: encabezado verde, tipografía y tabla de
resumen consistentes, botón principal y pie de privacidad. Destinatarios
resueltos en servidor y revalidados al enviar; no usar la lista de todas las
personas con rol Finanzas.

Eventos IMSS separados de `payroll.registered`/`payroll.paid`, con outbox
transaccional, claves de idempotencia y reintentos controlados. Cerrar dos
veces no genera otro correo. El modo de prueba debe quedar limitado a Ramón;
activar los destinatarios reales requiere el rollout IMSS, no hereda la
activación de la nómina de sueldos.

## Pruebas que deben cerrar la entrega

| Grupo | Casos requeridos |
| --- | --- |
| Captura | Documento real de referencia; guardar y reabrir; comparar extracción con original; PDF ilegible; archivo equivocado; cancelar selector sin cerrar modal; control de duplicados. |
| Permisos | Captura sin pago; Finanzas sin captura adicional; usuario ajeno; cruce de empresa; membresía revocada; acceso directo a RPC/Storage; archivos originales sin detalle por persona en la interfaz. |
| Presupuesto | Con/sin asignación; con/sin saldo; concurrencia IMSS vs solicitud normal; reserva exactamente una vez; cierre sin duplicar consumo; cancelación con liberación trazable. |
| Pago | Sin comprobante no cierra; monto distinto no cierra; documento de otra solicitud rechazado; estado pagado inmutable; repetir cierre idempotente. |
| Correo | Envío → Tesorería; cierre → creador; diseño Flux; deduplicación; reintentos; cuenta desactivada; modo DEV sin correos reales accidentales. |
| Interfaz | Archivos con estado uniforme y descarga; scroll dentro del listado y modal; celular; cambio de empresa sin conservar datos o permisos de la anterior. |
| Regresión | Captura Buk, confirmación, tres canales, extracción de comprobantes y cierre de sueldos; solicitudes normales y disponibilidad presupuestal. |

## Orden de implementación y datos pendientes

1. Muestras de documentos recibidas y analizadas: línea SIPARE, cédula SUA,
   propuesta EMA y línea ISN CDMX. Falta el comprobante bancario de pago y
   confirmar si la empresa de las muestras es solo una referencia de formato
   o también debe incorporarse al alcance operativo.
2. Concretar la asignación de Soporte Fersana si también usará el flujo, y la
   autorización presupuestal aplicable. Operadora tiene asignación en DEV;
   falta validar el alcance y el circuito con la operación real.
3. Implementar expediente privado, control presupuestal y permisos; después
   captura/lectura, pago, correos y prueba E2E con evidencia.
4. Pasar a DEV para revisión del equipo. Preparar un release IMSS acotado
   cuando cierre la prueba; este documento no despliega cambios en PROD.
5. Para ISN ya hay una muestra de CDMX con periodo, referencia y vigencia.
   Confirmar empresas/entidades realmente operadas, responsable y comprobante.
   Reutilizar infraestructura validada, sin asumir que ISN usa el formato IMSS
   ni introducir tasas o calendarios por inferencia.

La tarea amplia en ClickUp incluye el feed contable y la separación estricta
RH/Finanzas de todo Nómina. No marcarla completa al terminar solo IMSS.

## Resultado de la revisión de muestras y primera implementación

Los cuatro PDF aportados por Ramón son de una razón social distinta de los
nombres de las dos empresas del piloto de sueldos. Tres contienen el mismo
RFC corporativo normalizado; la cédula SUA contiene otro RFC, también después
de quitar guiones. El registro patronal, periodo y total de los tres soportes
IMSS coinciden. Esa coincidencia no autoriza a corregir el RFC por mayoría ni
a asociar los archivos automáticamente a Fersana u Operadora.

No se copian a Git los PDF, textos originales, RFC reales, líneas de captura,
importes reales ni datos de empleados. Las pruebas versionadas son sintéticas.

| Formato recibido | Datos leídos y comportamiento |
| --- | --- |
| Línea IMSS/SIPARE | RFC, registro patronal, periodo mensual, total final, fecha límite y línea de captura. Es la referencia monetaria principal. |
| Cédula SUA, dos páginas | RFC, registro patronal, periodo y total de la segunda página. La fecha de proceso no se usa como vencimiento ni fecha de pago. |
| Propuesta EMA, dos páginas | RFC, registro patronal, periodo, total y fecha límite. Su pie menciona SUA, pero eso no cambia su clasificación. |
| Línea ISN CDMX | RFC, periodo, total final impreso, línea de captura y vigencia. El talón repite total/referencia; no duplica la obligación. La cadena larga del código de barras no sustituye la línea de captura. |

Ninguno de los cuatro archivos contiene recibo bancario o certificación de
pago realizado. Las fechas límite impresas no acreditan una fecha de pago.
La cédula y EMA contienen datos de empleados: el lector devuelve únicamente
una lista explícita de campos corporativos y agregados, sin filas de personas,
texto original ni CURP/NSS/salarios individuales.

### Código y validación

- `app/src/features/nomina/obligationDocuments.ts`: clasificador por contenido,
  lectura de agregados y consistencia del paquete IMSS. No usa el nombre del
  archivo, no suma los soportes y exige RFC explícito de la empresa para dar
  una validación de consistencia positiva. Esto no sustituye autorización,
  presupuesto, validación de bytes ni conciliación bancaria en servidor.
- `scripts/qa/payroll-obligation-documents.test.mjs`: ocho pruebas con
  documentos sintéticos: formatos, discrepancia de RFC, duplicados, empresa,
  diferencias de importe/periodo/registro patronal, fechas ambiguas y total
  impreso de ISN. Incluye las filas intercaladas observadas con PDF.js.
- Workflow específico en `.github/workflows/payroll-obligation-documents-tests.yml`.
- Lectura local de todas las páginas de las cuatro muestras mediante Poppler
  y PDF.js 3.11.174, con la agrupación geométrica usada por `extractPdfLines`.
  Comparación contra revisión visual; los originales permanecen fuera de Git.
- El lector aún no se invoca desde la pantalla ni desde un servicio. No hay
  migración, cambio de roles, envío de correos ni despliegue con esta entrega.

### Lo que falta para el siguiente paso

1. Confirmar si la razón social de las muestras es solo ejemplo de formato o
   una empresa adicional que debe operar en Flux. No crear ni mapear empresas
   por semejanza de nombre.
2. Aclarar el RFC diferente en la cédula SUA antes de aceptar ese paquete real;
   la implementación puede continuar con casos sintéticos consistentes.
3. Obtener al menos un comprobante bancario de pago IMSS/ISN para diseñar y
   probar su lectura. Las líneas de captura ya recibidas cubren la etapa de
   solicitud, no la evidencia de pago.
4. Resolver asignación/autorización presupuestal por empresa, persistencia
   privada y acciones del flujo; después integrar UI, notificaciones y E2E.
