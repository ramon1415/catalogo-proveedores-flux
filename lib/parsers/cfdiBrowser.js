/**
 * FB-2 · Parser de CFDI 4.0 para el NAVEGADOR, sin dependencias de npm.
 *
 * La app de Flux es HTML/JS sin bundler: no puede importar `fast-xml-parser`.
 * Este módulo usa el `DOMParser` nativo del navegador y **reutiliza íntegra la
 * lógica fiscal ya certificada** en cfdi.js — no la duplica.
 *
 * Cómo: convierte el DOM al mismo contrato de árbol que produce
 * fast-xml-parser (atributos con prefijo `@_`, hijos por nombre de etiqueta,
 * arreglo cuando la etiqueta se repite) y llama a `parseCfdiDesdeArbol`.
 * Si mañana cambia una regla fiscal, cambia en un solo lugar.
 *
 * Uso en la app:
 *   import { parseCfdiXml } from './cfdiBrowser.js';
 *   const cfdi = parseCfdiXml(await file.text());
 *
 * Sin fs, sin red, sin npm. Solo `DOMParser`, disponible en todo navegador.
 */

import { CfdiParseError, parseCfdiDesdeArbol } from './cfdiCore.js';

/**
 * Convierte un elemento del DOM al contrato de árbol de fast-xml-parser.
 *
 * Reglas del contrato, que hay que respetar exactamente:
 *   - Cada atributo se expone como `@_Nombre` (nombre con prefijo intacto,
 *     porque el parser tolera prefijos de namespace por su cuenta).
 *   - Un hijo único es un objeto; dos o más con la misma etiqueta son arreglo.
 *   - El texto del nodo, si lo hay, va en `#text`.
 *
 * @param {Element} el
 * @returns {object}
 */
function elementoAArbol(el) {
  const nodo = {};

  for (const a of el.attributes) {
    nodo[`@_${a.name}`] = a.value;
  }

  for (const hijo of el.children) {
    const clave = hijo.nodeName;
    const valor = elementoAArbol(hijo);
    if (nodo[clave] === undefined) nodo[clave] = valor;
    else if (Array.isArray(nodo[clave])) nodo[clave].push(valor);
    else nodo[clave] = [nodo[clave], valor];
  }

  // Texto directo del elemento, solo si no tiene hijos elemento.
  if (el.children.length === 0) {
    const texto = (el.textContent ?? '').trim();
    if (texto !== '') nodo['#text'] = texto;
  }

  return nodo;
}

/**
 * Parsea un CFDI 4.0 desde su XML, en el navegador.
 *
 * @param {string} xmlString - Contenido del .xml (UTF-8).
 * @returns {object} Mismo shape que `parseCfdi` de cfdi.js.
 * @throws {CfdiParseError} XML vacío, mal formado, o que no es un CFDI 4.0.
 */
export function parseCfdiXml(xmlString) {
  if (typeof xmlString !== 'string' || xmlString.trim() === '') {
    throw new CfdiParseError('Se esperaba un string XML no vacío.');
  }
  if (typeof DOMParser === 'undefined') {
    throw new CfdiParseError(
      'DOMParser no disponible. Este módulo es para el navegador; en Node usa parseCfdi de cfdi.js.'
    );
  }

  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

  // DOMParser no lanza ante XML inválido: devuelve un documento con <parsererror>.
  const error = doc.querySelector('parsererror');
  if (error) {
    throw new CfdiParseError(`XML mal formado: ${error.textContent.trim().split('\n')[0]}`);
  }
  if (!doc.documentElement) {
    throw new CfdiParseError('XML mal formado: sin elemento raíz.');
  }

  const arbol = { [doc.documentElement.nodeName]: elementoAArbol(doc.documentElement) };
  return parseCfdiDesdeArbol(arbol);
}

export { CfdiParseError };
