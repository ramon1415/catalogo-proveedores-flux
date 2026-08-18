const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  periodKey: "",
  kpis: {},
  budgetComparison: [],
  ytd: [],
  incomeMembers: [],
  closureChecklist: {},
  closureComments: [],
  activeTab: "expenses",
  chart: null,
}

const moneyFmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 })
const numFmt   = new Intl.NumberFormat("es-MX")
const pctFmt   = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const checkLabels = {
  pending_payment_requests:        "Solicitudes pendientes de atencion",
  approved_without_operation:      "Solicitudes aprobadas sin operacion",
  unconfirmed_layouts:             "Layouts no confirmados",
  unpaid_approved_requests:        "Solicitudes aprobadas sin pago",
  overdue_cash_funds:              "Fondos vencidos",
  cash_reconciliations_in_review:  "Comprobaciones en revision",
  open_incidents:                  "Incidencias abiertas",
  issued_unpaid_invoices:          "Facturas emitidas sin pago",
  overdue_maintenance_fees:        "Cuotas vencidas",
  missing_budget_comments:         "Comentarios de presupuesto pendientes",
}

const statusLabels = {
  open: "Abierto", review: "En revision", closed: "Cerrado",
  cancelled: "Cancelado", not_created: "Sin cierre",
  pending: "Pendiente", partial: "Parcial", paid: "Pagado",
  overdue: "Vencido", issued: "Emitida", ok: "OK",
}

document.addEventListener("DOMContentLoaded", init)

async function init() {
  state.anualMode = new URLSearchParams(window.location.search).get("view") === "anual"
  setDefaultPeriod()
  bindEvents()

  const root = document.documentElement
  const stored = localStorage.getItem("flux-theme")
  if (stored) root.dataset.theme = stored

  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  const profile = window.FluxAuth?.getProfile?.()
  const session  = window.FluxAuth?.state?.session
  if (!session) { window.location.href = "./index.html"; return }
  state.profile = profile || null

  const userName  = document.getElementById("userName")
  const userEmail = document.getElementById("userEmail")
  if (userName)  userName.textContent  = profile?.full_name || "Usuario"
  if (userEmail) userEmail.textContent = profile?.email || "Sesion activa"

  if (window.Components?.buildNav) window.Components.buildNav(state.anualMode ? "dashboard-anual" : "dashboard")

  await loadDashboard()
  if (state.anualMode) await initAnualMode()
}

function bindEvents() {
  document.getElementById("refreshBtn")?.addEventListener("click", loadDashboard)
  document.getElementById("periodInput")?.addEventListener("change", loadDashboard)
  document.getElementById("historyBtn")?.addEventListener("click", openHistory)
  document.getElementById("histExitBtn")?.addEventListener("click", () => { window.location.href = "./dashboard.html" })
  document.getElementById("histYearSelect")?.addEventListener("change", (e) => {
    const v = e.target.value
    if (v === "todos") enterAllYears()
    else enterHistYear(Number(v))
  })
  document.getElementById("exportBtn")?.addEventListener("click", openExport)
  document.getElementById("clearFilterBtn")?.addEventListener("click", clearFilter)
  document.getElementById("memberSearch")?.addEventListener("input", renderMemberTable)

  document.getElementById("closePeriodBtn")?.addEventListener("click", () => {
    if (state.closureChecklist?.can_close) {
      showToast("Cierre pendiente", "El cierre formal se conectara en la siguiente tanda.", "success")
    } else {
      showToast("No se puede cerrar", "Resuelve primero los bloqueos del checklist.", "danger")
    }
  })

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut()
    window.location.href = "index.html"
  })

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
    document.documentElement.dataset.theme = next
    localStorage.setItem("flux-theme", next)
    updateChartTheme()
  })

  document.querySelectorAll(".section-tab").forEach((btn) =>
    btn.addEventListener("click", () => showTab(btn.dataset.tab))
  )

  document.querySelectorAll("[data-close-dialog]").forEach((btn) =>
    btn.addEventListener("click", () => btn.closest("dialog")?.close())
  )

  document.querySelectorAll("[data-export-option]").forEach((btn) =>
    btn.addEventListener("click", () =>
      showToast("Exportacion pendiente", "La conexion a Google Drive se implementara mediante n8n.", "info")
    )
  )

  ;["expenseSearch", "expenseCompanyFilter", "expenseCostCenterFilter", "expenseCategoryFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderExpenses)
    document.getElementById(id)?.addEventListener("change", renderExpenses)
  })

  ;["incomeSearch", "incomeStatusFilter", "incomeLineageFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderIncome)
    document.getElementById(id)?.addEventListener("change", renderIncome)
  })
}

// ─── Data loading ────────────────────────────────────────────────────────────

async function loadDashboard() {
  if (!state.anualMode) exitHistYear()
  const periodInput = document.getElementById("periodInput")
  state.periodKey = periodInput?.value || currentPeriodKey()
  setLoading(true)

  try {
    const { data, error } = await supabaseClient.rpc("dashboard_export_payload", { p_period_key: state.periodKey })
    if (error) throw error
    const payload = normalize(data)
    state.kpis             = payload.kpis || {}
    state.budgetComparison = ensureArray(payload.budget_comparison)
    state.ytd              = ensureArray(payload.ytd)
    state.incomeMembers    = ensureArray(payload.income_members)
    state.closureChecklist = payload.closure_checklist || {}
    state.closureComments  = ensureArray(payload.closure_comments)
    renderAll()
    const lu = document.getElementById("lastUpdated")
    if (lu) lu.textContent = `Ultima actualizacion: ${fmtDateTime(new Date())}`
    // load yearly chart in background (solo vista operativa)
    if (!state.anualMode) loadYearlyChart()
  } catch (err) {
    showToast("Error al cargar", friendlyError(err), "danger")
  } finally {
    setLoading(false)
  }
}

async function loadYearlyChart() {
  const year = Number(state.periodKey.slice(0, 4))
  const currentMonth = Number(state.periodKey.slice(5, 7))
  const months = []
  for (let m = 1; m <= currentMonth; m++) months.push(`${year}-${String(m).padStart(2, "0")}`)

  const sub = document.getElementById("chartSubtitle")
  if (sub) sub.textContent = `Cargando ${months.length} meses...`

  try {
    const results = await Promise.all(
      months.map((pk) => supabaseClient.rpc("dashboard_export_payload", { p_period_key: pk }))
    )

    const labels = months.map((pk) => {
      const [, m] = pk.split("-")
      return new Date(Number(pk.slice(0, 4)), Number(m) - 1, 1).toLocaleDateString("es-MX", { month: "short" })
    })

    const presupuesto = []
    const ejecutado   = []
    const esperado    = []
    const cobrado     = []

    results.forEach(({ data }) => {
      const p = normalize(data)
      const bc = ensureArray(p.budget_comparison)
      presupuesto.push(bc.reduce((s, r) => s + num(r.budget_amount),   0))
      ejecutado.push(  bc.reduce((s, r) => s + num(r.executed_amount), 0))
      esperado.push(  num(p.kpis?.ingresos?.maintenance_expected))
      cobrado.push(   num(p.kpis?.ingresos?.maintenance_collected))
    })

    const hasData = [presupuesto, ejecutado, esperado, cobrado].some((serie) => serie.some((v) => v > 0))
    if (!hasData) {
      const demo = demoChartSeries(labels.length)
      if (sub) sub.textContent = `Enero – ${labels[labels.length - 1]} ${year} · datos de ejemplo`
      if (state.histYear) return
      drawChart(labels, demo.presupuesto, demo.ejecutado, demo.esperado, demo.cobrado)
      return
    }

    if (sub) sub.textContent = `Enero – ${labels[labels.length - 1]} ${year}`
    if (state.histYear) return
    drawChart(labels, presupuesto, ejecutado, esperado, cobrado)
  } catch (_) {
    if (sub) sub.textContent = "No se pudo cargar la serie anual"
  }
}

