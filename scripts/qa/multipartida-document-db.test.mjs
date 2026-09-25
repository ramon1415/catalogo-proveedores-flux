import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { fixture, company, actor, approver, provider, cc, ordinary, shared } from './fixtures/multipartida-rpc-db.mjs'

const sql=readFileSync(new URL('./fixtures/multipartida-release/20260925160000_request_with_document_distributions.sql',import.meta.url),'utf8')
const good=`solicitudes/drafts/${actor}/qa.pdf`, rejected=`solicitudes/drafts/${actor}/reject.pdf`
const distributions=[{budget_category_id:ordinary,amount:20},{budget_category_id:shared,amount:10}]
const invoke=(db,{path=good,lines=distributions,legacy=false}={})=>db.query(`select public.create_payment_request_with_document(
 p_proveedor_id=>'${provider}',p_company_id=>'${company}',p_cost_center_id=>'${cc}',p_budget_category_id=>'${ordinary}',
 p_budget_month=>'2026-09-01',p_amount_requested=>30,p_currency=>'MXN',p_exchange_rate=>1,p_description=>'QA',p_notes=>null,
 p_requested_by=>null,p_is_extraordinary_adjustment=>false,p_approver_id=>'${approver}',p_approver_assignment_id=>null,
 p_subtotal_amount=>null,p_tax_amount=>null,p_withholding_amount=>null,p_invoice_uuid=>null,p_beneficiary_profile_id=>null,
 p_request_type=>'provider_payment',p_invoice_storage_path=>$1${legacy?'':',p_partida_unsure=>false,p_distributions=>$2::jsonb'}) as result`,legacy?[path]:[path,JSON.stringify(lines)])

test('document wrapper atomically creates request, distributions and document link',async t=>{
 const db=await fixture()
 try {
  await db.exec(`reset role;
   create schema storage; create schema auth;
   create function auth.uid() returns uuid language sql as $$select public.current_profile_id()$$;
   create table storage.objects(bucket_id text,name text,owner uuid);
   alter table public.payment_requests add column invoice_storage_path text check(invoice_storage_path not like '%reject%');
   insert into storage.objects values('payment-receipts','${good}','${actor}'),('payment-receipts','${rejected}','${actor}');`)
  await db.exec(sql)
  await db.exec('create role service_role')
  await db.exec(readFileSync(new URL('./fixtures/multipartida-release/20260925171716_multipartida_preserve_rpc_permissions.sql',import.meta.url),'utf8'))
  const permissions=(await db.query("select proname,has_function_privilege('anon',oid,'execute') anonymous,has_function_privilege('authenticated',oid,'execute') signed_in,has_function_privilege('service_role',oid,'execute') service from pg_proc where proname in ('create_payment_request','create_payment_request_with_document')")).rows
  assert.equal(permissions.length,3)
  assert.ok(permissions.every(p=>!p.anonymous&&p.signed_in&&p.service))
  await db.exec('set role authenticated')
  await t.test('new client creates two lines and attaches the owned object',async()=>{
   const result=(await invoke(db)).rows[0].result
   assert.equal(result.distribution_count,2)
   assert.equal(result.invoice_storage_path,good)
   assert.equal((await db.query('select * from payment_request_distributions where payment_request_id=$1',[result.payment_request_id])).rows.length,2)
   assert.equal((await db.query('select invoice_storage_path from payment_requests where id=$1',[result.payment_request_id])).rows[0].invoice_storage_path,good)
  })
  await t.test('old client without distribution arguments still creates a single-partida request',async()=>{
   const result=(await invoke(db,{legacy:true})).rows[0].result
   assert.equal(result.distribution_count,0)
   assert.equal(result.invoice_storage_path,good)
  })
  await t.test('failure linking the object rolls back request and distribution inserts',async()=>{
   const before=(await db.query('select (select count(*) from payment_requests) as requests,(select count(*) from payment_request_distributions) as lines')).rows[0]
   await assert.rejects(invoke(db,{path:rejected}),e=>e.code==='23514')
   assert.deepEqual((await db.query('select (select count(*) from payment_requests) as requests,(select count(*) from payment_request_distributions) as lines')).rows[0],before)
  })
  await t.test('foreign and missing objects fail before creation',async()=>{
   await assert.rejects(invoke(db,{path:`solicitudes/drafts/${company}/qa.pdf`}),/request_document_path_invalid/)
   await assert.rejects(invoke(db,{path:`solicitudes/drafts/${actor}/missing.pdf`}),/request_document_not_found_or_not_owned/)
  })
 } finally {await db.close()}
})
