;(function payrollCompanyScopeFix(){
  'use strict';
  if(window.__fluxPayrollCompanyScopeFixLoaded)return;window.__fluxPayrollCompanyScopeFixLoaded=true;

  function onReady(cb){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cb,{once:true});else cb();}
  onReady(init);

  async function init(){
    if((location.pathname.split('/').pop()||'').toLowerCase()!=='solicitudes.html')return;
    if(window.FluxAuth?.ready)await window.FluxAuth.ready();
    const requestType=document.getElementById('requestType');
    if(!requestType)return;
    installBridge();
    requestType.addEventListener('change',syncVisibility);
    syncVisibility();
  }

  function installBridge(){
    if(document.getElementById('payrollCompanyScopeBridge'))return;
    const source=document.getElementById('companyId');
    const sourceAccount=document.getElementById('payrollSourceAccount');
    const grid=sourceAccount?.closest('.form-grid');
    if(!source||!grid)return;

    const wrapper=document.createElement('label');
    wrapper.id='payrollCompanyScopeBridge';
    wrapper.innerHTML='Empresa *<select id="payrollCompanyScopeSelect" class="form-control"><option value="">Seleccionar empresa</option></select><span class="field-hint">Selecciona empresa primero para cargar cuenta origen y centro de costo.</span>';
    grid.insertAdjacentElement('afterbegin',wrapper);

    const mirror=wrapper.querySelector('select');
    mirror.addEventListener('change',()=>{
      source.value=mirror.value;
      source.dispatchEvent(new Event('change',{bubbles:true}));
    });
    source.addEventListener('change',syncFromSource);
    new MutationObserver(syncFromSource).observe(source,{childList:true,subtree:true});
    syncFromSource();
  }

  function syncVisibility(){
    const payroll=document.getElementById('requestType')?.value==='nomina';
    document.getElementById('payrollCompanyScopeBridge')?.classList.toggle('hidden',!payroll);
    if(payroll)syncFromSource();
  }

  function syncFromSource(){
    const source=document.getElementById('companyId');
    const mirror=document.getElementById('payrollCompanyScopeSelect');
    if(!source||!mirror)return;
    const expected=Array.from(source.options).map(option=>({value:option.value,label:option.textContent||''}));
    const current=Array.from(mirror.options).map(option=>({value:option.value,label:option.textContent||''}));
    if(JSON.stringify(expected)!==JSON.stringify(current)){
      mirror.innerHTML='';
      expected.forEach(item=>{
        const option=document.createElement('option');
        option.value=item.value;option.textContent=item.label;mirror.appendChild(option);
      });
    }
    mirror.value=source.value||'';
  }
})();
