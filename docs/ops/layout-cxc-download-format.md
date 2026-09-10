# Formatos BBVA de descarga para layouts

Este documento reemplaza la idea de un unico layout CxC. La evidencia operativa muestra al menos dos formatos distintos generados desde el simulador `SIM X.xlsm`:

- `PAGOSBBV`: pagos mismo banco por número de cuenta, 85 caracteres utiles por registro + CRLF.
- `PAGOSMIX`: registro mixto `PTC` para CLABE BBVA `012`, 88 caracteres utiles por registro + CRLF.
- `PAGOSINT`: pagos interbancarios, 128 caracteres utiles por registro + CRLF.

El `CRLF` final es terminador del ultimo registro, no una linea vacia adicional. Los archivos no deben llevar BOM, encabezado, pipes, comas ni tabs.

## Evidencia usada

- `SIM X.xlsm`
  - Hoja `Pagos Mismo Banco`: `CUENTA CARGO`, `CUENTA / TARJETA ABONO`, `MONEDA`, `IMPORTE`, `MOTIVO PAGO`.
  - Hoja `Pagos Interbancarios`: `CUENTA CARGO`, `CUENTA CLABE / TARJETA ABONO`, `IMPORTE`, `TITULAR`, `MOTIVO PAGO`, `REF_NUMERICA`.
  - Hoja `Pagos CIE`: existe, pero no se implementa en este hotfix.
  - Hoja `Pagos Mixtos`: contrato recuperado directamente de `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm` (SHA-256 `CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556`) y su `vbaProject.bin` (SHA-256 `4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD`).
- `PAGOSBBV020726 (2).txt`: 2 registros, 174 bytes, 85 caracteres utiles por registro + CRLF.
- `PAGOSINT180626.txt`: 2 registros, 260 bytes, 128 caracteres utiles por registro + CRLF.

## Matriz de formatos

| Formato | Archivo ejemplo | Longitud util | Terminador | Uso esperado |
| --- | --- | ---: | --- | --- |
| `PAGOSBBV` | `PAGOSBBV020726` | 85 | CRLF por registro | Número de cuenta BBVA, mismo banco |
| `PAGOSMIX` | VBA `Pagos Mixtos` / registro `PTC` | 88 | CRLF por registro | CLABE BBVA de 18 dígitos con prefijo `012` |
| `PAGOSINT` | `PAGOSINT180626` | 128 | CRLF por registro | CLABE de banco externo/TDC cuando aplique |

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

## PAGOSMIX / Pagos Mixtos / registro PTC / 88 caracteres

El procedimiento `Microft_Mixtos` de la hoja VBA `Hoja8` asigna `PTC` cuando el tipo de operación es `Mismo Banco`. El UDT `uExpTrasBmerMix` define el registro exacto:

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-3 | 3 | Tipo de operación | `PTC` |
| 4-21 | 18 | Cuenta/CLABE de abono | Para este routing: CLABE BBVA completa con prefijo `012` |
| 22-39 | 18 | Cuenta cargo | Número de cuenta origen con ceros a la izquierda |
| 40-42 | 3 | Divisa | `MXP` |
| 43-58 | 16 | Importe | `0000000000000.00` |
| 59-88 | 30 | Motivo | Mayúsculas, normalizado y rellenado con espacios |
| 89-90 | 2 | Terminador físico | `CRLF` |

Ejemplo sintético:

```text
PTC012914000000000007000000000191134094MXP0000000000100.00PRUEBA CLABE BBVA            \r\n
```

La macro permite que el campo de abono ocupe 18 posiciones. Flux usa este rail únicamente cuando `destination_type = clabe` y la CLABE comienza con `012`; no intenta recortar ni deducir una cuenta BBVA de 10 dígitos.

## PAGOSINT / interbancario / 128 caracteres

| Posicion | Longitud | Campo | Regla |
| --- | ---: | --- | --- |
| 1-18 | 18 | CLABE/tarjeta/cuenta destino interbancaria | Solo digitos |
| 19-36 | 18 | Cuenta cargo | Solo digitos, ceros a la izquierda |
| 37-39 | 3 | Moneda | `MXP` |
| 40-55 | 16 | Importe | 13 digitos, punto decimal, 2 decimales |
| 56-85 | 30 | Titular / beneficiario | Mayusculas, sin acentos, espacios a la derecha |
| 86-90 | 5 | Tipo de cuenta y banco | `40` + código de banco de 3 dígitos tomado de las primeras 3 posiciones de la CLABE (`002` → `40002`) |
| 91-120 | 30 | Motivo de pago | Mayusculas, sin acentos, espacios a la derecha; truncado a 30 |
| 121-127 | 7 | Referencia numerica | `payment_reference`, completada con ceros a la izquierda |
| 128 | 1 | Disponibilidad | `H`, como establece `Hoja5.GenerateRow` |
| 129-130 | 2 | Terminador fisico | `CRLF` |

Ejemplo:

```text
002180000000000001000000000123456789MXP0000000000100.00BENEFICIARIO DE PRUEBA        40002REEMBOLSO                     0000042H\r\n
```

## Seleccion de formato en Flux

El hotfix no mezcla registros de 85 y 128 en un mismo archivo.

