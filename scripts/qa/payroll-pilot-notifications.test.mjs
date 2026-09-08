import assert from 'node:assert/strict';
import { test } from 'node:test';
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
