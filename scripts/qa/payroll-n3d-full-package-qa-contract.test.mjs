import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const coverQa = require('../../payroll_cover_qa_parser.js');
const sameBankQa = require('../../payroll_same_bank_qa_parser.js');
const tokaQa = require('../../payroll_toka_qa_parser.js');
const payroll = require('../../payroll_parser.js');

const SAME_BANK_PATH = 'scripts/qa/fixtures/payroll/BBVA_Mismo_Banco_Nomina_Sintetica_QA_Flux.txt';
const TOKA_PATH = 'scripts/qa/fixtures/payroll/TOKA_Vales_Nomina_Sintetica_QA_Flux.xml';
const SOURCE_ACCOUNT = '000000000000000001';

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function le16(value) { return Buffer.from([value & 255, (value >>> 8) & 255]); }
function le32(value) { return Buffer.from([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]); }
function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const body = Buffer.from(text);
    const local = Buffer.concat([
      le32(0x04034b50), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(0), le32(body.length), le32(body.length), le16(nameBytes.length), le16(0), nameBytes, body,
    ]);
    locals.push(local);
    const central = Buffer.concat([
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(0), le16(0), le16(0),
      le32(0), le32(body.length), le32(body.length), le16(nameBytes.length), le16(0), le16(0),
      le16(0), le16(0), le32(0), le32(offset), nameBytes,
    ]);
    centrals.push(central);
    offset += local.length;
  }
  const centralBody = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    centralBody,
    le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length),
    le32(centralBody.length), le32(offset), le16(0),
  ]);
}

