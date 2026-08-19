(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FluxPayrollTokaQa = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'flux-synthetic-toka-qa-v1';
  const FIXTURE_SHA256 = '3e16bcbe4dcf39e7e46bc91aa8e682cd40460a8b0202c20b294db3e37cd7674c';
  const EXPECTED_TOTAL_MINOR = 210000;
  const EXPECTED = Object.freeze([
    Object.freeze({ rfc: 'PRUE040404DD4', curp: 'PRUE040404MDFRRS04', amountMinor: 60000 }),
    Object.freeze({ rfc: 'PRUE060606FF6', curp: 'PRUE060606MDFRRS06', amountMinor: 90000 }),
    Object.freeze({ rfc: 'PRUE080808HH8', curp: 'PRUE080808MDFRRS08', amountMinor: 60000 })
  ]);

  const ISSUE = Object.freeze({
    HASH_MISMATCH: 'PAYROLL_QA_TOKA_HASH_MISMATCH',
    XML_INVALID: 'PAYROLL_QA_TOKA_XML_INVALID',
    CONTRACT_MISMATCH: 'PAYROLL_QA_TOKA_CONTRACT_MISMATCH',
    RECORD_MISMATCH: 'PAYROLL_QA_TOKA_RECORD_MISMATCH',
    TOTAL_MISMATCH: 'PAYROLL_QA_TOKA_TOTAL_MISMATCH'
  });

  function issue(code, row, field) {
    const value = { code: code, severity: 'blocking', source: 'cfdi_vales_xml_qa' };
    if (Number.isInteger(row) && row > 0) value.row = row;
    if (field) value.field = field;
    return value;
  }

  function text(input) {
    if (typeof input === 'string') return input;
    try {
      if (input instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: true }).decode(input);
      if (input instanceof ArrayBuffer) return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(input));
      if (ArrayBuffer.isView(input)) {
        return new TextDecoder('utf-8', { fatal: true }).decode(
          new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        );
      }
    } catch (_) {
      return '';
    }
    return '';
  }

  function decodeXml(value) {
    return String(value || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  function attr(tag, name) {
    const match = tag.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'));
    return match ? decodeXml(match[1]) : '';
  }

  function amountMinor(value) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
    const parts = value.split('.');
    const minor = BigInt(parts[0]) * 100n + BigInt((parts[1] || '').padEnd(2, '0'));
    if (minor < 0 || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
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

    const xml = text(input).replace(/^\uFEFF/, '');
    if (!xml || !xml.includes('<FluxPayrollTokaQA')) {
      return {
        contractVersion: CONTRACT_VERSION,
        qaOnly: true,
        certifiedPhysicalSource: false,
        valid: false,
        records: [],
        issues: [issue(ISSUE.XML_INVALID)]
      };
    }

    const root = xml.match(/<FluxPayrollTokaQA\b[^>]*>/)?.[0] || '';
    if (
      attr(root, 'contractVersion') !== CONTRACT_VERSION ||
      attr(root, 'qaOnly') !== 'true' ||
      attr(root, 'certifiedPhysicalSource') !== 'false' ||
      attr(root, 'currency') !== 'MXN' ||
      !xml.includes('<Company>OPERADORA TLACATECPAN</Company>') ||
      !xml.includes('<Warning>SINTETICO QA - NO USAR PARA PAGOS</Warning>')
    ) {
      return {
        contractVersion: CONTRACT_VERSION,
        qaOnly: true,
        certifiedPhysicalSource: false,
        valid: false,
        records: [],
        issues: [issue(ISSUE.CONTRACT_MISMATCH)]
      };
    }

    const tags = Array.from(xml.matchAll(/<Voucher\b[^>]*\/>/g)).map(function (match) { return match[0]; });
    if (tags.length !== EXPECTED.length) {
      return {
        contractVersion: CONTRACT_VERSION,
        qaOnly: true,
        certifiedPhysicalSource: false,
        valid: false,
        records: [],
        issues: [issue(ISSUE.RECORD_MISMATCH)]
      };
    }

    const records = [];
    const issues = [];
    let total = 0;
    tags.forEach(function (tag, index) {
      const expected = EXPECTED[index];
      const rfc = attr(tag, 'rfc').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const curp = attr(tag, 'curp').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const amount = attr(tag, 'amount');
      const minor = amountMinor(amount);
      const row = index + 1;
      if (!rfc || !curp || minor === null) {
        issues.push(issue(ISSUE.XML_INVALID, row));
        return;
      }
      if (rfc !== expected.rfc || curp !== expected.curp || minor !== expected.amountMinor) {
        issues.push(issue(ISSUE.RECORD_MISMATCH, row));
        return;
      }
      total += minor;
      if (!Number.isSafeInteger(total)) {
        issues.push(issue(ISSUE.TOTAL_MISMATCH));
        return;
      }
      records.push({ sourceRow: row, rfc: rfc, curp: curp, amount: amount, amountMinor: minor });
    });

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
    EXPECTED_TOTAL_MINOR: EXPECTED_TOTAL_MINOR,
    ISSUE: ISSUE,
    parse: parse
  });
});
