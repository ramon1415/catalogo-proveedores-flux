import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { usesPropertyIncidents } from '../../lib/tenantConfig'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { TableSkeletonRows, Skeleton } from '../../components/ui/Skeleton'
import {
  fetchDashboardPayload, fetchHistoricalPeriods, fetchHistoricalYear, fetchHistoricalAll, loadHistMapeo,
} from './api'
import { useOperationalDashboard, useDashboardActivity } from './useOperationalDashboard'
import {
  toDashboardState, currentPeriodKey, fmtDateTime, friendlyError, canViewDashboard,
  filterMembers, incomeStatusBadge,
  money, whole, pct, num,
  aggregateHistYear, aggregateHistAll, histKpisTotals, buildHistMatrix, fmtCell, fmtMoney0, yearColor,
  aggregateBudget, budgetMonthLabel, BUDGET_ALL_PERIOD, filterBudgetPartidas, aggregateDashboardActivity,
  aggregateRequests, aggregateTaxes, requestAmountLabel,
} from './logic'
import type {
  DashboardState, SectionTab, HistMapeo, BudgetPartida,
  RequestsAggregate, TaxesAggregate, RequestStage,
} from './types'
import type { HistMatrix } from './logic'
import type { Serie } from './charts'
import { ComboChart } from './charts'
import { HistoryModal } from './HistoryModal'
import { ExportModal } from './ExportModal'
import s from './Dashboard.module.css'

// Colores de series (idénticos a Chart.js del vanilla).
const C = {
  presupFill: 'rgba(74,124,109,.22)', presupBorder: 'rgba(74,124,109,.55)',
  ejecFill: 'rgba(74,124,109,.8)', ejecBorder: 'rgba(74,124,109,.95)',
  esperado: 'rgba(16,185,129,.45)', cobrado: 'rgba(16,185,129,.9)',
}

type ChartModel = { labels: string[]; series: Serie[]; subtitle: string; empty?: boolean; incomeIncomplete?: boolean }
type AlertTone = 'danger' | 'warning' | 'info'
type AlertItem = { tone: AlertTone; value: string; label: string; target: string }
type LegendItem = { color: string; label: string; dashed?: boolean; light?: boolean; note?: boolean; kind?: 'bar' | 'line' }

// Enfoca/scrollea a una sección por id (alertas accionables). No-op si no existe.
function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
type Cell = { text: string; right?: boolean; color?: string; bold?: boolean; capitalize?: boolean }
type HistTableModel = { title: string; head: Cell[]; rows: Cell[][]; foot: Cell[] | null }
type HistKpi = { ingresos: number; egresos: number; neto: number; promedio: number }

const OPERATIVE_LEGEND: LegendItem[] = [
  { color: 'var(--op-budget-stroke)', label: 'Presupuesto', kind: 'bar', light: true },
  { color: 'var(--op-used)', label: 'Usado', kind: 'bar' },
  { color: 'var(--op-expected)', label: 'Esperado', kind: 'line', dashed: true },
  { color: 'var(--op-collected)', label: 'Cobrado', kind: 'line' },
]

const netColor = (v: number) => (v >= 0 ? 'var(--emerald)' : 'var(--ruby)')
const MONTH_LONG = (year: number, m: number) => new Date(year, m - 1, 1).toLocaleDateString('es-MX', { month: 'long' })

