;(function payrollShadowUxPolish(){
  'use strict';
  if(window.__fluxPayrollShadowUxPolishLoaded)return;
  window.__fluxPayrollShadowUxPolishLoaded=true;

  const FINANCE_ROLES=['finance','finanzas','treasury','tesoreria','administracion'];
  const state={observer:null,timer:null,metaLoadedFor:null,lineCount:null};

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
    state.observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    scheduleSync();
  }

  function hasFinanceRole(){
    const roles=window.FluxAuth?.getRoles?.()||[];
    return roles.map(role=>String(role).toLowerCase()).some(role=>FINANCE_ROLES.includes(role));
  }

  function client(){return window.supabaseClient||window.getFluxSupabaseClient?.()||null;}

  function handleChange(event){
    const id=event.target?.id||'';
    if(id==='payrollDraftSelect'){
      state.metaLoadedFor=null;
      state.lineCount=null;
    }
    if(['requestType','payrollDraftSelect','payrollCompanyScopeSelect'].includes(id))scheduleSync();
  }

  function scheduleSync(){
    clearTimeout(state.timer);
    state.timer=setTimeout(syncAll,70);
  }

  function syncAll(){
    const payroll=document.getElementById('requestType')?.value==='nomina';
    syncCompanyScope(payroll);
    if(!payroll)return;
    ensureSummaryShell();
    syncFileStates();
    syncSummary();
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

  function syncSummary(){
    const summary=document.getElementById('payrollSubmissionSummary');
    if(!summary||summary.classList.contains('hidden'))return;

    const submissionText=(document.getElementById('payrollSubmissionState')?.textContent||'').trim();
    const isDraft=!/^Estado de solicitud:/i.test(submissionText)||/draft/i.test(submissionText);
    document.getElementById('payrollShadowDraftNotice')?.classList.toggle('hidden',!isDraft);

    const channels=document.querySelectorAll('#payrollChannelSummary .payroll-n3g-channel').length;
    const channelCount=document.getElementById('payrollShadowChannelCount');
    if(channelCount)channelCount.textContent=String(channels);
    const employeeCount=document.getElementById('payrollShadowEmployeeCount');
    if(employeeCount)employeeCount.textContent=Number.isInteger(state.lineCount)?String(state.lineCount):'—';
    syncRunMeta(channels);
    syncVarianceTitle();
    refreshSessionMeta();
  }

  function syncRunMeta(channels){
    const target=document.getElementById('payrollShadowRunMeta');
    if(!target)return;
    const treasury=(document.getElementById('payrollTreasuryTotal')?.textContent||'').trim();
    const parts=[];
    if(Number.isInteger(state.lineCount))parts.push(state.lineCount+' empleados');
    parts.push(channels+' canales');
    if(treasury&&treasury!=='—')parts.push(treasury+' Tesorería');
    target.textContent=parts.join(' · ');
  }

  function syncVarianceTitle(){
    const review=document.getElementById('payrollVarianceReview');
    if(!review||review.classList.contains('hidden'))return;
    const title=review.querySelector('strong');
    const copy=(document.getElementById('payrollVarianceCopy')?.textContent||'').trim();
    if(!title)return;
    const marker='diferencia ';
    const index=copy.toLowerCase().lastIndexOf(marker);
    const amount=index>=0?copy.slice(index+marker.length).trim().replace(/\.$/,''):'';
    const next=amount
      ? 'TOKA presenta diferencia de '+amount+' — requiere revisión de Finanzas'
      : 'TOKA presenta una diferencia — requiere revisión de Finanzas';
    if(title.textContent!==next)title.textContent=next;
  }

  async function refreshSessionMeta(){
    const sessionId=document.getElementById('payrollDraftSelect')?.value||'';
    if(!isUuid(sessionId)||state.metaLoadedFor===sessionId)return;
    state.metaLoadedFor=sessionId;
    const c=client();
    if(!c)return;
    try{
      const result=await c.rpc('get_payroll_capture_sessions',{p_session_id:sessionId});
      if(result.error)throw result.error;
      const session=Array.isArray(result.data)?result.data.find(item=>item.id===sessionId):null;
      const count=Number(session?.server_verification_summary?.line_count);
      state.lineCount=Number.isInteger(count)&&count>=0?count:null;
      const employeeCount=document.getElementById('payrollShadowEmployeeCount');
      if(employeeCount)employeeCount.textContent=Number.isInteger(state.lineCount)?String(state.lineCount):'—';
      const channels=document.querySelectorAll('#payrollChannelSummary .payroll-n3g-channel').length;
      syncRunMeta(channels);
    }catch(_){
      state.lineCount=null;
    }
  }

  function injectStyles(){
    if(document.getElementById('payrollShadowUxPolishStyle'))return;
    const style=document.createElement('style');
    style.id='payrollShadowUxPolishStyle';
    style.textContent=`
      .payroll-shadow-base-context-hidden{display:none!important}
      .payroll-shadow-draft-notice{display:flex;flex-direction:column;gap:3px;margin-bottom:10px;padding:11px 12px;border:1px solid rgba(245,158,11,.32);border-radius:10px;background:var(--amber-dim)}
      .payroll-shadow-draft-notice.hidden{display:none}
      .payroll-shadow-draft-notice strong{font-size:12px;color:var(--text-1)}
      .payroll-shadow-draft-notice span{font-size:11px;line-height:1.45;color:var(--text-3)}
      .payroll-shadow-run-summary{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:10px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg-input)}
      .payroll-shadow-run-summary strong{font-size:12px;color:var(--text-1)}
      .payroll-shadow-run-summary span{font-size:11px;color:var(--text-3);text-align:right}
      #payrollSubmissionSummary .payroll-n3g-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}
      #payrollVarianceReview>strong{display:block;margin-bottom:4px}
      @media(max-width:980px){#payrollSubmissionSummary .payroll-n3g-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:720px){.payroll-shadow-run-summary{align-items:flex-start;flex-direction:column}.payroll-shadow-run-summary span{text-align:left}#payrollSubmissionSummary .payroll-n3g-metrics{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}

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
