const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  members: [],
  charges: [],
  payments: [],
  incidents: [],
  invoices: [],
  periods: [],
  activeFilter: "all",
  editingMemberId: null,
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
  dom.goIncomeBtn = document.getElementById("goIncomeBtn")
  dom.newMemberBtn = document.getElementById("newMemberBtn")
  dom.searchInput = document.getElementById("searchInput")
  dom.statusFilter = document.getElementById("statusFilter")
  dom.lineageFilter = document.getElementById("lineageFilter")
  dom.clearFilterBtn = document.getElementById("clearFilterBtn")
  dom.tableBody = document.getElementById("membersTableBody")
  dom.memberDialog = document.getElementById("memberDialog")
  dom.memberForm = document.getElementById("memberForm")
  dom.memberDialogTitle = document.getElementById("memberDialogTitle")
  dom.memberError = document.getElementById("memberError")
  dom.historyDialog = document.getElementById("historyDialog")
  dom.historyTitle = document.getElementById("historyTitle")
  dom.historyContent = document.getElementById("historyContent")
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
  dom.goIncomeBtn?.addEventListener("click", () => { window.location.href = "./ingresos.html" })
  dom.newMemberBtn?.addEventListener("click", openNewMember)
  dom.searchInput?.addEventListener("input", renderMembers)
  dom.statusFilter?.addEventListener("change", () => {
    state.activeFilter = "all"
    renderMembers()
  })
  dom.lineageFilter?.addEventListener("change", () => {
    state.activeFilter = "all"
    renderMembers()
  })
  dom.clearFilterBtn?.addEventListener("click", () => {
    state.activeFilter = "all"
    dom.searchInput.value = ""
    dom.statusFilter.value = "all"
    dom.lineageFilter.value = "all"
    renderMembers()
  })
  document.querySelectorAll("[data-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      state.activeFilter = card.dataset.filter || "all"
      renderMembers()
    })
  })
  dom.tableBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]")
    if (!button) return
    if (button.dataset.action === "history") showMemberHistory(button.dataset.id)
    if (button.dataset.action === "edit") openEditMember(button.dataset.id)
  })
  dom.memberForm?.addEventListener("submit", saveMember)
  document.getElementById("closeMemberBtn")?.addEventListener("click", closeMember)
  document.getElementById("cancelMemberBtn")?.addEventListener("click", closeMember)
  document.getElementById("closeHistoryBtn")?.addEventListener("click", closeHistory)
  document.getElementById("closeHistoryFooterBtn")?.addEventListener("click", closeHistory)
}

function applyTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.dataset.theme = saved
}

async function resolveUser() {
  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  state.profile = window.FluxAuth?.getProfile?.() || null
  const session = window.FluxAuth?.state?.session
  dom.userName.textContent = state.profile?.full_name || session?.user?.email || "Usuario"
  dom.userEmail.textContent = state.profile?.email || session?.user?.email || "Sesion activa"
}

async function loadData() {
  dom.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state"><strong>Cargando socios...</strong></td></tr>`
  try {
    const [members, charges, payments, incidents, invoices, periods] = await Promise.all([
      supabaseClient.from("members").select("*").order("full_name", { ascending: true }),
      supabaseClient.from("maintenance_fee_charges").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("maintenance_fee_payments").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("incident_charges").select("*").order("incident_date", { ascending: false }),
      supabaseClient.from("invoices").select("*").order("issue_date", { ascending: false }),
      supabaseClient.from("billing_periods").select("*").order("cutoff_date", { ascending: false }),
    ])
    const failed = [members, charges, payments, incidents, invoices, periods].find((result) => result.error)
    if (failed) throw failed.error
    state.members = members.data || []
    state.charges = charges.data || []
    state.payments = payments.data || []
    state.incidents = incidents.data || []
    state.invoices = invoices.data || []
    state.periods = periods.data || []
    renderStats()
    renderMembers()
  } catch (error) {
    dom.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state"><strong>No se pudieron cargar socios</strong>${escapeHtml(friendlyError(error))}</td></tr>`
    showToast("No se pudo cargar", friendlyError(error), "error")
  }
}

function renderStats() {
  const active = state.members.filter((member) => member.active !== false).length
  const pending = state.members.filter((member) => memberBalance(member.id).pending > 0).length
  const withIncidents = state.members.filter((member) => memberIncidents(member.id).length > 0).length
  const pendingInvoices = state.members.filter((member) => memberInvoices(member.id).some((invoice) => invoice.status === "issued")).length
  const totalHistoric = state.members.reduce((sum, member) => sum + memberBalance(member.id).historic, 0)
  setText("activeCount", active)
  setText("pendingCount", pending)
  setText("incidentCount", withIncidents)
  setText("invoiceCount", pendingInvoices)
  setText("historicTotal", formatCurrency(totalHistoric))
}

