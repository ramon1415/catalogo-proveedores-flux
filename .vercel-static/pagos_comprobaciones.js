const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  entries: [],
  requests: [],
  providers: [],
  companies: [],
  layouts: [],
  lines: [],
  funds: [],
  reconciliations: [],
  receipts: [],
  activeFilter: "all",
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
  dom.searchInput = document.getElementById("searchInput")
  dom.typeFilter = document.getElementById("typeFilter")
  dom.statusFilter = document.getElementById("statusFilter")
  dom.clearFilterBtn = document.getElementById("clearFilterBtn")
  dom.tableBody = document.getElementById("paymentsTableBody")
  dom.detailDialog = document.getElementById("detailDialog")
  dom.detailTitle = document.getElementById("detailTitle")
  dom.detailSubtitle = document.getElementById("detailSubtitle")
  dom.detailContent = document.getElementById("detailContent")
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
  dom.typeFilter?.addEventListener("change", () => {
    state.activeFilter = "all"
    renderTable()
  })
  dom.statusFilter?.addEventListener("change", () => {
    state.activeFilter = "all"
    renderTable()
  })
  dom.clearFilterBtn?.addEventListener("click", () => {
    state.activeFilter = "all"
    dom.searchInput.value = ""
    dom.typeFilter.value = "all"
    dom.statusFilter.value = "all"
    renderTable()
  })
  document.querySelectorAll("[data-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      state.activeFilter = card.dataset.filter || "all"
      renderTable()
    })
  })
  dom.tableBody?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]")
    if (!button) return
    if (button.dataset.action === "detail") openDetail(button.dataset.id)
    if (button.dataset.action === "receipt") openReceipt(button.dataset.id)
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
  const session = window.FluxAuth?.state?.session
  dom.userName.textContent = state.profile?.full_name || session?.user?.email || "Usuario"
  dom.userEmail.textContent = state.profile?.email || session?.user?.email || "Sesion activa"
}

async function loadData() {
  dom.tableBody.innerHTML = `<tr><td colspan="8" class="empty-state"><strong>Cargando pagos...</strong></td></tr>`
  try {
    const [requests, providers, companies, layouts, lines, funds, reconciliations, receipts] = await Promise.all([
      supabaseClient.from("payment_requests").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("proveedores").select("id,alias,nombre_completo,rfc"),
      supabaseClient.from("companies").select("id,name,legal_name"),
      supabaseClient.from("payment_layouts").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("payment_layout_lines").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("cash_funds").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("cash_reconciliations").select("*").order("created_at", { ascending: false }),
      supabaseClient.from("payment_receipts").select("*").order("created_at", { ascending: false }),
    ])

    const required = [requests, providers, companies, layouts, lines, funds, reconciliations]
    const failed = required.find((result) => result.error)
    if (failed) throw failed.error

    state.requests = requests.data || []
    state.providers = providers.data || []
    state.companies = companies.data || []
    state.layouts = layouts.data || []
    state.lines = lines.data || []
    state.funds = funds.data || []
    state.reconciliations = reconciliations.data || []
    state.receipts = receipts.error ? [] : (receipts.data || [])
    state.entries = buildEntries()
    renderStats()
    renderTable()

    if (receipts.error) {
      showToast("Comprobantes parciales", "No se pudo leer payment_receipts. Se muestran pagos y placeholder de comprobante.", "warning")
    }
  } catch (error) {
    dom.tableBody.innerHTML = `<tr><td colspan="8" class="empty-state"><strong>No se pudieron cargar pagos</strong>${escapeHtml(friendlyError(error))}</td></tr>`
    showToast("No se pudo cargar", friendlyError(error), "error")
  }
}

