import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const parser = require('../../payroll_parser.js');
const fixture = JSON.parse(readFileSync(
  new URL('./fixtures/payroll/internal-synthetic-run.json', import.meta.url),
  'utf8'
));

function minor(value) {
  const parsed = parser.parseMoneyMinor(value);
  assert.equal(parsed.ok, true);
  return parsed.valueMinor;
}

function normalizedFixture(overrides = {}) {
  const cover = parser.parsePayrollCoverSheetRows(
    overrides.coverRows || fixture.coverRows,
    fixture.coverContract
  );
  const sameBank = parser.normalizePayrollBankRecords(
    overrides.sameBankRecords || fixture.sameBankRecords,
    { channel: 'banco' }
  );
  const spei = parser.normalizePayrollBankRecords(
    overrides.speiRecords || fixture.speiRecords,
    { channel: 'spei' }
  );
  const toka = parser.normalizePayrollTokaRecords(
    overrides.tokaRecords || fixture.tokaRecords
  );
  const merged = parser.mergePayrollSources({
    cover,
    sameBank,
    spei,
    toka,
    sourceAccount: fixture.request.sourceAccount
  });
  return { cover, sameBank, spei, toka, merged };
}

test('fixture is explicitly internal synthetic data, never a source format', () => {
  assert.equal(fixture.evidenceClassification, parser.SYNTHETIC_EVIDENCE);
  assert.match(fixture.notice, /not an XLSX.*BBVA TXT.*TOKA XML/i);
});

test('money parser uses exact safe integer minor units and rejects floats', () => {
  assert.deepEqual(parser.parseMoneyMinor('1,234.50'), { ok: true, valueMinor: 123450 });
  assert.equal(parser.parseMoneyMinor('0.01').valueMinor, 1);
  assert.equal(parser.parseMoneyMinor(1234.5).ok, false);
  assert.equal(parser.parseMoneyMinor('12.345').ok, false);
  assert.equal(parser.parseMoneyMinor('-1.00').ok, false);
});

test('three synthetic people merge deterministically and reconcile exactly', () => {
  const result = normalizedFixture();
  assert.deepEqual(result.cover.issues, []);
  assert.deepEqual(result.sameBank.issues, []);
  assert.deepEqual(result.spei.issues, []);
  assert.deepEqual(result.toka.issues, []);
  assert.deepEqual(result.merged.issues, []);
  assert.equal(result.merged.people.length, 3);

  const validation = parser.validatePayrollRun({
    coverPresent: true,
    periodStart: fixture.request.periodStart,
    periodEnd: fixture.request.periodEnd,
    sourceAccount: fixture.request.sourceAccount,
    requestAmountMinor: minor(fixture.request.requestAmount),
    channels: {
      banco: minor(fixture.channels.banco),
      spei: minor(fixture.channels.spei),
      vales: minor(fixture.channels.vales)
    },
    people: result.merged.people
  });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(validation.totals, {
    bankMinor: 180000,
    speiMinor: 175000,
    vouchersMinor: 45000,
    requestMinor: 400000
  });
});

test('physical XLSX, BBVA, SPEI, and TOKA adapters fail closed without fixtures', () => {
  const results = [
    parser.parsePayrollCoverSheet('opaque'),
    parser.parsePayrollBbvaSameBank('opaque'),
    parser.parsePayrollSpei('opaque'),
    parser.parsePayrollTokaXml('<opaque/>')
  ];
  for (const result of results) {
    assert.equal(result.records.length, 0);
    assert.equal(
      result.issues.some((item) => item.code === parser.ISSUE_CODES.SOURCE_FIXTURES_REQUIRED),
      true
    );
  }
});

test('missing account match is blocking and issues never echo source values', () => {
  const changed = structuredClone(fixture.sameBankRecords);
  changed[0].account = '9999999999';
  const result = normalizedFixture({ sameBankRecords: changed });
  assert.equal(
    result.merged.issues.some((item) => item.code === parser.ISSUE_CODES.EMPLOYEE_NOT_FOUND),
    true
  );
  const serializedIssues = JSON.stringify(result.merged.issues);
  assert.doesNotMatch(serializedIssues, /9999999999|PERSONA SINTETICA/i);
});

test('different bank amount is blocking and is not auto-corrected', () => {
  const changed = structuredClone(fixture.sameBankRecords);
  changed[0].amount = '999.99';
  const result = normalizedFixture({ sameBankRecords: changed });
  assert.equal(
    result.merged.issues.some((item) => item.code === parser.ISSUE_CODES.BANK_AMOUNT_MISMATCH),
    true
  );
});

test('duplicate canonical person in cover sheet is rejected', () => {
  const rows = structuredClone(fixture.coverRows);
  rows.push({ ...rows[0], __sourceRow: 99 });
  const result = normalizedFixture({ coverRows: rows });
  assert.equal(
    result.cover.issues.some((item) => item.code === parser.ISSUE_CODES.DUPLICATE_PERSON),
    true
  );
});

test('invalid structured layout line is rejected', () => {
  const changed = structuredClone(fixture.speiRecords);
  changed[0].amount = 'invalid';
  const result = normalizedFixture({ speiRecords: changed });
  assert.equal(
    result.spei.issues.some((item) => item.code === parser.ISSUE_CODES.LAYOUT_LINE_INVALID),
    true
  );
});

test('TOKA record without deterministic RFC/CURP match is blocking', () => {
  const changed = structuredClone(fixture.tokaRecords);
  changed[0].rfc = 'SYNTHETIC-RFC-NOT-FOUND';
  const result = normalizedFixture({ tokaRecords: changed });
  assert.equal(
    result.merged.issues.some((item) => item.code === parser.ISSUE_CODES.EMPLOYEE_NOT_FOUND),
    true
  );
});

test('source account mismatch is blocking', () => {
  const changed = structuredClone(fixture.speiRecords);
  changed[0].sourceAccount = '000000000000000099';
  const result = normalizedFixture({ speiRecords: changed });
  assert.equal(
    result.merged.issues.some((item) => item.code === parser.ISSUE_CODES.SOURCE_ACCOUNT_MISMATCH),
    true
  );
});

test('request total mismatch remains blocking', () => {
  const result = normalizedFixture();
  const validation = parser.validatePayrollRun({
    coverPresent: true,
    periodStart: fixture.request.periodStart,
    periodEnd: fixture.request.periodEnd,
    sourceAccount: fixture.request.sourceAccount,
    requestAmountMinor: minor(fixture.request.requestAmount) + 1,
    channels: {
      banco: minor(fixture.channels.banco),
      spei: minor(fixture.channels.spei),
      vales: minor(fixture.channels.vales)
    },
    people: result.merged.people
  });
  assert.equal(validation.valid, false);
  assert.equal(
    validation.issues.some((item) => item.code === parser.ISSUE_CODES.TOTAL_MISMATCH),
    true
  );
});
