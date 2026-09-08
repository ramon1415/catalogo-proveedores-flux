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

Estado de despliegue y comprobaciones productivas: pendiente al preparar este PR.
