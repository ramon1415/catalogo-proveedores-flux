(function () {
  'use strict';

  if (window.__fluxPayrollDispersionN4ALoaded) return;
  window.__fluxPayrollDispersionN4ALoaded = true;

  const FINANCE_ROLES = ['finance', 'finanzas', 'treasury', 'tesoreria', 'administracion'];
  const state = { queue: [], summary: null, selectedRequestId: null, saving: false };
  const dom = {};

  onReady(init);

  function onReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function getClient() {
    if (typeof window.getFluxSupabaseClient === 'function') return window.getFluxSupabaseClient();
    if (window.supabaseClient) return window.supabaseClient;
    if (window.supabase && typeof window.SUPABASE_URL !== 'undefined' && typeof window.SUPABASE_ANON_KEY !== 'undefined') {
      window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      return window.supabaseClient;
    }
    return null;
  }

  function hasFinanceRole() {
    const roles = window.FluxAuth?.getRoles?.() || [];
    return roles.map(function (role) { return String(role).toLowerCase(); })
      .some(function (role) { return FINANCE_ROLES.includes(role); });
  }

  async function init() {
    if ((window.location.pathname.split('/').pop() || '').toLowerCase() !== 'nomina_dispersion.html') return;
    cacheDom();
    dom.refresh?.addEventListener('click', loadQueue);
    dom.queue?.addEventListener('click', handleQueueClick);
    dom.detail?.addEventListener('click', handleDetailClick);

    if (window.FluxAuth?.ready) await window.FluxAuth.ready();
    const session = window.FluxAuth?.state?.session;
    if (!session) {
      window.location.href = './index.html';
      return;
    }

    const profile = window.FluxAuth?.getProfile?.();
    dom.user.textContent = profile?.full_name || profile?.email || session.user?.email || 'Finanzas';

    if (!hasFinanceRole()) {
      dom.queue.innerHTML = '<div class="n4a-empty">Esta pantalla es exclusiva de Finanzas.</div>';
      dom.detail.innerHTML = '<div class="n4a-empty">No tienes el rol requerido para registrar dispersión de Nómina.</div>';
      dom.refresh.disabled = true;
      return;
    }

    await loadQueue();
  }

  function cacheDom() {
    dom.queue = document.getElementById('payrollDispersionQueue');
    dom.detail = document.getElementById('payrollDispersionDetail');
    dom.refresh = document.getElementById('payrollDispersionRefresh');
    dom.user = document.getElementById('payrollDispersionUser');
    dom.message = document.getElementById('payrollDispersionMessage');
  }

  async function loadQueue() {
    const client = getClient();
    if (!client) return setMessage('No se encontró la conexión a Supabase.', 'error');
    dom.refresh.disabled = true;
    dom.refresh.textContent = 'Actualizando…';
    setMessage('Cargando Nóminas aprobadas…', 'neutral');
    try {
      const result = await client.rpc('get_payroll_dispersion_queue');
      if (result.error) throw result.error;
      state.queue = Array.isArray(result.data) ? result.data : [];
      renderQueue();
      if (state.selectedRequestId && state.queue.some(function (row) { return row.payment_request_id === state.selectedRequestId; })) {
        await loadSummary(state.selectedRequestId);
      } else if (state.queue.length) {
        await loadSummary(state.queue[0].payment_request_id);
      } else {
        state.selectedRequestId = null;
        state.summary = null;
        renderDetail();
      }
      setMessage(state.queue.length ? 'Lista actualizada.' : 'No hay Nóminas aprobadas pendientes de operación.', 'success');
    } catch (error) {
      setMessage(friendlyError(error), 'error');
    } finally {
      dom.refresh.disabled = false;
      dom.refresh.textContent = 'Actualizar';
    }
  }

  function renderQueue() {
    if (!state.queue.length) {
      dom.queue.innerHTML = '<div class="n4a-empty">No hay solicitudes de Nómina aprobadas para dispersión.</div>';
      return;
    }
    dom.queue.innerHTML = state.queue.map(function (row) {
      const selected = row.payment_request_id === state.selectedRequestId ? ' selected' : '';
      return '<button type="button" class="n4a-queue-item' + selected + '" data-request-id="' + escapeHtml(row.payment_request_id) + '">' +
        '<span class="n4a-queue-top"><strong>' + escapeHtml(row.request_number || 'Nómina') + '</strong>' + statusPill(row.overall_status) + '</span>' +
        '<span>' + escapeHtml(row.company_name || 'Empresa') + '</span>' +
        '<span>' + escapeHtml(formatMoney(row.amount_requested, row.currency)) + ' · ' + Number(row.dispersed_count || 0) + '/' + Number(row.channel_count || 0) + ' canales</span>' +
      '</button>';
    }).join('');
  }

  async function handleQueueClick(event) {
    const button = event.target.closest('[data-request-id]');
    if (!button) return;
    await loadSummary(button.dataset.requestId);
  }

  async function loadSummary(requestId) {
    const client = getClient();
    if (!client || !requestId) return;
    state.selectedRequestId = requestId;
    state.summary = null;
    renderQueue();
    dom.detail.innerHTML = '<div class="n4a-empty">Cargando canales…</div>';
    const result = await client.rpc('get_payroll_dispersion_summary', { p_payment_request_id: requestId });
    if (result.error) {
      dom.detail.innerHTML = '<div class="n4a-empty danger">' + escapeHtml(friendlyError(result.error)) + '</div>';
      return;
    }
    state.summary = result.data;
    renderDetail();
  }

  function renderDetail() {
    const summary = state.summary;
    if (!summary) {
      dom.detail.innerHTML = '<div class="n4a-empty">Selecciona una Nómina para revisar sus canales.</div>';
      return;
    }

    const channels = Array.isArray(summary.channels) ? summary.channels : [];
    dom.detail.innerHTML =
      '<div class="n4a-detail-head">' +
        '<div><span class="n4a-eyebrow">Dispersión manual · Finance only</span><h2>' + escapeHtml(summary.request_number || 'Nómina') + '</h2><p>' + escapeHtml(summary.company_name || '') + '</p></div>' +
        statusPill(summary.overall_status) +
      '</div>' +
      '<div class="n4a-total"><span>Salida aprobada de Tesorería</span><strong>' + escapeHtml(formatMoney(summary.amount_requested, summary.currency)) + '</strong></div>' +
      '<div class="n4a-warning">Flux no ejecuta el pago. Marca un canal como dispersado únicamente después de confirmar la operación fuera de Flux en BBVA Net Cash / TOKA.</div>' +
      '<div class="n4a-channel-list">' + channels.map(renderChannel).join('') + '</div>' +
      (summary.all_dispersed ? '<div class="n4a-complete">Todos los canales están dispersados. La conciliación con comprobantes se habilitará en N4B.</div>' : '');
  }

  function renderChannel(channel) {
    const id = escapeHtml(channel.id);
    const locked = channel.dispersion_status === 'dispersed';
    const failed = channel.dispersion_status === 'failed';
    const time = channel.dispersed_at ? formatDateTime(channel.dispersed_at) : 'Sin registro';
    return '<article class="n4a-channel-card" data-channel-id="' + id + '">' +
      '<div class="n4a-channel-head"><div><strong>' + escapeHtml(channelLabel(channel.channel)) + '</strong><span>' + escapeHtml(formatMoney(channel.amount, channel.currency)) + '</span></div>' + statusPill(channel.dispersion_status) + '</div>' +
      '<div class="n4a-channel-meta">Último registro: ' + escapeHtml(time) + '</div>' +
      (locked ? '<div class="n4a-channel-lock">Dispersión registrada · irreversible en N4A</div>' :
        '<div class="n4a-actions">' +
          '<button type="button" class="primary-btn" data-dispersion-action="dispersed" data-channel-id="' + id + '">' + (failed ? 'Registrar reintento exitoso' : 'Marcar dispersado') + '</button>' +
          (!failed ? '<button type="button" class="secondary-btn" data-failure-toggle="' + id + '">Registrar fallo</button>' : '') +
        '</div>' +
        (!failed ? '<div class="n4a-failure-form hidden" data-failure-form="' + id + '"><textarea maxlength="500" placeholder="Describe el fallo operativo (3–500 caracteres)."></textarea><button type="button" class="secondary-btn" data-dispersion-action="failed" data-channel-id="' + id + '">Guardar fallo</button></div>' : '<div class="n4a-failed-copy">Hay un fallo registrado. El siguiente cambio permitido es marcar el reintento como dispersado.</div>')) +
    '</article>';
  }

  async function handleDetailClick(event) {
    const toggle = event.target.closest('[data-failure-toggle]');
    if (toggle) {
      dom.detail.querySelector('[data-failure-form="' + cssEscape(toggle.dataset.failureToggle) + '"]')?.classList.toggle('hidden');
      return;
    }

    const actionButton = event.target.closest('[data-dispersion-action]');
    if (!actionButton || state.saving || !state.summary) return;
    const action = actionButton.dataset.dispersionAction;
    const channelId = actionButton.dataset.channelId;
    let note = null;

    if (action === 'failed') {
      const form = actionButton.closest('.n4a-failure-form');
      note = form?.querySelector('textarea')?.value.trim() || '';
      if (note.length < 3) return setMessage('Describe el fallo antes de guardarlo.', 'warning');
    } else {
      const ok = window.confirm('Confirma que este canal ya fue dispersado fuera de Flux. Esta acción queda auditada y no se puede revertir en N4A.');
      if (!ok) return;
    }

    await recordAction(channelId, action, note);
  }

  async function recordAction(channelId, action, note) {
    const client = getClient();
    if (!client || !state.summary) return;
    state.saving = true;
    setControlsDisabled(true);
    setMessage(action === 'dispersed' ? 'Registrando dispersión…' : 'Registrando fallo…', 'neutral');
    try {
      const result = await client.rpc('record_payroll_channel_dispersion', {
        p_payment_request_id: state.summary.payment_request_id,
        p_payroll_channel_id: channelId,
        p_action: action,
        p_failure_note: note || null
      });
      if (result.error) throw result.error;
      state.summary = result.data?.summary || state.summary;
      renderDetail();
      await refreshQueueOnly();
      setMessage(action === 'dispersed' ? 'Canal marcado como dispersado.' : 'Fallo operativo registrado.', action === 'dispersed' ? 'success' : 'warning');
    } catch (error) {
      setMessage(friendlyError(error), 'error');
    } finally {
      state.saving = false;
      setControlsDisabled(false);
    }
  }

  async function refreshQueueOnly() {
    const client = getClient();
    const result = await client.rpc('get_payroll_dispersion_queue');
    if (!result.error) {
      state.queue = Array.isArray(result.data) ? result.data : [];
      renderQueue();
    }
  }

  function setControlsDisabled(disabled) {
    dom.detail?.querySelectorAll('button,textarea').forEach(function (control) { control.disabled = disabled; });
  }

  function statusPill(status) {
    const labels = { pending: 'Pendiente', partial: 'Parcial', failed: 'Con fallo', dispersed: 'Dispersada', not_ready: 'No disponible' };
    return '<span class="n4a-pill ' + escapeHtml(status || 'pending') + '">' + escapeHtml(labels[status] || status || 'Pendiente') + '</span>';
  }

  function channelLabel(channel) {
    return ({ banco: 'BBVA mismo banco', spei: 'SPEI', vales: 'TOKA / vales' })[channel] || channel || 'Canal';
  }

  function formatMoney(value, currency) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(number);
  }

  function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin registro';
    return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function setMessage(message, variant) {
    if (!dom.message) return;
    dom.message.textContent = message || '';
    dom.message.dataset.variant = variant || 'neutral';
  }

  function friendlyError(error) {
    const message = String(error?.message || error || 'Error inesperado.');
    const map = {
      PAYROLL_FINANCE_REQUIRED: 'La operación de dispersión es exclusiva de Finanzas.',
      PAYROLL_DISPERSION_REQUIRES_APPROVED_REQUEST: 'La Nómina debe estar aprobada antes de registrar dispersión.',
      PAYROLL_DISPERSION_COMPANY_MEMBERSHIP_REQUIRED: 'No tienes acceso operativo a la empresa de esta Nómina.',
      PAYROLL_DISPERSION_MATERIALIZATION_REQUIRED: 'La Nómina no tiene una materialización válida.',
      PAYROLL_DISPERSION_ALREADY_FINAL: 'Este canal ya quedó dispersado y no puede revertirse en N4A.',
      PAYROLL_DISPERSION_FAILURE_NOTE_REQUIRED: 'El fallo requiere una nota de 3 a 500 caracteres.',
      PAYROLL_DISPERSION_FAILURE_ALREADY_RECORDED: 'Ya existe un fallo registrado para este intento.',
      PAYROLL_DISPERSION_RECONCILIATION_ALREADY_STARTED: 'La conciliación de este canal ya comenzó.'
    };
    const key = Object.keys(map).find(function (item) { return message.includes(item); });
    return key ? map[key] : message;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function cssEscape(value) {
    return String(value || '').replace(/[^a-zA-Z0-9_-]/g, function (char) { return '\\' + char; });
  }
})();
