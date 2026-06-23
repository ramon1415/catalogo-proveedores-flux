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
  approvalEvents: [],
  mainTab: "decide",   // "decide" | "history"
  subFilter: "all",
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
  dom.clearFilterBtn = document.getElementById("clearFilterBtn")
  dom.mainTabs = document.getElementById("mainTabs")
  dom.subTabs = document.getElementById("subTabs")
  dom.tableBody = document.getElementById("approvalsTableBody")
  dom.detailDialog = document.getElementById("detailDialog")
  dom.detailTitle = document.getElementById("detailTitle")
  dom.detailSubtitle = document.getElementById("detailSubtitle")
  dom.detailAmount = document.getElementById("detailAmount")
  dom.detailContent = document.getElementById("detailContent")
  dom.decisionComments = document.getElementById("decisionComments")
  dom.decisionActions = document.getElementById("decisionActions")
  dom.decisionError = document.getElementById("decisionError")
  dom.decisionErrorText = document.getElementById("decisionErrorText")
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
  dom.searchInput?.addEventListener("input", render)
  dom.clearFilterBtn?.addEventListener("click", () => {
    dom.searchInput.value = ""
    state.subFilter = "all"
    render()
  })
  dom.mainTabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-main-tab]")
    if (!btn) return
    state.mainTab = btn.dataset.mainTab
    state.subFilter = "all"
    render()
  })
  dom.subTabs?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sub-tab]")
    if (!btn) return
    state.subFilter = btn.dataset.subTab
    render()
  })
  dom.tableBody?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]")
    if (!btn) return
    const id = btn.dataset.id
    if (btn.dataset.action === "detail") openDetail(id)
    if (btn.dataset.action === "quick-approve") handleQuickDecision(id, "approved")
    if (btn.dataset.action === "quick-reject") handleQuickDecision(id, "rejected")
  })
  dom.decisionActions?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-decision]")
    if (!btn) return
    decideRequest(btn.dataset.decision)
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
  dom.tableBody.innerHTML = `<div class="empty-state"><strong>Cargando aprobaciones...</strong></div>`
  try {
    const [req, prov, comp, cent, cat, lines, funds] = await Promise.all([
      supabaseClient.from("payment_requests").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("proveedores").select("id,alias,nombre_completo,rfc"),
      supabaseClient.from("companies").select("id,name,legal_name"),
      supabaseClient.from("cost_centers").select("id,code,name"),
      supabaseClient.from("budget_categories").select("id,code,name,category"),
      supabaseClient.from("payment_layout_lines").select("id,payment_request_id,layout_id,status"),
      supabaseClient.from("cash_funds").select("id,payment_request_id,status,pending_amount"),
    ])
    const failed = [req, prov, comp, cent, cat, lines, funds].find((r) => r.error)
    if (failed) throw failed.error
    state.approvalEvents = await loadApprovalEvents(req.data || [])
    state.requests = attachApprovalMetadata(req.data || [], state.approvalEvents)
    state.providers = prov.data || []
    state.companies = comp.data || []
    state.centers = cent.data || []
    state.categories = cat.data || []
    state.layoutLines = lines.data || []
    state.cashFunds = funds.data || []
    render()
  } catch (error) {
    dom.tableBody.innerHTML = `<div class="empty-state"><strong>No se pudieron cargar aprobaciones.</strong> ${escapeHtml(friendlyError(error))}</div>`
    showToast("No se pudo cargar", friendlyError(error), "error")
  }
}

async function loadApprovalEvents(requests) {
  const ids = [...new Set((requests || []).map((request) => request.id).filter(Boolean))]
  if (!ids.length) return []
  const { data, error } = await supabaseClient
    .from("payment_request_approvals")
    .select("payment_request_id,action,from_status,to_status,comments,approval_level,created_at,actor_profile_id")
    .in("payment_request_id", ids)
    .in("action", ["approved", "exception_approved", "rejected", "exception_rejected"])
    .order("created_at", { ascending: false })
  if (error) {
    console.warn("No se pudo cargar bitacora para fechas de aprobacion", error)
    return []
  }
  return data || []
}

function attachApprovalMetadata(requests, events) {
  const byRequest = new Map()
  ;(events || []).forEach((event) => {
    if (!event.payment_request_id || byRequest.has(event.payment_request_id)) return
    byRequest.set(event.payment_request_id, event)
  })
  return (requests || []).map((request) => ({
    ...request,
    __approvalEvent: byRequest.get(request.id) || null,
  }))
}

