;(function fluxFase2RequestPaymentMethodExtension() {
  if (window.__fluxFase2RequestPaymentMethodLoaded) return
  window.__fluxFase2RequestPaymentMethodLoaded = true
  window.__fluxFase2RequestSuccessPatchLoaded = true

  const pageName = (window.location.pathname.split("/").pop() || "index.html").toLowerCase()
  const activeRequestStatuses = ["submitted", "approved", "changes_requested", "finance_validation", "scheduled"]
  const requestTypeOptions = [
    ["provider_payment", "Pago a proveedor"],
    ["online_purchase", "Compra en linea"],
    ["reimbursement", "Reembolso"],
  ]
  const paymentMethodOptions = [
    ["transfer", "Transferencia"],
    ["cash", "Efectivo"],
    ["check", "Cheque"],
    ["other", "Otro"],
  ]
  const requestTypeLabels = {
    provider_payment: "Pago a proveedor",
    supplier_payment: "Pago a proveedor",
    online_purchase: "Compra en linea",
    reimbursement: "Reembolso",
    deposit_refund: "Pago a proveedor",
    cash: "Pago a proveedor",
    check: "Pago a proveedor",
    other: "Pago a proveedor",
  }
  const paymentMethodLabels = {
    transfer: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    other: "Otro",
  }

  let requestedAmountTimer = null
  let approvalsRefreshTimer = null
  let paymentsRefreshTimer = null

  onReady(init)

  function init() {
    injectStyles()
    if (pageName === "proveedores.html") initProvidersPage()
    if (pageName === "solicitudes.html") initRequestsPage()
    if (pageName === "aprobaciones.html") initApprovalsPage()
    if (pageName === "layouts.html") initLayoutsPage()
    if (pageName === "pagos_comprobaciones.html") initPaymentsPage()
  }

  function initProvidersPage() {
    relabelPreferredPaymentMethod()
    new MutationObserver(relabelPreferredPaymentMethod).observe(document.body, { childList: true, subtree: true })
  }

  function initRequestsPage() {
    waitForElement("requestForm", () => {
      ensureRequestFields()
      ensureCashCheckSection()
      bindPaymentMethodVisibility()
      bindProviderPreferredMethod()
      bindQuickProviderCreation()
      bindRequestSubmitInterceptor()
      patchRequestRows()
      patchRequestDetail()
      patchRequestedAmountCard()
      showStoredRequestCreatedBanner()
      startRequestFieldKeeper()
    })
  }

  function initApprovalsPage() {
    scheduleApprovalRefresh()
    const target = document.getElementById("approvalsTableBody") || document.body
    new MutationObserver(scheduleApprovalRefresh).observe(target, { childList: true, subtree: true })
  }

  function initLayoutsPage() {
    waitForElement("newLayoutForm", addLayoutTransferNotice)
  }

  function initPaymentsPage() {
    waitForElement("paymentsTableBody", () => {
      schedulePaymentsRefresh()
      const target = document.getElementById("paymentsTableBody")
      new MutationObserver(schedulePaymentsRefresh).observe(target, { childList: true, subtree: true })
      ;["typeFilter", "statusFilter", "searchInput"].forEach((id) => {
        document.getElementById(id)?.addEventListener("input", schedulePaymentsRefresh)
        document.getElementById(id)?.addEventListener("change", schedulePaymentsRefresh)
      })
    })
  }

  function getClient() {
    if (typeof window.getFluxSupabaseClient === "function") return window.getFluxSupabaseClient()
    if (window.supabaseClient) return window.supabaseClient
    if (window.supabase?.createClient && window.SUPABASE_URL && window.SUPABASE_ANON_KEY) {
      window.supabaseClient = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
      return window.supabaseClient
    }
    return null
  }

  function ensureRequestFields() {
    const form = document.getElementById("requestForm")
    const firstGrid = form?.querySelector(".form-section .form-grid")
    if (!form || !firstGrid) return

    let requestType = document.getElementById("requestType")
    if (!requestType) {
      firstGrid.insertAdjacentHTML("afterbegin", "<label class=\"full-row\" data-fase2-request-type-label>Tipo de solicitud *<select id=\"requestType\" class=\"form-control\" required></select></label>")
      requestType = document.getElementById("requestType")
    }
    const selectedType = normalizeRequestType(requestType.value || "provider_payment")
    requestType.innerHTML = requestTypeOptions.map(([value, label]) => "<option value=\"" + value + "\">" + label + "</option>").join("")
    requestType.value = selectedType
    relabelSelect(requestType, "Tipo de solicitud *", "Define la naturaleza de la solicitud. No determina si entra a layout bancario.")

    let paymentMethod = document.getElementById("paymentMethod")
    if (!paymentMethod) {
      const providerLabel = document.getElementById("proveedorId")?.closest("label")
      const insertTarget = providerLabel || requestType.closest("label")
      insertTarget?.insertAdjacentHTML("afterend", "<label class=\"full-row\" data-fase2-payment-method-label>Metodo de pago *<select id=\"paymentMethod\" class=\"form-control\" required></select><span class=\"fase2-field-help\">Este metodo decide el flujo operativo: transferencia, efectivo, cheque u otro.</span></label>")
      paymentMethod = document.getElementById("paymentMethod")
    }
    const selectedMethod = normalizePaymentMethod(paymentMethod.value || "transfer")
    paymentMethod.innerHTML = paymentMethodOptions.map(([value, label]) => "<option value=\"" + value + "\">" + label + "</option>").join("")
    paymentMethod.value = selectedMethod
  }

  function ensureCashCheckSection() {
    const form = document.getElementById("requestForm")
    if (!form || document.getElementById("cashCheckSection")) return
    const firstSection = form.querySelector(".form-section")
    const profile = window.FluxAuth?.getProfile?.()
    const option = profile?.id
      ? "<option value=\"" + escapeHtml(profile.id) + "\">" + escapeHtml(profile.full_name || profile.email || "Usuario actual") + "</option>"
      : "<option value=\"\">Seleccionar responsable</option>"
    firstSection?.insertAdjacentHTML("afterend", "<section class=\"form-section hidden\" id=\"cashCheckSection\"><h3>Datos de entrega</h3><div class=\"form-grid\"><div class=\"field-hint full-row\">Estos datos se usan cuando el metodo de pago es efectivo o cheque.</div><label>Responsable del gasto *<select id=\"cashResponsibleProfileId\" class=\"form-control\">" + option + "</select></label><label>Fecha limite de comprobacion *<input id=\"cashDueDate\" class=\"form-control\" type=\"date\"></label><label>Metodo de entrega *<select id=\"cashDeliveryMethod\" class=\"form-control\"><option value=\"cash\">Efectivo</option><option value=\"check\">Cheque</option></select></label><div id=\"cashBlockStatus\" class=\"field-hint full-row\">Se guardara como metadata operativa local hasta que exista el fondo.</div></div></section>")
  }

  function bindPaymentMethodVisibility() {
    const method = document.getElementById("paymentMethod")
    if (!method || method.dataset.fase2VisibilityBound === "true") return
    method.dataset.fase2VisibilityBound = "true"
    method.addEventListener("change", syncPaymentMethodUi)
    document.getElementById("cashDeliveryMethod")?.addEventListener("change", () => {
      const delivery = document.getElementById("cashDeliveryMethod")?.value
      if (["cash", "check"].includes(method.value) && delivery) method.value = delivery
      syncPaymentMethodUi()
    })
    syncPaymentMethodUi()
  }

  function syncPaymentMethodUi() {
    const method = normalizePaymentMethod(value("paymentMethod") || "transfer")
    const isCashOrCheck = method === "cash" || method === "check"
    document.getElementById("cashCheckSection")?.classList.toggle("hidden", !isCashOrCheck)
    document.getElementById("requestLayoutDetails")?.classList.toggle("hidden", isCashOrCheck)
    const delivery = document.getElementById("cashDeliveryMethod")
    if (delivery && isCashOrCheck) delivery.value = method
  }

  function startRequestFieldKeeper() {
    const form = document.getElementById("requestForm")
    if (!form || form.dataset.fase2KeeperBound === "true") return
    form.dataset.fase2KeeperBound = "true"
    const keep = () => {
      ensureRequestFields()
      ensureCashCheckSection()
      bindPaymentMethodVisibility()
      syncPaymentMethodUi()
    }
    ;[120, 350, 700, 1200, 2000].forEach((delay) => window.setTimeout(keep, delay))
    new MutationObserver(() => window.setTimeout(keep, 40)).observe(form, { childList: true, subtree: true })
  }

  function bindProviderPreferredMethod() {
    const providerId = document.getElementById("proveedorId")
    if (!providerId || providerId.dataset.fase2PreferredBound === "true") return
    providerId.dataset.fase2PreferredBound = "true"
    providerId.addEventListener("change", () => applyProviderPreferredMethod(providerId.value))
    if (providerId.value) applyProviderPreferredMethod(providerId.value)
  }

  async function applyProviderPreferredMethod(providerId) {
    const paymentMethod = document.getElementById("paymentMethod")
    const client = getClient()
    if (!providerId || !paymentMethod || !client) return
    try {
      const { data, error } = await client.from("proveedores").select("id,metodo_pago").eq("id", providerId).maybeSingle()
      if (error) throw error
      const preferred = normalizePaymentMethod(data?.metodo_pago)
      if (!preferred) return
      paymentMethod.value = preferred
      paymentMethod.dispatchEvent(new Event("change", { bubbles: true }))
    } catch (error) {
      toast("Metodo preferido no disponible", friendlyError(error), "warning")
    }
  }

  function bindQuickProviderCreation() {
    const button = document.getElementById("newProviderFromRequestBtn")
    if (!button || button.dataset.fase2QuickProviderBound === "true") return
    button.dataset.fase2QuickProviderBound = "true"
    button.addEventListener("click", openQuickProviderDialog)
  }

  function openQuickProviderDialog() {
    const dialog = ensureQuickProviderDialog()
    dialog.querySelector("form")?.reset()
    dialog.showModal()
  }

  function ensureQuickProviderDialog() {
    let dialog = document.getElementById("fase2QuickProviderDialog")
    if (dialog) return dialog
    dialog = document.createElement("dialog")
    dialog.id = "fase2QuickProviderDialog"
    dialog.className = "narrow"
    dialog.innerHTML = "<form class=\"modal-content\" id=\"fase2QuickProviderForm\"><div class=\"modal-header\"><div><h2>Proveedor rapido</h2><p>Alta minima para continuar la solicitud sin salir de la pantalla.</p></div><button type=\"button\" class=\"icon-btn\" data-fase2-quick-provider-close>x</button></div><div class=\"modal-scroll\"><div class=\"form-grid\"><label>Alias *<input id=\"fase2ProviderAlias\" class=\"form-control\" required></label><label>Nombre completo / razon social *<input id=\"fase2ProviderName\" class=\"form-control\" required></label><label>Metodo preferido *<select id=\"fase2ProviderMethod\" class=\"form-control\" required><option value=\"Transferencia bancaria\">Transferencia bancaria</option><option value=\"Efectivo\">Efectivo</option><option value=\"Cheque\">Cheque</option><option value=\"Otro\">Otro</option></select></label><label>Destino<select id=\"fase2ProviderDestinationType\" class=\"form-control\"><option value=\"clabe\">CLABE</option><option value=\"cuenta\">Cuenta bancaria</option><option value=\"convenio\">Convenio</option></select></label><label>Beneficiario para layout<input id=\"fase2ProviderBeneficiary\" class=\"form-control\"></label><label>Banco<input id=\"fase2ProviderBank\" class=\"form-control\"></label><label>CLABE<input id=\"fase2ProviderClabe\" class=\"form-control\" maxlength=\"18\"></label><label>Cuenta bancaria<input id=\"fase2ProviderAccount\" class=\"form-control\"></label><label>Convenio<input id=\"fase2ProviderAgreement\" class=\"form-control\"></label></div></div><div class=\"modal-actions\"><button type=\"button\" class=\"secondary-btn\" data-fase2-quick-provider-close>Cancelar</button><button type=\"submit\" class=\"primary-btn\" data-fase2-quick-provider-submit>Crear proveedor</button></div></form>"
    document.body.appendChild(dialog)
    dialog.querySelectorAll("[data-fase2-quick-provider-close]").forEach((button) => button.addEventListener("click", () => dialog.close()))
    dialog.querySelector("form")?.addEventListener("submit", submitQuickProvider)
    return dialog
  }

  async function submitQuickProvider(event) {
    event.preventDefault()
    const client = getClient()
    if (!client) return toast("Sin conexion", "No se encontro el cliente Supabase compartido.", "error")
    const submit = event.currentTarget.querySelector("[data-fase2-quick-provider-submit]")
    const alias = value("fase2ProviderAlias")
    const nombre = value("fase2ProviderName")
    const metodoPago = value("fase2ProviderMethod")
    const destinationType = value("fase2ProviderDestinationType") || "clabe"
    if (!alias || !nombre || !metodoPago) return toast("Revisa el proveedor", "Alias, nombre y metodo preferido son obligatorios.", "warning")

    const bankRequired = normalizePaymentMethod(metodoPago) === "transfer"
    const payload = {
      alias,
      nombre_completo: nombre,
      metodo_pago: metodoPago,
      destination_type: bankRequired ? destinationType : null,
      beneficiary_name: value("fase2ProviderBeneficiary") || nombre,
      banco: bankRequired ? value("fase2ProviderBank") || null : null,
      clabe: bankRequired && destinationType === "clabe" ? value("fase2ProviderClabe") || null : null,
      cuenta_bancaria: bankRequired && destinationType === "cuenta" ? value("fase2ProviderAccount") || null : null,
      convenio_number: bankRequired && destinationType === "convenio" ? value("fase2ProviderAgreement") || null : null,
      tipo_cuenta: destinationType === "cuenta" ? "Cuenta" : destinationType === "clabe" ? "CLABE" : null,
      activo: true,
    }

    setButtonLoading(submit, true, "Creando...")
    try {
      const { data, error } = await client.from("proveedores").insert(payload).select("id,alias,nombre_completo,metodo_pago").maybeSingle()
      if (error) throw error
      document.getElementById("proveedorId").value = data.id
      const search = document.getElementById("providerSearch")
      if (search) search.value = data.alias || data.nombre_completo || alias
      document.getElementById("proveedorId").dispatchEvent(new Event("change", { bubbles: true }))
      document.getElementById("paymentMethod").value = normalizePaymentMethod(data.metodo_pago || metodoPago)
      document.getElementById("paymentMethod").dispatchEvent(new Event("change", { bubbles: true }))
      toast("Proveedor creado", "Se precargo el metodo preferido en la solicitud.", "success")
      document.getElementById("fase2QuickProviderDialog")?.close()
    } catch (error) {
      toast("No se pudo crear proveedor", friendlyError(error), "error")
    } finally {
      setButtonLoading(submit, false, "Crear proveedor")
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

    ensureRequestFields()
    ensureCashCheckSection()
    syncPaymentMethodUi()
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
        p_approver_id: payload.approver_id,
        p_approver_assignment_id: payload.approver_assignment_id,
      })
      if (error) throw error

      const result = normalizeRpcResult(data)
      const requestId = result.payment_request_id || result.id || null
      if (!requestId) throw new Error("No se obtuvo el id de la solicitud creada.")

      const { error: updateError } = await client.from("payment_requests").update({
        request_type: payload.request_type,
        payment_method: payload.payment_method,
        updated_at: new Date().toISOString(),
      }).eq("id", requestId)
      if (updateError) throw updateError

      persistCashMetadataIfNeeded(requestId, payload)
      await attachRequestFileIfPresent(client, requestId)
      const folio = result.request_number || result.payment_request_number || "Solicitud"
      toast("Solicitud creada", folio + " creada correctamente.", "success")
      scheduleRequestedAmountRefresh()
      renderRequestCreationSuccess(result, payload)
    } catch (error) {
      toast("No se pudo crear la solicitud", friendlyError(error), "error")
      setButtonLoading(submitButton, false, "Crear solicitud")
      form.dataset.fase2Submitting = "false"
    }
  }

  function collectRequestPayload() {
    const currency = value("currency") || "MXN"
    const profile = window.FluxAuth?.getProfile?.()
    const paymentMethod = normalizePaymentMethod(value("paymentMethod") || "transfer")
    return {
      request_type: normalizeRequestType(value("requestType") || "provider_payment"),
      payment_method: paymentMethod,
      proveedor_id: value("proveedorId"),
      company_id: value("companyId"),
      approver_id: value("approverId"),
      approver_assignment_id: value("approverAssignmentId") || null,
      cost_center_id: value("costCenterId"),
      budget_category_id: value("budgetCategoryId"),
      budget_month: value("budgetMonth") ? value("budgetMonth") + "-01" : null,
      amount_requested: numberValue(value("amountRequested")),
      currency,
      exchange_rate: currency === "MXN" ? 1 : numberValue(value("exchangeRate") || 1),
      description: value("description"),
      notes: value("notes") || null,
      requested_by: profile?.id || null,
      is_extraordinary_adjustment: Boolean(window.FluxAuth?.canApprove?.() && document.getElementById("isExtraordinaryAdjustment")?.checked),
      responsible_profile_id: value("cashResponsibleProfileId"),
      due_date: value("cashDueDate"),
      delivery_method: value("cashDeliveryMethod") || paymentMethod,
    }
  }

  function validateRequestPayload(payload) {
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
    if (["cash", "check"].includes(payload.payment_method) && !payload.responsible_profile_id) return "Selecciona el responsable del gasto."
    if (["cash", "check"].includes(payload.payment_method) && !payload.due_date) return "Captura la fecha limite de comprobacion."
    return ""
  }

  function persistCashMetadataIfNeeded(requestId, payload) {
    if (!requestId || !["cash", "check"].includes(payload.payment_method)) return
    try {
      localStorage.setItem("flux-cash-request-" + requestId, JSON.stringify({
        responsible_profile_id: payload.responsible_profile_id,
        due_date: payload.due_date,
        delivery_method: payload.payment_method,
      }))
    } catch (_) {}
  }

  async function attachRequestFileIfPresent(client, requestId) {
    const input = document.getElementById("requestFile")
    const file = input?.files?.[0]
    if (!file || !window.FluxUpload?.uploadReceipt) return
    try {
      const storagePath = await window.FluxUpload.uploadReceipt(file, "solicitudes/" + requestId)
      const { error } = await client.from("payment_requests").update({ invoice_storage_path: storagePath }).eq("id", requestId)
      if (error) throw error
    } catch (_) {
      toast("Comprobante no vinculado", "La solicitud se creo, pero el comprobante no pudo subirse o vincularse.", "warning")
    }
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
    const title = form.querySelector(".modal-header h2")
    const copy = form.querySelector(".modal-header p")
    if (title) title.textContent = "Solicitud creada correctamente"
    if (copy) copy.textContent = "La solicitud ya fue registrada y esta disponible en la bandeja de solicitudes."

    const panel = document.createElement("div")
    panel.dataset.fase2Success = "true"
    panel.className = "fase2-success-panel"
    panel.innerHTML = "<strong>Solicitud creada correctamente</strong><span class=\"fase2-success-folio\">Folio: " + escapeHtml(folio) + "</span><span>Tipo de solicitud: " + escapeHtml(requestTypeLabel(payload.request_type)) + "</span><span>Metodo de pago: " + escapeHtml(paymentMethodLabel(payload.payment_method)) + "</span>"
    modalScroll?.parentElement?.insertBefore(panel, modalScroll)

    if (actions) {
      actions.innerHTML = "<button type=\"button\" id=\"fase2CreateAnotherRequestBtn\" class=\"secondary-btn\">Crear otra solicitud</button><button type=\"button\" id=\"fase2CloseAndViewRequestsBtn\" class=\"primary-btn\">Cerrar y ver solicitudes</button>"
      document.getElementById("fase2CreateAnotherRequestBtn")?.addEventListener("click", () => resetRequestModalForAnother(form, panel, modalScroll, actions))
      document.getElementById("fase2CloseAndViewRequestsBtn")?.addEventListener("click", () => closeAndRefreshRequests(folio))
    }
  }

  function resetRequestModalForAnother(form, panel, modalScroll, actions) {
    panel?.remove()
    form.reset()
    form.dataset.fase2Submitting = "false"
    const approver = document.getElementById("approverId")
    if (approver) {
      approver.disabled = true
      approver.innerHTML = '<option value="">Completa empresa, centro de costo y monto</option>'
      approver.dispatchEvent(new Event("change", { bubbles: true }))
    }
    const assignment = document.getElementById("approverAssignmentId")
    if (assignment) assignment.value = ""
    modalScroll?.classList.remove("hidden")
    if (actions?.dataset.fase2OriginalHtml) actions.innerHTML = actions.dataset.fase2OriginalHtml
    document.getElementById("cancelRequestBtn")?.addEventListener("click", () => document.getElementById("requestDialog")?.close())
    ensureRequestFields()
    ensureCashCheckSection()
    bindPaymentMethodVisibility()
    setButtonLoading(document.getElementById("submitRequestBtn"), false, "Crear solicitud")
  }

  function closeAndRefreshRequests(folio) {
    try {
      if (folio) window.sessionStorage?.setItem("fluxFase2RequestCreatedFolio", folio)
    } catch (_) {}
    document.getElementById("requestDialog")?.close()
    window.setTimeout(() => window.location.reload(), 120)
  }

  function showStoredRequestCreatedBanner() {
    try {
      const folio = window.sessionStorage?.getItem("fluxFase2RequestCreatedFolio")
      if (!folio) return
      window.sessionStorage.removeItem("fluxFase2RequestCreatedFolio")
      window.setTimeout(() => showRequestCreatedBanner(folio), 450)
    } catch (_) {}
  }

  function showRequestCreatedBanner(folio) {
    document.querySelector("[data-fase2-floating-success]")?.remove()
    const banner = document.createElement("div")
    banner.dataset.fase2FloatingSuccess = "true"
    banner.className = "fase2-floating-success"
    banner.setAttribute("role", "status")
    banner.setAttribute("aria-live", "polite")
    banner.innerHTML = "<strong>Solicitud creada correctamente</strong><span>Folio: " + escapeHtml(folio || "Solicitud") + "</span>"
    document.body.appendChild(banner)
    window.setTimeout(() => banner.classList.add("is-visible"), 20)
    window.setTimeout(() => {
      banner.classList.remove("is-visible")
      window.setTimeout(() => banner.remove(), 260)
    }, 6500)
  }

  function patchRequestRows() {
    const table = document.getElementById("requestsTableBody")
    if (!table) return
    new MutationObserver(() => window.setTimeout(enrichRequestRows, 80)).observe(table, { childList: true, subtree: true })
    enrichRequestRows()
  }

  async function enrichRequestRows() {
    const client = getClient()
    const table = document.getElementById("requestsTableBody")
    if (!client || !table) return
    const folios = Array.from(table.querySelectorAll("td:first-child strong")).map((node) => node.textContent.trim()).filter(Boolean)
    if (!folios.length) return
    try {
      const { data, error } = await client.from("payment_requests").select("request_number,request_type,payment_method").in("request_number", folios)
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
        wrapper.innerHTML = miniBadge(requestTypeLabel(item.request_type), "info") + miniBadge(paymentMethodLabel(item.payment_method), paymentMethodVariant(item.payment_method))
        folioNode.parentElement?.appendChild(wrapper)
      })
    } catch (_) {}
  }

  function patchRequestDetail() {
    const detail = document.getElementById("detailContent")
    if (!detail) return
    new MutationObserver(() => window.setTimeout(enrichRequestDetail, 120)).observe(detail, { childList: true, subtree: true })
  }

  async function enrichRequestDetail() {
    const detail = document.getElementById("detailContent")
    const title = document.getElementById("detailTitle")?.textContent?.trim()
    const client = getClient()
    if (!detail || !title || !client || detail.querySelector("[data-fase2-detail]") || !title.startsWith("SOL-")) return
    try {
      const { data, error } = await client.from("payment_requests").select("request_type,payment_method").eq("request_number", title).maybeSingle()
      if (error || !data) return
      const strip = document.createElement("div")
      strip.className = "fase2-detail-strip"
      strip.dataset.fase2Detail = "true"
      strip.innerHTML = "<span>Tipo de solicitud: " + miniBadge(requestTypeLabel(data.request_type), "info") + "</span><span>Metodo de pago: " + miniBadge(paymentMethodLabel(data.payment_method), paymentMethodVariant(data.payment_method)) + "</span>"
      detail.insertAdjacentElement("afterbegin", strip)
    } catch (_) {}
  }

  function patchRequestedAmountCard() {
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
      const { data, error } = await client.from("payment_requests").select("amount_requested,status").in("status", activeRequestStatuses)
      if (error) throw error
      const total = (data || []).reduce((sum, row) => sum + numberValue(row.amount_requested), 0)
      const next = formatCurrencyFull(total)
      if (target.textContent !== next) target.textContent = next
    } catch (_) {}
  }

  function scheduleApprovalRefresh() {
    window.clearTimeout(approvalsRefreshTimer)
    approvalsRefreshTimer = window.setTimeout(enrichApprovals, 160)
  }

  async function enrichApprovals() {
    const client = getClient()
    if (!client) return
    const folios = Array.from(document.querySelectorAll(".approval-card-folio, #detailTitle")).map((node) => (node.textContent || "").trim()).filter((text) => text.startsWith("SOL-"))
    if (!folios.length) return
    try {
      const { data, error } = await client.from("payment_requests").select("request_number,request_type,payment_method").in("request_number", [...new Set(folios)])
      if (error) throw error
      const byFolio = new Map((data || []).map((item) => [item.request_number, item]))
      document.querySelectorAll(".approval-card").forEach((card) => {
        const folio = card.querySelector(".approval-card-folio")?.textContent?.trim()
        const item = byFolio.get(folio)
        const badges = card.querySelector(".approval-card-badges")
        if (!item || !badges || badges.querySelector("[data-fase2-approval-badge]")) return
        const typeBadge = miniBadge("Tipo: " + requestTypeLabel(item.request_type), "info")
        const methodBadge = miniBadge("Metodo: " + paymentMethodLabel(item.payment_method), paymentMethodVariant(item.payment_method))
        badges.insertAdjacentHTML("beforeend", "<span data-fase2-approval-badge>" + typeBadge + "</span><span data-fase2-approval-badge>" + methodBadge + "</span>")
      })
      const detailTitle = document.getElementById("detailTitle")?.textContent?.trim()
      const detailSubtitle = document.getElementById("detailSubtitle")
      const detailItem = byFolio.get(detailTitle)
      if (detailSubtitle && detailItem && !detailSubtitle.querySelector("[data-fase2-detail-approval]")) {
        const typeBadge = miniBadge("Tipo de solicitud: " + requestTypeLabel(detailItem.request_type), "info")
        const methodBadge = miniBadge("Metodo de pago: " + paymentMethodLabel(detailItem.payment_method), paymentMethodVariant(detailItem.payment_method))
        detailSubtitle.insertAdjacentHTML("beforeend", "<span data-fase2-detail-approval>" + typeBadge + "</span><span data-fase2-detail-approval>" + methodBadge + "</span>")
      }
    } catch (_) {}
  }

  function addLayoutTransferNotice() {
    const box = document.getElementById("layoutInvalidBox")
    if (!box || box.dataset.fase2Notice === "true") return
    box.dataset.fase2Notice = "true"
    box.classList.remove("hidden")
    box.innerHTML = "<strong>Layouts bancarios solo para transferencias.</strong><p style=\"margin:6px 0 0;color:var(--text-2)\">El RPC reforzado por la migracion 004c excluye efectivo, cheque y otros metodos aunque esten aprobados.</p>"
  }

  function schedulePaymentsRefresh() {
    window.clearTimeout(paymentsRefreshTimer)
    paymentsRefreshTimer = window.setTimeout(enrichPaymentsPage, 260)
  }

  async function enrichPaymentsPage() {
    const client = getClient()
    const body = document.getElementById("paymentsTableBody")
    if (!client || !body) return
    try {
      const [requestsResult, providersResult, companiesResult] = await Promise.all([
        client.from("payment_requests").select("id,request_number,request_type,payment_method,status,proveedor_id,company_id,amount_requested,scheduled_payment_date,updated_at,created_at").in("status", ["approved", "finance_validation", "scheduled", "paid"]),
        client.from("proveedores").select("id,alias,nombre_completo"),
        client.from("companies").select("id,name,legal_name"),
      ])
      if (requestsResult.error) throw requestsResult.error
      const providers = new Map((providersResult.data || []).map((p) => [p.id, p]))
      const companies = new Map((companiesResult.data || []).map((c) => [c.id, c]))
      const existingFolios = new Set(Array.from(body.querySelectorAll("td strong")).map((node) => node.textContent.trim()))
      const query = normalize(document.getElementById("searchInput")?.value || "")
      const typeFilter = document.getElementById("typeFilter")?.value || "all"
      const statusFilter = document.getElementById("statusFilter")?.value || "all"
      const rows = (requestsResult.data || [])
        .map((request) => ({ request, method: effectivePaymentMethod(request) }))
        .filter(({ request, method }) => method !== "transfer" && !existingFolios.has(request.request_number))
        .filter(({ method }) => typeFilter === "all" || method === typeFilter)
        .map(({ request, method }) => {
          const provider = providers.get(request.proveedor_id)
          const company = companies.get(request.company_id)
          const providerName = provider?.alias || provider?.nombre_completo || "Proveedor"
          const companyName = company?.legal_name || company?.name || "Sin empresa"
          const status = method === "cash" || method === "check" ? "pending_delivery" : "pending_confirmation"
          return { request, method, providerName, companyName, status }
        })
        .filter((entry) => statusFilter === "all" || entry.status === statusFilter)
        .filter((entry) => normalize([entry.request.request_number, entry.providerName, entry.companyName, paymentMethodLabel(entry.method)].join(" ")).includes(query))
      if (!rows.length) return
      if (body.querySelector(".empty-state")) body.innerHTML = ""
      body.insertAdjacentHTML("beforeend", rows.map(paymentRowHtml).join(""))
      bumpCounter("pendingDeliveryCount", rows.filter((row) => row.status === "pending_delivery").length)
    } catch (_) {}
  }

  function paymentRowHtml(entry) {
    const statusLabel = entry.status === "pending_delivery" ? "Aprobada sin entrega" : "Fuera de layout bancario"
    return "<tr data-fase2-payment-row><td>" + typeBadge(entry.method) + "</td><td><strong>" + escapeHtml(entry.request.request_number || "Solicitud") + "</strong><span class=\"muted-line\">" + escapeHtml(paymentMethodLabel(entry.method)) + "</span></td><td><strong>" + escapeHtml(entry.providerName) + "</strong></td><td>" + (entry.method === "cash" || entry.method === "check" ? "Pendiente" : "No aplica") + "</td><td>" + escapeHtml(entry.companyName) + "</td><td><strong>" + formatCurrencyFull(entry.request.amount_requested || 0) + "</strong></td><td>" + escapeHtml(formatDate(entry.request.scheduled_payment_date || entry.request.updated_at || entry.request.created_at)) + "</td><td>" + miniBadge(statusLabel, entry.status === "pending_delivery" ? "warning" : "neutral") + "</td><td><span class=\"badge\">No aplica</span></td><td><div class=\"actions\"><a class=\"small-btn\" href=\"./solicitudes.html?request_id=" + encodeURIComponent(entry.request.id) + "\">Ver solicitud</a></div></td></tr>"
  }

  function effectivePaymentMethod(request) {
    if (request?.payment_method) return normalizePaymentMethod(request.payment_method)
    if (request?.request_type === "cash" || request?.request_type === "check") return request.request_type
    return "transfer"
  }

  function bumpCounter(id, amount) {
    const node = document.getElementById(id)
    if (!node || !amount) return
    const current = Number(String(node.textContent || "0").replace(/[^0-9.-]/g, "")) || 0
    node.textContent = String(current + amount)
  }

  function typeBadge(method) {
    return miniBadge(paymentMethodLabel(method), paymentMethodVariant(method))
  }

  function relabelPreferredPaymentMethod() {
    const select = document.getElementById("metodo_pago")
    const label = select?.closest("label")
    if (label && label.dataset.fase2PreferredRelabeled !== "true") {
      replaceFirstText(label, "Metodo de pago preferido *")
      label.dataset.fase2PreferredRelabeled = "true"
      if (!label.querySelector("[data-fase2-preferred-help]")) {
        label.insertAdjacentHTML("beforeend", "<span class=\"fase2-field-help\" data-fase2-preferred-help>Se usa como metodo sugerido al crear una solicitud, pero puede cambiarse en la solicitud.</span>")
      }
    }
    document.querySelectorAll("th").forEach((th) => {
      if (normalize(th.textContent) === "metodo") th.textContent = "Metodo preferido"
    })
  }

  function normalizeRequestType(raw) {
    const key = normalize(raw)
    if (key === "online_purchase") return "online_purchase"
    if (key === "reimbursement") return "reimbursement"
    return "provider_payment"
  }

  function normalizePaymentMethod(raw) {
    const key = normalize(raw)
    if (!key) return "transfer"
    if (key.includes("transfer") || key.includes("bancaria") || key.includes("clabe") || key.includes("spei")) return "transfer"
    if (key.includes("efectivo") || key === "cash") return "cash"
    if (key.includes("cheque") || key === "check") return "check"
    return "other"
  }

  function requestTypeLabel(raw) {
    return requestTypeLabels[normalizeRequestType(raw)] || "Pago a proveedor"
  }

  function paymentMethodLabel(raw) {
    return paymentMethodLabels[normalizePaymentMethod(raw)] || "Otro"
  }

  function paymentMethodVariant(raw) {
    const method = normalizePaymentMethod(raw)
    if (method === "transfer") return "success"
    if (method === "cash") return "warning"
    if (method === "check") return "info"
    return "neutral"
  }

  function relabelSelect(select, labelText, helpText) {
    const label = select?.closest("label")
    if (!label) return
    replaceFirstText(label, labelText)
    if (helpText && !label.querySelector("[data-fase2-help]")) {
      label.insertAdjacentHTML("beforeend", "<span class=\"fase2-field-help\" data-fase2-help>" + escapeHtml(helpText) + "</span>")
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
    style.textContent = ".fase2-field-help{display:block;margin-top:4px;color:var(--text-3);font-size:11px;font-weight:500;line-height:1.4;text-transform:none;letter-spacing:0}.fase2-inline-badges{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.fase2-mini-badge{display:inline-flex;align-items:center;min-height:22px;padding:2px 8px;border-radius:999px;border:1px solid var(--border);font-size:10.5px;font-weight:800;line-height:1;color:var(--text-2);background:var(--bg-hover)}.fase2-mini-badge.success{background:var(--emerald-dim);border-color:rgba(18,183,106,.24);color:var(--emerald)}.fase2-mini-badge.warning{background:var(--amber-dim);border-color:rgba(245,158,11,.24);color:var(--amber)}.fase2-mini-badge.info{background:var(--accent-dim);border-color:rgba(15,118,110,.24);color:var(--accent-text)}.fase2-mini-badge.neutral{background:var(--bg-hover);color:var(--text-2)}.fase2-detail-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:rgba(255,255,255,.018)}.fase2-success-panel{margin:0 2px 16px;padding:18px;border:1px solid rgba(18,183,106,.28);border-radius:14px;background:var(--emerald-dim);color:var(--text-1);display:flex;flex-direction:column;gap:8px}.fase2-success-panel strong{font-size:16px;color:var(--emerald)}.fase2-success-panel span{font-size:13px;color:var(--text-2)}.fase2-success-folio{font-weight:900;color:var(--text-1)!important}.fase2-floating-success{position:fixed;top:18px;right:18px;z-index:2147483000;max-width:min(420px,calc(100vw - 32px));padding:16px 18px;border:1px solid rgba(18,183,106,.34);border-radius:16px;background:linear-gradient(135deg,rgba(6,78,59,.98),rgba(8,47,73,.98));box-shadow:0 22px 60px rgba(0,0,0,.42);color:#ecfdf5;display:flex;flex-direction:column;gap:4px;opacity:0;transform:translateY(-10px);transition:opacity .22s ease,transform .22s ease;pointer-events:none}.fase2-floating-success.is-visible{opacity:1;transform:translateY(0)}.fase2-floating-success strong{font-size:15px;font-weight:900;color:#cfe1cb}.fase2-floating-success span{font-size:13px;font-weight:700;color:#d1fae5}@media (max-width:720px){.fase2-floating-success{top:12px;left:12px;right:12px;max-width:none}}"
    document.head.appendChild(style)
  }

  function miniBadge(label, variant) {
    return "<span class=\"fase2-mini-badge " + escapeHtml(variant || "neutral") + "\">" + escapeHtml(label) + "</span>"
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

  function numberValue(raw) {
    const number = Number(String(raw || "").replace(/,/g, ""))
    return Number.isFinite(number) ? number : 0
  }

  function normalize(raw) {
    return String(raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim()
  }

  function formatCurrencyFull(raw) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(numberValue(raw))
  }

  function formatDate(raw) {
    if (!raw) return "Sin fecha"
    const date = new Date(raw)
    if (Number.isNaN(date.getTime())) return String(raw).slice(0, 10)
    return date.toLocaleDateString("es-MX")
  }

  function escapeHtml(raw) {
    return String(raw ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Error desconocido")
    if (message.includes("payment_method")) return "La columna payment_method no esta disponible en este ambiente. Falta aplicar la migracion 004c."
    if (message.includes("online_purchase")) return "El tipo Compra en linea no esta disponible en este ambiente. Falta aplicar la migracion 004c."
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "No tienes permiso para realizar esta accion."
    return message
  }

  function toast(title, desc, variant) {
    if (window.Components?.showToast) return window.Components.showToast({ title, desc, variant, duration: 6 })
    if (window.FluxToast?.show) return window.FluxToast.show({ title, message: desc, type: variant })
    if (window.showToast) return window.showToast(title, desc, variant)
    console[variant === "error" || variant === "danger" ? "error" : "log"]("[" + title + "] " + desc)
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
