import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { TableSkeletonRows } from '../../components/ui/Skeleton'
import { IcSearch } from '../../components/ui/icons'
import { formatCurrency, compactCurrency, numberValue } from '../../lib/format'
import { loadIngresosData, generateFees as apiGenerateFees } from './api'
import {
  makeLookups, computeStats, computeDashboard, computeStatement,
  filterMembers, filterPaymentCharges, chargesForPeriod, filterIncidents, filterInvoices,
  badgeVariant, chargeLabel, incidentLabel, invoiceStatusLabel, periodStatusLabel,
  quickFilterLabel, dateCell, formatFactor, friendlyError, rpcError, LINEAGES,
} from './logic'
import type {
  MemberFilters, PaymentFilters, IncidentFilters, InvoiceFilters,
} from './logic'
import type {
  IngresosData, IngresosTab, QuickFilter, Member, MaintenanceFeeCharge, InvoiceType,
} from './types'
import { MemberModal } from './MemberModal'
import { PeriodModal } from './PeriodModal'
import { PaymentModal } from './PaymentModal'
import { IncidentModal } from './IncidentModal'
import { InvoiceModal } from './InvoiceModal'
import { InvoicePayModal } from './InvoicePayModal'
import { StatementModal } from './StatementModal'
import s from './Ingresos.module.css'

type MemberModalState = { member: Member | null } | null
type InvoiceModalState = { type: InvoiceType; id: string; title: string; subtitle: string; amount: string } | null

