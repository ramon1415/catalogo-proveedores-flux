/**
 * F2 · Builders de registros FISCALES del layout CONTPAQ: `AM`, `I`, `W2`,
 * `V`, `AD` + passthrough genérico para tokens no modelados (R/E/D/C, ...).
 *
 * Representación calcada del archivo real de junio 2026 (golden test F2):
 * - IdPersona/IdProveedor (I col1, V col1): string alineado a la DERECHA a
 *   6 caracteres con espacios (`"   177"`, `"    59"`, `"     2"`).
 * - IdCuenta (I col4, V col18): cuenta de BANCO del pago concatenada
 *   (verificación F0 cerrada: único valor real 10201100000, o `" "` cuando
 *   no aplica — se emite tal cual si viene en blanco).
 * - Serie: string (puede ser `""`); Folio: NÚMERO (0 cuando el folio del
 *   CFDI no cabe como entero); Referencia: string (`""` si no hay).
 * - UUID: tal cual venga del CFDI (el archivo real mezcla mayúsculas y
 *   minúsculas según el origen — no se normaliza).
 * - Clasificadores DIOT (I col31-33 y col36): STRINGS (`"201"`, `"201.03"`,
 *   `"301.01"`; `"0"` en retenciones); Proporción (col34) y Deducible
 *   (col35): números.
 * - W2: CINCO celdas — `['W2', IETUDeducible, 0, 0, '']` (la última es
 *   string vacío en el archivo real, no celda ausente).
 * - Celdas de texto vacías dentro de un registro: `""` (no undefined).
 *
 * Semántica fiscal (F0 §6/6b, decodificada de los casos COPPEL y Lorenia):
 * - `TipoMovimiento` en I: 1 = traslado (padre), 2 = retención (hija).
 * - `Impuesto` en I: 1 = ISR, 2 = IVA (catálogo interno CONTPAQ, no la
 *   clave SAT literal).
 * - Las retenciones se ligan al traslado padre vía `GuidMovPadre`; solo el
 *   padre lleva clasificadores DIOT e IETUDeducible = base.
 * - ORDEN real observado dentro de la póliza (un solo CFDI):
 *   P → (M1 + AM)×n → I×k → W2 → V → AD, donde los I de RETENCIÓN van
 *   ANTES del I traslado padre (caso Lorenia: ret ISR, ret IVA, padre).
 *
 * Módulo puro: sin fs, sin dependencias. Guids: el caller los provee
 * (inyectables) — estos builders no generan ninguno.
 */

import { transformCuenta } from './cuentas.js';
import { ValidacionError } from './validate.js';

/** TipoMovimiento (I col12): traslado — el registro padre con DIOT. */
export const TIPO_MOV_TRASLADO = 1;
/** TipoMovimiento (I col12): retención — hija ligada por GuidMovPadre. */
export const TIPO_MOV_RETENCION = 2;
/** Impuesto (I col14): ISR (catálogo interno CONTPAQ). */
export const IMPUESTO_ISR = 1;
/** Impuesto (I col14): IVA (catálogo interno CONTPAQ). */
export const IMPUESTO_IVA = 2;

/**
 * Config DIOT observada constante en los traslados del archivo real de
 * Operadora (F0 §6). Por empresa puede sobreescribirse vía
 * `mapeoEmpresa.diot` (hay variantes reales: 201.04/301.09 en notas de
 * crédito Total Play, 206/206.01 en un caso — quedan como override).
 */
export const DIOT_DEFAULT = {
  concepto: 201,
  subconcepto: '201.03',
  clasificador: '301.01',
  proporcion: 100,
  deducible: 1,
};

/** DIOT "en ceros" de los registros I de retención (observado, F0 §6b). */
export const DIOT_CEROS = {
  concepto: 0,
  subconcepto: 0,
  clasificador: 0,
  proporcion: 100,
  deducible: 0,
};

/** Ancho del campo IdPersona/IdProveedor en I/V (observado en el archivo). */
const ANCHO_ID_PERSONA = 6;

/** Folio máximo que el archivo real acepta como número (entero de 32 bits
 * con signo). HALLAZGO F2: folios numéricos MÁS LARGOS (p. ej. CFE
 * "200034213922") van con Folio=0 y el folio completo en Referencia. */
const FOLIO_MAX = 2147483647;

/**
 * IdPersona/IdProveedor al formato del archivo: string alineado a la
 * derecha a 6 caracteres.
 * @param {number|string} id - IdProveedor CONTPAQ (p. ej. 177).
 * @returns {string} `"   177"`.
 */
