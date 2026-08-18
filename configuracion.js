const configClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Estado ──────────────────────────────────────────────────────
const TAB_LABELS = { members: "Socios", originAccounts: "Cuentas origen", budgets: "Presupuestos", contpaq: "Mapeo CONTPAQ", system: "Sistema" }
const dom = {}
let currentTab = null

// Cuentas origen
let originAccounts = []
let originCompanies = []
let editingOriginAccountId = null
let originLoaded = false

// Socios
let sociosMembers = []
let sociosCharges = []
let sociosPayments = []
let sociosIncidents = []
let sociosInvoices = []
let sociosPeriods = []
let editingMemberId = null
let sociosLoaded = false

// Enrutamiento de aprobadores
let routingCompanies = []
let routingMemberships = []
let routingAssignments = []
let routingApprovers = []

// ── Init ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", initConfigurationPage)

async function initConfigurationPage() {
  cacheDom()
  bindEvents()
  await FluxAuth.ready()
  const profile = FluxAuth.getProfile()
  if (profile) {
    dom.userName.textContent = profile.full_name || "Usuario"
    dom.userEmail.textContent = FluxAuth.state?.session?.user?.email || "Sesion activa"
  }
  updateVisibleTabs()
  openInitialTab()
}

function cacheDom() {
  dom.userName = document.getElementById("userName")
  dom.userEmail = document.getElementById("userEmail")
  dom.logoutBtn = document.getElementById("logoutBtn")
  dom.themeToggle = document.getElementById("themeToggle")
  dom.permissionMessage = document.getElementById("permissionMessage")
  dom.permissionMessageText = document.getElementById("permissionMessageText")
  dom.tabs = Array.from(document.querySelectorAll("[data-config-tab]"))
  dom.panels = {
    members: document.getElementById("membersPanel"),
    originAccounts: document.getElementById("originAccountsPanel"),
    budgets: document.getElementById("budgetsPanel"),
    contpaq: document.getElementById("contpaqPanel"),
    system: document.getElementById("systemPanel"),
  }
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", logout)
  dom.tabs.forEach((btn) => btn.addEventListener("click", () => openTab(btn.dataset.configTab)))

  // Cuentas origen
  document.getElementById("newOriginAccountBtn")?.addEventListener("click", openOriginAccountCreate)
  document.getElementById("closeOriginAccountModalBtn")?.addEventListener("click", closeOriginAccountModal)
  document.getElementById("cancelOriginAccountBtn")?.addEventListener("click", closeOriginAccountModal)
  document.getElementById("originAccountForm")?.addEventListener("submit", saveOriginAccount)
  document.getElementById("originAccountsTableBody")?.addEventListener("click", handleOriginAccountAction)

  // Socios
  document.getElementById("newMemberBtn")?.addEventListener("click", openNewMember)
  document.getElementById("closeMemberBtn")?.addEventListener("click", closeMember)
  document.getElementById("cancelMemberBtn")?.addEventListener("click", closeMember)
  document.getElementById("memberForm")?.addEventListener("submit", saveMember)
  document.getElementById("membersTableBody")?.addEventListener("click", handleMemberAction)
  document.getElementById("memberSearch")?.addEventListener("input", renderMembers)
  document.getElementById("memberStatusFilter")?.addEventListener("change", renderMembers)
  document.getElementById("memberLineageFilter")?.addEventListener("change", renderMembers)
  document.getElementById("clearMemberFilterBtn")?.addEventListener("click", clearMemberFilters)
  document.getElementById("closeHistoryBtn")?.addEventListener("click", closeHistory)
  document.getElementById("closeHistoryFooterBtn")?.addEventListener("click", closeHistory)

  // Usuarios
  document.getElementById("usersSearch")?.addEventListener("input", renderUsersTable)
  document.getElementById("usersRoleFilter")?.addEventListener("change", renderUsersTable)
  document.getElementById("refreshUsersBtn")?.addEventListener("click", loadSystemAdministration)
  document.getElementById("closeAssignRoleBtn")?.addEventListener("click", closeAssignRole)
  document.getElementById("cancelAssignRoleBtn")?.addEventListener("click", closeAssignRole)
  document.getElementById("saveAssignRoleBtn")?.addEventListener("click", saveAssignRole)
  document.getElementById("saveRoutingMembershipBtn")?.addEventListener("click", saveRoutingMembership)
  document.getElementById("routingMembershipsTableBody")?.addEventListener("click", handleRoutingMembershipAction)
  document.getElementById("routingRequester")?.addEventListener("change", handleRoutingRequesterChange)
  document.getElementById("routingAssignmentCompany")?.addEventListener("change", loadRoutingApproverOptions)
  document.getElementById("routingAssignmentForm")?.addEventListener("submit", saveRoutingAssignment)
  document.getElementById("routingAssignmentsTableBody")?.addEventListener("click", handleRoutingAssignmentAction)
}

// ── Tab logic ────────────────────────────────────────────────────
function updateVisibleTabs() {
  dom.tabs.forEach((btn) => {
    const allowed = canAccess(btn.dataset.configTab)
    btn.hidden = !allowed
    btn.disabled = !allowed
  })
}

function openInitialTab() {
  const requested = new URLSearchParams(window.location.search).get("tab") || ""
  const tabMap = { socios: "members", members: "members", cuentas: "originAccounts", cuentas_origen: "originAccounts", "cuentas-origen": "originAccounts", originAccounts: "originAccounts", budgets: "budgets", presupuestos: "budgets", system: "system", sistema: "system" }
  const requestedTab = tabMap[requested] || requested
  const firstAllowed = dom.tabs.find((btn) => !btn.hidden)?.dataset.configTab

  if (requestedTab && !canAccess(requestedTab)) {
    showPermission(`No tienes permiso para ver ${TAB_LABELS[requestedTab] || "esta seccion"}.`)
    openTab(firstAllowed)
    return
  }
  openTab(canAccess(requestedTab) ? requestedTab : firstAllowed)
}

