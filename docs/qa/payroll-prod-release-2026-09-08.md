# Salida de Nómina a PROD

Autorización: Ramón pidió promover el flujo validado y conservar las notificaciones. Alcance: el correo enviado a Ara y Yulma, más los ajustes que Ramón confirmó en DEV.

Base de producción: `b998919341b1e337f0cc2a7b7d31b289b4944e7c`. Fuente validada en DEV: `4339b09cec3c5b1f2b906aceb97e25ddd6cac5f7`.

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

Las funciones genéricas de solicitudes permanecen intactas. Solamente se limita la aplicación de los tres triggers de aprobación y correo general para excluir Nómina, con verificación previa de sus definiciones. La cuenta técnica `PAYROLL_NON_BUDGET` mantiene el registro sin consumir presupuesto. La configuración de provisiones queda vacía; no se activa contabilidad, CONTPAQi ni cálculo de sueldos.

## Orden de salida

1. Integrar la interfaz a `main` manteniendo Nómina deshabilitada en ambas empresas; verificar Vercel/runtime de PROD.
2. Verificar respaldo con el workflow protegido desde `main` y revisar el estado de las dos migraciones. No aplicar DDL si falta el respaldo.
3. Aplicar las dos migraciones mediante la herramienta nativa de Supabase, conservando su historial.
4. Desplegar `payroll-materialize`, `payroll-capture-file-url`, `payroll-receipt-verify` y `payroll-notification-dispatcher`.
5. Verificar configuración de envío sin reclamar eventos ni mandar correos de prueba a usuarios finales.
6. Habilitar el módulo y la captura en las empresas autorizadas; configurar Tesorería con los perfiles activos de PROD.
7. Verificar capturas, cierre pagado y notificaciones; registrar el resultado de despliegue.

## Verificación

`npm run qa:setup && npm run test:payroll` ejecuta las pruebas de interfaz, lectura de PDF, entrega de avisos y una prueba aislada de PostgreSQL contra el esquema de PROD. La prueba de base verifica instalación, roles por empresa y el ciclo hasta pagado con dos eventos, sin presupuesto ni aprobaciones semanales.

Estado inicial: preparación. Las migraciones, servicios y habilitación de PROD aún no se han aplicado. La autorización del usuario ya está recibida. Build, preview de Vercel y 28 pruebas locales/CI correctos. La consulta protegida del respaldo se ejecuta desde `main`; nunca recibe credenciales el código del PR.
