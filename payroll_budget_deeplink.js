;(function payrollBudgetDeepLinkN5B(){
  'use strict';
  if(window.__fluxPayrollBudgetDeepLinkN5BLoaded)return;
  window.__fluxPayrollBudgetDeepLinkN5BLoaded=true;

  const requestId=new URLSearchParams(location.search).get('request_id');
  if(!isUuid(requestId))return;

  const queue=document.getElementById('payrollBudgetQueue');
  if(!queue)return;

  let completed=false;
  const focus=()=>{
    if(completed)return true;
    const button=Array.from(queue.querySelectorAll('[data-request-id]')).find(item=>item.dataset.requestId===requestId);
    if(!button)return false;
    completed=true;
    if(!button.classList.contains('selected'))button.click();
    button.scrollIntoView({block:'nearest'});
    return true;
  };

  if(focus())return;
  const observer=new MutationObserver(()=>{if(focus())observer.disconnect();});
  observer.observe(queue,{childList:true,subtree:true});
  window.setTimeout(()=>observer.disconnect(),10000);

  function isUuid(value){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''));}
})();