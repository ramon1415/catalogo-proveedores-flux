import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { perms } from '../../lib/roles'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { IcSearch } from '../../components/ui/icons'
import { formatDateTime } from '../../lib/format'
import { loadApprovalData, decidePaymentRequest } from './api'
import {
  normalize, byId, formatCurrency, approvalRows, matchSearch, columnKey,
  statusBadge, budgetBadge, approvalDateMeta, requiresComment, decisionLabel,
  friendlyDecisionError, friendlyError,
} from './logic'
import { DecisionModal } from './DecisionModal'
import type { ApprovalData, PaymentRequest, MainTab, SubFilter, ColumnKey, DecisionAction } from './types'
import s from './Aprobaciones.module.css'

type ModalState = { requestId: string; initialError?: string } | null

const DECIDE_TABS: Array<{ key: SubFilter; label: string; variant: string }> = [
  { key: 'all', label: 'Todas', variant: '' },
  { key: 'pending', label: 'Por aprobar', variant: 'warning' },
  { key: 'changes', label: 'Cambios', variant: 'danger' },
  { key: 'exceptions', label: 'Excepciones', variant: 'violet' },
]
const HISTORY_TABS: Array<{ key: SubFilter; label: string; variant: string }> = [
  { key: 'all', label: 'Todas', variant: '' },
  { key: 'approved', label: 'Aprobadas', variant: '' },
  { key: 'closed', label: 'Rechazadas', variant: '' },
]
const DECIDE_COLUMNS: Array<{ key: ColumnKey; title: string }> = [
  { key: 'pending', title: 'Por aprobar' },
  { key: 'changes', title: 'Cambios solicitados' },
  { key: 'exceptions', title: 'Excepcion presupuestal' },
]
const HISTORY_COLUMNS: Array<{ key: ColumnKey; title: string }> = [
  { key: 'approved', title: 'Aprobadas recientemente' },
  { key: 'closed', title: 'Rechazadas / cerradas' },
]

function BudgetBadge({ request }: { request: PaymentRequest }) {
  const b = budgetBadge(request)
  if (b.variant === 'violet') return <span className={`${s.badge} ${s.violet}`}>{b.label}</span>
  return <Badge variant={b.variant}>{b.label}</Badge>
}