function padIdPersona(id) {
  return String(id ?? '').padStart(ANCHO_ID_PERSONA, ' ');
}

/**
 * Cuenta para las columnas IdCuenta fiscales: se transforma con la config
 * de la empresa (quita guiones + valida width), pero un valor en blanco
 * (`" "`, observado en el archivo real cuando no aplica) pasa tal cual.
 * @param {string|number} cuenta
 * @param {object} [empresaConfig] - Si se omite, la cuenta pasa tal cual.
 * @returns {string}
 */
function cuentaFiscal(cuenta, empresaConfig) {
  if (typeof cuenta === 'string' && cuenta.trim() === '') return cuenta;
  return empresaConfig ? transformCuenta(cuenta, empresaConfig) : String(cuenta);
}

/**
 * Emite las 6 columnas DIOT (I col31-36) con la representación real:
 * clasificadores como string, proporción/deducible como número.
 * @param {{concepto: number|string, subconcepto: number|string,
 *   clasificador: number|string, proporcion: number, deducible: number,
 *   subconceptoDiot?: number|string}} diot
 * @returns {Array<*>} [ConceptoIVA, SubconceptoIVA, ClasificadorIVA,
 *   ProporcionDIOT, DeducibleDIOT, SubConceptoDIOT]
 */
function columnasDiot(diot) {
  return [
    String(diot.concepto),
    String(diot.subconcepto),
    String(diot.clasificador),
    diot.proporcion,
    diot.deducible,
    String(diot.subconceptoDiot ?? diot.subconcepto),
  ];
}

/**
 * Regla Serie/Folio/Referencia de los registros I/V, decodificada del
 * archivo real de junio:
 * - Folio numérico que cabe en entero de 32 bits → Folio = número,
 *   Referencia = "".
 * - En cualquier otro caso (no numérico, o numérico demasiado largo como
 *   los folios CFE de 12+ dígitos) → Folio = 0 y el folio CRUDO completo
 *   va en Referencia.
 *
 * NOTA (hipótesis vs archivo): el spec F2 planteaba Referencia =
 * serie+folio (caso Lorenia "F2025"); las pólizas reales de Total Play
 * (Serie "TP", Referencia "B1-469238001T1-4") muestran que la Referencia
 * es el folio CRUDO, sin anteponer la serie — pendiente de confirmar con
 * el XML real de Lorenia (cuyo folio sería entonces "F2025").
 *
 * @param {string|undefined} serie - Serie del CFDI (puede faltar).
 * @param {string|number|undefined} folio - Folio del CFDI.
 * @returns {{serie: string, folio: number, referencia: string}}
 */
export function serieFolioReferencia(serie, folio) {
  const s = serie === undefined || serie === null ? '' : String(serie);
  const f = folio === undefined || folio === null ? '' : String(folio).trim();
  if (f !== '' && /^\d+$/.test(f) && Number(f) <= FOLIO_MAX) {
    return { serie: s, folio: Number(f), referencia: '' };
  }
  return { serie: s, folio: 0, referencia: f };
}

/**
 * Fila `AM` (asociación movimiento↔CFDI): va inmediatamente después de
 * cada M1 asociado a una factura.
 * @param {string} uuid - UUID del CFDI, tal cual (no se normaliza el case).
 * @returns {Array<*>} ['AM', uuid]
 * @throws {ValidacionError} Si falta el UUID.
 */
export function buildAM(uuid) {
  if (typeof uuid !== 'string' || uuid.trim() === '') {
    throw new ValidacionError(`buildAM: UUID requerido; llegó ${JSON.stringify(uuid)}.`);
  }
  return ['AM', uuid];
}

/**
 * Fila `AD` (asociación documento): cierra el bloque fiscal de la póliza
 * (una por CFDI asociado; puede haber más de una).
 * @param {string} uuid - UUID del CFDI, tal cual.
 * @returns {Array<*>} ['AD', uuid]
 * @throws {ValidacionError} Si falta el UUID.
 */
export function buildAD(uuid) {
  if (typeof uuid !== 'string' || uuid.trim() === '') {
    throw new ValidacionError(`buildAD: UUID requerido; llegó ${JSON.stringify(uuid)}.`);
  }
  return ['AD', uuid];
}

