/**
 * Mapeo + armado de asientos: contrato canónico (FB-1) → asientos[] para
 * buildPoliza (F1).
 *
 * El contrato trae IDS de negocio (partida, banco, proveedor); este módulo
 * los resuelve a cuentas CONTPAQ con el `mapeoEmpresa` y arma los asientos
 * según el PATRÓN REAL del formato (spec F0 §6b, decodificado de las pólizas
 * de junio 2026):
 *
 * Egreso con CFDI y retenciones (caso Lorenia Atondo — honorarios PF):
 *   cargo  gasto (base, por línea de distribución)
 *   cargo  IVA acreditable pagado = IVA trasladado − IVA retenido
 *   cargo  IVA retenido acreditable (= ret IVA)
 *   abono  pasivo ret IVA
 *   abono  pasivo ret ISR
 *   abono  banco = neto (base + IVA − retenciones)
 *
 * Egreso con CFDI sin retenciones (caso COPPEL):
 *   cargo gasto + cargo IVA acreditable + abono banco (= total).
 *
 * Egreso sin CFDI (provisión formal aún no soportada en esta tanda):
 *   cargo(s) gasto por distribución + abono banco por el mismo monto.
 *
 * Todo se calcula en CENTAVOS ENTEROS, así el resultado cuadra por
 * construcción (validateCuadre de F1 con tolerancia 0).
 *
 * Módulo puro: sin fs, sin dependencias.
 */

/** Claves SAT de impuestos que este resolver entiende. */
const SAT_ISR = '001';
const SAT_IVA = '002';

/**
 * Error de mapeo incompleto: `faltantes` lista cada id de negocio sin cuenta
 * asignada, en formato `tipo:id` — insumo directo para el futuro tab de
 * config que resalta no-mapeados (FB-3).
 */
export class MapeoError extends Error {
  /**
   * @param {string} message
   * @param {string[]} faltantes - Ids sin mapeo, como 'partida:<id>',
   *   'banco:<id>', 'impuesto:<clave>'.
   */
  constructor(message, faltantes = []) {
    super(message);
    this.name = 'MapeoError';
    this.faltantes = faltantes;
  }
}

/**
 * Convierte a centavos enteros (misma regla que validate.js de F1).
 * @param {number} importe
 * @returns {number}
 */
function cent(importe) {
  return Math.round((importe ?? 0) * 100);
}

/**
 * Suma los importes de impuestos del CFDI, separados por clave SAT.
 * @param {object|undefined} cfdi - Salida de parseCfdi.
 * @returns {{ivaTrasladoCent: number, retIvaCent: number, retIsrCent: number}}
 * @throws {MapeoError} Si el CFDI trae un impuesto que el resolver no soporta
 *   (p. ej. IEPS trasladado) — mejor tronar claro que contabilizar mal.
 */
function impuestosCfdi(cfdi) {
  let ivaTrasladoCent = 0;
  let retIvaCent = 0;
  let retIsrCent = 0;
  for (const t of cfdi?.impuestos?.traslados ?? []) {
    if (t.impuesto === SAT_IVA) {
      ivaTrasladoCent += cent(t.importe ?? 0);
    } else if (cent(t.importe ?? 0) !== 0) {
      throw new MapeoError(
        `CFDI con impuesto trasladado no soportado: "${t.impuesto}" ` +
          `(importe ${t.importe}). Este resolver solo maneja IVA (002).`
      );
    }
  }
  for (const r of cfdi?.impuestos?.retenciones ?? []) {
    if (r.impuesto === SAT_IVA) retIvaCent += cent(r.importe);
    else if (r.impuesto === SAT_ISR) retIsrCent += cent(r.importe);
    else if (cent(r.importe) !== 0) {
      throw new MapeoError(
        `CFDI con retención no soportada: "${r.impuesto}" (importe ${r.importe}). ` +
          'Este resolver solo maneja ISR (001) e IVA (002).'
      );
    }
  }
  return { ivaTrasladoCent, retIvaCent, retIsrCent };
}

/**
 * Resuelve el contrato canónico a asientos para buildPoliza (F1) usando el
 * mapeo de la empresa.
 *
 * @param {object} contrato - Contrato canónico VÁLIDO (FB-1). Debe ser de
 *   tipo 'egreso' (único flujo de esta tanda).
 * @param {{
 *   partida: Object<string, string>,
 *   banco: Object<string, string>,
 *   proveedor?: Object<string, {cuenta: string, idProveedor: number|string}>,
 *   impuesto: {
 *     ivaAcreditablePagado?: string,
 *     ivaRetenidoAcreditable?: string,
 *     retIvaPasivo?: string,
 *     retIsrPasivo?: string
 *   },
 *   cuentasEspeciales?: {ajusteRedondeo?: string, noDeducibles?: string}
 * }} mapeoEmpresa - Cuentas CONTPAQ por id de negocio (con o sin guiones;
 *   transformCuenta de F1 normaliza).
 * @returns {Array<{cuenta: string, tipoMovto: 'cargo'|'abono', importe: number,
 *   referencia: string, concepto: string}>} Asientos en el orden del patrón
 *   real (cargos gasto → cargos IVA → abonos pasivos → abono banco); cuadran
 *   por construcción.
 * @throws {MapeoError} Si falta el mapeo de algún id del contrato — junta
 *   TODOS los faltantes en `faltantes` antes de tronar.
 */
