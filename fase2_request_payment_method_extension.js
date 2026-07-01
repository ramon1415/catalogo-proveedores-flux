;(function fluxFase2RequestPaymentMethodExtension() {
  if (window.__fluxFase2RequestPaymentMethodLoaded) return
  window.__fluxFase2RequestPaymentMethodLoaded = true

  const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase()
  const activeRequestStatuses = ["submitted", "approved", "changes_requested", "finance_validation", "scheduled"]
  const requestTypeOptions = [
    ["supplier_payment", "Pago a proveedor"],
    ["online_purchase", "Compra en linea"],
    ["reimbursement", "Reembolso"],
  ]
  const paymentMethodOptions = [
    ["transfer", "Transferencia"],
    ["cash", "Efectivo"],
    ["check", "Cheque"],
    ["other", "Otro"],
  ]
  const legacyRequestTypeLabels = {
    supplier_payment: "Pago a proveedor",
    provider_payment: "Pago a proveedor",
    online_purchase: "Compra en linea",
    reimbursement: "Reembolso",
    cash: "Pago a proveedor",
    check: "Pago a proveedor",
    deposit_refund: "Pago a proveedor",
    other: "Pago a proveedor",
  }
  const paymentMethodLabels = {
    transfer: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    other: "Otro",
  }

  let requestedAmountTimer = null

  onReady(init)

  function init() {
    injectStyles()
    if (pageName === "proveedores.html") initProvidersPage()
    if (pageName === "solicitudes.html") initRequestsPage()
    if (pageName === "aprobaciones.html") initApprovalsPage()
    if (pageName === "layouts.html") initLayoutsPage()
  }

  function initProvidersPage() {
    relabelPreferredPaymentMethod()
    const observer = new MutationObserver(relabelPreferredPaymentMethod)
    observer.observe(document.body, { childList: true, subtree: true })
  }

  function initRequestsPage() {
    waitForElement("requestForm", () => {
      ensureRequestTypeAndPaymentMethodFields()
      startRequestTypeEnforcer()
      bindProviderPreferredMethod()
      bindRequestSubmitInterceptor()
      patchRequestRows()
      patchRequestDetail()
      patchRequestedAmountCard()
      showStoredRequestCreatedBanner()
    })
  }

  function initApprovalsPage() {
    patchApprovalLabels()
    const target = document.getElementById("approvalsTableBody") || document.body
    const observer = new MutationObserver(() => patchApprovalLabels())
    observer.observe(target, { childList: true, subtree: true })
  }

  function initLayoutsPage() {
    waitForElement("newLayoutForm", () => bindLayoutTransferGuard())
  }

  function getClient() {
    if (typeof window.getFluxSupabaseClient === "function") return window.getFluxSupabaseClient()
    return window.supabaseClient || null
  }

  function relabelPreferredPaymentMethod() {
    const select = document.getElementById("metodo_pago")
    const label = select?.closest("label")
    if (label && label.dataset.fase2PreferredRelabeled !== "true") {
      replaceFirstText(label, "Metodo de pago preferido *")
      label.dataset.fase2PreferredRelabeled = "true"
      if (!label.querySelector("[data-fase2-preferred-help]")) {
        label.insertAdjacentHTML("beforeend", `<span class="fase2-field-help" data-fase2-preferred-help>Se usa como metodo sugerido al crear una solicitud, pero puede cambiarse en la solicitud.</span>`)
      }
    }

    document.querySelectorAll("th").forEach((th) => {
      if (normalize(th.textContent) === "metodo") th.textContent = "Metodo preferido"
    })
  }

  function ensureRequestTypeAndPaymentMethodFields() {
    const form = document.getElementById("requestForm")
    if (!form) return
    const firstGrid = form.querySelector(".form-section .form-grid")
    if (!firstGrid) return

    let requestType = document.getElementById("requestType")
    if (!requestType) {
      firstGrid.insertAdjacentHTML("afterbegin", `
        <label class="full-row" data-fase2-request-type-label>Tipo de solicitud *
          <select id="requestType" class="form-control" required></select>
        </label>
      `)
      requestType = document.getElementById("requestType")
    }
    const normalizedType = normalizeRequestType(requestType.value || "supplier_payment")
    if (!selectMatchesOptions(requestType, requestTypeOptions)) {
      requestType.innerHTML = requestTypeOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")
    }
    requestType.value = normalizedType
    relabelSelect(requestType, "Tipo de solicitud *", "Define la naturaleza de la solicitud. No determina si entra a layout bancario.")

    let paymentMethod = document.getElementById("paymentMethod")
    if (!paymentMethod) {
      const providerLabel = document.getElementById("proveedorId")?.closest("label")
      const insertTarget = providerLabel || requestType.closest("label")
      insertTarget?.insertAdjacentHTML("afterend", `
        <label class="full-row" data-fase2-payment-method-label>Metodo de pago *
          <select id="paymentMethod" class="form-control" required></select>
          <span class="fase2-field-help">Este metodo decide el flujo operativo: transferencia, efectivo, cheque u otro.</span>
        </label>
      `)
      paymentMethod = document.getElementById("paymentMethod")
    }
    const normalizedMethod = normalizePaymentMethod(paymentMethod.value || "transfer")
    if (!selectMatchesOptions(paymentMethod, paymentMethodOptions)) {
      paymentMethod.innerHTML = paymentMethodOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")
    }
    paymentMethod.value = normalizedMethod

    const cashCheckSection = document.getElementById("cashCheckSection")
    if (cashCheckSection) {
      cashCheckSection.classList.add("hidden")
      cashCheckSection.dataset.fase2LegacyHidden = "true"
    }
  }

  function startRequestTypeEnforcer() {
    const form = document.getElementById("requestForm")
    if (!form || form.dataset.fase2EnforcerBound === "true") return
    form.dataset.fase2EnforcerBound = "true"

    const enforce = () => {
      if (form.dataset.fase2Enforcing === "true") return
      form.dataset.fase2Enforcing = "true"
      ensureRequestTypeAndPaymentMethodFields()
      form.dataset.fase2Enforcing = "false"
    }

    ;[0, 120, 350, 700, 1200, 2000].forEach((delay) => window.setTimeout(enforce, delay))
    const observer = new MutationObserver(() => window.setTimeout(enforce, 40))
    observer.observe(form, { childList: true, subtree: true })
  }

  function bindProviderPreferredMethod() {
    const providerIdInput = document.getElementById("proveedorId")
    if (!providerIdInput || providerIdInput.dataset.fase2PreferredBound === "true") return
    providerIdInput.dataset.fase2PreferredBound = "true"
    providerIdInput.addEventListener("change", () => applyProviderPreferredMethod(providerIdInput.value))
    if (providerIdInput.value) applyProviderPreferredMethod(providerIdInput.value)
  }

  async function applyProviderPreferredMethod(providerId) {
    const paymentMethod = document.getElementById("paymentMethod")
    const client = getClient()
    if (!providerId || !paymentMethod || !client) return

    try {
      const { data, error } = await client
        .from("proveedores")
        .select("id,metodo_pago")
        .eq("id", providerId)
        .maybeSingle()
      if (error) throw error
      const preferred = normalizePaymentMethod(data?.metodo_pago)
      if (preferred) {
        paymentMethod.value = preferred
        paymentMethod.dataset.fase2PreferredFromProvider = preferred
        paymentMethod.dispatchEvent(new Event("change", { bubbles: true }))
      }
    } catch (error) {
      toast("Metodo preferido no disponible", friendlyError(error), "warning")
    }
  }

  function bindRequestSubmitInterceptor() {
    const form = document.getElementById("requestForm")
    if (!form || form.dataset.fase2SubmitBound === "true") return
    form.dataset.fase2SubmitBound = "true"
    form.addEventListener("submit", submitRequestWithFase2Fields, true)
  }

  async function submitRequestWithFase2Fields(event) {
    const form = event.currentTarget
    if (form.dataset.fase2Submitting === "true") return
    event.preventDefault()
    event.stopImmediatePropagation()

    const client = getClient()
    if (!client) return toast("Sin conexion", "No se encontro el cliente Supabase compartido.", "error")

    ensureRequestTypeAndPaymentMethodFields()
    const payload = collectRequestPayload()
    const validation = validateRequestPayload(payload)
    if (validation) return toast("Revisa la solicitud", validation, "warning")

    const submitButton = document.getElementById("submitRequestBtn")
    setButtonLoading(submitButton, true, "Creando solicitud...")
    form.dataset.fase2Submitting = "true"

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

      await attachRequestFileIfPresent(client, requestId)

      const folio = result.request_number || result.payment_request_number || "Solicitud"
      toast("Solicitud creada", `${folio} creada correctamente.`, "success")
      scheduleRequestedAmountRefresh()
      renderRequestCreationSuccess(result, payload)
    } catch (error) {
      toast("No se pudo crear la solicitud", friendlyError(error), "error")
      setButtonLoading(submitButton, false, "Crear solicitud")
      form.dataset.fase2Submitting = "false"
    }
  }

  function showStoredRequestCreatedBanner() {
    try {
      const folio = window.sessionStorage?.getItem("fluxFase2RequestCreatedFolio")
      if (!folio) return
      window.sessionStorage.removeItem("fluxFase2RequestCreatedFolio")
      window.setTimeout(() => showRequestCreatedBanner(folio), 450)
    } catch (_) {
      // El mensaje persistido es solo una mejora visual.
    }
  }

  function showRequestCreatedBanner(folio) {
    const safeFolio = folio && folio !== "Solicitud" ? folio : "la solicitud"
    document.querySelector("[data-fase2-floating-success]")?.remove()
    const banner = document.createElement("div")
    banner.dataset.fase2FloatingSuccess = "true"
    banner.className = "fase2-floating-success"
    banner.setAttribute("role", "status")
    banner.setAttribute("aria-live", "polite")
    banner.innerHTML = `
      <strong>Solicitud creada correctamente</strong>
      <span>Folio: ${escapeHtml(safeFolio)}</span>
    `
    document.body.appendChild(banner)
    window.setTimeout(() => banner.classList.add("is-visible"), 20)
    window.setTimeout(() => {
      banner.classList.remove("is-visible")
      window.setTimeout(() => banner.remove(), 260)
    }, 6500)
  }

  function renderRequestCreationSuccess(result, payload) {
    const form = document.getElementById("requestForm")
    if (!form) return
    const folio = result.request_number || result.payment_request_number || "Solicitud creada"
    const modalScroll = form.querySelector(".modal-scroll")
    const actions = form.querySelector(".modal-actions")
    if (actions && !actions.dataset.fase2OriginalHtml) actions.dataset.fase2OriginalHtml = actions.innerHTML

    modalScroll?.classList.add("hidden")
    form.querySelector("[data-fase2-success]")?.remove()

    const headerTitle = form.querySelector(".modal-header h2")
    const headerCopy = form.querySelector(".modal-header p")
    if (headerTitle) headerTitle.textContent = "Solicitud creada correctamente"
    if (headerCopy) headerCopy.textContent = "La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes."

    const panel = document.createElement("div")
    panel.dataset.fase2Success = "true"
    panel.className = "fase2-success-panel"
    panel.innerHTML = `
      <strong>Solicitud creada correctamente</strong>
      <span class="fase2-success-folio">Folio: ${escapeHtml(folio)}</span>
      <span>La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes.</span>
      <span>Tipo: ${escapeHtml(requestTypeLabel(payload.request_type))}</span>
      <span>Metodo de pago: ${escapeHtml(paymentMethodLabel(payload.payment_method))}</span>
    `
    modalScroll?.parentElement?.insertBefore(panel, modalScroll)

    if (actions) {
      actions.innerHTML = `
        <button type="button" id="fase2CreateAnotherRequestBtn" class="secondary-btn">Crear otra solicitud</button>
        <button type="button" id="fase2CloseAndViewRequestsBtn" class="primary-btn">Cerrar y ver solicitudes</button>
      `
      document.getElementById("fase2CreateAnotherRequestBtn")?.addEventListener("click", () => resetRequestModalForAnother(form, panel, modalScroll, actions))
      document.getElementById("fase2CloseAndViewRequestsBtn")?.addEventListener("click", () => closeAndRefreshRequests(folio))
    }

    window.setTimeout(() => panel.scrollIntoView({ block: "start", behavior: "smooth" }), 40)
  }

  function resetRequestModalForAnother(form, panel, modalScroll, actions) {
    panel?.remove()
    form.reset()
    form.dataset.fase2Submitting = "false"
    modalScroll?.classList.remove("hidden")
    const headerTitle = form.querySelector(".modal-header h2")
    const headerCopy = form.querySelector(".modal-header p")
    if (headerTitle) headerTitle.textContent = "Nueva solicitud de pago"
    if (headerCopy) headerCopy.textContent = "Completa los datos operativos y financieros para validar presupuesto al guardar."
    if (actions?.dataset.fase2OriginalHtml) actions.innerHTML = actions.dataset.fase2OriginalHtml
    document.getElementById("cancelRequestBtn")?.addEventListener("click", () => document.getElementById("requestDialog")?.close())
    ensureRequestTypeAndPaymentMethodFields()
    setButtonLoading(document.getElementById("submitRequestBtn"), false, "Crear solicitud")
    updateSummaryPanelIfAvailable()
  }

  function closeAndRefreshRequests(folio) {
    try {
      if (folio) window.sessionStorage?.setItem("fluxFase2RequestCreatedFolio", folio)
    } catch (_) {
      // Solo mejora visual para resaltar el cierre.
    }
    document.getElementById("requestDialog")?.close()
    window.setTimeout(() => window.location.reload(), 120)
  }

  function updateSummaryPanelIfAvailable() {
    try {
      if (typeof window.updateSummaryPanel === "function") window.updateSummaryPanel()
    } catch (_) {
      // El resumen se recalcula con los eventos existentes de la pagina.
    }
  }

  function collectRequestPayload() {
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

  function validateRequestPayload(payload) {
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

  async function attachRequestFileIfPresent(client, requestId) {
    const input = document.getElementById("requestFile")
    const file = input?.files?.[0]
    if (!file || !window.FluxUpload?.uploadReceipt) return
    try {
      const storagePath = await window.FluxUpload.uploadReceipt(file, `solicitudes/${requestId}`)
      const { error } = await client.from("payment_requests").update({ invoice_storage_path: storagePath }).eq("id", requestId)
      if (error) throw error
    } catch (error) {
      toast("Comprobante no vinculado", "La solicitud se creo, pero el comprobante no pudo subirse o vincularse.", "warning")
    }
  }

  function patchRequestRows() {
    const table = document.getElementById("requestsTableBody")
    if (!table) return
    const observer = new MutationObserver(() => {
      window.setTimeout(enrichRequestRows, 80)
      // no re-disparar el total aquí: cada mutación de la tabla lo refetcheaba (loop)
    })
    observer.observe(table, { childList: true, subtree: true })
    enrichRequestRows()
  }

  async function enrichRequestRows() {
    const client = getClient()
    const table = document.getElementById("requestsTableBody")
    if (!client || !table) return
    const folios = Array.from(table.querySelectorAll("td:first-child strong"))
      .map((node) => node.textContent.trim())
      .filter(Boolean)
    if (!folios.length) return

    try {
      const { data, error } = await client
        .from("payment_requests")
        .select("request_number,request_type,payment_method")
        .in("request_number", folios)
      if (error) throw error
      const byFolio = new Map((data || []).map((item) => [item.request_number, item]))
      table.querySelectorAll("tr").forEach((row) => {
        const folioNode = row.querySelector("td:first-child strong")
        if (!folioNode || row.querySelector("[data-fase2-request-badges]")) return
        const item = byFolio.get(folioNode.textContent.trim())
        if (!item) return
        const wrapper = document.createElement("div")
        wrapper.dataset.fase2RequestBadges = "true"
        wrapper.className = "fase2-inline-badges"
        wrapper.innerHTML = `${miniBadge(requestTypeLabel(item.request_type), "info")}${miniBadge(paymentMethodLabel(item.payment_method), paymentMethodVariant(item.payment_method))}`
        folioNode.parentElement?.appendChild(wrapper)
      })
    } catch (_) {
      // Si la columna payment_method no esta lista en algun ambiente, no rompemos la tabla.
    }
  }

  function patchRequestDetail() {
    const detail = document.getElementById("detailContent")
    if (!detail) return
    const observer = new MutationObserver(() => window.setTimeout(enrichRequestDetail, 120))
    observer.observe(detail, { childList: true, subtree: true })
  }

  async function enrichRequestDetail() {
    const detail = document.getElementById("detailContent")
    const title = document.getElementById("detailTitle")?.textContent?.trim()
    const client = getClient()
    if (!detail || !title || !client || detail.querySelector("[data-fase2-detail]") || !title.startsWith("SOL-")) return
    try {
      const { data, error } = await client
        .from("payment_requests")
        .select("request_type,payment_method")
        .eq("request_number", title)
        .maybeSingle()
      if (error || !data) return
      detail.insertAdjacentHTML("afterbegin", `
        <div class="fase2-detail-strip" data-fase2-detail>
          <span>${miniBadge(requestTypeLabel(data.request_type), "info")}</span>
          <span>${miniBadge(paymentMethodLabel(data.payment_method), paymentMethodVariant(data.payment_method))}</span>
        </div>
      `)
    } catch (_) {
      // Solo mejora visual.
    }
  }

  function patchRequestedAmountCard() {
    // NO observar #requestedAmount: fase2 y solicitudes.js escriben en el mismo
    // elemento con formatos distintos; observarlo causaba un loop infinito de
    // fetch a payment_requests. Se refresca en init + timers, no en cada mutación.
    scheduleRequestedAmountRefresh()
    ;[300, 900, 1600].forEach((delay) => window.setTimeout(scheduleRequestedAmountRefresh, delay))
  }

  function scheduleRequestedAmountRefresh() {
    window.clearTimeout(requestedAmountTimer)
    requestedAmountTimer = window.setTimeout(updateRequestedAmountFull, 180)
  }

  async function updateRequestedAmountFull() {
    const target = document.getElementById("requestedAmount")
    const client = getClient()
    if (!target || !client) return
    try {
      const { data, error } = await client
        .from("payment_requests")
        .select("amount_requested,status")
        .in("status", activeRequestStatuses)
      if (error) throw error
      const total = (data || []).reduce((sum, row) => sum + numberValue(row.amount_requested), 0)
      const next = formatCurrencyFull(total)
      if (target.textContent !== next) target.textContent = next
    } catch (_) {
      const parsed = Number(String(target.textContent || "").replace(/[^0-9.-]/g, ""))
      if (Number.isFinite(parsed)) {
        const nextParsed = formatCurrencyFull(parsed)
        if (target.textContent !== nextParsed) target.textContent = nextParsed
      }
    }
  }

  function patchApprovalLabels() {
    document.querySelectorAll(".approval-card-badges, #detailSubtitle").forEach((container) => {
      container.querySelectorAll(".badge, .status-badge, span").forEach((node) => {
        const text = normalize(node.textContent)
        if (text === "efectivo" || text === "cheque") {
          node.textContent = paymentMethodLabel(text)
          node.title = "Metodo de pago"
        }
        if (text === "transferencia") {
          node.textContent = "Pago a proveedor"
          node.title = "Tipo de solicitud legado"
        }
      })
    })
  }

  function bindLayoutTransferGuard() {
    const form = document.getElementById("newLayoutForm")
    if (!form || form.dataset.fase2LayoutGuardBound === "true") return
    form.dataset.fase2LayoutGuardBound = "true"
    form.addEventListener("submit", guardLayoutSubmit, true)
  }

  async function guardLayoutSubmit(event) {
    const form = event.currentTarget
    if (form.dataset.fase2LayoutChecking === "true") return
    const client = getClient()
    if (!client) return

    const periodStart = value("layoutPeriodStart")
    const periodEnd = value("layoutPeriodEnd")
    const companyId = value("layoutCompanyId")
    if (!periodStart || !periodEnd || periodStart > periodEnd) return

    form.dataset.fase2LayoutChecking = "true"
    try {
      let query = client
        .from("payment_requests")
        .select("id,request_number,payment_method,status,company_id,created_at")
        .eq("status", "approved")
        .gte("created_at", `${periodStart}T00:00:00`)
        .lte("created_at", `${periodEnd}T23:59:59`)
      if (companyId) query = query.eq("company_id", companyId)

      const { data, error } = await query
      if (error) throw error
      const candidates = data || []
      const nonTransfer = candidates.filter((request) => normalizePaymentMethodForLayout(request.payment_method) !== "transfer")
      if (nonTransfer.length) {
        event.preventDefault()
        event.stopImmediatePropagation()
        renderLayoutGuardNotice(nonTransfer)
        toast("Layout filtrado", "Hay solicitudes aprobadas que no tienen metodo Transferencia. Corrigelas antes de generar el layout bancario.", "warning")
      }
    } catch (error) {
      event.preventDefault()
      event.stopImmediatePropagation()
      renderLayoutGuardError(error)
      toast("No se pudo validar metodo de pago", friendlyError(error), "error")
    } finally {
      form.dataset.fase2LayoutChecking = "false"
    }
  }

  function renderLayoutGuardNotice(rows) {
    const box = document.getElementById("layoutInvalidBox")
    if (!box) return
    const items = rows.slice(0, 8).map((row) => `<li><strong>${escapeHtml(row.request_number || row.id)}</strong>: ${escapeHtml(paymentMethodLabel(row.payment_method))}</li>`).join("")
    const more = rows.length > 8 ? `<p style="margin-top:6px;color:var(--text-3)">Y ${rows.length - 8} mas.</p>` : ""
    box.innerHTML = `
      <strong>Solo se pueden generar layouts bancarios con metodo de pago Transferencia.</strong>
      <p style="margin:6px 0 0;color:var(--text-2)">Estas solicitudes aprobadas quedan fuera del layout por metodo de pago:</p>
      <ul style="margin:6px 0 0 16px">${items}</ul>${more}
      <p style="margin:8px 0 0;color:var(--text-3)">Bloqueo preventivo frontend. El refuerzo definitivo debe vivir en el RPC de layout cuando se autorice SQL/RPC.</p>
    `
    box.classList.remove("hidden")
  }

  function renderLayoutGuardError(error) {
    const box = document.getElementById("layoutInvalidBox")
    if (!box) return
    box.innerHTML = `<strong>No se pudo validar el metodo de pago antes de generar layout.</strong><p style="margin:6px 0 0;color:var(--text-2)">${escapeHtml(friendlyError(error))}</p>`
    box.classList.remove("hidden")
  }

  function normalizeRequestType(value) {
    const key = normalize(value)
    if (key === "provider_payment" || key === "transfer" || key === "cash" || key === "check" || key === "deposit_refund" || key === "other") return "supplier_payment"
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

  function normalizePaymentMethodForLayout(value) {
    const key = normalize(value)
    if (!key) return ""
    return normalizePaymentMethod(key)
  }

  function requestTypeLabel(value) {
    return legacyRequestTypeLabels[normalizeRequestType(value)] || legacyRequestTypeLabels[value] || "Pago a proveedor"
  }

  function paymentMethodLabel(value) {
    const key = normalize(value)
    if (!key) return "Sin metodo capturado"
    return paymentMethodLabels[normalizePaymentMethod(value)] || "Otro"
  }

  function paymentMethodVariant(value) {
    const key = normalize(value)
    if (!key) return "neutral"
    const method = normalizePaymentMethod(value)
    if (method === "transfer") return "success"
    if (method === "cash") return "warning"
    if (method === "check") return "info"
    return "neutral"
  }

  function selectMatchesOptions(select, pairs) {
    const options = Array.from(select?.options || [])
    if (options.length !== pairs.length) return false
    return pairs.every(([value, label], index) => options[index]?.value === value && options[index]?.textContent.trim() === label)
  }

  function relabelSelect(select, labelText, helpText) {
    const label = select?.closest("label")
    if (!label) return
    replaceFirstText(label, labelText)
    if (helpText && !label.querySelector("[data-fase2-help]")) {
      label.insertAdjacentHTML("beforeend", `<span class="fase2-field-help" data-fase2-help>${escapeHtml(helpText)}</span>`)
    }
  }

  function replaceFirstText(label, text) {
    const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    if (textNode) textNode.textContent = text
  }

  function injectStyles() {
    if (document.getElementById("fase2RequestPaymentMethodStyles")) return
    const style = document.createElement("style")
    style.id = "fase2RequestPaymentMethodStyles"
    style.textContent = `
      .fase2-field-help{display:block;margin-top:4px;color:var(--text-3);font-size:11px;font-weight:500;line-height:1.4;text-transform:none;letter-spacing:0}
      .fase2-inline-badges{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
      .fase2-mini-badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:10.5px;font-weight:800;line-height:1;color:var(--text-2);background:var(--bg-hover)}
      .fase2-mini-badge.success{background:var(--emerald-dim);border-color:rgba(18,183,106,.24);color:var(--emerald)}
      .fase2-mini-badge.warning{background:var(--amber-dim);border-color:rgba(245,158,11,.24);color:var(--amber)}
      .fase2-mini-badge.info{background:var(--accent-dim);border-color:rgba(15,118,110,.24);color:var(--accent-text)}
      .fase2-mini-badge.neutral{background:var(--bg-hover);color:var(--text-2)}
      .fase2-detail-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.018)}
      .fase2-success-panel{margin:0 2px 16px;padding:18px;border:1px solid rgba(18,183,106,.28);border-radius:14px;background:var(--emerald-dim);color:var(--text-1);display:flex;flex-direction:column;gap:8px}
      .fase2-success-panel strong{font-size:16px;color:var(--emerald)}
      .fase2-success-panel span{font-size:13px;color:var(--text-2)}
      .fase2-success-folio{font-weight:900;color:var(--text-1)!important}
      .fase2-floating-success{position:fixed;top:18px;right:18px;z-index:2147483000;max-width:min(420px,calc(100vw - 32px));padding:16px 18px;border:1px solid rgba(18,183,106,.34);border-radius:16px;background:linear-gradient(135deg,rgba(6,78,59,.98),rgba(8,47,73,.98));box-shadow:0 22px 60px rgba(0,0,0,.42);color:#ecfdf5;display:flex;flex-direction:column;gap:4px;opacity:0;transform:translateY(-10px);transition:opacity .22s ease,transform .22s ease;pointer-events:none}
      .fase2-floating-success.is-visible{opacity:1;transform:translateY(0)}
      .fase2-floating-success strong{font-size:15px;font-weight:900;color:#5eead4}
      .fase2-floating-success span{font-size:13px;font-weight:700;color:#d1fae5}
      @media (max-width:720px){.fase2-floating-success{top:12px;left:12px;right:12px;max-width:none}}
    `
    document.head.appendChild(style)
  }

  function miniBadge(label, variant = "neutral") {
    return `<span class="fase2-mini-badge ${escapeHtml(variant)}">${escapeHtml(label)}</span>`
  }

  function setButtonLoading(button, loading, text) {
    if (!button) return
    button.disabled = loading
    button.textContent = text
  }

  function normalizeRpcResult(data) {
    if (Array.isArray(data)) return data[0] || {}
    return data || {}
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

  function formatCurrencyFull(value) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(numberValue(value))
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Error desconocido")
    if (message.includes("payment_method")) return "La columna payment_method no esta disponible en este ambiente. Falta aplicar la migracion backend correspondiente."
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "No tienes permiso para realizar esta accion."
    return message
  }

  function toast(title, desc, variant = "success") {
    if (window.Components?.showToast) {
      window.Components.showToast({ title, desc, variant, duration: 6 })
      return
    }
    console[variant === "error" || variant === "danger" ? "error" : "log"](`[${title}] ${desc}`)
  }

  function waitForElement(id, callback, attempts = 80) {
    const element = document.getElementById(id)
    if (element) return callback(element)
    if (attempts <= 0) return
    window.setTimeout(() => waitForElement(id, callback, attempts - 1), 100)
  }

  function onReady(callback) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", callback, { once: true })
    else callback()
  }
})()
