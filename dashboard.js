const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  periodKey: "",
  payload: {},
  kpis: {},
  budgetComparison: [],
  ytd: [],
  incomeMembers: [],
  closureChecklist: {},
  closureComments: [],
  activeTab: "summary",
  activeFilter: null,
}

const els = {}
const moneyFormatter = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })
const numberFormatter = new Intl.NumberFormat("es-MX")
const percentFormatter = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const statusLabels = {
  open: "Abierto",
  review: "En revision",
  closed: "Cerrado",
  cancelled: "Cancelado",
  not_created: "Sin cierre",
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagado",
  overdue: "Vencido",
  issued: "Emitida",
}

const checkLabels = {
  pending_payment_requests: "Solicitudes pendientes de atencion",
  approved_without_operation: "Solicitudes aprobadas sin operacion",
  unconfirmed_layouts: "Layouts no confirmados",
  unpaid_approved_requests: "Solicitudes aprobadas sin pago",
  overdue_cash_funds: "Fondos vencidos",
  cash_reconciliations_in_review: "Comprobaciones en revision",
  open_incidents: "Incidencias abiertas",
  issued_unpaid_invoices: "Facturas emitidas pendientes de pago",
  overdue_maintenance_fees: "Cuotas vencidas",
  missing_budget_comments: "Comentarios de presupuesto pendientes",
}

const warningLabels = {
  budget_variance_comment_check_pending_model_confirmation: "La revision de comentarios por variacion presupuestal esta pendiente de conectar al modelo presupuestal final.",
}

const cardRoutes = {
  requested: { tab: "expenses", label: "Gastos mes" },
  paid: { tab: "expenses", label: "Pagado" },
  "pending-payment": { tab: "expenses", label: "Pendiente de pago" },
  "income-collected": { tab: "income", label: "Ingresos cobrados", incomeStatus: "paid" },
  "income-pending": { tab: "income", label: "Ingresos pendientes", pendingOnly: true },
  "net-balance": { tab: "summary", label: "Balance neto" },
  "overdue-cash": { tab: "cash", label: "Fondos vencidos" },
  critical: { tab: "closure", label: "Pendientes criticos" },
}

document.addEventListener("DOMContentLoaded", init)

function init() {
  bindElements()
  bindEvents()
  initTheme()
  setDefaultPeriod()
  resolveSession().finally(loadDashboard)
}

function bindElements() {
  const ids = [
    "periodInput", "refreshBtn", "exportBtn", "historyBtn", "lastUpdated", "messageBox", "filterStrip", "filterLabel", "clearFilterBtn",
    "totalRequested", "totalPaid", "totalPendingPayment", "incomeCollected", "incomePending", "netBalance", "overdueCashFunds", "criticalPending",
    "expensesSummary", "cashSummary", "incomeSummary", "closureSummary", "expensesTableBody", "ytdTableBody", "incomeTableBody",
    "ytdSummary", "incomeTotals", "cashCards", "cashChecklist", "incidentCards", "closureResult", "closureChecksBody", "closureComments",
    "expenseSearch", "expenseCompanyFilter", "expenseCostCenterFilter", "expenseCategoryFilter", "expenseVarianceOnly", "budgetNote",
    "incomeSearch", "incomeStatusFilter", "incomeLineageFilter", "incomePendingOnly", "closePeriodBtn", "historyDialog", "historyTableBody",
    "exportDialog", "exportLinks", "toastStack", "themeToggle", "logoutBtn", "userName", "userEmail",
  ]
  ids.forEach((id) => { els[id] = document.getElementById(id) })
}

