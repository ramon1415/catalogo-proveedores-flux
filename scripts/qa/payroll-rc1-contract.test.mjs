import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const provision=require('../../payroll_provision_base.js');
const edge=fs.readFileSync('supabase/functions/payroll-materialize/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260821173000_payroll_rc1_provision_contpaq_feed.sql','utf8');

function le16(v){return Buffer.from([v&255,(v>>>8)&255]);}
function le32(v){return Buffer.from([v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]);}
function storedZip(entries){
  const locals=[];const centrals=[];let offset=0;
  for(const [name,text] of entries){
    const n=Buffer.from(name),b=Buffer.from(text);
    const local=Buffer.concat([le32(0x04034b50),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(b.length),le32(b.length),le16(n.length),le16(0),n,b]);
    locals.push(local);
    centrals.push(Buffer.concat([le32(0x02014b50),le16(20),le16(20),le16(0),le16(0),le16(0),le16(0),le32(0),le32(b.length),le32(b.length),le16(n.length),le16(0),le16(0),le16(0),le16(0),le32(0),le32(offset),n]));
    offset+=local.length;
  }
  const central=Buffer.concat(centrals);
  return Buffer.concat([...locals,central,le32(0x06054b50),le16(0),le16(0),le16(entries.length),le16(entries.length),le32(central.length),le32(offset),le16(0)]);
}
function cell(ref,value,type='str'){return `<c r="${ref}" t="${type}"><v>${value}</v></c>`;}
function fixture(){
  const headers=Array.from({length:20},(_,i)=>`Col ${i+1}`);headers[18]='Sueldo';headers[19]='Sueldo Vacaciones';
  const headerCells=headers.map((h,i)=>cell(String.fromCharCode(65+i)+'5',h)).join('');
  const row=(r,sueldo,vac)=>`<row r="${r}">${cell('S'+r,sueldo,'n')}${cell('T'+r,vac,'n')}</row>`;
  const sheet=`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5">${headerCells}</row>${row(6,'1000.25','100.00')}${row(7,'2000.50','200.00')}${row(8,'0','50.00')}</sheetData></worksheet>`;
  const workbook=`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="OPERADORA TLACATECPAN" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels=`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="rId1"/></Relationships>`;
  return storedZip([['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',rels],['xl/worksheets/sheet1.xml',sheet]]);
}

test('RC1 derives one provision base from Sueldo + Sueldo Vacaciones at real columns 19+20',async()=>{
  const parsed=await provision.parseProvisionBaseXlsx(fixture());
  assert.equal(parsed.valid,true);
  assert.equal(parsed.rowCount,3);
  assert.equal(parsed.baseAmountMinor,335075);
  assert.deepEqual(provision.REQUIRED_HEADERS,['Sueldo','Sueldo Vacaciones']);
});

test('RC1 provision base is server-side aggregate only and never added to payroll_run_lines',()=>{
  assert.match(edge,/payroll_provision_base\.js/);
  assert.match(edge,/parseProvisionBaseXlsx\(bytes\)/);
  assert.match(edge,/provision_base_amount_minor:provisionBaseAmountMinor/);
  assert.match(migration,/post_payroll_provision_internal/);
  assert.match(migration,/provision_base_amount_minor/);
  assert.doesNotMatch(migration,/insert into public\.payroll_run_lines[\s\S]{0,1200}sueldo/i);
  assert.doesNotMatch(edge,/sueldo_amount|vacation_salary|sueldo_vacaciones/i);
});

test('RC1 factor is configuration, not hard-coded business logic',()=>{
  assert.match(migration,/payroll_provision_settings/);
  assert.match(migration,/configure_payroll_provision/);
  assert.match(migration,/combined_factor/);
  assert.doesNotMatch(migration,/15\s*\/\s*365|0\.0411|4\.11/);
  assert.match(migration,/PAYROLL_PROVISION_CONFIG_REQUIRED/);
});

test('RC1 provision is idempotent per payroll request and accumulates into monthly budget_lines',()=>{
  assert.match(migration,/payment_request_id uuid primary key references public\.payment_requests/);
  assert.match(migration,/date_trunc\('month',v_request\.payroll_period_end\)::date/);
  assert.match(migration,/v_after:=v_before\+v_provision/);
  assert.match(migration,/update public\.budget_lines set amount=v_after/);
  assert.match(migration,/insert into public\.budget_lines/);
  assert.match(migration,/v_provision:=public\.post_payroll_provision_internal/);
});

test('RC1 TOKA accounting feed separates vouchers, fee, VAT and signed variance while preserving one operational channel',()=>{
  for(const role of ['cash_payroll_expense','vouchers_expense','toka_fee_expense','input_vat','toka_variance','bank_credit']) assert.ok(migration.includes(role),role);
  assert.match(migration,/v_variance:=v_actual_toka-v_expected_toka/);
  assert.match(migration,/if v_variance>0 then/);
  assert.match(migration,/credit',abs\(v_variance\)/);
  assert.match(migration,/PAYROLL_CONTPAQ_UNBALANCED_FEED/);
  assert.match(migration,/'contains_employee_pii',false/);
  assert.doesNotMatch(migration,/get_payroll_contpaq_feed[\s\S]*employee_name|get_payroll_contpaq_feed[\s\S]*\brfc\b|get_payroll_contpaq_feed[\s\S]*\bcurp\b/i);
});

test('RC1 CONTPAQ feed cannot export before payment confirmation and reconciliation',()=>{
  assert.match(migration,/PAYROLL_CONTPAQ_PAID_REQUIRED/);
  assert.match(migration,/PAYROLL_CONTPAQ_RECONCILIATION_REQUIRED/);
  assert.match(migration,/payroll_contpaq_role_mappings/);
  assert.match(migration,/PAYROLL_CONTPAQ_MAPPING_REQUIRED/);
});
