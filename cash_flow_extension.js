;(function fluxCashFlowExtension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!client) return

  const requestTypeLabels = {
    provider_payment: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    reimbursement: "Reembolso",
    deposit_refund: "Devolucion de deposito",
    other: "Otro",
  }

  const cashStatuses = {
    active: "Activo",
    pending_receipt: "Pendiente de comprobar",
    blocked: "Bloqueado",
    receipt_review: "En revision",
    verified: "Verificado",
    closed: "Cerrado",
    cancelled: "Cancelado",
  }

  let profiles = []
  let currentProfile = null
  let activeCashRequest = null

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initExtension)
  } else {
    initExtension()
  }

  async function initExtension() {
    injectStyles()
    await resolveProfile()
    if (pageName === "solicitudes.html") initSolicitudesCashFlow()
    if (pageName === "efectivo.html") initEfectivoQuickFilters()
  }

  async function resolveProfile() {
    const { data: { session } } = await client.auth.getSession()
    if (!session) return

    const lookups = [
      ["auth_user_id", session.user.id],
      ["email", session.user.email],
    ].filter(([, value]) => value)

    for (const [column, value] of lookups) {
      const { data } = await client.from("profiles").select("id,full_name,email,active").eq(column, value).maybeSingle()
      if (data?.id) {
        currentProfile = data
        break
      }
    }
  }

  async function loadProfiles() {
    if (profiles.length) return profiles
    const { data, error } = await client.from("profiles").select("id,full_name,email,active").order("full_name", { ascending: true })
    if (error) return []
    profiles = (data || []).filter((profile) => profile.active !== false)
    return profiles
  }

  async function initSolicitudesCashFlow() {
    await loadProfiles()
    ensureRequestTypeFields()
    bindCashRequestForm()
    patchRequestTypeBadges()
    patchRequestDetail()
  }

  function ensureRequestTypeFields() {
    const requestForm = document.getElementById("requestForm")
    if (!requestForm || document.getElementById("requestType")) return

    const firstGrid = requestForm.querySelector(".form-section .form-grid")
    if (!firstGrid) return

    firstGrid.insertAdjacentHTML("afterbegin", `
      <label class="full-row">Tipo de solicitud *
        <select id="requestType" class="form-control" required>
          <option value="provider_payment">Pago a proveedor / Transferencia</option>
          <option value="cash">Efectivo</option>
          <option value="check">Cheque</option>
          <option value="reimbursement">Reembolso</option>
          <option value="deposit_refund">Devolucion de deposito</option>
          <option value="other">Otro</option>
        </select>
      </label>
    `)

    const firstSection = requestForm.querySelector(".form-section")
    firstSection.insertAdjacentHTML("afterend", `
      <section class="form-section hidden" id="cashCheckSection">
        <h3>Datos de comprobacion</h3>
        <div class="form-grid">
          <div class="field-hint full-row">Este tipo de solicitud genera un fondo que debera comprobarse con tickets o comprobantes.</div>
          <label>Responsable del gasto *
            <select id="cashResponsibleProfileId" class="form-control">${profileOptions()}</select>
          </label>
          <label>Fecha limite de comprobacion *
            <input id="cashDueDate" class="form-control" type="date">
          </label>
          <label>Metodo de entrega *
            <select id="cashDeliveryMethod" class="form-control">
              <option value="cash">Efectivo</option>
              <option value="check">Cheque</option>
            </select>
          </label>
          <div id="cashBlockStatus" class="field-hint full-row">Selecciona responsable para verificar si tiene fondos pendientes vencidos.</div>
        </div>
      </section>
    `)

    ensureCashFundDialog()

    const typeSelect = document.getElementById("requestType")
    const methodSelect = document.getElementById("cashDeliveryMethod")
    const responsibleSelect = document.getElementById("cashResponsibleProfileId")
    typeSelect.addEventListener("change", updateCashRequestVisibility)
    methodSelect.addEventListener("change", () => {
      if (["cash", "check"].includes(typeSelect.value)) typeSelect.value = methodSelect.value
      updateCashRequestVisibility()
    })
    responsibleSelect.addEventListener("change", () => verifyCashBlock(responsibleSelect.value, document.getElementById("cashBlockStatus")))
    updateCashRequestVisibility()
  }

  function updateCashRequestVisibility() {
    const type = document.getElementById("requestType")?.value || "provider_payment"
    const isCash = type === "cash" || type === "check"
    document.getElementById("cashCheckSection")?.classList.toggle("hidden", !isCash)
    document.getElementById("requestLayoutDetails")?.classList.toggle("hidden", isCash)
    const method = document.getElementById("cashDeliveryMethod")
    if (method && isCash) method.value = type === "check" ? "check" : "cash"
  }

  function bindCashRequestForm() {
    const form = document.getElementById("requestForm")
    if (!form || form.dataset.cashFlowBound) return
    form.dataset.cashFlowBound = "true"

    form.addEventListener("submit", async (event) => {
      const type = document.getElementById("requestType")?.value || "provider_payment"
      if (type !== "cash" && type !== "check") return

      event.preventDefault()
      event.stopImmediatePropagation()
      await submitCashOrCheckRequest(type)
    }, true)
  }

  async function submitCashOrCheckRequest(type) {
    const submitButton = document.getElementById("submitRequestBtn")
    const payload = collectRequestPayload(type)
    const validation = validateCashRequest(payload)
    if (validation) return toast("Revisa la solicitud", validation, "warning")

    submitButton.disabled = true
    submitButton.textContent = "Creando solicitud..."

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
        p_requested_by: currentProfile?.id || null,
        p_is_extraordinary_adjustment: payload.is_extraordinary_adjustment,
        p_approver_id: payload.approver_id,
        p_approver_assignment_id: payload.approver_assignment_id,
      })
      if (error) throw error

      const result = Array.isArray(data) ? (data[0] || {}) : (data || {})
      const requestId = result.payment_request_id || result.id
      if (requestId) {
        await client.from("payment_requests").update({
          request_type: type,
          updated_at: new Date().toISOString(),
        }).eq("id", requestId)
        localStorage.setItem(`flux-cash-request-${requestId}`, JSON.stringify({
          responsible_profile_id: payload.responsible_profile_id,
          due_date: payload.due_date,
          delivery_method: payload.delivery_method,
        }))
      }

      toast("Solicitud creada", `${result.request_number || "Solicitud"} creada como ${requestTypeLabels[type]}.`, "success")
      document.getElementById("requestDialog")?.close()
      window.setTimeout(() => window.location.reload(), 900)
    } catch (error) {
      toast("No se pudo crear la solicitud", friendlyError(error), "error")
      submitButton.disabled = false
      submitButton.textContent = "Crear solicitud"
    }
  }

  function collectRequestPayload(type) {
    const currency = document.getElementById("currency")?.value || "MXN"
    return {
      request_type: type,
      proveedor_id: value("proveedorId"),
      company_id: value("companyId"),
      approver_id: value("approverId"),
      approver_assignment_id: value("approverAssignmentId") || null,
      cost_center_id: value("costCenterId"),
      budget_category_id: value("budgetCategoryId"),
      budget_month: value("budgetMonth") ? `${value("budgetMonth")}-01` : null,
      amount_requested: numberValue(value("amountRequested")),
      currency,
      exchange_rate: currency === "MXN" ? 1 : numberValue(value("exchangeRate")),
      description: value("description"),
      notes: value("notes") || null,
      is_extraordinary_adjustment: Boolean(window.FluxAuth?.canApprove?.() && document.getElementById("isExtraordinaryAdjustment")?.checked),
      responsible_profile_id: value("cashResponsibleProfileId"),
      due_date: value("cashDueDate"),
      delivery_method: value("cashDeliveryMethod") || type,
    }
  }

  function validateCashRequest(payload) {
    if (!payload.company_id) return "Selecciona una empresa."
    if (!payload.approver_id) return "Selecciona quien revisa o aprueba la solicitud."
    if (!payload.cost_center_id) return "Selecciona un centro de costo."
    if (!payload.budget_category_id) return "Selecciona una partida presupuestal."
    if (!payload.budget_month) return "Selecciona el mes presupuestal."
    if (!payload.proveedor_id) return "Selecciona un proveedor."
    if (!payload.amount_requested || payload.amount_requested <= 0) return "El monto solicitado debe ser mayor a 0."
    if (!payload.description) return "Captura una descripcion."
    if (!payload.responsible_profile_id) return "Selecciona el responsable del gasto."
    if (!payload.due_date) return "Captura la fecha limite de comprobacion."
    if (!["cash", "check"].includes(payload.delivery_method)) return "Selecciona efectivo o cheque como metodo de entrega."
    return ""
  }

  function patchRequestDetail() {
    const target = document.getElementById("detailContent")
    if (!target) return
    const observer = new MutationObserver(() => window.setTimeout(appendCashFundSection, 120))
    observer.observe(target, { childList: true, subtree: false })
  }

  async function patchRequestTypeBadges() {
    const tbody = document.getElementById("requestsTableBody")
    if (!tbody) return

    const apply = async () => {
      const { data } = await client.from("payment_requests").select("request_number,request_type,payment_method")
      const byNumber = new Map((data || []).map((request) => [request.request_number, effectivePaymentType(request)]))
      tbody.querySelectorAll("tr").forEach((row) => {
        const strong = row.querySelector("td:first-child strong")
        if (!strong || row.querySelector("[data-request-type-badge]")) return
        const type = byNumber.get(strong.textContent.trim())
        if (!type || type === "provider_payment") return
        const badge = document.createElement("span")
        badge.dataset.requestTypeBadge = "true"
        badge.className = `badge ${type === "cash" ? "badge-warning" : type === "check" ? "badge-extra" : "badge-neutral"}`
        badge.textContent = requestTypeLabels[type] || type
        badge.style.marginLeft = "6px"
        strong.insertAdjacentElement("afterend", badge)
      })
    }

    const observer = new MutationObserver(() => apply())
    observer.observe(tbody, { childList: true, subtree: true })
    window.setTimeout(apply, 800)
  }

  async function appendCashFundSection() {
    const target = document.getElementById("detailContent")
    if (!target || target.querySelector("[data-cash-fund-section]")) return

    const requestNumber = document.getElementById("detailTitle")?.textContent?.trim()
    if (!requestNumber || requestNumber === "Detalle de solicitud") return

    const { data: request } = await client
      .from("payment_requests")
      .select("id,request_number,request_type,payment_method,amount_requested,currency")
      .eq("request_number", requestNumber)
      .maybeSingle()
    const method = effectivePaymentType(request)
    if (!request || !["cash", "check"].includes(method)) return

    const layoutSection = Array.from(target.querySelectorAll("section")).find((section) => /Preparacion para layout/i.test(section.textContent))
    if (layoutSection) layoutSection.classList.add("hidden")

    const [{ data: funds, error: fundsError }, contextResult] = await Promise.all([
      client.from("cash_funds").select("*").eq("payment_request_id", request.id).order("created_at", { ascending: false }),
      loadExecutionContext(request.id),
    ])
    const fund = funds?.[0] || null
    const context = contextResult.data || null
    const draft = getDraft(request.id)
    const canCreate = !fundsError && context?.can_create_cash_fund === true && !fund
    const availabilityMessage = cashFundAvailabilityMessage(context, fund, contextResult.error || fundsError)
    const authorizationSource = executionAuthorizationSourceLabel(context?.execution_authorization_source)

    target.insertAdjacentHTML("beforeend", `
      <section class="decision-card" data-cash-fund-section>
        <h3>Fondo y comprobacion</h3>
        <p>Esta solicitud se opera como ${escapeHtml(requestTypeLabels[method].toLowerCase())}. El fondo se comprueba desde Efectivo y comprobaciones.</p>
        <div class="decision-note ${fund || canCreate ? "success" : "neutral"}">
          ${escapeHtml(availabilityMessage)}
        </div>
        <div class="detail-grid">
          ${detailCard("Tipo", requestTypeLabels[method])}
          ${detailCard("Responsable", fund ? profileName(fund.responsible_profile_id) : profileName(draft?.responsible_profile_id))}
          ${detailCard("Fecha limite", fund ? formatDate(fund.due_date) : formatDate(draft?.due_date))}
          ${detailCard("Metodo", requestTypeLabels[method])}
          ${detailCard("Importe autorizado", formatCurrency(request.amount_requested))}
          ${detailCard("Actor de ejecucion", context?.is_finance === true ? "Finanzas" : "Sin rol de Finanzas")}
          ${detailCard("Autorizacion", authorizationSource)}
          ${detailCard("Estado del fondo", fund ? cashStatuses[fund.status] || fund.status : "Sin fondo creado")}
          ${detailCard("Monto pendiente", fund ? formatCurrency(fund.pending_amount) : "Pendiente de crear fondo")}
        </div>
        <div class="decision-actions">
          ${canCreate ? `<button type="button" class="decision-btn approve" data-create-cash-fund="${escapeHtml(request.id)}">${method === "check" ? "Registrar entrega de cheque" : "Registrar entrega de efectivo"}</button>` : ""}
          <button type="button" class="decision-btn change" data-go-cash-funds="${fund ? escapeHtml(fund.id) : ""}">Ver en Efectivo y comprobaciones</button>
        </div>
      </section>
    `)

    target.querySelector("[data-create-cash-fund]")?.addEventListener("click", () => openCashFundDialog(request, draft, context))
    target.querySelector("[data-go-cash-funds]")?.addEventListener("click", (event) => {
      const fundId = event.currentTarget.dataset.goCashFunds
      window.location.href = `./efectivo.html${fundId ? `?fund_id=${fundId}` : ""}`
    })
  }

  async function loadExecutionContext(requestId) {
    const sharedLoader = window.FluxBatchExecutionContext?.get
    if (typeof sharedLoader === "function") return sharedLoader(requestId)
    return client.rpc("get_payment_request_execution_context", {
      p_payment_request_id: requestId,
    })
  }

  function cashFundAvailabilityMessage(context, fund, error) {
    if (fund) return "El fondo ya fue creado."
    if (error || !context) return "No se pudo confirmar si la solicitud esta autorizada para crear un fondo."
    if (context.can_create_cash_fund === true) return "Autorizada y liberada para crear fondo."
    return ({
      finance_role_required: "Solo Finanzas puede crear el fondo.",
      cash_fund_batch_not_closed: "Dirección aprobó; Finanzas debe liberar el corte.",
      cash_fund_direction_pending: "Pendiente de decisión de Dirección.",
      cash_fund_direction_rejected: "La solicitud fue rechazada por Dirección.",
      cash_fund_material_change_requires_reapproval: "Los datos cambiaron y requieren una nueva revisión de Dirección.",
      cash_fund_extraordinary_not_current: "La autorización extraordinaria ya no está vigente.",
      cash_fund_already_exists: "El fondo ya fue creado.",
      cash_fund_execution_not_authorized: "La solicitud todavía no está autorizada para crear un fondo.",
      payment_request_must_be_cash_or_check: "Solo solicitudes de efectivo o cheque pueden generar fondo.",
    })[context.cash_fund_block_reason] || "La solicitud todavía no está autorizada para crear un fondo."
  }

  function executionAuthorizationSourceLabel(source) {
    return ({
      closed_batch: "Corte cerrado",
      extraordinary: "Autorización extraordinaria",
      legacy_approved: "Aprobación heredada",
    })[source] || "No autorizada"
  }

  function ensureCashFundDialog() {
    if (document.getElementById("cashFundDialog")) return
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="cashFundDialog">
        <form id="cashFundForm" class="modal-content">
          <div class="modal-header">
            <div><h2 id="cashFundTitle">Registrar entrega</h2><p>Crea el fondo para que el responsable pueda comprobarlo.</p></div>
            <button type="button" id="closeCashFundModalBtn" class="icon-btn" aria-label="Cerrar">x</button>
          </div>
          <div class="cash-fund-request-summary" aria-live="polite">
            <div><span>Solicitud</span><strong id="fundRequestNumber">-</strong></div>
            <div><span>Importe</span><strong id="fundAssignedAmount">$0.00</strong></div>
            <div><span>Autorizacion</span><strong id="fundAuthorizationSource">-</strong></div>
          </div>
          <div class="form-grid">
            <label class="full-row">Responsable del gasto *
              <select id="fundResponsibleProfileId" class="form-control" required>${profileOptions()}</select>
              <span id="fundResponsibleHelp" class="field-hint">Selecciona quien comprobara este fondo.</span>
            </label>
            <label>Fecha limite de comprobacion *
              <input id="fundDueDate" class="form-control" type="date" required>
            </label>
            <label>Metodo de entrega *
              <select id="fundDeliveryMethod" class="form-control" required>
                <option value="cash">Efectivo</option>
                <option value="check">Cheque</option>
              </select>
            </label>
            <label class="full-row">Notas
              <textarea id="fundNotes" class="form-control textarea" rows="3" placeholder="Notas de entrega, folio de cheque o comentarios operativos..."></textarea>
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" id="cancelCashFundBtn" class="secondary-btn">Cancelar</button>
            <button type="submit" id="submitCashFundBtn" class="primary-btn">Crear fondo</button>
          </div>
        </form>
      </dialog>
    `)
    document.getElementById("closeCashFundModalBtn").addEventListener("click", closeCashFundDialog)
    document.getElementById("cancelCashFundBtn").addEventListener("click", closeCashFundDialog)
    document.getElementById("fundResponsibleProfileId").addEventListener("change", (event) => verifyCashBlock(event.target.value, document.getElementById("fundResponsibleHelp")))
    document.getElementById("cashFundForm").addEventListener("submit", submitCashFund)
  }

  function openCashFundDialog(request, draft, context) {
    activeCashRequest = request
    ensureCashFundDialog()
    const method = effectivePaymentType(request)
    document.getElementById("cashFundTitle").textContent = method === "check" ? "Registrar entrega de cheque" : "Registrar entrega de efectivo"
    document.getElementById("fundRequestNumber").textContent = request.request_number || "Solicitud"
    document.getElementById("fundAssignedAmount").textContent = formatCurrency(request.amount_requested)
    document.getElementById("fundAuthorizationSource").textContent = executionAuthorizationSourceLabel(context?.execution_authorization_source)
    document.getElementById("fundResponsibleProfileId").value = draft?.responsible_profile_id || ""
    document.getElementById("fundDueDate").value = draft?.due_date || ""
    document.getElementById("fundDeliveryMethod").value = draft?.delivery_method || method
    document.getElementById("fundDeliveryMethod").disabled = true
    document.getElementById("fundNotes").value = ""
    verifyCashBlock(document.getElementById("fundResponsibleProfileId").value, document.getElementById("fundResponsibleHelp"))
    document.getElementById("cashFundDialog").showModal()
  }

  function effectivePaymentType(request) {
    const paymentMethod = String(request?.payment_method || "").trim().toLowerCase()
    if (["cash", "check"].includes(paymentMethod)) return paymentMethod
    const requestType = String(request?.request_type || "").trim().toLowerCase()
    if (["cash", "check"].includes(requestType)) return requestType
    return requestType || "provider_payment"
  }

  function closeCashFundDialog() {
    activeCashRequest = null
    document.getElementById("fundDeliveryMethod").disabled = false
    document.getElementById("cashFundDialog")?.close()
  }

  async function submitCashFund(event) {
    event.preventDefault()
    if (!activeCashRequest) return
    if (!currentProfile?.id) return toast("Perfil no identificado", "No se pudo identificar tu perfil de usuario.", "error")

    const button = document.getElementById("submitCashFundBtn")
    const payload = {
      p_payment_request_id: activeCashRequest.id,
      p_responsible_profile_id: value("fundResponsibleProfileId"),
      p_due_date: value("fundDueDate"),
      p_delivery_method: value("fundDeliveryMethod"),
      p_delivered_by: currentProfile.id,
      p_notes: value("fundNotes") || null,
    }
    if (!payload.p_responsible_profile_id) return toast("Responsable requerido", "Selecciona el responsable del gasto.", "error")
    if (!payload.p_due_date) return toast("Fecha requerida", "Captura la fecha limite de comprobacion.", "error")

    button.disabled = true
    button.textContent = "Creando fondo..."
    try {
      const { error } = await client.rpc("create_cash_fund", payload)
      if (error) throw error
      localStorage.removeItem(`flux-cash-request-${activeCashRequest.id}`)
      toast("Fondo creado", "Fondo creado correctamente. Queda pendiente de comprobacion.", "success")
      closeCashFundDialog()
      window.setTimeout(() => window.location.reload(), 900)
    } catch (error) {
      toast("No se pudo crear el fondo", friendlyCashFundError(error), "error")
    } finally {
      button.disabled = false
      button.textContent = "Crear fondo"
    }
  }

  async function initEfectivoQuickFilters() {
    if (document.getElementById("filterStrip")) return
    const stats = document.querySelector(".stats-grid")
    const toolbar = document.querySelector(".table-toolbar")
    if (!stats || !toolbar) return

    stats.querySelectorAll(".stat-card").forEach((card, index) => {
      const keys = ["active", "pending", "review", "closed", "pending_amount"]
      card.dataset.quickFilter = keys[index]
      card.classList.add("clickable")
      card.setAttribute("role", "button")
      card.tabIndex = 0
      card.addEventListener("click", () => renderCashFundsFilter(keys[index]))
    })

    toolbar.insertAdjacentHTML("afterend", `
      <div id="filterStrip" class="filter-strip hidden">
        <span id="filterLabel">Vista filtrada</span>
        <button id="clearQuickFilterBtn" type="button" class="small-btn">Ver todos</button>
      </div>
    `)
    document.getElementById("clearQuickFilterBtn").addEventListener("click", () => {
      document.getElementById("filterStrip").classList.add("hidden")
      document.querySelectorAll(".stat-card.selected").forEach((card) => card.classList.remove("selected"))
      renderCashFundsFilter("all")
    })

    patchEfectivoDetailMessages()
    const params = new URLSearchParams(window.location.search)
    const fundId = params.get("fund_id")
    if (fundId) window.setTimeout(() => window.openFundDetail?.(fundId), 1200)
  }

  async function renderCashFundsFilter(filter) {
    const [fundsResult, requestsResult, profilesResult, companiesResult, reconciliationsResult] = await Promise.all([
      client.from("cash_funds").select("*").order("created_at", { ascending: false }),
      client.from("payment_requests").select("id,request_number,description"),
      client.from("profiles").select("id,full_name,email"),
      client.from("companies").select("id,name,legal_name"),
      client.from("cash_reconciliations").select("id,cash_fund_id,status"),
    ])
    const funds = fundsResult.data || []
    const requests = requestsResult.data || []
    const people = profilesResult.data || []
    const companies = companiesResult.data || []
    const reconciliations = reconciliationsResult.data || []

    const filtered = funds.filter((fund) => {
      if (filter === "active") return ["active", "pending_receipt", "receipt_review", "blocked"].includes(fund.status)
      if (filter === "pending") return ["pending_receipt", "blocked"].includes(fund.status)
      if (filter === "review") return fund.status === "receipt_review" || reconciliations.some((item) => item.cash_fund_id === fund.id && item.status === "submitted")
      if (filter === "closed") return fund.status === "closed"
      if (filter === "pending_amount") return numberValue(fund.pending_amount) > 0 && !["closed", "cancelled"].includes(fund.status)
      return true
    })

    const labels = {
      active: "Fondos activos",
      pending: "Pendientes de comprobar",
      review: "En revision",
      closed: "Cerrados",
      pending_amount: "Con monto pendiente",
      all: "Todos",
    }
    document.querySelectorAll(".stat-card").forEach((card) => card.classList.toggle("selected", card.dataset.quickFilter === filter && filter !== "all"))
    document.getElementById("filterStrip").classList.toggle("hidden", filter === "all")
    document.getElementById("filterLabel").textContent = `Vista filtrada: ${labels[filter] || "Fondos"}`

    const tbody = document.getElementById("fundsTableBody")
    if (!filtered.length) {
      const empty = filter === "pending" ? "No hay fondos pendientes de comprobar." : filter === "review" ? "No hay fondos en revision." : filter === "closed" ? "No hay fondos cerrados." : "No hay fondos para este filtro."
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state"><strong>${empty}</strong>Ajusta la busqueda o cambia los filtros.</td></tr>`
      return
    }

    tbody.innerHTML = filtered.map((fund) => {
      const request = requests.find((item) => item.id === fund.payment_request_id)
      const profile = people.find((item) => item.id === fund.responsible_profile_id)
      const company = companies.find((item) => item.id === fund.company_id)
      return `<tr>
        <td><strong>${escapeHtml(request?.request_number || "Sin solicitud")}</strong><span class="muted-line">${escapeHtml(request?.description || fund.notes || "Sin descripcion")}</span></td>
        <td>${escapeHtml(profile?.full_name || profile?.email || "Sin responsable")}</td>
        <td>${escapeHtml(company?.legal_name || company?.name || "Sin empresa")}</td>
        <td>${escapeHtml(requestTypeLabels[fund.delivery_method] || fund.delivery_method || "Sin metodo")}</td>
        <td><strong>${escapeHtml(formatCurrency(fund.assigned_amount))}</strong></td>
        <td>${escapeHtml(formatCurrency(fund.verified_amount))}</td>
        <td><strong>${escapeHtml(formatCurrency(fund.pending_amount))}</strong></td>
        <td>${escapeHtml(formatDate(fund.due_date))}</td>
        <td><span class="badge badge-${escapeHtml(fund.status || "neutral")}">${escapeHtml(cashStatuses[fund.status] || fund.status || "Sin estatus")}</span></td>
        <td><button class="small-btn" type="button" onclick="openFundDetail('${escapeHtml(fund.id)}')">Ver detalle</button></td>
      </tr>`
    }).join("")
  }

  function patchEfectivoDetailMessages() {
    const target = document.getElementById("detailContent")
    if (!target) return
    const observer = new MutationObserver(() => {
      if (!/Cerrado/i.test(document.getElementById("detailSubtitle")?.textContent || "")) return
      target.querySelector(".actions")?.classList.add("hidden")
      if (!target.querySelector("[data-closed-fund-note]")) {
        const section = target.querySelector(".section-card")
        section?.insertAdjacentHTML("beforeend", `
          <div class="notice" data-closed-fund-note>Este fondo ya esta cerrado. La comprobacion fue aprobada y no requiere mas acciones.</div>
          <div class="notice warning">Acciones no disponibles porque la comprobacion ya fue aprobada.</div>
        `)
      }
    })
    observer.observe(target, { childList: true, subtree: true })
  }

  async function verifyCashBlock(profileId, target) {
    if (!target) return
    target.classList.remove("success", "warning", "error")
    if (!profileId) {
      target.textContent = "Selecciona responsable para verificar si tiene fondos pendientes vencidos."
      return
    }
    target.textContent = "Verificando fondos pendientes del responsable..."
    try {
      const { data, error } = await client.rpc("verify_cash_block", { p_profile_id: profileId })
      if (error) throw error
      if (data?.blocked) {
        target.textContent = "El responsable tiene fondos vencidos o pendientes de comprobar. La solicitud puede registrarse, pero quedara marcada para revision."
        target.classList.add("warning")
      } else {
        target.textContent = "El responsable no tiene fondos vencidos pendientes."
        target.classList.add("success")
      }
    } catch (error) {
      target.textContent = friendlyError(error)
      target.classList.add("error")
    }
  }

  function profileOptions() {
    return `<option value="">Seleccionar responsable</option>` + profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profileName(profile.id))}</option>`).join("")
  }

  function getDraft(requestId) {
    try { return JSON.parse(localStorage.getItem(`flux-cash-request-${requestId}`) || "null") } catch (_) { return null }
  }

  function profileName(id) {
    const profile = profiles.find((item) => item.id === id)
    return profile ? (profile.full_name || profile.email || "Responsable") : "Sin responsable"
  }

  function detailCard(label, value) {
    return `<div class="detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  }

  function value(id) {
    return String(document.getElementById(id)?.value || "").trim()
  }

  function numberValue(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(numberValue(value))
  }

  function formatDate(value) {
    if (!value) return "Sin fecha"
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
    return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date)
  }

  function toast(title, message, type = "success") {
    let stack = document.getElementById("toastStack")
    if (!stack) {
      stack = document.createElement("div")
      stack.id = "toastStack"
      stack.className = "toast-stack-v2"
      stack.setAttribute("aria-live", "polite")
      document.body.appendChild(stack)
    }
    const node = document.createElement("div")
    node.className = `toast ${type}`
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
    stack.appendChild(node)
    window.setTimeout(() => node.remove(), 6200)
  }

  function friendlyCashFundError(error) {
    const message = error?.message || String(error || "Error desconocido")
    const known = {
      payment_request_must_be_approved: "La solicitud debe estar aprobada para crear el fondo.",
      payment_request_must_be_cash_or_check: "Solo solicitudes de efectivo o cheque pueden generar fondo.",
      finance_role_required: "Solo Finanzas puede crear el fondo.",
      cash_fund_batch_not_closed: "Dirección aprobó; Finanzas debe liberar el corte.",
      cash_fund_direction_pending: "Pendiente de decisión de Dirección.",
      cash_fund_direction_rejected: "La solicitud fue rechazada por Dirección.",
      cash_fund_material_change_requires_reapproval: "Los datos cambiaron y requieren una nueva revisión de Dirección.",
      cash_fund_extraordinary_not_current: "La autorización extraordinaria ya no está vigente.",
      cash_fund_already_exists: "El fondo ya fue creado.",
      cash_fund_execution_not_authorized: "La solicitud todavía no está autorizada para crear un fondo.",
      responsible_profile_not_found: "No se encontro el responsable.",
      invalid_delivery_method: "Metodo de entrega invalido.",
    }
    const key = Object.keys(known).find((item) => message.includes(item))
    return key ? known[key] : friendlyError(error)
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Error desconocido")
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "La operacion fue bloqueada por RLS. Puede faltar una policy para usuarios autenticados."
    if (message.toLowerCase().includes("permission denied")) return "Faltan permisos para ejecutar la operacion."
    return message
  }

  function injectStyles() {
    if (document.getElementById("cashFlowExtensionStyles")) return
    const style = document.createElement("style")
    style.id = "cashFlowExtensionStyles"
    style.textContent = `
      .stat-card.clickable{cursor:pointer;text-align:left;width:100%;appearance:none;font:inherit;color:inherit}
      .stat-card.clickable:hover{border-color:var(--border-strong);transform:translateY(-1px);box-shadow:0 12px 34px rgba(0,0,0,.22)}
      .stat-card.selected{border-color:rgba(94,234,212,.34);box-shadow:0 0 0 3px var(--accent-dim)}
      .filter-strip{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:rgba(15,118,110,.07)}
      .filter-strip span{color:var(--accent-text);font-size:12px;font-weight:700}
      .cash-fund-request-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 18px;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface-soft)}
      .cash-fund-request-summary div{display:grid;gap:3px;min-width:0}
      .cash-fund-request-summary span{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em}
      .cash-fund-request-summary strong{font-size:14px;overflow-wrap:anywhere}
      @media (max-width:640px){.cash-fund-request-summary{grid-template-columns:1fr}}
    `
    document.head.appendChild(style)
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }
})()