function bindEvents() {
  els.refreshBtn?.addEventListener("click", loadDashboard)
  els.periodInput?.addEventListener("change", loadDashboard)
  els.clearFilterBtn?.addEventListener("click", clearQuickFilter)
  els.historyBtn?.addEventListener("click", openHistory)
  els.exportBtn?.addEventListener("click", openExport)
  els.closePeriodBtn?.addEventListener("click", () => {
    if (state.closureChecklist?.can_close) {
      showToast("Cierre pendiente", "El cierre formal se conectara en la siguiente tanda.", "success")
    } else {
      showToast("No se puede cerrar", "Resuelve primero los bloqueos del checklist.", "error")
    }
  })
  els.logoutBtn?.addEventListener("click", async () => {
    await db.auth.signOut()
    window.location.href = "index.html"
  })
  document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)))
  document.querySelectorAll(".stat").forEach((button) => button.addEventListener("click", () => applyCardFilter(button.dataset.card)))
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => button.closest("dialog")?.close()))
  document.querySelectorAll("[data-export-option]").forEach((button) => button.addEventListener("click", () => {
    showToast("Exportacion pendiente", "La exportacion a Google Drive se conectara en la siguiente tanda mediante n8n.", "success")
  }))
  ;["expenseSearch", "expenseCompanyFilter", "expenseCostCenterFilter", "expenseCategoryFilter", "expenseVarianceOnly"].forEach((id) => {
    els[id]?.addEventListener("input", renderExpenses)
    els[id]?.addEventListener("change", renderExpenses)
  })
  ;["incomeSearch", "incomeStatusFilter", "incomeLineageFilter", "incomePendingOnly"].forEach((id) => {
    els[id]?.addEventListener("input", renderIncome)
    els[id]?.addEventListener("change", renderIncome)
  })
}

function initTheme() {
  const stored = localStorage.getItem("flux-theme")
  if (stored) document.documentElement.dataset.theme = stored
  els.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"
    document.documentElement.dataset.theme = next
    localStorage.setItem("flux-theme", next)
  })
}

function setDefaultPeriod() {
  const now = new Date()
  const value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
  els.periodInput.value = value
  state.periodKey = value
}

async function resolveSession() {
  const { data } = await db.auth.getSession()
  const user = data?.session?.user
  if (!user) return
  if (els.userEmail) els.userEmail.textContent = user.email || "Sesion activa"
  const profile = await findProfile(user)
  state.profile = profile
  if (els.userName) els.userName.textContent = profile?.full_name || user.user_metadata?.full_name || user.email || "Usuario"
}

async function findProfile(user) {
  let result = await db.from("profiles").select("id,full_name,email,auth_user_id").eq("auth_user_id", user.id).maybeSingle()
  if (result.error || !result.data) {
    result = await db.from("profiles").select("id,full_name,email,auth_user_id").eq("email", user.email).maybeSingle()
  }
  return result.data || null
}

async function loadDashboard() {
  state.periodKey = els.periodInput.value || currentPeriodKey()
  showLoading(true)
  hideMessage()
  try {
    const { data, error } = await db.rpc("dashboard_export_payload", { p_period_key: state.periodKey })
    if (error) throw error
    const payload = normalizePayload(data)
    state.payload = payload
    state.kpis = payload.kpis || {}
    state.budgetComparison = ensureArray(payload.budget_comparison)
    state.ytd = ensureArray(payload.ytd)
    state.incomeMembers = ensureArray(payload.income_members)
    state.closureChecklist = payload.closure_checklist || {}
    state.closureComments = ensureArray(payload.closure_comments)
    renderAll()
    if (els.lastUpdated) els.lastUpdated.textContent = `Ultima actualizacion: ${formatDateTime(new Date())}`
  } catch (error) {
    handleLoadError(error)
  } finally {
    showLoading(false)
  }
}

function normalizePayload(data) {
  if (!data) return {}
  if (typeof data === "string") {
    try { return JSON.parse(data) } catch (_) { return {} }
  }
  return data
}

function renderAll() {
  renderCards()
  renderSummary()
  renderExpenses()
  renderYtd()
  renderIncome()
  renderCash()
  renderIncidents()
  renderClosure()
}

