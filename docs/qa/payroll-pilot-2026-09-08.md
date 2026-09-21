# Nómina: alcance comprometido con Yulma y Ara

Revisión sobre DEV `c5989a5fe969c8cb35433bed0cf4e315e7f08185` (PR #570).
Proyecto DEV: `scsirgbuqjcwoaxfacth`. Producción no se modifica en este cambio.

| Compromiso | Evidencia / resultado |
| --- | --- |
| Nueva captura y reconocimiento de cinco archivos Buk | Ya implementado en #505, #514, #515, #553 y #554. 41 pruebas de formatos/captura aprobadas. SOL-2026-0156 conserva cinco archivos cargados y materializados: carátula, BBVA, SPEI, TOKA y CFDI. |
| Captura por Ara y Yulma | Nuevo permiso específico por empresa, consultado por menú, pantalla, RPC y Storage. Ara: Soporte Fersana. Yulma: Soporte Fersana y Operadora Tlacatecpan. Conservan su membresía operator y no reciben permisos de pago. |
| Descargar originales | #560 y #563 ya implementaron el enlace privado con vigencia de 120 segundos. Se extiende su autorización al permiso de captura. La carátula de SOL-2026-0157 se descargó con sesión real y coincide en SHA-256 con el original y Storage. |
| Comprobante por canal | Se corrigió el preflight de payroll-receipt-verify: antes 405; después 204 con las cabeceras CORS requeridas, comprobado en DEV. Se conserva JWT obligatorio. |
| Verificar importe | Al seleccionar el PDF se precargan importe, fecha de pago y referencia mediante lectura local. Tesorería revisa los datos; la UI compara centavos exactos y el RPC conserva su validación independiente. La verificación del servidor comprueba integridad y formato. Los datos ausentes o ambiguos requieren revisión explícita. Mejora de #573, incluida también en el preview del piloto. |
| Cerrar y consultar pago | Los RPC existentes conservan sus restricciones de Finanzas y evidencia por canal. La UI muestra Pagada y mantiene comprobantes descargables; refresca el historial al cerrar. Las capturas materializadas permanecen aunque expire el staging. |
| Avisos | Dos eventos en la cola existente: payroll.registered a la responsable de Tesorería configurada; payroll.paid a quien creó la captura. Un evento por transición/corrida y clave estable de envío. El aviso de pago incluye los PDF verificados; si superan 20 MiB en conjunto, enlaza a su descarga privada en Flux. |
| Confidencialidad | Los permisos de registros individuales y pagos no se amplían. Las respuestas visibles y las plantillas de correo usan totales. Los originales siguen siendo archivos privados y pueden contener información individual. |

## Instalación y verificaciones

- Migraciones instaladas en DEV: `20260908015626_payroll_capture_access_and_history.sql` y `20260908015701_payroll_pilot_notifications.sql`. Los archivos usan los mismos identificadores que el historial del servidor.
- Edge en DEV: payroll-receipt-verify v35 (JWT); payroll-capture-file-url v2 (JWT); payroll-notification-dispatcher v4 (autenticación propia y diseño de correo habitual de Flux).
- El dispatcher general certificado permanece en v83, sin cambios. El nuevo worker de nómina usa la cola y las funciones existentes de auditoría, éxito y reintento.
- RLS y privilegios verificados después de aplicar: anónimos sin acceso; capturistas sin acceso directo a grants ni al worker; materialización y documentos de correo reservados al servicio.
- Grants y destinataria de Tesorería configurados en DEV mediante coincidencia única de perfiles y membresías existentes. No hubo backfill. La entrega se habilitó únicamente para la corrida de QA y volvió a desactivarse después de cada aviso autorizado.
- Suite completa local actualizada: 1,096 pruebas aprobadas (un chequeo opcional de artefacto reservado a CI). Incluye 20 pruebas nuevas de PostgreSQL 17 en memoria, permisos, historial, CORS, importes y notificaciones con transporte simulado.
- Build y TypeScript de la aplicación verificados. Las pruebas locales no equivalen a UAT autenticado contra PostgREST/Storage.

## UAT autenticado y aviso autorizado

Ramón autorizó expresamente iniciar sesión y recibir los dos avisos de prueba en `ramon@quantta.mx`.

- Sesión real de Ramón Hipo verificada por el autor del registro; no se suplantaron perfiles de RH.
- Preview del PR: `https://catalogo-proveedores-flux-git-fix-payroll-p-fe9e46-quantta-team.vercel.app`.
- Corrida `SOL-2026-0157`, captura `4cb0d528-a376-4039-bc02-b1432e2feda4`, solicitud `cfd6db66-063d-4411-b191-42dc9af07371`.
- Concepto: `QA FLUX 20260908 UAT-2 - NOMINA SINTETICA - NO PAGAR`. Tres personas sintéticas; ningún sueldo real ni transferencia ejecutada.
- Los cinco archivos se identificaron automáticamente. Periodo: 01 al 15 de septiembre de 2026. Neto $300.00; BBVA $100.00, SPEI $150.00, TOKA $51.16; salida total $301.16.
- Materialización y confirmación de montos completadas desde la UI. Ramón continuó la prueba, confirmó la precarga automática, concilió los tres comprobantes y cerró la corrida. Estado verificado en DEV: paid; BBVA, SPEI y TOKA dispersados y conciliados, con comprobante asociado.
- Carátula descargada desde el servidor: 4,315 bytes; SHA-256 `725eba7fe6f2ae5b56bf9e4eced0f775af8e1e97a9db282ef395d85489d8e1d9`, idéntico al archivo cargado.
- El primer paquete sintético omitía las columnas Sueldo/Sueldo Vacaciones que ya exige el parser de Buk. El servidor rechazó materializarlo; quedó una captura QA sin folio (`b1a7143d-410b-45eb-ab46-9cdedeb9d515`), sin aviso. Se completó el fixture y se registró la corrida anterior. No se debilitó la validación para aceptar el fixture incompleto.
- Se corrigieron dos problemas observados: conservar los IDs de los originales para descarga aun si falla la validación y refrescar la captura abierta después de confirmar montos en el diálogo de Finanzas. Build/TypeScript y suite completa aprobados; falta revalidar estos dos cambios en navegador.

### Entrega acotada a QA

- Migración adicional instalada: `20260908022737_payroll_notification_scoped_test.sql`.
- El diagnóstico autenticado sin envío confirmó que el modo global es test_only y que el destinatario global era distinto del autorizado. No se modificó esa configuración compartida.
- Se configuró exclusivamente la captura de SOL-2026-0157 y el perfil activo de Ramón. La configuración caduca; al caducar detiene los claims sin regresar al envío normal. El worker rechaza una corrida de QA en modo real. El cliente no puede elegir destinatarios ni cambiar el modo.
- Aviso registrado: evento `575aa6eb-6247-4c08-8b8b-ea12a5f1935c`, respuesta HTTP 200 del worker, `sent:1`; procesado a las 02:39:53 UTC del 08/09/2026. El proveedor aceptó el envío a la cuenta autorizada; esto no equivale a confirmar lectura o llegada a bandeja de entrada.
- Al terminar el primer aviso se desactivó la entrega. Por ello, y por la caducidad de la ventana QA, el evento final generado por el cierre manual de Ramón quedó pending con cero intentos; el dominio preview no era la causa.
- Aviso final: evento `90b92a3d-c41c-4f11-a1fc-66fef8a3386a`, generado a las 04:41:51 UTC. Se renovó únicamente la ventana de esa captura y el perfil activo `ramon@quantta.mx`, tras confirmar modo test_only mediante preflight autenticado sin envío.
- Procesado una sola vez a las 05:00:05 UTC: intento 1, proveedor `87c971af-a3de-482d-859e-346976f823e3`. El despertar HTTP de 2 segundos agotó su espera, pero el registro del envío confirmó sent; no se reenvió.
- Gmail de Quantta confirma recepción a las 05:00:08 UTC: mensaje `1a07f634fba064b9`, INBOX, asunto `[DEV TEST] Nómina pagada · SOL-2026-0157`. Se leyó el MIME y se verificaron los tres adjuntos BBVA/SPEI/TOKA, el HTML con encabezado verde y el botón hacia la captura correcta. La representación visual en Gmail no se comprobó desde el navegador automatizado.
- Entrega nuevamente desactivada en ambas empresas. Cero eventos de nómina pendientes para esta corrida. Los dos avisos autorizados quedaron completos.

### Observaciones finales de Ramón

- La selección del PDF ya precarga importe, fecha y referencia, confirmado por Ramón.
- Cancelar el selector de archivos hacía llegar su evento cancel al modal compartido y cerraba la captura. Ahora el modal solo responde a su propio cancel; se conservan Escape y el botón Cerrar. También cubre volver a elegir el mismo archivo.
- Revalidar paquete espera el estado del servidor y se oculta cuando es paid, tanto después del cierre como al reabrir. El estado visible se presenta como Nómina pagada.
- Build/TypeScript y 15 pruebas dirigidas aprobadas: dos regresiones de modal/cierre, once de precarga y dos de notificaciones visuales en diálogos. El selector nativo sigue pendiente de retest manual porque el navegador compartido no responde.

### Presentación de archivos y scroll interno

- El listado de Nómina ocupa el espacio disponible con el mismo reparto flexible que Solicitudes de pago. La cabecera permanece fija y el scroll pertenece a la lista; también admite desplazamiento con teclado. El panel conserva una altura mínima en ventanas muy bajas.
- Se eliminan los títulos duplicados y el identificador técnico N3G del encabezado del listado. Se muestran la empresa, el número de capturas y el acceso privado.
- Originales y comprobantes comparten filas con icono de archivo, datos legibles y botones de descarga. Descargar y Quitar quedan agrupados para evitar una quinta columna desalineada; los nombres completos se pueden consultar y se ajustan en móvil.
- Cada comprobante separa canal, importe/moneda, estado, fecha y referencia. El panel usa los colores normales de Flux y la confirmación de pago es verde; el ámbar se reserva para advertencias. Las barras internas del modal y del listado respetan el tema activo.
- Build/TypeScript y 24 pruebas dirigidas aprobadas: modal/cierre, precarga del PDF, contrato de captura y notificaciones de diálogo. Los dos harness de componentes cargan los iconos compartidos reales; sus aserciones funcionales se conservan.
- El navegador compartido volvió a agotar la conexión al listar las pestañas. No se da por verificado visualmente el scroll, el selector nativo ni el diseño nuevo en el navegador; requieren retest manual en el preview publicado. No se generaron nuevas corridas ni avisos durante este ajuste.

### Destinatarios para la liberación

- Registro: responsable de Tesorería por empresa; en DEV ambas empresas tienen a Yanin Navarrete (`ynavarrete@soportef.com`).
- Pago: quien creó la captura. Si la creó Ara, llega a Ara; si la creó Yulma, llega a Yulma. No es un envío automático a todas las capturistas. Se envía un único correo con los comprobantes de todos los canales al cerrar.
- Verificación de PROD: no existen aún payroll_notification_settings ni get_payroll_notification_document. La configuración productiva y habilitación forman parte de la liberación pendiente; no se aplicaron cambios en PROD.

### Validación manual e integración a DEV

Ramón confirmó que los dos pendientes de UX quedaron correctos: cancelar el selector sin cerrar el modal/ocultar Revalidar al pagar, y presentación de archivos/scroll interno. El PR #571 quedó fusionado en DEV, commit `205c78458cc0f9d4b6cb40f0688c3967f187d40c`, con Contract suite posterior al merge y Vercel aprobados. Esos dos pendientes quedan cerrados por la validación del usuario.

### Conteos e importes al reabrir la captura

La consulta original devolvía los metadatos de staging: por contrato, solo SPEI conserva ahí conteo e importe del navegador. Los cinco archivos ya estaban validados en el servidor, pero los otros cuatro aparecían sin datos al reabrir. No faltaban archivos ni registros.

- Migración `20260908060513_payroll_capture_verified_file_totals.sql`, aplicada únicamente en DEV. El archivo se creó con Supabase CLI 2.117.0 y se alineó con la versión asignada por el historial nativo al aplicar la migración puntual.
- Se conserva el RPC público y se actualiza su consulta interna: conteos de `payroll_run_files.parsing_metadata.row_count`, neto de las líneas de la carátula y montos de los canales. El CFDI muestra el importe de vales; fondeo TOKA muestra el fondeo completo, que incluye comisión/IVA.
- La evidencia debe coincidir en archivo de captura, solicitud, empresa, tipo, hash y validación del servidor. Cuando falta evidencia, el valor queda nulo. La lectura de borradores conserva sus metadatos previos.
- La UI etiqueta personas, pagos, transferencias y beneficiarios de vales, con singular/plural. El importe tiene una descripción según el tipo de archivo.
- Build/TypeScript y 16 pruebas dirigidas aprobadas: 13 de PostgreSQL 17/permisos/ciclo y 3 del modal. Incluyen cinco regresiones nuevas para reapertura de los cinco archivos, exactitud de importes, conservación del staging, vínculos inválidos, aislamiento por empresa y datos incompletos.
- Consulta al RPC en DEV con rol authenticated y el contexto del perfil autorizado de Ramón: cinco archivos, folio SOL-2026-0157 y estado paid. Resultados:

| Archivo | Conteo | Importe MXN |
| --- | ---: | ---: |
| Carátula | 3 personas | 300.00 |
| BBVA Nómina | 1 pago | 100.00 |
| SPEI | 1 transferencia | 150.00 |
| TOKA fondeo | 1 transferencia | 51.16 |
| TOKA CFDI | 1 beneficiario de vales | 50.00 |

Los datos de staging permanecen intactos, el estado sigue paid y la corrida conserva exactamente los dos eventos de aviso previos. La ACL interna permanece exclusiva de postgres/service_role; el wrapper público sigue disponible para authenticated. No hubo hallazgos nuevos respecto de la línea base de advisors. La verificación del arreglo combina el RPC real y el componente React; no constituye una nueva prueba visual en navegador.

## Pendiente para cerrar el piloto

1. Verificar la descarga de comprobantes desde la captura. Los dos ajustes de UX previos, el cierre y ambos avisos ya están verificados.
2. Confirmar la apariencia del correo final dentro de Gmail. El mensaje recibido, el HTML y los tres adjuntos ya fueron verificados mediante la API de Gmail.
3. Validar la experiencia de Ara/Yulma con su sesión. Los permisos por empresa y la prohibición de mutaciones de pago ya están cubiertos por pruebas de base de datos; la UAT realizada corresponde a Ramón con capacidad de Finanzas.
4. Preparar y revisar la liberación de producción. En la revisión inicial, main estaba en #548 y PROD todavía no tenía las tablas/RPC/Edge de nómina; este PR a DEV no habilita por sí solo el uso en producción.

IMSS/ISN, CONTPAQ/provisiones, calendario avanzado y el alcance pendiente de #457 se mantienen fuera de este cierre.

Referencias técnicas: [adjuntos en Resend](https://resend.com/docs/dashboard/emails/attachments) (límite de 40 MB tras codificación) y [claves de idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys) (24 horas). El worker envía a la cuenta de QA cuando el modo global es test_only y retiene intentos ambiguos mayores de 23 horas para revisión.
