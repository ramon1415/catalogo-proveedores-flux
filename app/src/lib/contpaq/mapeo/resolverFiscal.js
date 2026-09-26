/**
 * F2 · Resolver FISCAL: contrato canónico (con CFDI parseado, FA-2) +
 * mapeo de empresa → registros fiscales del bloque de la póliza
 * (I traslado padre + I retenciones + W2 + V + AD), listos para
 * armarPolizaFiscal (que intercala el AM tras cada M1 y anexa el bloque).
 *
 * Reglas decodificadas del archivo real de junio 2026 (F0 §6/6b + golden F2):
 * - Un I TRASLADO (padre) por el IVA del CFDI: TipoMovimiento=1, DIOT de la
 *   config de empresa (default observado 201/201.03/301.01/100/1),
 *   IETUDeducible = base, ImpTotal = redondeo a centavos de base+IVA.
 * - Un I RETENCIÓN por CADA retención del CFDI (ISR=1 / IVA=2), ligado al
 *   padre por GuidMovPadre, DIOT en ceros, IETUDeducible=0, ImpTotal =
 *   importe de la retención, tasa = importe/base a 4 decimales (el CFDI no
 *   trae la tasa de las retenciones globales).
 * - ORDEN de emisión observado: retenciones PRIMERO (en el orden del CFDI)
 *   y el traslado padre AL FINAL (caso Lorenia: ret ISR, ret IVA, padre).
 * - V: ImpTotal / ImpSinRet = SUMA FLOTANTE base+IVA (así viene en el
 *   archivo real: COPPEL trae 62391.009999999995); GranTotal = neto pagado
 *   (ImpTotal − retenciones); IVARetenido/ISRRetenido del CFDI.
 * - Ejercicio/Periodo = de la fecha de PAGO del contrato (fallback: fecha
 *   de factura).
 * - IdCuenta (en I y V) = cuenta de BANCO del pago (verificación F0
 *   cerrada sobre los 59 I y 51 V reales).
 * - Serie/Folio/Referencia según serieFolioReferencia (folio numérico
 *   int32 → Folio; si no → Folio=0 y el folio crudo en Referencia).
 *
 * Determinismo: los GuidMov de los I son inyectables vía opts.generarGuid
 * (se generan en el ORDEN DE EMISIÓN: retenciones primero, padre al final);
 * el default vive en el borde (generarGuidDefault de F1).
 *
 * Módulo puro: sin fs, sin dependencias.
 */

import { MapeoError } from './resolver.js';
import { generarGuidDefault } from '../serializer/buildPoliza.js';
import {
  buildAD,
  buildI,
  buildV,
  buildW2,
  serieFolioReferencia,
  DIOT_DEFAULT,
  IMPUESTO_ISR,
  IMPUESTO_IVA,
  TIPO_MOV_RETENCION,
  TIPO_MOV_TRASLADO,
} from '../serializer/fiscal.js';

/** Claves SAT que este resolver traduce al catálogo interno CONTPAQ. */
const SAT_ISR = '001';
const SAT_IVA = '002';

/**
 * Redondea a n decimales (aritmética de porcentajes de tasa).
 * @param {number} x
 * @param {number} decimales
 * @returns {number}
 */
function redondear(x, decimales) {
  const f = 10 ** decimales;
  return Math.round(x * f) / f;
}

/**
 * Ejercicio y periodo desde una fecha 'YYYY-MM-DD'.
 * @param {string|undefined} fecha
 * @returns {{ejercicio: number, periodo: number}}
 * @throws {MapeoError} Si no hay fecha interpretable.
 */
function ejercicioPeriodo(fecha) {
  const m = /^(\d{4})-(\d{2})/.exec(fecha ?? '');
  if (!m) {
    throw new MapeoError(
      `resolverFiscal: no hay fecha de pago ni de factura interpretable para Ejercicio/Periodo (llegó ${JSON.stringify(fecha)}).`
    );
  }
  return { ejercicio: Number(m[1]), periodo: Number(m[2]) };
}

