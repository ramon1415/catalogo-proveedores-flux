# Nómina N2A-R2: incorporación de XLSM físicos y certificación de formatos

Fecha de corte: 2026-08-16. Este reporte no contiene valores de empleados, cuentas, CLABE, RFC, CURP, NSS ni sueldos. Los archivos físicos permanecen fuera del repositorio.

## R2 gate summary

La evidencia se mantiene separada en tres capas que no son intercambiables:

| Capa | Evidencia R2 | Resultado |
| --- | --- | --- |
| `INPUT_PHYSICAL` | dos XLSM reales y byte-identificados de la corrida | SPEI input y transferencia agregada TOKA certificados |
| `GENERATOR_SOURCE` | OOXML y VBA extraídos estáticamente, sin ejecutar macros | contratos históricos recuperados; no equivalen a aceptación bancaria |
| `OUTPUT_PHYSICAL` | `PAGOSINT180626.txt` histórico; ningún TXT payroll mismo banco de esta corrida | SPEI converge; mismo banco payroll sigue sin salida física atribuible |

Los archivos `(1)` son copias byte-for-byte de los XLSM ya identificados; el sufijo no crea una fuente independiente. Su disponibilidad física sí permite cerrar el gate de **input**, sin promoverlos a TXT, carátula o XML.

### Workbook facts revalidados

| Evidence ID | SHA-256 | Bytes | Hojas | Filas útiles | Clasificación |
| --- | --- | ---: | ---: | ---: | --- |
| `INTERBANK_PAYROLL_XLSM_INPUT` | `cc5b4376a2bd7c9b8e1de02b29cafbf186e03d371bc0b9ce7364bc4da26df556` | 2,747,218 | 53 | 5 en `Pagos Interbancarios` | `SOURCE_PHYSICAL_SUPPORTING` |
| `TOKA_XLSM_INPUT` | `66f20373ceea98aec461ff91526a182c2155bc1435e807fc0f88fc1ff042450d` | 2,698,369 | 53 | 1 agregada en `Pagos Interbancarios` | `SOURCE_PHYSICAL_SUPPORTING` |

En ambos libros sólo `Pagos Interbancarios` está visible; las otras 52 hojas están ocultas e incluyen `Pagos Mismo Banco`, `Pagos CIE`, `Pagos Mixtos`, `Nomina`, `Nomina 108`, `Nomina TR` y `Nomina 232`. Ambos contienen `xl/vbaProject.bin`. El análisis fue exclusivamente estático: macros, ActiveX y acceso de red ejecutados = 0.

### Provenance de carátula a SPEI

El vínculo externo del XLSM interbancario apunta, sin inferencia, a:

`1. Papel de trabajo/OPERADORA TLACATECPAN - Reporte de nómina periodo 15.xlsx`

La hoja origen es `OPERADORA TLACATECPAN`. Las fórmulas demuestran este mapeo, sin revelar valores:

| Target `Pagos Interbancarios` | Source carátula |
| --- | --- |
| `C6` | `AD18` |
| `C7` | `AD11` |
| `C8` | `AD19` |
| `C9` | `AD14` |
| `C10` | `AD9` |

La columna target `C` es `IMPORTE`. El cache externo sólo conserva esas cinco celdas; no conserva headers ni el resto de la carátula, por lo que no prueba qué semántica tiene la columna `AD` ni permite construir el adapter XLSX.

### Same-bank generator vs. payroll output

`Hoja4` y el UDT `uExpTrasBmer` prueban un generador histórico genérico `Pagos Mismo Banco`:

| Orden | Campo | Ancho |
| --- | --- | ---: |
| 1 | cuenta abono/destino, zero-padded | 18 |
| 2 | cuenta cargo/origen, zero-padded | 18 |
| 3 | divisa `MXP`/`USD`/`EUR` | 3 |
| 4 | importe `0000000000000.00` | 16 |
| 5 | motivo en mayúsculas, normalizado y padded | 30 |
| 6 | `vbCrLf` | 2 |

La rutina abre en modo `Binary`, construye un UDT por fila y lo escribe con `Put`: 85 bytes útiles + CRLF = 87 bytes físicos. Esto permite declarar `BBVA_SAME_BANK_GENERATOR = GENERATOR_CONTRACT_CERTIFIED`, limitado a `GENERATOR_SOURCE`/`HISTORICAL_IMPLEMENTATION`.

