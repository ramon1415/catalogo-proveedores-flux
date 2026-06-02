const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  canApprove: false,
  requests: [],
  providers: [],
  companies: [],
  centers: [],
  categories: [],
  layoutLines: [],
  cashFunds: [],
  activeFilter: "pending",
  currentRequestId: null,
}

const dom = {}

document.addEventListener("DOMContentLoaded", init)

async function init() {
  cacheDom()
  bindEvents()
  applyTheme()
  await resolveUser()
  await loadData()
}

function cacheDom() {
  dom.userName = document.getElementById("userName")
  dom.userEmail = document.getElementById("userEmail")
  dom.logoutBtn = document.getElementById("logoutBtn")
  dom.themeToggle = document.getElementById("themeToggle")
  dom.refreshBtn = document.getElementById("refreshBtn")
  dom.permissionNotice = document.getElementById("permissionNotice")
  dom.searchInput = document.getElementById("searchInput")
  dom.statusFilter = document.getElementById("statusFilter")
  dom.budgetFilter = document.getElementById("budgetFilter")
  dom.clearFilterBtn = document.getElementById("clearFilterBtn")
  dom.tableBody = document.getElementById("approvalsTableBody")
  dom.detailDialog = document.getElementById("detailDialog")
  dom.detailTitle = document.getElementById("detailTitle")
  dom.detailSubtitle = document.getElementById("detailSubtitle")
  dom.detailContent = document.getElementById("detailContent")
  dom.decisionComments = document.getElementById("decisionComments")
  dom.decisionActions = document.getElementById("decisionActions")
  dom.decisionError = document.getElementById("decisionError")
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut()
    window.location.href = "./index.html"
  })
  dom.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"
    document.documentElement.dataset.theme = next
    localStorage.setItem("flux-theme", next)
  })
  dom.refreshBtn?.addEventListener("click", loadData)
  dom.searchInput?.addEventListener("input", renderTable)
  dom.statusFilter?.addEventListener("change", () => {
    state.activeFilter = "all"
    renderTable()
  })
  dom.budgetFilter?.addEventListener("change", () => {
    state.activeFilter = "all"
    renderTable()
  })
  dom.clearFilterBtn?.addEventListener("click", () => {
    state.activeFilter = "all"
    dom.searchInput.value = ""
    dom.statusFilter.value = "all"
    dom.budgetFilter.value = "all"
    renderTable()
  })
  document.querySelectorAll("[data-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      state.activeFilter = card.dataset.filter || "all"
      dom.statusFilter.value = "all"
      dom.budgetFilter.value = "all"
      renderTable()
    })
  })
  dom.tableBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]")
    if (!button) return
    const requestId = button.dataset.id
    if (button.dataset.action === "detail") openDetail(requestId)
  })
  dom.decisionActions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision]")
    if (!button) return
    decideRequest(button.dataset.decision)
  })
  document.getElementById("closeDetailBtn")?.addEventListener("click", closeDetail)
  document.getElementById("closeDetailFooterBtn")?.addEventListener("click", closeDetail)
}

function applyTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.dataset.theme = saved
}

async function resolveUser() {
  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  state.profile = window.FluxAuth?.getProfile?.() || null
  state.canApprove = Boolean(window.FluxAuth?.canApprove?.())

  const session = window.FluxAuth?.state?.session
  dom.userName.textContent = state.profile?.full_name || session?.user?.email || "Usuario"
  dom.userEmail.textContent = state.profile?.email || session?.user?.email || "Sesion activa"
  dom.permissionNotice.classList.toggle("hidden", state.canApprove)
}

async function loadData() {
  dom.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state"><strong>Cargando aprobaciones...</strong></td></tr>`
  try {
    const [
      requestsResult,
      providersResult,
      companiesResult,
      centersResult,
      categoriesResult,
      linesResult,
      fundsResult,
    ] = await Promise.all([
      supabaseClient.from("payment_requests").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("proveedores").select("id,alias,nombre_completo,rfc,beneficiary_name,destination_type"),
      supabaseClient.from("companies").select("id,name,legal_name"),
      supabaseClient.from("cost_centers").select("id,code,name"),
      supabaseClient.from("budget_categories").select("id,code,name,category"),
      supabaseClient.from("payment_layout_lines").select("id,payment_request_id,layout_id,status"),
      supabaseClient.from("cash_funds").select("id,payment_request_id,status,pending_amount"),
    ])

    const results = [requestsResult, providersResult, companiesResult, centersResult, categoriesResult, linesResult, fundsResult]
    const failed = results.find((result) => result.error)
    if (failed) throw failed.error

    state.requests = requestsResult.data || []
    state.providers = providersResult.data || []
    state.companies = companiesResult.data || []
    state.centers = centersResult.data || []
    state.categories = categoriesResult.data || []
    state.layoutLines = linesResult.data || []
    state.cashFunds = fundsResult.data || []
    renderStats()
    renderTable()
  } catch (error) {
    dom.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state"><strong>No se pudieron cargar aprobaciones</strong>${escapeHtml(friendlyError(error))}</td></tr>`
    showToast("No se pudo cargar", friendlyError(error), "error")
  }
}

