/**
 * F1-2 / F1-3 · Construcción de una póliza CONTPAQ: registro `P` (encabezado)
 * + registros `M1` (asientos), como filas crudas (arrays de celdas) listas
 * para renderLayout.
 *
 * Representación de celdas — calcada del archivo real (golden test):
 * - Fecha (P col1) y FechaAplicacion (M1 col10): número SERIAL de Excel.
 * - TipoPol/Folio/Clase/SistOrig/Impresa/Ajuste/TipoMovto/Importe/ImporteME:
 *   números.
 * - IdCuenta: string concatenado (11 o 22 dígitos según empresa).
 * - IdDiario: STRING "0" (así viene en ambos archivos reales).
 * - IdSegNeg: un ESPACIO " " cuando no hay segmento de negocio.
 * - Concepto/Referencia vacíos: string vacío "" (no celda vacía).
 * - Guid: UUID en mayúsculas SIN llaves.
 *
 * Determinismo: el core nunca genera Guids por sí solo — el generador es
 * inyectable vía `opts.generarGuid` y el default (crypto.randomUUID) vive en
 * el borde del módulo (`generarGuidDefault`), de modo que en tests se
 * inyectan los Guids del original y el default ni se toca.
 *
 * Módulo puro: sin fs, sin dependencias.
 */

import { transformCuenta } from './cuentas.js';
import { validateCuadre, validarPoliza, ValidacionError } from './validate.js';

/** Días entre el epoch Unix (1970-01-01) y el epoch de Excel (1899-12-30). */
const OFFSET_SERIAL_EXCEL = 25569;
const MS_POR_DIA = 86400000;

/**
 * Generador de Guid por default (borde del módulo): crypto.randomUUID en
 * mayúsculas, formato observado en los archivos reales. El core solo lo usa
 * cuando falta un guid y no se inyectó `opts.generarGuid`.
 * @returns {string} UUID v4 en mayúsculas sin llaves.
 */
export function generarGuidDefault() {
  return globalThis.crypto.randomUUID().toUpperCase();
}

/**
 * Normaliza una fecha a número serial de Excel (representación del archivo
 * real). Acepta:
 * - número finito (serial ya calculado) → passthrough;
 * - string numérico ("46174", como lo entrega el parser del layout) → Number;
 * - Date → serial (fecha UTC);
 * - string ISO "YYYY-MM-DD" → serial.
 * @param {number|string|Date} fecha
 * @returns {number} Serial de Excel (días desde 1899-12-30).
 * @throws {ValidacionError} Si la fecha no es interpretable.
 */
export function aSerialExcel(fecha) {
  if (typeof fecha === 'number' && Number.isFinite(fecha)) return fecha;
  if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
    return fecha.getTime() / MS_POR_DIA + OFFSET_SERIAL_EXCEL;
  }
  if (typeof fecha === 'string') {
    const s = fecha.trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (iso) {
      const ms = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      return ms / MS_POR_DIA + OFFSET_SERIAL_EXCEL;
    }
  }
  throw new ValidacionError(
    `Fecha no interpretable: ${JSON.stringify(fecha)} (se acepta serial de Excel, ` +
      `"YYYY-MM-DD" o Date).`
  );
}

/**
 * Normaliza el folio a número cuando es numérico (representación del archivo
 * real: la celda Folio de `P` es un número).
 * @param {number|string|undefined} folio
 * @returns {number|string} Número si es numérico; el string tal cual si no.
 */
function normalizarFolio(folio) {
  if (typeof folio === 'number' && Number.isFinite(folio)) return folio;
  if (typeof folio === 'string' && /^\d+$/.test(folio.trim())) return Number(folio.trim());
  return folio ?? '';
}

/**
 * Dado un TipoPol numérico del archivo, regresa el tipo canónico
 * ('diario'|'egreso'|'ingreso') según la config de la empresa. Útil para
 * reconstruir la entrada canónica desde un layout parseado (golden test) y
 * para Feeder-B.
 * @param {object} empresaConfig
 * @param {number|string} tipoPol
 * @returns {string|undefined} Tipo canónico, o undefined si no está mapeado.
 */
