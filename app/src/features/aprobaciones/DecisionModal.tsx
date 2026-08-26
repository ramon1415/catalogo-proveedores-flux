import { useEffect, useRef, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import {
  byId, formatCurrency, formatMonth, statusBadge, budgetBadge, typeLabel,
  decisionActionsFor, requiresComment, approverDetailLabel,
} from './logic'
import type { DecisionButton } from './logic'
import { getApproverDetails } from './api'
import type {
  PaymentRequest, ProviderLite, Company, CostCenter, BudgetCategory,
  LayoutLine, CashFundLite, DecisionAction,
} from './types'
import s from './Aprobaciones.module.css'

// Badge de presupuesto: usa el componente compartido salvo la variante `violet`
// (excepción), que no existe en Badge y se pinta con una clase local.
function BudgetBadge({ request }: { request: PaymentRequest }) {
  const b = budgetBadge(request)
  if (b.variant === 'violet') return <span className={`${s.badge} ${s.violet}`}>{b.label}</span>
  return <Badge variant={b.variant}>{b.label}</Badge>
}

function Ref({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`${s.refCell} ${full ? s.full : ''}`}>
      <span className={s.refLabel}>{label}</span>
      <span className={s.refValue}>{value}</span>
    </div>
  )
}

export function DecisionModal({
  request,
  providers,
  companies,
  centers,
  categories,
  layoutLines,
  cashFunds,
  canApprove,
  profileId,
  initialError,
  onDecide,
  onClose,
}: {
  request: PaymentRequest
  providers: ProviderLite[]
  companies: Company[]
  centers: CostCenter[]
  categories: BudgetCategory[]
  layoutLines: LayoutLine[]
  cashFunds: CashFundLite[]
  canApprove: boolean
  profileId: string | null | undefined
  initialError?: string
  onDecide: (action: DecisionAction, comments: string) => Promise<string | null>
  onClose: () => void
}) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState(initialError ?? '')
  const [saving, setSaving] = useState(false)
  const [approver, setApprover] = useState('Cargando...')
  const commentRef = useRef<HTMLTextAreaElement>(null)

  // Enfoca el comentario cuando llega con un error inicial (quick-reject).
  useEffect(() => {
    if (initialError) commentRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Carga el aprobador seleccionado (RPC).
  useEffect(() => {
    let cancelled = false
    setApprover('Cargando...')
    getApproverDetails(request.id)
      .then((row) => { if (!cancelled) setApprover(approverDetailLabel(row)) })
      .catch(() => { if (!cancelled) setApprover('No disponible') })
    return () => { cancelled = true }
  }, [request.id])

  const provider = byId(providers, request.proveedor_id)
  const company = byId(companies, request.company_id)
  const center = byId(centers, request.cost_center_id)
  const category = byId(categories, request.budget_category_id)
  const layoutLine = layoutLines.find((l) => l.payment_request_id === request.id)
  const fund = cashFunds.find((f) => f.payment_request_id === request.id)

  const st = statusBadge(request.status)
  const decision = decisionActionsFor(request, canApprove, profileId)

  async function onDecision(action: DecisionAction) {
    if (requiresComment(action) && !comment.trim()) {
      setError('Captura un comentario para registrar esta decision.')
      commentRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    const msg = await onDecide(action, comment.trim())
    if (msg) {
      setError(msg)
      setSaving(false)
    }
    // Si no hay error, el modal se desmonta (la página recarga y cierra).
  }

  const categoryValue = [category?.code, category?.name || category?.category].filter(Boolean).join(' · ') || 'Sin partida'
  const operationValue = layoutLine ? 'En layout' : fund ? 'Fondo creado' : 'Sin operacion creada'
  const showOperationSection = Boolean(layoutLine || fund || request.is_extraordinary_adjustment)

  return (
    <Modal
      title={request.request_number || 'Solicitud'}
      size="lg"
      onClose={onClose}
      actions={<button type="button" className={s.secondaryBtn} onClick={onClose}>Cerrar</button>}
    >
      <div className={s.detailHead}>
        <div className={s.detailBadges}>
          <Badge variant={st.variant}>{st.label}</Badge>
          <BudgetBadge request={request} />
        </div>
        <span className={s.detailAmount}>{formatCurrency(request.amount_requested, request.currency)}</span>
      </div>

      {(request.description || request.notes) && (
        <div className={s.dataSection}>
          {request.description && (
            <div className={s.dataRow}><span className={s.dataLabel}>Descripcion</span><span className={s.dataValue}>{request.description}</span></div>
          )}
          {request.notes && (
            <div className={s.dataRow}><span className={s.dataLabel}>Notas</span><span className={s.dataValue}>{request.notes}</span></div>
          )}
        </div>
      )}

      <div className={s.refGrid}>
        <div className={s.refCell}>
          <span className={s.refLabel}>Proveedor</span>
          <span className={s.refValue}>{provider?.alias || provider?.nombre_completo || 'Sin proveedor'}</span>
          {provider?.rfc && <span className={`${s.refValue} ${s.muted}`}>{provider.rfc}</span>}
        </div>
        <Ref label="Empresa" value={company?.legal_name || company?.name || 'Sin empresa'} />
        <Ref label="Centro de costo" value={center?.name || center?.code || 'Sin centro'} />
        <Ref label="Partida" value={categoryValue} />
        <Ref label="Tipo" value={typeLabel(request.request_type)} />
        <Ref label="Mes presupuestal" value={formatMonth(request.budget_month)} />
        <Ref label="Aprobador seleccionado" value={approver} full />
      </div>

      {showOperationSection && (
        <div className={s.dataSection}>
          <div className={s.dataRow}>
            <span className={s.dataLabel}>Operacion posterior</span>
            <span className={s.dataValue}>{operationValue}</span>
          </div>
          {request.is_extraordinary_adjustment && (
            <div className={s.dataRow}>
              <span className={s.dataLabel}>Ajuste extraordinario</span>
              <span className={s.dataValue}>{request.exception_action || request.exception_status || 'Activo'}</span>
            </div>
          )}
        </div>
      )}

      <div className={s.decisionBox}>
        <div className={s.sectionHeading}>Decision del aprobador</div>
        <div className={`${s.notice} ${s.neutral}`}>
          <span className={s.noticeTitle}>Accion requerida</span>
          <span className={s.noticeDesc}>— Selecciona una accion y captura comentario cuando aplique.</span>
        </div>
        <label className={s.commentLabel}>Comentario
          <textarea
            ref={commentRef}
            className={s.textarea}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comentario para la decision"
          />
        </label>
        {error && (
          <div className={`${s.notice} ${s.danger}`}>
            <span className={s.noticeDesc}>{error}</span>
          </div>
        )}
        <div className={s.decisionActions}>
          {decision.kind === 'message' ? (
            <span className={s.hint}>{decision.text}</span>
          ) : (
            decision.buttons.map((b: DecisionButton) => (
              <button
                key={b.action}
                type="button"
                className={`${s.decisionBtn} ${s[b.variant]}`}
                disabled={saving}
                onClick={() => onDecision(b.action)}
              >
                {b.label}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  )
}