function approvalRows() {
  const cutoff = Date.now() - 100 * 24 * 60 * 60 * 1000
  return state.requests.filter((request) => {
    if (["paid", "cancelled"].includes(request.status)) return false
    if (isPending(request) || isException(request) || isChanges(request)) return true
    if (request.status === "approved") {
      const dateValue = new Date(request.updated_at || request.created_at).getTime()
      return Number.isNaN(dateValue) || dateValue >= cutoff
    }
    return false
  })
}

function renderStats() {
  const rows = approvalRows()
  setText("pendingCount", rows.filter(isPending).length)
  setText("exceptionCount", rows.filter(isException).length)
  setText("changesCount", rows.filter(isChanges).length)
  setText("approvedCount", rows.filter((request) => request.status === "approved").length)
  setText("totalCount", rows.length)
}

function renderTable() {
  const query = normalize(dom.searchInput.value)
  const status = dom.statusFilter.value
  const budget = dom.budgetFilter.value
  let rows = approvalRows()

  rows = rows.filter((request) => {
    const provider = byId(state.providers, request.proveedor_id)
    const company = byId(state.companies, request.company_id)
    const category = byId(state.categories, request.budget_category_id)
    const haystack = normalize([
      request.request_number,
      request.description,
      request.notes,
      provider?.alias,
      provider?.nombre_completo,
      company?.legal_name,
      company?.name,
      category?.code,
      category?.name,
    ].join(" "))

    return haystack.includes(query) &&
      (status === "all" || request.status === status) &&
      (budget === "all" || request.budget_decision === budget) &&
      matchesQuickFilter(request)
  })

  if (!rows.length) {
    dom.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state"><strong>No hay solicitudes para esta vista.</strong>Cambia filtros o presiona Ver todas.</td></tr>`
    return
  }

  dom.tableBody.innerHTML = rows.map((request) => {
    const provider = byId(state.providers, request.proveedor_id)
    const company = byId(state.companies, request.company_id)
    const category = byId(state.categories, request.budget_category_id)
    return `
      <tr>
        <td><strong>${escapeHtml(request.request_number || "Sin folio")}</strong><span class="muted-line">${escapeHtml(formatDate(request.created_at))}</span></td>
        <td>${typeBadge(request.request_type)}</td>
        <td><strong>${escapeHtml(provider?.alias || provider?.nombre_completo || "Sin proveedor")}</strong><span class="muted-line">${escapeHtml(provider?.rfc || "")}</span></td>
        <td>${escapeHtml(company?.legal_name || company?.name || "Sin empresa")}</td>
        <td><strong>${escapeHtml(category?.code || "")}</strong><span class="muted-line">${escapeHtml(category?.name || category?.category || "Sin partida")}</span></td>
        <td><strong>${formatCurrency(request.amount_requested, request.currency)}</strong></td>
        <td>${statusBadge(request.status)}</td>
        <td>${budgetBadge(request)}</td>
        <td><div class="actions"><button class="small-btn" type="button" data-action="detail" data-id="${escapeHtml(request.id)}">Ver detalle</button></div></td>
      </tr>
    `
  }).join("")
}

function matchesQuickFilter(request) {
  if (state.activeFilter === "all") return true
  if (state.activeFilter === "pending") return isPending(request)
  if (state.activeFilter === "exceptions") return isException(request)
  if (state.activeFilter === "changes") return isChanges(request)
  if (state.activeFilter === "approved") return request.status === "approved"
  return true
}

function openDetail(requestId) {
  const request = state.requests.find((item) => item.id === requestId)
  if (!request) return
  state.currentRequestId = requestId
  dom.detailTitle.textContent = request.request_number || "Solicitud"
  dom.detailSubtitle.textContent = `${statusLabel(request.status)} / ${budgetLabel(request.budget_decision)}`
  dom.decisionComments.value = ""
  dom.decisionError.classList.add("hidden")
  dom.decisionError.textContent = ""
  dom.detailContent.innerHTML = renderDetail(request)
  dom.decisionActions.innerHTML = renderDecisionActions(request)
  dom.detailDialog.showModal()
}

