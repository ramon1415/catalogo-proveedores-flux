const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const ACTIVE_FUND_STATUSES = ["active", "pending_receipt", "receipt_review", "blocked"]
const PENDING_FUND_STATUSES = ["pending_receipt", "blocked"]
const REVIEW_ROLES = ["admin", "finance", "finanzas", "approver_2", "aprobador_2", "sysadmin", "system_admin", "treasury", "tesoreria"]

const dom = {}
let currentProfile = null
let currentRoles = []
let cashFunds = []
let reconciliations = []
let reconciliationItems = []
let paymentRequests = []
let profiles = []
let companies = []
let proveedores = []
let budgetCategories = []
let activeFundId = null
let activeReconciliationId = null
let activeReviewAction = null

document.addEventListener("DOMContentLoaded", initCashPage)

async function initCashPage() {
  cacheDom()
  bindEvents()

  try {
    await FluxAuth.ready()
    const profile = FluxAuth.getProfile()
    currentProfile = profile
    currentRoles = FluxAuth.state.roles || []
    if (profile) {
      dom.userName.textContent = profile.full_name || "Usuario"
      dom.userEmail.textContent = FluxAuth.state.session?.user?.email || "Sesion activa"
    }
    await loadCashData()
  } catch (error) {
    showToast("No fue posible iniciar", friendlyError(error), "danger")
  }
}

function cacheDom() {
  ;[
    "themeToggle", "userName", "userEmail", "logoutBtn", "refreshBtn", "searchInput", "statusFilter", "methodFilter",
    "responsibleFilter", "companyFilter", "fundsTableBody", "toastStack", "activeFunds", "pendingFunds",
    "reviewFunds", "closedFunds", "pendingAmount", "fundDetailDialog", "detailTitle", "detailSubtitle", "detailContent",
    "closeDetailModalBtn", "closeDetailFooterBtn", "ticketDialog", "ticketForm", "ticketConcept", "ticketAmount", "ticketDate",
    "ticketProviderId", "ticketBudgetCategoryId", "closeTicketModalBtn", "cancelTicketBtn", "submitTicketBtn", "submitDialog",
    "submitReconciliationForm", "submitTotalTickets", "submitAssignedAmount", "submitDifference", "returnedAmount", "closeSubmitModalBtn",
    "cancelSubmitBtn", "submitReconciliationBtn", "reviewDialog", "reviewForm", "reviewTitle", "reviewSubtitle", "reviewComment",
    "closeReviewModalBtn", "cancelReviewBtn", "submitReviewBtn",
  ].forEach((id) => { dom[id] = document.getElementById(id) })
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", logout)
  dom.refreshBtn?.addEventListener("click", loadCashData)
  ;[dom.searchInput, dom.statusFilter, dom.methodFilter, dom.responsibleFilter, dom.companyFilter]
    .forEach((el) => el?.addEventListener("input", renderFundsTable))
  ;[dom.statusFilter, dom.methodFilter, dom.responsibleFilter, dom.companyFilter]
    .forEach((el) => el?.addEventListener("change", renderFundsTable))
  dom.closeDetailModalBtn?.addEventListener("click", closeFundDetail)
  dom.closeDetailFooterBtn?.addEventListener("click", closeFundDetail)
  dom.detailContent?.addEventListener("click", handleDetailAction)
  dom.closeTicketModalBtn?.addEventListener("click", closeTicketModal)
  dom.cancelTicketBtn?.addEventListener("click", closeTicketModal)
  dom.ticketForm?.addEventListener("submit", saveTicket)
  dom.closeSubmitModalBtn?.addEventListener("click", closeSubmitModal)
  dom.cancelSubmitBtn?.addEventListener("click", closeSubmitModal)
  dom.returnedAmount?.addEventListener("input", updateSubmitTotals)
  dom.submitReconciliationForm?.addEventListener("submit", submitReconciliation)
  dom.closeReviewModalBtn?.addEventListener("click", closeReviewModal)
  dom.cancelReviewBtn?.addEventListener("click", closeReviewModal)
  dom.reviewForm?.addEventListener("submit", reviewReconciliation)
}