// ── Clasificación ─────────────────────────────────────────────

function approvalRows() {
  const cutoff = Date.now() - 100 * 24 * 60 * 60 * 1000
  return state.requests.filter((r) => {
    if (["paid", "cancelled"].includes(r.status)) return false
    if (isPending(r) || isException(r) || isChanges(r)) return true
    if (r.status === "approved" || r.status === "rejected") {
      const t = new Date(historyRelevantDate(r) || r.created_at).getTime()
      return Number.isNaN(t) || t >= cutoff
    }
    return false
  })
}

function isPending(r) {
  return r.status === "submitted" || r.status === "pending_approval" || r.status === "finance_validation"
}
function isChanges(r) {
  return r.status === "changes_requested" || r.exception_status === "changes_requested" ||
    ["amount_change_requested", "category_change_requested", "budget_adjustment_requested"].includes(r.exception_action)
}
function isException(r) {
  return r.budget_decision === "bloqueado" || r.is_extraordinary_adjustment === true ||
    ["pending", "requested"].includes(r.exception_status)
}
function columnKey(r) {
  if (r.status === "approved") return "approved"
  if (r.status === "rejected" || r.status === "cancelled") return "closed"
  if (isChanges(r)) return "changes"
  if (isException(r)) return "exceptions"
  return "pending"
}

// ── Render ────────────────────────────────────────────────────

function render() {
  renderMainTabs()
  renderSubTabs()
  renderKanban()
}

function renderMainTabs() {
  dom.mainTabs.querySelectorAll("[data-main-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mainTab === state.mainTab)
  })
  dom.tableBody.className = `approval-kanban ${state.mainTab === "decide" ? "view-decide" : "view-history"}`
}

function renderSubTabs() {
  const rows = approvalRows()
  const q = normalize(dom.searchInput.value)

  const counts = {
    pending: rows.filter((r) => columnKey(r) === "pending" && matchSearch(r, q)).length,
    changes: rows.filter((r) => columnKey(r) === "changes" && matchSearch(r, q)).length,
    exceptions: rows.filter((r) => columnKey(r) === "exceptions" && matchSearch(r, q)).length,
    approved: rows.filter((r) => columnKey(r) === "approved" && matchSearch(r, q)).length,
    closed: rows.filter((r) => columnKey(r) === "closed" && matchSearch(r, q)).length,
  }

  const decideTabs = [
    { key: "all", label: "Todas", variant: "" },
    { key: "pending", label: "Por aprobar", variant: "warning" },
    { key: "changes", label: "Cambios", variant: "danger" },
    { key: "exceptions", label: "Excepciones", variant: "violet" },
  ]
  const historyTabs = [
    { key: "all", label: "Todas", variant: "" },
    { key: "approved", label: "Aprobadas", variant: "" },
    { key: "closed", label: "Rechazadas", variant: "" },
  ]

  const tabs = state.mainTab === "decide" ? decideTabs : historyTabs
  dom.subTabs.innerHTML = tabs.map(({ key, label, variant }) => {
    const count = key === "all" ? null : counts[key]
    const isActive = state.subFilter === key
    return `<button class="sub-tab${isActive ? ` active${variant ? " " + variant : ""}` : ""}" type="button" data-sub-tab="${key}">
      ${escapeHtml(label)}${count != null ? `<span class="sub-tab-count">${count}</span>` : ""}
    </button>`
  }).join("")
}

