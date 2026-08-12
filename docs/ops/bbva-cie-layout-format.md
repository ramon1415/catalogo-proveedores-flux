# BBVA Convenio/CIE — contrato recuperado de macros

Estado: `CIE_SERIALIZER_MATCHES_RECOVERED_VBA_CONTRACT`.

No existe un TXT golden generado con input conocido, por lo que este documento no declara paridad byte-for-byte con una salida real de la macro ni aceptación bancaria. La implementación reproduce el contrato recuperado de dos proyectos VBA independientes.

## Evidencia

| Fuente | SHA-256 workbook | SHA-256 `xl/vbaProject.bin` | Clasificación |
| --- | --- | --- | --- |
| `Qna 15_2026 AFE Macro TOKA.xlsm` | `66F20373CEEA98AEC461FF91526A182C2155BC1435E807FC0F88FC1FF042450D` | `A17B7A7C40A4BE506CBE50889A6E49F708D7813B4C419E4EDEA369550C491960` | `BANK_SIMULATOR_GENERATED_SOURCE` |
| `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm` | `CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556` | `4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD` | `BANK_SIMULATOR_GENERATED_SOURCE` |

Ambos libros contienen la hoja oculta `Pagos CIE` (code name `Hoja6`) con los inputs `CUENTA CARGO`, `CONVENIO CIE`, `REFERENCIA CIE`, `IMPORTE` y `CONCEPTO CIE`. El procedimiento exacto es `Microft_Pag_CIE`, que llama a `GenerateRow`, valida con `ValidateRow` y escribe cada UDT con `Put #1, , lRow` en modo `Binary`.

Los proyectos VBA están protegidos; la revisión fue estática y no ejecutó macros. Los streams MS-OVBA fueron recuperados de copias de análisis y las fuentes originales no se modificaron.

## Paridad entre macros

| Regla | Interbancarias | TOKA | Coinciden |
| --- | --- | --- | --- |
| Orden de campos | concepto, convenio, cargo, importe, concepto, referencia | igual | Sí |
| Anchos | 30, 7, 18, 16, 30, 20 | igual | Sí |
| Cuenta cargo | entrada numérica 9/10; formato 18 con ceros | igual | Sí |
| Convenio | entrada numérica 6/7; formato 7 con ceros | igual | Sí |
| Importe | `0000000000000.00` | igual | Sí |
| Concepto | `UCase(RemoveTrash(...))`, fixed 30, duplicado | igual | Sí |
| Referencia | `UCase(RemoveTrash(...))`, fixed 20 | igual | Sí |
| Padding/truncado | `String * N`: espacios / truncado | igual | Sí |
| Terminador | `vbCrLf` | igual | Sí |
| Escritura | `Open ... For Binary` + `Put` UDT | igual | Sí |
| Header/trailer | ninguno | ninguno | Sí |
| Filename | selector libre `.txt` | igual | Sí |

La única diferencia encontrada en `Hoja6` es el orden de metadatos `Attribute VB_Control`; no cambia procedimientos ni contrato.

## Registro CIE

Longitud útil: 121 bytes ASCII. Longitud física por registro: 123 bytes incluyendo CRLF.

| Posición | Longitud | Campo | Fuente Flux | Padding | Regla |
| --- | ---: | --- | --- | --- | --- |
| 1–30 | 30 | Concepto CIE | `payment_layout_lines.payment_concept` | espacios a derecha | mayúsculas + `RemoveTrash`; truncado |
| 31–37 | 7 | Convenio CIE | `payment_layout_lines.convenio_number` | ceros a izquierda | 6 o 7 dígitos de entrada |
| 38–55 | 18 | Cuenta cargo | `payment_layout_lines.source_account_number` | ceros a izquierda | 9 o 10 dígitos de entrada; se admite snapshot ya normalizado de 18 que represente esa salida |
| 56–71 | 16 | Importe | `payment_layout_lines.amount` | ceros a izquierda | `0000000000000.00`; mayor a cero |
| 72–101 | 30 | Motivo | mismo `payment_concept` | espacios a derecha | duplicación comprobada del concepto |
| 102–121 | 20 | Referencia CIE | `payment_layout_lines.payment_reference` | espacios a derecha | mayúsculas + `RemoveTrash`; truncado |
| 122–123 | 2 | Terminador | serializer | no aplica | CRLF, también en el último registro |

No hay moneda, header, trailer, delimitadores ni tipo de registro en el archivo dedicado `Pagos CIE`.

## Normalización

`RemoveTrash` aplica este mapeo posicional y después `UCase`:

- `áéíóúÁÉÍÓÚ` → `aeiouAEIOU`;
- `ñÑ` → `nN`;
- punto y `!#$%&/()='?¿¡` → espacios.

VBA no contiene una lista general de caracteres permitidos para concepto o referencia. Flux aplica una guarda adicional fail-closed: después del mapeo, el contenido debe quedar en ASCII imprimible y no puede incluir `|`. Esto evita depender de la code page de Windows y garantiza que la serialización UTF-8 del navegador produzca exactamente un byte por carácter, sin BOM. La guarda es de portabilidad interna, no una regla bancaria atribuida a BBVA.

## Encoding físico

El VBA usa strings de ancho fijo dentro de un UDT y `Put` en modo binario. Los elementos se escriben contiguos, sin separadores ni padding adicional entre miembros; el padding pertenece a cada `String * N`. La salida histórica depende de la code page ANSI de VBA para caracteres no ASCII.

Flux limita CIE a ASCII después de la normalización. En ese subconjunto, los bytes ANSI y UTF-8 son idénticos. El `Blob` no agrega BOM. Cada registro termina en `0D 0A`.

## Mapeo y snapshot

| Input de macro | Snapshot Flux |
| --- | --- |
| CUENTA CARGO | `source_account_number` |
| CONVENIO CIE | `convenio_number` |
| REFERENCIA CIE | `payment_reference` |
| IMPORTE | `amount` |
| CONCEPTO CIE | `payment_concept` |

La migration `048` agrega `payment_layout_lines.convenio_number` y lo captura desde `proveedores.convenio_number` al insertar una línea CIE. No hay backfill automático: una línea histórica sin snapshot queda bloqueada. El serializer nunca consulta el proveedor vivo ni extrae dígitos de `destination_value`.

## Routing y aislamiento

- `cuenta` → `PAGOSBBV`;
- `clabe` → `PAGOSINT`;
- `convenio` → `CIE`.

Cada rail se descarga en un archivo separado. CIE no cae en PAGOSBBV/PAGOSINT y los rails existentes no caen en CIE.

Flux usa `PAGOSCIE_FLUX_<FOLIO>_<YYYYMMDD>.txt` como convención operativa propia. El selector VBA únicamente demuestra extensión `.txt`; el nombre de Flux no se presenta como requisito BBVA.

## Límites y siguiente evidencia

- La hoja `Cie` corresponde al catálogo/alta de convenios y queda fuera de scope.
- `Pagos Mixtos` y su prefijo `CIL` se usaron solo como cross-check y quedan fuera de scope.
- No se modifican nómina, TOKA, servicios recurrentes ni doc-extract.
- El convenio actual debe cumplir 6/7 dígitos antes de UAT; la configuración observada en DEV no cumple esa validación.
- Para declarar `CIE_SERIALIZER_BYTE_PARITY_WITH_BBVA_MACRO` se necesita un TXT golden generado por la macro con inputs sintéticos conocidos.
