import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { perms } from '../../lib/roles'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { TableSkeletonRows } from '../../components/ui/Skeleton'
import { IcSearch, IcPlus } from '../../components/ui/icons'
import { compactCurrency, formatDate } from '../../lib/format'
import { numberValue, normalize } from '../../lib/format'
import {
  loadCompanies, loadCostCenters, loadBudgetCategories, loadProveedores,
  loadProfiles, loadPaymentRequests, loadFase2Metadata, loadExtraordinaryBadges,
} from './api'
import {
  isActiveRequest, isExceptionRequest, statusMatches, budgetDecisionMatches,
  requestSearchHaystack, statusBadge, budgetDecisionBadge, companyName, costCenterName,
  proveedorAlias, formatCurrencyC, formatMonth, hasFinanceRole,
  requestTypeLabel, paymentMethodLabel, paymentMethodVariant,
  STATUS_FILTER_LABELS,
} from './logic'
import { RequestModal } from './RequestModal'
import { DetailModal } from './DetailModal'
import { EditModal } from './EditModal'
import type {
  PaymentRequest, Company, CostCenter, BudgetCategory, Proveedor, Profile,
  StatusFilter, BudgetDecisionFilter,
} from './types'
import s from './Solicitudes.module.css'

type Fase2Meta = { request_type: string | null; payment_method: string | null }

