import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseObligationDocument as parse, reconcileImssDocuments as reconcile } from '../../app/src/features/nomina/obligationDocuments.ts';

// Synthetic aggregates only. No original PDFs, taxpayer records or employee
// rows are committed. Formats follow the reviewed document labels/layout.
const rfc = 'AAA010101AAA';
const registration = 'Z99-12345-67-8';
const sipareRef = 'ABCDEFGH-1234-A-1234-5678-1234567-0000000-0000000-0000000-ABCD';
const sipare = `INSTITUTO MEXICANO DEL SEGURO SOCIAL
FORMATO PARA PAGO DE CUOTAS OBRERO PATRONALES, APORTACIONES Y AMORTIZACIONES
PERÍODO QUE COMPRENDE BIMESTRE QUE COMPRENDE
EL PAGO DE SEGUROS IMSS EL PAGO RCV E INFONAVIT
07-2026
REGISTRO PATRONAL: ${registration} RFC: ${rfc}
FECHA LÍMITE DE PAGO: S.M.G.D.F - FECHA SAL. MIN.
17/08/2026 315.04 01/01/26
SUBTOTAL SEGUROS IMSS $ 900.00 $ 334.56 $ 1,234.56
TOTAL A PAGAR $ 900.00 $ 334.56 $ 1,234.56
LÍNEA DE CAPTURA SIPARE DATOS A CAPTURAR POR LA ENTIDAD RECEPTORA
CIA DE
PAGO
${sipareRef}`;
const sua = `SISTEMA ÚNICO DE AUTODETERMINACIÓN
CÉDULA DE DETERMINACIÓN DE CUOTAS
Período de Proceso: Julio-2026 Fecha de Proceso: 08/ago./2026
Registro Patronal: ${registration} RFC: AAA-010101-AAA
Nombre o Razón Social: EMPRESA DE PRUEBA
Total de Cotizantes: 9 Total a pagar: 1,234.56`;
const ema = `Propuesta de Cédula de Determinación de Cuotas IMSS
${registration} R.F.C. ${rfc} IMPORTE TOTAL: 900.00 334.56 1,234.56
Fecha Límite de Pago: 17/08/2026
PERIODO PROPUESTA PRIMA R.T. CLASE RT
07 - 2026 IMSS 0.50000 1
Para modificaciones se utiliza el denominado Sistema Único de Autodeterminación (SUA).
Propuesta de Cédula de Determinación de Cuotas IMSS`;
const isn = `FORMATO MÚLTIPLE DE PAGO A LA TESORERÍA
IMPUESTO SOBRE NOMINAS CFCDMX CIUDAD DE MEXICO
RFC: ${rfc}
PERIODO: 202607
IMPUESTO A CARGO 1,921.40
SUBSIDIO -480.35
TOTAL A PAGAR $ 1,441.00
LÍNEA DE CAPTURA
88AAA111PX2F3N7Y80VK
VIGENCIA HASTA: 2026-08-17
88AAA111PX2F3N7Y80VK000001441069
CONTRIBUYENTE
LÍNEA DE CAPTURA
88AAA111PX2F3N7Y80VK
TOTAL A PAGAR $ 1,441.00`;

test('recognizes all four supplied format families from content, retaining only aggregates', () => {
  for (const [text, kind, amount] of [[sipare,'imss_sipare',123456],[sua,'imss_sua',123456],[ema,'imss_ema',123456],[isn,'isn_cdmx',144100]]) {
    const result = parse(text);
    assert.equal(result.kind, kind);
    assert.equal(result.taxpayerRfc, rfc);
    assert.equal(result.amountMinor, amount);
    assert.equal(result.periodStart, '2026-07-01');
    assert.equal(result.periodEnd, '2026-07-31');
    assert.deepEqual(result.issues, []);
    assert.equal(result.isPaymentReceipt, false);
    assert.equal('paymentDate' in result, false);
    assert.equal('employees' in result, false);
    assert.equal('rawText' in result, false);
  }
});

test('three IMSS supports represent one amount; extraction never adds them together', () => {
  const result = reconcile([parse(sipare),parse(ema),parse(sua)], rfc);
  assert.equal(result.consistent, true);
  assert.equal(result.amountMinor, 123456);
  assert.deepEqual(result.issues, []);
  assert.equal(parse(sipare).paymentReference, sipareRef);
});

