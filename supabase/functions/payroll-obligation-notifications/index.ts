type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch }
type Document = {event_id:string;event_type:string;id:string;kind:'imss'|'isn_cdmx';folio:string;company:string;
 recipient_email:string;test_recipient_email:string|null;period_start:string;period_end:string;amount_minor:number;url:string}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function renderObligationEmail(doc:Document,testOnly:boolean){
 const kind=doc.kind==='imss'?'IMSS':'ISN';const paid=doc.event_type==='payroll.obligation.paid'
 const heading=paid?`Pago de ${kind} registrado`:`Nueva solicitud de ${kind} por revisar`
 const intro=paid?'Finanzas registró el pago y guardó su comprobante. Puedes consultarlo en Flux.':'Se registró una obligación. Revisa el documento y confirma el monto para continuar con el pago.'
 const subject=`${testOnly?'[DEV TEST] ':''}${heading} · ${doc.folio}`
 const rows=[['Folio',doc.folio],['Empresa',doc.company],['Periodo',`${doc.period_start} al ${doc.period_end}`],['Importe',`MXN ${(doc.amount_minor/100).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}`]]
 const action=paid?'Ver comprobante en Flux':'Revisar solicitud'
 const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1e9;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef1e9" style="border-top:8px solid #16322d;"><tr><td align="center" style="padding:24px 12px 18px;">
 <div style="max-width:560px;margin:0 auto;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;">
 <tr><td bgcolor="#16322d" style="padding:20px 28px;border-radius:13px 13px 0 0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:32px;font-weight:700;">Flux</td></tr>
 <tr><td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;"><h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:#16322d;">${escape(heading)}</h1>
 <p style="font-size:14px;line-height:1.5;">${escape(intro)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map(([k,v])=>`<tr><td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;">${escape(k)}</td><td style="padding:10px 0;border-bottom:1px solid #e8ece7;font-size:14px;"><strong>${escape(v)}</strong></td></tr>`).join('')}</table>
 <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:22px;"><tr><td bgcolor="#16322d" style="border-radius:6px;"><a href="${escape(doc.url)}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-weight:700;text-decoration:none;font-size:14px;">${escape(action)}</a></td></tr></table>
 <p style="margin-top:18px;font-size:12px;color:#68716d;">Información privada · Acceso con tu cuenta de Flux.</p>${testOnly?'<p style="padding:12px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;">DEV TEST · Correo dirigido a la cuenta de prueba.</p>':''}</td></tr></table></div>
 <div style="padding:14px 8px 0;font-family:Arial,sans-serif;font-size:11px;color:#7b837f;">Flux · Powered by Quantta</div></td></tr></table></body></html>`
 return {subject,html,text:[heading,intro,...rows.map(([k,v])=>`${k}: ${v}`),`${action}: ${doc.url}`].join('\n')}
}
export async function handleRequest(req:Request,runtime:Runtime):Promise<Response>{
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405)
 const secret=runtime.env('NOTIFICATION_DISPATCHER_SECRET')
 if(!secret||req.headers.get('x-notification-dispatcher-secret')!==secret)return json({error:'UNAUTHORIZED'},401)
 const mode=runtime.env('NOTIFICATION_SEND_MODE')||'disabled'
 const body=await req.json().catch(()=>({}))
 if(body.dry_run===true)return json({dry_run:true,mode,sent:0,configured:['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','RESEND_API_KEY','NOTIFICATION_FROM_EMAIL'].every(key=>!!runtime.env(key))})
 if(mode==='disabled')return json({disabled:true,sent:0})
 if(!['real','test_only'].includes(mode))return json({error:'OBLIGATION_NOTIFICATION_MODE_INVALID'},409)
 try{
  const base=runtime.env('SUPABASE_URL')?.replace(/\/$/,'');const key=runtime.env('SUPABASE_SERVICE_ROLE_KEY');const resend=runtime.env('RESEND_API_KEY');const from=runtime.env('NOTIFICATION_FROM_EMAIL')
  if(!base||!key||!resend||!from)throw Error('configuration')
  const rpc=async(name:string,body:unknown)=>{const r=await runtime.fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('rpc');return r.json()}
  const worker=`obligation-${crypto.randomUUID()}`;const events=await rpc('claim_payroll_obligation_notifications',{p_worker_id:worker}) as string[];let sent=0
  for(const event of events){let providerId:string|null=null;try{
   const doc=await rpc('get_payroll_obligation_notification_document',{p_event_id:event,p_worker_id:worker}) as Document
   if(doc.event_id!==event||!['payroll.obligation.registered','payroll.obligation.paid'].includes(doc.event_type)||!['imss','isn_cdmx'].includes(doc.kind)
    ||!email.test(doc.recipient_email)||!Number.isSafeInteger(Number(doc.amount_minor))||Number(doc.amount_minor)<=0
    ||!/^https:\/\/[a-zA-Z0-9.-]+\/nomina\?obligation=[0-9a-f-]{36}$/.test(doc.url)||!doc.url.endsWith(doc.id))throw Error('document')
   const recipient=mode==='test_only'?doc.test_recipient_email:doc.recipient_email
   if(!recipient||!email.test(recipient)||(mode==='real'&&doc.test_recipient_email))throw Error('test recipient configuration')
   const response=await runtime.fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`notification/${event}`},body:JSON.stringify({from,to:[recipient],...renderObligationEmail(doc,mode==='test_only')})})
   if(!response.ok)throw Error('delivery')
   const result=await response.json();if(typeof result.id!=='string'||!result.id)throw Error('provider result');providerId=result.id
   await rpc('mark_notification_processed_for_dispatcher',{p_event_id:event,p_worker_id:worker,p_provider_message_id:providerId,p_resend_email_id:providerId});sent++
  }catch{await rpc('mark_notification_failed_for_dispatcher',{p_event_id:event,p_worker_id:worker,p_error_message:'OBLIGATION_NOTIFICATION_FAILED',p_resend_email_id:providerId})}}
  return json({sent})
 }catch{return json({error:'OBLIGATION_NOTIFICATION_DISPATCH_FAILED'},500)}
}
if(import.meta.main)Deno.serve((req:Request)=>handleRequest(req,{env:name=>Deno.env.get(name),fetch}))