export default function SolicitudesPage() {
  const { profile, roles, group, memberships } = useAuth()
  const { companyId: activeCompanyId } = useCompany()
  const { showToast } = useToast()
  const [params] = useSearchParams()
  const canApprove = perms.canApprove(group)
  const currentProfileId = profile?.id ?? null

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('Cargando solicitudes...')

  const [companies, setCompanies] = useState<Company[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [requests, setRequests] = useState<PaymentRequest[]>([])
  const [fase2, setFase2] = useState<Map<string, Fase2Meta>>(new Map())
  const [extraBadges, setExtraBadges] = useState<Map<string, { status: string }>>(new Map())

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('activas')
  const [decisionFilter, setDecisionFilter] = useState<BudgetDecisionFilter>('todos')
  // La lista arranca filtrada a la empresa activa (switcher) y se re-sincroniza
  // al cambiarla. Un usuario de una sola empresa solo ve la suya.
  const [companyFilter, setCompanyFilter] = useState<string>(activeCompanyId ?? '')
  useEffect(() => { setCompanyFilter(activeCompanyId ?? '') }, [activeCompanyId])
  // El selector de empresa solo ofrece las empresas del usuario (memberships).
  const myCompanies = useMemo(
    () => companies.filter((c) => memberships.some((m) => m.company_id === c.id)),
    [companies, memberships],
  )
  const allowedCompanyIds = useMemo(
    () => new Set(memberships.map((membership) => membership.company_id)),
    [memberships],
  )
  // La empresa activa es el límite de contexto de la SPA. Aunque RLS siga
  // siendo la autoridad de seguridad, ningún contador, fila o deep-link debe
  // mezclar otra empresa a la que el mismo usuario también pertenezca.
  const scopedRequests = useMemo(
    () => requests.filter(
      (request) => Boolean(activeCompanyId)
        && request.company_id === activeCompanyId
        && allowedCompanyIds.has(request.company_id || ''),
    ),
    [requests, activeCompanyId, allowedCompanyIds],
  )

  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const [requestModalOpen, setRequestModalOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailKey, setDetailKey] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)

  const deepLinkHandled = useRef(false)
  const highlightTimer = useRef<number | undefined>(undefined)

  async function loadRequests() {
    const data = await loadPaymentRequests()
    setRequests(data)
    const numbers = data.map((r) => r.request_number).filter(Boolean) as string[]
    // Metadata Fase 2 y badges de extraordinarios (mejores esfuerzos).
    void loadFase2Metadata(numbers).then(setFase2)
    void loadExtraordinaryBadges(data.map((r) => r.id)).then(setExtraBadges)
    return data
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [comp, cc, cats, provs, profs] = await Promise.all([
          loadCompanies(), loadCostCenters(), loadBudgetCategories(), loadProveedores(), loadProfiles(),
        ])
        if (cancelled) return
        setCompanies(comp); setCostCenters(cc); setBudgetCategories(cats); setProveedores(provs); setProfiles(profs)
        await loadRequests()
        if (!cancelled) setStatus('ready')
      } catch (error: any) {
        if (!cancelled) { setStatus('error'); setErrorMsg(error?.message || 'No fue posible cargar la pantalla.') }
        showToast('No fue posible iniciar', error?.message || 'Error al cargar.', 'error')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Deep-link ?request_id → abre detalle una vez cargadas las solicitudes.
  useEffect(() => {
    if (status !== 'ready' || deepLinkHandled.current) return
    const requestId = params.get('request_id')
    if (!requestId) { deepLinkHandled.current = true; return }
    if (scopedRequests.some((r) => r.id === requestId)) {
      deepLinkHandled.current = true
      setDetailId(requestId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, scopedRequests])

  const lookups = useMemo(() => ({
    company: (id: string | null) => companies.find((c) => c.id === id) || null,
    center: (id: string | null) => costCenters.find((c) => c.id === id) || null,
    category: (id: string | null) => budgetCategories.find((c) => c.id === id) || null,
    proveedor: (id: string | null) => proveedores.find((p) => p.id === id) || null,
  }), [companies, costCenters, budgetCategories, proveedores])

  // ── Stats ────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = scopedRequests.filter(isActiveRequest)
    const paid = scopedRequests.filter((r) => r.status === 'paid')
    return {
      total: active.length,
      aprobables: active.filter((r) => r.budget_decision === 'aprobable').length,
      blocked: active.filter(isExceptionRequest).length,
      paid: paid.length,
      amount: active.reduce((sum, r) => sum + numberValue(r.amount_requested), 0),
    }
  }, [scopedRequests])

  // ── Filtered rows ────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const q = normalize(query)
    return scopedRequests.filter((r) => {
      const haystack = requestSearchHaystack(r, lookups.proveedor(r.proveedor_id), lookups.company(r.company_id), lookups.center(r.cost_center_id), lookups.category(r.budget_category_id))
      return (
        haystack.includes(q) &&
        statusMatches(r, statusFilter) &&
        budgetDecisionMatches(r, decisionFilter) &&
        r.company_id === companyFilter
      )
    })
  }, [scopedRequests, lookups, query, statusFilter, decisionFilter, companyFilter])

  const hasActiveFilters = Boolean(query.trim()) || statusFilter !== 'todos' || decisionFilter !== 'todos'

  const filterParts = useMemo(() => {
    const parts: string[] = []
    if (query.trim()) parts.push('Busqueda')
    if (statusFilter !== 'todos') parts.push(STATUS_FILTER_LABELS[statusFilter] || `Estatus: ${statusFilter}`)
    if (decisionFilter === 'aprobable') parts.push('Aprobables')
    if (decisionFilter === 'excepciones') parts.push('Excepciones presupuestales')
    if (companyFilter) { const c = lookups.company(companyFilter); parts.push(c ? companyName(c) : 'Empresa activa') }
    return parts
  }, [query, statusFilter, decisionFilter, companyFilter, lookups])

  function setFilters(next: { status: StatusFilter; decision: BudgetDecisionFilter }) {
    setQuery(''); setStatusFilter(next.status); setDecisionFilter(next.decision); setCompanyFilter(activeCompanyId ?? '')
  }

  // ── Card active state (mirror renderFilterState) ─────────────────────────
  const cardActive = {
    total: statusFilter === 'activas' && decisionFilter === 'todos',
    approvable: statusFilter === 'activas' && decisionFilter === 'aprobable',
    exceptions: statusFilter === 'activas' && decisionFilter === 'excepciones',
    paid: statusFilter === 'paid',
  }

  function afterCreate(requestId: string | null) {
    void loadRequests()
    if (requestId) {
      setHighlightedId(requestId)
      window.clearTimeout(highlightTimer.current)
      highlightTimer.current = window.setTimeout(() => setHighlightedId(null), 3500)
    }
  }

  async function afterDetailChange() {
    await loadRequests()
    setDetailKey((k) => k + 1) // fuerza recarga de historial/contexto del detalle
  }

  const detailRequest = detailId ? scopedRequests.find((r) => r.id === detailId) || null : null
  const editRequest = editId ? scopedRequests.find((r) => r.id === editId) || null : null

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Solicitudes de pago</h1>
          <p>Crea solicitudes y deja que el sistema valide automaticamente la disponibilidad presupuestal.</p>
        </div>
        <button className={s.primaryBtn} onClick={() => setRequestModalOpen(true)}><IcPlus size={16} /> Nueva solicitud</button>
      </div>

      <div className={s.statsGrid}>
        <div className={`${s.kpi} ${s.info} ${s.clickable} ${cardActive.total ? s.active : ''}`} role="button" tabIndex={0}
          onClick={() => setFilters({ status: 'activas', decision: 'todos' })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilters({ status: 'activas', decision: 'todos' }) } }}>
          <span className={s.kpiLabel}>Solicitudes activas</span><span className={s.kpiValue}>{stats.total}</span>
        </div>
        <div className={`${s.kpi} ${s.success} ${s.clickable} ${cardActive.approvable ? s.active : ''}`} role="button" tabIndex={0}
          onClick={() => setFilters({ status: 'activas', decision: 'aprobable' })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilters({ status: 'activas', decision: 'aprobable' }) } }}>
          <span className={s.kpiLabel}>Aprobables</span><span className={s.kpiValue}>{stats.aprobables}</span>
        </div>
        <div className={`${s.kpi} ${s.warning} ${s.clickable} ${cardActive.exceptions ? s.active : ''}`} role="button" tabIndex={0}
          onClick={() => setFilters({ status: 'activas', decision: 'excepciones' })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilters({ status: 'activas', decision: 'excepciones' }) } }}>
          <span className={s.kpiLabel}>Excepciones presupuestales</span><span className={s.kpiValue}>{stats.blocked}</span>
        </div>
        <div className={`${s.kpi} ${s.success} ${s.clickable} ${cardActive.paid ? s.active : ''}`} role="button" tabIndex={0}
          onClick={() => setFilters({ status: 'paid', decision: 'todos' })}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFilters({ status: 'paid', decision: 'todos' }) } }}>
          <span className={s.kpiLabel}>Pagadas</span><span className={s.kpiValue}>{stats.paid}</span>
        </div>
        <div className={s.kpi}>
          <span className={s.kpiLabel}>Monto solicitado</span><span className={s.kpiValue}>{compactCurrency(stats.amount)}</span>
        </div>
      </div>

      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <IcSearch size={16} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por folio, proveedor o descripcion..." aria-label="Buscar solicitudes" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="todos">Estatus: Todos</option>
            <option value="activas">Activas</option>
            <option value="submitted">Enviada</option>
            <option value="approved">Aprobada</option>
            <option value="changes_requested">Con correccion</option>
            <option value="finance_validation">En revision</option>
            <option value="scheduled">Programada</option>
            <option value="paid">Pagada</option>
            <option value="rejected">Rechazada</option>
            <option value="cancelled">Cancelada</option>
          </select>
          <select value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value as BudgetDecisionFilter)}>
            <option value="todos">Presupuesto: Todos</option>
            <option value="aprobable">Aprobable</option>
            <option value="excepciones">Excepciones</option>
          </select>
          <select value={companyFilter} disabled aria-label="Empresa activa">
            {!activeCompanyId && <option value="">Empresa activa no disponible</option>}
            {myCompanies.filter((c) => c.id === activeCompanyId).map((c) => <option key={c.id} value={c.id}>{companyName(c)}</option>)}
          </select>
        </div>

        {filterParts.length > 0 && (
          <div className={s.filterSummary}>
            <span className={s.filterPill}>Vista filtrada: {filterParts.join(' · ')}</span>
            <button type="button" className={s.smallBtn} onClick={() => { setQuery(''); setStatusFilter('todos'); setDecisionFilter('todos'); setCompanyFilter(activeCompanyId ?? '') }}>Ver todas</button>
          </div>
        )}

        {status === 'error' && <div className={`${s.messageBox} ${s.error}`}>{errorMsg}</div>}

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th>Folio</th><th>Proveedor</th><th>Partida</th><th>Monto</th><th>Estatus</th><th>Acciones</th></tr>
            </thead>
            <tbody>
              {status === 'loading' && <TableSkeletonRows cols={6} />}
              {status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={6}>
                  <div className={s.emptyState}>
                    <div className={s.esIcon}>{hasActiveFilters ? '🔍' : '📋'}</div>
                    <div className={s.esTitle}>{hasActiveFilters ? 'Sin resultados' : 'Sin solicitudes'}</div>
                    <div className={s.esDesc}>{hasActiveFilters ? 'Ninguna solicitud coincide con los filtros aplicados.' : 'Crea una nueva solicitud de pago para iniciar la bandeja.'}</div>
                    {hasActiveFilters && <div className={s.esAction}><button className={s.secondaryBtn} onClick={() => { setQuery(''); setStatusFilter('todos'); setDecisionFilter('todos'); setCompanyFilter(activeCompanyId ?? '') }}>Limpiar filtros</button></div>}
                  </div>
                </td></tr>
              )}
              {status === 'ready' && rows.map((r) => {
                const proveedor = lookups.proveedor(r.proveedor_id)
                const company = lookups.company(r.company_id)
                const center = lookups.center(r.cost_center_id)
                const category = lookups.category(r.budget_category_id)
                const sb = statusBadge(r.status)
                const db = budgetDecisionBadge(r.budget_decision, r.budget_block_reason || '')
                const meta = r.request_number ? fase2.get(r.request_number) : undefined
                const extra = extraBadges.get(r.id)
                return (
                  <tr key={r.id} className={highlightedId === r.id ? s.highlightRow : undefined}>
                    <td>
                      <span className={s.cellMain}>{r.request_number || 'Sin folio'}{r.is_extraordinary_adjustment && <> <Badge variant="accent">Extraordinario</Badge></>}{extra && <> <Badge variant="warning">{extra.status === 'draft' ? 'Evidencia pendiente' : 'Extraordinario'}</Badge></>}</span>
                      <span className={s.cellSub}>{formatDate(r.submitted_at || r.created_at)}</span>
                      {meta && (
                        <span className={s.inlineBadges}>
                          <Badge variant="info">{requestTypeLabel(meta.request_type)}</Badge>
                          <Badge variant={paymentMethodVariant(meta.payment_method)}>{paymentMethodLabel(meta.payment_method)}</Badge>
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={s.cellMain}>{proveedorAlias(proveedor)}</span>
                      <span className={s.cellSub}>{companyName(company)} · {costCenterName(center)}</span>
                    </td>
                    <td>
                      <span className={s.cellMain}>{category?.code || 'Sin partida'}</span>
                      <span className={s.cellSub}>{category?.name || ''} · {formatMonth(r.budget_month)}</span>
                    </td>
                    <td><span className={s.cellMain}>{formatCurrencyC(r.amount_requested, r.currency || 'MXN')}</span></td>
                    <td><Badge variant={sb.variant}>{sb.label}</Badge> <Badge variant={db.variant}>{db.label}</Badge></td>
                    <td><div className={s.rowActions}><button type="button" className={s.smallBtn} style={{ whiteSpace: 'nowrap' }} onClick={() => { setDetailId(r.id); setDetailKey((k) => k + 1) }}>Ver detalle</button></div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {requestModalOpen && (
        <RequestModal
          companies={companies}
          costCenters={costCenters}
          budgetCategories={budgetCategories}
          proveedores={proveedores}
          profile={profile}
          canApprove={canApprove}
          showNomina={hasFinanceRole(roles)}
          onProviderCreated={(p) => setProveedores((prev) => prev.some((x) => x.id === p.id) ? prev : [...prev, p].sort((a, b) => (a.alias || '').localeCompare(b.alias || '', 'es')))}
          onClose={() => setRequestModalOpen(false)}
          onCreated={afterCreate}
        />
      )}

      {detailRequest && (
        <DetailModal
          key={detailKey}
          request={detailRequest}
          companies={companies}
          costCenters={costCenters}
          budgetCategories={budgetCategories}
          proveedores={proveedores}
          profiles={profiles}
          fase2={detailRequest.request_number ? fase2.get(detailRequest.request_number) : undefined}
          canApprove={canApprove}
          currentProfileId={currentProfileId}
          onClose={() => setDetailId(null)}
          onEdit={() => { if (detailRequest) { setEditId(detailRequest.id) } }}
          onChanged={afterDetailChange}
        />
      )}

      {editRequest && (
        <EditModal
          request={editRequest}
          companies={companies}
          costCenters={costCenters}
          budgetCategories={budgetCategories}
          proveedores={proveedores}
          onClose={() => setEditId(null)}
          onSaved={async () => { setEditId(null); await loadRequests(); setDetailKey((k) => k + 1) }}
        />
      )}
    </>
  )
}