/**
 * Fila `W2` (Devolución de IVA / IETU): col1 = IETUDeducible (= base del
 * traslado), col2 = col3 = 0 y una QUINTA celda `""` (así viene en las 51
 * filas reales).
 * @param {number} base - IETUDeducible (base gravable del CFDI).
 * @param {{ietuModificado?: number, ietuAcreditable?: number}} [opts]
 * @returns {Array<*>} ['W2', base, 0, 0, '']
 * @throws {ValidacionError} Si la base no es un número finito.
 */
export function buildW2(base, opts = {}) {
  if (typeof base !== 'number' || !Number.isFinite(base)) {
    throw new ValidacionError(`buildW2: base (IETUDeducible) debe ser número finito; llegó ${JSON.stringify(base)}.`);
  }
  return ['W2', base, opts.ietuModificado ?? 0, opts.ietuAcreditable ?? 0, ''];
}

/**
 * Registro `I` (movimiento de impuestos) — 36 columnas según F0 §6.
 *
 * Distingue por `tipoMovimiento`:
 * - TRASLADO (1, default): lleva clasificadores DIOT (default DIOT_DEFAULT,
 *   configurable por empresa) e IETUDeducible = base; GuidMovPadre vacío
 *   (es el padre).
 * - RETENCIÓN (2): `impuesto` 1=ISR / 2=IVA, `guidMovPadre` = GuidMov del
 *   I traslado padre (REQUERIDO), DIOT en ceros e IETUDeducible = 0.
 *
 * Todos los campos con default observado constante son sobreescribibles
 * (necesario para reproducir los casos atípicos reales: pagos sin
 * comprobante desglosado, tasa 0, DIOT 206/206.01, etc.).
 *
 * @param {{
 *   idProveedor: number|string, ejercicio: number, periodo: number,
 *   cuentaBanco: string, uuid: string, guidMov: string,
 *   tasa: number, base: number, importe: number, impTotal: number,
 *   tipoMovimiento?: number, impuesto?: number, guidMovPadre?: string,
 *   serie?: string, folio?: number, referencia?: string,
 *   aplicaImpuesto?: number, origen?: number, computable?: number,
 *   tipoFactor?: number, objetoImpuesto?: number, nombreImpLocal?: string,
 *   desglosado?: number, ivaNoAcred?: number, acumulaIETU?: number,
 *   idConceptoIETU?: string, ietuDeducible?: number, ietuModificado?: number,
 *   ietuAcreditable?: number, migrado?: number,
 *   diot?: {concepto, subconcepto, clasificador, proporcion, deducible, subconceptoDiot?}
 * }} datos
 * @param {object} [empresaConfig] - Para transformar `cuentaBanco`
 *   (transformCuenta F1); si se omite, la cuenta pasa tal cual.
 * @returns {Array<*>} Fila cruda de 37 celdas (token + 36 columnas).
 * @throws {ValidacionError} Si faltan campos requeridos o una retención no
 *   trae guidMovPadre.
 */