function renderMembers() {
  const query = normalize(dom.searchInput.value)
  const status = dom.statusFilter.value
  const lineage = dom.lineageFilter.value
  const rows = state.members.filter((member) => {
    const balance = memberBalance(member.id)
    const haystack = normalize([member.full_name, member.rfc, member.email, member.phone].join(" "))
    return haystack.includes(query) &&
      (status === "all" || (status === "active" ? member.active !== false : member.active === false)) &&
      (lineage === "all" || member.lineage === lineage) &&
      matchesQuickFilter(member, balance)
  })

  if (!rows.length) {
    dom.tableBody.innerHTML = `<tr><td colspan="9" class="empty-state"><strong>No hay socios para este filtro.</strong>Usa Ver todos o crea un nuevo socio.</td></tr>`
    return
  }

  dom.tableBody.innerHTML = rows.map((member) => {
    const balance = memberBalance(member.id)
    return `
      <tr>
        <td><strong>${escapeHtml(member.full_name || "Sin nombre")}</strong><span class="muted-line">${escapeHtml(member.email || "Sin correo")}</span></td>
        <td>${escapeHtml(member.rfc || "Sin RFC")}</td>
        <td>${escapeHtml(member.lineage || "Sin estirpe")}</td>
        <td>${formatNumber(member.fee_factor || 1)}</td>
        <td><strong>${formatCurrency(balance.pending)}</strong></td>
        <td>${statusBadge(balance.openIncidents > 0 ? "warn" : "good", `${balance.openIncidents} abiertas`)}</td>
        <td>${statusBadge(balance.pendingInvoices > 0 ? "warn" : "good", `${balance.pendingInvoices} pendientes`)}</td>
        <td>${statusBadge(member.active === false ? "bad" : "good", member.active === false ? "Inactivo" : "Activo")}</td>
        <td><div class="actions">
          <button class="small-btn info" type="button" data-action="history" data-id="${escapeHtml(member.id)}">Historial</button>
          <button class="small-btn" type="button" data-action="edit" data-id="${escapeHtml(member.id)}">Editar</button>
        </div></td>
      </tr>
    `
  }).join("")
}

function matchesQuickFilter(member, balance) {
  if (state.activeFilter === "all") return true
  if (state.activeFilter === "active") return member.active !== false
  if (state.activeFilter === "pending") return balance.pending > 0
  if (state.activeFilter === "incidents") return balance.openIncidents > 0 || balance.paidIncidents > 0
  if (state.activeFilter === "invoices") return balance.pendingInvoices > 0
  return true
}

function openNewMember() {
  state.editingMemberId = null
  dom.memberDialogTitle.textContent = "Nuevo socio"
  dom.memberForm.reset()
  value("memberFeeFactor", "1")
  document.getElementById("memberActive").checked = true
  hideMemberError()
  dom.memberDialog.showModal()
}

function openEditMember(memberId) {
  const member = byId(state.members, memberId)
  if (!member) return
  state.editingMemberId = memberId
  dom.memberDialogTitle.textContent = "Editar socio"
  value("memberFullName", member.full_name || "")
  value("memberRfc", member.rfc || "")
  value("memberLineage", member.lineage || "")
  value("memberFeeFactor", member.fee_factor || 1)
  value("memberEmail", member.email || "")
  value("memberPhone", member.phone || "")
  value("memberNotes", member.notes || "")
  document.getElementById("memberActive").checked = member.active !== false
  hideMemberError()
  dom.memberDialog.showModal()
}

function closeMember() {
  state.editingMemberId = null
  if (dom.memberDialog.open) dom.memberDialog.close()
}

async function saveMember(event) {
  event.preventDefault()
  hideMemberError()
  const fullName = value("memberFullName")
  const feeFactor = Number(value("memberFeeFactor"))
  if (!fullName) return showMemberError("Captura nombre completo.")
  if (!Number.isFinite(feeFactor) || feeFactor <= 0) return showMemberError("El factor debe ser mayor a cero. Ejemplo: 1 para cuota completa.")

  const payload = {
    full_name: fullName,
    rfc: value("memberRfc") || null,
    lineage: value("memberLineage") || null,
    fee_factor: feeFactor,
    email: value("memberEmail") || null,
    phone: value("memberPhone") || null,
    notes: value("memberNotes") || null,
    active: document.getElementById("memberActive").checked,
    updated_at: new Date().toISOString(),
  }

  const button = document.getElementById("saveMemberBtn")
  button.disabled = true
  button.textContent = "Guardando..."
  try {
    const result = state.editingMemberId
      ? await supabaseClient.from("members").update(payload).eq("id", state.editingMemberId)
      : await supabaseClient.from("members").insert(payload)
    if (result.error) throw result.error
    showToast("Socio guardado", "La informacion del socio se actualizo correctamente.", "success")
    closeMember()
    await loadData()
  } catch (error) {
    showMemberError(friendlyError(error))
  } finally {
    button.disabled = false
    button.textContent = "Guardar socio"
  }
}