function demoChartSeries(count) {
  // Serie determinística y plausible para demo cuando no hay movimientos reales
  const basePresupuesto = [920000, 880000, 940000, 905000, 960000, 930000, 915000, 950000, 925000, 945000, 910000, 970000]
  const ejecPct         = [0.82, 0.91, 0.76, 0.88, 0.79, 0.85, 0.93, 0.81, 0.87, 0.78, 0.9, 0.84]
  const baseEsperado    = 480000
  const cobroPct        = [0.95, 0.88, 0.92, 1, 0.85, 0.97, 0.9, 0.94, 0.89, 0.98, 0.91, 0.96]
  const presupuesto = [], ejecutado = [], esperado = [], cobrado = []
  for (let i = 0; i < count; i++) {
    const p = basePresupuesto[i % 12]
    presupuesto.push(p)
    ejecutado.push(Math.round(p * ejecPct[i % 12]))
    esperado.push(baseEsperado)
    cobrado.push(Math.round(baseEsperado * cobroPct[i % 12]))
  }
  return { presupuesto, ejecutado, esperado, cobrado }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  renderKpis()
  renderMemberTable()
  renderClosure()
  renderExpenses()
  renderYtd()
  renderIncome()
  renderCash()
  renderIncidents()
}

function renderKpis() {
  const eg     = state.kpis.egresos  || {}
  const inc    = state.kpis.ingresos || {}
  const cash   = state.kpis.efectivo || {}
  const checks = state.closureChecklist?.checks || {}

  // Ejecución
  const budget   = state.budgetComparison.reduce((s, r) => s + num(r.budget_amount),   0)
  const executed = state.budgetComparison.reduce((s, r) => s + num(r.executed_amount), 0)
  const execPct  = budget > 0 ? Math.min(100, (executed / budget) * 100) : 0
  setEl("kpiExecuted",    money(executed))
  setEl("kpiExecutedSub", `de ${money(budget)} presupuestado · ${pct(execPct)}`)
  setBar("kpiExecutedBar", execPct)

  // Cobranza
  const expected  = num(inc.maintenance_expected)
  const collected = num(inc.maintenance_collected)
  const collPct   = expected > 0 ? Math.min(100, (collected / expected) * 100) : 0
  setEl("kpiCollected",    money(collected))
  setEl("kpiCollectedSub", `de ${money(expected)} esperado · ${pct(collPct)}`)
  setBar("kpiCollectedBar", collPct)

  // Efectivo
  const active  = num(cash.active_cash_funds)
  const pending = num(cash.pending_cash_reconciliation)
  const overdue = num(cash.overdue_cash_funds)
  const verified = active - pending - overdue
  const cashPct  = active > 0 ? Math.min(100, (Math.max(0, verified) / active) * 100) : 0
  setEl("kpiCash",    `${whole(active)} fondos`)
  setEl("kpiCashSub", `${whole(Math.max(0, verified))} comprobados · ${whole(pending)} pendientes`)
  setBar("kpiCashBar", cashPct)

  // Incidencias
  const openInc  = num(inc.open_incidents)
  const paidInc  = num(inc.paid_incidents)
  const totalInc = openInc + paidInc
  const incPct   = totalInc > 0 ? Math.min(100, (paidInc / totalInc) * 100) : 100
  const blockers = Object.values(checks).filter((v) => num(v) > 0).length
  setEl("kpiIncidents",    whole(openInc))
  setEl("kpiIncidentsSub", `${whole(blockers)} bloqueos de cierre`)
  setBar("kpiIncidentsBar", incPct)
}

function renderMemberTable() {
  const tbody  = document.getElementById("memberTableBody")
  if (!tbody) return
  const search = String(document.getElementById("memberSearch")?.value || "").toLowerCase()
  const rows = [...state.incomeMembers]
    .filter((r) => !search || String(r.member_name || "").toLowerCase().includes(search))
    .sort((a, b) => num(b.pending_amount) - num(a.pending_amount))

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="padding:44px;text-align:center;color:var(--text-3)">Sin registros para este periodo.</td></tr>`
    return
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td><span class="cell-main">${safe(r.member_name)}</span><span class="cell-sub">${safe(r.lineage, "")}</span></td>
      <td>${money(r.expected_amount)}</td>
      <td>${money(r.paid_amount)}</td>
      <td style="font-weight:700;color:${num(r.pending_amount) > 0 ? "var(--amber)" : "var(--text-3)"}">${money(r.pending_amount)}</td>
      <td>${incomeStatusBadge(r.status)}</td>
    </tr>
  `).join("")
}

function renderClosure() {
  const checklist = state.closureChecklist || {}
  const checks    = checklist.checks || {}
  const status    = state.kpis.cierre?.closure_status || "not_created"
  const canClose  = Boolean(checklist.can_close)
  const blockers  = ensureArray(checklist.blocking_reasons)

  const btn = document.getElementById("closePeriodBtn")
  if (btn) btn.disabled = !canClose

  const lbl = document.getElementById("closureStatusLabel")
  if (lbl) lbl.textContent = canClose ? "Listo para cerrar" : `${blockers.length || Object.values(checks).filter((v) => num(v) > 0).length} bloqueos activos`

  const result = document.getElementById("closureResult")
  if (result) {
    result.innerHTML = [
      ["Estatus", closureStatusBadge(status)],
      ["Puede cerrar", canClose ? Components.badge("Si", "success") : Components.badge("No", "danger")],
      ["Bloqueos", blockers.length ? blockers.map((k) => checkLabels[k] || k).join(", ") : "Sin bloqueos criticos"],
    ].map(([label, value]) => `<div class="summary-row"><span>${label}</span><strong>${value}</strong></div>`).join("")
  }

  const list = document.getElementById("closureChecksList")
  if (list) {
    const entries = Object.entries(checks)
    list.innerHTML = entries.map(([key, value]) => {
      const count = num(value)
      return `<div class="summary-row" style="padding:7px 10px">
        <span>${checkLabels[key] || key}</span>
        <strong>${count > 0 ? Components.badge("Bloquea", "danger") : Components.badge("OK", "success")}</strong>
      </div>`
    }).join("") || `<div style="font-size:12px;color:var(--text-3);padding:4px 0">Sin revisiones para este periodo.</div>`
  }
}

