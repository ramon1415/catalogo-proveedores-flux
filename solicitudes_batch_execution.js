(() => {
  const state = {
    currentRequest: null,
    currentContext: null,
    tableRequestIds: [],
  }
  const dom = {}

  document.addEventListener("DOMContentLoaded", init)
  document.addEventListener("flux:payment-requests-rendered", (event) => {
    state.tableRequestIds = Array.isArray(event.detail?.requestIds) ? event.detail.requestIds : []
    decorateExtraordinaryRows(state.tableRequestIds)
  })
  document.addEventListener("flux:payment-request-detail-opened", (event) => {
    state.currentRequest = event.detail || null
    loadExecutionContext()
  })

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
    const { data, error } = await supabaseClient.rpc("get_payment_request_execution_context", {
      p_payment_request_id: requestId,
    })
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
        <div class="batch-execution-head"><div><strong>Extraordinario · autorizado por Finanzas</strong><span>${escapeHtml(categoryLabel(extra.category))}</span></div>${currentLabel}</div>
        <div class="batch-execution-meta"><span>${escapeHtml(extra.authorized_by_name || "Finanzas")}</span><span>${escapeHtml(formatDateTime(extra.authorized_at))}</span></div>
        <p>${escapeHtml(extra.reason || "Sin motivo registrado")}</p>
        ${extra.can_revoke ? `<div class="batch-execution-actions"><button class="secondary-btn" type="button" data-batch-execution-action="revoke">Revocar extraordinario</button></div>` : ""}`
    } else {
      const batchText = batch
        ? `${escapeHtml(batch.batch_label || "Corte")} · ${escapeHtml(batchStatusLabel(batch.batch_status, batch.director_status))}`
        : "Sin corte activo"
      panel.innerHTML = `
        <div class="batch-execution-head"><div><strong>Control previo a pago</strong><span>${batchText}</span></div>${context.finance_approval_current ? `<span class="badge success">Finanzas vigente</span>` : `<span class="badge warning">Requiere revision</span>`}</div>
        ${context.can_authorize_extraordinary ? `<div class="batch-execution-actions"><button class="primary-btn" type="button" data-batch-execution-action="authorize">Marcar como extraordinario</button></div>` : `<div class="batch-execution-meta"><span>${escapeHtml(blockReasonLabel(context.authorization_block_reason))}</span></div>`}
      `
    }
    const firstCard = host.querySelector(".decision-card")
    if (firstCard) host.insertBefore(panel, firstCard)
    else host.appendChild(panel)
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
    if (directorStatus === "rejected") return "Rechazada por Direccion"
    return ({
      draft: "Borrador",
      submitted: "Pendiente de Direccion",
      approved: "Aprobado · pendiente de cierre",
      partially_approved: "Con rechazos · pendiente de cierre",
      closed: "Liberado para pago",
    })[batchStatus] || batchStatus || "Sin estado"
  }

  function blockReasonLabel(value) {
    return ({
      finance_role_required: "Solo Finanzas puede autorizar extraordinarios.",
      payment_request_must_be_finance_approved: "La solicitud debe estar aprobada por Finanzas.",
      finance_reapproval_required: "Los datos cambiaron y requieren nueva revision de Finanzas.",
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
      finance_reapproval_required: "Los datos cambiaron y requieren nueva revision de Finanzas.",
      payment_request_must_be_finance_approved: "La solicitud debe estar aprobada por Finanzas.",
      payment_request_already_executed: "La solicitud ya tiene ejecucion registrada.",
      extraordinary_authorization_already_active: "Ya existe una autorizacion extraordinaria activa.",
      direction_rejected_request_cannot_be_extraordinary: "No se puede omitir un rechazo previo de Direccion.",
      submitted_batch_request_cannot_be_extraordinary: "No se puede autorizar mientras el corte esta enviado.",
      remove_request_from_draft_batch_first: "Retira primero la solicitud del corte en borrador.",
      batch_approved_request_cannot_be_extraordinary: "La solicitud ya fue aprobada dentro de un corte.",
      executed_extraordinary_cannot_be_revoked: "No se puede revocar porque el pago ya fue ejecutado.",
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
