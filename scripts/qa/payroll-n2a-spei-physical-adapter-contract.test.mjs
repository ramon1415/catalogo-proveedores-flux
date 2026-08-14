import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const parser = require('../../payroll_parser.js');

const SYNTHETIC_NOTICE = 'INTERNAL_SYNTHETIC_BYTES_NOT_REAL_PAYROLL';

function fixed(value, width) {
  assert.ok(value.length <= width);
  return value.padEnd(width, ' ');
}

function speiRecord(overrides = {}) {
  const destination = overrides.destination || '002000000000000123';
  const record = [
    destination,
    overrides.sourceAccount || '000000000000000987',
    overrides.currency || 'MXP',
    overrides.amount || '0000000001250.00',
    fixed(overrides.employeeName || 'PERSONA PRUEBA UNO', 30),
    overrides.accountType || '40',
    overrides.destinationBank || destination.slice(0, 3),
    fixed(overrides.paymentReference || 'NOMINA SINTETICA', 30),
    overrides.numericReference === undefined ? '       ' : overrides.numericReference,
    overrides.indicator || 'H'
  ].join('');
  assert.equal(record.length, 128, SYNTHETIC_NOTICE);
  return record + '\r\n';
}

test('synthetic fixture is constructed in-test and contains no recovered source values', () => {
  assert.match(SYNTHETIC_NOTICE, /SYNTHETIC.*NOT_REAL/i);
  assert.equal(speiRecord().length, 130);
});

test('certified 128-byte payroll SPEI contract parses exact fields', () => {
  const input = speiRecord() + speiRecord({
    destination: '014000000000000456',
    employeeName: 'PERSONA PRUEBA DOS',
    amount: '0000000000075.25',
    numericReference: '0000015'
  });
  const result = parser.parsePayrollSpeiTxt(Buffer.from(input, 'ascii'));

  assert.equal(result.contractVersion, parser.PAYROLL_SPEI_CONTRACT_VERSION);
  assert.deepEqual(result.issues, []);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records.map((record) => ({
    sourceRow: record.sourceRow,
    destinationLength: record.clabe.length,
    sourceLength: record.sourceAccount.length,
    currency: record.currency,
    amountMinor: record.amountMinor,
    beneficiaryLength: record.employeeName.length,
    accountType: record.accountType,
    destinationBank: record.destinationBank,
    paymentReferenceLength: record.paymentReference.length,
    numericReference: record.numericReference,
    indicator: record.indicator
  })), [
    {
      sourceRow: 1,
      destinationLength: 18,
      sourceLength: 18,
      currency: 'MXP',
      amountMinor: 125000,
      beneficiaryLength: 18,
      accountType: '40',
      destinationBank: '002',
      paymentReferenceLength: 16,
      numericReference: '',
      indicator: 'H'
    },
    {
      sourceRow: 2,
      destinationLength: 18,
      sourceLength: 18,
      currency: 'MXP',
      amountMinor: 7525,
      beneficiaryLength: 18,
      accountType: '40',
      destinationBank: '014',
      paymentReferenceLength: 16,
      numericReference: '0000015',
      indicator: 'H'
    }
  ]);
});

test('legacy parsePayrollSpei API delegates to the certified byte parser', () => {
  const direct = parser.parsePayrollSpeiTxt(speiRecord());
  const legacy = parser.parsePayrollSpei(speiRecord());
  assert.deepEqual(legacy, direct);
});

test('certified records feed the existing normalized SPEI contract without format reuse', () => {
  const physical = parser.parsePayrollSpeiTxt(speiRecord());
  const normalized = parser.normalizePayrollBankRecords(physical.records, { channel: 'spei' });
  assert.deepEqual(physical.issues, []);
  assert.deepEqual(normalized.issues, []);
  assert.equal(normalized.payments.length, 1);
  assert.equal(normalized.payments[0].channel, 'spei');
  assert.equal(normalized.payments[0].amountMinor, 125000);
});

test('BOM, LF-only, missing final CRLF, and truncated records are rejected', () => {
  const valid = Buffer.from(speiRecord(), 'ascii');
  const cases = [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]),
    Buffer.from(speiRecord().replace(/\r\n/g, '\n'), 'ascii'),
    valid.subarray(0, valid.length - 2),
    valid.subarray(0, 129)
  ];
  for (const bytes of cases) {
    const result = parser.parsePayrollSpeiTxt(bytes);
    assert.equal(result.records.length, 0);
    assert.ok(result.issues.length > 0);
  }
});

test('amount, account type, bank prefix, numeric reference, and indicator are exact', () => {
  const cases = [
    speiRecord({ amount: '0000000000000.00' }),
    speiRecord({ accountType: '01' }),
    speiRecord({ destinationBank: '072' }),
    speiRecord({ numericReference: '12A4567' }),
    speiRecord({ indicator: 'D' })
  ];
  for (const input of cases) {
    const result = parser.parsePayrollSpeiTxt(input);
    assert.equal(result.records.length, 0);
    assert.ok(result.issues.length > 0);
  }
});

test('lowercase and non-ASCII payloads fail closed without echoing source data', () => {
  const lower = parser.parsePayrollSpeiTxt(speiRecord({ employeeName: 'persona prueba uno' }));
  const nonAscii = parser.parsePayrollSpeiTxt(speiRecord().replace('PRUEBA', 'PRUÉBA'));
  for (const result of [lower, nonAscii]) {
    assert.equal(result.records.length, 0);
    const serializedIssues = JSON.stringify(result.issues);
    assert.doesNotMatch(serializedIssues, /PERSONA|PRUEBA|000000000000000987/i);
  }
});
