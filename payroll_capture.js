(function () {
  'use strict';

  if (window.__fluxPayrollCaptureN2BLoaded) return;
  window.__fluxPayrollCaptureN2BLoaded = true;

  const FINANCE_ROLES = ['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'];
  const BUCKET = 'payroll-private';
  const MAX_BYTES = 25 * 1024 * 1024;
  const SLOT_CONFIG = Object.freeze({
    caratula: Object.freeze({
      kind: 'caratula',
      extension: 'xlsx',
      mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    }),
    layout_mismo_banco: Object.freeze({
      kind: 'layout_mismo_banco',
      extension: 'txt',
      mimes: ['text/plain']
    }),
    layout_spei: Object.freeze({
      kind: 'layout_spei',
      extension: 'txt',
      mimes: ['text/plain']
    }),
    cfdi_vales: Object.freeze({
      kind: 'cfdi_vales',
      extension: 'xml',
      mimes: ['application/xml', 'text/xml']
    })
  });

  const state = {
    active: false,
    initialized: false,
    saving: false,
    sessionId: null,
    sessionVersion: null,
    persistedCompanyId: null,
    persistedSourceAccountId: null,
    sessions: [],
    accounts: [],
    files: {},
    observer: null,
    sessionsLoadError: false,
    accountsLoadError: false
  };

  const dom = {};

  onReady(init);

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  async function init() {
    if ((window.location.pathname.split('/').pop() || '').toLowerCase() !== 'solicitudes.html') return;
    if (window.FluxAuth?.ready) await window.FluxAuth.ready();
    await waitForElement('requestType');
    cacheBaseDom();
    syncPayrollOptionVisibility();

    state.observer = new MutationObserver(function () {
      syncPayrollOptionVisibility();
    });
    state.observer.observe(dom.requestForm, { childList: true, subtree: true });

    if (!hasFinanceRole()) return;
    injectCaptureSection();
    injectCaptureBoard();
    bindEvents();
    state.initialized = true;
    const loads = await Promise.allSettled([loadSourceAccounts(), loadSessions()]);
    state.accountsLoadError = loads[0].status === 'rejected';
    state.sessionsLoadError = loads[1].status === 'rejected';
    if (state.accountsLoadError) state.accounts = [];
    if (state.sessionsLoadError) state.sessions = [];
    const loadFailure = loads.find(function (result) { return result.status === 'rejected'; });
    if (loadFailure) notify('Captura N2B no disponible', friendlyError(loadFailure.reason), 'warning');
    renderSourceAccounts();
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

  function injectCaptureSection() {
    if (document.getElementById('payrollCaptureSection')) return;
    const firstSection = dom.requestForm.querySelector('.form-sections .form-section');
    firstSection.insertAdjacentHTML('afterend', `
      <section class="form-section payroll-capture-section hidden" id="payrollCaptureSection" aria-labelledby="payrollCaptureTitle">
        <div class="payroll-section-heading">
          <div>
            <span class="payroll-dev-pill">DEV · N2B</span>
            <h3 id="payrollCaptureTitle">Captura de nómina</h3>
            <p>Sesión temporal privada. Todavía no es una solicitud de pago ni entra a aprobación.</p>
          </div>
          <button class="secondary-btn" id="payrollNewCaptureBtn" type="button">Nueva captura</button>
        </div>

        <label class="full-row">Reanudar captura guardada
          <select id="payrollDraftSelect" class="form-control">
            <option value="">Nueva captura</option>
          </select>
          <span class="field-hint">Solo se muestran sesiones privadas vigentes para Finanzas.</span>
        </label>

        <div class="form-grid payroll-metadata-grid">
          <label>Tipo de corrida *
            <select id="payrollSubtype" class="form-control" required>
              <option value="ordinaria">Ordinaria</option>
              <option value="extraordinaria">Extraordinaria</option>
            </select>
          </label>
          <label>Cuenta origen *
            <select id="payrollSourceAccount" class="form-control" required>
              <option value="">Selecciona empresa primero</option>
            </select>
            <span class="field-hint">La cuenta se filtra por empresa y siempre se muestra enmascarada.</span>
          </label>
          <label>Periodo inicio *
            <input id="payrollPeriodStart" class="form-control" type="date" required>
          </label>
          <label>Periodo fin *
            <input id="payrollPeriodEnd" class="form-control" type="date" required>
          </label>
        </div>

        <fieldset class="payroll-channel-picker">
          <legend>Canales esperados *</legend>
          <p>Decláralos mientras la carátula no tenga adapter certificado. No se crean canales de importe cero.</p>
          <label><input type="checkbox" value="banco" data-payroll-channel> BBVA mismo banco</label>
          <label><input type="checkbox" value="spei" data-payroll-channel> SPEI</label>
          <label><input type="checkbox" value="vales" data-payroll-channel> Vales / TOKA</label>
        </fieldset>

        <div class="payroll-package-heading">
          <div><h3>Paquete de nómina</h3><p>La selección se valida localmente antes de cualquier upload.</p></div>
          <span class="payroll-private-pill">Privado · Finanzas</span>
        </div>

        <div class="payroll-file-grid">
          <article class="payroll-file-card" data-payroll-card="caratula">
            <div class="payroll-file-card-head"><strong>Carátula XLSX</strong><span>Obligatoria</span></div>
            <p>Puede resguardarse; la extracción permanece bloqueada hasta certificar la fuente física.</p>
            <input id="payrollCoverFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Seleccionar carátula XLSX" aria-describedby="payrollCoverStatus">
            <div class="payroll-file-status" id="payrollCoverStatus" data-payroll-status="caratula"></div>
          </article>

          <article class="payroll-file-card" data-payroll-card="layout_mismo_banco">
            <div class="payroll-file-card-head"><strong>BBVA mismo banco TXT</strong><span>Condicional</span></div>
            <p>Se resguarda como metadata; no se interpretan posiciones mientras falte el output físico certificado.</p>
            <input id="payrollSameBankFile" type="file" accept=".txt,text/plain" aria-label="Seleccionar TXT BBVA mismo banco" aria-describedby="payrollSameBankStatus" disabled>
            <div class="payroll-file-status" id="payrollSameBankStatus" data-payroll-status="layout_mismo_banco"></div>
          </article>

          <article class="payroll-file-card payroll-file-card-certified" data-payroll-card="layout_spei">
            <div class="payroll-file-card-head"><strong>SPEI TXT</strong><span>Adapter certificado</span></div>
            <p>Valida bytes, registros, cuenta origen e importe con el contrato payroll N2A.</p>
            <input id="payrollSpeiFile" type="file" accept=".txt,text/plain" aria-label="Seleccionar TXT SPEI" aria-describedby="payrollSpeiStatus" disabled>
            <div class="payroll-file-status" id="payrollSpeiStatus" data-payroll-status="layout_spei"></div>
          </article>

          <article class="payroll-file-card payroll-file-card-locked" data-payroll-card="toka_transfer_xlsm">
            <div class="payroll-file-card-head"><strong>Transferencia agregada TOKA</strong><span>Evidencia generadora</span></div>
            <p>El XLSM histórico no es un input operativo. N2B no lo solicita, no lo sube y no crea líneas por persona.</p>
            <div class="payroll-file-status"><span class="payroll-state neutral">No carga operativa XLSM</span></div>
          </article>

          <article class="payroll-file-card" data-payroll-card="cfdi_vales">
            <div class="payroll-file-card-head"><strong>XML TOKA / vales</strong><span>Condicional</span></div>
            <p>Documento separado del XLSM. Se resguarda, pero el desglose por persona sigue pendiente de contrato.</p>
            <input id="payrollTokaXmlFile" type="file" accept=".xml,application/xml,text/xml" aria-label="Seleccionar XML TOKA o vales" aria-describedby="payrollTokaXmlStatus" disabled>
            <div class="payroll-file-status" id="payrollTokaXmlStatus" data-payroll-status="cfdi_vales"></div>
          </article>
        </div>

        <section class="payroll-validation-panel" aria-live="polite">
          <div>
            <span class="payroll-summary-label">Estado de corrida</span>
            <strong id="payrollCaptureState">Archivos pendientes</strong>
          </div>
          <div>
            <span class="payroll-summary-label">Monto total</span>
            <strong id="payrollCalculatedTotal">Pendiente de validación</strong>
          </div>
          <div>
            <span class="payroll-summary-label">Registros SPEI</span>
            <strong id="payrollSpeiCount">Pendiente</strong>
          </div>
          <div class="payroll-issues" id="payrollIssues"></div>
          <p class="payroll-pii-note">La vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias.</p>
        </section>
      </section>
    `);

    dom.section = document.getElementById('payrollCaptureSection');
    dom.draftSelect = document.getElementById('payrollDraftSelect');
    dom.subtype = document.getElementById('payrollSubtype');
    dom.sourceAccount = document.getElementById('payrollSourceAccount');
    dom.periodStart = document.getElementById('payrollPeriodStart');
    dom.periodEnd = document.getElementById('payrollPeriodEnd');
    dom.captureState = document.getElementById('payrollCaptureState');
    dom.total = document.getElementById('payrollCalculatedTotal');
    dom.speiCount = document.getElementById('payrollSpeiCount');
    dom.issues = document.getElementById('payrollIssues');

    const approval = document.createElement('button');
    approval.id = 'payrollApprovalBtn';
    approval.className = 'primary-btn payroll-approval-disabled hidden';
    approval.type = 'button';
    approval.disabled = true;
    approval.textContent = 'Validación completa — flujo de aprobación pendiente de habilitar';
    dom.submit.insertAdjacentElement('afterend', approval);
    dom.approval = approval;
  }

  function injectCaptureBoard() {
    if (document.getElementById('payrollCaptureBoard')) return;
    const stats = document.querySelector('.stats-grid');
    stats?.insertAdjacentHTML('afterend', `
      <section class="payroll-capture-board" id="payrollCaptureBoard">
        <div class="payroll-board-heading">
          <div><span class="payroll-dev-pill">Nómina N2B</span><h2>Capturas en progreso</h2><p>Staging privado; ninguna fila es todavía una solicitud de pago.</p></div>
          <span class="payroll-private-pill">Finance only</span>
        </div>
        <div id="payrollCaptureBoardList" class="payroll-board-list"><p>Cargando capturas…</p></div>
      </section>
    `);
    dom.board = document.getElementById('payrollCaptureBoard');
    dom.boardList = document.getElementById('payrollCaptureBoardList');
  }

  function bindEvents() {
    dom.requestType.addEventListener('change', syncRequestMode);
    dom.requestForm.addEventListener('submit', submitPayrollCapture, true);
    dom.requestDialog.addEventListener('close', function () {
      if (!state.saving) resetCapture();
    });
    dom.companyId.addEventListener('change', handleCompanyChange);
    dom.sourceAccount.addEventListener('change', handleSourceAccountChange);
    dom.draftSelect.addEventListener('change', function () {
      const session = state.sessions.find(function (item) { return item.id === dom.draftSelect.value; });
      if (session) hydrateSession(session);
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
    bindFile('payrollCoverFile', 'caratula');
    bindFile('payrollSameBankFile', 'layout_mismo_banco');
    bindFile('payrollSpeiFile', 'layout_spei');
    bindFile('payrollTokaXmlFile', 'cfdi_vales');
    dom.boardList.addEventListener('click', function (event) {
      const button = event.target.closest('[data-payroll-resume]');
      if (!button) return;
      const session = state.sessions.find(function (item) { return item.id === button.dataset.payrollResume; });
      if (!session) return;
      document.getElementById('newRequestBtn')?.click();
      window.setTimeout(function () {
        dom.requestType.value = 'nomina';
        dom.requestType.dispatchEvent(new Event('change', { bubbles: true }));
        hydrateSession(session);
      }, 40);
    });
  }

  function bindFile(id, slot) {
    document.getElementById(id).addEventListener('change', async function (event) {
      const file = event.target.files?.[0] || null;
      if (!file) {
        delete state.files[slot];
        renderCapture();
        return;
      }
      event.target.disabled = true;
      try {
        state.files[slot] = await inspectFile(slot, file);
      } catch (_) {
        state.files[slot] = {
          present: true,
          status: 'parser_error',
          uploadable: false,
          issueCodes: ['PARSER_ERROR']
        };
      } finally {
        syncConditionalInputs();
        renderCapture();
      }
    });
  }

  async function inspectFile(slot, file) {
    const config = SLOT_CONFIG[slot];
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (!config || extension !== config.extension || !config.mimes.includes(file.type) || file.size < 1 || file.size > MAX_BYTES) {
      throw new Error('PAYROLL_FILE_METADATA_INVALID');
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (slot === 'caratula' && !isZipSignature(bytes)) throw new Error('PAYROLL_XLSX_SIGNATURE_INVALID');
    if ((slot === 'layout_mismo_banco' || slot === 'layout_spei') && hasBinaryNull(bytes)) {
      throw new Error('PAYROLL_TXT_SIGNATURE_INVALID');
    }
    if (slot === 'cfdi_vales' && !looksLikeXml(bytes)) throw new Error('PAYROLL_XML_SIGNATURE_INVALID');

    const sha256 = await sha256Hex(buffer);
    const base = {
      present: true,
      uploadable: true,
      uploaded: false,
      file,
      extension,
      mimeType: file.type,
      sizeBytes: file.size,
      sha256
    };

    if (slot === 'layout_spei') {
      const summary = window.FluxPayrollParser.summarizePayrollSpeiForCapture(
        buffer,
        selectedSourceAccountCandidates()
      );
      if (!summary.valid) {
        return Object.assign(base, {
          status: 'parser_error',
          uploadable: false,
          parserSummary: summary,
          issueCodes: ['PARSER_ERROR']
        });
      }
      return Object.assign(base, {
        status: 'parsed',
        parserSummary: summary,
        recordCount: summary.recordCount,
        totalAmountMinor: summary.totalAmountMinor,
        issueCodes: []
      });
    }

    return Object.assign(base, {
      status: 'blocked',
      issueCodes: ['FORMAT_NOT_CERTIFIED']
    });
  }

  function isZipSignature(bytes) {
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (
      (bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08)
    );
  }

  function hasBinaryNull(bytes) {
    const limit = Math.min(bytes.length, 4096);
    for (let index = 0; index < limit; index += 1) {
      if (bytes[index] === 0) return true;
    }
    return false;
  }

  function looksLikeXml(bytes) {
    try {
      const sample = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(0, 512));
      return sample.replace(/^\uFEFF/, '').trimStart().startsWith('<');
    } catch (_) {
      return false;
    }
  }

  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, '0');
    }).join('');
  }

  function selectedSourceAccountCandidates() {
    const account = state.accounts.find(function (item) { return item.id === dom.sourceAccount.value; });
    if (!account) return [];
    return [account.account_number, account.clabe]
      .map(function (value) { return String(value || '').replace(/\D/g, ''); })
      .filter(Boolean);
  }

  function syncRequestMode() {
    const next = dom.requestType.value === 'nomina' && hasFinanceRole();
    state.active = next;
    applyRequestMode();
    if (next) {
      handleCompanyChange();
      renderCapture();
    }
  }

  function applyRequestMode() {
    if (!dom.section) return;
    const payroll = state.active;
    dom.section.classList.toggle('hidden', !payroll);
    dom.approval.classList.toggle('hidden', !payroll);
    dom.requestForm.querySelector('.request-layout')?.classList.toggle('payroll-mode', payroll);
    dom.requestForm.querySelector('.summary-panel')?.classList.toggle('hidden', payroll);

    const fieldIds = [
      'costCenterId', 'budgetCategorySearch', 'budgetCategoryId', 'budgetMonth',
      'providerSearch', 'proveedorId', 'paymentMethod', 'requestFile', 'approverId',
      'amountRequested', 'currency', 'exchangeRate', 'isExtraordinaryAdjustment'
    ];
    const hiddenTargets = new Set();
    fieldIds.forEach(function (id) {
      const control = document.getElementById(id);
      if (!control) return;
      // Hide only the provider-payment field itself. Hiding its nearest
      // section can also remove shared payroll fields such as concept/notes
      // when extensions compose the form differently at runtime.
      const target = control.closest('label');
      if (target) hiddenTargets.add(target);
      setControlMode(control, payroll);
    });
    hiddenTargets.forEach(function (target) { target.classList.toggle('hidden', payroll); });
    document.getElementById('approverSelectionSection')?.classList.toggle('hidden', payroll);
    if (payroll) document.getElementById('cashCheckSection')?.classList.add('hidden');

    dom.section.querySelectorAll('input,select,textarea').forEach(function (control) {
      control.disabled = !payroll || control.dataset.payrollConditionalDisabled === 'true';
    });
    syncConditionalInputs();

    const title = dom.requestForm.querySelector('.modal-header h2');
    const copy = dom.requestForm.querySelector('.modal-header p');
    const descriptionSection = dom.description.closest('.form-section');
    if (payroll) {
      if (title) title.textContent = 'Nueva captura de nómina';
      if (copy) copy.textContent = 'Guarda metadata y archivos privados sin crear todavía una solicitud de pago.';
      if (descriptionSection?.querySelector('h3')) descriptionSection.querySelector('h3').textContent = 'Concepto / descripción';
      dom.submit.textContent = 'Guardar captura segura';
    } else {
      if (title) title.textContent = 'Nueva solicitud de pago';
      if (copy) copy.textContent = 'Completa los datos operativos y financieros para validar presupuesto al guardar.';
      if (descriptionSection?.querySelector('h3')) descriptionSection.querySelector('h3').textContent = 'Descripcion';
      dom.submit.textContent = 'Crear solicitud';
    }
  }

  function setControlMode(control, payroll) {
    if (control.dataset.payrollOriginalRequired === undefined) {
      control.dataset.payrollOriginalRequired = control.required ? 'true' : 'false';
    }
    control.required = payroll ? false : control.dataset.payrollOriginalRequired === 'true';
    control.disabled = payroll;
  }

  function expectedChannels() {
    return Array.from(document.querySelectorAll('[data-payroll-channel]:checked'))
      .map(function (input) { return input.value; });
  }

  function handleChannelChange(input) {
    if (input.checked) return true;
    const slotByChannel = {
      banco: 'layout_mismo_banco',
      spei: 'layout_spei',
      vales: 'cfdi_vales'
    };
    const inputBySlot = {
      layout_mismo_banco: 'payrollSameBankFile',
      layout_spei: 'payrollSpeiFile',
      cfdi_vales: 'payrollTokaXmlFile'
    };
    const slot = slotByChannel[input.value];
    const file = state.files[slot];
    if (file?.uploaded) {
      input.checked = true;
      notify('Canal protegido', 'No puedes retirar un canal después de subir su archivo. Crea una captura nueva.', 'warning');
      return false;
    }
    if (file?.file) {
      delete state.files[slot];
      const fileInput = document.getElementById(inputBySlot[slot]);
      if (fileInput) fileInput.value = '';
      notify('Archivo retirado', 'El archivo local se descartó al retirar el canal esperado.', 'warning');
    }
    return true;
  }

  function syncConditionalInputs() {
    if (!dom.section) return;
    const channels = expectedChannels();
    const map = {
      payrollSameBankFile: channels.includes('banco'),
      payrollSpeiFile: channels.includes('spei'),
      payrollTokaXmlFile: channels.includes('vales')
    };
    Object.entries(map).forEach(function (entry) {
      const input = document.getElementById(entry[0]);
      if (!input) return;
      const slot = input.id === 'payrollSameBankFile' ? 'layout_mismo_banco'
        : input.id === 'payrollSpeiFile' ? 'layout_spei' : 'cfdi_vales';
      const lockedByInspection = Boolean(state.files[slot]?.file && state.files[slot]?.uploadable === undefined);
      input.disabled = !state.active || !entry[1] || lockedByInspection;
      input.dataset.payrollConditionalDisabled = entry[1] ? 'false' : 'true';
    });
    const cover = document.getElementById('payrollCoverFile');
    if (cover) cover.disabled = !state.active;
  }

  async function handleCompanyChange() {
    if (!state.active || !dom.sourceAccount) return;
    const hasPersistedFile = Object.values(state.files).some(function (file) { return file.uploaded; });
    if (
      state.sessionId &&
      state.persistedCompanyId &&
      dom.companyId.value !== state.persistedCompanyId &&
      hasPersistedFile
    ) {
      dom.companyId.value = state.persistedCompanyId;
      renderSourceAccounts();
      dom.sourceAccount.value = state.persistedSourceAccountId || '';
      notify('Empresa protegida', 'La empresa queda fija después de subir un archivo. Crea una captura nueva para cambiarla.', 'warning');
      return;
    }
    renderSourceAccounts();
    clearLocalFileSelections();
    renderCapture();
  }

  function handleSourceAccountChange() {
    if (!state.active) return;
    if (
      state.sessionId &&
      state.persistedSourceAccountId &&
      state.files.layout_spei?.uploaded &&
      dom.sourceAccount.value !== state.persistedSourceAccountId
    ) {
      dom.sourceAccount.value = state.persistedSourceAccountId;
      notify('Cuenta origen protegida', 'La cuenta queda fija después de validar SPEI. Crea una captura nueva para cambiarla.', 'warning');
      return;
    }
    if (state.files.layout_spei?.file) {
      delete state.files.layout_spei;
      document.getElementById('payrollSpeiFile').value = '';
      notify('Revalida SPEI', 'La cuenta origen cambió; vuelve a seleccionar el TXT SPEI.', 'warning');
    }
    renderCapture();
  }

  function clearLocalFileSelections() {
    let cleared = false;
    Object.entries(state.files).forEach(function (entry) {
      if (!entry[1].file) return;
      delete state.files[entry[0]];
      cleared = true;
    });
    ['payrollCoverFile', 'payrollSameBankFile', 'payrollSpeiFile', 'payrollTokaXmlFile'].forEach(function (id) {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    if (cleared) notify('Revalida archivos', 'La empresa cambió; vuelve a seleccionar los archivos de esta captura.', 'warning');
  }

  async function loadSourceAccounts() {
    const client = getClient();
    if (!client) return;
    const result = await client.from('company_bank_accounts')
      .select('id,company_id,name,bank_name,currency,account_type,last4,account_number,clabe,active')
      .eq('active', true)
      .eq('account_type', 'bank')
      .eq('currency', 'MXN')
      .order('name', { ascending: true });
    if (result.error) throw result.error;
    state.accounts = result.data || [];
    state.accountsLoadError = false;
  }

  function renderSourceAccounts() {
    if (!dom.sourceAccount) return;
    if (state.accountsLoadError) {
      dom.sourceAccount.innerHTML = '<option value="">Cuentas origen no disponibles</option>';
      return;
    }
    const companyId = dom.companyId.value;
    const previous = dom.sourceAccount.value;
    const options = state.accounts.filter(function (account) { return account.company_id === companyId; });
    dom.sourceAccount.innerHTML = '<option value="">Seleccionar cuenta origen</option>' + options.map(function (account) {
      const digits = String(account.last4 || account.account_number || account.clabe || '').replace(/\D/g, '');
      const masked = digits ? '•••• ' + digits.slice(-4) : 'Cuenta enmascarada';
      return '<option value="' + escapeHtml(account.id) + '">' +
        escapeHtml([account.name, account.bank_name, masked, account.currency].filter(Boolean).join(' · ')) +
        '</option>';
    }).join('');
    if (options.some(function (account) { return account.id === previous; })) dom.sourceAccount.value = previous;
  }

  async function loadSessions() {
    const client = getClient();
    if (!client) return;
    const result = await client.rpc('get_payroll_capture_sessions', { p_session_id: null });
    if (result.error) throw result.error;
    state.sessions = Array.isArray(result.data) ? result.data : [];
    state.sessionsLoadError = false;
    renderDraftOptions();
  }

  function renderDraftOptions() {
    if (!dom.draftSelect) return;
    dom.draftSelect.innerHTML = '<option value="">Nueva captura</option>' + state.sessions.map(function (session) {
      const label = [
        session.concept,
        session.period_start + ' → ' + session.period_end,
        captureStateLabel(session.capture_state)
      ].filter(Boolean).join(' · ');
      return '<option value="' + escapeHtml(session.id) + '">' + escapeHtml(label) + '</option>';
    }).join('');
    if (state.sessionId) dom.draftSelect.value = state.sessionId;
  }

  function renderCaptureBoard() {
    if (!dom.boardList) return;
    if (state.sessionsLoadError) {
      dom.boardList.innerHTML = '<div class="payroll-board-empty">La captura N2B todavía no está disponible en este ambiente.</div>';
      return;
    }
    if (!state.sessions.length) {
      dom.boardList.innerHTML = '<div class="payroll-board-empty">Aún no hay capturas de nómina en staging.</div>';
      return;
    }
    dom.boardList.innerHTML = state.sessions.map(function (session) {
      const company = (typeof companies !== 'undefined' ? companies : []).find(function (item) { return item.id === session.company_id; });
      return `<article class="payroll-board-item">
        <div><strong>${escapeHtml(session.concept)}</strong><span>${escapeHtml(session.period_start)} → ${escapeHtml(session.period_end)}</span></div>
        <div><span>${escapeHtml(company?.name || company?.legal_name || 'Empresa')}</span><span class="payroll-state warning">${escapeHtml(captureStateLabel(session.capture_state))}</span></div>
        <button class="secondary-btn" type="button" data-payroll-resume="${escapeHtml(session.id)}">Continuar captura</button>
      </article>`;
    }).join('');
  }

  function hydrateSession(session) {
    state.sessionId = session.id;
    state.sessionVersion = session.version;
    state.persistedCompanyId = session.company_id;
    state.persistedSourceAccountId = session.company_bank_account_id;
    state.files = {};
    ['payrollCoverFile', 'payrollSameBankFile', 'payrollSpeiFile', 'payrollTokaXmlFile'].forEach(function (id) {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    dom.companyId.value = session.company_id;
    renderSourceAccounts();
    dom.sourceAccount.value = session.company_bank_account_id;
    dom.subtype.value = session.payroll_subtype;
    dom.periodStart.value = session.period_start;
    dom.periodEnd.value = session.period_end;
    dom.description.value = session.concept;
    dom.notes.value = session.notes || '';
    document.querySelectorAll('[data-payroll-channel]').forEach(function (input) {
      input.checked = (session.expected_channels || []).includes(input.value);
    });
    (session.files || []).forEach(function (file) {
      state.files[file.kind] = {
        present: true,
        uploaded: true,
        uploadable: false,
        status: file.parsing_status,
        recordCount: file.record_count,
        totalAmountMinor: file.total_amount_minor,
        issueCodes: file.issue_codes || []
      };
    });
    dom.draftSelect.value = session.id;
    syncConditionalInputs();
    renderCapture();
  }

  function resetCapture(keepPayrollMode) {
    state.sessionId = null;
    state.sessionVersion = null;
    state.persistedCompanyId = null;
    state.persistedSourceAccountId = null;
    state.files = {};
    if (dom.draftSelect) dom.draftSelect.value = '';
    if (dom.subtype) dom.subtype.value = 'ordinaria';
    if (dom.sourceAccount) dom.sourceAccount.value = '';
    if (dom.periodStart) dom.periodStart.value = '';
    if (dom.periodEnd) dom.periodEnd.value = '';
    document.querySelectorAll('[data-payroll-channel]').forEach(function (input) { input.checked = false; });
    ['payrollCoverFile', 'payrollSameBankFile', 'payrollSpeiFile', 'payrollTokaXmlFile'].forEach(function (id) {
      const input = document.getElementById(id);
      if (input) input.value = '';
    });
    if (keepPayrollMode && dom.requestType) {
      dom.requestType.value = 'nomina';
      state.active = true;
    }
    syncConditionalInputs();
    renderCapture();
  }

  function captureFilesForModel() {
    const result = {};
    Object.entries(state.files).forEach(function (entry) {
      const file = entry[1];
      result[entry[0]] = {
        present: file.present,
        status: file.status,
        recordCount: file.recordCount,
        totalAmountMinor: file.totalAmountMinor
      };
    });
    return result;
  }

  function renderCapture() {
    if (!dom.section || !window.FluxPayrollParser) return;
    const evaluation = window.FluxPayrollParser.evaluatePayrollCapture({
      expectedChannels: expectedChannels(),
      files: captureFilesForModel()
    });
    renderFileCard('caratula', true);
    renderFileCard('layout_mismo_banco', expectedChannels().includes('banco'));
    renderFileCard('layout_spei', expectedChannels().includes('spei'));
    renderFileCard('cfdi_vales', expectedChannels().includes('vales'));
    dom.captureState.textContent = captureStateLabel(evaluation.captureState);
    dom.total.textContent = evaluation.totalAmountMinor === null
      ? 'Pendiente de validación'
      : formatMinor(evaluation.totalAmountMinor);
    const spei = state.files.layout_spei;
    dom.speiCount.textContent = ['parsed', 'client_parsed_unverified'].includes(spei?.status)
      ? String(spei.recordCount)
      : 'Pendiente';
    dom.issues.innerHTML = evaluation.issues.length
      ? evaluation.issues.map(function (item) {
          return '<span class="payroll-issue-chip">' + escapeHtml(item.type) + ' · ' + escapeHtml(slotLabel(item.source)) + '</span>';
        }).join('')
      : '<span class="payroll-issue-chip">Sin issues locales</span>';
  }

  function renderFileCard(slot, required) {
    const target = document.querySelector('[data-payroll-status="' + slot + '"]');
    if (!target) return;
    const file = state.files[slot];
    if (!required) {
      target.innerHTML = '<span class="payroll-state neutral">No requerido</span>';
      return;
    }
    if (!file) {
      target.innerHTML = '<span class="payroll-state warning">Pendiente de archivo</span><small>MISSING_USER_FILE</small>';
      return;
    }
    if (file.status === 'parsed' || file.status === 'client_parsed_unverified') {
      target.innerHTML = '<span class="payroll-state success">Parser local PASS</span><small>' +
        escapeHtml(String(file.recordCount)) + ' registros · ' + escapeHtml(formatMinor(file.totalAmountMinor)) +
        ' · N3 deberá revalidar los bytes</small>';
      return;
    }
    if (file.status === 'parser_error' || file.status === 'failed') {
      target.innerHTML = '<span class="payroll-state danger">Error de formato</span><small>PARSER_ERROR · no se subirá</small>';
      return;
    }
    if (file.uploaded && slot === 'caratula') {
      target.innerHTML = '<span class="payroll-state warning">Carátula recibida</span><small>El formato aún requiere validación para extracción automática · FORMAT_NOT_CERTIFIED</small>';
      return;
    }
    if (file.uploaded) {
      target.innerHTML = '<span class="payroll-state warning">Archivo privado recibido</span><small>Formato pendiente de certificar · FORMAT_NOT_CERTIFIED</small>';
      return;
    }
    target.innerHTML = '<span class="payroll-state warning">Formato pendiente de certificar</span><small>FORMAT_NOT_CERTIFIED</small>';
  }

  async function submitPayrollCapture(event) {
    if (!state.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (state.saving) return;

    const validation = validateMetadata();
    if (validation) {
      notify('Revisa la captura', validation, 'warning');
      return;
    }

    const client = getClient();
    if (!client) return notify('Sin conexión', 'No se encontró el cliente Supabase.', 'error');
    state.saving = true;
    dom.submit.disabled = true;
    dom.submit.textContent = 'Guardando staging privado…';

    try {
      const save = await client.rpc('save_payroll_capture_session', {
        p_session_id: state.sessionId,
        p_expected_version: state.sessionVersion,
        p_company_id: dom.companyId.value,
        p_company_bank_account_id: dom.sourceAccount.value,
        p_payroll_subtype: dom.subtype.value,
        p_period_start: dom.periodStart.value,
        p_period_end: dom.periodEnd.value,
        p_concept: dom.description.value.trim(),
        p_notes: dom.notes.value.trim() || null,
        p_expected_channels: expectedChannels()
      });
      if (save.error) throw save.error;
      state.sessionId = save.data.id;
      state.sessionVersion = save.data.version;

      const uploads = Object.entries(state.files).filter(function (entry) {
        return entry[1].uploadable && !entry[1].uploaded;
      });
      for (const entry of uploads) await uploadReservedFile(client, entry[0], entry[1]);

      await loadSessions();
      const current = state.sessions.find(function (item) { return item.id === state.sessionId; });
      if (current) hydrateSession(current);
      renderCaptureBoard();
      notify('Captura guardada', 'El staging privado quedó disponible para continuar después. No se creó una solicitud ni un evento de aprobación.', 'success');
    } catch (error) {
      notify('No se pudo guardar la captura', friendlyError(error), 'error');
    } finally {
      state.saving = false;
      dom.submit.disabled = false;
      dom.submit.textContent = 'Guardar captura segura';
    }
  }

  async function uploadReservedFile(client, slot, fileState) {
    const config = SLOT_CONFIG[slot];
    const summary = fileState.parserSummary || {};
    const reservation = await client.rpc('reserve_payroll_capture_file', {
      p_session_id: state.sessionId,
      p_expected_version: state.sessionVersion,
      p_kind: config.kind,
      p_extension: fileState.extension,
      p_mime_type: fileState.mimeType,
      p_size_bytes: fileState.sizeBytes,
      p_sha256: fileState.sha256,
      p_parser_version: slot === 'layout_spei' ? summary.parserVersion : null,
      p_parser_contract: slot === 'layout_spei' ? summary.contractVersion : null,
      p_record_count: slot === 'layout_spei' ? summary.recordCount : null,
      p_total_amount_minor: slot === 'layout_spei' ? summary.totalAmountMinor : null
    });
    if (reservation.error) throw reservation.error;

    const upload = await client.storage.from(BUCKET).upload(
      reservation.data.storage_path,
      fileState.file,
      { contentType: fileState.mimeType, upsert: false }
    );
    if (upload.error) throw upload.error;

    const confirmation = await client.rpc('confirm_payroll_capture_file', {
      p_file_id: reservation.data.file_id,
      p_sha256: fileState.sha256
    });
    if (confirmation.error) throw confirmation.error;
    state.sessionVersion = confirmation.data.version;
    fileState.uploaded = true;
    fileState.uploadable = false;
    delete fileState.file;
    delete fileState.parserSummary;
  }

  function validateMetadata() {
    if (!hasFinanceRole()) return 'La captura de nómina es exclusiva de Finanzas.';
    if (!dom.companyId.value) return 'Selecciona una empresa.';
    if (!dom.sourceAccount.value) return 'Selecciona una cuenta origen de la empresa.';
    if (!['ordinaria', 'extraordinaria'].includes(dom.subtype.value)) return 'Selecciona el tipo de corrida.';
    if (!dom.periodStart.value || !dom.periodEnd.value || dom.periodStart.value > dom.periodEnd.value) return 'Captura un periodo válido.';
    if (dom.description.value.trim().length < 3) return 'Captura el concepto o descripción.';
    if (!expectedChannels().length) return 'Declara al menos un canal esperado.';
    return '';
  }

  function captureStateLabel(value) {
    return ({
      draft: 'Borrador',
      files_pending: 'Archivos pendientes',
      validation_pending: 'Validación pendiente',
      ready_for_submission: 'Validación completa'
    })[value] || 'Validación pendiente';
  }

  function slotLabel(value) {
    return ({
      caratula: 'Carátula',
      layout_mismo_banco: 'BBVA mismo banco',
      layout_spei: 'SPEI',
      cfdi_vales: 'TOKA / vales'
    })[value] || value || 'Captura';
  }

  function formatMinor(value) {
    if (!Number.isSafeInteger(value)) return 'Pendiente de validación';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value / 100);
  }

  function notify(title, message, variant) {
    if (typeof showToast === 'function') return showToast(title, message, variant);
    if (window.Components?.toast) return window.Components.toast(title, message, variant);
  }

  function friendlyError(error) {
    const message = String(error?.message || error || 'Error inesperado.');
    const map = {
      payroll_capture_finance_required: 'La captura de nómina es exclusiva de Finanzas.',
      payroll_capture_metadata_invalid: 'La metadata de la corrida no es válida.',
      payroll_capture_source_account_invalid: 'La cuenta origen no pertenece a la empresa o está inactiva.',
      payroll_capture_version_conflict: 'Otra sesión actualizó la captura. Recarga antes de continuar.',
      payroll_capture_session_expired: 'La sesión de captura expiró.',
      payroll_capture_company_locked_after_file_reservation: 'La empresa queda fija después de reservar un archivo. Crea una captura nueva para cambiarla.',
      payroll_capture_source_account_locked_after_spei: 'La cuenta origen queda fija después de validar SPEI. Crea una captura nueva para cambiarla.',
      payroll_capture_channel_locked_after_file_reservation: 'No puedes retirar un canal después de reservar su archivo. Crea una captura nueva.',
      payroll_capture_spei_validation_required: 'El TXT SPEI no pasó el parser certificado.',
      payroll_capture_storage_object_mismatch: 'El objeto privado no coincide con la reserva.'
    };
    const key = Object.keys(map).find(function (candidate) { return message.includes(candidate); });
    return key ? map[key] : message;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function waitForElement(id) {
    return new Promise(function (resolve) {
      const existing = document.getElementById(id);
      if (existing) return resolve(existing);
      const observer = new MutationObserver(function () {
        const element = document.getElementById(id);
        if (!element) return;
        observer.disconnect();
        resolve(element);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  window.FluxPayrollCapture = Object.freeze({
    isActive: function () { return state.active; },
    handleCompanyChange,
    reset: function () { resetCapture(false); syncRequestMode(); }
  });
})();
