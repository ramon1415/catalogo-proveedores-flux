(function () {
  'use strict';
  if (window.__fluxPayrollReconciliationN4BLoaded) return;
  window.__fluxPayrollReconciliationN4BLoaded = true;

  const FINANCE_ROLES = ['finance','finanzas','treasury','tesoreria','administracion'];
  const state = { queue:[], summary:null, selectedRequestId:null, saving:false };
  const dom = {};
  onReady(init);

  function onReady(callback){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',callback,{once:true}); else callback(); }
  function getClient(){
    if(typeof window.getFluxSupabaseClient==='function') return window.getFluxSupabaseClient();
    if(window.supabaseClient) return window.supabaseClient;
    if(window.supabase && typeof window.SUPABASE_URL!=='undefined' && typeof window.SUPABASE_ANON_KEY!=='undefined'){
      window.supabaseClient=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY); return window.supabaseClient;
    }
    return null;
  }
  function hasFinanceRole(){ const roles=window.FluxAuth?.getRoles?.()||[]; return roles.map(r=>String(r).toLowerCase()).some(r=>FINANCE_ROLES.includes(r)); }

  async function init(){
    if((window.location.pathname.split('/').pop()||'').toLowerCase()!=='nomina_reconciliacion.html') return;
    dom.queue=document.getElementById('payrollReconciliationQueue'); dom.detail=document.getElementById('payrollReconciliationDetail'); dom.refresh=document.getElementById('payrollReconciliationRefresh'); dom.message=document.getElementById('payrollReconciliationMessage');
    dom.refresh?.addEventListener('click',loadQueue); dom.queue?.addEventListener('click',handleQueueClick); dom.detail?.addEventListener('click',handleDetailClick);
    if(window.FluxAuth?.ready) await window.FluxAuth.ready();
    const session=window.FluxAuth?.state?.session;
    if(!session){ window.location.href='./index.html'; return; }
    if(!hasFinanceRole()){ dom.queue.innerHTML='<div class="n4b-empty">Esta pantalla es exclusiva de Finanzas.</div>'; dom.detail.innerHTML='<div class="n4b-empty">No tienes el rol requerido.</div>'; dom.refresh.disabled=true; return; }
    await loadQueue();
  }

  async function loadQueue(){
    const client=getClient(); if(!client) return setMessage('No se encontró la conexión a Supabase.','error');
    dom.refresh.disabled=true; setMessage('Cargando Nóminas dispersadas…','neutral');
    try{
      const result=await client.rpc('get_payroll_reconciliation_queue'); if(result.error) throw result.error;
      state.queue=Array.isArray(result.data)?result.data:[]; renderQueue();
      if(state.selectedRequestId && state.queue.some(r=>r.payment_request_id===state.selectedRequestId)) await loadSummary(state.selectedRequestId);
      else if(state.queue.length) await loadSummary(state.queue[0].payment_request_id);
      else { state.selectedRequestId=null; state.summary=null; renderDetail(); }
      setMessage(state.queue.length?'Lista actualizada.':'No hay Nóminas listas para conciliación.','success');
    }catch(error){ setMessage(friendlyError(error),'error'); }
    finally{ dom.refresh.disabled=false; }
  }

  function renderQueue(){
    if(!state.queue.length){ dom.queue.innerHTML='<div class="n4b-empty">No hay corridas listas para conciliación.</div>'; return; }
    dom.queue.innerHTML=state.queue.map(row=>{
      const selected=row.payment_request_id===state.selectedRequestId?' selected':'';
      return '<button type="button" class="'+selected+'" data-request-id="'+escapeHtml(row.payment_request_id)+'"><strong>'+escapeHtml(row.request_number||'Nómina')+'</strong><span>'+escapeHtml(row.company_name||'Empresa')+'</span><span>'+escapeHtml(formatMoney(row.amount_requested,row.currency))+' · '+Number(row.reconciled_count||0)+'/'+Number(row.channel_count||0)+' conciliados</span></button>';
    }).join('');
  }

  async function handleQueueClick(event){ const button=event.target.closest('[data-request-id]'); if(button) await loadSummary(button.dataset.requestId); }
  async function loadSummary(requestId){
    const client=getClient(); if(!client||!requestId) return;
    state.selectedRequestId=requestId; state.summary=null; renderQueue(); dom.detail.innerHTML='<div class="n4b-empty">Cargando canales…</div>';
    const result=await client.rpc('get_payroll_reconciliation_summary',{p_payment_request_id:requestId});
    if(result.error){ dom.detail.innerHTML='<div class="n4b-empty">'+escapeHtml(friendlyError(result.error))+'</div>'; return; }
    state.summary=result.data; renderDetail();
  }

  function renderDetail(){
    const summary=state.summary; if(!summary){ dom.detail.innerHTML='<div class="n4b-empty">Selecciona una Nómina.</div>'; return; }
    const channels=Array.isArray(summary.channels)?summary.channels:[];
    dom.detail.innerHTML='<div class="n4b-head"><div><span class="n4b-eyebrow">Conciliación por canal</span><h2>'+escapeHtml(summary.request_number||'Nómina')+'</h2><div class="n4b-meta">'+escapeHtml(summary.company_name||'')+'</div></div>'+pill(summary.request_status==='paid'?'paid':'pending',summary.request_status==='paid'?'Pagada':'Aprobada')+'</div>'+
      '<div class="n4b-total"><span>Salida aprobada de Tesorería</span><strong>'+escapeHtml(formatMoney(summary.amount_requested,summary.currency))+'</strong></div>'+
      '<div class="n4b-warning">El PDF se valida por hash/MIME en servidor. Flux no usa OCR: Finanzas captura importe, fecha y referencia y el importe debe coincidir exactamente con el canal.</div>'+
      '<div class="n4b-list">'+channels.map(renderChannel).join('')+'</div>'+
      (summary.can_close_paid?'<div class="n4b-complete"><div><strong>Todos los canales están conciliados.</strong><div class="n4b-meta">El cierre sólo cambia la solicitud a Pagada; no ejecuta ninguna operación bancaria.</div></div><button type="button" class="primary-btn" data-close-paid="'+escapeHtml(summary.payment_request_id)+'">Cerrar como Pagada</button></div>':'');
  }

  function renderChannel(channel){
    const id=escapeHtml(channel.id); const reconciled=channel.reconciliation_status==='reconciled';
    if(reconciled){
      return '<article class="n4b-card"><div class="n4b-card-head"><div><strong>'+escapeHtml(channelLabel(channel.channel))+'</strong><span>'+escapeHtml(formatMoney(channel.amount,channel.currency))+'</span></div>'+pill('reconciled','Conciliado')+'</div><div class="n4b-meta">Fecha: '+escapeHtml(channel.receipt_payment_date||'—')+' · Referencia: '+escapeHtml(channel.reference_hint||'—')+'</div></article>';
    }
    return '<article class="n4b-card" data-channel-id="'+id+'"><div class="n4b-card-head"><div><strong>'+escapeHtml(channelLabel(channel.channel))+'</strong><span>'+escapeHtml(formatMoney(channel.amount,channel.currency))+'</span></div>'+pill('pending','Pendiente')+'</div><div class="n4b-form">'+
      '<label class="full">Comprobante PDF<input type="file" accept="application/pdf,.pdf" data-receipt-file="'+id+'"></label>'+
      '<label>Importe del comprobante<input type="number" step="0.01" min="0.01" inputmode="decimal" data-receipt-amount="'+id+'" placeholder="0.00"></label>'+
      '<label>Fecha de pago<input type="date" data-receipt-date="'+id+'"></label>'+
      '<label class="full">Referencia bancaria<input type="text" maxlength="120" data-receipt-reference="'+id+'" placeholder="Captura la referencia del comprobante"></label>'+
      '</div><div class="n4b-form-actions"><button type="button" class="primary-btn" data-reconcile-channel="'+id+'">Verificar y conciliar</button></div></article>';
  }

  async function handleDetailClick(event){
    const reconcile=event.target.closest('[data-reconcile-channel]'); if(reconcile){ await reconcileChannel(reconcile.dataset.reconcileChannel); return; }
    const close=event.target.closest('[data-close-paid]'); if(close) await closePaid(close.dataset.closePaid);
  }

  async function reconcileChannel(channelId){
    if(state.saving||!state.summary) return; const client=getClient(); if(!client) return;
    const file=dom.detail.querySelector('[data-receipt-file="'+cssEscape(channelId)+'"]')?.files?.[0];
    const amountText=dom.detail.querySelector('[data-receipt-amount="'+cssEscape(channelId)+'"]')?.value||'';
    const paymentDate=dom.detail.querySelector('[data-receipt-date="'+cssEscape(channelId)+'"]')?.value||'';
    const reference=dom.detail.querySelector('[data-receipt-reference="'+cssEscape(channelId)+'"]')?.value.trim()||'';
    if(!file) return setMessage('Selecciona el comprobante PDF.','warning');
    if(file.type!=='application/pdf' || file.size<100 || file.size>10485760) return setMessage('El comprobante debe ser PDF y pesar máximo 10 MB.','warning');
    const amount=Number(amountText); if(!Number.isFinite(amount)||amount<=0) return setMessage('Captura el importe del comprobante.','warning');
    if(!paymentDate) return setMessage('Captura la fecha de pago.','warning'); if(reference.length<3) return setMessage('Captura la referencia bancaria.','warning');

    state.saving=true; setControlsDisabled(true); setMessage('Verificando comprobante en servidor…','neutral');
    try{
      const sha=await sha256File(file);
      const reserved=await client.rpc('reserve_payroll_channel_receipt',{p_payment_request_id:state.summary.payment_request_id,p_payroll_channel_id:channelId,p_mime_type:'application/pdf',p_size_bytes:file.size,p_sha256:sha,p_original_filename:file.name});
      if(reserved.error) throw reserved.error;
      const upload=await client.storage.from(reserved.data.storage_bucket).upload(reserved.data.storage_path,file,{contentType:'application/pdf',upsert:false}); if(upload.error) throw upload.error;
      const verified=await client.functions.invoke('payroll-receipt-verify',{body:{run_file_id:reserved.data.run_file_id}}); if(verified.error) throw verified.error;
      const reconciled=await client.rpc('reconcile_payroll_channel',{p_payment_request_id:state.summary.payment_request_id,p_payroll_channel_id:channelId,p_receipt_file_id:reserved.data.run_file_id,p_receipt_amount:amount,p_payment_date:paymentDate,p_reference_hint:reference});
      if(reconciled.error) throw reconciled.error;
      state.summary=reconciled.data.summary; renderDetail(); await refreshQueueOnly(); setMessage('Canal conciliado correctamente.','success');
    }catch(error){ setMessage(friendlyError(error),'error'); }
    finally{ state.saving=false; setControlsDisabled(false); }
  }

  async function closePaid(requestId){
    if(state.saving||!requestId) return; if(!window.confirm('Confirma el cierre final. Flux sólo registrará la Nómina como Pagada; no ejecutará ningún pago.')) return;
    const client=getClient(); state.saving=true; setControlsDisabled(true);
    try{ const result=await client.rpc('close_payroll_as_paid',{p_payment_request_id:requestId}); if(result.error) throw result.error; setMessage('Nómina cerrada como Pagada.','success'); state.selectedRequestId=null; state.summary=null; await loadQueue(); }
    catch(error){ setMessage(friendlyError(error),'error'); }
    finally{ state.saving=false; setControlsDisabled(false); }
  }

  async function refreshQueueOnly(){ const client=getClient(); const result=await client.rpc('get_payroll_reconciliation_queue'); if(!result.error){ state.queue=Array.isArray(result.data)?result.data:[]; renderQueue(); } }
  async function sha256File(file){ const bytes=new Uint8Array(await file.arrayBuffer()); const digest=await crypto.subtle.digest('SHA-256',bytes); return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join(''); }
  function setControlsDisabled(disabled){ dom.detail?.querySelectorAll('button,input').forEach(c=>c.disabled=disabled); }
  function pill(kind,label){ return '<span class="n4b-pill '+escapeHtml(kind)+'">'+escapeHtml(label)+'</span>'; }
  function channelLabel(channel){ return ({banco:'BBVA mismo banco',spei:'SPEI',vales:'TOKA / vales'})[channel]||channel||'Canal'; }
  function formatMoney(value,currency){ const number=Number(value); return Number.isFinite(number)?new Intl.NumberFormat('es-MX',{style:'currency',currency:currency||'MXN'}).format(number):'—'; }
  function setMessage(message,variant){ if(!dom.message)return; dom.message.textContent=message||''; dom.message.dataset.variant=variant||'neutral'; }
  function friendlyError(error){ const message=String(error?.message||error||'Error inesperado.'); const map={PAYROLL_FINANCE_REQUIRED:'La conciliación es exclusiva de Finanzas.',PAYROLL_RECEIPT_REQUIRES_DISPERSED_CHANNEL:'Primero registra la dispersión del canal.',PAYROLL_RECEIPT_PDF_REQUIRED:'El comprobante debe ser PDF.',PAYROLL_RECEIPT_HASH_MISMATCH:'El archivo subido no coincide con el hash reservado.',PAYROLL_RECEIPT_PDF_INVALID:'El archivo no es un PDF válido.',PAYROLL_RECONCILIATION_AMOUNT_MISMATCH:'El importe del comprobante no coincide con el importe del canal.',PAYROLL_RECONCILIATION_VERIFIED_RECEIPT_REQUIRED:'El comprobante todavía no está verificado por el servidor.',PAYROLL_PAID_RECONCILIATION_REQUIRED:'Todos los canales deben estar dispersados y conciliados antes del cierre.'}; const key=Object.keys(map).find(k=>message.includes(k)); return key?map[key]:message; }
  function escapeHtml(value){ return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function cssEscape(value){ return String(value||'').replace(/[^a-zA-Z0-9_-]/g,c=>'\\'+c); }
})();
