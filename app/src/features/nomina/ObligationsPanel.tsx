import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { extractPdfLines } from '../../lib/pdfText'
import { parseObligationDocument } from './obligationDocuments'
import { receiptAmountMinor } from './receiptAmount'
import { formatMoney } from './logic'
import s from './Nomina.module.css'

type Kind = 'imss' | 'isn_cdmx'
type Context = { can_capture: boolean; can_pay: boolean; company_rfc: string; kinds: {kind: Kind; category_name: string | null; centers: {id: string; name: string}[]}[] }
type SavedFile = { id: string; kind: string; status: string; parsed?: {amount?: string; paymentDate?: string; reference?: string; currency?: string} }
type Obligation = { id: string; kind: Kind; company_id: string; status: string; version: number; files: SavedFile[];
  period_start: string | null; period_end: string | null; amount_minor: number | null; due_date: string | null; payment_reference: string | null;
  cost_center_id: string | null; budget_month: string | null; payment_date: string | null; bank_reference: string | null }
const kinds: Record<string,string> = { imss: 'IMSS', isn_cdmx: 'ISN · CDMX', imss_sipare: 'Línea de captura IMSS', imss_sua: 'Cédula SUA', imss_ema: 'Propuesta EMA', receipt: 'Comprobante de pago' }
const states: Record<string,string> = {draft: 'Borrador', submitted: 'Por confirmar montos', approved: 'Lista para pago', paid: 'Pagada', cancelled: 'Cancelada'}
const errors: Record<string,string> = {
 OBLIGATION_COMPANY_RFC_MISMATCH: 'El RFC del documento no corresponde a la empresa activa.',
 OBLIGATION_DOCUMENTS_INCONSISTENT: 'Revisa que los documentos tengan el mismo RFC, registro patronal, periodo e importe.',
 OBLIGATION_DOCUMENT_INVALID: 'No se pudieron leer todos los datos. Revisa el PDF y su formato.',
 OBLIGATION_BUDGET_ASSIGNMENT_REQUIRED: 'Falta configurar la partida y el centro de costo para esta obligación.',
 OBLIGATION_BUDGET_LINE_REQUIRED: 'No existe presupuesto activo para el centro, partida y mes seleccionados.',
 OBLIGATION_BUDGET_UNAVAILABLE: 'El presupuesto disponible no alcanza para enviar esta obligación.',
 OBLIGATION_STALE_VERSION: 'La solicitud cambió. Se actualizará para que revises su última versión.',
 OBLIGATION_DUPLICATE_DOCUMENT: 'Este documento ya está registrado en otra obligación de la empresa.',
 OBLIGATION_PAYMENT_FORM_IS_NOT_RECEIPT: 'Selecciona el comprobante bancario del pago realizado. Una línea de captura no acredita el pago.',
 OBLIGATION_PAYMENT_FIELDS_INVALID: 'Revisa importe, fecha y referencia. El importe debe coincidir con la obligación.',
 OBLIGATION_RECEIPT_REQUIRED: 'Carga el comprobante de pago antes de cerrar.',
 OBLIGATION_ACCESS_DENIED: 'Tu perfil no tiene permiso para esta acción en la empresa activa.',
}
const message = (error: unknown) => errors[(error as {message?: string})?.message || ''] || 'No se completó la acción. Revisa los datos y vuelve a intentar.'
async function rpc<T>(name: string, params: Record<string,unknown>): Promise<T> {
 const { data, error } = await supabase.rpc(name,params); if (error) throw error; return data as T
}
async function fileAction(fileId: string,action: 'verify'|'download') {
 const {data,error}=await supabase.functions.invoke('payroll-obligations',{body:{file_id:fileId,action}})
 if(error){const body=await error.context?.clone?.().json().catch(()=>null);throw new Error(body?.error||'OBLIGATION_FILE_FAILED')}
 return data
}