function renderExpenses() {
  const rows = [...state.budgetComparison]
  populateSelect("expenseCompanyFilter",    "Empresa", unique(rows.map((r) => r.company)))
  populateSelect("expenseCostCenterFilter", "Centro",  unique(rows.map((r) => r.cost_center)))
  populateSelect("expenseCategoryFilter",   "Partida", unique(rows.map((r) => r.budget_category)))

  const search     = (document.getElementById("expenseSearch")?.value || "").toLowerCase()
  const company    = document.getElementById("expenseCompanyFilter")?.value    || "todos"
  const costCenter = document.getElementById("expenseCostCenterFilter")?.value || "todos"
  const category   = document.getElementById("expenseCategoryFilter")?.value   || "todos"

  const filtered = rows.filter((r) => {
    const hay = [r.company, r.cost_center, r.budget_category, r.category_code].join(" ").toLowerCase()
    if (search && !hay.includes(search)) return false
    if (company    !== "todos" && norm(r.company)         !== company)    return false
    if (costCenter !== "todos" && norm(r.cost_center)     !== costCenter) return false
    if (category   !== "todos" && norm(r.budget_category) !== category)   return false
    return true
  })

  const hasBudget = rows.some((r) => num(r.budget_amount) > 0)
  document.getElementById("budgetNote")?.classList.toggle("hidden", hasBudget)

  const tbody = document.getElementById("expensesTableBody")
  if (!tbody) return
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="10" style="padding:44px;text-align:center;color:var(--text-3)">Sin datos para este filtro.</td></tr>`
    return
  }
  tbody.innerHTML = filtered.map((r) => `
    <tr>
      <td><span class="cell-main">${safe(r.company, "Sin empresa")}</span></td>
      <td>${safe(r.cost_center, "Sin centro")}</td>
      <td>${safe(r.budget_category, "Sin partida")}</td>
      <td style="color:var(--text-3)">${safe(r.category_code, "-")}</td>
      <td>${money(r.budget_amount)}</td>
      <td>${money(r.committed_amount)}</td>
      <td>${money(r.executed_amount)}</td>
      <td>${money(r.available_amount)}</td>
      <td style="color:${num(r.variance_amount) < 0 ? "var(--ruby)" : "inherit"}">${money(r.variance_amount)}</td>
      <td>${pct(r.variance_pct)}</td>
    </tr>
  `).join("")
}

function renderYtd() {
  const rows   = [...state.ytd]
  const totals = rows.reduce((acc, r) => {
    acc.budget    += num(r.ytd_budget)
    acc.committed += num(r.ytd_committed)
    acc.executed  += num(r.ytd_executed)
    acc.available += num(r.ytd_available)
    return acc
  }, { budget: 0, committed: 0, executed: 0, available: 0 })

  const ytdSum = document.getElementById("ytdSummary")
  if (ytdSum) {
    ytdSum.innerHTML = [
      ["Presupuesto YTD", money(totals.budget)],
      ["Comprometido YTD", money(totals.committed)],
      ["Ejecutado YTD", money(totals.executed)],
      ["Disponible YTD", money(totals.available)],
    ].map(([l, v]) => `<div class="mini-card"><span>${l}</span><strong>${v}</strong></div>`).join("")
  }

  const tbody = document.getElementById("ytdTableBody")
  if (!tbody) return
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--text-3)">Sin datos acumulados.</td></tr>`
    return
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td>${safe(r.company, "Sin empresa")}</td>
      <td>${safe(r.cost_center, "Sin centro")}</td>
      <td>${safe(r.budget_category, "Sin partida")}</td>
      <td>${money(r.ytd_budget)}</td>
      <td>${money(r.ytd_committed)}</td>
      <td>${money(r.ytd_executed)}</td>
      <td>${money(r.ytd_available)}</td>
      <td>${money(r.ytd_variance_amount)}</td>
      <td>${pct(r.ytd_variance_pct)}</td>
    </tr>
  `).join("")
}

function renderIncome() {
  const rows = [...state.incomeMembers]
  populateSelect("incomeLineageFilter", "Estirpe", unique(rows.map((r) => r.lineage)))

  const search    = (document.getElementById("incomeSearch")?.value || "").toLowerCase()
  const status    = document.getElementById("incomeStatusFilter")?.value  || "todos"
  const lineage   = document.getElementById("incomeLineageFilter")?.value || "todos"

  const filtered = rows.filter((r) => {
    if (search  && !String(r.member_name || "").toLowerCase().includes(search)) return false
    if (status  !== "todos" && r.status !== status) return false
    if (lineage !== "todos" && norm(r.lineage) !== lineage) return false
    return true
  })

  const totals = filtered.reduce((acc, r) => {
    acc.expected += num(r.expected_amount)
    acc.paid     += num(r.paid_amount)
    acc.pending  += num(r.pending_amount)
    if (num(r.pending_amount) > 0) acc.members++
    return acc
  }, { expected: 0, paid: 0, pending: 0, members: 0 })

  const totalsEl = document.getElementById("incomeTotals")
  if (totalsEl) {
    totalsEl.innerHTML = [
      ["Total esperado", money(totals.expected)],
      ["Total cobrado",  money(totals.paid)],
      ["Total pendiente", money(totals.pending)],
      ["Socios con saldo", whole(totals.members)],
    ].map(([l, v]) => `<div class="mini-card"><span>${l}</span><strong>${v}</strong></div>`).join("")
  }

  const tbody = document.getElementById("incomeTableBody")
  if (!tbody) return
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--text-3)">Sin registros para este filtro.</td></tr>`
    return
  }
  tbody.innerHTML = filtered.map((r) => `
    <tr>
      <td><span class="cell-main">${safe(r.member_name)}</span></td>
      <td>${safe(r.lineage, "-")}</td>
      <td>${safe(r.billing_period, "-")}</td>
      <td>${money(r.expected_amount)}</td>
      <td>${money(r.paid_amount)}</td>
      <td>${money(r.pending_amount)}</td>
      <td>${incomeStatusBadge(r.status)}</td>
      <td>${whole(r.open_incidents)}</td>
      <td>${whole(r.issued_invoices)}</td>
    </tr>
  `).join("")
}

