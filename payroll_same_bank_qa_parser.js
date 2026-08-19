(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FluxPayrollSameBankQa = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'flux-synthetic-bbva-same-bank-qa-v1';
  const FIXTURE_SHA256 = 'c8dfd71874c9fb7d8a9e3d8b87ed52198bb98d1e1cfeb7580f24cef447f25cf8';
  const SOURCE_ACCOUNT = '000000000000000001';
  const RECORD_BYTES = 87;
  const USEFUL_BYTES = 85;
  const EXPECTED_TOTAL_MINOR = 2285050;
  const EXPECTED = Object.freeze([
    Object.freeze({ account: '000000000000000002', amountMinor: 980000, employeeName: 'PERSONA PRUEBA DOS' }),
    Object.freeze({ account: '000000000000000004', amountMinor: 580000, employeeName: 'PERSONA PRUEBA CUATRO' }),
    Object.freeze({ account: '000000000000000005', amountMinor: 725050, employeeName: 'PERSONA PRUEBA CINCO' })
  ]);

  const ISSUE = Object.freeze({
    HASH_MISMATCH: 'PAYROLL_QA_SAME_BANK_HASH_MISMATCH',
    BYTE_CONTRACT_INVALID: 'PAYROLL_QA_SAME_BANK_BYTE_CONTRACT_INVALID',
    RECORD_MISMATCH: 'PAYROLL_QA_SAME_BANK_RECORD_MISMATCH',
    TOTAL_MISMATCH: 'PAYROLL_QA_SAME_BANK_TOTAL_MISMATCH'
  });

  function issue(code, row, field) {
    const value = { code: code, severity: 'blocking', source: 'layout_mismo_banco_txt_qa' };
    if (Number.isInteger(row) && row > 0) value.row = row;
    if (field) value.field = field;
    return value;
  }

  function asBytes(input) {
    if (typeof input === 'string') {
      const bytes = new Uint8Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        if (code > 255) return null;
        bytes[index] = code;
      }
      return bytes;
    }
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    return null;
  }

  function ascii(bytes, start, end) {
    let value = '';
    for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]);
    return value;
  }

  function amountMinor(value) {
    if (!/^\d{13}\.\d{2}$/.test(value)) return null;
    const parts = value.split('.');
    const minor = BigInt(parts[0]) * 100n + BigInt(parts[1]);
    if (minor <= 0 || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(minor);
  }

  function parse(input, declaredSha256) {
    if (declaredSha256 !== FIXTURE_SHA256) {
      return {
        contractVersion: CONTRACT_VERSION,
        qaOnly: true,
        certifiedPhysicalSource: false,
        valid: false,
        records: [],
        issues: [issue(ISSUE.HASH_MISMATCH)]
      };
    }

    const bytes = asBytes(input);
    if (!bytes || bytes.length !== EXPECTED.length * RECORD_BYTES) {
      return {
        contractVersion: CONTRACT_VERSION,
        qaOnly: true,
        certifiedPhysicalSource: false,
        valid: false,
        records: [],
        issues: [issue(ISSUE.BYTE_CONTRACT_INVALID, null, 'length')]
      };
    }

    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      if (byte > 0x7f || (byte < 0x20 && byte !== 0x0d && byte !== 0x0a)) {
        return {
          contractVersion: CONTRACT_VERSION,
          qaOnly: true,
          certifiedPhysicalSource: false,
          valid: false,
          records: [],
          issues: [issue(ISSUE.BYTE_CONTRACT_INVALID, null, 'encoding')]
        };
      }
    }

    const records = [];
    const issues = [];
    let total = 0;
    for (let lineIndex = 0; lineIndex < EXPECTED.length; lineIndex += 1) {
      const row = lineIndex + 1;
      const offset = lineIndex * RECORD_BYTES;
      if (bytes[offset + USEFUL_BYTES] !== 0x0d || bytes[offset + USEFUL_BYTES + 1] !== 0x0a) {
        issues.push(issue(ISSUE.BYTE_CONTRACT_INVALID, row, 'crlf'));
        continue;
      }
      const line = ascii(bytes, offset, offset + USEFUL_BYTES);
      const account = line.slice(0, 18);
      const sourceAccount = line.slice(18, 36);
      const currency = line.slice(36, 39);
      const amount = line.slice(39, 55);
      const motive = line.slice(55, 85);
      const minor = amountMinor(amount);
      const employeeName = motive.trimEnd().replace(/^QA\s+/, '');
      const expected = EXPECTED[lineIndex];

      if (!/^\d{18}$/.test(account) || !/^\d{18}$/.test(sourceAccount) || sourceAccount !== SOURCE_ACCOUNT) {
        issues.push(issue(ISSUE.BYTE_CONTRACT_INVALID, row, 'account'));
        continue;
      }
      if (currency !== 'MXP' || minor === null || !/^QA PERSONA PRUEBA [A-Z ]+$/.test(motive.trimEnd())) {
        issues.push(issue(ISSUE.BYTE_CONTRACT_INVALID, row, 'record'));
        continue;
      }
      if (account !== expected.account || minor !== expected.amountMinor || employeeName !== expected.employeeName) {
        issues.push(issue(ISSUE.RECORD_MISMATCH, row));
        continue;
      }

      total += minor;
      if (!Number.isSafeInteger(total)) {
        issues.push(issue(ISSUE.TOTAL_MISMATCH));
        break;
      }
      records.push({
        sourceRow: row,
        account: account,
        sourceAccount: sourceAccount,
        currency: currency,
        amount: amount,
        amountMinor: minor,
        employeeName: employeeName,
        motive: motive.trimEnd()
      });
    }

    if (issues.length === 0 && total !== EXPECTED_TOTAL_MINOR) issues.push(issue(ISSUE.TOTAL_MISMATCH));
    return {
      contractVersion: CONTRACT_VERSION,
      qaOnly: true,
      certifiedPhysicalSource: false,
      valid: issues.length === 0 && records.length === EXPECTED.length,
      recordCount: issues.length === 0 ? records.length : 0,
      totalAmountMinor: issues.length === 0 ? total : null,
      records: issues.length === 0 ? records : [],
      issues: issues
    };
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    FIXTURE_SHA256: FIXTURE_SHA256,
    SOURCE_ACCOUNT: SOURCE_ACCOUNT,
    RECORD_BYTES: RECORD_BYTES,
    USEFUL_BYTES: USEFUL_BYTES,
    EXPECTED_TOTAL_MINOR: EXPECTED_TOTAL_MINOR,
    ISSUE: ISSUE,
    parse: parse
  });
});