No prueba que ése sea el rail payroll que el spec describe, ni sustituye un TXT de la corrida o una aceptación bancaria. `Pagos Mismo Banco` tiene 0 operaciones en ambos XLSM y coexiste con `Nomina 108`, `Nomina TR` y `Nomina 232`. En todos los componentes OOXML y módulos VBA descomprimidos de ambos libros, `001001` tuvo **0 ocurrencias**. Por tanto `BBVA_SAME_BANK_TXT = PARTIAL_CONTRACT_ONLY` y el adapter payroll permanece fail-closed.

### TOKA: transferencia vs. desglose por persona

- `TOKA_AGGREGATE_TRANSFER = CERTIFIED_FROM_PHYSICAL_INPUT`: una fila/un monto agregado; nunca una transferencia por empleado.
- `TOKA_XML = MISSING_PHYSICAL_SOURCE`: el XLSM no contiene `customXml`, XML embebido, vínculo externo o generador de CFDI/XML.

Se documentan las dos decisiones posibles, sin cambiar el contrato silenciosamente:

- **Opción A:** carátula canónica para `vouchers_amount` por persona; XML TOKA como evidencia/conciliación posterior. Sólo es válida si la carátula física demuestra columnas determinísticas de vales.
- **Opción B:** carátula + XML TOKA como fuentes obligatorias de cross-check. Es la opción vigente en N0/N1: el parser conserva `coverVouchersAmountMinor`, carga vouchers por RFC/CURP y bloquea discrepancias.

Recomendación R2: mantener **Opción B** para validación completa hasta recuperar la carátula y probar A. El XML no bloquea empezar la interfaz de captura, pero una corrida con vales no puede habilitar `Enviar a aprobación` bajo el contrato actual sin desglose determinístico y conciliado.

### N2B decision

`CAN_N2B_CAPTURE_UI_START = YES`, únicamente por etapas y fail-closed:

| Componente | Estado | Gate N2B |
| --- | --- | --- |
| metadata + selección local de uploads | diseño puede iniciar | no persistir solicitud/archivos antes de validación sin una decisión explícita de draft |
| cover sheet parser | `MISSING_PHYSICAL_SOURCE` | archivo puede seleccionarse; parse/submit bloqueados |
| same-bank parser | generator conocido, payroll output no probado | archivo puede seleccionarse; parse/submit bloqueados |
| SPEI parser | certificado | puede integrarse |
| TOKA aggregate transfer | certificado | canal agregado puede modelarse |
| TOKA employee breakdown | no probado físicamente | submit bloqueado cuando existan vales |

El schema admite `parsing_status='pending'`, pero `payroll_run_files.payment_request_id` es obligatorio y N0 dispone crear la solicitud después de validar fuentes. Por eso N2B puede iniciar UI, selección local y SPEI; persistir uploads prevalidación requiere una decisión arquitectónica separada. `Enviar a aprobación` debe permanecer bloqueado hasta que toda la corrida sea válida.

## A. DEV baseline

- Repositorio: `ramon1415/catalogo-proveedores-flux`.
- Base de la rama N2A: `origin/dev` en `8860baab576af24620167cb59fec0d8f8e5ddf4a`.
- Ese SHA incluye el merge de PR #361 y la corrección forward-only N1 `20260814183429_fix_payroll_request_total_trigger.sql`.
- Rama de trabajo: `feature/ramon-payroll-n2a-source-recovery`.
- No se consultó ni modificó PROD.
- No hubo escrituras en Supabase DEV, DDL nuevo, migrations, cambios UI ni despliegues manuales.

## B. Search coverage

La recuperación fue exhaustiva y read-only antes de solicitar archivos:

- repo actual, `docs/`, `scripts/qa/fixtures`, carpetas de evidencia y 2 worktrees;
- 258 refs remotos de `origin`, incluyendo ramas vivas e históricas;
- 361 refs de heads de PR y metadatos de los 361 PR históricos;
- commits, paths y blobs de todos esos refs;
- `git fsck`: un blob inaccesible recuperable, identificado como documentación N0, no como fuente física;
- 258 artifacts de GitHub Actions por nombre, branch y metadatos, sin artifact físico de nómina;
- rutas locales autorizadas ya montadas: Downloads, workspace/OneDrive y adjuntos de Codex;
- File Library/adjuntos previos accesibles: sólo prompts pegados, sin binarios;
- ZIPs y carpetas relacionadas con el caso documentado;
- búsqueda exacta del caso `fwdnom15_2026operadoratlacatecpan` y sus variantes;
- búsqueda exacta posterior del nombre de carátula recuperado desde el vínculo externo del XLSM.

