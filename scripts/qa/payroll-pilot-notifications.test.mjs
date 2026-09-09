import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from '../../app/node_modules/typescript/lib/typescript.js';
import { syntheticPng, syntheticJpeg } from './fixtures/payroll-image-fixture.mjs';
import { handleRequest, renderPayrollEmail } from '../../supabase/functions/payroll-notification-dispatcher/index.ts';
const uuid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const bytes=new TextEncoder().encode('%PDF-1.4\n'+'x'.repeat(100)+'\n%%EOF');
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
const doc={event_id:uuid(1),event_type:'payroll.paid',request_id:uuid(2),folio:'QA-ONLY',recipient_email:'rh@example.com',company:'Empresa <privada>',period_start:'2026-09-01',period_end:'2026-09-15',amount:300,currency:'MXN',url:`https://flux.example.com/nomina?capture=${uuid(3)}`,channels:['banco','spei','vales'].map(channel=>({channel,amount:100})),attachments:['banco','spei','vales'].map((channel,i)=>({channel,file_id:uuid(10+i),bucket:'payroll-private',path:`${uuid(2)}/${uuid(10+i)}.pdf`,mime_type:'application/pdf',size_bytes:bytes.length,sha256:hash}))};
const env={NOTIFICATION_DISPATCHER_SECRET:'test-secret',NOTIFICATION_SEND_MODE:'test_only',SUPABASE_URL:'https://project.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-key',RESEND_API_KEY:'test-resend',NOTIFICATION_FROM_EMAIL:'Flux <test@example.com>',NOTIFICATION_TEST_EMAIL:'qa@example.com'};
const request=()=>new Request('https://worker.example.com',{method:'POST',headers:{'x-notification-dispatcher-secret':'test-secret'}});

test('unauthorized and disabled calls perform no fetches',async()=>{
  const fetch=()=>{throw Error('network not allowed')};
  assert.equal((await handleRequest(new Request('https://worker.example.com',{method:'POST'}),{env:n=>env[n],fetch})).status,401);
  const disabled=await handleRequest(request(),{env:n=>n==='NOTIFICATION_SEND_MODE'?'disabled':env[n],fetch});
  assert.equal((await disabled.json()).sent,0);
});

test('authenticated dry run verifies delivery configuration without claiming or sending',async()=>{
  const makeRequest=authorized=>new Request('https://worker.example.com',{method:'POST',
    headers:authorized?{'x-notification-dispatcher-secret':'test-secret'}:{},body:JSON.stringify({dry_run:true,to:'override@example.com'})});
  const runtime={env:n=>env[n],fetch:()=>{throw Error('dry run must never reach the network')}};
  assert.equal((await handleRequest(makeRequest(false),runtime)).status,401);
  const result=await handleRequest(makeRequest(true),runtime);
  assert.deepEqual(await result.json(),{dry_run:true,sent:0,mode:'test_only',test_recipient:'qa@example.com',configured:true});
});

test('one mail contains all three verified receipts and DEV stays on the test recipient',async()=>{
  const deliveries=[];
  const runtime={env:n=>env[n],fetch:async(url,init)=>{
    if(url.endsWith('/claim_payroll_notifications')) return Response.json([doc.event_id]);
    if(url.endsWith('/get_payroll_notification_document')) return Response.json(doc);
    if(url.includes('/storage/v1/object/')) return new Response(bytes);
    if(url==='https://api.resend.com/emails'){deliveries.push({body:JSON.parse(init.body),headers:init.headers});return Response.json({id:'provider-id'});}
    if(url.endsWith('/mark_notification_processed_for_dispatcher')) return Response.json({status:'sent'});
    throw Error(`unexpected ${url}`);
  }};
  const result=await handleRequest(request(),runtime);
  assert.equal((await result.json()).sent,1);
  assert.equal(deliveries.length,1);
  assert.deepEqual(deliveries[0].body.to,['qa@example.com']);
  assert.equal(deliveries[0].headers['Idempotency-Key'],`notification/${doc.event_id}`);
  assert.deepEqual(deliveries[0].body.attachments.map(a=>a.filename),['Comprobante_BBVA.pdf','Comprobante_SPEI.pdf','Comprobante_TOKA.pdf']);
  assert.match(deliveries[0].body.html,/Empresa &lt;privada&gt;/);
  assert.doesNotMatch(deliveries[0].body.html,/bank_account|employee_name|CLABE/);
});

