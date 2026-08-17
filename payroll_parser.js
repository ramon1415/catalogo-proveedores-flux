(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FluxPayrollParser = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARSER_VERSION = 'payroll-normalized-v1';
  const SYNTHETIC_EVIDENCE = 'INTERNAL_SYNTHETIC_MODEL_NOT_SOURCE_FORMAT';
  const PAYROLL_SPEI_CONTRACT_VERSION = 'bbva-simulator-pagos-interbancarios-128-v1';
  const PAYROLL_SPEI_RECORD_BYTES = 130;
  const PAYROLL_SPEI_USEFUL_BYTES = 128;
  const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

  const ISSUE_CODES = Object.freeze({
    COVER_SHEET_REQUIRED: 'PAYROLL_COVER_SHEET_REQUIRED',
    COVER_SHEET_CONTRACT_REQUIRED: 'PAYROLL_COVER_SHEET_CONTRACT_REQUIRED',
    SOURCE_FIXTURES_REQUIRED: 'PAYROLL_SOURCE_FIXTURES_REQUIRED',
    LAYOUT_FORMAT_UNSUPPORTED: 'PAYROLL_LAYOUT_FORMAT_UNSUPPORTED',
    LAYOUT_LINE_INVALID: 'PAYROLL_LAYOUT_LINE_INVALID',
    SPEI_BYTE_CONTRACT_INVALID: 'PAYROLL_SPEI_BYTE_CONTRACT_INVALID',
    EMPLOYEE_NOT_FOUND: 'PAYROLL_EMPLOYEE_NOT_FOUND',
    EMPLOYEE_MATCH_AMBIGUOUS: 'PAYROLL_EMPLOYEE_MATCH_AMBIGUOUS',
    EMPLOYEE_NAME_MISMATCH: 'PAYROLL_EMPLOYEE_NAME_MISMATCH',
    BANK_AMOUNT_MISMATCH: 'PAYROLL_BANK_AMOUNT_MISMATCH',
    SPEI_AMOUNT_MISMATCH: 'PAYROLL_SPEI_AMOUNT_MISMATCH',
    VOUCHERS_AMOUNT_MISMATCH: 'PAYROLL_VOUCHERS_AMOUNT_MISMATCH',
    TOTAL_MISMATCH: 'PAYROLL_TOTAL_MISMATCH',
    DUPLICATE_PERSON: 'PAYROLL_DUPLICATE_PERSON',
    SOURCE_ACCOUNT_MISMATCH: 'PAYROLL_SOURCE_ACCOUNT_MISMATCH',
    PERIOD_INVALID: 'PAYROLL_PERIOD_INVALID',
    PII_ACCESS_DENIED: 'PAYROLL_PII_ACCESS_DENIED',
    PROVISION_BASE_UNRESOLVED: 'PAYROLL_PROVISION_BASE_UNRESOLVED'
  });

  function issue(code, source, row, field) {
    const value = { code, severity: 'blocking' };
    if (source) value.source = source;
    if (Number.isInteger(row) && row > 0) value.row = row;
    if (field) value.field = field;
    return value;
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function normalizeName(value) {
    return normalizeText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  function normalizeIdentifier(value) {
    return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function normalizeAccount(value) {
    return normalizeText(value).replace(/\D/g, '');
  }

  function parseMoneyMinor(value) {
    if (typeof value !== 'string') {
      return { ok: false, code: ISSUE_CODES.LAYOUT_LINE_INVALID };
    }

    const raw = value.trim();
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) {
      return { ok: false, code: ISSUE_CODES.LAYOUT_LINE_INVALID };
    }

    const normalized = raw.replace(/,/g, '');
    const parts = normalized.split('.');
    const major = BigInt(parts[0]);
    const fraction = (parts[1] || '').padEnd(2, '0');
    const minor = major * 100n + BigInt(fraction || '0');

    if (minor > MAX_SAFE_MINOR) {
      return { ok: false, code: ISSUE_CODES.LAYOUT_LINE_INVALID };
    }

    return { ok: true, valueMinor: Number(minor) };
  }

  function requireColumnContract(contract) {
    const columns = contract && contract.columns;
    const required = ['employeeName', 'netAmount', 'cashAmount', 'vouchersAmount'];
    return Boolean(
      columns && required.every(function (key) {
        return typeof columns[key] === 'string' && columns[key].trim();
      })
    );
  }

  function getCell(row, columns, name) {
    const key = columns[name];
    return key ? row[key] : undefined;
  }

  function canonicalPersonKey(person) {
    if (person.rfc) return 'RFC:' + person.rfc;
    if (person.curp) return 'CURP:' + person.curp;
    if (person.nss) return 'NSS:' + person.nss;
    if (person.clabe) return 'CLABE:' + person.clabe;
    if (person.account) return 'ACCOUNT:' + person.account;
    return '';
  }

  function parsePayrollCoverSheetRows(rows, contract) {
    const issues = [];
    if (!Array.isArray(rows) || rows.length === 0) {
      return { parserVersion: PARSER_VERSION, people: [], issues: [issue(ISSUE_CODES.COVER_SHEET_REQUIRED, 'caratula')] };
    }
    if (!requireColumnContract(contract)) {
      return { parserVersion: PARSER_VERSION, people: [], issues: [issue(ISSUE_CODES.COVER_SHEET_CONTRACT_REQUIRED, 'caratula')] };
    }

    const columns = contract.columns;
    const seen = new Set();
    const people = [];

    rows.forEach(function (row, index) {
      const sourceRow = Number.isInteger(row && row.__sourceRow) ? row.__sourceRow : index + 2;
      const net = parseMoneyMinor(getCell(row, columns, 'netAmount'));
      const cash = parseMoneyMinor(getCell(row, columns, 'cashAmount'));
      const vouchers = parseMoneyMinor(getCell(row, columns, 'vouchersAmount'));
      const employeeName = normalizeText(getCell(row, columns, 'employeeName'));

      if (!net.ok || !cash.ok || !vouchers.ok || !employeeName) {
        issues.push(issue(ISSUE_CODES.LAYOUT_LINE_INVALID, 'caratula', sourceRow));
        return;
      }

      const person = {
        sourceRow,
        employeeName,
        normalizedName: normalizeName(employeeName),
        rfc: normalizeIdentifier(getCell(row, columns, 'rfc')),
        curp: normalizeIdentifier(getCell(row, columns, 'curp')),
        nss: normalizeIdentifier(getCell(row, columns, 'nss')),
        bankName: normalizeText(getCell(row, columns, 'bankName')),
        account: normalizeAccount(getCell(row, columns, 'account')),
        clabe: normalizeAccount(getCell(row, columns, 'clabe')),
        netAmountMinor: net.valueMinor,
        coverCashAmountMinor: cash.valueMinor,
        coverVouchersAmountMinor: vouchers.valueMinor,
        bankAmountMinor: 0,
        speiAmountMinor: 0,
        vouchersAmountMinor: 0
      };

      const key = canonicalPersonKey(person);
      if (!key || seen.has(key)) {
        issues.push(issue(ISSUE_CODES.DUPLICATE_PERSON, 'caratula', sourceRow));
        return;
      }
      seen.add(key);
      people.push(person);
    });

    return { parserVersion: PARSER_VERSION, people, issues };
  }

  function normalizePayrollBankRecords(records, options) {
    const channel = options && options.channel;
    const source = channel === 'banco' ? 'layout_mismo_banco' : 'layout_spei';
    const destinationField = channel === 'banco' ? 'account' : 'clabe';
    const issues = [];
    const payments = [];

    if (!Array.isArray(records) || !['banco', 'spei'].includes(channel)) {
      return { parserVersion: PARSER_VERSION, payments: [], issues: [issue(ISSUE_CODES.LAYOUT_FORMAT_UNSUPPORTED, source)] };
    }

    records.forEach(function (record, index) {
      const sourceRow = Number.isInteger(record && record.sourceRow) ? record.sourceRow : index + 1;
      const amount = parseMoneyMinor(record && record.amount);
      const destination = normalizeAccount(record && record[destinationField]);
      const sourceAccount = normalizeAccount(record && record.sourceAccount);
      if (!amount.ok || amount.valueMinor <= 0 || !destination || !sourceAccount) {
        issues.push(issue(ISSUE_CODES.LAYOUT_LINE_INVALID, source, sourceRow));
        return;
      }
      payments.push({
        sourceRow,
        channel,
        destination,
        sourceAccount,
        amountMinor: amount.valueMinor,
        employeeName: normalizeText(record.employeeName),
        normalizedName: normalizeName(record.employeeName)
      });
    });

    return { parserVersion: PARSER_VERSION, payments, issues };
  }

  function normalizePayrollTokaRecords(records) {
    const issues = [];
    const vouchers = [];
    if (!Array.isArray(records)) {
      return { parserVersion: PARSER_VERSION, vouchers: [], issues: [issue(ISSUE_CODES.LAYOUT_FORMAT_UNSUPPORTED, 'cfdi_vales')] };
    }

    records.forEach(function (record, index) {
      const sourceRow = Number.isInteger(record && record.sourceRow) ? record.sourceRow : index + 1;
      const amount = parseMoneyMinor(record && record.amount);
      const rfc = normalizeIdentifier(record && record.rfc);
      const curp = normalizeIdentifier(record && record.curp);
      if (!amount.ok || amount.valueMinor < 0 || (!rfc && !curp)) {
        issues.push(issue(ISSUE_CODES.LAYOUT_LINE_INVALID, 'cfdi_vales', sourceRow));
        return;
      }
      vouchers.push({ sourceRow, rfc, curp, amountMinor: amount.valueMinor });
    });

    return { parserVersion: PARSER_VERSION, vouchers, issues };
  }

  function blockedPhysicalParser(source) {
    return {
      parserVersion: PARSER_VERSION,
      records: [],
      issues: [
        issue(ISSUE_CODES.SOURCE_FIXTURES_REQUIRED, source),
        issue(ISSUE_CODES.LAYOUT_FORMAT_UNSUPPORTED, source)
      ]
    };
  }

  function parsePayrollCoverSheet() {
    return blockedPhysicalParser('caratula_xlsx');
  }

  function parsePayrollBbvaSameBank() {
    return blockedPhysicalParser('layout_mismo_banco_txt');
  }

  function payrollSpeiBytes(input) {
    if (typeof input === 'string') {
      const bytes = new Uint8Array(input.length);
      for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        if (code > 255) return null;
        bytes[index] = code;
      }
      return bytes;
    }
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    return null;
  }

  function payrollAscii(bytes, start, end) {
    let value = '';
    for (let index = start; index < end; index += 1) {
      value += String.fromCharCode(bytes[index]);
    }
    return value;
  }

  function speiContractIssue(row, field) {
    return issue(ISSUE_CODES.SPEI_BYTE_CONTRACT_INVALID, 'layout_spei_txt', row, field);
  }

  function parsePayrollSpeiTxt(input) {
    const bytes = payrollSpeiBytes(input);
    const issues = [];
    const records = [];
    if (!bytes || bytes.length === 0) {
      return {
        parserVersion: PARSER_VERSION,
        contractVersion: PAYROLL_SPEI_CONTRACT_VERSION,
        records,
        issues: [speiContractIssue(null, 'source')]
      };
    }
    if (
      (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe) ||
      (bytes[0] === 0xfe && bytes[1] === 0xff)
    ) {
      issues.push(speiContractIssue(null, 'bom'));
    }
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      if (byte > 0x7f || (byte < 0x20 && byte !== 0x0d && byte !== 0x0a)) {
        issues.push(speiContractIssue(null, 'encoding'));
        break;
      }
    }
    if (bytes.length % PAYROLL_SPEI_RECORD_BYTES !== 0) {
      issues.push(speiContractIssue(null, 'record_length'));
    }
    if (issues.length > 0) {
      return {
        parserVersion: PARSER_VERSION,
        contractVersion: PAYROLL_SPEI_CONTRACT_VERSION,
        records,
        issues
      };
    }

    const lineCount = bytes.length / PAYROLL_SPEI_RECORD_BYTES;
    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const row = lineIndex + 1;
      const offset = lineIndex * PAYROLL_SPEI_RECORD_BYTES;
      if (
        bytes[offset + PAYROLL_SPEI_USEFUL_BYTES] !== 0x0d ||
        bytes[offset + PAYROLL_SPEI_USEFUL_BYTES + 1] !== 0x0a
      ) {
        issues.push(speiContractIssue(row, 'crlf'));
        continue;
      }
      const line = payrollAscii(bytes, offset, offset + PAYROLL_SPEI_USEFUL_BYTES);
      const destination = line.slice(0, 18);
      const sourceAccount = line.slice(18, 36);
      const currency = line.slice(36, 39);
      const amount = line.slice(39, 55);
      const beneficiary = line.slice(55, 85);
      const accountType = line.slice(85, 87);
      const destinationBank = line.slice(87, 90);
      const paymentReference = line.slice(90, 120);
      const numericReference = line.slice(120, 127);
      const indicator = line.slice(127, 128);
      const amountResult = parseMoneyMinor(amount);
      const fieldChecks = [
        ['destination_account', /^\d{18}$/.test(destination)],
        ['source_account', /^\d{18}$/.test(sourceAccount)],
        ['currency', currency === 'MXP'],
        ['amount', /^\d{13}\.\d{2}$/.test(amount) && amountResult.ok && amountResult.valueMinor > 0],
        ['beneficiary', /^[\x20-\x7e]{30}$/.test(beneficiary) && beneficiary === beneficiary.toUpperCase()],
        ['account_type', accountType === '40'],
        ['destination_bank', /^\d{3}$/.test(destinationBank) && destinationBank === destination.slice(0, 3)],
        ['payment_reference', /^[\x20-\x7e]{30}$/.test(paymentReference) && paymentReference === paymentReference.toUpperCase()],
        ['numeric_reference', /^(?:\d{7}| {7})$/.test(numericReference)],
        ['indicator', indicator === 'H']
      ];
      const invalidFields = fieldChecks.filter(function (entry) { return !entry[1]; });
      invalidFields.forEach(function (entry) {
        issues.push(speiContractIssue(row, entry[0]));
      });
      if (invalidFields.length > 0) continue;
      records.push({
        sourceRow: row,
        clabe: destination,
        sourceAccount,
        currency,
        amount,
        amountMinor: amountResult.valueMinor,
        employeeName: beneficiary.trimEnd(),
        accountType,
        destinationBank,
        paymentReference: paymentReference.trimEnd(),
        numericReference: numericReference.trim(),
        indicator
      });
    }
    return {
      parserVersion: PARSER_VERSION,
      contractVersion: PAYROLL_SPEI_CONTRACT_VERSION,
      records,
      issues
    };
  }

  function parsePayrollSpei(input) {
    return parsePayrollSpeiTxt(input);
  }

  function parsePayrollTokaXml() {
    return blockedPhysicalParser('cfdi_toka_xml');
  }

  function matchesBankPayment(person, payment) {
    const destinationMatches = payment.channel === 'banco'
      ? person.account === payment.destination
      : person.clabe === payment.destination;
    return destinationMatches && person.coverCashAmountMinor === payment.amountMinor;
  }

  function mergePayrollSources(input) {
    const cover = input && input.cover;
    const sameBank = (input && input.sameBank) || { payments: [], issues: [] };
    const spei = (input && input.spei) || { payments: [], issues: [] };
    const toka = (input && input.toka) || { vouchers: [], issues: [] };
    const issues = []
      .concat((cover && cover.issues) || [])
      .concat(sameBank.issues || [])
      .concat(spei.issues || [])
      .concat(toka.issues || []);

    if (!cover || !Array.isArray(cover.people) || cover.people.length === 0) {
      issues.push(issue(ISSUE_CODES.COVER_SHEET_REQUIRED, 'caratula'));
      return { parserVersion: PARSER_VERSION, people: [], issues };
    }

    const people = cover.people.map(function (person) {
      return Object.assign({}, person, {
        bankAmountMinor: 0,
        speiAmountMinor: 0,
        vouchersAmountMinor: 0
      });
    });

    function assignBankPayments(result, channel) {
      (result.payments || []).forEach(function (payment) {
        if (
          input.sourceAccount &&
          normalizeAccount(input.sourceAccount) !== payment.sourceAccount
        ) {
          issues.push(issue(ISSUE_CODES.SOURCE_ACCOUNT_MISMATCH, channel, payment.sourceRow));
          return;
        }
        const accountCandidates = people.filter(function (person) {
          return channel === 'banco'
            ? person.account === payment.destination
            : person.clabe === payment.destination;
        });
        const candidates = accountCandidates.filter(function (person) {
          return matchesBankPayment(person, payment);
        });

        if (accountCandidates.length === 1 && candidates.length === 0) {
          issues.push(issue(
            channel === 'banco' ? ISSUE_CODES.BANK_AMOUNT_MISMATCH : ISSUE_CODES.SPEI_AMOUNT_MISMATCH,
            channel === 'banco' ? 'layout_mismo_banco' : 'layout_spei',
            payment.sourceRow
          ));
          return;
        }
        if (candidates.length === 0) {
          issues.push(issue(ISSUE_CODES.EMPLOYEE_NOT_FOUND, channel, payment.sourceRow));
          return;
        }
        if (candidates.length > 1) {
          issues.push(issue(ISSUE_CODES.EMPLOYEE_MATCH_AMBIGUOUS, channel, payment.sourceRow));
          return;
        }

        const person = candidates[0];
        if (payment.normalizedName && payment.normalizedName !== person.normalizedName) {
          issues.push(issue(ISSUE_CODES.EMPLOYEE_NAME_MISMATCH, channel, payment.sourceRow));
          return;
        }
        if (channel === 'banco') person.bankAmountMinor += payment.amountMinor;
        else person.speiAmountMinor += payment.amountMinor;
      });
    }

    assignBankPayments(sameBank, 'banco');
    assignBankPayments(spei, 'spei');

    (toka.vouchers || []).forEach(function (voucher) {
      let candidates = [];
      if (voucher.rfc) {
        candidates = people.filter(function (person) { return person.rfc === voucher.rfc; });
      }
      if (candidates.length === 0 && voucher.curp) {
        candidates = people.filter(function (person) { return person.curp === voucher.curp; });
      }
      if (candidates.length === 0) {
        issues.push(issue(ISSUE_CODES.EMPLOYEE_NOT_FOUND, 'cfdi_vales', voucher.sourceRow));
        return;
      }
      if (candidates.length > 1) {
        issues.push(issue(ISSUE_CODES.EMPLOYEE_MATCH_AMBIGUOUS, 'cfdi_vales', voucher.sourceRow));
        return;
      }
      candidates[0].vouchersAmountMinor += voucher.amountMinor;
    });

    people.forEach(function (person) {
      if (person.vouchersAmountMinor !== person.coverVouchersAmountMinor) {
        issues.push(issue(ISSUE_CODES.VOUCHERS_AMOUNT_MISMATCH, 'person', person.sourceRow));
      }
    });

    return { parserVersion: PARSER_VERSION, people, issues };
  }

  function safeSum(values) {
    let total = 0;
    for (const value of values) {
      if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) {
        return null;
      }
      total += value;
    }
    return total;
  }

  function validatePeriod(periodStart, periodEnd) {
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    return iso.test(periodStart || '') && iso.test(periodEnd || '') && periodStart <= periodEnd;
  }

  function validatePayrollRun(run) {
    const issues = [];
    const people = (run && run.people) || [];
    const channels = (run && run.channels) || {};

    if (!run || !run.coverPresent) issues.push(issue(ISSUE_CODES.COVER_SHEET_REQUIRED, 'caratula'));
    if (!run || !validatePeriod(run.periodStart, run.periodEnd)) {
      issues.push(issue(ISSUE_CODES.PERIOD_INVALID, 'request'));
    }
    if (!run || !normalizeAccount(run.sourceAccount)) {
      issues.push(issue(ISSUE_CODES.SOURCE_ACCOUNT_MISMATCH, 'request'));
    }

    people.forEach(function (person) {
      const composed = safeSum([
        person.bankAmountMinor,
        person.speiAmountMinor,
        person.vouchersAmountMinor
      ]);
      if (composed === null || composed !== person.netAmountMinor) {
        issues.push(issue(ISSUE_CODES.TOTAL_MISMATCH, 'person', person.sourceRow));
      }
      if (person.coverCashAmountMinor !== person.bankAmountMinor + person.speiAmountMinor) {
        issues.push(issue(ISSUE_CODES.TOTAL_MISMATCH, 'caratula_cash', person.sourceRow));
      }
    });

    const bankTotal = safeSum(people.map(function (person) { return person.bankAmountMinor; }));
    const speiTotal = safeSum(people.map(function (person) { return person.speiAmountMinor; }));
    const vouchersTotal = safeSum(people.map(function (person) { return person.vouchersAmountMinor; }));
    const channelTotal = safeSum(['banco', 'spei', 'vales'].map(function (channel) {
      return channels[channel] || 0;
    }));

    if (bankTotal === null || bankTotal !== (channels.banco || 0)) {
      issues.push(issue(ISSUE_CODES.BANK_AMOUNT_MISMATCH, 'channel_banco'));
    }
    if (speiTotal === null || speiTotal !== (channels.spei || 0)) {
      issues.push(issue(ISSUE_CODES.SPEI_AMOUNT_MISMATCH, 'channel_spei'));
    }
    if (vouchersTotal === null || vouchersTotal !== (channels.vales || 0)) {
      issues.push(issue(ISSUE_CODES.VOUCHERS_AMOUNT_MISMATCH, 'channel_vales'));
    }
    if (
      channelTotal === null ||
      !Number.isSafeInteger(run && run.requestAmountMinor) ||
      channelTotal !== run.requestAmountMinor
    ) {
      issues.push(issue(ISSUE_CODES.TOTAL_MISMATCH, 'request'));
    }

    return {
      parserVersion: PARSER_VERSION,
      valid: issues.length === 0,
      totals: { bankMinor: bankTotal, speiMinor: speiTotal, vouchersMinor: vouchersTotal, requestMinor: channelTotal },
      issues
    };
  }

  return Object.freeze({
    PARSER_VERSION,
    SYNTHETIC_EVIDENCE,
    PAYROLL_SPEI_CONTRACT_VERSION,
    PAYROLL_SPEI_RECORD_BYTES,
    PAYROLL_SPEI_USEFUL_BYTES,
    ISSUE_CODES,
    normalizeText,
    normalizeName,
    normalizeIdentifier,
    normalizeAccount,
    parseMoneyMinor,
    parsePayrollCoverSheet,
    parsePayrollCoverSheetRows,
    parsePayrollBbvaSameBank,
    parsePayrollSpei,
    parsePayrollSpeiTxt,
    parsePayrollTokaXml,
    normalizePayrollBankRecords,
    normalizePayrollTokaRecords,
    mergePayrollSources,
    validatePayrollRun
  });
});