function showMemberHistory(memberId) {
  const member = byId(state.members, memberId)
  if (!member) return
  const charges = memberCharges(memberId)
  const payments = memberPayments(memberId)
  const incidents = memberIncidents(memberId)
  const invoices = memberInvoices(memberId)
  const balance = memberBalance(memberId)

  dom.historyTitle.textContent = `Historial - ${member.full_name}`
  dom.historyContent.innerHTML = `
    <div class="detail-grid history-summary-grid">
      ${detailCard("Cuotas esperadas", formatCurrency(balance.expected))}
      ${detailCard("Cuotas pagadas", formatCurrency(balance.paid))}
      ${detailCard("Saldo pendiente", formatCurrency(balance.pending))}
      ${detailCard("Visitas/incidencias abiertas", `${balance.openIncidents}`)}
      ${detailCard("Visitas/incidencias pagadas", `${balance.paidIncidents}`)}
      ${detailCard("Facturas pendientes", `${balance.pendingInvoices}`)}
    </div>
    ${historyTable("Cuotas", "Cuotas de mantenimiento esperadas y avance de cobro.", "Sin cuotas registradas.", ["Periodo", "Esperado", "Pagado", "Pendiente", "Estatus"], charges.map((charge) => [
      periodLabel(charge.billing_period_id),
      formatCurrency(charge.expected_amount),
      formatCurrency(charge.paid_amount),
      formatCurrency(charge.pending_amount),
      statusPill(charge.status, chargeStatusLabel(charge.status)),
    ]))}
    ${historyTable("Pagos", "Pagos registrados contra cuotas de mantenimiento.", "Sin pagos registrados.", ["Fecha", "Monto", "Metodo", "Referencia", "Notas"], payments.map((payment) => [
      formatDate(payment.payment_date || payment.created_at),
      formatCurrency(payment.amount_paid),
      payment.payment_method || "Sin metodo",
      payment.bank_reference || "Sin referencia",
      payment.notes || "Sin notas",
    ]))}
    ${historyTable("Visitas / Incidencias", "Registro actual de visitas/incidencias. En la siguiente fase estas agruparan pagos asociados.", "Sin visitas/incidencias registradas.", ["Fecha", "Descripcion", "Monto actual", "Estatus", "Factura"], incidents.map((incident) => [
      formatDate(incident.incident_date),
      incident.description || "Sin descripcion",
      formatCurrency(incident.amount),
      statusPill(incident.status, incidentStatusLabel(incident.status)),
      invoiceLabel(incident.invoice_id),
    ]))}
    ${historyTable("Facturas", "Facturas emitidas o vinculadas al socio.", "Sin facturas registradas.", ["Folio", "Tipo", "Monto", "Emision", "Estatus", "Pago"], invoices.map((invoice) => [
      invoice.series_folio || invoice.fiscal_uuid || "Sin folio",
      invoice.invoice_type === "incident" ? "Visita/incidencia" : "Cuota",
      formatCurrency(invoice.amount),
      formatDate(invoice.issue_date),
      statusPill(invoice.status, invoiceStatusLabel(invoice.status)),
      formatDate(invoice.payment_date),
    ]))}
  `
  dom.historyDialog.showModal()
}

function closeHistory() {
  if (dom.historyDialog.open) dom.historyDialog.close()
}

function memberBalance(memberId) {
  const charges = memberCharges(memberId)
  const incidents = memberIncidents(memberId)
  const invoices = memberInvoices(memberId)
  const expected = sum(charges, "expected_amount")
  const paid = sum(charges, "paid_amount")
  const pending = charges.filter((charge) => !["paid", "cancelled"].includes(charge.status)).reduce((acc, charge) => acc + Number(charge.pending_amount || 0), 0)
  const openIncidents = incidents.filter((incident) => ["open", "invoiced"].includes(incident.status)).length
  const paidIncidents = incidents.filter((incident) => incident.status === "paid").length
  const pendingInvoices = invoices.filter((invoice) => invoice.status === "issued").length
  const historic = expected + sum(incidents, "amount")
  return { expected, paid, pending, openIncidents, paidIncidents, pendingInvoices, historic }
}

function memberCharges(memberId) {
  return state.charges.filter((charge) => charge.member_id === memberId)
}

