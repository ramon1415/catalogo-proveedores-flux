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

  if (window.Components?.buildNav) window.Components.buildNav("dashboard")

  await loadDashboard()
}

function bindEvents() {
  document.getElementById("refreshBtn")?.addEventListener("click", loadDashboard)
  document.getElementById("periodInput")?.addEventListener("change", loadDashboard)
  document.getElementById("historyBtn")?.addEventListener("click", openHistory)
  document.getElementById("histYearsBtn")?.addEventListener("click", toggleHistYearsMenu)
  document.getElementById("histExitBtn")?.addEventListener("click", () => { exitHistYear(); loadDashboard() })
  document.getElementById("histViewMensual")?.addEventListener("click", () => setHistView("mensual"))
  document.getElementById("histViewCuentas")?.addEventListener("click", () => setHistView("cuentas"))
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("histYearsMenu")
    if (menu && !menu.classList.contains("hidden") && !e.target.closest("#histYearsBtn") && !e.target.closest("#histYearsMenu")) menu.classList.add("hidden")
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
  exitHistYear()
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
    // load yearly chart in background
    loadYearlyChart()
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
          backgroundColor: isDark ? "#1a1a2e" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)",
          borderWidth: 1,
          titleColor: isDark ? "#eeeef6" : "#10111f",
          bodyColor: isDark ? "#aaaac3" : "#50506a",
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

async function toggleHistYearsMenu() {
  const menu = document.getElementById("histYearsMenu")
  if (!menu) return
  if (!menu.classList.contains("hidden")) { menu.classList.add("hidden"); return }
  menu.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--text-3)">Cargando años...</div>`
  menu.classList.remove("hidden")
  try {
    const { data, error } = await supabaseClient
      .from("historical_actuals")
      .select("period_month")
      .order("period_month", { ascending: true })
      .limit(5000)
    if (error) throw error
    const years = [...new Set((data || []).map((r) => String(r.period_month).slice(0, 4)))]
    if (!years.length) {
      menu.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--text-3)">Sin histórico cargado.</div>`
      return
    }
    const item = (label, onclickAttr) =>
      `<button type="button" class="secondary-btn" data-hist-year="${onclickAttr}" style="justify-content:flex-start;border:0;font-size:12.5px">${label}</button>`
    menu.innerHTML = `
      <div style="padding:4px 10px 6px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--text-3)">Histórico</div>
      ${years.map((y) => item(`Año ${y}`, y)).join("")}
      <div style="border-top:1px solid var(--border);margin:4px 0"></div>
      ${item("Año en curso", "actual")}
    `
    menu.querySelectorAll("[data-hist-year]").forEach((btn) => btn.addEventListener("click", () => {
      menu.classList.add("hidden")
      const y = btn.dataset.histYear
      if (y === "actual") { exitHistYear(); loadDashboard() } else enterHistYear(Number(y))
    }))
  } catch (err) {
    menu.innerHTML = `<div style="padding:8px 10px;font-size:11px;color:var(--ruby)">Error: ${safe(friendlyError(err))}</div>`
  }
}

