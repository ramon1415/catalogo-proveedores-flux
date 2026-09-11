# Solicitudes por convenio BBVA CIE

En **Solicitudes → Nueva solicitud → Tipo de solicitud → Convenio**, el solicitante elige un proveedor cuyo destino registrado sea Convenio. El número se muestra desde el catálogo; Finanzas mantiene ese dato en Proveedores. Elegir un proveedor CIE desde Pago a proveedor también activa la captura de Convenio.

Cada solicitud guarda su propia referencia / línea de captura y concepto CIE. Son textos separados: conservan los ceros iniciales y no se concatenan ni se recortan. La referencia admite hasta 20 caracteres; el convenio CFE 0578869 requiere exactamente 20 sin espacios. El concepto admite hasta 30 caracteres compatibles con el layout. No se deducen instrucciones de pago a partir de los rótulos de una captura o de un código de barras completo.

El flujo usa MXN y transferencia. El recibo puede adjuntarse con los formatos existentes. Tipo, referencia, concepto y documento se guardan en la misma transacción mediante `create_convenio_payment_request`; siguen vigentes la empresa, el solicitante, las reglas de aprobación y el presupuesto. La captura no programa ni ejecuta un pago. Finanzas completa la cuenta origen y la programación en el flujo habitual; el destino Convenio genera PAGOSCIE.

El detalle muestra los datos CIE. Finanzas puede corregirlos en Editar mientras el pago no esté cerrado o incluido en un layout. Cambiar referencia, concepto, importe o destinatario de una solicitud con layout activo se rechaza para evitar instrucciones distintas entre la solicitud y el archivo generado. No se migran ni se completan automáticamente solicitudes históricas.

## Validación

- Pruebas de interacción de Nueva solicitud y Editar, con Operadora y Fersana, con y sin adjunto.
- PostgreSQL aislado con los cuatro contratos de creación obtenidos de producción; dependencias de presupuesto y selección de aprobadores con datos sintéticos. Verifica creación atómica, documento propio, acceso por empresa, aprobación, validación final y bloqueo tras generar layout/pagar.
- Regresiones de CIE, PAGOSBBV, PAGOSMIX, PAGOSINT y documentos opcionales; build de producción.
- DEV conserva un guard bancario anterior de cinco caracteres y carece del wrapper de documentos de MAIN. Por ello las pruebas de creación se ejecutan contra los contratos de producción en PostgreSQL aislado; no se considera la creación en DEV una prueba superada.

La verificación de software no certifica que el emisor acepte una referencia concreta ni confirma ejecución bancaria. Los datos del recibo y el resultado final deben comprobarse en BBVA.