function renderCash() {
  const cash   = state.kpis.efectivo || {}
  const checks = state.closureChecklist?.checks || {}

  const cardsEl = document.getElementById("cashCards")
  if (cardsEl) {
    cardsEl.innerHTML = [
      ["Fondos activos",     whole(cash.active_cash_funds)],
      ["Pendientes",         whole(cash.pending_cash_reconciliation)],
      ["En revision",        whole(cash.cash_in_review)],
      ["Vencidos",           whole(cash.overdue_cash_funds)],
      ["Monto entregado",    money(cash.cash_assigned_amount)],
      ["Monto comprobado",   money(cash.cash_verified_amount)],
      ["Monto pendiente",    money(cash.cash_pending_amount)],
    ].map(([l, v]) => `<div class="mini-card"><span>${l}</span><strong>${v}</strong></div>`).join("")
  }

  const listEl = document.getElementById("cashChecklist")
  if (listEl) {
    listEl.innerHTML = [
      ["Fondos vencidos",            num(checks.overdue_cash_funds)],
      ["Comprobaciones en revision", num(checks.cash_reconciliations_in_review)],
    ].map(([label, count]) => `
      <div class="summary-row">
        <span>${label}</span>
        <strong>${count > 0 ? Components.badge("Bloquea", "danger") : Components.badge("OK", "success")}</strong>
      </div>
    `).join("")
  }
}

function renderIncidents() {
  const inc = state.kpis.ingresos || {}
  const el  = document.getElementById("incidentCards")
  if (!el) return
  el.innerHTML = [
    ["Incidencias abiertas",  whole(inc.open_incidents)],
    ["Incidencias cobradas",  whole(inc.paid_incidents)],
    ["Facturas emitidas",     whole(inc.issued_invoices)],
    ["Facturas pendientes",   whole(inc.pending_invoices)],
  ].map(([l, v]) => `<div class="mini-card"><span>${l}</span><strong>${v}</strong></div>`).join("")
}

// ─── Chart ───────────────────────────────────────────────────────────────────

function drawChart(labels, presupuesto, ejecutado, esperado, cobrado) {
  const canvas = document.getElementById("mainChart")
  if (!canvas) return

  const isDark = document.documentElement.dataset.theme !== "light"
  const gridColor   = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"
  const tickColor   = isDark ? "rgba(255,255,255,.35)"  : "rgba(0,0,0,.4)"

  if (state.chart) state.chart.destroy()

  state.chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Presupuesto",
          data: presupuesto,
          backgroundColor: "rgba(74,124,109,.22)",
          borderColor:     "rgba(74,124,109,.55)",
          borderWidth: 1,
          borderRadius: 4,
          order: 2,
        },
        {
          type: "bar",
          label: "Ejecutado",
          data: ejecutado,
          backgroundColor: "rgba(74,124,109,.8)",
          borderColor:     "rgba(74,124,109,.95)",
          borderWidth: 1,
          borderRadius: 4,
          order: 1,
        },
        {
          type: "line",
          label: "Esperado",
          data: esperado,
          borderColor: "rgba(16,185,129,.45)",
          borderDash: [5, 4],
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "rgba(16,185,129,.5)",
          tension: 0.3,
          fill: false,
          order: 0,
          yAxisID: "y2",
        },
        {
          type: "line",
          label: "Cobrado",
          data: cobrado,
          borderColor: "rgba(16,185,129,.9)",
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: "rgba(16,185,129,1)",
          tension: 0.3,
          fill: false,
          order: 0,
          yAxisID: "y2",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? "#152119" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)",
          borderWidth: 1,
          titleColor: isDark ? "#f7f7f5" : "#15211d",
          bodyColor: isDark ? "#b4c1ba" : "#4d5f58",
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${moneyFmt.format(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: tickColor, font: { size: 11 } },
        },
        y: {
          grid: { color: gridColor },
          ticks: { color: tickColor, font: { size: 11 }, callback: (v) => `$${(v / 1000).toFixed(0)}k` },
          title: { display: true, text: "Gastos", color: tickColor, font: { size: 10 } },
        },
        y2: {
          position: "right",
          grid: { drawOnChartArea: false },
          ticks: { color: tickColor, font: { size: 11 }, callback: (v) => `$${(v / 1000).toFixed(0)}k` },
          title: { display: true, text: "Ingresos", color: tickColor, font: { size: 10 } },
        },
      },
    },
  })
}

// ─── Histórico (años anteriores, fuente historical_actuals/CONTPAQ) ─────────

async function initAnualMode() {
  document.title = "Dashboard anual | Flux Operadora"
  const h1 = document.querySelector(".page-header h1")
  if (h1) h1.textContent = "Dashboard anual"
  const sub = document.querySelector(".page-header p")
  if (sub) sub.textContent = "Ejercicios históricos: ingresos y egresos contables por año, mes y cuenta."
  await loadHistMapeo()
  const sel = document.getElementById("histYearSelect")
  document.getElementById("histYearWrap")?.classList.remove("hidden")
  document.getElementById("histExitBtn")?.classList.remove("hidden")
  document.getElementById("periodLabel")?.classList.add("hidden")
  try {
    const data = await fetchAllRows(() => supabaseClient
      .from("historical_actuals")
      .select("period_month")
      .order("period_month", { ascending: false }))
    const years = [...new Set((data || []).map((r) => String(r.period_month).slice(0, 4)))]
    if (!years.length) {
      showToast("Sin histórico", "No hay datos históricos cargados todavía.", "warning")
      return
    }
    if (sel) {
      sel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("") +
        `<option value="todos">Todos los años</option>`
      sel.value = years[0]
    }
    await enterHistYear(Number(years[0]))
  } catch (err) {
    showToast("Error", friendlyError(err), "danger")
  }
}

async function loadHistMapeo() {
  // Estructura tipo presupuesto: cuenta CONTPAQ → partida/grupo del forecast.
  // Si las tablas del mapper no existen aún (DDL pendiente), cae a vista por cuenta.
  state.histMapeo = new Map()
  try {
    const [mapR, catR] = await Promise.all([
      supabaseClient.from("budget_account_mappings").select("budget_category_id,contpaq_account_code").limit(2000),
      supabaseClient.from("budget_categories").select("id,name,category").limit(500),
    ])
    if (mapR.error || catR.error) return
    const cats = new Map((catR.data || []).map((c) => [c.id, c]))
    for (const m of mapR.data || []) {
      const cat = cats.get(m.budget_category_id)
      if (cat) state.histMapeo.set(m.contpaq_account_code, { partida: cat.name, grupo: cat.category || "Sin grupo" })
    }
  } catch (_) { /* mapper aún no instalado en esta base */ }
}

function r2c(v) { return Math.round(v * 100) / 100 }

