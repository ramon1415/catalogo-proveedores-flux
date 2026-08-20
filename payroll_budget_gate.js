;(function payrollBudgetGateN5A(){
  'use strict';
  if(window.__fluxPayrollBudgetGateN5ALoaded)return;window.__fluxPayrollBudgetGateN5ALoaded=true;

  const FINANCE_ROLES=['finance','finanzas','treasury','tesoreria','administracion'];
  const state={queue:[],selectedRequestId:null,summary:null,options:[],saving:false};
  const dom={};
  onReady(init);

  function onReady(callback){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',callback,{once:true});else callback();}
  function client(){if(window.supabaseClient)return window.supabaseClient;if(window.supabase&&typeof SUPABASE_URL!=='undefined'&&typeof SUPABASE_ANON_KEY!=='undefined'){window.supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);return window.supabaseClient;}return null;}
  function hasFinanceRole(){const roles=window.FluxAuth?.getRoles?.()||[];return roles.map(r=>String(r).toLowerCase()).some(r=>FINANCE_ROLES.includes(r));}

  async function init(){
    if((location.pathname.split('/').pop()||'').toLowerCase()!=='nomina_presupuesto.html')return;
    dom.queue=document.getElementById('payrollBudgetQueue');dom.detail=document.getElementById('payrollBudgetDetail');dom.message=document.getElementById('payrollBudgetMessage');dom.refresh=document.getElementById('payrollBudgetRefresh');
    dom.refresh?.addEventListener('click',loadQueue);dom.queue?.addEventListener('click',handleQueueClick);dom.detail?.addEventListener('change',handleDetailChange);dom.detail?.addEventListener('click',handleDetailClick);
    if(window.FluxAuth?.ready)await window.FluxAuth.ready();
    const session=window.FluxAuth?.state?.session;if(!session){location.href='./index.html';return;}
    if(!hasFinanceRole()){dom.queue.innerHTML='<div class="n5a-empty">Esta pantalla es exclusiva de Finanzas.</div>';dom.detail.innerHTML='<div class="n5a-empty">No tienes el rol requerido.</div>';dom.refresh.disabled=true;return;}
    await loadQueue();
  }

  async function loadQueue(){
    const c=client();if(!c)return setMessage('No se encontró la conexión a Supabase.','error');
    dom.refresh.disabled=true;setMessage('Cargando Nóminas materializadas…','neutral');
    try{const result=await c.rpc('get_payroll_budget_queue');if(result.error)throw result.error;state.queue=Array.isArray(result.data)?result.data:[];renderQueue();
      if(state.selectedRequestId&&state.queue.some(r=>r.payment_request_id===state.selectedRequestId))await loadDetail(state.selectedRequestId);else if(state.queue.length)await loadDetail(state.queue[0].payment_request_id);else{state.selectedRequestId=null;state.summary=null;renderEmptyDetail();}
      setMessage(state.queue.length?'Lista actualizada.':'No hay Nóminas materializadas pendientes de presupuesto.',state.queue.length?'success':'neutral');
    }catch(error){setMessage(friendlyError(error),'error');}finally{dom.refresh.disabled=false;}
  }

  function renderQueue(){
    if(!state.queue.length){dom.queue.innerHTML='<div class="n5a-empty">No hay borradores materializados.</div>';return;}
    dom.queue.innerHTML=state.queue.map(row=>{
      const selected=row.payment_request_id===state.selectedRequestId?' selected':'';const decision=row.budget_decision||'not_checked';
      return '<button type="button" class="'+selected+'" data-request-id="'+escapeHtml(row.payment_request_id)+'"><strong>'+escapeHtml(row.request_number||'Nómina')+'</strong><span>'+escapeHtml(row.company_name||'')+' · '+escapeHtml(row.cost_center_name||'')+'</span><span>'+escapeHtml(formatMoney(row.amount_requested,row.currency))+' · '+escapeHtml(decisionLabel(decision))+'</span></button>';
    }).join('');
  }
  async function handleQueueClick(event){const button=event.target.closest('[data-request-id]');if(button)await loadDetail(button.dataset.requestId);}

  async function loadDetail(requestId){
    const c=client();if(!c||!requestId)return;state.selectedRequestId=requestId;renderQueue();dom.detail.innerHTML='<div class="n5a-empty">Cargando presupuesto…</div>';
    const summary=await c.rpc('get_payroll_submission_summary',{p_payment_request_id:requestId});if(summary.error){dom.detail.innerHTML='<div class="n5a-empty">'+escapeHtml(friendlyError(summary.error))+'</div>';return;}
    state.summary=summary.data;const month=monthValue(state.summary.budget_month||state.summary.period_start||new Date().toISOString().slice(0,10));await loadOptions(month);renderDetail(month);
  }

  async function loadOptions(month){
    const c=client();state.options=[];if(!c||!state.selectedRequestId||!month)return;
    const result=await c.rpc('get_payroll_budget_context_options',{p_payment_request_id:state.selectedRequestId,p_budget_month:month+'-01'});if(result.error){setMessage(friendlyError(result.error),'error');return;}state.options=Array.isArray(result.data)?result.data:[];
  }

  function renderDetail(month){
    const s=state.summary;if(!s)return renderEmptyDetail();const currentCategory=s.budget_category_id||'';
    dom.detail.innerHTML='<div class="n5a-head"><div><span class="n5a-eyebrow">Contexto presupuestal</span><h2>'+escapeHtml(state.queue.find(r=>r.payment_request_id===s.payment_request_id)?.request_number||'Nómina')+'</h2><p>'+escapeHtml(formatPeriod(s.period_start,s.period_end))+'</p></div><strong>'+escapeHtml(decisionLabel(s.budget_decision||'not_checked'))+'</strong></div>'+
      '<div class="n5a-total"><span>Salida de Tesorería a presupuestar</span><strong>'+escapeHtml(formatMoney(s.amount_requested,s.currency))+'</strong></div>'+
      '<div class="n5a-warning">Esta validación usa budget_lines y budget_availability existentes. No calcula Nómina ni genera porcentajes de provisión. El submit vuelve a validar bajo lock para evitar sobrecomprometer la misma partida.</div>'+
      '<div class="n5a-form">'+
        '<label>Mes presupuestal<input id="n5aBudgetMonth" type="month" value="'+escapeHtml(month)+'"></label>'+
        '<label>Partida<select id="n5aBudgetCategory"><option value="">Selecciona partida</option>'+state.options.map(o=>'<option value="'+escapeHtml(o.budget_category_id)+'" '+(o.budget_category_id===currentCategory?'selected':'')+'>'+escapeHtml((o.code||'')+' · '+(o.name||''))+'</option>').join('')+'</select></label>'+
        '<div id="n5aBudgetPreview" class="n5a-option-preview"></div>'+
        '<div class="n5a-form-actions"><button type="button" class="secondary-btn" data-n5a-action="refresh" '+(!s.budget_category_id||!s.budget_month?'disabled':'')+'>Revalidar contexto guardado</button><button type="button" class="primary-btn" data-n5a-action="save">Guardar y validar</button></div>'+
      '</div>'+renderSnapshot(s);
    renderOptionPreview();
  }

  function renderOptionPreview(){
    const target=document.getElementById('n5aBudgetPreview'),select=document.getElementById('n5aBudgetCategory');if(!target||!select)return;const option=state.options.find(o=>o.budget_category_id===select.value);
    if(!option){target.innerHTML='<div class="n5a-kpi" style="grid-column:1/-1"><span>Partida</span><strong>Selecciona una partida para revisar disponibilidad.</strong></div>';return;}
    target.innerHTML=kpi('Presupuestado',formatMoney(option.budgeted,'MXN'))+kpi('Comprometido',formatMoney(option.committed,'MXN'))+kpi('Ejecutado',formatMoney(option.executed,'MXN'))+kpi('Disponible',formatMoney(option.available,'MXN'));
  }
  function kpi(label,value){return '<div class="n5a-kpi"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>';}
  function renderSnapshot(s){const decision=s.budget_decision||'not_checked';const detail=decision==='aprobable'?'Presupuesto disponible. Regresa a Solicitudes para completar la revisión TOKA y enviar al aprobador.':decision==='bloqueado'?'Presupuesto bloqueado'+(s.budget_block_reason?': '+escapeHtml(s.budget_block_reason):'.'):'Aún no existe una validación presupuestal para esta Nómina.';return '<div class="n5a-status '+escapeHtml(decision)+'"><strong>'+escapeHtml(decisionLabel(decision))+'</strong><br>'+detail+(s.budget_checked_at?'<br><small>Última validación: '+escapeHtml(formatDateTime(s.budget_checked_at))+'</small>':'')+'</div>';}

  async function handleDetailChange(event){if(event.target.id==='n5aBudgetMonth'){await loadOptions(event.target.value);const old=state.summary?.budget_category_id||'';const select=document.getElementById('n5aBudgetCategory');if(select){select.innerHTML='<option value="">Selecciona partida</option>'+state.options.map(o=>'<option value="'+escapeHtml(o.budget_category_id)+'" '+(o.budget_category_id===old?'selected':'')+'>'+escapeHtml((o.code||'')+' · '+(o.name||''))+'</option>').join('');}renderOptionPreview();}else if(event.target.id==='n5aBudgetCategory')renderOptionPreview();}
  async function handleDetailClick(event){const button=event.target.closest('[data-n5a-action]');if(!button||state.saving)return;if(button.dataset.n5aAction==='save')await saveContext();if(button.dataset.n5aAction==='refresh')await refreshContext();}

  async function saveContext(){
    const month=document.getElementById('n5aBudgetMonth')?.value||'',category=document.getElementById('n5aBudgetCategory')?.value||'';if(!month||!category)return setMessage('Selecciona mes y partida.','warning');
    const c=client();state.saving=true;disableActions(true);setMessage('Validando presupuesto…','neutral');
    try{const result=await c.rpc('set_payroll_budget_context',{p_payment_request_id:state.selectedRequestId,p_budget_category_id:category,p_budget_month:month+'-01'});if(result.error)throw result.error;await reloadCurrent();const status=result.data?.status||state.summary?.budget_decision;setMessage(status==='aprobable'?'Presupuesto aprobable. La Nómina ya puede continuar a aprobación.':'La Nómina quedó bloqueada por presupuesto.',status==='aprobable'?'success':'warning');}
    catch(error){setMessage(friendlyError(error),'error');}finally{state.saving=false;disableActions(false);}
  }
  async function refreshContext(){const c=client();state.saving=true;disableActions(true);setMessage('Revalidando presupuesto…','neutral');try{const result=await c.rpc('refresh_payroll_budget_validation',{p_payment_request_id:state.selectedRequestId});if(result.error)throw result.error;await reloadCurrent();setMessage(result.data?.status==='aprobable'?'Presupuesto vigente y aprobable.':'La disponibilidad vigente bloquea esta Nómina.',result.data?.status==='aprobable'?'success':'warning');}catch(error){setMessage(friendlyError(error),'error');}finally{state.saving=false;disableActions(false);}}
  async function reloadCurrent(){const requestId=state.selectedRequestId;const c=client();const queue=await c.rpc('get_payroll_budget_queue');if(!queue.error)state.queue=Array.isArray(queue.data)?queue.data:[];renderQueue();await loadDetail(requestId);}

  function disableActions(value){dom.detail?.querySelectorAll('button,input,select').forEach(el=>el.disabled=value);}
  function renderEmptyDetail(){dom.detail.innerHTML='<div class="n5a-empty">Selecciona una Nómina materializada para configurar su presupuesto.</div>';}
  function setMessage(text,variant){dom.message.textContent=text||'';dom.message.dataset.variant=variant||'neutral';}
  function decisionLabel(value){return({aprobable:'Aprobable',bloqueado:'Bloqueado',not_checked:'Sin validar'})[value]||value||'Sin validar';}
  function monthValue(value){const text=String(value||'');return /^\d{4}-\d{2}/.test(text)?text.slice(0,7):new Date().toISOString().slice(0,7);}
  function formatPeriod(start,end){return [start||'—',end||'—'].join(' → ');}
  function formatMoney(value,currency='MXN'){const n=Number(value);return Number.isFinite(n)?new Intl.NumberFormat('es-MX',{style:'currency',currency:currency||'MXN'}).format(n):'—';}
  function formatDateTime(value){const date=new Date(value);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('es-MX',{dateStyle:'medium',timeStyle:'short'}).format(date);}
  function friendlyError(error){const message=String(error?.message||error||'Error inesperado.');const map={PAYROLL_FINANCE_REQUIRED:'Esta operación es exclusiva de Finanzas.',PAYROLL_BUDGET_CONTEXT_REQUIRED:'Selecciona mes y partida presupuestal.',PAYROLL_BUDGET_CATEGORY_NOT_ALLOWED:'La partida no está habilitada para la empresa y centro de costo.',PAYROLL_BUDGET_REQUESTER_REQUIRED:'Sólo quien capturó esta Nómina puede administrar su presupuesto antes del envío.',PAYROLL_BUDGET_DRAFT_REQUIRED:'El presupuesto sólo puede cambiar mientras la Nómina está en borrador.',PAYROLL_BUDGET_COMPANY_MEMBERSHIP_REQUIRED:'No tienes acceso operativo a la empresa de esta Nómina.',PAYROLL_VALID_MATERIALIZATION_REQUIRED:'La Nómina debe estar materializada antes de validar presupuesto.'};const key=Object.keys(map).find(k=>message.includes(k));return key?map[key]:message;}
  function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
})();
