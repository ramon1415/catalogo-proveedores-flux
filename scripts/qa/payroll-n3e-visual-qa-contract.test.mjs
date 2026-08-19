import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const payroll = require('../../payroll_parser.js');
const coverQa = require('../../payroll_cover_qa_parser.js');
const sameBankQa = require('../../payroll_same_bank_qa_parser.js');
const tokaQa = require('../../payroll_toka_qa_parser.js');
const visualModel = require('../../payroll_qa_visual_model.js');

const paths = Object.freeze({
  cover: 'scripts/qa/fixtures/payroll/Caratula_Nomina_Sintetica_QA_Flux.xlsx',
  sameBank: 'scripts/qa/fixtures/payroll/BBVA_Mismo_Banco_Nomina_Sintetica_QA_Flux.txt',
  spei: 'scripts/qa/fixtures/payroll/SPEI_Nomina_Sintetica_QA_Flux.txt',
  toka: 'scripts/qa/fixtures/payroll/TOKA_Vales_Nomina_Sintetica_QA_Flux.xml',
});

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function parsePackage() {
  const bytes = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, fs.readFileSync(path)]));
  const hashes = Object.fromEntries(Object.entries(bytes).map(([key, value]) => [key, sha256(value)]));
  const cover = await coverQa.parse(bytes.cover);
  const sameBank = sameBankQa.parse(bytes.sameBank, hashes.sameBank);
  const spei = payroll.parsePayrollSpeiTxt(bytes.spei);
  const toka = tokaQa.parse(bytes.toka, hashes.toka);
  return { bytes, hashes, cover, sameBank, spei, toka };
}

test('N3E commits all four exact QA fixtures with immutable hashes', async () => {
  const parsed = await parsePackage();
  for (const key of Object.keys(visualModel.FIXTURES)) {
    assert.equal(parsed.hashes[key], visualModel.FIXTURES[key].sha256, key);
  }
  assert.equal(parsed.bytes.cover.length > 0, true);
  assert.equal(parsed.bytes.sameBank.length, 261);
  assert.equal(parsed.bytes.spei.length, 650);
  assert.equal(parsed.bytes.toka.length > 0, true);
});

test('visual QA model cross-checks the full package across eight people', async () => {
  const parsed = await parsePackage();
  assert.equal(parsed.cover.valid, true);
  assert.equal(parsed.sameBank.valid, true);
  assert.equal(parsed.spei.issues.length, 0);
  assert.equal(parsed.spei.records.length, 5);
  assert.equal(parsed.toka.valid, true);

  const result = visualModel.evaluate({
    hashes: parsed.hashes,
    cover: parsed.cover,
    sameBank: parsed.sameBank,
    spei: parsed.spei,
    toka: parsed.toka,
  });

  assert.equal(result.valid, true);
  assert.equal(result.peopleCount, 8);
  assert.deepEqual(result.totals, {
    netAmountMinor: 6665150,
    bankAmountMinor: 2285050,
    speiAmountMinor: 4170100,
    vouchersAmountMinor: 210000,
  });
  assert.equal(result.qaOnly, true);
  assert.equal(result.certifiedPhysicalSource, false);
  assert.equal(result.realCertification, false);
  assert.equal(result.serverMutation, false);
  assert.equal(result.bankAction, false);
  assert.equal(result.stages.length, 6);
});

test('wrong fixture hash fails closed before visual PASS', async () => {
  const parsed = await parsePackage();
  const bad = visualModel.evaluate({
    hashes: { ...parsed.hashes, cover: '0'.repeat(64) },
    cover: parsed.cover,
    sameBank: parsed.sameBank,
    spei: parsed.spei,
    toka: parsed.toka,
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.issues.some((issue) => issue.code === 'PAYROLL_QA_FIXTURE_HASH_MISMATCH'));
});

test('visual page is DEV-only, role-gated and read-only', () => {
  const page = fs.readFileSync('payroll_qa_visual_page.js', 'utf8');
  const html = fs.readFileSync('nomina_qa.html', 'utf8');

  assert.match(page, /PRODUCTION_HOSTS/);
  assert.match(page, /PAYROLL_QA_PRODUCTION_HOST_BLOCKED/);
  assert.match(page, /ALLOWED_ROLES/);
  assert.match(page, /serverMutation/);
  assert.match(page, /bankAction/);
  assert.doesNotMatch(page, /\.rpc\s*\(/);
  assert.doesNotMatch(page, /from\(['\"](?:payment_requests|payroll_|notification_)/i);
  assert.doesNotMatch(page, /submit_payroll_for_approval|decide_payment_request|materialize_payroll_capture_internal/);
  assert.doesNotMatch(page, /supabaseClient|getFluxSupabaseClient/);

  for (const script of [
    'payroll_parser.js',
    'payroll_cover_qa_parser.js',
    'payroll_same_bank_qa_parser.js',
    'payroll_toka_qa_parser.js',
    'payroll_qa_visual_model.js',
    'payroll_qa_visual_page.js',
  ]) assert.ok(html.includes(script), script);
  assert.match(html, /NO PAGAR/);
  assert.match(html, /Ejecución real bloqueada/);
});

test('real physical-format blockers remain unchanged', () => {
  const sourceRecovery = fs.readFileSync('docs/ops/payroll-source-recovery-report.md', 'utf8');
  const page = fs.readFileSync('nomina_qa.html', 'utf8');
  for (const state of [
    'COVER_SHEET_XLSX = UNSUPPORTED_PENDING_SOURCE_CONTRACT',
    'BBVA_SAME_BANK_TXT = PARTIAL_CONTRACT_ONLY',
    'TOKA_XML = MISSING_PHYSICAL_SOURCE',
  ]) {
    assert.ok(sourceRecovery.includes(state), state);
    assert.ok(page.includes(state), state);
  }
});
