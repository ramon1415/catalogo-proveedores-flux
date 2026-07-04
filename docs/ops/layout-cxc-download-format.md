# Formato de descarga CxC BBVA para layouts

Este hotfix ajusta la descarga del layout bancario en `layouts.html` para que el archivo ya no sea `.xlsx` ni TXT delimitado por `|`.

El formato se basa en el archivo real de referencia `PAGOSBBV020726.txt`: TXT de ancho fijo, una linea por pago, 85 caracteres por linea. Los registros se separan con CRLF y el archivo no agrega una linea vacia al inicio ni al final.

## Formato actual

- Extension: `.txt`
- MIME type: `text/plain;charset=utf-8`
- Encoding: UTF-8 sin BOM
- Saltos de linea: CRLF (`\r\n`) solo entre registros; no se agrega CRLF despues del ultimo registro
- Header: no incluido
- Separadores: no usa `|`, comas ni tabs
- Longitud por registro: 85 caracteres exactos
- Nombre de archivo: `PAGOSBBV_CXC_<YYYYMMDD>_<FOLIO>.txt`

## Estructura por linea

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-18 | 18 | Cuenta destino / abono | Solo digitos, ceros a la izquierda, falla si excede 18 |
| 19-36 | 18 | Cuenta origen / cargo | Solo digitos, ceros a la izquierda, falla si excede 18 |
| 37-39 | 3 | Moneda | Valor fijo `MXP` |
| 40-55 | 16 | Importe | Punto decimal, 2 decimales, ceros a la izquierda, falla si excede 16 |
| 56-85 | 30 | Concepto | Mayusculas, sin acentos, `N` en lugar de `Ñ`, espacios a la derecha, truncado controlado a 30 |

## Mapeo desde `payment_layout_lines`

- Cuenta destino / abono: `destination_value`
- Cuenta origen / cargo: `source_account_number`
- Importe: `amount`
- Concepto: `payment_concept`

El archivo real no trae beneficiario ni referencia como campos separados, por eso esos campos no se exportan como columnas independientes.

## Ejemplo

```text
000000000110363553000000000191134094MXP0000000156600.00RENTA JULIO                   
000000000468889147000000000191134094MXP0000000000324.00GALLETAS                     
```

Cada linea mide 85 caracteres antes del salto `\r\n`.

## Validaciones esperadas

- Cada linea mide exactamente 85 caracteres.
- No existe linea vacia inicial ni final.
- No existe BOM al inicio.
- Los registros multiples se separan con CRLF.
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
- Ausencia de BOM, separador `|`, lineas vacias y caracteres invisibles.
- Cuentas origen/destino como 18 digitos sin espacios.
- Moneda fija `MXP`.
- Importe de 16 caracteres con punto decimal y 2 decimales.
- Concepto normalizado a 30 caracteres.

La pantalla tambien muestra una accion `Validar layout` que reporta el largo real y una vista diagnostica enmascarada de la linea 1. Las cuentas se muestran solo con ultimos 4 digitos.

## Causa raiz del hotfix

El formato anterior ya generaba registros de 85 caracteres, pero agregaba un salto CRLF despues del ultimo registro y no tenia una validacion visible previa a la descarga. Si BBVA interpreta ese cierre como linea extra o caracter fuera de layout, puede devolver `El tamaño de la linea 1 del archivo no es correcto`. El generador ahora no agrega linea final vacia y bloquea la descarga si detecta longitud o caracteres inesperados.

## Alcance

El cambio es solo frontend/documentacion. No modifica Supabase, tablas, RLS, RPCs, n8n, secrets ni variables.

## Pendiente

Si Carlos/Ramon/BBVA entregan una especificacion bancaria formal distinta, por ejemplo posiciones adicionales o reglas de layout propietario, este documento y el exportador deben ajustarse en un PR separado con esa evidencia.
