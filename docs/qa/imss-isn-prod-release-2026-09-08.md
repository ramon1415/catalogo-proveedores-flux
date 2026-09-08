# Liberación IMSS / ISN a producción

Autorización: Ramón validó la UAT de #583 y pidió «pasalo a prod».
Base main: a5391ea614f5946bbc4c04690123b98ac8d840f5. Fuente DEV: ab71a3264fe12ca3367597d1d374a01cca89ad55 (#578, #582, #583).

## Contenido

Captura privada, lectura IMSS y CDMX ISN, borrador, revisión previa, confirmación según capacidad de Finanzas, documentos y comprobante, cierre pagado y avisos con identidad Flux. Conserva el scroll interno y todos los ajustes de UAT. Se mantienen las correcciones específicas de sueldos PROD y el resto de módulos.

Incluye un guard adicional en solicitudes normales para compartir el bloqueo de la línea presupuestal con IMSS/ISN. Solo aplica a partidas de obligaciones habilitadas y a aumentos efectivos del compromiso. No modifica los RPC ni los triggers existentes; respeta reducciones, estados terminales y solicitudes no presupuestales.

## Validación

56 pruebas locales aprobadas, incluyendo instalación de la base de sueldos PROD, ambos ciclos, aislamiento, avisos, UAT y guard de presupuesto. TypeScript/Vite aprobados. CI añade una prueba con PostgreSQL 17 desechable: dos conexiones concurrentes, espera observada y rechazo del segundo compromiso en ambos órdenes. No usa credenciales ni datos productivos.

En DEV, los dos RPCs de inserción normal y envío de obligación también se probaron en rollback; sin registros persistidos ni correos enviados. Los intentos de concurrencia por MCP no se consideran evidencia de solapamiento porque el conector serializa las consultas.

## Configuración productiva y límites

- Operadora carecía de RFC en companies. La declaración enviada por Yanin el 10 de julio de 2026 identifica OPERADORA TLACATECPAN SA DE CV como AFE190704UE0. Se verificó la primera página; no se incorporan originales ni datos personales a Git.
- Esa declaración histórica de ISN corresponde al Estado de México. El lector de esta entrega cubre **CDMX**, tal como la UAT; no se clasifica Edomex como CDMX ni se promete su soporte.
- Fersana conserva borradores; no tiene asignaciones presupuestales para estas obligaciones. No se crean asignaciones, presupuestos ni centros ficticios.
- Aviso de registro: Yanin, según la configuración vigente de Nómina en cada empresa. Aviso de pago: creador. Modo real, ligas https://flux.quantta.mx/nomina y sin desvío a QA.
- PDFs bancarios escaneados requieren captura manual de campos; el lector no inventa datos ausentes. Una transferencia histórica real permite leer fecha y clave de rastreo; el importe ambiguo permanece vacío para revisión.

## Operación

Aplicar únicamente las cuatro migraciones de obligaciones incluidas, en orden, registrar las versiones nativas efectivamente asignadas y desplegar los dos servicios propios. La declaración de autenticación se aplica por servicio en su despliegue (archivos: JWT; worker: secreto propio); se preserva config.toml productivo. Activar por empresa después de comprobar respaldo, pruebas y permisos. No reparar el ledger histórico de DEV/PROD ni aplicar migraciones ajenas.

Backend instalado y habilitado en PROD el 2026-09-08; publicación de interfaz por el merge de #585.

- Respaldo: GitHub run 34201136591, job 102195143778, aprobado y exitoso. Identidad ucantptjhwttexzmslvm verificada a las 19:04:09 UTC; respaldo COMPLETED del 2026-09-08 04:34:54.076 UTC.
- Versiones fuente DEV → ledger PROD: 20260908172940 → 20260908190908; 20260908173408 → 20260908190912; 20260908182623 → 20260908190917; 20260908184710 → 20260908190923. Archivos de esta rama alineados a PROD sin reparar historia ajena.
- Ambos Edge Functions ACTIVE v1. payroll-obligations exige JWT; payroll-obligation-notifications exige secreto privado. Ambas rutas rechazaron peticiones sin credenciales con HTTP 401.
- Worker dry_run vía Vault/pg_net: HTTP 200, mode=real, configured=true, sent=0. Cuatro configuraciones empresa/tipo habilitadas, origin productivo, destinatario de pruebas NULL; Finanzas vigente conserva permiso de pago.
- RFC faltante de Operadora completado con la fuente corporativa verificada. No se modificaron roles, asignaciones ni presupuestos.
- Cuatro tablas con RLS, sin SELECT directo anon/authenticated. Bucket privado con límite de 10 MB.
- Los 1,318 renglones presupuestales conservaron exactamente sus sumas antes/después: presupuesto 16,876,595.76; comprometido 239,023.89; ejercido 219,428.67; disponible 16,637,571.87.
- Smoke SQL productivo en ROLLBACK: ambos tipos recorrieron crear/leer/revisar/enviar/confirmar/pagar, idempotencia del pago y dos eventos de notificación por solicitud. Metadatos sintéticos, sin subir archivos ni persistir solicitudes ni enviar mensajes. No sustituye la UAT visual ya aprobada en DEV.
- 56 pruebas locales nuevamente aprobadas después de alinear las versiones. Concurrencia PostgreSQL 17 previamente aprobada en CI en ambos órdenes; los checks del nuevo head deben aprobar antes del merge.
- Límite pendiente fuera de esta liberación: formato ISN Edomex y asignaciones presupuestales Fersana.
