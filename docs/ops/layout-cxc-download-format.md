# Formatos BBVA de descarga para layouts

Este documento reemplaza la idea de un unico layout CxC. La evidencia operativa muestra al menos dos formatos distintos generados desde el simulador `SIM X.xlsm`:

- `PAGOSBBV`: pagos mismo banco / CxC, 85 caracteres utiles por registro + CRLF.
- `PAGOSINT`: pagos interbancarios, 128 caracteres utiles por registro + CRLF.

El `CRLF` final es terminador del ultimo registro, no una linea vacia adicional. Los archivos no deben llevar BOM, encabezado, pipes, comas ni tabs.

## Evidencia usada

- `SIM X.xlsm`
  - Hoja `Pagos Mismo Banco`: `CUENTA CARGO`, `CUENTA / TARJETA ABONO`, `MONEDA`, `IMPORTE`, `MOTIVO PAGO`.
  - Hoja `Pagos Interbancarios`: `CUENTA CARGO`, `CUENTA CLABE / TARJETA ABONO`, `IMPORTE`, `TITULAR`, `MOTIVO PAGO`, `REF_NUMERICA`.
  - Hoja `Pagos CIE`: existe, pero no se implementa en este hotfix.
  - Hoja `Pagos Mixtos`: existe, pero no se implementa sin confirmacion operativa.
- `PAGOSBBV020726 (2).txt`: 2 registros, 174 bytes, 85 caracteres utiles por registro + CRLF.
- `PAGOSINT180626.txt`: 2 registros, 260 bytes, 128 caracteres utiles por registro + CRLF.

## Matriz de formatos

| Formato | Archivo ejemplo | Longitud util | Terminador | Uso esperado |
| --- | --- | ---: | --- | --- |
| `PAGOSBBV` | `PAGOSBBV020726` | 85 | CRLF por registro | Cuenta/tarjeta BBVA compatible, mismo banco |
| `PAGOSINT` | `PAGOSINT180626` | 128 | CRLF por registro | CLABE/interbancario/TDC cuando aplique |

## PAGOSBBV / mismo banco / 85 caracteres

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-18 | 18 | Cuenta/tarjeta abono BBVA | Solo digitos, ceros a la izquierda |
| 19-36 | 18 | Cuenta cargo | Solo digitos, ceros a la izquierda |
| 37-39 | 3 | Moneda | `MXP` |
| 40-55 | 16 | Importe | 13 digitos, punto decimal, 2 decimales |
| 56-85 | 30 | Motivo/concepto de pago | Mayusculas, sin acentos, espacios a la derecha |
| 86-87 | 2 | Terminador fisico | `CRLF` |

Ejemplo:

```text
000000000110363553000000000191134094MXP0000000156600.00RENTA JULIO                   \r\n
```

## PAGOSINT / interbancario / 128 caracteres

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-18 | 18 | CLABE/tarjeta/cuenta destino interbancaria | Solo digitos |
| 19-36 | 18 | Cuenta cargo | Solo digitos, ceros a la izquierda |
| 37-39 | 3 | Moneda | `MXP` |
| 40-55 | 16 | Importe | 13 digitos, punto decimal, 2 decimales |
| 56-85 | 30 | Titular / beneficiario | Mayusculas, sin acentos, espacios a la derecha |
| 86-90 | 5 | Referencia numerica | Captura de 1 a 5 digitos; el TXT completa con ceros a la izquierda |
| 91-127 | 37 | Motivo de pago | Mayusculas, sin acentos, espacios a la derecha |
| 128 | 1 | Indicador | `H` segun ejemplo recibido |
| 129-130 | 2 | Terminador fisico | `CRLF` |

Ejemplo:

```text
002180700287444966000000000191134094MXP0000000000806.00CLAUDIA YANIN NAVARRETE       40002REEMBOLSO                            H\r\n
```

## Seleccion de formato en Flux

El hotfix no mezcla registros de 85 y 128 en un mismo archivo.

- `destination_type = cuenta` -> `PAGOSBBV`.
- `destination_type = clabe` -> `PAGOSINT`.
- `destination_type = convenio` -> bloqueado para estos formatos; requiere CIE.
- Tipo desconocido -> bloqueado y requiere correccion del proveedor.

Si un layout contiene ambos formatos, el sistema descarga archivos separados:

- `PAGOSBBV_FLUX_<FOLIO>_<YYYYMMDD>.txt`
- `PAGOSINT_FLUX_<FOLIO>_<YYYYMMDD>.txt`

La convencion deja el tipo de layout al inicio (`PAGOSBBV` o `PAGOSINT`), conserva el folio operativo del layout y cierra con fecha de generacion `YYYYMMDD` para facilitar busqueda, conciliacion y soporte con el banco.

## Referencia PAGOSINT en layouts ya generados

Si una linea `PAGOSINT` ya generada no tiene referencia numerica, la descarga queda bloqueada. Desde la pantalla de Layouts se debe abrir la linea y usar `Completar referencia` para guardar el dato en `payment_layout_lines.payment_reference`.

La captura permite de 1 a 5 digitos. El archivo siempre conserva 5 posiciones en el registro:

- `7` -> `00007`
- `42` -> `00042`
- `40002` -> `40002`

La accion no aplica a `PAGOSBBV` porque el formato de 85 caracteres no usa este campo.

## Validaciones locales

Para ambos formatos:

- Sin BOM.
- Sin `|`.
- Sin encabezado.
- Sin doble CRLF final.
- Sin linea vacia real inicial/final.
- CRLF obligatorio despues de cada registro, incluyendo el ultimo.
- Campos numericos sin espacios ni guiones.
- Importe con punto decimal y 2 decimales.

Validaciones adicionales:

- `PAGOSBBV`: 85 caracteres utiles por registro.
- `PAGOSINT`: 128 caracteres utiles por registro, titular 30, referencia numerica de 5 posiciones en archivo, motivo 37, indicador final `H`.
- `PAGOSINT`: la referencia capturada no tiene que ser exactamente de 5 digitos; si operacion captura `7`, `42` o `40002`, el archivo sale como `00007`, `00042` o `40002` para conservar las posiciones 86-90.

## Riesgos / pendientes

- El indicador final `H` de `PAGOSINT` se toma del ejemplo recibido; si BBVA entrega catalogo formal, validar su significado.
- Si hay pagos por convenio, debe implementarse o habilitarse layout `CIE` en otro PR.
- Si operacion requiere lote mixto en un solo archivo, debe validarse contra la hoja `Pagos Mixtos` antes de implementarlo.
- Si una TDC debe ir por mismo banco y no por interbancario, hay que capturar ese tipo de destino de forma explicita; hoy Flux solo distingue `cuenta`, `clabe` y `convenio`.

## Alcance

Cambio solo frontend/documentacion. No modifica Supabase, tablas, RLS, RPCs, migraciones, n8n, secrets ni variables.