Términos: `fwdnom15_2026operadoratlacatecpan`, `fwdnom15`, `nom15`, `nomina`, `nómina`, `payroll`, `Operadora Tlacatecpan`, `caratula`, `carátula`, `layout nomina`, `layout nómina`, `mismo banco`, `001001`, `PAGOSINT180626.txt`, `PAGOSINT`, `SPEI`, `interbancario`, `Cuentas interbancarias`, `TOKA`, `vales`, `CFDI vales`, `CFDI TOKA`, y extensiones XLSX/XLSM/TXT/XML/PDF/ZIP.

Resultado negativo demostrado: no se encontró el paquete/carpeta `fwdnom15_2026operadoratlacatecpan`, una carátula XLSX física, un TXT físico de Nómina mismo banco ni un XML TOKA. La búsqueda no se detuvo al encontrar referencias narrativas.

Rescan R2 del 2026-08-16: `SEARCHED_LOCATIONS = Downloads y hermanos; OneDrive/workspace; Documents; worktrees/evidence; adjuntos/File Library local accesible; todos los objetos de refs Git ya recuperados; metadatos de 258 artifacts de GitHub Actions`. Desktop no existe como ubicación separada en este perfil. `FOUND cover/TXT/XML = NO`; los 258 artifacts tuvieron 0 nombres relacionados. No apareció candidato nuevo en ZIP/7z.

## C. Files found

| Logical source | SHA-256 | Bytes | Clasificación | Utilidad probada |
| --- | --- | ---: | --- | --- |
| `Qna 15_2026 AFE Macro Cuentas interbancarias (1).xlsm` | `cc5b4376a2bd7c9b8e1de02b29cafbf186e03d371bc0b9ce7364bc4da26df556` | 2,747,218 | `SOURCE_PHYSICAL_SUPPORTING` | `INPUT_PHYSICAL` real de la corrida, 5 renglones en `Pagos Interbancarios`, vínculo externo, VBA y UDT recuperables |
| `Qna 15_2026 AFE Macro TOKA (1).xlsm` | `66f20373ceea98aec461ff91526a182c2155bc1435e807fc0f88fc1ff042450d` | 2,698,369 | `SOURCE_PHYSICAL_SUPPORTING` | `INPUT_PHYSICAL` con una transferencia agregada; no contiene XML TOKA |
| `PAGOSINT180626.txt` | `7be47fea70730bc8cdfca9a70548d857d76bf94baabd924c35eb6053f3b23851` | 260 | `HISTORICAL_RELATED_FORMAT` | Dos registros físicos que convergen exactamente con el UDT/VBA interbancario |
| `PAGOSBBV020726.txt` | `13e3f73f04c69a533a93ea655fb4bd2bf3ba8a1f31fd2f7d312bab59008829e9` | 174 | `HISTORICAL_RELATED_FORMAT` | Formato genérico BBVA de 85+CRLF; no es el layout Nómina 108/232 |
| `SIM X.xlsm` | `a676ce4fd28d86e4e6f8d9de804fc55c4c4b855275eac2efe20b1af0cfe3247d` | 2,788,687 | `SIMULATOR_SOURCE_ONLY` | Confirma la familia del simulador; no es una salida de la corrida de nómina |
| `spec_solicitud_nomina.md` | `c18796c80ad446ee6cab98e6f6e848f6d908dd705a431779d6af2f46dabe16db` | 13,726 | `DOCUMENTATION_ONLY` | Intención funcional y consistency checks; no certifica bytes |

Las copias con nombre URL-encoded y sufijos `(1)`/`(2)` son duplicados byte-for-byte de los hashes anteriores; se deduplicaron en el manifest. Ningún archivo real fue copiado al repo.

## D. Carátula XLSX

El vínculo externo del workbook interbancario recupera el nombre físico esperado:

`OPERADORA TLACATECPAN - Reporte de nómina periodo 15.xlsx`

La ruta relativa codificada en OOXML corresponde a `1. Papel de trabajo/OPERADORA TLACATECPAN - Reporte de nómina periodo 15.xlsx`; no es un nombre inferido.

El vínculo confirma la hoja externa `OPERADORA TLACATECPAN`. Su cache sólo conserva 5 celdas numéricas (`AD9`, `AD11`, `AD14`, `AD18`, `AD19`), sin headers ni filas suficientes para reconstruir el schema. El nombre exacto se buscó en Downloads, workspace/OneDrive, Desktop, Documents y adjuntos; el XLSX no está disponible.

