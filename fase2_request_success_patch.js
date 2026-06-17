;(function fluxFase2RequestSuccessPatch() {
  if (window.__fluxFase2RequestSuccessPatchLoaded) return
  window.__fluxFase2RequestSuccessPatchLoaded = true

  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "solicitudes.html") return

  onReady(() => waitForElement("requestForm", bindSuccessSubmitPatch))

  function bindSuccessSubmitPatch(form) {
    if (!form || form.dataset.fase2SuccessPatchBound === "true") return
    form.dataset.fase2SuccessPatchBound = "true"
    window.addEventListener("submit", handleSubmit, true)
  }

  async function handleSubmit(event) {
    const form = event.target
    if (!form || form.id !== "requestForm") return
    if (form.dataset.fase2SuccessSubmitting === "true") {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }

    event.preventDefault()
    event.stopImmediatePropagation()

    const payload = collectPayload()
    const validation = validatePayload(payload)
    if (validation) return toast("Revisa la solicitud", validation, "warning")

    const client = getClient()
    if (!client) return toast("Sin conexion", "No se encontro el cliente Supabase compartido.", "error")

    const submitButton = document.getElementById("submitRequestBtn")
    setButtonLoading(submitButton, true, "Creando solicitud...")
    form.dataset.fase2SuccessSubmitting = "true"

    try {
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
      })
      if (error) throw error

      const result = normalizeRpcResult(data)
      const requestId = result.payment_request_id || result.id || null
      if (!requestId) throw new Error("No se obtuvo el id de la solicitud creada.")

      const { error: updateError } = await client
        .from("payment_requests")
        .update({
          request_type: payload.request_type,
          payment_method: payload.payment_method,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId)
      if (updateError) throw updateError

      await attachFileIfPossible(client, requestId)

      const folio = result.request_number || result.payment_request_number || "Solicitud creada"
      toast("Solicitud creada correctamente", `Folio: ${folio}`, "success")
      renderSuccessState(form, folio, payload)
      refreshListSoon(folio)
    } catch (error) {
      toast("No se pudo crear la solicitud", friendlyError(error), "error")
      setButtonLoading(submitButton, false, "Crear solicitud")
      form.dataset.fase2SuccessSubmitting = "false"
    }
  }

  function renderSuccessState(form, folio, payload) {
    const modalScroll = form.querySelector(".modal-scroll")
    const actions = form.querySelector(".modal-actions")
    const header = form.querySelector(".modal-header")
    const dialog = document.getElementById("requestDialog")

    if (actions && !actions.dataset.fase2SuccessOriginalHtml) actions.dataset.fase2SuccessOriginalHtml = actions.innerHTML
    form.querySelector("[data-fase2-request-success]")?.remove()
    form.classList.add("fase2-success-confirmed")
    modalScroll?.classList.add("hidden")
    if (modalScroll) modalScroll.style.display = "none"

    const title = form.querySelector(".modal-header h2")
    const copy = form.querySelector(".modal-header p")
    if (title) title.textContent = "Solicitud creada correctamente"
    if (copy) copy.textContent = "La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes."

    const panel = document.createElement("section")
    panel.dataset.fase2RequestSuccess = "true"
    panel.className = "fase2-request-success-card"
    panel.setAttribute("role", "status")
    panel.setAttribute("aria-live", "polite")
    panel.innerHTML = `
      <div class="fase2-request-success-icon">OK</div>
      <div class="fase2-request-success-copy">
        <strong>Solicitud creada correctamente</strong>
        <span class="fase2-request-success-folio">Folio: ${escapeHtml(folio)}</span>
        <span>La solicitud ya fue registrada y est&aacute; disponible en la bandeja de solicitudes.</span>
        <span>Tipo: ${escapeHtml(requestTypeLabel(payload.request_type))}</span>
        <span>Metodo de pago: ${escapeHtml(paymentMethodLabel(payload.payment_method))}</span>
      </div>
    `
    if (header) header.insertAdjacentElement("afterend", panel)
    else form.insertBefore(panel, modalScroll || actions || null)

    if (actions) {
      actions.innerHTML = `
        <button type="button" id="fase2CreateAnotherRequestBtn" class="secondary-btn">Crear otra solicitud</button>
        <button type="button" id="fase2CloseAndViewRequestsBtn" class="primary-btn">Cerrar y ver solicitudes</button>
      `
      document.getElementById("fase2CreateAnotherRequestBtn")?.addEventListener("click", () => resetForAnother(form, modalScroll, actions, panel))
      document.getElementById("fase2CloseAndViewRequestsBtn")?.addEventListener("click", () => closeAndViewRequests(folio))
    }

    setButtonLoading(document.getElementById("submitRequestBtn"), false, "Crear solicitud")
    dialog?.scrollTo?.(0, 0)
    window.setTimeout(() => {
      panel.scrollIntoView({ block: "start", behavior: "smooth" })
      document.getElementById("fase2CloseAndViewRequestsBtn")?.focus()
    }, 40)
  }

  function resetForAnother(form, modalScroll, actions, panel) {
    panel?.remove()
    form.reset()
    form.classList.remove("fase2-success-confirmed")
    form.dataset.fase2SuccessSubmitting = "false"
    modalScroll?.classList.remove("hidden")
    if (modalScroll) modalScroll.style.display = ""
    const title = form.querySelector(".modal-header h2")
    const copy = form.querySelector(".modal-header p")
    if (title) title.textContent = "Nueva solicitud de pago"
    if (copy) copy.textContent = "Completa los datos operativos y financieros para validar presupuesto al guardar."
    if (actions?.dataset.fase2SuccessOriginalHtml) actions.innerHTML = actions.dataset.fase2SuccessOriginalHtml
    setButtonLoading(document.getElementById("submitRequestBtn"), false, "Crear solicitud")
    document.getElementById("requestType") && (document.getElementById("requestType").value = "supplier_payment")
    document.getElementById("paymentMethod") && (document.getElementById("paymentMethod").value = "transfer")
  }

  function closeAndViewRequests(folio) {
    document.getElementById("requestDialog")?.close()
    showFloatingSuccess(folio)
    refreshListSoon(folio)
  }

  async function refreshListSoon(folio) {
    window.setTimeout(async () => {
      try {
        if (typeof window.loadPaymentRequests === "function") await window.loadPaymentRequests()
        else if (typeof window.renderPaymentRequestsTable === "function") window.renderPaymentRequestsTable()
      } catch (_) {
        // El refresco interno es una mejora; no debe romper la confirmacion.
      }
      highlightRow(folio)
    }, 120)
  }

  function highlightRow(folio) {
    if (!folio) return
    const row = Array.from(document.querySelectorAll("#requestsTableBody tr")).find((tr) => tr.textContent.includes(folio))
    if (!row) return
    row.classList.add("highlight-row")
    row.scrollIntoView({ block: "center", behavior: "smooth" })
    window.setTimeout(() => row.classList.remove("highlight-row"), 6500)
  }

  async function attachFileIfPossible(client, requestId) {
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

  function collectPayload() {
    const currency = value("currency") || "MXN"
    const profile = window.FluxAuth?.getProfile?.()
    return {
      request_type: normalizeRequestType(value("requestType") || "supplier_payment"),
      payment_method: normalizePaymentMethod(value("paymentMethod") || "transfer"),
      proveedor_id: value("proveedorId"),
      company_id: value("companyId"),
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
    if (!payload.cost_center_id) return "Selecciona un centro de costo."
    if (!payload.budget_category_id) return "Selecciona una partida presupuestal."
    if (!payload.budget_month) return "Selecciona el mes presupuestal."
    if (!payload.proveedor_id) return "Selecciona un proveedor."
    if (!payload.amount_requested || payload.amount_requested <= 0) return "El monto solicitado debe ser mayor a 0."
    if (!payload.description) return "Captura una descripcion."
    return ""
  }

  function injectStyles() {
    if (document.getElementById("fase2RequestSuccessPatchStyles")) return
    const style = document.createElement("style")
    style.id = "fase2RequestSuccessPatchStyles"
    style.textContent = `
      .fase2-success-confirmed .modal-scroll{display:none!important}
      .fase2-request-success-card{display:grid;grid-template-columns:48px minmax(0,1fr);gap:14px;margin:0 2px 16px;padding:22px;border:1px solid rgba(18,183,106,.34);border-radius:18px;background:linear-gradient(135deg,rgba(6,78,59,.92),rgba(8,47,73,.86));box-shadow:0 22px 58px rgba(0,0,0,.32);color:var(--text-1)}
      .fase2-request-success-icon{width:48px;height:48px;border-radius:16px;background:rgba(20,184,166,.18);border:1px solid rgba(94,234,212,.34);display:flex;align-items:center;justify-content:center;color:#5eead4;font-size:16px;font-weight:900}
      .fase2-request-success-copy{display:flex;flex-direction:column;gap:7px;min-width:0}
      .fase2-request-success-copy strong{font-size:18px;color:#5eead4}
      .fase2-request-success-copy span{font-size:13px;line-height:1.45;color:#d1d5db}
      .fase2-request-success-folio{font-weight:900;color:#fff!important}
      @media (max-width:720px){.fase2-request-success-card{grid-template-columns:1fr}.fase2-request-success-icon{width:42px;height:42px}}
    `
    document.head.appendChild(style)
  }

  function showFloatingSuccess(folio) {
    if (window.Components?.showToast) window.Components.showToast({ title: "Solicitud creada correctamente", desc: `Folio: ${folio}`, variant: "success", duration: 6 })
  }

  function getClient() {
    if (typeof window.getFluxSupabaseClient === "function") return window.getFluxSupabaseClient()
    return window.supabaseClient || null
  }

  function normalizeRpcResult(data) {
    if (Array.isArray(data)) return data[0] || {}
    return data || {}
  }

  function normalizeRequestType(value) {
    const key = normalize(value)
    if (key === "online_purchase") return "online_purchase"
    if (key === "reimbursement") return "reimbursement"
    return "supplier_payment"
  }

  function normalizePaymentMethod(value) {
    const key = normalize(value)
    if (!key) return "transfer"
    if (key.includes("transfer") || key.includes("bancaria") || key.includes("clabe") || key.includes("spei")) return "transfer"
    if (key.includes("efectivo") || key === "cash") return "cash"
    if (key.includes("cheque") || key === "check") return "check"
    return "other"
  }

  function requestTypeLabel(value) {
    return { supplier_payment: "Pago a proveedor", online_purchase: "Compra en linea", reimbursement: "Reembolso" }[normalizeRequestType(value)] || "Pago a proveedor"
  }

  function paymentMethodLabel(value) {
    return { transfer: "Transferencia", cash: "Efectivo", check: "Cheque", other: "Otro" }[normalizePaymentMethod(value)] || "Otro"
  }

  function value(id) {
    return String(document.getElementById(id)?.value || "").trim()
  }

  function numberValue(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
  }

  function normalize(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return
    button.disabled = loading
    button.textContent = text
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Error desconocido")
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "No tienes permiso para realizar esta accion."
    return message
  }

  function toast(title, desc, variant = "success") {
    if (window.Components?.showToast) {
      window.Components.showToast({ title, desc, variant, duration: 6 })
      return
    }
    console[variant === "error" ? "error" : "log"](`[${title}] ${desc}`)
  }

  function waitForElement(id, callback, attempts = 80) {
    const element = document.getElementById(id)
    if (element) {
      injectStyles()
      callback(element)
      return
    }
    if (attempts <= 0) return
    window.setTimeout(() => waitForElement(id, callback, attempts - 1), 100)
  }

  function onReady(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback, { once: true })
    else callback()
  }
})()
