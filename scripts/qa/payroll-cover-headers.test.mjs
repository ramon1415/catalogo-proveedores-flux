import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const formats = require('../../payroll_real_formats.js');
const crc = bytes => { let c = 0xffffffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
function zip(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const n = Buffer.from(name), data = Buffer.from(text), checksum = crc(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt32LE(checksum, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(n.length, 28); cd.writeUInt32LE(offset, 42);
    locals.push(local, n, data); central.push(cd, n); offset += local.length + n.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function workbook({ modern = true, retro = false, blankRetro = false, mismatch = false, duplicate = false, missingNet = false, laterHeader = false, operadora = false } = {}) {
  const fields = [['RFC','XAXX010101000'],['CURP',''],['Nombre completo','PERSONA DE PRUEBA'],['Banco','BBVA'],['Cuenta banco','1234567890'],['CLABE','012345678901234567'],['Vales De Despensa','100.00'],['Pension Alimenticia','0']];
  if (!missingNet) fields.push([modern ? 'Neto con vales ' : 'Neto a pagar', mismatch ? '1199.99' : retro ? '1110.00' : '1100.00']);
  fields.push([modern ? 'Neto sin vales' : operadora ? 'Neto en efectivo (sin vales)' : 'Neto en efectivo', '1000.00']);
  if (retro) fields.push(['Retroactivo Vales Despensa', blankRetro ? '' : '10.00']);
  if (duplicate) fields.push(['Neto a pagar','1100.00']);
  const escape = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');
  const cell = (col, row, value) => `<c r="${col}${row}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
  let cells = fields.map(([label,value], i) => cell(String.fromCharCode(65+i),5,label)+cell(String.fromCharCode(65+i),6,value)).join('');
  if (laterHeader) cells += cell('Z',15,'Neto a pagar');
  const sheet = operadora ? 'OPERADORA TLACATECPAN' : 'SOPORTE FERSANA';
  return zip({ 'xl/workbook.xml': `<workbook><sheets><sheet name="${sheet}" r:id="rId1"/></sheets></workbook>`, 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${cells}</sheetData></worksheet>` });
}
test('Fersana periodo 17 net headers and absent retroactive column parse in Node and browser runtime', async () => {
  const browser = vm.createContext({ Uint8Array, ArrayBuffer, TextDecoder, Blob, Response, DecompressionStream });
  vm.runInContext(readFileSync(new URL('../../payroll_real_formats.js', import.meta.url), 'utf8'), browser);
  for (const api of [formats, browser.FluxPayrollRealFormats]) {
    const result = await api.parseCoverXlsx(workbook());
    assert.equal(result.valid, true); assert.equal(result.people.length, 1);
    assert.equal(result.totals.netAmountMinor, 110000); assert.equal(result.totals.cashAmountMinor, 100000); assert.equal(result.totals.vouchersAmountMinor, 10000);
  }
});
test('Fersana original headers retain retroactive vouchers and Operadora original contract stays valid', async () => {
  const old = await formats.parseCoverXlsx(workbook({ modern:false, retro:true }));
  assert.equal(old.valid,true); assert.equal(old.totals.vouchersAmountMinor,11000);
  assert.equal((await formats.parseCoverXlsx(workbook({ modern:false, operadora:true }))).valid,true);
  assert.equal((await formats.parseCoverXlsx(workbook({ operadora:true }))).valid,false);
});
test('ambiguous and missing net headers fail; labels from row 15 cannot supply row 5 headers', async () => {
  for (const options of [{duplicate:true}, {missingNet:true}, {missingNet:true,laterHeader:true}]) assert.equal((await formats.parseCoverXlsx(workbook(options))).valid,false);
  assert.equal((await formats.parseCoverXlsx(workbook({laterHeader:true}))).valid,true);
});
test('net mismatches and present but empty retroactive cells remain blocking', async () => {
  for (const options of [{mismatch:true}, {retro:true,blankRetro:true}]) {
    const r = await formats.parseCoverXlsx(workbook(options)); assert.equal(r.valid,false); assert.equal(r.totals,null); assert.equal(r.people.length,0);
  }
});
