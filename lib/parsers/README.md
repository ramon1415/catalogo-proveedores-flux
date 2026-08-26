# Parser de CFDI 4.0 para el navegador

Entregado para **FB-2**: parsear el CFDI al adjuntarlo y precargar la solicitud.

Sin DDL, sin Tax Resolver, sin fixtures reales.

## Los tres archivos

| Archivo | Qué es | Importa |
|---|---|---|
| `cfdiCore.js` | La lógica fiscal y los helpers de acceso al árbol | **nada** |
| `cfdiBrowser.js` | Entrada para el navegador: `DOMParser` nativo | solo `cfdiCore.js` |

`cfdiCore.js` **no importa nada** — ni npm, ni Node, ni APIs del navegador.
Por eso los dos entornos lo pueden cargar sin arrastrarse dependencias.

En el repo del módulo existe además `cfdi.js`, la entrada para Node que usa
`fast-xml-parser`. **No se incluye aquí a propósito:** la app no tiene bundler
y ese import rompe en el navegador con
`Failed to resolve module specifier "fast-xml-parser"`.

## Uso

```js
import { parseCfdiXml, CfdiParseError } from './lib/parsers/cfdiBrowser.js';

try {
  const cfdi = parseCfdiXml(await archivo.text());
  // cfdi.emisor.rfc · cfdi.comprobante.total · cfdi.uuid · cfdi.impuestos …
} catch (e) {
  if (e instanceof CfdiParseError) mostrarError(e.message);
}
```

Es un módulo ES: la etiqueta que lo cargue necesita `type="module"`.

## Qué extrae

`version` · `comprobante` (serie, folio, fecha, forma y método de pago, moneda,
tipo de cambio, subtotal, total) · `emisor` (RFC, nombre, régimen fiscal) ·
`receptor` (RFC, nombre, uso CFDI) · `impuestos` (traslados y **retenciones**) ·
`uuid` · `cfdiRelacionados` · `pagos` (complemento 2.0 con documentos
relacionados y saldos) · `nomina`.

## Verificación

Los tres fixtures producen en el navegador una salida **idéntica byte a byte**
a la de Node, comparando el JSON completo. Y los cuatro casos de error se
comportan igual en ambos: vacío, no-es-CFDI, versión 3.3 rechazada, XML mal
formado.

Los fixtures son **sintéticos**, construidos para prueba. El RFC
`OPT150312QV1` y sus contrapartes no corresponden a ninguna empresa del grupo.

## Detalle que conviene conocer

`DOMParser` **no lanza** ante XML inválido: devuelve un documento con un nodo
`<parsererror>`. `cfdiBrowser` lo detecta y lanza `CfdiParseError`, para que el
contrato de errores sea el mismo en los dos entornos.

## Origen

`carlosquantta/flux-contpaq-export` · rama `feat/motor-agregacion` · commit
`6605c95a5145a45746460be0c319fc9da5cb38f6` · suite 104/104.
