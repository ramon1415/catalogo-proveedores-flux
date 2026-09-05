/**
 * FB-6 · Lógica pura del ledger `accounting_exports` (sin DB real).
 *
 * El DDL borrador vive en sql/accounting_exports.sql; este módulo contiene
 * las funciones que la integración a Flux (tanda FB-2/FB-7) usará contra la
 * tabla real:
 * - yaExportado(registros, source, kind?): ¿este origen (y etapa) ya tiene
 *   un export VIGENTE?
 * - hashContenido(registrosPoliza): hash estable de las filas exportadas.
 * - planRegistro(contrato, poliza): la fila a insertar en el ledger.
 * - reglaCancelacion(registros, source): F3 — cancelar la provisión de un
 *   ciclo bloquea emitir su pago.
 *
 * F3 (ciclo de pólizas): un mismo origen puede producir HASTA DOS pólizas
 * — la provisión (diario al recibir factura) y el pago (egreso que salda)
 * en modo dos-polizas, o UNA ('directo') en modo egreso-directo. Las
 * etapas comparten `source` y se distinguen por `source_kind`
 * ('provision'|'pago'|'directo'): la idempotencia es por (source, kind).
 * El `kind` viene directo de las pólizas que emite procesarEvento
 * (src/ciclo/maquina.js).
 *
 * Core PURO y determinista: no toca DB, no llama Date.now(). El único borde
 * es el hasher por default (node:crypto), inyectable — mismo patrón que
 * generarGuidDefault en buildPoliza (F1).
 */

// [vendored] node:crypto removido para el navegador: hashFn es inyectable
// y la app SIEMPRE lo pasa (sha256Sync). El default truena explícito.
const createHash = null;

/** Días entre el epoch Unix y el epoch de Excel (igual que buildPoliza). */
const OFFSET_SERIAL_EXCEL = 25569;
const MS_POR_DIA = 86400000;

/**
 * Etapas (source_kind) válidas de un export dentro del ciclo (F3):
 * 'directo' = única póliza del modo egreso-directo; 'provision' y 'pago' =
 * las dos etapas del modo dos-polizas.
 */
export const SOURCE_KINDS = ['provision', 'pago', 'directo'];

/**
 * source_kind de una fila del ledger, tolerante a filas anteriores a F3
 * (sin la columna): se interpretan como 'directo' — que es exactamente lo
 * que eran (única póliza del origen).
 * @param {{source_kind?: string}} r - Fila de accounting_exports.
 * @returns {string}
 */
function kindDe(r) {
  return r.source_kind ?? 'directo';
}

/**
 * Hasher por default (borde del módulo): SHA-256 hex vía node:crypto.
 * El core solo lo usa si no se inyecta otro `hashFn`.
 * @param {string} texto - Contenido canónico a hashear.
 * @returns {string} Digest SHA-256 en hexadecimal.
 */
export function sha256HexDefault(texto) {
  throw new Error('hash_fn_required: inyecta hashFn (sha256 síncrono) — vendored sin node:crypto');
}

/**
 * Serialización CANÓNICA de las filas de una póliza (header P + registros
 * M1, como las produce buildPoliza): JSON de la matriz con `undefined`
 * normalizado a null. Determinista: mismas filas ⇒ mismo string, cualquier
 * celda distinta ⇒ string distinto.
 * @param {Array<Array<*>>} filas - Filas crudas (arrays de celdas).
 * @returns {string} Representación canónica.
 */
export function serializarFilas(filas) {
  if (!Array.isArray(filas)) {
    throw new TypeError('serializarFilas: se esperaba un arreglo de filas (arrays de celdas).');
  }
  return JSON.stringify(filas.map((fila) => fila.map((c) => (c === undefined ? null : c))));
}

/**
 * Hash ESTABLE del contenido exportado de una póliza. Mismas filas ⇒ mismo
 * hash (para detectar en el ledger si la data origen cambió tras exportar).
 * @param {Array<Array<*>>} registrosPoliza - Filas crudas de la póliza
 *   ([header, ...registros] de buildPoliza).
 * @param {(texto: string) => string} [hashFn] - Hasher inyectable
 *   (default: sha256HexDefault).
 * @returns {string} Hash del contenido.
 */