function renderKanban() {
  const q = normalize(dom.searchInput.value)
  const rows = approvalRows().filter((r) => matchSearch(r, q))

  const decideColumns = [
    { key: "pending", title: "Por aprobar" },
    { key: "changes", title: "Cambios solicitados" },
    { key: "exceptions", title: "Excepcion presupuestal" },
  ]
  const historyColumns = [
    { key: "approved", title: "Aprobadas recientemente" },
    { key: "closed", title: "Rechazadas / cerradas" },
  ]

  const columns = (state.mainTab === "decide" ? decideColumns : historyColumns)
    .filter((col) => state.subFilter === "all" || state.subFilter === col.key)
    .map((col) => ({ ...col, rows: rows.filter((r) => columnKey(r) === col.key) }))

  const visibleRows = rows.filter((r) => columns.some((c) => c.key === columnKey(r)))
  if (!visibleRows.length) {
    dom.tableBody.innerHTML = `<div class="empty-state"><strong>Sin solicitudes en esta vista.</strong> Cambia el filtro o usa Ver todas.</div>`
    return
  }

  dom.tableBody.innerHTML = columns.map((col) => `
    <section class="approval-column">
      <div class="approval-column-header">
        <strong>${escapeHtml(col.title)}</strong>
        <em>${col.rows.length}</em>
      </div>
      <div class="approval-column-body">
        ${col.rows.length
          ? col.rows.map((r) => renderCard(r, col.key)).join("")
          : `<div class="kanban-empty">Sin solicitudes.</div>`}
      </div>
    </section>
  `).join("")
}

function matchSearch(r, q) {
  if (!q) return true
  const provider = byId(state.providers, r.proveedor_id)
  const company = byId(state.companies, r.company_id)
  return normalize([r.request_number, r.description, provider?.alias, provider?.nombre_completo, company?.legal_name, company?.name].join(" ")).includes(q)
}

function renderCard(r, colKey) {
  const provider = byId(state.providers, r.proveedor_id)
  const company = byId(state.companies, r.company_id)
  const canAct = state.canApprove && colKey === "pending"

  return `
    <article class="approval-card">
      <div class="approval-card-head">
        <div>
          <div class="approval-card-folio">${escapeHtml(r.request_number || "Sin folio")}</div>
          <div class="approval-card-date">${renderCardDates(r, colKey)}</div>
        </div>
        <div class="approval-card-amount">${escapeHtml(formatCurrency(r.amount_requested, r.currency))}</div>
      </div>
      <div>
        <div class="approval-card-provider">${escapeHtml(provider?.alias || provider?.nombre_completo || "Sin proveedor")}</div>
        <div class="approval-card-sub">${escapeHtml(company?.legal_name || company?.name || "Sin empresa")}</div>
      </div>
      <div class="approval-card-badges">
        ${statusBadge(r.status)}
        ${budgetBadge(r)}
      </div>
      <div class="approval-card-actions">
        <button class="small-btn" type="button" data-action="detail" data-id="${escapeHtml(r.id)}">Ver detalle</button>
        ${canAct ? `
          <button class="small-btn success" type="button" data-action="quick-approve" data-id="${escapeHtml(r.id)}">Aprobar</button>
          <button class="small-btn danger" type="button" data-action="quick-reject" data-id="${escapeHtml(r.id)}">Rechazar</button>
        ` : ""}
      </div>
    </article>
  `
}

function renderCardDates(request, colKey) {
  const created = `<span style="display:block">Creada: ${escapeHtml(formatDateTime(request.created_at))}</span>`
  if (!["approved", "closed"].includes(colKey)) return created
  const meta = approvalDateMeta(request)
  if (!meta?.value) return created
  return `<span style="display:block">${escapeHtml(meta.label)}: ${escapeHtml(formatDateTime(meta.value))}</span>${created}`
}

function approvalDateMeta(request) {
  const event = request.__approvalEvent
  if (event?.created_at) return { label: decisionDateLabel(event.action), value: event.created_at }
  if (request.exception_approved_at) return { label: "Excepción autorizada", value: request.exception_approved_at }
  if (request.approved_at) return { label: "Aprobada", value: request.approved_at }
  if ((request.status === "approved" || request.status === "rejected") && request.updated_at) {
    return { label: request.status === "rejected" ? "Rechazada/actualizada" : "Aprobada/actualizada", value: request.updated_at }
  }
  return null
}

function historyRelevantDate(request) {
  return approvalDateMeta(request)?.value || request.updated_at || request.created_at
}

function decisionDateLabel(action) {
  const labels = {
    approved: "Aprobada",
    exception_approved: "Excepción autorizada",
    rejected: "Rechazada",
    exception_rejected: "Excepción rechazada",
  }
  return labels[action] || "Decision"
}

// ── Modal ─────────────────────────────────────────────────────

function handleQuickDecision(requestId, action) {
  state.currentRequestId = requestId
  if (requiresComment(action)) {
    openDetail(requestId)
    dom.decisionComments.focus()
    showDecisionError("Captura un comentario para registrar esta decision.")
    return
  }
  decideRequest(action)
}