function buildEntries() {
  const transferEntries = state.lines.map((line) => {
    const layout = byId(state.layouts, line.layout_id)
    const request = byId(state.requests, line.payment_request_id)
    const provider = byId(state.providers, line.proveedor_id || request?.proveedor_id)
    const company = byId(state.companies, line.company_id || request?.company_id)
    const receipt = receiptFor(line, request, layout)
    const paid = line.status === "paid" || layout?.status === "confirmed" || request?.status === "paid"
    return {
      id: `transfer:${line.id}`,
      type: "transfer",
      typeLabel: "Transferencia",
      name: provider?.alias || provider?.nombre_completo || line.beneficiary_name || "Proveedor",
      subtitle: request?.request_number || line.request_number || layout?.layout_number || "Sin solicitud",
      company: company?.legal_name || company?.name || line.company_name || "Sin empresa",
      amount: line.amount || request?.amount_requested || 0,
      date: receipt?.payment_date || layout?.updated_at || layout?.created_at || line.updated_at || line.created_at,
      status: paid ? "confirmed" : "pending_receipt",
      statusLabel: paid ? "Pago confirmado" : "Pendiente de confirmar",
      receipt,
      raw: { line, request, layout },
    }
  })

  const cashEntries = state.funds.map((fund) => {
    const request = byId(state.requests, fund.payment_request_id)
    const company = byId(state.companies, fund.company_id || request?.company_id)
    const reconciliation = state.reconciliations.find((item) => item.cash_fund_id === fund.id)
    const type = fund.delivery_method === "check" || request?.request_type === "check" ? "check" : "cash"
    return {
      id: `cash:${fund.id}`,
      type,
      typeLabel: type === "check" ? "Cheque" : "Efectivo",
      name: "Responsable de fondo",
      subtitle: request?.request_number || "Fondo sin solicitud visible",
      company: company?.legal_name || company?.name || "Sin empresa",
      amount: fund.assigned_amount || request?.amount_requested || 0,
      date: fund.delivered_at || fund.assignment_date || fund.created_at,
      status: cashStatusFor(fund, reconciliation),
      statusLabel: cashStatusLabel(cashStatusFor(fund, reconciliation)),
      receipt: reconciliation,
      raw: { fund, request, reconciliation },
    }
  })

  return [...transferEntries, ...cashEntries]
}

function renderStats() {
  setText("confirmedCount", state.entries.filter((entry) => entry.status === "confirmed" || entry.status === "closed").length)
  setText("pendingReceiptCount", state.entries.filter((entry) => entry.status === "pending_receipt").length)
  setText("transferCount", state.entries.filter((entry) => entry.type === "transfer").length)
  setText("cashCount", state.entries.filter((entry) => entry.type === "cash" || entry.type === "check").length)
  setText("reviewCount", state.entries.filter((entry) => entry.status === "review").length)
}

function renderTable() {
  const query = normalize(dom.searchInput.value)
  const type = dom.typeFilter.value
  const status = dom.statusFilter.value
  const rows = state.entries.filter((entry) => {
    const haystack = normalize([entry.name, entry.subtitle, entry.company, entry.typeLabel, entry.statusLabel].join(" "))
    return haystack.includes(query) &&
      (type === "all" || entry.type === type) &&
      (status === "all" || entry.status === status) &&
      matchesQuick(entry)
  })

  if (!rows.length) {
    dom.tableBody.innerHTML = `<tr><td colspan="8" class="empty-state"><strong>No hay pagos para este filtro.</strong>Cuando existan layouts confirmados o fondos, apareceran aqui.</td></tr>`
    return
  }

  dom.tableBody.innerHTML = rows.map((entry) => `
    <tr>
      <td>${typeBadge(entry.type)}</td>
      <td><strong>${escapeHtml(entry.name)}</strong><span class="muted-line">${escapeHtml(entry.subtitle)}</span></td>
      <td>${escapeHtml(entry.company)}</td>
      <td><strong>${formatCurrency(entry.amount)}</strong></td>
      <td>${escapeHtml(formatDate(entry.date))}</td>
      <td>${statusBadge(entry.status, entry.statusLabel)}</td>
      <td>${receiptCell(entry)}</td>
      <td><div class="actions"><button class="small-btn" type="button" data-action="detail" data-id="${escapeHtml(entry.id)}">Ver detalle</button></div></td>
    </tr>
  `).join("")
}

function matchesQuick(entry) {
  if (state.activeFilter === "all") return true
  if (state.activeFilter === "confirmed") return entry.status === "confirmed" || entry.status === "closed"
  if (state.activeFilter === "pending_receipt") return entry.status === "pending_receipt"
  if (state.activeFilter === "transfer") return entry.type === "transfer"
  if (state.activeFilter === "cash") return entry.type === "cash" || entry.type === "check"
  if (state.activeFilter === "review") return entry.status === "review"
  return true
}

function receiptCell(entry) {
  const path = receiptPath(entry.receipt)
  if (path) return `<button class="small-btn success" type="button" data-action="receipt" data-id="${escapeHtml(entry.id)}">Ver comprobante</button>`
  if (entry.type === "transfer") return `<span class="badge warn">Pendiente integracion</span>`
  if (entry.receipt) return `<span class="badge info">Comprobacion registrada</span>`
  return `<span class="badge warn">Sin comprobante</span>`
}

