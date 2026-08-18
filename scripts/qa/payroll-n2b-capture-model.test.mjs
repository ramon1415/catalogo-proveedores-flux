import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const parser = require('../../payroll_parser.js');

const SYNTHETIC_NOTICE = 'INTERNAL_SYNTHETIC_BYTES_NOT_REAL_PAYROLL';

function fixed(value, width) {
  assert.ok(value.length <= width, SYNTHETIC_NOTICE);
  return value.padEnd(width, ' ');
}

function syntheticSpei(overrides = {}) {
  const destination = overrides.destination || '002000000000000123';
  const row = [
    destination,
    overrides.sourceAccount || '000000000000000987',
    'MXP',
    overrides.amount || '0000000001250.00',
    fixed(overrides.employeeName || 'PERSONA SINTETICA UNO', 30),
    '40',
    destination.slice(0, 3),
    fixed('NOMINA TEST N2B NO PAGAR', 30),
    '       ',
    'H'
  ].join('');
  assert.equal(row.length, 128, SYNTHETIC_NOTICE);
  return Buffer.from(row + '\r\n', 'ascii');
}

test('capture capabilities expose certified and pending adapters without format guesses', () => {
  const capabilities = parser.PAYROLL_CAPTURE_CAPABILITIES;
  assert.equal(capabilities.caratula.capability, 'unsupported_pending_source_contract');
  assert.equal(capabilities.layout_mismo_banco.capability, 'pending_format_certification');
  assert.equal(capabilities.layout_spei.capability, 'supported_certified');
  assert.equal(capabilities.toka_transfer_xlsm.uploadSupported, false);
  assert.equal(capabilities.cfdi_vales.capability, 'pending_employee_breakdown_validation');
});

test('certified SPEI capture summary contains totals and count but never physical records or PII', () => {
  const bytes = Buffer.concat([
    syntheticSpei(),
    syntheticSpei({
      destination: '014000000000000456',
      amount: '0000000000075.25',
      employeeName: 'PERSONA SINTETICA DOS'
    })
  ]);
  const summary = parser.summarizePayrollSpeiForCapture(bytes, ['987']);
  assert.equal(summary.valid, true);
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.totalAmountMinor, 132525);
  assert.equal(summary.parserVersion, 'payroll-normalized-v1');
  assert.equal(summary.contractVersion, 'bbva-simulator-pagos-interbancarios-128-v1');
  assert.equal('records' in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /PERSONA|002000000000000123|000000000000000987|NOMINA TEST/i);
});

test('source-account mismatch fails closed without echoing either account', () => {
  const summary = parser.summarizePayrollSpeiForCapture(
    syntheticSpei({ sourceAccount: '000000000000000987' }),
    ['000000000000000111']
  );
  assert.equal(summary.valid, false);
  assert.equal(summary.totalAmountMinor, null);
  assert.ok(summary.issues.some((item) => item.code === parser.ISSUE_CODES.SOURCE_ACCOUNT_MISMATCH));
  assert.doesNotMatch(JSON.stringify(summary), /000000000000000987|000000000000000111/);
});

test('missing file, uncertified format, parser error, and total mismatch remain distinct', () => {
  const missing = parser.evaluatePayrollCapture({ expectedChannels: ['spei'], files: {} });
  assert.ok(missing.issues.some((item) => item.type === 'MISSING_USER_FILE' && item.source === 'caratula'));
  assert.ok(missing.issues.some((item) => item.type === 'MISSING_USER_FILE' && item.source === 'layout_spei'));

  const parserError = parser.evaluatePayrollCapture({
    expectedChannels: ['spei'],
    files: {
      caratula: { present: true, status: 'blocked' },
      layout_spei: { present: true, status: 'parser_error' }
    }
  });
  assert.ok(parserError.issues.some((item) => item.type === 'FORMAT_NOT_CERTIFIED'));
  assert.ok(parserError.issues.some((item) => item.type === 'PARSER_ERROR'));

  const mismatch = parser.evaluatePayrollCapture({
    expectedChannels: ['spei'],
    files: {
      caratula: { present: true, status: 'blocked' },
      layout_spei: { present: true, status: 'parsed', recordCount: 1, totalAmountMinor: 0 }
    }
  });
  assert.ok(mismatch.issues.some((item) => item.type === 'TOTAL_MISMATCH'));
});

test('SPEI-only total is derived from the certified channel and approval stays blocked', () => {
  const capture = parser.evaluatePayrollCapture({
    expectedChannels: ['spei'],
    files: {
      caratula: { present: true, status: 'blocked' },
      layout_spei: { present: true, status: 'parsed', recordCount: 2, totalAmountMinor: 132525 }
    }
  });
  assert.equal(capture.totalAmountMinor, 132525);
  assert.equal(capture.totalStatus, 'calculated_from_channels');
  assert.equal(capture.captureState, 'validation_pending');
  assert.equal(capture.approvalEnabled, false);
  assert.equal(capture.approvalReason, 'PAYROLL_N3_NOT_ENABLED');
  assert.equal('banco' in capture.channelTotals, false);
  assert.equal('vales' in capture.channelTotals, false);
});

test('resumed client-attested SPEI remains useful for capture but never enables approval', () => {
  const capture = parser.evaluatePayrollCapture({
    expectedChannels: ['spei'],
    files: {
      caratula: { present: true, status: 'blocked' },
      layout_spei: {
        present: true,
        status: 'client_parsed_unverified',
        recordCount: 2,
        totalAmountMinor: 132525
      }
    }
  });
  assert.equal(capture.channelTotals.spei, 132525);
  assert.equal(capture.approvalEnabled, false);
  assert.equal(capture.approvalReason, 'PAYROLL_N3_NOT_ENABLED');
});

test('uncertified expected channels never create zero totals', () => {
  const capture = parser.evaluatePayrollCapture({
    expectedChannels: ['banco', 'vales'],
    files: {
      caratula: { present: true, status: 'blocked' },
      layout_mismo_banco: { present: true, status: 'blocked' },
      cfdi_vales: { present: true, status: 'blocked' }
    }
  });
  assert.equal(capture.channelTotals.banco, null);
  assert.equal(capture.channelTotals.vales, null);
  assert.equal(capture.totalAmountMinor, null);
  assert.equal(capture.totalStatus, 'pending_validation');
  assert.equal(capture.captureState, 'validation_pending');
});