async function loadCashData() {
  dom.fundsTableBody.innerHTML = `<tr><td colspan="10" style="padding:44px;text-align:center;color:var(--text-3)">Cargando fondos...</td></tr>`

  const [fundsResult, reconciliationsResult, itemsResult, requestsResult, profilesResult, companiesResult, providersResult, categoriesResult] = await Promise.all([
    supabaseClient.from("cash_funds").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("cash_reconciliations").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("cash_reconciliation_items").select("*").order("created_at", { ascending: true }),
    supabaseClient.from("payment_requests").select("*"),
    supabaseClient.from("profiles").select("*"),
    supabaseClient.from("companies").select("*").order("name", { ascending: true }),
    supabaseClient.from("proveedores").select("*").order("alias", { ascending: true }),
    supabaseClient.from("budget_categories").select("*").order("code", { ascending: true }),
  ])

  if (fundsResult.error) {
    dom.fundsTableBody.innerHTML = `<tr><td colspan="10" style="padding:44px;text-align:center;color:var(--text-3)">${escapeHtml(rlsHint("cash_funds", "select", fundsResult.error))}</td></tr>`
    return
  }

  cashFunds = fundsResult.data || []
  reconciliations = reconciliationsResult.error ? [] : (reconciliationsResult.data || [])
  reconciliationItems = itemsResult.error ? [] : (itemsResult.data || [])
  paymentRequests = requestsResult.error ? [] : (requestsResult.data || [])
  profiles = profilesResult.error ? [] : (profilesResult.data || [])
  companies = companiesResult.error ? [] : (companiesResult.data || [])
  proveedores = providersResult.error ? [] : (providersResult.data || [])
  budgetCategories = categoriesResult.error ? [] : (categoriesResult.data || [])

  if (currentProfile && !profiles.some((p) => p.id === currentProfile.id)) profiles.push(currentProfile)

  populateFilters()
  populateTicketCatalogs()
  renderStats()
  renderFundsTable()
  if (activeFundId && dom.fundDetailDialog.open) renderFundDetail(activeFundId)
}

function populateFilters() {
  const responsibleIds = unique(cashFunds.map((fund) => fund.responsible_profile_id).filter(Boolean))
  dom.responsibleFilter.innerHTML = [`<option value="todos">Responsable: Todos</option>`, ...responsibleIds.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(profileName(id))}</option>`)].join("")
  const companyIds = unique(cashFunds.map((fund) => fund.company_id).filter(Boolean))
  dom.companyFilter.innerHTML = [`<option value="todos">Empresa: Todas</option>`, ...companyIds.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(companyName(id))}</option>`)].join("")
}

function populateTicketCatalogs() {
  dom.ticketProviderId.innerHTML = [`<option value="">Sin proveedor</option>`, ...proveedores.filter((p) => p.activo !== false).map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(providerLabel(p))}</option>`)].join("")
  dom.ticketBudgetCategoryId.innerHTML = [`<option value="">Sin partida</option>`, ...budgetCategories.filter((c) => c.active !== false && c.activo !== false).map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(budgetCategoryLabel(c))}</option>`)].join("")
}

function renderStats() {
  const activeCount = cashFunds.filter((fund) => ACTIVE_FUND_STATUSES.includes(fund.status)).length
  const pendingCount = cashFunds.filter((fund) => PENDING_FUND_STATUSES.includes(fund.status)).length
  const reviewIds = new Set([...cashFunds.filter((fund) => fund.status === "receipt_review").map((fund) => fund.id), ...reconciliations.filter((item) => item.status === "submitted").map((item) => item.cash_fund_id)].filter(Boolean))
  const closedCount = cashFunds.filter((fund) => fund.status === "closed").length
  const pendingAmount = cashFunds.filter((fund) => !["closed", "cancelled"].includes(fund.status)).reduce((sum, fund) => sum + numberValue(fund.pending_amount), 0)

  dom.activeFunds.textContent = activeCount
  dom.pendingFunds.textContent = pendingCount
  dom.reviewFunds.textContent = reviewIds.size
  dom.closedFunds.textContent = closedCount
  dom.pendingAmount.textContent = compactCurrency(pendingAmount)
}

