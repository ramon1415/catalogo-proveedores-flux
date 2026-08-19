(function () {
  'use strict';

  if (window.__fluxPayrollQaVisualPageLoaded) return;
  window.__fluxPayrollQaVisualPageLoaded = true;

  const PRODUCTION_HOSTS = new Set(['catalogo-proveedores-flux.vercel.app', 'flux.quantta.mx']);
  const ALLOWED_ROLES = new Set([
    'sysadmin', 'system_admin', 'admin', 'superadmin',
    'finance', 'finanzas', 'treasury', 'tesoreria', 'administracion',
    'approver_2', 'aprobador_2', 'direccion', 'director'
  ]);

  const dom = {};

  onReady(init);

  function onReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function isQaHost() {
    const host = String(window.location.hostname || '').toLowerCase();
    if (!host || PRODUCTION_HOSTS.has(host)) return false;
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app');
  }

  async function init() {
    cacheDom();
    if (!isQaHost()) return blockPage('PAYROLL_QA_PRODUCTION_HOST_BLOCKED', 'Esta herramienta QA no está disponible en Producción.');
    if (window.FluxAuth?.ready) await window.FluxAuth.ready();
    const roles = (window.FluxAuth?.getRoles?.() || []).map(function (role) { return String(role).toLowerCase(); });
    if (!roles.some(function (role) { return ALLOWED_ROLES.has(role); })) {
      return blockPage('PAYROLL_QA_ROLE_REQUIRED', 'La visualización QA requiere una sesión administrativa, Dirección o Finanzas en DEV.');
    }
    renderReadyShell();
    dom.validate.addEventListener('click', validatePackage);
    validatePackage();
  }

  function cacheDom() {
    dom.guard = document.getElementById('payrollQaGuard');
    dom.validate = document.getElementById('payrollQaValidateBtn');
    dom.status = document.getElementById('payrollQaStatus');
    dom.fixtureGrid = document.getElementById('payrollQaFixtureGrid');
    dom.totalGrid = document.getElementById('payrollQaTotalGrid');
    dom.timeline = document.getElementById('payrollQaTimeline');
    dom.evidence = document.getElementById('payrollQaEvidence');
  }

  function blockPage(code, message) {
    if (dom.guard) {
      dom.guard.className = 'payroll-qa-guard blocked';
      dom.guard.innerHTML = '<strong>' + escapeHtml(code) + '</strong><span>' + escapeHtml(message) + '</span>';
    }
    if (dom.validate) dom.validate.disabled = true;
  }

  function renderReadyShell() {
    dom.guard.className = 'payroll-qa-guard ready';
    dom.guard.innerHTML = '<strong>DEV · QA SINTÉTICO</strong><span>Sin escrituras Supabase, sin correos, sin layouts y sin pagos.</span>';
    renderFixtureCards(null);
    renderTimeline([]);
  }

  async function validatePackage() {
    if (dom.validate.disabled) return;
    dom.validate.disabled = true;
    dom.validate.textContent = 'Validando paquete QA…';
    dom.status.className = 'payroll-qa-status pending';
    dom.status.textContent = 'Descargando fixtures locales y validando hashes/contratos…';
    try {
      const model = window.FluxPayrollQaVisualModel;
      const coverParser = window.FluxPayrollCoverQa;
      const sameBankParser = window.FluxPayrollSameBankQa;
      const tokaParser = window.FluxPayrollTokaQa;
      const payroll = window.FluxPayrollParser;
      if (!model || !coverParser || !sameBankParser || !tokaParser || !payroll) {
        throw new Error('PAYROLL_QA_RUNTIME_DEPENDENCY_MISSING');
      }

      const keys = ['cover', 'sameBank', 'spei', 'toka'];
      const packages = {};
      for (const key of keys) {
        const fixture = model.FIXTURES[key];
        const response = await fetch(fixture.path, { cache: 'no-store', credentials: 'same-origin' });
        if (!response.ok) throw new Error('PAYROLL_QA_FIXTURE_FETCH_FAILED_' + key.toUpperCase());
        const bytes = new Uint8Array(await response.arrayBuffer());
        const hash = await sha256Hex(bytes);
        if (hash !== fixture.sha256) throw new Error('PAYROLL_QA_FIXTURE_HASH_MISMATCH_' + key.toUpperCase());
        packages[key] = { bytes: bytes, hash: hash };
      }

      const cover = await coverParser.parse(packages.cover.bytes);
      const sameBank = sameBankParser.parse(packages.sameBank.bytes, packages.sameBank.hash);
      const spei = payroll.parsePayrollSpeiTxt(packages.spei.bytes);
      const toka = tokaParser.parse(packages.toka.bytes, packages.toka.hash);
      const result = model.evaluate({
        hashes: {
          cover: packages.cover.hash,
          sameBank: packages.sameBank.hash,
          spei: packages.spei.hash,
          toka: packages.toka.hash
        },
        cover: cover,
        sameBank: sameBank,
        spei: spei,
        toka: toka
      });

      renderFixtureCards({ cover: cover, sameBank: sameBank, spei: spei, toka: toka, hashes: packages });
      renderTotals(result);
      renderTimeline(result.stages || []);
      renderEvidence(result);

      if (!result.valid) throw new Error('PAYROLL_QA_PACKAGE_CROSSCHECK_FAILED');
      dom.status.className = 'payroll-qa-status success';
      dom.status.textContent = 'PASS · Paquete QA 4/4 · 8 personas · MXN 66,651.50 · cero acciones bancarias';
    } catch (error) {
      dom.status.className = 'payroll-qa-status danger';
      dom.status.textContent = String(error?.message || error || 'PAYROLL_QA_VISUAL_FAILED');
      renderTimeline([]);
    } finally {
      dom.validate.disabled = false;
      dom.validate.textContent = 'Revalidar paquete QA';
    }
  }

  function renderFixtureCards(result) {
    const model = window.FluxPayrollQaVisualModel;
    if (!model || !dom.fixtureGrid) return;
    const labels = {
      cover: ['Carátula XLSX', '8 personas'],
      sameBank: ['BBVA mismo banco', '3 registros'],
      spei: ['SPEI', '5 registros'],
      toka: ['TOKA / vales', '3 registros']
    };
    dom.fixtureGrid.innerHTML = Object.keys(model.FIXTURES).map(function (key) {
      const fixture = model.FIXTURES[key];
      let status = 'Pendiente';
      if (result) {
        if (key === 'spei') status = (result.spei.issues || []).length === 0 ? 'PASS' : 'FAIL';
        else status = result[key]?.valid ? 'PASS' : 'FAIL';
      }
      const statusClass = status === 'PASS' ? 'pass' : status === 'FAIL' ? 'fail' : 'pending';
      return '<article class="payroll-qa-fixture-card">' +
        '<div><strong>' + escapeHtml(labels[key][0]) + '</strong><span>' + escapeHtml(labels[key][1]) + '</span></div>' +
        '<span class="payroll-qa-mini-state ' + statusClass + '">' + status + '</span>' +
        '<code>' + escapeHtml(fixture.sha256.slice(0, 12)) + '…</code>' +
        '<a class="secondary-btn" href="' + escapeHtml(fixture.path) + '" download>Descargar fixture</a>' +
      '</article>';
    }).join('');
  }

  function renderTotals(result) {
    if (!dom.totalGrid) return;
    if (!result || !result.totals) {
      dom.totalGrid.innerHTML = '';
      return;
    }
    const items = [
      ['Personas', String(result.peopleCount)],
      ['Neto', formatMinor(result.totals.netAmountMinor)],
      ['Mismo banco', formatMinor(result.totals.bankAmountMinor)],
      ['SPEI', formatMinor(result.totals.speiAmountMinor)],
      ['Vales', formatMinor(result.totals.vouchersAmountMinor)]
    ];
    dom.totalGrid.innerHTML = items.map(function (item) {
      return '<div><span>' + escapeHtml(item[0]) + '</span><strong>' + escapeHtml(item[1]) + '</strong></div>';
    }).join('');
  }

  function renderTimeline(stages) {
    if (!dom.timeline) return;
    if (!stages.length) {
      dom.timeline.innerHTML = '<div class="payroll-qa-timeline-empty">La línea E2E aparecerá después de validar el paquete.</div>';
      return;
    }
    dom.timeline.innerHTML = stages.map(function (stage) {
      const label = stage.status === 'pass' ? 'PASS' : stage.status === 'evidence' ? 'PASS · rollback' : 'BLOCKED';
      return '<div class="payroll-qa-step ' + escapeHtml(stage.status) + '">' +
        '<span class="payroll-qa-step-dot"></span>' +
        '<div><strong>' + escapeHtml(stage.label) + '</strong><span>' + escapeHtml(stage.detail) + '</span></div>' +
        '<b>' + escapeHtml(label) + '</b>' +
      '</div>';
    }).join('');
  }

  function renderEvidence(result) {
    if (!dom.evidence) return;
    if (!result) {
      dom.evidence.textContent = '';
      return;
    }
    dom.evidence.innerHTML = [
      '<strong>Controles de seguridad del modo QA</strong>',
      '<span>qaOnly=' + String(result.qaOnly) + '</span>',
      '<span>certifiedPhysicalSource=' + String(result.certifiedPhysicalSource) + '</span>',
      '<span>serverMutation=' + String(result.serverMutation) + '</span>',
      '<span>bankAction=' + String(result.bankAction) + '</span>',
      '<span>realCertification=' + String(result.realCertification) + '</span>'
    ].join('');
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
    return Array.from(new Uint8Array(digest)).map(function (value) {
      return value.toString(16).padStart(2, '0');
    }).join('');
  }

  function formatMinor(value) {
    if (!Number.isSafeInteger(value)) return '—';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(value / 100);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
