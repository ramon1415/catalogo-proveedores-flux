/**
 * FB-1 · Contrato canónico Feeder-B → módulo CONTPAQ.
 *
 * El contrato es la estructura NEUTRA que producen los adapters (solicitudes
 * de pago, nómina, ...) y que consume el resolver de mapeo para armar los
 * asientos de buildPoliza (F1). Regla central del diseño: el contrato NO
 * lleva cuentas CONTPAQ — solo ids de negocio (partida, banco, proveedor);
 * las cuentas las pone el mapeo por empresa (src/mapeo/resolver.js).
 *
 * Forma:
 * {
 *   control: {
 *     empresa,            // id/nombre lógico de la empresa emisora de la póliza
 *     companyId?,         // uuid de la empresa en Flux (para el ledger)
 *     tipo,               // 'egreso' | 'diario' | 'ingreso' (semántica F0 §3)
 *     fechaFactura?,      // 'YYYY-MM-DD' — fecha del CFDI
 *     fechaPago?,         // 'YYYY-MM-DD' — fecha del pago (paid_at)
 *     referencia,         // request_number o serie-folio del CFDI
 *     concepto,           // concepto de la póliza
 *     idempotencyKey,     // p. ej. 'pr:<uuid>' — clave del ledger
 *     source: { feeder, id }  // origen exacto ('flux', id de la fila)
 *   },
 *   contraparte: { rfc, nombre, personaTipo?, regimenFiscal?, businessId?,
 *                  counterpartyCompanyId? },
 *   distribucion: [ { partidaId, centroCostosId?, importeBase } ],
 *   efectivo: { cuentaOrigenId, metodoPago?, monto, moneda, tipoCambio },
 *   cfdi?: <salida de parseCfdi (FA-2)>
 * }
 *
 * Módulo puro: sin fs, sin dependencias.
 */

/** Tipos de póliza válidos (semántica de negocio, F0 §3). */
export const TIPOS_CONTRATO = ['egreso', 'diario', 'ingreso'];

/** RFC genérico SAT: 3-4 letras + fecha + homoclave (12 moral / 13 física). */
const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;

/** Fecha del contrato: 'YYYY-MM-DD' (con o sin hora ISO a continuación). */
const RE_FECHA = /^\d{4}-\d{2}-\d{2}/;

/** Error de contrato canónico inválido, con la lista de problemas. */
export class ContratoError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [detalles] - Problemas individuales acumulados.
   */
  constructor(message, detalles = []) {
    super(message);
    this.name = 'ContratoError';
    this.detalles = detalles;
  }
}

/**
 * ¿Es un string no vacío (tras trim)?
 * @param {*} v
 * @returns {boolean}
 */
