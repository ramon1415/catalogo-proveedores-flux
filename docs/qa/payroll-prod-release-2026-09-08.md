# Salida de Nómina a PROD

Autorización: Ramón pidió promover el flujo validado y conservar las notificaciones. Alcance: el correo enviado a Ara y Yulma, más los ajustes que Ramón confirmó en DEV.

Base de producción: `b998919341b1e337f0cc2a7b7d31b289b4944e7c`. Fuente validada en DEV: `4339b09cec3c5b1f2b906aceb97e25ddd6cac5f7`.

Estado al **2026-09-08 07:53 UTC**: backend aplicado y Nómina habilitada en Soporte Fersana y Operadora Tlacatecpan. La interfaz y la base consolidada se integraron mediante [PR #575](https://github.com/ramon1415/catalogo-proveedores-flux/pull/575); [PR #576](https://github.com/ramon1415/catalogo-proveedores-flux/pull/576) corrigió la comprobación protegida del respaldo. La comprobación visual en PROD sigue pendiente porque el navegador automatizado no responde.

| Entrega | Comportamiento |
| --- | --- |
| Captura privada | Nueva captura, cinco archivos Buk, identificación automática, periodo y registro de corrida. |
| Totales y originales | Montos y conteos verificados de los cinco archivos; descarga privada; sin detalle de personas en la interfaz. |
| Tesorería | Confirmación de montos, BBVA/SPEI/TOKA, comprobante PDF y conciliación de cada canal. |
| Avisos del PR #571 | Registro a Tesorería y pago al creador de la captura; plantilla Flux y tres comprobantes verificados. |
| Ajustes de UAT | Scroll interno, presentación de archivos, cancelar selector sin cerrar modal, pago sin Revalidar, lectura automática de importe/fecha/referencia. |
| Corrección para PROD | Usa el rol de Finanzas de cada empresa; no requiere roles globales ni permite pagar en otra empresa. |

## Composición

El historial de DEV contiene migraciones dependientes de objetos que PROD no tiene. Esta salida consolida las definiciones actuales de Nómina en dos migraciones nuevas: primero el valor de enum y después las tablas, funciones, políticas, bucket privado y cron. El manifiesto registra la procedencia y los hashes. No se repara el historial ni se aplican migraciones pendientes ajenas a Nómina.

El resultado funcional de los PR #505, #514, #515, #553, #554, #555, #557, #559, #560, #563, #564, #565, #568, #570, #571, #572, #573 y #574 queda consolidado junto con las fundaciones necesarias del flujo. No corresponde reaplicar esos parches ni las migraciones históricas de DEV por separado. El scroll inicial de #572 fue sustituido por el scroll interno de #571.

Las funciones genéricas de solicitudes permanecen intactas. Solamente se limita la aplicación de los tres triggers de aprobación y correo general para excluir Nómina, con verificación previa de sus definiciones. La partida técnica `PAYROLL_NON_BUDGET` mantiene el registro sin consumir presupuesto. La configuración de provisiones queda vacía; no se activa contabilidad, CONTPAQi ni cálculo de sueldos.

## Liberación aplicada

| Componente | Evidencia |
| --- | --- |
| Respaldo previo | Estado `COMPLETED`, fecha `2026-09-08T04:34:54.076Z`; comprobado a las `07:49:34 UTC` mediante [run 34201136591](https://github.com/ramon1415/catalogo-proveedores-flux/actions/runs/34201136591), job `101979931838`. Proyecto y endpoint de respaldos respondieron HTTP 200 con la referencia PROD correcta. |
| Tipo de solicitud | Migración nativa `20260908075132_payroll_prod_request_type.sql`. |
| Base de Nómina | Migración nativa `20260908075149_payroll_prod_capture_and_notifications.sql`. |
| Servicios | `payroll-materialize`, `payroll-capture-file-url`, `payroll-receipt-verify` y `payroll-notification-dispatcher`, activos en PROD en versión 1. |
| Activación | Módulo habilitado en ambas empresas a las `07:53 UTC`; se conservan versión 1, canal stable y los roles existentes. |
| Captura RH | Ara en ambas empresas; Yulma solamente en Soporte Fersana, conforme a sus membresías activas. |
| Avisos | Registro a Yanin, `ynavarrete@soportef.com`, en ambas empresas. Pago a quien creó la captura. Entrega habilitada en modo `real`, sin configuración de redirección de pruebas. |

Supabase asignó las versiones nativas al aplicar las dos migraciones. Los archivos del repositorio, el generador y la prueba de instalación se alinean con esas versiones, conservando los bytes del SQL; no se vuelve a aplicar SQL ni se repara el historial remoto.

- Enum SHA-256: `cb1a4ff034467a705e11707d47842b39f9dea299c8d78620345abf29715c90ec`.
- Baseline SHA-256: `9922a43a9236b7fd01e0ed07ca67d9002314108a7bb33c59301ff38c684b15e2`.

## Verificación

`npm run qa:setup && npm run test:payroll` ejecuta las pruebas de interfaz, lectura de PDF, entrega de avisos y una prueba aislada de PostgreSQL contra el esquema de PROD. La prueba de base verifica instalación, roles por empresa y el ciclo hasta pagado con dos eventos, sin presupuesto ni aprobaciones semanales.

Build, preview de Vercel y 28 pruebas locales/CI aprobados antes de la liberación. El preflight autenticado del dispatcher de PROD devolvió HTTP 200, `mode=real`, `configured=true` y `sent=0`; esa llamada no reclama eventos ni envía correos.

Después de aplicar la base se verificaron en PROD 25 funciones compartidas con hash idéntico al previo y los diez triggers originales de solicitudes habilitados. Siete permanecen idénticos; tres sólo agregan la exclusión de Nómina para el aviso general y la validación del aprobador. RLS permanece activo en solicitudes, aprobaciones, líneas de layouts y partidas de cortes. Nómina conserva su exclusión del corte semanal; no hay permisos anónimos en sus funciones o tablas y la política restrictiva de Storage está instalada.

Las comprobaciones lógicas posteriores a la activación confirmaron:

- RPC con rol PostgreSQL `authenticated` y contexto de Ara y Yanin: `can_capture=true` y `can_pay=true` en ambas empresas. El contexto de Ara devuelve una cuenta y un centro de costo activos en Soporte Fersana. Es una prueba del contexto de autorización en SQL, no una sesión de navegador.
- Creación y lectura de una captura con Ara aprobadas dentro de una transacción terminada con `ROLLBACK`. Después quedaron cero capturas, solicitudes de Nómina, eventos de Nómina y entradas de provisiones; no se materializó la prueba ni se consumió un folio.
- Preflight del dispatcher, solicitud HTTP `8155`: respuesta 200, `mode=real`, `configured=true`, `sent=0`.
- Despertador del worker, solicitud HTTP `8157`: respuesta 200, `sent=0`, `results=[]`, sin timeout. Las dos últimas ejecuciones de cron consultadas terminaron `succeeded`.
- Yanin permanece configurada como destinataria de registro en ambas empresas, sin redirecciones de pruebas. El aviso de pago conserva como destinatario al creador de la captura.

El ciclo completo de DEV y la prueba aislada hasta pagado no se presentan como una corrida productiva real. No se verificó una entrega real nueva en PROD porque no hay corridas reales registradas. La comprobación visual del módulo y el primer acceso de Yulma continúan pendientes; su perfil no tiene `auth_user_id` y debe enlazarse mediante el mecanismo normal de primer acceso de Flux.