function renderFundsTable() {
  const query = normalize(dom.searchInput.value)
  const status = dom.statusFilter.value
  const method = dom.methodFilter.value
  const responsibleId = dom.responsibleFilter.value
  const companyId = dom.companyFilter.value

  const rows = cashFunds.filter((fund) => {
    const request = paymentRequestById(fund.payment_request_id)
    const searchable = normalize([request?.request_number, request?.description, fund.notes, profileName(fund.responsible_profile_id), companyName(fund.company_id)].join(" "))
    return searchable.includes(query) && (status === "todos" || fund.status === status) && (method === "todos" || fund.delivery_method === method) && (responsibleId === "todos" || fund.responsible_profile_id === responsibleId) && (companyId === "todos" || fund.company_id === companyId)
  })

  if (!rows.length) {
    dom.fundsTableBody.innerHTML = `<tr><td colspan="10" class="empty-state"><strong>No hay fondos para este filtro.</strong>Ajusta la busqueda o cambia los filtros.</td></tr>`
    return
  }

  dom.fundsTableBody.innerHTML = rows.map((fund) => {
    const request = paymentRequestById(fund.payment_request_id)
    return `<tr>
      <td><span class="cell-main">${escapeHtml(request?.request_number || "Sin solicitud")}</span><span class="cell-sub">${escapeHtml(request?.description || fund.notes || "")}</span></td>
      <td>${escapeHtml(profileName(fund.responsible_profile_id))}</td>
      <td>${escapeHtml(companyName(fund.company_id))}</td>
      <td>${escapeHtml(methodLabel(fund.delivery_method))}</td>
      <td><span class="cell-main">${escapeHtml(formatCurrency(fund.assigned_amount))}</span></td>
      <td>${escapeHtml(formatCurrency(fund.verified_amount))}</td>
      <td><span class="cell-main">${escapeHtml(formatCurrency(fund.pending_amount))}</span></td>
      <td>${escapeHtml(formatDate(fund.due_date))}</td>
      <td>${fundStatusBadge(fund.status)}</td>
      <td><button class="small-btn" type="button" style="white-space:nowrap" onclick="openFundDetail('${escapeHtml(fund.id)}')">Ver detalle</button></td>
    </tr>`
  }).join("")
}

function openFundDetail(fundId) {
  activeFundId = fundId
  renderFundDetail(fundId)
  dom.fundDetailDialog.showModal()
}
window.openFundDetail = openFundDetail

function renderFundDetail(fundId) {
  const fund = fundById(fundId)
  if (!fund) return
  const request = paymentRequestById(fund.payment_request_id)
  const reconciliation = reconciliationForFund(fund.id)
  dom.detailTitle.textContent = request?.request_number || "Detalle de fondo"
  dom.detailSubtitle.textContent = `${methodLabel(fund.delivery_method)} — ${fundStatusLabel(fund.status)}`
  dom.detailContent.innerHTML = `
    <div class="ref-grid">
      ${refCell("Solicitud origen", request?.request_number || "Sin solicitud")}
      ${refCell("Responsable", profileName(fund.responsible_profile_id))}
      ${refCell("Empresa", companyName(fund.company_id))}
      ${refCell("Metodo", methodLabel(fund.delivery_method))}
      ${refCell("Monto asignado", formatCurrency(fund.assigned_amount))}
      ${refCell("Monto comprobado", formatCurrency(fund.verified_amount))}
      ${refCell("Monto pendiente", formatCurrency(fund.pending_amount))}
      ${refCell("Fecha de asignacion", formatDate(fund.assignment_date))}
      ${refCell("Fecha limite", formatDate(fund.due_date))}
      <div class="ref-cell"><span class="ref-label">Estatus</span><span class="ref-value">${fundStatusBadge(fund.status)}</span></div>
      <div class="ref-cell" style="grid-column:1/-1"><span class="ref-label">Notas</span><span class="ref-value">${escapeHtml(fund.notes || "Sin notas")}</span></div>
    </div>
    ${renderReconciliationSection(fund, reconciliation)}
    ${renderTicketsSection(reconciliation)}
  `
}