function openDetail(requestId) {
  const request = state.requests.find((r) => r.id === requestId)
  if (!request) return
  state.currentRequestId = requestId
  dom.detailTitle.textContent = request.request_number || "Solicitud"
  dom.detailAmount.textContent = formatCurrency(request.amount_requested, request.currency)
  dom.detailSubtitle.innerHTML = `${statusBadge(request.status)} ${budgetBadge(request)}`
  dom.decisionComments.value = ""
  hideDecisionError()
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
  const layoutLine = state.layoutLines.find((l) => l.payment_request_id === request.id)
  const fund = state.cashFunds.find((f) => f.payment_request_id === request.id)

  return `
    <div style="padding:0 20px 8px;display:flex;flex-direction:column;gap:12px">
      ${(request.description || request.notes) ? `
      <div class="data-section">
        ${request.description ? `<div class="data-row"><span class="data-label">Descripcion</span><span class="data-value muted">${escapeHtml(request.description)}</span></div>` : ""}
        ${request.notes ? `<div class="data-row"><span class="data-label">Notas</span><span class="data-value muted">${escapeHtml(request.notes)}</span></div>` : ""}
      </div>` : ""}
      <div class="ref-grid" style="grid-template-columns:1fr 1fr 1fr">
        <div class="ref-cell">
          <span class="ref-label">Proveedor</span>
          <span class="ref-value">${escapeHtml(provider?.alias || provider?.nombre_completo || "Sin proveedor")}</span>
          ${provider?.rfc ? `<span class="ref-value muted">${escapeHtml(provider.rfc)}</span>` : ""}
        </div>
        <div class="ref-cell">
          <span class="ref-label">Empresa</span>
          <span class="ref-value">${escapeHtml(company?.legal_name || company?.name || "Sin empresa")}</span>
        </div>
        <div class="ref-cell">
          <span class="ref-label">Centro de costo</span>
          <span class="ref-value">${escapeHtml(center?.name || center?.code || "Sin centro")}</span>
        </div>
        <div class="ref-cell">
          <span class="ref-label">Partida</span>
          <span class="ref-value">${escapeHtml([category?.code, category?.name || category?.category].filter(Boolean).join(" · ") || "Sin partida")}</span>
        </div>
        <div class="ref-cell">
          <span class="ref-label">Tipo</span>
          <span class="ref-value">${escapeHtml(typeLabel(request.request_type))}</span>
        </div>
        <div class="ref-cell">
          <span class="ref-label">Mes presupuestal</span>
          <span class="ref-value">${escapeHtml(formatMonth(request.budget_month))}</span>
        </div>
      </div>
      ${(layoutLine || fund || request.is_extraordinary_adjustment) ? `
      <div class="data-section">
        <div class="data-row">
          <span class="data-label">Operacion posterior</span>
          <span class="data-value">${escapeHtml(layoutLine ? "En layout" : fund ? "Fondo creado" : "Sin operacion creada")}</span>
        </div>
        ${request.is_extraordinary_adjustment ? `<div class="data-row"><span class="data-label">Ajuste extraordinario</span><span class="data-value">${escapeHtml(request.exception_action || request.exception_status || "Activo")}</span></div>` : ""}
      </div>` : ""}
    </div>
  `
}

function renderDecisionActions(request) {
  if (!state.canApprove) return `<span style="color:var(--text-3);font-size:12px">Sin permisos de aprobacion</span>`
  if (["approved", "rejected", "paid", "cancelled"].includes(request.status) && !isException(request)) {
    return `<span style="color:var(--text-3);font-size:12px">Esta solicitud ya tiene una decision registrada</span>`
  }
  if (isException(request)) {
    return [
      decisionButton("Autorizar excepcion", "exception_approved", "approve"),
      decisionButton("Rechazar excepcion", "exception_rejected", "reject"),
      decisionButton("Cambio de monto", "amount_change_requested", "change"),
      decisionButton("Cambio de partida", "category_change_requested", "change"),
      decisionButton("Ajuste presupuestal", "budget_adjustment_requested", "exception"),
    ].join("")
  }
  return [
    decisionButton("Aprobar", "approved", "approve"),
    decisionButton("Rechazar", "rejected", "reject"),
    decisionButton("Solicitar cambios", "changes_requested", "change"),
  ].join("")
}