async function enterAllYears() {
  state.histYear = "todos"
  const sub = document.getElementById("chartSubtitle")
  if (sub) sub.textContent = "Cargando todos los años..."
  try {
    const data = await fetchAllRows(() => supabaseClient
      .from("historical_actuals")
      .select("account_code,account_name,period_month,amount")
      .order("period_month"))
    const anios = {}
    const cuentas = new Map()
    for (const r of data || []) {
      const y = String(r.period_month).slice(0, 4)
      anios[y] = anios[y] || { ingresos: 0, egresos: 0 }
      const fam = String(r.account_code || "")[0]
      if (fam === "4") anios[y].ingresos += num(r.amount)
      else if (fam === "6") anios[y].egresos += num(r.amount)
      if (fam === "4" || fam === "6") {
        const c = cuentas.get(r.account_code) || { nombre: r.account_name || "", fam, meses: {}, total: 0 }
        c.meses[y] = (c.meses[y] || 0) + num(r.amount)
        c.total += num(r.amount)
        cuentas.set(r.account_code, c)
      }
    }
    const yy = Object.keys(anios).sort()
    // por AÑO sobrepuesto: 12 meses en X, una serie por año (egresos sólida, ingresos punteada)
    const porAnioMes = {}
    for (const r of data || []) {
      const y = String(r.period_month).slice(0, 4)
      const m = Number(String(r.period_month).slice(5, 7))
      porAnioMes[y] = porAnioMes[y] || {}
      porAnioMes[y][m] = porAnioMes[y][m] || { ingresos: 0, egresos: 0 }
      const fam = String(r.account_code || "")[0]
      if (fam === "4") porAnioMes[y][m].ingresos += num(r.amount)
      else if (fam === "6") porAnioMes[y][m].egresos += num(r.amount)
    }
    if (sub) sub.textContent = "Todos los años sobrepuestos · mensual · contabilidad CONTPAQ"
    state.histCuentas = { periodos: yy, etiquetas: yy, cuentas, titulo: "Histórico por cuenta — todos los años" }
    drawYearsOverlayChart(yy, porAnioMes)
    renderAllYearsTable(yy, anios)
    renderHistKpisTotales(yy, anios)
    renderHistCuentas()
    enterHistLayout()
    setYearsOverlayLegend(yy)
  } catch (err) {
    if (sub) sub.textContent = "No se pudo cargar"
    showToast("Error al cargar histórico", friendlyError(err), "danger")
  }
}

const YEAR_COLORS = ["rgba(148,163,175,VAR)", "rgba(74,124,109,VAR)", "rgba(245,158,11,VAR)", "rgba(46,144,250,VAR)", "rgba(224,62,82,VAR)"]

function drawYearsOverlayChart(yy, porAnioMes) {
  const canvas = document.getElementById("mainChart")
  if (!canvas) return
  const isDark = document.documentElement.dataset.theme !== "light"
  const gridColor = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"
  const tickColor = isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)"
  const labels = Array.from({ length: 12 }, (_, i) =>
    new Date(2000, i, 1).toLocaleDateString("es-MX", { month: "short" }))
  const datasets = []
  yy.forEach((y, i) => {
    const color = (a) => YEAR_COLORS[i % YEAR_COLORS.length].replace("VAR", a)
    const serie = (campo) => Array.from({ length: 12 }, (_, m) => {
      const v = porAnioMes[y]?.[m + 1]?.[campo]
      return v === undefined ? null : r2c(v)
    })
    datasets.push({ type: "line", label: `Egresos ${y}`, data: serie("egresos"), borderColor: color(".9"), backgroundColor: color(".9"), borderWidth: 2, pointRadius: 2.5, tension: 0.25, fill: false, spanGaps: false })
    datasets.push({ type: "line", label: `Ingresos ${y}`, data: serie("ingresos"), borderColor: color(".55"), backgroundColor: color(".55"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 2, tension: 0.25, fill: false, spanGaps: false })
  })
  if (state.chart) state.chart.destroy()
  state.chart = new Chart(canvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? "#152119" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)",
          borderWidth: 1,
          titleColor: isDark ? "#f7f7f5" : "#15211d",
          bodyColor: isDark ? "#b4c1ba" : "#4d5f58",
          callbacks: { label: (ctx) => ctx.raw === null ? null : ` ${ctx.dataset.label}: ${moneyFmt.format(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 }, callback: (v) => `$${(v / 1000).toFixed(0)}k` } },
      },
    },
  })
}

function setYearsOverlayLegend(yy) {
  const legend = document.querySelector(".chart-legend")
  if (!legend) return
  if (!state.legendOriginal) state.legendOriginal = legend.innerHTML
  legend.innerHTML = yy.map((y, i) => {
    const color = YEAR_COLORS[i % YEAR_COLORS.length].replace("VAR", ".9")
    return `<div class="chart-legend-item"><div class="chart-legend-dot" style="background:${color}"></div>${y}</div>`
  }).join("") + `<div class="chart-legend-item" style="color:var(--text-3)">sólida = egresos · punteada = ingresos</div>`
}

function renderAllYearsTable(yy, anios) {
  const head = document.getElementById("histTableHead")
  const body = document.getElementById("histTableBody")
  const foot = document.getElementById("histTableFoot")
  const title = document.getElementById("histPanelTitle")
  if (title) title.textContent = "Comparativo anual"
  if (head) head.innerHTML = `<tr><th>Año</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Egresos</th><th style="text-align:right">Neto</th><th style="text-align:right">Δ Ingresos</th></tr>`
  if (!body) return
  let ti = 0, te = 0
  body.innerHTML = yy.map((y, i) => {
    const { ingresos, egresos } = anios[y]
    ti += ingresos; te += egresos
    const neto = ingresos - egresos
    const prev = i > 0 ? anios[yy[i - 1]].ingresos : null
    const delta = prev ? ((ingresos - prev) / prev) * 100 : null
    return `<tr>
      <td><span class="cell-main">${y}</span></td>
      <td style="text-align:right">${moneyFmt.format(ingresos)}</td>
      <td style="text-align:right">${moneyFmt.format(egresos)}</td>
      <td style="text-align:right;color:${neto >= 0 ? "var(--emerald)" : "var(--ruby)"}">${moneyFmt.format(neto)}</td>
      <td style="text-align:right;color:${delta === null ? "var(--text-3)" : delta >= 0 ? "var(--emerald)" : "var(--ruby)"}">${delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`}</td>
    </tr>`
  }).join("")
  const netoT = ti - te
  if (foot) foot.innerHTML = `<tr>
    <td style="font-weight:800">Total</td>
    <td style="text-align:right;font-weight:800">${moneyFmt.format(ti)}</td>
    <td style="text-align:right;font-weight:800">${moneyFmt.format(te)}</td>
    <td style="text-align:right;font-weight:800;color:${netoT >= 0 ? "var(--emerald)" : "var(--ruby)"}">${moneyFmt.format(netoT)}</td>
    <td></td>
  </tr>`
}

function renderHistKpisTotales(yy, anios) {
  let ti = 0, te = 0
  for (const y of yy) { ti += anios[y].ingresos; te += anios[y].egresos }
  const neto = ti - te
  const set = (id, v, color) => {
    const el = document.getElementById(id)
    if (el) { el.textContent = moneyFmt.format(v); if (color) el.style.color = color }
  }
  set("histKpiIngresos", ti)
  set("histKpiEgresos", te)
  set("histKpiNeto", neto, neto >= 0 ? "var(--emerald)" : "var(--ruby)")
  set("histKpiPromedio", yy.length ? te / yy.length : 0)
}