export function buildI(datos, empresaConfig) {
  if (!datos || typeof datos !== 'object') {
    throw new ValidacionError('buildI: se esperaba el objeto de datos del registro I.');
  }
  const errores = [];
  if (typeof datos.uuid !== 'string' || datos.uuid.trim() === '') errores.push('uuid requerido');
  if (typeof datos.guidMov !== 'string' || datos.guidMov.trim() === '') errores.push('guidMov requerido');
  for (const campo of ['tasa', 'base', 'importe', 'impTotal', 'ejercicio', 'periodo']) {
    if (typeof datos[campo] !== 'number' || !Number.isFinite(datos[campo])) {
      errores.push(`${campo} debe ser número finito (llegó ${JSON.stringify(datos[campo])})`);
    }
  }
  const tipoMovimiento = datos.tipoMovimiento ?? TIPO_MOV_TRASLADO;
  const esRetencion = tipoMovimiento === TIPO_MOV_RETENCION;
  if (esRetencion && (typeof datos.guidMovPadre !== 'string' || datos.guidMovPadre.trim() === '')) {
    errores.push('guidMovPadre requerido en una retención (guid del I traslado padre)');
  }
  if (errores.length > 0) {
    throw new ValidacionError(`buildI inválido:\n- ${errores.join('\n- ')}`, errores);
  }

  const diot = datos.diot ?? (esRetencion ? DIOT_CEROS : DIOT_DEFAULT);

  // Columnas 1-36 (F0 §6): IdPersona, Ejercicio, Periodo, IdCuenta,
  // AplicaImpuesto, Serie, Folio, Referencia, UUID, Origen, Computable,
  // TipoMovimiento, TipoFactor, Impuesto, ObjetoImpuesto, NombreImpLocal,
  // TasaOCuota, ImpBase, ImpImpuesto, ImpTotal, Desglosado, IVANoAcred,
  // AcumulaIETU, IdConceptoIETU, IETUDeducible, IETUModificado,
  // IETUAcreditable, GuidMov, GuidMovPadre, Migrado, ConceptoIVA,
  // SubconceptoIVA, ClasificadorIVA, ProporcionDIOT, DeducibleDIOT,
  // SubConceptoDIOT.
  return [
    'I',
    padIdPersona(datos.idProveedor),
    datos.ejercicio,
    datos.periodo,
    cuentaFiscal(datos.cuentaBanco, empresaConfig),
    datos.aplicaImpuesto ?? 1,
    datos.serie ?? '',
    datos.folio ?? 0,
    datos.referencia ?? '',
    datos.uuid,
    datos.origen ?? 2,
    datos.computable ?? 1,
    tipoMovimiento,
    datos.tipoFactor ?? 1, // 1 = Tasa
    datos.impuesto ?? IMPUESTO_IVA,
    datos.objetoImpuesto ?? 2,
    datos.nombreImpLocal ?? '',
    datos.tasa, // porcentaje (16, 10, 10.6667), no fracción
    datos.base,
    datos.importe,
    datos.impTotal,
    datos.desglosado ?? 1,
    datos.ivaNoAcred ?? 0,
    datos.acumulaIETU ?? 0,
    datos.idConceptoIETU ?? '',
    datos.ietuDeducible ?? (esRetencion ? 0 : datos.base),
    datos.ietuModificado ?? 0,
    datos.ietuAcreditable ?? 0,
    datos.guidMov,
    datos.guidMovPadre ?? '',
    datos.migrado ?? 0,
    ...columnasDiot(diot),
  ];
}

/**
 * Registro `V` (comprobante) — 22 columnas según F0 §6.
 *
 * GranTotal = NETO pagado: igual a ImpTotal cuando no hay retenciones, y
 * ImpTotal − IVARetenido − ISRRetenido cuando las hay (caso Lorenia:
 * 13,920 − 1,280 − 1,200 = 11,440).
 *
 * NOTA de representación (golden F2): en el archivo real ImpTotal /
 * ImpSinRet / GranTotal son la SUMA FLOTANTE de base + IVA (p. ej. COPPEL
 * V trae 62391.009999999995, no 62391.01 — a diferencia del I, que trae el
 * total redondeado). El resolver fiscal reproduce esa aritmética.
 *
 * @param {{
 *   idProveedor: number|string, impTotal: number, porIVA: number,
 *   base: number, iva: number, ejercicio: number, periodo: number,
 *   cuentaBanco: string, uuid: string, rfc: string,
 *   serie?: string, folio?: number, referencia?: string,
 *   causaIVA?: number, exentoIVA?: number, otrosImptos?: number,
 *   impSinRet?: number, ivaRetenido?: number, isrRetenido?: number,
 *   granTotal?: number, ivaPagNoAcred?: number, ieps?: number
 * }} datos
 * @param {object} [empresaConfig] - Para transformar `cuentaBanco`.
 * @returns {Array<*>} Fila cruda de 23 celdas (token + 22 columnas).
 * @throws {ValidacionError} Si faltan campos requeridos.
 */
