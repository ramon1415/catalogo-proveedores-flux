;(function payrollShadowUxPolish(){
  'use strict';
  if(window.__fluxPayrollShadowUxPolishLoaded)return;
  window.__fluxPayrollShadowUxPolishLoaded=true;

  const FINANCE_ROLES=['finance','finanzas','treasury','tesoreria','administracion'];
  const state={observer:null,timer:null,metaLoadedFor:null,metaLoadingFor:null,lineCount:null,channelCount:null,retryTimer:null};

  onReady(init);

  function onReady(callback){
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',callback,{once:true});
    else callback();
  }

  async function init(){
    if((location.pathname.split('/').pop()||'').toLowerCase()!=='solicitudes.html')return;
    if(window.FluxAuth?.ready)await window.FluxAuth.ready();
    if(!hasFinanceRole())return;
    await waitForElement('requestType');
    await waitForElement('payrollCaptureSection');
    injectStyles();
    ensureSummaryShell();
    document.addEventListener('change',handleChange,true);
    state.observer=new MutationObserver(scheduleSync);
    state.observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class'],characterData:true});
    schedulePulse();
  }

  function hasFinanceRole(){
    const roles=window.FluxAuth?.getRoles?.()||[];
    return roles.map(role=>String(role).toLowerCase()).some(role=>FINANCE_ROLES.includes(role));
  }

  function client(){return window.supabaseClient||window.getFluxSupabaseClient?.()||null;}

  function handleChange(event){
    const id=event.target?.id||'';
    if(id==='payrollDraftSelect')resetMeta();
    if(['requestType','payrollDraftSelect','payrollCompanyScopeSelect'].includes(id))schedulePulse();
  }

  function resetMeta(){
    state.metaLoadedFor=null;
    state.metaLoadingFor=null;
    state.lineCount=null;
    state.channelCount=null;
    clearTimeout(state.retryTimer);
  }

  function schedulePulse(){
    [0,120,360,800,1600].forEach(delay=>window.setTimeout(scheduleSync,delay));
  }

  function scheduleSync(){
    clearTimeout(state.timer);
    state.timer=setTimeout(syncAll,60);
  }

  function syncAll(){
    const payroll=document.getElementById('requestType')?.value==='nomina';
    const materialized=payroll&&isMaterializedView();
    syncCompanyScope(payroll);
    syncMaterializedFooter(materialized);
    syncClassificationContext(materialized);
    if(!payroll)return;
    ensureSummaryShell();
    syncFileStates();
    syncSummary(materialized);
  }

  function isMaterializedView(){
    const summary=document.getElementById('payrollSubmissionSummary');
    if(summary&&!summary.classList.contains('hidden'))return true;
    if(/materializada/i.test(document.getElementById('payrollCaptureState')?.textContent||''))return true;
    const selected=document.getElementById('payrollDraftSelect')?.selectedOptions?.[0]?.textContent||'';
    return /materializada/i.test(selected);
  }

  function syncCompanyScope(payroll){
    const source=document.getElementById('companyId');
    const bridge=document.getElementById('payrollCompanyScopeBridge');
    const baseSection=source?.closest('.form-section');
    if(baseSection)baseSection.classList.toggle('payroll-shadow-base-context-hidden',Boolean(payroll&&bridge));
    if(!bridge)return;
    const hint=bridge.querySelector('.field-hint');
    const copy='Empresa de la corrida. Se captura una sola vez aquí; cuenta origen y centro de costo heredan esta selección.';
    if(hint&&hint.textContent!==copy)hint.textContent=copy;
  }

  function syncClassificationContext(materialized){
    const dialog=document.getElementById('requestDialog');
    if(!dialog)return;
    const headings=Array.from(dialog.querySelectorAll('h2,h3,h4')).filter(el=>/^clasificaci[oó]n presupuestal$/i.test((el.textContent||'').trim()));
    headings.forEach(heading=>{
      const section=heading.closest('.form-section')||heading.parentElement;
      if(!section)return;
      const labels=Array.from(section.querySelectorAll('label'));
      const companyLabel=labels.find(label=>/^empresa\b/i.test((label.textContent||'').trim())&&label.querySelector('select'))||null;
      companyLabel?.classList.toggle('payroll-shadow-budget-company-hidden',materialized);
      let card=section.querySelector('#payrollShadowBudgetCompanyContext');
      if(!materialized){card?.remove();return;}
      if(!card){
        card=document.createElement('div');
        card.id='payrollShadowBudgetCompanyContext';
        card.className='payroll-shadow-inherited-company';
        const anchor=companyLabel||heading;
        anchor.insertAdjacentElement('afterend',card);
      }
      const name=currentCompanyLabel();
      card.innerHTML='<span>Empresa heredada de la corrida</span><strong>'+escapeHtml(name||'Empresa seleccionada')+'</strong><small>La empresa ya quedó fijada al materializar. Presupuesto reutiliza este contexto; no se vuelve a capturar aquí.</small>';
    });
  }

  function currentCompanyLabel(){
    const mirror=document.getElementById('payrollCompanyScopeSelect');
    const source=document.getElementById('companyId');
    const select=mirror||source;
    return (select?.selectedOptions?.[0]?.textContent||'').trim();
  }

  function syncMaterializedFooter(materialized){
    const dialog=document.getElementById('requestDialog');
    const save=document.getElementById('submitRequestBtn');
    const materialize=document.getElementById('payrollMaterializeBtn');
    save?.classList.toggle('payroll-shadow-materialized-action-hidden',materialized);
    materialize?.classList.toggle('payroll-shadow-materialized-action-hidden',materialized);
    let badge=dialog?.querySelector('#payrollShadowMaterializedFooter');
    if(!materialized){badge?.remove();return;}
    if(!badge&&dialog){
      const actions=save?.closest('.modal-actions')||materialize?.closest('.modal-actions');
      if(actions){
        badge=document.createElement('div');
        badge.id='payrollShadowMaterializedFooter';
        badge.className='payroll-shadow-materialized-footer';
        badge.innerHTML='<strong>Materializada · solo lectura</strong><span>La captura está congelada. Crea una nueva captura para iniciar otra corrida.</span>';
        const cancel=actions.querySelector('button[type="button"]');
        if(cancel)cancel.insertAdjacentElement('afterend',badge);else actions.prepend(badge);
      }
    }
  }

  function syncFileStates(){
    document.querySelectorAll('[data-payroll-status]').forEach(target=>{
      const badge=target.querySelector('.payroll-state');
      const detail=target.querySelector('small');
      if(!badge)return;
      const label=badge.textContent.trim();
      if(label==='Archivo privado recibido'){
        badge.textContent='Pendiente de validación server-side';
        badge.classList.remove('success');
        badge.classList.add('warning');
        if(detail){
          const diagnostic=/Diagnóstico local PASS/i.test(detail.textContent||'');
          detail.textContent=diagnostic
            ? 'Archivo privado recibido · diagnóstico local PASS · servidor pendiente'
            : 'Archivo privado recibido · servidor pendiente';
        }
      }else if(label==='Verificado en servidor'){
        badge.textContent='Verificado por servidor';
        badge.classList.remove('warning');
        badge.classList.add('success');
        if(detail)detail.textContent='SHA-256, formato y contenido validados; evidencia vinculada a la corrida.';
      }else if(label==='Listo para subir'){
        badge.textContent='Listo para guardar';
        if(detail)detail.textContent='Se almacenará en privado; la validación server-side ocurre después.';
      }
    });
  }

  function ensureSummaryShell(){
    const summary=document.getElementById('payrollSubmissionSummary');
    if(!summary)return;
    if(!document.getElementById('payrollShadowDraftNotice')){
      summary.insertAdjacentHTML('afterbegin',`
        <div id="payrollShadowDraftNotice" class="payroll-shadow-draft-notice hidden" role="status" aria-live="polite">
          <strong>Borrador — no enviado a aprobación ni pago</strong>
          <span>La materialización verificó la corrida y creó una solicitud en borrador; no ejecuta pagos ni la envía por sí sola.</span>
        </div>
        <div id="payrollShadowRunSummary" class="payroll-shadow-run-summary">
          <strong>Corrida verificada por servidor</strong>
          <span id="payrollShadowRunMeta">Cargando resumen materializado…</span>
        </div>`);
    }
    const metrics=summary.querySelector('.payroll-n3g-metrics');
    if(metrics&&!document.getElementById('payrollShadowEmployeeCount')){
      metrics.insertAdjacentHTML('afterbegin',`
        <div class="payroll-n3g-metric"><span>Empleados</span><strong id="payrollShadowEmployeeCount">—</strong></div>
        <div class="payroll-n3g-metric"><span>Canales</span><strong id="payrollShadowChannelCount">—</strong></div>`);
    }
    document.getElementById('payrollVarianceReview')?.setAttribute('role','alert');
  }

  function syncSummary(materialized){
    const summary=document.getElementById('payrollSubmissionSummary');
    if(!summary||summary.classList.contains('hidden'))return;

    const submissionText=(document.getElementById('payrollSubmissionState')?.textContent||'').trim();
    const isDraft=materialized&&(!/^Estado de solicitud:/i.test(submissionText)||/draft/i.test(submissionText));
    document.getElementById('payrollShadowDraftNotice')?.classList.toggle('hidden',!isDraft);

    const renderedChannels=document.querySelectorAll('#payrollChannelSummary .payroll-n3g-channel').length;
    const channels=Number.isInteger(state.channelCount)?state.channelCount:renderedChannels;
    const channelCount=document.getElementById('payrollShadowChannelCount');
    if(channelCount)channelCount.textContent=channels>0?String(channels):'—';
    const employeeCount=document.getElementById('payrollShadowEmployeeCount');
    if(employeeCount)employeeCount.textContent=Number.isInteger(state.lineCount)?String(state.lineCount):'—';
    syncRunMeta(channels);
    syncVarianceTitle();
    refreshSessionMeta();
    if((!Number.isInteger(state.lineCount)||channels===0)&&materialized)scheduleMetaRetry();
  }

  function syncRunMeta(channels){
    const target=document.getElementById('payrollShadowRunMeta');
    if(!target)return;
    const treasury=(document.getElementById('payrollTreasuryTotal')?.textContent||'').trim();
    const parts=[];
    if(Number.isInteger(state.lineCount))parts.push(state.lineCount+' empleados');
    if(channels>0)parts.push(channels+' canales');
    if(treasury&&treasury!=='—')parts.push(treasury+' Tesorería');
    target.textContent=parts.length?parts.join(' · '):'Resumen materializado pendiente de lectura visual.';
  }

  function syncVarianceTitle(){
    const review=document.getElementById('payrollVarianceReview');
    if(!review||review.classList.contains('hidden'))return;
    const title=review.querySelector('strong');
    const copy=(document.getElementById('payrollVarianceCopy')?.textContent||'').trim();
    if(!title)return;
    const match=copy.match(/diferencia\s+([^·.]+(?:\.[0-9]{2})?)/i);
    const amount=match?.[1]?.trim().replace(/\.$/,'')||'';
    const next=amount
      ? 'TOKA presenta diferencia de '+amount+' — requiere revisión de Finanzas'
      : 'TOKA presenta una diferencia — requiere revisión de Finanzas';
    if(title.textContent!==next)title.textContent=next;
  }

  async function refreshSessionMeta(){
    const sessionId=document.getElementById('payrollDraftSelect')?.value||'';
    if(!isUuid(sessionId)||state.metaLoadedFor===sessionId||state.metaLoadingFor===sessionId)return;
    const c=client();
    if(!c){scheduleMetaRetry();return;}
    state.metaLoadingFor=sessionId;
    try{
      const result=await c.rpc('get_payroll_capture_sessions',{p_session_id:sessionId});
      if(result.error)throw result.error;
      const session=Array.isArray(result.data)?result.data.find(item=>item.id===sessionId):null;
      const count=Number(session?.server_verification_summary?.line_count);
      state.lineCount=Number.isInteger(count)&&count>=0?count:null;
      const expectedChannels=Array.isArray(session?.expected_channels)?session.expected_channels.length:null;
      state.channelCount=Number.isInteger(expectedChannels)&&expectedChannels>0?expectedChannels:null;
      if(Number.isInteger(state.lineCount))state.metaLoadedFor=sessionId;
      const employeeCount=document.getElementById('payrollShadowEmployeeCount');
      if(employeeCount)employeeCount.textContent=Number.isInteger(state.lineCount)?String(state.lineCount):'—';
      const renderedChannels=document.querySelectorAll('#payrollChannelSummary .payroll-n3g-channel').length;
      const channels=Number.isInteger(state.channelCount)?state.channelCount:renderedChannels;
      const channelCount=document.getElementById('payrollShadowChannelCount');
      if(channelCount)channelCount.textContent=channels>0?String(channels):'—';
      syncRunMeta(channels);
      syncVarianceTitle();
    }catch(_){
      state.lineCount=null;
      state.channelCount=null;
      state.metaLoadedFor=null;
      scheduleMetaRetry();
    }finally{
      state.metaLoadingFor=null;
    }
  }

  function scheduleMetaRetry(){
    clearTimeout(state.retryTimer);
    state.retryTimer=setTimeout(scheduleSync,450);
  }

  function injectStyles(){
    if(document.getElementById('payrollShadowUxPolishStyle'))return;
    const style=document.createElement('style');
    style.id='payrollShadowUxPolishStyle';
    style.textContent=`
      .payroll-shadow-base-context-hidden{display:none!important}
      .payroll-shadow-budget-company-hidden{display:none!important}
      .payroll-shadow-materialized-action-hidden{display:none!important}
      .payroll-shadow-draft-notice{display:flex;flex-direction:column;gap:3px;margin-bottom:10px;padding:11px 12px;border:1px solid rgba(245,158,11,.32);border-radius:10px;background:var(--amber-dim)}
      .payroll-shadow-draft-notice.hidden{display:none}
      .payroll-shadow-draft-notice strong{font-size:12px;color:var(--text-1)}
      .payroll-shadow-draft-notice span{font-size:11px;line-height:1.45;color:var(--text-3)}
      .payroll-shadow-run-summary{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-input)}
      .payroll-shadow-run-summary strong{font-size:12px;color:var(--text-1)}
      .payroll-shadow-run-summary span{font-size:11px;color:var(--text-3);text-align:right}
      .payroll-shadow-inherited-company{display:flex;flex-direction:column;gap:3px;margin-top:8px;padding:11px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-input)}
      .payroll-shadow-inherited-company span{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.35px;color:var(--text-3)}
      .payroll-shadow-inherited-company strong{font-size:13px;color:var(--text-1)}
      .payroll-shadow-inherited-company small{font-size:11px;line-height:1.45;color:var(--text-3)}
      .payroll-shadow-materialized-footer{display:flex;flex-direction:column;gap:2px;margin-right:auto;padding:7px 10px;border:1px solid rgba(18,183,106,.28);border-radius:9px;background:var(--emerald-dim)}
      .payroll-shadow-materialized-footer strong{font-size:11px;color:var(--text-1)}
      .payroll-shadow-materialized-footer span{font-size:10px;color:var(--text-3)}
      #payrollSubmissionSummary .payroll-n3g-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}
      #payrollVarianceReview>strong{display:block;margin-bottom:4px}
      @media(max-width:980px){#payrollSubmissionSummary .payroll-n3g-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:720px){.payroll-shadow-run-summary{align-items:flex-start;flex-direction:column}.payroll-shadow-run-summary span{text-align:left}#payrollSubmissionSummary .payroll-n3g-metrics{grid-template-columns:1fr}.payroll-shadow-materialized-footer{width:100%;order:-1}}
    `;
    document.head.appendChild(style);
  }

  function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
  function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

  function waitForElement(id){
    const existing=document.getElementById(id);
    if(existing)return Promise.resolve(existing);
    return new Promise(resolve=>{
      const observer=new MutationObserver(()=>{
        const element=document.getElementById(id);
        if(!element)return;
        observer.disconnect();
        resolve(element);
      });
      observer.observe(document.documentElement,{childList:true,subtree:true});
    });
  }
})();
