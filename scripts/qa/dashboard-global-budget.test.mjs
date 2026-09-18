import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(new URL('../../app/package.json', import.meta.url))
const { PGlite } = require('@electric-sql/pglite')
const migration = readFileSync(new URL('../../supabase/migrations/20260918171356_dashboard_global_budget_report.sql', import.meta.url), 'utf8')
const company = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create schema auth; create schema private;
    create role anon; create role authenticated;
    grant usage on schema public,private,auth to authenticated;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function public.current_profile_id() returns uuid language sql as $$select auth.uid()$$;
    create function public.dashboard_assert_access() returns void language plpgsql as $$ begin
      if current_setting('test.role',true) <> 'director' then raise exception 'not_allowed_to_view_dashboard'; end if;
    end $$;
    create function public.has_active_company_membership(uuid,uuid) returns boolean language sql as $$select $2='${company}'::uuid$$;
    create function private.profile_has_company_role(uuid,uuid,text[]) returns boolean language sql as $$select false$$;
    create table public.budget_versions(id int,active boolean);
    create table public.budget_lines(company_id uuid,budget_version_id int,budget_category_id uuid,budget_month date,amount numeric);
    create table public.payment_requests(company_id uuid,budget_category_id uuid,budget_month date,status text,
      budget_decision text,amount_requested numeric,subtotal_amount numeric,currency text,exchange_rate numeric,
      no_presupuestal boolean,request_type text);
    create table public.payroll_obligations(company_id uuid,budget_category_id uuid,budget_month date,status text,amount_minor bigint,no_presupuestal boolean);
    insert into budget_versions values(1,true),(2,false);
    insert into budget_lines values('${company}',1,'${company}','2026-09-01',1000),('${company}',2,'${company}','2026-09-01',9000),('${other}',1,'${other}','2026-09-01',5000);
    insert into payment_requests values
      ('${company}','${company}','2026-09-01','paid','aprobable',100,100,'MXN',1,false,'provider_payment'),
      ('${company}','${company}','2026-09-01','paid','bloqueado',232,200,'MXN',1,false,'provider_payment'),
      ('${company}','${other}','2026-09-01','paid','aprobable',50,null,'MXN',1,true,'provider_payment'),
      ('${company}','${other}','2026-09-01','paid','aprobable',300,null,'MXN',1,true,'nomina'),
      ('${company}','${company}','2026-09-01','approved','bloqueado',100,null,'MXN',1,false,'provider_payment'),
      ('${company}','${company}','2026-09-01','pending_approval','bloqueado',999,null,'MXN',1,false,'provider_payment'),
      ('${company}','${company}','2026-09-01','submitted','aprobable',50,null,'MXN',1,false,'reimbursement'),
      ('${other}','${company}','2026-09-01','paid','aprobable',9999,null,'MXN',1,false,'provider_payment'),
      ('${company}','${company}','2025-09-01','paid','aprobable',9999,null,'MXN',1,false,'provider_payment');
    insert into payroll_obligations values
      ('${company}','${company}','2026-09-01','paid',2000,false),
      ('${company}','${other}','2026-09-01','approved',1000,true),
      ('${other}','${other}','2026-09-01','paid',99999,true);
    set test.actor='${company}'; set test.role='director';
  `)
  await db.exec(migration)
  return db
}
async function report(db, id=company) {
  return (await db.query('select public.dashboard_global_budget_report($1,2026) report',[id])).rows[0].report
}
function total(rows,key) { return rows.reduce((sum,row)=>sum+Number(row[key]),0) }

test('global report reconciles ordinary payments, authorized exceptions, payroll and unbudgeted obligations once', async () => {
  const db=await fixture()
  try {
    await db.exec('set role authenticated')
    const rows=await report(db)
    assert.equal(total(rows,'budgeted'),1000)
    assert.equal(total(rows,'committed'),830)
    assert.equal(total(rows,'executed'),670)
    assert.equal(total(rows,'paid_amount'),702)
    assert.equal(total(rows,'available'),170)
    assert.equal(total(rows,'non_budget_used'),360)
    assert.equal(total(rows,'payroll_used'),300)
    assert.equal(rows.length,2) // A category without a budget line must still appear.
    assert.equal(rows.find(row=>row.budget_category_id===other).available,-360)
  } finally { await db.close() }
})

test('increased spending produces a negative global balance without increasing the budget or changing approvals', async () => {
  const db=await fixture()
  try {
    await db.exec(`insert into payment_requests values('${company}','${company}','2026-09-01','paid','bloqueado',250,null,'MXN',1,true,'provider_payment')`)
    const rows=await report(db)
    assert.equal(total(rows,'budgeted'),1000)
    assert.equal(total(rows,'committed'),1080)
    assert.equal(total(rows,'available'),-80)
    assert.equal((await db.query("select count(*) n from payment_requests where status='paid' and budget_decision='bloqueado'")).rows[0].n,2)
  } finally { await db.close() }
})

test('drafts, rejected and cancelled requests and obligations never consume budget; foreign currency uses its saved rate', async () => {
  const db=await fixture()
  try {
    for (const status of ['draft','rejected','cancelled','changes_requested']) {
      await db.query(`insert into payment_requests values($1,$1,'2026-09-01',$2,'aprobable',9000,null,'MXN',1,true,'provider_payment')`,[company,status])
    }
    await db.exec(`insert into payroll_obligations values('${company}','${company}','2026-09-01','cancelled',999999,true)`)
    await db.exec(`insert into payment_requests values('${company}','${company}','2026-09-01','paid','bloqueado',11.6,10,'USD',20,false,'provider_payment')`)
    assert.equal(total(await report(db),'committed'),1030)
    assert.equal(total(await report(db),'paid_amount'),934)
    await db.exec("update payment_requests set exchange_rate=null where currency='USD'")
    assert.equal(total(await report(db),'unconverted_count'),1)
  } finally { await db.close() }
})

test('report refuses anonymous, unauthorized-role, cross-company and invalid-year reads, including direct helper calls', async () => {
  const db=await fixture()
  try {
    await db.exec('set role anon')
    await assert.rejects(()=>report(db),/permission denied/)
    await db.exec('reset role; set role authenticated')
    await assert.rejects(()=>report(db,other),/company_access_required/)
    await assert.rejects(()=>db.query('select private.dashboard_global_budget_report($1,2026)',[other]),/company_access_required/)
    await assert.rejects(()=>db.query('select public.dashboard_global_budget_report($1,null)',[company]),/invalid_year/)
    await db.exec("set test.role='operator'")
    await assert.rejects(()=>report(db),/not_allowed_to_view_dashboard/)
    await db.exec("set test.role='director'; set test.actor=''")
    await assert.rejects(()=>report(db),/not_authenticated/)
  } finally { await db.close() }
})
