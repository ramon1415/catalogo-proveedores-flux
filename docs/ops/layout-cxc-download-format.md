# Formato de descarga CxC para layouts

Este hotfix cambia la descarga del layout bancario en `layouts.html` para que ya no genere un archivo `.xlsx`.

## Formato actual

Mientras no exista una especificacion bancaria formal versionada en el repositorio, el archivo CxC se exporta como archivo plano:

- Extension: `.txt`
- MIME type: `text/plain;charset=utf-8`
- Encoding: UTF-8 con BOM para conservar acentos al abrir en Windows
- Saltos de linea: CRLF
- Delimitador: `|`
- Header: no incluido

## Columnas

Cada linea representa un pago incluido en el layout, en el mismo orden operativo que antes se escribia en columnas B:H del Excel:

1. `CTA_CARGO`: cuenta origen
2. `TITULAR`: empresa/titular origen
3. `DESTINO`: cuenta destino, CLABE o convenio
4. `BENEFICIARIO`: beneficiario
5. `MONTO`: monto con dos decimales
6. `REFERENCIA`: referencia de pago
7. `CONCEPTO`: concepto de pago

Ejemplo:

```text
0123456789|Flux Operadora S.A. de C.V.|012345678901234567|Proveedor Demo|1250.50|SOL-2026-0001|Pago proveedor demo
```

## Alcance

El cambio es solo frontend. No modifica Supabase, tablas, RLS, RPCs, n8n, secrets ni variables.

## Pendiente

Si Carlos/Ramon entregan una especificacion bancaria CxC formal con posiciones fijas, layouts por banco o extension diferente, este documento debe actualizarse y el exportador debe ajustarse en un PR separado.