async function enterHistYear(year) {
  state.histYear = year
  const sub = document.getElementById("chartSubtitle")
  if (sub) sub.textContent = `Cargando histórico ${year}...`
  try {
    const data = await fetchAllRows(() => supabaseClient
      .from("historical_actuals")
      .select("account_code,account_name,period_month,amount")
      .gte("period_month", `${year}-01-01`)
      .lt("period_month", `${year + 1}-01-01`)
      .order("period_month"))
    const meses = {}
    const cuentas = new Map()
    for (const r of data || []) {
      const m = Number(String(r.period_month).slice(5, 7))
      meses[m] = meses[m] || { ingresos: 0, egresos: 0 }
      const fam = String(r.account_code || "")[0]
      if (fam === "4") meses[m].ingresos += num(r.amount)
      else if (fam === "6") meses[m].egresos += num(r.amount)
      if (fam === "4" || fam === "6") {
        const c = cuentas.get(r.account_code) || { nombre: r.account_name || "", fam, meses: {}, total: 0 }
        c.meses[m] = (c.meses[m] || 0) + num(r.amount)
        c.total += num(r.amount)
        cuentas.set(r.account_code, c)
      }
    }
    const mm = Object.keys(meses).map(Number).sort((a, b) => a - b)
    const labels = mm.map((m) => new Date(year, m - 1, 1).toLocaleDateString("es-MX", { month: "short" }))
    const ingresos = mm.map((m) => Math.round(meses[m].ingresos * 100) / 100)
    const egresos  = mm.map((m) => Math.round(meses[m].egresos * 100) / 100)
    if (sub) sub.textContent = `Histórico ${year} · contabilidad CONTPAQ`
    state.histCuentas = { periodos: mm, etiquetas: labels, cuentas, titulo: `Histórico por cuenta — ${year}` }
    drawHistChart(labels, ingresos, egresos)
    renderHistTable(year, mm, meses)
    renderHistKpis(year, meses, mm)
    renderHistCuentas()
    enterHistLayout()
    setHistLegend(true)
  } catch (err) {
    if (sub) sub.textContent = "No se pudo cargar el histórico"
    showToast("Error al cargar histórico", friendlyError(err), "danger")
    state.histYear = null
  }
}

function exitHistYear() {
  if (!state.histYear) return
  state.histYear = null
  document.getElementById("histGrid")?.classList.add("hidden")
  document.getElementById("histKpiStrip")?.classList.add("hidden")
  document.getElementById("kpiGrid")?.classList.remove("hidden")
  const dashGrid = document.getElementById("dashGrid")
  dashGrid?.classList.remove("hidden")
  const card = document.getElementById("memberCard")
  if (card && dashGrid && card.parentElement?.id === "histMemberSlot") {
    dashGrid.insertBefore(card, dashGrid.firstElementChild)
    card.classList.remove("compact-rows")
  }
  document.getElementById("histCuentasPanel")?.classList.add("hidden")
  document.getElementById("tabsBlock")?.classList.remove("hidden")
  showTab(state.activeTab || "expenses")
  setHistLegend(false)
}

function enterHistLayout() {
  document.getElementById("histGrid")?.classList.remove("hidden")
  document.getElementById("kpiGrid")?.classList.add("hidden")
  document.getElementById("histKpiStrip")?.classList.remove("hidden")
  document.getElementById("dashGrid")?.classList.add("hidden")
  document.getElementById("histCuentasPanel")?.classList.remove("hidden")
  document.getElementById("tabsBlock")?.classList.add("hidden")
  ;["expenses", "ytd", "income", "cash", "incidents"].forEach((id) =>
    document.getElementById(`${id}Tab`)?.classList.add("hidden"))
  const card = document.getElementById("memberCard")
  const slot = document.getElementById("histMemberSlot")
  if (card && slot && card.parentElement !== slot) {
    slot.appendChild(card)
    card.classList.add("compact-rows")
  }
}

function renderHistKpis(year, meses, mm) {
  let ti = 0, te = 0
  for (const m of mm) { ti += meses[m].ingresos; te += meses[m].egresos }
  const neto = ti - te
  const set = (id, v, color) => {
    const el = document.getElementById(id)
    if (el) { el.textContent = moneyFmt.format(v); if (color) el.style.color = color }
  }
  set("histKpiIngresos", ti)
  set("histKpiEgresos", te)
  set("histKpiNeto", neto, neto >= 0 ? "var(--emerald)" : "var(--ruby)")
  set("histKpiPromedio", mm.length ? te / mm.length : 0)
}