export function resolverAsientos(contrato, mapeoEmpresa) {
  if (!contrato?.control || !Array.isArray(contrato.distribucion)) {
    throw new TypeError('resolverAsientos: se esperaba un contrato canónico válido (usar validarContrato antes).');
  }
  if (!mapeoEmpresa || typeof mapeoEmpresa !== 'object') {
    throw new TypeError('resolverAsientos: se esperaba el mapeoEmpresa (partida/banco/impuesto/...).');
  }
  if (contrato.control.tipo !== 'egreso') {
    throw new MapeoError(
      `resolverAsientos solo soporta contratos tipo 'egreso' en esta tanda; ` +
        `llegó "${contrato.control.tipo}" (nómina/diario: tanda FB-5).`
    );
  }

  const cfdi = contrato.cfdi;
  const { ivaTrasladoCent, retIvaCent, retIsrCent } = cfdi
    ? impuestosCfdi(cfdi)
    : { ivaTrasladoCent: 0, retIvaCent: 0, retIsrCent: 0 };

  // ---- Recolección de mapeos, juntando TODOS los faltantes ----
  const faltantes = [];
  const impuesto = mapeoEmpresa.impuesto ?? {};

  const lineas = contrato.distribucion.map((linea) => {
    const cuenta = mapeoEmpresa.partida?.[linea.partidaId];
    if (!cuenta) faltantes.push(`partida:${linea.partidaId}`);
    return { cuenta, baseCent: cent(linea.importeBase) };
  });

  const cuentaBanco = mapeoEmpresa.banco?.[contrato.efectivo?.cuentaOrigenId];
  if (!cuentaBanco) faltantes.push(`banco:${contrato.efectivo?.cuentaOrigenId}`);

  if (ivaTrasladoCent > 0 && !impuesto.ivaAcreditablePagado) {
    faltantes.push('impuesto:ivaAcreditablePagado');
  }
  if (retIvaCent > 0) {
    if (!impuesto.ivaRetenidoAcreditable) faltantes.push('impuesto:ivaRetenidoAcreditable');
    if (!impuesto.retIvaPasivo) faltantes.push('impuesto:retIvaPasivo');
  }
  if (retIsrCent > 0 && !impuesto.retIsrPasivo) {
    faltantes.push('impuesto:retIsrPasivo');
  }

  if (faltantes.length > 0) {
    throw new MapeoError(
      `Mapeo incompleto para ${contrato.control.idempotencyKey} ` +
        `(${contrato.control.concepto}): ${faltantes.length} id(s) sin cuenta CONTPAQ ` +
        `asignada:\n- ${faltantes.join('\n- ')}\n` +
        'Asignar las cuentas en la config de mapeo de la empresa (tab Mapeo/Impuestos, FB-3).',
      faltantes
    );
  }

  // ---- Armado de asientos (patrón F0 §6b), todo en centavos ----
  const referencia = contrato.control.referencia;
  const concepto = contrato.control.concepto;
  const asiento = (cuenta, tipoMovto, importeCent) => ({
    cuenta,
    tipoMovto,
    importe: importeCent / 100,
    referencia,
    concepto,
  });

  const asientos = [];
  let basesCent = 0;

  // Cargos de gasto: una línea por partida de la distribución.
  for (const l of lineas) {
    basesCent += l.baseCent;
    asientos.push(asiento(l.cuenta, 'cargo', l.baseCent));
  }

  if (!cfdi) {
    // Sin CFDI: monto directo gasto vs banco (la provisión formal con cuenta
    // de pasivo proveedor no está soportada en esta tanda).
    asientos.push(asiento(cuentaBanco, 'abono', basesCent));
    return asientos;
  }

  // IVA acreditable pagado = IVA trasladado − IVA retenido (patrón 6b: solo
  // el IVA neto tras retención es acreditable-pagado; el retenido va aparte).
  const ivaAcredCent = ivaTrasladoCent - retIvaCent;
  if (ivaAcredCent !== 0) {
    asientos.push(asiento(impuesto.ivaAcreditablePagado, 'cargo', ivaAcredCent));
  }
  if (retIvaCent > 0) {
    asientos.push(asiento(impuesto.ivaRetenidoAcreditable, 'cargo', retIvaCent));
    asientos.push(asiento(impuesto.retIvaPasivo, 'abono', retIvaCent));
  }
  if (retIsrCent > 0) {
    asientos.push(asiento(impuesto.retIsrPasivo, 'abono', retIsrCent));
  }

  // Abono banco = neto pagado. Se calcula desde las mismas piezas para que
  // la póliza cuadre POR CONSTRUCCIÓN:
  //   cargos = bases + (IVA−retIVA) + retIVA = bases + IVA
  //   abonos = retIVA + retISR + neto  ⇒  neto = bases + IVA − retIVA − retISR.
  const netoCent = basesCent + ivaTrasladoCent - retIvaCent - retIsrCent;
  asientos.push(asiento(cuentaBanco, 'abono', netoCent));

  return asientos;
}
