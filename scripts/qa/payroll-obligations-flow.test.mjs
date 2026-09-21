import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const [company,other,rh,finance,outsider,category,center,budgetVersion]=[1,2,3,4,5,6,7,8].map(id);
let db;
async function as(profile,fn,role='authenticated'){
 await db.query("select set_config('test.profile',$1,false),set_config('request.jwt.claim.role',$2,false)",[profile||'',role]);
 await db.exec(`set role ${role}`);try{return await fn();}finally{await db.exec('reset role');}
}
const call=async(name,args=[])=> (await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;
const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
before(async()=>{
 db=new PGlite();await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema private;create schema auth;create schema storage;create schema cron;
 create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
 grant usage on schema public,private,auth,storage to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.profile',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_setting('request.jwt.claim.role',true))$$;
 create function public.current_profile_id() returns uuid language sql stable as $$select auth.uid()$$;
 create table companies(id uuid primary key,name text,active boolean,rfc text);
 create table profiles(id uuid primary key,active boolean,email text);
 create table test_memberships(profile_id uuid,company_id uuid,role text,active boolean);
 create function public.has_active_company_membership(p uuid,c uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from test_memberships where profile_id=p and company_id=c and active)$$;
 create function private.profile_has_company_role(p uuid,c uuid,r text[]) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from test_memberships where profile_id=p and company_id=c and active and role=any(r))$$;
 create table payroll_capture_grants(profile_id uuid,company_id uuid,active boolean);
 create table cost_centers(id uuid primary key,name text,active boolean);
 create table budget_categories(id uuid primary key,name text,active boolean,no_presupuestal boolean);
 create table company_cost_center_budget_categories(company_id uuid,cost_center_id uuid,budget_category_id uuid,active boolean);
 create table budget_versions(id uuid primary key,active boolean);
 create table budget_lines(id uuid primary key default gen_random_uuid(),company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_version_id uuid,budget_month date,amount numeric);
 create table payment_requests(id uuid primary key default gen_random_uuid(),company_id uuid,cost_center_id uuid,budget_category_id uuid,budget_month date,amount_requested numeric,status text);
 create view public.budget_availability with(security_invoker=true) as select b.company_id,b.cost_center_id,b.budget_category_id,b.budget_month,b.amount budgeted,
 coalesce(sum(r.amount_requested),0) committed,coalesce(sum(r.amount_requested)filter(where r.status='paid'),0) executed,b.amount-coalesce(sum(r.amount_requested),0) available
 from budget_lines b left join payment_requests r using(company_id,cost_center_id,budget_category_id,budget_month) group by b.company_id,b.cost_center_id,b.budget_category_id,b.budget_month,b.amount;
 grant select on budget_availability,budget_lines,payment_requests to authenticated,service_role;
 create function verify_budget_availability(c uuid,cc uuid,bc uuid,m date,a numeric,e boolean,np boolean) returns jsonb language sql set search_path=public as $$
 select jsonb_build_object('status',case when exists(select 1 from company_cost_center_budget_categories where company_id=c and cost_center_id=cc and budget_category_id=bc and active)
 and (select available from budget_availability where company_id=c and cost_center_id=cc and budget_category_id=bc and budget_month=m)>=a then 'aprobable' else 'bloqueado' end)$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);alter table storage.objects enable row level security;grant insert on storage.objects to authenticated;
 create table payroll_notification_settings(company_id uuid primary key,finance_recipient_profile_id uuid,app_origin text);
 create table notification_events(id uuid primary key default gen_random_uuid(),event_type text,source_table text,source_id uuid,source_folio text,recipient_type text,recipient_profile_id uuid,recipient_email text,channel text,priority text,payload jsonb,idempotency_key text unique,status text,last_error text,next_attempt_at timestamptz,locked_by text,locked_at timestamptz,last_attempt_at timestamptz,updated_at timestamptz,attempt_count integer default 0,max_attempts integer default 5,created_at timestamptz default now());
 insert into companies values('${company}','A',true,'AAA010101AAA'),('${other}','B',true,'BBB010101BBB');
 insert into profiles values('${rh}',true,'rh@example.com'),('${finance}',true,'finance@example.com'),('${outsider}',true,'other@example.com');
 insert into test_memberships values('${rh}','${company}','operator',true),('${finance}','${company}','finance',true),('${outsider}','${company}','operator',true);
 insert into payroll_capture_grants values('${rh}','${company}',true);
 insert into cost_centers values('${center}','Cost center',true);insert into budget_categories values('${category}','IMSS',true,false);
 insert into company_cost_center_budget_categories values('${company}','${center}','${category}',true);
 insert into budget_versions values('${budgetVersion}',true);insert into budget_lines(company_id,cost_center_id,budget_category_id,budget_version_id,budget_month,amount) values('${company}','${center}','${category}','${budgetVersion}','2026-07-01',1000);
 insert into payroll_notification_settings values('${company}','${finance}','https://flux.example.com');
 `);
 await db.exec(read('../../supabase/migrations/20260908172940_payroll_obligations_imss_isn.sql'));
 await db.exec(read('../../supabase/migrations/20260908173408_payroll_obligations_app_origin.sql'));
 await db.exec(read('../../supabase/migrations/20260908182623_payroll_obligations_review_feedback.sql'));
 await db.query('insert into payroll_obligation_settings(company_id,kind,enabled,budget_category_id) values($1,$2,true,$3)',[company,'imss',category]);
});
after(async()=>{await db?.close();});
const snapshot=async obligation=>as(rh,async()=>(await call('get_payroll_obligations',[company,obligation]))[0]);
const parsed={kind:'imss_sipare',taxpayerRfc:'AAA010101AAA',employerRegistration:'Z9912345678',periodStart:'2026-07-01',periodEnd:'2026-07-31',amountMinor:10000,dueDate:'2026-08-17',paymentReference:'QA-REF-001',issues:[]};
async function upload(obligation,kind,actor,hash,doc){
 const o=await snapshot(obligation);const reservation=await as(actor,()=>call('reserve_payroll_obligation_file',[obligation,o.version,kind,100,hash.repeat(64)]));
 await as(actor,()=>db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[reservation.bucket,reservation.path]));
 await as(null,()=>call('complete_payroll_obligation_file',[reservation.file_id,actor,hash.repeat(64),JSON.stringify(doc)]),'service_role');return reservation;
}
test('capture permissions do not grant payment or cross-company access; raw tables stay private',async()=>{
 const capture=await as(rh,()=>call('get_payroll_obligation_context',[company]));assert.equal(capture.can_capture,true);assert.equal(capture.can_pay,false);
 const pay=await as(finance,()=>call('get_payroll_obligation_context',[company]));assert.equal(pay.can_capture,false);assert.equal(pay.can_pay,true);
 await assert.rejects(as(outsider,()=>call('save_payroll_obligation',[id(20),company,'imss'])),/ACCESS_DENIED/);
 await assert.rejects(as(rh,()=>call('save_payroll_obligation',[id(20),other,'imss'])),/ACCESS_DENIED/);
 await assert.rejects(as(rh,()=>db.query('select * from payroll_obligations')),/permission denied/);
 await assert.rejects(as(null,()=>call('get_payroll_obligation_context',[company]),'anon'),/permission denied/);
});
test('IMSS lifecycle reserves budget once, requires receipt, notifies correct profiles and locks paid',async()=>{
 const obligation=id(30);await as(rh,()=>call('save_payroll_obligation',[obligation,company,'imss',null,center,'2026-07-01']));
 await upload(obligation,'imss_sipare',rh,'a',parsed);
 let o=await snapshot(obligation);assert.equal(o.amount_minor,10000);
 await assert.rejects(as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'submit'])),/ACCESS_DENIED/);
 await as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'submit']));
 assert.equal(await as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'submit'])),'submitted');
 const budget=await as(outsider,()=>db.query('select * from budget_availability'));
 assert.equal(Number(budget.rows[0].available),900);assert.equal(Number(budget.rows[0].committed),100);
 o=await snapshot(obligation);await assert.rejects(as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'confirm'])),/ACCESS_DENIED/);
 await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'confirm']));
 o=await snapshot(obligation);await assert.rejects(as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10000,'2026-07-15','QA-PAY'])),/RECEIPT_REQUIRED/);
 await upload(obligation,'receipt',finance,'b',{amount:'100.00',paymentDate:'2026-07-15',reference:'QA-PAY',currency:'MXN'});
 o=await snapshot(obligation);await assert.rejects(as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10001,'2026-07-15','QA-PAY'])),/PAYMENT_FIELDS_INVALID/);
 await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10000,'2026-07-15','QA-PAY']));
 await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10000,'2026-07-15','QA-PAY']));
 o=await snapshot(obligation);assert.equal(o.status,'paid');
 await assert.rejects(as(finance,()=>call('reserve_payroll_obligation_file',[obligation,o.version,'receipt',100,'c'.repeat(64)])),/FILE_STATE_INVALID/);
 const after=await as(outsider,()=>db.query('select * from budget_availability'));assert.equal(Number(after.rows[0].available),900);assert.equal(Number(after.rows[0].executed),100);
 const events=await db.query('select event_type,recipient_profile_id from notification_events order by event_type');assert.equal(events.rows.length,2);
 assert.equal(events.rows.find(e=>e.event_type.endsWith('.paid')).recipient_profile_id,rh);assert.equal(events.rows.find(e=>e.event_type.endsWith('.registered')).recipient_profile_id,finance);
});
test('storage cannot be spoofed and revoked capturers lose access',async()=>{
 await assert.rejects(as(rh,()=>db.query("insert into storage.objects(bucket_id,name) values('payroll-obligations','invented.pdf')")),/row-level security/);
 await db.query('update payroll_capture_grants set active=false where profile_id=$1',[rh]);
 await assert.rejects(as(rh,()=>call('get_payroll_obligations',[company])),/ACCESS_DENIED/);
 await db.query('update payroll_capture_grants set active=true where profile_id=$1',[rh]);
});
test('ordinary request spending and IMSS share availability; failed sends do not reserve and cancellation releases',async()=>{
 await db.query('insert into payment_requests(company_id,cost_center_id,budget_category_id,budget_month,amount_requested,status) values($1,$2,$3,$4,850,$5)',[company,center,category,'2026-07-01','submitted']);
 const obligation=id(40);await as(rh,()=>call('save_payroll_obligation',[obligation,company,'imss',null,center,'2026-07-01']));
 await upload(obligation,'imss_sipare',rh,'c',{...parsed,paymentReference:'QA-REF-002'});
 let o=await snapshot(obligation);await assert.rejects(as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'submit'])),/BUDGET_UNAVAILABLE/);
 assert.equal((await snapshot(obligation)).status,'draft');
 await db.query('update payment_requests set amount_requested=750');
 await as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'submit']));
 o=await snapshot(obligation);await assert.rejects(as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'cancel'])),/ACCESS_DENIED/);
 await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'cancel']));
 const budget=await as(outsider,()=>db.query('select available from budget_availability'));assert.equal(Number(budget.rows[0].available),150);
});
test('wrong company RFC and caller-supplied verification cannot activate a document',async()=>{
 const obligation=id(41);await as(rh,()=>call('save_payroll_obligation',[obligation,company,'imss']));
 const reservation=await as(rh,()=>call('reserve_payroll_obligation_file',[obligation,1,'imss_sipare',100,'d'.repeat(64)]));
 await assert.rejects(as(rh,()=>call('complete_payroll_obligation_file',[reservation.file_id,rh,'d'.repeat(64),JSON.stringify(parsed)])),/permission denied/);
 await assert.rejects(as(null,()=>call('complete_payroll_obligation_file',[reservation.file_id,rh,'d'.repeat(64),JSON.stringify({...parsed,taxpayerRfc:'BBB010101BBB'})]),'service_role'),/COMPANY_RFC_MISMATCH/);
 assert.equal((await snapshot(obligation)).amount_minor,null);
});
test('notification claims require activation and revalidate recipients; paid sends only once',async()=>{
 assert.deepEqual(await as(null,()=>call('claim_payroll_obligation_notifications',['qa-worker']),'service_role'),[]);
 await db.query("update payroll_obligation_settings set dispatch_enabled=true,app_origin='https://imss-dev.example.com',test_recipient_profile_id=$1",[rh]);
 const claimed=await as(null,()=>call('claim_payroll_obligation_notifications',['qa-worker']),'service_role');assert.equal(claimed.length,2);
 const doc=await as(null,()=>call('get_payroll_obligation_notification_document',[claimed[0],'qa-worker']),'service_role');assert.equal(doc.test_recipient_email,'rh@example.com');assert.ok(doc.url.startsWith('https://imss-dev.example.com/nomina?obligation='));
 await assert.rejects(as(null,()=>call('get_payroll_obligation_notification_document',[claimed[0],'different-worker']),'service_role'),/CLAIM_REQUIRED/);
 await db.query('update profiles set active=false where id=$1',[doc.event_type.endsWith('.paid')?rh:finance]);
 await assert.rejects(as(null,()=>call('get_payroll_obligation_notification_document',[claimed[0],'qa-worker']),'service_role'),/RECIPIENT_CHANGED|PAID_REQUIRED/);
});

test('ISN uses its printed total, completes payment and never counts the source twice',async()=>{
 await db.query('update profiles set active=true');
 await db.query('insert into payroll_obligation_settings(company_id,kind,enabled,budget_category_id) values($1,$2,true,$3)',[company,'isn_cdmx',category]);
 const obligation=id(50);await as(rh,()=>call('save_payroll_obligation',[obligation,company,'isn_cdmx',null,center,'2026-07-01']));
 await upload(obligation,'isn_cdmx',rh,'e',{...parsed,kind:'isn_cdmx',employerRegistration:null,amountMinor:1000,paymentReference:'QA-ISN-001'});
 let o=await snapshot(obligation);await as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'submit']));
 o=await snapshot(obligation);await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'confirm']));
 await upload(obligation,'receipt',finance,'f',{amount:'10.00',paymentDate:'2026-07-15',reference:'QA-ISN-PAY',currency:'MXN'});
 o=await snapshot(obligation);
 await assert.rejects(as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',1000,'2026-07-16','QA-ISN-PAY'])),/PAYMENT_FIELDS_INVALID/);
 await assert.rejects(as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',1000,'2026-07-15','DIFFERENT'])),/PAYMENT_FIELDS_INVALID/);
 await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',1000,'2026-07-15','QA-ISN-PAY']));
 assert.equal((await snapshot(obligation)).status,'paid');
 const budget=await as(outsider,()=>db.query('select available,executed from budget_availability'));assert.equal(Number(budget.rows[0].available),140);assert.equal(Number(budget.rows[0].executed),110);
 const events=await db.query('select event_type from notification_events where source_id=$1',[obligation]);assert.equal(events.rows.length,2);
});

test('pre-send review is atomic, rejects changed amounts and preserves capture/payment permissions',async()=>{
 const obligation=id(70);await as(rh,()=>call('save_payroll_obligation',[obligation,company,'imss',null,center,'2026-07-01']));
 await upload(obligation,'imss_sipare',rh,'7',{...parsed,amountMinor:100,paymentReference:'QA-REVIEW-RH'});
 let o=await snapshot(obligation);
 await assert.rejects(as(rh,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,999])),/REVIEW_REQUIRED/);
 await assert.rejects(as(outsider,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,100])),/ACCESS_DENIED/);
 await assert.rejects(as(null,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,100]),'anon'),/permission denied/);
 assert.equal(await as(rh,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,100])),'submitted');
 assert.equal((await snapshot(obligation)).confirmed_by,null,'RH review never impersonates Finance');
 await db.query('insert into payroll_capture_grants values($1,$2,true)',[finance,company]);
 const second=id(71);await as(finance,()=>call('save_payroll_obligation',[second,company,'imss',null,center,'2026-07-01']));
 await upload(second,'imss_sipare',finance,'8',{...parsed,amountMinor:100,paymentReference:'QA-REVIEW-FINANCE'});
 o=await snapshot(second);
 assert.equal(await as(finance,()=>call('submit_reviewed_payroll_obligation',[second,o.version,100])),'approved');
 assert.equal(await as(finance,()=>call('submit_reviewed_payroll_obligation',[second,o.version,100])),'approved');
 assert.equal((await snapshot(second)).confirmed_by,finance);
 assert.equal(Number((await db.query('select count(*) n from notification_events where source_id=$1',[second])).rows[0].n),1);
 const audit=(await db.query('select action from payroll_obligation_audit where obligation_id=$1 order by id',[second])).rows.map(r=>r.action);
 assert.ok(audit.indexOf('reviewed_amounts_before_submission')<audit.indexOf('submitted'));
 await db.query('delete from payroll_capture_grants where profile_id=$1',[finance]);
});
test('event insertion wakes only obligation notifications for an enabled company',async()=>{
 await db.exec('create table test_obligation_wakes(id int); create or replace function private.wake_payroll_obligation_notifications() returns bigint language plpgsql as $$begin insert into public.test_obligation_wakes values(1);return 1;end;$$;');
 await db.query('update payroll_obligation_settings set dispatch_enabled=true where company_id=$1 and kind=$2',[company,'imss']);
 await db.query("insert into notification_events(event_type,source_table,source_id,status) values('payroll.obligation.registered','payroll_obligations',$1,'pending')",[id(71)]);
 assert.equal((await db.query('select count(*) n from test_obligation_wakes')).rows[0].n,1);
 await db.query("insert into notification_events(event_type,source_table,source_id,status) values('payment_request.created','payment_requests',$1,'pending')",[id(71)]);
 await db.query('update payroll_obligation_settings set dispatch_enabled=false');
 await db.query("insert into notification_events(event_type,source_table,source_id,status) values('payroll.obligation.paid','payroll_obligations',$1,'pending')",[id(71)]);
 assert.equal((await db.query('select count(*) n from test_obligation_wakes')).rows[0].n,1);
});

test('non-budget release preserves history and allows both obligations without assignments or available balance',async()=>{
 const beforeBudget=(await as(rh,()=>db.query('select * from budget_availability'))).rows;
 const historical=(await db.query("select id,status,version from payroll_obligations where status<>'draft' order by id")).rows;
 const migration=process.env.OBLIGATION_NON_BUDGET_SQL||new URL('../../supabase/migrations/'+readdirSync(new URL('../../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_payroll_obligations_non_budget.sql')),import.meta.url);
 await db.exec(readFileSync(migration,'utf8'));
 assert.deepEqual((await as(rh,()=>db.query('select * from budget_availability'))).rows,beforeBudget);
 assert.deepEqual((await db.query("select id,status,version from payroll_obligations where status<>'draft' order by id")).rows,historical);
 assert.equal((await db.query("select count(*) n from payroll_obligations where status<>'draft' and no_presupuestal")).rows[0].n,0);
 assert.equal((await db.query("select count(*) n from payroll_obligations where status='draft' and not no_presupuestal")).rows[0].n,0);
 await db.query('delete from company_cost_center_budget_categories');
 await db.query('update budget_lines set amount=0');
 await db.query("insert into payroll_obligation_settings(company_id,kind,enabled) values($1,'isn_cdmx',true) on conflict(company_id,kind) do update set enabled=true",[company]);
 await db.query('update payroll_obligation_settings set budget_category_id=null');
 const budget=(await as(rh,()=>db.query('select * from budget_availability'))).rows;
 for(const [i,kind] of ['imss','isn_cdmx'].entries()){
  const obligation=id(800+i);await as(rh,()=>call('save_payroll_obligation',[obligation,company,kind]));
  let o=await snapshot(obligation);assert.equal(o.no_presupuestal,true);assert.equal(o.cost_center_id,null);assert.equal(o.budget_category_id,null);
  await assert.rejects(as(outsider,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,10000])),/ACCESS_DENIED/);
  await assert.rejects(as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'submit'])),/DOCUMENTS_INCONSISTENT/);
  const primary=kind==='imss'?'imss_sipare':'isn_cdmx';
  await upload(obligation,primary,rh,String(i+1),{...parsed,kind:primary,paymentReference:'NONBUDGET-'+kind});
  o=await snapshot(obligation);
  await assert.rejects(as(rh,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,999])),/REVIEW_REQUIRED/);
  assert.equal(await as(rh,()=>call('submit_reviewed_payroll_obligation',[obligation,o.version,10000])),'submitted');
  o=await snapshot(obligation);assert.equal(o.budget_result.status,'no_presupuestal');
  await assert.rejects(as(rh,()=>call('transition_payroll_obligation',[obligation,o.version,'confirm'])),/ACCESS_DENIED/);
  await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'confirm']));
  o=await snapshot(obligation);
  await assert.rejects(as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10000,'2026-07-15','NONBUDGET-PAY'])),/RECEIPT_REQUIRED/);
  await upload(obligation,'receipt',finance,String(i+3),{amount:'100.00',paymentDate:'2026-07-15',reference:'NONBUDGET-PAY',currency:'MXN'});
  o=await snapshot(obligation);
  await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10000,'2026-07-15','NONBUDGET-PAY']));
  assert.equal(await as(finance,()=>call('transition_payroll_obligation',[obligation,o.version,'pay',10000,'2026-07-15','NONBUDGET-PAY'])),'paid');
  assert.equal((await db.query("select count(*) n from notification_events where source_table='payroll_obligations' and source_id=$1",[obligation])).rows[0].n,2);
  assert.deepEqual((await as(rh,()=>db.query('select * from budget_availability'))).rows,budget);
 }
 await assert.rejects(as(rh,()=>db.query('select * from payroll_obligations')),/permission denied/);
});