function esTexto(v) {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * ¿Es un número finito?
 * @param {*} v
 * @returns {boolean}
 */
function esNumero(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Valida el contrato canónico. Junta TODOS los problemas (no se detiene en
 * el primero) para que el error sea accionable de una sola pasada — mismo
 * criterio que validarPoliza (F1-5).
 *
 * Reglas:
 * - control: empresa/tipo/referencia/concepto/idempotencyKey/source requeridos;
 *   tipo ∈ TIPOS_CONTRATO; fechas (si vienen) en 'YYYY-MM-DD'.
 * - contraparte: rfc (formato SAT) y nombre requeridos; personaTipo (si viene)
 *   ∈ {'fisica','moral'}.
 * - distribucion: al menos una línea; cada línea con partidaId e importeBase
 *   numérico finito ≠ 0 (negativos permitidos: notas de crédito futuras).
 * - efectivo: requerido para egreso/ingreso (afectan banco, F0 §3); opcional
 *   para diario (provisiones no tocan banco). Si viene: cuentaOrigenId,
 *   monto finito > 0, moneda, tipoCambio finito > 0.
 * - cfdi (si viene): estructura mínima de parseCfdi; en egresos el RFC del
 *   emisor debe coincidir con la contraparte (nos están facturando).
 *
 * @param {object} contrato - Contrato canónico (ver forma arriba).
 * @returns {{ok: boolean, errores: string[]}}
 */
export function validarContrato(contrato) {
  const errores = [];
  if (!contrato || typeof contrato !== 'object') {
    return { ok: false, errores: ['El contrato debe ser un objeto.'] };
  }

  // ---- control ----
  const c = contrato.control;
  if (!c || typeof c !== 'object') {
    errores.push('control: requerido (empresa, tipo, referencia, concepto, idempotencyKey, source).');
  } else {
    if (!esTexto(c.empresa)) errores.push('control.empresa: requerido (id/nombre lógico de la empresa).');
    if (!TIPOS_CONTRATO.includes(c.tipo)) {
      errores.push(`control.tipo: "${c.tipo}" inválido; debe ser uno de: ${TIPOS_CONTRATO.join(', ')}.`);
    }
    for (const campo of ['fechaFactura', 'fechaPago']) {
      if (c[campo] !== undefined && !(esTexto(c[campo]) && RE_FECHA.test(c[campo]))) {
        errores.push(`control.${campo}: "${c[campo]}" no tiene formato 'YYYY-MM-DD'.`);
      }
    }
    if (!esTexto(c.referencia)) errores.push('control.referencia: requerida (request_number o serie-folio del CFDI).');
    if (!esTexto(c.concepto)) errores.push('control.concepto: requerido.');
    if (!esTexto(c.idempotencyKey)) errores.push('control.idempotencyKey: requerida (p. ej. "pr:<id>").');
    if (!c.source || typeof c.source !== 'object' || !esTexto(c.source.feeder) || !esTexto(String(c.source.id ?? ''))) {
      errores.push('control.source: requerido con {feeder, id} (origen exacto del contrato).');
    }
  }

  // ---- contraparte ----
  const cp = contrato.contraparte;
  if (!cp || typeof cp !== 'object') {
    errores.push('contraparte: requerida (rfc, nombre).');
  } else {
    if (!esTexto(cp.rfc) || !RE_RFC.test(cp.rfc.trim().toUpperCase())) {
      errores.push(`contraparte.rfc: "${cp.rfc}" no es un RFC válido (formato SAT 12/13).`);
    }
    if (!esTexto(cp.nombre)) errores.push('contraparte.nombre: requerido.');
    if (cp.personaTipo !== undefined && !['fisica', 'moral'].includes(cp.personaTipo)) {
      errores.push(`contraparte.personaTipo: "${cp.personaTipo}" inválido; debe ser 'fisica' o 'moral'.`);
    }
  }

  // ---- distribucion ----
  const dist = contrato.distribucion;
  if (!Array.isArray(dist) || dist.length === 0) {
    errores.push('distribucion: se requiere al menos una línea {partidaId, importeBase}.');
  } else {
    for (const [i, linea] of dist.entries()) {
      if (!linea || typeof linea !== 'object') {
        errores.push(`distribucion[${i}]: debe ser un objeto {partidaId, importeBase}.`);
        continue;
      }
      if (!esTexto(String(linea.partidaId ?? ''))) {
        errores.push(`distribucion[${i}].partidaId: requerido (id de partida/categoría presupuestal).`);
      }
      if (!esNumero(linea.importeBase) || linea.importeBase === 0) {
        errores.push(
          `distribucion[${i}].importeBase: ${JSON.stringify(linea.importeBase)} inválido; ` +
            'debe ser número finito distinto de 0.'
        );
      }
    }
  }

  // ---- efectivo ----
  const ef = contrato.efectivo;
  const tipo = c?.tipo;
  if (ef === undefined || ef === null) {
    if (tipo === 'egreso' || tipo === 'ingreso') {
      errores.push(`efectivo: requerido para tipo "${tipo}" (afecta banco).`);
    }
  } else if (typeof ef !== 'object') {
    errores.push('efectivo: debe ser un objeto {cuentaOrigenId, monto, moneda, tipoCambio}.');
  } else {
    if (!esTexto(String(ef.cuentaOrigenId ?? ''))) {
      errores.push('efectivo.cuentaOrigenId: requerido (id de la cuenta bancaria de la empresa).');
    }
    if (!esNumero(ef.monto) || ef.monto <= 0) {
      errores.push(`efectivo.monto: ${JSON.stringify(ef.monto)} inválido; debe ser número finito > 0.`);
    }
    if (!esTexto(ef.moneda)) errores.push('efectivo.moneda: requerida (p. ej. "MXN").');
    if (!esNumero(ef.tipoCambio) || ef.tipoCambio <= 0) {
      errores.push(`efectivo.tipoCambio: ${JSON.stringify(ef.tipoCambio)} inválido; debe ser número finito > 0.`);
    }
  }

  // ---- cfdi (opcional, estructura de parseCfdi) ----
  const cfdi = contrato.cfdi;
  if (cfdi !== undefined && cfdi !== null) {
    if (typeof cfdi !== 'object' || !cfdi.comprobante || !cfdi.emisor) {
      errores.push('cfdi: si viene, debe ser la salida de parseCfdi (con comprobante y emisor).');
    } else {
      if (!esNumero(cfdi.comprobante.subTotal) || !esNumero(cfdi.comprobante.total)) {
        errores.push('cfdi.comprobante: subTotal y total deben ser numéricos (salida de parseCfdi).');
      }
      if (
        tipo === 'egreso' &&
        esTexto(cp?.rfc) &&
        esTexto(cfdi.emisor.rfc) &&
        cp.rfc.trim().toUpperCase() !== cfdi.emisor.rfc.trim().toUpperCase()
      ) {
        errores.push(
          `cfdi.emisor.rfc "${cfdi.emisor.rfc}" no coincide con contraparte.rfc "${cp.rfc}" ` +
            '(en un egreso el emisor del CFDI es el proveedor).'
        );
      }
    }
  }

  return { ok: errores.length === 0, errores };
}

/**
 * Valida y lanza ContratoError si el contrato es inválido; útil como gate
 * en los adapters.
 * @param {object} contrato
 * @returns {object} El mismo contrato (válido).
 * @throws {ContratoError} Con los problemas acumulados en `detalles`.
 */
export function assertContrato(contrato) {
  const r = validarContrato(contrato);
  if (!r.ok) {
    throw new ContratoError(
      `Contrato canónico inválido (${r.errores.length} problema(s)):\n- ` + r.errores.join('\n- '),
      r.errores
    );
  }
  return contrato;
}
