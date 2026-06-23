(() => {
  "use strict";

  const VERSION = "20260623-audit-fallback";
  const NORMAL_APPROVAL = "approved";
  const BUDGET_RECHECK_BLOCK_MESSAGE = "No fue posible revalidar presupuesto. No se ejecutó la aprobación normal desde frontend.";
  const state = {
    currentApprovalRequestId: null,
    currentEditRequestId: null,
    editTimer: null,
    allowNextEditSubmit: false,
    allowNextButton: new WeakSet(),
    requestCache: new Map(),
  };

  const STYLE_ID = "flux-budget-live-guards-style";

  function init() {
    injectStyles();
    patchSolicitudesHooks();
    bindEditRevalidation();
    bindEditSubmitGuard();
    bindApprovalClickGuard();
    bindExceptionApprovalGuard();
    bindDetailTracking();
    watchDetailDialogs();
  }

  function client() {
    return window.supabaseClient || window.getFluxSupabaseClient?.() || null;
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .budget-live-panel{border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.025);padding:12px 14px;margin-top:10px;display:flex;flex-direction:column;gap:8px}
      .budget-live-panel strong{color:var(--text-1);font-size:13px}
      .budget-live-panel p{margin:0;color:var(--text-3);font-size:12px;line-height:1.45}
      .budget-live-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
      .budget-live-cell{border:1px solid var(--border);border-radius:10px;padding:9px;background:var(--bg-input)}
      .budget-live-cell span{display:block;color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:.35px;font-weight:800}
      .budget-live-cell b{display:block;color:var(--text-1);font-size:13px;margin-top:3px;font-variant-numeric:tabular-nums}
      .budget-live-panel.ok{border-color:rgba(18,183,106,.26);background:rgba(18,183,106,.07)}
      .budget-live-panel.warn{border-color:rgba(245,158,11,.34);background:rgba(245,158,11,.08)}
      .budget-live-panel.danger{border-color:rgba(224,62,82,.34);background:rgba(224,62,82,.08)}
      .budget-live-panel.info{border-color:rgba(45,140,255,.26);background:rgba(45,140,255,.07)}
      .budget-live-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:4px}
      .budget-live-dialog::backdrop{background:rgba(2,6,23,.72)}
      .budget-live-dialog .modal-content{max-width:560px}
      .budget-live-audit{border-top:1px solid var(--border);margin-top:12px;padding-top:12px}
      .budget-live-audit h4{margin:0 0 8px;color:var(--text-1);font-size:13px}
      .budget-live-audit .history-item{color:var(--text-2)}
      .budget-live-audit .history-item strong{display:block;margin-bottom:3px}
      .budget-live-audit .history-item span{color:var(--text-3)}
      .budget-live-audit .history-item.empty{color:var(--text-3)}
      .budget-live-audit .history-item.derived{border-color:rgba(245,158,11,.28);background:rgba(245,158,11,.07)}
      @media (max-width:720px){.budget-live-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function patchSolicitudesHooks() {
    patchOpenEditRequest();
    patchOpenRequestDetail();
    patchLoadApprovalHistory();
    patchDecidePaymentRequest();
  }

  function patchOpenEditRequest() {
    const original = window.openEditRequest;
    if (typeof original !== "function" || original.__budgetLivePatched) return;
    const patched = async function patchedOpenEditRequest(id, ...rest) {
      state.currentEditRequestId = id;
      const result = await original.call(this, id, ...rest);
      setTimeout(() => refreshEditPanel(id), 80);
      return result;
    };
    patched.__budgetLivePatched = true;
    window.openEditRequest = patched;
  }

  function patchOpenRequestDetail() {
    const original = window.openRequestDetail;
    if (typeof original !== "function" || original.__budgetLivePatched) return;
    const patched = function patchedOpenRequestDetail(id, ...rest) {
      state.currentApprovalRequestId = id;
      const result = original.call(this, id, ...rest);
      setTimeout(() => renderDetailBudgetSignals(id), 120);
      return result;
    };
    patched.__budgetLivePatched = true;
    window.openRequestDetail = patched;
  }

  function patchLoadApprovalHistory() {
    const original = window.loadApprovalHistory;
    if (typeof original !== "function" || original.__budgetLivePatched) return;
    const patched = async function patchedLoadApprovalHistory(id, ...rest) {
      const result = await original.call(this, id, ...rest);
      await renderDecisionAudit(id, document.getElementById("approvalHistoryList"));
      return result;
    };
    patched.__budgetLivePatched = true;
    window.loadApprovalHistory = patched;
  }

  function patchDecidePaymentRequest() {
    const original = window.decidePaymentRequest;
    if (typeof original !== "function" || original.__budgetLivePatched) return;
    const patched = async function patchedDecidePaymentRequest(paymentRequestId, action, comments) {
      if (action === NORMAL_APPROVAL) {
        const allowed = await runApprovalGuard(paymentRequestId, { source: "solicitudes" });
        if (!allowed) return;
      }
      return original.call(this, paymentRequestId, action, comments);
    };
    patched.__budgetLivePatched = true;
    window.decidePaymentRequest = patched;
  }

  function bindEditRevalidation() {
    const ids = ["editAmountRequested", "editCompanyId", "editCostCenterId", "editBudgetCategoryId", "editBudgetMonth", "editCurrency", "editExchangeRate"];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.budgetLiveBound === "1") return;
      el.dataset.budgetLiveBound = "1";
      const eventName = el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(eventName, scheduleEditRefresh);
      if (eventName !== "change") el.addEventListener("change", scheduleEditRefresh);
    });
  }

  function scheduleEditRefresh() {
    clearTimeout(state.editTimer);
    state.editTimer = setTimeout(() => refreshEditPanel(state.currentEditRequestId), 320);
  }

  function bindEditSubmitGuard() {
    const form = document.getElementById("editForm");
    if (!form || form.dataset.budgetLiveSubmitGuard === "1") return;
    form.dataset.budgetLiveSubmitGuard = "1";
    form.addEventListener("submit", async (event) => {
      if (state.allowNextEditSubmit) {
        state.allowNextEditSubmit = false;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const panel = ensureEditPanel();
      const fields = getEditFields();
      if (!fields.company_id || !fields.cost_center_id || !fields.budget_category_id || !fields.budget_month || !fields.amount_requested) {
        const message = "Completa empresa, centro de costo, partida, mes y monto para revalidar presupuesto antes de guardar.";
        renderBudgetPanel(panel, { tone: "warn", title: "Revalidacion presupuestal pendiente", message });
        notify("Revisa la solicitud", message, "warning");
        return;
      }

      renderBudgetPanel(panel, { tone: "info", title: "Revalidando presupuesto", message: "Consultando disponibilidad actual antes de guardar..." });
      const request = state.currentEditRequestId ? await fetchRequest(state.currentEditRequestId) : null;
      const result = await revalidateBudget({ ...request, ...fields });
      renderBudgetPanel(panel, panelModelFromValidation(result, request, "edit"));

      if (!result.ok || result.status === "unknown") {
        const message = result.message || "No fue posible revalidar presupuesto antes de guardar.";
        notify("No se guardo la solicitud", message, "warning");
        return;
      }

      if (result.status !== "ok") {
        const message = "No se puede guardar como solicitud aprobable porque el presupuesto actual es insuficiente. Usa flujo de excepción o ajuste presupuestal.";
        renderBudgetPanel(panel, {
          tone: "danger",
          title: "Presupuesto insuficiente",
          message,
          available: result.available,
          amount: result.amount,
          after: result.after,
          shortfall: result.shortfall,
        });
        notify("No se guardo la solicitud", message, "warning");
        return;
      }

      state.allowNextEditSubmit = true;
      const submitEvent = typeof SubmitEvent === "function"
        ? new SubmitEvent("submit", { bubbles: true, cancelable: true })
        : new Event("submit", { bubbles: true, cancelable: true });
      form.dispatchEvent(submitEvent);
    }, true);
  }

  async function refreshEditPanel(requestId) {
    const panel = ensureEditPanel();
    if (!panel) return;
    const fields = getEditFields();
    if (!fields.company_id || !fields.cost_center_id || !fields.budget_category_id || !fields.budget_month || !fields.amount_requested) {
      renderBudgetPanel(panel, {
        tone: "info",
        title: "Revalidacion presupuestal pendiente",
        message: "Completa empresa, centro de costo, partida, mes y monto para recalcular disponibilidad antes de guardar.",
      });
      return;
    }
    renderBudgetPanel(panel, { tone: "info", title: "Revalidando presupuesto", message: "Consultando disponibilidad actual..." });
    const request = requestId ? await fetchRequest(requestId) : null;
    const result = await revalidateBudget({ ...request, ...fields });
    renderBudgetPanel(panel, panelModelFromValidation(result, request, "edit"));
  }

  function ensureEditPanel() {
    const help = document.getElementById("editBudgetCategoryHelp");
    if (!help) return null;
    let panel = document.getElementById("editBudgetLivePanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "editBudgetLivePanel";
      panel.className = "budget-live-panel info";
      help.insertAdjacentElement("afterend", panel);
    }
    return panel;
  }

  function getEditFields() {
    const amount = numberValue(document.getElementById("editAmountRequested")?.value);
    const currency = document.getElementById("editCurrency")?.value || "MXN";
    const exchangeRate = currency === "MXN" ? 1 : numberValue(document.getElementById("editExchangeRate")?.value) || 1;
    return {
      company_id: document.getElementById("editCompanyId")?.value || null,
      cost_center_id: document.getElementById("editCostCenterId")?.value || null,
      budget_category_id: document.getElementById("editBudgetCategoryId")?.value || null,
      budget_month: monthToDate(document.getElementById("editBudgetMonth")?.value),
      amount_requested: amount * exchangeRate,
      currency,
    };
  }

  function bindExceptionApprovalGuard() {
    document.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-decision='exception_approved'], [data-action='exception_approved']");
      if (!btn) return;
      if (state.allowNextButton.has(btn)) {
        state.allowNextButton.delete(btn);
        return;
      }

      const requestId = btn.dataset.id || state.currentApprovalRequestId || await requestIdFromVisibleDetail();
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const confirmed = await confirmExceptionApproval(requestId);
      if (!confirmed) return;

      state.allowNextButton.add(btn);
      btn.click();
    }, true);
  }

  function bindDetailTracking() {
    document.addEventListener("click", (event) => {
      const detailBtn = event.target.closest("[data-action='detail'][data-id]");
      if (detailBtn) state.currentApprovalRequestId = detailBtn.dataset.id;
    }, true);
  }

  function bindApprovalClickGuard() {
    document.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-action='quick-approve'][data-id], [data-decision='approved']");
      if (!btn) return;
      if (state.allowNextButton.has(btn)) {
        state.allowNextButton.delete(btn);
        return;
      }

      const requestId = btn.dataset.id || state.currentApprovalRequestId || await requestIdFromVisibleDetail();
      if (!requestId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const allowed = await runApprovalGuard(requestId, { source: "aprobaciones" });
      if (!allowed) return;

      state.allowNextButton.add(btn);
      btn.click();
    }, true);
  }

  async function runApprovalGuard(requestId, options = {}) {
    const request = await fetchRequest(requestId);
    if (!request) {
      notify("No se pudo revalidar", "No se encontro la solicitud para validar presupuesto antes de aprobar.", "error");
      showDecisionMessage("No se encontro la solicitud para validar presupuesto antes de aprobar.");
      return false;
    }

    if (isExceptionFlow(request)) return true;

    const result = await revalidateBudget(request);
    await renderDetailBudgetSignals(requestId, result, request);

    if (!result.ok || result.status === "unknown") {
      const message = result.message || BUDGET_RECHECK_BLOCK_MESSAGE;
      notify("Aprobacion detenida", message, "warning");
      showDecisionMessage(message);
      return false;
    }

    if (result.status !== "ok") {
      const message = `Presupuesto insuficiente. Disponible actual: ${formatCurrency(result.available)}; solicitado: ${formatCurrency(result.amount)}.`;
      notify("Aprobacion detenida", message, "warning");
      showDecisionMessage(message);
      return false;
    }

    return confirmBudgetApproval(request, result, options);
  }

  async function renderDetailBudgetSignals(requestId, precomputed, preloadedRequest) {
    const detail = document.getElementById("detailContent");
    if (!detail || !requestId) return;
    const request = preloadedRequest || await fetchRequest(requestId);
    if (!request) return;

    let panel = document.getElementById("detailBudgetLivePanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "detailBudgetLivePanel";
      const firstGrid = detail.querySelector(".ref-grid, .data-section") || detail.firstElementChild;
      if (firstGrid) firstGrid.insertAdjacentElement("afterend", panel);
      else detail.prepend(panel);
    }

    const result = precomputed || await revalidateBudget(request);
    renderBudgetPanel(panel, panelModelFromValidation(result, request, "detail"));

    const auditHost = ensureAuditHost(detail);
    await renderDecisionAudit(requestId, auditHost);
  }

  function ensureAuditHost(container) {
    let host = document.getElementById("budgetLiveAuditLog");
    if (!host) {
      host = document.createElement("div");
      host.id = "budgetLiveAuditLog";
      host.className = "budget-live-audit";
      container.appendChild(host);
    }
    return host;
  }

  async function renderDecisionAudit(requestId, host) {
    if (!host || !requestId) return;
    const heading = host.closest(".approval-history")?.querySelector("h4");
    if (heading) heading.textContent = "Bitácora de decisiones";
    host.innerHTML = host.id === "approvalHistoryList" ? `<div class="history-item">Cargando bitácora...</div>` : `<h4>Bitácora de decisiones</h4><div class="history-list"><div class="history-item">Cargando bitácora...</div></div>`;

    const c = client();
    if (!c) {
      setAuditHtml(host, `<div class="history-item">No hay cliente de datos disponible para cargar la bitacora.</div>`);
      return;
    }

    const { data, error } = await c
      .from("payment_request_approvals")
      .select("id,action,from_status,to_status,comments,approval_level,created_at,actor_profile_id,role_id")
      .eq("payment_request_id", requestId)
      .order("created_at", { ascending: false });

    if (error) {
      const request = await fetchRequest(requestId);
      const derived = derivedAuditEvent(request);
      if (derived) {
        setAuditHtml(host, renderDerivedAuditEvent(derived, "No fue posible cargar el registro detallado en payment_request_approvals."));
        return;
      }
      setAuditHtml(host, `<div class="history-item empty">No fue posible cargar la bitácora. ${escapeHtml(error.message || "")}</div>`);
      return;
    }

    if (!data?.length) {
      const request = await fetchRequest(requestId);
      const derived = derivedAuditEvent(request);
      if (derived) {
        setAuditHtml(host, renderDerivedAuditEvent(derived));
        return;
      }
      setAuditHtml(host, `<div class="history-item empty">Aún no hay decisiones registradas.</div>`);
      return;
    }

    const profilesById = await fetchProfilesById(data.map((item) => item.actor_profile_id).filter(Boolean));
    const rows = data.map((item) => {
      const actor = profilesById.get(item.actor_profile_id) || "Usuario no disponible";
      return `
        <div class="history-item">
          <strong>${escapeHtml(decisionLabel(item.action))}</strong>
          ${escapeHtml(item.comments || "Sin comentario")}
          <span>${escapeHtml(formatDateTime(item.created_at))} - ${escapeHtml(item.from_status || "-")} -> ${escapeHtml(item.to_status || "-")} - Nivel ${escapeHtml(item.approval_level || "-")} - ${escapeHtml(actor)}</span>
        </div>
      `;
    }).join("");
    setAuditHtml(host, rows);
  }

  function derivedAuditEvent(request) {
    if (!request) return null;
    const exceptionStatus = String(request.exception_status || "").toLowerCase();
    const exceptionAction = String(request.exception_action || "").toLowerCase();
    const status = String(request.status || "").toLowerCase();
    const budgetDecision = String(request.budget_decision || "").toLowerCase();
    const isExceptionApproved = exceptionStatus === "exception_approved" ||
      exceptionAction === "exception_approved" ||
      (request.is_extraordinary_adjustment === true && status === "approved") ||
      (budgetDecision.includes("exception") && status === "approved");
    const isRejected = status === "rejected" || exceptionStatus === "exception_rejected";
    const isApproved = status === "approved";
    if (!isExceptionApproved && !isRejected && !isApproved) return null;

    const action = isExceptionApproved ? "exception_approved" : isRejected ? "rejected" : "approved";
    return {
      action,
      label: decisionLabel(action),
      from_status: request.previous_status || request.from_status || "-",
      to_status: request.exception_status || request.status || "-",
      comments: request.exception_comments || request.approval_comments || request.comments || "Sin comentario registrado",
      approval_level: request.approval_level || "-",
      created_at: request.exception_approved_at || request.approved_at || request.rejected_at || request.updated_at || request.created_at,
    };
  }

  function renderDerivedAuditEvent(event, reason) {
    return `
      <div class="history-item derived">
        <strong>${escapeHtml(event.label)}</strong>
        ${escapeHtml(reason || "Evento derivado de la solicitud. No existe registro detallado en payment_request_approvals.")}
        <span>Comentario: ${escapeHtml(event.comments || "Sin comentario registrado")}</span>
        <span>${escapeHtml(formatDateTime(event.created_at))} - ${escapeHtml(event.from_status || "-")} -> ${escapeHtml(event.to_status || "-")} - Nivel ${escapeHtml(event.approval_level || "-")} - Usuario no disponible</span>
      </div>
    `;
  }

  function setAuditHtml(host, html) {
    if (host.id === "approvalHistoryList") host.innerHTML = html;
    else host.innerHTML = `<h4>Bitácora de decisiones</h4><div class="history-list">${html}</div>`;
  }

  async function fetchProfilesById(ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) return new Map();
    const c = client();
    if (!c) return new Map();
    const { data, error } = await c
      .from("profiles")
      .select("id,full_name,email")
      .in("id", uniqueIds);
    if (error) return new Map();
    return new Map((data || []).map((profile) => [profile.id, profile.full_name || profile.email || "Usuario no disponible"]));
  }

  async function fetchRequest(id) {
    if (!id) return null;
    if (state.requestCache.has(id)) return state.requestCache.get(id);
    const c = client();
    if (!c) return null;
    const { data, error } = await c
      .from("payment_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return null;
    state.requestCache.set(id, data || null);
    setTimeout(() => state.requestCache.delete(id), 5000);
    return data || null;
  }

  async function revalidateBudget(request) {
    const c = client();
    if (!c) return { ok: false, status: "unknown", message: BUDGET_RECHECK_BLOCK_MESSAGE, details: "No hay cliente de datos para revalidar presupuesto." };
    if (!request?.company_id || !request?.cost_center_id || !request?.budget_category_id || !request?.budget_month) {
      return { ok: false, status: "unknown", message: "La solicitud no tiene clasificacion presupuestal completa." };
    }

    const month = monthToDate(request.budget_month);
    const { data, error } = await c
      .from("budget_availability")
      .select("*")
      .eq("company_id", request.company_id)
      .eq("cost_center_id", request.cost_center_id)
      .eq("budget_category_id", request.budget_category_id)
      .eq("budget_month", month);

    if (error) {
      return {
        ok: false,
        status: "unknown",
        message: BUDGET_RECHECK_BLOCK_MESSAGE,
        details: error.message || "No se pudo consultar presupuesto vivo.",
      };
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      return {
        ok: false,
        status: "unknown",
        message: BUDGET_RECHECK_BLOCK_MESSAGE,
        details: "No hay presupuesto activo para esta combinacion.",
      };
    }

    const row = pickAvailabilityRow(rows);
    const amount = numberValue(request.amount_requested);
    const available = availableAmount(row);
    const after = available - amount;
    return {
      ok: true,
      status: after >= 0 ? "ok" : "insufficient",
      row,
      rows_count: rows.length,
      ambiguous: rows.length > 1,
      amount,
      available,
      after,
      shortfall: after >= 0 ? 0 : Math.abs(after),
    };
  }

  function panelModelFromValidation(result, request, mode) {
    if (!result?.ok || result.status === "unknown") {
      const details = result?.details ? ` ${result.details}` : "";
      return {
        tone: "warn",
        title: "Presupuesto no confirmado",
        message: `${result?.message || "No fue posible revalidar presupuesto vivo."}${details}`,
      };
    }

    const warnings = staleReasons(request, result);
    if (result.ambiguous) {
      warnings.push("Aviso: hay varias filas de disponibilidad; se uso la mayor disponibilidad para esta validacion preventiva.");
    }
    const tone = result.status === "ok" ? (warnings.length ? "warn" : "ok") : "danger";
    const title = result.status === "ok" ? "Presupuesto disponible revalidado" : "Presupuesto insuficiente";
    const message = result.status === "ok"
      ? (mode === "edit" ? "El monto capturado cabe en la disponibilidad actual antes de guardar." : "La disponibilidad actual permite la aprobacion normal.")
      : "La disponibilidad actual no alcanza para aprobar normalmente; usa el flujo de excepcion/cambio segun corresponda.";

    return {
      tone,
      title,
      message: warnings.length ? `${message} ${warnings.join(" ")}` : message,
      available: result.available,
      amount: result.amount,
      after: result.after,
      shortfall: result.shortfall,
    };
  }

  function staleReasons(request, result) {
    const reasons = [];
    if (!request) return reasons;
    if (request.updated_at && request.budget_checked_at && new Date(request.updated_at) > new Date(request.budget_checked_at)) {
      reasons.push("Aviso: la solicitud fue modificada despues de la ultima validacion presupuestal guardada.");
    }
    const storedOk = String(request.budget_decision || "").toLowerCase() === "aprobable";
    const liveOk = result?.status === "ok";
    if (request.budget_decision && storedOk !== liveOk) {
      reasons.push("Aviso: la revalidacion visual difiere de la decision presupuestal guardada.");
    }
    return reasons;
  }

  function renderBudgetPanel(panel, model) {
    if (!panel) return;
    const tone = model.tone || "info";
    panel.className = `budget-live-panel ${tone}`;
    const hasNumbers = [model.available, model.amount, model.after].some((value) => value !== undefined && value !== null);
    panel.innerHTML = `
      <strong>${escapeHtml(model.title || "Revalidacion presupuestal")}</strong>
      <p>${escapeHtml(model.message || "")}</p>
      ${hasNumbers ? `
        <div class="budget-live-grid">
          <div class="budget-live-cell"><span>Disponible vivo</span><b>${escapeHtml(formatCurrency(model.available))}</b></div>
          <div class="budget-live-cell"><span>Monto solicitud</span><b>${escapeHtml(formatCurrency(model.amount))}</b></div>
          <div class="budget-live-cell"><span>Despues de operar</span><b>${escapeHtml(formatCurrency(model.after))}</b></div>
        </div>
        ${model.shortfall ? `<p>Faltante estimado: <strong>${escapeHtml(formatCurrency(model.shortfall))}</strong></p>` : ""}
      ` : ""}
    `;
  }

  function confirmExceptionApproval(requestId) {
    return new Promise(async (resolve) => {
      const request = requestId ? await fetchRequest(requestId) : null;
      let dialog = document.getElementById("budgetExceptionConfirmDialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "budgetExceptionConfirmDialog";
        dialog.className = "budget-live-dialog";
        document.body.appendChild(dialog);
      }
      dialog.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <div>
              <h2 style="color:var(--text-1)">Autorizar excepción presupuestal</h2>
              <p>${escapeHtml(request?.request_number || "Solicitud")}</p>
            </div>
          </div>
          <div class="modal-scroll">
            <div class="budget-live-panel danger">
              <strong>Confirmación requerida</strong>
              <p>Esta acción autoriza una excepción presupuestal aunque el presupuesto vigente sea insuficiente.</p>
              <p>La decisión debe quedar registrada como excepción, no como aprobación normal.</p>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-btn" data-budget-exception-confirm="cancel">Cancelar</button>
            <button type="button" class="primary-btn" data-budget-exception-confirm="approve">Autorizar excepción</button>
          </div>
        </div>
      `;
      const finish = (value) => {
        dialog.close();
        dialog.querySelectorAll("[data-budget-exception-confirm]").forEach((btn) => btn.onclick = null);
        resolve(value);
      };
      dialog.querySelector("[data-budget-exception-confirm='cancel']").onclick = () => finish(false);
      dialog.querySelector("[data-budget-exception-confirm='approve']").onclick = () => finish(true);
      dialog.addEventListener("cancel", () => finish(false), { once: true });
      dialog.showModal();
    });
  }

  function confirmBudgetApproval(request, result) {
    return new Promise((resolve) => {
      let dialog = document.getElementById("budgetApprovalConfirmDialog");
      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.id = "budgetApprovalConfirmDialog";
        dialog.className = "budget-live-dialog";
        document.body.appendChild(dialog);
      }
      dialog.innerHTML = `
        <div class="modal-content">
          <div class="modal-header">
            <div>
              <h2 style="color:var(--text-1)">Confirmar aprobacion normal</h2>
              <p>Se revalido presupuesto vivo antes de llamar la aprobacion.</p>
            </div>
          </div>
          <div class="modal-scroll">
            <div class="budget-live-panel ok">
              <strong>${escapeHtml(request.request_number || "Solicitud")}</strong>
              <p>Disponible actual: ${escapeHtml(formatCurrency(result.available))}. Monto solicitado: ${escapeHtml(formatCurrency(result.amount))}. Disponible posterior: ${escapeHtml(formatCurrency(result.after))}.</p>
            </div>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-btn" data-budget-confirm="cancel">Cancelar</button>
            <button type="button" class="primary-btn" data-budget-confirm="approve">Aprobar normalmente</button>
          </div>
        </div>
      `;
      const finish = (value) => {
        dialog.close();
        dialog.querySelectorAll("[data-budget-confirm]").forEach((btn) => btn.onclick = null);
        resolve(value);
      };
      dialog.querySelector("[data-budget-confirm='cancel']").onclick = () => finish(false);
      dialog.querySelector("[data-budget-confirm='approve']").onclick = () => finish(true);
      dialog.addEventListener("cancel", () => finish(false), { once: true });
      dialog.showModal();
    });
  }

  async function requestIdFromVisibleDetail() {
    const title = document.getElementById("detailTitle")?.textContent?.trim();
    if (!title) return null;
    const c = client();
    if (!c) return null;
    const { data } = await c.from("payment_requests").select("id").eq("request_number", title).maybeSingle();
    return data?.id || null;
  }

  function watchDetailDialogs() {
    const observer = new MutationObserver(() => {
      const solicitudesDetail = document.getElementById("detailContent");
      const requestId = state.currentApprovalRequestId;
      if (solicitudesDetail && requestId && !document.getElementById("detailBudgetLivePanel")) {
        renderDetailBudgetSignals(requestId);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function showDecisionMessage(message) {
    const text = String(message || "");
    const solicitudesError = document.getElementById("decisionError");
    if (solicitudesError) {
      if ("textContent" in solicitudesError) solicitudesError.textContent = text;
      solicitudesError.classList?.remove("hidden");
    }
    const aprobacionesError = document.getElementById("decisionErrorText");
    if (aprobacionesError) {
      aprobacionesError.textContent = text;
      document.getElementById("decisionError")?.classList?.remove("hidden");
    }
  }

  function isExceptionFlow(request) {
    return !!(request?.is_extraordinary_adjustment || request?.exception_status || String(request?.budget_decision || "").toLowerCase().includes("exception"));
  }

  function availableAmount(row) {
    const candidates = [row?.available_amount, row?.amount_available, row?.disponible, row?.available, row?.budget_available, row?.current_available, row?.remaining_amount, row?.available_before];
    const first = candidates.find((value) => value !== null && value !== undefined && value !== "");
    return numberValue(first);
  }

  function pickAvailabilityRow(rows) {
    return [...(rows || [])].sort((a, b) => availableAmount(b) - availableAmount(a))[0] || null;
  }

  function monthToDate(value) {
    if (!value) return null;
    const text = String(value);
    if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return `${text.slice(0, 7)}-01`;
    return text;
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(numberValue(value));
  }

  function formatDateTime(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
  }

  function decisionLabel(action) {
    const labels = {
      approved: "Aprobada",
      rejected: "Rechazada",
      changes_requested: "Cambios solicitados",
      exception_approved: "Excepción autorizada",
      exception_rejected: "Excepción rechazada",
      amount_change_requested: "Cambio de monto solicitado",
      category_change_requested: "Cambio de partida solicitado",
      budget_adjustment_requested: "Ajuste presupuestal solicitado",
    };
    return labels[action] || action || "Decisión";
  }

  function notify(title, message, type = "info") {
    if (typeof window.showToast === "function") {
      window.showToast(title, message, type);
      return;
    }
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = `toast-v2 ${type}`;
    toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    stack.appendChild(toast);
    setTimeout(() => toast.remove(), 5200);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  window.FluxBudgetGuards = {
    version: VERSION,
    revalidateBudget,
    renderDetailBudgetSignals,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