function renderCards() {
  const egresos = state.kpis.egresos || {}
  const ingresos = state.kpis.ingresos || {}
  const balance = state.kpis.balance || {}
  const efectivo = state.kpis.efectivo || {}
  setText("totalRequested", money(egresos.total_requested))
  setText("totalPaid", money(egresos.total_paid))
  setText("totalPendingPayment", money(egresos.total_pending_payment))
  setText("incomeCollected", money(ingresos.maintenance_collected))
  setText("incomePending", money(ingresos.maintenance_pending))
  setText("netBalance", money(balance.net_balance))
  setText("overdueCashFunds", whole(efectivo.overdue_cash_funds))
  setText("criticalPending", whole(countCritical()))
}

function renderSummary() {
  const eg = state.kpis.egresos || {}
  const cash = state.kpis.efectivo || {}
  const income = state.kpis.ingresos || {}
  const close = state.kpis.cierre || {}
  renderSummaryList(els.expensesSummary, [
    ["Total solicitado", money(eg.total_requested)], ["Total aprobado", money(eg.total_approved)], ["Total pagado", money(eg.total_paid)], ["Pendiente de pago", money(eg.total_pending_payment)],
    ["Solicitudes pendientes", whole(eg.pending_payment_requests)], ["Aprobadas listas para operar", whole(eg.approved_ready_to_operate)], ["Layouts activos", whole(eg.active_layouts)], ["Layouts confirmados", whole(eg.confirmed_layouts)],
  ])
  renderSummaryList(els.cashSummary, [
    ["Fondos activos", whole(cash.active_cash_funds)], ["Pendientes de comprobar", whole(cash.pending_cash_reconciliation)], ["En revision", whole(cash.cash_in_review)], ["Vencidos", whole(cash.overdue_cash_funds)],
    ["Monto entregado", money(cash.cash_assigned_amount)], ["Monto comprobado", money(cash.cash_verified_amount)], ["Monto pendiente", money(cash.cash_pending_amount)],
  ])
  renderSummaryList(els.incomeSummary, [
    ["Socios activos", whole(income.active_members)], ["Cuotas esperadas", money(income.maintenance_expected)], ["Cuotas cobradas", money(income.maintenance_collected)], ["Cuotas pendientes", money(income.maintenance_pending)],
    ["Incidencias abiertas", whole(income.open_incidents)], ["Facturas pendientes", whole(income.pending_invoices)],
  ])
  renderSummaryList(els.closureSummary, [
    ["Estatus del cierre", badge(close.closure_status || "not_created")], ["Fecha cierre", close.closure_closed_at ? formatDate(close.closure_closed_at) : "Sin cierre"], ["Ultima exportacion", close.last_export_at ? formatDateTime(close.last_export_at) : "Sin exportacion"], ["Puede cerrar", state.closureChecklist?.can_close ? badge("ok", "Si") : badge("danger", "No")],
  ])
}