export function buildV(datos, empresaConfig) {
  if (!datos || typeof datos !== 'object') {
    throw new ValidacionError('buildV: se esperaba el objeto de datos del registro V.');
  }
  const errores = [];
  if (typeof datos.uuid !== 'string' || datos.uuid.trim() === '') errores.push('uuid requerido');
  if (typeof datos.rfc !== 'string' || datos.rfc.trim() === '') errores.push('rfc requerido');
  for (const campo of ['impTotal', 'porIVA', 'base', 'iva', 'ejercicio', 'periodo']) {
    if (typeof datos[campo] !== 'number' || !Number.isFinite(datos[campo])) {
      errores.push(`${campo} debe ser número finito (llegó ${JSON.stringify(datos[campo])})`);
    }
  }
  if (errores.length > 0) {
    throw new ValidacionError(`buildV inválido:\n- ${errores.join('\n- ')}`, errores);
  }

  const ivaRetenido = datos.ivaRetenido ?? 0;
  const isrRetenido = datos.isrRetenido ?? 0;

  // Columnas 1-22 (F0 §6): IdProveedor, ImpTotal, PorIVA, ImpBase, ImpIVA,
  // CausaIVA, ExentoIVA, Serie, Folio, Referencia, OtrosImptos, ImpSinRet,
  // IVARetenido, ISRRetenido, GranTotal, EjercicioAsignado,
  // PeriodoAsignado, IdCuenta, IVAPagNoAcred, UUID, RFC, IEPS.
  return [
    'V',
    padIdPersona(datos.idProveedor),
    datos.impTotal,
    datos.porIVA,
    datos.base,
    datos.iva,
    datos.causaIVA ?? 1,
    datos.exentoIVA ?? 0,
    datos.serie ?? '',
    datos.folio ?? 0,
    datos.referencia ?? '',
    datos.otrosImptos ?? 0,
    datos.impSinRet ?? datos.impTotal,
    ivaRetenido,
    isrRetenido,
    datos.granTotal ?? datos.impTotal - ivaRetenido - isrRetenido,
    datos.ejercicio,
    datos.periodo,
    cuentaFiscal(datos.cuentaBanco, empresaConfig),
    datos.ivaPagNoAcred ?? 0,
    datos.uuid,
    datos.rfc,
    datos.ieps ?? 0,
  ];
}

/**
 * Passthrough para registros crudos NO modelados por F2 (R/E/D/C de la
 * Causación de IVA, MC, bancarios, ...): recibe la fila tal cual y la
 * emite copiada. Permite reproducir el archivo completo sin modelar cada
 * token todavía.
 * @param {Array<*>} fila - Fila cruda con el token en la celda 0.
 * @returns {Array<*>} Copia de la fila.
 * @throws {ValidacionError} Si la fila no trae token de registro en col0.
 */
export function passthroughRegistro(fila) {
  if (!Array.isArray(fila) || typeof fila[0] !== 'string' || !/^[A-Z]{1,2}[0-9]?$/.test(fila[0].trim())) {
    throw new ValidacionError(
      `passthroughRegistro: se esperaba una fila cruda con token de registro en col0; llegó ${JSON.stringify(fila?.[0])}.`
    );
  }
  return fila.slice();
}

/**
 * Integra el bloque fiscal a una póliza construida por buildPoliza (F1),
 * en el ORDEN real observado para una póliza con UN CFDI:
 *   P → (M1 + AM)×n → I×k (retenciones y al final el traslado padre) →
 *   W2 → V → AD.
 *
 * (En pólizas reales con VARIOS comprobantes el orden es: todos los I
 * agrupados, luego pares W2+V por comprobante y los AD al final — ese
 * armado multi-CFDI queda para cuando el flujo lo requiera; el golden F2
 * lo reproduce vía reconstrucción fila a fila.)
 *
 * @param {{header: Array<*>, registros: Array<Array<*>>}} polizaConstruida
 *   - Salida de buildPoliza (P + M1[]).
 * @param {{uuid: string, is: Array<Array<*>>, w2: Array<*>, v: Array<*>,
 *   ad: Array<*>}} registrosFiscales - Salida de resolverFiscal (o filas
 *   construidas con estos builders).
 * @returns {{header: Array<*>, registros: Array<Array<*>>}} Póliza con el
 *   AM tras cada M1 y el bloque fiscal al final, lista para renderLayout.
 */
export function armarPolizaFiscal(polizaConstruida, registrosFiscales) {
  const { header, registros } = polizaConstruida ?? {};
  if (!Array.isArray(header) || !Array.isArray(registros)) {
    throw new ValidacionError('armarPolizaFiscal: se esperaba la salida de buildPoliza ({header, registros}).');
  }
  const rf = registrosFiscales;
  if (!rf || typeof rf.uuid !== 'string' || !Array.isArray(rf.is) || !Array.isArray(rf.w2) || !Array.isArray(rf.v) || !Array.isArray(rf.ad)) {
    throw new ValidacionError('armarPolizaFiscal: registrosFiscales inválidos (se esperaba {uuid, is, w2, v, ad} de resolverFiscal).');
  }

  const salida = [];
  for (const m1 of registros) {
    salida.push(m1.slice());
    salida.push(buildAM(rf.uuid));
  }
  for (const i of rf.is) salida.push(i.slice());
  salida.push(rf.w2.slice());
  salida.push(rf.v.slice());
  salida.push(rf.ad.slice());

  return { header: header.slice(), registros: salida };
}
