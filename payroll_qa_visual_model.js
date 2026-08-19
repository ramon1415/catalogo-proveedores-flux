(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./payroll_parser.js'));
  } else {
    root.FluxPayrollQaVisualModel = factory(root.FluxPayrollParser);
  }
})(typeof self !== 'undefined' ? self : this, function (payroll) {
  'use strict';

  const SOURCE_ACCOUNT = '000000000000000001';
  const FIXTURES = Object.freeze({
    cover: Object.freeze({
      path: './scripts/qa/fixtures/payroll/Caratula_Nomina_Sintetica_QA_Flux.xlsx',
      sha256: '1c50510376ef71dbf4f3c5087a74140860136cadafe49f896f95f9ce8768fe94',
      contractVersion: 'flux-synthetic-cover-qa-v1'
    }),
    sameBank: Object.freeze({
      path: './scripts/qa/fixtures/payroll/BBVA_Mismo_Banco_Nomina_Sintetica_QA_Flux.txt',
      sha256: 'c8dfd71874c9fb7d8a9e3d8b87ed52198bb98d1e1cfeb7580f24cef447f25cf8',
      contractVersion: 'flux-synthetic-bbva-same-bank-qa-v1'
    }),
    spei: Object.freeze({
      path: './scripts/qa/fixtures/payroll/SPEI_Nomina_Sintetica_QA_Flux.txt',
      sha256: '26450184918d52a9784b250edf90f5f7d6b3da56db7c89b32a66cf5ffe59c306',
      contractVersion: 'bbva-simulator-pagos-interbancarios-128-v1'
    }),
    toka: Object.freeze({
      path: './scripts/qa/fixtures/payroll/TOKA_Vales_Nomina_Sintetica_QA_Flux.xml',
      sha256: '3e16bcbe4dcf39e7e46bc91aa8e682cd40460a8b0202c20b294db3e37cd7674c',
      contractVersion: 'flux-synthetic-toka-qa-v1'
    })
  });

  const EXPECTED = Object.freeze({
    people: 8,
    netAmountMinor: 6665150,
    bankAmountMinor: 2285050,
    speiAmountMinor: 4170100,
    vouchersAmountMinor: 210000
  });

  function issue(code, source) {
    return Object.freeze({ code: code, source: source || 'qa_package', severity: 'blocking' });
  }

  function hashesMatch(input) {
    const hashes = input && input.hashes || {};
    return Object.keys(FIXTURES).every(function (key) {
      return hashes[key] === FIXTURES[key].sha256;
    });
  }

  function evaluate(input) {
    const issues = [];
    if (!payroll || typeof payroll.mergePayrollSources !== 'function') {
      return Object.freeze({ valid: false, issues: [issue('PAYROLL_QA_MODEL_DEPENDENCY_MISSING')] });
    }
    if (!hashesMatch(input)) issues.push(issue('PAYROLL_QA_FIXTURE_HASH_MISMATCH'));

    const cover = input && input.cover;
    const sameBankRaw = input && input.sameBank;
    const speiRaw = input && input.spei;
    const tokaRaw = input && input.toka;

    if (!cover || !cover.valid || cover.qaOnly !== true || cover.certifiedPhysicalSource !== false || cover.contractVersion !== FIXTURES.cover.contractVersion) {
      issues.push(issue('PAYROLL_QA_COVER_INVALID', 'caratula'));
    }
    if (!sameBankRaw || !sameBankRaw.valid || sameBankRaw.qaOnly !== true || sameBankRaw.certifiedPhysicalSource !== false || sameBankRaw.contractVersion !== FIXTURES.sameBank.contractVersion) {
      issues.push(issue('PAYROLL_QA_SAME_BANK_INVALID', 'layout_mismo_banco'));
    }
    if (!speiRaw || (speiRaw.issues || []).length || speiRaw.contractVersion !== FIXTURES.spei.contractVersion || (speiRaw.records || []).length !== 5) {
      issues.push(issue('PAYROLL_QA_SPEI_INVALID', 'layout_spei'));
    }
    if (!tokaRaw || !tokaRaw.valid || tokaRaw.qaOnly !== true || tokaRaw.certifiedPhysicalSource !== false || tokaRaw.contractVersion !== FIXTURES.toka.contractVersion) {
      issues.push(issue('PAYROLL_QA_TOKA_INVALID', 'cfdi_vales'));
    }

    if (issues.length) {
      return Object.freeze({
        valid: false,
        qaOnly: true,
        certifiedPhysicalSource: false,
        realCertification: false,
        serverMutation: false,
        bankAction: false,
        issues: Object.freeze(issues)
      });
    }

    const sameBank = payroll.normalizePayrollBankRecords(sameBankRaw.records, { channel: 'banco' });
    const spei = payroll.normalizePayrollBankRecords(speiRaw.records, { channel: 'spei' });
    const toka = payroll.normalizePayrollTokaRecords(tokaRaw.records);
    const merged = payroll.mergePayrollSources({
      cover: cover,
      sameBank: sameBank,
      spei: spei,
      toka: toka,
      sourceAccount: SOURCE_ACCOUNT
    });

    issues.push.apply(issues, sameBank.issues || []);
    issues.push.apply(issues, spei.issues || []);
    issues.push.apply(issues, toka.issues || []);
    issues.push.apply(issues, merged.issues || []);

    const channels = {
      banco: sameBankRaw.totalAmountMinor,
      spei: (speiRaw.records || []).reduce(function (total, record) { return total + record.amountMinor; }, 0),
      vales: tokaRaw.totalAmountMinor
    };
    const requestAmountMinor = cover.totals && cover.totals.netAmountMinor;
    const validation = payroll.validatePayrollRun({
      coverPresent: true,
      periodStart: '2026-08-01',
      periodEnd: '2026-08-15',
      sourceAccount: SOURCE_ACCOUNT,
      people: merged.people,
      channels: channels,
      requestAmountMinor: requestAmountMinor
    });
    issues.push.apply(issues, validation.issues || []);

    if ((merged.people || []).length !== EXPECTED.people) issues.push(issue('PAYROLL_QA_PEOPLE_COUNT_MISMATCH'));
    if (requestAmountMinor !== EXPECTED.netAmountMinor) issues.push(issue('PAYROLL_QA_NET_TOTAL_MISMATCH'));
    if (channels.banco !== EXPECTED.bankAmountMinor) issues.push(issue('PAYROLL_QA_BANK_TOTAL_MISMATCH'));
    if (channels.spei !== EXPECTED.speiAmountMinor) issues.push(issue('PAYROLL_QA_SPEI_TOTAL_MISMATCH'));
    if (channels.vales !== EXPECTED.vouchersAmountMinor) issues.push(issue('PAYROLL_QA_VOUCHERS_TOTAL_MISMATCH'));

    const valid = issues.length === 0 && validation.valid === true;
    const stages = Object.freeze([
      Object.freeze({ key: 'capture', label: 'Paquete QA 4/4', status: valid ? 'pass' : 'blocked', detail: 'Hashes exactos y contratos QA-only.' }),
      Object.freeze({ key: 'crosscheck', label: 'Cross-check 8/8', status: valid ? 'pass' : 'blocked', detail: 'Carátula ↔ BBVA ↔ SPEI ↔ TOKA.' }),
      Object.freeze({ key: 'n3a', label: 'Materialización N3A', status: valid ? 'evidence' : 'blocked', detail: 'PASS certificado por UAT rollback; esta pantalla no escribe en DB.' }),
      Object.freeze({ key: 'n3b', label: 'Submit N3B', status: valid ? 'evidence' : 'blocked', detail: 'PASS certificado por UAT rollback e idempotencia.' }),
      Object.freeze({ key: 'approval', label: 'Aprobación', status: valid ? 'evidence' : 'blocked', detail: 'PASS certificado con aprobación individual existente.' }),
      Object.freeze({ key: 'freeze', label: 'Freeze post-decisión', status: valid ? 'pass' : 'blocked', detail: 'No permite dispersión/pago en esta fase.' })
    ]);

    return Object.freeze({
      valid: valid,
      qaOnly: true,
      certifiedPhysicalSource: false,
      realCertification: false,
      serverMutation: false,
      bankAction: false,
      sourceAccount: SOURCE_ACCOUNT,
      peopleCount: (merged.people || []).length,
      totals: Object.freeze({
        netAmountMinor: requestAmountMinor,
        bankAmountMinor: channels.banco,
        speiAmountMinor: channels.spei,
        vouchersAmountMinor: channels.vales
      }),
      stages: stages,
      issues: Object.freeze(issues)
    });
  }

  return Object.freeze({
    SOURCE_ACCOUNT: SOURCE_ACCOUNT,
    FIXTURES: FIXTURES,
    EXPECTED: EXPECTED,
    evaluate: evaluate
  });
});