function renderReconciliationSection(fund, reconciliation) {
  const canCreate = !reconciliation && !["closed", "cancelled"].includes(fund.status)
  const canAddTicket = reconciliation && ["draft", "correction_requested"].includes(reconciliation.status)
  const canSubmit = reconciliation && ["draft", "correction_requested"].includes(reconciliation.status)
  const canReview = reconciliation && reconciliation.status === "submitted" && canReviewCurrentUser()

  const reconciliationDetails = reconciliation ? `
    <div class="ref-grid">
      <div class="ref-cell"><span class="ref-label">Estatus</span><span class="ref-value">${reconciliationStatusBadge(reconciliation.status)}</span></div>
      ${refCell("Total tickets", formatCurrency(reconciliation.total_tickets))}
      ${refCell("Monto devuelto", formatCurrency(reconciliation.returned_amount))}
      ${refCell("Diferencia", formatCurrency(reconciliation.difference_amount))}
      ${refCell("Fecha de revision", formatDateTime(reconciliation.reviewed_at))}
      <div class="ref-cell" style="grid-column:1/-1"><span class="ref-label">Comentario del revisor</span><span class="ref-value">${escapeHtml(reconciliation.reviewer_comment || "Sin comentario")}</span></div>
    </div>` : `
    <div class="notice-v2 warning" style="margin-bottom:10px">
      <span class="notice-icon">·</span>
      <span class="notice-text">
        <span class="notice-title">Sin comprobacion</span>
        <span class="notice-sep">—</span>
        <span class="notice-desc">Crea una comprobacion para empezar a registrar tickets.</span>
      </span>
    </div>`

  const submittedNotice = reconciliation?.status === "submitted" && !canReview ? `
    <div class="notice-v2 warning">
      <span class="notice-icon">·</span>
      <span class="notice-text">
        <span class="notice-title">En revision</span>
        <span class="notice-sep">—</span>
        <span class="notice-desc">Las decisiones las registra un perfil autorizado.</span>
      </span>
    </div>` : ""

  return `
    <div class="section-heading">Comprobacion</div>
    ${reconciliationDetails}
    <div id="blockCheckResult"></div>
    <div class="actions">
      ${canCreate ? `<button type="button" class="small-btn success" data-action="create-reconciliation" data-fund-id="${escapeHtml(fund.id)}">Crear comprobacion</button>` : ""}
      ${canAddTicket ? `<button type="button" class="small-btn" data-action="add-ticket" data-reconciliation-id="${escapeHtml(reconciliation.id)}">Agregar ticket</button>` : ""}
      ${canSubmit ? `<button type="button" class="small-btn info" data-action="submit-reconciliation" data-reconciliation-id="${escapeHtml(reconciliation.id)}">Enviar comprobacion</button>` : ""}
      ${canReview ? `
        <button type="button" class="small-btn success" data-action="review" data-review-action="approved" data-reconciliation-id="${escapeHtml(reconciliation.id)}">Aprobar</button>
        <button type="button" class="small-btn danger" data-action="review" data-review-action="rejected" data-reconciliation-id="${escapeHtml(reconciliation.id)}">Rechazar</button>
        <button type="button" class="small-btn warning" data-action="review" data-review-action="correction_requested" data-reconciliation-id="${escapeHtml(reconciliation.id)}">Solicitar correccion</button>
      ` : ""}
      <button type="button" class="small-btn" data-action="verify-block" data-profile-id="${escapeHtml(fund.responsible_profile_id || "")}">Verificar bloqueo</button>
    </div>
    ${submittedNotice}`
}