function renderHistCuentas() {
  const tabla = document.getElementById("histCuentasTable")
  if (!tabla || !state.histCuentas) return
  const { periodos, etiquetas, cuentas, titulo } = state.histCuentas
  const titleEl = document.getElementById("histCuentasTitle")
  if (titleEl) titleEl.textContent = titulo
  const fmtK = (v) => (v === 0 ? "—" : moneyFmt.format(v))
  const r2 = (v) => Math.round(v * 100) / 100
  const celdas = (obj) => periodos.map((k) => `<td style="text-align:right;white-space:nowrap">${fmtK(r2(obj[k] || 0))}</td>`).join("")

  const fila = (nombre, meta, meses, total, opts = {}) => `<tr style="${opts.style || ""}">
    <td class="hist-cuenta-col" ${opts.title ? `title="${safe(opts.title)}"` : ""}>${opts.pad ? '<span style="display:inline-block;width:14px"></span>' : ""}<span class="cell-main">${safe(nombre)}</span>${meta ? `<span class="muted-line">${safe(meta)}</span>` : ""}</td>
    ${celdas(meses)}
    <td style="text-align:right;font-weight:700;white-space:nowrap">${moneyFmt.format(r2(total))}</td>
  </tr>`

  const headerRow = (texto, colorVar) =>
    `<tr><td colspan="${periodos.length + 2}" style="padding:9px 14px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:${colorVar};background:var(--bg-hover)">${texto}</td></tr>`

  // ── Ingresos: por cuenta (sin estructura de presupuesto) ──
  const listaIng = [...cuentas.entries()].filter(([, c]) => c.fam === "4").sort((a, b) => b[1].total - a[1].total)
  let htmlIng = ""
  if (listaIng.length) {
    const sub = {}; let tot = 0
    for (const [, c] of listaIng) { tot += c.total; for (const k of periodos) sub[k] = (sub[k] || 0) + (c.meses[k] || 0) }
    htmlIng = headerRow("Ingresos", "var(--emerald)") +
      listaIng.map(([code, c]) => fila(c.nombre, null, c.meses, c.total, { title: code })).join("") +
      fila("Total ingresos", null, sub, tot, { style: "font-weight:800" })
  }

  // ── Egresos: estructura del presupuesto (grupo → partida) usando el mapeo ──
  const mapeo = state.histMapeo || new Map()
  const grupos = new Map() // grupo → { partidas: Map(partida → {meses,total}), meses, total }
  const sinMapear = []
  for (const [code, c] of [...cuentas.entries()].filter(([, x]) => x.fam === "6")) {
    const destino = mapeo.get(code.replace(/-/g, ""))
    if (!destino) { sinMapear.push([code, c]); continue }
    const g = grupos.get(destino.grupo) || { partidas: new Map(), meses: {}, total: 0 }
    const pa = g.partidas.get(destino.partida) || { meses: {}, total: 0 }
    for (const k of periodos) { const v = c.meses[k] || 0; pa.meses[k] = (pa.meses[k] || 0) + v; g.meses[k] = (g.meses[k] || 0) + v }
    pa.total += c.total; g.total += c.total
    g.partidas.set(destino.partida, pa)
    grupos.set(destino.grupo, g)
  }
  let htmlEgr = ""
  let totEgr = 0; const subEgr = {}
  const acum = (meses, total) => { totEgr += total; for (const k of periodos) subEgr[k] = (subEgr[k] || 0) + (meses[k] || 0) }
  if (grupos.size) {
    htmlEgr += headerRow("Egresos · estructura del presupuesto", "var(--accent-text)")
    let gi = 0
    for (const [grupo, g] of [...grupos.entries()].sort((a, b) => b[1].total - a[1].total)) {
      gi++
      htmlEgr += `<tr class="hist-grupo" data-grupo="${gi}" style="font-weight:800;background:var(--bg-hover)">
        <td class="hist-cuenta-col" style="background:linear-gradient(var(--bg-hover),var(--bg-hover)),var(--bg-card)"><span style="display:flex;align-items:center;gap:6px;white-space:nowrap"><span class="hist-caret">▶</span><span class="cell-main">${safe(grupo)}</span><span class="muted-line" style="display:inline;margin:0;white-space:nowrap">· ${g.partidas.size} partida${g.partidas.size === 1 ? "" : "s"}</span></span></td>
        ${celdas(g.meses)}
        <td style="text-align:right;font-weight:800;white-space:nowrap">${moneyFmt.format(r2(g.total))}</td>
      </tr>`
      for (const [partida, pa] of [...g.partidas.entries()].sort((a, b) => b[1].total - a[1].total)) {
        htmlEgr += `<tr class="hist-sub hidden" data-grupo-de="${gi}">
          <td class="hist-cuenta-col"><span class="cell-main">${safe(partida)}</span></td>
          ${celdas(pa.meses)}
          <td style="text-align:right;font-weight:700;white-space:nowrap">${moneyFmt.format(r2(pa.total))}</td>
        </tr>`
      }
      acum(g.meses, g.total)
    }
  }
  if (sinMapear.length) {
    htmlEgr += headerRow(grupos.size ? "Fuera del presupuesto (cuentas sin partida)" : "Egresos", "var(--amber)")
    sinMapear.sort((a, b) => b[1].total - a[1].total)
    for (const [code, c] of sinMapear) { htmlEgr += fila(c.nombre, grupos.size ? "sin partida" : null, c.meses, c.total, { title: code }); acum(c.meses, c.total) }
  }
  if (htmlEgr) htmlEgr += fila("Total egresos", null, subEgr, totEgr, { style: "font-weight:800" })

  tabla.innerHTML = `
    <thead><tr>
      <th class="hist-cuenta-col">Cuenta / partida</th>
      ${etiquetas.map((l) => `<th style="text-align:right;text-transform:capitalize">${l}</th>`).join("")}
      <th style="text-align:right">Total</th>
    </tr></thead>
    <tbody>${htmlIng}${htmlEgr}</tbody>`
  tabla.querySelectorAll("tr.hist-grupo").forEach((row) => {
    row.addEventListener("click", () => {
      const abierto = row.classList.toggle("abierto")
      tabla.querySelectorAll(`tr[data-grupo-de="${row.dataset.grupo}"]`).forEach((sub) =>
        sub.classList.toggle("hidden", !abierto))
    })
  })
}

function setHistLegend(on) {
  const legend = document.querySelector(".chart-legend")
  if (!legend) return
  if (on) {
    if (!state.legendOriginal) state.legendOriginal = legend.innerHTML
    legend.innerHTML = `
      <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(74,124,109,.85)"></div>Egresos</div>
      <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(16,185,129,.9)"></div>Ingresos</div>
      ${on === "todos" ? `<div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(245,158,11,.9)"></div>Neto</div>` : ""}
    `
  } else if (state.legendOriginal) {
    legend.innerHTML = state.legendOriginal
  }
}

function drawHistChart(labels, ingresos, egresos) {
  const canvas = document.getElementById("mainChart")
  if (!canvas) return
  const isDark = document.documentElement.dataset.theme !== "light"
  const gridColor = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"
  const tickColor = isDark ? "rgba(255,255,255,.35)" : "rgba(0,0,0,.4)"
  if (state.chart) state.chart.destroy()
  state.chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Egresos", data: egresos, backgroundColor: "rgba(74,124,109,.8)", borderColor: "rgba(74,124,109,.95)", borderWidth: 1, borderRadius: 4, order: 1 },
        { type: "line", label: "Ingresos", data: ingresos, borderColor: "rgba(16,185,129,.9)", borderWidth: 2, pointRadius: 3, pointBackgroundColor: "rgba(16,185,129,1)", tension: 0.3, fill: false, order: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? "#152119" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)",
          borderWidth: 1,
          titleColor: isDark ? "#f7f7f5" : "#15211d",
          bodyColor: isDark ? "#b4c1ba" : "#4d5f58",
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${moneyFmt.format(ctx.raw)}` },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 }, callback: (v) => `$${(v / 1000).toFixed(0)}k` } },
      },
    },
  })
}

function renderHistTable(year, mm, meses) {
  const panel = document.getElementById("histPanel")
  const title = document.getElementById("histPanelTitle")
  const body = document.getElementById("histTableBody")
  const foot = document.getElementById("histTableFoot")
  if (!panel || !body) return
  if (title) title.textContent = `Histórico ${year} — mensual`
  const head = document.getElementById("histTableHead")
  if (head) head.innerHTML = `<tr><th>Mes</th><th style="text-align:right">Ingresos</th><th style="text-align:right">Egresos</th><th style="text-align:right">Neto</th></tr>`
  let ti = 0, te = 0
  body.innerHTML = mm.map((m) => {
    const { ingresos, egresos } = meses[m]
    ti += ingresos; te += egresos
    const neto = ingresos - egresos
    const nombre = new Date(year, m - 1, 1).toLocaleDateString("es-MX", { month: "long" })
    return `<tr>
      <td><span class="cell-main" style="text-transform:capitalize">${nombre}</span></td>
      <td style="text-align:right">${moneyFmt.format(ingresos)}</td>
      <td style="text-align:right">${moneyFmt.format(egresos)}</td>
      <td style="text-align:right;color:${neto >= 0 ? "var(--emerald)" : "var(--ruby)"}">${moneyFmt.format(neto)}</td>
    </tr>`
  }).join("")
  const netoT = ti - te
  if (foot) foot.innerHTML = `<tr>
    <td style="font-weight:800">Total ${year}</td>
    <td style="text-align:right;font-weight:800">${moneyFmt.format(ti)}</td>
    <td style="text-align:right;font-weight:800">${moneyFmt.format(te)}</td>
    <td style="text-align:right;font-weight:800;color:${netoT >= 0 ? "var(--emerald)" : "var(--ruby)"}">${moneyFmt.format(netoT)}</td>
  </tr>`
  panel.classList.remove("hidden")
}

