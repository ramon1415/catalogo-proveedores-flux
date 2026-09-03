# BBVA Pagos Mixtos — CLABE BBVA 012 mediante registro PTC

Estado: `PAGOSMIX_PTC_MATCHES_RECOVERED_VBA_CONTRACT`.

## Fuente física

- Workbook: `Qna 15_2026 AFE Macro Cuentas interbancarias.xlsm`.
- SHA-256 workbook: `CC5B4376A2BD7C9B8E1DE02B29CAFBF186E03D371BC0B9CE7364BC4DA26DF556`.
- SHA-256 `xl/vbaProject.bin`: `4785E40BC10DAC3AF4698D2F29FE1FCC72BB037CEA0FD8A93F16FA6C02945DCD`.
- Hoja visible/oculta usada: `Pagos Mixtos` (`Hoja8`).
- Procedimiento: `Microft_Mixtos`.
- Tipo VBA: `uExpTrasBmerMix`.

La revisión fue estática; no se ejecutaron macros ni se modificó el workbook.

## Routing solicitado

| Dato de destino | Rail Flux |
| --- | --- |
| Número de cuenta BBVA | `PAGOSBBV` |
| CLABE BBVA de 18 dígitos con código `012` | `PAGOSMIX` / `PTC` |
| CLABE de banco externo | `PAGOSINT` |
| Convenio | `CIE` |

El código bancario se obtiene de la propia CLABE; no se consulta ni transforma el proveedor vivo al descargar un layout ya creado.

## Registro PTC

Longitud útil: 88 bytes ASCII. Longitud física: 90 bytes con CRLF.

| Campo | Ancho | Valor |
| --- | ---: | --- |
| Tipo de operación | 3 | `PTC` |
| Cuenta/CLABE de abono | 18 | CLABE `012...` completa |
| Cuenta cargo | 18 | Cuenta origen, cero-padding |
| Divisa | 3 | `MXP` |
| Importe | 16 | `0000000000000.00` |
| Motivo | 30 | mayúsculas, ancho fijo |
| Terminador | 2 | CRLF |

La secuencia coincide con `GenerateRow` de `Hoja8`: `TipOper`, abono, cargo, divisa, importe, motivo y CRLF. Para `Mismo Banco`, `Microft_Mixtos` asigna `TipOper = "PTC"`.

## Seguridad operativa

- Sólo se serializan líneas con estado `included`.
- Una línea `paid`, `bank_rejected` o `cancelled` permanece en el historial pero no vuelve a un archivo accionable.
- Una CLABE `012` no puede caer en `PAGOSINT`.
- `PAGOSMIX` exige exactamente 18 dígitos y prefijo `012`; no recorta la CLABE a 10 dígitos.
- El archivo no lleva BOM, encabezado, trailer, pipes, comas ni tabs.
- Cada registro termina en CRLF, incluido el último.

## Operación en BBVA Net Cash

El archivo debe importarse usando **Lote mixto**. La primera aceptación bancaria real sigue siendo el gate operativo definitivo; el serializer declara paridad con la macro recuperada, no una aceptación bancaria inventada.