/**
 * Resuelve el bloque fiscal de un contrato con CFDI: registros I (padre +
 * retenciones), W2, V y AD, con los valores y la representación del
 * archivo real.
 *
 * @param {object} contrato - Contrato canónico VÁLIDO (FB-1) con `cfdi`
 *   (salida de parseCfdi). Sin CFDI no hay bloque fiscal:
 *   `registrosFiscales` regresa null.
 * @param {{
 *   proveedor?: Object<string, {cuenta?: string, idProveedor: number|string}>,
 *   banco?: Object<string, string>,
 *   diot?: {concepto, subconcepto, clasificador, proporcion, deducible}
 * }} mapeoEmpresa - `proveedor[businessId].idProveedor` (IdProveedor
 *   CONTPAQ), `banco[cuentaOrigenId]` (cuenta de banco del pago) y config
 *   DIOT de la empresa (default: DIOT_DEFAULT observado).
 * @param {{generarGuid?: () => string, empresaConfig?: object}} [opts] -
 *   `generarGuid` inyectable (orden de emisión: retenciones, luego padre);
 *   `empresaConfig` para transformar la cuenta de banco (transformCuenta).
 * @returns {{registrosFiscales: {uuid: string, is: Array<Array<*>>,
 *   w2: Array<*>, v: Array<*>, ad: Array<*>}|null}}
 * @throws {MapeoError} Si falta mapeo (idProveedor/banco), el CFDI trae un
 *   impuesto no soportado o no hay fecha para Ejercicio/Periodo.
 */
