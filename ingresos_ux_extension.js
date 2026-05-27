;(function enhanceIncomeUx() {
  if (window.__fluxIncomeUxExtension) return
  window.__fluxIncomeUxExtension = true

  function onReady(callback) {
    if (document.readyState === "complete") {
      window.setTimeout(callback, 0)
    } else {
      window.addEventListener("load", () => window.setTimeout(callback, 0), { once: true })
    }
  }

  onReady(function startIncomeUxPatch() {
    if (typeof state === "undefined" || typeof d === "undefined") {
      window.setTimeout(startIncomeUxPatch, 150)
      return
    }

    injectIncomeUxStyles()
    patchIncomeCards()
    patchMemberFactorCopy()
    patchPaymentFilters()
    patchPaymentHistoryDialog()
    patchIncomeLogic()

    if (typeof renderAll === "function") renderAll()
  })

  function injectIncomeUxStyles() {
    if (document.getElementById("incomeUxExtensionStyles")) return
    const style = document.createElement("style")
    style.id = "incomeUxExtensionStyles"
    style.textContent = `
      .stat-card.paid::after { background:linear-gradient(90deg,var(--emerald),transparent 55%); }
      .stat-card.collected::after { background:linear-gradient(90deg,var(--sky),transparent 55%); }
      .stat-card.paid strong { color:var(--emerald); }
      .stat-card.collected strong { color:var(--sky); font-size:20px; }
      .segmented-filter { display:flex; flex-wrap:wrap; gap:6px; padding:13px 16px 0; }
      .segment-btn {
        min-height:30px; padding:5px 12px; border:1px solid var(--border); border-radius:8px;
        background:transparent; color:var(--text-3); font-size:12px; font-weight:700; cursor:pointer;
      }
      .segment-btn:hover { color:var(--text-2); background:var(--bg-hover); }
      .segment-btn.active { color:var(--accent-text); background:var(--accent-dim); border-color:rgba(15,118,110,.24); }
      .field-help { color:var(--text-3); font-size:11px; line-height:1.45; font-weight:500; letter-spacing:0; text-transform:none; }
      .summary-group-title { margin:4px 0 2px; color:var(--text-3); font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.65px; }
    `
    document.head.appendChild(style)
  }

  function patchIncomeCards() {
    const grid = document.querySelector(".stats-grid")
    if (!grid) return
    grid.innerHTML = `
      <button type="button" class="stat-card members" data-card-filter="members"><p>Socios activos</p><strong id="activeMembersCount">0</strong></button>
      <button type="button" class="stat-card fees" data-card-filter="pendingFees"><p>Cuotas pendientes</p><strong id="pendingFeesCount">0</strong></button>
      <button type="button" class="stat-card amount" data-card-filter="pendingAmount"><p>Monto pendiente</p><strong id="pendingAmountTotal">$0</strong></button>
      <button type="button" class="stat-card paid" data-card-filter="paidFees"><p>Cuotas pagadas</p><strong id="paidFeesCount">0</strong></button>
      <button type="button" class="stat-card collected" data-card-filter="collectedAmount"><p>Monto cobrado</p><strong id="collectedAmountTotal">$0</strong></button>
    `
    d.statCards = [...document.querySelectorAll("[data-card-filter]")]
    d.activeMembersCount = document.getElementById("activeMembersCount")
    d.pendingFeesCount = document.getElementById("pendingFeesCount")
    d.pendingAmountTotal = document.getElementById("pendingAmountTotal")
    d.paidFeesCount = document.getElementById("paidFeesCount")
    d.collectedAmountTotal = document.getElementById("collectedAmountTotal")
    d.statCards.forEach(card => card.addEventListener("click", () => applyCard(card.dataset.cardFilter)))
  }

  function patchMemberFactorCopy() {
    const headerCells = document.querySelectorAll("#membersTab th")
    headerCells.forEach(cell => {
      if (cell.textContent.trim().toLowerCase() === "factor cuota") cell.textContent = "Factor participacion"
    })

    const dialogCopy = document.querySelector("#memberDialogTitle")?.parentElement?.querySelector("p")
    if (dialogCopy) dialogCopy.textContent = "Registra datos base del socio y su factor de participacion."

    const input = document.getElementById("memberFeeFactor")
    if (!input) return
    input.step = "any"
    input.min = "0.0001"
    const label = input.closest("label")
    if (!label) return

    const firstText = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    if (firstText) firstText.textContent = "Factor de participacion *"

    if (!label.querySelector(".field-help")) {
      const help = document.createElement("span")
      help.className = "field-help"
      help.textContent = "Usa 1 para cuota completa, 0.5 para media cuota, 0.333 para una tercera parte."
      label.appendChild(help)
    }
  }

  function patchPaymentFilters() {
    const panel = document.querySelector("#paymentsTab .table-card")
    const toolbar = document.querySelector("#paymentsTab .toolbar")
    if (panel && toolbar && !document.getElementById("paymentViewSegments")) {
      const segments = document.createElement("div")
      segments.id = "paymentViewSegments"
      segments.className = "segmented-filter"
      segments.setAttribute("aria-label", "Vista de cobros")
      segments.innerHTML = `
        <button type="button" class="segment-btn active" data-payment-view="pending">Pendientes</button>
        <button type="button" class="segment-btn" data-payment-view="paid">Pagados</button>
        <button type="button" class="segment-btn" data-payment-view="all">Todos</button>
      `
      panel.insertBefore(segments, toolbar)
    }

    const title = document.querySelector("#paymentsTab .panel-header h2")
    const subtitle = document.querySelector("#paymentsTab .panel-header p")
    if (title) title.textContent = "Cobros"
    if (subtitle) subtitle.textContent = "Consulta pendientes, pagados e historico de cuotas de mantenimiento."

    addOptionIfMissing(document.getElementById("paymentStatusFilter"), "paid", "Pagada")
    addOptionIfMissing(document.getElementById("paymentStatusFilter"), "cancelled", "Cancelada")

    d.paymentViewButtons = [...document.querySelectorAll("[data-payment-view]")]
    d.paymentViewButtons.forEach(button => button.addEventListener("click", () => setPaymentView(button.dataset.paymentView)))
    ;[d.paymentSearch, d.paymentStatusFilter, d.paymentPeriodFilter].forEach(el => {
      el?.addEventListener("input", () => window.setTimeout(renderPayments, 0))
      el?.addEventListener("change", () => window.setTimeout(renderPayments, 0))
    })
  }

  function patchPaymentHistoryDialog() {
    if (document.getElementById("paymentHistoryDialog")) {
      d.paymentHistoryDialog = document.getElementById("paymentHistoryDialog")
      d.paymentHistoryTitle = document.getElementById("paymentHistoryTitle")
      d.paymentHistoryTableBody = document.getElementById("paymentHistoryTableBody")
      return
    }

    const dialog = document.createElement("dialog")
    dialog.id = "paymentHistoryDialog"
    dialog.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <div><h2 id="paymentHistoryTitle">Pagos de la cuota</h2><p>Historial de cobros registrados para esta cuota.</p></div>
          <button type="button" class="icon-btn" data-close-dialog="paymentHistoryDialog">x</button>
        </div>
        <div class="table-card">
          <div class="table-wrapper" style="max-height:360px;min-height:180px;">
            <table>
              <thead><tr><th>Fecha</th><th>Monto</th><th>Metodo</th><th>Referencia</th><th>Registrado por</th><th>Notas</th></tr></thead>
              <tbody id="paymentHistoryTableBody"></tbody>
            </table>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary-btn" data-close-dialog="paymentHistoryDialog">Cerrar</button>
        </div>
      </div>
    `
    document.body.appendChild(dialog)
    dialog.querySelectorAll("[data-close-dialog]").forEach(button => {
      button.addEventListener("click", () => closeDialog(button.dataset.closeDialog))
    })
    d.paymentHistoryDialog = dialog
    d.paymentHistoryTitle = document.getElementById("paymentHistoryTitle")
    d.paymentHistoryTableBody = document.getElementById("paymentHistoryTableBody")
  }

  function patchIncomeLogic() {
    state.paymentView = state.paymentView || "pending"

    renderStats = function renderStatsUx() {
      const activeMembers = state.members.filter(member => member.active !== false).length
      const pendingCharges = state.charges.filter(charge => PENDING.includes(charge.status)).length
      const pendingAmount = state.charges
        .filter(charge => PENDING.includes(charge.status))
        .reduce((total, charge) => total + num(charge.pending_amount), 0)
      const paidCharges = state.charges.filter(charge => charge.status === "paid").length
      const collected = state.charges.reduce((total, charge) => total + num(charge.paid_amount), 0)

      if (d.activeMembersCount) d.activeMembersCount.textContent = activeMembers
      if (d.pendingFeesCount) d.pendingFeesCount.textContent = pendingCharges
      if (d.pendingAmountTotal) d.pendingAmountTotal.textContent = moneySmall(pendingAmount)
      if (d.paidFeesCount) d.paidFeesCount.textContent = paidCharges
      if (d.collectedAmountTotal) d.collectedAmountTotal.textContent = moneySmall(collected)
      d.statCards.forEach(card => card.classList.toggle("selected", card.dataset.cardFilter === state.quick))
    }

    renderDashboard = function renderDashboardUx() {
      const expected = sum(state.charges, "expected_amount")
      const collected = sum(state.charges, "paid_amount")
      const pendingCharges = state.charges.filter(charge => PENDING.includes(charge.status)).length
      const paidCharges = state.charges.filter(charge => charge.status === "paid").length
      const pending = state.charges
        .filter(charge => PENDING.includes(charge.status))
        .reduce((total, charge) => total + num(charge.pending_amount), 0)
      const openIncidents = state.incidents
        .filter(incident => OPEN_INCIDENTS.includes(incident.status))
        .reduce((total, incident) => total + num(incident.amount), 0)
      const pendingInvoices = state.invoices
        .filter(invoice => invoice.status === "issued")
        .reduce((total, invoice) => total + num(invoice.amount), 0)
      const paidIncidents = state.incidents.filter(incident => incident.status === "paid").length
      const paidInvoices = state.invoices.filter(invoice => invoice.status === "paid").length

      d.dashboardSummary.innerHTML = [
        `<div class="summary-group-title">Pendiente</div>`,
        rowSummary("Cuotas pendientes", `${pendingCharges} / ${money(pending)}`),
        rowSummary("Incidencias abiertas/facturadas", money(openIncidents)),
        rowSummary("Facturas emitidas pendientes", money(pendingInvoices)),
        `<div class="summary-group-title">Cobrado / historico</div>`,
        rowSummary("Cuotas esperadas", money(expected)),
        rowSummary("Cuotas cobradas", `${paidCharges} / ${money(collected)}`),
        rowSummary("Incidencias cobradas", paidIncidents),
        rowSummary("Facturas pagadas", paidInvoices),
      ].join("")
    }

    applyCard = function applyCardUx(filter) {
      state.quick = filter
      if (filter === "members") {
        switchTab("members")
        d.memberStatusFilter.value = "active"
      }
      if (filter === "pendingFees" || filter === "pendingAmount") {
        switchTab("payments")
        state.paymentView = "pending"
        d.paymentStatusFilter.value = "todos"
      }
      if (filter === "paidFees" || filter === "collectedAmount") {
        switchTab("payments")
        state.paymentView = "paid"
        d.paymentStatusFilter.value = "todos"
      }
      renderFilter()
      renderAll()
    }

    clearQuick = function clearQuickUx() {
      state.quick = null
      d.memberStatusFilter.value = "todos"
      if (state.tab === "payments") state.paymentView = "all"
      d.paymentStatusFilter.value = "todos"
      d.incidentStatusFilter.value = "todos"
      d.invoiceStatusFilter.value = "todos"
      renderFilter()
      renderAll()
    }

    renderFilter = function renderFilterUx() {
      const labels = {
        members: "Vista filtrada: Socios activos",
        pendingFees: "Vista filtrada: Cuotas pendientes",
        pendingAmount: "Vista filtrada: Monto pendiente",
        paidFees: "Vista filtrada: Cuotas pagadas",
        collectedAmount: "Vista filtrada: Monto cobrado",
      }
      d.filterLabel.textContent = labels[state.quick] || "Vista filtrada"
      d.filterStrip.classList.toggle("hidden", !state.quick)
    }

    renderPayments = function renderPaymentsUx() {
      const q = norm(d.paymentSearch.value)
      const status = d.paymentStatusFilter.value
      const period = d.paymentPeriodFilter.value

      let rows = [...state.charges]
      if (state.paymentView === "pending") rows = rows.filter(charge => PENDING.includes(charge.status))
      if (state.paymentView === "paid") rows = rows.filter(charge => charge.status === "paid")
      if (state.quick === "pendingFees" || state.quick === "pendingAmount") {
        rows = rows.filter(charge => PENDING.includes(charge.status) && num(charge.pending_amount) > 0)
      }
      if (state.quick === "paidFees" || state.quick === "collectedAmount") {
        rows = rows.filter(charge => charge.status === "paid")
      }

      rows = rows.filter(charge => {
        const haystack = norm([memberName(charge.member_id), periodLabel(periodById(charge.billing_period_id))].join(" "))
        return (!q || haystack.includes(q))
          && (status === "todos" || charge.status === status)
          && (period === "todos" || charge.billing_period_id === period)
      })

      const emptyMessage = {
        pending: "No hay cuotas pendientes para este filtro.",
        paid: "No hay cuotas pagadas para este filtro.",
        all: "No hay cuotas para este filtro.",
      }[state.paymentView] || "No hay cuotas para este filtro."

      d.paymentsTableBody.innerHTML = rows.length ? rows.map(chargeRow).join("") : empty(8, emptyMessage)
      renderPaymentViewButtons()
    }

    chargeRow = function chargeRowUx(charge) {
      const member = memberById(charge.member_id)
      const period = periodById(charge.billing_period_id)
      const invoice = invoiceById(charge.invoice_id)
      const chargePayments = state.payments.filter(payment => payment.charge_id === charge.id)
      const canViewPayments = chargePayments.length > 0 || num(charge.paid_amount) > 0
      const invoiceCell = invoice
        ? `${badge(invoice.status, invoiceStatus(invoice.status))}<span class="muted-line">${esc(invoice.series_folio || invoice.fiscal_uuid || "Factura")}</span>`
        : badge("neutral", "Sin factura")

      return `<tr>
        <td><strong>${esc(member?.full_name || "Socio no encontrado")}</strong><span class="muted-line">${esc(member?.rfc || "Sin RFC")}</span></td>
        <td>${esc(periodLabel(period))}</td>
        <td>${money(charge.expected_amount)}</td>
        <td>${money(charge.paid_amount)}</td>
        <td>${money(charge.pending_amount)}</td>
        <td>${badge(charge.status, chargeLabel(charge.status))}</td>
        <td>${invoiceCell}</td>
        <td><div class="actions">
          ${PENDING.includes(charge.status) ? `<button class="small-btn success" data-action="pay" data-id="${esc(charge.id)}">Registrar cobro</button>` : ""}
          ${canViewPayments ? `<button class="small-btn" data-action="view-payments" data-id="${esc(charge.id)}">Ver pagos</button>` : ""}
          ${!charge.invoice_id && charge.status !== "cancelled" ? `<button class="small-btn info" data-action="invoice-charge" data-id="${esc(charge.id)}">Crear factura</button>` : ""}
        </div></td>
      </tr>`
    }

    d.chargesTableBody?.addEventListener("click", onPaymentHistoryClick)
    d.paymentsTableBody?.addEventListener("click", onPaymentHistoryClick)
  }

  function setPaymentView(view) {
    state.paymentView = view === "paid" || view === "all" ? view : "pending"
    state.quick = null
    d.paymentStatusFilter.value = "todos"
    renderFilter()
    renderStats()
    renderPayments()
  }

  function renderPaymentViewButtons() {
    d.paymentViewButtons?.forEach(button => {
      button.classList.toggle("active", button.dataset.paymentView === state.paymentView)
    })
  }

  function onPaymentHistoryClick(event) {
    const button = event.target.closest("button[data-action='view-payments']")
    if (!button) return
    event.stopPropagation()
    showPaymentHistory(button.dataset.id)
  }

  function showPaymentHistory(chargeId) {
    const charge = state.charges.find(item => item.id === chargeId)
    if (!charge) return toast("Cuota no encontrada", "No se encontro la cuota.", "error")
    const member = memberById(charge.member_id)
    const period = periodById(charge.billing_period_id)
    const rows = state.payments
      .filter(payment => payment.charge_id === chargeId)
      .sort((a, b) => String(b.payment_date || b.created_at || "").localeCompare(String(a.payment_date || a.created_at || "")))

    d.paymentHistoryTitle.textContent = `Pagos - ${member?.full_name || "Socio"} / ${periodLabel(period)}`
    d.paymentHistoryTableBody.innerHTML = rows.length
      ? rows.map(payment => `<tr>
          <td>${date(payment.payment_date)}</td>
          <td><strong>${money(payment.amount_paid)}</strong></td>
          <td>${esc(paymentMethodLabel(payment.payment_method))}</td>
          <td>${esc(payment.bank_reference || "Sin referencia")}</td>
          <td>${esc(profileLabel(payment.registered_by))}</td>
          <td>${esc(payment.notes || "Sin notas")}</td>
        </tr>`).join("")
      : empty(6, "No hay pagos registrados para esta cuota.")
    d.paymentHistoryDialog.showModal()
  }

  function addOptionIfMissing(select, value, label) {
    if (!select || [...select.options].some(option => option.value === value)) return
    const option = document.createElement("option")
    option.value = value
    option.textContent = label
    select.appendChild(option)
  }

  function profileLabel(id) {
    if (!id) return "Sin usuario"
    if (state.profile?.id === id) return state.profile.full_name || state.profile.email || "Usuario actual"
    return `Perfil ${String(id).slice(0, 8)}`
  }

  function paymentMethodLabel(method) {
    return ({ transfer: "Transferencia", cash: "Efectivo", check: "Cheque", card: "Tarjeta", other: "Otro" })[method] || method || "Sin metodo"
  }
})()