- Physical source found: **NO**.
- Contract status: `MISSING_PHYSICAL_SOURCE`.
- Adapter status: `parsePayrollCoverSheet` sigue fail-closed.
- No se infirieron headers, offsets ni totales desde las cinco celdas cacheadas.

## E. BBVA same bank

No se encontró un TXT físico de Nómina mismo banco. El XLSM sí permite recuperar contratos narrativos/estáticos parciales, pero existen varias variantes incompatibles:

- `Nomina 108`: 108 bytes útiles + CRLF. El UDT incluye consecutivo 9, RFC 16, tipo 2, cuenta 20, importe en centavos 15, nombre 40, banco 3 y plaza 3.
- `Nomina 232`: header y detalle distintos, cada uno de 232 bytes útiles + CRLF.
- `Nomina TR`: existe como hoja separada, sin salida física recuperada.
- `Pagos Mismo Banco`: contrato genérico de 85 bytes útiles + CRLF, no equivalente automáticamente a Nómina 108/232.

La secuencia narrativa `consecutivo + cuenta + importe en centavos + nombre + 001001` no converge completamente con el VBA recuperado y el literal `001001` no aparece en el proyecto VBA. Sin un TXT físico no se puede elegir variante, encoding ni constantes finales.

- Generic generator status: `GENERATOR_CONTRACT_CERTIFIED` para `Hoja4/uExpTrasBmer`, clasificado `HISTORICAL_IMPLEMENTATION`; no es certificación bancaria ni selección del rail payroll.
- Physical payroll source found: **NO**.
- Contract status: `PARTIAL_CONTRACT_ONLY`.
- Adapter status: `parsePayrollBbvaSameBank` sigue fail-closed.
- El `PAGOSBBV020726.txt` genérico queda como `HISTORICAL_RELATED_FORMAT`, no como evidencia canónica de nómina.

## F. Payroll SPEI

- `PAYROLL_SPEI_INPUT`: `CERTIFIED` desde 5 registros físicos estructurados del XLSM interbancario.

### Evidencia payroll

El XLSM interbancario es un workbook estructurado real de `Qna 15_2026`. La hoja visible `Pagos Interbancarios` (`codeName=Hoja5`) tiene 5 renglones de pago. El VBA de esa misma hoja:

1. abre el destino en modo `Binary`;
2. recorre desde la fila 6;
3. llama `GenerateRow`;
4. escribe cada UDT `uExpPagInter` mediante `Put #`;
5. termina cada UDT con `vbCrLf`.

No se ejecutaron macros. La extracción fue estática desde `xl/vbaProject.bin`.

### Contrato convergente

| Field | Payroll XLSM/VBA | `PAGOSINT180626.txt` | Match | Evidence |
| --- | --- | --- | --- | --- |
| Cuenta destino | 18, `Format(..., 18 ceros)` | 18 dígitos | YES | UDT + ambos registros físicos |
| Cuenta origen | 18, `Format(..., 18 ceros)` | 18 dígitos | YES | UDT + ambos registros físicos |
| Moneda | `MXP`, ancho 3 | `MXP` | YES | constante VBA + bytes |
| Importe | 13 dígitos + punto + 2 decimales, ancho 16 | mismo patrón | YES | máscara VBA + bytes |
| Beneficiario | 30, `UCase(RemoveTrash(...))`, padding derecho | 30 ASCII mayúsculas/espacios | YES | UDT/VBA + bytes |
| Tipo cuenta | ancho 2, constante del rail | `40` | YES | VBA + bytes |
| Banco destino | primeros 3 de cuenta destino | coincide con prefijo | YES | VBA + bytes |
| Referencia pago | 30, `UCase(RemoveTrash(...))`, padding derecho | 30 | YES | UDT/VBA + bytes |
| Referencia numérica | 7, dígitos o padding si la celda está vacía | 7 espacios en ambos registros | YES | UDT/VBA + bytes |
| Indicador | `H` | `H` | YES | constante VBA + bytes |
| Terminador | `vbCrLf` | CRLF por registro, incluido el último | YES | VBA + bytes |
| BOM/encoding observable | salida binaria normalizada | sin BOM, ASCII-only | YES | bytes físicos |

Cada registro físico tiene 128 bytes útiles + CRLF; el archivo tiene 2 registros y 260 bytes. El parser nuevo aceptó los 2 registros físicos con 0 issues, sin imprimir sus valores.