function closeDetail() {
  state.currentRequestId = null
  if (dom.detailDialog.open) dom.detailDialog.close()
}

function renderDetail(request) {
  const provider = byId(state.providers, request.proveedor_id)
  const company = byId(state.companies, request.company_id)
  const center = byId(state.centers, request.cost_center_id)
  const category = byId(state.categories, request.budget_category_id)
  const layoutLine = state.layoutLines.find((line) => line.payment_request_id === request.id)
  const fund = state.cashFunds.find((item) => item.payment_request_id === request.id)

  return `
    <div class="detail-grid">
      ${detailCard("Proveedor", provider?.alias || provider?.nombre_completo || "Sin proveedor", provider?.rfc || "")}
      ${detailCard("Empresa", company?.legal_name || company?.name || "Sin empresa", "")}
      ${detailCard("Centro de costo", center?.name || center?.code || "Sin centro", center?.code || "")}
      ${detailCard("Partida", `${category?.code || ""} ${category?.name || category?.category || ""}`.trim() || "Sin partida", "")}
      ${detailCard("Monto", formatCurrency(request.amount_requested, request.currency), request.currency || "MXN")}
      ${detailCard("Tipo", typeLabel(request.request_type), request.request_type || "provider_payment")}
      ${detailCard("Estatus", statusLabel(request.status), request.status || "")}
      ${detailCard("Presupuesto", budgetLabel(request.budget_decision), request.budget_block_reason || "Sin motivo")}
    </div>
    <div class="panel-card" style="padding:14px;">
      <div class="section-title">Datos del pago</div>
      <p style="color:var(--text-2);margin-top:8px;">${escapeHtml(request.description || "Sin descripcion")}</p>
      <p style="color:var(--text-3);margin-top:4px;">${escapeHtml(request.notes || "Sin notas")}</p>
    </div>
    <div class="detail-grid">
      ${detailCard("Operacion posterior", layoutLine ? "En layout" : fund ? "Fondo creado" : "Sin operacion creada", layoutLine?.status || fund?.status || "Pendiente")}
      ${detailCard("Ajuste extraordinario", request.is_extraordinary_adjustment ? "Si" : "No", request.exception_action || request.exception_status || "")}
    </div>
  `
}

function renderDecisionActions(request) {
  if (!state.canApprove) {
    return `<span class="muted-line">Sin permisos de aprobacion</span>`
  }
  if (["approved", "rejected", "paid", "cancelled"].includes(request.status) && !isException(request)) {
    return `<span class="muted-line">Esta solicitud ya tiene una decision registrada</span>`
  }
  if (isException(request)) {
    return [
      decisionButton("Autorizar excepcion", "exception_approved", "success"),
      decisionButton("Rechazar excepcion", "exception_rejected", "danger"),
      decisionButton("Solicitar cambio de monto", "amount_change_requested", "warning"),
      decisionButton("Solicitar cambio de partida", "category_change_requested", "warning"),
      decisionButton("Solicitar ajuste presupuestal", "budget_adjustment_requested", "warning"),
    ].join("")
  }
  return [
    decisionButton("Aprobar", "approved", "success"),
    decisionButton("Rechazar", "rejected", "danger"),
    decisionButton("Solicitar cambios", "changes_requested", "warning"),
  ].join("")
}

function decisionButton(label, action, variant) {
  return `<button class="small-btn ${variant}" type="button" data-decision="${escapeHtml(action)}">${escapeHtml(label)}</button>`
}

async function decideRequest(action) {
  const request = state.requests.find((item) => item.id === state.currentRequestId)
  if (!request) return
  const comments = dom.decisionComments.value.trim()
  if (!state.profile?.id) return showToast("Perfil no identificado", "No se pudo identificar el perfil del usuario.", "error")
  if (requiresComment(action) && !comments) {
    dom.decisionError.textContent = "Captura un comentario para registrar esta decision."
    dom.decisionError.classList.remove("hidden")
    dom.decisionComments.focus()
    return
  }

  setDecisionButtons(true)
  try {
    const { error } = await supabaseClient.rpc("decide_payment_request", {
      p_payment_request_id: request.id,
      p_actor_profile_id: state.profile.id,
      p_action: action,
      p_comments: comments || null,
    })
    if (error) throw error
    showToast("Decision registrada", `${decisionLabel(action)} registrada correctamente.`, action.includes("reject") ? "warning" : "success")
    closeDetail()
    await loadData()
  } catch (error) {
    dom.decisionError.textContent = friendlyDecisionError(error)
    dom.decisionError.classList.remove("hidden")
    showToast("No se pudo registrar", friendlyDecisionError(error), "error")
  } finally {
    setDecisionButtons(false)
  }
}