export function ObligationsPanel({companyId,companyName}: {companyId: string; companyName: string}) {
 const {showToast}=useToast();const [context,setContext]=useState<Context|null>(null);const [records,setRecords]=useState<Obligation[]>([])
 const [loading,setLoading]=useState(true);const [modal,setModal]=useState<Obligation|null>(null);const [busy,setBusy]=useState(false)
 const [center,setCenter]=useState('');const [month,setMonth]=useState('');const [amount,setAmount]=useState('');const [date,setDate]=useState('');const [reference,setReference]=useState('')
 const [notice,setNotice]=useState(''); const scope=useRef(companyId);scope.current=companyId
 async function refresh(id?: string) {
  const company=companyId;const rows=await rpc<Obligation[]>('get_payroll_obligations',{p_company_id:company,p_id:null})
  if(scope.current!==company)return
  setRecords(rows)
  if(id){const current=rows.find(r=>r.id===id);if(current)setModal(current)}
 }
 useEffect(()=>{
  let cancelled=false;setContext(null);setRecords([]);setModal(null);setNotice('');setLoading(true)
  void rpc<Context>('get_payroll_obligation_context',{p_company_id:companyId}).then(async data=>{
   if(cancelled)return;setContext(data)
   if(data.can_capture||data.can_pay){await refresh()
    const linked=new URLSearchParams(window.location.search).get('obligation')
    if(linked){const rows=await rpc<Obligation[]>('get_payroll_obligations',{p_company_id:companyId,p_id:linked});if(!cancelled&&rows[0])open(rows[0])}
   }
  }).catch(()=>{if(!cancelled)setNotice('IMSS/ISN todavía no está disponible para esta empresa.')}).finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[companyId])
 function open(o: Obligation) {
  setModal(o);setCenter(o.cost_center_id||'');setMonth(o.budget_month?.slice(0,7)||'');setNotice('')
  const receipt=o.files.find(f=>f.kind==='receipt'&&f.status==='verified')?.parsed
  setAmount(receipt?.amount||'');setDate(receipt?.paymentDate||o.payment_date||'');setReference(receipt?.reference||o.bank_reference||'')
 }
 async function execute(action: ()=>Promise<void>) {
  if(busy)return;setBusy(true);setNotice('')
  try{await action()}catch(error){const text=message(error);setNotice(text);showToast('Revisa la solicitud',text,'warning');if(modal)await refresh(modal.id).catch(()=>{})}
  finally{setBusy(false)}
 }
 async function create(kind: Kind) {
  const id=crypto.randomUUID()
  await rpc('save_payroll_obligation',{p_id:id,p_company_id:companyId,p_kind:kind})
  const rows=await rpc<Obligation[]>('get_payroll_obligations',{p_company_id:companyId,p_id:id});if(scope.current!==companyId)return
  await refresh();if(rows[0])open(rows[0])
 }
 async function upload(files: FileList|null,receipt=false) {
  if(!modal||!files?.length)return
  const id=modal.id;let current=modal
  for(const file of Array.from(files)) {
   if(file.size<100||file.size>10*1024*1024)throw new Error('OBLIGATION_DOCUMENT_INVALID')
   let kind='receipt'
   if(!receipt){const parsed=parseObligationDocument(await extractPdfLines(file));kind=parsed.kind
    if(kind==='unknown'||parsed.issues.length)throw new Error('OBLIGATION_DOCUMENT_INVALID')
    if(parsed.taxpayerRfc!==context?.company_rfc?.replace(/[^A-Z0-9Ñ&]/gi,'').toUpperCase())throw new Error('OBLIGATION_COMPANY_RFC_MISMATCH')
   }
   const bytes=await file.arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('')
   const reserved=await rpc<{file_id:string;bucket:string;path:string}>('reserve_payroll_obligation_file',{p_id:id,p_version:current.version,p_kind:kind,p_size_bytes:file.size,p_sha256:hash})
   const {error}=await supabase.storage.from(reserved.bucket).upload(reserved.path,file,{contentType:'application/pdf',upsert:false});if(error)throw error
   const verified=await fileAction(reserved.file_id,'verify')
   const rows=await rpc<Obligation[]>('get_payroll_obligations',{p_company_id:companyId,p_id:id});current=rows[0]
   if(scope.current!==companyId)return
   setModal(current);setMonth(current.budget_month?.slice(0,7)||'')
   if(receipt){setAmount(verified.parsed?.amount||'');setDate(verified.parsed?.paymentDate||'');setReference(verified.parsed?.reference||'')}
  }
  await refresh(id)
 }
 async function save() {
  if(!modal)return
  await rpc('save_payroll_obligation',{p_id:modal.id,p_company_id:companyId,p_kind:modal.kind,p_version:modal.version,p_cost_center_id:center||null,p_budget_month:month?`${month}-01`:null})
  await refresh(modal.id)
 }
 async function transition(action: string) {
  if(!modal)return
  let current=modal
  if(action==='submit'){
   await rpc('save_payroll_obligation',{p_id:modal.id,p_company_id:companyId,p_kind:modal.kind,p_version:modal.version,p_cost_center_id:center||null,p_budget_month:month?`${month}-01`:null})
   current=(await rpc<Obligation[]>('get_payroll_obligations',{p_company_id:companyId,p_id:modal.id}))[0]
  }
  await rpc('transition_payroll_obligation',{p_id:current.id,p_version:current.version,p_action:action,p_amount_minor:action==='pay'?receiptAmountMinor(amount):null,p_payment_date:action==='pay'?date||null:null,p_reference:action==='pay'?reference||null:null})
  await refresh(current.id);showToast('Solicitud actualizada',action==='pay'?'El pago quedó registrado.':'El cambio quedó guardado.','success')
 }
 const cfg=context?.kinds.find(k=>k.kind===modal?.kind)
 const canEdit=!!context?.can_capture&&modal?.status==='draft'
 return <>
  <div className={s.phead}><div><h1>IMSS e ISN</h1><p>Registra los documentos y el pago de las obligaciones de {companyName}.</p></div>
   <div className={s.fileActions}>{context?.can_capture&&context.kinds.map(k=><button key={k.kind} className={s.primaryBtn} disabled={busy} onClick={()=>void execute(()=>create(k.kind))}>Nueva solicitud {kinds[k.kind]}</button>)}</div>
  </div>
  <section className={s.board}><div className={s.boardHead}><div><h2 id="obligation-list-title">Solicitudes IMSS / ISN</h2><p>{records.length} solicitudes · Acceso privado</p></div></div>
   <div className={s.boardList} role="region" aria-labelledby="obligation-list-title" tabIndex={0}>
    {loading&&<div className={s.boardEmpty}>Cargando…</div>}
    {!loading&&!records.length&&<div className={s.boardEmpty}>{notice||'Aún no hay solicitudes.'}</div>}
    {records.map(o=><article key={o.id} className={s.boardItem}><div className={s.boardItemInfo}><strong>{kinds[o.kind]} · {o.period_start?.slice(0,7)||'Nueva captura'}</strong><span>{o.amount_minor?formatMoney(o.amount_minor/100):'Importe pendiente de documento'}</span></div>
     <span className={`${s.state} ${o.status==='paid'?s.stateSuccess:s.stateNeutral}`}>{states[o.status]}</span><button className={s.secondaryBtn} onClick={()=>open(o)}>Abrir</button></article>)}
   </div></section>
  {modal&&<Modal title={`Solicitud ${kinds[modal.kind]}`} subtitle={`${companyName} · ${states[modal.status]}`} size="lg" onClose={()=>{if(!busy)setModal(null)}} actions={<>
   <button className={s.secondaryBtn} disabled={busy} onClick={()=>setModal(null)}>Cerrar</button>
   {canEdit&&<><button className={s.secondaryBtn} disabled={busy} onClick={()=>void execute(save)}>Guardar borrador</button><button className={s.primaryBtn} disabled={busy||!center||!month||!modal.amount_minor} onClick={()=>void execute(()=>transition('submit'))}>Enviar a Finanzas</button></>}
   {context?.can_pay&&modal.status==='submitted'&&<button className={s.primaryBtn} disabled={busy} onClick={()=>void execute(()=>transition('confirm'))}>Confirmar montos correctos</button>}
   {context?.can_pay&&modal.status==='approved'&&<button className={s.primaryBtn} disabled={busy||!amount||!date||!reference||!modal.files.some(f=>f.kind==='receipt'&&f.status==='verified')} onClick={()=>void execute(()=>transition('pay'))}>Confirmar pago registrado</button>}
  </>}>
   <div className={s.section}>
    {notice&&<div className={s.notice} role="alert">{notice}</div>}
    {canEdit&&<label className={s.dropzone} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void execute(()=>upload(e.dataTransfer.files))}}>
     <strong>Arrastra aquí los documentos {kinds[modal.kind]}</strong><span>{modal.kind==='imss'?'Línea SIPARE y, si los tienes, cédula SUA y propuesta EMA.':'Línea de captura ISN de CDMX.'} PDF, hasta 10 MB por archivo.</span>
     <input type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={e=>{const files=e.target.files;void execute(()=>upload(files));e.target.value=''}} />
    </label>}
    <div className={s.fileRows}>{modal.files.map(f=><div key={f.id} className={s.fileRow}><div className={s.fileInfo}><strong>{kinds[f.kind]}</strong><span>{f.status==='verified'?'Guardado':'Carga pendiente; vuelve a seleccionar el archivo'}</span></div>
     {f.status==='verified'&&<button className={s.secondaryBtn} disabled={busy} onClick={()=>void execute(async()=>{const data=await fileAction(f.id,'download');window.open(data.url,'_blank','noopener,noreferrer')})}>Descargar</button>}</div>)}</div>
    <div className={s.summaryMetrics}><div className={s.metric}><span>Importe total</span><strong>{modal.amount_minor?formatMoney(modal.amount_minor/100):'Pendiente'}</strong></div><div className={s.metric}><span>Periodo</span><strong>{modal.period_start||'Pendiente'} → {modal.period_end||'Pendiente'}</strong></div></div>
    {modal.due_date&&<p>Vencimiento del documento: {modal.due_date}</p>}
    {canEdit&&<div className={s.receiptForm}>
     <p>{cfg?.category_name||'Partida pendiente de configurar'}. Esta obligación utiliza presupuesto.</p>
     {!cfg?.centers.length&&<div className={s.notice}>Finanzas debe configurar el centro y la partida de esta empresa antes del envío. Puedes guardar los documentos como borrador.</div>}
     <div className={s.grid}><label>Centro de costo<select value={center} disabled={busy} onChange={e=>setCenter(e.target.value)}><option value="">Selecciona un centro</option>{cfg?.centers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label>Mes presupuestal<input type="month" value={month} disabled={busy} onChange={e=>setMonth(e.target.value)}/></label></div>
    </div>}
    {context?.can_pay&&modal.status==='approved'&&<div className={s.receiptForm}><h3>Registrar el pago realizado</h3><p>Sube el comprobante bancario y revisa los datos leídos. Completa los que no se hayan identificado.</p>
     <label className={s.fullRow}>Comprobante PDF<input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{const files=e.target.files;void execute(()=>upload(files,true));e.target.value=''}}/></label>
     <div className={s.grid}><label>Importe pagado<input inputMode="decimal" value={amount} disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
     <label>Fecha de pago<input type="date" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label>
     <label>Referencia bancaria<input value={reference} maxLength={120} disabled={busy} onChange={e=>setReference(e.target.value)}/></label></div>
    </div>}
    {modal.status==='paid'&&<div className={`${s.inlineNotice} ${s.stateSuccess}`}>Pago registrado el {modal.payment_date}. El comprobante está disponible para descargar.</div>}
    {(canEdit||(context?.can_pay&&['submitted','approved'].includes(modal.status)))&&<button className={s.secondaryBtn} disabled={busy} onClick={()=>{if(window.confirm('¿Cancelar esta solicitud? Se liberará su reserva presupuestal.'))void execute(()=>transition('cancel'))}}>Cancelar solicitud</button>}
   </div>
  </Modal>}
 </>
}
