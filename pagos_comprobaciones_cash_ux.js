;(function pagosComprobacionesCashUx() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "pagos_comprobaciones.html") return

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!client) return

  const state = {
    requests: [],
    providers: [],
    companies: [],
    layouts: [],
    lines: [],
    funds: [],
    reconciliations: [],
    receipts: [],
    profiles: [],
    entries: [],
    activeFilter: "all",
  }

  const dom = {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  async function init() {
    cacheDom()
    bindEvents()
    window.setTimeout(loadData, 450)
  }

  function cacheDom() {
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
    dom.searchInput?.addEventListener("input", renderTable)
    dom.typeFilter?.addEventListener("change", () => { state.activeFilter = "all"; renderTable() })
    dom.statusFilter?.addEventListener("change", () => { state.activeFilter = "all"; renderTable() })
    dom.clearFilterBtn?.addEventListener("click", () => {
      state.activeFilter = "all"
      if (dom.searchInput) dom.searchInput.value = ""
      if (dom.typeFilter) dom.typeFilter.value = "all"
      if (dom.statusFilter) dom.statusFilter.value = "all"
      renderTable()
    })
    document.querySelectorAll("[data-filter]").forEach((card) => {
      card.addEventListener("click", () => {
        state.activeFilter = card.dataset.filter || "all"
        renderTable()
      })
    })
    dom.tableBody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cash-ux-detail]")
      if (button) openDetail(button.dataset.cashUxDetail)
    })
  }

  async function loadData() {
    if (!dom.tableBody) return
    dom.tableBody.innerHTML = `<tr><td colspan="10" class="empty-state"><strong>Cargando pagos...</strong></td></tr>`
    try {
      const [requests, providers, companies, layouts, lines, funds, reconciliations, receipts, profiles] = await Promise.all([
        client.from("payment_requests").select("*").order("created_at", { ascending: false }),
        client.from("proveedores").select("id,alias,nombre_completo,rfc"),
        client.from("companies").select("id,name,legal_name"),
        client.from("payment_layouts").select("*").order("created_at", { ascending: false }),
        client.from("payment_layout_lines").select("*").order("created_at", { ascending: false }),
        client.from("cash_funds").select("*").order("created_at", { ascending: false }),
        client.from("cash_reconciliations").select("*").order("created_at", { ascending: false }),
        client.from("payment_receipts").select("*").order("created_at", { ascending: false }),
        client.from("profiles").select("id,full_name,email,active").order("full_name", { ascending: true }),
      ])

      const failed = [requests, providers, companies, layouts, lines, funds, reconciliations].find((result) => result.error)
      if (failed) throw failed.error

      state.requests = requests.data || []
      state.providers = providers.data || []
      state.companies = companies.data || []
      state.layouts = layouts.data || []
      state.lines = lines.data || []
      state.funds = funds.data || []
      state.reconciliations = reconciliations.data || []
      state.receipts = receipts.error ? [] : (receipts.data || [])
      state.profiles = activeRows(profiles.data || [])
      state.entries = buildEntries()
      renderStats()
      renderTable()
    } catch (error) {
      dom.tableBody.innerHTML = `<tr><td colspan="10" class="empty-state"><strong>No se pudieron cargar pagos</strong>${escapeHtml(friendlyError(error))}</td></tr>`
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
        responsible: "No aplica",
        subtitle: request?.request_number || line.request_number || layout?.layout_number || "Sin solicitud",
        company: company?.legal_name || company?.name || line.company_name || "Sin empresa",
        amount: line.amount || request?.amount_requested || 0,
        date: receipt?.payment_date || layout?.updated_at || layout?.created_at || line.updated_at || line.created_at,
        status: paid ? "confirmed" : "pending_confirmation",
        statusLabel: paid ? "Pago confirmado" : "Transferencia pendiente de confirmacion bancaria",
        receipt,
        raw: { line, request, layout },
      }
    })

    const cashPendingDeliveryEntries = state.requests
      .filter((request) => isCashOrCheck(request) && request.status === "approved" && !fundForRequest(request.id))
      .map((request) => {
        const provider = byId(state.providers, request.proveedor_id)
        const company = byId(state.companies, request.company_id)
        const draft = cashMetadataForRequest(request)
        const type = request.request_type === "check" ? "check" : "cash"
        return {
          id: `request:${request.id}`,
          type,
          typeLabel: type === "check" ? "Cheque" : "Efectivo",
          name: provider?.alias || provider?.nombre_completo || "Proveedor",
          responsible: profileName(draft?.responsible_profile_id),
          subtitle: request.request_number || "Solicitud aprobada",
          company: company?.legal_name || company?.name || "Sin empresa",
          amount: request.amount_requested || 0,
          date: draft?.due_date || request.updated_at || request.created_at,
          status: "pending_delivery",
          statusLabel: "Aprobada sin entrega",
          receipt: null,
          raw: { request, draft },
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
        name: providerName(request?.proveedor_id),
        responsible: profileName(fund.responsible_profile_id),
        subtitle: request?.request_number || "Fondo sin solicitud visible",
        company: company?.legal_name || company?.name || "Sin empresa",
        amount: fund.assigned_amount || request?.amount_requested || 0,
        date: fund.delivered_at || fund.assignment_date || fund.due_date || fund.created_at,
        status: cashStatusFor(fund, reconciliation),
        statusLabel: cashStatusLabel(cashStatusFor(fund, reconciliation)),
        receipt: reconciliation,
        raw: { fund, request, reconciliation },
      }
    })

    return [...transferEntries, ...cashPendingDeliveryEntries, ...cashEntries]
  }

  function renderStats() {
    setText("confirmedCount", state.entries.filter((entry) => entry.status === "confirmed" || entry.status === "closed").length)
    setText("pendingConfirmationCount", state.entries.filter((entry) => entry.status === "pending_confirmation").length)
    setText("pendingDeliveryCount", state.entries.filter((entry) => entry.status === "pending_delivery").length)
    setText("pendingReceiptCount", state.entries.filter((entry) => entry.status === "pending_reconciliation" || transferNeedsReceipt(entry)).length)
    setText("reviewCount", state.entries.filter((entry) => entry.status === "review").length)
  }

  function renderTable() {
    const query = normalize(dom.searchInput?.value || "")
    const type = dom.typeFilter?.value || "all"
    const status = dom.statusFilter?.value || "all"
    const rows = state.entries.filter((entry) => {
      const haystack = normalize([entry.name, entry.responsible, entry.subtitle, entry.company, entry.typeLabel, entry.statusLabel].join(" "))
      return haystack.includes(query) &&
        (type === "all" || entry.type === type) &&
        (status === "all" || entry.status === status) &&
        matchesQuick(entry)
    })

    if (!rows.length) {
      dom.tableBody.innerHTML = `<tr><td colspan="10" class="empty-state"><strong>No hay pagos para este filtro.</strong>Las transferencias, entregas de efectivo/cheque y comprobaciones apareceran aqui segun su etapa.</td></tr>`
      return
    }

    dom.tableBody.innerHTML = rows.map((entry) => `
      <tr>
        <td>${typeBadge(entry.type)}</td>
        <td><strong>${escapeHtml(entry.subtitle)}</strong><span class="muted-line">${escapeHtml(entry.typeLabel)}</span></td>
        <td><strong>${escapeHtml(entry.name)}</strong></td>
        <td>${escapeHtml(entry.responsible || "No aplica")}</td>
        <td>${escapeHtml(entry.company)}</td>
        <td><strong>${formatCurrency(entry.amount)}</strong></td>
        <td>${escapeHtml(formatDate(entry.date))}</td>
        <td>${statusBadge(entry.status, entry.statusLabel)}</td>
        <td>${receiptCell(entry)}</td>
        <td><div class="actions">${rowActions(entry)}</div></td>
      </tr>
    `).join("")
  }

  function matchesQuick(entry) {
    if (state.activeFilter === "all") return true
    if (state.activeFilter === "confirmed") return entry.status === "confirmed" || entry.status === "closed"
    if (state.activeFilter === "pending_confirmation") return entry.status === "pending_confirmation"
    if (state.activeFilter === "pending_delivery") return entry.status === "pending_delivery"
    if (state.activeFilter === "pending_receipt") return entry.status === "pending_reconciliation" || transferNeedsReceipt(entry)
    if (state.activeFilter === "review") return entry.status === "review"
    return true
  }

  function receiptCell(entry) {
    const path = receiptPath(entry.receipt)
    if (path) return `<button class="small-btn success" type="button">Ver comprobante</button>`
    if (entry.status === "pending_delivery") return `<span class="badge">No aplica hasta entrega</span>`
    if (entry.type === "transfer" && entry.status === "pending_confirmation") return `<span class="badge warn">Pendiente confirmacion bancaria</span>`
    if (entry.type === "transfer") return `<span class="badge warn">Comprobante pendiente integracion</span>`
    if (entry.status === "review") return `<span class="badge info">Comprobacion en revision</span>`
    if (entry.status === "closed") return `<span class="badge good">Comprobacion cerrada</span>`
    return `<span class="badge warn">Pendiente de cargar</span>`
  }

  function rowActions(entry) {
    const actions = [`<button class="small-btn" type="button" data-cash-ux-detail="${escapeHtml(entry.id)}">Ver detalle</button>`]
    const requestId = entry.raw?.request?.id
    if (entry.status === "pending_delivery" && requestId) {
      actions.push(`<a class="small-btn warning" href="./solicitudes.html?request_id=${encodeURIComponent(requestId)}">Crear fondo</a>`)
    } else if ((entry.type === "cash" || entry.type === "check") && entry.raw?.fund?.id) {
      actions.push(`<a class="small-btn" href="./efectivo.html?fund_id=${encodeURIComponent(entry.raw.fund.id)}">Ver efectivo</a>`)
    } else if (entry.type === "transfer") {
      actions.push(`<a class="small-btn" href="./layouts.html">Ver layout</a>`)
    }
    return actions.join("")
  }

  function openDetail(entryId) {
    const entry = state.entries.find((item) => item.id === entryId)
    if (!entry || !dom.detailDialog) return
    dom.detailTitle.textContent = entry.typeLabel
    dom.detailSubtitle.textContent = `${entry.subtitle} / ${entry.statusLabel}`
    dom.detailContent.innerHTML = `
      <div class="detail-grid">
        ${detailCard("Tipo", entry.typeLabel)}
        ${detailCard("Estatus", entry.statusLabel)}
        ${detailCard("Solicitud / folio", entry.subtitle)}
        ${detailCard("Proveedor", entry.name)}
        ${detailCard("Responsable del gasto", entry.responsible || "No aplica")}
        ${detailCard("Empresa", entry.company)}
        ${detailCard("Monto", formatCurrency(entry.amount))}
        ${detailCard("Fecha", formatDate(entry.date))}
      </div>
      <div class="notice warning">${paymentOperationMessage(entry)}</div>
      <div class="actions">${detailActions(entry)}</div>
    `
    dom.detailDialog.showModal()
  }

  function paymentOperationMessage(entry) {
    if (entry.status === "pending_delivery") return "Solicitud aprobada, pendiente de entrega. Registra la entrega desde Solicitudes para crear el fondo."
    if (entry.type === "transfer" && entry.status === "pending_confirmation") return "Transferencia pendiente de confirmacion bancaria."
    if (entry.type === "transfer") return "Comprobante de transferencia pendiente de integracion."
    if (entry.status === "review") return "La comprobacion fue enviada y esta pendiente de revision."
    if (entry.status === "closed") return "Fondo cerrado. La comprobacion fue aprobada."
    return "Fondo entregado. El responsable debe comprobar con tickets o comprobantes."
  }

  function detailActions(entry) {
    const requestId = entry.raw?.request?.id
    if (entry.status === "pending_delivery" && requestId) return `<a class="secondary-btn" href="./solicitudes.html?request_id=${encodeURIComponent(requestId)}">Ir a solicitud / crear fondo</a>`
    if ((entry.type === "cash" || entry.type === "check") && entry.raw?.fund?.id) return `<a class="secondary-btn" href="./efectivo.html?fund_id=${encodeURIComponent(entry.raw.fund.id)}">Ver efectivo y comprobaciones</a>`
    if (entry.type === "transfer") return `<a class="secondary-btn" href="./layouts.html">Ver layouts de pago</a>`
    return ""
  }

  function cashStatusFor(fund, reconciliation) {
    if (fund.status === "closed" || reconciliation?.status === "approved") return "closed"
    if (fund.status === "receipt_review" || reconciliation?.status === "submitted") return "review"
    if (["pending_receipt", "active", "blocked"].includes(fund.status)) return "pending_reconciliation"
    return fund.status || "pending_reconciliation"
  }

  function cashStatusLabel(status) {
    const labels = {
      closed: "Fondo cerrado",
      review: "Comprobacion en revision",
      pending_reconciliation: "Pendiente de comprobar",
      pending_delivery: "Aprobada sin entrega",
      pending_confirmation: "Pendiente de confirmar",
      confirmed: "Confirmado",
    }
    return labels[status] || status
  }

  function isCashOrCheck(request) {
    return request?.request_type === "cash" || request?.request_type === "check"
  }

  function fundForRequest(requestId) {
    return state.funds.find((fund) => fund.payment_request_id === requestId) || null
  }

  function cashMetadataForRequest(request) {
    if (!request?.id) return null
    try {
      const local = JSON.parse(localStorage.getItem(`flux-cash-request-${request.id}`) || "null")
      if (local) return local
    } catch (_) {}
    return cashMetadataFromNotes(request.notes)
  }

  function cashMetadataFromNotes(notes) {
    const match = String(notes || "").match(/\[Cash fund metadata:\s*([^\]]+)\]/)
    if (!match) return null
    const metadata = {}
    match[1].split(";").forEach((part) => {
      const [key, ...rest] = part.split("=")
      if (!key) return
      metadata[key.trim()] = rest.join("=").trim() || null
    })
    return {
      responsible_profile_id: metadata.responsible_profile_id || null,
      due_date: metadata.due_date || null,
      delivery_method: metadata.delivery_method || null,
    }
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

  function transferNeedsReceipt(entry) {
    return entry.type === "transfer" && entry.status === "confirmed" && !receiptPath(entry.receipt)
  }

  function typeBadge(type) {
    const labels = { transfer: "Transferencia", cash: "Efectivo", check: "Cheque" }
    const klass = type === "transfer" ? "info" : "warn"
    return `<span class="badge ${klass}">${labels[type] || type}</span>`
  }

  function statusBadge(status, label) {
    const klass = status === "closed" || status === "confirmed" ? "good" : status === "review" ? "info" : ["pending_reconciliation", "pending_delivery", "pending_confirmation"].includes(status) ? "warn" : ""
    return `<span class="badge ${klass}">${escapeHtml(label || status)}</span>`
  }

  function detailCard(label, value) {
    return `<div class="detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`
  }

  function profileName(profileId) {
    if (!profileId) return "Sin responsable"
    const profile = byId(state.profiles, profileId)
    return profile?.full_name || profile?.email || "Sin responsable"
  }

  function providerName(providerId) {
    const provider = byId(state.providers, providerId)
    return provider?.alias || provider?.nombre_completo || "Proveedor"
  }

  function activeRows(rows) {
    return rows.filter((row) => row.active !== false && row.activo !== false && row.is_active !== false)
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
})()