`RemoveTrash` traduce vocales acentuadas a su versión ASCII, `ñ/Ñ` a `n/N` y el conjunto de puntuación definido por la macro a espacios; después se aplica mayúscula. El parser no intenta regenerar ni corregir bytes: valida el resultado físico de forma fail-closed.

### Diferencia con PAGOSINT genérico existente

El PAGOSINT genérico actual interpreta posiciones 86-90 como una referencia de 5 y 91-127 como concepto de 37. La evidencia macro/física recuperada demuestra otra semántica en el formato del simulador:

- 86-87: tipo de cuenta `40`;
- 88-90: banco destino;
- 91-120: referencia de pago de 30;
- 121-127: referencia numérica de 7.

Por eso N2A **no reutiliza** el parser/serializer genérico ni modifica PAGOSINT/PAGOSBBV existentes. Se implementó un adapter payroll aislado.

- Physical payroll TXT found: **NO**, pero el input payroll estructurado, el VBA/UDT exacto y el output físico histórico convergen en estructura, offsets, widths, normalization, padding y constantes.
- Contract status: `CERTIFIED_FROM_MULTIPLE_CONVERGENT_SOURCES`.
- Adapter status: `parsePayrollSpeiTxt` implementado; `parsePayrollSpei` lo delega por compatibilidad.

## G. TOKA

El XLSM TOKA pertenece a la misma familia del simulador. Su hoja visible `Pagos Interbancarios` contiene un renglón, lo que prueba una transferencia agregada por el mismo rail `uExpPagInter`. No demuestra distribución por persona.

La inspección OOXML encontró:

- `customXml` parts: 0;
- XML embebidos en `xl/embeddings`: 0;
- referencias `TOKA` o `.xml` en las fuentes VBA extraídas: 0;
- vínculo externo a una fuente de empleados: 0.

El XLSM no reemplaza el CFDI/XML y no permite probar namespaces, root, nodos repetibles, identificadores ni agregación individual.

- TOKA XLSM found: **YES**, supporting aggregate transfer only.
- `TOKA_AGGREGATE_TRANSFER`: `CERTIFIED_FROM_PHYSICAL_INPUT`.
- TOKA XML found: **NO**.
- Contract status: `MISSING_PHYSICAL_SOURCE`.
- Adapter status: `parsePayrollTokaXml` sigue fail-closed.

## H. Cross-source reconciliation

Los dos XLSM comparten `Qna 15_2026`, empresa, familia de simulador y timestamps locales separados por aproximadamente 5 segundos. El interbancario contiene 5 pagos y TOKA un agregado. El vínculo de la carátula también indica periodo 15. Estas señales hacen **probable** que sean parte de la misma corrida.

No se declara una corrida completa/certificada porque faltan la carátula física y el TXT payroll mismo banco. Para corridas con vales, el contrato N0/N1 actual también requiere el desglose TOKA para cross-check. La necesidad definitiva del XML en captura sólo puede reevaluarse al observar si la carátula física contiene `vouchers_amount` determinístico por persona. Sin ese insumo no se pueden cerrar employee count, totales por persona ni `neto = banco + vales` desde fuentes físicas.

## I. PII controls

- Archivos reales agregados al repo: 0.
- Valores reales agregados a fixtures/tests/report: 0.
- Logs de recuperación persistidos con filas o valores: 0.
- Manifest: sólo logical name, tipo, hash, tamaño, clasificación, estado y flags.
- Los tests nuevos construyen bytes sintéticos marcados `INTERNAL_SYNTHETIC_BYTES_NOT_REAL_PAYROLL`.
- Issues del adapter contienen sólo código, fuente, fila y campo; nunca incluyen el valor rechazado.

## J. Parsers

| Adapter | Resultado N2A |
| --- | --- |
| `parsePayrollCoverSheet` | fail-closed; carátula no recuperada |
| `parsePayrollBbvaSameBank` | fail-closed; sólo contrato parcial/múltiples variantes |
| `parsePayrollSpeiTxt` | implementado con contrato exacto 128+CRLF |
| `parsePayrollSpei` | alias compatible al adapter certificado |
| `parsePayrollTokaXml` | fail-closed; XML ausente |

## K. Tests

Se agregaron contratos sintéticos para:

