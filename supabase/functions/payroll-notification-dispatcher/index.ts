// Payroll-only delivery through the shared transactional outbox. The existing
// certified general dispatcher is unchanged. No public/client trigger endpoint.
type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch }
type Attachment = { channel: string; file_id: string; bucket: string; path: string; mime_type: string; size_bytes: number; sha256: string }
type Document = {
  event_id: string; event_type: 'payroll.registered' | 'payroll.paid'; request_id: string;
  folio: string; recipient_email: string; test_recipient_email?: string | null; company: string; period_start: string; period_end: string;
  amount: number; currency: string; url: string;
  channels: { channel: string; amount: number }[]; attachments: Attachment[];
}
const labels: Record<string, string> = { banco: 'BBVA', spei: 'SPEI', vales: 'TOKA' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const money = (value: number, currency: string) => new Intl.NumberFormat('es-MX',{style:'currency',currency}).format(value)
function required(runtime: Runtime, name: string): string {
  const value = runtime.env(name)?.trim()
  if (!value) throw new Error('PAYROLL_NOTIFICATION_CONFIGURATION_REQUIRED')
  return value
}
export function renderPayrollEmail(doc: Document, mode: string, attached: boolean) {
  const paid = doc.event_type === 'payroll.paid'
  const subject = `${mode === 'test_only' ? '[DEV TEST] ' : ''}Nómina ${paid ? 'pagada' : 'registrada'} · ${doc.folio}`
  const intro = paid ? 'Tesorería completó el pago de la nómina y registró los comprobantes de todos los canales.' : 'Se registró una corrida de nómina. Revisa los montos en Flux para continuar con el pago.'
  const rows = [['Empresa',doc.company],['Periodo',`${doc.period_start} al ${doc.period_end}`],['Folio',doc.folio],
    ...doc.channels.map(c => [labels[c.channel] || c.channel,money(c.amount,doc.currency)]),['Total',money(doc.amount,doc.currency)]]
  const proof = paid ? (attached ? 'Se adjuntan los comprobantes de los canales.' : 'Descarga los comprobantes de cada canal en Flux.') : ''
  return { subject, text: [intro,...rows.map(([k,v])=>`${k}: ${v}`),proof,`Abrir en Flux: ${doc.url}`].filter(Boolean).join('\n'),
    html:`<!doctype html><html lang="es"><body style="background:#eef1e9;font-family:Arial,sans-serif;color:#16322d;padding:24px"><table role="presentation" style="max-width:560px;width:100%;margin:auto;background:white;border-radius:12px;padding:24px"><tr><td><h1>Flux</h1><h2>${escape(subject)}</h2><p>${escape(intro)}</p><table style="width:100%">${rows.map(([k,v])=>`<tr><td style="padding:6px">${escape(k)}</td><td style="padding:6px;text-align:right">${escape(v)}</td></tr>`).join('')}</table><p>${escape(proof)}</p><p><a href="${escape(doc.url)}">Abrir nómina en Flux</a></p><p style="font-size:12px">Información privada · Acceso con tu cuenta de Flux.</p></td></tr></table></body></html>` }
}
async function rpc(runtime: Runtime, base: string, key: string, name: string, body: unknown): Promise<any> {
  const result = await runtime.fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
  if (!result.ok) throw new Error(`PAYROLL_NOTIFICATION_RPC_FAILED_${result.status}`)
  return result.json()
}
function validateDocument(doc: Document, eventId: string) {
  if (doc.event_id !== eventId || !['payroll.registered','payroll.paid'].includes(doc.event_type)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doc.recipient_email) || !/^https:\/\/[a-zA-Z0-9.-]+\/nomina\?capture=[0-9a-f-]{36}$/.test(doc.url)
    || !Array.isArray(doc.channels) || !doc.channels.length || doc.channels.length>3
    || new Set(doc.channels.map(c=>c.channel)).size!==doc.channels.length
    || doc.channels.some(c=>!labels[c.channel] || !Number.isFinite(Number(c.amount)) || Number(c.amount)<=0)) throw new Error('PAYROLL_NOTIFICATION_DOCUMENT_INVALID')
  if (!Array.isArray(doc.attachments) || (doc.event_type==='payroll.paid' && doc.attachments.length!==doc.channels.length)
    || (doc.event_type==='payroll.registered' && doc.attachments.length)) throw new Error('PAYROLL_NOTIFICATION_EVIDENCE_REQUIRED')
  for (const a of doc.attachments) {
    if (a.bucket!=='payroll-private' || a.mime_type!=='application/pdf' || a.path!==`${doc.request_id}/${a.file_id}.pdf`
      || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/.test(a.path) || !/^[0-9a-f]{64}$/.test(a.sha256)
      || !Number.isSafeInteger(a.size_bytes) || a.size_bytes<100 || a.size_bytes>10*1024*1024
      || !doc.channels.some(c=>c.channel===a.channel)) throw new Error('PAYROLL_NOTIFICATION_ATTACHMENT_INVALID')
  }
  if (new Set(doc.attachments.map(a=>a.channel)).size!==doc.attachments.length) throw new Error('PAYROLL_NOTIFICATION_ATTACHMENT_INVALID')
}
export async function prepareAttachments(runtime: Runtime, base: string, key: string, doc: Document) {
  // Keep the encoded email comfortably below Resend's 40 MB limit. Larger
  // packages remain available through the authenticated page linked in the mail.
  if (doc.attachments.reduce((total,a)=>total+a.size_bytes,0)>20*1024*1024) return []
  const result: {filename:string;content:string}[]=[]
  for (const a of doc.attachments) {
    const response=await runtime.fetch(`${base}/storage/v1/object/authenticated/payroll-private/${a.path}`,{headers:{apikey:key,Authorization:`Bearer ${key}`}})
    if (!response.ok) throw new Error('PAYROLL_NOTIFICATION_ATTACHMENT_DOWNLOAD_FAILED')
    const bytes=new Uint8Array(await response.arrayBuffer())
    const digest=await crypto.subtle.digest('SHA-256',bytes)
    const hash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('')
    if (bytes.length!==a.size_bytes || hash!==a.sha256 || new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-'
      || !new TextDecoder().decode(bytes.slice(-4096)).includes('%%EOF')) throw new Error('PAYROLL_NOTIFICATION_ATTACHMENT_MISMATCH')
    let binary=''
    for(let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768))
    result.push({filename:`Comprobante_${labels[a.channel]}.pdf`,content:btoa(binary)})
  }
  return result
}
export async function handleRequest(req: Request, runtime: Runtime): Promise<Response> {
  if(req.method!=='POST') return json({error:'METHOD_NOT_ALLOWED'},405)
  const secret=runtime.env('NOTIFICATION_DISPATCHER_SECRET')?.trim()
  if(!secret || req.headers.get('x-notification-dispatcher-secret')!==secret) return json({error:'UNAUTHORIZED'},401)
  const mode=runtime.env('NOTIFICATION_SEND_MODE') || 'disabled'
  // Authenticated, non-sending preflight. Operators can verify the effective
  // recipient/mode without claiming an event or exposing credential values.
  const body = await req.json().catch(() => ({}))
  if(body?.dry_run === true) return json({dry_run:true,sent:0,mode,
    test_recipient:mode==='test_only' ? runtime.env('NOTIFICATION_TEST_EMAIL')?.trim() || null : null,
    configured:['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','NOTIFICATION_FROM_EMAIL'].every(name=>!!runtime.env(name)?.trim())})
  if(mode==='disabled') return json({disabled:true,sent:0})
  if(!['test_only','real'].includes(mode)) return json({error:'PAYROLL_NOTIFICATION_MODE_INVALID'},409)
  try {
    const base=required(runtime,'SUPABASE_URL').replace(/\/$/,'')
    const key=required(runtime,'SUPABASE_SERVICE_ROLE_KEY')
    const resend=required(runtime,'RESEND_API_KEY')
    const from=required(runtime,'NOTIFICATION_FROM_EMAIL')
    const testEmail=mode==='test_only' ? required(runtime,'NOTIFICATION_TEST_EMAIL') : ''
    const worker=`payroll-${crypto.randomUUID()}`
    const events=await rpc(runtime,base,key,'claim_payroll_notifications',{p_worker_id:worker}) as string[]
    const results: {event_id:string;status:string}[]=[]
    for(const eventId of events) {
      let providerId: string | null=null
      try {
        const doc=await rpc(runtime,base,key,'get_payroll_notification_document',{p_event_id:eventId,p_worker_id:worker}) as Document
        validateDocument(doc,eventId)
        if(doc.test_recipient_email && (mode!=='test_only' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(doc.test_recipient_email)))
          throw new Error('PAYROLL_NOTIFICATION_TEST_MODE_REQUIRED')
        const attachments=await prepareAttachments(runtime,base,key,doc)
        const rendered=renderPayrollEmail(doc,mode,attachments.length>0)
        const response=await runtime.fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`notification/${eventId}`},
          body:JSON.stringify({from,to:[mode==='test_only'?(doc.test_recipient_email || testEmail):doc.recipient_email],...rendered,...(attachments.length?{attachments}:{})})})
        if(!response.ok) throw new Error(`PAYROLL_NOTIFICATION_SEND_FAILED_${response.status}`)
        const sent=await response.json()
        if(typeof sent.id!=='string' || !sent.id) throw new Error('PAYROLL_NOTIFICATION_SEND_RESULT_INVALID')
        providerId=sent.id
        await rpc(runtime,base,key,'mark_notification_processed_for_dispatcher',{p_event_id:eventId,p_worker_id:worker,p_provider_message_id:providerId,p_resend_email_id:providerId})
        results.push({event_id:eventId,status:'sent'})
      } catch(error) {
        const code=error instanceof Error && /^PAYROLL_[A-Z0-9_]+$/.test(error.message) ? error.message : 'PAYROLL_NOTIFICATION_FAILED'
        await rpc(runtime,base,key,'mark_notification_failed_for_dispatcher',{p_event_id:eventId,p_worker_id:worker,p_error_message:code,p_resend_email_id:providerId})
        results.push({event_id:eventId,status:'failed'})
      }
    }
    return json({results,sent:results.filter(r=>r.status==='sent').length})
  } catch { return json({error:'PAYROLL_NOTIFICATION_DISPATCH_FAILED'},500) }
}
if(import.meta.main) Deno.serve((req: Request)=>handleRequest(req,{env:name=>Deno.env.get(name),fetch}))