- `destination_type = cuenta` -> `PAGOSBBV`.
- `destination_type = clabe` con código bancario `012` -> `PAGOSMIX`, registro `PTC`.
- `destination_type = clabe` con cualquier otro código bancario -> `PAGOSINT`.
- Solo las líneas con estado `included` se vuelven a descargar; una línea `paid` nunca se reemite en un archivo accionable.
- `destination_type = convenio` -> bloqueado para estos formatos; requiere CIE.
- Tipo desconocido -> bloqueado y requiere correccion del proveedor.

Si un layout contiene ambos formatos, el sistema descarga archivos separados:

- `PAGOSBBV_FLUX_<FOLIO>_<YYYYMMDD>.txt`
- `PAGOSMIX_FLUX_<FOLIO>_<YYYYMMDD>.txt`
- `PAGOSINT_FLUX_<FOLIO>_<YYYYMMDD>.txt`

La convencion deja el tipo de layout al inicio (`PAGOSBBV`, `PAGOSMIX` o `PAGOSINT`), conserva el folio operativo del layout y cierra con fecha de generacion `YYYYMMDD` para facilitar busqueda, conciliacion y soporte con el banco.

## Campo banco PAGOSINT

Las posiciones 86-90 **no son una referencia capturada por el usuario**. Los archivos históricos aceptados por BBVA muestran el contrato:

- tipo de cuenta: `40`;
- código de banco: primeras 3 posiciones de la CLABE;
- ejemplos: CLABE `002...` → `40002`, CLABE `014...` → `40014`.

Flux deriva este campo automáticamente al descargar el archivo. `payment_reference` no se serializa en ese bloque: ocupa las posiciones **121-127**, después de los 30 caracteres de motivo.

Una CLABE `012` pertenece a BBVA y se genera en `PAGOSMIX` con tipo `PTC`, no en `PAGOSINT` ni en el archivo corto `PAGOSBBV`.

## Referencia numerica PAGOSINT: corrección del 10 de septiembre de 2026

El contrato anterior unía por error motivo y referencia en un campo de 37 caracteres. Los conceptos cortos dejaban espacios en el campo numérico y ocultaban el defecto. Con un motivo largo, las posiciones 121-127 contenían letras y Net Cash rechazaba el registro por referencia numérica inválida.

La recuperación estática de `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm` confirma:

- Workbook SHA-256: `CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556`.
- `xl/vbaProject.bin` SHA-256: `4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD`.
- `Módulo1.uExpPagInter`: `u8_Ref_Pago As String * 30`, seguido de `u9_Ref_Num As String * 7`.
- `Hoja5.GenerateRow`: `u9_Ref_Num = Format(Hoja5.Cells(lFila, 6).Value, "0000000")`.
- `u10_Disp = "H"` y `u11_CRLF = vbCrLf`.

No se ejecutó la macro. Los anchos y el formato numérico se verificaron sobre su código recuperado. La captura de Flux mantiene el límite vigente de 1 a 5 dígitos para conservar el contrato del RPC. El exportador completa esa referencia a 7 dígitos, sin inventarla ni extraerla del concepto. Una referencia vacía o con letras bloquea la descarga.

El concepto completo permanece en la solicitud. Solo su representación en el TXT se limita a 30 caracteres. No cambian cuentas, beneficiarios, importes, moneda, separación por destino ni estados de pago.

## Importación en Net Cash

| Archivo de Flux | Importación correspondiente |
| --- | --- |
| `PAGOSBBV` | Pagos mismo banco, sin marcar Lote mixto |
| `PAGOSINT` | Pagos interbancarios, sin marcar Lote mixto |
| `PAGOSMIX` | Lote mixto, registros con prefijo `PTC` |
| `PAGOSCIE` | Pagos CIE, archivo dedicado |

Que la cuenta de cargo sea BBVA no convierte un archivo interbancario en mixto. La clasificación depende del destino. Si un lote de Flux tiene destinos BBVA y externos, se descargan y se importan los archivos separados correspondientes.

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
- `PAGOSMIX`: 88 caracteres utiles por registro, prefijo `PTC`, CLABE BBVA `012` completa y CRLF final.
- `PAGOSINT`: 128 caracteres utiles por registro, titular 30, tipo de cuenta y banco de 5 posiciones, motivo 30, referencia numerica 7 e indicador final `H`.
- `PAGOSINT`: el campo banco debe coincidir con `40` + las primeras 3 posiciones de la CLABE; no se toma de `payment_reference`.
- `PAGOSINT`: la referencia de las posiciones 121-127 debe contener exactamente 7 dígitos. El validador identifica la línea y el campo que fallan.

## Riesgos / pendientes

- La corrección de PAGOSINT reproduce el contrato recuperado de la macro. La aceptación del archivo corregido en Net Cash se confirma con la siguiente importación bancaria del usuario; una prueba local no acredita ejecución de pagos.
- `PAGOSMIX` reproduce el registro `PTC` recuperado de la macro. La aceptación bancaria final se confirma con el primer upload real usando la opción **Lote mixto** de Net Cash.
- Si una TDC debe ir por mismo banco y no por interbancario, hay que capturar ese tipo de destino de forma explicita; hoy Flux solo distingue `cuenta`, `clabe` y `convenio`.

## Alcance

Cambio solo frontend/documentacion. No modifica Supabase, tablas, RLS, RPCs, migraciones, n8n, secrets ni variables.
