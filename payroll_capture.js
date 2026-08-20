(function () {
  'use strict';

  if (window.__fluxPayrollCaptureN3GLoaded) return;
  window.__fluxPayrollCaptureN3GLoaded = true;

  const FINANCE_ROLES = ['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'];
  const BUCKET = 'payroll-private';
  const MAX_BYTES = 25 * 1024 * 1024;
  const SLOT_CONFIG = Object.freeze({
    caratula: Object.freeze({ kind: 'caratula', extension: 'xlsx', mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] }),
    layout_mismo_banco: Object.freeze({ kind: 'layout_mismo_banco', extension: 'txt', mimes: ['text/plain'] }),
    layout_spei: Object.freeze({ kind: 'layout_spei', extension: 'txt', mimes: ['text/plain'] }),
    layout_toka: Object.freeze({ kind: 'layout_toka', extension: 'txt', mimes: ['text/plain'] }),
    cfdi_vales: Object.freeze({ kind: 'cfdi_vales', extension: 'xml', mimes: ['application/xml', 'text/xml'] })
  });

  const state = {
    active: false,
    initialized: false,
    saving: false,
    materializing: false,
    submitting: false,
    sessionId: null,
    sessionVersion: null,
    materializedRequestId: null,
    persistedCompanyId: null,
    persistedSourceAccountId: null,
    sessions: [],
    accounts: [],
    costCenters: [],
    companyCostCenters: [],
    files: {},
    summary: null,
    approvers: [],
    observer: null,
    sessionsLoadError: false,
    accountsLoadError: false,
    accountingLoadError: false
  };
  const dom = {};

  onReady(init);

  function onReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  async function init() {
    if ((window.location.pathname.split('/').pop() || '').toLowerCase() !== 'solicitudes.html') return;
    if (window.FluxAuth?.ready) await window.FluxAuth.ready();
    await waitForElement('requestType');
    cacheBaseDom();
    syncPayrollOptionVisibility();

    state.observer = new MutationObserver(function () {
      syncPayrollOptionVisibility();
      if (state.active) syncNonPayrollSections(true);
    });
    state.observer.observe(dom.requestForm, { childList: true, subtree: true });

    if (!hasFinanceRole()) return;
    injectStyles();
    injectCaptureSection();
    injectCaptureBoard();
    bindEvents();
    state.initialized = true;

    const loads = await Promise.allSettled([loadSourceAccounts(), loadAccountingScope(), loadSessions()]);
    state.accountsLoadError = loads[0].status === 'rejected';
    state.accountingLoadError = loads[1].status === 'rejected';
    state.sessionsLoadError = loads[2].status === 'rejected';
    const failed = loads.find(function (result) { return result.status === 'rejected'; });
    if (failed) notify('Nómina parcialmente disponible', friendlyError(failed.reason), 'warning');
    renderSourceAccounts();
    renderCostCenters();
    renderCaptureBoard();
    renderCapture();
  }

  function getClient() {
    if (typeof window.getFluxSupabaseClient === 'function') return window.getFluxSupabaseClient();
    if (window.supabaseClient) return window.supabaseClient;
    if (typeof supabaseClient !== 'undefined') return supabaseClient;
    return null;
  }

  function hasFinanceRole() {
    const roles = window.FluxAuth?.getRoles?.() || [];
    return roles.map(function (role) { return String(role).toLowerCase(); })
      .some(function (role) { return FINANCE_ROLES.includes(role); });
  }

  function cacheBaseDom() {
    dom.requestForm = document.getElementById('requestForm');
    dom.requestDialog = document.getElementById('requestDialog');
    dom.requestType = document.getElementById('requestType');
    dom.companyId = document.getElementById('companyId');
    dom.description = document.getElementById('description');
    dom.notes = document.getElementById('notes');
    dom.submit = document.getElementById('submitRequestBtn');
  }

  function syncPayrollOptionVisibility() {
    const select = document.getElementById('requestType');
    if (!select) return;
    const option = Array.from(select.options).find(function (item) { return item.value === 'nomina'; });
    if (!hasFinanceRole() && option) {
      if (select.value === 'nomina') select.value = 'provider_payment';
      option.remove();
    }
  }

  function injectStyles() {
    if (document.getElementById('payrollN3gStyles')) return;
    const style = document.createElement('style');
    style.id = 'payrollN3gStyles';
    style.textContent = `
      .payroll-n3g-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .payroll-n3g-summary{margin-top:14px;border:1px solid var(--border);border-radius:13px;padding:14px;background:rgba(255,255,255,.015)}
      .payroll-n3g-summary.hidden{display:none}
      .payroll-n3g-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}
      .payroll-n3g-metric{padding:11px;border:1px solid var(--border);border-radius:10px;background:var(--bg-input)}
      .payroll-n3g-metric span{display:block;color:var(--text-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}
      .payroll-n3g-metric strong{display:block;color:var(--text-1);font-size:16px;margin-top:4px}
      .payroll-n3g-channel-list{display:grid;gap:7px;margin:10px 0}
      .payroll-n3g-channel{display:flex;justify-content:space-between;gap:12px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;color:var(--text-2);font-size:12px}
      .payroll-n3g-review{margin-top:10px;padding:11px;border:1px solid rgba(245,158,11,.3);border-radius:10px;background:var(--amber-dim)}
      .payroll-n3g-review.hidden{display:none}
      .payroll-n3g-review textarea{width:100%;min-height:68px;margin-top:8px;padding:9px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;color:var(--text-1);font-family:inherit}
      .payroll-n3g-approval{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-top:12px}
      .payroll-n3g-approval.hidden{display:none}
      .payroll-n3g-approval label{display:flex;flex-direction:column;gap:5px;color:var(--text-3);font-size:10.5px;font-weight:700;text-transform:uppercase}
      @media(max-width:720px){.payroll-n3g-metrics{grid-template-columns:1fr}.payroll-n3g-approval{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function injectCaptureSection() {
    if (document.getElementById('payrollCaptureSection')) return;
    const firstSection = dom.requestForm.querySelector('.form-sections .form-section');
    firstSection.insertAdjacentHTML('afterend', `
      <section class="form-section payroll-capture-section hidden" id="payrollCaptureSection" aria-labelledby="payrollCaptureTitle">
        <div class="payroll-section-heading">
          <div>
            <span class="payroll-dev-pill">DEV · N3G</span>
            <h3 id="payrollCaptureTitle">Captura real de nómina</h3>
            <p>Flux no calcula nómina. Valida el paquete físico, materializa la corrida y la envía a aprobación individual.</p>
          </div>
          <button class="secondary-btn" id="payrollNewCaptureBtn" type="button">Nueva captura</button>
        </div>

        <label class="full-row">Reanudar captura
          <select id="payrollDraftSelect" class="form-control"><option value="">Nueva captura</option></select>
          <span class="field-hint">Solo sesiones privadas vigentes para Finanzas.</span>
        </label>

        <div class="form-grid payroll-metadata-grid">
          <label>Tipo de corrida *
            <select id="payrollSubtype" class="form-control"><option value="ordinaria">Ordinaria</option><option value="extraordinaria">Extraordinaria</option></select>
          </label>
          <label>Cuenta origen *
            <select id="payrollSourceAccount" class="form-control"><option value="">Selecciona empresa primero</option></select>
            <span class="field-hint">Cuenta de Tesorería; siempre se muestra enmascarada.</span>
          </label>
          <label>Centro de costo *
            <select id="payrollCostCenter" class="form-control"><option value="">Selecciona empresa primero</option></select>
            <span class="field-hint">Define el contexto contable y las reglas de aprobación.</span>
          </label>
          <label>Periodo inicio *<input id="payrollPeriodStart" class="form-control" type="date"></label>
          <label>Periodo fin *<input id="payrollPeriodEnd" class="form-control" type="date"></label>
        </div>

        <fieldset class="payroll-channel-picker">
          <legend>Canales de la corrida *</legend>
          <label><input type="checkbox" value="banco" data-payroll-channel> BBVA mismo banco</label>
          <label><input type="checkbox" value="spei" data-payroll-channel> SPEI</label>
          <label><input type="checkbox" value="vales" data-payroll-channel> Vales / TOKA</label>
        </fieldset>

        <div class="payroll-package-heading">
          <div><h3>Paquete físico</h3><p>Los bytes son re-descargados y re-interpretados por el servidor antes de materializar.</p></div>
          <span class="payroll-private-pill">Privado · Finanzas</span>
        </div>

        <div class="payroll-file-grid">
          ${fileCard('caratula','Carátula XLSX','Obligatoria','Contrato real Operadora Tlacatecpan. Validación final en servidor.','payrollCoverFile','.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
          ${fileCard('layout_mismo_banco','BBVA Nómina 108 TXT','Condicional','108 bytes útiles + CRLF. Validación final en servidor.','payrollSameBankFile','.txt,text/plain')}
          ${fileCard('layout_spei','SPEI TXT','Condicional','128 bytes útiles + CRLF. Diagnóstico local y verificación final en servidor.','payrollSpeiFile','.txt,text/plain')}
          ${fileCard('layout_toka','TOKA fondeo TXT','Condicional','Transferencia agregada real a TOKA; separada del beneficio por empleado.','payrollTokaFundingFile','.txt,text/plain')}
          ${fileCard('cfdi_vales','TOKA CFDI XML','Condicional','CFDI 4.0 + complemento valesdedespensa para beneficio, comisión e IVA.','payrollTokaXmlFile','.xml,application/xml,text/xml')}
        </div>

        <section class="payroll-validation-panel" aria-live="polite">
          <div><span class="payroll-summary-label">Estado</span><strong id="payrollCaptureState">Archivos pendientes</strong></div>
          <div><span class="payroll-summary-label">Monto</span><strong id="payrollCalculatedTotal">Se calcula en servidor</strong></div>
          <div><span class="payroll-summary-label">SPEI</span><strong id="payrollSpeiCount">Pendiente</strong></div>
          <div class="payroll-issues" id="payrollIssues"></div>
          <p class="payroll-pii-note">Esta vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias de empleados.</p>
        </section>

        <section id="payrollSubmissionSummary" class="payroll-n3g-summary hidden">
          <div class="payroll-n3g-metrics">
            <div class="payroll-n3g-metric"><span>Neto empleados</span><strong id="payrollEmployeeNet">—</strong></div>
            <div class="payroll-n3g-metric"><span>Salida Tesorería</span><strong id="payrollTreasuryTotal">—</strong></div>
          </div>
          <div id="payrollChannelSummary" class="payroll-n3g-channel-list"></div>
          <div id="payrollVarianceReview" class="payroll-n3g-review hidden">
            <strong>Revisión de fondeo TOKA requerida</strong>
            <p id="payrollVarianceCopy"></p>
            <textarea id="payrollVarianceNote" maxlength="500" placeholder="Documenta por qué Finanzas acepta la diferencia antes de enviar a aprobación."></textarea>
            <div class="payroll-n3g-actions"><button type="button" id="payrollAcknowledgeVarianceBtn" class="secondary-btn">Reconocer diferencia</button></div>
          </div>
          <div id="payrollApprovalSection" class="payroll-n3g-approval hidden">
            <label>Aprobador *<select id="payrollApproverSelect" class="form-control"><option value="">Selecciona aprobador</option></select></label>
            <button type="button" id="payrollSubmitApprovalBtn" class="primary-btn">Enviar a aprobación</button>
          </div>
          <p id="payrollSubmissionState" class="field-hint"></p>
        </section>
      </section>
    `);

    dom.section = document.getElementById('payrollCaptureSection');
    dom.draftSelect = document.getElementById('payrollDraftSelect');
    dom.subtype = document.getElementById('payrollSubtype');
    dom.sourceAccount = document.getElementById('payrollSourceAccount');
    dom.costCenter = document.getElementById('payrollCostCenter');
    dom.periodStart = document.getElementById('payrollPeriodStart');
    dom.periodEnd = document.getElementById('payrollPeriodEnd');
    dom.captureState = document.getElementById('payrollCaptureState');
    dom.total = document.getElementById('payrollCalculatedTotal');
    dom.speiCount = document.getElementById('payrollSpeiCount');
    dom.issues = document.getElementById('payrollIssues');
    dom.summary = document.getElementById('payrollSubmissionSummary');
    dom.employeeNet = document.getElementById('payrollEmployeeNet');
    dom.treasuryTotal = document.getElementById('payrollTreasuryTotal');
    dom.channelSummary = document.getElementById('payrollChannelSummary');
    dom.varianceReview = document.getElementById('payrollVarianceReview');
    dom.varianceCopy = document.getElementById('payrollVarianceCopy');
    dom.varianceNote = document.getElementById('payrollVarianceNote');
    dom.approvalSection = document.getElementById('payrollApprovalSection');
    dom.approverSelect = document.getElementById('payrollApproverSelect');
    dom.submissionState = document.getElementById('payrollSubmissionState');

    const materialize = document.createElement('button');
    materialize.id = 'payrollMaterializeBtn';
    materialize.className = 'primary-btn hidden';
    materialize.type = 'button';
    materialize.disabled = true;
    materialize.textContent = 'Validar paquete y materializar';
    dom.submit.insertAdjacentElement('afterend', materialize);
    dom.materialize = materialize;
    dom.ackVariance = document.getElementById('payrollAcknowledgeVarianceBtn');
    dom.submitApproval = document.getElementById('payrollSubmitApprovalBtn');
  }

  function fileCard(slot,title,badge,copy,inputId,accept) {
    return `<article class="payroll-file-card" data-payroll-card="${slot}">
      <div class="payroll-file-card-head"><strong>${title}</strong><span>${badge}</span></div>
      <p>${copy}</p>
      <input id="${inputId}" type="file" accept="${accept}" aria-label="${title}" data-payroll-file-input="${slot}">
      <div class="payroll-file-status" data-payroll-status="${slot}"></div>
    </article>`;
  }

  function injectCaptureBoard() {
    if (document.getElementById('payrollCaptureBoard')) return;
    const stats = document.querySelector('.stats-grid');
    stats?.insertAdjacentHTML('afterend', `
      <section class="payroll-capture-board" id="payrollCaptureBoard">
        <div class="payroll-board-heading"><div><span class="payroll-dev-pill">Nómina N3G</span><h2>Capturas de nómina</h2><p>Paquetes privados de Finanzas y su estado de validación.</p></div><span class="payroll-private-pill">Finance only</span></div>
        <div id="payrollCaptureBoardList" class="payroll-board-list"><p>Cargando capturas…</p></div>
      </section>`);
    dom.board = document.getElementById('payrollCaptureBoard');
    dom.boardList = document.getElementById('payrollCaptureBoardList');
  }

  function bindEvents() {
    dom.requestType.addEventListener('change', syncRequestMode);
    dom.requestForm.addEventListener('submit', submitPayrollCapture, true);
    dom.requestDialog.addEventListener('close', function () { if (!state.saving && !state.materializing) resetCapture(); });
    dom.companyId.addEventListener('change', handleCompanyChange);
    dom.sourceAccount.addEventListener('change', handleSourceAccountChange);
    dom.costCenter.addEventListener('change', renderCapture);
    dom.draftSelect.addEventListener('change', async function () {
      const session = state.sessions.find(function (item) { return item.id === dom.draftSelect.value; });
      if (session) await hydrateSession(session);
      else resetCapture(true);
    });
    document.getElementById('payrollNewCaptureBtn').addEventListener('click', function () { resetCapture(true); });
    document.querySelectorAll('[data-payroll-channel]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!handleChannelChange(input)) return;
        syncConditionalInputs();
        renderCapture();
      });
    });
    document.querySelectorAll('[data-payroll-file-input]').forEach(function (input) { bindFile(input.id, input.dataset.payrollFileInput); });
    dom.materialize.addEventListener('click', materializeCapture);
    dom.ackVariance.addEventListener('click', acknowledgeVariance);
    dom.submitApproval.addEventListener('click', submitForApproval);
    dom.boardList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-payroll-resume]');
      if (!button) return;
      const session = state.sessions.find(function (item) { return item.id === button.dataset.payrollResume; });
      if (!session) return;
      document.getElementById('newRequestBtn')?.click();
      window.setTimeout(async function () {
        dom.requestType.value = 'nomina';
        dom.requestType.dispatchEvent(new Event('change', { bubbles: true }));
        await hydrateSession(session);
      }, 40);
    });
  }

  function bindFile(id, slot) {
    const input = document.getElementById(id);
    input.addEventListener('change', async function (event) {
      const file = event.target.files?.[0] || null;
      if (!file) { delete state.files[slot]; renderCapture(); return; }
      input.disabled = true;
      try { state.files[slot] = await inspectFile(slot, file); }
      catch (_) { state.files[slot] = { present:true,status:'parser_error',uploadable:false,issueCodes:['PARSER_ERROR'] }; }
      finally { syncConditionalInputs(); renderCapture(); }
    });
  }

  async function inspectFile(slot,file) {
    const config = SLOT_CONFIG[slot];
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    const mimeType = file.type || config?.mimes?.[0] || '';
    if (!config || extension !== config.extension || !config.mimes.includes(mimeType) || file.size < 1 || file.size > MAX_BYTES) throw new Error('PAYROLL_FILE_METADATA_INVALID');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (slot === 'caratula' && !isZipSignature(bytes)) throw new Error('PAYROLL_XLSX_SIGNATURE_INVALID');
    if (['layout_mismo_banco','layout_spei','layout_toka'].includes(slot) && hasBinaryNull(bytes)) throw new Error('PAYROLL_TXT_SIGNATURE_INVALID');
    if (slot === 'cfdi_vales' && !looksLikeXml(bytes)) throw new Error('PAYROLL_XML_SIGNATURE_INVALID');

    const base = { present:true,uploadable:true,uploaded:false,file,extension,mimeType,sizeBytes:file.size,sha256:await sha256Hex(buffer),issueCodes:[] };
    if (slot === 'layout_spei') {
      const summary = window.FluxPayrollParser.summarizePayrollSpeiForCapture(buffer, selectedSourceAccountCandidates());
      if (!summary.valid) return Object.assign(base,{status:'parser_error',uploadable:false,parserSummary:summary,issueCodes:['PARSER_ERROR']});
      return Object.assign(base,{status:'parsed',parserSummary:summary,recordCount:summary.recordCount,totalAmountMinor:summary.totalAmountMinor});
    }
    if (slot === 'layout_toka') {
      const parsed = window.FluxPayrollParser.parsePayrollSpeiTxt(buffer);
      const allowed = new Set(selectedSourceAccountCandidates().map(normalizeAccount18));
      if (parsed.issues.length || parsed.records.length !== 1 || !allowed.size || parsed.records.some(function (record) { return !allowed.has(record.sourceAccount); })) {
        return Object.assign(base,{status:'parser_error',uploadable:false,issueCodes:['PARSER_ERROR']});
      }
    }
    return Object.assign(base,{status:'server_verification_pending'});
  }

  function isZipSignature(bytes) { return bytes.length>=4 && bytes[0]===0x50 && bytes[1]===0x4b && ((bytes[2]===0x03&&bytes[3]===0x04)||(bytes[2]===0x05&&bytes[3]===0x06)||(bytes[2]===0x07&&bytes[3]===0x08)); }
  function hasBinaryNull(bytes) { for (let i=0;i<Math.min(bytes.length,4096);i+=1) if (bytes[i]===0) return true; return false; }
  function looksLikeXml(bytes) { try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(0,512)).replace(/^\uFEFF/,'').trimStart().startsWith('<'); } catch (_) { return false; } }
  async function sha256Hex(buffer) { const digest=await crypto.subtle.digest('SHA-256',buffer); return Array.from(new Uint8Array(digest)).map(function(byte){return byte.toString(16).padStart(2,'0');}).join(''); }
  function normalizeAccount18(value) { const digits=String(value||'').replace(/\D/g,''); return digits ? digits.padStart(18,'0') : ''; }

  async function loadSourceAccounts() {
    const client=getClient(); if(!client) return;
    const result=await client.from('company_bank_accounts').select('id,company_id,name,bank_name,currency,account_type,last4,account_number,clabe,active').eq('active',true).eq('account_type','bank').eq('currency','MXN').order('name',{ascending:true});
    if(result.error) throw result.error; state.accounts=result.data||[]; state.accountsLoadError=false;
  }

  async function loadAccountingScope() {
    const client=getClient(); if(!client) return;
    const [centers,mappings]=await Promise.all([
      client.from('cost_centers').select('id,name,code,active').eq('active',true).order('name',{ascending:true}),
      client.from('company_cost_centers').select('company_id,cost_center_id,active').eq('active',true)
    ]);
    if(centers.error) throw centers.error; if(mappings.error) throw mappings.error;
    state.costCenters=centers.data||[]; state.companyCostCenters=mappings.data||[]; state.accountingLoadError=false;
  }

  async function loadSessions() {
    const client=getClient(); if(!client) return;
    const result=await client.rpc('get_payroll_capture_sessions',{p_session_id:null});
    if(result.error) throw result.error;
    state.sessions=Array.isArray(result.data)?result.data:[]; state.sessionsLoadError=false;
    renderDraftOptions(); renderCaptureBoard();
  }

  function renderSourceAccounts() {
    if(!dom.sourceAccount) return;
    if(state.accountsLoadError){dom.sourceAccount.innerHTML='<option value="">Cuentas no disponibles</option>';return;}
    const companyId=dom.companyId.value,previous=dom.sourceAccount.value;
    const options=state.accounts.filter(function(a){return a.company_id===companyId;});
    dom.sourceAccount.innerHTML='<option value="">Seleccionar cuenta origen</option>'+options.map(function(a){const digits=String(a.last4||a.account_number||a.clabe||'').replace(/\D/g,'');const masked=digits?'•••• '+digits.slice(-4):'Cuenta enmascarada';return '<option value="'+escapeHtml(a.id)+'">'+escapeHtml([a.name,a.bank_name,masked,a.currency].filter(Boolean).join(' · '))+'</option>';}).join('');
    if(options.some(function(a){return a.id===previous;})) dom.sourceAccount.value=previous;
  }

  function renderCostCenters() {
    if(!dom.costCenter) return;
    if(state.accountingLoadError){dom.costCenter.innerHTML='<option value="">Centros de costo no disponibles</option>';return;}
    const companyId=dom.companyId.value,previous=dom.costCenter.value;
    const allowed=new Set(state.companyCostCenters.filter(function(m){return m.company_id===companyId&&m.active!==false;}).map(function(m){return m.cost_center_id;}));
    const options=state.costCenters.filter(function(c){return allowed.has(c.id);});
    dom.costCenter.innerHTML='<option value="">Seleccionar centro de costo</option>'+options.map(function(c){return '<option value="'+escapeHtml(c.id)+'">'+escapeHtml([c.code,c.name].filter(Boolean).join(' · '))+'</option>';}).join('');
    if(options.some(function(c){return c.id===previous;})) dom.costCenter.value=previous;
  }

  function selectedSourceAccountCandidates() {
    const account=state.accounts.find(function(item){return item.id===dom.sourceAccount.value;});
    if(!account) return [];
    return [account.account_number,account.clabe].map(function(v){return String(v||'').replace(/\D/g,'');}).filter(Boolean);
  }

  function syncRequestMode() {
    state.active=dom.requestType.value==='nomina'&&hasFinanceRole();
    applyRequestMode();
    if(state.active){renderSourceAccounts();renderCostCenters();renderCapture();}
  }

  function applyRequestMode() {
    if(!dom.section) return;
    const payroll=state.active;
    dom.section.classList.toggle('hidden',!payroll); dom.materialize.classList.toggle('hidden',!payroll);
    dom.requestForm.querySelector('.request-layout')?.classList.toggle('payroll-mode',payroll);
    dom.requestForm.querySelector('.summary-panel')?.classList.toggle('hidden',payroll);
    const fieldIds=['costCenterId','budgetCategorySearch','budgetCategoryId','budgetMonth','providerSearch','proveedorId','paymentMethod','requestFile','approverId','amountRequested','currency','exchangeRate','isExtraordinaryAdjustment'];
    const hiddenTargets=new Set();
    fieldIds.forEach(function(id){const control=document.getElementById(id);if(!control)return;const target=control.closest('label');if(target)hiddenTargets.add(target);setControlMode(control,payroll);});
    hiddenTargets.forEach(function(target){target.classList.toggle('hidden',payroll);});
    syncNonPayrollSections(payroll);
    document.getElementById('approverSelectionSection')?.classList.toggle('hidden',payroll);
    if(payroll) document.getElementById('cashCheckSection')?.classList.add('hidden');
    dom.section.querySelectorAll('input,select,textarea').forEach(function(control){control.disabled=!payroll||control.dataset.payrollConditionalDisabled==='true'||state.materializedRequestId!==null;});
    syncConditionalInputs();
    const title=dom.requestForm.querySelector('.modal-header h2'),copy=dom.requestForm.querySelector('.modal-header p');
    if(payroll){if(title)title.textContent='Captura de nómina';if(copy)copy.textContent='Carga el paquete físico, valida en servidor y envía el total de Tesorería a aprobación.';dom.submit.textContent='Guardar captura';}
    else{if(title)title.textContent='Nueva solicitud de pago';if(copy)copy.textContent='Completa los datos operativos y financieros para validar presupuesto al guardar.';dom.submit.textContent='Crear solicitud';}
  }

  function syncNonPayrollSections(payroll) { ['requestProviderSection','requestVisitContextSection'].forEach(function(id){document.getElementById(id)?.classList.toggle('hidden',payroll);}); }
  function setControlMode(control,payroll){if(control.dataset.payrollOriginalRequired===undefined)control.dataset.payrollOriginalRequired=control.required?'true':'false';control.required=payroll?false:control.dataset.payrollOriginalRequired==='true';control.disabled=payroll;}
  function expectedChannels(){return Array.from(document.querySelectorAll('[data-payroll-channel]:checked')).map(function(input){return input.value;});}
  function requiredSlots(){const channels=expectedChannels();return ['caratula'].concat(channels.includes('banco')?['layout_mismo_banco']:[],channels.includes('spei')?['layout_spei']:[],channels.includes('vales')?['layout_toka','cfdi_vales']:[]);}

  function handleChannelChange(input) {
    if(input.checked) return true;
    const slots=input.value==='vales'?['layout_toka','cfdi_vales']:input.value==='banco'?['layout_mismo_banco']:['layout_spei'];
    if(slots.some(function(slot){return state.files[slot]?.uploaded;})){input.checked=true;notify('Canal protegido','No puedes retirar un canal después de subir su evidencia. Crea una captura nueva.','warning');return false;}
    slots.forEach(function(slot){delete state.files[slot];const target=document.querySelector('[data-payroll-file-input="'+slot+'"]');if(target)target.value='';});
    return true;
  }

  function syncConditionalInputs() {
    if(!dom.section) return;
    const channels=expectedChannels(),enabled={caratula:true,layout_mismo_banco:channels.includes('banco'),layout_spei:channels.includes('spei'),layout_toka:channels.includes('vales'),cfdi_vales:channels.includes('vales')};
    document.querySelectorAll('[data-payroll-file-input]').forEach(function(input){const slot=input.dataset.payrollFileInput;input.disabled=!state.active||!enabled[slot]||state.materializedRequestId!==null;input.dataset.payrollConditionalDisabled=enabled[slot]?'false':'true';});
  }

  async function handleCompanyChange() {
    if(!state.active) return;
    const hasPersisted=Object.values(state.files).some(function(file){return file.uploaded;});
    if(state.sessionId&&state.persistedCompanyId&&dom.companyId.value!==state.persistedCompanyId&&hasPersisted){dom.companyId.value=state.persistedCompanyId;renderSourceAccounts();renderCostCenters();dom.sourceAccount.value=state.persistedSourceAccountId||'';notify('Empresa protegida','La empresa queda fija después de subir evidencia.','warning');return;}
    renderSourceAccounts();renderCostCenters();clearLocalFileSelections();renderCapture();
  }

  function handleSourceAccountChange() {
    if(!state.active) return;
    const encodedUploaded=state.files.layout_spei?.uploaded||state.files.layout_toka?.uploaded;
    if(state.sessionId&&state.persistedSourceAccountId&&encodedUploaded&&dom.sourceAccount.value!==state.persistedSourceAccountId){dom.sourceAccount.value=state.persistedSourceAccountId;notify('Cuenta origen protegida','La cuenta queda fija después de subir un layout que la codifica.','warning');return;}
    ['layout_spei','layout_toka'].forEach(function(slot){if(state.files[slot]?.file){delete state.files[slot];const target=document.querySelector('[data-payroll-file-input="'+slot+'"]');if(target)target.value='';}});
    renderCapture();
  }

  function clearLocalFileSelections(){Object.entries(state.files).forEach(function(entry){if(entry[1].file)delete state.files[entry[0]];});document.querySelectorAll('[data-payroll-file-input]').forEach(function(input){input.value='';});}

  function renderDraftOptions(){if(!dom.draftSelect)return;dom.draftSelect.innerHTML='<option value="">Nueva captura</option>'+state.sessions.map(function(s){return '<option value="'+escapeHtml(s.id)+'">'+escapeHtml([s.concept,s.period_start+' → '+s.period_end,captureStateLabel(s.capture_state)].filter(Boolean).join(' · '))+'</option>';}).join('');if(state.sessionId)dom.draftSelect.value=state.sessionId;}
  function renderCaptureBoard(){if(!dom.boardList)return;if(state.sessionsLoadError){dom.boardList.innerHTML='<div class="payroll-board-empty">Las capturas no están disponibles.</div>';return;}if(!state.sessions.length){dom.boardList.innerHTML='<div class="payroll-board-empty">Aún no hay capturas de nómina.</div>';return;}dom.boardList.innerHTML=state.sessions.map(function(s){const materialized=s.materialized_payment_request_id?' · Materializada':'';return '<article class="payroll-board-item"><div><strong>'+escapeHtml(s.concept)+'</strong><span>'+escapeHtml(s.period_start)+' → '+escapeHtml(s.period_end)+materialized+'</span></div><div><span class="payroll-state '+(s.capture_state==='materialized'?'success':'warning')+'">'+escapeHtml(captureStateLabel(s.capture_state))+'</span></div><button class="secondary-btn" type="button" data-payroll-resume="'+escapeHtml(s.id)+'">Abrir</button></article>';}).join('');}

  async function hydrateSession(session) {
    state.sessionId=session.id;state.sessionVersion=session.version;state.materializedRequestId=session.materialized_payment_request_id||null;state.persistedCompanyId=session.company_id;state.persistedSourceAccountId=session.company_bank_account_id;state.files={};state.summary=null;state.approvers=[];
    dom.companyId.value=session.company_id;renderSourceAccounts();renderCostCenters();dom.sourceAccount.value=session.company_bank_account_id;dom.costCenter.value=session.cost_center_id||'';dom.subtype.value=session.payroll_subtype;dom.periodStart.value=session.period_start;dom.periodEnd.value=session.period_end;dom.description.value=session.concept;dom.notes.value=session.notes||'';
    document.querySelectorAll('[data-payroll-channel]').forEach(function(input){input.checked=(session.expected_channels||[]).includes(input.value);});
    (session.files||[]).forEach(function(file){state.files[file.kind]={present:true,uploaded:true,uploadable:false,status:file.parsing_status,recordCount:file.record_count,totalAmountMinor:file.total_amount_minor,issueCodes:file.issue_codes||[]};});
    dom.draftSelect.value=session.id;syncConditionalInputs();renderCapture();
    if(state.materializedRequestId) await loadSubmissionSummary(); else renderSubmissionSummary();
  }

  function resetCapture(keepPayrollMode) {
    state.sessionId=null;state.sessionVersion=null;state.materializedRequestId=null;state.persistedCompanyId=null;state.persistedSourceAccountId=null;state.files={};state.summary=null;state.approvers=[];
    if(dom.draftSelect)dom.draftSelect.value='';if(dom.subtype)dom.subtype.value='ordinaria';if(dom.sourceAccount)dom.sourceAccount.value='';if(dom.costCenter)dom.costCenter.value='';if(dom.periodStart)dom.periodStart.value='';if(dom.periodEnd)dom.periodEnd.value='';
    document.querySelectorAll('[data-payroll-channel]').forEach(function(input){input.checked=false;});document.querySelectorAll('[data-payroll-file-input]').forEach(function(input){input.value='';});
    if(keepPayrollMode&&dom.requestType){dom.requestType.value='nomina';state.active=true;}
    syncConditionalInputs();renderCapture();renderSubmissionSummary();
  }

  function renderCapture() {
    if(!dom.section) return;
    const required=requiredSlots(),missing=required.filter(function(slot){return !state.files[slot]?.uploaded;});
    required.forEach(function(slot){renderFileCard(slot,true);});
    Object.keys(SLOT_CONFIG).filter(function(slot){return !required.includes(slot);}).forEach(function(slot){renderFileCard(slot,false);});
    const materialized=Boolean(state.materializedRequestId);
    dom.captureState.textContent=materialized?'Materializada':missing.length?'Archivos pendientes':'Lista para validación server-side';
    dom.total.textContent=state.summary?formatMoney(state.summary.amount_requested):'Se calcula en servidor';
    const spei=state.files.layout_spei;dom.speiCount.textContent=spei?.recordCount?String(spei.recordCount):spei?.uploaded?'Servidor validará':'Pendiente';
    dom.issues.innerHTML=missing.length?missing.map(function(slot){return '<span class="payroll-issue-chip">MISSING_USER_FILE · '+escapeHtml(slotLabel(slot))+'</span>';}).join(''):'<span class="payroll-issue-chip">Paquete completo para verificación</span>';
    dom.materialize.disabled=!state.active||materialized||!state.sessionId||missing.length>0||state.materializing;
    dom.submit.disabled=materialized||state.saving;
    syncConditionalInputs();
  }

  function renderFileCard(slot,required){const target=document.querySelector('[data-payroll-status="'+slot+'"]');if(!target)return;const file=state.files[slot];if(!required){target.innerHTML='<span class="payroll-state neutral">No requerido</span>';return;}if(!file){target.innerHTML='<span class="payroll-state warning">Pendiente de archivo</span><small>MISSING_USER_FILE</small>';return;}if(file.status==='parser_error'||file.status==='failed'){target.innerHTML='<span class="payroll-state danger">Error de formato</span><small>No se subirá</small>';return;}if(state.materializedRequestId){target.innerHTML='<span class="payroll-state success">Verificado en servidor</span><small>Evidencia vinculada a la corrida materializada</small>';return;}if(file.uploaded){target.innerHTML='<span class="payroll-state success">Archivo privado recibido</span><small>'+escapeHtml(slot==='layout_spei'?'Diagnóstico local PASS · servidor revalidará':'Verificación server-side pendiente')+'</small>';return;}target.innerHTML='<span class="payroll-state warning">Listo para subir</span><small>Se verificará en servidor</small>';}

  async function submitPayrollCapture(event) {
    if(!state.active) return;
    event.preventDefault();event.stopImmediatePropagation();if(state.saving||state.materializedRequestId)return;
    const validation=validateMetadata();if(validation){notify('Revisa la captura',validation,'warning');return;}
    const client=getClient();if(!client)return notify('Sin conexión','No se encontró Supabase.','error');
    state.saving=true;dom.submit.disabled=true;dom.submit.textContent='Guardando…';
    try{
      const save=await client.rpc('save_payroll_capture_session_n3g',{p_session_id:state.sessionId,p_expected_version:state.sessionVersion,p_company_id:dom.companyId.value,p_company_bank_account_id:dom.sourceAccount.value,p_cost_center_id:dom.costCenter.value,p_payroll_subtype:dom.subtype.value,p_period_start:dom.periodStart.value,p_period_end:dom.periodEnd.value,p_concept:dom.description.value.trim(),p_notes:dom.notes.value.trim()||null,p_expected_channels:expectedChannels()});
      if(save.error)throw save.error;state.sessionId=save.data.id;state.sessionVersion=save.data.version;
      const uploads=Object.entries(state.files).filter(function(entry){return entry[1].uploadable&&!entry[1].uploaded;});for(const entry of uploads)await uploadReservedFile(client,entry[0],entry[1]);
      await loadSessions();const current=state.sessions.find(function(item){return item.id===state.sessionId;});if(current)await hydrateSession(current);renderCaptureBoard();notify('Captura guardada','El paquete privado quedó guardado. Cuando estén todos los archivos podrás validar y materializar.','success');
    }catch(error){notify('No se pudo guardar',friendlyError(error),'error');}
    finally{state.saving=false;dom.submit.disabled=false;dom.submit.textContent='Guardar captura';renderCapture();}
  }

  async function uploadReservedFile(client,slot,fileState){const config=SLOT_CONFIG[slot],summary=fileState.parserSummary||{};const reservation=await client.rpc('reserve_payroll_capture_file',{p_session_id:state.sessionId,p_expected_version:state.sessionVersion,p_kind:config.kind,p_extension:fileState.extension,p_mime_type:fileState.mimeType,p_size_bytes:fileState.sizeBytes,p_sha256:fileState.sha256,p_parser_version:slot==='layout_spei'?summary.parserVersion:null,p_parser_contract:slot==='layout_spei'?summary.contractVersion:null,p_record_count:slot==='layout_spei'?summary.recordCount:null,p_total_amount_minor:slot==='layout_spei'?summary.totalAmountMinor:null});if(reservation.error)throw reservation.error;const upload=await client.storage.from(BUCKET).upload(reservation.data.storage_path,fileState.file,{contentType:fileState.mimeType,upsert:false});if(upload.error)throw upload.error;const confirmation=await client.rpc('confirm_payroll_capture_file',{p_file_id:reservation.data.file_id,p_sha256:fileState.sha256});if(confirmation.error)throw confirmation.error;state.sessionVersion=confirmation.data.version;fileState.uploaded=true;fileState.uploadable=false;delete fileState.file;delete fileState.parserSummary;}

  async function materializeCapture() {
    if(state.materializing||!state.sessionId||!state.sessionVersion)return;
    const missing=requiredSlots().filter(function(slot){return !state.files[slot]?.uploaded;});if(missing.length){notify('Paquete incompleto','Faltan archivos requeridos.','warning');return;}
    const client=getClient();if(!client)return;
    const expectedVersion=state.sessionVersion,idempotencyKey='payroll-n3g:'+state.sessionId+':v'+expectedVersion;
    state.materializing=true;dom.materialize.disabled=true;dom.materialize.textContent='Validando en servidor…';
    try{
      const result=await client.functions.invoke('payroll-materialize',{body:{capture_session_id:state.sessionId,expected_version:expectedVersion,idempotency_key:idempotencyKey}});
      if(result.error)throw result.error;
      if(!result.data||!['materialized','already_materialized'].includes(result.data.status))throw new Error('PAYROLL_MATERIALIZATION_FAILED');
      state.materializedRequestId=result.data.payment_request_id||state.materializedRequestId;
      await loadSessions();const current=state.sessions.find(function(item){return item.id===state.sessionId;});if(current)await hydrateSession(current);else if(state.materializedRequestId)await loadSubmissionSummary();
      notify('Nómina validada','El servidor verificó el paquete y materializó la solicitud.','success');
    }catch(error){notify('Validación no completada',friendlyError(error),'error');}
    finally{state.materializing=false;dom.materialize.textContent='Validar paquete y materializar';renderCapture();}
  }

  async function loadSubmissionSummary() {
    if(!state.materializedRequestId){state.summary=null;renderSubmissionSummary();return;}
    const client=getClient();if(!client)return;
    const result=await client.rpc('get_payroll_submission_summary',{p_payment_request_id:state.materializedRequestId});
    if(result.error){notify('No se pudo leer el resumen',friendlyError(result.error),'error');return;}
    state.summary=result.data;await loadApprovers();renderSubmissionSummary();
  }

  async function loadApprovers() {
    state.approvers=[];
    if(!state.summary||state.summary.status!=='draft')return;
    const client=getClient();if(!client)return;
    const result=await client.rpc('list_payment_request_approver_options',{p_company_id:state.summary.company_id,p_cost_center_id:state.summary.cost_center_id,p_amount:state.summary.amount_requested});
    if(result.error){notify('Aprobadores no disponibles',friendlyError(result.error),'warning');return;}
    state.approvers=Array.isArray(result.data)?result.data:[];
  }

  function renderSubmissionSummary() {
    const s=state.summary;dom.summary.classList.toggle('hidden',!s);if(!s)return;
    dom.employeeNet.textContent=formatMoney(s.employee_net);dom.treasuryTotal.textContent=formatMoney(s.amount_requested);
    const channels=Array.isArray(s.channels)?s.channels:[];
    dom.channelSummary.innerHTML=channels.map(function(c){let detail=formatMoney(c.amount);if(c.channel==='vales')detail+=' · beneficio '+formatMoney(c.benefit_amount)+' · comisión '+formatMoney(c.fee_amount)+' · IVA '+formatMoney(c.tax_amount);return '<div class="payroll-n3g-channel"><span>'+escapeHtml(channelLabel(c.channel))+'</span><strong>'+escapeHtml(detail)+'</strong></div>';}).join('');
    const vales=channels.find(function(c){return c.channel==='vales';});const variance=Number(vales?.funding_variance||0),needsReview=variance!==0&&!vales?.funding_variance_acknowledged;
    dom.varianceReview.classList.toggle('hidden',!needsReview);if(needsReview)dom.varianceCopy.textContent='Fondeo real '+formatMoney(vales.amount)+' vs esperado '+formatMoney(vales.expected_funding_amount)+' · diferencia '+formatMoney(variance)+'.';
    const approvalReady=s.status==='draft'&&!needsReview;
    dom.approvalSection.classList.toggle('hidden',!approvalReady);
    dom.approverSelect.innerHTML='<option value="">Selecciona aprobador</option>'+state.approvers.map(function(a){return '<option value="'+escapeHtml(a.profile_id)+'" data-assignment="'+escapeHtml(a.assignment_id||'')+'">'+escapeHtml(a.option_label||a.display_name||a.email)+'</option>';}).join('');
    dom.submitApproval.disabled=!approvalReady||!state.approvers.length||state.submitting;
    dom.submissionState.textContent=s.status==='draft'?(needsReview?'Reconoce la diferencia TOKA antes de enviar.':state.approvers.length?'Lista para seleccionar aprobador.':'No hay aprobadores elegibles para este contexto.'):'Estado de solicitud: '+s.status;
  }

  async function acknowledgeVariance() {
    if(!state.summary||!state.materializedRequestId)return;const note=dom.varianceNote.value.trim();if(!note)return notify('Nota requerida','Documenta la revisión de la diferencia TOKA.','warning');
    const client=getClient();const result=await client.rpc('acknowledge_payroll_toka_funding_variance',{p_payment_request_id:state.materializedRequestId,p_note:note});if(result.error)return notify('No se pudo reconocer la diferencia',friendlyError(result.error),'error');dom.varianceNote.value='';await loadSubmissionSummary();notify('Diferencia revisada','Finanzas dejó evidencia de la revisión del fondeo TOKA.','success');
  }

  async function submitForApproval() {
    if(state.submitting||!state.summary)return;const option=dom.approverSelect.selectedOptions[0];if(!option?.value)return notify('Aprobador requerido','Selecciona un aprobador elegible.','warning');
    const client=getClient();state.submitting=true;dom.submitApproval.disabled=true;
    try{const result=await client.rpc('submit_payroll_for_approval',{p_payment_request_id:state.materializedRequestId,p_approver_id:option.value,p_approver_assignment_id:option.dataset.assignment||null});if(result.error)throw result.error;await loadSubmissionSummary();if(typeof loadPaymentRequests==='function')await loadPaymentRequests();notify('Enviada a aprobación','La Nómina quedó enviada al aprobador seleccionado.','success');}
    catch(error){notify('No se pudo enviar',friendlyError(error),'error');}
    finally{state.submitting=false;renderSubmissionSummary();}
  }

  function validateMetadata(){if(!hasFinanceRole())return'La Nómina es exclusiva de Finanzas.';if(!dom.companyId.value)return'Selecciona empresa.';if(!dom.sourceAccount.value)return'Selecciona cuenta origen.';if(!dom.costCenter.value)return'Selecciona centro de costo.';if(!['ordinaria','extraordinaria'].includes(dom.subtype.value))return'Selecciona tipo de corrida.';if(!dom.periodStart.value||!dom.periodEnd.value||dom.periodStart.value>dom.periodEnd.value)return'Captura un periodo válido.';if(dom.description.value.trim().length<3)return'Captura concepto o descripción.';if(!expectedChannels().length)return'Declara al menos un canal.';return'';}
  function captureStateLabel(value){return({draft:'Borrador',files_pending:'Archivos pendientes',validation_pending:'Validación pendiente',ready_for_submission:'Validación completa',materialized:'Materializada'})[value]||'Validación pendiente';}
  function slotLabel(value){return({caratula:'Carátula',layout_mismo_banco:'BBVA Nómina 108',layout_spei:'SPEI',layout_toka:'TOKA fondeo',cfdi_vales:'TOKA CFDI'})[value]||value||'Captura';}
  function channelLabel(value){return({banco:'BBVA mismo banco',spei:'SPEI',vales:'TOKA / vales'})[value]||value;}
  function formatMoney(value){const n=Number(value);if(!Number.isFinite(n))return'—';return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(n);}
  function notify(title,message,variant){if(typeof showToast==='function')return showToast(title,message,variant);if(window.Components?.toast)return window.Components.toast(title,message,variant);}

  function friendlyError(error){const message=String(error?.message||error||'Error inesperado.');const map={payroll_capture_finance_required:'La captura de nómina es exclusiva de Finanzas.',payroll_capture_metadata_invalid:'La metadata de la corrida no es válida.',payroll_capture_source_account_invalid:'La cuenta origen no pertenece a la empresa o está inactiva.',payroll_capture_cost_center_invalid:'El centro de costo no está habilitado para la empresa.',payroll_capture_version_conflict:'La captura cambió. Recarga antes de continuar.',payroll_capture_session_expired:'La sesión de captura expiró.',payroll_capture_materialized_locked:'La corrida ya fue materializada y sus datos de captura están congelados.',payroll_capture_spei_validation_required:'El TXT SPEI no pasó el diagnóstico certificado.',payroll_capture_toka_funding_validation_required:'El TXT de fondeo TOKA no es válido para esta captura.',PAYROLL_TOKA_FUNDING_VARIANCE_REVIEW_REQUIRED:'Finanzas debe reconocer la diferencia de fondeo TOKA antes de enviar.',PAYROLL_SERVER_PACKAGE_VALIDATION_FAILED:'Los archivos no conciliaron entre sí en la verificación del servidor.',PAYROLL_SOURCE_ACCOUNT_MISMATCH:'La cuenta origen codificada en los layouts no coincide con la cuenta seleccionada.',PAYROLL_REQUIRED_FILES_MISSING:'Faltan archivos obligatorios del paquete.',PAYROLL_COVER_SHEET_SERVER_PARSE_FAILED:'La carátula no coincide con el contrato físico certificado.',PAYROLL_SAME_BANK_SERVER_PARSE_FAILED:'El archivo BBVA mismo banco no coincide con Nómina 108.',PAYROLL_TOKA_CFDI_SERVER_PARSE_FAILED:'El CFDI TOKA no coincide con el contrato certificado.',PAYROLL_TOKA_FUNDING_SERVER_PARSE_FAILED:'El TXT de fondeo TOKA no coincide con el contrato certificado.'};const key=Object.keys(map).find(function(k){return message.includes(k);});return key?map[key]:message;}
  function escapeHtml(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
  function waitForElement(id){return new Promise(function(resolve){const existing=document.getElementById(id);if(existing)return resolve(existing);const observer=new MutationObserver(function(){const el=document.getElementById(id);if(!el)return;observer.disconnect();resolve(el);});observer.observe(document.documentElement,{childList:true,subtree:true});});}

  window.FluxPayrollCapture=Object.freeze({isActive:function(){return state.active;},handleCompanyChange,reset:function(){resetCapture(false);syncRequestMode();}});
})();
