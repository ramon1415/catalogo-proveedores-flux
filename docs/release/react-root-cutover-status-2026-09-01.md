# Corte de solicitudes y cambio de liga — 1 de septiembre de 2026

| Solicitud del cliente | PR / implementación | Estado actual | Qué falta |
| --- | --- | --- | --- |
| Cambiar entre Operadora y Soporte Fersana según membresía | #475, #476, #477, #467 | ✅ Código en PROD | Completar y probar las membresías de todo el equipo en Soporte PROD; Gerardo (`contabilidad2@soportef.com`) queda pendiente de confirmación operativa. |
| Operadores sólo ven sus propias solicitudes; Finanzas/Dirección ven las de su empresa | #461, #476, #467 | ✅ PROD | Probar una sesión real por cada rol y empresa una vez terminadas las membresías. |
| Roles distintos por empresa | #475, #476, #481, #482 | ✅ Código listo | Terminar la configuración real de usuarios; no se cambiará automáticamente en este corte. |
| Cada usuario sólo ve sus partidas presupuestales | #470, #472, #467 | ✅ PROD, 60/60 | La matriz ya coincide con “Gastos Soporte F”, columna E; falta aceptación final con usuarios reales. |
| Mostrar disponibilidad presupuestal del mes | Funcionalidad base + #470 | ✅ PROD | Ninguno para el modelo mensual actual. |
| Presupuesto anual y menú Reportes | #471, incluido en #467 | ✅ PROD, lectura | No resuelve reglas de vencimiento o arrastre. |
| Definir partidas mensuales, trimestrales, anuales y carryover | Sin PR completo | 🔴 Pendiente funcional | Tati/Finanzas debe entregar la regla por partida; el Excel no contiene esa clasificación. |
| El presupuesto debe descontar subtotal sin IVA | #480, publicado por #491 | ✅ PROD verificado | Ejecutar el soak funcional con una solicitud real controlada; la migración gemela y el frontend ya están en PROD. |
| Autollenado del desglose desde XML CFDI | #480, publicado por #491 | ✅ PROD | Validar con CFDI reales de los formatos habituales del cliente. |
| Bloquear desglose que no cuadre | #480, publicado por #491 | ✅ PROD | Confirmar el mensaje con un caso negativo controlado. |
| El monto solicitado representa el pago neto al banco | Formulario base + #480/#491 | ✅ PROD | Confirmar reglas particulares de retenciones con Finanzas. |
| Documento obligatorio: factura, XML, recibo, contrato, cotización, etc. | #470, incluido en #467 | ✅ PROD | Ninguno. |
| No permitir alta rápida de proveedor desde la solicitud | #470, incluido en #467 | ✅ PROD | Ninguno. |
| Alta de proveedor únicamente desde su módulo | #470 + módulo Proveedores | ✅ Código | Falta la notificación automática a Tesorería. |
| Avisar a Tesorería cuando se crea un proveedor nuevo | Sin PR identificado | 🔴 Pendiente | Diseñar la notificación y confirmar destinatarios. |
| Ocultar “Visita/incidencia” para Soporte Fersana | #469, incluido en #467 | ✅ PROD | Ninguno. |
| Errores visibles sobre el modal y con texto comprensible | #483 + hotfixes posteriores | ✅ Validado en DEV | Portar a PROD sólo dentro de un release autorizado y repetir el caso negativo. |
| Aprobador específico por solicitante | Sistema existente + #465 | 🟡 Parcial | En PROD sólo está confirmada explícitamente la ruta Yanin → César; completar matriz. |
| Estados enviada, aprobada y pagada | Flujo base | ✅ Disponible | Validar con usuarios reales de Soporte. |
| Pagos manuales de SAT/IMSS/ISN con línea de captura | Flujo base permite documento y método “otro” | 🟡 Parcial | Falta campo dedicado de referencia y confirmar exclusión del layout bancario. |
| Referencia específica para impuestos, vales y líneas de captura | Sin PR identificado | 🔴 Pendiente | Crear campo estructurado. |
| Recordatorio para adjuntar factura después del pago cuando inicialmente sólo existe cotización/contrato | Sin PR identificado | 🔴 Pendiente | Crear seguimiento de “factura posterior pendiente”. |
| Si hay presupuesto, omitir eventualmente aprobación final | No implementado; cliente aceptó temporalmente aprobación actual | ⚪ Evolución posterior | Hoy continúa Dirección/corte semanal. |
| Nómina y finiquitos | Flujo separado; finiquitos no definidos | ⚪ Fuera del corte urgente | Revisión posterior. |
| Mantener la liga conocida y poner React en la raíz | Cambio de rutas en PR borrador de este corte | 🟡 Preparado para Preview DEV | Validar `/`, rutas internas, ligas antiguas y sesión; después requiere autorización separada para fusionar a `dev`. |
| Conservar el vanilla como rollback | Build lo publica bajo `/legacy` | 🟡 Preparado para Preview DEV | Probar navegación y APIs desde `/legacy`; no retirar hasta aceptar paridad. |
| Conservar marcadores `/app/*` | Redirect temporal a la misma ruta sin `/app` | 🟡 Preparado para Preview DEV | Probar marcadores existentes; mantenerlos durante la transición. |
| Conservar ligas públicas de proveedor y aprobación rápida | `/solicitar.html` y `/approval_batch_quick_approve.html` permanecen en raíz | ✅ Contrato automatizado | Prueba manual final en Preview antes del merge. |

## Límites de este cambio

- Sólo código y Preview contra `dev`.
- Sin cambios de base de datos, migraciones, permisos o membresías.
- Sin tocar `main` ni PROD.
- El PR queda en borrador hasta recibir autorización explícita para fusionarlo.
