/**
 * F1-4 / F1-5 · Validadores del serializer: cuadre exacto y estructura.
 *
 * Opera sobre la entrada CANÓNICA del serializer (asientos con
 * tipoMovto 'cargo'|'abono'), no sobre el layout parseado — para eso está
 * `validateCuadre` de src/parsers/contpaqLayout.js (tipoMovto 0|1).
 *
 * Reglas (spec F0 §3):
 * - Σ cargos == Σ abonos EXACTO. Se compara en centavos ENTEROS para evitar
 *   errores de punto flotante. Tolerancia 0: el redondeo se salda con asiento
 *   explícito (el fixture real trae un cargo de −0.06 a no deducibles), no
 *   con tolerancia.
 * - Los importes PUEDEN ser negativos, pero deben ser numéricos finitos.
 *
 * Módulo puro: sin fs, sin dependencias.
 */

import { transformCuenta, CuentaError } from './cuentas.js';

/** Error de validación con la lista de problemas encontrados en `detalles`. */
export class ValidacionError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [detalles] - Problemas individuales encontrados.
   */
  constructor(message, detalles = []) {
    super(message);
    this.name = 'ValidacionError';
    this.detalles = detalles;
  }
}

/**
 * Convierte un importe a centavos enteros.
 * @param {number} importe
 * @returns {number} Centavos (entero, puede ser negativo).
 * @throws {ValidacionError} Si el importe no es numérico finito.
 */
export function aCentavos(importe) {
  if (typeof importe !== 'number' || !Number.isFinite(importe)) {
    throw new ValidacionError(`Importe no numérico o no finito: ${JSON.stringify(importe)}`);
  }
  return Math.round(importe * 100);
}

/**
 * Valida el cuadre exacto de los asientos canónicos: Σ cargos == Σ abonos
 * en centavos enteros (tolerancia 0, negativos permitidos).
 *
 * @param {Array<{tipoMovto: 'cargo'|'abono', importe: number}>} asientos
 * @returns {{ok: boolean, cargos: number, abonos: number, diff: number}}
 *   Totales en pesos; `diff` = cargos − abonos (0 cuando cuadra).
 */
export function validateCuadre(asientos) {
  let cargosCent = 0;
  let abonosCent = 0;
  for (const a of asientos ?? []) {
    const cent = aCentavos(a.importe);
    if (a.tipoMovto === 'cargo') cargosCent += cent;
    else if (a.tipoMovto === 'abono') abonosCent += cent;
    // tipoMovto inválido se reporta en validarPoliza; aquí solo se suma lo válido.
  }
  const diffCent = cargosCent - abonosCent;
  return {
    ok: diffCent === 0,
    cargos: cargosCent / 100,
    abonos: abonosCent / 100,
    diff: diffCent / 100,
  };
}

/**
 * Validadores estructurales de una póliza canónica. Junta TODOS los
 * problemas (no se detiene en el primero) para un mensaje de error útil.
 *
 * @param {{tipo: string, asientos: Array<object>}} poliza - Entrada canónica
 *   de buildPoliza.
 * @param {object} empresaConfig - Config de la empresa (tiposPol, width).
 * @param {{catalogo?: Array<{codigo: string, esDetalle: boolean}>}} [opts] -
 *   `catalogo`: salida de parseCatalogo; si se pasa, se valida que cada
 *   cuenta exista y sea de detalle. Si se omite, esa validación se salta.
 * @returns {{ok: boolean, errores: string[]}}
 */
export function validarPoliza(poliza, empresaConfig, opts = {}) {
  const errores = [];

  const tiposPol = empresaConfig?.poliza?.tiposPol ?? {};
  if (!poliza || typeof poliza !== 'object') {
    return { ok: false, errores: ['La póliza debe ser un objeto.'] };
  }
  if (!tiposPol[poliza.tipo]) {
    errores.push(
      `Tipo de póliza "${poliza.tipo}" no válido para ${empresaConfig?.empresa ?? '?'}; ` +
        `tipos configurados: ${Object.keys(tiposPol).join(', ') || '(ninguno)'}.`
    );
  }

  const asientos = poliza.asientos;
  if (!Array.isArray(asientos) || asientos.length === 0) {
    errores.push('La póliza debe traer al menos un asiento en `asientos`.');
    return { ok: false, errores };
  }

  // Índice de cuentas del catálogo, normalizadas a formato concatenado
  // (el catálogo puede traer códigos con o sin guiones).
  let indiceCatalogo = null;
  if (opts.catalogo) {
    indiceCatalogo = new Map();
    for (const c of opts.catalogo) {
      indiceCatalogo.set(String(c.codigo).replace(/[-\s]/g, ''), c);
    }
  }

  for (const [i, a] of asientos.entries()) {
    const ref = `asiento ${i} (cuenta ${a?.cuenta ?? '?'})`;

    if (a.tipoMovto !== 'cargo' && a.tipoMovto !== 'abono') {
      errores.push(`${ref}: tipoMovto "${a.tipoMovto}" inválido; debe ser 'cargo' o 'abono'.`);
    }
    if (typeof a.importe !== 'number' || !Number.isFinite(a.importe)) {
      errores.push(`${ref}: importe no numérico o no finito (${JSON.stringify(a.importe)}).`);
    }

    let concatenada;
    try {
      concatenada = transformCuenta(a.cuenta, empresaConfig);
    } catch (e) {
      if (e instanceof CuentaError) {
        errores.push(`${ref}: ${e.message}`);
        continue;
      }
      throw e;
    }

    if (indiceCatalogo) {
      const enCatalogo = indiceCatalogo.get(concatenada);
      if (!enCatalogo) {
        errores.push(`${ref}: la cuenta ${concatenada} no existe en el catálogo.`);
      } else if (!enCatalogo.esDetalle) {
        errores.push(
          `${ref}: la cuenta ${concatenada} (${enCatalogo.nombre ?? 'sin nombre'}) es ` +
            'acumulativa; los asientos solo aceptan cuentas de detalle.'
        );
      }
    }
  }

  return { ok: errores.length === 0, errores };
}