function openTab(tab) {
  if (!tab) { showPermission("No tienes permisos de configuracion disponibles."); return }
  if (!canAccess(tab)) { showPermission(`No tienes permiso para ver ${TAB_LABELS[tab] || "esta seccion"}.`); return }

  hidePermission()
  currentTab = tab
  dom.tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.configTab === tab))
  Object.entries(dom.panels).forEach(([key, panel]) => {
    if (!panel) return
    panel.classList.toggle("active", key === tab)
  })

  const params = new URLSearchParams(window.location.search)
  params.set("tab", tab)
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`)

  if (tab === "system" && window.FluxAuth?.isSysadmin?.()) loadSystemAdministration()

  if (tab === "originAccounts" && !originLoaded) loadOriginAccounts()
  if (tab === "contpaq" && !contpaqLoaded) loadContpaqMapper()
  if (tab === "members" && !sociosLoaded) loadSocios()
}

function canAccess(tab) { return Boolean(window.FluxAuth?.canAccessConfigTab?.(tab)) }
function showPermission(msg) { if (dom.permissionMessageText) dom.permissionMessageText.textContent = msg; dom.permissionMessage?.classList.remove("hidden") }
function hidePermission() { dom.permissionMessage?.classList.add("hidden") }
async function logout() { await configClient.auth.signOut(); window.location.href = "./index.html" }

// ── Cuentas origen ───────────────────────────────────────────────
async function loadOriginAccounts() {
  const tbody = document.getElementById("originAccountsTableBody")
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">Cargando cuentas origen...</td></tr>`

  const [companiesResult, accountsResult] = await Promise.all([
    configClient.from("companies").select("id,name,legal_name,active").order("name", { ascending: true }),
    configClient.from("company_bank_accounts").select("id,company_id,name,bank_name,currency,account_type,last4,active,notes,account_number,clabe").order("name", { ascending: true }),
  ])

  if (companiesResult.error || accountsResult.error) {
    const error = companiesResult.error || accountsResult.error
    tbody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--ruby)">${escHtml(originRlsMessage(error, "select"))}</td></tr>`
    return
  }

  originCompanies = (companiesResult.data || []).filter((c) => c.active !== false)
  originAccounts = accountsResult.data || []
  originLoaded = true
  populateOriginCompanyOptions()
  renderOriginAccountsTable()
}

function renderOriginAccountsTable() {
  const tbody = document.getElementById("originAccountsTableBody")
  if (!tbody) return
  if (!originAccounts.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">No hay cuentas origen capturadas.</td></tr>`
    return
  }
  tbody.innerHTML = originAccounts.map((account) => {
    const company = originCompanies.find((c) => c.id === account.company_id)
    return `<tr>
      <td><strong>${escHtml(originCompanyName(company))}</strong></td>
      <td>${escHtml(account.name || "")}</td>
      <td>${escHtml(account.bank_name || "")}</td>
      <td><span class="clabe-num" style="font-variant-numeric:tabular-nums;font-size:12px">${escHtml(account.account_number || "")}</span></td>
      <td>${escHtml(account.clabe || "")}</td>
      <td>${escHtml(account.currency || "MXN")}</td>
      <td>${Components.badge(account.active === false ? "Inactiva" : "Activa", account.active === false ? "neutral" : "success")}</td>
      <td>
        <button type="button" class="small-btn" data-origin-action="edit" data-id="${escHtml(account.id)}">Editar</button>
        ${account.active === false
          ? `<button type="button" class="small-btn" data-origin-action="toggle" data-active="true" data-id="${escHtml(account.id)}">Reactivar</button>`
          : `<button type="button" class="small-btn danger" data-origin-action="toggle" data-active="false" data-id="${escHtml(account.id)}">Inactivar</button>`}
      </td>
    </tr>`
  }).join("")
}

function populateOriginCompanyOptions() {
  const select = document.getElementById("originCompanyId")
  if (!select) return
  select.innerHTML = '<option value="">Seleccionar empresa...</option>' +
    originCompanies.map((c) => `<option value="${escHtml(c.id)}">${escHtml(originCompanyName(c))}</option>`).join("")
}

function openOriginAccountCreate() {
  editingOriginAccountId = null
  document.getElementById("originAccountForm")?.reset()
  populateOriginCompanyOptions()
  document.getElementById("originAccountModalTitle").textContent = "Nueva cuenta origen"
  setVal("originCurrency", "MXN")
  document.getElementById("originAccountActive").checked = true
  hideOriginFormMessage()
  document.getElementById("originAccountDialog")?.showModal()
}

function openOriginAccountEdit(id) {
  const account = originAccounts.find((a) => a.id === id)
  if (!account) return
  editingOriginAccountId = id
  populateOriginCompanyOptions()
  document.getElementById("originAccountModalTitle").textContent = "Editar cuenta origen"
  setVal("originAccountId", account.id)
  setVal("originCompanyId", account.company_id)
  setVal("originAccountName", account.name)
  setVal("originBankName", account.bank_name)
  setVal("originAccountNumber", account.account_number)
  setVal("originClabe", account.clabe)
  setVal("originCurrency", account.currency || "MXN")
  setVal("originAccountType", account.account_type)
  setVal("originNotes", account.notes)
  document.getElementById("originAccountActive").checked = account.active !== false
  hideOriginFormMessage()
  document.getElementById("originAccountDialog")?.showModal()
}

async function saveOriginAccount(event) {
  event.preventDefault()
  const payload = {
    company_id: getVal("originCompanyId"),
    name: getVal("originAccountName"),
    bank_name: getVal("originBankName"),
    account_number: getVal("originAccountNumber"),
    clabe: getVal("originClabe"),
    currency: getVal("originCurrency") || "MXN",
    account_type: getVal("originAccountType"),
    notes: getVal("originNotes"),
    active: document.getElementById("originAccountActive")?.checked !== false,
  }
  payload.last4 = payload.account_number ? payload.account_number.slice(-4) : null

  const validation = validateOriginAccount(payload)
  if (validation) { showOriginFormMessage(validation); return }
  hideOriginFormMessage()

  const result = editingOriginAccountId
    ? await configClient.from("company_bank_accounts").update(payload).eq("id", editingOriginAccountId)
    : await configClient.from("company_bank_accounts").insert(payload)

  if (result.error) { showOriginFormMessage(originRlsMessage(result.error, editingOriginAccountId ? "update" : "insert")); return }

  closeOriginAccountModal()
  showToast("Cuenta origen guardada", "Los datos se guardaron correctamente.", "success")
  originLoaded = false
  await loadOriginAccounts()
}

function validateOriginAccount(payload) {
  if (!payload.company_id) return "Selecciona la empresa."
  if (!payload.name) return "Captura el nombre de la cuenta."
  if (!payload.bank_name) return "Captura el banco."
  if (!payload.account_number) return "Captura el numero de cuenta."
  if (!payload.currency) return "Selecciona la moneda."
  return ""
}

async function handleOriginAccountAction(event) {
  const button = event.target.closest("[data-origin-action]")
  if (!button) return
  const { originAction: action, id, active } = button.dataset
  if (action === "edit") { openOriginAccountEdit(id); return }
  if (action === "toggle") await toggleOriginAccount(id, active === "true")
}

async function toggleOriginAccount(id, active) {
  if (!confirm(active ? "Seguro que deseas reactivar esta cuenta origen?" : "Seguro que deseas inactivar esta cuenta origen?")) return
  const { error } = await configClient.from("company_bank_accounts").update({ active }).eq("id", id)
  if (error) { showToast("Error al actualizar", originRlsMessage(error, "update"), "danger"); return }
  showToast(active ? "Cuenta reactivada" : "Cuenta inactivada", "", "success")
  originLoaded = false
  await loadOriginAccounts()
}

function closeOriginAccountModal() {
  document.getElementById("originAccountDialog")?.close()
  hideOriginFormMessage()
  editingOriginAccountId = null
}

function showOriginFormMessage(text) {
  const msg = document.getElementById("originAccountFormMessage")
  const msgText = document.getElementById("originAccountFormMessageText")
  if (msgText) msgText.textContent = text
  msg?.classList.remove("hidden")
}

