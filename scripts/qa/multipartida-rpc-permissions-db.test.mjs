import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, rpc, line, company, actor, cc, ordinary, shared, other } from './fixtures/multipartida-rpc-db.mjs'

test('multipartida RPC respects the production permissions boundary', async t => {
 const db=await fixture()
 try {
  await t.test('fixture reproduces private settings and SELECT-only budget RLS',async()=>{
   await assert.rejects(db.query('select * from public.payroll_obligation_settings'),e=>e.code==='42501')
   assert.equal((await db.query('select * from public.budget_lines')).rows.length,2)
   assert.equal((await db.query('select * from public.budget_lines for update')).rows.length,0)
  })
  await t.test('full RPC creates ordinary distributions without reading private settings as caller',async()=>{
   const result=(await rpc(db,[line(ordinary,10)])).rows[0].result
   assert.equal(result.distribution_count,1)
   assert.equal(result.budget_decision,'aprobable')
  })
  await t.test('full RPC includes a shared secondary category and atomically inserts both lines',async()=>{
   const result=(await rpc(db,[line(ordinary,20),line(shared,10)])).rows[0].result
   assert.equal(result.distribution_count,2)
   assert.equal((await db.query('select * from payment_request_distributions where payment_request_id=$1',[result.payment_request_id])).rows.length,2)
  })
  await t.test('shared secondary over budget aborts with 40001 and leaves no request',async()=>{
   const before=(await db.query('select count(*) from payment_requests')).rows[0].count
   await assert.rejects(rpc(db,[line(ordinary,20),line(shared,101)]),e=>e.code==='40001')
   assert.equal((await db.query('select count(*) from payment_requests')).rows[0].count,before)
  })
  await t.test('unauthorized company is rejected before eligibility lookup',async()=>{
   await assert.rejects(db.query(`select private.lock_and_check_obligation_budget('${other}','${cc}','${ordinary}','2026-09-01',1)`),/company_authorization_required/)
  })
  await t.test('helper denies missing identity and anonymous execution',async()=>{
   await db.exec("set test.actor=''")
   await assert.rejects(db.query(`select private.lock_and_check_obligation_budget('${company}','${cc}','${ordinary}','2026-09-01',1)`),/not_authenticated/)
   await db.exec('reset role; set role anon')
   await assert.rejects(db.query(`select private.lock_and_check_obligation_budget('${company}','${cc}','${ordinary}','2026-09-01',1)`),e=>e.code==='42501')
  })
 } finally {await db.close()}
})