export default function IngresosPage() {
  const { profile, memberships } = useAuth()
  const { companyId, companyName } = useCompany()
  const { showToast } = useToast()
  const location = useLocation()
  const profileId = (profile as { id?: string } | null)?.id ?? null

  const isIncidentsPage = location.pathname === '/incidencias'
  const routeTab: IngresosTab = isIncidentsPage ? 'incidents' : 'dashboard'

  const [data, setData] = useState<IngresosData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tab, setTab] = useState<IngresosTab>(routeTab)
  const [quick, setQuick] = useState<QuickFilter>(null)
  const [periodId, setPeriodId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  const [memberFilters, setMemberFilters] = useState<MemberFilters>({ query: '', status: 'todos', lineage: 'todos' })
  const [paymentFilters, setPaymentFilters] = useState<PaymentFilters>({ query: '', status: 'todos', period: 'todos' })
  const [incidentFilters, setIncidentFilters] = useState<IncidentFilters>({ query: '', status: 'todos', receiver: 'todos', date: '' })
  const [invoiceFilters, setInvoiceFilters] = useState<InvoiceFilters>({ query: '', type: 'todos', status: 'todos', date: '' })

  const [memberModal, setMemberModal] = useState<MemberModalState>(null)
  const [periodModal, setPeriodModal] = useState(false)
  const [paymentCharge, setPaymentCharge] = useState<MaintenanceFeeCharge | null>(null)
  const [incidentModal, setIncidentModal] = useState(false)
  const [invoiceModal, setInvoiceModal] = useState<InvoiceModalState>(null)
  const [invoicePayId, setInvoicePayId] = useState<string | null>(null)
  const [statementMemberId, setStatementMemberId] = useState<string | null>(null)

  // Reseed del tab cuando cambia la ruta (deep-link).
  useEffect(() => {
    setTab(routeTab)
    setQuick(null)
  }, [routeTab])

  useEffect(() => {
    setIncidentModal(false)
  }, [companyId])

  async function reload() {
    setStatus('loading')
    try {
      const d = await loadIngresosData(isIncidentsPage ? 'incidents' : 'income')
      setData(d)
      setPeriodId((prev) => prev ?? d.periods[0]?.id ?? null)
      setStatus('ready')
    } catch (error) {
      setStatus('error')
      showToast('No se pudo cargar', friendlyError(error), 'error')
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isIncidentsPage])

  // Clamp del filtro de periodo (paridad con fillCatalogs: vuelve a "todos" si el periodo ya no existe).
  useEffect(() => {
    if (!data) return
    setPaymentFilters((f) => (f.period === 'todos' || data.periods.some((p) => p.id === f.period) ? f : { ...f, period: 'todos' }))
  }, [data])

  const lookups = useMemo(() => (data ? makeLookups(data) : null), [data])
  const stats = useMemo(() => (data ? computeStats(data) : null), [data])
  const dashboard = useMemo(() => (data ? computeDashboard(data) : null), [data])
  const incidentStats = useMemo(() => {
    const rows = (data?.incidents ?? []).filter((incident) => Boolean(companyId) && incident.company_id === companyId)
    const pending = rows.filter((i) => ['open', 'invoiced'].includes(i.status || ''))
    return {
      total: rows.length,
      open: rows.filter((i) => i.status === 'open').length,
      invoiced: rows.filter((i) => i.status === 'invoiced').length,
      paid: rows.filter((i) => i.status === 'paid').length,
      pendingAmount: pending.reduce((sum, i) => sum + numberValue(i.amount), 0),
    }
  }, [data, companyId])

  const memberRows = useMemo(() => (data ? filterMembers(data, memberFilters, quick) : []), [data, memberFilters, quick])
  const paymentRows = useMemo(
    () => (data && lookups ? filterPaymentCharges(data, paymentFilters, quick, lookups) : []),
    [data, lookups, paymentFilters, quick],
  )
  const periodCharges = useMemo(() => (data ? chargesForPeriod(data, periodId) : []), [data, periodId])
  const incidentRows = useMemo(
    () => {
      if (!data || !lookups || !companyId) return []
      return filterIncidents({ ...data, incidents: data.incidents.filter((incident) => incident.company_id === companyId) }, incidentFilters, quick, lookups)
    },
    [data, lookups, incidentFilters, quick, companyId],
  )
  const invoiceRows = useMemo(
    () => (data && lookups ? filterInvoices(data, invoiceFilters, quick, lookups) : []),
    [data, lookups, invoiceFilters, quick],
  )

  const selectedPeriod = data && lookups ? lookups.periodById(periodId) ?? null : null

  // ── Stat cards / filtro rápido ──────────────────────────────────
  function applyCard(filter: Exclude<QuickFilter, null>) {
    setQuick(filter)
    if (filter === 'members') { setTab('members'); setMemberFilters((f) => ({ ...f, status: 'active' })) }
    if (filter === 'pendingFees' || filter === 'pendingAmount') { setTab('payments'); setPaymentFilters((f) => ({ ...f, status: 'todos' })) }
    if (filter === 'openIncidents') { setTab('incidents'); setIncidentFilters((f) => ({ ...f, status: 'todos' })) }
    if (filter === 'pendingInvoices') { setTab('invoices'); setInvoiceFilters((f) => ({ ...f, status: 'issued' })) }
  }
  function clearQuick() {
    setQuick(null)
    setMemberFilters((f) => ({ ...f, status: 'todos' }))
    setPaymentFilters((f) => ({ ...f, status: 'todos' }))
    setIncidentFilters((f) => ({ ...f, status: 'todos' }))
    setInvoiceFilters((f) => ({ ...f, status: 'todos' }))
  }

  function applyIncidentCard(statusFilter: string) {
    setIncidentFilters((f) => ({ ...f, status: statusFilter }))
  }

  async function onGenerateFees() {
    if (!periodId) return showToast('Selecciona un periodo', 'Selecciona un periodo para generar cuotas.', 'warning')
    setGenerating(true)
    try {
      const result = await apiGenerateFees(periodId)
      showToast('Cuotas generadas', `${result?.charges_generated || 0} cuotas generadas correctamente.`, 'success')
      await reload()
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
    } finally {
      setGenerating(false)
    }
  }

  function openInvoice(type: InvoiceType, id: string) {
    if (!data || !lookups) return
    if (type === 'maintenance_fee') {
      const c = lookups.chargeById(id)
      setInvoiceModal({
        type,
        id,
        title: 'Registrar factura de cuota',
        subtitle: `${lookups.memberName(c?.member_id ?? null)} — ${lookups.periodLabel(lookups.periodById(c?.billing_period_id ?? null))}`,
        amount: numberValue(c?.pending_amount || c?.expected_amount).toFixed(2),
      })
    } else {
      const i = lookups.incidentById(id)
      setInvoiceModal({
        type,
        id,
        title: 'Registrar factura de incidencia',
        subtitle: lookups.incidentReceiver(i),
        amount: numberValue(i?.amount).toFixed(2),
      })
    }
  }

  const cardClass = (base: string, filter: Exclude<QuickFilter, null>) =>
    `${s.statCard} ${s[base]} ${quick === filter ? s.selected : ''}`

  // ── Render de una fila de cuota (compartida por Cuotas del periodo y Cobros) ──
  function ChargeRow({ c }: { c: MaintenanceFeeCharge }) {
    if (!lookups) return null
    const m = lookups.memberById(c.member_id)
    const p = lookups.periodById(c.billing_period_id)
    const inv = lookups.invoiceById(c.invoice_id)
    return (
      <tr>
        <td><span className={s.cellMain}>{m?.full_name || 'Socio no encontrado'}</span><span className={s.cellSub}>{m?.rfc || 'Sin RFC'}</span></td>
        <td>{lookups.periodLabel(p)}</td>
        <td>{formatCurrency(c.expected_amount)}</td>
        <td>{formatCurrency(c.paid_amount)}</td>
        <td>{formatCurrency(c.pending_amount)}</td>
        <td><Badge variant={badgeVariant(c.status)}>{chargeLabel(c.status)}</Badge></td>
        <td>
          {inv ? (
            <><Badge variant={badgeVariant(inv.status)}>{invoiceStatusLabel(inv.status)}</Badge><span className={s.cellSub}>{inv.series_folio || inv.fiscal_uuid || 'Factura'}</span></>
          ) : (
            <Badge variant="neutral">Sin factura</Badge>
          )}
        </td>
        <td>
          <div className={s.rowActions}>
            {['pending', 'partial', 'overdue'].includes(c.status || '') && (
              <button className={`${s.smallBtn} ${s.success}`} onClick={() => setPaymentCharge(c)}>Registrar cobro</button>
            )}
            {!c.invoice_id && c.status !== 'cancelled' && (
              <button className={`${s.smallBtn} ${s.info}`} onClick={() => openInvoice('maintenance_fee', c.id)}>Crear factura</button>
            )}
          </div>
        </td>
      </tr>
    )
  }

  const loadingRow = (cols: number, msg: string) => <tr><td colSpan={cols} className={s.tableMsg}>{msg}</td></tr>
  function tableBody(cols: number, loadingMsg: string, emptyMsg: string, ready: boolean, count: number, rows: React.ReactNode) {
    if (status === 'loading') { void loadingMsg; return <TableSkeletonRows cols={cols} /> }
    if (status === 'error') return loadingRow(cols, 'No se pudo cargar.')
    if (ready && count === 0) return loadingRow(cols, emptyMsg)
    return rows
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>{isIncidentsPage ? 'Incidencias' : 'Ingresos'}</h1>
          <p className="muted">
            {isIncidentsPage
              ? `Registra y da seguimiento a cargos recuperables de ${companyName || 'la empresa activa'}.`
              : `Controla el catálogo compartido de socios, periodos, cuotas y pagos desde ${companyName || 'la empresa activa'}.`}
          </p>
        </div>
        <button className={s.secondaryBtn} onClick={reload}>Actualizar</button>
      </div>

      {/* Stat cards */}
      {isIncidentsPage ? (
        <div className={s.statsGrid}>
          <button type="button" className={`${s.statCard} ${s.accent} ${incidentFilters.status === 'todos' ? s.selected : ''}`} onClick={() => applyIncidentCard('todos')}>
            <p>Total incidencias</p><strong>{incidentStats.total}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.warning} ${incidentFilters.status === 'open' ? s.selected : ''}`} onClick={() => applyIncidentCard('open')}>
            <p>Abiertas</p><strong>{incidentStats.open}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.info} ${incidentFilters.status === 'invoiced' ? s.selected : ''}`} onClick={() => applyIncidentCard('invoiced')}>
            <p>Facturadas</p><strong>{incidentStats.invoiced}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.accent} ${incidentFilters.status === 'paid' ? s.selected : ''}`} onClick={() => applyIncidentCard('paid')}>
            <p>Cobradas</p><strong>{incidentStats.paid}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.violet} ${incidentFilters.status === 'pending_collection' ? s.selected : ''}`} onClick={() => applyIncidentCard('pending_collection')}>
            <p>Monto pendiente</p><strong>{compactCurrency(incidentStats.pendingAmount)}</strong>
          </button>
        </div>
      ) : (
        <div className={s.statsGrid}>
          <button type="button" className={cardClass('accent', 'members')} onClick={() => applyCard('members')}>
            <p>Socios activos</p><strong>{stats?.activeMembers ?? 0}</strong>
          </button>
          <button type="button" className={cardClass('warning', 'pendingFees')} onClick={() => applyCard('pendingFees')}>
            <p>Cuotas pendientes</p><strong>{stats?.pendingCharges ?? 0}</strong>
          </button>
          <button type="button" className={cardClass('violet', 'pendingAmount')} onClick={() => applyCard('pendingAmount')}>
            <p>Monto pendiente</p><strong>{compactCurrency(stats?.pendingAmount ?? 0)}</strong>
          </button>
          <button type="button" className={cardClass('danger', 'pendingInvoices')} onClick={() => applyCard('pendingInvoices')}>
            <p>Facturas pendientes</p><strong>{stats?.pendingInvoices ?? 0}</strong>
          </button>
        </div>
      )}

      {/* Tabs internos */}
      {!isIncidentsPage && <div className={s.ingTabs} role="tablist">
        {([
          ['dashboard', 'Balance'], ['members', 'Socios'], ['periods', 'Periodos y cuotas'],
          ['payments', 'Cuotas'], ['invoices', 'Facturas'],
        ] as [IngresosTab, string][]).map(([key, label]) => (
          <button key={key} type="button" className={`${s.ingTab} ${tab === key ? s.active : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>}

      {/* Filtro rápido */}
      {!isIncidentsPage && quick && (
        <div className={s.filterStrip}>
          <span>{quickFilterLabel(quick)}</span>
          <button type="button" className={s.smallBtn} onClick={clearQuick}>Ver todo</button>
        </div>
      )}

      {/* ── Dashboard ── */}
      {!isIncidentsPage && tab === 'dashboard' && (
        <div className={s.dashboardGrid}>
          <div className={s.tableCard}>
            <div className={s.panelHeader}><div><h2>Resumen operativo</h2><p>Lectura rapida de cobranza y facturas de cuotas.</p></div></div>
            <div className={s.summaryList}>
              <SummaryRow label="Cuotas esperadas" value={formatCurrency(dashboard?.expected ?? 0)} />
              <SummaryRow label="Cuotas cobradas" value={formatCurrency(dashboard?.collected ?? 0)} />
              <SummaryRow label="Cuotas pendientes" value={formatCurrency(dashboard?.pending ?? 0)} />
              <SummaryRow label="Facturas emitidas pendientes" value={formatCurrency(dashboard?.inv ?? 0)} />
            </div>
          </div>
          <div className={s.tableCard}>
            <div className={s.panelHeader}><div><h2>Acciones rapidas</h2><p>Atajos para operar el modulo.</p></div></div>
            <div className={`${s.summaryList} ${s.summaryListTight}`}>
              <button type="button" className={s.secondaryBtn} onClick={() => setMemberModal({ member: null })}>+ Nuevo socio</button>
              <button type="button" className={s.secondaryBtn} onClick={() => setPeriodModal(true)}>+ Nuevo periodo</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Socios ── */}
      {!isIncidentsPage && tab === 'members' && (
        <div className={s.tableCard}>
          <div className={s.panelHeader}>
            <div><h2>Socios</h2><p>Catalogo de titulares y factores para cuotas de mantenimiento.</p></div>
            <button type="button" className={s.primaryBtn} onClick={() => setMemberModal({ member: null })}>+ Nuevo socio</button>
          </div>
          <div className={s.toolbar}>
            <div className={s.searchBox}>
              <IcSearch size={16} />
              <input type="search" value={memberFilters.query} onChange={(e) => setMemberFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Buscar por nombre, RFC o correo..." />
            </div>
            <select value={memberFilters.status} onChange={(e) => setMemberFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="todos">Estatus: Todos</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>
            <select value={memberFilters.lineage} onChange={(e) => setMemberFilters((f) => ({ ...f, lineage: e.target.value }))}>
              <option value="todos">Estirpe: Todas</option>
              {LINEAGES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Nombre</th><th>RFC</th><th>Estirpe</th><th>Factor</th><th>Correo</th><th>Telefono</th><th>Estatus</th><th>Acciones</th></tr></thead>
              <tbody>
                {tableBody(8, 'Cargando socios...', 'No hay socios para este filtro.', status === 'ready', memberRows.length,
                  memberRows.map((m) => (
                    <tr key={m.id}>
                      <td><span className={s.cellMain}>{m.full_name}</span><span className={s.cellSub}>{m.email || 'Sin correo'}</span></td>
                      <td>{m.rfc || '—'}</td>
                      <td>{m.lineage || '—'}</td>
                      <td>{formatFactor(m.fee_factor)}</td>
                      <td>{m.email || '—'}</td>
                      <td>{m.phone || '—'}</td>
                      <td><Badge variant={m.active === false ? 'neutral' : 'success'}>{m.active === false ? 'Inactivo' : 'Activo'}</Badge></td>
                      <td>
                        <div className={s.rowActions}>
                          <button className={`${s.smallBtn} ${s.info}`} onClick={() => setStatementMemberId(m.id)}>Estado de cuenta</button>
                          <button className={s.smallBtn} onClick={() => setMemberModal({ member: m })}>Editar</button>
                        </div>
                      </td>
                    </tr>
                  )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Periodos y cuotas ── */}
      {!isIncidentsPage && tab === 'periods' && (
        <>
          <div className={s.tableCard}>
            <div className={s.panelHeader}>
              <div><h2>Periodos de cobro</h2><p>Crea periodos y genera cuotas de mantenimiento por socio.</p></div>
              <button type="button" className={s.primaryBtn} onClick={() => setPeriodModal(true)}>+ Nuevo periodo</button>
            </div>
            <div className={`${s.tableWrap} ${s.compact}`}>
              <table className={s.table}>
                <thead><tr><th>Periodo</th><th>Ano</th><th>Fecha corte</th><th>Presupuesto total</th><th>Estatus</th><th>Acciones</th></tr></thead>
                <tbody>
                  {tableBody(6, 'Cargando periodos...', 'No hay periodos de cobro.', status === 'ready', data?.periods.length ?? 0,
                    (data?.periods ?? []).map((p) => (
                      <tr key={p.id}>
                        <td><span className={s.cellMain}>{p.name}</span><span className={s.cellSub}>{p.id === periodId ? 'Seleccionado' : 'Periodo'}</span></td>
                        <td>{p.year}</td>
                        <td>{dateCell(p.cutoff_date)}</td>
                        <td>{formatCurrency(p.total_budget)}</td>
                        <td><Badge variant={badgeVariant(p.status)}>{periodStatusLabel(p.status)}</Badge></td>
                        <td><button className={`${s.smallBtn} ${p.id === periodId ? s.success : s.info}`} onClick={() => setPeriodId(p.id)}>Ver cuotas</button></td>
                      </tr>
                    )))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={s.tableCard}>
            <div className={s.panelHeader}>
              <div>
                <h2>{selectedPeriod ? `Cuotas de ${selectedPeriod.name}` : 'Cuotas del periodo'}</h2>
                <p>{selectedPeriod ? `Presupuesto ${formatCurrency(selectedPeriod.total_budget)} con corte ${dateCell(selectedPeriod.cutoff_date)}.` : 'Selecciona un periodo para ver o generar cuotas.'}</p>
              </div>
              <button type="button" className={s.primaryBtn} disabled={generating} onClick={onGenerateFees}>{generating ? 'Generando...' : 'Generar cuotas'}</button>
            </div>
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead><tr><th>Socio</th><th>Esperado</th><th>Cobrado</th><th>Pendiente</th><th>Estatus</th><th>Factura</th><th>Acciones</th></tr></thead>
                <tbody>
                  {status !== 'ready'
                    ? loadingRow(7, status === 'error' ? 'No se pudo cargar.' : 'Selecciona un periodo.')
                    : !selectedPeriod
                      ? loadingRow(7, 'Selecciona un periodo.')
                      : periodCharges.length === 0
                        ? loadingRow(7, 'Este periodo todavia no tiene cuotas generadas.')
                        : periodCharges.map((c) => <ChargeRow key={c.id} c={c} />)}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Cobros (Cuotas) ── */}
      {!isIncidentsPage && tab === 'payments' && (
        <div className={s.tableCard}>
          <div className={s.panelHeader}><div><h2>Cobros pendientes</h2><p>Cuotas con saldo pendiente para registrar cobros parciales o finales.</p></div></div>
          <div className={s.toolbar}>
            <div className={s.searchBox}>
              <IcSearch size={16} />
              <input type="search" value={paymentFilters.query} onChange={(e) => setPaymentFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Buscar por socio o periodo..." />
            </div>
            <select value={paymentFilters.status} onChange={(e) => setPaymentFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="todos">Estatus: Todos</option>
              <option value="pending">Pendiente</option>
              <option value="partial">Parcial</option>
              <option value="overdue">Vencida</option>
            </select>
            <select value={paymentFilters.period} onChange={(e) => setPaymentFilters((f) => ({ ...f, period: e.target.value }))}>
              <option value="todos">Periodo: Todos</option>
              {(data?.periods ?? []).map((p) => <option key={p.id} value={p.id}>{lookups?.periodLabel(p)}</option>)}
            </select>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Socio</th><th>Periodo</th><th>Esperado</th><th>Cobrado</th><th>Pendiente</th><th>Estatus</th><th>Factura</th><th>Acciones</th></tr></thead>
              <tbody>
                {tableBody(8, 'Cargando cobros...', 'No hay cuotas pendientes para este filtro.', status === 'ready', paymentRows.length,
                  paymentRows.map((c) => <ChargeRow key={c.id} c={c} />))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Incidencias ── */}
      {isIncidentsPage && (
        <div className={s.tableCard}>
          <div className={s.panelHeader}>
            <div><h2>Incidencias</h2><p>Cargos recuperables a socios o externos.</p></div>
            <button type="button" className={s.primaryBtn} onClick={() => setIncidentModal(true)}>+ Nueva incidencia</button>
          </div>
          <div className={s.toolbar}>
            <div className={s.searchBox}>
              <IcSearch size={16} />
              <input type="search" value={incidentFilters.query} onChange={(e) => setIncidentFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Buscar por receptor, RFC o descripcion..." />
            </div>
            <select value={incidentFilters.status} onChange={(e) => setIncidentFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="todos">Estatus: Todos</option>
              <option value="pending_collection">Pendiente de cobro</option>
              <option value="open">Abierta</option>
              <option value="invoiced">Facturada</option>
              <option value="paid">Cobrada</option>
              <option value="cancelled">Cancelada</option>
            </select>
            <select value={incidentFilters.receiver} onChange={(e) => setIncidentFilters((f) => ({ ...f, receiver: e.target.value }))}>
              <option value="todos">Tipo: Todos</option>
              <option value="member">Socio</option>
              <option value="external">Externo</option>
            </select>
            <input type="date" value={incidentFilters.date} onChange={(e) => setIncidentFilters((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Receptor</th><th>Tipo</th><th>Referido por</th><th>Descripcion</th><th>Monto</th><th>Fecha</th><th>Estatus</th><th>Factura</th><th>Acciones</th></tr></thead>
              <tbody>
                {tableBody(9, 'Cargando incidencias...', 'No hay incidencias para este filtro.', status === 'ready', incidentRows.length,
                  incidentRows.map((i) => {
                    if (!lookups) return null
                    const inv = lookups.invoiceById(i.invoice_id)
                    return (
                      <tr key={i.id}>
                        <td><span className={s.cellMain}>{lookups.incidentReceiver(i)}</span><span className={s.cellSub}>{i.external_rfc || lookups.memberById(i.member_id)?.rfc || 'Sin RFC'}</span></td>
                        <td>{lookups.receiverType(i) === 'member' ? 'Socio' : 'Externo'}</td>
                        <td>{lookups.memberName(i.referred_by_member_id) || '—'}</td>
                        <td><span className={s.cellMain}>{i.description}</span><span className={s.cellSub}>{lookups.companyName(i.company_id) || 'Sin empresa'}</span></td>
                        <td>{formatCurrency(i.amount)}</td>
                        <td>{dateCell(i.incident_date)}</td>
                        <td><Badge variant={badgeVariant(i.status)}>{incidentLabel(i.status)}</Badge></td>
                        <td>
                          {inv ? (
                            <><Badge variant={badgeVariant(inv.status)}>{invoiceStatusLabel(inv.status)}</Badge><span className={s.cellSub}>{inv.series_folio || inv.fiscal_uuid || 'Factura'}</span></>
                          ) : (
                            <Badge variant="neutral">Sin factura</Badge>
                          )}
                        </td>
                        <td>
                          <div className={s.rowActions}>
                            {!i.invoice_id && i.status !== 'cancelled' && (
                              <button className={`${s.smallBtn} ${s.info}`} onClick={() => openInvoice('incident', i.id)}>Crear factura</button>
                            )}
                            {inv?.status === 'issued' && (
                              <button className={`${s.smallBtn} ${s.success}`} onClick={() => setInvoicePayId(inv.id)}>Marcar pagada</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Facturas ── */}
      {!isIncidentsPage && tab === 'invoices' && (
        <div className={s.tableCard}>
          <div className={s.panelHeader}><div><h2>Facturas de cuotas</h2><p>Registro operativo de facturas de mantenimiento emitidas y pagadas. No timbra CFDI.</p></div></div>
          <div className={s.toolbar}>
            <div className={s.searchBox}>
              <IcSearch size={16} />
              <input type="search" value={invoiceFilters.query} onChange={(e) => setInvoiceFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Buscar por receptor, RFC o folio..." />
            </div>
            <select value={invoiceFilters.status} onChange={(e) => setInvoiceFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="todos">Estatus: Todos</option>
              <option value="issued">Emitida</option>
              <option value="paid">Pagada</option>
              <option value="cancelled">Cancelada</option>
            </select>
            <input type="date" value={invoiceFilters.date} onChange={(e) => setInvoiceFilters((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Tipo</th><th>Receptor</th><th>RFC</th><th>Referencia</th><th>Folio fiscal</th><th>Serie/Folio</th><th>Monto</th><th>Emision</th><th>Pago</th><th>Estatus</th><th>Acciones</th></tr></thead>
              <tbody>
                {tableBody(11, 'Cargando facturas...', 'No hay facturas para este filtro.', status === 'ready', invoiceRows.length,
                  invoiceRows.map((i) => {
                    if (!lookups) return null
                    return (
                      <tr key={i.id}>
                        <td>{i.invoice_type === 'maintenance_fee' ? 'Cuota' : 'Incidencia'}</td>
                        <td><span className={s.cellMain}>{lookups.invoiceReceiver(i)}</span></td>
                        <td>{i.receiver_rfc || lookups.memberById(i.member_id)?.rfc || '—'}</td>
                        <td>{lookups.invoiceRef(i)}</td>
                        <td>{i.fiscal_uuid || '—'}</td>
                        <td>{i.series_folio || '—'}</td>
                        <td>{formatCurrency(i.amount)}</td>
                        <td>{dateCell(i.issue_date)}</td>
                        <td>{dateCell(i.payment_date)}</td>
                        <td><Badge variant={badgeVariant(i.status)}>{invoiceStatusLabel(i.status)}</Badge></td>
                        <td>{i.status === 'issued' && <button className={`${s.smallBtn} ${s.success}`} onClick={() => setInvoicePayId(i.id)}>Marcar pagada</button>}</td>
                      </tr>
                    )
                  }))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modales ── */}
      {memberModal && (
        <MemberModal
          member={memberModal.member}
          onClose={() => setMemberModal(null)}
          onSaved={async () => { setMemberModal(null); await reload() }}
        />
      )}
      {periodModal && (
        <PeriodModal
          profileId={profileId}
          onClose={() => setPeriodModal(false)}
          onSaved={async (newId) => { setPeriodModal(false); if (newId) setPeriodId(newId); await reload(); setTab('periods') }}
        />
      )}
      {paymentCharge && (
        <PaymentModal
          charge={paymentCharge}
          memberName={lookups?.memberName(paymentCharge.member_id) ?? ''}
          profileId={profileId}
          onClose={() => setPaymentCharge(null)}
          onSaved={async () => { setPaymentCharge(null); await reload() }}
        />
      )}
      {incidentModal && data && lookups && (
        <IncidentModal
          data={data}
          lookups={lookups}
          profileId={profileId}
          activeCompanyId={companyId}
          allowedCompanyIds={memberships.map((membership) => membership.company_id)}
          onClose={() => setIncidentModal(false)}
          onSaved={async () => { setIncidentModal(false); await reload(); setTab('incidents') }}
        />
      )}
      {invoiceModal && (
        <InvoiceModal
          type={invoiceModal.type}
          referenceId={invoiceModal.id}
          title={invoiceModal.title}
          subtitle={invoiceModal.subtitle}
          initialAmount={invoiceModal.amount}
          onClose={() => setInvoiceModal(null)}
          onSaved={async () => { setInvoiceModal(null); await reload() }}
        />
      )}
      {invoicePayId && (
        <InvoicePayModal
          invoiceId={invoicePayId}
          profileId={profileId}
          onClose={() => setInvoicePayId(null)}
          onSaved={async () => { setInvoicePayId(null); await reload() }}
        />
      )}
      {statementMemberId && data && lookups && (
        <StatementModal
          title={lookups.memberById(statementMemberId)?.full_name || 'Estado de cuenta'}
          values={computeStatement(data, statementMemberId)}
          onClose={() => setStatementMemberId(null)}
        />
      )}
    </>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.summaryRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