function hideOriginFormMessage() { document.getElementById("originAccountFormMessage")?.classList.add("hidden") }

function originRlsMessage(error, operation) {
  const msg = error?.message || ""
  const code = error?.code || ""
  const isPerm = code === "42501" || msg.toLowerCase().includes("row-level security") || msg.toLowerCase().includes("permission")
  if (code === "23502") return `Falta un dato obligatorio: ${msg}`
  if (code === "23505") return "Ya existe una cuenta origen con esos datos."
  if (msg.includes("company_account_type")) return "Tipo de cuenta no permitido."
  if (!isPerm) return `Error en cuentas origen: ${msg}`
  if (operation === "select") return "No se pudieron cargar las cuentas origen. Falta policy select sobre company_bank_accounts."
  if (operation === "insert") return "No se pudo crear la cuenta origen. Falta policy insert."
  return "No se pudo actualizar la cuenta origen. Falta policy update."
}

function originCompanyName(company) { return company ? (company.legal_name || company.name || "Empresa sin nombre") : "Sin empresa" }

// ── Socios ───────────────────────────────────────────────────────
async function loadSocios() {
  const tbody = document.getElementById("membersTableBody")
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--text-3)">Cargando socios...</td></tr>`

  try {
    const [members, charges, payments, incidents, invoices, periods] = await Promise.all([
      configClient.from("members").select("*").order("full_name", { ascending: true }),
      configClient.from("maintenance_fee_charges").select("*").order("created_at", { ascending: false }),
      configClient.from("maintenance_fee_payments").select("*").order("created_at", { ascending: false }),
      configClient.from("incident_charges").select("*").order("incident_date", { ascending: false }),
      configClient.from("invoices").select("*").order("issue_date", { ascending: false }),
      configClient.from("billing_periods").select("*").order("cutoff_date", { ascending: false }),
    ])
    const failed = [members, charges, payments, incidents, invoices, periods].find((r) => r.error)
    if (failed) throw failed.error

    sociosMembers = members.data || []
    sociosCharges = charges.data || []
    sociosPayments = payments.data || []
    sociosIncidents = incidents.data || []
    sociosInvoices = invoices.data || []
    sociosPeriods = periods.data || []
    sociosLoaded = true
    renderMembers()
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--ruby)">${escHtml(friendlyError(error))}</td></tr>`
    showToast("No se pudo cargar socios", friendlyError(error), "danger")
  }
}

function renderMembers() {
  const tbody = document.getElementById("membersTableBody")
  if (!tbody) return
  const query = normalize(document.getElementById("memberSearch")?.value || "")
  const status = document.getElementById("memberStatusFilter")?.value || "all"
  const lineage = document.getElementById("memberLineageFilter")?.value || "all"

  const rows = sociosMembers.filter((m) => {
    const haystack = normalize([m.full_name, m.rfc, m.email, m.phone].join(" "))
    return haystack.includes(query) &&
      (status === "all" || (status === "active" ? m.active !== false : m.active === false)) &&
      (lineage === "all" || m.lineage === lineage)
  })

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--text-3)">No hay socios para este filtro.</td></tr>`
    return
  }

  tbody.innerHTML = rows.map((m) => {
    const balance = memberBalance(m.id)
    return `<tr>
      <td><span class="cell-main">${escHtml(m.full_name || "Sin nombre")}</span><span class="cell-sub">${escHtml(m.email || "")}</span></td>
      <td>${escHtml(m.rfc || "")}</td>
      <td>${escHtml(m.lineage || "")}</td>
      <td>${formatNumber(m.fee_factor || 1)}</td>
      <td><span class="cell-main">${formatCurrency(balance.pending)}</span></td>
      <td>${Components.badge(`${balance.openIncidents} abiertas`, balance.openIncidents > 0 ? "warning" : "neutral")}</td>
      <td>${Components.badge(`${balance.pendingInvoices} pendientes`, balance.pendingInvoices > 0 ? "warning" : "neutral")}</td>
      <td>${Components.badge(m.active === false ? "Inactivo" : "Activo", m.active === false ? "neutral" : "success")}</td>
      <td>
        <button class="small-btn info" type="button" data-action="history" data-id="${escHtml(m.id)}" style="white-space:nowrap">Historial</button>
        <button class="small-btn" type="button" data-action="edit" data-id="${escHtml(m.id)}">Editar</button>
      </td>
    </tr>`
  }).join("")
}

function clearMemberFilters() {
  const search = document.getElementById("memberSearch")
  const status = document.getElementById("memberStatusFilter")
  const lineage = document.getElementById("memberLineageFilter")
  if (search) search.value = ""
  if (status) status.value = "all"
  if (lineage) lineage.value = "all"
  renderMembers()
}

function handleMemberAction(event) {
  const button = event.target.closest("[data-action]")
  if (!button) return
  if (button.dataset.action === "history") showMemberHistory(button.dataset.id)
  if (button.dataset.action === "edit") openEditMember(button.dataset.id)
}

function openNewMember() {
  editingMemberId = null
  document.getElementById("memberForm")?.reset()
  document.getElementById("memberDialogTitle").textContent = "Nuevo socio"
  document.getElementById("memberFeeFactor").value = "1"
  document.getElementById("memberActive").checked = true
  hideMemberError()
  document.getElementById("memberDialog")?.showModal()
}

function openEditMember(id) {
  const m = sociosMembers.find((item) => item.id === id)
  if (!m) return
  editingMemberId = id
  document.getElementById("memberDialogTitle").textContent = "Editar socio"
  setVal("memberFullName", m.full_name)
  setVal("memberRfc", m.rfc)
  setVal("memberLineage", m.lineage)
  setVal("memberFeeFactor", m.fee_factor || 1)
  setVal("memberEmail", m.email)
  setVal("memberPhone", m.phone)
  setVal("memberNotes", m.notes)
  document.getElementById("memberActive").checked = m.active !== false
  hideMemberError()
  document.getElementById("memberDialog")?.showModal()
}

async function saveMember(event) {
  event.preventDefault()
  const payload = {
    full_name: getVal("memberFullName"),
    rfc: getVal("memberRfc"),
    lineage: getVal("memberLineage"),
    fee_factor: Number(getVal("memberFeeFactor")) || 1,
    email: getVal("memberEmail"),
    phone: getVal("memberPhone"),
    notes: getVal("memberNotes"),
    active: document.getElementById("memberActive")?.checked !== false,
  }
  if (!payload.full_name) { showMemberError("El nombre completo es obligatorio."); return }
  hideMemberError()

  const result = editingMemberId
    ? await configClient.from("members").update(payload).eq("id", editingMemberId)
    : await configClient.from("members").insert(payload)

  if (result.error) { showMemberError(friendlyError(result.error)); return }

  closeMember()
  showToast("Socio guardado", "Los datos se guardaron correctamente.", "success")
  sociosLoaded = false
  await loadSocios()
}

