import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

// Execute the real worker without network/PDF dependencies. The existing weekly
// suite separately exercises its actual PDF renderer and database migrations.
const source=readFileSync(new URL('../../supabase/functions/weekly-request-digest/index.ts',import.meta.url),'utf8')
const isolated=source.replace(/^import .* from '\.\/render\.ts'\r?\n/m,`let renderCalls=0;
const renderPdf=()=>{renderCalls++;return new TextEncoder().encode('%PDF-test')};
const renderEmail=()=>{renderCalls++;return {subject:'test',html:'test'}};
const validateDocument=()=>{};
export const renderingCount=()=>renderCalls;
`)
const worker=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(isolated)).toString('base64')}`)
const DEV='https://scsirgbuqjcwoaxfacth.supabase.co'
const PROD='https://ucantptjhwttexzmslvm.supabase.co'
const fixture={NOTIFICATION_DISPATCHER_SECRET:'test-secret',SUPABASE_URL:DEV,SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',RESEND_API_KEY:'synthetic-mail-key',NOTIFICATION_FROM_EMAIL:'Flux <test@example.invalid>',NOTIFICATION_SEND_MODE:'test_only',NOTIFICATION_TEST_EMAIL:'ramon@quantta.mx'}
const request=(body={},secret='test-secret')=>new Request('https://worker.invalid',{method:'POST',headers:{'x-notification-dispatcher-secret':secret,'Content-Type':'application/json'},body:JSON.stringify(body)})
function runtime(overrides={},fetch=async()=>{throw Error('Unexpected network access')}){const values={...fixture,...overrides};return {env:key=>values[key],fetch}}

for(const mode of [undefined,'','disabled',' DISABLED ','invalid','true']){
 for(const body of [{},{dry_run:true}])test(`${String(mode)} blocks ${body.dry_run?'preview':'delivery'} before credentials, reads, render or send`,async()=>{
  const before=worker.renderingCount();const keys=[];let calls=0
  const rt={env:key=>{keys.push(key);if(key==='NOTIFICATION_DISPATCHER_SECRET')return 'test-secret';if(key==='NOTIFICATION_SEND_MODE')return mode;throw Error('Must not read other configuration')},fetch:async()=>{calls++;throw Error('Must not fetch')}}
  const response=await worker.handleRequest(request(body),rt)
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{sent:0,mode:'disabled',reason:'notification_send_disabled'})
  assert.equal(calls,0);assert.equal(worker.renderingCount(),before)
  assert.deepEqual(keys,['NOTIFICATION_DISPATCHER_SECRET','NOTIFICATION_SEND_MODE'])
 })
}
test('authentication and HTTP method still precede the disabled response',async()=>{
 assert.equal((await worker.handleRequest(request({},'wrong'),runtime({NOTIFICATION_SEND_MODE:'disabled'}))).status,401)
 assert.equal((await worker.handleRequest(new Request('https://worker.invalid'),runtime())).status,405)
})
for(const email of [undefined,'','lisette@dezdez.earth','someone@example.invalid'])test(`test_only rejects ${String(email)} before network`,async()=>{
 const response=await worker.handleRequest(request(),runtime({NOTIFICATION_TEST_EMAIL:email}))
 assert.equal(response.status,500);assert.equal((await response.json()).error,'DIGEST_TEST_RECIPIENT_MISMATCH')
})
test('DEV refuses real mode even with copied production credentials',async()=>{
 const response=await worker.handleRequest(request(),runtime({NOTIFICATION_SEND_MODE:'real'}))
 assert.equal(response.status,500);assert.equal((await response.json()).error,'DIGEST_DEV_REAL_SEND_FORBIDDEN')
})
test('PROD test_only cannot silently deliver to the production recipient',async()=>{
 const response=await worker.handleRequest(request(),runtime({SUPABASE_URL:PROD,NOTIFICATION_TEST_EMAIL:'lisette@dezdez.earth'}))
 assert.equal(response.status,500);assert.equal((await response.json()).error,'DIGEST_TEST_RECIPIENT_MISMATCH')
})
test('PROD disabled also makes zero network calls',async()=>{
 assert.equal((await(await worker.handleRequest(request(),runtime({SUPABASE_URL:PROD,NOTIFICATION_SEND_MODE:'disabled'}))).json()).mode,'disabled')
})
test('normalizes explicit mode and whitespace around the approved test recipient',async()=>{
 let calls=0
 const response=await worker.handleRequest(request(),runtime({NOTIFICATION_SEND_MODE:' TEST_ONLY ',NOTIFICATION_TEST_EMAIL:' ramon@quantta.mx '},async url=>{calls++;assert.ok(url.endsWith('/claim_weekly_request_digest'));return Response.json(null)}))
 assert.equal(response.status,200);assert.equal((await response.json()).reason,'NOT_DUE');assert.equal(calls,1)
})
test('enabled callers still cannot override the recipient in the request',async()=>{
 assert.equal((await worker.handleRequest(request({to:'other@example.invalid'}),runtime())).status,400)
})
for(const environment of ['dev','prod'])test(`${environment} retains recipient, frozen payload and idempotency on the enabled path`,async()=>{
 const base=environment==='dev'?DEV:PROD;const recipient=worker.target(base).recipient
 const document={id:'synthetic-run',environment,recipient,period_start:'2026-09-18T06:00:00Z',period_end:'2026-09-23T23:00:00Z',rows:[]}
 const frozen={from:'frozen@example.invalid',to:[recipient],subject:'frozen',html:'frozen',attachments:[{filename:'frozen.pdf',content:'JVBERi0='}]}
 const calls=[];let sent
 const response=await worker.handleRequest(request(),runtime({SUPABASE_URL:base,NOTIFICATION_SEND_MODE:environment==='dev'?'test_only':'real'},async(url,init)=>{
  calls.push(url);const body=JSON.parse(init.body)
  if(url.endsWith('/claim_weekly_request_digest'))return Response.json({id:document.id,document,payload:frozen})
  if(url.endsWith('/prepare_weekly_request_digest')){assert.deepEqual(body.p_payload,frozen);return Response.json(frozen)}
  if(url==='https://api.resend.com/emails'){assert.equal(init.headers['Idempotency-Key'],'weekly-request-digest/synthetic-run');sent=body;return Response.json({id:'mock-provider-id'})}
  if(url.endsWith('/finish_weekly_request_digest')){assert.equal(body.p_provider_id,'mock-provider-id');return Response.json(null)}
  throw Error('Unexpected URL')
 }))
 assert.equal(response.status,200);assert.equal((await response.json()).sent,1);assert.deepEqual(sent,frozen);assert.equal(calls.length,4)
})
test('allowed DEV preview never claims or calls the email provider',async()=>{
 const calls=[];const before=worker.renderingCount()
 const response=await worker.handleRequest(request({dry_run:true}),runtime({},async url=>{calls.push(url);assert.ok(url.endsWith('/preview_weekly_request_digest'));return Response.json({enabled:true,environment:'dev',recipient:'ramon@quantta.mx',next_cutoff:'2026-09-23T23:00:00Z',document:{rows:[{}],period_start:'2026-09-18T06:00:00Z'}})}))
 assert.equal(response.status,200);assert.equal((await response.json()).sent,0);assert.equal(calls.length,1);assert.equal(worker.renderingCount(),before+2)
})