- registro válido de 128 bytes útiles + CRLF;
- dos registros y extracción de offsets;
- compatibilidad `parsePayrollSpei`/`parsePayrollSpeiTxt`;
- rechazo de BOM, LF-only, CRLF final faltante y truncamiento;
- importe cero/inválido;
- tipo de cuenta incorrecto;
- banco que no coincide con la cuenta destino;
- referencia numérica inválida;
- indicador distinto de `H`;
- minúsculas y bytes no ASCII;
- issues sin eco de valores.

Los contratos N0 parser/migration y el forward fix N1 se ejecutan junto con N2A. En Windows, el assertion histórico de hash byte-for-byte de la migration N0 observa la conversión de checkout CRLF de `core.autocrlf`; el blob Git no fue modificado y `git diff` de migrations permanece vacío. CI sobre el blob LF es la autoridad para ese check.

Validación local R2 previa a publicación:

- syntax de `payroll_parser.js`: PASS;
- bundle N0/N1/N2A: 39/40 PASS; el único fallo es el assertion CRLF de Windows descrito arriba;
- SHA-256 calculado directamente desde el blob Git N0: `3A44AE1DA3438379B97B8D9F1CCCCA21DAEFBCF8E46D149A557EBD7526F85038`;
- regresiones CIE + payment receipt parser: 26/26 PASS;
- `PAGOSINT180626.txt`: 260 bytes, 2 registros aceptados, 0 issues, sin imprimir valores;
- PII leak scan persistente: 0 private paths, RFC, CURP, CLABE, NSS o nombres completos;
- `git diff --check`: PASS; diff de migrations: vacío.

## L. PR

La rama contiene sólo parser, tests sintéticos, manifest no-PII y este reporte. El PR debe permanecer Draft con base `dev`; no se autoriza merge en N2A. La creación del PR activó el preview automático estándar de Vercel; ese preview no es DEV ni PROD y no contiene cambios UI.

Baseline R2: PR #362 `OPEN`, Draft, base `dev`, head inicial `a4cea78abd3b02665e4f053585017b12f9f5ac21`, merge state `CLEAN`, sin reviews pendientes y checks previos verdes. R2 actualiza el mismo PR; PRs nuevos = 0.

## M. DEV

- DB writes: 0.
- DDL/migrations nuevas: 0.
- UI: 0.
- Deployments manuales: 0.
- El preview automático estándar puede refrescarse con el nuevo head del PR; no es un deploy manual ni DEV/PROD.

## N. PROD

- Consultas: 0.
- Writes: 0.
- DDL/migrations: 0.
- Deployments: 0.
- All mutations: 0.

## O. Exact missing artifacts

Para cerrar los formatos no certificados se requieren, conservando bytes originales:

1. `OPERADORA TLACATECPAN - Reporte de nómina periodo 15.xlsx`, la carátula original referenciada por el XLSM.
2. El TXT físico de Nómina BBVA mismo banco generado por la macro para esa corrida; debe permitir identificar si el rail válido es Nómina 108, Nómina 232 u otra variante.
3. El XML TOKA/CFDI asociado a la misma corrida de `Qna 15_2026`, **condicional para captura**: bajo el contrato N0/N1 vigente es necesario para validar vales; puede diferirse a evidencia/conciliación sólo si la carátula física prueba un desglose determinístico y se autoriza ese cambio de contrato.

No se necesita volver a subir los XLSM, el spec ni `PAGOSINT180626.txt`: ya fueron recuperados y reutilizados.

## P. Next recommendation

N2B puede iniciar el shell de captura, metadata, selección local de archivos y el adapter SPEI certificado. Carátula, mismo banco y desglose TOKA deben permanecer en estado bloqueado/pending hasta contar con evidencia. No se debe persistir una solicitud incompleta ni habilitar `Enviar a aprobación`: el modelo actual liga archivos a una solicitud obligatoria y dispone crearla después de validar fuentes. Persistencia temprana requeriría un contrato explícito de draft fuera de R2.

## Q. Final status

`PASS PARTIAL / PAYROLL_N2A_R2_COMPLETE / XLSM_INPUTS_CERTIFIED / PAYROLL_SPEI_CERTIFIED / TOKA_AGGREGATE_TRANSFER_CERTIFIED / MISSING_EXACT_ARTIFACTS=COVER_SHEET_XLSX,BBVA_SAME_BANK_TXT,TOKA_XML_CONDITIONAL / NO_FORMAT_GUESSES / PII_NOT_COMMITTED / PR362_UPDATED / DEV_DB_UNTOUCHED / PROD_UNTOUCHED`