function closeMember() { document.getElementById("memberDialog")?.close(); editingMemberId = null }
function showMemberError(text) { const el = document.getElementById("memberErrorText"); if (el) el.textContent = text; document.getElementById("memberError")?.classList.remove("hidden") }
function hideMemberError() { document.getElementById("memberError")?.classList.add("hidden") }

function showMemberHistory(id) {
  const member = sociosMembers.find((m) => m.id === id)
  if (!member) return
  document.getElementById("historyTitle").textContent = member.full_name || "Historial"
  const content = document.getElementById("historyContent")
  if (!content) return

  const charges = sociosCharges.filter((c) => c.member_id === id)
  const payments = sociosPayments.filter((p) => p.member_id === id)
  const incidents = sociosIncidents.filter((i) => i.member_id === id)
  const invoices = sociosInvoices.filter((inv) => inv.member_id === id)

  const balance = memberBalance(id)

  content.innerHTML = `
    <div class="ref-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px">
      <div class="ref-cell"><span class="ref-label">Saldo pendiente</span><span class="ref-value" style="color:${balance.pending > 0 ? "var(--amber)" : "var(--emerald)"}">${formatCurrency(balance.pending)}</span></div>
      <div class="ref-cell"><span class="ref-label">Total historico</span><span class="ref-value">${formatCurrency(balance.historic)}</span></div>
      <div class="ref-cell"><span class="ref-label">Factor</span><span class="ref-value">${formatNumber(member.fee_factor || 1)}</span></div>
    </div>
    ${renderHistorySection("Cuotas", charges.map((c) => `<tr><td>${escHtml(c.description || c.period_label || "Cuota")}</td><td>${formatCurrency(c.amount)}</td><td>${chargeStatusBadge(c.status)}</td><td>${formatDate(c.due_date)}</td></tr>`), ["Descripcion", "Monto", "Estatus", "Vencimiento"])}
    ${renderHistorySection("Pagos", payments.map((p) => `<tr><td>${formatDate(p.payment_date)}</td><td>${formatCurrency(p.amount)}</td><td>${paymentMethodLabel(p.payment_method)}</td>${p.notes ? `<td>${escHtml(p.notes)}</td>` : ""}</tr>`), payments.some((p) => p.notes) ? ["Fecha", "Monto", "Metodo", "Notas"] : ["Fecha", "Monto", "Metodo"])}
    ${renderHistorySection("Visitas / Incidencias", incidents.map((i) => `<tr><td>${formatDate(i.incident_date)}</td><td>${escHtml(i.description || "")}</td><td>${formatCurrency(i.amount)}</td><td>${incidentStatusBadge(i.status)}</td></tr>`), ["Fecha", "Descripcion", "Cargo", "Estatus"])}
    ${renderHistorySection("Facturas", invoices.map((inv) => `<tr><td>${escHtml(inv.folio || "—")}</td><td>${formatCurrency(inv.total)}</td><td>${invoiceStatusBadge(inv.status)}</td><td>${formatDate(inv.issue_date)}</td></tr>`), ["Folio", "Total", "Estatus", "Emision"])}
  `
  document.getElementById("historyDialog")?.showModal()
}

function renderHistorySection(title, rows, headers) {
  return `
    <div class="section-heading">${title}</div>
    ${rows.length ? `
      <div class="history-table-wrapper">
        <table class="history-table">
          <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>` : `<p style="color:var(--text-3);font-size:12px;margin-bottom:8px">Sin registros.</p>`}
  `
}

function closeHistory() { document.getElementById("historyDialog")?.close() }

// ── Balance helpers ──────────────────────────────────────────────
function memberBalance(memberId) {
  const charges = sociosCharges.filter((c) => c.member_id === memberId)
  const payments = sociosPayments.filter((p) => p.member_id === memberId)
  const incidents = sociosIncidents.filter((i) => i.member_id === memberId)
  const invoices = sociosInvoices.filter((inv) => inv.member_id === memberId)
  const totalCharged = charges.reduce((sum, c) => sum + Number(c.amount || 0), 0)
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)
  const incidentCharges = incidents.reduce((sum, i) => sum + Number(i.amount || 0), 0)
  const pending = totalCharged + incidentCharges - totalPaid
  const historic = totalCharged + incidentCharges
  const openIncidents = incidents.filter((i) => i.status && !["resolved", "paid", "closed"].includes(i.status)).length
  const pendingInvoices = invoices.filter((inv) => inv.status === "issued").length
  return { pending: Math.max(0, pending), historic, openIncidents, pendingInvoices }
}

// ── Badge helpers ────────────────────────────────────────────────
function chargeStatusBadge(status) {
  const map = { pending: ["Pendiente", "warning"], partial: ["Parcial", "warning"], paid: ["Pagado", "success"], cancelled: ["Cancelado", "neutral"], voided: ["Anulado", "neutral"] }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

function incidentStatusBadge(status) {
  const map = { open: ["Abierta", "danger"], pending: ["Pendiente", "warning"], paid: ["Pagada", "success"], resolved: ["Resuelta", "success"], closed: ["Cerrada", "neutral"], cancelled: ["Cancelada", "neutral"] }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

function invoiceStatusBadge(status) {
  const map = { issued: ["Emitida", "warning"], paid: ["Pagada", "success"], cancelled: ["Cancelada", "neutral"], draft: ["Borrador", "neutral"] }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

function paymentMethodLabel(method) {
  const map = { transfer: "Transferencia", cash: "Efectivo", check: "Cheque", card: "Tarjeta", spei: "SPEI" }
  return escHtml(map[method] || method || "—")
}

// ── Utilidades ───────────────────────────────────────────────────
function getVal(id) { const el = document.getElementById(id); return el ? (el.value.trim() || null) : null }
function setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value ?? "" }
function escHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }
function normalize(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") }
function formatCurrency(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(Number(value) || 0) }
function formatNumber(value) { return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 4 }).format(Number(value) || 0) }
function formatDate(value) { if (!value) return "—"; const d = new Date(`${String(value).slice(0, 10)}T00:00:00`); return isNaN(d) ? "—" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(d) }
function friendlyError(error) { const msg = error?.message || String(error || "Error desconocido"); if (msg.toLowerCase().includes("row-level security") || error?.code === "42501") return "Operacion bloqueada por RLS. Revisa policies."; return msg }
function showToast(title, desc, variant = "success") { Components.showToast({ title, desc, variant, duration: 6 }) }

// ── Gestión de usuarios ──────────────────────────────────────────

let allUsers = []
let assigningProfileId = null

const GROUP_LABELS = {
  sysadmin:     "SysAdmin",
  admin_finance: "Financiero",
  direction:    "Director",
  operation:    "Operativo",
  pending:      "Pendiente",
}
const GROUP_BADGE = {
  sysadmin:     "accent",
  admin_finance: "info",
  direction:    "violet",
  operation:    "success",
  pending:      "warning",
}
// El valor del radio del dialog mapea a varios nombres reales posibles en la
// tabla roles (alineado con los grupos de config.js). Así "sysadmin" encuentra
// superadmin/admin, "finance" encuentra administracion, etc.
const ROLE_ALIASES = {
  sysadmin:    ["sysadmin", "superadmin", "system_admin", "admin"],
  finance:     ["finance", "finanzas", "administracion", "treasury", "tesoreria"],
  director:    ["director", "direccion", "approver_2", "aprobador_2"],
  solicitante: ["solicitante", "operator", "default"],
}

