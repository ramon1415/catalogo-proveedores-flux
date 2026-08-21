(() => {
  "use strict";

  const BASE_SRC = "./budget_live_frontend_guards_base.js?v=20260707-detail-loop-fix";
  const COMPANY_SCOPE_FIX_SRC = "./payroll_company_scope_fix.js?v=20260820-shadow-scope";
  const SHADOW_UX_POLISH_SRC = "./payroll_shadow_ux_polish.js?v=20260821-shadow-run-ux-v3";
  const FINANCE_ROLES = ["finance","finanzas","treasury","tesoreria","administracion"];
  const N5B_STYLE_ID = "payroll-n5b-budget-ux-style";
  const state = { requestId:null, budgetReady:null, lastSignature:null, timer:null, observer:null };

  const base = document.createElement("script");
  base.src = BASE_SRC;
  base.async = false;
  base.onload = initN5B;
  base.onerror = initN5B;
  document.head.appendChild(base);

  const companyScopeFix = document.createElement("script");
  companyScopeFix.src = COMPANY_SCOPE_FIX_SRC;
  companyScopeFix.async = false;
  document.head.appendChild(companyScopeFix);

  const shadowUxPolish = document.createElement("script");
  shadowUxPolish.src = SHADOW_UX_POLISH_SRC;
  shadowUxPolish.async = false;
  document.head.appendChild(shadowUxPolish);

  function initN5B() {
    if ((location.pathname.split("/").pop() || "").toLowerCase() !== "solicitudes.html") return;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once:true });
    else start();
  }

  async function start() {
    if (window.FluxAuth?.ready) await window.FluxAuth.ready();
    if (!hasFinanceRole()) return;
    injectStyles();
    document.addEventListener("change", (event) => {
      if (event.target?.id === "payrollDraftSelect") scheduleRefresh();
    }, true);
    document.addEventListener("click", guardApprovalClick, true);
    state.observer = new MutationObserver(scheduleRefresh);
    state.observer.observe(document.documentElement, { childList:true, subtree:true, attributes:true, attributeFilter:["class"] });
    scheduleRefresh();
  }

  function client() { return window.supabaseClient || window.getFluxSupabaseClient?.() || null; }
  function hasFinanceRole() {
    const roles = window.FluxAuth?.getRoles?.() || [];
    return roles.map((role) => String(role).toLowerCase()).some((role) => FINANCE_ROLES.includes(role));
  }

  function injectStyles() {
    if (document.getElementById(N5B_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = N5B_STYLE_ID;
    style.textContent = `
      .payroll-n5b-budget{margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:10px;display:flex;justify-content:space-between;gap:12px;align-items:center;background:var(--bg-input)}
      .payroll-n5b-budget strong{display:block;font-size:12px;color:var(--text-1)}
      .payroll-n5b-budget p{margin:3px 0 0;color:var(--text-3);font-size:11px;line-height:1.45}
      .payroll-n5b-budget.pending{border-color:rgba(245,158,11,.32);background:var(--amber-dim)}
      .payroll-n5b-budget.ready{border-color:rgba(18,183,106,.28);background:var(--emerald-dim)}
      .payroll-n5b-budget.blocked{border-color:rgba(224,62,82,.28);background:var(--ruby-dim)}
      .payroll-n5b-budget-blocked{display:none!important}
      @media(max-width:720px){.payroll-n5b-budget{align-items:flex-start;flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function scheduleRefresh() {
    clearTimeout(state.timer);
    state.timer = setTimeout(refreshBudgetGate, 140);
  }

  async function refreshBudgetGate() {
    const summaryRoot = document.getElementById("payrollSubmissionSummary");
    const draftSelect = document.getElementById("payrollDraftSelect");
    if (!summaryRoot || !draftSelect || summaryRoot.classList.contains("hidden")) return clearGate();
    const sessionId = draftSelect.value;
    if (!isUuid(sessionId)) return clearGate();
    const c = client();
    if (!c) return;
    try {
      const sessions = await c.rpc("get_payroll_capture_sessions", { p_session_id:sessionId });
      if (sessions.error) throw sessions.error;
      const session = Array.isArray(sessions.data) ? sessions.data.find((item) => item.id === sessionId) : null;
      const requestId = session?.materialized_payment_request_id || null;
      if (!isUuid(requestId)) return clearGate();
      const summary = await c.rpc("get_payroll_submission_summary", { p_payment_request_id:requestId });
      if (summary.error) throw summary.error;
      renderGate(summary.data || {}, requestId);
    } catch (_) {
      clearGate();
    }
  }

  function renderGate(summary, requestId) {
    const approval = document.getElementById("payrollApprovalSection");
    const stateText = document.getElementById("payrollSubmissionState");
    if (!approval || !stateText) return;
    let panel = document.getElementById("payrollN5bBudgetGate");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "payrollN5bBudgetGate";
      stateText.insertAdjacentElement("beforebegin", panel);
    }

    const isDraft = summary.status === "draft";
    const budgetReady = summary.budget_ready === true;
    state.requestId = requestId;
    state.budgetReady = budgetReady;

    if (isDraft && !budgetReady) approval.classList.add("payroll-n5b-budget-blocked");
    else approval.classList.remove("payroll-n5b-budget-blocked");

    const decision = summary.budget_decision || "not_checked";
    const tone = budgetReady ? "ready" : decision === "bloqueado" ? "blocked" : "pending";
    const title = budgetReady ? "Presupuesto listo" : decision === "bloqueado" ? "Presupuesto bloqueado" : "Presupuesto pendiente";
    const detail = budgetReady
      ? `Disponible después: ${money(summary.budget_available_after)} · ${monthLabel(summary.budget_month)}`
      : decision === "bloqueado"
        ? (summary.budget_block_reason || "La disponibilidad vigente no permite enviar esta Nómina a aprobación.")
        : "Configura mes y partida presupuestal antes de seleccionar aprobador.";
    const cta = isDraft && !budgetReady
      ? `<a class="secondary-btn" href="./nomina_presupuesto.html?request_id=${encodeURIComponent(requestId)}">Configurar presupuesto</a>`
      : "";
    const signature = [requestId, summary.status, budgetReady, decision, summary.budget_available_after, summary.budget_month, detail].join("|");
    if (signature !== state.lastSignature) {
      panel.className = `payroll-n5b-budget ${tone}`;
      panel.innerHTML = `<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>${cta}`;
      state.lastSignature = signature;
    }
  }

  function clearGate() {
    document.getElementById("payrollApprovalSection")?.classList.remove("payroll-n5b-budget-blocked");
    document.getElementById("payrollN5bBudgetGate")?.remove();
    state.requestId = null;
    state.budgetReady = null;
    state.lastSignature = null;
  }

  function guardApprovalClick(event) {
    const button = event.target.closest("#payrollSubmitApprovalBtn");
    if (!button || state.budgetReady !== false || !state.requestId) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (typeof window.showToast === "function") window.showToast("Presupuesto requerido", "Configura y valida el presupuesto antes de enviar la Nómina a aprobación.", "warning");
    location.href = `./nomina_presupuesto.html?request_id=${encodeURIComponent(state.requestId)}`;
  }

  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
  function money(value) { const n = Number(value); return Number.isFinite(n) ? new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" }).format(n) : "—"; }
  function monthLabel(value) { const text = String(value || ""); return /^\d{4}-\d{2}/.test(text) ? text.slice(0,7) : "mes validado"; }
  function escapeHtml(value) { return String(value == null ? "" : value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
})();