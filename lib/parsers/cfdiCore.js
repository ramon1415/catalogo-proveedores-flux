/**
 * FB-2 · Núcleo del parseo de CFDI 4.0 — SIN dependencias.
 *
 * Contiene la lógica fiscal y los helpers de acceso al árbol. No importa nada:
 * ni npm, ni APIs de Node, ni del navegador. Por eso lo pueden cargar los dos
 * frentes sin arrastrarse dependencias entre sí:
 *
 *   cfdi.js         → Node, construye el árbol con fast-xml-parser
 *   cfdiBrowser.js  → navegador, lo construye con DOMParser nativo
 *
 * El contrato del árbol es el de fast-xml-parser: atributos con prefijo `@_`,
 * hijos por nombre de etiqueta, y arreglo cuando la etiqueta se repite.
 *
 * La regla fiscal vive aquí y solo aquí: si cambia, cambia en un lugar.
 */

/** Error de parseo/validación de CFDI con mensaje accionable. */
export class CfdiParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CfdiParseError';
  }
}

function asArray(node) {
  if (node === undefined || node === null) return [];
  return Array.isArray(node) ? node : [node];
}

function attr(node, name) {
  if (!node) return undefined;
  const v = node[`@_${name}`];
  return v === undefined ? undefined : String(v);
}

function num(node, name) {
  const v = attr(node, name);
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (Number.isNaN(n)) {
    throw new CfdiParseError(`Atributo numérico inválido: ${name}="${v}"`);
  }
  return n;
}

function child(node, localName) {
  if (!node || typeof node !== 'object') return undefined;
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const local = key.includes(':') ? key.split(':').pop() : key;
    if (local === localName) return node[key];
  }
  return undefined;
}

function children(node, localName) {
  return asArray(child(node, localName));
}