function groupFromRoleNames(roleNames) {
  const SYSADMIN   = ["sysadmin","system_admin","admin"]
  const ADMIN      = ["finance","finanzas","treasury","tesoreria"]
  const DIRECTION  = ["approver_2","aprobador_2","direccion","director"]
  const OPERATION  = ["solicitante","operator","default"]
  const n = roleNames.map(r => r.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu,""))
  if (n.some(r => SYSADMIN.includes(r)))   return "sysadmin"
  if (n.some(r => ADMIN.includes(r)))      return "admin_finance"
  if (n.some(r => DIRECTION.includes(r)))  return "direction"
  if (n.some(r => OPERATION.includes(r)))  return "operation"
  return "pending"
}

async function loadUsers() {
  const tbody = document.getElementById("usersTableBody")
  if (!tbody) return
  tbody.innerHTML = `<tr><td colspan="6" style="padding:32px;text-align:center;color:var(--text-3)">Cargando…</td></tr>`

  try {
    // Traer todos los profiles con sus roles
    const { data: profiles, error: pe } = await configClient
      .from("profiles")
      .select("id,email,full_name,created_at,active")
      .order("created_at", { ascending: false })
    if (pe) throw pe

    const { data: userRoles, error: re } = await configClient
      .from("user_roles")
      .select("profile_id, roles(id,name)")
    if (re) throw re

    // Agrupar roles por profile
    const rolesByProfile = {}
    for (const ur of userRoles || []) {
      if (!rolesByProfile[ur.profile_id]) rolesByProfile[ur.profile_id] = []
      rolesByProfile[ur.profile_id].push(ur.roles?.name || "")
    }

    allUsers = (profiles || []).map(p => ({
      ...p,
      roleNames: rolesByProfile[p.id] || [],
      group: groupFromRoleNames(rolesByProfile[p.id] || []),
    }))

    renderUsersTable()
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--ruby)">${escHtml(err.message)}</td></tr>`
  }
}

function renderUsersTable() {
  const tbody = document.getElementById("usersTableBody")
  if (!tbody) return
  const query = normalize(document.getElementById("usersSearch")?.value || "")
  const groupFilter = document.getElementById("usersRoleFilter")?.value || "todos"

  const filtered = allUsers.filter(u => {
    const text = normalize(`${u.full_name || ""} ${u.email || ""}`)
    const matchText = !query || text.includes(query)
    const matchGroup = groupFilter === "todos" || u.group === groupFilter
    return matchText && matchGroup
  })

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--text-3)">Sin resultados.</td></tr>`
    return
  }

  tbody.innerHTML = filtered.map(u => `
    <tr>
      <td>
        <span class="cell-main">${escHtml(u.full_name || "Sin nombre")}</span>
        <span class="cell-sub">${escHtml(u.email || "")}</span>
      </td>
      <td>
        ${Components.badge(u.active === true ? "Activo" : "Inactivo", u.active === true ? "success" : "neutral")}
        ${u.active === true ? "" : `<span class="cell-sub">Este perfil conserva historial, pero no puede agregarse a una membresía ni utilizarse como aprobador.</span>`}
      </td>
      <td>${u.roleNames.length ? escHtml(u.roleNames.join(", ")) : Components.badge("Sin rol", "neutral")}</td>
      <td>${Components.badge(GROUP_LABELS[u.group] || u.group, GROUP_BADGE[u.group] || "neutral")}</td>
      <td><span class="cell-sub">${formatDate(u.created_at)}</span></td>
      <td>
        <button class="small-btn row-actions" data-action="assign-role" data-profile-id="${escHtml(u.id)}" data-group="${escHtml(u.group)}">
          Cambiar rol
        </button>
      </td>
    </tr>`).join("")

  tbody.addEventListener("click", handleUserAction, { once: true })
}

function handleUserAction(e) {
  // Re-bind after each render
  document.getElementById("usersTableBody")?.addEventListener("click", handleUserAction, { once: true })
  const btn = e.target.closest("[data-action='assign-role']")
  if (!btn) return
  openAssignRole(btn.dataset.profileId, btn.dataset.group)
}

function openAssignRole(profileId, currentGroup) {
  const user = allUsers.find(u => u.id === profileId)
  if (!user) return
  assigningProfileId = profileId
  document.getElementById("assignRoleSubtitle").textContent =
    `${user.full_name || user.email} - rol actual: ${GROUP_LABELS[currentGroup] || currentGroup}. Perfil ${user.active === true ? "activo" : "inactivo"}; cambiar el rol no modifica este estado.`
  // Preselect current group radio
  const roleMap = { sysadmin: "sysadmin", admin_finance: "finance", direction: "director", operation: "solicitante", pending: "pending" }
  const currentValue = roleMap[currentGroup] || "pending"
  document.querySelectorAll("[name='assignRole']").forEach(r => { r.checked = r.value === currentValue })
  document.getElementById("assignRoleDialog")?.showModal()
}

function closeAssignRole() {
  assigningProfileId = null
  document.getElementById("assignRoleDialog")?.close()
}

async function saveAssignRole() {
  if (!assigningProfileId) return
  const selected = document.querySelector("[name='assignRole']:checked")?.value
  if (!selected) { showToast("Selecciona un rol", "Elige un nivel de acceso.", "warning"); return }

  const btn = document.getElementById("saveAssignRoleBtn")
  btn.disabled = true
  btn.textContent = "Guardando…"

  try {
    // 1. Obtener todos los roles de la tabla roles
    const { data: rolesData, error: re } = await configClient.from("roles").select("id,name")
    if (re) throw re

    // 2. Resolver el rol destino ANTES de borrar nada (alias-tolerante: el
    //    valor del UI puede mapear a varios nombres reales en la tabla).
    let roleRow = null
    if (selected !== "pending") {
      const aliases = (ROLE_ALIASES[selected] || [selected]).map(a => a.toLowerCase())
      roleRow = rolesData.find(r => aliases.includes(r.name.toLowerCase()))
      if (!roleRow) throw new Error(`No hay un rol equivalente a "${selected}" en la tabla roles.`)
    }

    // 3. Borrar roles actuales del usuario (ya verificamos que el nuevo existe)
    const { error: de } = await configClient.from("user_roles").delete().eq("profile_id", assigningProfileId)
    if (de) throw de

    // 4. Asignar el nuevo rol (si no es pending)
    if (roleRow) {
      const { error: ie } = await configClient.from("user_roles").insert({ profile_id: assigningProfileId, role_id: roleRow.id })
      if (ie) throw ie
    }

    const updatedUser = allUsers.find((user) => user.id === assigningProfileId)
    showToast(
      "Rol actualizado",
      updatedUser?.active === true
        ? "El acceso del usuario fue actualizado correctamente."
        : "El rol se guardó, pero el perfil continúa inactivo y sin acceso operativo.",
      "success"
    )
    closeAssignRole()
    await loadSystemAdministration()
  } catch (err) {
    showToast("Error al guardar", err.message, "error")
  } finally {
    btn.disabled = false
    btn.textContent = "Guardar rol"
  }
}

