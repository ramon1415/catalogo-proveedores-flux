import assert from 'node:assert/strict';
import {test} from 'node:test';
import {handleRequest as fileHandler,extractObligationPdfLines} from '../../supabase/functions/payroll-obligations/index.ts';
import {handleRequest as notify,renderObligationEmail} from '../../supabase/functions/payroll-obligation-notifications/index.ts';
import {jsPDF} from 'jspdf';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const pdf=new jsPDF();pdf.text(['COMPROBANTE DE PRUEBA','Importe total: 100.00 MXN','Fecha de pago: 2026-07-15','Referencia: QA-REF-001'],15,20);
const bytes=new Uint8Array(pdf.output('arraybuffer'));const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
const ctx={file_id:id(1),obligation_id:id(2),company_id:id(3),actor_id:id(4),kind:'receipt',bucket:'payroll-obligations',path:`${id(3)}/${id(2)}/${id(1)}.pdf`,size_bytes:bytes.length,sha256:hash,company_rfc:'AAA010101AAA'};
const env={SUPABASE_URL:'https://project.example.com',SUPABASE_SERVICE_ROLE_KEY:'test',NOTIFICATION_DISPATCHER_SECRET:'secret',NOTIFICATION_SEND_MODE:'test_only',RESEND_API_KEY:'test',NOTIFICATION_FROM_EMAIL:'Flux <qa@example.com>'};
const request=()=>new Request('https://worker.example.com',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify({file_id:id(1),action:'verify'})});
test('server rereads a real PDF and writes only extracted receipt fields after caller authorization',async()=>{
 let saved=null;const runtime={env:n=>env[n],fetch:async(url,init)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:id(4)});
  if(url.endsWith('/get_payroll_obligation_file_context')){assert.equal(init.headers.Authorization,'Bearer test');return Response.json(ctx)}
  if(url.includes('/storage/v1/object/authenticated/'))return new Response(bytes);
  if(url.endsWith('/complete_payroll_obligation_file')){saved=JSON.parse(init.body);return Response.json(null)}
  throw Error('unexpected request');
 }};
 const result=await fileHandler(request(),runtime);assert.equal(result.status,200);assert.equal(saved.p_parsed.amount,'100.00');assert.equal(saved.p_parsed.paymentDate,'2026-07-15');assert.equal(saved.p_parsed.reference,'QA-REF-001');assert.equal(saved.p_sha256,hash);
});
test('bad JWT, wrong storage scope and hash mismatch prevent verification',async()=>{
 for(const mode of ['jwt','path','hash']){let completed=false;
  const r=await fileHandler(request(),{env:n=>env[n],fetch:async url=>{
   if(url.endsWith('/auth/v1/user'))return Response.json({}, {status:mode==='jwt'?401:200});
   if(url.endsWith('/get_payroll_obligation_file_context'))return Response.json({...ctx,...(mode==='path'?{path:'other.pdf'}:{}),...(mode==='hash'?{sha256:'0'.repeat(64)}:{})});
   if(url.includes('/storage/'))return new Response(bytes);
   completed=true;return Response.json(null);
  }});assert.notEqual(r.status,200);assert.equal(completed,false);
 }
});
test('server PDF reader preserves labelled lines across pages',async()=>{
 const second=new jsPDF();second.text('Primera pagina',15,20);second.addPage();second.text('Total a pagar: 1,234.56',15,20);
 const lines=await extractObligationPdfLines(new Uint8Array(second.output('arraybuffer')));assert.ok(lines.includes('Primera pagina'));assert.ok(lines.includes('Total a pagar: 1,234.56'));
});
const doc={event_id:id(5),event_type:'payroll.obligation.paid',id:id(2),kind:'imss',folio:'IMSS-QA',company:'Empresa <prueba>',recipient_email:'creator@example.com',test_recipient_email:'qa@example.com',period_start:'2026-07-01',period_end:'2026-07-31',amount_minor:10000,url:`https://flux.example.com/nomina?obligation=${id(2)}`};
test('notice uses Flux design, private link and the configured test recipient, with idempotency',async()=>{
 let delivery=null;const r=await notify(new Request('https://worker',{method:'POST',headers:{'x-notification-dispatcher-secret':'secret'}}),{env:n=>env[n],fetch:async(url,init)=>{
  if(url.endsWith('/claim_payroll_obligation_notifications'))return Response.json([doc.event_id]);
  if(url.endsWith('/get_payroll_obligation_notification_document'))return Response.json(doc);
  if(url==='https://api.resend.com/emails'){delivery=JSON.parse(init.body);assert.equal(init.headers['Idempotency-Key'],`notification/${doc.event_id}`);return Response.json({id:'provider-id'})}
  if(url.endsWith('/mark_notification_processed_for_dispatcher'))return Response.json({});throw Error('unexpected');
 }});
 assert.equal((await r.json()).sent,1);assert.deepEqual(delivery.to,['qa@example.com']);assert.match(delivery.html,/#16322d/);assert.match(delivery.html,/Georgia/);assert.match(delivery.html,/Empresa &lt;prueba&gt;/);assert.match(delivery.html,/Ver comprobante en Flux/);
});
test('real mode cannot silently deliver a company configured for QA; unauthorized dry run does nothing',async()=>{
 let deliveries=0;const runtime={env:n=>n==='NOTIFICATION_SEND_MODE'?'real':env[n],fetch:async url=>{
  if(url.endsWith('/claim_payroll_obligation_notifications'))return Response.json([doc.event_id]);if(url.endsWith('/get_payroll_obligation_notification_document'))return Response.json(doc);
  if(url.includes('resend.com'))deliveries++;return Response.json({});
 }};
 const r=await notify(new Request('https://worker',{method:'POST',headers:{'x-notification-dispatcher-secret':'secret'}}),runtime);assert.equal((await r.json()).sent,0);assert.equal(deliveries,0);
 assert.equal((await notify(new Request('https://worker',{method:'POST',body:'{"dry_run":true}'}),runtime)).status,401);
 assert.match(renderObligationEmail({...doc,event_type:'payroll.obligation.registered',kind:'isn_cdmx'},true).subject,/ISN/);
});

test('a Finance-reviewed submission email directs Treasury to payment without repeating confirmation',()=>{
 const email=renderObligationEmail({...doc,event_type:'payroll.obligation.registered',status:'approved'},true);
 assert.match(email.html,/Los montos quedaron confirmados/);assert.doesNotMatch(email.html,/confirma el monto para continuar/);
});
