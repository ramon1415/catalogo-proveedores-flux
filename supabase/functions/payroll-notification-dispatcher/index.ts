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
const money = (value: number, currency: string) => `${currency} ${Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
function required(runtime: Runtime, name: string): string {
  const value = runtime.env(name)?.trim()
  if (!value) throw new Error('PAYROLL_NOTIFICATION_CONFIGURATION_REQUIRED')
  return value
}
export function renderPayrollEmail(doc: Document, mode: string, attached: boolean) {
  const paid = doc.event_type === 'payroll.paid'
  const subject = `${mode === 'test_only' ? '[DEV TEST] ' : ''}Nómina ${paid ? 'pagada' : 'registrada'} · ${doc.folio}`
  const heading = paid ? 'Nómina pagada' : 'Nueva nómina por revisar'
  const intro = paid ? 'Tesorería completó el pago de la nómina y registró los comprobantes de todos los canales.' : 'Se registró una corrida de nómina. Revisa los montos en Flux para continuar con el pago.'
  const rows = [['Folio',doc.folio],['Empresa',doc.company],['Periodo',`${doc.period_start} al ${doc.period_end}`],
    ...doc.channels.map(c => [labels[c.channel] || c.channel,money(c.amount,doc.currency)]),['Total',money(doc.amount,doc.currency)]]
  const proof = paid ? (attached ? 'Se adjuntan los comprobantes de los canales.' : 'Descarga los comprobantes de cada canal en Flux.') : ''
  const action = paid ? 'Ver nómina y comprobantes' : 'Revisar nómina'
  const privacy = 'Información privada · Acceso con tu cuenta de Flux.'
  const testNotice = mode === 'test_only' ? 'Modo DEV TEST: este correo fue redirigido al destinatario de prueba.' : ''
  // Match the established payment-request email in notification-dispatcher.
  // Tables, inline styles and bgcolor keep the layout usable in email clients.
  const htmlRows = rows.map(([label, value]) => `
      <tr>
        <td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;line-height:1.35;vertical-align:top;">${escape(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e8ece7;color:#1f2926;font-size:14px;line-height:1.35;vertical-align:top;overflow-wrap:anywhere;"><strong>${escape(value)}</strong></td>
      </tr>`).join('')
  const testBanner = testNotice
    ? `<div style="margin-top:20px;padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;line-height:1.4;">${escape(testNotice)}</div>`
    : ''
  return {
    subject,
    text: [heading, intro, ...rows.map(([k,v])=>`${k}: ${v}`), proof, `${action}: ${doc.url}`, privacy, testNotice].filter(Boolean).join('\n'),
    html: `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#eef1e9;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(subject)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef1e9" style="width:100%;margin:0;padding:0;border-top:8px solid #16322d;background:#eef1e9;">
      <tr>
        <td align="center" style="padding:24px 12px 18px;">
          <div style="width:100%;max-width:560px;margin:0 auto;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;background:#ffffff;">
            <tr>
              <td bgcolor="#16322d" style="padding:20px 28px;border-radius:13px 13px 0 0;background:#16322d;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;line-height:1.15;text-align:left;">Flux</td>
            </tr>
            <tr>
              <td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;text-align:left;">
                <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;color:#16322d;">${escape(heading)}</h1>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.5;color:#1f2926;">${escape(intro)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table>
                ${proof ? `<p style="margin:18px 0 0;font-size:14px;line-height:1.5;">${escape(proof)}</p>` : ''}
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">
                  <tr>
                    <td bgcolor="#16322d" style="border-radius:6px;">
                      <a href="${escape(doc.url)}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;line-height:22px;text-decoration:none;">${escape(action)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#68716d;">${escape(privacy)}</p>
                ${testBanner}
              </td>
            </tr>
          </table>
          </div>
          <div style="padding:14px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#7b837f;text-align:center;">Flux &middot; Powered by Quantta</div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  }
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