async function loadSystemAdministration() {
  await loadUsers()
  await loadApproverRoutingAdmin()
}

async function loadApproverRoutingAdmin() {
  const membershipsBody = document.getElementById("routingMembershipsTableBody")
  const assignmentsBody = document.getElementById("routingAssignmentsTableBody")
  if (membershipsBody) membershipsBody.innerHTML = `<tr><td colspan="4" style="padding:28px;text-align:center;color:var(--text-3)">Cargando membresías...</td></tr>`
  if (assignmentsBody) assignmentsBody.innerHTML = `<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--text-3)">Cargando aprobadores disponibles...</td></tr>`

  try {
    const [companiesResult, membershipsResult, assignmentsResult] = await Promise.all([
      configClient.from("companies").select("id,name,legal_name,active").eq("active", true).order("name"),
      configClient.rpc("list_profile_company_memberships"),
      configClient.rpc("list_approver_assignments"),
    ])
    const failed = [companiesResult, membershipsResult, assignmentsResult].find(result => result.error)
    if (failed) throw failed.error

    routingCompanies = companiesResult.data || []
    routingMemberships = membershipsResult.data || []
    routingAssignments = assignmentsResult.data || []
    populateRoutingBaseSelectors()
    renderRoutingMemberships()
    renderRoutingAssignments()
    handleRoutingRequesterChange()
  } catch (error) {
    const message = escHtml(friendlyRoutingError(error))
    if (membershipsBody) membershipsBody.innerHTML = `<tr><td colspan="4" style="padding:24px;text-align:center;color:var(--ruby)">${message}</td></tr>`
    if (assignmentsBody) assignmentsBody.innerHTML = `<tr><td colspan="6" style="padding:24px;text-align:center;color:var(--ruby)">${message}</td></tr>`
  }
}

function populateRoutingBaseSelectors() {
  const profileOptions = `<option value="">Seleccionar usuario...</option>` +
    allUsers.filter(user => user.active === true).map(user => `<option value="${escHtml(user.id)}">${escHtml(user.full_name || user.email || "Sin nombre")}</option>`).join("")
  const companyOptions = `<option value="">Seleccionar empresa...</option>` +
    routingCompanies.map(company => `<option value="${escHtml(company.id)}">${escHtml(company.legal_name || company.name || "Sin empresa")}</option>`).join("")
  const membershipProfile = document.getElementById("routingMembershipProfile")
  const membershipCompany = document.getElementById("routingMembershipCompany")
  const requester = document.getElementById("routingRequester")
  if (membershipProfile) membershipProfile.innerHTML = profileOptions
  if (membershipCompany) membershipCompany.innerHTML = companyOptions
  if (requester) requester.innerHTML = profileOptions.replace("Seleccionar usuario...", "Seleccionar solicitante...")
}

function renderRoutingMemberships() {
  const tbody = document.getElementById("routingMembershipsTableBody")
  if (!tbody) return
  if (!routingMemberships.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding:28px;text-align:center;color:var(--text-3)">No hay membresías configuradas.</td></tr>`
    return
  }
  tbody.innerHTML = routingMemberships.map(row => `
    <tr>
      <td><span class="cell-main">${escHtml(row.profile_name || "Sin nombre")}</span><span class="cell-sub">${escHtml(row.profile_email || "")}</span>${allUsers.find((user) => user.id === row.profile_id)?.active === true ? "" : `<span class="cell-sub" style="color:var(--ruby)">Perfil inactivo; se conserva solo por historial.</span>`}</td>
      <td>${escHtml(row.company_name || "Sin empresa")}</td>
      <td>${Components.badge(row.active ? "Activa" : "Inactiva", row.active ? "success" : "neutral")}</td>
      <td><button type="button" class="small-btn" data-routing-membership-id="${escHtml(row.id)}">${row.active ? "Desactivar" : "Activar"}</button></td>
    </tr>`).join("")
}

async function saveRoutingMembership() {
  const profileId = document.getElementById("routingMembershipProfile")?.value || ""
  const companyId = document.getElementById("routingMembershipCompany")?.value || ""
  if (!profileId || !companyId) return showToast("Datos incompletos", "Selecciona usuario y empresa.", "warning")
  const button = document.getElementById("saveRoutingMembershipBtn")
  button.disabled = true
  try {
    const { error } = await configClient.rpc("set_profile_company_membership", {
      p_profile_id: profileId,
      p_company_id: companyId,
      p_active: true,
    })
    if (error) throw error
    showToast("Membresía guardada", "El alcance usuario–empresa quedó activo.", "success")
    await loadApproverRoutingAdmin()
  } catch (error) {
    showToast("No se pudo guardar", friendlyRoutingError(error), "danger")
  } finally {
    button.disabled = false
  }
}

async function handleRoutingMembershipAction(event) {
  const button = event.target.closest("[data-routing-membership-id]")
  if (!button) return
  const membership = routingMemberships.find(row => row.id === button.dataset.routingMembershipId)
  if (!membership) return
  button.disabled = true
  try {
    const { error } = await configClient.rpc("set_profile_company_membership", {
      p_profile_id: membership.profile_id,
      p_company_id: membership.company_id,
      p_active: !membership.active,
    })
    if (error) throw error
    showToast("Membresía actualizada", !membership.active ? "Membresía activada." : "Membresía desactivada.", "success")
    await loadApproverRoutingAdmin()
  } catch (error) {
    showToast("No se pudo actualizar", friendlyRoutingError(error), "danger")
  } finally {
    button.disabled = false
  }
}

function handleRoutingRequesterChange() {
  const requesterId = document.getElementById("routingRequester")?.value || ""
  const companySelect = document.getElementById("routingAssignmentCompany")
  const approverSelect = document.getElementById("routingApprover")
  const activeMemberships = routingMemberships.filter(row => row.profile_id === requesterId && row.active)
  if (companySelect) {
    companySelect.disabled = !requesterId || !activeMemberships.length
    companySelect.innerHTML = `<option value="">Seleccionar empresa...</option>` +
      activeMemberships.map(row => `<option value="${escHtml(row.company_id)}">${escHtml(row.company_name || "Sin empresa")}</option>`).join("")
  }
  if (approverSelect) {
    approverSelect.disabled = true
    approverSelect.innerHTML = `<option value="">Selecciona solicitante y empresa</option>`
  }
  setRoutingAssignmentHelp(activeMemberships.length ? "Selecciona la empresa para cargar aprobadores elegibles." : "El solicitante necesita una membresía activa.")
}

