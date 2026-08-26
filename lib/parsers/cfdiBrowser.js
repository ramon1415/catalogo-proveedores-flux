/**
 * FB-2 · Parser de CFDI 4.0 para el NAVEGADOR, sin dependencias de npm.
 *
 * La app de Flux es HTML/JS sin bundler: no puede importar `fast-xml-parser`.
 * Este módulo usa DOMParser nativo y reutiliza el core fiscal compartido.
 */

import { CfdiParseError, parseCfdiDesdeArbol } from './cfdiCore.js';

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

  if (el.children.length === 0) {
    const texto = (el.textContent ?? '').trim();
    if (texto !== '') nodo['#text'] = texto;
  }

  return nodo;
}

export function parseCfdiXml(xmlString) {
  if (typeof xmlString !== 'string' || xmlString.trim() === '') {
    throw new CfdiParseError('Se esperaba un string XML no vacío.');
  }

  // CFDI válido no necesita DTD. Fallamos cerrado antes de DOMParser para no
  // depender del comportamiento del navegador ante entidades/DOCTYPE.
  if (/<!DOCTYPE/i.test(xmlString)) {
    throw new CfdiParseError('XML con DOCTYPE rechazado.');
  }

  if (typeof DOMParser === 'undefined') {
    throw new CfdiParseError(
      'DOMParser no disponible. Este módulo es para el navegador; en Node usa parseCfdi de cfdi.js.'
    );
  }

  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

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
