const configClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Estado ──────────────────────────────────────────────────────
const TAB_LABELS = { members: "Socios", originAccounts: "Cuentas origen", budgets: "Presupuestos", system: "Sistema" }
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

  if (tab === "originAccounts" && !originLoaded) loadOriginAccounts()
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