async function loadRoutingApproverOptions() {
  const requesterId = document.getElementById("routingRequester")?.value || ""
  const companyId = document.getElementById("routingAssignmentCompany")?.value || ""
  const select = document.getElementById("routingApprover")
  routingApprovers = []
  if (!select) return
  if (!requesterId || !companyId) {
    select.disabled = true
    select.innerHTML = `<option value="">Selecciona solicitante y empresa</option>`
    return
  }
  select.disabled = true
  select.innerHTML = `<option value="">Cargando aprobadores...</option>`
  const { data, error } = await configClient.rpc("list_company_approver_candidates", {
    p_company_id: companyId,
    p_requester_id: requesterId,
  })
  if (error) {
    select.innerHTML = `<option value="">No se pudieron cargar</option>`
    setRoutingAssignmentHelp(friendlyRoutingError(error), true)
    return
  }
  routingApprovers = data || []
  select.innerHTML = `<option value="">Seleccionar aprobador...</option>` +
    routingApprovers.map(row => {
      const roles = Array.isArray(row.eligible_roles) ? row.eligible_roles.join(", ") : ""
      return `<option value="${escHtml(row.profile_id)}">${escHtml(row.display_name || row.email || "Sin nombre")}${roles ? ` - ${escHtml(roles)}` : ""}</option>`
    }).join("")
  select.disabled = !routingApprovers.length
  setRoutingAssignmentHelp(routingApprovers.length ? "Se excluyen los aprobadores que ya están activos en este pool." : "No quedan aprobadores disponibles para agregar.", !routingApprovers.length)
}

async function saveRoutingAssignment(event) {
  event.preventDefault()
  const requesterId = document.getElementById("routingRequester")?.value || ""
  const companyId = document.getElementById("routingAssignmentCompany")?.value || ""
  const approverId = document.getElementById("routingApprover")?.value || ""
  if (!requesterId || !companyId || !approverId) return showToast("Datos incompletos", "Selecciona solicitante, empresa y aprobador.", "warning")
  const button = document.getElementById("saveRoutingAssignmentBtn")
  button.disabled = true
  try {
    const { error } = await configClient.rpc("add_approver_assignment", {
      p_company_id: companyId,
      p_requester_id: requesterId,
      p_approver_id: approverId,
    })
    if (error) throw error
    showToast("Aprobador agregado correctamente", "El aprobador quedó disponible para este solicitante y empresa.", "success")
    await loadApproverRoutingAdmin()
  } catch (error) {
    showToast("No se pudo guardar", friendlyRoutingError(error), "danger")
  } finally {
    button.disabled = false
  }
}

function renderRoutingAssignments() {
  const tbody = document.getElementById("routingAssignmentsTableBody")
  if (!tbody) return
  if (!routingAssignments.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--text-3)">No hay aprobadores disponibles configurados.</td></tr>`
    return
  }
  tbody.innerHTML = routingAssignments.map(row => `
    <tr>
      <td><span class="cell-main">${escHtml(row.requester_name || "Sin nombre")}</span><span class="cell-sub">${escHtml(row.requester_email || "")}</span></td>
      <td>${escHtml(row.company_name || "Sin empresa")}</td>
      <td><span class="cell-main">${escHtml(row.approver_name || "Sin nombre")}</span><span class="cell-sub">${escHtml(row.approver_email || "")}</span></td>
      <td>${escHtml(Array.isArray(row.approver_roles) && row.approver_roles.length ? row.approver_roles.join(", ") : "Sin rol elegible")}</td>
      <td>${Components.badge(row.active ? "Activo" : "Inactivo", row.active ? "success" : "neutral")}</td>
      <td><button type="button" class="small-btn ${row.active ? "danger" : ""}" data-routing-assignment-id="${escHtml(row.id)}" data-routing-assignment-action="${row.active ? "remove" : "activate"}">${row.active ? "Quitar" : "Activar"}</button></td>
    </tr>`).join("")
}

async function handleRoutingAssignmentAction(event) {
  const button = event.target.closest("[data-routing-assignment-id]")
  if (!button) return
  const assignment = routingAssignments.find(row => row.id === button.dataset.routingAssignmentId)
  if (!assignment) return
  button.disabled = true
  try {
    const activating = button.dataset.routingAssignmentAction === "activate"
    const { error } = activating
      ? await configClient.rpc("add_approver_assignment", {
          p_company_id: assignment.company_id,
          p_requester_id: assignment.requester_id,
          p_approver_id: assignment.approver_id,
        })
      : await configClient.rpc("remove_approver_assignment", {
          p_assignment_id: assignment.id,
        })
    if (error) throw error
    showToast(
      activating ? "Aprobador activado correctamente" : "Aprobador eliminado correctamente",
      activating ? "Volvió a quedar disponible en el pool." : "Los demás aprobadores configurados permanecen sin cambios.",
      "success"
    )
    await loadApproverRoutingAdmin()
  } catch (error) {
    showToast("No se pudo quitar", friendlyRoutingError(error), "danger")
  } finally {
    button.disabled = false
  }
}

function setRoutingAssignmentHelp(message, isError = false) {
  const element = document.getElementById("routingAssignmentHelp")
  if (!element) return
  element.textContent = message
  element.style.color = isError ? "var(--ruby)" : ""
}

function friendlyRoutingError(error) {
  const message = error?.message || String(error || "Error desconocido")
  const known = {
    routing_admin_required: "Solo SysAdmin puede administrar el enrutamiento.",
    membership_used_by_active_approver_pool: "Quita primero los aprobadores activos que usan esta membresía.",
    requester_company_membership_required: "El solicitante necesita membresía activa en la empresa.",
    approver_company_membership_required: "El usuario no pertenece a la empresa o su membresía no está activa.",
    approver_role_required: "El usuario no tiene rol finance/director.",
    approver_not_eligible_for_company: "El aprobador debe ser finance/director y pertenecer a la empresa.",
    profile_not_found_or_inactive: "Solo los perfiles activos pueden recibir una membresía.",
    requester_cannot_be_own_pool_approver: "El solicitante no puede agregarse como su propio aprobador.",
    approver_already_configured: "Este aprobador ya está configurado para el solicitante y la empresa.",
  }
  const key = Object.keys(known).find(item => message.includes(item))
  return key ? known[key] : friendlyError(error)
}


// ── Mapeo contable CONTPAQ (partida → cuenta) ───────────────────
let contpaqLoaded = false
const contpaqState = { companies: [], companyId: null, accounts: new Map(), categories: [], mappings: new Map() }

