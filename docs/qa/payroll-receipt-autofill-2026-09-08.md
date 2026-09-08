# Precarga de comprobantes de Nómina

Solicitud de Ramón: seleccionar el PDF de cada canal y completar automáticamente importe, fecha de pago y referencia antes de continuar la UAT.

## Comportamiento

- El selector PDF aparece antes de los datos. La lectura se ejecuta localmente con PDF.js, el mismo lector distribuido con Flux.
- Se reconocen importes etiquetados, fechas de pago/aplicación/operación y referencias, folios o claves de rastreo. Se conservan ceros iniciales y centavos exactos.
- El importe esperado del canal y la fecha de hoy nunca sustituyen datos ausentes del documento. Los campos quedan revisables; una fecha inválida o una diferencia de importe bloquea conciliar. Una moneda distinta o ambigua exige otro comprobante.
- Un archivo distinto limpia todos los datos previos del canal. Las lecturas antiguas no pueden sobrescribir el archivo nuevo ni otra corrida; los canales se procesan de forma independiente.
- Seleccionar un archivo no registra pago ni sube documentos. La reserva, carga privada, verificación del servidor y conciliación ocurren únicamente al pulsar el botón existente.
- Se leen todas las páginas, hasta 20; no se extraen sugerencias de un documento truncado. Máximo 10 MiB. Un PDF sin texto, cifrado, ilegible o con datos ambiguos requiere revisión y captura de los campos faltantes. No se implementa OCR de imágenes.

## Verificación

- 11 pruebas funcionales: bytes PDF sintéticos de BBVA/SPEI/TOKA leídos con el PDF.js distribuido; etiquetas en línea y valores separados; fechas inválidas; importes múltiples; centavos; documento inválido o sobre el límite; reemplazos y cambio de corrida; errores de lectura; envío de los datos extraídos al RPC únicamente tras la confirmación; rechazo de importe/moneda distintos.
- 14 comprobaciones existentes de privacidad/conciliación, ámbito de empresa y lector PDF/CSF aprobadas.
- La prueba usa React 18 real con transporte simulado. No equivale a una prueba táctil contra DEV: el navegador compartido continúa bloqueado.

## Paquete QA

Corrida autorizada: SOL-2026-0157, Operadora Tlacatecpan. Importe BBVA $100.00, SPEI $150.00 y TOKA $51.16; fecha de pago de prueba 08/09/2026. Los PDF de prueba se actualizan con una etiqueta explícita de fecha de pago, conservando sus referencias. Los documentos anteriores incluían una fecha UAT y un periodo; ninguna de ellas se infiere como fecha bancaria.

La prueba del pago y correo final sigue pendiente. Esta mejora no cambia esa evidencia ni envía correos.

Referencia del lector: [API oficial PDF.js](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