export function hashContenido(registrosPoliza, hashFn = sha256HexDefault) {
  return hashFn(serializarFilas(registrosPoliza));
}

/**
 * ¿El origen ya tiene un export VIGENTE (status 'exported')? Los registros
 * 'cancelled' NO cuentan: un origen cancelado puede re-exportarse (misma
 * semántica que el índice único parcial del DDL).
 *
 * F3: si se pasa `kind`, la pregunta es por ETAPA — ¿este origen ya tiene
 * un export vigente de esa etapa ('provision'|'pago'|'directo')? Así la
 * idempotencia del ciclo es por (source, kind): la provisión exportada no
 * bloquea exportar el pago del mismo origen, pero sí re-exportar la
 * provisión. Sin `kind` la semántica original se conserva (cualquier
 * export vigente del origen, sin importar etapa) — API previa intacta.
 *
 * @param {Array<{source_feeder: string, source_id: string, status: string,
 *   source_kind?: string}>} registros - Filas existentes de
 *   accounting_exports para consultar (en la integración real, el
 *   resultado del select por source). Filas sin source_kind (pre-F3)
 *   cuentan como 'directo'.
 * @param {{feeder: string, id: string|number}} source - Origen del contrato
 *   (contrato.control.source).
 * @param {'provision'|'pago'|'directo'} [kind] - Etapa del ciclo a
 *   consultar; omitirlo pregunta por el origen completo.
 * @returns {boolean} true si ya existe un export vigente de ese origen
 *   (y etapa, si se pidió).
 * @throws {TypeError} source inválido o kind fuera de SOURCE_KINDS.
 */
export function yaExportado(registros, source, kind) {
  if (!source || !source.feeder) {
    throw new TypeError('yaExportado: se esperaba source {feeder, id}.');
  }
  if (kind !== undefined && !SOURCE_KINDS.includes(kind)) {
    throw new TypeError(
      `yaExportado: kind "${kind}" inválido; debe ser uno de: ${SOURCE_KINDS.join(', ')} (u omitirse).`
    );
  }
  return (registros ?? []).some(
    (r) =>
      r.source_feeder === source.feeder &&
      String(r.source_id) === String(source.id) &&
      r.status === 'exported' &&
      (kind === undefined || kindDe(r) === kind)
  );
}

/**
 * F3 · Regla de cancelación del ciclo: si la PROVISIÓN de un origen fue
 * cancelada (y no re-exportada), emitir el PAGO queda BLOQUEADO — el pago
 * saldaría un pasivo de proveedor que ya no existe en la contabilidad, y
 * descuadraría la cuenta 201-XX. El desbloqueo es re-exportar la provisión
 * o cancelar el ciclo completo.
 *
 * Un origen SIN provisiones en el ledger no se bloquea: es un ciclo en
 * modo egreso-directo (o uno de dos-polizas aún sin provisión — ese orden
 * lo cuida la máquina de ciclo vía estadoCiclo, no el ledger).
 *
 * @param {Array<{source_feeder: string, source_id: string, status: string,
 *   source_kind?: string}>} registros - Filas de accounting_exports del
 *   origen (o superset).
 * @param {{feeder: string, id: string|number}} source - Origen del ciclo.
 * @returns {{pagoBloqueado: boolean, razon: string|null}} `razon` es
 *   accionable (qué pasó y cómo desbloquear); null cuando no hay bloqueo.
 */