function memberPayments(memberId) {
  const chargeIds = new Set(memberCharges(memberId).map((charge) => charge.id))
  return state.payments.filter((payment) => payment.member_id === memberId || chargeIds.has(payment.charge_id))
}

function memberIncidents(memberId) {
  return state.incidents.filter((incident) => incident.member_id === memberId || incident.referred_by_member_id === memberId)
}

function memberInvoices(memberId) {
  const chargeIds = new Set(memberCharges(memberId).map((charge) => charge.id))
  const incidentIds = new Set(memberIncidents(memberId).map((incident) => incident.id))
  return state.invoices.filter((invoice) => invoice.member_id === memberId || chargeIds.has(invoice.charge_id) || incidentIds.has(invoice.incident_charge_id))
}

function historyTable(title, description, emptyMessage, columns, rows) {
  if (!rows.length) {
    return `
      <section class="panel-card history-section">
        <div class="history-section-header">
          <div class="section-title">${escapeHtml(title)}</div>
          <p>${escapeHtml(description || "")}</p>
        </div>
        <div class="empty-state compact"><strong>${escapeHtml(emptyMessage || "Sin registros.")}</strong></div>
      </section>
    `
  }
  return `
    <section class="panel-card history-section">
      <div class="history-section-header">
        <div class="section-title">${escapeHtml(title)}</div>
        <p>${escapeHtml(description || "")}</p>
      </div>
      <div class="table-wrapper history-table-wrapper">
        <table class="history-table">
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${row.map(historyCell).join("")}</tr>`).join("")}</tbody>
        </table>
      </div>
    </section>
  `
}

function historyCell(cell) {
  if (cell && typeof cell === "object" && "html" in cell) return `<td>${cell.html}</td>`
  return `<td>${escapeHtml(displayValue(cell))}</td>`
}

function statusPill(status, label) {
  const good = ["paid", "closed", "approved"].includes(status)
  const bad = ["cancelled", "rejected"].includes(status)
  const klass = good ? "good" : bad ? "bad" : "warn"
  return { html: `<span class="badge ${klass}">${escapeHtml(label || status || "Sin estatus")}</span>` }
}

function detailCard(label, value) {
  return `<div class="detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(displayValue(value))}</strong></div>`
}

function periodLabel(id) {
  const period = byId(state.periods, id)
  return period ? `${period.name || "Periodo"} / ${period.year || ""}` : "Sin periodo"
}

function invoiceLabel(id) {
  const invoice = byId(state.invoices, id)
  return invoice ? (invoice.series_folio || invoice.fiscal_uuid || invoice.status || "Factura") : "Sin factura"
}

function displayValue(value) {
  if (value === null || value === undefined || value === "" || Number.isNaN(value)) return "-"
  return String(value)
}

function chargeStatusLabel(status) {
  const labels = { pending: "Pendiente", partial: "Parcial", paid: "Pagada", overdue: "Vencida", cancelled: "Cancelada" }
  return labels[status] || status || "Sin estatus"
}

function incidentStatusLabel(status) {
  const labels = { open: "Abierta", invoiced: "Facturada", paid: "Pagada", cancelled: "Cancelada" }
  return labels[status] || status || "Sin estatus"
}

function invoiceStatusLabel(status) {
  const labels = { issued: "Emitida", paid: "Pagada", cancelled: "Cancelada" }
  return labels[status] || status || "Sin estatus"
}

function statusBadge(type, label) {
  const klass = type === "good" ? "good" : type === "bad" ? "bad" : "warn"
  return `<span class="badge ${klass}">${escapeHtml(label)}</span>`
}

function showMemberError(message) {
  dom.memberError.textContent = message
  dom.memberError.classList.remove("hidden")
}

function hideMemberError() {
  dom.memberError.textContent = ""
  dom.memberError.classList.add("hidden")
}

function friendlyError(error) {
  const message = error?.message || String(error || "Error desconocido")
  if (message.includes("row-level security") || error?.code === "42501") return "No tienes permiso para realizar esta accion."
  return message
}

function showToast(title, message, type = "success") {
  const node = document.createElement("div")
  node.className = `toast ${type}`
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
  document.getElementById("toastStack").appendChild(node)
  window.setTimeout(() => node.remove(), 5500)
}

function byId(list, id) {
  return list.find((item) => item.id === id)
}

function setText(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function value(id, next) {
  const node = document.getElementById(id)
  if (!node) return ""
  if (next !== undefined) node.value = next
  return String(node.value || "").trim()
}

function normalize(text) {
  return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

function sum(list, key) {
  return list.reduce((acc, item) => acc + Number(item[key] || 0), 0)
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0))
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 4 }).format(Number(value || 0))
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