function renderTicketsSection(reconciliation) {
  if (!reconciliation) return `
    <div class="section-heading">Tickets / comprobantes</div>
    <div style="border:1px dashed var(--border-strong);border-radius:10px;padding:18px;text-align:center;color:var(--text-3);font-size:12px">Primero crea una comprobacion para agregar tickets.</div>`

  const rows = itemsForReconciliation(reconciliation.id)
  const tableRows = rows.length
    ? rows.map((item) => `<tr>
        <td><span class="cell-main">${escapeHtml(item.concept || "Sin concepto")}</span><span class="cell-sub">${item.storage_path ? escapeHtml(item.storage_path) : "Archivo pendiente"}</span></td>
        <td>${escapeHtml(providerName(item.proveedor_id))}</td>
        <td>${escapeHtml(budgetCategoryName(item.budget_category_id))}</td>
        <td><span class="cell-main">${escapeHtml(formatCurrency(item.amount))}</span></td>
        <td>${escapeHtml(formatDate(item.ticket_date))}</td>
        <td>${itemStatusBadge(item.status)}</td>
      </tr>`).join("")
    : `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--text-3)">No hay tickets registrados.</td></tr>`

  return `
    <div class="section-heading">Tickets / comprobantes</div>
    <div class="table-wrapper" style="max-height:260px;min-height:auto;border:1px solid var(--border);border-radius:10px;overflow:hidden">
      <table style="min-width:600px">
        <thead><tr><th>Concepto</th><th>Proveedor</th><th>Partida</th><th>Monto</th><th>Fecha ticket</th><th>Estatus</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`
}

async function handleDetailAction(event) {
  const button = event.target.closest("[data-action]")
  if (!button) return
  if (button.dataset.action === "create-reconciliation") await createReconciliation(button.dataset.fundId)
  if (button.dataset.action === "add-ticket") openTicketModal(button.dataset.reconciliationId)
  if (button.dataset.action === "submit-reconciliation") openSubmitModal(button.dataset.reconciliationId)
  if (button.dataset.action === "review") openReviewModal(button.dataset.reconciliationId, button.dataset.reviewAction)
  if (button.dataset.action === "verify-block") await verifyCashBlock(button.dataset.profileId)
}

async function createReconciliation(fundId) {
  if (!ensureCurrentProfile()) return
  try {
    const { error } = await supabaseClient.rpc("create_cash_reconciliation", { p_cash_fund_id: fundId, p_submitted_by: currentProfile.id })
    if (error) throw error
    showToast("Comprobacion creada", "Comprobacion creada en borrador.", "success")
    await loadCashData()
    renderFundDetail(fundId)
  } catch (error) { showToast("No se pudo crear comprobacion", friendlyRpcError(error), "danger") }
}

function openTicketModal(reconciliationId) { activeReconciliationId = reconciliationId; dom.ticketForm.reset(); dom.ticketDate.value = todayValue(); dom.ticketDialog.showModal() }
function closeTicketModal() { activeReconciliationId = null; dom.ticketForm.reset(); if (dom.ticketDialog.open) dom.ticketDialog.close() }

async function saveTicket(event) {
  event.preventDefault()
  if (!activeReconciliationId) return
  const payload = { reconciliation_id: activeReconciliationId, concept: cleanText(dom.ticketConcept.value), amount: numberValue(dom.ticketAmount.value), ticket_date: dom.ticketDate.value || null, proveedor_id: dom.ticketProviderId.value || null, budget_category_id: dom.ticketBudgetCategoryId.value || null, status: "valid" }
  if (!payload.concept) return showToast("Concepto requerido", "Captura el concepto del ticket.", "danger")
  if (payload.amount <= 0) return showToast("Monto requerido", "Captura un monto mayor a cero.", "danger")
  if (!payload.ticket_date) return showToast("Fecha requerida", "Captura la fecha del ticket.", "danger")
  setButtonLoading(dom.submitTicketBtn, true, "Guardando...")
  const { error } = await supabaseClient.from("cash_reconciliation_items").insert(payload)
  setButtonLoading(dom.submitTicketBtn, false, "Guardar ticket")
  if (error) return showToast("No se pudo guardar ticket", rlsHint("cash_reconciliation_items", "insert", error), "danger")
  const fundId = activeFundId
  closeTicketModal()
  showToast("Ticket agregado", "Ticket agregado correctamente.", "success")
  await loadCashData()
  if (fundId) renderFundDetail(fundId)
}

