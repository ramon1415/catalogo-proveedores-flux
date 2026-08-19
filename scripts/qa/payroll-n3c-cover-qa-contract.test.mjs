import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('../../payroll_cover_qa_parser.js');

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
  const eocd = Buffer.concat([
    le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length),
    le32(centralBody.length), le32(offset), le16(0),
  ]);
  return Buffer.concat([...locals, centralBody, eocd]);
}

function cell(ref, value, type = 'str') {
  const escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<x:c r="${ref}" t="${type}"><x:v>${escaped}</x:v></x:c>`;
}

function qaWorkbook() {
  const headers = parser.EXPECTED_HEADERS.map((value, index) => cell(String.fromCharCode(65 + index) + '8', value)).join('');
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
    if ([9,11,14,18,19].includes(row)) cells += cell('AD' + row, spei, 'n');
    else cells += cell('AD' + row, '0', 'n');
    return `<x:row r="${row}">${cells}</x:row>`;
  }).join('');
  const sheet = `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
    <x:row r="1">${cell('A1','OPERADORA TLACATECPAN — REPORTE DE NÓMINA PERIODO 15 — SINTÉTICO QA')}</x:row>
    <x:row r="6">${cell('H6','NO CERTIFICADA')}</x:row><x:row r="8">${headers}</x:row>${rowXml}</x:sheetData></x:worksheet>`;
  const workbook = `<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="OPERADORA TLACATECPAN" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/></Relationships>`;
  return storedZip([
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', rels],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

test('synthetic XLSX adapter is explicitly QA-only', async () => {
  const result = await parser.parse(qaWorkbook());
  assert.equal(result.valid, true);
  assert.equal(result.qaOnly, true);
  assert.equal(result.certifiedPhysicalSource, false);
  assert.equal(result.contractVersion, 'flux-synthetic-cover-qa-v1');
  assert.equal(result.sheetName, 'OPERADORA TLACATECPAN');
});

test('synthetic cover parser extracts exact QA totals without OCR', async () => {
  const result = await parser.parse(qaWorkbook());
  assert.equal(result.people.length, 8);
  assert.deepEqual(result.totals, {
    netAmountMinor: 6665150,
    bankAmountMinor: 2285050,
    speiAmountMinor: 4170100,
    vouchersAmountMinor: 210000,
  });
  assert.deepEqual(parser.RECOVERED_MAP, ['C6→AD18','C7→AD11','C8→AD19','C9→AD14','C10→AD9']);
  assert.equal(result.issues.length, 0);
});

test('synthetic cover contract includes only safe issue metadata on failure', async () => {
  const result = await parser.parse(new Uint8Array([0x50,0x4b,0x03,0x04,0x00]));
  assert.equal(result.valid, false);
  assert.equal(result.people.length, 0);
  assert.ok(result.issues.length > 0);
  for (const item of result.issues) {
    assert.ok(Object.keys(item).every((key) => ['code','severity','source','row','field'].includes(key)));
  }
});

test('adapter cannot claim the synthetic workbook is the real physical payroll source', () => {
  const source = fs.readFileSync('payroll_cover_qa_parser.js', 'utf8');
  assert.match(source, /certifiedPhysicalSource: false/);
  assert.match(source, /qaOnly: true/);
  assert.doesNotMatch(source, /CERTIFIED_PHYSICAL_SOURCE|REAL_COVER_CERTIFIED/);
});