export default function AprobacionesPage() {
  const { profile, group } = useAuth()
  const { showToast } = useToast()

  const [data, setData] = useState<ApprovalData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [query, setQuery] = useState('')
  const [mainTab, setMainTab] = useState<MainTab>('decide')
  const [subFilter, setSubFilter] = useState<SubFilter>('all')
  const [modal, setModal] = useState<ModalState>(null)

  const canApprove = perms.canApprove(group)

  async function reload() {
    setStatus('loading')
    try {
      setData(await loadApprovalData())
      setStatus('ready')
    } catch (error) {
      setErrorMsg(friendlyError(error))
      setStatus('error')
      showToast('No se pudo cargar', friendlyError(error), 'error')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const requests = data?.requests ?? []
  const providers = data?.providers ?? []
  const companies = data?.companies ?? []

  const q = normalize(query)
  const rows = useMemo(
    () => approvalRows(requests).filter((r) => matchSearch(r, q, providers, companies)),
    [requests, q, providers, companies],
  )

  const counts = useMemo(() => {
    const base: Record<ColumnKey, number> = { pending: 0, changes: 0, exceptions: 0, approved: 0, closed: 0 }
    rows.forEach((r) => { base[columnKey(r)] += 1 })
    return base
  }, [rows])

  const subTabs = mainTab === 'decide' ? DECIDE_TABS : HISTORY_TABS

  const columns = useMemo(() => {
    const defs = mainTab === 'decide' ? DECIDE_COLUMNS : HISTORY_COLUMNS
    return defs
      .filter((col) => subFilter === 'all' || subFilter === col.key)
      .map((col) => ({ ...col, rows: rows.filter((r) => columnKey(r) === col.key) }))
  }, [mainTab, subFilter, rows])

  const hasVisibleRows = rows.some((r) => columns.some((c) => c.key === columnKey(r)))

  function selectMainTab(tab: MainTab) {
    setMainTab(tab)
    setSubFilter('all')
  }

  function clearFilter() {
    setQuery('')
    setSubFilter('all')
  }

  const modalRequest = modal ? requests.find((r) => r.id === modal.requestId) ?? null : null

  // Decisión: espejo de decideRequest(). Devuelve mensaje de error o null.
  async function runDecision(request: PaymentRequest, action: DecisionAction, comments: string): Promise<string | null> {
    if (!profile?.id) {
      showToast('Perfil no identificado', 'No se pudo identificar el perfil.', 'error')
      return null
    }
    if (requiresComment(action) && !comments) {
      return 'Captura un comentario para registrar esta decision.'
    }
    try {
      await decidePaymentRequest(request.id, profile.id, action, comments || null)
      showToast('Decision registrada', `${decisionLabel(action)} registrada correctamente.`, action.includes('reject') ? 'warning' : 'success')
      setModal(null)
      await reload()
      return null
    } catch (error) {
      const msg = friendlyDecisionError(error)
      showToast('No se pudo registrar', msg, 'error')
      return msg
    }
  }

  // Acción rápida desde la tarjeta.
  function handleQuickDecision(requestId: string, action: 'approved' | 'rejected') {
    if (requiresComment(action)) {
      setModal({ requestId, initialError: 'Captura un comentario para registrar esta decision.' })
      return
    }
    const request = requests.find((r) => r.id === requestId)
    if (request) runDecision(request, action, '')
  }

  function renderCardDates(request: PaymentRequest, colKey: ColumnKey) {
    const created = <span className={s.cardDateLine}>Creada: {formatDateTime(request.created_at)}</span>
    if (colKey !== 'approved' && colKey !== 'closed') return created
    const meta = approvalDateMeta(request)
    if (!meta?.value) return created
    return (
      <>
        <span className={s.cardDateLine}>{meta.label}: {formatDateTime(meta.value)}</span>
        {created}
      </>
    )
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Cola de aprobacion</h1>
          <p className="muted">Revisa solicitudes pendientes, excepciones y cambios. El historial en la segunda pestaña.</p>
        </div>
        <button className={s.primaryBtn} onClick={reload}>Actualizar</button>
      </div>

      {!canApprove && (
        <div className={`${s.notice} ${s.warning}`}>
          <span className={s.noticeTitle}>Sin permisos de aprobacion</span>
          <span className={s.noticeDesc}>— Esta seccion esta disponible para admin, finanzas y aprobadores.</span>
        </div>
      )}

      <div className={s.mainTabs}>
        <button type="button" className={`${s.mainTab} ${mainTab === 'decide' ? s.active : ''}`} onClick={() => selectMainTab('decide')}>Por decidir</button>
        <button type="button" className={`${s.mainTab} ${mainTab === 'history' ? s.active : ''}`} onClick={() => selectMainTab('history')}>Historial</button>
      </div>

      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <IcSearch size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar folio, proveedor o empresa"
              aria-label="Buscar aprobaciones"
            />
          </div>
          <div className={s.subTabs}>
            {subTabs.map(({ key, label, variant }) => {
              const count = key === 'all' ? null : counts[key as ColumnKey]
              const isActive = subFilter === key
              const cls = [s.subTab, isActive ? s.active : '', isActive && variant ? s[variant] : ''].filter(Boolean).join(' ')
              return (
                <button key={key} type="button" className={cls} onClick={() => setSubFilter(key)}>
                  {label}
                  {count != null && <span className={s.subTabCount}>{count}</span>}
                </button>
              )
            })}
          </div>
          <button className={s.secondaryBtn} style={{ marginLeft: 'auto' }} onClick={clearFilter}>Ver todas</button>
        </div>

        <div className={`${s.kanban} ${mainTab === 'decide' ? s.viewDecide : s.viewHistory}`}>
          {status === 'loading' && <div className={s.emptyState}><strong>Cargando aprobaciones...</strong></div>}
          {status === 'error' && (
            <div className={s.emptyState}><strong>No se pudieron cargar aprobaciones.</strong> {errorMsg}</div>
          )}
          {status === 'ready' && !hasVisibleRows && (
            <div className={s.emptyState}><strong>Sin solicitudes en esta vista.</strong> Cambia el filtro o usa Ver todas.</div>
          )}
          {status === 'ready' && hasVisibleRows && columns.map((col) => (
            <section key={col.key} className={s.column}>
              <div className={s.columnHeader}>
                <strong>{col.title}</strong>
                <em>{col.rows.length}</em>
              </div>
              <div className={s.columnBody}>
                {col.rows.length === 0 ? (
                  <div className={s.kanbanEmpty}>Sin solicitudes.</div>
                ) : (
                  col.rows.map((r) => {
                    const provider = byId(providers, r.proveedor_id)
                    const company = byId(companies, r.company_id)
                    const canAct = canApprove && col.key === 'pending' && (!r.approver_id || r.approver_id === profile?.id)
                    return (
                      <article key={r.id} className={s.card}>
                        <div className={s.cardHead}>
                          <div>
                            <div className={s.cardFolio}>{r.request_number || 'Sin folio'}</div>
                            <div className={s.cardDate}>{renderCardDates(r, col.key)}</div>
                          </div>
                          <div className={s.cardAmount}>{formatCurrency(r.amount_requested, r.currency)}</div>
                        </div>
                        <div>
                          <div className={s.cardProvider}>{provider?.alias || provider?.nombre_completo || 'Sin proveedor'}</div>
                          <div className={s.cardSub}>{company?.legal_name || company?.name || 'Sin empresa'}</div>
                        </div>
                        <div className={s.cardBadges}>
                          {(() => { const b = statusBadge(r.status); return <Badge variant={b.variant}>{b.label}</Badge> })()}
                          <BudgetBadge request={r} />
                        </div>
                        <div className={s.cardActions}>
                          <button className={s.smallBtn} onClick={() => setModal({ requestId: r.id })}>Ver detalle</button>
                          {canAct && (
                            <>
                              <button className={`${s.smallBtn} ${s.success}`} onClick={() => handleQuickDecision(r.id, 'approved')}>Aprobar</button>
                              <button className={`${s.smallBtn} ${s.danger}`} onClick={() => handleQuickDecision(r.id, 'rejected')}>Rechazar</button>
                            </>
                          )}
                        </div>
                      </article>
                    )
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      </section>

      {modalRequest && data && (
        <DecisionModal
          request={modalRequest}
          providers={providers}
          companies={companies}
          centers={data.centers}
          categories={data.categories}
          layoutLines={data.layoutLines}
          cashFunds={data.cashFunds}
          canApprove={canApprove}
          profileId={profile?.id}
          initialError={modal?.initialError}
          onDecide={(action, comments) => runDecision(modalRequest, action, comments)}
          onClose={() => setModal(null)}
        />
      )}
    </>
  )
}
