import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { TableSkeletonRows, Skeleton } from '../../components/ui/Skeleton'
import {
  fetchDashboardPayload, fetchHistoricalPeriods, fetchHistoricalYear, fetchHistoricalAll, loadHistMapeo,
  fetchBudgetAvailability, fetchPaymentRequests,
} from './api'
import {
  toDashboardState, currentPeriodKey, fmtDateTime, friendlyError, canViewDashboard,
  computeKpis, computeClosure, filterMembers,
  filterIncome, computeIncomeTotals, incomeStatusBadge, closureStatusBadge,
  money, whole, pct, num, uniqueSorted, normKey,
  buildYearMonths, aggregateYearly, hasChartData,
  aggregateHistYear, aggregateHistAll, histKpisTotals, buildHistMatrix, fmtCell, fmtMoney0, yearColor,
  aggregateBudget, budgetMonthLabel, BUDGET_ALL_PERIOD,
  aggregateRequests, aggregateTaxes,
} from './logic'
import type {
  DashboardState, SectionTab, HistMapeo, BudgetAvailabilityRow, BudgetCategoryMeta, BudgetPartida,
  PaymentRequestRow, RequestsAggregate, TaxesAggregate, RequestStage,
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

type ChartModel = { labels: string[]; series: Serie[]; subtitle: string; empty?: boolean }
type AlertTone = 'danger' | 'warning' | 'info'
type AlertItem = { tone: AlertTone; value: string; label: string; target: string }
type LegendItem = { color: string; label: string; dashed?: boolean; light?: boolean; note?: boolean }

// Enfoca/scrollea a una sección por id (alertas accionables). No-op si no existe.
function scrollToSection(id: string) {
  const el = document.getElementById(id)
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
type Cell = { text: string; right?: boolean; color?: string; bold?: boolean; capitalize?: boolean }
type HistTableModel = { title: string; head: Cell[]; rows: Cell[][]; foot: Cell[] | null }
type HistKpi = { ingresos: number; egresos: number; neto: number; promedio: number }

const OPERATIVE_LEGEND: LegendItem[] = [
  { color: 'rgba(74,124,109,.85)', label: 'Ejecutado' },
  { color: 'rgba(74,124,109,.25)', label: 'Presupuesto', dashed: true },
  { color: 'rgba(16,185,129,.85)', label: 'Cobrado' },
  { color: 'rgba(16,185,129,.25)', label: 'Esperado', dashed: true },
]

const netColor = (v: number) => (v >= 0 ? 'var(--emerald)' : 'var(--ruby)')
const MONTH_LONG = (year: number, m: number) => new Date(year, m - 1, 1).toLocaleDateString('es-MX', { month: 'long' })

export default function DashboardPage() {
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  const anualMode = pathname === '/dashboard-anual' || params.get('view') === 'anual'
  const { group } = useAuth()
  const { companyId, companyName } = useCompany()
  const { showToast } = useToast()
  const canView = canViewDashboard(group)

  // Estado operativo
  const [ds, setDs] = useState<DashboardState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [periodKey, setPeriodKey] = useState(currentPeriodKey())
  const [lastUpdated, setLastUpdated] = useState('')

  // Filtros / tabs
  const [activeTab, setActiveTab] = useState<SectionTab>('income')
  const [memberSearch, setMemberSearch] = useState('')
  const [incSearch, setIncSearch] = useState('')
  const [incStatus, setIncStatus] = useState('todos')
  const [incLineage, setIncLineage] = useState('todos')

  // Gráfica operativa
  const [opChart, setOpChart] = useState<ChartModel>({ labels: [], series: [], subtitle: 'Cargando datos del año...' })

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

  // Presupuesto (disponible vs usado por partida) — vista budget_availability.
  const [budgetData, setBudgetData] = useState<{ rows: BudgetAvailabilityRow[]; categories: Map<string, BudgetCategoryMeta> } | null>(null)
  const [budgetLoading, setBudgetLoading] = useState(false)
  const [budgetError, setBudgetError] = useState(false)
  const [budgetPeriod, setBudgetPeriod] = useState<string>(BUDGET_ALL_PERIOD)

  // Solicitudes / Impuestos (payment_requests) — comparten el selector de periodo
  // del presupuesto (budgetPeriod).
  const [reqData, setReqData] = useState<PaymentRequestRow[] | null>(null)
  const [reqLoading, setReqLoading] = useState(false)
  const [reqError, setReqError] = useState(false)

  // En modo anual la vista histórica está activa desde el primer paint (equivalente
  // a la clase `anual-boot` del vanilla, que oculta lo operativo sin flash).
  const inHistView = anualMode

  useEffect(() => {
    document.title = anualMode ? 'Dashboard anual | Flux Operadora' : 'Dashboard operativo | Flux Operadora'
  }, [anualMode])

  // ── Carga operativa ─────────────────────────────────────────────────────────
  const loadDashboard = useCallback(async (pk: string) => {
    setRefreshing(true)
    try {
      const payload = await fetchDashboardPayload(pk)
      setDs(toDashboardState(payload))
      setLastUpdated(`Ultima actualizacion: ${fmtDateTime(new Date())}`)
      if (!anualMode) void loadYearlyChart(pk)
    } catch (err) {
      showToast('Error al cargar', friendlyError(err), 'error')
    } finally {
      setRefreshing(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anualMode, showToast])

  async function loadYearlyChart(pk: string) {
    const { months, labels, year } = buildYearMonths(pk)
    setOpChart((c) => ({ ...c, subtitle: `Cargando ${months.length} meses...` }))
    try {
      const results = await Promise.all(months.map((m) => fetchDashboardPayload(m)))
      const agg = aggregateYearly(results)
      // Sin datos reales del periodo => empty state honesto (nunca serie de ejemplo).
      if (!hasChartData(agg)) {
        setOpChart({ labels: [], series: [], subtitle: 'Sin datos del periodo', empty: true })
        return
      }
      setOpChart({
        labels,
        subtitle: `Enero – ${labels[labels.length - 1]} ${year}`,
        series: [
          { kind: 'bar', label: 'Presupuesto', data: agg.presupuesto, color: C.presupBorder, fill: C.presupFill, axis: 'y' },
          { kind: 'bar', label: 'Ejecutado', data: agg.ejecutado, color: C.ejecBorder, fill: C.ejecFill, axis: 'y' },
          { kind: 'line', label: 'Esperado', data: agg.esperado, color: C.esperado, dashed: true, axis: 'y2' },
          { kind: 'line', label: 'Cobrado', data: agg.cobrado, color: C.cobrado, axis: 'y2' },
        ],
      })
    } catch {
      setOpChart((c) => ({ ...c, subtitle: 'No se pudo cargar la serie anual' }))
    }
  }

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

  // Init: carga operativa siempre; luego anual si aplica.
  useEffect(() => {
    if (!canView) return
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

  // Carga de presupuesto (año en curso de la empresa activa). Solo vista operativa.
  useEffect(() => {
    if (!canView || anualMode || !companyId) { setBudgetData(null); return }
    let cancelled = false
    setBudgetLoading(true)
    setBudgetError(false)
    setBudgetPeriod(BUDGET_ALL_PERIOD)
    ;(async () => {
      try {
        const data = await fetchBudgetAvailability(companyId, new Date().getFullYear())
        if (!cancelled) setBudgetData(data)
      } catch (err) {
        if (!cancelled) { setBudgetError(true); showToast('Error al cargar presupuesto', friendlyError(err), 'error') }
      } finally {
        if (!cancelled) setBudgetLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, anualMode, companyId])

  // Carga de solicitudes (año en curso de la empresa activa). Solo vista operativa.
  useEffect(() => {
    if (!canView || anualMode || !companyId) { setReqData(null); return }
    let cancelled = false
    setReqLoading(true)
    setReqError(false)
    ;(async () => {
      try {
        const data = await fetchPaymentRequests(companyId, new Date().getFullYear())
        if (!cancelled) setReqData(data)
      } catch (err) {
        if (!cancelled) { setReqError(true); showToast('Error al cargar solicitudes', friendlyError(err), 'error') }
      } finally {
        if (!cancelled) setReqLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, anualMode, companyId])

  function onPeriodChange(v: string) {
    setPeriodKey(v)
    void loadDashboard(v || currentPeriodKey())
  }
  function onRefresh() {
    void loadDashboard(anualMode ? currentPeriodKey() : (periodKey || currentPeriodKey()))
  }
  function onHistYearChange(v: string) {
    setHistSel(v)
    if (v === 'todos') void enterAllYears(histMapeoState)
    else void enterHistYear(Number(v), histMapeoState)
  }
  function onClosePeriod() {
    if (ds?.closureChecklist?.can_close) {
      showToast('Cierre pendiente', 'El cierre formal se conectara en la siguiente tanda.', 'success')
    } else {
      showToast('No se puede cerrar', 'Resuelve primero los bloqueos del checklist.', 'error')
    }
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
  const scopedBudget = useMemo(
    () => (ds && companyId ? ds.budgetComparison.filter((row) => row.company_id === companyId) : []),
    [ds, companyId],
  )
  const scopedCompanyLabel = scopedBudget[0]?.company || companyName
  const kpis = useMemo(() => (ds ? computeKpis(ds.kpis, scopedBudget, ds.closureChecklist) : null), [ds, scopedBudget])
  const closure = useMemo(() => (ds ? computeClosure(ds.kpis, ds.closureChecklist) : null), [ds])
  const members = useMemo(() => (ds ? filterMembers(ds.incomeMembers, memberSearch) : []), [ds, memberSearch])

  // Modelo de socios (cuotas/estirpe): se oculta cuando la empresa activa no tiene
  // socios/cuotas, en vez de mostrar tablas vacías.
  const hasMembers = !!ds && ds.incomeMembers.length > 0

  const incomeLineages = useMemo(() => (ds ? uniqueSorted(ds.incomeMembers.map((r) => r.lineage)) : []), [ds])
  const income = useMemo(
    () => (ds ? filterIncome(ds.incomeMembers, { search: incSearch, status: incStatus, lineage: incLineage }) : []),
    [ds, incSearch, incStatus, incLineage],
  )
  const incomeTotals = useMemo(() => computeIncomeTotals(income), [income])

  const budgetAgg = useMemo(
    () => (budgetData ? aggregateBudget(budgetData.rows, budgetData.categories, budgetPeriod) : null),
    [budgetData, budgetPeriod],
  )
  const periodLabel = budgetPeriod === BUDGET_ALL_PERIOD ? `Año ${new Date().getFullYear()}` : budgetMonthLabel(budgetPeriod)

  // Tabs visibles: "Ingresos" (modelo de socios) solo si la empresa tiene cuotas.
  const visibleTabs = useMemo<[SectionTab, string][]>(() => {
    const t: [SectionTab, string][] = []
    if (hasMembers) t.push(['income', 'Ingresos'])
    t.push(['cash', 'Efectivo'], ['incidents', 'Incidencias'])
    return t
  }, [hasMembers])

  // Si la pestaña activa deja de existir (p.ej. sin socios), cae a la primera.
  useEffect(() => {
    if (!visibleTabs.some(([t]) => t === activeTab)) setActiveTab(visibleTabs[0][0])
  }, [visibleTabs, activeTab])
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
  const closurePending = !!closure && closure.status !== 'closed'
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
      tone: 'warning', value: money(taxesAgg.retenciones), label: 'retenciones por enterar', target: 'sec-taxes',
    })
    if (closurePending) out.push({
      tone: 'info', value: '1', label: 'cierre pendiente', target: 'sec-closure',
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overspentCount, requestsAgg, taxesAgg, closurePending])

  const cash = ds?.kpis.efectivo || {}
  const checks = ds?.closureChecklist?.checks || {}
  const inc = ds?.kpis.ingresos || {}

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
          <h2>Cobranza por socio</h2>
          <div className={s.panelSub}>Cuotas del periodo — pendientes primero</div>
        </div>
        <input className={s.memberSearch} type="search" placeholder="Buscar..." value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
      </div>
      <div className={s.memberTableWrap}>
        <table className={s.table}>
          <thead><tr><th>Socio</th><th>Esperado</th><th>Cobrado</th><th>Pendiente</th><th>Estatus</th></tr></thead>
          <tbody>
            {!ds && <TableSkeletonRows cols={5} rows={4} />}
            {ds && members.length === 0 && <tr><td colSpan={5} className={s.tableMsg}>Sin registros para este periodo.</td></tr>}
            {ds && members.map((r, i) => {
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
            : 'Ejecucion presupuestal, cobranza, efectivo y cierre mensual.'}</p>
        </div>
        <div className={s.headActions}>
          {!anualMode && (
            <label className={s.periodField}>
              <span>Periodo</span>
              <input type="month" value={periodKey} onChange={(e) => onPeriodChange(e.target.value)} />
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
          <button className={s.secondaryBtn} type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Cargando...' : 'Actualizar'}</button>
          <button className={s.secondaryBtn} type="button" onClick={() => setShowExport(true)}>Exportar</button>
          <button className={s.secondaryBtn} type="button" onClick={() => setShowHistory(true)}>Historial</button>
        </div>
      </div>

      <span className={s.lastUpdated}>{lastUpdated}</span>

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
        <div className={s.kpiGrid}>
          <div className={`${s.kpiCard} ${s.accent}`}>
            <div className={s.kpiLabel}>Ejecucion presupuestal</div>
            <div className={s.kpiValue}>{kpis ? kpis.executed : '$0'}</div>
            <div className={s.kpiProgress}><div className={s.kpiProgressBar} style={{ width: `${kpis ? kpis.execPct : 0}%` }} /></div>
            <div className={s.kpiSub}>{kpis ? kpis.executedSub : 'de $0 presupuestado · 0%'}</div>
          </div>
          <div className={`${s.kpiCard} ${s.success}`}>
            <div className={s.kpiLabel}>Cobranza de cuotas</div>
            <div className={s.kpiValue}>{kpis ? kpis.collected : '$0'}</div>
            <div className={s.kpiProgress}><div className={s.kpiProgressBar} style={{ width: `${kpis ? kpis.collPct : 0}%` }} /></div>
            <div className={s.kpiSub}>{kpis ? kpis.collectedSub : 'de $0 esperado · 0%'}</div>
          </div>
          <div className={`${s.kpiCard} ${s.violet}`}>
            <div className={s.kpiLabel}>Comprobacion de efectivo</div>
            <div className={s.kpiValue}>{kpis ? kpis.cash : '0 fondos'}</div>
            <div className={s.kpiProgress}><div className={s.kpiProgressBar} style={{ width: `${kpis ? kpis.cashPct : 0}%` }} /></div>
            <div className={s.kpiSub}>{kpis ? kpis.cashSub : '0 comprobados · 0 pendientes'}</div>
          </div>
          <div className={`${s.kpiCard} ${s.warning}`}>
            <div className={s.kpiLabel}>Incidencias abiertas</div>
            <div className={s.kpiValue}>{kpis ? kpis.incidents : '0'}</div>
            <div className={s.kpiProgress}><div className={s.kpiProgressBar} style={{ width: `${kpis ? kpis.incPct : 0}%` }} /></div>
            <div className={s.kpiSub}>{kpis ? kpis.incidentsSub : '0 bloqueos de cierre'}</div>
          </div>
        </div>
      )}

      {/* ── Alertas / estado del mes (operativo) — lo primero tras los KPIs ── */}
      {!inHistView && (
        <div className={s.alertsRow}>
          {alerts.length === 0 ? (
            <div className={`${s.alertCard} ${s.ok}`}>
              <span className={s.alertValue}>✓</span>
              <span className={s.alertLabel}>Todo en orden este periodo</span>
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
        </div>
      )}

      {/* Gráfica principal */}
      <div className={s.chartCard}>
        <div className={s.panelHeader}>
          <div>
            <h2>Presupuesto vs Ejecutado — evolucion mensual</h2>
            <div className={s.panelSub}>{activeChart?.subtitle}</div>
          </div>
          <div className={s.chartLegend}>
            {legend.map((l, i) => (
              l.note ? (
                <div key={i} className={s.chartLegendItem} style={{ color: 'var(--text-3)' }}>{l.label}</div>
              ) : (
                <div key={i} className={s.chartLegendItem}>
                  <div className={s.chartLegendDot} style={{ background: l.color, ...(l.dashed ? { outline: '1px dashed', outlineOffset: '1px' } : {}) }} />
                  {l.label}
                </div>
              )
            ))}
          </div>
        </div>
        <div className={s.chartBody}>
          {activeChart && activeChart.labels.length > 0 ? (
            <ComboChart
              labels={activeChart.labels}
              series={activeChart.series}
              leftTitle={inHistView ? undefined : 'Gastos'}
              rightTitle={inHistView ? undefined : 'Ingresos'}
            />
          ) : !inHistView && opChart.empty ? (
            <div className={s.chartEmpty}>Sin datos del periodo</div>
          ) : null}
        </div>
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
          <div className={s.dashGrid} style={hasMembers ? undefined : { gridTemplateColumns: '1fr' }}>
            {hasMembers && memberCard(false)}
            <div id="sec-closure" className={`${s.chartCard} ${s.closureCard}`}>
              <div className={s.panelHeader}>
                <div>
                  <h2>Checklist de cierre</h2>
                  <div className={s.panelSub}>{closure ? closure.statusLabel : 'Calculando...'}</div>
                </div>
                <button className={s.primaryBtn} type="button" disabled={!closure?.canClose} onClick={onClosePeriod} style={{ whiteSpace: 'nowrap', fontSize: 12 }}>Cerrar periodo</button>
              </div>
              <div className={s.summaryList}>
                {closure && (
                  <>
                    <div className={s.summaryRow}><span>Estatus</span><strong><Badge variant={closureStatusBadge(closure.status).variant}>{closureStatusBadge(closure.status).label}</Badge></strong></div>
                    <div className={s.summaryRow}><span>Puede cerrar</span><strong><Badge variant={closure.canClose ? 'success' : 'danger'}>{closure.canClose ? 'Si' : 'No'}</Badge></strong></div>
                    <div className={s.summaryRow}><span>Bloqueos</span><strong>{closure.blockersText}</strong></div>
                  </>
                )}
              </div>
              <div className={s.closureChecks}>
                <div className={s.closureChecksLabel}>Revisiones de bloqueo</div>
                <div className={s.closureChecksList}>
                  {closure && closure.checkEntries.length === 0 && <div className={s.emptyNote}>Sin revisiones para este periodo.</div>}
                  {closure && closure.checkEntries.map((c, i) => (
                    <div key={i} className={`${s.summaryRow} ${s.summaryRowTight}`}>
                      <span>{c.label}</span>
                      <strong><Badge variant={c.blocks ? 'danger' : 'success'}>{c.blocks ? 'Bloquea' : 'OK'}</Badge></strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Presupuesto: disponible vs usado, por partida ── */}
          <section id="sec-budget" className={s.tableCard}>
            <div className={s.panelHeader} style={{ flexWrap: 'wrap' }}>
              <div>
                <h2>Presupuesto — disponible vs usado por partida</h2>
                <div className={s.panelSub}>
                  {(scopedCompanyLabel || companyName || 'Empresa activa')} · {budgetPeriod === BUDGET_ALL_PERIOD ? `Año ${new Date().getFullYear()}` : budgetMonthLabel(budgetPeriod)}
                </div>
              </div>
              <div className={s.budgetLegend}>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--emerald)' }} />Ejecutado</div>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--amber)' }} />Comprometido</div>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--border)' }} />Disponible</div>
                <div className={s.chartLegendItem}><div className={s.chartLegendDot} style={{ background: 'var(--ruby)' }} />Sobregirado</div>
              </div>
              <label className={s.periodField}>
                <span>Periodo</span>
                <select className={s.budgetSelect} value={budgetPeriod} onChange={(e) => setBudgetPeriod(e.target.value)} disabled={!budgetAgg || budgetLoading}>
                  <option value={BUDGET_ALL_PERIOD}>Año completo</option>
                  {budgetAgg?.months.map((m) => <option key={m} value={m}>{budgetMonthLabel(m)}</option>)}
                </select>
              </label>
            </div>

            {budgetAgg && !budgetLoading && !budgetError && (budgetAgg.partidas.length > 0 || budgetAgg.totals.budgeted > 0) && (
              <div className={s.miniGrid}>
                {([
                  ['Presupuestado', money(budgetAgg.totals.budgeted)],
                  ['Usado', money(budgetAgg.totals.used)],
                  ['Disponible', money(budgetAgg.totals.available)],
                  ['% usado', pct(budgetAgg.totals.pctUsed)],
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
                <div className={s.budgetList}>
                  {budgetAgg.partidas.map((p) => <BudgetPartidaRow key={p.categoryId} p={p} />)}
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
                  {(scopedCompanyLabel || companyName || 'Empresa activa')} · {periodLabel} · por periodo presupuestal (budget_month)
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
                      <span className={s.funnelAmount}>{money(st.amount)}</span>
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
                        <strong>{whole(requestsAgg.rejected.count)} · {money(requestsAgg.rejected.amount)}</strong>
                      </div>
                    )}
                    {requestsAgg.changesRequested.count > 0 && (
                      <div className={`${s.reqAlert} ${s.warning}`}>
                        <span>Cambios solicitados</span>
                        <strong>{whole(requestsAgg.changesRequested.count)} · {money(requestsAgg.changesRequested.amount)}</strong>
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
                          <td className={s.right}>{money(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td style={{ fontWeight: 800 }}>Total</td>
                        <td className={s.right} style={{ fontWeight: 800 }}>{whole(requestsAgg.total)}</td>
                        <td className={s.right} style={{ fontWeight: 800 }}>{money(requestsAgg.byStatus.reduce((a, r) => a + r.amount, 0))}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className={s.budgetOmitNote}>
                  Monto = importe solicitado (amount_requested). El esquema no registra un monto pagado real, así que las pagadas también usan el solicitado.
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
                  {(scopedCompanyLabel || companyName || 'Empresa activa')} · {periodLabel}
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
                Ninguna de las {whole(taxesAgg.total)} solicitud{taxesAgg.total === 1 ? '' : 'es'} del periodo trae desglose fiscal (IVA / retenciones).
              </div>
            )}
            {!reqLoading && !reqError && taxesAgg && taxesAgg.withDetail > 0 && (
              <>
                <div className={s.miniGrid} style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
                  <div className={`${s.miniCard} ${s.taxIva}`}>
                    <span>IVA acreditable</span>
                    <strong>{money(taxesAgg.iva)}</strong>
                    <span className={s.taxHint}>Suma de tax_amount</span>
                  </div>
                  <div className={`${s.miniCard} ${s.taxRet}`}>
                    <span>Retenciones por enterar</span>
                    <strong>{money(taxesAgg.retenciones)}</strong>
                    <span className={s.taxHint}>IVA/ISR retenido · withholding_amount</span>
                  </div>
                </div>
                <div className={s.budgetOmitNote}>
                  {whole(taxesAgg.withDetail)} de {whole(taxesAgg.total)} solicitud{taxesAgg.total === 1 ? '' : 'es'} con desglose fiscal en el periodo. El resto no captura IVA ni retenciones.
                </div>
              </>
            )}
          </section>

          <div className={s.tabsBlock}>
            <div className={s.sectionTabs}>
              {visibleTabs.map(([tab, label]) => (
                <button key={tab} type="button" className={`${s.sectionTab} ${activeTab === tab ? s.active : ''}`} onClick={() => setActiveTab(tab)}>{label}</button>
              ))}
            </div>
          </div>

          {activeTab === 'income' && hasMembers && (
            <section className={s.tableCard}>
              <div className={s.miniGrid}>
                {[['Total esperado', money(incomeTotals.expected)], ['Total cobrado', money(incomeTotals.paid)], ['Total pendiente', money(incomeTotals.pending)], ['Socios con saldo', whole(incomeTotals.members)]].map(([l, v]) => (
                  <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                ))}
              </div>
              <div className={s.toolbar} style={{ gridTemplateColumns: 'minmax(200px,1fr) 150px 150px' }}>
                <input type="search" placeholder="Buscar socio..." value={incSearch} onChange={(e) => setIncSearch(e.target.value)} />
                <select value={incStatus} onChange={(e) => setIncStatus(e.target.value)}>
                  <option value="todos">Estatus: Todos</option><option value="pending">Pendiente</option><option value="partial">Parcial</option><option value="paid">Pagado</option><option value="overdue">Vencido</option>
                </select>
                <select value={incLineage} onChange={(e) => setIncLineage(e.target.value)}><option value="todos">Estirpe: Todas</option>{incomeLineages.map((v) => <option key={v} value={normKey(v)}>{v}</option>)}</select>
              </div>
              <div className={s.tableWrap}>
                <table className={s.table} style={{ minWidth: 900 }}>
                  <thead><tr><th>Socio</th><th>Estirpe</th><th>Periodo</th><th>Esperado</th><th>Cobrado</th><th>Pendiente</th><th>Estatus</th><th>Inc.</th><th>Fact.</th></tr></thead>
                  <tbody>
                    {!ds && <TableSkeletonRows cols={9} rows={4} />}
                    {ds && income.length === 0 && <tr><td colSpan={9} className={s.tableMsg}>Sin registros para este filtro.</td></tr>}
                    {ds && income.map((r, i) => {
                      const b = incomeStatusBadge(r.status)
                      return (
                        <tr key={i}>
                          <td><span className={s.cellMain}>{r.member_name || '—'}</span></td>
                          <td>{r.lineage || '-'}</td>
                          <td>{r.billing_period || '-'}</td>
                          <td>{money(r.expected_amount)}</td>
                          <td>{money(r.paid_amount)}</td>
                          <td>{money(r.pending_amount)}</td>
                          <td><Badge variant={b.variant}>{b.label}</Badge></td>
                          <td>{whole(r.open_incidents)}</td>
                          <td>{whole(r.issued_invoices)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'cash' && (
            <section className={s.tableCard}>
              <div className={s.panelHeader}>
                <h2>Efectivo y comprobaciones</h2>
                <Link className={s.secondaryBtn} to="/efectivo">Ver modulo completo</Link>
              </div>
              <div className={s.miniGrid}>
                {[['Fondos activos', whole(cash.active_cash_funds)], ['Pendientes', whole(cash.pending_cash_reconciliation)], ['En revision', whole(cash.cash_in_review)], ['Vencidos', whole(cash.overdue_cash_funds)], ['Monto entregado', money(cash.cash_assigned_amount)], ['Monto comprobado', money(cash.cash_verified_amount)], ['Monto pendiente', money(cash.cash_pending_amount)]].map(([l, v]) => (
                  <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                ))}
              </div>
              <div className={s.summaryList}>
                {[['Fondos vencidos', num(checks.overdue_cash_funds)], ['Comprobaciones en revision', num(checks.cash_reconciliations_in_review)]].map(([label, count]) => (
                  <div key={label as string} className={s.summaryRow}><span>{label}</span><strong><Badge variant={(count as number) > 0 ? 'danger' : 'success'}>{(count as number) > 0 ? 'Bloquea' : 'OK'}</Badge></strong></div>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'incidents' && (
            <section className={s.tableCard}>
              <div className={s.panelHeader}>
                <h2>Incidencias y facturas</h2>
                <Link className={s.secondaryBtn} to="/ingresos">Ver modulo completo</Link>
              </div>
              <div className={s.miniGrid}>
                {[['Incidencias abiertas', whole(inc.open_incidents)], ['Incidencias cobradas', whole(inc.paid_incidents)], ['Facturas emitidas', whole(inc.issued_invoices)], ['Facturas pendientes', whole(inc.pending_invoices)]].map(([l, v]) => (
                  <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                ))}
              </div>
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
        <span>Comprometido<strong>{money(p.committed)}</strong></span>
        <span>Usado<strong>{money(p.used)}</strong></span>
        <span>Disponible<strong className={p.over ? s.alert : undefined}>{money(p.available)}</strong></span>
      </div>
    </div>
  )
}
