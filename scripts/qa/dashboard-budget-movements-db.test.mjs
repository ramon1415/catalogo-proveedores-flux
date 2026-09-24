import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../app/package.json', import.meta.url))
const { PGlite } = require('@electric-sql/pglite')
const read = p => readFileSync(new URL('../../'+p, import.meta.url),'utf8')
const migration = read('supabase/migrations/20260924175643_dashboard_budget_movements_operational.sql')
const company='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
async function fixture() {
 const db=new PGlite()
 await db.exec(`
 create schema auth; create schema private; create role authenticated; create role anon; create role service_role;
 grant usage on schema public,private,auth to authenticated,anon;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function public.current_profile_id() returns uuid language sql as $$select auth.uid()$$;
 create function public.dashboard_assert_access() returns void language plpgsql as $$begin if current_setting('test.role',true)<>'director' then raise exception 'not_allowed'; end if; end$$;
 create function public.has_active_company_membership(uuid,uuid) returns boolean language sql as $$select $2='${company}'::uuid$$;
 create function private.profile_has_company_role(uuid,uuid,text[]) returns boolean language sql as $$select false$$;
 create table public.budget_versions(id int,active boolean);
 create table public.budget_lines(company_id uuid,budget_version_id int,budget_category_id uuid,budget_month date,amount numeric);
 create table public.proveedores(id uuid,alias text,nombre_completo text);
 create table public.payment_requests(id uuid default gen_random_uuid(),company_id uuid,budget_category_id uuid,budget_month date,status text,budget_decision text,amount_requested numeric,subtotal_amount numeric,currency text,exchange_rate numeric,no_presupuestal boolean,request_type text,request_number text default 'QA',proveedor_id uuid,description text default 'Prueba',submitted_at timestamptz,created_at timestamptz default '2026-09-05');
 create table public.payroll_obligations(id uuid default gen_random_uuid(),company_id uuid,budget_category_id uuid,budget_month date,status text,amount_minor bigint,no_presupuestal boolean,kind text default 'imss',submitted_at timestamptz,created_at timestamptz default '2026-09-06');
 insert into budget_versions values(1,true);
 insert into budget_lines values('${company}',1,'${company}','2026-09-01',1000);
 insert into payment_requests(company_id,budget_category_id,budget_month,status,budget_decision,amount_requested,subtotal_amount,currency,exchange_rate,no_presupuestal,request_type) values
 ('${company}','${company}','2026-09-01','paid','bloqueado',116,100,'MXN',null,false,'provider_payment'),
 ('${company}','${company}','2026-09-01','approved','bloqueado',232,200,'USD',2,false,'provider_payment'),
 ('${company}','${company}','2026-09-01','submitted','aprobable',50,null,'MXN',1,false,'nomina'),
 ('${company}','${company}','2026-09-01','pending_approval','bloqueado',999,null,'MXN',1,false,'provider_payment'),
 ('${company}','${company}','2026-09-01','draft','aprobable',999,null,'MXN',1,false,'provider_payment'),
 ('${company}',null,'2026-09-01','paid',null,25,null,'MXN',1,true,'reimbursement'),
 ('${other}','${company}','2026-09-01','paid','aprobable',9999,null,'MXN',1,false,'provider_payment'),
 ('${company}','${company}','2026-08-01','paid','aprobable',999,null,'MXN',1,false,'provider_payment');
 insert into payroll_obligations(company_id,budget_category_id,budget_month,status,amount_minor) values
 ('${company}','${company}','2026-09-01','paid',2000),('${company}','${company}','2026-08-01','paid',90000);
 set test.actor='${company}'; set test.role='director';
 `)
 await db.exec(read('supabase/migrations/20260918171356_dashboard_global_budget_report.sql'))
 await db.exec(migration)
 return db
}
const detail=async(db,key=company,month="'2026-09-01'")=>(await db.query(`select public.dashboard_budget_movements('${company}',2026,'${key}',${month}) as rows`)).rows[0].rows

test('detail reconciles with canonical summary: subtotal, FX, exceptions, payroll; rejects excluded rows and other companies',async()=>{
 const db=await fixture();try {
 await db.exec('set role authenticated')
 const rows=await detail(db)
 assert.equal(rows.length,4);assert.equal(rows.reduce((n,r)=>n+Number(r.amount),0),570)
 assert.equal(rows.filter(r=>r.status==='paid').reduce((n,r)=>n+Number(r.amount),0),120)
 const summary=(await db.query(`select public.dashboard_global_budget_report('${company}',2026) as rows`)).rows[0].rows
 const row=summary.find(r=>r.budget_month==='2026-09-01' && r.budget_category_id===company)
 assert.equal(Number(row.committed),rows.reduce((n,r)=>n+Number(r.amount),0))
 assert.equal(Number(row.executed),120)
 assert.equal((await detail(db,'__sin_partida__')).length,1)
 assert.equal((await detail(db,'__por_clasificar__')).length,0)
 }finally{await db.close()}
})
test('operational annual and monthly detail work without historical schema dependencies',async()=>{
 const db=await fixture();try {
 const rows=await detail(db,company,"'2026-08-01'");assert.equal(rows.length,2)
 assert.ok(rows.every(r=>r.source!=='historical'))
 assert.equal(rows.reduce((n,r)=>n+Number(r.amount),0),1899)
 assert.equal((await detail(db,company,'null')).reduce((n,r)=>n+Number(r.amount),0),2469)
 assert.equal((await detail(db,company,"'2026-07-01'")).length,0)
 }finally{await db.close()}
})
test('no partial totals on missing FX; validate periods, company, role and authentication',async()=>{
 const db=await fixture();try {
 await assert.rejects(db.query(`select public.dashboard_budget_movements('${other}',2026,'${company}',null)`),/company_access_required/)
 await assert.rejects(detail(db,company,"'2025-09-01'"),/invalid_month/)
 await assert.rejects(detail(db,company,"'2026-09-02'"),/invalid_month/)
 await db.exec(`update public.payment_requests set exchange_rate=null where currency='USD'`)
 await assert.rejects(detail(db),/conversion_missing/)
 await db.exec("set test.role='operator'");await assert.rejects(detail(db),/not_allowed/)
 await db.exec("set test.actor=''");await assert.rejects(detail(db),/not_authenticated/)
 await db.exec('set role anon');await assert.rejects(detail(db),/permission denied/)
 }finally{await db.close()}
})