function openDetail(entryId) {
  const entry = state.entries.find((item) => item.id === entryId)
  if (!entry) return
  dom.detailTitle.textContent = entry.typeLabel
  dom.detailSubtitle.textContent = `${entry.subtitle} / ${entry.statusLabel}`
  dom.detailContent.innerHTML = `
    <div class="detail-grid">
      ${detailCard("Tipo", entry.typeLabel)}
      ${detailCard("Estatus", entry.statusLabel)}
      ${detailCard("Proveedor / responsable", entry.name)}
      ${detailCard("Empresa", entry.company)}
      ${detailCard("Monto", formatCurrency(entry.amount))}
      ${detailCard("Fecha", formatDate(entry.date))}
    </div>
    <div class="notice ${receiptPath(entry.receipt) ? "" : "warning"}">
      ${receiptPath(entry.receipt)
        ? `Existe una ruta de comprobante registrada: ${escapeHtml(receiptPath(entry.receipt))}`
        : entry.type === "transfer"
          ? "Carga de comprobante de transferencia pendiente de integracion."
          : "La comprobacion se opera desde el modulo Efectivo y comprobaciones."}
    </div>
    <div class="actions">
      ${entry.type === "transfer" ? `<a class="secondary-btn" href="./layouts.html">Ver layouts de pago</a>` : `<a class="secondary-btn" href="./efectivo.html">Ver efectivo y comprobaciones</a>`}
    </div>
  `
  dom.detailDialog.showModal()
}

function closeDetail() {
  if (dom.detailDialog.open) dom.detailDialog.close()
}

function openReceipt(entryId) {
  const entry = state.entries.find((item) => item.id === entryId)
  const path = receiptPath(entry?.receipt)
  if (!path) return showToast("Sin comprobante", "No hay archivo/ruta de comprobante para abrir.", "warning")
  if (/^https?:\/\//i.test(path)) window.open(path, "_blank", "noopener")
  else showToast("Comprobante registrado", path, "success")
}

function receiptFor(line, request, layout) {
  return state.receipts.find((receipt) =>
    receipt.payment_request_id === request?.id ||
    receipt.layout_id === layout?.id ||
    receipt.payment_layout_id === layout?.id ||
    receipt.payment_layout_line_id === line?.id ||
    receipt.layout_line_id === line?.id
  )
}

function receiptPath(receipt) {
  if (!receipt) return ""
  return receipt.storage_path || receipt.file_path || receipt.receipt_path || receipt.path || receipt.url || receipt.file_url || ""
}

function cashStatusFor(fund, reconciliation) {
  if (fund.status === "closed" || reconciliation?.status === "approved") return "closed"
  if (fund.status === "receipt_review" || reconciliation?.status === "submitted") return "review"
  if (["pending_receipt", "active", "blocked"].includes(fund.status)) return "pending_receipt"
  return fund.status || "pending_receipt"
}

function cashStatusLabel(status) {
  const labels = { closed: "Fondo cerrado", review: "Comprobacion en revision", pending_receipt: "Pendiente de comprobar", confirmed: "Confirmado" }
  return labels[status] || status
}

function typeBadge(type) {
  const labels = { transfer: "Transferencia", cash: "Efectivo", check: "Cheque" }
  const klass = type === "transfer" ? "info" : "warn"
  return `<span class="badge ${klass}">${labels[type] || type}</span>`
}

function statusBadge(status, label) {
  const klass = status === "closed" || status === "confirmed" ? "good" : status === "review" ? "info" : status === "pending_receipt" ? "warn" : ""
  return `<span class="badge ${klass}">${escapeHtml(label || status)}</span>`
}

function detailCard(label, value) {
  return `<div class="detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`
}

function byId(list, id) {
  return list.find((item) => item.id === id)
}

function setText(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function friendlyError(error) {
  const message = error?.message || String(error || "Error desconocido")
  if (message.includes("row-level security") || error?.code === "42501") return "No tienes permiso para consultar esta informacion."
  return message
}

function showToast(title, message, type = "success") {
  const node = document.createElement("div")
  node.className = `toast ${type}`
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
  document.getElementById("toastStack").appendChild(node)
  window.setTimeout(() => node.remove(), 5500)
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0))
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
