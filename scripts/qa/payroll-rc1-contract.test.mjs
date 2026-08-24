import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const provision=require('../../payroll_provision_base.js');
const edge=fs.readFileSync('supabase/functions/payroll-materialize/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20260821173000_payroll_rc1_provision_contpaq_feed.sql','utf8');
const paymentFeed=(migration.match(/create or replace function public\.get_payroll_contpaq_feed[\s\S]*?\n\$\$;\n/)||[''])[0];
const provisionFeed=(migration.match(/create or replace function public\.get_payroll_provision_contpaq_feed[\s\S]*?\n\$\$;\n/)||[''])[0];

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
  assert.doesNotMatch(migration,/insert into public\.payroll_run_lines[\s\S]{0,1200}sueldo/i);
});

test('RC1 provision policy does not freeze the rejected 5.05 percent assumption',()=>{
  assert.match(migration,/calculation_policy in \('pending','configured_components','server_calculated_components'\)/);
  assert.match(migration,/configured_aguinaldo_factor/);
  assert.match(migration,/configured_vacation_premium_factor/);
  assert.match(migration,/PAYROLL_PROVISION_SERVER_CALCULATION_REQUIRED/);
  assert.match(migration,/provision_policy_version/);
  assert.doesNotMatch(migration,/15\s*\/\s*365|0\.0505|5\.05|0\.17|17\.0/);
});

test('RC1 stores separate aguinaldo and vacation-premium components and one monthly forecast total',()=>{
  for(const field of ['aguinaldo_factor','vacation_premium_factor','aguinaldo_amount','vacation_premium_amount','combined_factor','provision_amount']) assert.ok(migration.includes(field),field);
  assert.match(migration,/provision_amount = aguinaldo_amount \+ vacation_premium_amount/);
  assert.match(migration,/v_provision:=v_aguinaldo\+v_vacation/);
  assert.match(migration,/date_trunc\('month',v_request\.payroll_period_end\)::date/);
  assert.match(migration,/v_after:=v_before\+v_provision/);
  assert.match(migration,/payment_request_id uuid primary key references public\.payment_requests/);
});

test('RC1 payment feed discharges payroll liabilities instead of booking salary or voucher expense again',()=>{
  assert.ok(paymentFeed.length>0);
  for(const role of ['salary_payable','vouchers_payable','toka_fee_expense','input_vat','toka_variance','bank_credit']) assert.ok(paymentFeed.includes(role),role);
  assert.doesNotMatch(paymentFeed,/cash_payroll_expense|vouchers_expense/);
  assert.match(paymentFeed,/Pago nómina · descarga pasivo sueldos/);
  assert.match(paymentFeed,/Pago vales · descarga pasivo/);
  assert.match(paymentFeed,/PAYROLL_CONTPAQ_UNBALANCED_FEED/);
  assert.match(paymentFeed,/'contains_employee_pii',false/);
  assert.doesNotMatch(paymentFeed,/employee_name|\brfc\b|\bcurp\b|\bnss\b|\bclabe\b/i);
});

test('RC1 provision CONTPAQ feed keeps aguinaldo and vacation premium separately balanced',()=>{
  assert.ok(provisionFeed.length>0);
  for(const role of ['provision_aguinaldo_expense','provision_aguinaldo_liability','provision_vacation_premium_expense','provision_vacation_premium_liability']) assert.ok(provisionFeed.includes(role),role);
  assert.match(provisionFeed,/PAYROLL_PROVISION_CONTPAQ_UNBALANCED_FEED/);
  assert.match(provisionFeed,/'source_type','payroll_provision'/);
  assert.match(provisionFeed,/'contains_employee_pii',false/);
});

test('RC1 CONTPAQ mappings remain configuration, scoped to cost center and exact source bank account',()=>{
  assert.match(paymentFeed,/PAYROLL_CONTPAQ_PAID_REQUIRED/);
  assert.match(paymentFeed,/PAYROLL_CONTPAQ_RECONCILIATION_REQUIRED/);
  assert.match(paymentFeed,/payroll_contpaq_account_for_role_internal\(v_request\.company_id,v_request\.cost_center_id/);
  assert.match(paymentFeed,/payroll_contpaq_bank_account_internal\(v_request\.company_bank_account_id\)/);
  assert.match(migration,/primary key\(company_id,cost_center_id,role\)/);
  assert.match(migration,/payroll_contpaq_bank_mappings/);
  assert.doesNotMatch(migration,/21001500000|21008500000|60201001000|60201010000|60201013000|60201014000|21003500000|21002500000|10201100000/);
});