async function enterHistYear(year) {
  state.histYear = year
  const sub = document.getElementById("chartSubtitle")
  if (sub) sub.textContent = `Cargando histórico ${year}...`
  try {
    const { data, error } = await supabaseClient
      .from("historical_actuals")
      .select("account_code,period_month,amount")
      .gte("period_month", `${year}-01-01`)
      .lt("period_month", `${year + 1}-01-01`)
      .limit(10000)
    if (error) throw error
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
    state.histCuentas = { year, mm, cuentas }
    drawHistChart(labels, ingresos, egresos)
    renderHistTable(year, mm, meses)
    renderHistKpis(year, meses, mm)
    renderHistCuentas()
    enterHistLayout()
    setHistView("mensual")
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
  setHistLegend(false)
}

function enterHistLayout() {
  document.getElementById("histGrid")?.classList.remove("hidden")
  document.getElementById("kpiGrid")?.classList.add("hidden")
  document.getElementById("histKpiStrip")?.classList.remove("hidden")
  document.getElementById("dashGrid")?.classList.add("hidden")
  const card = document.getElementById("memberCard")
  const slot = document.getElementById("histMemberSlot")
  if (card && slot && card.parentElement !== slot) {
    slot.appendChild(card)
    card.classList.add("compact-rows")
  }
}

function setHistView(view) {
  const mensual = document.getElementById("histMensualWrap")
  const cuentasW = document.getElementById("histCuentasWrap")
  const grid = document.getElementById("histGrid")
  const slot = document.getElementById("histMemberSlot")
  const on = view === "cuentas"
  mensual?.classList.toggle("hidden", on)
  cuentasW?.classList.toggle("hidden", !on)
  grid?.classList.toggle("full", on)
  slot?.classList.toggle("hidden", on)
  document.getElementById("histViewMensual")?.style.setProperty("background", on ? "transparent" : "var(--accent-dim)")
  document.getElementById("histViewCuentas")?.style.setProperty("background", on ? "var(--accent-dim)" : "transparent")
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
  const { year, mm, cuentas } = state.histCuentas
  const mesesCorto = mm.map((m) => new Date(year, m - 1, 1).toLocaleDateString("es-MX", { month: "short" }))
  const fmtK = (v) => (v === 0 ? "—" : moneyFmt.format(v))
  const filaCuenta = ([code, c]) => `<tr>
    <td class="hist-cuenta-col"><span class="cell-main">${safe(c.nombre)}</span><span class="muted-line">${safe(code)}</span></td>
    ${mm.map((m) => `<td style="text-align:right;white-space:nowrap">${fmtK(Math.round((c.meses[m] || 0) * 100) / 100)}</td>`).join("")}
    <td style="text-align:right;font-weight:700;white-space:nowrap">${moneyFmt.format(Math.round(c.total * 100) / 100)}</td>
  </tr>`
  const seccion = (titulo, fam, colorVar) => {
    const lista = [...cuentas.entries()].filter(([, c]) => c.fam === fam).sort((a, b) => b[1].total - a[1].total)
    if (!lista.length) return ""
    const sub = mm.map((m) => lista.reduce((s, [, c]) => s + (c.meses[m] || 0), 0))
    const tot = lista.reduce((s, [, c]) => s + c.total, 0)
    return `
      <tr><td colspan="${mm.length + 2}" style="padding:9px 14px;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:${colorVar};background:var(--bg-hover)">${titulo}</td></tr>
      ${lista.map(filaCuenta).join("")}
      <tr style="font-weight:800">
        <td class="hist-cuenta-col">Total ${titulo.toLowerCase()}</td>
        ${sub.map((v) => `<td style="text-align:right;white-space:nowrap">${moneyFmt.format(Math.round(v * 100) / 100)}</td>`).join("")}
        <td style="text-align:right;white-space:nowrap">${moneyFmt.format(Math.round(tot * 100) / 100)}</td>
      </tr>`
  }
  tabla.innerHTML = `
    <thead><tr>
      <th class="hist-cuenta-col">Cuenta</th>
      ${mesesCorto.map((l) => `<th style="text-align:right;text-transform:capitalize">${l}</th>`).join("")}
      <th style="text-align:right">Total</th>
    </tr></thead>
    <tbody class="compact-rows">
      ${seccion("Ingresos", "4", "var(--emerald)")}
      ${seccion("Egresos", "6", "var(--accent-text)")}
    </tbody>`
}

function setHistLegend(on) {
  const legend = document.querySelector(".chart-legend")
  if (!legend) return
  if (on) {
    if (!state.legendOriginal) state.legendOriginal = legend.innerHTML
    legend.innerHTML = `
      <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(74,124,109,.85)"></div>Egresos</div>
      <div class="chart-legend-item"><div class="chart-legend-dot" style="background:rgba(16,185,129,.9)"></div>Ingresos</div>
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
          backgroundColor: isDark ? "#1a1a2e" : "#fff",
          borderColor: isDark ? "rgba(255,255,255,.12)" : "rgba(0,0,0,.1)",
          borderWidth: 1,
          titleColor: isDark ? "#eeeef6" : "#10111f",
          bodyColor: isDark ? "#aaaac3" : "#50506a",
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
