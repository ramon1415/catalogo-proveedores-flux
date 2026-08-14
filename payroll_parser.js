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
  const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

  const ISSUE_CODES = Object.freeze({
    COVER_SHEET_REQUIRED: 'PAYROLL_COVER_SHEET_REQUIRED',
    COVER_SHEET_CONTRACT_REQUIRED: 'PAYROLL_COVER_SHEET_CONTRACT_REQUIRED',
    SOURCE_FIXTURES_REQUIRED: 'PAYROLL_SOURCE_FIXTURES_REQUIRED',
    LAYOUT_FORMAT_UNSUPPORTED: 'PAYROLL_LAYOUT_FORMAT_UNSUPPORTED',
    LAYOUT_LINE_INVALID: 'PAYROLL_LAYOUT_LINE_INVALID',
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

  function parsePayrollSpei() {
    return blockedPhysicalParser('layout_spei_txt');
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
    parsePayrollTokaXml,
    normalizePayrollBankRecords,
    normalizePayrollTokaRecords,
    mergePayrollSources,
    validatePayrollRun
  });
});