function renderSummaryList(container, rows) {
  if (!container) return
  container.innerHTML = rows.map(([label, value]) => `<div class="summary-row"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join("")
}

function renderExpenses() {
  const rows = [...state.budgetComparison]
  populateSelect(els.expenseCompanyFilter, "Empresa", unique(rows.map((row) => row.company)))
  populateSelect(els.expenseCostCenterFilter, "Centro", unique(rows.map((row) => row.cost_center)))
  populateSelect(els.expenseCategoryFilter, "Partida", unique(rows.map((row) => row.budget_category)))
  const search = textValue(els.expenseSearch).toLowerCase()
  const company = selectValue(els.expenseCompanyFilter)
  const costCenter = selectValue(els.expenseCostCenterFilter)
  const category = selectValue(els.expenseCategoryFilter)
  const varianceOnly = Boolean(els.expenseVarianceOnly?.checked)
  const filtered = rows.filter((row) => {
    const haystack = [row.company, row.cost_center, row.budget_category, row.category_code].join(" ").toLowerCase()
    if (search && !haystack.includes(search)) return false
    if (company !== "todos" && normalize(row.company) !== company) return false
    if (costCenter !== "todos" && normalize(row.cost_center) !== costCenter) return false
    if (category !== "todos" && normalize(row.budget_category) !== category) return false
    if (varianceOnly && !num(row.variance_amount)) return false
    return true
  })
  const hasBudget = rows.some((row) => num(row.budget_amount) > 0)
  els.budgetNote?.classList.toggle("hidden", hasBudget)
  renderRows(els.expensesTableBody, filtered, (row) => `
    <tr><td><strong>${safe(row.company, "Sin empresa")}</strong></td><td>${safe(row.cost_center, "Sin centro")}</td><td>${safe(row.budget_category, "Sin partida")}</td><td>${safe(row.category_code, "-")}</td><td>${money(row.budget_amount)}</td><td>${money(row.committed_amount)}</td><td>${money(row.executed_amount)}</td><td>${money(row.available_amount)}</td><td>${money(row.variance_amount)}</td><td>${pct(row.variance_pct)}</td></tr>
  `, "No hay datos de gastos para este periodo.")
}

function renderYtd() {
  const rows = [...state.ytd]
  const totals = rows.reduce((acc, row) => {
    acc.budget += num(row.ytd_budget)
    acc.committed += num(row.ytd_committed)
    acc.executed += num(row.ytd_executed)
    acc.available += num(row.ytd_available)
    return acc
  }, { budget: 0, committed: 0, executed: 0, available: 0 })
  renderMiniCards(els.ytdSummary, [
    ["Presupuesto YTD", money(totals.budget)], ["Comprometido YTD", money(totals.committed)], ["Ejecutado YTD", money(totals.executed)], ["Disponible YTD", money(totals.available)],
  ])
  renderRows(els.ytdTableBody, rows, (row) => `
    <tr><td>${safe(row.company, "Sin empresa")}</td><td>${safe(row.cost_center, "Sin centro")}</td><td>${safe(row.budget_category, "Sin partida")}</td><td>${money(row.ytd_budget)}</td><td>${money(row.ytd_committed)}</td><td>${money(row.ytd_executed)}</td><td>${money(row.ytd_available)}</td><td>${money(row.ytd_variance_amount)}</td><td>${pct(row.ytd_variance_pct)}</td></tr>
  `, "No hay datos acumulados para este periodo.")
}

function renderIncome() {
  const rows = [...state.incomeMembers]
  populateSelect(els.incomeLineageFilter, "Estirpe", unique(rows.map((row) => row.lineage)))
  const search = textValue(els.incomeSearch).toLowerCase()
  const status = selectValue(els.incomeStatusFilter)
  const lineage = selectValue(els.incomeLineageFilter)
  const pendingOnly = Boolean(els.incomePendingOnly?.checked)
  const filtered = rows.filter((row) => {
    if (search && !String(row.member_name || "").toLowerCase().includes(search)) return false
    if (status !== "todos" && row.status !== status) return false
    if (lineage !== "todos" && normalize(row.lineage) !== lineage) return false
    if (pendingOnly && num(row.pending_amount) <= 0) return false
    return true
  })
  const totals = filtered.reduce((acc, row) => {
    acc.expected += num(row.expected_amount)
    acc.paid += num(row.paid_amount)
    acc.pending += num(row.pending_amount)
    if (num(row.pending_amount) > 0) acc.members += 1
    return acc
  }, { expected: 0, paid: 0, pending: 0, members: 0 })
  renderMiniCards(els.incomeTotals, [
    ["Total esperado", money(totals.expected)], ["Total cobrado", money(totals.paid)], ["Total pendiente", money(totals.pending)], ["Socios con saldo", whole(totals.members)],
  ])
  renderRows(els.incomeTableBody, filtered, (row) => `
    <tr><td><strong>${safe(row.member_name, "Sin socio")}</strong></td><td>${safe(row.lineage, "-")}</td><td>${safe(row.billing_period, "-")}</td><td>${formatDate(row.cutoff_date)}</td><td>${money(row.expected_amount)}</td><td>${money(row.paid_amount)}</td><td>${money(row.pending_amount)}</td><td>${badge(row.status)}</td><td>${whole(row.open_incidents)}</td><td>${whole(row.paid_incidents)}</td><td>${whole(row.issued_invoices)}</td><td>${whole(row.paid_invoices)}</td></tr>
  `, "No hay ingresos para este filtro.")
}

function renderCash() {
  const cash = state.kpis.efectivo || {}
  const checks = state.closureChecklist?.checks || {}
  renderMiniCards(els.cashCards, [
    ["Fondos activos", whole(cash.active_cash_funds)], ["Pendientes", whole(cash.pending_cash_reconciliation)], ["En revision", whole(cash.cash_in_review)], ["Vencidos", whole(cash.overdue_cash_funds)],
    ["Monto entregado", money(cash.cash_assigned_amount)], ["Monto comprobado", money(cash.cash_verified_amount)], ["Monto pendiente", money(cash.cash_pending_amount)],
  ])
  renderSummaryList(els.cashChecklist, [
    ["Fondos vencidos", badgeFromCount(checks.overdue_cash_funds)], ["Comprobaciones en revision", badgeFromCount(checks.cash_reconciliations_in_review)],
  ])
}

function renderIncidents() {
  const income = state.kpis.ingresos || {}
  renderMiniCards(els.incidentCards, [
    ["Incidencias abiertas", whole(income.open_incidents)], ["Incidencias cobradas", whole(income.paid_incidents)], ["Facturas emitidas", whole(income.issued_invoices)], ["Facturas pendientes", whole(income.pending_invoices)],
  ])
}

function renderClosure() {
  const checklist = state.closureChecklist || {}
  const checks = checklist.checks || {}
  const status = state.kpis.cierre?.closure_status || "not_created"
  const canClose = Boolean(checklist.can_close)
  if (els.closePeriodBtn) {
    els.closePeriodBtn.disabled = !canClose
    els.closePeriodBtn.title = canClose ? "Cierre formal pendiente de conectar" : "No se puede cerrar el periodo hasta resolver los bloqueos."
  }
  const reasons = ensureArray(checklist.blocking_reasons)
  const warnings = ensureArray(checklist.warnings)
  const resultRows = [
    ["Estatus del cierre", badge(status)],
    ["Puede cerrar", canClose ? badge("ok", "Si") : badge("danger", "No")],
    ["Bloqueos", reasons.length ? reasons.map(translateCheck).join("<br>") : "Sin bloqueos criticos"],
  ]
  if (!canClose) resultRows.push(["Siguiente paso", "No se puede cerrar el periodo hasta resolver los bloqueos."])
  if (warnings.length) resultRows.push(["Advertencias", warnings.map(translateWarning).join("<br>")])
  renderSummaryList(els.closureResult, resultRows)
  const checkEntries = Object.entries(checks)
  renderRows(els.closureChecksBody, checkEntries, ([key, value]) => {
    const count = num(value)
    return `<tr><td>${translateCheck(key)}</td><td>${whole(count)}</td><td>${count > 0 ? badge("danger", "Bloquea") : badge("ok", "OK")}</td></tr>`
  }, "No hay revisiones para este periodo.")
  renderClosureComments()
}

function renderClosureComments() {
  const rows = state.closureComments
  if (!els.closureComments) return
  if (!rows.length) {
    els.closureComments.innerHTML = `<div class="empty"><strong>Sin comentarios ejecutivos</strong><span>Los comentarios se capturaran en una tanda posterior.</span></div>`
    return
  }
  els.closureComments.innerHTML = rows.map((row) => `<div class="summary-row"><span>${safe(row.section, "Comentario")}</span><strong>${safe(row.comment, "")}</strong></div>`).join("")
}

function renderMiniCards(container, rows) {
  if (!container) return
  container.innerHTML = rows.map(([label, value]) => `<div class="mini-card"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`).join("")
}

function renderRows(tbody, rows, mapper, emptyText) {
  if (!tbody) return
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="12"><div class="empty"><strong>${escapeHtml(emptyText)}</strong></div></td></tr>`
    return
  }
  tbody.innerHTML = rows.map(mapper).join("")
}