test('RFC discrepancy remains blocking even with identical period, registration and totals', () => {
  const docs = [parse(sipare),parse(ema),parse(sua.replace('AAA-010101-AAA','AAA-010102-AAA'))];
  const result = reconcile(docs, rfc);
  assert.equal(result.consistent, false);
  assert.ok(result.issues.some(i => i.code === 'IMSS_SUPPORT_MISMATCH' && i.field === 'taxpayerRfc'));
  assert.ok(result.issues.some(i => i.code === 'COMPANY_RFC_MISMATCH'));
  assert.equal(docs[2].taxpayerRfc, 'AAA010102AAA');
});

test('requires explicit company identity and one payment form, rejects duplicate/support-only sets', () => {
  for (const docs of [[parse(ema),parse(sua)],[parse(sipare),parse(sipare)],[parse(sipare),parse(isn)],[]]) {
    assert.equal(reconcile(docs,rfc).consistent,false);
  }
  assert.ok(reconcile([parse(sipare)]).issues.some(i => i.code === 'COMPANY_RFC_REQUIRED'));
  assert.equal(reconcile([parse(sipare)],'BBB010101BBB').consistent,false);
});

test('ISN uses its printed rounded total, deduplicates coupon and ignores longer barcode', () => {
  const result = parse(isn);
  assert.equal(result.amountMinor,144100);
  assert.notEqual(result.amountMinor,192140-48035);
  assert.equal(result.paymentReference,'88AAA111PX2F3N7Y80VK');
  const conflict = parse(isn.replace(/TOTAL A PAGAR \$ 1,441.00$/, 'TOTAL A PAGAR $ 1,442.00'));
  assert.equal(conflict.amountMinor,null);
  assert.ok(conflict.issues.some(i => i.field === 'amountMinor' && i.code === 'FIELD_CONFLICT'));
});

test('due date is not payment date; SUA process date never fills due date', () => {
  assert.equal(parse(sua).dueDate,null);
  assert.equal(parse(sipare).dueDate,'2026-08-17');
  assert.equal(parse(ema.replace('07 - 2026 IMSS 0.50000 1','07 - 2026 IMSS 0.50000 1 01/01/2026 31/01/2026')).dueDate,'2026-08-17');
  const invalid = parse(isn.replace('2026-08-17','2026-02-31'));
  assert.equal(invalid.dueDate,null);
  assert.ok(invalid.issues.some(i => i.field === 'dueDate'));
  const invalidPeriod = parse(isn.replace('202607','202613'));
  assert.equal(invalidPeriod.periodStart,null);
  const spaced=sipare.replace('17/08/2026 315.04 01/01/26','No. DE COTIZANTES: 9\n315.04 01/01/26 No. DE DÍAS A COTIZAR: 279\n17/08/2026');
  assert.equal(parse(spaced).dueDate,'2026-08-17');
  const ambiguous=parse(spaced.replace('01/01/26','01/01/2026'));
  assert.equal(ambiguous.dueDate,null);
  assert.ok(ambiguous.issues.some(i=>i.code==='FIELD_CONFLICT' && i.field==='dueDate'));
});

test('missing labels, missing text and mixed files require review rather than guessing from numbers', () => {
  for (const input of ['', 'COMPROBANTE DE TRANSFERENCIA $ 1,234.56', 'x'.repeat(300001), `${sipare}\n${isn}`]) {
    const result=parse(input);
    assert.equal(result.kind,'unknown');
    assert.ok(result.issues.length);
  }
  const missing=parse(sipare.replace('TOTAL A PAGAR','OTRO CONCEPTO'));
  assert.equal(missing.amountMinor,null);
  assert.ok(missing.issues.some(i=>i.field==='amountMinor'));
  assert.equal(parse(isn.replaceAll('TOTAL A PAGAR $ 1,441.00','TOTAL A PAGAR $ -1,441.00')).amountMinor,null);
});

test('conflicting amounts, registration and periods block the package', () => {
  for (const changed of [sua.replace('1,234.56','1,235.56'),sua.replace(registration,'Z99-12345-67-9'),sua.replace('Julio-2026','Junio-2026')]) {
    const result=reconcile([parse(sipare),parse(changed)],rfc);
    assert.equal(result.consistent,false);
    assert.ok(result.issues.some(i=>i.code==='IMSS_SUPPORT_MISMATCH'));
  }
});