function openSubmitModal(reconciliationId) { activeReconciliationId = reconciliationId; dom.returnedAmount.value = "0"; updateSubmitTotals(); dom.submitDialog.showModal() }
function closeSubmitModal() { activeReconciliationId = null; dom.submitReconciliationForm.reset(); if (dom.submitDialog.open) dom.submitDialog.close() }
function updateSubmitTotals() {
  const reconciliation = reconciliationById(activeReconciliationId)
  const fund = reconciliation ? fundById(reconciliation.cash_fund_id) : null
  const tickets = reconciliation ? totalValidTickets(reconciliation.id) : 0
  const returned = numberValue(dom.returnedAmount.value)
  const assigned = numberValue(fund?.assigned_amount)
  dom.submitTotalTickets.textContent = formatCurrency(tickets)
  dom.submitAssignedAmount.textContent = formatCurrency(assigned)
  dom.submitDifference.textContent = formatCurrency(assigned - tickets - returned)
}

async function submitReconciliation(event) {
  event.preventDefault()
  if (!activeReconciliationId) return
  setButtonLoading(dom.submitReconciliationBtn, true, "Enviando...")
  try {
    const { error } = await supabaseClient.rpc("submit_cash_reconciliation", { p_reconciliation_id: activeReconciliationId, p_returned_amount: numberValue(dom.returnedAmount.value) })
    if (error) throw error
    const fundId = activeFundId
    closeSubmitModal()
    showToast("Comprobacion enviada", "Comprobacion enviada para revision.", "success")
    await loadCashData()
    if (fundId) renderFundDetail(fundId)
  } catch (error) { showToast("No se pudo enviar", friendlyRpcError(error), "danger") }
  finally { setButtonLoading(dom.submitReconciliationBtn, false, "Enviar comprobacion") }
}

function openReviewModal(reconciliationId, action) {
  activeReconciliationId = reconciliationId
  activeReviewAction = action
  dom.reviewForm.reset()
  dom.reviewTitle.textContent = reviewActionTitle(action)
  dom.reviewSubtitle.textContent = action === "approved" ? "El comentario es opcional para aprobar." : "Captura un comentario para informar al responsable."
  dom.submitReviewBtn.textContent = reviewActionButton(action)
  dom.reviewDialog.showModal()
}
function closeReviewModal() { activeReconciliationId = null; activeReviewAction = null; dom.reviewForm.reset(); if (dom.reviewDialog.open) dom.reviewDialog.close() }

async function reviewReconciliation(event) {
  event.preventDefault()
  if (!activeReconciliationId || !activeReviewAction || !ensureCurrentProfile()) return
  const comment = cleanText(dom.reviewComment.value)
  if (["rejected", "correction_requested"].includes(activeReviewAction) && !comment) return showToast("Comentario requerido", "Captura un comentario para rechazar o solicitar correccion.", "danger")
  setButtonLoading(dom.submitReviewBtn, true, "Registrando...")
  try {
    const { error } = await supabaseClient.rpc("review_cash_reconciliation", { p_reconciliation_id: activeReconciliationId, p_reviewer_profile_id: currentProfile.id, p_action: activeReviewAction, p_comment: comment || null })
    if (error) throw error
    const fundId = activeFundId
    closeReviewModal()
    const desc = activeReviewAction === "approved" ? "Comprobacion aprobada." : activeReviewAction === "rejected" ? "Comprobacion rechazada." : "Correccion solicitada."
    showToast("Decision registrada", desc, "success")
    await loadCashData()
    if (fundId) renderFundDetail(fundId)
  } catch (error) { showToast("No se pudo registrar decision", friendlyRpcError(error), "danger") }
  finally { setButtonLoading(dom.submitReviewBtn, false, reviewActionButton(activeReviewAction)) }
}

async function verifyCashBlock(profileId) {
  if (!profileId) return showToast("Sin responsable", "Este fondo no tiene responsable asignado.", "warning")
  const target = document.getElementById("blockCheckResult")
  if (target) target.innerHTML = `<div class="notice-v2 warning"><span class="notice-icon">·</span><span class="notice-text"><span class="notice-title">Verificando</span><span class="notice-sep">—</span><span class="notice-desc">Consultando fondos pendientes...</span></span></div>`
  try {
    const { data, error } = await supabaseClient.rpc("verify_cash_block", { p_profile_id: profileId })
    if (error) throw error
    renderCashBlockResult(data)
  } catch (error) {
    if (target) target.innerHTML = `<div class="notice-v2 danger"><span class="notice-icon">✕</span><span class="notice-text">${escapeHtml(friendlyRpcError(error))}</span></div>`
  }
}