function updateChartTheme() {
  if (!state.chart) return
  const isDark    = document.documentElement.dataset.theme !== "light"
  const gridColor = isDark ? "rgba(255,255,255,.06)" : "rgba(0,0,0,.07)"
  const tickColor = isDark ? "rgba(255,255,255,.35)"  : "rgba(0,0,0,.4)"
  const scales    = state.chart.options.scales
  ;["x", "y", "y2"].forEach((key) => {
    if (scales[key]?.grid)  scales[key].grid.color  = gridColor
    if (scales[key]?.ticks) scales[key].ticks.color = tickColor
    if (scales[key]?.title) scales[key].title.color = tickColor
  })
  state.chart.update()
}

// ─── Dialogs ─────────────────────────────────────────────────────────────────

async function openHistory() {
  document.getElementById("historyDialog")?.showModal()
  try {
    const { data, error } = await supabaseClient
      .from("monthly_closures")
      .select("id,period_key,status,closed_at,sheet_url,slides_url,pdf_url")
      .order("period_key", { ascending: false })
      .limit(24)
    if (error) throw error
    const tbody = document.getElementById("historyTableBody")
    if (!tbody) return
    if (!(data || []).length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:44px;text-align:center;color:var(--text-3)">Sin cierres registrados.</td></tr>`
      return
    }
    tbody.innerHTML = (data || []).map((r) => `
      <tr>
        <td><span class="cell-main">${safe(r.period_key)}</span></td>
        <td>${closureStatusBadge(r.status)}</td>
        <td>${r.closed_at ? fmtDateTime(r.closed_at) : "—"}</td>
        <td>${linkOrDash(r.sheet_url)}</td>
        <td>${linkOrDash(r.slides_url)}</td>
        <td>${linkOrDash(r.pdf_url)}</td>
      </tr>
    `).join("")
  } catch (err) {
    showToast("Error", friendlyError(err), "danger")
  }
}

function openExport() {
  const close = state.kpis.cierre || {}
  const links = [
    ["Sheet existente", close.sheet_url],
    ["Reporte Slides",  close.slides_url],
    ["PDF existente",   close.pdf_url],
  ].filter(([, url]) => isRealUrl(url))
  const linksEl = document.getElementById("exportLinks")
  if (linksEl) {
    linksEl.innerHTML = links.length
      ? links.map(([l, url]) => `<div class="summary-row"><span>${l}</span><strong><a href="${esc(url)}" target="_blank" rel="noopener">Abrir</a></strong></div>`).join("")
      : `<p style="font-size:12.5px;color:var(--text-3);padding:4px 0">La exportacion a Google Drive se conectara mediante n8n.</p>`
  }
  document.getElementById("exportDialog")?.showModal()
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showTab(name) {
  state.activeTab = name
  document.querySelectorAll(".section-tab").forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.tab === name)
  )
  ;["expenses", "ytd", "income", "cash", "incidents"].forEach((id) => {
    document.getElementById(`${id}Tab`)?.classList.toggle("hidden", id !== name)
  })
}

function clearFilter() {
  document.getElementById("filterStrip")?.classList.add("hidden")
}

function setLoading(on) {
  const btn = document.getElementById("refreshBtn")
  if (btn) { btn.disabled = on; btn.textContent = on ? "Cargando..." : "Actualizar" }
}

function setEl(id, html) {
  const el = document.getElementById(id)
  if (el) el.innerHTML = html
}

function setBar(id, pctValue) {
  const el = document.getElementById(id)
  if (el) el.style.width = `${Math.max(0, Math.min(100, pctValue))}%`
}

function populateSelect(id, label, values) {
  const sel = document.getElementById(id)
  if (!sel) return
  const current = sel.value || "todos"
  sel.innerHTML = `<option value="todos">${label}: Todos</option>` +
    values.map((v) => `<option value="${norm(v)}">${esc(v)}</option>`).join("")
  sel.value = [...sel.options].some((o) => o.value === current) ? current : "todos"
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function incomeStatusBadge(status) {
  const map = {
    pending: ["Pendiente", "warning"],
    partial: ["Parcial",   "warning"],
    paid:    ["Pagado",    "success"],
    overdue: ["Vencido",   "danger"],
  }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

function closureStatusBadge(status) {
  const map = {
    open:        ["Abierto",    "info"],
    review:      ["En revision","warning"],
    closed:      ["Cerrado",    "success"],
    cancelled:   ["Cancelado",  "neutral"],
    not_created: ["Sin cierre", "neutral"],
  }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function money(v)     { return moneyFmt.format(num(v)) }
function whole(v)     { return numFmt.format(num(v)) }
function pct(v)       { return `${pctFmt.format(num(v))}%` }
function num(v)       { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function ensureArray(v) { return Array.isArray(v) ? v : [] }
function unique(arr)  { return [...new Set(arr.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, "es")) }
function norm(v)      { return String(v || "").trim().toLowerCase().replace(/\s+/g, "-") }
function safe(v, fb = "—") { return esc(v === null || v === undefined || v === "" ? fb : String(v)) }
function esc(v)       { return String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])) }
function isRealUrl(url) {
  if (!url || !/^https?:\/\//i.test(url.trim())) return false;
  // Filtrar URLs de ejemplo/placeholder que solo generarían 404
  if (/example[-_]/i.test(url) || /\/example$/i.test(url)) return false;
  return true;
}
function linkOrDash(url) {
  return isRealUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">Abrir</a>` : "—";
}

function fmtDateTime(v) {
  if (!v) return "—"
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("es-MX", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function currentPeriodKey() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`
}

function setDefaultPeriod() {
  const input = document.getElementById("periodInput")
  if (input) { input.value = currentPeriodKey(); state.periodKey = input.value }
}

function normalize(data) {
  if (!data) return {}
  if (typeof data === "string") { try { return JSON.parse(data) } catch (_) { return {} } }
  return data
}

function friendlyError(err) {
  const raw = String(err?.message || err || "")
  if (raw.includes("not_allowed_to_view_dashboard")) return "No tienes permiso para consultar el Dashboard."
  if (raw.includes("period_key_required")) return "Selecciona un periodo valido."
  if (raw.includes("JWT") || raw.includes("permission") || raw.includes("policy")) return "Sin permiso para esta accion."
  return raw || "No se pudo cargar la informacion."
}

function showToast(title, desc, variant = "success") {
  Components.showToast({ title, desc, variant, duration: 6 })
}

async function fetchAllRows(builderFactory, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await builderFactory().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}