export function tipoDesdeTipoPol(empresaConfig, tipoPol) {
  const n = Number(tipoPol);
  for (const [tipo, cfg] of Object.entries(empresaConfig?.poliza?.tiposPol ?? {})) {
    if (cfg.tipoPol === n) return tipo;
  }
  return undefined;
}

/**
 * Construye los registros de una póliza (P + M1[]) como filas crudas.
 *
 * @param {{
 *   tipo: 'diario'|'egreso'|'ingreso',
 *   fecha: number|string|Date,
 *   folio?: number|string,
 *   concepto: string,
 *   guid?: string,
 *   clase?: number,
 *   impresa?: number,
 *   asientos: Array<{
 *     cuenta: string,
 *     tipoMovto: 'cargo'|'abono',
 *     importe: number,
 *     importeME?: number,
 *     concepto?: string,
 *     referencia?: string,
 *     segNeg?: string,
 *     guid?: string,
 *     fechaAplicacion?: number|string|Date
 *   }>
 * }} poliza - Entrada canónica.
 * @param {object} empresaConfig - Config de la empresa (ver configs/).
 * @param {{
 *   generarGuid?: () => string,
 *   catalogo?: Array<{codigo: string, esDetalle: boolean}>
 * }} [opts] - `generarGuid` inyectable (default: generarGuidDefault, solo se
 *   invoca si falta un guid); `catalogo` activa la validación de cuentas
 *   contra el catálogo (parseCatalogo).
 * @returns {{header: Array<*>, registros: Array<Array<*>>}} `header` = fila
 *   cruda del registro P; `registros` = filas crudas de los M1 en orden.
 * @throws {ValidacionError} Si la estructura es inválida o la póliza
 *   descuadra (con detalle de cargos vs abonos).
 */
export function buildPoliza(poliza, empresaConfig, opts = {}) {
  const estructura = validarPoliza(poliza, empresaConfig, { catalogo: opts.catalogo });
  if (!estructura.ok) {
    throw new ValidacionError(
      `Póliza inválida (${estructura.errores.length} problema(s)):\n- ` +
        estructura.errores.join('\n- '),
      estructura.errores
    );
  }

  const cuadre = validateCuadre(poliza.asientos);
  if (!cuadre.ok) {
    throw new ValidacionError(
      `Póliza descuadrada: cargos=${cuadre.cargos.toFixed(2)} ` +
        `abonos=${cuadre.abonos.toFixed(2)} diff=${cuadre.diff.toFixed(2)} ` +
        `(${poliza.concepto ?? 'sin concepto'}).`,
      [`cargos=${cuadre.cargos}`, `abonos=${cuadre.abonos}`, `diff=${cuadre.diff}`]
    );
  }

  const generarGuid = opts.generarGuid ?? generarGuidDefault;
  const tipoCfg = empresaConfig.poliza.tiposPol[poliza.tipo];
  const fechaSerial = aSerialExcel(poliza.fecha);

  // Registro P — columnas (leyenda "Póliza(P)"):
  // Fecha, TipoPol, Folio, Clase, IdDiario, Concepto, SistOrig, Impresa, Ajuste, Guid
  const header = [
    'P',
    fechaSerial,
    tipoCfg.tipoPol,
    normalizarFolio(poliza.folio),
    poliza.clase ?? tipoCfg.clase,
    String(tipoCfg.idDiario),
    poliza.concepto ?? '',
    empresaConfig.poliza.sistOrig,
    poliza.impresa ?? empresaConfig.poliza.impresa,
    empresaConfig.poliza.ajuste ?? 0,
    poliza.guid ?? generarGuid(),
  ];

  // Registros M1 — columnas (leyenda "Movimiento de póliza(M1)"):
  // IdCuenta, Referencia, TipoMovto, Importe, IdDiario, ImporteME, Concepto,
  // IdSegNeg, Guid, FechaAplicacion
  const registros = poliza.asientos.map((a) => [
    'M1',
    transformCuenta(a.cuenta, empresaConfig),
    a.referencia ?? '',
    a.tipoMovto === 'cargo' ? 0 : 1,
    a.importe,
    String(tipoCfg.idDiario),
    a.importeME ?? 0,
    a.concepto ?? '',
    a.segNeg ?? ' ',
    a.guid ?? generarGuid(),
    aSerialExcel(a.fechaAplicacion ?? fechaSerial),
  ]);

  return { header, registros };
}