for(const invalid of ['different_hash','other_request','duplicate_channel']) test(`invalid evidence (${invalid}) prevents all email delivery`,async()=>{
  const bad=structuredClone(doc);
  if(invalid==='different_hash') bad.attachments[0].sha256='0'.repeat(64);
  if(invalid==='other_request') bad.attachments[0].path=`${uuid(999)}/${uuid(10)}.pdf`;
  if(invalid==='duplicate_channel') bad.attachments[1].channel='banco';
  let failed=0, emails=0;
  const runtime={env:n=>env[n],fetch:async(url)=>{
    if(url.endsWith('/claim_payroll_notifications')) return Response.json([bad.event_id]);
    if(url.endsWith('/get_payroll_notification_document')) return Response.json(bad);
    if(url.includes('/storage/v1/object/')) return new Response(bytes);
    if(url==='https://api.resend.com/emails') emails++;
    if(url.endsWith('/mark_notification_failed_for_dispatcher')){failed++;return Response.json({status:'failed'});}
    throw Error('email must not be called');
  }};
  assert.equal((await (await handleRequest(request(),runtime)).json()).sent,0);
  assert.equal(failed,1);
  assert.equal(emails,0);
});

test('registered template requests finance review; large paid packages retain the private download link',()=>{
  const registered=renderPayrollEmail({...doc,event_type:'payroll.registered',attachments:[]},'real',false);
  assert.match(registered.text,/Revisa los montos/);
  assert.doesNotMatch(registered.subject,/pagada/);
  const paid=renderPayrollEmail(doc,'real',false);
  assert.match(paid.text,/Descarga los comprobantes de cada canal en Flux/);
  assert.ok(paid.text.includes(doc.url));
});

for(const mode of ['test_only','real']) test(`scoped test recipient is server-authored and blocked in real mode (${mode})`,async()=>{
  const deliveries=[];
  const runtime={env:n=>n==='NOTIFICATION_SEND_MODE'?mode:env[n],fetch:async(url,init)=>{
    if(url.endsWith('/claim_payroll_notifications')) return Response.json([doc.event_id]);
    if(url.endsWith('/get_payroll_notification_document')) return Response.json({...doc,test_recipient_email:'scoped-qa@example.com'});
    if(url.includes('/storage/v1/object/')) return new Response(bytes);
    if(url==='https://api.resend.com/emails'){deliveries.push(JSON.parse(init.body));return Response.json({id:'provider-id'});}
    if(url.endsWith('/mark_notification_processed_for_dispatcher') || url.endsWith('/mark_notification_failed_for_dispatcher')) return Response.json({});
    throw Error('unexpected request');
  }};
  const req=new Request('https://worker.example.com',{method:'POST',headers:{'x-notification-dispatcher-secret':'test-secret'},body:JSON.stringify({to:'caller@example.com'})});
  const result=await (await handleRequest(req,runtime)).json();
  assert.equal(result.sent,mode==='test_only'?1:0);
  assert.deepEqual(deliveries.map(d=>d.to),mode==='test_only'?[['scoped-qa@example.com']]:[]);
});

test('closing email preserves the exact PDF generated from each JPG/PNG image',async()=>{
  const require=createRequire(import.meta.url),client={exports:{}};
  const source=readFileSync(new URL('../../app/src/features/nomina/receiptUpload.ts',import.meta.url),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','window',compiled)(client.exports,{PDFLib:require('../../pdf-lib-1.17.1.min.js')});
  const converted=[];
  for(const [name,input]of [['image.jpg',syntheticJpeg],['image.png',syntheticPng()]]){
    const prepared=await client.exports.prepareReceiptPdf(new File([input],name));
    converted.push(new Uint8Array(await prepared.file.arrayBuffer()));
  }
  const payload=structuredClone(doc),files=[...converted,bytes],deliveries=[];
  for(let i=0;i<files.length;i++){
    payload.attachments[i].size_bytes=files[i].length;
    payload.attachments[i].sha256=Buffer.from(await crypto.subtle.digest('SHA-256',files[i])).toString('hex');
  }
  const runtime={env:n=>env[n],fetch:async(url,init)=>{
    if(url.endsWith('/claim_payroll_notifications'))return Response.json([payload.event_id]);
    if(url.endsWith('/get_payroll_notification_document'))return Response.json(payload);
    if(url.includes('/storage/v1/object/'))return new Response(files[payload.attachments.findIndex(a=>url.endsWith(a.path))]);
    if(url==='https://api.resend.com/emails'){deliveries.push(JSON.parse(init.body));return Response.json({id:'test-only'});}
    if(url.endsWith('/mark_notification_processed_for_dispatcher'))return Response.json({status:'sent'});
    throw Error('unexpected request');
  }};
  assert.equal((await(await handleRequest(request(),runtime)).json()).sent,1);
  assert.equal(deliveries.length,1);
  for(let i=0;i<files.length;i++)assert.deepEqual(Buffer.from(deliveries[0].attachments[i].content,'base64'),Buffer.from(files[i]));
  assert.deepEqual(deliveries[0].attachments.map(a=>a.filename),['Comprobante_BBVA.pdf','Comprobante_SPEI.pdf','Comprobante_TOKA.pdf']);
});
