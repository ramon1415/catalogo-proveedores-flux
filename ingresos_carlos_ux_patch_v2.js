;(function ingresosCarlosUxPatch() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "ingresos.html") return

  const params = new URLSearchParams(window.location.search)
  const requestedTab = (params.get("tab") || "income").toLowerCase()
  const isIncidentMode = ["incidents", "incidencias", "visitas"].includes(requestedTab)
  const balanceFilters = { scope: "month", period: "", party: "", type: "all" }
  const quotasFilters = { search: "", status: "todos", period: "todos" }
  const incidentFilters = { search: "", status: "todos", receiver: "todos", period: "" }
  let fallbackData = null
  let fallbackLoading = false

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    installStyles()
    document.addEventListener("flux:income-data-ready", () => renderCustomViews())
    document.addEventListener("click", handleDocumentClick)
    loadFallbackData()
    window.setTimeout(applyMode, 60)
    window.setTimeout(applyMode, 350)
    window.setTimeout(applyMode, 850)
  }

  function applyMode() {
    normalizeCopy()
    if (isIncidentMode) {
      applyIncidentMode()
    } else {
      applyIncomeMode()
    }
    renderCustomViews()
    adjustIncidentFormCopy()
  }

  function normalizeCopy() {
    setText("[data-tab='incidents']", "Incidencias")
    replaceRepeatedText(document.body, /(visitas\/)+incidencias/g, "incidencias")
    replaceRepeatedText(document.body, /(Visitas\/)+Incidencias/g, "Incidencias")
  }

  function applyIncomeMode() {
    document.title = "Ingresos | Flux"
    setText(".brand-subtitle", "Ingresos")
    setText(".topbar-kicker", "CUOTAS, COBROS Y BALANCE")
    setText(".page-header h1", "Ingresos")
    setText(".page-header p", "Controla cuotas de mantenimiento, periodos de cobro, pagos e historico de ingresos.")
    setText("[data-tab='dashboard']", "Balance")
    setText("[data-tab='payments']", "Cuotas")
    showTabButton("dashboard")
    showTabButton("payments")
    hideTabButton("members")
    hideTabButton("periods")
    hideTabButton("incidents")
    hideTabButton("invoices")
    ensureNotice("incomeModeNotice", "Ingresos queda enfocado en balance y cuotas. Socios y cuentas origen viven en Configuracion; Incidencias tiene su propia entrada en el menu.")
    const targetTab = ["cuotas", "payments"].includes(requestedTab) ? "payments" : "dashboard"
    clickTab(targetTab)
  }

  function applyIncidentMode() {
    document.title = "Incidencias | Flux"
    setText(".brand-subtitle", "Incidencias")
    setText(".topbar-kicker", "VISITAS, INCIDENCIAS Y CARGOS RECUPERABLES")
    setText(".page-header h1", "Incidencias")
    setText(".page-header p", "Registra visitas, incidencias y cargos recuperables. La relacion formal con solicitudes de pago queda preparada para la siguiente tanda backend.")
    hideTabButton("dashboard")
    hideTabButton("members")
    hideTabButton("periods")
    hideTabButton("payments")
    showTabButton("incidents")
    hideTabButton("invoices")
    ensureNotice("incidentModeNotice", "Una incidencia representa una visita o evento que agrupa solicitudes de pago. Hoy se captura el cargo recuperable; la vinculacion multiple queda pendiente de backend/SQL.")
    clickTab("incidents")
  }

  function renderCustomViews() {
    const data = getData()
    if (isIncidentMode) {
      renderIncidentsExperience(data)
    } else {
      renderBalanceExperience(data)
      renderQuotasExperience(data)
    }
  }

  function renderBalanceExperience(data) {
    const dashboardTab = document.getElementById("dashboardTab")
    if (!dashboardTab) return
    const rows = buildBalanceRows(data)
    ensureDefaultPeriod(rows)
    const filteredRows = filterBalanceRows(rows)
    const totals = filteredRows.reduce((acc, row) => {
      acc.expected += numberValue(row.expected)
      acc.collected += numberValue(row.collected)
      acc.pending += Math.max(numberValue(row.expected) - numberValue(row.collected), 0)
      acc.pendingInvoices += row.invoiceStatus === "issued" ? 1 : 0
      return acc
    }, { expected: 0, collected: 0, pending: 0, pendingInvoices: 0 })
    const progress = totals.expected > 0 ? Math.min((totals.collected / totals.expected) * 100, 999) : 0

    dashboardTab.innerHTML = `
      <div class="table-card flux-balance-card">
        <div class="panel-header">
          <div><h2>Balance</h2><p>Vista de analisis. No captura cuotas, incidencias, facturas ni pagos.</p></div>
          <button type="button" class="secondary-btn" data-income-export>Exportar</button>
        </div>
        <div class="toolbar compact">
          <select id="balanceScopeFilter"><option value="month">Periodo: Mes</option><option value="quarter">Periodo: Trimestre</option><option value="year">Periodo: Ano</option></select>
          <input id="balancePeriodFilter" type="month" value="${escapeHtml(balanceFilters.period)}">
          <input id="balancePartyFilter" type="search" placeholder="Socio o externo" value="${escapeHtml(balanceFilters.party)}">
          <select id="balanceTypeFilter"><option value="all">Tipo: Cuotas e incidencias</option><option value="fees">Solo cuotas</option><option value="incidents">Solo incidencias</option></select>
        </div>
        <div class="flux-progress-wrap"><div class="flux-progress-head"><span>Cobrado vs esperado</span><strong>${formatPercent(progress)}</strong></div><div class="flux-progress"><span style="width:${Math.min(progress, 100)}%"></span></div></div>
        <div class="stats-grid compact-stats">
          <div class="stat-card"><p>Monto esperado</p><strong>${formatCurrency(totals.expected)}</strong></div>
          <div class="stat-card collected"><p>Monto cobrado</p><strong>${formatCurrency(totals.collected)}</strong></div>
          <div class="stat-card amount"><p>Monto pendiente</p><strong>${formatCurrency(totals.pending)}</strong></div>
          <div class="stat-card paid"><p>Avance</p><strong>${formatPercent(progress)}</strong></div>
          <div class="stat-card"><p>Facturas pendientes</p><strong>${totals.pendingInvoices}</strong></div>
        </div>
        <div class="notice neutral">La exportacion se conectara en la siguiente fase. Por ahora esta vista es solo lectura y usa los datos internos actuales.</div>
        <div class="table-wrapper"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Socio / externo</th><th>Concepto</th><th>Monto esperado</th><th>Monto cobrado</th><th>Estado</th><th>Factura</th></tr></thead><tbody>${filteredRows.length ? filteredRows.map(renderBalanceRow).join("") : emptyRow(8, "No hay movimientos para este filtro.")}</tbody></table></div>
      </div>`

    const scope = document.getElementById("balanceScopeFilter")
    const period = document.getElementById("balancePeriodFilter")
    const party = document.getElementById("balancePartyFilter")
    const type = document.getElementById("balanceTypeFilter")
    if (scope) scope.value = balanceFilters.scope
    if (type) type.value = balanceFilters.type
    scope?.addEventListener("change", () => { balanceFilters.scope = scope.value; renderBalanceExperience(getData()) })
    period?.addEventListener("change", () => { balanceFilters.period = period.value; renderBalanceExperience(getData()) })
    party?.addEventListener("input", () => { balanceFilters.party = party.value; renderBalanceExperience(getData()) })
    type?.addEventListener("change", () => { balanceFilters.type = type.value; renderBalanceExperience(getData()) })
  }

  function renderQuotasExperience(data) {
    const paymentsTab = document.getElementById("paymentsTab")
    if (!paymentsTab) return
    const rows = data.charges.filter((charge) => {
      const member = byId(data.members, charge.member_id)
      return member && member.active !== false
    }).filter((charge) => {
      const member = byId(data.members, charge.member_id)
      const period = byId(data.periods, charge.billing_period_id)
      const haystack = normalize([member?.full_name, member?.rfc, period?.name, period?.year].join(" "))
      const searchOk = !quotasFilters.search || haystack.includes(normalize(quotasFilters.search))
      const statusOk = quotasFilters.status === "todos" || charge.status === quotasFilters.status
      const periodOk = quotasFilters.period === "todos" || charge.billing_period_id === quotasFilters.period
      return searchOk && statusOk && periodOk
    })

    paymentsTab.innerHTML = `
      <div class="table-card">
        <div class="panel-header"><div><h2>Cuotas</h2><p>Socios con cuota generada. Monto y periodicidad se administran desde Configuracion > Socios.</p></div><a class="secondary-btn" href="./configuracion.html?tab=members">Configurar socios</a></div>
        <div class="notice neutral">Esta vista no captura monto ni periodicidad. Aqui solo se factura, se registra pago y se consulta historial.</div>
        <div class="toolbar compact">
          <input id="quotaSearchFilter" type="search" placeholder="Buscar socio, RFC o periodo" value="${escapeHtml(quotasFilters.search)}">
          <select id="quotaStatusFilter"><option value="todos">Estado: Todos</option><option value="pending">Pendiente</option><option value="partial">Facturado/parcial</option><option value="paid">Pagado</option><option value="overdue">Vencido</option></select>
          <select id="quotaPeriodFilter"><option value="todos">Periodo actual: Todos</option>${data.periods.map((period) => `<option value="${escapeHtml(period.id)}">${escapeHtml(periodLabel(period))}</option>`).join("")}</select>
        </div>
        <div class="table-wrapper"><table><thead><tr><th>Nombre del socio</th><th>Periodicidad</th><th>Monto</th><th>Periodo actual</th><th>Estado</th><th>Factura</th><th>Acciones</th></tr></thead><tbody id="paymentsTableBody">${rows.length ? rows.map((charge) => renderQuotaRow(charge, data)).join("") : emptyRow(7, "No hay cuotas para este filtro.")}</tbody></table></div>
      </div>`

    const search = document.getElementById("quotaSearchFilter")
    const status = document.getElementById("quotaStatusFilter")
    const period = document.getElementById("quotaPeriodFilter")
    if (status) status.value = quotasFilters.status
    if (period) period.value = quotasFilters.period
    search?.addEventListener("input", () => { quotasFilters.search = search.value; renderQuotasExperience(getData()) })
    status?.addEventListener("change", () => { quotasFilters.status = status.value; renderQuotasExperience(getData()) })
    period?.addEventListener("change", () => { quotasFilters.period = period.value; renderQuotasExperience(getData()) })
  }

  function renderIncidentsExperience(data) {
    const incidentsTab = document.getElementById("incidentsTab")
    if (!incidentsTab) return
    const rows = data.incidents.slice().sort((a, b) => String(b.incident_date || "").localeCompare(String(a.incident_date || ""))).filter((incident) => {
      const receiver = incidentReceiverName(incident, data)
      const haystack = normalize([receiver, incident.external_rfc, incident.description, memberName(incident.referred_by_member_id, data)].join(" "))
      const searchOk = !incidentFilters.search || haystack.includes(normalize(incidentFilters.search))
      const statusOk = incidentFilters.status === "todos" || incident.status === incidentFilters.status
      const receiverOk = incidentFilters.receiver === "todos" || incidentReceiverType(incident) === incidentFilters.receiver
      const periodOk = !incidentFilters.period || String(incident.incident_date || "").slice(0, 7) === incidentFilters.period
      return searchOk && statusOk && receiverOk && periodOk
    })

    incidentsTab.innerHTML = `
      <div class="table-card">
        <div class="panel-header"><div><h2>Incidencias</h2><p>Visitas o eventos que acumulan cargos recuperables. La vinculacion real con solicitudes queda pendiente de backend.</p></div><button type="button" class="primary-btn" data-open-incident-ui>Nueva incidencia</button></div>
        <div class="flux-stepper"><span>Apertura</span><span>Solicitudes vinculadas</span><span>Factura</span><span>Pago / cierre</span></div>
        <div class="notice neutral">El monto total usa el monto tecnico actual. Cuando exista relacion con solicitudes, se calculara como suma de solicitudes vinculadas.</div>
        <div class="toolbar"><input id="incidentUxSearch" type="search" placeholder="Buscar socio, externo o descripcion" value="${escapeHtml(incidentFilters.search)}"><select id="incidentUxStatus"><option value="todos">Facturacion/cobro: Todos</option><option value="open">Abierta</option><option value="invoiced">Facturada</option><option value="paid">Pagada</option><option value="cancelled">Cancelada</option></select><select id="incidentUxReceiver"><option value="todos">Receptor: Todos</option><option value="member">Socio</option><option value="external">Externo</option></select><input id="incidentUxPeriod" type="month" value="${escapeHtml(incidentFilters.period)}"></div>
        <div class="table-wrapper"><table><thead><tr><th>Socio o externo</th><th>Fecha visita</th><th>Inicio / fin</th><th>Descripcion</th><th>Monto total</th><th>Facturacion</th><th>Cobro</th><th>Acciones</th></tr></thead><tbody id="incidentsTableBody">${rows.length ? rows.map((incident) => renderIncidentRow(incident, data)).join("") : emptyRow(8, "No hay incidencias para este filtro.")}</tbody></table></div>
      </div>`
    ensureIncidentDetailDialog()
    const status = document.getElementById("incidentUxStatus")
    const receiver = document.getElementById("incidentUxReceiver")
    const search = document.getElementById("incidentUxSearch")
    const period = document.getElementById("incidentUxPeriod")
    if (status) status.value = incidentFilters.status
    if (receiver) receiver.value = incidentFilters.receiver
    status?.addEventListener("change", () => { incidentFilters.status = status.value; renderIncidentsExperience(getData()) })
    receiver?.addEventListener("change", () => { incidentFilters.receiver = receiver.value; renderIncidentsExperience(getData()) })
    search?.addEventListener("input", () => { incidentFilters.search = search.value; renderIncidentsExperience(getData()) })
    period?.addEventListener("change", () => { incidentFilters.period = period.value; renderIncidentsExperience(getData()) })
  }

  function buildBalanceRows(data) {
    const feeRows = data.charges.map((charge) => {
      const period = byId(data.periods, charge.billing_period_id)
      const member = byId(data.members, charge.member_id)
      const invoice = byId(data.invoices, charge.invoice_id)
      return { id: charge.id, date: period?.cutoff_date || charge.created_at, type: "cuota", typeLabel: "Cuota", party: member?.full_name || "Socio no encontrado", concept: periodLabel(period), expected: charge.expected_amount, collected: charge.paid_amount, status: charge.status, statusLabel: chargeStatusLabel(charge.status), invoiceStatus: invoice?.status || "", invoiceLabel: invoice ? invoiceStatusLabel(invoice.status) : "Sin factura" }
    })
    const incidentRows = data.incidents.map((incident) => {
      const invoice = byId(data.invoices, incident.invoice_id)
      const collected = invoice?.status === "paid" || incident.status === "paid" ? numberValue(incident.amount) : 0
      return { id: incident.id, date: incident.incident_date, type: "incidencia", typeLabel: "Incidencia", party: incidentReceiverName(incident, data), concept: incident.description || "Incidencia sin descripcion", expected: incident.amount, collected, status: incident.status, statusLabel: incidentStatusLabel(incident.status), invoiceStatus: invoice?.status || "", invoiceLabel: invoice ? invoiceStatusLabel(invoice.status) : "Sin factura" }
    })
    return feeRows.concat(incidentRows).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
  }

  function filterBalanceRows(rows) {
    return rows.filter((row) => {
      const periodOk = matchesPeriod(row.date, balanceFilters.period, balanceFilters.scope)
      const partyOk = !balanceFilters.party || normalize(row.party).includes(normalize(balanceFilters.party))
      const typeOk = balanceFilters.type === "all" || (balanceFilters.type === "fees" && row.type === "cuota") || (balanceFilters.type === "incidents" && row.type === "incidencia")
      return periodOk && partyOk && typeOk
    })
  }

  function renderBalanceRow(row) {
    return `<tr><td>${formatDate(row.date)}</td><td><span class="badge badge-neutral">${escapeHtml(row.typeLabel)}</span></td><td><strong>${escapeHtml(row.party)}</strong></td><td>${escapeHtml(row.concept)}</td><td>${formatCurrency(row.expected)}</td><td>${formatCurrency(row.collected)}</td><td>${escapeHtml(row.statusLabel)}</td><td>${escapeHtml(row.invoiceLabel)}</td></tr>`
  }

  function renderQuotaRow(charge, data) {
    const member = byId(data.members, charge.member_id)
    const period = byId(data.periods, charge.billing_period_id)
    const invoice = byId(data.invoices, charge.invoice_id)
    const canInvoice = !charge.invoice_id && charge.status !== "cancelled"
    const canPay = ["pending", "partial", "overdue"].includes(charge.status)
    return `<tr><td><strong>${escapeHtml(member?.full_name || "Socio no encontrado")}</strong><span class="muted-line">${escapeHtml(member?.rfc || "Sin RFC")}</span></td><td>${escapeHtml(member?.periodicity || member?.billing_frequency || "Pendiente config")}</td><td>${formatCurrency(charge.expected_amount)}</td><td>${escapeHtml(periodLabel(period))}</td><td>${escapeHtml(chargeStatusLabel(charge.status))}</td><td>${invoice ? escapeHtml(invoiceStatusLabel(invoice.status)) : "Sin factura"}</td><td><div class="actions"><button class="small-btn info" data-action="invoice-charge" data-id="${escapeHtml(charge.id)}" ${canInvoice ? "" : "disabled"}>Emitir factura</button><button class="small-btn success" data-action="pay" data-id="${escapeHtml(charge.id)}" ${canPay ? "" : "disabled"}>Registrar pago</button><button class="small-btn" data-action="view-payments" data-id="${escapeHtml(charge.id)}">Ver historial</button></div></td></tr>`
  }

  function renderIncidentRow(incident, data) {
    const invoice = byId(data.invoices, incident.invoice_id)
    const canInvoice = !incident.invoice_id && incident.status !== "cancelled"
    const canPay = invoice?.status === "issued"
    return `<tr><td><strong>${escapeHtml(incidentReceiverName(incident, data))}</strong><span class="muted-line">${escapeHtml(incident.external_rfc || memberById(incident.member_id, data)?.rfc || "Sin RFC")}</span></td><td>${formatDate(incident.incident_date)}</td><td>${formatDate(incident.start_date || incident.incident_date)} / ${formatDate(incident.end_date) || "No capturada"}</td><td>${escapeHtml(incident.description || "Sin descripcion")}</td><td>${formatCurrency(incident.amount)}<span class="muted-line">Monto tecnico actual</span></td><td>${invoice ? escapeHtml(invoiceStatusLabel(invoice.status)) : "Sin factura"}</td><td>${incident.status === "paid" ? "Pagada" : canPay ? "Pendiente" : "Sin pago"}</td><td><div class="actions"><button class="small-btn" data-action="incident-detail" data-id="${escapeHtml(incident.id)}">Ver detalle</button><button class="small-btn info" data-action="invoice-incident" data-id="${escapeHtml(incident.id)}" ${canInvoice ? "" : "disabled"}>Emitir factura</button><button class="small-btn success" data-action="pay-invoice" data-id="${escapeHtml(invoice?.id || "")}" ${canPay ? "" : "disabled"}>Registrar pago</button></div></td></tr>`
  }

  function handleDocumentClick(event) {
    const exportButton = event.target.closest("[data-income-export]")
    if (exportButton) return toast("Exportacion pendiente", "La exportacion se conectara en la siguiente fase.")
    const incidentOpen = event.target.closest("[data-open-incident-ui]")
    if (incidentOpen) { if (typeof window.openIncidentModal === "function") window.openIncidentModal(); return }
    const button = event.target.closest("button[data-action]")
    if (!button || button.disabled) return
    if (button.dataset.action === "pay" && typeof window.openPaymentModal === "function") window.openPaymentModal(button.dataset.id)
    if (button.dataset.action === "view-payments" && typeof window.showPaymentHistory === "function") window.showPaymentHistory(button.dataset.id)
    if (button.dataset.action === "invoice-charge" && typeof window.openInvoiceModal === "function") window.openInvoiceModal("maintenance_fee", button.dataset.id)
    if (button.dataset.action === "invoice-incident" && typeof window.openInvoiceModal === "function") window.openInvoiceModal("incident", button.dataset.id)
    if (button.dataset.action === "pay-invoice" && typeof window.openInvoicePayModal === "function") window.openInvoicePayModal(button.dataset.id)
    if (button.dataset.action === "incident-detail") openIncidentDetail(button.dataset.id)
  }

  function openIncidentDetail(incidentId) {
    const data = getData()
    const incident = byId(data.incidents, incidentId)
    if (!incident) return
    const invoice = byId(data.invoices, incident.invoice_id)
    ensureIncidentDetailDialog()
    const dialog = document.getElementById("incidentDetailDialog")
    const body = document.getElementById("incidentDetailBody")
    body.innerHTML = `<div class="flux-stepper"><span>Apertura</span><span>Solicitudes vinculadas</span><span>Factura</span><span>Pago / cierre</span></div><div class="detail-grid"><div class="detail-card"><span>Receptor</span><strong>${escapeHtml(incidentReceiverName(incident, data))}</strong><small>${escapeHtml(incidentReceiverType(incident) === "member" ? "Socio" : "Externo")}</small></div><div class="detail-card"><span>RFC</span><strong>${escapeHtml(incident.external_rfc || memberById(incident.member_id, data)?.rfc || "Sin RFC")}</strong></div><div class="detail-card"><span>Fecha visita</span><strong>${formatDate(incident.incident_date)}</strong></div><div class="detail-card"><span>Estado</span><strong>${escapeHtml(incidentStatusLabel(incident.status))}</strong></div></div><div class="table-card inner-card"><div class="panel-header"><div><h2>Datos de la incidencia</h2><p>${escapeHtml(incident.description || "Sin descripcion")}</p></div></div><div class="summary-list"><div class="summary-row"><span>Socio referidor</span><strong>${escapeHtml(memberName(incident.referred_by_member_id, data) || "Sin referidor")}</strong></div><div class="summary-row"><span>Notas</span><strong>${escapeHtml(incident.notes || "Sin notas")}</strong></div></div></div><div class="notice neutral">Solicitudes de pago vinculadas: pendiente de soporte backend. Aqui se mostrara folio, proveedor, monto y estado cuando exista la relacion formal.</div><div class="detail-grid"><div class="detail-card"><span>Total solicitudes vinculadas</span><strong>0</strong></div><div class="detail-card"><span>Monto facturado</span><strong>${formatCurrency(invoice?.amount || 0)}</strong></div><div class="detail-card"><span>Monto cobrado</span><strong>${incident.status === "paid" ? formatCurrency(incident.amount) : formatCurrency(0)}</strong></div><div class="detail-card"><span>Saldo pendiente</span><strong>${incident.status === "paid" ? formatCurrency(0) : formatCurrency(incident.amount)}</strong></div></div><div class="table-card inner-card"><div class="panel-header"><div><h2>Factura y pagos</h2><p>${invoice ? escapeHtml(invoice.series_folio || invoice.fiscal_uuid || "Factura registrada") : "Sin factura emitida"}</p></div></div><div class="summary-list"><div class="summary-row"><span>Factura</span><strong>${invoice ? escapeHtml(invoiceStatusLabel(invoice.status)) : "Pendiente"}</strong></div><div class="summary-row"><span>Fecha factura</span><strong>${formatDate(invoice?.issue_date) || "Sin fecha"}</strong></div><div class="summary-row"><span>Fecha pago</span><strong>${formatDate(invoice?.payment_date) || "Sin pago"}</strong></div></div></div>`
    dialog.showModal()
  }

  function ensureIncidentDetailDialog() {
    if (document.getElementById("incidentDetailDialog")) return
    document.body.insertAdjacentHTML("beforeend", `<dialog id="incidentDetailDialog"><div class="modal-content"><div class="modal-header"><div><h2>Detalle de incidencia</h2><p>Estado de cuenta operativo de la visita/incidencia.</p></div><button type="button" class="icon-btn" data-close-incident-detail>x</button></div><div id="incidentDetailBody"></div><div class="modal-actions"><button type="button" class="secondary-btn" data-close-incident-detail>Cerrar</button></div></div></dialog>`)
    document.querySelectorAll("[data-close-incident-detail]").forEach((button) => button.addEventListener("click", () => document.getElementById("incidentDetailDialog")?.close()))
  }

  function adjustIncidentFormCopy() {
    const amount = document.getElementById("incidentAmount")
    const label = amount?.closest("label")
    if (!amount || !label || label.dataset.adjusted === "true") return
    label.dataset.adjusted = "true"
    if (label.childNodes[0]) label.childNodes[0].nodeValue = "Monto tecnico de compatibilidad *"
    amount.placeholder = "Se calculara por solicitudes vinculadas cuando exista soporte"
  }

  function getData() { return window.FluxIncomeData || fallbackData || { members: [], periods: [], charges: [], payments: [], incidents: [], invoices: [], companies: [], costCenters: [], budgetCategories: [] } }

  async function loadFallbackData() {
    if (window.FluxIncomeData || fallbackLoading || !window.supabase?.createClient) return
    fallbackLoading = true
    try {
      const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      const [membersResult, periodsResult, chargesResult, paymentsResult, incidentsResult, invoicesResult] = await Promise.all([
        client.from("members").select("*").order("full_name", { ascending: true }),
        client.from("billing_periods").select("*").order("cutoff_date", { ascending: false }),
        client.from("maintenance_fee_charges").select("*").order("created_at", { ascending: false }),
        client.from("maintenance_fee_payments").select("*").order("created_at", { ascending: false }),
        client.from("incident_charges").select("*").order("incident_date", { ascending: false }),
        client.from("invoices").select("*").order("issue_date", { ascending: false }),
      ])
      const failed = [membersResult, periodsResult, chargesResult, paymentsResult, incidentsResult, invoicesResult].find((result) => result.error)
      if (failed?.error) return
      fallbackData = { members: membersResult.data || [], periods: periodsResult.data || [], charges: chargesResult.data || [], payments: paymentsResult.data || [], incidents: incidentsResult.data || [], invoices: invoicesResult.data || [], companies: [], costCenters: [], budgetCategories: [] }
      renderCustomViews()
    } finally { fallbackLoading = false }
  }

  function ensureDefaultPeriod(rows) { if (balanceFilters.period) return; const firstDate = rows.map((row) => row.date).filter(Boolean).sort().pop(); balanceFilters.period = firstDate ? String(firstDate).slice(0, 7) : new Date().toISOString().slice(0, 7) }
  function matchesPeriod(dateValue, periodValue, scope) { if (!periodValue) return true; const date = new Date(dateValue); if (Number.isNaN(date.getTime())) return false; const [yearText, monthText] = String(periodValue).split("-"); const year = Number(yearText); const month = Number(monthText); if (scope === "year") return date.getFullYear() === year; if (scope === "quarter") { const selectedQuarter = Math.floor((month - 1) / 3); const rowQuarter = Math.floor(date.getMonth() / 3); return date.getFullYear() === year && rowQuarter === selectedQuarter } return date.getFullYear() === year && date.getMonth() + 1 === month }
  function clickTab(tab) { const button = document.querySelector(`[data-tab="${tab}"]`); if (button && !button.classList.contains("active")) button.click() }
  function showTabButton(tab) { const button = document.querySelector(`[data-tab="${tab}"]`); if (button) button.hidden = false }
  function hideTabButton(tab) { const button = document.querySelector(`[data-tab="${tab}"]`); if (button) button.hidden = true }
  function ensureNotice(id, copy) { const existing = document.getElementById(id); if (existing) { existing.textContent = copy; return } document.getElementById("incomeUx2Notice")?.remove(); document.getElementById(isIncidentMode ? "incomeModeNotice" : "incidentModeNotice")?.remove(); const header = document.querySelector(".page-header"); if (!header) return; header.insertAdjacentHTML("afterend", `<div id="${id}" class="notice neutral">${copy}</div>`) }
  function installStyles() { if (document.getElementById("ingresosCarlosUxStyles")) return; const style = document.createElement("style"); style.id = "ingresosCarlosUxStyles"; style.textContent = `.compact-stats{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:14px 0}.flux-progress-wrap{border:1px solid var(--border);border-radius:8px;padding:12px;margin:12px 0;background:var(--bg-hover)}.flux-progress-head{display:flex;justify-content:space-between;gap:12px;font-weight:800;margin-bottom:8px}.flux-progress{height:8px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}.flux-progress span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--accent),var(--accent-text))}.flux-stepper{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0 0 12px}.flux-stepper span{border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center;font-weight:800;color:var(--accent-text);background:var(--accent-dim)}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}.detail-card{border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg-hover)}.detail-card span,.detail-card small{display:block;color:var(--text-3);font-weight:700;font-size:11px;text-transform:uppercase}.detail-card strong{display:block;margin-top:4px;color:var(--text-1)}.inner-card{margin-top:12px}button[disabled]{opacity:.45;cursor:not-allowed}`; document.head.appendChild(style) }
  function byId(list, id) { return (list || []).find((item) => item.id === id) }
  function memberById(id, data) { return byId(data.members, id) }
  function memberName(id, data) { return memberById(id, data)?.full_name || "" }
  function incidentReceiverType(incident) { return incident?.member_id ? "member" : "external" }
  function incidentReceiverName(incident, data) { if (!incident) return "Sin receptor"; return incident.member_id ? memberName(incident.member_id, data) || "Socio no encontrado" : incident.external_name || "Externo" }
  function periodLabel(period) { if (!period) return "Sin periodo"; return period.name || `${period.year || ""}-${String(new Date(period.cutoff_date).getMonth() + 1).padStart(2, "0")}` }
  function chargeStatusLabel(status) { return ({ pending: "Pendiente", partial: "Facturado/parcial", paid: "Pagado", overdue: "Vencido", cancelled: "Cancelado" })[status] || status || "Sin estado" }
  function incidentStatusLabel(status) { return ({ open: "Abierta", invoiced: "Facturada", paid: "Pagada", cancelled: "Cancelada" })[status] || status || "Sin estado" }
  function invoiceStatusLabel(status) { return ({ issued: "Emitida", paid: "Pagada", cancelled: "Cancelada" })[status] || status || "Sin factura" }
  function formatCurrency(value) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(numberValue(value)) }
  function formatPercent(value) { return `${numberValue(value).toFixed(1)}%` }
  function formatDate(value) { if (!value) return ""; return String(value).slice(0, 10) }
  function numberValue(value) { const number = Number(value); return Number.isFinite(number) ? number : 0 }
  function emptyRow(colspan, message) { return `<tr><td colspan="${colspan}" class="empty-state">${escapeHtml(message)}</td></tr>` }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]) }
  function setText(selector, text) { const node = document.querySelector(selector); if (node && node.textContent !== text) node.textContent = text }
  function replaceRepeatedText(root, pattern, to) { if (!root) return; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode); nodes.forEach((node) => { node.nodeValue = node.nodeValue.replace(pattern, to) }) }
  function toast(title, message) { if (typeof window.showToast === "function") window.showToast(title, message, "info"); else alert(`${title}\n${message}`) }
  function normalize(value) { return String(value || "").trim().toLowerCase() }
})()