export function resolverFiscal(contrato, mapeoEmpresa, opts = {}) {
  if (!contrato?.control) {
    throw new TypeError('resolverFiscal: se esperaba un contrato canónico válido (usar validarContrato antes).');
  }
  if (!mapeoEmpresa || typeof mapeoEmpresa !== 'object') {
    throw new TypeError('resolverFiscal: se esperaba el mapeoEmpresa (proveedor/banco/diot).');
  }
  const cfdi = contrato.cfdi;
  if (!cfdi) return { registrosFiscales: null };

  const uuid = cfdi.uuid;
  if (typeof uuid !== 'string' || uuid.trim() === '') {
    throw new MapeoError(
      `resolverFiscal: el CFDI de ${contrato.control.idempotencyKey} no trae UUID (TimbreFiscalDigital) — sin UUID no hay AM/I/V/AD.`
    );
  }

  // ---- Mapeos requeridos, juntando faltantes (mismo criterio que FB) ----
  const faltantes = [];
  const businessId = contrato.contraparte?.businessId;
  const idProveedor = mapeoEmpresa.proveedor?.[businessId]?.idProveedor;
  if (idProveedor === undefined || idProveedor === null) faltantes.push(`proveedor:${businessId}`);
  const cuentaBanco = mapeoEmpresa.banco?.[contrato.efectivo?.cuentaOrigenId];
  if (!cuentaBanco) faltantes.push(`banco:${contrato.efectivo?.cuentaOrigenId}`);
  if (faltantes.length > 0) {
    throw new MapeoError(
      `Mapeo fiscal incompleto para ${contrato.control.idempotencyKey} ` +
        `(${contrato.control.concepto}): ${faltantes.length} id(s) sin dato CONTPAQ:\n- ${faltantes.join('\n- ')}`,
      faltantes
    );
  }

  // ---- Componentes de impuesto del CFDI ----
  let base = 0;
  let iva = 0;
  let tasaIva;
  for (const t of cfdi.impuestos?.traslados ?? []) {
    if (t.impuesto === SAT_IVA) {
      base += t.base ?? 0;
      iva += t.importe ?? 0;
      if (tasaIva === undefined && t.tasaOCuota !== undefined) {
        tasaIva = redondear(t.tasaOCuota * 100, 4); // fracción SAT → porcentaje
      }
    } else if ((t.importe ?? 0) !== 0) {
      throw new MapeoError(
        `resolverFiscal: traslado no soportado "${t.impuesto}" (importe ${t.importe}); solo IVA (002).`
      );
    }
  }
  tasaIva = tasaIva ?? 0;

  const retenciones = [];
  for (const r of cfdi.impuestos?.retenciones ?? []) {
    if (r.importe === 0) continue;
    if (r.impuesto !== SAT_ISR && r.impuesto !== SAT_IVA) {
      throw new MapeoError(
        `resolverFiscal: retención no soportada "${r.impuesto}" (importe ${r.importe}); solo ISR (001) e IVA (002).`
      );
    }
    retenciones.push({
      impuesto: r.impuesto === SAT_ISR ? IMPUESTO_ISR : IMPUESTO_IVA,
      importe: r.importe,
      // El CFDI no trae la tasa de las retenciones globales: se deriva de
      // importe/base a 4 decimales (real Lorenia: 1280/12000 → 10.6667).
      tasa: base > 0 ? redondear((r.importe / base) * 100, 4) : 0,
    });
  }

  // ---- Datos comunes ----
  const { ejercicio, periodo } = ejercicioPeriodo(
    contrato.control.fechaPago ?? contrato.control.fechaFactura
  );
  const sfr = serieFolioReferencia(cfdi.comprobante?.serie, cfdi.comprobante?.folio);
  const diot = mapeoEmpresa.diot ?? DIOT_DEFAULT;
  const generarGuid = opts.generarGuid ?? generarGuidDefault;
  const empresaConfig = opts.empresaConfig;

  const comunes = { idProveedor, ejercicio, periodo, cuentaBanco, uuid, ...sfr };

  // ---- Registros I: retenciones primero (orden del CFDI), padre al final ----
  const guidsRet = retenciones.map(() => generarGuid());
  const guidPadre = generarGuid();

  const is = retenciones.map((r, i) =>
    buildI(
      {
        ...comunes,
        tipoMovimiento: TIPO_MOV_RETENCION,
        impuesto: r.impuesto,
        tasa: r.tasa,
        base,
        importe: r.importe,
        impTotal: r.importe,
        guidMov: guidsRet[i],
        guidMovPadre: guidPadre,
      },
      empresaConfig
    )
  );
  is.push(
    buildI(
      {
        ...comunes,
        tipoMovimiento: TIPO_MOV_TRASLADO,
        impuesto: IMPUESTO_IVA,
        tasa: tasaIva,
        base,
        importe: iva,
        // En el I el total va redondeado a centavos (el archivo real trae
        // 62391.01 en I y la suma flotante cruda en V).
        impTotal: redondear(base + iva, 2),
        guidMov: guidPadre,
        diot,
      },
      empresaConfig
    )
  );

  // ---- W2 + V + AD ----
  const retIva = retenciones
    .filter((r) => r.impuesto === IMPUESTO_IVA)
    .reduce((s, r) => s + r.importe, 0);
  const retIsr = retenciones
    .filter((r) => r.impuesto === IMPUESTO_ISR)
    .reduce((s, r) => s + r.importe, 0);

  // Suma FLOTANTE deliberada: reproduce la aritmética del archivo real.
  const impTotalV = base + iva;
  const granTotal = impTotalV - retIva - retIsr;

  const w2 = buildW2(base);
  const v = buildV(
    {
      idProveedor,
      impTotal: impTotalV,
      porIVA: tasaIva,
      base,
      iva,
      ...sfr,
      impSinRet: impTotalV,
      ivaRetenido: retIva,
      isrRetenido: retIsr,
      granTotal,
      ejercicio,
      periodo,
      cuentaBanco,
      uuid,
      rfc: cfdi.emisor?.rfc ?? contrato.contraparte?.rfc,
    },
    empresaConfig
  );
  const ad = buildAD(uuid);

  return { registrosFiscales: { uuid, is, w2, v, ad } };
}