function renderCashBlockResult(result) {
  const target = document.getElementById("blockCheckResult")
  if (!target) return
  if (!result?.blocked) {
    target.innerHTML = `<div class="notice-v2 neutral"><span class="notice-icon">·</span><span class="notice-text"><span class="notice-title">Sin bloqueo</span><span class="notice-sep">—</span><span class="notice-desc">El responsable no tiene fondos vencidos pendientes.</span></span></div>`
    return
  }
  const funds = Array.isArray(result?.funds) ? result.funds : []
  target.innerHTML = `<div class="notice-v2 danger"><span class="notice-icon">✕</span><span class="notice-text"><span class="notice-title">Fondos vencidos</span><span class="notice-sep">—</span><span class="notice-desc">Pendiente total: ${escapeHtml(formatCurrency(result?.total_pending || 0))}. Fondos vencidos: ${escapeHtml(String(result?.overdue_count || funds.length || 0))}.</span></span></div>`
}

function canReviewCurrentUser() { if (!currentProfile) return false; return currentRoles.some((role) => REVIEW_ROLES.includes(normalizeRole(role))) }
function ensureCurrentProfile() { if (currentProfile?.id) return true; showToast("Perfil no identificado", "No se pudo identificar tu perfil de usuario.", "danger"); return false }
async function logout() { await supabaseClient.auth.signOut(); window.location.href = "./index.html" }
function closeFundDetail() { activeFundId = null; if (dom.fundDetailDialog.open) dom.fundDetailDialog.close() }

// Badge helpers using Components.badge()
function fundStatusBadge(status) {
  const labels = { active: "Activo", pending_receipt: "Por comprobar", blocked: "Bloqueado", receipt_review: "En revision", verified: "Verificado", closed: "Cerrado", cancelled: "Cancelado" }
  const variants = { active: "accent", pending_receipt: "warning", blocked: "danger", receipt_review: "info", verified: "success", closed: "neutral", cancelled: "neutral" }
  const s = status || "neutral"
  return Components.badge(labels[s] || s, variants[s] || "neutral")
}
function reconciliationStatusBadge(status) {
  const labels = { draft: "Borrador", submitted: "En revision", approved: "Aprobada", rejected: "Rechazada", correction_requested: "Correccion" }
  const variants = { draft: "neutral", submitted: "info", approved: "success", rejected: "danger", correction_requested: "warning" }
  const s = status || "neutral"
  return Components.badge(labels[s] || s, variants[s] || "neutral")
}
function itemStatusBadge(status) {
  return Components.badge(status === "rejected" ? "Rechazado" : "Valido", status === "rejected" ? "danger" : "success")
}

// Lookup helpers
function fundById(id) { return cashFunds.find((item) => item.id === id) || null }
function reconciliationById(id) { return reconciliations.find((item) => item.id === id) || null }
function reconciliationForFund(fundId) { return reconciliations.filter((item) => item.cash_fund_id === fundId).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null }
function itemsForReconciliation(id) { return reconciliationItems.filter((item) => item.reconciliation_id === id).sort((a, b) => new Date(a.ticket_date || a.created_at || 0) - new Date(b.ticket_date || b.created_at || 0)) }
function totalValidTickets(id) { return itemsForReconciliation(id).filter((item) => item.status !== "rejected").reduce((sum, item) => sum + numberValue(item.amount), 0) }
function paymentRequestById(id) { return paymentRequests.find((item) => item.id === id) || null }
function profileById(id) { return profiles.find((item) => item.id === id) || (currentProfile?.id === id ? currentProfile : null) }
function companyById(id) { return companies.find((item) => item.id === id) || null }
function providerById(id) { return proveedores.find((item) => item.id === id) || null }
function budgetCategoryById(id) { return budgetCategories.find((item) => item.id === id) || null }
function profileName(id) { const p = profileById(id); return p ? (p.full_name || p.email || "Responsable") : "Sin responsable" }
function companyName(id) { const c = companyById(id); return c ? (c.legal_name || c.name || "Empresa") : "Sin empresa" }
function providerName(id) { return id ? providerLabel(providerById(id)) : "Sin proveedor" }
function providerLabel(p) { return p ? (p.alias || p.nombre_completo || p.rfc || "Proveedor") : "Sin proveedor" }
function budgetCategoryName(id) { return id ? budgetCategoryLabel(budgetCategoryById(id)) : "Sin partida" }
function budgetCategoryLabel(c) { return c ? `${c.code ? `${c.code} - ` : ""}${c.name || c.nombre || "Sin nombre"}` : "Sin partida" }
function methodLabel(method) { return ({ cash: "Efectivo", check: "Cheque" })[method] || "Sin metodo" }
function fundStatusLabel(status) { return ({ active: "Activo", pending_receipt: "Pendiente de comprobar", blocked: "Bloqueado", receipt_review: "En revision", verified: "Verificado", closed: "Cerrado", cancelled: "Cancelado" })[status] || status || "Sin estatus" }
function reviewActionTitle(action) { return ({ approved: "Aprobar comprobacion", rejected: "Rechazar comprobacion", correction_requested: "Solicitar correccion" })[action] || "Revisar comprobacion" }
function reviewActionButton(action) { return ({ approved: "Aprobar", rejected: "Rechazar", correction_requested: "Solicitar correccion" })[action] || "Registrar decision" }

