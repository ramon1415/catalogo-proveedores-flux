/**
 * FB-4 · Adapter payment_requests (Flux) → contrato canónico.
 *
 * Función PURA: recibe la fila de `payment_requests` (columnas reales de
 * Flux) más sus objetos anidados opcionales (`proveedor`, `cfdiParseado`)
 * y produce el contrato canónico de FB-1. NO resuelve cuentas contables —
 * eso es del mapeo por empresa (src/mapeo/resolver.js).
 *
 * Reglas de mapeo (spec Feeder-B):
 * - tipo: 'egreso' (una solicitud de pago pagada disminuye banco, F0 §3).
 * - fechaFactura = cfdi.comprobante.fecha (si hay CFDI); fechaPago = paid_at.
 * - referencia = request_number, o serie-folio del CFDI como fallback.
 * - idempotencyKey = `pr:${id}`; source = { feeder: 'flux', id }.
 * - distribucion: UNA línea con budget_category_id + cost_center_id; base =
 *   SubTotal del CFDI si hay, si no amount_requested (sin CFDI el monto es
 *   el único dato — la provisión formal es de F2/tanda posterior).
 *
 * Módulo puro: sin fs, sin dependencias, sin acceso a DB.
 */

import { assertContrato } from '../contrato/schema.js';

/**
 * Recorta un timestamp (ISO o Date) a fecha 'YYYY-MM-DD'; undefined si viene vacío.
 * @param {string|Date|undefined|null} v
 * @returns {string|undefined}
 */
function aFecha(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const s = v instanceof Date ? v.toISOString() : String(v);
  return s.slice(0, 10);
}

/**
 * Serie-folio del CFDI ("DEAAA-390122", "F-2025"); undefined si no hay datos.
 * @param {object|undefined} cfdi - Salida de parseCfdi.
 * @returns {string|undefined}
 */
function serieFolio(cfdi) {
  const partes = [cfdi?.comprobante?.serie, cfdi?.comprobante?.folio].filter(
    (p) => p !== undefined && p !== null && String(p).trim() !== ''
  );
  return partes.length > 0 ? partes.join('-') : undefined;
}

/**
 * Convierte una fila de `payment_requests` de Flux al contrato canónico.
 *
 * @param {{
 *   id: string,
 *   provider_id?: string, proveedor_id?: string,
 *   cost_center_id?: string, company_id?: string, budget_category_id?: string,
 *   amount_requested: number, currency?: string, exchange_rate?: number,
 *   concept?: string, description?: string, request_number?: string,
 *   due_date?: string, scheduled_payment_date?: string, paid_at?: string,
 *   company_bank_account_id?: string, payment_method?: string,
 *   payment_reference?: string, status?: string,
 *   proveedor?: {rfc: string, nombre_completo: string, persona_tipo?: string},
 *   cfdiParseado?: object
 * }} row - Fila de payment_requests + anidados opcionales.
 * @param {{empresa?: string}} [opts] - `empresa`: id/nombre lógico de la
 *   empresa para control.empresa (default: row.company_id).
 * @returns {object} Contrato canónico VALIDADO (FB-1).
 * @throws {ContratoError} Si la fila no alcanza para un contrato válido
 *   (con la lista acumulada de faltantes en `detalles`).
 */
export function paymentRequestAContrato(row, opts = {}) {
  if (!row || typeof row !== 'object') {
    throw new TypeError('paymentRequestAContrato: se esperaba la fila de payment_requests como objeto.');
  }
  const cfdi = row.cfdiParseado ?? undefined;

  const contrato = {
    control: {
      empresa: opts.empresa ?? row.company_id,
      companyId: row.company_id,
      tipo: 'egreso',
      fechaFactura: aFecha(cfdi?.comprobante?.fecha),
      fechaPago: aFecha(row.paid_at),
      referencia: row.request_number ?? serieFolio(cfdi),
      concepto: row.concept ?? row.description ?? '',
      idempotencyKey: `pr:${row.id}`,
      source: { feeder: 'flux', id: row.id },
    },
    contraparte: {
      rfc: row.proveedor?.rfc ?? cfdi?.emisor?.rfc,
      nombre: row.proveedor?.nombre_completo ?? cfdi?.emisor?.nombre,
      personaTipo: row.proveedor?.persona_tipo,
      regimenFiscal: cfdi?.emisor?.regimenFiscal,
      businessId: row.provider_id ?? row.proveedor_id,
    },
    distribucion: [
      {
        partidaId: row.budget_category_id,
        centroCostosId: row.cost_center_id ?? undefined,
        // Con CFDI la base contable es el SubTotal (el IVA va aparte, 6b);
        // sin CFDI solo existe el monto solicitado.
        importeBase: cfdi ? cfdi.comprobante.subTotal : row.amount_requested,
      },
    ],
    efectivo: {
      cuentaOrigenId: row.company_bank_account_id,
      metodoPago: row.payment_method,
      monto: row.amount_requested,
      moneda: row.currency ?? 'MXN',
      tipoCambio: row.exchange_rate ?? 1,
    },
    cfdi,
  };

  return assertContrato(contrato);
}
