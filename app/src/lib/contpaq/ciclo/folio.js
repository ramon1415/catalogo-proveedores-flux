/**
 * F3 · Folio provider — asignación de folios de póliza, parametrizada.
 *
 * La numeración de folio es una de las DOS respuestas pendientes de
 * contabilidad (junto con el modo del ciclo, ver maquina.js). Por eso este
 * módulo NO fija una regla: expone estrategias seleccionables por config —
 * la respuesta contable ELIGE, no cambia código (mismo patrón que
 * 213-08/213-09 vs 216-04/216-10 en el mapeo de retenciones).
 *
 * Estrategias (`config.estrategia`):
 * - 'consecutivo-por-tipo' (DEFAULT): una secuencia independiente por
 *   TipoPol (1/2/3). HIPÓTESIS VERIFICADA contra el archivo real de junio
 *   2026 de OPT (78 pólizas): ingresos 1..13, egresos 1..47, diarios 1..16 —
 *   explica 76/78 folios (97.4%). Las 2 anomalías son los egresos con folio
 *   218 y 221 ("FRANCISCO JESUS PEREZ"), fuera de la secuencia — probable
 *   captura manual u otra numeradora. Ver test de hipótesis en
 *   test/ciclo.test.js.
 * - 'consecutivo-global': una sola secuencia para todos los TipoPol.
 *   DESCARTADA por los datos de junio (los folios se repiten entre tipos:
 *   1..47 ∪ 1..13 ∪ 1..16 solo tienen 47 valores únicos — a lo más 47/78).
 *
 * Reinicio (`config.reinicio`):
 * - 'mensual' (DEFAULT): al cambiar el mes de la fecha de asignación, todas
 *   las secuencias vuelven a empezar en 1.
 *   CONFIRMADO con junio + julio 2026 de OPT. Junio cierra en 13 / 47 / 16
 *   (ingresos/egresos/diarios) y julio ARRANCA EN 1 para los tres. Sin
 *   reinicio, julio habría empezado en 14 / 48 / 17. Con un solo mes no se
 *   podía distinguir del arranque de numeración; con dos, sí.
 * - 'nunca': la secuencia corre continua entre meses. Descartada por los
 *   datos, se conserva por si otra empresa numera distinto.

 * SERIE MANUAL (`config.rangoManualDesde`, default 200):
 * Los egresos con folio ≥ 200 NO los produce la numeradora automática: son
 * captura manual con su propio contador, que además NO se reinicia. En el
 * archivo real: junio 218 y 221, julio 220, 222, 223 y 224 — una sola serie
 * continua que atraviesa los meses mientras la automática se reinicia.
 * El provider nunca asigna en ese rango y falla si la secuencia lo alcanza,
 * porque llegar ahí significaría colisionar con un folio capturado a mano.
 *
 * ESTADO INYECTABLE: el provider opera sobre un objeto plano serializable
 * (`config.estado`) que el caller conserva y persiste (futuro: una fila de
 * config/contadores en DB). `crearFolioProvider` NO guarda estado oculto:
 * mismo estado inyectado ⇒ mismos folios.
 *
 * Módulo puro: sin fs, sin dependencias.
 */

/** Días entre el epoch Unix y el epoch de Excel (igual que buildPoliza). */
const OFFSET_SERIAL_EXCEL = 25569;
const MS_POR_DIA = 86400000;

/** Estrategias de numeración soportadas. */
export const ESTRATEGIAS_FOLIO = ['consecutivo-por-tipo', 'consecutivo-global'];

/** Políticas de reinicio soportadas. */
export const REINICIOS_FOLIO = ['nunca', 'mensual'];

/**
 * Config default: la hipótesis GANADORA del análisis de junio (por tipo,
 * sin reinicio). La respuesta de contabilidad la confirma o la cambia —
 * por config, nunca por código.
 */
export const FOLIO_CONFIG_DEFAULT = Object.freeze({
  estrategia: 'consecutivo-por-tipo',
  reinicio: 'mensual',
  rangoManualDesde: 200,
});

/** Error de asignación de folio con mensaje accionable. */
export class FolioError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FolioError';
  }
}

/**
 * Normaliza una fecha a periodo 'YYYY-MM' (para el reinicio mensual).
 * Acepta 'YYYY-MM-DD' (con o sin hora), Date, o serial de Excel numérico
 * (representación del archivo real).
 * @param {string|number|Date} fecha
 * @returns {string} 'YYYY-MM'.
 * @throws {FolioError} Si la fecha no es interpretable.
 */
export function periodoDeFecha(fecha) {
  if (typeof fecha === 'number' && Number.isFinite(fecha)) {
    return new Date((fecha - OFFSET_SERIAL_EXCEL) * MS_POR_DIA).toISOString().slice(0, 7);
  }
  if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
    return fecha.toISOString().slice(0, 7);
  }
  if (typeof fecha === 'string' && /^\d{4}-\d{2}/.test(fecha.trim())) {
    return fecha.trim().slice(0, 7);
  }
  throw new FolioError(
    `periodoDeFecha: fecha no interpretable ${JSON.stringify(fecha)} ` +
      `(se acepta 'YYYY-MM-DD', Date o serial de Excel).`
  );
}

