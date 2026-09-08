# Nómina: alcance comprometido con Yulma y Ara

Revisión sobre DEV `c5989a5fe969c8cb35433bed0cf4e315e7f08185` (PR #570).
Proyecto DEV: `scsirgbuqjcwoaxfacth`. Producción no se modifica en este cambio.

| Compromiso | Evidencia / resultado |
| --- | --- |
| Nueva captura y reconocimiento de cinco archivos Buk | Ya implementado en #505, #514, #515, #553 y #554. 41 pruebas de formatos/captura aprobadas. SOL-2026-0156 conserva cinco archivos cargados y materializados: carátula, BBVA, SPEI, TOKA y CFDI. |
| Captura por Ara y Yulma | Nuevo permiso específico por empresa, consultado por menú, pantalla, RPC y Storage. Ara: Soporte Fersana. Yulma: Soporte Fersana y Operadora Tlacatecpan. Conservan su membresía operator y no reciben permisos de pago. |
| Descargar originales | #560 y #563 ya implementaron el enlace privado con vigencia de 120 segundos. Se extiende su autorización al permiso de captura. Falta verificar la descarga con sesión real en navegador. |
| Comprobante por canal | Se corrigió el preflight de payroll-receipt-verify: antes 405; después 204 con las cabeceras CORS requeridas, comprobado en DEV. Se conserva JWT obligatorio. |
| Verificar importe | Tesorería debe capturar el importe del PDF. La UI compara centavos exactos y el RPC conserva su validación independiente. La verificación del PDF comprueba integridad y formato; no extrae automáticamente su importe. |
| Cerrar y consultar pago | Los RPC existentes conservan sus restricciones de Finanzas y evidencia por canal. La UI muestra Pagada y mantiene comprobantes descargables; refresca el historial al cerrar. Las capturas materializadas permanecen aunque expire el staging. |
| Avisos | Dos eventos en la cola existente: payroll.registered a la responsable de Tesorería configurada; payroll.paid a quien creó la captura. Un evento por transición/corrida y clave estable de envío. El aviso de pago incluye los PDF verificados; si superan 20 MiB en conjunto, enlaza a su descarga privada en Flux. |
| Confidencialidad | Los permisos de registros individuales y pagos no se amplían. Las respuestas visibles y las plantillas de correo usan totales. Los originales siguen siendo archivos privados y pueden contener información individual. |

## Instalación y verificaciones

- Migraciones instaladas en DEV: `20260908015626_payroll_capture_access_and_history.sql` y `20260908015701_payroll_pilot_notifications.sql`. Los archivos usan los mismos identificadores que el historial del servidor.
- Edge en DEV: payroll-receipt-verify v35 (JWT); payroll-capture-file-url v2 (JWT); payroll-notification-dispatcher v1 (autenticación propia mediante el secreto del dispatcher).
- El dispatcher general certificado permanece en v83, sin cambios. El nuevo worker de nómina usa la cola y las funciones existentes de auditoría, éxito y reintento.
- RLS y privilegios verificados después de aplicar: anónimos sin acceso; capturistas sin acceso directo a grants ni al worker; materialización y documentos de correo reservados al servicio.
- Grants y destinataria de Tesorería configurados en DEV mediante coincidencia única de perfiles y membresías existentes. Entrega de correo desactivada en ambas empresas (`dispatch_enabled=false`); no hubo backfill ni envío de correo.
- Suite completa local: 1,092 pruebas aprobadas (un chequeo opcional de artefacto se verifica por separado). Incluye 16 pruebas nuevas de PostgreSQL 17 en memoria, permisos, historial, CORS, importes y notificaciones con transporte simulado.
- Build y TypeScript de la aplicación verificados. Las pruebas locales no equivalen a UAT autenticado contra PostgREST/Storage.

## Pendiente para cerrar el piloto

1. Recorrido autenticado en DEV con los perfiles de captura y Tesorería: cinco originales, confirmación del periodo, registro, confirmación de montos, tres comprobantes y cierre. Las pruebas de pago deben hacerse con una corrida de prueba identificada, sin marcar como pagada una corrida real pendiente.
2. Envío de prueba a un destinatario expresamente autorizado; comprobar un aviso de registro y un aviso final, con sus tres comprobantes. Habilitar la entrega solo después de comprobar el modo/destinatario de prueba y revisar la corrida.
3. Verificar la pantalla y descarga al reabrir Pagada. La revisión automática bloqueó tanto el inicio de sesión con Google como la invocación de prueba del worker de avisos; requieren autorización explícita para continuar esas acciones.
4. Preparar y revisar la liberación de producción. En la revisión inicial, main estaba en #548 y PROD todavía no tenía las tablas/RPC/Edge de nómina; este PR a DEV no habilita por sí solo el uso en producción.

IMSS/ISN, CONTPAQ/provisiones, calendario avanzado y el alcance pendiente de #457 se mantienen fuera de este cierre.

Referencias técnicas: [adjuntos en Resend](https://resend.com/docs/dashboard/emails/attachments) (límite de 40 MB tras codificación) y [claves de idempotencia](https://resend.com/docs/dashboard/emails/idempotency-keys) (24 horas). El worker envía a la cuenta de QA cuando el modo global es test_only y retiene intentos ambiguos mayores de 23 horas para revisión.
