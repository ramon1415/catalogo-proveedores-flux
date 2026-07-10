;(function fluxFase2RequestSuccessPatch() {
  if (window.__fluxFase2RequestSuccessPatchLoaded) return
  window.__fluxFase2RequestSuccessPatchLoaded = true

  const requestTypeLabels = {
    supplier_payment: "Pago a proveedor",
    online_purchase: "Compra en linea",
    reimbursement: "Reembolso",
  }
  const paymentMethodLabels = {
    transfer: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    other: "Otro",
  }

  document.addEventListener("submit", handleRequestSubmit, true)

  async function handleRequestSubmit(event) {
    const form = event.target
    if (!form || form.id !== "requestForm") return

    event.preventDefault()
    event.stopImmediatePropagation()

    if (form.dataset.fase2SuccessSubmitting === "true") return
    form.dataset.fase2SuccessSubmitting = "true"

    const submitButton = document.getElementById("submitRequestBtn")
    setButtonLoading(submitButton, true, "Creando solicitud...")

    try {
      const client = getClient()
      if (!client) throw new Error("No se encontro el cliente Supabase compartido.")

      const payload = collectPayload()
      const validation = validatePayload(payload)
      if (validation) {
        toast("Revisa la solicitud", validation, "warning")
        form.dataset.fase2SuccessSubmitting = "false"
        setButtonLoading(submitButton, false, "Crear solicitud")
        return
      }

      const { data, error } = await client.rpc("create_payment_request", {
        p_proveedor_id: payload.proveedor_id,
        p_company_id: payload.company_id,
        p_cost_center_id: payload.cost_center_id,
        p_budget_category_id: payload.budget_category_id,
        p_budget_month: payload.budget_month,
        p_amount_requested: payload.amount_requested,
        p_currency: payload.currency,
        p_exchange_rate: payload.exchange_rate,
        p_description: payload.description,
        p_notes: payload.notes,
        p_requested_by: payload.requested_by,
        p_is_extraordinary_adjustment: payload.is_extraordinary_adjustment,
        p_approver_id: payload.approver_id,
      })
      if (error) throw error

      const result = Array.isArray(data) ? data[0] : data
      const requestId = result?.payment_request_id || result?.id
      if (!requestId) throw new Error("No se obtuvo el id de la solicitud creada.")

      const metadataWarning = await tryPersistFase2Metadata(client, requestId, payload)
      await attachRequestFile(client, requestId)

      const folio = result?.request_number || result?.payment_request_number || "Solicitud"
      renderSuccessState(form, folio, payload, metadataWarning)
      toast("Solicitud creada", `${folio} creada correctamente.`, "success")
      if (metadataWarning) toast("Metodo de pago pendiente", metadataWarning, "warning")
      refreshRequestsList(requestId)
    } catch (error) {
      toast("No se pudo crear la solicitud", friendlyError(error), "error")
      form.dataset.fase2SuccessSubmitting = "false"
      setButtonLoading(submitButton, false, "Crear solicitud")
    }
  }

  async function tryPersistFase2Metadata(client, requestId, payload) {
    try {
      const { error } = await client
        .from("payment_requests")
        .update({
          request_type: payload.request_type,
          payment_method: payload.payment_method,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)

      if (!error) return ""
      if (isMissingFase2ColumnError(error)) {
        return "La solicitud se creo, pero el metodo de pago quedo pendiente de guardarse en este ambiente."
      }
      return `La solicitud se creo, pero no se pudo guardar la metadata de Fase 2: ${friendlyError(error)}`
    } catch (error) {
      if (isMissingFase2ColumnError(error)) {
        return "La solicitud se creo, pero el metodo de pago quedo pendiente de guardarse en este ambiente."
      }
      return `La solicitud se creo, pero no se pudo guardar la metadata de Fase 2: ${friendlyError(error)}`
    }
  }

  function isMissingFase2ColumnError(error) {
    const message = String(error?.message || error || "").toLowerCase()
    const code = String(error?.code || "").toUpperCase()
    return code === "PGRST204" || message.includes("schema cache") || message.includes("payment_method") || message.includes("request_type")
  }

  function renderSuccessState(form, folio, payload, metadataWarning = "") {
    const modalScroll = form.querySelector(".modal-scroll")
    const actions = form.querySelector(".modal-actions")
    const title = form.querySelector(".modal-header h2")
    const copy = form.querySelector(".modal-header p")

    if (title) title.textContent = "Solicitud creada correctamente"
    if (copy) copy.textContent = "La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes."
    if (actions && !actions.dataset.fase2OriginalHtml) actions.dataset.fase2OriginalHtml = actions.innerHTML

    form.querySelector("[data-fase2-success]")?.remove()
    modalScroll?.classList.add("hidden")

    const panel = document.createElement("section")
    panel.dataset.fase2Success = "true"
    panel.className = "fase2-success-panel"
    panel.setAttribute("role", "status")
    panel.setAttribute("aria-live", "polite")
    panel.innerHTML = `
      <strong>Solicitud creada correctamente</strong>
      <span class="fase2-success-folio">Folio: ${escapeHtml(folio)}</span>
      <span>La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes.</span>
      <span>Tipo de solicitud: ${escapeHtml(requestTypeLabels[payload.request_type] || "Pago a proveedor")}</span>
      <span>Metodo de pago: ${escapeHtml(paymentMethodLabels[payload.payment_method] || "Transferencia")}</span>
      ${metadataWarning ? `<span class="fase2-success-warning">${escapeHtml(metadataWarning)}</span>` : ""}
    `
    modalScroll?.parentElement?.insertBefore(panel, modalScroll)

    if (actions) {
      actions.innerHTML = `
        <button type="button" id="fase2CreateAnotherRequestBtn" class="secondary-btn">Crear otra solicitud</button>
        <button type="button" id="fase2CloseAndViewRequestsBtn" class="primary-btn">Cerrar y ver solicitudes</button>
      `
    }

    document.getElementById("fase2CreateAnotherRequestBtn")?.addEventListener("click", () => {
      panel.remove()
      form.reset()
      form.dataset.fase2SuccessSubmitting = "false"
      form.dataset.fase2Submitting = "false"
      modalScroll?.classList.remove("hidden")
      if (title) title.textContent = "Nueva solicitud de pago"
      if (copy) copy.textContent = "Completa los datos operativos y financieros para validar presupuesto al guardar."
      if (actions?.dataset.fase2OriginalHtml) actions.innerHTML = actions.dataset.fase2OriginalHtml
      document.getElementById("cancelRequestBtn")?.addEventListener("click", () => document.getElementById("requestDialog")?.close())
      setButtonLoading(document.getElementById("submitRequestBtn"), false, "Crear solicitud")
      document.getElementById("requestType")?.dispatchEvent(new Event("change", { bubbles: true }))
    })

    document.getElementById("fase2CloseAndViewRequestsBtn")?.addEventListener("click", async () => {
      document.getElementById("requestDialog")?.close()
      await refreshRequestsList()
    })

    window.setTimeout(() => panel.scrollIntoView({ block: "start", behavior: "smooth" }), 40)
  }

  async function refreshRequestsList(requestId) {
    try {
      if (requestId) window.highlightedRequestId = requestId
      if (typeof window.loadPaymentRequests === "function") {
        await window.loadPaymentRequests()
      }
    } catch (_) {
      // Si la lista no expone recarga publica, la siguiente navegacion mostrara la solicitud.
    }
  }

  function collectPayload() {
    const currency = value("currency") || "MXN"
    const profile = window.FluxAuth?.getProfile?.()
    return {
      request_type: normalizeRequestType(value("requestType") || "supplier_payment"),
      payment_method: normalizePaymentMethod(value("paymentMethod") || "transfer"),
      proveedor_id: value("proveedorId"),
      company_id: value("companyId"),
      approver_id: value("approverId"),
      cost_center_id: value("costCenterId"),
      budget_category_id: value("budgetCategoryId"),
      budget_month: value("budgetMonth") ? `${value("budgetMonth")}-01` : null,
      amount_requested: numberValue(value("amountRequested")),
      currency,
      exchange_rate: currency === "MXN" ? 1 : numberValue(value("exchangeRate") || 1),
      description: value("description"),
      notes: value("notes") || null,
      requested_by: profile?.id || null,
      is_extraordinary_adjustment: Boolean(window.FluxAuth?.canApprove?.() && document.getElementById("isExtraordinaryAdjustment")?.checked),
    }
  }

  function validatePayload(payload) {
    if (!payload.request_type) return "Selecciona el tipo de solicitud."
    if (!payload.payment_method) return "Selecciona el metodo de pago."
    if (!payload.company_id) return "Selecciona una empresa."
    if (!payload.approver_id) return "Selecciona quien revisa o aprueba la solicitud."
    if (!payload.cost_center_id) return "Selecciona un centro de costo."
    if (!payload.budget_category_id) return "Selecciona una partida presupuestal."
    if (!payload.budget_month) return "Selecciona el mes presupuestal."
    if (!payload.proveedor_id) return "Selecciona un proveedor."
    if (!payload.amount_requested || payload.amount_requested <= 0) return "El monto solicitado debe ser mayor a 0."
    if (!payload.description) return "Captura una descripcion."
    return ""
  }

  async function attachRequestFile(client, requestId) {
    const input = document.getElementById("requestFile")
    const file = input?.files?.[0]
    if (!file || !window.FluxUpload?.uploadReceipt) return
    try {
      const storagePath = await window.FluxUpload.uploadReceipt(file, `solicitudes/${requestId}`)
      const { error } = await client.from("payment_requests").update({ invoice_storage_path: storagePath }).eq("id", requestId)
      if (error) throw error
    } catch (_) {
      toast("Comprobante no vinculado", "La solicitud se creo, pero el comprobante no pudo subirse o vincularse.", "warning")
    }
  }

  function getClient() {
    if (typeof window.getFluxSupabaseClient === "function") return window.getFluxSupabaseClient()
    return window.supabaseClient || null
  }

  function normalizeRequestType(value) {
    if (["online_purchase", "reimbursement", "supplier_payment"].includes(value)) return value
    return "supplier_payment"
  }

  function normalizePaymentMethod(value) {
    if (["transfer", "cash", "check", "other"].includes(value)) return value
    if (value === "cash" || value === "check") return value
    return "transfer"
  }

  function value(id) {
    return document.getElementById(id)?.value?.trim() || ""
  }

  function numberValue(raw) {
    const parsed = Number(String(raw || "").replace(/,/g, ""))
    return Number.isFinite(parsed) ? parsed : 0
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return
    button.disabled = loading
    button.textContent = label
  }

  function toast(title, message, type) {
    if (window.FluxToast?.show) return window.FluxToast.show({ title, message, type })
    if (window.showToast) return window.showToast(title, message, type)
    if (message) console[type === "error" ? "error" : "log"](`${title}: ${message}`)
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "")
    if (message.includes("not_allowed")) return "No tienes permiso para realizar esta accion."
    if (message.includes("budget")) return "No se pudo validar el presupuesto de la solicitud."
    return message || "Intenta de nuevo."
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    }[char]))
  }
})()
