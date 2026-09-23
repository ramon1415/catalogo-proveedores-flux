import { jsPDF } from 'jspdf'
import autoTableModule from 'jspdf-autotable'
import { FONT_REGULAR, FONT_BOLD } from './fonts.ts'
import { FLUX_PDF_LOGO } from './pdfLogo.ts'
export type Row = { id:string; folio:string; company:string; beneficiary:string; description:string; cost_center:string; category:string; amount_minor:number; currency:string; status:string; request_type:string; requester:string; created_at:string }
export type Document = { id:string; environment:'dev'|'prod'; recipient:string; period_start:string; period_end:string; rows:Row[] }
const labels:Record<string,string>={draft:'Borrador',submitted:'Enviada',pending_approval:'Pendiente de aprobación',approved:'Aprobada',changes_requested:'Cambios solicitados',finance_validation:'Validación de Finanzas',scheduled:'Programada',paid:'Pagada',cancelled:'Cancelada'}
export const escapeHtml=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const money=(n:number,currency:string)=>`$${(n/100).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency}`
const date=(v:string)=>new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v))
export function validateDocument(doc:Document) {
  if(!doc.id || !['dev','prod'].includes(doc.environment) || !Array.isArray(doc.rows) || !doc.rows.length
    || !Number.isFinite(Date.parse(doc.period_start)) || !Number.isFinite(Date.parse(doc.period_end)) || Date.parse(doc.period_start)>=Date.parse(doc.period_end)
    || doc.recipient!==(doc.environment==='prod'?'lisette@dezdez.earth':'ramon@quantta.mx')) throw Error('DIGEST_DOCUMENT_INVALID')
  const ids=new Set<string>()
  for(const r of doc.rows) {
    if(!r.id || ids.has(r.id) || r.status!=='approved' || !Number.isSafeInteger(r.amount_minor) || r.amount_minor<0
      || !/^[A-Z]{3}$/.test(r.currency) || !r.company || !r.folio || Date.parse(r.created_at)<Date.parse(doc.period_start)
      || Date.parse(r.created_at)>=Date.parse(doc.period_end) || !Number.isFinite(Date.parse(r.created_at))) throw Error('DIGEST_ROW_INVALID')
    ids.add(r.id)
  }
}
export function totals(rows:Row[]) {
  const totals=new Map<string,number>()
  for(const r of rows) { const sum=(totals.get(r.currency)||0)+r.amount_minor; if(!Number.isSafeInteger(sum))throw Error('DIGEST_AMOUNT_OVERFLOW');totals.set(r.currency,sum) }
  return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([currency,amount])=>money(amount,currency)).join(' / ')
}
export function renderEmail(doc:Document) {
  validateDocument(doc)
  const groups=[...new Set(doc.rows.map(r=>r.company))].sort()
  const summary=groups.map(company=>{const rows=doc.rows.filter(r=>r.company===company);return {company,count:rows.length,total:totals(rows)}})
  const approved=doc.rows.filter(r=>['approved','scheduled','paid'].includes(r.status)).length
  const pending=doc.rows.filter(r=>!['approved','scheduled','paid','cancelled'].includes(r.status)).length
  const cancelled=doc.rows.filter(r=>r.status==='cancelled').length
  const subject=`${doc.environment==='dev'?'[DEV TEST] ':''}Flux | Corte semanal de solicitudes · ${date(doc.period_end).split(',')[0]}`
  const period=`${date(doc.period_start)} al ${date(doc.period_end)} · CDMX`
  const state=`${approved} solicitud(es) aprobada(s).`
  const rowsHtml=summary.map(s=>`<tr><td>${escapeHtml(s.company)}</td><td align="center"><strong>${s.count}</strong></td><td align="right"><strong>${escapeHtml(s.total)}</strong></td></tr>`).join('')
  // The summary is deliberately short; all requests and their real status are in the attached PDF.
  const details=groups.map(company=>`<h2 style="margin:22px 0 8px;font-family:Georgia,serif;font-size:18px;color:#16322d;">${escapeHtml(company)}</h2><table width="100%" cellspacing="0" cellpadding="0" style="font-size:13px;">${doc.rows.filter(r=>r.company===company).slice(0,8).map(r=>`<tr><td style="padding:9px 8px 9px 0;border-bottom:1px solid #e8ece7;"><strong>${escapeHtml(r.beneficiary||r.requester)}</strong><br><span style="color:#68716d;font-size:12px;">${escapeHtml(r.folio)} · ${escapeHtml(r.description.slice(0,100))}<br>${escapeHtml(labels[r.status])}</span></td><td align="right" style="white-space:nowrap;vertical-align:top;padding-top:9px;">${escapeHtml(money(r.amount_minor,r.currency))}</td></tr>`).join('')}</table>${doc.rows.filter(r=>r.company===company).length>8?'<p style="font-size:12px;color:#68716d;">Detalle completo en el PDF adjunto.</p>':''}`).join('')
  const text=[doc.environment==='dev'?'PRUEBA DEV · SOLO PARA RAMÓN':'','Corte semanal de solicitudes',period,...summary.map(s=>`${s.company}: ${s.count} solicitudes · ${s.total}`),`TOTAL: ${doc.rows.length} solicitudes · ${totals(doc.rows)}`,state,'PDF adjunto con el detalle por empresa. Incluye únicamente solicitudes aprobadas.','Monto solicitado; este reporte no autoriza ni ejecuta pagos.'].filter(Boolean).join('\n')
  const html=`<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#eef1e9;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#eef1e9" style="border-top:8px solid #16322d;"><tr><td align="center" style="padding:24px 12px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:560px;border:1px solid #d8ddd5;border-radius:14px;overflow:hidden;"><tr><td bgcolor="#16322d" style="padding:20px 28px;"><img src="https://flux.quantta.mx/assets/email/flux-logo-email-white.png" width="110" alt="Flux" style="display:block;border:0;"></td></tr><tr><td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;">${doc.environment==='dev'?'<p style="font-size:11px;font-weight:bold;color:#9a6700;">PRUEBA DEV · SOLO PARA RAMÓN</p>':''}<h1 style="margin:0 0 8px;font-family:Georgia,serif;font-size:24px;color:#16322d;">Corte semanal de solicitudes</h1><p style="margin:0 0 18px;font-size:13px;color:#68716d;">${escapeHtml(period)}</p><table width="100%" cellspacing="0" cellpadding="11" style="border-collapse:collapse;background:#eef1e9;border:1px solid #d8ddd5;font-size:14px;"><thead><tr style="font-size:12px;color:#68716d;"><th align="left">Empresa</th><th>Solicitudes</th><th align="right">Monto solicitado</th></tr></thead><tbody>${rowsHtml}<tr bgcolor="#16322d" style="color:#ffffff;"><td><strong>TOTAL</strong></td><td align="center"><strong>${doc.rows.length}</strong></td><td align="right"><strong>${escapeHtml(totals(doc.rows))}</strong></td></tr></tbody></table><p style="font-size:13px;">${escapeHtml(state)}<br><strong>PDF adjunto con el detalle por empresa.</strong></p>${details}<p style="margin:18px 0 0;font-size:11px;line-height:1.4;color:#7b837f;">Incluye únicamente solicitudes aprobadas creadas en el periodo. Este reporte es independiente de los cortes de autorización. Este reporte no autoriza ni ejecuta pagos.</p></td></tr></table><div style="padding:14px 8px 0;font-family:Arial,sans-serif;font-size:11px;color:#7b837f;">Flux · Powered by Quantta</div></td></tr></table></body></html>`
  return {subject,text,html}
}
export function renderPdf(doc:Document):Uint8Array {
  validateDocument(doc)
  // npm and Deno expose the CommonJS autotable package with different wrapping.
  const autoTable=typeof autoTableModule==='function'?autoTableModule:(autoTableModule as any).default
  const pdf=new jsPDF({orientation:'landscape',unit:'pt',format:'letter',compress:true})
  pdf.addFileToVFS('FluxSans.ttf',FONT_REGULAR);pdf.addFont('FluxSans.ttf','FluxSans','normal')
  pdf.addFileToVFS('FluxSans-Bold.ttf',FONT_BOLD);pdf.addFont('FluxSans-Bold.ttf','FluxSans','bold')
  pdf.setCreationDate(new Date(doc.period_end));pdf.setFileId(doc.id.replace(/-/g,'').slice(0,32))
  pdf.setProperties({title:'Corte semanal de solicitudes',author:'Flux'})
  const groups=[...new Set(doc.rows.map(r=>r.company))].sort()
  for(let i=0;i<groups.length;i++) {
    if(i)pdf.addPage()
    const company=groups[i];const rows=doc.rows.filter(r=>r.company===company)
    pdf.addImage(FLUX_PDF_LOGO,'PNG',676,22,80,32)
    pdf.setFont('FluxSans','bold');pdf.setFontSize(17);pdf.setTextColor(22,50,45);pdf.text('Corte semanal de solicitudes',36,36)
    pdf.setFont('FluxSans','normal');pdf.setFontSize(10);pdf.text(company,36,55)
    pdf.setFontSize(8);pdf.setTextColor(104,113,109);pdf.text(`${date(doc.period_start)} al ${date(doc.period_end)} | CDMX`,36,72)
    pdf.text(`${rows.length} solicitudes | Monto solicitado: ${totals(rows)}`,36,88)
    pdf.text(doc.environment==='dev'?'PRUEBA DEV - Reporte informativo, no autoriza pagos.':'Reporte informativo; incluye únicamente solicitudes aprobadas.',36,104)
    autoTable(pdf,{startY:118,margin:{left:36,right:36,top:30,bottom:40},head:[['Folio / tipo','Proveedor / beneficiario','Concepto','Centro / partida','Monto','Solicitante / estado']],body:rows.map(r=>[`${r.folio}\n${r.request_type==='reimbursement'?'Reembolso':r.request_type==='provider_payment'?'Proveedor':r.request_type}`,r.beneficiary||r.requester,r.description,`${r.cost_center}\n${r.category}`,money(r.amount_minor,r.currency),`${r.requester}\n${labels[r.status]}`]),styles:{font:'FluxSans',fontSize:8,cellPadding:6,overflow:'linebreak',textColor:[22,50,45]},headStyles:{fillColor:[22,50,45],textColor:[255,255,255]},alternateRowStyles:{fillColor:[244,246,241]},columnStyles:{0:{cellWidth:88},1:{cellWidth:139},2:{cellWidth:135},3:{cellWidth:165},4:{cellWidth:87},5:{cellWidth:106}}})
  }
  for(let p=1;p<=pdf.getNumberOfPages();p++){pdf.setPage(p);pdf.setFontSize(8);pdf.setTextColor(104,113,109);pdf.text('Flux - Corte semanal | Solo aprobadas | No autoriza ni ejecuta pagos',36,590);pdf.text(`${p} / ${pdf.getNumberOfPages()}`,756,590,{align:'right'})}
  return new Uint8Array(pdf.output('arraybuffer'))
}