function showTab(tabName) {
  state.activeTab = tabName
  document.querySelectorAll(".tab").forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName))
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"))
  const panel = document.getElementById(`${tabName}Tab`)
  panel?.classList.remove("hidden")
}

function applyCardFilter(cardKey) {
  const route = cardRoutes[cardKey]
  if (!route) return
  state.activeFilter = route.label
  document.querySelectorAll(".stat").forEach((button) => button.classList.toggle("active", button.dataset.card === cardKey))
  setText("filterLabel", `Vista filtrada: ${route.label}`)
  els.filterStrip?.classList.remove("hidden")
  showTab(route.tab)
  if (route.incomeStatus && els.incomeStatusFilter) els.incomeStatusFilter.value = route.incomeStatus
  if (route.pendingOnly && els.incomePendingOnly) els.incomePendingOnly.checked = true
  renderIncome()
}

function clearQuickFilter() {
  state.activeFilter = null
  document.querySelectorAll(".stat").forEach((button) => button.classList.remove("active"))
  els.filterStrip?.classList.add("hidden")
  if (els.incomeStatusFilter) els.incomeStatusFilter.value = "todos"
  if (els.incomePendingOnly) els.incomePendingOnly.checked = false
  renderIncome()
}

async function openHistory() {
  try {
    const { data: closures, error } = await db.from("monthly_closures").select("id,period_key,status,closed_at,sheet_url,slides_url,pdf_url").order("period_key", { ascending: false }).limit(24)
    if (error) throw error
    const ids = (closures || []).map((row) => row.id)
    const [exportsResult, commentsResult] = await Promise.all([
      ids.length ? db.from("monthly_closure_exports").select("id,monthly_closure_id").in("monthly_closure_id", ids) : Promise.resolve({ data: [] }),
      ids.length ? db.from("monthly_closure_comments").select("id,monthly_closure_id").in("monthly_closure_id", ids) : Promise.resolve({ data: [] }),
    ])
    const exportCounts = countBy(exportsResult.data || [], "monthly_closure_id")
    const commentCounts = countBy(commentsResult.data || [], "monthly_closure_id")
    renderRows(els.historyTableBody, closures || [], (row) => `
      <tr><td><strong>${safe(row.period_key, "-")}</strong></td><td>${badge(row.status)}</td><td>${row.closed_at ? formatDateTime(row.closed_at) : "Sin cierre"}</td><td>${linkOrDash(row.sheet_url)}</td><td>${linkOrDash(row.slides_url)}</td><td>${linkOrDash(row.pdf_url)}</td><td>${whole(exportCounts[row.id])}</td><td>${whole(commentCounts[row.id])}</td></tr>
    `, "No hay cierres registrados.")
    els.historyDialog?.showModal()
  } catch (error) {
    showToast("No se pudo cargar historial", friendlyError(error), "error")
  }
}

