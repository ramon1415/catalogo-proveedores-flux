(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./payroll_real_formats.js'));
  } else {
    root.FluxPayrollRealReconcile = factory(root.FluxPayrollRealFormats);
  }
})(typeof self !== 'undefined' ? self : this, function (formats) {
  'use strict';

  if (!formats) throw new Error('PAYROLL_REAL_FORMATS_REQUIRED');

  const CONTRACT_VERSION = 'payroll-real-package-v1';
  const ISSUE = Object.freeze({
    EXPECTED_CHANNELS_REQUIRED: 'PAYROLL_REAL_EXPECTED_CHANNELS_REQUIRED',
    COVER_REQUIRED: 'PAYROLL_REAL_COVER_REQUIRED',
    SAME_BANK_REQUIRED: 'PAYROLL_REAL_SAME_BANK_REQUIRED',
    SPEI_REQUIRED: 'PAYROLL_REAL_SPEI_REQUIRED',
    TOKA_CFDI_REQUIRED: 'PAYROLL_REAL_TOKA_CFDI_REQUIRED',
    TOKA_FUNDING_REQUIRED: 'PAYROLL_REAL_TOKA_FUNDING_REQUIRED',
    EMPLOYEE_NOT_FOUND: 'PAYROLL_REAL_EMPLOYEE_NOT_FOUND',
    EMPLOYEE_MATCH_AMBIGUOUS: 'PAYROLL_REAL_EMPLOYEE_MATCH_AMBIGUOUS',
    EMPLOYEE_TOTAL_MISMATCH: 'PAYROLL_REAL_EMPLOYEE_TOTAL_MISMATCH',
    UNDECLARED_CHANNEL_AMOUNT: 'PAYROLL_REAL_UNDECLARED_CHANNEL_AMOUNT',
    SOURCE_ACCOUNT_MISMATCH: 'PAYROLL_REAL_SOURCE_ACCOUNT_MISMATCH',
    CHANNEL_TOTAL_INVALID: 'PAYROLL_REAL_CHANNEL_TOTAL_INVALID',
    TOKA_FUNDING_INVALID: 'PAYROLL_REAL_TOKA_FUNDING_INVALID'
  });
  const WARNING = Object.freeze({
    SOURCE_NAME_DIFFERENCE: 'PAYROLL_SOURCE_NAME_DIFFERENCE',
    SOURCE_ACCOUNT_NOT_ENCODED: 'PAYROLL_SOURCE_ACCOUNT_NOT_ENCODED_IN_ACTIVE_LAYOUTS',
    TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED: 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'
  });

  function issue(code, source, row, field) {
    const out = { code: code, severity: 'blocking' };
    if (source) out.source = source;
    if (Number.isInteger(row) && row > 0) out.row = row;
    if (field) out.field = field;
    return out;
  }
  function warning(code, source, row, extra) {
    const out = { code: code, severity: 'warning' };
    if (source) out.source = source;
    if (Number.isInteger(row) && row > 0) out.row = row;
    return Object.assign(out, extra || {});
  }
  function normalizeName(value) { return formats.normalizeName(value); }
  function normalizeAccount(value) { return formats.normalizeAccount(value); }
  function nameTokens(value) {
    return new Set(normalizeName(value).split(' ').filter(function (x) { return x.length > 2; }));
  }
  function namesRoughlyAgree(a, b) {
    const aa = nameTokens(a); const bb = nameTokens(b);
    if (!aa.size || !bb.size) return true;
    let overlap = 0;
    aa.forEach(function (token) { if (bb.has(token)) overlap += 1; });
    return overlap >= Math.min(2, aa.size, bb.size);
  }
  function recordTotal(records) {
    let total = 0;
    for (const record of records || []) {
      if (!Number.isSafeInteger(record.amountMinor) || record.amountMinor <= 0 || !Number.isSafeInteger(total + record.amountMinor)) return null;
      total += record.amountMinor;
    }
    return total;
  }

  function reconcilePackage(input) {
    const expectedChannels = Array.from(new Set((input && input.expectedChannels) || []));
    const allowed = ['banco', 'spei', 'vales'];
    const issues = [];
    const warnings = [];
    if (!expectedChannels.length || expectedChannels.some(function (channel) { return !allowed.includes(channel); })) {
      issues.push(issue(ISSUE.EXPECTED_CHANNELS_REQUIRED, 'request'));
    }

    const cover = input && input.cover;
    const sameBank = input && input.sameBank;
    const spei = input && input.spei;
    const tokaCfdi = input && input.tokaCfdi;
    const tokaFunding = input && input.tokaFunding;
    const selectedSourceAccount = normalizeAccount(input && input.sourceAccount);

    if (!cover || !cover.valid || !Array.isArray(cover.people)) issues.push(issue(ISSUE.COVER_REQUIRED, 'caratula'));
    if (expectedChannels.includes('banco') && (!sameBank || !sameBank.valid || !Array.isArray(sameBank.records))) {
      issues.push(issue(ISSUE.SAME_BANK_REQUIRED, 'layout_mismo_banco'));
    }
    if (expectedChannels.includes('spei') && (!spei || !Array.isArray(spei.records) || (spei.issues || []).length)) {
      issues.push(issue(ISSUE.SPEI_REQUIRED, 'layout_spei'));
    }
    if (expectedChannels.includes('vales')) {
      if (!tokaCfdi || !tokaCfdi.valid || !Array.isArray(tokaCfdi.records)) issues.push(issue(ISSUE.TOKA_CFDI_REQUIRED, 'cfdi_vales'));
      if (!tokaFunding || !Array.isArray(tokaFunding.records) || tokaFunding.records.length !== 1 || (tokaFunding.issues || []).length) {
        issues.push(issue(ISSUE.TOKA_FUNDING_REQUIRED, 'layout_toka'));
      }
    }
    if (issues.length) return { contractVersion: CONTRACT_VERSION, valid: false, people: [], channels: [], issues: issues, warnings: warnings };

    const people = cover.people.map(function (person) {
      return Object.assign({}, person, { bankAmountMinor: 0, speiAmountMinor: 0, vouchersAmountMinor: 0 });
    });

    function assignBank(records, channel) {
      (records || []).forEach(function (record) {
        const destination = channel === 'banco' ? record.account : record.clabe;
        const candidates = people.filter(function (person) {
          const expectedDestination = channel === 'banco' ? person.account : person.clabe;
          return Boolean(expectedDestination) && expectedDestination === destination && person.coverCashAmountMinor === record.amountMinor;
        });
        if (candidates.length === 0) {
          issues.push(issue(ISSUE.EMPLOYEE_NOT_FOUND, channel === 'banco' ? 'layout_mismo_banco' : 'layout_spei', record.sourceRow));
          return;
        }
        if (candidates.length > 1) {
          issues.push(issue(ISSUE.EMPLOYEE_MATCH_AMBIGUOUS, channel === 'banco' ? 'layout_mismo_banco' : 'layout_spei', record.sourceRow));
          return;
        }
        const person = candidates[0];
        if (channel === 'banco') person.bankAmountMinor += record.amountMinor;
        else person.speiAmountMinor += record.amountMinor;
        if (record.employeeName && !namesRoughlyAgree(person.employeeName, record.employeeName)) {
          warnings.push(warning(WARNING.SOURCE_NAME_DIFFERENCE, channel === 'banco' ? 'layout_mismo_banco' : 'layout_spei', record.sourceRow));
        }
      });
    }

    if (expectedChannels.includes('banco')) assignBank(sameBank.records, 'banco');
    if (expectedChannels.includes('spei')) assignBank(spei.records, 'spei');

    if (expectedChannels.includes('vales')) {
      tokaCfdi.records.forEach(function (record) {
        let candidates = [];
        if (record.rfc) candidates = people.filter(function (person) { return person.rfc === record.rfc; });
        if (!candidates.length && record.curp) candidates = people.filter(function (person) { return person.curp === record.curp; });
        if (candidates.length === 0) {
          issues.push(issue(ISSUE.EMPLOYEE_NOT_FOUND, 'cfdi_vales', record.sourceRow));
          return;
        }
        if (candidates.length > 1) {
          issues.push(issue(ISSUE.EMPLOYEE_MATCH_AMBIGUOUS, 'cfdi_vales', record.sourceRow));
          return;
        }
        candidates[0].vouchersAmountMinor += record.amountMinor;
        if (record.employeeName && !namesRoughlyAgree(candidates[0].employeeName, record.employeeName)) {
          warnings.push(warning(WARNING.SOURCE_NAME_DIFFERENCE, 'cfdi_vales', record.sourceRow));
        }
      });
    }

    people.forEach(function (person) {
      if (!expectedChannels.includes('vales') && person.coverVouchersAmountMinor > 0) {
        issues.push(issue(ISSUE.UNDECLARED_CHANNEL_AMOUNT, 'caratula', person.sourceRow, 'vales'));
      }
      if (!expectedChannels.includes('banco') && person.bankAmountMinor > 0) {
        issues.push(issue(ISSUE.UNDECLARED_CHANNEL_AMOUNT, 'person', person.sourceRow, 'banco'));
      }
      if (!expectedChannels.includes('spei') && person.speiAmountMinor > 0) {
        issues.push(issue(ISSUE.UNDECLARED_CHANNEL_AMOUNT, 'person', person.sourceRow, 'spei'));
      }
      if (person.bankAmountMinor > 0 && person.speiAmountMinor > 0) {
        issues.push(issue(ISSUE.EMPLOYEE_TOTAL_MISMATCH, 'person', person.sourceRow, 'dual_bank_rail'));
      }
      if (
        person.bankAmountMinor + person.speiAmountMinor !== person.coverCashAmountMinor ||
        person.vouchersAmountMinor !== person.coverVouchersAmountMinor ||
        person.bankAmountMinor + person.speiAmountMinor + person.vouchersAmountMinor !== person.netAmountMinor
      ) {
        issues.push(issue(ISSUE.EMPLOYEE_TOTAL_MISMATCH, 'person', person.sourceRow));
      }
    });

    const encodedSourceAccounts = [];
    if (expectedChannels.includes('spei')) (spei.records || []).forEach(function (record) { encodedSourceAccounts.push(normalizeAccount(record.sourceAccount)); });
    if (expectedChannels.includes('vales')) (tokaFunding.records || []).forEach(function (record) { encodedSourceAccounts.push(normalizeAccount(record.sourceAccount)); });
    if (!selectedSourceAccount) {
      issues.push(issue(ISSUE.SOURCE_ACCOUNT_MISMATCH, 'request'));
    } else if (encodedSourceAccounts.length) {
      if (encodedSourceAccounts.some(function (account) { return !account || account !== selectedSourceAccount; })) {
        issues.push(issue(ISSUE.SOURCE_ACCOUNT_MISMATCH, 'request'));
      }
    } else {
      warnings.push(warning(WARNING.SOURCE_ACCOUNT_NOT_ENCODED, 'request', null, { authority: 'selected_capture_not_encoded_in_same_bank_108' }));
    }

    const bankTotal = expectedChannels.includes('banco') ? recordTotal(sameBank.records) : 0;
    const speiTotal = expectedChannels.includes('spei') ? recordTotal(spei.records) : 0;
    const benefitTotal = expectedChannels.includes('vales') ? tokaCfdi.benefitAmountMinor : 0;
    if ([bankTotal, speiTotal, benefitTotal].some(function (value) { return value === null; })) issues.push(issue(ISSUE.CHANNEL_TOTAL_INVALID, 'channels'));

    const calculatedBank = people.reduce(function (sum, person) { return sum + person.bankAmountMinor; }, 0);
    const calculatedSpei = people.reduce(function (sum, person) { return sum + person.speiAmountMinor; }, 0);
    const calculatedBenefit = people.reduce(function (sum, person) { return sum + person.vouchersAmountMinor; }, 0);
    if (calculatedBank !== bankTotal || calculatedSpei !== speiTotal || calculatedBenefit !== benefitTotal) {
      issues.push(issue(ISSUE.CHANNEL_TOTAL_INVALID, 'channels'));
    }

    const channels = [];
    if (expectedChannels.includes('banco')) channels.push({ channel: 'banco', amountMinor: bankTotal });
    if (expectedChannels.includes('spei')) channels.push({ channel: 'spei', amountMinor: speiTotal });

    let financeReviewRequired = false;
    if (expectedChannels.includes('vales')) {
      const funding = tokaFunding.records[0];
      if (!funding || normalizeName(funding.employeeName).indexOf('TOKA INTERNACIONAL') < 0) {
        issues.push(issue(ISSUE.TOKA_FUNDING_INVALID, 'layout_toka'));
      }
      const actualFunding = funding ? funding.amountMinor : 0;
      const expectedFunding = tokaCfdi.expectedFundingAmountMinor;
      const variance = actualFunding - expectedFunding;
      financeReviewRequired = variance !== 0;
      if (financeReviewRequired) {
        warnings.push(warning(WARNING.TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED, 'layout_toka', 1, {
          varianceAmountMinor: variance,
          expectedFundingAmountMinor: expectedFunding,
          actualFundingAmountMinor: actualFunding
        }));
      }
      channels.push({
        channel: 'vales',
        amountMinor: actualFunding,
        benefitAmountMinor: benefitTotal,
        feeAmountMinor: tokaCfdi.feeAmountMinor,
        taxAmountMinor: tokaCfdi.taxAmountMinor,
        expectedFundingAmountMinor: expectedFunding,
        fundingVarianceMinor: variance
      });
    }

    const employeeNetTotalMinor = people.reduce(function (sum, person) { return sum + person.netAmountMinor; }, 0);
    const treasuryRequestAmountMinor = channels.reduce(function (sum, channel) { return sum + channel.amountMinor; }, 0);
    return {
      contractVersion: CONTRACT_VERSION,
      valid: issues.length === 0,
      financeReviewRequired: financeReviewRequired,
      sourceAccountAuthority: encodedSourceAccounts.length ? 'server_verified_from_physical_layout' : 'selected_capture_not_encoded_in_same_bank_108',
      people: issues.length ? [] : people,
      channels: issues.length ? [] : channels,
      employeeNetTotalMinor: employeeNetTotalMinor,
      treasuryRequestAmountMinor: treasuryRequestAmountMinor,
      issues: issues,
      warnings: warnings
    };
  }

  return Object.freeze({
    CONTRACT_VERSION: CONTRACT_VERSION,
    ISSUE: ISSUE,
    WARNING: WARNING,
    reconcilePackage: reconcilePackage
  });
});
