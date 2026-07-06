# Formato de descarga CxC BBVA para layouts

Este hotfix ajusta la descarga del layout bancario en `layouts.html` para que el archivo ya no sea `.xlsx` ni TXT delimitado por `|`.

La fuente de verdad para este ajuste es el simulador bancario `SIM X.xlsm` y el archivo real aceptado `PAGOSBBV020726.txt`. El libro contiene hojas ocultas/muy ocultas para `Pagos Mismo Banco`, `Pagos Interbancarios`, `Pagos CIE` y `Pagos Mixtos`; las macros generan archivos `.txt` y usan `vbCrLf` como terminador de registro.

Para el flujo actual de Flux, el archivo descargado corresponde al layout fijo de pagos BBVA/CxC: una linea por pago, 85 caracteres utiles por linea y CRLF (`\r\n`) despues de cada registro, incluyendo el ultimo. Ese CRLF final es terminador del ultimo registro, no una linea vacia adicional.

## Formato actual

- Extension: `.txt`
- MIME type: `text/plain;charset=utf-8`
- Encoding: UTF-8 sin BOM
- Saltos de linea: CRLF (`\r\n`) despues de cada registro, incluyendo el ultimo registro
- Header: no incluido
- Separadores: no usa `|`, comas ni tabs
- Longitud por registro: 85 caracteres exactos antes de cada CRLF
- Nombre de archivo: `PAGOSBBV_CXC_<YYYYMMDD>_<FOLIO>.txt`

## Estructura por linea

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-18 | 18 | Cuenta destino / abono | Solo digitos, ceros a la izquierda, falla si excede 18 |
| 19-36 | 18 | Cuenta origen / cargo | Solo digitos, ceros a la izquierda, falla si excede 18 |
| 37-39 | 3 | Moneda | Valor fijo `MXP` |
| 40-55 | 16 | Importe | Punto decimal, 2 decimales, ceros a la izquierda, falla si excede 16 |
| 56-85 | 30 | Concepto | Mayusculas, sin acentos, `N` en lugar de la letra ene con tilde, espacios a la derecha, truncado controlado a 30 |

## Mapeo desde `payment_layout_lines`

- Cuenta destino / abono: `destination_value`
- Cuenta origen / cargo: `source_account_number`
- Importe: `amount`
- Concepto: `payment_concept`

El archivo real no trae beneficiario ni referencia como campos separados, por eso esos campos no se exportan como columnas independientes.

## Ejemplo

```text
000000000110363553000000000191134094MXP0000000156600.00RENTA JULIO                   \r\n
000000000468889147000000000191134094MXP0000000000324.00GALLETAS                      \r\n
```

Cada linea mide 85 caracteres antes del salto `\r\n`. El archivo de referencia con 2 registros pesa 174 bytes: `(85 + 2) * 2`. Un archivo de 1 registro valido pesa 87 bytes: `85 + 2`.

## Validaciones esperadas

- Cada linea mide exactamente 85 caracteres antes del CRLF.
- El archivo termina con exactamente un CRLF despues del ultimo registro.
- No existe linea vacia inicial.
- No existe doble CRLF final.
- No existe BOM al inicio.
- Los registros se separan con CRLF.
- No existe el caracter `|`.
- No hay encabezado.
- No se genera `.xlsx`.
- Las cuentas se normalizan a 18 digitos.
- El importe conserva punto decimal y 2 decimales.
- El concepto se normaliza y se rellena a 30 caracteres.

## Validacion previa de descarga

Antes de descargar, el generador valida localmente:

- Numero de lineas activas.
- Longitud real de cada linea contra 85 caracteres.
- Terminador CRLF final obligatorio.
- Ausencia de BOM, separador `|`, lineas vacias reales y caracteres invisibles.
- Cuentas origen/destino como 18 digitos sin espacios.
- Moneda fija `MXP`.
- Importe de 16 caracteres con punto decimal y 2 decimales.
- Concepto normalizado a 30 caracteres.

La pantalla tambien muestra una accion `Validar layout` que reporta el largo real, el terminador CRLF y una vista diagnostica enmascarada de la linea 1. Las cuentas se muestran solo con ultimos 4 digitos.

## Causa raiz del hotfix

El PR anterior genero registros de 85 caracteres, pero retiro el CRLF final. El simulador `SIM X.xlsm` y el archivo aceptado por operacion muestran que cada registro debe terminar en CRLF, incluyendo el ultimo. BBVA puede rechazar el archivo cuando el cierre fisico no coincide con el terminador esperado del layout.

La correccion conserva los 85 caracteres utiles por registro, elimina BOM/separadores/lineas vacias reales y vuelve a agregar exactamente un CRLF final como terminador del ultimo registro.

## Alcance

El cambio es solo frontend/documentacion. No modifica Supabase, tablas, RLS, RPCs, n8n, secrets ni variables.

## Pendiente

Si Carlos/Ramon/BBVA entregan una especificacion bancaria formal distinta, por ejemplo posiciones adicionales o reglas de layout propietario, este documento y el exportador deben ajustarse en un PR separado con esa evidencia.