function openExport() {
  const close = state.kpis.cierre || {}
  const links = [
    ["Sheet existente", close.sheet_url], ["Reporte Slides existente", close.slides_url], ["PDF existente", close.pdf_url],
  ].filter(([, url]) => Boolean(url))
  if (els.exportLinks) {
    els.exportLinks.innerHTML = links.length
      ? links.map(([label, url]) => `<div class="summary-row"><span>${escapeHtml(label)}</span><strong><a href="${escapeAttribute(url)}" target="_blank" rel="noopener">Abrir</a></strong></div>`).join("")
      : `<div class="message">La exportacion a Google Drive se conectara en la siguiente tanda mediante n8n.</div>`
  }
  els.exportDialog?.showModal()
}

function handleLoadError(error) {
  const message = friendlyError(error)
  showMessage(message, "error")
  showToast("No se pudo cargar", message, "error")
}

function friendlyError(error) {
  const raw = String(error?.message || error || "")
  if (raw.includes("not_allowed_to_view_dashboard")) return "No tienes permiso para consultar el Dashboard Operativo."
  if (raw.includes("period_key_required")) return "Selecciona un periodo valido."
  if (raw.includes("JWT") || raw.includes("permission") || raw.includes("policy")) return "No tienes permiso para realizar esta accion."
  return raw || "No se pudo cargar la informacion del dashboard."
}

