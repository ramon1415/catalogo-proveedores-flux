import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { TableSkeletonRows } from '../../components/ui/Skeleton'
import { IcSearch } from '../../components/ui/icons'
import { formatCurrency, formatDate, compactCurrency, unique } from '../../lib/format'
import {
  loadCashData, createReconciliation, verifyCashBlock, getReceiptUrl,
} from './api'
import type { CashBlockResult } from './api'
import {
  makeLookups, computeStats, filterFunds, fundStatusBadge, canReview as canReviewRoles,
  friendlyRpcError, rlsHint,
} from './logic'
import type { CashFilters } from './logic'
import type { CashData, ReviewAction, ProfileLite } from './types'
import { FundDetailModal } from './FundDetailModal'
import { TicketModal } from './TicketModal'
import { SubmitModal } from './SubmitModal'
import { ReviewModal } from './ReviewModal'
import s from './Efectivo.module.css'

const EMPTY_FILTERS: CashFilters = { query: '', status: 'todos', method: 'todos', responsibleId: 'todos', companyId: '' }

export default function EfectivoPage() {
  const { profile, roles, memberships } = useAuth()
  const { companyId } = useCompany()
  const { showToast } = useToast()

  const [data, setData] = useState<CashData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [filters, setFilters] = useState<CashFilters>(EMPTY_FILTERS)

  const [detailFundId, setDetailFundId] = useState<string | null>(null)
  const [ticketFor, setTicketFor] = useState<string | null>(null)
  const [submitFor, setSubmitFor] = useState<string | null>(null)
  const [reviewFor, setReviewFor] = useState<{ recId: string; action: ReviewAction } | null>(null)
  const [blockResults, setBlockResults] = useState<Record<string, CashBlockResult | 'loading'>>({})

  const currentProfile = (profile as ProfileLite | null) ?? null
  const canReview = canReviewRoles(roles)

  async function reload() {
    try {
      const d = await loadCashData()
      setData(d)
      setStatus('ready')
    } catch (error) {
      setErrorMsg(rlsHint('cash_funds', 'select', error))
      setStatus('error')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  useEffect(() => {
    setFilters((current) => ({ ...current, companyId: companyId || '' }))
    setDetailFundId(null)
  }, [companyId])

  const lookups = useMemo(
    () => (data ? makeLookups(data, currentProfile) : null),
    [data, currentProfile],
  )
  const scopedData = useMemo(() => {
    if (!data || !companyId) return null
    const cashFunds = data.cashFunds.filter((fund) => fund.company_id === companyId)
    const fundIds = new Set(cashFunds.map((fund) => fund.id))
    return { ...data, cashFunds, reconciliations: data.reconciliations.filter((rec) => fundIds.has(rec.cash_fund_id || '')) }
  }, [data, companyId])
  const stats = useMemo(() => (scopedData ? computeStats(scopedData) : null), [scopedData])

  const responsibleOptions = useMemo(() => {
    if (!scopedData || !lookups) return []
    return unique(scopedData.cashFunds.map((f) => f.responsible_profile_id).filter(Boolean) as string[]).map((id) => ({ id, name: lookups.profileName(id) }))
  }, [scopedData, lookups])
  const companyOptions = useMemo(() => {
    if (!lookups || !companyId) return []
    const membership = memberships.find((item) => item.company_id === companyId)
    return membership ? [{ id: companyId, name: lookups.companyName(companyId) || membership.company_name }] : []
  }, [memberships, lookups, companyId])

  const rows = useMemo(() => {
    if (!data || !lookups) return []
    return filterFunds(data, filters, lookups)
  }, [data, lookups, filters])

  function toggleStatusFilter(nextStatus: string) {
    setFilters((current) => ({
      ...current,
      status: current.status === nextStatus ? 'todos' : nextStatus,
    }))
  }

  function ensureProfile(): boolean {
    if (currentProfile?.id) return true
    showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error')
    return false
  }

  async function onCreateReconciliation(fundId: string) {
    if (!ensureProfile()) return
    try {
      await createReconciliation(fundId, currentProfile!.id)
      showToast('Comprobación creada', 'Comprobación creada en borrador.', 'success')
      await reload()
    } catch (error: any) {
      showToast('No se pudo crear comprobación', friendlyRpcError(error), 'error')
    }
  }

  async function onVerifyBlock(fundId: string, profileId: string) {
    if (!profileId) {
      showToast('Sin responsable', 'Este fondo no tiene responsable asignado.', 'warning')
      return
    }
    setBlockResults((prev) => ({ ...prev, [fundId]: 'loading' }))
    try {
      const result = await verifyCashBlock(profileId)
      setBlockResults((prev) => ({ ...prev, [fundId]: result }))
    } catch (error) {
      showToast('No se pudo verificar', friendlyRpcError(error), 'error')
      setBlockResults((prev) => {
        const next = { ...prev }
        delete next[fundId]
        return next
      })
    }
  }

  async function onOpenReceipt(path: string) {
    const url = await getReceiptUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else showToast('No disponible', 'No se pudo generar el enlace al comprobante.', 'error')
  }

  const detailFund = data && detailFundId ? data.cashFunds.find((f) => f.id === detailFundId) ?? null : null

  // Datos para SubmitModal a partir del reconciliation activo.
  const submitCtx = useMemo(() => {
    if (!submitFor || !data || !lookups) return null
    const rec = lookups.reconciliationById(submitFor)
    const fund = rec ? lookups.fundById(rec.cash_fund_id) : null
    return { assigned: Number(fund?.assigned_amount ?? 0), tickets: lookups.totalValidTickets(submitFor) }
  }, [submitFor, data, lookups])

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Efectivo y comprobaciones</h1>
          <p className="muted">Controla fondos entregados, comprobaciones pendientes, tickets y cierre de efectivo o cheques.</p>
        </div>
        <button className={s.secondaryBtn} onClick={reload}>Actualizar</button>
      </div>

      {stats && (
        <div className={s.statsGrid}>
          <button type="button" className={`${s.statCard} ${s.accent} ${filters.status === 'activos' ? s.selected : ''}`} aria-pressed={filters.status === 'activos'} onClick={() => toggleStatusFilter('activos')}>
            <p>Fondos activos</p><strong>{stats.activeCount}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.warning} ${filters.status === 'pendientes' ? s.selected : ''}`} aria-pressed={filters.status === 'pendientes'} onClick={() => toggleStatusFilter('pendientes')}>
            <p>Pendientes de comprobar</p><strong>{stats.pendingCount}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.info} ${filters.status === 'en_revision' ? s.selected : ''}`} aria-pressed={filters.status === 'en_revision'} onClick={() => toggleStatusFilter('en_revision')}>
            <p>En revisión</p><strong>{stats.reviewCount}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.success} ${filters.status === 'closed' ? s.selected : ''}`} aria-pressed={filters.status === 'closed'} onClick={() => toggleStatusFilter('closed')}>
            <p>Cerrados</p><strong>{stats.closedCount}</strong>
          </button>
          <button type="button" className={`${s.statCard} ${s.violet} ${filters.status === 'con_pendiente' ? s.selected : ''}`} aria-pressed={filters.status === 'con_pendiente'} onClick={() => toggleStatusFilter('con_pendiente')}>
            <p>Monto pendiente</p><strong>{compactCurrency(stats.pendingAmount)}</strong>
          </button>
        </div>
      )}

      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <IcSearch size={16} />
            <input type="search" value={filters.query} onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))} placeholder="Buscar por solicitud, responsable o descripción..." />
          </div>
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="todos">Estatus: Todos</option>
            <option value="activos">Fondos activos</option>
            <option value="pendientes">Pendientes de comprobar</option>
            <option value="en_revision">En revisión</option>
            <option value="con_pendiente">Con monto pendiente</option>
            <option value="active">Activo</option>
            <option value="pending_receipt">Pendiente de comprobar</option>
            <option value="blocked">Bloqueado</option>
            <option value="receipt_review">En revisión</option>
            <option value="verified">Verificado</option>
            <option value="closed">Cerrado</option>
            <option value="cancelled">Cancelado</option>
          </select>
          <select value={filters.method} onChange={(e) => setFilters((f) => ({ ...f, method: e.target.value }))}>
            <option value="todos">Método: Todos</option>
            <option value="cash">Efectivo</option>
            <option value="check">Cheque</option>
          </select>
          <select value={filters.responsibleId} onChange={(e) => setFilters((f) => ({ ...f, responsibleId: e.target.value }))}>
            <option value="todos">Responsable: Todos</option>
            {responsibleOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={filters.companyId} disabled aria-label="Empresa activa">
            {!companyId && <option value="">Empresa activa no disponible</option>}
            {companyOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Solicitud</th><th>Responsable</th><th>Empresa</th><th>Método</th>
                <th>Monto asignado</th><th>Monto comprobado</th><th>Pendiente</th><th>Fecha límite</th><th>Estatus</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && <TableSkeletonRows cols={10} />}
              {status === 'error' && <tr><td colSpan={10} className={s.tableMsg}>{errorMsg}</td></tr>}
              {status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={10} className={s.tableMsg}><strong>No hay fondos para este filtro.</strong><br />Ajusta la búsqueda o cambia los filtros.</td></tr>
              )}
              {status === 'ready' && lookups && rows.map((fund) => {
                const request = lookups.paymentRequestById(fund.payment_request_id)
                const b = fundStatusBadge(fund.status)
                return (
                  <tr key={fund.id}>
                    <td>
                      <span className={s.cellMain}>{request?.request_number || 'Sin solicitud'}</span>
                      <span className={s.cellSub}>{request?.description || fund.notes || ''}</span>
                    </td>
                    <td>{lookups.profileName(fund.responsible_profile_id)}</td>
                    <td>{lookups.companyName(fund.company_id)}</td>
                    <td>{({ cash: 'Efectivo', check: 'Cheque' } as Record<string, string>)[fund.delivery_method || ''] || 'Sin método'}</td>
                    <td><span className={s.cellMain}>{formatCurrency(fund.assigned_amount)}</span></td>
                    <td>{formatCurrency(fund.verified_amount)}</td>
                    <td><span className={s.cellMain}>{formatCurrency(fund.pending_amount)}</span></td>
                    <td>{formatDate(fund.due_date)}</td>
                    <td><Badge variant={b.variant}>{b.label}</Badge></td>
                    <td><button className={s.smallBtn} onClick={() => setDetailFundId(fund.id)}>Ver detalle</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {detailFund && lookups && (
        <FundDetailModal
          fund={detailFund}
          lookups={lookups}
          canReview={canReview}
          blockResult={blockResults[detailFund.id] ?? null}
          onCreateReconciliation={onCreateReconciliation}
          onAddTicket={setTicketFor}
          onSubmit={setSubmitFor}
          onReview={(recId, action) => setReviewFor({ recId, action })}
          onVerifyBlock={(profileId) => onVerifyBlock(detailFund.id, profileId)}
          onOpenReceipt={onOpenReceipt}
          onClose={() => setDetailFundId(null)}
        />
      )}

      {ticketFor && data && (
        <TicketModal
          reconciliationId={ticketFor}
          providers={data.proveedores}
          budgetCategories={data.budgetCategories}
          onClose={() => setTicketFor(null)}
          onSaved={async () => { setTicketFor(null); await reload() }}
        />
      )}

      {submitFor && submitCtx && (
        <SubmitModal
          reconciliationId={submitFor}
          assignedAmount={submitCtx.assigned}
          totalTickets={submitCtx.tickets}
          onClose={() => setSubmitFor(null)}
          onSubmitted={async () => { setSubmitFor(null); await reload() }}
        />
      )}

      {reviewFor && ensureProfileGuard(currentProfile) && (
        <ReviewModal
          reconciliationId={reviewFor.recId}
          action={reviewFor.action}
          reviewerProfileId={currentProfile!.id}
          onClose={() => setReviewFor(null)}
          onReviewed={async () => { setReviewFor(null); await reload() }}
        />
      )}
    </>
  )
}

// Evita abrir el modal de revisión sin perfil (el RPC lo exige).
function ensureProfileGuard(profile: ProfileLite | null): boolean {
  return Boolean(profile?.id)
}
