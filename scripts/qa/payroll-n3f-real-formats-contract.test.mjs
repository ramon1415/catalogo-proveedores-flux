import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const real = require('../../payroll_real_formats.js');
const reconcile = require('../../payroll_real_reconcile.js');
const payroll = require('../../payroll_parser.js');
const migration = fs.readFileSync('supabase/migrations/20260820002000_payroll_n3f_real_formats_toka_funding.sql', 'utf8');
const edge = fs.readFileSync('supabase/functions/payroll-materialize/index.ts', 'utf8');

const SOURCE = '000000000000000111';
const SAME_ACCOUNT = '991500000001';
const SPEI_CLABE = '014180000000000222';
const TOKA_CLABE = '646180000000000333';

function le16(value) { return Buffer.from([value & 255, (value >>> 8) & 255]); }
function le32(value) { return Buffer.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function storedZip(entries) {
  const locals = []; const centrals = []; let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name); const body = Buffer.from(text);
    const local = Buffer.concat([
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(0), le32(body.length), le32(body.length), le16(nameBytes.length), le16(0), nameBytes, body,
    ]);
    locals.push(local);
    centrals.push(Buffer.concat([
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(0), le32(body.length), le32(body.length), le16(nameBytes.length), le16(0), le16(0),
      le16(0), le16(0), le32(0), le32(offset), nameBytes,
    ]));
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([...locals, central, le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length), le32(central.length), le32(offset), le16(0)]);
}
function xmlEscape(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function cell(ref, value, type = 'str') { return `<c r="${ref}" t="${type}"><v>${xmlEscape(value)}</v></c>`; }
function coverFixture({ withVouchers = true } = {}) {
  const headers = real.REQUIRED_COVER_HEADERS;
  const headerCells = headers.map((header, index) => cell(String.fromCharCode(65 + index) + '5', header)).join('');
  const voucher = withVouchers ? '50' : '0';
  const netTwo = withVouchers ? '200' : '150';
  const rows = [
    [6, 'TEST010101AA1', 'TEST010101HDFABC01', 'PERSONA SINTETICA UNO', 'BBVA', SAME_ACCOUNT, '', '0', '100', '100'],
    [7, 'TEST020202BB2', 'TEST020202MDFABC02', 'PERSONA SINTETICA DOS', 'BANCO EXTERNO', '', SPEI_CLABE, voucher, netTwo, '150'],
    [8, 'TEST030303CC3', 'TEST030303HDFABC03', 'PERSONA SINTETICA CERO', '', '', '', '0', '0', '0'],
  ];
  const body = rows.map(([row, rfc, curp, name, bank, account, clabe, vales, net, cash]) => {
    const vals = [rfc, curp, name, bank, account, clabe, vales, net, cash];
    return `<row r="${row}">${vals.map((value, index) => cell(String.fromCharCode(65 + index) + row, value, index >= 6 ? 'n' : 'str')).join('')}</row>`;
  }).join('');
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5">${headerCells}</row>${body}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OPERADORA TLACATECPAN" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/></Relationships>`;
  return storedZip([['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', rels], ['xl/worksheets/sheet1.xml', sheet]]);
}
function fixed(value, width) { const text = String(value).toUpperCase(); assert.ok(text.length <= width); return text.padEnd(width, ' '); }
function sameBank108() {
  const useful = ['000000001', fixed('', 16), '99', fixed(SAME_ACCOUNT, 20), String(10000).padStart(15, '0'), fixed('ALIAS UNO', 40), '001', '001'].join('');
  assert.equal(useful.length, 108);
  return Buffer.from(`${useful}\r\n`, 'ascii');
}
function amount16(value) { const [major, fraction] = String(value).split('.'); return major.padStart(13, '0') + '.' + (fraction || '').padEnd(2, '0'); }
function speiLine(destination, amount, name, reference, numeric = '0000001') {
  const useful = [destination, SOURCE, 'MXP', amount16(amount), fixed(name, 30), '40', destination.slice(0, 3), fixed(reference, 30), numeric, 'H'].join('');
  assert.equal(useful.length, 128);
  return `${useful}\r\n`;
}
function spei150() { return Buffer.from(speiLine(SPEI_CLABE, '150.00', 'NOMBRE DIFERENTE', 'NOMINA PRUEBA'), 'ascii'); }
function tokaFunding5117() { return Buffer.from(speiLine(TOKA_CLABE, '51.17', 'TOKA INTERNACIONAL', 'VD PRUEBA SINTETICA', '1234567'), 'ascii'); }
function tokaCfdi5000() {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:valesdedespensa="http://www.sat.gob.mx/valesdedespensa" Version="4.0" Moneda="MXN" SubTotal="1.00" Total="1.16">
  <cfdi:Emisor Rfc="TIN090211JC9" Nombre="TOKA INTERNACIONAL"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="0.16"/>
  <cfdi:Complemento><valesdedespensa:ValesDeDespensa version="1.0" tipoOperacion="monedero electrónico" total="50.00"><valesdedespensa:Conceptos>
    <valesdedespensa:Concepto rfc="TEST020202BB2" curp="TEST020202MDFABC02" numSeguridadSocial="00000000001" nombre="OTRO NOMBRE DOS" importe="50.00"/>
  </valesdedespensa:Conceptos></valesdedespensa:ValesDeDespensa></cfdi:Complemento>
</cfdi:Comprobante>`, 'utf8');
}
async function packageFixtures({ channels = ['banco', 'spei', 'vales'] } = {}) {
  const cover = await real.parseCoverXlsx(coverFixture({ withVouchers: channels.includes('vales') }));
  const sameBank = channels.includes('banco') ? real.parseSameBank108(sameBank108()) : null;
  const spei = channels.includes('spei') ? payroll.parsePayrollSpeiTxt(spei150()) : null;
  const tokaCfdi = channels.includes('vales') ? real.parseTokaCfdi(tokaCfdi5000()) : null;
  const tokaFunding = channels.includes('vales') ? payroll.parsePayrollSpeiTxt(tokaFunding5117()) : null;
  return { cover, sameBank, spei, tokaCfdi, tokaFunding, sourceAccount: SOURCE, expectedChannels: channels };
}