function decisionButton(label, action, variant) {
  return `<button class="decision-btn ${escapeHtml(variant)}" type="button" data-decision="${escapeHtml(action)}">${escapeHtml(label)}</button>`
}

async function decideRequest(action) {
  const request = state.requests.find((r) => r.id === state.currentRequestId)
  if (!request) return
  const comments = dom.decisionComments.value.trim()
  if (!state.profile?.id) return showToast("Perfil no identificado", "No se pudo identificar el perfil.", "error")
  if (requiresComment(action) && !comments) {
    showDecisionError("Captura un comentario para registrar esta decision.")
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
    showDecisionError(friendlyDecisionError(error))
    showToast("No se pudo registrar", friendlyDecisionError(error), "error")
  } finally {
    setDecisionButtons(false)
  }
}

function setDecisionButtons(disabled) {
  dom.decisionActions.querySelectorAll("button").forEach((btn) => { btn.disabled = disabled })
}

function showDecisionError(msg) {
  dom.decisionErrorText.textContent = msg
  dom.decisionError.classList.remove("hidden")
}

function hideDecisionError() {
  dom.decisionError.classList.add("hidden")
  dom.decisionErrorText.textContent = ""
}

function requiresComment(action) { return action !== "approved" }

// ── Badges ────────────────────────────────────────────────────

function statusBadge(status) {
  const map = { approved: "success", rejected: "danger", changes_requested: "warning", submitted: "neutral", pending_approval: "neutral", finance_validation: "info" }
  return Components.badge(statusLabel(status), map[status] ?? "neutral")
}

function budgetBadge(r) {
  if (r.budget_decision === "aprobable") return Components.badge("Aprobable", "success")
  if (r.budget_decision === "bloqueado") return Components.badge("Excepcion", "violet")
  return Components.badge(r.budget_decision || "Sin validar", "neutral")
}

// ── Labels y formato ──────────────────────────────────────────

function typeLabel(type) {
  const m = { provider_payment: "Transferencia", cash: "Efectivo", check: "Cheque", reimbursement: "Reembolso", deposit_refund: "Devolucion de deposito", other: "Otro" }
  return m[type || "provider_payment"] || type || "Transferencia"
}

function statusLabel(status) {
  const m = { submitted: "Pendiente", pending_approval: "Pendiente", finance_validation: "Validacion financiera", changes_requested: "Cambios solicitados", approved: "Aprobada", rejected: "Rechazada", paid: "Pagada", cancelled: "Cancelada" }
  return m[status] || status || "Sin estatus"
}

function decisionLabel(action) {
  const m = { approved: "Aprobacion", rejected: "Rechazo", changes_requested: "Solicitud de cambios", exception_approved: "Excepcion autorizada", exception_rejected: "Excepcion rechazada", amount_change_requested: "Cambio de monto solicitado", category_change_requested: "Cambio de partida solicitado", budget_adjustment_requested: "Ajuste presupuestal solicitado" }
  return m[action] || action
}

function formatMonth(value) {
  if (!value) return "Sin mes"
  const [year, month] = String(value).split("-")
  const date = new Date(Number(year), Number(month) - 1, 1)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date)
}

function friendlyDecisionError(error) {
  const msg = error?.message || String(error || "")
  const map = { actor_cannot_approve: "Tu rol no tiene permiso para aprobar.", actor_cannot_reject: "Tu rol no tiene permiso para rechazar.", comments_required_for_changes_requested: "El comentario es obligatorio para solicitar cambios.", comments_required_for_exception_action: "El comentario es obligatorio para decisiones de excepcion." }
  return map[msg] || friendlyError(error)
}

function friendlyError(error) {
  const msg = error?.message || String(error || "Error desconocido")
  if (msg.includes("not_allowed") || msg.includes("row-level security") || error?.code === "42501") return "No tienes permiso para realizar esta accion."
  return msg
}

function showToast(title, message, type = "success") {
  const variantMap = { success: "success", error: "danger", warning: "warning", info: "info" }
  Components.showToast({ title: escapeHtml(title), desc: escapeHtml(message), variant: variantMap[type] ?? "info", duration: 6 })
}

function byId(list, id) { return list.find((item) => item.id === id) }

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
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

function formatDateTime(value) {
  if (!value) return "Sin fecha"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin fecha"
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;")
}