function cell(ref, value, type = 'str') {
  const escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<x:c r="${ref}" t="${type}"><x:v>${escaped}</x:v></x:c>`;
}

function qaWorkbook() {
  const headers = coverQa.EXPECTED_HEADERS.map((value, index) => cell(String.fromCharCode(65 + index) + '8', value)).join('');
  const rows = [
    [9,'QA-001','PERSONA PRUEBA UNO','PRUE010101AA1','PRUE010101HDFRRS01','01010101010','SANTANDER','','014180000000000001','1250','0','1250','0'],
    [10,'QA-002','PERSONA PRUEBA DOS','PRUE020202BB2','PRUE020202MDFRRS02','02020202020','BBVA','000000000000000002','','9800','9800','0','0'],
    [11,'QA-003','PERSONA PRUEBA TRES','PRUE030303CC3','PRUE030303HDFRRS03','03030303030','BANORTE','','072180000000000003','15750.25','0','15750.25','0'],
    [12,'QA-004','PERSONA PRUEBA CUATRO','PRUE040404DD4','PRUE040404MDFRRS04','04040404040','BBVA','000000000000000004','','6400','5800','0','600'],
    [13,'QA-005','PERSONA PRUEBA CINCO','PRUE050505EE5','PRUE050505HDFRRS05','05050505050','BBVA','000000000000000005','','7250.5','7250.5','0','0'],
    [14,'QA-006','PERSONA PRUEBA SEIS','PRUE060606FF6','PRUE060606MDFRRS06','06060606060','HSBC','','021180000000000006','9300','0','8400','900'],
    [18,'QA-007','PERSONA PRUEBA SIETE','PRUE070707GG7','PRUE070707HDFRRS07','07070707070','SANTANDER','','014180000000000007','11200.75','0','11200.75','0'],
    [19,'QA-008','PERSONA PRUEBA OCHO','PRUE080808HH8','PRUE080808MDFRRS08','08080808080','BANORTE','','072180000000000008','5700','0','5100','600'],
  ];
  const rowXml = rows.map((r) => {
    const [row, qa, name, rfc, curp, nss, bankName, account, clabe, net, bank, spei, vouchers] = r;
    const values = [qa,name,rfc,curp,nss,bankName,account,clabe,net,bank,spei,vouchers];
    const refs = 'ABCDEFGHIJKL';
    let cells = values.map((value, i) => cell(refs[i] + row, value, i >= 8 ? 'n' : 'str')).join('');
    cells += cell('AD' + row, [9,11,14,18,19].includes(row) ? spei : '0', 'n');
    return `<x:row r="${row}">${cells}</x:row>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1">${cell('A1','OPERADORA TLACATECPAN — REPORTE DE NÓMINA PERIODO 15 — SINTÉTICO QA')}</x:row><x:row r="6">${cell('H6','NO CERTIFICADA')}</x:row><x:row r="8">${headers}</x:row>${rowXml}</x:sheetData></x:worksheet>`;
  const workbook = `<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="OPERADORA TLACATECPAN" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/></Relationships>`;
  return storedZip([
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

function fixed(value, width) {
  const text = String(value).toUpperCase();
  assert.ok(text.length <= width);
  return text.padEnd(width, ' ');
}

function amount16(value) {
  const [major, minor] = String(value).split('.');
  return major.padStart(13, '0') + '.' + (minor || '').padEnd(2, '0');
}

function speiFixture() {
  const rows = [
    ['014180000000000001','1250.00','PERSONA PRUEBA UNO','0000001'],
    ['072180000000000003','15750.25','PERSONA PRUEBA TRES','0000002'],
    ['021180000000000006','8400.00','PERSONA PRUEBA SEIS','0000003'],
    ['014180000000000007','11200.75','PERSONA PRUEBA SIETE','0000004'],
    ['072180000000000008','5100.00','PERSONA PRUEBA OCHO','0000005'],
  ];
  return Buffer.from(rows.map(([destination, amount, name, numeric]) => [
    destination,
    SOURCE_ACCOUNT,
    'MXP',
    amount16(amount),
    fixed(name, 30),
    '40',
    destination.slice(0, 3),
    fixed('NOMINA SINTETICA QA', 30),
    numeric,
    'H',
  ].join('') + '\r\n').join(''), 'ascii');
}

test('synthetic BBVA and TOKA fixtures are byte-identified and QA-only', () => {
  const bbva = fs.readFileSync(SAME_BANK_PATH);
  const toka = fs.readFileSync(TOKA_PATH);
  assert.equal(sha256(bbva), sameBankQa.FIXTURE_SHA256);
  assert.equal(sha256(toka), tokaQa.FIXTURE_SHA256);
  assert.equal(bbva.length, 261);
  assert.equal(bbva.length / sameBankQa.RECORD_BYTES, 3);

  const parsedBbva = sameBankQa.parse(bbva, sha256(bbva));
  const parsedToka = tokaQa.parse(toka, sha256(toka));
  assert.equal(parsedBbva.valid, true);
  assert.equal(parsedToka.valid, true);
  assert.equal(parsedBbva.qaOnly, true);
  assert.equal(parsedToka.qaOnly, true);
  assert.equal(parsedBbva.certifiedPhysicalSource, false);
  assert.equal(parsedToka.certifiedPhysicalSource, false);
  assert.equal(parsedBbva.totalAmountMinor, 2285050);
  assert.equal(parsedToka.totalAmountMinor, 210000);
});

test('wrong hashes fail closed before QA fixture data is accepted', () => {
  const bbva = fs.readFileSync(SAME_BANK_PATH);
  const toka = fs.readFileSync(TOKA_PATH);
  assert.equal(sameBankQa.parse(bbva, '0'.repeat(64)).valid, false);
  assert.equal(tokaQa.parse(toka, '0'.repeat(64)).valid, false);
});

test('cover, same-bank, SPEI and TOKA cross-check exactly across eight synthetic people', async () => {
  const cover = await coverQa.parse(qaWorkbook());
  assert.equal(cover.valid, true);

  const bbvaBytes = fs.readFileSync(SAME_BANK_PATH);
  const bbvaRaw = sameBankQa.parse(bbvaBytes, sha256(bbvaBytes));
  assert.equal(bbvaRaw.valid, true);
  const sameBank = payroll.normalizePayrollBankRecords(bbvaRaw.records, { channel: 'banco' });
  assert.equal(sameBank.issues.length, 0);

  const speiRaw = payroll.parsePayrollSpeiTxt(speiFixture());
  assert.equal(speiRaw.issues.length, 0);
  assert.equal(speiRaw.records.length, 5);
  const spei = payroll.normalizePayrollBankRecords(speiRaw.records, { channel: 'spei' });
  assert.equal(spei.issues.length, 0);

  const tokaBytes = fs.readFileSync(TOKA_PATH);
  const tokaRaw = tokaQa.parse(tokaBytes, sha256(tokaBytes));
  assert.equal(tokaRaw.valid, true);
  const toka = payroll.normalizePayrollTokaRecords(tokaRaw.records);
  assert.equal(toka.issues.length, 0);

  const merged = payroll.mergePayrollSources({ cover, sameBank, spei, toka, sourceAccount: SOURCE_ACCOUNT });
  assert.equal(merged.issues.length, 0);
  assert.equal(merged.people.length, 8);

  const channels = { banco: 2285050, spei: 4170100, vales: 210000 };
  const validation = payroll.validatePayrollRun({
    coverPresent: true,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-15',
    sourceAccount: SOURCE_ACCOUNT,
    people: merged.people,
    channels,
    requestAmountMinor: 6665150,
  });
  assert.equal(validation.valid, true);
  assert.equal(validation.issues.length, 0);
  assert.deepEqual(validation.totals, {
    bankMinor: 2285050,
    speiMinor: 4170100,
    vouchersMinor: 210000,
    requestMinor: 6665150,
  });
});

test('synthetic adapters cannot promote themselves to real physical certification', () => {
  for (const path of ['payroll_same_bank_qa_parser.js', 'payroll_toka_qa_parser.js']) {
    const source = fs.readFileSync(path, 'utf8');
    assert.match(source, /qaOnly: true/);
    assert.match(source, /certifiedPhysicalSource: false/);
    assert.doesNotMatch(source, /REAL_(?:BBVA|TOKA)_CERTIFIED|CERTIFIED_PHYSICAL_SOURCE/);
  }
  const sourceRecovery = fs.readFileSync('docs/ops/payroll-source-recovery-report.md', 'utf8');
  assert.match(sourceRecovery, /BBVA_SAME_BANK_TXT = PARTIAL_CONTRACT_ONLY/);
  assert.match(sourceRecovery, /TOKA_XML = MISSING_PHYSICAL_SOURCE/);
});