export function reglaCancelacion(registros, source) {
  if (!source || !source.feeder) {
    throw new TypeError('reglaCancelacion: se esperaba source {feeder, id}.');
  }
  const provisiones = (registros ?? []).filter(
    (r) =>
      r.source_feeder === source.feeder &&
      String(r.source_id) === String(source.id) &&
      kindDe(r) === 'provision'
  );
  if (provisiones.length === 0) return { pagoBloqueado: false, razon: null };
  if (provisiones.some((r) => r.status === 'exported')) {
    return { pagoBloqueado: false, razon: null };
  }
  return {
    pagoBloqueado: true,
    razon:
      `La provisión de ${source.feeder}:${source.id} está CANCELADA sin re-export vigente; ` +
      'emitir el pago saldaría un pasivo de proveedor que ya no está contabilizado. ' +
      'Re-exportar la provisión (nuevo export source_kind=provision) o cancelar el ciclo completo.',
  };
}

/**
 * Serial de Excel → primer día del mes en ISO ('YYYY-MM-01') — el `periodo`
 * contable del ledger.
 * @param {number} serial - Serial de Excel (como emite buildPoliza en P col1).
 * @returns {string} 'YYYY-MM-01'.
 */
function periodoDesdeSerial(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) {
    throw new TypeError(`periodo: la fecha de la póliza no es un serial de Excel: ${JSON.stringify(serial)}`);
  }
  const iso = new Date((serial - OFFSET_SERIAL_EXCEL) * MS_POR_DIA).toISOString();
  return `${iso.slice(0, 7)}-01`;
}

/**
 * Arma la fila a insertar en accounting_exports para una póliza generada.
 * Pura: no inserta nada; `exported_at` solo se llena si se inyecta `ahora`
 * (si no, lo pone el default now() de la tabla).
 *
 * @param {object} contrato - Contrato canónico (FB-1) origen de la póliza.
 * @param {{header: Array<*>, registros: Array<Array<*>>}} poliza - Salida de
 *   buildPoliza (F1) para ese contrato — o una póliza de procesarEvento
 *   (F3), que trae además `kind`.
 * @param {{ahora?: string, hashFn?: (t: string) => string,
 *   kind?: 'provision'|'pago'|'directo'}} [opts] -
 *   `ahora`: timestamp ISO para exported_at (tests); `hashFn`: hasher
 *   inyectable para content_hash; `kind`: etapa del ciclo F3 para
 *   source_kind (default: `poliza.kind` si la póliza viene de
 *   procesarEvento, si no 'directo' — el comportamiento pre-F3).
 * @returns {{
 *   source_feeder: string, source_id: string, source_kind: string,
 *   company_id: string|null,
 *   tipo_pol: number, folio: number, periodo: string,
 *   uuid_cfdi: string|null, status: 'exported', content_hash: string,
 *   exported_at: string|null, cancelled_at: null, reversal_of: null
 * }} Fila lista para insert (nombres = columnas del DDL).
 */
export function planRegistro(contrato, poliza, opts = {}) {
  const source = contrato?.control?.source;
  if (!source?.feeder) {
    throw new TypeError('planRegistro: el contrato no trae control.source {feeder, id}.');
  }
  if (!poliza?.header || !Array.isArray(poliza.registros)) {
    throw new TypeError('planRegistro: se esperaba la salida de buildPoliza {header, registros}.');
  }
  const kind = opts.kind ?? poliza.kind ?? 'directo';
  if (!SOURCE_KINDS.includes(kind)) {
    throw new TypeError(
      `planRegistro: kind "${kind}" inválido; debe ser uno de: ${SOURCE_KINDS.join(', ')}.`
    );
  }

  // Columnas del header P (buildPoliza): [P, Fecha, TipoPol, Folio, ...].
  const [, fechaSerial, tipoPol, folio] = poliza.header;

  return {
    source_feeder: source.feeder,
    source_id: String(source.id),
    source_kind: kind,
    company_id: contrato.control.companyId ?? null,
    tipo_pol: tipoPol,
    folio,
    periodo: periodoDesdeSerial(fechaSerial),
    uuid_cfdi: contrato.cfdi?.uuid ?? null,
    status: 'exported',
    content_hash: hashContenido([poliza.header, ...poliza.registros], opts.hashFn),
    exported_at: opts.ahora ?? null,
    cancelled_at: null,
    reversal_of: null,
  };
}