export default function DashboardPage() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const anualMode = pathname === '/dashboard-anual' || params.get('view') === 'anual'
  const { group } = useAuth()
  const { companyId, companyName } = useCompany()
  const showIncidents = usesPropertyIncidents(companyId)
  const { showToast } = useToast()
  const canView = canViewDashboard(group)

  // Estado operativo
  const [ds, setDs] = useState<DashboardState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [periodKey, setPeriodKey] = useState(currentPeriodKey())
  const [lastUpdated, setLastUpdated] = useState('')

  // Filtros / tabs
  const [activeTab, setActiveTab] = useState<SectionTab>('cash')
  const [memberSearch, setMemberSearch] = useState('')
  const [budgetSearch, setBudgetSearch] = useState('')

  // Anual / histórico
  const [years, setYears] = useState<string[]>([])
  const [histSel, setHistSel] = useState('')
  const [histMapeoState, setHistMapeoState] = useState<HistMapeo>(new Map())
  const [histChart, setHistChart] = useState<ChartModel | null>(null)
  const [histLegend, setHistLegend] = useState<LegendItem[]>([])
  const [histTable, setHistTable] = useState<HistTableModel | null>(null)
  const [histKpi, setHistKpi] = useState<HistKpi | null>(null)
  const [histMatrix, setHistMatrix] = useState<HistMatrix | null>(null)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  // Dialogs
  const [showHistory, setShowHistory] = useState(false)
  const [showExport, setShowExport] = useState(false)

  // Presupuesto, solicitudes e impuestos comparten empresa, año y actualización.
  const [budgetPeriod, setBudgetPeriod] = useState(`${currentPeriodKey()}-01`)
  const reportYear = Number(periodKey.slice(0, 4))
  const {
    budgetData, reqData, budgetError, reqError, loading: summaryLoading, refresh: refreshSummary, revision, loadedAt,
  } = useOperationalDashboard(companyId, reportYear, canView && !anualMode)
  const activity = useDashboardActivity(companyId, reportYear, canView && !anualMode, revision)
  const activityAgg = useMemo(() => activity.data ? aggregateDashboardActivity(activity.data, periodKey) : null, [activity.data, periodKey])
  const allLoading = summaryLoading || activity.loading
  const budgetLoading = summaryLoading
  const reqLoading = summaryLoading
  const summaryIncomplete = !companyId || budgetError || reqError || activity.error || !!activityAgg?.incomeExcluded
  const summaryMonths = useMemo(
    () => Array.from({ length: 12 }, (_, i) => `${reportYear}-${String(i + 1).padStart(2, '0')}-01`),
    [reportYear],
  )

  // En modo anual la vista histórica está activa desde el primer paint (equivalente
  // a la clase `anual-boot` del vanilla, que oculta lo operativo sin flash).
  const inHistView = anualMode

  useEffect(() => {
    document.title = anualMode ? 'Dashboard anual | Flux Operadora' : 'Dashboard operativo | Flux Operadora'
  }, [anualMode])

  // El payload histórico se conserva para la vista anual. El operativo usa
  // exclusivamente las fuentes acotadas a empresa y año de los hooks.
  const loadDashboard = useCallback(async (pk: string) => {
    setRefreshing(true)
    try {
      const payload = await fetchDashboardPayload(pk)
      setDs(toDashboardState(payload))
      setLastUpdated(`Ultima actualizacion: ${fmtDateTime(new Date())}`)
    } catch (err) {
      showToast('Error al cargar', friendlyError(err), 'error')
    } finally {
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anualMode, showToast])

  // ── Histórico ────────────────────────────────────────────────────────────────
  const enterHistYear = useCallback(async (year: number, mapeo: HistMapeo) => {
    setHistChart({ labels: [], series: [], subtitle: `Cargando histórico ${year}...` })
    try {
      if (!companyId) return
      const rows = await fetchHistoricalYear(companyId, year)
      const agg = aggregateHistYear(rows, year)
      setHistChart({
        labels: agg.labels,
        subtitle: `Histórico ${year} · contabilidad CONTPAQ`,
        series: [
          { kind: 'bar', label: 'Egresos', data: agg.egresos, color: C.ejecBorder, fill: C.ejecFill },
          { kind: 'line', label: 'Ingresos', data: agg.ingresos, color: C.cobrado },
        ],
      })
      setHistLegend([
        { color: 'rgba(74,124,109,.85)', label: 'Egresos' },
        { color: 'rgba(16,185,129,.9)', label: 'Ingresos' },
      ])
      setHistMatrix(buildHistMatrix({ periodos: agg.mm, etiquetas: agg.labels, cuentas: agg.cuentas, titulo: `Histórico por cuenta — ${year}` }, mapeo))
      setOpenGroups(new Set())
      // Tabla mensual
      let ti = 0, te = 0
      const rowsT: Cell[][] = agg.mm.map((m) => {
        const { ingresos, egresos } = agg.meses[m]
        ti += ingresos; te += egresos
        const neto = ingresos - egresos
        return [
          { text: MONTH_LONG(year, m), capitalize: true },
          { text: money(ingresos), right: true },
          { text: money(egresos), right: true },
          { text: money(neto), right: true, color: netColor(neto) },
        ]
      })
      const netoT = ti - te
      setHistTable({
        title: `Histórico ${year} — mensual`,
        head: [{ text: 'Mes' }, { text: 'Ingresos', right: true }, { text: 'Egresos', right: true }, { text: 'Neto', right: true }],
        rows: rowsT,
        foot: [
          { text: `Total ${year}`, bold: true },
          { text: money(ti), right: true, bold: true },
          { text: money(te), right: true, bold: true },
          { text: money(netoT), right: true, bold: true, color: netColor(netoT) },
        ],
      })
      setHistKpi(histKpisTotals(agg.mm, agg.meses))
    } catch (err) {
      setHistChart({ labels: [], series: [], subtitle: 'No se pudo cargar el histórico' })
      showToast('Error al cargar histórico', friendlyError(err), 'error')
    }
  }, [showToast, companyId])

  const enterAllYears = useCallback(async (mapeo: HistMapeo) => {
    setHistChart({ labels: [], series: [], subtitle: 'Cargando todos los años...' })
    try {
      if (!companyId) return
      const rows = await fetchHistoricalAll(companyId)
      const { yy, anios, cuentas, porAnioMes } = aggregateHistAll(rows)
      const labels = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString('es-MX', { month: 'short' }))
      const series: Serie[] = []
      yy.forEach((y, i) => {
        const serie = (campo: 'ingresos' | 'egresos') =>
          Array.from({ length: 12 }, (_, m) => {
            const v = porAnioMes[y]?.[m + 1]?.[campo]
            return v === undefined ? null : Math.round(v * 100) / 100
          })
        series.push({ kind: 'line', label: `Egresos ${y}`, data: serie('egresos'), color: yearColor(i, '.9') })
        series.push({ kind: 'line', label: `Ingresos ${y}`, data: serie('ingresos'), color: yearColor(i, '.55'), dashed: true })
      })
      setHistChart({ labels, series, subtitle: 'Todos los años sobrepuestos · mensual · contabilidad CONTPAQ' })
      setHistLegend(yy.map((y, i): LegendItem => ({ color: yearColor(i, '.9'), label: y })).concat([{ color: '', label: 'sólida = egresos · punteada = ingresos', note: true }]))
      setHistMatrix(buildHistMatrix({ periodos: yy, etiquetas: yy, cuentas, titulo: 'Histórico por cuenta — todos los años' }, mapeo))
      setOpenGroups(new Set())
      // Comparativo anual
      let ti = 0, te = 0
      const rowsT: Cell[][] = yy.map((y, i) => {
        const { ingresos, egresos } = anios[y]
        ti += ingresos; te += egresos
        const neto = ingresos - egresos
        const prev = i > 0 ? anios[yy[i - 1]].ingresos : null
        const delta = prev ? ((ingresos - prev) / prev) * 100 : null
        return [
          { text: y },
          { text: money(ingresos), right: true },
          { text: money(egresos), right: true },
          { text: money(neto), right: true, color: netColor(neto) },
          {
            text: delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`,
            right: true,
            color: delta === null ? 'var(--text-3)' : delta >= 0 ? 'var(--emerald)' : 'var(--ruby)',
          },
        ]
      })
      const netoT = ti - te
      setHistTable({
        title: 'Comparativo anual',
        head: [{ text: 'Año' }, { text: 'Ingresos', right: true }, { text: 'Egresos', right: true }, { text: 'Neto', right: true }, { text: 'Δ Ingresos', right: true }],
        rows: rowsT,
        foot: [
          { text: 'Total', bold: true },
          { text: money(ti), right: true, bold: true },
          { text: money(te), right: true, bold: true },
          { text: money(netoT), right: true, bold: true, color: netColor(netoT) },
          { text: '' },
        ],
      })
      setHistKpi(histKpisTotals(yy, anios))
    } catch (err) {
      setHistChart({ labels: [], series: [], subtitle: 'No se pudo cargar' })
      showToast('Error al cargar histórico', friendlyError(err), 'error')
    }
  }, [showToast, companyId])

  // Inicialización del histórico; el operativo no consulta el RPC global.
  useEffect(() => {
    if (!canView || !anualMode) return
    let cancelled = false
    ;(async () => {
      await loadDashboard(currentPeriodKey())
      if (cancelled || !anualMode) return
      const mapeo = await loadHistMapeo()
      if (cancelled) return
      setHistMapeoState(mapeo)
      try {
        if (!companyId) return
        const periods = await fetchHistoricalPeriods(companyId)
        const yrs = [...new Set((periods || []).map((r) => String(r.period_month).slice(0, 4)))]
        if (cancelled) return
        if (!yrs.length) {
          showToast('Sin histórico', 'No hay datos históricos cargados todavía.', 'warning')
          return
        }
        setYears(yrs)
        setHistSel(yrs[0])
        await enterHistYear(Number(yrs[0]), mapeo)
      } catch (err) {
        if (!cancelled) showToast('Error', friendlyError(err), 'error')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, anualMode])

  function onPeriodChange(v: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return
    setPeriodKey(v)
    setBudgetPeriod(`${v}-01`)
  }
  function onBudgetPeriodChange(v: string) {
    if (v === BUDGET_ALL_PERIOD) setBudgetPeriod(v)
    else onPeriodChange(v.slice(0, 7))
  }
  function onRefresh() {
    if (!anualMode) refreshSummary()
    else void loadDashboard(currentPeriodKey())
  }
  function onHistYearChange(v: string) {
    setHistSel(v)
    if (v === 'todos') void enterAllYears(histMapeoState)
    else void enterHistYear(Number(v), histMapeoState)
  }
  function onExportPending() {
    showToast('Exportacion pendiente', 'La conexion a Google Drive se implementara mediante n8n.', 'info')
  }
  function toggleGroup(g: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(g)) next.delete(g); else next.add(g)
      return next
    })
  }

  // ── Derivados ────────────────────────────────────────────────────────────────
  const members = useMemo(() => filterMembers(anualMode ? (ds?.incomeMembers ?? []) : (activityAgg?.members ?? []), memberSearch), [anualMode, ds, activityAgg, memberSearch])
  const incomeReady = anualMode ? !!ds : !!activityAgg
  const legacyIncome = anualMode || activity.data?.legacyIncome

  const budgetAgg = useMemo(
    () => (budgetData ? aggregateBudget(budgetData.rows, budgetData.categories, budgetPeriod) : null),
    [budgetData, budgetPeriod],
  )
  const periodLabel = budgetPeriod === BUDGET_ALL_PERIOD ? `Año ${reportYear}` : budgetMonthLabel(budgetPeriod)
  const monthLabel = budgetMonthLabel(`${periodKey}-01`)
  const filteredPartidas = useMemo(() => filterBudgetPartidas(budgetAgg?.partidas ?? [], budgetSearch), [budgetAgg, budgetSearch])
  const opChart = useMemo<ChartModel>(() => {
    if (!budgetData) return { labels: [], series: [], subtitle: budgetError ? 'No se pudo cargar el presupuesto.' : 'Cargando presupuesto…' }
    const months = budgetPeriod === BUDGET_ALL_PERIOD ? summaryMonths : summaryMonths.slice(0, Number(periodKey.slice(5, 7)))
    const totals = months.map(month => aggregateBudget(budgetData.rows, budgetData.categories, month).totals)
    const incomes = months.map(month => activity.data ? aggregateDashboardActivity(activity.data, month.slice(0, 7)) : null)
    // Un fallo de consulta o una moneda sin conversión no se dibuja como ingreso cero.
    const expected = incomes.map(row => row && !row.incomeExcluded ? row.income.expected : null)
    const collected = incomes.map(row => row && !row.incomeExcluded ? row.income.paid : null)
    return {
      labels: months.map(month => new Date(`${month}T12:00:00`).toLocaleDateString('es-MX', { month: 'short' })),
      subtitle: `${companyName} · Enero a ${MONTH_LONG(reportYear, months.length)} de ${reportYear} · MXN`,
      empty: incomes.every(row => row && !row.incomeExcluded) && totals.every(row => row.budgeted === 0 && row.used === 0) && expected.every(v => !v) && collected.every(v => !v),
      incomeIncomplete: incomes.some(row => !row || row.incomeExcluded > 0),
      series: [
        { kind: 'bar', label: 'Presupuesto', data: totals.map(row => row.budgeted), color: 'var(--op-budget-stroke)', fill: 'var(--op-budget-fill)' },
        { kind: 'bar', label: 'Usado', data: totals.map(row => row.used), color: 'var(--op-used)', fill: 'var(--op-used-fill)' },
        { kind: 'line', label: 'Esperado', data: expected, color: 'var(--op-expected)', dashed: true, axis: 'y2' },
        { kind: 'line', label: 'Cobrado', data: collected, color: 'var(--op-collected)', axis: 'y2' },
      ],
    }
  }, [budgetData, budgetError, budgetPeriod, summaryMonths, periodKey, reportYear, companyName, activity.data])
  const visibleTabs: [SectionTab, string][] = showIncidents ? [['cash', 'Efectivo'], ['incidents', 'Incidencias']] : [['cash', 'Efectivo']]
  // Si cambia desde la pestaña Incidencias de Operadora a Fersana, muestra
  // Efectivo desde el primer render; no deja el panel anterior ni un hueco.
  const selectedTab = showIncidents ? activeTab : 'cash'
  const requestsAgg: RequestsAggregate | null = useMemo(
    () => (reqData ? aggregateRequests(reqData, budgetPeriod) : null),
    [reqData, budgetPeriod],
  )
  const taxesAgg: TaxesAggregate | null = useMemo(
    () => (reqData ? aggregateTaxes(reqData, budgetPeriod) : null),
    [reqData, budgetPeriod],
  )

  // ── Fila de alertas / estado del mes (accionables) ──────────────────────────
  const overspentCount = budgetAgg ? budgetAgg.partidas.filter((p) => p.over).length : 0
  const monthRequests = useMemo(() => reqData ? aggregateRequests(reqData, `${periodKey}-01`) : null, [reqData, periodKey])
  const operationalChecks = [
    { label: 'Solicitudes en trámite', count: monthRequests?.funnel.find(row => row.key === 'en_curso')?.count, to: '/solicitudes' },
    { label: 'Aprobadas o programadas por pagar', count: monthRequests ? monthRequests.funnel.filter(row => ['aprobadas', 'programadas'].includes(row.key)).reduce((sum, row) => sum + row.count, 0) : undefined, to: '/solicitudes' },
    { label: 'Fondos vencidos por comprobar · saldo actual', count: activityAgg?.cash.overdue, to: '/efectivo' },
    { label: 'Fondos con comprobación en revisión · saldo actual', count: activityAgg?.cash.inReview, to: '/efectivo' },
    ...(showIncidents ? [{ label: 'Incidencias pendientes del mes', count: activityAgg?.incidents.pending, to: '/incidencias' }] : []),
  ]
  const alerts = useMemo<AlertItem[]>(() => {
    const out: AlertItem[] = []
    if (overspentCount > 0) out.push({
      tone: 'danger', value: whole(overspentCount),
      label: `partida${overspentCount === 1 ? '' : 's'} sobregirada${overspentCount === 1 ? '' : 's'}`, target: 'sec-budget',
    })
    if (requestsAgg && requestsAgg.rejected.count > 0) out.push({
      tone: 'danger', value: whole(requestsAgg.rejected.count), label: 'solicitudes rechazadas', target: 'sec-requests',
    })
    if (requestsAgg && requestsAgg.inReview.count > 0) out.push({
      tone: 'warning', value: whole(requestsAgg.inReview.count), label: 'solicitudes en revisión', target: 'sec-requests',
    })
    if (taxesAgg && taxesAgg.retenciones > 0) out.push({
      tone: 'info', value: requestAmountLabel({ count: taxesAgg.withDetail, amount: taxesAgg.retenciones, unconvertedCount: taxesAgg.unconvertedCount }),
      label: 'retenciones registradas', target: 'sec-taxes',
    })
    if (requestsAgg && requestsAgg.unconvertedCount > 0) out.push({
      tone: 'warning', value: whole(requestsAgg.unconvertedCount), label: 'solicitudes sin conversión a MXN', target: 'sec-requests',
    })
    if (activityAgg?.cash.overdue) out.push({ tone: 'warning', value: whole(activityAgg.cash.overdue), label: 'fondos vencidos por comprobar', target: 'sec-activity' })
    if (showIncidents && activityAgg?.incidents.pending) out.push({ tone: 'warning', value: whole(activityAgg.incidents.pending), label: 'incidencias pendientes', target: 'sec-activity' })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overspentCount, requestsAgg, taxesAgg, activityAgg, showIncidents])

  const cash = activityAgg?.cash
  const inc = activityAgg?.incidents
  const activityEmpty = activity.loading ? 'Cargando…' : activity.error ? 'No disponible' : 'Selecciona una empresa'
  const budgetEmpty = budgetLoading ? 'Cargando…' : budgetError ? 'No disponible' : 'Selecciona una empresa'
  const incomeLabel = (amount: number) => activityAgg ? requestAmountLabel({ amount, count: activityAgg.members.length + activityAgg.incomeExcluded, unconvertedCount: activityAgg.incomeExcluded }) : '—'
  const operationalUpdated = loadedAt && activity.loadedAt ? `Última actualización: ${fmtDateTime(new Date(loadedAt > activity.loadedAt ? loadedAt : activity.loadedAt))}` : ''

  if (!canView) {
    return (
      <div className={s.gate}>
        <h2>Acceso restringido</h2>
        <p>No tienes permiso para consultar el Dashboard.</p>
      </div>
    )
  }

  const activeChart = inHistView ? histChart : opChart
  const legend = inHistView ? histLegend : OPERATIVE_LEGEND

  const memberCard = (compact: boolean) => (
    <div className={`${s.chartCard} ${compact ? s.compactRows : ''}`}>
      <div className={s.panelHeader}>
        <div>
          <h2>{anualMode ? 'Cobranza por socio' : legacyIncome ? 'Cuotas por cobrar' : 'Cobros registrados'}</h2>
          <div className={s.panelSub}>{anualMode ? 'Cuotas del periodo — pendientes primero' : `${companyName} · ${monthLabel} · MXN`}</div>
        </div>
        <input className={s.memberSearch} type="search" aria-label="Buscar cobros" placeholder={anualMode ? 'Buscar...' : legacyIncome ? 'Buscar socio…' : 'Buscar pagador…'} value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
      </div>
      {!anualMode && <p className={s.budgetOmitNote}>Esperado: cobros registrados para el mes. Cobrado: pagos registrados. Pendiente: saldo por cobrar.</p>}
      {!anualMode && activityAgg && <div className={s.incomeSummary}>
        <span>Esperado <strong>{incomeLabel(activityAgg.income.expected)}</strong></span>
        <span>Cobrado <strong>{incomeLabel(activityAgg.income.paid)}</strong></span>
        <span>Pendiente <strong>{incomeLabel(activityAgg.income.pending)}</strong></span>
      </div>}
      {!anualMode && !!activityAgg?.incomeExcluded && <p className={s.budgetNote}>{activityAgg.incomeExcluded} cobros en otra moneda o sin moneda se excluyen de los importes en MXN. Consúltalos en Ingresos.</p>}
      <div className={s.memberTableWrap}>
        <table className={s.table}>
          <thead><tr><th>{legacyIncome ? 'Socio' : 'Pagador'}</th><th>Esperado</th><th>Cobrado</th><th>Pendiente</th><th>Estatus</th></tr></thead>
          <tbody>
            {!incomeReady && (anualMode || activity.loading) && <TableSkeletonRows cols={5} rows={4} />}
            {!anualMode && activity.error && <tr><td colSpan={5} className={s.tableMsg}>No se pudieron cargar los cobros. Pulsa Actualizar para reintentar.</td></tr>}
            {incomeReady && members.length === 0 && <tr><td colSpan={5} className={s.tableMsg}>{anualMode ? 'Sin registros para este periodo.' : memberSearch ? 'Sin coincidencias.' : 'Sin cobros en MXN registrados para este periodo.'}</td></tr>}
            {incomeReady && members.map((r, i) => {
              const b = incomeStatusBadge(r.status)
              return (
                <tr key={i}>
                  <td><span className={s.cellMain}>{r.member_name || '—'}</span><span className={s.cellSub}>{r.lineage || ''}</span></td>
                  <td>{money(r.expected_amount)}</td>
                  <td>{money(r.paid_amount)}</td>
                  <td style={{ fontWeight: 700, color: num(r.pending_amount) > 0 ? 'var(--amber)' : 'var(--text-3)' }}>{money(r.pending_amount)}</td>
                  <td><Badge variant={b.variant}>{b.label}</Badge></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className={s.dash}>
      <div className={s.phead}>
        <div>
          <h1>{anualMode ? 'Dashboard anual' : 'Dashboard operativo'}</h1>
          <p>{anualMode
            ? 'Ejercicios históricos: ingresos y egresos contables por año, mes y cuenta.'
            : 'Presupuesto, cobros y pendientes de la empresa seleccionada.'}</p>
        </div>
        <div className={s.headActions}>
          {!anualMode && (
            <label className={s.periodField}>
              <span>Mes operativo</span>
              <input type="month" aria-label="Mes operativo" value={periodKey} onChange={(e) => onPeriodChange(e.target.value)} />
            </label>
          )}
          {anualMode && (
            <>
              <label className={`${s.periodField} ${s.accent}`}>
                <span>Año</span>
                <select value={histSel} onChange={(e) => onHistYearChange(e.target.value)}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                  <option value="todos">Todos los años</option>
                </select>
              </label>
              <Link className={s.secondaryBtn} to="/dashboard">Año en curso</Link>
            </>
          )}
          <button className={s.secondaryBtn} type="button" onClick={onRefresh} disabled={refreshing || allLoading}>{refreshing || allLoading ? 'Cargando...' : 'Actualizar'}</button>
          {anualMode && <>
            <button className={s.secondaryBtn} type="button" onClick={() => setShowExport(true)}>Exportar</button>
            <button className={s.secondaryBtn} type="button" onClick={() => setShowHistory(true)}>Historial</button>
          </>}
        </div>
      </div>

      <span className={s.lastUpdated}>{anualMode ? lastUpdated : allLoading ? 'Actualizando resumen…' : summaryIncomplete ? 'Resumen incompleto: revisa los avisos de cada sección.' : operationalUpdated}</span>

      {/* KPI histórico (solo hist) */}
      {inHistView && histKpi && (
        <div className={s.histKpiStrip}>
          <div className={s.histKpi}><span>Ingresos</span><strong style={{ color: 'var(--emerald)' }}>{money(histKpi.ingresos)}</strong></div>
          <div className={s.histKpi}><span>Egresos</span><strong style={{ color: 'var(--accent-text)' }}>{money(histKpi.egresos)}</strong></div>
          <div className={s.histKpi}><span>Neto</span><strong style={{ color: netColor(histKpi.neto) }}>{money(histKpi.neto)}</strong></div>
          <div className={s.histKpi}><span>Gasto prom/mes</span><strong>{money(histKpi.promedio)}</strong></div>
        </div>
      )}

      {/* KPI operativos */}
      {!inHistView && (
        <div className={`${s.kpiGrid} ${showIncidents ? '' : s.kpiGridThree}`} aria-label="Indicadores operativos">
          <div className={`${s.kpiCard} ${s.accent}`}>
            <div className={s.kpiLabel}>Presupuesto usado</div>
            <div className={s.kpiValue}>{budgetAgg ? money(budgetAgg.totals.used) : '—'}</div>
            {budgetAgg && <div className={s.kpiProgress}><div className={s.kpiProgressBar} style={{ width: `${Math.max(0, Math.min(100, budgetAgg.totals.pctUsed))}%` }} /></div>}
            <div className={s.kpiSub}>{budgetAgg ? `de ${money(budgetAgg.totals.budgeted)} presupuestado · ${Number.isFinite(budgetAgg.totals.pctUsed) ? pct(budgetAgg.totals.pctUsed) : 'Sin presupuesto'}` : budgetEmpty}</div>
            <div className={s.kpiSub}>{periodLabel} · Pagado + pendiente presupuestal</div>
          </div>
          <div className={`${s.kpiCard} ${s.success}`}>
            <div className={s.kpiLabel}>Cobrado en el mes</div>
            <div className={s.kpiValue}>{activityAgg ? incomeLabel(activityAgg.income.paid) : '—'}</div>
            <div className={s.kpiSub}>{activityAgg ? `de ${incomeLabel(activityAgg.income.expected)} esperado` : activityEmpty}</div>
            <div className={s.kpiSub}>{monthLabel} · {legacyIncome ? 'Cuotas de socios' : 'Ingresos registrados'}</div>
          </div>
          <div className={`${s.kpiCard} ${s.violet}`}>
            <div className={s.kpiLabel}>Efectivo por comprobar</div>
            <div className={s.kpiValue}>{cash ? money(cash.pendingAmount) : '—'}</div>
            <div className={s.kpiSub}>{cash ? `${whole(cash.pending)} fondos pendientes · ${whole(cash.overdue)} de ellos vencidos` : activityEmpty}</div>
            <div className={s.kpiSub}>Saldo actual · incluye meses anteriores</div>
          </div>
          {showIncidents && <div className={`${s.kpiCard} ${s.warning}`}>
            <div className={s.kpiLabel}>Incidencias pendientes</div>
            <div className={s.kpiValue}>{inc ? whole(inc.pending) : '—'}</div>
            <div className={s.kpiSub}>{inc ? `${whole(inc.open)} abiertas · ${whole(inc.invoiced)} facturadas por cobrar` : activityEmpty}</div>
            <div className={s.kpiSub}>{monthLabel} · Incidencias registradas</div>
          </div>}
        </div>
      )}

      {/* ── Alertas / estado del mes (operativo) — lo primero tras los KPIs ── */}
      {!inHistView && (
        <div className={s.alertsRow} aria-label="Alertas del periodo">
          {allLoading ? (
            <div className={`${s.alertCard} ${s.info}`} role="status">
              <span className={s.alertLabel}>Cargando alertas de {companyName || 'la empresa activa'}…</span>
            </div>
          ) : <>
          {summaryIncomplete && (
            <div className={`${s.alertCard} ${s.warning}`} role="status">
              <span className={s.alertLabel}>Resumen incompleto. {!companyId ? 'Selecciona una empresa.' : activityAgg?.incomeExcluded ? 'Revisa los cobros excluidos por moneda.' : 'Pulsa Actualizar para reintentar.'}</span>
            </div>
          )}
          {!summaryIncomplete && alerts.length === 0 ? (
            <div className={`${s.alertCard} ${s.ok}`}>
              <span className={s.alertValue}>✓</span>
              <span className={s.alertLabel}>Sin alertas destacadas. Consulta los pendientes operativos.</span>
            </div>
          ) : (
            alerts.map((a, i) => (
              <button
                key={i}
                type="button"
                className={`${s.alertCard} ${s[a.tone]}`}
                onClick={() => scrollToSection(a.target)}
              >
                <span className={s.alertValue}>{a.value}</span>
                <span className={s.alertLabel}>{a.label}</span>
              </button>
            ))
          )}
          </>}
        </div>
      )}
      {!inHistView && budgetPeriod === BUDGET_ALL_PERIOD && (
        <p className={s.budgetOmitNote}>
          Resumen anual de presupuesto, solicitudes e impuestos ({reportYear}). Cobros{showIncidents ? ', incidencias' : ''} y solicitudes por atender corresponden a {monthLabel}. Efectivo muestra el saldo actual.
        </p>
      )}

      {/* Gráfica principal */}
      <div className={`${s.chartCard} ${!inHistView ? s.operationalChart : ''}`}>
        <div className={s.panelHeader}>
          <div>
            <h2>{inHistView ? 'Presupuesto vs Ejecutado — evolucion mensual' : 'Presupuesto e ingresos — evolución mensual'}</h2>
            <div className={s.panelSub}>{activeChart?.subtitle}</div>
          </div>
          <div className={s.chartLegend}>
            {legend.map((l, i) => (
              l.note ? (
                <div key={i} className={s.chartLegendItem} style={{ color: 'var(--text-3)' }}>{l.label}</div>
              ) : (
                <div key={i} className={s.chartLegendItem}>
                  {l.kind ? <span aria-hidden className={l.kind === 'line' ? s.legendLine : s.legendBar} style={{ color: l.color, ...(l.kind === 'line' ? { borderTopStyle: l.dashed ? 'dashed' : 'solid' } : { background: l.light ? 'var(--op-budget-fill)' : l.color }) }} /> :
                    <div className={s.chartLegendDot} style={{ background: l.color, ...(l.dashed ? { outline: '1px dashed', outlineOffset: '1px' } : {}) }} />}
                  {l.label}
                </div>
              )
            ))}
          </div>
        </div>
        <div className={s.chartBody}>
          {activeChart && activeChart.labels.length > 0 && !activeChart.empty ? (
            <ComboChart
              labels={activeChart.labels}
              series={activeChart.series}
              leftTitle={inHistView ? undefined : 'Presupuesto y uso'}
              rightTitle={inHistView ? undefined : 'Ingresos'}
              presentation={inHistView ? undefined : 'operational'}
            />
          ) : !inHistView ? (
            <div className={s.chartEmpty}>{opChart.empty ? 'Sin presupuesto, uso ni ingresos registrados en el periodo.' : opChart.subtitle}</div>
          ) : null}
        </div>
        {!inHistView && <div className={s.chartGuide}>
          <span><strong>Barras · eje izquierdo</strong> Presupuesto y uso (pagado + pendiente).</span>
          <span><strong>Líneas · eje derecho</strong> {activity.data?.legacyIncome ? 'Cuotas por mes de corte; cobrado registrado para esas cuotas.' : 'Cobros esperados y registrados del periodo.'} MXN; cada eje tiene su propia escala.</span>
          {opChart.incomeIncomplete && <span role="status">{activity.loading ? 'Cargando ingresos…' : activity.error ? 'Ingresos no disponibles. Pulsa Actualizar para reintentar.' : 'Los meses con ingresos sin conversión completa a MXN se muestran sin punto.'}</span>}
        </div>}
      </div>

      {/* ── Vista histórica ── */}
      {inHistView && (
        <>
          <div className={s.histGrid}>
            <div className={`${s.tableCard} ${s.compactRows}`}>
              <div className={s.histPanelHead}>
                <div>
                  <div className={s.histPanelTitle}>{histTable?.title || 'Histórico'}</div>
                  <div className={s.histPanelSub}>Contabilidad CONTPAQ · 4xx / 6xx</div>
                </div>
              </div>
              <div className={s.tableWrap}>
                {histTable && (
                  <table className={s.table}>
                    <thead><tr>{histTable.head.map((c, i) => <th key={i} className={c.right ? s.right : ''}>{c.text}</th>)}</tr></thead>
                    <tbody>
                      {histTable.rows.map((row, ri) => (
                        <tr key={ri}>
                          {row.map((c, ci) => (
                            <td key={ci} className={c.right ? s.right : ''} style={{ color: c.color, fontWeight: c.bold ? 800 : undefined }}>
                              <span className={c.capitalize ? s.capitalize : undefined} style={c.capitalize ? { textTransform: 'capitalize' } : undefined}>{c.text}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {histTable.foot && (
                      <tfoot><tr>{histTable.foot.map((c, i) => <td key={i} className={c.right ? s.right : ''} style={{ color: c.color, fontWeight: c.bold ? 800 : undefined }}>{c.text}</td>)}</tr></tfoot>
                    )}
                  </table>
                )}
              </div>
            </div>
            <div>{memberCard(true)}</div>
          </div>

          {histMatrix && <HistCuentasPanel matrix={histMatrix} openGroups={openGroups} onToggle={toggleGroup} />}
        </>
      )}

      {/* ── Vista operativa ── */}
      {!inHistView && (
        <>
          {/* ── Presupuesto: disponible vs usado, por partida ── */}
          <section id="sec-budget" className={s.tableCard}>
            <div className={s.panelHeader} style={{ flexWrap: 'wrap' }}>
              <div>
                <h2>Presupuesto — disponible vs usado por partida</h2>
                <div className={s.panelSub}>
                  {(companyName || 'Empresa activa')} · {periodLabel} · MXN
                </div>
              </div>
              <div className={s.budgetLegend}>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--emerald)' }} />Ejecutado</div>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--amber)' }} />Pendiente de pago</div>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--border)' }} />Disponible</div>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--ruby)' }} />Sobregirado</div>
              </div>
              <label className={s.periodField}>
                <span>Ver resumen</span>
                <select className={s.budgetSelect} aria-label="Periodo del resumen" value={budgetPeriod} onChange={(e) => onBudgetPeriodChange(e.target.value)}>
                  <option value={BUDGET_ALL_PERIOD}>Año completo</option>
                  {summaryMonths.map((m) => <option key={m} value={m}>{budgetMonthLabel(m)}</option>)}
                </select>
              </label>
            </div>

            {budgetAgg && !budgetLoading && !budgetError && (budgetAgg.partidas.length > 0 || budgetAgg.totals.budgeted > 0) && (
              <div className={s.miniGrid}>
                {([
                  ['Presupuestado', money(budgetAgg.totals.budgeted)],
                  ['Usado', money(budgetAgg.totals.used)],
                  ['Disponible', money(budgetAgg.totals.available)],
                  ['% usado', Number.isFinite(budgetAgg.totals.pctUsed) ? pct(budgetAgg.totals.pctUsed) : 'Sin presupuesto'],
                ] as [string, string][]).map(([l, v]) => (
                  <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                ))}
              </div>
            )}

            {budgetLoading && (
              <div className={s.budgetList}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={s.budgetRow}>
                    <div className={s.budgetRowHead}><Skeleton width="40%" /><Skeleton width={48} /></div>
                    <Skeleton width="100%" height={10} />
                  </div>
                ))}
              </div>
            )}
            {!budgetLoading && budgetError && <div className={s.tableMsg}>No se pudo cargar el presupuesto.</div>}
            {!budgetLoading && !budgetError && budgetAgg && budgetAgg.partidas.length === 0 && (
              <div className={s.tableMsg}>Sin presupuesto cargado para esta empresa o periodo.</div>
            )}

            {!budgetLoading && !budgetError && budgetAgg && budgetAgg.partidas.length > 0 && (
              <>
                <div className={s.budgetSearchBar}>
                  <label className={s.budgetSearchField}>
                    <span>Buscar partida o grupo</span>
                    <input type="search" aria-label="Buscar partida o grupo" placeholder="Ej. seguridad, combustible…" value={budgetSearch} onChange={(e) => setBudgetSearch(e.target.value)} />
                  </label>
                  {budgetSearch && <button type="button" className={s.secondaryBtn} onClick={() => setBudgetSearch('')}>Limpiar búsqueda</button>}
                  <span role="status">{filteredPartidas.length} de {budgetAgg.partidas.length} partidas</span>
                </div>
                <p className={s.budgetOmitNote}>Usado = pagado + pendiente, con la base registrada en presupuesto. Excluye solicitudes no presupuestales. La búsqueda filtra el desglose; los totales conservan todo el periodo.</p>
                <div className={s.budgetList}>
                  {filteredPartidas.map((p) => <BudgetPartidaRow key={p.categoryId} p={p} />)}
                  {filteredPartidas.length === 0 && <div className={s.tableMsg}>No hay partidas que coincidan con «{budgetSearch}».</div>}
                </div>
                {budgetAgg.omittedCount > 0 && (
                  <div className={s.budgetOmitNote}>
                    {budgetAgg.omittedCount} partida{budgetAgg.omittedCount === 1 ? '' : 's'} sin presupuesto ni uso omitida{budgetAgg.omittedCount === 1 ? '' : 's'} del desglose.
                  </div>
                )}
              </>
            )}
          </section>

          {/* ── Solicitudes: cómo van vs pagadas ── */}
          <section id="sec-requests" className={s.tableCard}>
            <div className={s.panelHeader} style={{ flexWrap: 'wrap' }}>
              <div>
                <h2>Solicitudes — cómo van vs pagadas</h2>
                <div className={s.panelSub}>
                  {(companyName || 'Empresa activa')} · {periodLabel} · por periodo presupuestal · MXN
                </div>
              </div>
            </div>

            {reqLoading && (
              <div className={s.budgetList}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={s.budgetRow}><div className={s.budgetRowHead}><Skeleton width="30%" /><Skeleton width={60} /></div></div>
                ))}
              </div>
            )}
            {!reqLoading && reqError && <div className={s.tableMsg}>No se pudieron cargar las solicitudes.</div>}
            {!reqLoading && !reqError && requestsAgg && requestsAgg.total === 0 && (
              <div className={s.tableMsg}>Sin solicitudes para esta empresa o periodo.</div>
            )}

            {!reqLoading && !reqError && requestsAgg && requestsAgg.total > 0 && (
              <>
                {/* Embudo por etapa: conteo + monto */}
                <div className={s.funnelRow}>
                  {requestsAgg.funnel.map((st: RequestStage, i) => (
                    <div key={st.key} className={`${s.funnelStage} ${st.key === 'pagadas' ? s.paid : ''}`}>
                      <span className={s.funnelLabel}>{st.label}</span>
                      <strong className={s.funnelCount}>{whole(st.count)}</strong>
                      <span className={s.funnelAmount}>{requestAmountLabel(st)}</span>
                      {i < requestsAgg.funnel.length - 1 && <span className={s.funnelArrow} aria-hidden>→</span>}
                    </div>
                  ))}
                </div>

                {/* Alertas resaltadas */}
                {(requestsAgg.rejected.count > 0 || requestsAgg.changesRequested.count > 0) && (
                  <div className={s.reqAlerts}>
                    {requestsAgg.rejected.count > 0 && (
                      <div className={`${s.reqAlert} ${s.danger}`}>
                        <span>Rechazadas</span>
                        <strong>{whole(requestsAgg.rejected.count)} · {requestAmountLabel(requestsAgg.rejected)}</strong>
                      </div>
                    )}
                    {requestsAgg.changesRequested.count > 0 && (
                      <div className={`${s.reqAlert} ${s.warning}`}>
                        <span>Cambios solicitados</span>
                        <strong>{whole(requestsAgg.changesRequested.count)} · {requestAmountLabel(requestsAgg.changesRequested)}</strong>
                      </div>
                    )}
                  </div>
                )}

                {/* Desglose por status */}
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead><tr><th>Estatus</th><th className={s.right}>Solicitudes</th><th className={s.right}>Monto</th></tr></thead>
                    <tbody>
                      {requestsAgg.byStatus.map((r) => (
                        <tr key={r.status}>
                          <td><span className={s.cellMain}>{r.label}</span></td>
                          <td className={s.right}>{whole(r.count)}</td>
                          <td className={s.right}>{requestAmountLabel(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ fontWeight: 800 }}>Total</td>
                        <td className={s.right} style={{ fontWeight: 800 }}>{whole(requestsAgg.total)}</td>
                        <td className={s.right} style={{ fontWeight: 800 }}>{requestAmountLabel({ count: requestsAgg.total, amount: requestsAgg.byStatus.reduce((a, r) => a + r.amount, 0), unconvertedCount: requestsAgg.unconvertedCount })}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className={s.budgetOmitNote}>
                  Importes totales solicitados, con impuestos y solicitudes no presupuestales, convertidos a MXN con el tipo de cambio registrado. Por eso pueden diferir del uso presupuestal. En pagadas se muestra el importe solicitado.
                  {requestsAgg.unconvertedCount > 0 && <> {whole(requestsAgg.unconvertedCount)} solicitudes se incluyen en el conteo, pero su importe se excluye por moneda o tipo de cambio faltante o inválido.</>}
                </div>
              </>
            )}
          </section>

          {/* ── Impuestos: desglose fiscal ── */}
          <section id="sec-taxes" className={s.tableCard}>
            <div className={s.panelHeader} style={{ flexWrap: 'wrap' }}>
              <div>
                <h2>Impuestos — desglose fiscal</h2>
                <div className={s.panelSub}>
                  {(companyName || 'Empresa activa')} · {periodLabel}
                  {' · Solicitudes aprobadas, programadas o pagadas · MXN'}
                </div>
              </div>
            </div>

            {reqLoading && (
              <div className={s.miniGrid}>
                {Array.from({ length: 2 }).map((_, i) => <div key={i} className={s.miniCard}><Skeleton width="60%" /><Skeleton width="40%" height={16} /></div>)}
              </div>
            )}
            {!reqLoading && reqError && <div className={s.tableMsg}>No se pudo cargar el desglose fiscal.</div>}
            {!reqLoading && !reqError && taxesAgg && taxesAgg.withDetail === 0 && (
              <div className={s.tableMsg}>
                Sin desglose fiscal en las {whole(taxesAgg.total)} solicitudes aprobadas, programadas o pagadas del periodo.
              </div>
            )}
            {!reqLoading && !reqError && taxesAgg && taxesAgg.withDetail > 0 && (
              <>
                <div className={s.miniGrid} style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                  <div className={`${s.miniCard} ${s.taxIva}`}>
                    <span>IVA registrado</span>
                    <strong>{requestAmountLabel({ count: taxesAgg.withDetail, amount: taxesAgg.iva, unconvertedCount: taxesAgg.unconvertedCount })}</strong>
                    <span className={s.taxHint}>Según el desglose de las solicitudes</span>
                  </div>
                  <div className={`${s.miniCard} ${s.taxRet}`}>
                    <span>Retenciones registradas</span>
                    <strong>{requestAmountLabel({ count: taxesAgg.withDetail, amount: taxesAgg.retenciones, unconvertedCount: taxesAgg.unconvertedCount })}</strong>
                    <span className={s.taxHint}>Según el desglose de las solicitudes</span>
                  </div>
                </div>
                <div className={s.budgetOmitNote}>
                  {whole(taxesAgg.withDetail)} de {whole(taxesAgg.total)} solicitudes aprobadas, programadas o pagadas con desglose fiscal. No representa una declaración fiscal.
                  {taxesAgg.unconvertedCount > 0 && <> Se excluye el importe de {whole(taxesAgg.unconvertedCount)} solicitudes sin conversión válida a MXN.</>}
                </div>
              </>
            )}
          </section>

          <div className={s.dashGrid} id="sec-activity">
            {memberCard(false)}
            <section className={`${s.chartCard} ${s.closureCard}`}>
              <div className={s.panelHeader}>
                <div>
                  <h2>Pendientes operativos</h2>
                  <div className={s.panelSub}>{companyName} · {monthLabel}</div>
                </div>
              </div>
              <p className={s.budgetOmitNote}>Revisa los pendientes en su módulo. Esta lista sirve para seguimiento; no realiza ni certifica el cierre contable.</p>
              <div className={s.summaryList}>
                {operationalChecks.map(check => (
                  <div key={check.label} className={s.summaryRow}>
                    <span>{check.label}</span>
                    <Link to={check.to} className={s.checkLink} aria-label={`Revisar ${check.label.toLowerCase()}`}>
                      {check.count === undefined ? 'Sin datos' : <><strong>{whole(check.count)}</strong> · {check.count > 0 ? 'Revisar →' : 'Sin pendientes'}</>}
                    </Link>
                  </div>
                ))}
              </div>
              {(activity.error || reqError) && <p className={s.budgetNote}>No fue posible consultar todos los pendientes. Pulsa Actualizar para reintentar.</p>}
            </section>
          </div>

          {visibleTabs.length > 1 && <div className={s.tabsBlock}>
            <div className={s.sectionTabs}>
              {visibleTabs.map(([tab, label]) => (
                <button key={tab} type="button" className={`${s.sectionTab} ${selectedTab === tab ? s.active : ''}`} onClick={() => setActiveTab(tab)}>{label}</button>
              ))}
            </div>
          </div>}

          {selectedTab === 'cash' && (
            <section className={s.tableCard}>
              <div className={s.panelHeader}>
                <div><h2>Efectivo y comprobaciones</h2><div className={s.panelSub}>{companyName} · Fondos activos al día de hoy, incluidos los de meses anteriores</div></div>
                <Link className={s.secondaryBtn} to="/efectivo">Ver módulo completo</Link>
              </div>
              {!cash ? <div className={s.tableMsg}>{activityEmpty}</div> : <>
                <div className={s.miniGrid}>
                  {[['Fondos activos', whole(cash.active)], ['Con saldo por comprobar', whole(cash.pending)], ['En revisión', whole(cash.inReview)], ['De los pendientes, vencidos', whole(cash.overdue)], ['Monto entregado', money(cash.assigned)], ['Monto comprobado', money(cash.verified)], ['Monto por comprobar', money(cash.pendingAmount)]].map(([l, v]) => (
                    <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                  ))}
                </div>
                <p className={s.budgetOmitNote}>Los fondos vencidos ya están incluidos en los pendientes; no se suman de nuevo.</p>
              </>}
            </section>
          )}

          {showIncidents && selectedTab === 'incidents' && (
            <section className={s.tableCard}>
              <div className={s.panelHeader}>
                <div><h2>Incidencias del mes</h2><div className={s.panelSub}>{companyName} · {monthLabel} · Por fecha de incidencia</div></div>
                <Link className={s.secondaryBtn} to="/incidencias">Ver módulo completo</Link>
              </div>
              {!inc ? <div className={s.tableMsg}>{activityEmpty}</div> : <div className={s.miniGrid}>
                {[['Abiertas', whole(inc.open)], ['Facturadas por cobrar', whole(inc.invoiced)], ['Cobradas', whole(inc.paid)], ['Total pendiente', whole(inc.pending)]].map(([l, v]) => (
                  <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                ))}
              </div>}
            </section>
          )}
        </>
      )}

      {showHistory && <HistoryModal onClose={() => setShowHistory(false)} onError={(msg) => showToast('Error', msg, 'error')} />}
      {showExport && <ExportModal cierre={ds?.kpis.cierre || {}} onExportPending={onExportPending} onClose={() => setShowExport(false)} />}
    </div>
  )
}

// ── Matriz "Histórico por cuenta" ──────────────────────────────────────────────
function HistCuentasPanel({ matrix, openGroups, onToggle }: { matrix: HistMatrix; openGroups: Set<string>; onToggle: (g: string) => void }) {
  const { periodos, etiquetas, titulo, ingresos, egresos } = matrix
  const colCount = periodos.length + 2
  const cells = (obj: Record<string, number>) =>
    periodos.map((k) => <td key={String(k)} className={s.right} style={{ whiteSpace: 'nowrap' }}>{fmtCell(obj[String(k)] || 0)}</td>)

  return (
    <div className={`${s.tableCard} ${s.compactRows} ${s.histCuentasPanel}`}>
      <div className={s.histPanelHead} style={{ display: 'block' }}>
        <div className={s.histPanelTitle}>{titulo}</div>
        <div className={s.histPanelSub}>Ordenado por monto · código de cuenta al pasar el mouse</div>
      </div>
      <div className={s.histCuentasWrap}>
        <table className={s.table} style={{ minWidth: 0 }}>
          <thead>
            <tr>
              <th className={s.histCuentaCol}>Cuenta / partida</th>
              {etiquetas.map((l, i) => <th key={i} className={s.right} style={{ textTransform: 'capitalize' }}>{l}</th>)}
              <th className={s.right}>Total</th>
            </tr>
          </thead>
          <tbody>
            {ingresos && (
              <>
                <tr className={s.histSectionHead}><td colSpan={colCount} style={{ color: 'var(--emerald)' }}>Ingresos</td></tr>
                {ingresos.rows.map((r, i) => (
                  <tr key={`ing${i}`}>
                    <td className={s.histCuentaCol} title={r.code}><span className={s.cellMain}>{r.nombre}</span></td>
                    {cells(r.meses)}
                    <td className={s.right} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMoney0(r.total)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 800 }}>
                  <td className={s.histCuentaCol}><span className={s.cellMain}>{ingresos.total.nombre}</span></td>
                  {cells(ingresos.total.meses)}
                  <td className={s.right} style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtMoney0(ingresos.total.total)}</td>
                </tr>
              </>
            )}
            {egresos && (
              <>
                {egresos.grupos.length > 0 && (
                  <tr className={s.histSectionHead}><td colSpan={colCount} style={{ color: 'var(--accent-text)' }}>Egresos · estructura del presupuesto</td></tr>
                )}
                {egresos.grupos.map((g) => {
                  const open = openGroups.has(g.grupo)
                  return (
                    <FragmentGroup key={g.grupo} open={open}>
                      <tr className={`${s.histGrupo} ${open ? s.abierto : ''}`} onClick={() => onToggle(g.grupo)}>
                        <td className={s.histCuentaCol} style={{ background: 'linear-gradient(var(--bg-hover),var(--bg-hover)),var(--bg-card)' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                            <span className={s.histCaret}>▶</span>
                            <span className={s.cellMain}>{g.grupo}</span>
                            <span className={s.mutedLine} style={{ display: 'inline', margin: 0, whiteSpace: 'nowrap' }}>· {g.partidasCount} partida{g.partidasCount === 1 ? '' : 's'}</span>
                          </span>
                        </td>
                        {cells(g.meses)}
                        <td className={s.right} style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtMoney0(g.total)}</td>
                      </tr>
                      {open && g.partidas.map((pa, pi) => (
                        <tr key={pi} className={s.histSub}>
                          <td className={s.histCuentaCol}><span className={s.cellMain}>{pa.nombre}</span></td>
                          {cells(pa.meses)}
                          <td className={s.right} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMoney0(pa.total)}</td>
                        </tr>
                      ))}
                    </FragmentGroup>
                  )
                })}
                {egresos.sinMapear.length > 0 && (
                  <tr className={s.histSectionHead}><td colSpan={colCount} style={{ color: 'var(--amber)' }}>{egresos.sinMapearHeader}</td></tr>
                )}
                {egresos.sinMapear.map((r, i) => (
                  <tr key={`sm${i}`}>
                    <td className={s.histCuentaCol} title={r.code}><span className={s.cellMain}>{r.nombre}</span>{r.meta ? <span className={s.mutedLine}>{r.meta}</span> : null}</td>
                    {cells(r.meses)}
                    <td className={s.right} style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtMoney0(r.total)}</td>
                  </tr>
                ))}
                {egresos.total && (
                  <tr style={{ fontWeight: 800 }}>
                    <td className={s.histCuentaCol}><span className={s.cellMain}>{egresos.total.nombre}</span></td>
                    {cells(egresos.total.meses)}
                    <td className={s.right} style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{fmtMoney0(egresos.total.total)}</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Agrupa filas de grupo + sub-partidas sin envoltura DOM extra.
function FragmentGroup({ children }: { open: boolean; children: ReactNode }) {
  return <>{children}</>
}

// ── Fila de partida: barra usado (ejecutado+comprometido) vs disponible ─────────
function BudgetPartidaRow({ p }: { p: BudgetPartida }) {
  // Escala: 100% = presupuestado; si está sobregirado, el usado (mayor) llena la
  // barra. base = max(presupuestado, usado) para no perder proporción al sobregirar.
  const base = Math.max(p.budgeted, p.used, 1)
  const exW = (p.executed / base) * 100
  const comW = (p.committed / base) * 100
  const availW = p.available > 0 ? (p.available / base) * 100 : 0
  const rowCls = `${s.budgetRow} ${p.over ? s.alert : p.warn ? s.warn : ''}`
  const pctCls = `${s.budgetPct} ${p.over ? s.alert : p.warn ? s.warn : ''}`
  const pctText = Number.isFinite(p.pctUsed) ? pct(p.pctUsed) : 'sin presup.'
  return (
    <div className={rowCls}>
      <div className={s.budgetRowHead}>
        <div>
          <span className={s.budgetPartida}>{p.name}</span>
          {p.group && p.group !== 'Sin grupo' && <span className={s.budgetGroup}>{p.group}</span>}
        </div>
        <span className={pctCls}>{p.over ? 'Sobregirado · ' : ''}{pctText}</span>
      </div>
      <div className={s.budgetBar} role="img" aria-label={`Usado ${pctText} de ${money(p.budgeted)}`}>
        <div className={`${s.budgetSeg} ${s.executed}`} style={{ width: `${exW}%` }} />
        <div className={`${s.budgetSeg} ${s.committed}`} style={{ width: `${comW}%` }} />
        {availW > 0 && <div className={s.budgetSeg} style={{ width: `${availW}%` }} />}
      </div>
      <div className={s.budgetFigures}>
        <span>Presupuestado<strong>{money(p.budgeted)}</strong></span>
        <span>Ejecutado<strong>{money(p.executed)}</strong></span>
        <span>Pendiente de pago<strong>{money(p.committed)}</strong></span>
        <span>Usado<strong>{money(p.used)}</strong></span>
        <span>Disponible<strong className={p.over ? s.alert : undefined}>{money(p.available)}</strong></span>
      </div>
    </div>
  )
}