test('real cover contract is header-driven, preserves zero-net rows, and does not require NSS', async () => {
  const parsed = await real.parseCoverXlsx(coverFixture());
  assert.equal(parsed.valid, true);
  assert.equal(parsed.people.length, 3);
  assert.equal(parsed.people[2].netAmountMinor, 0);
  assert.equal(parsed.people[2].nss, '');
  assert.deepEqual(parsed.totals, { netAmountMinor: 30000, cashAmountMinor: 25000, vouchersAmountMinor: 5000 });
});

test('Nomina 108 physical contract is 108 useful ASCII bytes plus CRLF', () => {
  const bytes = sameBank108();
  assert.equal(bytes.length, 110);
  const parsed = real.parseSameBank108(bytes);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.recordCount, 1);
  assert.equal(parsed.totalAmountMinor, 10000);
  assert.equal(parsed.records[0].type, '99');
  assert.equal(parsed.records[0].bankCode + parsed.records[0].plazaCode, '001001');
  assert.equal(parsed.records[0].account, SAME_ACCOUNT);
});

test('TOKA CFDI separates employee benefit from provider fee/tax and expected funding', () => {
  const parsed = real.parseTokaCfdi(tokaCfdi5000());
  assert.equal(parsed.valid, true);
  assert.equal(parsed.benefitAmountMinor, 5000);
  assert.equal(parsed.feeAmountMinor, 100);
  assert.equal(parsed.taxAmountMinor, 16);
  assert.equal(parsed.providerChargeAmountMinor, 116);
  assert.equal(parsed.expectedFundingAmountMinor, 5116);
  assert.equal(parsed.records.length, 1);
});

test('full physical package uses actual TOKA funding for treasury amount and requires Finance review on one-cent variance', async () => {
  const result = reconcile.reconcilePackage(await packageFixtures());
  assert.equal(result.valid, true);
  assert.equal(result.people.length, 3);
  assert.equal(result.employeeNetTotalMinor, 30000);
  assert.equal(result.treasuryRequestAmountMinor, 30117);
  assert.equal(result.financeReviewRequired, true);
  assert.deepEqual(result.channels.find((channel) => channel.channel === 'vales'), {
    channel: 'vales', amountMinor: 5117, benefitAmountMinor: 5000, feeAmountMinor: 100,
    taxAmountMinor: 16, expectedFundingAmountMinor: 5116, fundingVarianceMinor: 1
  });
  assert.ok(result.warnings.some((entry) => entry.code === 'PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED'));
  assert.ok(result.warnings.some((entry) => entry.code === 'PAYROLL_SOURCE_NAME_DIFFERENCE'));
});

