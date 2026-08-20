;(function payrollCompanyScopeFix(){
  'use strict';
  if(window.__fluxPayrollCompanyScopeFixLoaded)return;window.__fluxPayrollCompanyScopeFixLoaded=true;

  function onReady(cb){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cb,{once:true});else cb();}
  onReady(init);

  async function init(){
    if((location.pathname.split('/').pop()||'').toLowerCase()!=='solicitudes.html')return;
    if(window.FluxAuth?.ready)await window.FluxAuth.ready();
    const requestType=await waitForElement('requestType');
    if(!requestType)return;
    requestType.addEventListener('change',async()=>{await ensureBridge();syncVisibility();});
    await ensureBridge();
    syncVisibility();
  }

  async function ensureBridge(){
    const existing=document.getElementById('payrollCompanyScopeBridge');
    if(existing){syncFromSource();return existing;}
    const source=document.getElementById('companyId');
    const sourceAccount=await waitForElement('payrollSourceAccount');
    const grid=sourceAccount?.closest('.form-grid');
    if(!source||!grid)return null;

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
    return wrapper;
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