export function parseCfdiDesdeArbol(tree) {
  const comprobante = child(tree, 'Comprobante');
  if (!comprobante) {
    throw new CfdiParseError(
      'No se encontró el nodo Comprobante: el archivo no parece ser un CFDI.'
    );
  }

  const version = attr(comprobante, 'Version');
  if (version !== '4.0') {
    throw new CfdiParseError(
      `Versión de CFDI no soportada: "${version ?? '(ausente)'}". Este parser solo acepta CFDI 4.0.`
    );
  }

  const fecha = attr(comprobante, 'Fecha');
  const tipoDeComprobante = attr(comprobante, 'TipoDeComprobante');
  if (!fecha) throw new CfdiParseError('Comprobante sin atributo Fecha.');
  if (!tipoDeComprobante) {
    throw new CfdiParseError('Comprobante sin atributo TipoDeComprobante.');
  }

  const comprobanteOut = {
    serie: attr(comprobante, 'Serie'),
    folio: attr(comprobante, 'Folio'),
    fecha,
    tipoDeComprobante,
    metodoPago: attr(comprobante, 'MetodoPago'),
    formaPago: attr(comprobante, 'FormaPago'),
    moneda: attr(comprobante, 'Moneda') ?? '',
    tipoCambio: num(comprobante, 'TipoCambio'),
    subTotal: num(comprobante, 'SubTotal') ?? 0,
    total: num(comprobante, 'Total') ?? 0,
  };

  const emisorNode = child(comprobante, 'Emisor');
  if (!emisorNode) throw new CfdiParseError('CFDI sin nodo Emisor.');
  const emisor = {
    rfc: attr(emisorNode, 'Rfc') ?? '',
    nombre: attr(emisorNode, 'Nombre') ?? '',
    regimenFiscal: attr(emisorNode, 'RegimenFiscal') ?? '',
  };
  if (!emisor.rfc) throw new CfdiParseError('Emisor sin Rfc.');

  const receptorNode = child(comprobante, 'Receptor');
  if (!receptorNode) throw new CfdiParseError('CFDI sin nodo Receptor.');
  const receptor = {
    rfc: attr(receptorNode, 'Rfc') ?? '',
    nombre: attr(receptorNode, 'Nombre') ?? '',
    usoCfdi: attr(receptorNode, 'UsoCFDI') ?? '',
  };
  if (!receptor.rfc) throw new CfdiParseError('Receptor sin Rfc.');

  const impuestosNode = child(comprobante, 'Impuestos');
  const traslados = [];
  const retenciones = [];
  if (impuestosNode) {
    for (const t of children(child(impuestosNode, 'Traslados'), 'Traslado')) {
      traslados.push({
        base: num(t, 'Base') ?? 0,
        impuesto: attr(t, 'Impuesto') ?? '',
        tipoFactor: attr(t, 'TipoFactor') ?? '',
        tasaOCuota: num(t, 'TasaOCuota'),
        importe: num(t, 'Importe'),
      });
    }
    for (const r of children(child(impuestosNode, 'Retenciones'), 'Retencion')) {
      retenciones.push({
        impuesto: attr(r, 'Impuesto') ?? '',
        importe: num(r, 'Importe') ?? 0,
      });
    }
  }
  const impuestos = {
    traslados,
    retenciones,
    totalTrasladados: impuestosNode
      ? num(impuestosNode, 'TotalImpuestosTrasladados')
      : undefined,
    totalRetenidos: impuestosNode
      ? num(impuestosNode, 'TotalImpuestosRetenidos')
      : undefined,
  };

  const cfdiRelacionados = [];
  for (const rel of children(comprobante, 'CfdiRelacionados')) {
    cfdiRelacionados.push({
      tipoRelacion: attr(rel, 'TipoRelacion') ?? '',
      uuids: children(rel, 'CfdiRelacionado')
        .map((n) => attr(n, 'UUID'))
        .filter(Boolean),
    });
  }

  const complemento = child(comprobante, 'Complemento');

  let uuid;
  let pagos = null;
  let pagosTotales = null;
  let nomina = null;

  if (complemento) {
    const tfd = child(complemento, 'TimbreFiscalDigital');
    uuid = tfd ? attr(tfd, 'UUID') : undefined;

    const pagosNode = child(complemento, 'Pagos');
    if (pagosNode) {
      const totalesNode = child(pagosNode, 'Totales');
      pagosTotales = totalesNode
        ? { montoTotalPagos: num(totalesNode, 'MontoTotalPagos') }
        : null;

      pagos = children(pagosNode, 'Pago').map((p) => ({
        fechaPago: attr(p, 'FechaPago') ?? '',
        formaDePagoP: attr(p, 'FormaDePagoP') ?? '',
        monedaP: attr(p, 'MonedaP') ?? '',
        tipoCambioP: num(p, 'TipoCambioP'),
        montoP: num(p, 'Monto') ?? 0,
        doctoRelacionado: children(p, 'DoctoRelacionado').map((d) => ({
          idDocumento: attr(d, 'IdDocumento') ?? '',
          serie: attr(d, 'Serie'),
          folio: attr(d, 'Folio'),
          impSaldoAnt: num(d, 'ImpSaldoAnt') ?? 0,
          impPagado: num(d, 'ImpPagado') ?? 0,
          impSaldoInsoluto: num(d, 'ImpSaldoInsoluto') ?? 0,
        })),
      }));
    }

    const nominaNode = child(complemento, 'Nomina');
    if (nominaNode) {
      const percepcionesNode = child(nominaNode, 'Percepciones');
      const deduccionesNode = child(nominaNode, 'Deducciones');
      nomina = {
        totalPercepciones: num(nominaNode, 'TotalPercepciones'),
        totalDeducciones: num(nominaNode, 'TotalDeducciones'),
        totalOtrosPagos: num(nominaNode, 'TotalOtrosPagos'),
        fechaPago: attr(nominaNode, 'FechaPago'),
        percepciones: children(percepcionesNode, 'Percepcion').map((p) => ({
          tipoPercepcion: attr(p, 'TipoPercepcion') ?? '',
          clave: attr(p, 'Clave') ?? '',
          concepto: attr(p, 'Concepto') ?? '',
          importeGravado: num(p, 'ImporteGravado') ?? 0,
          importeExento: num(p, 'ImporteExento') ?? 0,
        })),
        deducciones: children(deduccionesNode, 'Deduccion').map((d) => ({
          tipoDeduccion: attr(d, 'TipoDeduccion') ?? '',
          clave: attr(d, 'Clave') ?? '',
          concepto: attr(d, 'Concepto') ?? '',
          importe: num(d, 'Importe') ?? 0,
        })),
      };
    }
  }

  return {
    version,
    comprobante: comprobanteOut,
    emisor,
    receptor,
    impuestos,
    uuid,
    cfdiRelacionados,
    pagos,
    pagosTotales,
    nomina,
  };
}