async function loadContpaqMapper() {
  contpaqLoaded = true
  const body = document.getElementById("contpaqMapperBody")
  try {
    const [companiesR, categoriesR] = await Promise.all([
      configClient.from("companies").select("id,name,active").eq("active", true).order("name"),
      configClient.from("budget_categories").select("id,name,category,code,active").eq("active", true).order("category").order("name"),
    ])
    if (companiesR.error) throw companiesR.error
    if (categoriesR.error) throw categoriesR.error
    contpaqState.companies = companiesR.data || []
    contpaqState.categories = categoriesR.data || []

    const sel = document.getElementById("contpaqCompanySelect")
    if (sel) {
      sel.innerHTML = contpaqState.companies.map((c) => `<option value="${c.id}">${escHtml(c.name)}</option>`).join("")
      sel.addEventListener("change", () => selectContpaqCompany(sel.value))
    }
    document.getElementById("contpaqSearch")?.addEventListener("input", renderContpaqMapper)
    await selectContpaqCompany(contpaqState.companies[0]?.id || null)
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="4" style="padding:44px;text-align:center;color:var(--ruby)">${escHtml(errorMessage(err))}</td></tr>`
  }
}

async function selectContpaqCompany(companyId) {
  contpaqState.companyId = companyId
  const body = document.getElementById("contpaqMapperBody")
  if (!companyId) { if (body) body.innerHTML = "" ; return }
  if (body) body.innerHTML = `<tr><td colspan="4" style="padding:44px;text-align:center;color:var(--text-3)">Cargando catálogo...</td></tr>`
  try {
    const [accountsR, mappingsR] = await Promise.all([
      configClient.from("contpaq_accounts").select("code,name,is_detail").eq("company_id", companyId).limit(5000),
      configClient.from("budget_account_mappings").select("budget_category_id,contpaq_account_code").eq("company_id", companyId).limit(2000),
    ])
    if (accountsR.error) throw accountsR.error
    if (mappingsR.error) throw mappingsR.error
    contpaqState.accounts = new Map((accountsR.data || []).map((a) => [a.code, a]))
    contpaqState.mappings = new Map((mappingsR.data || []).map((m) => [m.budget_category_id, m.contpaq_account_code]))

    // datalist: solo cuentas de detalle (mapeables), gasto primero
    const list = document.getElementById("contpaqAccountsList")
    if (list) {
      const detalle = (accountsR.data || []).filter((a) => a.is_detail)
      detalle.sort((a, b) => (a.code[0] === "6" ? 0 : 1) - (b.code[0] === "6" ? 0 : 1) || a.code.localeCompare(b.code))
      list.innerHTML = detalle.map((a) => `<option value="${a.code}">${a.code} — ${escHtml(a.name)}</option>`).join("")
    }
    renderContpaqMapper()
  } catch (err) {
    if (body) body.innerHTML = `<tr><td colspan="4" style="padding:44px;text-align:center;color:var(--ruby)">${escHtml(errorMessage(err))} — ¿ya corriste el DDL del mapper en esta base?</td></tr>`
  }
}

function renderContpaqMapper() {
  const body = document.getElementById("contpaqMapperBody")
  if (!body) return
  const q = (document.getElementById("contpaqSearch")?.value || "").trim().toLowerCase()
  const cats = contpaqState.categories.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || String(c.category || "").toLowerCase().includes(q)
  )
  if (!contpaqState.accounts.size) {
    body.innerHTML = `<tr><td colspan="4" style="padding:44px;text-align:center;color:var(--text-3)">Esta empresa no tiene catálogo CONTPAQ cargado.</td></tr>`
    updateContpaqCounter(); return
  }
  const porGrupo = new Map()
  for (const cat of cats) {
    const g = cat.category || "Sin grupo"
    if (!porGrupo.has(g)) porGrupo.set(g, [])
    porGrupo.get(g).push(cat)
  }
  let html = ""
  for (const [grupo, lista] of [...porGrupo.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    const mapeadas = lista.filter((c) => contpaqState.accounts.get(contpaqState.mappings.get(c.id))).length
    html += `<tr><td colspan="4" style="padding:8px 14px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:var(--accent-text);background:var(--bg-hover)">${escHtml(grupo)} <span style="color:var(--text-3);font-weight:600;text-transform:none;letter-spacing:0">· ${mapeadas}/${lista.length}</span></td></tr>`
    html += lista.map((cat) => {
      const code = contpaqState.mappings.get(cat.id) || ""
      const account = code ? contpaqState.accounts.get(code) : null
      const ok = Boolean(account)
      return `<tr data-cat="${cat.id}" style="${ok ? "" : "background:rgba(245,158,11,.05)"}">
        <td style="padding-left:26px"><span class="cell-main">${escHtml(cat.name)}</span></td>
        <td><input list="contpaqAccountsList" data-map-input="${cat.id}" value="${escHtml(code)}" placeholder="Código o buscar..." class="form-control" style="width:100%;font-variant-numeric:tabular-nums"></td>
        <td data-map-name="${cat.id}" style="color:var(--text-2)">${account ? escHtml(account.name) : "—"}</td>
        <td data-map-state="${cat.id}">${ok
          ? `<span class="badge success">Mapeada</span>`
          : `<span class="badge warning">Sin mapear</span>`}</td>
      </tr>`
    }).join("")
  }
  body.innerHTML = html
  body.querySelectorAll("[data-map-input]").forEach((input) => {
    input.addEventListener("change", () => saveContpaqMapping(input.dataset.mapInput, input.value.trim(), input))
  })
  updateContpaqCounter()
}

function updateContpaqCounter() {
  const el = document.getElementById("contpaqMapperCounter")
  if (!el) return
  const total = contpaqState.categories.length
  const mapped = contpaqState.categories.filter((c) => contpaqState.accounts.get(contpaqState.mappings.get(c.id))).length
  el.textContent = `${mapped} de ${total} partidas mapeadas${mapped < total ? ` · ${total - mapped} pendientes` : " · completo ✓"}`
}

async function saveContpaqMapping(categoryId, code, input) {
  const companyId = contpaqState.companyId
  const profileId = window.FluxAuth?.getProfile?.()?.id || null
  try {
    if (!code) {
      const { error } = await configClient.from("budget_account_mappings")
        .delete().eq("company_id", companyId).eq("budget_category_id", categoryId)
      if (error) throw error
      contpaqState.mappings.delete(categoryId)
    } else {
      const account = contpaqState.accounts.get(code)
      if (!account) { showToastSafe("Cuenta no encontrada", `"${code}" no está en el catálogo CONTPAQ de esta empresa.`, "danger"); renderContpaqMapper(); return }
      if (!account.is_detail) { showToastSafe("Cuenta de mayor", `${code} no es cuenta de detalle — elige una cuenta hoja.`, "danger"); renderContpaqMapper(); return }
      const { error } = await configClient.from("budget_account_mappings")
        .upsert({ company_id: companyId, budget_category_id: categoryId, contpaq_account_code: code, updated_by: profileId, updated_at: new Date().toISOString() }, { onConflict: "company_id,budget_category_id" })
      if (error) throw error
      contpaqState.mappings.set(categoryId, code)
    }
    renderContpaqMapper()
  } catch (err) {
    showToastSafe("No se pudo guardar", errorMessage(err), "danger")
  }
}

function showToastSafe(title, desc, variant) {
  if (typeof showToast === "function") showToast(title, desc, variant)
  else alert(`${title}: ${desc}`)
}

function errorMessage(err) { return err?.message || String(err) }
