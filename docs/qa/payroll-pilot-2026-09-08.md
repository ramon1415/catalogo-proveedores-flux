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
- Edge en DEV: payroll-receipt-verify v35 (JWT); payroll-capture-file-url v2 (JWT); payroll-notification-dispatcher v3 (autenticación propia mediante el secreto del dispatcher).
- El dispatcher general certificado permanece en v83, sin cambios. El nuevo worker de nómina usa la cola y las funciones existentes de auditoría, éxito y reintento.
- RLS y privilegios verificados después de aplicar: anónimos sin acceso; capturistas sin acceso directo a grants ni al worker; materialización y documentos de correo reservados al servicio.
- Grants y destinataria de Tesorería configurados en DEV mediante coincidencia única de perfiles y membresías existentes. No hubo backfill. La entrega se habilitó únicamente para la corrida de QA y volvió a desactivarse después del primer aviso.
- Suite completa local actualizada: 1,096 pruebas aprobadas (un chequeo opcional de artefacto reservado a CI). Incluye 20 pruebas nuevas de PostgreSQL 17 en memoria, permisos, historial, CORS, importes y notificaciones con transporte simulado.
- Build y TypeScript de la aplicación verificados. Las pruebas locales no equivalen a UAT autenticado contra PostgREST/Storage.

## UAT autenticado y aviso autorizado

Ramón autorizó expresamente iniciar sesión y recibir los dos avisos de prueba en `ramon@quantta.mx`.

- Sesión real de Ramón Hipo verificada por el autor del registro; no se suplantaron perfiles de RH.
- Preview del PR: `https://catalogo-proveedores-flux-git-fix-payroll-p-fe9e46-quantta-team.vercel.app`.
- Corrida `SOL-2026-0157`, captura `4cb0d528-a376-4039-bc02-b1432e2feda4`, solicitud `cfd6db66-063d-4411-b191-42dc9af07371`.
- Concepto: `QA FLUX 20260908 UAT-2 - NOMINA SINTETICA - NO PAGAR`. Tres personas sintéticas; ningún sueldo real ni transferencia ejecutada.
- Los cinco archivos se identificaron automáticamente. Periodo: 01 al 15 de septiembre de 2026. Neto $300.00; BBVA $100.00, SPEI $150.00, TOKA $51.16; salida total $301.16.
- Materialización y confirmación de montos completadas desde la UI. Estado actual: approved, con tres canales aún pendientes.
- Carátula descargada desde el servidor: 4,315 bytes; SHA-256 `725eba7fe6f2ae5b56bf9e4eced0f775af8e1e97a9db282ef395d85489d8e1d9`, idéntico al archivo cargado.
- El primer paquete sintético omitía las columnas Sueldo/Sueldo Vacaciones que ya exige el parser de Buk. El servidor rechazó materializarlo; quedó una captura QA sin folio (`b1a7143d-410b-45eb-ab46-9cdedeb9d515`), sin aviso. Se completó el fixture y se registró la corrida anterior. No se debilitó la validación para aceptar el fixture incompleto.
- Se corrigieron dos problemas observados: conservar los IDs de los originales para descarga aun si falla la validación y refrescar la captura abierta después de confirmar montos en el diálogo de Finanzas. Build/TypeScript y suite completa aprobados; falta revalidar estos dos cambios en navegador.

### Entrega acotada a QA

- Migración adicional instalada: `20260908022737_payroll_notification_scoped_test.sql`.
- El diagnóstico autenticado sin envío confirmó que el modo global es test_only y que el destinatario global era distinto del autorizado. No se modificó esa configuración compartida.
- Se configuró exclusivamente la captura de SOL-2026-0157 y el perfil activo de Ramón. La configuración caduca; al caducar detiene los claims sin regresar al envío normal. El worker rechaza una corrida de QA en modo real. El cliente no puede elegir destinatarios ni cambiar el modo.
- Aviso registrado: evento `575aa6eb-6247-4c08-8b8b-ea12a5f1935c`, respuesta HTTP 200 del worker, `sent:1`; procesado a las 02:39:53 UTC del 08/09/2026. El proveedor aceptó el envío a la cuenta autorizada; esto no equivale a confirmar lectura o llegada a bandeja de entrada.
- Entrega nuevamente desactivada en ambas empresas al terminar esta prueba parcial. La corrida no se marcó como pagada y no se emitió payroll.paid.

## Pendiente para cerrar el piloto

1. Continuar SOL-2026-0157: dispersión simulada, tres comprobantes sintéticos y cierre. El navegador quedó bloqueado al abrir el window.confirm de BBVA; las acciones de control y recuperación reportaron timeout. El canal continúa pendiente en la base. Requiere resolver esa confirmación en el navegador compartido para continuar la UAT.
2. Enviar el aviso final autorizado a Ramón con los tres comprobantes y verificar Pagada al reabrir, junto con las descargas restantes. La autorización para ambos avisos ya está recibida; no debe pedirse otra vez.
3. Validar la experiencia de Ara/Yulma con su sesión. Los permisos por empresa y la prohibición de mutaciones de pago ya están cubiertos por pruebas de base de datos; la UAT realizada corresponde a Ramón con capacidad de Finanzas.
4. Preparar y revisar la liberación de producción. En la revisión inicial, main estaba en #548 y PROD todavía no tenía las tablas/RPC/Edge de nómina; este PR a DEV no habilita por sí solo el uso en producción.

IMSS/ISN, CONTPAQ/provisiones, calendario avanzado y el alcance pendiente de #457 se mantienen fuera de este cierre.

Referencias técnicas: [adjuntos en Resend](https://resend.com/docs/dashboard/emails/attachments) (límite de 40 MB tras codificación) y [claves de idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys) (24 horas). El worker envía a la cuenta de QA cuando el modo global es test_only y retiene intentos ambiguos mayores de 23 horas para revisión.