// ref-grid helper
function refCell(label, value) { return `<div class="ref-cell"><span class="ref-label">${escapeHtml(label)}</span><span class="ref-value">${escapeHtml(value)}</span></div>` }

// Error helpers
function friendlyRpcError(error) {
  const message = error?.message || String(error || "Error desconocido")
  const known = { cash_fund_not_found: "No se encontro el fondo.", cash_fund_not_open_for_reconciliation: "Este fondo ya no permite comprobacion.", open_reconciliation_already_exists: "Ya existe una comprobacion abierta para este fondo.", not_allowed_to_create_reconciliation: "No tienes permiso para crear esta comprobacion.", reconciliation_has_no_amounts: "Agrega al menos un ticket o registra monto devuelto.", reconciliation_exceeds_assigned_amount: "La suma de tickets y devuelto excede el fondo asignado.", only_draft_or_correction_can_be_submitted: "Solo se pueden enviar comprobaciones en borrador o correccion.", not_allowed_to_review_reconciliation: "No tienes permiso para revisar esta comprobacion.", only_submitted_reconciliations_can_be_reviewed: "Solo se pueden revisar comprobaciones enviadas.", review_comment_required: "Captura un comentario para rechazar o solicitar correccion.", profile_not_found: "No se pudo identificar el perfil del usuario." }
  const key = Object.keys(known).find((item) => message.includes(item))
  return key ? known[key] : friendlyError(error)
}
function friendlyError(error) { const message = error?.message || String(error || "Error desconocido"); if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "La operacion fue bloqueada por RLS. Revisa policies para usuarios autenticados."; if (message.toLowerCase().includes("permission denied")) return "Faltan permisos para ejecutar la operacion."; return message }
function rlsHint(table, operation, error) { const message = error?.message || ""; if (message.toLowerCase().includes("row-level security") || error?.code === "42501" || message.toLowerCase().includes("permission denied")) return `Operacion ${operation} bloqueada por RLS en ${table}.`; return message || `No se pudo ejecutar ${operation} en ${table}.` }

// Toast via components
function showToast(title, desc, variant = "success") { Components.showToast({ title, desc, variant, duration: 6 }) }

// Utils
function setButtonLoading(button, loading, text) { if (!button) return; button.disabled = loading; button.textContent = text }
function formatCurrency(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(numberValue(value)) }
function compactCurrency(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", notation: "compact", maximumFractionDigits: 1 }).format(numberValue(value)) }
function formatDate(value) { if (!value) return "Sin fecha"; const date = new Date(`${String(value).slice(0, 10)}T00:00:00`); return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date) }
function formatDateTime(value) { if (!value) return "Sin fecha"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) }
function numberValue(value) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function cleanText(value) { return String(value || "").trim() }
function normalize(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") }
function normalizeRole(value) { return normalize(value).replace(/\s+/g, "_") }
function todayValue() { return new Date().toISOString().slice(0, 10) }
function unique(values) { return Array.from(new Set(values)) }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }
