# Parser de CFDI 4.0 para el navegador

Entregado para **FB-2**: parsear el CFDI al adjuntarlo y precargar la solicitud.

Sin DDL, sin Tax Resolver, sin fixtures reales.

## Archivos

| Archivo | Qué es | Importa |
|---|---|---|
| `cfdiCore.js` | Lógica fiscal y helpers de acceso al árbol | **nada** |
| `cfdiBrowser.js` | Entrada navegador: `DOMParser` nativo | solo `cfdiCore.js` |

`cfdiCore.js` no importa npm, Node ni APIs del navegador.

En el repo del módulo existe además `cfdi.js`, entrada Node con
`fast-xml-parser`. No se incluye aquí porque la app no tiene bundler.

## Uso

```js
import { parseCfdiXml, CfdiParseError } from './lib/parsers/cfdiBrowser.js';
const cfdi = parseCfdiXml(await archivo.text());
```

## Shape relevante

Además de `version`, `comprobante`, `emisor`, `receptor`, `impuestos`, `uuid`,
`cfdiRelacionados`, `pagos` y `nomina`, el hardening de FB-2 expone:

- `pagosTotales.montoTotalPagos`;
- `pagos[].monedaP`;
- `pagos[].tipoCambioP`;
- `pagos[].montoP`.

Esto permite que un CFDI tipo **P / REP** se compare por su monto/moneda
efectivos y no por `Comprobante.Total=0` / `Moneda=XXX`.

## Seguridad navegador

- `DOMParser` parsererror → `CfdiParseError`.
- `<!DOCTYPE>` se rechaza antes de parsear.
- sin red, IA ni resolución contable.

## Origen y divergencia controlada

La entrega original provino de:

`carlosquantta/flux-contpaq-export` · `feat/motor-agregacion` ·
`6605c95a5145a45746460be0c319fc9da5cb38f6` · suite 104/104.

Después del review de Carlos en PR #422 se añadió hardening local para REP/P y
DOCTYPE. Por eso **esta copia ya no debe describirse como byte-idéntica al
upstream `6605c95`**. La versión de ingestión se identifica como
`cfdi-browser-6605c95-flux-rep-v2`.

Pendiente antes de cerrar el gate: backportear estos cambios al módulo fuente y
volver a establecer una única versión certificada para Node/navegador.

Los fixtures incluidos son sintéticos.
