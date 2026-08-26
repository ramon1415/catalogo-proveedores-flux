import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import {
  fetchDashboardPayload, fetchHistoricalPeriods, fetchHistoricalYear, fetchHistoricalAll, loadHistMapeo,
} from './api'
import {
  toDashboardState, currentPeriodKey, fmtDateTime, friendlyError, canViewDashboard,
  computeKpis, computeClosure, filterMembers, filterExpenses, hasBudget, computeYtdTotals,
  filterIncome, computeIncomeTotals, incomeStatusBadge, closureStatusBadge,
  money, whole, pct, num, uniqueSorted, normKey,
  buildYearMonths, aggregateYearly, hasChartData, demoChartSeries,
  aggregateHistYear, aggregateHistAll, histKpisTotals, buildHistMatrix, fmtCell, fmtMoney0, yearColor,
} from './logic'
import type { DashboardState, SectionTab, HistMapeo } from './types'
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

type ChartModel = { labels: string[]; series: Serie[]; subtitle: string }
type LegendItem = { color: string; label: string; dashed?: boolean; light?: boolean; note?: boolean }
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
  const { showToast } = useToast()
  const canView = canViewDashboard(group)

  // Estado operativo
  const [ds, setDs] = useState<DashboardState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [periodKey, setPeriodKey] = useState(currentPeriodKey())
  const [lastUpdated, setLastUpdated] = useState('')

  // Filtros / tabs
  const [activeTab, setActiveTab] = useState<SectionTab>('expenses')
  const [memberSearch, setMemberSearch] = useState('')
  const [expSearch, setExpSearch] = useState('')
  const [expCompany, setExpCompany] = useState('todos')
  const [expCenter, setExpCenter] = useState('todos')
  const [expCategory, setExpCategory] = useState('todos')
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
      const real = hasChartData(agg)
      const series = real ? agg : demoChartSeries(labels.length)
      const subtitle = real
        ? `Enero – ${labels[labels.length - 1]} ${year}`
        : `Enero – ${labels[labels.length - 1]} ${year} · datos de ejemplo`
      setOpChart({
        labels,
        subtitle,
        series: [
          { kind: 'bar', label: 'Presupuesto', data: series.presupuesto, color: C.presupBorder, fill: C.presupFill, axis: 'y' },
          { kind: 'bar', label: 'Ejecutado', data: series.ejecutado, color: C.ejecBorder, fill: C.ejecFill, axis: 'y' },
          { kind: 'line', label: 'Esperado', data: series.esperado, color: C.esperado, dashed: true, axis: 'y2' },
          { kind: 'line', label: 'Cobrado', data: series.cobrado, color: C.cobrado, axis: 'y2' },
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
      const rows = await fetchHistoricalYear(year)
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
  }, [showToast])

  const enterAllYears = useCallback(async (mapeo: HistMapeo) => {
    setHistChart({ labels: [], series: [], subtitle: 'Cargando todos los años...' })
    try {
      const rows = await fetchHistoricalAll()
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
  }, [showToast])

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
        const periods = await fetchHistoricalPeriods()
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
  const kpis = useMemo(() => (ds ? computeKpis(ds.kpis, ds.budgetComparison, ds.closureChecklist) : null), [ds])
  const closure = useMemo(() => (ds ? computeClosure(ds.kpis, ds.closureChecklist) : null), [ds])
  const members = useMemo(() => (ds ? filterMembers(ds.incomeMembers, memberSearch) : []), [ds, memberSearch])

  const expenseCompanies = useMemo(() => (ds ? uniqueSorted(ds.budgetComparison.map((r) => r.company)) : []), [ds])
  const expenseCenters = useMemo(() => (ds ? uniqueSorted(ds.budgetComparison.map((r) => r.cost_center)) : []), [ds])
  const expenseCategories = useMemo(() => (ds ? uniqueSorted(ds.budgetComparison.map((r) => r.budget_category)) : []), [ds])
  const expenses = useMemo(
    () => (ds ? filterExpenses(ds.budgetComparison, { search: expSearch, company: expCompany, costCenter: expCenter, category: expCategory }) : []),
    [ds, expSearch, expCompany, expCenter, expCategory],
  )
  const showBudgetNote = ds ? !hasBudget(ds.budgetComparison) : false

  const ytdTotals = useMemo(() => (ds ? computeYtdTotals(ds.ytd) : null), [ds])
  const incomeLineages = useMemo(() => (ds ? uniqueSorted(ds.incomeMembers.map((r) => r.lineage)) : []), [ds])
  const income = useMemo(
    () => (ds ? filterIncome(ds.incomeMembers, { search: incSearch, status: incStatus, lineage: incLineage }) : []),
    [ds, incSearch, incStatus, incLineage],
  )
  const incomeTotals = useMemo(() => computeIncomeTotals(income), [income])

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
            {!ds && <tr><td colSpan={5} className={s.tableMsg}>Cargando...</td></tr>}
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
          <div className={s.dashGrid}>
            {memberCard(false)}
            <div className={`${s.chartCard} ${s.closureCard}`}>
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

          <div className={s.tabsBlock}>
            <div className={s.sectionTabs}>
              {([['expenses', 'Gastos del mes'], ['ytd', 'YTD'], ['income', 'Ingresos'], ['cash', 'Efectivo'], ['incidents', 'Incidencias']] as [SectionTab, string][]).map(([tab, label]) => (
                <button key={tab} type="button" className={`${s.sectionTab} ${activeTab === tab ? s.active : ''}`} onClick={() => setActiveTab(tab)}>{label}</button>
              ))}
            </div>
          </div>

          {activeTab === 'expenses' && (
            <section className={s.tableCard}>
              <div className={s.toolbar} style={{ gridTemplateColumns: 'minmax(200px,1fr) 160px 160px 160px' }}>
                <input type="search" placeholder="Buscar empresa, centro o partida..." value={expSearch} onChange={(e) => setExpSearch(e.target.value)} />
                <select value={expCompany} onChange={(e) => setExpCompany(e.target.value)}><option value="todos">Empresa: Todas</option>{expenseCompanies.map((v) => <option key={v} value={normKey(v)}>{v}</option>)}</select>
                <select value={expCenter} onChange={(e) => setExpCenter(e.target.value)}><option value="todos">Centro: Todos</option>{expenseCenters.map((v) => <option key={v} value={normKey(v)}>{v}</option>)}</select>
                <select value={expCategory} onChange={(e) => setExpCategory(e.target.value)}><option value="todos">Partida: Todas</option>{expenseCategories.map((v) => <option key={v} value={normKey(v)}>{v}</option>)}</select>
              </div>
              {showBudgetNote && <div className={s.budgetNote}>El presupuesto base esta pendiente de conexion al modelo presupuestal final.</div>}
              <div className={s.tableWrap}>
                <table className={s.table} style={{ minWidth: 980 }}>
                  <thead><tr><th>Empresa</th><th>Centro</th><th>Partida</th><th>Codigo</th><th>Presupuesto</th><th>Comprometido</th><th>Ejecutado</th><th>Disponible</th><th>Var. $</th><th>Var. %</th></tr></thead>
                  <tbody>
                    {!ds && <tr><td colSpan={10} className={s.tableMsg}>Cargando...</td></tr>}
                    {ds && expenses.length === 0 && <tr><td colSpan={10} className={s.tableMsg}>Sin datos para este filtro.</td></tr>}
                    {ds && expenses.map((r, i) => (
                      <tr key={i}>
                        <td><span className={s.cellMain}>{r.company || 'Sin empresa'}</span></td>
                        <td>{r.cost_center || 'Sin centro'}</td>
                        <td>{r.budget_category || 'Sin partida'}</td>
                        <td style={{ color: 'var(--text-3)' }}>{r.category_code || '-'}</td>
                        <td>{money(r.budget_amount)}</td>
                        <td>{money(r.committed_amount)}</td>
                        <td>{money(r.executed_amount)}</td>
                        <td>{money(r.available_amount)}</td>
                        <td style={{ color: num(r.variance_amount) < 0 ? 'var(--ruby)' : 'inherit' }}>{money(r.variance_amount)}</td>
                        <td>{pct(r.variance_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'ytd' && (
            <section className={s.tableCard}>
              <div className={s.miniGrid}>
                {ytdTotals && [['Presupuesto YTD', money(ytdTotals.budget)], ['Comprometido YTD', money(ytdTotals.committed)], ['Ejecutado YTD', money(ytdTotals.executed)], ['Disponible YTD', money(ytdTotals.available)]].map(([l, v]) => (
                  <div key={l} className={s.miniCard}><span>{l}</span><strong>{v}</strong></div>
                ))}
              </div>
              <div className={s.tableWrap}>
                <table className={s.table} style={{ minWidth: 900 }}>
                  <thead><tr><th>Empresa</th><th>Centro</th><th>Partida</th><th>Presupuesto YTD</th><th>Comprometido</th><th>Ejecutado</th><th>Disponible</th><th>Var. $</th><th>Var. %</th></tr></thead>
                  <tbody>
                    {!ds && <tr><td colSpan={9} className={s.tableMsg}>Cargando...</td></tr>}
                    {ds && ds.ytd.length === 0 && <tr><td colSpan={9} className={s.tableMsg}>Sin datos acumulados.</td></tr>}
                    {ds && ds.ytd.map((r, i) => (
                      <tr key={i}>
                        <td>{r.company || 'Sin empresa'}</td>
                        <td>{r.cost_center || 'Sin centro'}</td>
                        <td>{r.budget_category || 'Sin partida'}</td>
                        <td>{money(r.ytd_budget)}</td>
                        <td>{money(r.ytd_committed)}</td>
                        <td>{money(r.ytd_executed)}</td>
                        <td>{money(r.ytd_available)}</td>
                        <td>{money(r.ytd_variance_amount)}</td>
                        <td>{pct(r.ytd_variance_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'income' && (
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
                    {!ds && <tr><td colSpan={9} className={s.tableMsg}>Cargando...</td></tr>}
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
