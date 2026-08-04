(() => {
  const state = {
    currentRequest: null,
    currentContext: null,
    tableRequestIds: [],
    pendingRequestId: null,
    deepLinkRequestId: new URLSearchParams(window.location.search).get("request_id"),
    deepLinkHandled: false,
    tableSignature: "",
  }
  const dom = {}
  const executionContextCache = new Map()

  window.FluxBatchExecutionContext = {
    get: getExecutionContext,
    clear: clearExecutionContext,
  }

  document.addEventListener("DOMContentLoaded", init)

  function init() {
    ;[
      "extraordinaryDialog", "extraordinaryForm", "extraordinarySubtitle", "extraordinarySummary", "extraordinaryCategory",
      "extraordinaryReason", "extraordinaryConfirm", "closeExtraordinaryBtn", "cancelExtraordinaryBtn",
      "submitExtraordinaryBtn", "revokeExtraordinaryDialog", "revokeExtraordinaryForm",
      "revokeExtraordinaryReason", "closeRevokeExtraordinaryBtn", "cancelRevokeExtraordinaryBtn",
      "submitRevokeExtraordinaryBtn",
    ].forEach((id) => { dom[id] = document.getElementById(id) })

    dom.closeExtraordinaryBtn?.addEventListener("click", closeExtraordinaryDialog)
    dom.cancelExtraordinaryBtn?.addEventListener("click", closeExtraordinaryDialog)
    dom.extraordinaryForm?.addEventListener("submit", authorizeExtraordinary)
    dom.closeRevokeExtraordinaryBtn?.addEventListener("click", closeRevokeDialog)
    dom.cancelRevokeExtraordinaryBtn?.addEventListener("click", closeRevokeDialog)
    dom.revokeExtraordinaryForm?.addEventListener("submit", revokeExtraordinary)
    document.getElementById("detailContent")?.addEventListener("click", handleDetailAction)
    startDomAdapter()
  }

  function startDomAdapter() {
    const tableBody = document.getElementById("requestsTableBody")
    const detailDialog = document.getElementById("detailDialog")
    document.addEventListener("click", captureRequestDetailClick, true)

    if (tableBody) {
      new MutationObserver(syncRequestRows).observe(tableBody, { childList: true, subtree: true })
      syncRequestRows()
    }
    if (detailDialog) {
      new MutationObserver(() => {
        if (detailDialog.open) handleDetailDialogOpened()
        else resetDetailState()
      }).observe(detailDialog, { attributes: true, attributeFilter: ["open"] })
    }
  }

  function captureRequestDetailClick(event) {
    const button = event.target.closest("button[onclick*='openRequestDetail']")
    if (!button) return
    const requestId = requestIdFromDetailButton(button)
    if (requestId) state.pendingRequestId = requestId
  }

  function requestIdFromDetailButton(button) {
    const source = button?.getAttribute("onclick") || ""
    return source.match(/openRequestDetail\(['\"]([^'\"]+)['\"]\)/)?.[1] || null
  }

  function syncRequestRows() {
    const rows = [...document.querySelectorAll("#requestsTableBody tr")]
    const requestIds = []
    rows.forEach((row) => {
      const button = row.querySelector("button[onclick*='openRequestDetail']")
      const requestId = requestIdFromDetailButton(button)
      if (!requestId) return
      row.dataset.paymentRequestId = requestId
      requestIds.push(requestId)
    })

    const signature = requestIds.join("|")
    state.tableRequestIds = requestIds
    if (signature !== state.tableSignature) {
      state.tableSignature = signature
      decorateExtraordinaryRows(requestIds)
    }

    if (!state.deepLinkHandled && state.deepLinkRequestId) {
      const target = rows.find((row) => row.dataset.paymentRequestId === state.deepLinkRequestId)
      const button = target?.querySelector("button[onclick*='openRequestDetail']")
      if (button) {
        state.deepLinkHandled = true
        state.pendingRequestId = state.deepLinkRequestId
        window.setTimeout(() => button.click(), 0)
      }
    }
  }

  async function handleDetailDialogOpened() {
    const requestId = state.pendingRequestId || state.deepLinkRequestId
    if (!requestId) return
    const request = await loadRequestSummary(requestId)
    if (!document.getElementById("detailDialog")?.open || state.pendingRequestId !== requestId) return
    state.currentRequest = request
    await loadExecutionContext()
  }

  async function loadRequestSummary(requestId) {
    const { data: request, error } = await supabaseClient
      .from("payment_requests")
      .select("id,request_number,company_id,proveedor_id,request_type,payment_method,amount_requested,currency,status")
      .eq("id", requestId)
      .maybeSingle()
    if (error || !request) return null

    const [companyResult, providerResult] = await Promise.all([
      request.company_id
        ? supabaseClient.from("companies").select("name,legal_name").eq("id", request.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      request.proveedor_id
        ? supabaseClient.from("proveedores").select("alias,nombre_completo").eq("id", request.proveedor_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const company = companyResult.data || {}
    const provider = providerResult.data || {}
    return {
      id: request.id,
      requestNumber: request.request_number,
      companyName: company.legal_name || company.name || "Sin empresa",
      providerName: provider.alias || provider.nombre_completo || "Sin proveedor",
      amount: request.amount_requested,
      currency: request.currency || "MXN",
      paymentMethod: request.payment_method || request.request_type || "-",
      status: request.status,
    }
  }

  function resetDetailState() {
    const requestId = state.currentRequest?.id || state.pendingRequestId
    state.currentRequest = null
    state.currentContext = null
    state.pendingRequestId = null
    clearExecutionContext(requestId)
    removeExecutionPanel()
  }

  function clearExecutionContext(requestId) {
    if (requestId) executionContextCache.delete(requestId)
    else executionContextCache.clear()
  }

  async function getExecutionContext(requestId, options = {}) {
    if (!requestId) return { data: null, error: new Error("payment_request_id_required") }
    if (options.force) executionContextCache.delete(requestId)
    if (!executionContextCache.has(requestId)) {
      const request = Promise.resolve(supabaseClient.rpc("get_payment_request_execution_context", {
        p_payment_request_id: requestId,
      })).catch((error) => ({ data: null, error }))
      executionContextCache.set(requestId, request)
    }
    return executionContextCache.get(requestId)
  }

  async function decorateExtraordinaryRows(requestIds) {
    if (!requestIds.length) return
    requestIds.forEach((requestId) => {
      document.querySelector(`[data-payment-request-id="${cssEscape(requestId)}"] [data-extraordinary-row-badge]`)?.remove()
    })
    const { data, error } = await supabaseClient
      .from("payment_request_extraordinary_authorizations")
      .select("payment_request_id,category,authorized_at")
      .in("payment_request_id", requestIds)
      .eq("status", "active")
    if (error) return

    const active = new Map((data || []).map((row) => [row.payment_request_id, row]))
    requestIds.forEach((requestId) => {
      const row = document.querySelector(`[data-payment-request-id="${cssEscape(requestId)}"]`)
      const record = active.get(requestId)
      if (!row || !record || row.querySelector("[data-extraordinary-row-badge]")) return
      const folio = row.querySelector("td:first-child .cell-main")
      folio?.insertAdjacentHTML(
        "afterend",
        `<span class="badge warning extraordinary-row-badge" data-extraordinary-row-badge>Extraordinario</span>`
      )
    })
  }

  async function loadExecutionContext() {
    const requestId = state.currentRequest?.id
    if (!requestId) return
    removeExecutionPanel()
    const { data, error } = await getExecutionContext(requestId)
    if (state.currentRequest?.id !== requestId) return
    if (error) return
    state.currentContext = data || null
    renderExecutionPanel()
  }

  function renderExecutionPanel() {
    removeExecutionPanel()
    const context = state.currentContext
    const request = state.currentRequest
    const host = document.getElementById("detailContent")
    if (!context || !request || !host) return
    const extra = context.extraordinary
    const extraordinaryUiReady = Boolean(dom.extraordinaryDialog && dom.extraordinaryForm)
    const batch = context.latest_batch
    if (!context.is_finance && !extra && !batch) return

    const panel = document.createElement("section")
    panel.id = "batchExecutionPanel"
    panel.className = `batch-execution-panel${extra ? " extraordinary" : ""}`
    if (extra) {
      const currentLabel = extra.authorization_current === false
        ? `<span class="badge warning">Requiere revocacion y nueva autorizacion</span>`
        : `<span class="badge warning">Omite Direccion</span>`
      panel.innerHTML = `
        <div class="batch-execution-head"><div><strong>Extraordinario - autorizado por Finanzas</strong><span>${escapeHtml(categoryLabel(extra.category))}</span></div>${currentLabel}</div>
        <div class="batch-execution-meta"><span>${escapeHtml(extra.authorized_by_name || "Finanzas")}</span><span>${escapeHtml(formatDateTime(extra.authorized_at))}</span></div>
        <p>${escapeHtml(extra.reason || "Sin motivo registrado")}</p>
        ${extra.can_revoke ? `<div class="batch-execution-actions"><button class="secondary-btn" type="button" data-batch-execution-action="revoke">Revocar extraordinario</button></div>` : `<div class="batch-execution-meta"><span>Ya fue incorporado a un layout, fondo de efectivo o registro de pago y no puede revocarse desde la solicitud.</span></div>`}`
    } else {
      const batchText = batch
        ? `${escapeHtml(batch.batch_label || "Corte")} - ${escapeHtml(batchStatusLabel(batch.batch_status, batch.director_status))}`
        : "Sin corte activo"
      const staleDirectionNotice = context.direction_approval_stale
        ? `<div class="batch-execution-meta"><span>Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.</span></div>`
        : ""
      const budgetLabel = context.budget_validation_current ? "Presupuesto validado" : "Presupuesto por revisar"
      panel.innerHTML = `
        <div class="batch-execution-head"><div><strong>Ruta de autorizacion y pago</strong><span>${batchText}</span></div>${context.budget_validation_current ? `<span class="badge success">${budgetLabel}</span>` : `<span class="badge warning">${budgetLabel}</span>`}</div>
        ${staleDirectionNotice}
        ${renderApprovalTimeline(context.approval_history)}
        ${context.can_authorize_extraordinary && extraordinaryUiReady ? `<div class="batch-execution-actions"><button class="primary-btn" type="button" data-batch-execution-action="authorize">Marcar como extraordinario</button></div>` : `<div class="batch-execution-meta"><span>${escapeHtml(blockReasonLabel(context.authorization_block_reason))}</span></div>`}
      `
    }
    const firstCard = host.querySelector(".decision-card")
    if (firstCard) host.insertBefore(panel, firstCard)
    else host.appendChild(panel)
  }

  function renderApprovalTimeline(history) {
    const rows = Array.isArray(history) ? history : []
    if (!rows.length) return `<div class="batch-execution-meta"><span>Aun no se incorpora a un corte semanal.</span></div>`
    return `<div class="batch-history-timeline" aria-label="Historial de revisiones de Direccion">${rows.map((row) => `<div class="batch-history-step"><span class="batch-history-dot ${escapeHtml(row.director_status || "pending")}"></span><div><strong>${escapeHtml(reviewLabel(row.review_sequence))} · ${escapeHtml(row.batch_label || "Corte")}</strong><span>${escapeHtml(batchStatusLabel(row.batch_status, row.director_status))}${row.decided_at ? ` · ${escapeHtml(formatDateTime(row.decided_at))}` : ""}</span>${row.reject_reason ? `<small>Motivo: ${escapeHtml(row.reject_reason)}</small>` : ""}${row.correction_note || row.resubmission_note ? `<small>Correccion: ${escapeHtml(row.correction_note || row.resubmission_note)}</small>` : ""}</div></div>`).join("")}</div>`
  }

  function reviewLabel(value) {
    const sequence = Math.max(1, Number(value || 1))
    return sequence === 1 ? "Primera revision" : `Revision ${sequence}`
  }

  function removeExecutionPanel() {
    document.getElementById("batchExecutionPanel")?.remove()
  }

  function handleDetailAction(event) {
    const button = event.target.closest("[data-batch-execution-action]")
    if (!button) return
    if (button.dataset.batchExecutionAction === "authorize") openExtraordinaryDialog()
    if (button.dataset.batchExecutionAction === "revoke") openRevokeDialog()
  }

  function openExtraordinaryDialog() {
    const request = state.currentRequest
    if (!request || !state.currentContext?.can_authorize_extraordinary) return
    dom.extraordinaryForm.reset()
    dom.extraordinarySubtitle.textContent = "Confirma los datos antes de omitir la decision de Direccion."
    dom.extraordinarySummary.innerHTML = [
      summaryItem("Folio", request.requestNumber || "Sin folio"),
      summaryItem("Empresa", request.companyName || "Sin empresa"),
      summaryItem("Proveedor", request.providerName || "Sin proveedor"),
      summaryItem("Monto", formatMoney(request.amount, request.currency)),
      summaryItem("Moneda", request.currency || "MXN"),
      summaryItem("Metodo", paymentMethodLabel(request.paymentMethod)),
    ].join("")
    dom.extraordinaryDialog.showModal()
  }

  function closeExtraordinaryDialog() {
    if (dom.extraordinaryDialog?.open) dom.extraordinaryDialog.close()
  }

  async function authorizeExtraordinary(event) {
    event.preventDefault()
    const category = dom.extraordinaryCategory.value
    const reason = dom.extraordinaryReason.value.trim()
    if (!dom.extraordinaryConfirm.checked) return toast("Confirmacion requerida", "Confirma que la urgencia no puede esperar al siguiente corte.", "warning")
    if (!category || reason.length < 20) return toast("Datos incompletos", "Selecciona categoria y captura un motivo de al menos 20 caracteres.", "warning")
    setLoading(dom.submitExtraordinaryBtn, true, "Autorizando...")
    try {
      const { error } = await supabaseClient.rpc("authorize_payment_request_extraordinary", {
        p_payment_request_id: state.currentRequest.id,
        p_category: category,
        p_reason: reason,
      })
      if (error) throw error
      closeExtraordinaryDialog()
      toast("Extraordinario autorizado", "El pago quedo habilitado con auditoria y sin decision de Direccion.", "success")
      await refreshCurrentState()
    } catch (error) {
      toast("No se pudo autorizar", friendlyError(error), "danger")
    } finally {
      setLoading(dom.submitExtraordinaryBtn, false, "Autorizar extraordinario")
    }
  }

  function openRevokeDialog() {
    if (!state.currentContext?.extraordinary?.can_revoke) return
    dom.revokeExtraordinaryForm.reset()
    dom.revokeExtraordinaryDialog.showModal()
  }

  function closeRevokeDialog() {
    if (dom.revokeExtraordinaryDialog?.open) dom.revokeExtraordinaryDialog.close()
  }

  async function revokeExtraordinary(event) {
    event.preventDefault()
    const reason = dom.revokeExtraordinaryReason.value.trim()
    if (!reason) return toast("Motivo requerido", "Explica por que se revoca la autorizacion.", "warning")
    setLoading(dom.submitRevokeExtraordinaryBtn, true, "Revocando...")
    try {
      const { error } = await supabaseClient.rpc("revoke_payment_request_extraordinary", {
        p_payment_request_id: state.currentRequest.id,
        p_reason: reason,
      })
      if (error) throw error
      closeRevokeDialog()
      toast("Extraordinario revocado", "La autorizacion dejo de habilitar el pago y conserva su historial.", "success")
      await refreshCurrentState()
    } catch (error) {
      toast("No se pudo revocar", friendlyError(error), "danger")
    } finally {
      setLoading(dom.submitRevokeExtraordinaryBtn, false, "Revocar autorizacion")
    }
  }

  async function refreshCurrentState() {
    clearExecutionContext(state.currentRequest?.id)
    await loadExecutionContext()
    await decorateExtraordinaryRows(state.tableRequestIds)
  }

  function categoryLabel(value) {
    return ({
      operational_emergency: "Emergencia operativa / fuga",
      urgent_reimbursement: "Reembolso urgente",
      urgent_termination: "Desvinculacion o finiquito urgente",
      critical_service: "Servicio critico",
      other: "Otro",
    })[value] || value || "Sin categoria"
  }

  function paymentMethodLabel(value) {
    return ({
      transfer: "Transferencia",
      cash: "Efectivo",
      check: "Cheque",
      online_purchase: "Compra en linea",
      provider_payment: "Pago a proveedor",
    })[String(value || "").toLowerCase()] || value || "No especificado"
  }

  function summaryItem(label, value) {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  }

  function batchStatusLabel(batchStatus, directorStatus) {
    if (directorStatus === "rejected") return "Rechazada por Dirección"
    return ({
      draft: "Borrador",
      submitted: "Pendiente de decisión de Dirección",
      approved: "Dirección aprobó · pendiente de liberación",
      partially_approved: "Dirección decidió con rechazos · pendiente de liberación",
      closed: "Aprobada y liberada para pago",
    })[batchStatus] || batchStatus || "Sin estado"
  }

  function blockReasonLabel(value) {
    return ({
      finance_role_required: "Solo Finanzas puede autorizar extraordinarios.",
      payment_request_must_be_finance_approved: "La solicitud requiere validacion de presupuesto antes de continuar.",
      finance_reapproval_required: "Los datos cambiaron y requieren revalidacion de presupuesto.",
      direction_reapproval_required: "Los datos cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.",
      payment_request_already_executed: "La solicitud ya tiene ejecucion registrada.",
      extraordinary_authorization_already_active: "La solicitud ya tiene autorizacion extraordinaria activa.",
      direction_rejected_request_cannot_be_extraordinary: "Un rechazo de Direccion no puede omitirse como extraordinario.",
      submitted_batch_request_cannot_be_extraordinary: "El corte ya fue enviado a Direccion.",
      remove_request_from_draft_batch_first: "Retira primero la solicitud del corte en borrador.",
      batch_approved_request_cannot_be_extraordinary: "La solicitud ya fue decidida dentro de un corte.",
    })[value] || "No disponible para autorizacion extraordinaria."
  }

  function friendlyError(error) {
    const raw = String(error?.message || error || "Error no identificado")
    const known = {
      finance_role_required: "Se requiere rol de Finanzas.",
      finance_reapproval_required: "Los datos cambiaron y requieren revalidacion de presupuesto.",
      payment_request_must_be_finance_approved: "La solicitud requiere validacion de presupuesto antes de continuar.",
      payment_request_already_executed: "La solicitud ya tiene ejecucion registrada.",
      extraordinary_authorization_already_active: "Ya existe una autorizacion extraordinaria activa.",
      direction_rejected_request_cannot_be_extraordinary: "No se puede omitir un rechazo previo de Direccion.",
      submitted_batch_request_cannot_be_extraordinary: "No se puede autorizar mientras el corte esta enviado.",
      remove_request_from_draft_batch_first: "Retira primero la solicitud del corte en borrador.",
      batch_approved_request_cannot_be_extraordinary: "La solicitud ya fue aprobada dentro de un corte.",
      extraordinary_already_materialized: "No se puede revocar porque ya fue incorporado a un layout, fondo de efectivo o registro de pago.",
    }
    const key = Object.keys(known).find((item) => raw.includes(item))
    return key ? known[key] : raw
  }

  function setLoading(button, loading, label) {
    if (!button) return
    button.disabled = loading
    button.textContent = label
  }

  function toast(title, desc, variant) {
    if (window.Components?.showToast) window.Components.showToast({ title, desc, variant, duration: 6 })
  }

  function formatMoney(value, currency = "MXN") {
    try {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0))
    } catch {
      return `${Number(value || 0).toFixed(2)} ${currency}`
    }
  }

  function formatDateTime(value) {
    if (!value) return "-"
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  }

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char])
  }
})()