function setDecisionButtons(disabled) {
  dom.decisionActions.querySelectorAll("button").forEach((button) => { button.disabled = disabled })
}

function isPending(request) {
  return request.status === "submitted" || request.status === "pending_approval" || request.status === "finance_validation"
}

function isChanges(request) {
  return request.status === "changes_requested" || request.exception_status === "changes_requested" ||
    ["amount_change_requested", "category_change_requested", "budget_adjustment_requested"].includes(request.exception_action)
}

function isException(request) {
  return request.budget_decision === "bloqueado" || request.is_extraordinary_adjustment === true ||
    ["pending", "requested"].includes(request.exception_status)
}

function requiresComment(action) {
  return action !== "approved"
}

function detailCard(label, value, hint) {
  return `<div class="detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong>${hint ? `<small class="muted-line">${escapeHtml(hint)}</small>` : ""}</div>`
}

function typeBadge(type) {
  const label = typeLabel(type)
  const klass = type === "cash" || type === "check" ? "warn" : "info"
  return `<span class="badge ${klass}">${escapeHtml(label)}</span>`
}

function statusBadge(status) {
  const klass = status === "approved" ? "good" : status === "rejected" ? "bad" : status === "changes_requested" ? "warn" : "info"
  return `<span class="badge ${klass}">${escapeHtml(statusLabel(status))}</span>`
}

function budgetBadge(request) {
  if (request.budget_decision === "aprobable") return `<span class="badge good">Aprobable</span>`
  if (request.budget_decision === "bloqueado") return `<span class="badge bad">Excepcion</span>`
  return `<span class="badge">${escapeHtml(request.budget_decision || "Sin validar")}</span>`
}

function typeLabel(type) {
  const labels = { provider_payment: "Transferencia", cash: "Efectivo", check: "Cheque", reimbursement: "Reembolso", deposit_refund: "Devolucion de deposito", other: "Otro" }
  return labels[type || "provider_payment"] || type || "Transferencia"
}

function statusLabel(status) {
  const labels = { submitted: "Pendiente", pending_approval: "Pendiente", finance_validation: "Validacion financiera", changes_requested: "Cambios solicitados", approved: "Aprobada", rejected: "Rechazada", paid: "Pagada", cancelled: "Cancelada" }
  return labels[status] || status || "Sin estatus"
}

function budgetLabel(value) {
  const labels = { aprobable: "Aprobable", bloqueado: "Excepcion presupuestal" }
  return labels[value] || value || "Sin validar"
}

function decisionLabel(action) {
  const labels = {
    approved: "Aprobacion",
    rejected: "Rechazo",
    changes_requested: "Solicitud de cambios",
    exception_approved: "Excepcion autorizada",
    exception_rejected: "Excepcion rechazada",
    amount_change_requested: "Cambio de monto solicitado",
    category_change_requested: "Cambio de partida solicitado",
    budget_adjustment_requested: "Ajuste presupuestal solicitado",
  }
  return labels[action] || action
}

function friendlyDecisionError(error) {
  const message = error?.message || String(error || "Error desconocido")
  const map = {
    actor_cannot_approve: "Tu rol no tiene permiso para aprobar esta solicitud.",
    actor_cannot_reject: "Tu rol no tiene permiso para rechazar esta solicitud.",
    comments_required_for_changes_requested: "El comentario es obligatorio para solicitar cambios.",
    comments_required_for_exception_action: "El comentario es obligatorio para decisiones de excepcion.",
  }
  return map[message] || friendlyError(error)
}

function friendlyError(error) {
  const message = error?.message || String(error || "Error desconocido")
  if (message.includes("not_allowed") || message.includes("row-level security") || error?.code === "42501") return "No tienes permiso para realizar esta accion."
  return message
}

function showToast(title, message, type = "success") {
  const node = document.createElement("div")
  node.className = `toast ${type}`
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
  document.getElementById("toastStack").appendChild(node)
  window.setTimeout(() => node.remove(), 5200)
}

function byId(list, id) {
  return list.find((item) => item.id === id)
}

function setText(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

function formatCurrency(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN" }).format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return "Sin fecha"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin fecha"
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date)
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}