test('channels are conditional and same-bank-only capture does not pretend source-account byte verification', async () => {
  const cover = await real.parseCoverXlsx(coverFixture({ withVouchers: false }));
  cover.people = cover.people.filter((person) => person.sourceRow !== 7);
  cover.totals = { netAmountMinor: 10000, cashAmountMinor: 10000, vouchersAmountMinor: 0 };
  const result = reconcile.reconcilePackage({ cover, sameBank: real.parseSameBank108(sameBank108()), spei: null, tokaCfdi: null, tokaFunding: null, sourceAccount: SOURCE, expectedChannels: ['banco'] });
  assert.equal(result.valid, true);
  assert.equal(result.channels.length, 1);
  assert.equal(result.treasuryRequestAmountMinor, 10000);
  assert.equal(result.sourceAccountAuthority, 'selected_capture_not_encoded_in_same_bank_108');
  assert.ok(result.warnings.some((entry) => entry.code === 'PAYROLL_SOURCE_ACCOUNT_NOT_ENCODED_IN_ACTIVE_LAYOUTS'));
});

test('source account, physical record shape and undeclared channels fail closed', async () => {
  const input = await packageFixtures();
  const badSource = reconcile.reconcilePackage({ ...input, sourceAccount: '999999999999999999' });
  assert.equal(badSource.valid, false);
  assert.ok(badSource.issues.some((entry) => entry.code === 'PAYROLL_REAL_SOURCE_ACCOUNT_MISMATCH'));
  assert.equal(real.parseSameBank108(Buffer.from(sameBank108().subarray(0, 109))).valid, false);
  assert.equal(reconcile.reconcilePackage({ ...input, tokaCfdi: null, tokaFunding: null, expectedChannels: ['banco', 'spei'] }).valid, false);
});

test('migration models treasury funding, zero-net snapshot, dual TOKA evidence and submit acknowledgement guard', () => {
  assert.match(migration, /net_amount >= 0/);
  for (const field of ['benefit_amount','fee_amount','tax_amount','expected_funding_amount','funding_variance_acknowledged_at']) assert.ok(migration.includes(field), field);
  assert.match(migration, /kind in \('caratula','layout_mismo_banco','layout_spei','layout_toka','cfdi_vales'\)/);
  assert.match(migration, /acknowledge_payroll_toka_funding_variance/);
  assert.match(migration, /PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED/);
  assert.match(migration, /insert into public\.payroll_channels[\s\S]*amount,currency,benefit_amount,fee_amount,tax_amount,expected_funding_amount/);
  assert.match(migration, /v_amount_minor\/100\.0/);
  assert.doesNotMatch(migration, /insert into public\.payroll_run_lines[\s\S]*perception|isr|imss/i);
});

test('Edge reparses every real physical file from downloaded bytes and browser summaries remain diagnostic', () => {
  for (const pattern of [/payroll_real_formats\.js/, /payroll_real_reconcile\.js/, /parseCoverXlsx\(bytes\)/, /parseSameBank108\(bytes\)/, /parseTokaCfdi\(bytes\)/, /parsePayrollSpeiTxt\(bytes\)/, /layout_toka/, /crypto\.subtle\.digest\("SHA-256"/, /authority:"server_verified"/, /browser_server_match:/]) assert.match(edge, pattern);
  assert.doesNotMatch(edge, /OCR|manual employee/i);
  assert.doesNotMatch(edge, /client_parsed_unverified.*valid:true/);
});

test('N3F fixtures are generated in-test and do not read external payroll source files', () => {
  const testSource = fs.readFileSync('scripts/qa/payroll-n3f-real-formats-contract.test.mjs', 'utf8');
  assert.match(testSource, /PERSONA SINTETICA/);
  assert.match(testSource, /TEST010101AA1/);
  assert.doesNotMatch(testSource, /readFileSync\(['"]\/mnt\/data\//);
  assert.doesNotMatch(testSource, /readFileSync\(['"]scripts\/qa\/fixtures\/payroll\//);
  const fixtureNames = fs.readdirSync('scripts/qa/fixtures/payroll');
  const realSourceNamePattern = /^(?:Nom\s+15_|3054\d+_|OPERADORA\s+TLACATECPAN\s+-\s+Reporte)/i;
  assert.equal(fixtureNames.some((name) => realSourceNamePattern.test(name)), false);
});
