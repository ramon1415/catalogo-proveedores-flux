# Formato de descarga CxC BBVA para layouts

Este hotfix ajusta la descarga del layout bancario en `layouts.html` para que el archivo ya no sea `.xlsx` ni TXT delimitado por `|`.

El formato se basa en el archivo real de referencia `PAGOSBBV020726.txt`: TXT de ancho fijo, una linea por pago, 85 caracteres por linea antes del salto CRLF.

## Formato actual

- Extension: `.txt`
- MIME type: `text/plain;charset=utf-8`
- Encoding: UTF-8 sin BOM
- Saltos de linea: CRLF (`\r\n`)
- Header: no incluido
- Separadores: no usa `|`, comas ni tabs
- Longitud por registro: 85 caracteres antes de `\r\n`
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

En el archivo descargado, el concepto se rellena con espacios a la derecha hasta completar 30 caracteres. Cada linea mide 85 caracteres antes del salto `\r\n`.

## Validaciones esperadas

- Cada linea mide exactamente 85 caracteres.
- El archivo termina cada registro con CRLF.
- No existe el caracter `|`.
- No hay encabezado.
- No se genera `.xlsx`.
- Las cuentas se normalizan a 18 digitos.
- El importe conserva punto decimal y 2 decimales.
- El concepto se normaliza y se rellena a 30 caracteres.

## Alcance

El cambio es solo frontend/documentacion. No modifica Supabase, tablas, RLS, RPCs, n8n, secrets ni variables.

## Pendiente

Si Carlos/Ramon/BBVA entregan una especificacion bancaria formal distinta, por ejemplo posiciones adicionales o reglas de layout propietario, este documento y el exportador deben ajustarse en un PR separado con esa evidencia.