/**
 * Crea el provider de folios.
 *
 * @param {{
 *   estrategia?: 'consecutivo-por-tipo'|'consecutivo-global',
 *   reinicio?: 'nunca'|'mensual',
 *   rangoManualDesde?: number,
 *   estado?: {ultimos?: Object<string, number>, periodo?: string}
 * }} [config] - Estrategia + reinicio (defaults FOLIO_CONFIG_DEFAULT) y el
 *   ESTADO inyectado: `ultimos` mapea clave de secuencia (TipoPol como
 *   string, o 'global') → último folio asignado; `periodo` es el 'YYYY-MM'
 *   de la última asignación (solo lo usa el reinicio mensual). El provider
 *   MUTA este objeto (y lo expone como `.estado`) para que el caller lo
 *   persista tras cada asignación.
 * @returns {{
 *   asignarFolio: (tipoPol: number|string, fecha: string|number|Date) => number,
 *   estado: {ultimos: Object<string, number>, periodo?: string}
 * }}
 * @throws {FolioError} Si la estrategia o el reinicio no son válidos.
 */
export function crearFolioProvider(config = {}) {
  const estrategia = config.estrategia ?? FOLIO_CONFIG_DEFAULT.estrategia;
  const reinicio = config.reinicio ?? FOLIO_CONFIG_DEFAULT.reinicio;
  const rangoManualDesde = config.rangoManualDesde ?? FOLIO_CONFIG_DEFAULT.rangoManualDesde;
  if (!Number.isInteger(rangoManualDesde) || rangoManualDesde < 1) {
    throw new FolioError(
      `crearFolioProvider: rangoManualDesde debe ser un entero ≥ 1, se recibió ${JSON.stringify(rangoManualDesde)}.`
    );
  }
  if (!ESTRATEGIAS_FOLIO.includes(estrategia)) {
    throw new FolioError(
      `crearFolioProvider: estrategia "${estrategia}" inválida; debe ser una de: ${ESTRATEGIAS_FOLIO.join(', ')}.`
    );
  }
  if (!REINICIOS_FOLIO.includes(reinicio)) {
    throw new FolioError(
      `crearFolioProvider: reinicio "${reinicio}" inválido; debe ser uno de: ${REINICIOS_FOLIO.join(', ')}.`
    );
  }

  const estado = config.estado ?? {};
  if (typeof estado !== 'object' || Array.isArray(estado)) {
    throw new FolioError('crearFolioProvider: estado debe ser un objeto plano serializable.');
  }
  estado.ultimos = estado.ultimos ?? {};

  /**
   * Asigna el siguiente folio de la secuencia que corresponda.
   * @param {number|string} tipoPol - TipoPol CONTPAQ de la póliza (1/2/3).
   *   Requerido aun en estrategia global (queda registrado el contrato de
   *   la interfaz y permite cambiar de estrategia sin tocar callers).
   * @param {string|number|Date} fecha - Fecha de la póliza; solo se
   *   interpreta cuando reinicio='mensual'.
   * @returns {number} Folio asignado (≥ 1).
   * @throws {FolioError} tipoPol ausente, fecha no interpretable con
   *   reinicio mensual, o asignación con fecha de un mes ANTERIOR al del
   *   estado (fuera de orden — el reinicio mensual exige asignar en orden
   *   de periodo).
   */
  function asignarFolio(tipoPol, fecha) {
    if (tipoPol === undefined || tipoPol === null || String(tipoPol).trim() === '') {
      throw new FolioError('asignarFolio: tipoPol requerido (TipoPol CONTPAQ de la póliza).');
    }
    if (reinicio === 'mensual') {
      const mes = periodoDeFecha(fecha);
      if (estado.periodo !== undefined && mes < estado.periodo) {
        throw new FolioError(
          `asignarFolio: asignación fuera de orden — fecha del periodo ${mes} con el ` +
            `contador ya en ${estado.periodo}. Con reinicio mensual los folios se ` +
            'asignan en orden de periodo; para re-emitir un mes cerrado, inyectar ' +
            'el estado de ese mes.'
        );
      }
      if (estado.periodo !== mes) {
        estado.periodo = mes;
        estado.ultimos = {};
      }
    }
    const clave = estrategia === 'consecutivo-global' ? 'global' : String(Number(tipoPol));
    const siguiente = (estado.ultimos[clave] ?? 0) + 1;
    if (siguiente >= rangoManualDesde) {
      throw new FolioError(
        `asignarFolio: la secuencia automática llegó a ${siguiente}, dentro del rango ` +
          `reservado a la serie manual (≥ ${rangoManualDesde}). Asignar ahí colisionaría ` +
          'con un folio capturado a mano en CONTPAQ. Revisar el contador o subir el rango.'
      );
    }
    estado.ultimos[clave] = siguiente;
    return siguiente;
  }

  return { asignarFolio, estado };
}
