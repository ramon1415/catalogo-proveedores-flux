import { renderEmail, renderPdf, validateDocument, type Document } from './render.ts'
type Runtime={env:(name:string)=>string|undefined;fetch:typeof fetch}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const required=(runtime:Runtime,name:string)=>{const value=runtime.env(name)?.trim();if(!value)throw Error('DIGEST_CONFIGURATION_REQUIRED');return value}
function base64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary)}
export function target(base:string){
 if(base==='https://scsirgbuqjcwoaxfacth.supabase.co')return {environment:'dev',recipient:'ramon@quantta.mx'}
 if(base==='https://ucantptjhwttexzmslvm.supabase.co')return {environment:'prod',recipient:'lisette@dezdez.earth'}
 throw Error('DIGEST_UNKNOWN_ENVIRONMENT')
}
// A missing or invalid mode is disabled, before credentials, reads or claims.
export function notificationSendMode(env:Runtime['env']):'disabled'|'test_only'|'real'{
 const mode=(env('NOTIFICATION_SEND_MODE')??'disabled').trim().toLowerCase()
 return mode==='test_only'||mode==='real'?mode:'disabled'
}
export async function handleRequest(req:Request,runtime:Runtime):Promise<Response>{
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
 const secret=runtime.env('NOTIFICATION_DISPATCHER_SECRET')?.trim()
 if(!secret||req.headers.get('x-notification-dispatcher-secret')!==secret)return json({error:'UNAUTHORIZED'},401)
 const mode=notificationSendMode(runtime.env)
 if(mode==='disabled')return json({sent:0,mode,reason:'notification_send_disabled'})
 let id:string|undefined;let worker:string|undefined;let rpc:((name:string,body:unknown)=>Promise<any>)|undefined
 try{
  const body=await req.json().catch(()=>({}))
  if(Object.keys(body).some(k=>k!=='dry_run'))return json({error:'DIGEST_UNSUPPORTED_INPUT'},400)
  const base=required(runtime,'SUPABASE_URL').replace(/\/$/,'');const destination=target(base)
  // Keep the fixed destination and reject copied PROD configuration in DEV.
  // test_only is deliberately DEV-only; production requires explicit real mode.
  if(destination.environment==='dev'&&mode==='real')throw Error('DIGEST_DEV_REAL_SEND_FORBIDDEN')
  if(mode==='test_only'&&(destination.environment!=='dev'||runtime.env('NOTIFICATION_TEST_EMAIL')?.trim()!==destination.recipient))throw Error('DIGEST_TEST_RECIPIENT_MISMATCH')
  const key=required(runtime,'SUPABASE_SERVICE_ROLE_KEY');const resend=required(runtime,'RESEND_API_KEY');const from=required(runtime,'NOTIFICATION_FROM_EMAIL')
  rpc=async(name,body)=>{const response=await runtime.fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`DIGEST_RPC_FAILED_${response.status}`);return response.json()}
  if(body.dry_run===true){
   const preview=await rpc('preview_weekly_request_digest',{})
   if(preview.environment!==destination.environment||preview.recipient!==destination.recipient)throw Error('DIGEST_ENVIRONMENT_MISMATCH')
   const doc=preview.document as Document
   // Before the first period opens there are no real rows. Exercise the actual
   // deployed PDF runtime with an internal, never-sent fixture in that case.
   const probe=doc.rows.length?doc:{...doc,period_end:preview.next_cutoff,rows:[{
    id:crypto.randomUUID(),folio:'VERIFICACION-TECNICA',company:'Verificación técnica',beneficiary:'Sin datos reales',
    description:'Prueba interna del PDF; no se envía por correo.',cost_center:'Prueba',category:'Prueba',amount_minor:0,
    currency:'MXN',status:'pending_approval',request_type:'provider_payment',requester:'Prueba',created_at:doc.period_start
   }]}
   validateDocument(probe);const pdfBytes=renderPdf(probe).length;renderEmail(probe)
   return json({dry_run:true,sent:0,configured:true,enabled:preview.enabled,...destination,next_cutoff:preview.next_cutoff,request_count:doc.rows.length,pdf_bytes:pdfBytes,synthetic_pdf_probe:doc.rows.length===0})
  }
  worker=crypto.randomUUID();const claimed=await rpc('claim_weekly_request_digest',{p_worker_id:worker})
  if(!claimed)return json({sent:0,reason:'NOT_DUE'})
  if(claimed.empty)return json({sent:0,reason:'NO_REQUESTS'})
  id=claimed.id;const doc=claimed.document as Document
  validateDocument(doc)
  if(doc.id!==id||doc.environment!==destination.environment||doc.recipient!==destination.recipient)throw Error('DIGEST_ENVIRONMENT_MISMATCH')
  let payload=claimed.payload
  if(!payload){
   const bytes=renderPdf(doc)
   if(bytes.length>20*1024*1024)throw Error('DIGEST_PDF_TOO_LARGE')
   payload={from,to:[destination.recipient],...renderEmail(doc),attachments:[{filename:`Corte_Semanal_${new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City'}).format(new Date(doc.period_end))}.pdf`,content:base64(bytes)}]}
  }
  // DB persists the exact payload before the first send. Every retry uses the
  // same bytes, sender and recipient even if templates or runtime configuration change.
  payload=await rpc('prepare_weekly_request_digest',{p_id:id,p_worker_id:worker,p_payload:payload})
  if(JSON.stringify(payload.to)!==JSON.stringify([destination.recipient])||payload.cc||payload.bcc||payload.attachments?.length!==1)throw Error('DIGEST_PAYLOAD_INVALID')
  const response=await runtime.fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`weekly-request-digest/${id}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw Error(`DIGEST_SEND_FAILED_${response.status}`)
  const result=await response.json()
  if(typeof result.id!=='string'||!result.id)throw Error('DIGEST_SEND_RESULT_INVALID')
  await rpc('finish_weekly_request_digest',{p_id:id,p_worker_id:worker,p_provider_id:result.id})
  return json({sent:1,run_id:id})
 }catch(error){
  const message=error instanceof Error?error.message:''
  const code=/^DIGEST_[A-Z0-9_]+$/.test(message)?message:'DIGEST_FAILED'
  if(id&&worker&&rpc){try{await rpc('finish_weekly_request_digest',{p_id:id,p_worker_id:worker,p_error_code:code})}catch{/* Lease expiry recovers with the same payload and idempotency key. */}}
  return json({error:code,sent:0},500)
 }
}
if(typeof Deno!=='undefined')Deno.serve((req:Request)=>handleRequest(req,{env:(name:string)=>Deno.env.get(name),fetch}))