function showMessage(text, type = "") {
  if (!els.messageBox) return
  els.messageBox.textContent = text
  els.messageBox.className = `message ${type}`
}

function hideMessage() {
  els.messageBox?.classList.add("hidden")
}

function showLoading(isLoading) {
  if (els.refreshBtn) els.refreshBtn.disabled = isLoading
  if (els.refreshBtn) els.refreshBtn.textContent = isLoading ? "Cargando..." : "Actualizar"
}

function showToast(title, body, type = "success") {
  if (!els.toastStack) return
  const toast = document.createElement("div")
  toast.className = `toast ${type}`
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span>`
  els.toastStack.appendChild(toast)
  setTimeout(() => toast.remove(), 4200)
}

function populateSelect(select, label, values) {
  if (!select) return
  const current = select.value || "todos"
  select.innerHTML = `<option value="todos">${label}: Todos</option>` + values.map((value) => `<option value="${normalize(value)}">${escapeHtml(value)}</option>`).join("")
  select.value = [...select.options].some((option) => option.value === current) ? current : "todos"
}

function countCritical() {
  const reasons = ensureArray(state.closureChecklist?.blocking_reasons)
  if (reasons.length) return reasons.length
  const checks = state.closureChecklist?.checks || {}
  return Object.values(checks).reduce((sum, value) => sum + (num(value) > 0 ? 1 : 0), 0)
}

function badgeFromCount(value) {
  const count = num(value)
  return count > 0 ? badge("danger", `${whole(count)} bloquea`) : badge("ok", "OK")
}

function badge(status, overrideLabel) {
  const key = String(status || "neutral")
  const label = overrideLabel || statusLabels[key] || key
  const cls = key === "ok" ? "ok" : key === "not_created" ? "neutral" : key === "closed" || key === "paid" ? "ok" : key === "cancelled" || key === "overdue" || key === "danger" ? "danger" : key === "pending" || key === "partial" ? "warning" : key
  return `<span class="badge ${escapeAttribute(cls)}">${escapeHtml(label)}</span>`
}

function linkOrDash(url) {
  return url ? `<a href="${escapeAttribute(url)}" target="_blank" rel="noopener">Abrir</a>` : "-"
}

function translateCheck(key) {
  return checkLabels[key] || String(key || "Revision")
}

function translateWarning(key) {
  return warningLabels[key] || String(key || "Advertencia")
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    acc[row[key]] = (acc[row[key]] || 0) + 1
    return acc
  }, {})
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, "es"))
}

function ensureArray(value) {
  return Array.isArray(value) ? value : []
}

function num(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function whole(value) {
  return numberFormatter.format(num(value))
}

function money(value) {
  return moneyFormatter.format(num(value))
}

function pct(value) {
  return `${percentFormatter.format(num(value))}%`
}

function formatDate(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("es-MX", { year: "numeric", month: "short", day: "2-digit" })
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("es-MX", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function currentPeriodKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function textValue(input) {
  return String(input?.value || "")
}

function selectValue(select) {
  return String(select?.value || "todos")
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-")
}

function setText(id, value) {
  if (els[id]) els[id].textContent = value
}

function safe(value, fallback = "-") {
  const text = value === null || value === undefined || value === "" ? fallback : String(value)
  return escapeHtml(text)
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]))
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;")
}
