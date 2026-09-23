import './weekly-request-digest-send-mode.test.mjs'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {extractText} from 'unpdf'
import {handleRequest} from '../../supabase/functions/weekly-request-digest/index.ts'
import {renderEmail,renderPdf,totals} from '../../supabase/functions/weekly-request-digest/render.ts'
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const row=(n,status='pending_approval')=>({id:uuid(n),folio:`SOL-QA-${n}`,company:n%2?'Operadora Tlacatecpan':'Soporte Fersana',beneficiary:'Beneficiario <QA>',description:'Solicitud de prueba con acentos: aprobación',cost_center:'Centro',category:'Sin partida (QA)',amount_minor:10000,currency:'MXN',status,request_type:'provider_payment',requester:'QA',created_at:'2026-09-17T12:00:00Z'})
const doc={id:uuid(50),environment:'dev',recipient:'ramon@quantta.mx',period_start:'2026-09-16T23:00:00Z',period_end:'2026-09-23T23:00:00Z',rows:[row(1),row(2,'approved')]}
const env={NOTIFICATION_DISPATCHER_SECRET:'secret',SUPABASE_URL:'https://scsirgbuqjcwoaxfacth.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',RESEND_API_KEY:'resend',NOTIFICATION_FROM_EMAIL:'Flux <test@example.com>',NOTIFICATION_SEND_MODE:'test_only',NOTIFICATION_TEST_EMAIL:'ramon@quantta.mx'}
const request=(body={},auth=true)=>new Request('https://worker',{method:'POST',headers:auth?{'x-notification-dispatcher-secret':'secret'}:{},body:JSON.stringify(body)})

test('PDF contains all rows, correct states and amounts across company pages; HTML escapes data',async()=>{
 const bytes=renderPdf(doc);const result=await extractText(bytes.slice(),{mergePages:true})
 assert.equal(result.totalPages,2);assert.match(result.text,/SOL-QA-1/);assert.match(result.text,/SOL-QA-2/);assert.match(result.text,/Pendiente de aprobación/);assert.match(result.text,/Aprobada/)
 const email=renderEmail(doc);assert.match(email.html,/Beneficiario &lt;QA&gt;/);assert.match(email.html,/\$200.00 MXN/);assert.doesNotMatch(email.html,/<a /)
 assert.equal(totals([...doc.rows,{...row(3),currency:'USD',amount_minor:5050}]),'$200.00 MXN / $50.50 USD')
 mkdirSync('/tmp/weekly-request-digest-qa',{recursive:true});writeFileSync('/tmp/weekly-request-digest-qa/example.pdf',bytes)
})
test('PDF paginates long weeks without dropping requests; email stays concise',async()=>{
 const large={...doc,rows:Array.from({length:100},(_,i)=>({...row(i+1),description:'Concepto extenso '.repeat(15)}))}
 const result=await extractText(renderPdf(large),{mergePages:true});assert.ok(result.totalPages>2);assert.match(result.text,/SOL-QA-100/)
 assert.match(renderEmail(large).html,/Detalle completo/)
})
test('unauthenticated calls and recipient overrides never access data or send',async()=>{
 const runtime={env:n=>env[n],fetch:()=>{throw Error('No network')}}
 assert.equal((await handleRequest(request({},false),runtime)).status,401)
 assert.equal((await handleRequest(request({to:'someone@example.com'}),runtime)).status,400)
})
test('dry run renders current PDF but never claims or sends',async()=>{
 const runtime={env:n=>env[n],fetch:async url=>{assert.ok(url.endsWith('/preview_weekly_request_digest'));return Response.json({enabled:true,environment:'dev',recipient:doc.recipient,next_cutoff:doc.period_end,document:doc})}}
 const response=await handleRequest(request({dry_run:true}),runtime);assert.equal(response.status,200);const result=await response.json();assert.equal(result.sent,0);assert.ok(result.pdf_bytes>1000)
})
for(const claim of [null,{empty:true}])test(`no delivery for ${claim?'empty week':'not due'}`,async()=>{
 let calls=0;const runtime={env:n=>env[n],fetch:async url=>{calls++;assert.ok(url.endsWith('/claim_weekly_request_digest'));return Response.json(claim)}}
 assert.equal((await(await handleRequest(request(),runtime)).json()).sent,0);assert.equal(calls,1)
})
for(const environment of ['dev','prod'])test(`${environment} freezes complete PDF payload and uses the fixed recipient`,async()=>{
 const d={...doc,environment,recipient:environment==='prod'?'lisette@dezdez.earth':doc.recipient};let payload,delivered,finish
 const runtime={env:n=>n==='NOTIFICATION_SEND_MODE'&&environment==='prod'?'real':n==='SUPABASE_URL'&&environment==='prod'?'https://ucantptjhwttexzmslvm.supabase.co':env[n],fetch:async(url,init)=>{
  const body=JSON.parse(init.body)
  if(url.endsWith('/claim_weekly_request_digest'))return Response.json({id:d.id,document:d,payload:null})
  if(url.endsWith('/prepare_weekly_request_digest')){payload=body.p_payload;return Response.json(payload)}
  if(url==='https://api.resend.com/emails'){delivered=body;assert.equal(init.headers['Idempotency-Key'],`weekly-request-digest/${d.id}`);return Response.json({id:'delivered'})}
  if(url.endsWith('/finish_weekly_request_digest')){finish=body;return Response.json(null)}
  throw Error(url)
 }}
 assert.equal((await(await handleRequest(request(),runtime)).json()).sent,1);assert.deepEqual(delivered.to,[d.recipient]);assert.deepEqual(payload,delivered);assert.equal(finish.p_provider_id,'delivered');assert.equal(delivered.attachments.length,1);assert.equal(Buffer.from(delivered.attachments[0].content,'base64').subarray(0,5).toString(),'%PDF-')
})
test('retry uses stored payload verbatim; uncertain send schedules recovery',async()=>{
 const payload={from:'frozen@example.com',to:[doc.recipient],subject:'Frozen',html:'Frozen',text:'Frozen',attachments:[{filename:'Frozen.pdf',content:'JVBERi0='}]};let failed=false
 const runtime={env:n=>env[n],fetch:async(url,init)=>{
  const body=JSON.parse(init.body)
  if(url.endsWith('/claim_weekly_request_digest'))return Response.json({id:doc.id,document:doc,payload})
  if(url.endsWith('/prepare_weekly_request_digest')){assert.deepEqual(body.p_payload,payload);return Response.json(payload)}
  if(url==='https://api.resend.com/emails'){assert.deepEqual(body,payload);throw Error('Timeout')}
  if(url.endsWith('/finish_weekly_request_digest')){failed=true;assert.equal(body.p_error_code,'DIGEST_FAILED');return Response.json(null)}
 }}
 assert.equal((await handleRequest(request(),runtime)).status,500);assert.equal(failed,true)
})
test('rejected or cross-environment snapshots are refused before send',async()=>{
 for(const d of [{...doc,rows:[row(1,'rejected')]},{...doc,recipient:'lisette@dezdez.earth'}]){
 const calls=[];const runtime={env:n=>env[n],fetch:async(url)=>{calls.push(url);if(url.endsWith('/claim_weekly_request_digest'))return Response.json({id:d.id,document:d});if(url.endsWith('/finish_weekly_request_digest'))return Response.json(null);throw Error('Should not send')}}
 assert.equal((await handleRequest(request(),runtime)).status,500);assert.ok(!calls.includes('https://api.resend.com/emails'))
 }
})

test('database: weekly boundaries, all non-rejected states, empty weeks, leases and exact-payload retries',async()=>{
 const db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
 create table public.companies(id uuid,name text);create table public.profiles(id uuid,full_name text);
 create table public.proveedores(id uuid,alias text,nombre_completo text);create table public.cost_centers(id uuid,code text,name text);create table public.budget_categories(id uuid,code text,name text);
 create table public.approval_batch_items(payment_request_id uuid,removed_at timestamptz,director_status text,rebatch_status text);
 create table public.payment_requests(id uuid,request_number text,company_id uuid,proveedor_id uuid,beneficiary_profile_id uuid,requested_by uuid,cost_center_id uuid,budget_category_id uuid,description text,concept text,sin_partida_description text,amount_requested numeric,currency text,status text,exception_status text,request_type text,created_at timestamptz);`)
 const migration=readFileSync('supabase/migrations/20260917221717_weekly_request_digest.sql','utf8')
 await db.exec(migration.split('-- Scheduler registration:')[0])
 for(const [at,expected] of [['2026-09-23T22:59:59Z','2026-09-16T23:00:00.000Z'],['2026-09-23T23:00:00Z','2026-09-23T23:00:00.000Z'],['2026-09-24T02:00:00Z','2026-09-23T23:00:00.000Z']]){
  const r=await db.query('select private.weekly_request_digest_cutoff($1) cutoff',[at]);assert.equal(r.rows[0].cutoff.toISOString(),expected)
 }
 await db.exec(`insert into private.weekly_request_digest_settings(environment,project_ref,recipient,period_start,next_cutoff)values('dev','scsirgbuqjcwoaxfacth','ramon@quantta.mx','2026-09-09T23:00:00Z','2026-09-16T23:00:00Z');insert into public.companies values('${uuid(99)}','Soporte Fersana');`)
 const states=['draft','submitted','pending_approval','approved','rejected','changes_requested','finance_validation','scheduled','paid','cancelled']
 for(let i=0;i<states.length;i++)await db.query('insert into public.payment_requests(id,company_id,amount_requested,currency,status,created_at)values($1,$2,100,\'MXN\',$3,\'2026-09-15T10:00:00Z\')',[uuid(i+1),uuid(99),states[i]])
 // Upper boundary belongs to next week; lower boundary included. Rejected in direction excluded, released resubmission included.
 await db.exec(`insert into public.payment_requests(id,company_id,amount_requested,currency,status,created_at)values('${uuid(20)}','${uuid(99)}',1,'MXN','approved','2026-09-16T23:00:00Z'),('${uuid(21)}','${uuid(99)}',1,'MXN','approved','2026-09-09T23:00:00Z');
 insert into public.approval_batch_items values('${uuid(4)}',null,'rejected','blocked'),('${uuid(6)}',null,'rejected','released');`)
 const claim=async worker=>(await db.query('select public.claim_weekly_request_digest($1) result',[worker])).rows[0].result
 const first=await claim(uuid(80));assert.equal(first.document.rows.length,9);assert.ok(first.document.rows.some(r=>r.status==='draft'));assert.ok(!first.document.rows.some(r=>r.status==='rejected'||r.id===uuid(4)||r.id===uuid(20)));// Isolate lease contention from subsequent weeks becoming due as the real clock advances.
 await db.exec(`update private.weekly_request_digest_settings set next_cutoff=now()+interval '7 days'`)
 assert.equal(await claim(uuid(81)),null)
 const payload={from:'Flux <test@example.com>',to:[doc.recipient],subject:'Subject',html:'HTML',text:'text',attachments:[{filename:'Corte.pdf',content:'base64'}]}
 const prep=async(worker,payload)=>(await db.query('select public.prepare_weekly_request_digest($1,$2,$3::jsonb) result',[first.id,worker,JSON.stringify(payload)])).rows[0].result
 await assert.rejects(prep(uuid(81),payload),/DIGEST_LEASE_INVALID/)
 await assert.rejects(prep(uuid(80),{...payload,to:['lisette@dezdez.earth']}),/DIGEST_PAYLOAD_INVALID/)
 assert.deepEqual(await prep(uuid(80),payload),payload)
 await db.exec(`update private.weekly_request_digest_runs set lease_until=now()-interval '1 minute';update public.payment_requests set amount_requested=999;`)
 const retry=await claim(uuid(81));assert.deepEqual(retry.document,first.document);assert.deepEqual(retry.payload,payload);assert.deepEqual(await prep(uuid(81),{...payload,subject:'Changed'}),payload)
 await db.query('select public.finish_weekly_request_digest($1,$2,$3)',[first.id,uuid(81),'resend-id']);assert.equal(await claim(uuid(82)),null)
 // An entirely empty past week advances scheduling without creating a sendable event.
 await db.exec(`update private.weekly_request_digest_settings set period_start='2026-08-26T23:00:00Z',next_cutoff='2026-09-02T23:00:00Z';`)
 assert.equal((await claim(uuid(83))).empty,true)
 await db.exec(`update private.weekly_request_digest_runs set status='pending',first_send_at=now()-interval '21 hours',lease_until=null where id='${first.id}';update private.weekly_request_digest_settings set next_cutoff=now()+interval '7 days';`)
 assert.equal(await claim(uuid(84)),null);assert.equal((await db.query('select status from private.weekly_request_digest_runs where id=$1',[first.id])).rows[0].status,'needs_review')
 // The user requested a first window starting Sep 18 at midnight CDMX, not Sep 16/17.
 await db.exec(`update private.weekly_request_digest_settings set period_start='2026-09-18T06:00:00Z',next_cutoff='2026-09-23T23:00:00Z';delete from public.payment_requests;`)
 for(const [n,date] of [[31,'2026-09-18T05:59:59Z'],[32,'2026-09-18T06:00:00Z'],[33,'2026-09-23T22:59:59Z'],[34,'2026-09-23T23:00:00Z']])await db.query('insert into public.payment_requests(id,company_id,amount_requested,currency,status,created_at)values($1,$2,1,\'MXN\',\'pending_approval\',$3)',[uuid(n),uuid(99),date])
 const initial=(await db.query("select private.weekly_request_digest_document($1,'2026-09-18T06:00:00Z','2026-09-23T23:00:00Z') result",[uuid(50)])).rows[0].result
 assert.deepEqual(initial.rows.map(r=>r.id),[uuid(32),uuid(33)])
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select public.preview_weekly_request_digest()'),/permission denied/);await db.exec('reset role')}
 await db.close()
})
