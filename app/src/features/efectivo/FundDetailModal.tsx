import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, formatDate, formatDateTime } from '../../lib/format'
import {
  makeLookups, fundStatusBadge, reconciliationStatusBadge, itemStatusBadge,
  methodLabel, fundStatusLabel,
} from './logic'
import type { CashFund, ReviewAction } from './types'
import type { CashBlockResult } from './api'
import s from './Efectivo.module.css'

type Lookups = ReturnType<typeof makeLookups>

function Ref({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.refCell}>
      <span className={s.refLabel}>{label}</span>
      <span className={s.refValue}>{value}</span>
    </div>
  )
}

export function FundDetailModal({
  fund,
  lookups,
  canReview,
  blockResult,
  onCreateReconciliation,
  onAddTicket,
  onSubmit,
  onReview,
  onVerifyBlock,
  onOpenReceipt,
  onClose,
}: {
  fund: CashFund
  lookups: Lookups
  canReview: boolean
  blockResult: CashBlockResult | 'loading' | null
  onCreateReconciliation: (fundId: string) => void
  onAddTicket: (reconciliationId: string) => void
  onSubmit: (reconciliationId: string) => void
  onReview: (reconciliationId: string, action: ReviewAction) => void
  onVerifyBlock: (profileId: string) => void
  onOpenReceipt: (path: string) => void
  onClose: () => void
}) {
  const request = lookups.paymentRequestById(fund.payment_request_id)
  const reconciliation = lookups.reconciliationForFund(fund.id)
  const badge = fundStatusBadge(fund.status)

  const closedOrCancelled = ['closed', 'cancelled'].includes(fund.status || '')
  const canCreate = !reconciliation && !closedOrCancelled
  const editable = reconciliation && ['draft', 'correction_requested'].includes(reconciliation.status || '')
  const canReviewNow = reconciliation && reconciliation.status === 'submitted' && canReview
  const showSubmittedNotice = reconciliation?.status === 'submitted' && !canReviewNow

  const tickets = reconciliation ? lookups.itemsForReconciliation(reconciliation.id) : []

  return (
    <Modal
      title={request?.request_number || 'Detalle de fondo'}
      subtitle={`${methodLabel(fund.delivery_method)} — ${fundStatusLabel(fund.status)}`}
      size="lg"
      onClose={onClose}
      actions={<button type="button" className={s.secondaryBtn} onClick={onClose}>Cerrar</button>}
    >
      <div className={s.refGrid}>
        <Ref label="Solicitud origen" value={request?.request_number || 'Sin solicitud'} />
        <Ref label="Responsable" value={lookups.profileName(fund.responsible_profile_id)} />
        <Ref label="Empresa" value={lookups.companyName(fund.company_id)} />
        <Ref label="Método" value={methodLabel(fund.delivery_method)} />
        <Ref label="Monto asignado" value={formatCurrency(fund.assigned_amount)} />
        <Ref label="Monto comprobado" value={formatCurrency(fund.verified_amount)} />
        <Ref label="Pendiente" value={formatCurrency(fund.pending_amount)} />
        <Ref label="Fecha límite" value={formatDate(fund.due_date)} />
        <div className={s.refCell}>
          <span className={s.refLabel}>Estatus</span>
          <span className={s.refValue}><Badge variant={badge.variant}>{badge.label}</Badge></span>
        </div>
        {fund.notes && (
          <div className={`${s.refCell} ${s.full}`}>
            <span className={s.refLabel}>Notas</span>
            <span className={s.refValue}>{fund.notes}</span>
          </div>
        )}
      </div>

      <div className={s.sectionHeading}>Comprobación</div>
      {reconciliation ? (
        <div className={s.refGrid}>
          <div className={s.refCell}>
            <span className={s.refLabel}>Estatus</span>
            <span className={s.refValue}>
              {(() => { const b = reconciliationStatusBadge(reconciliation.status); return <Badge variant={b.variant}>{b.label}</Badge> })()}
            </span>
          </div>
          <Ref label="Total tickets" value={formatCurrency(reconciliation.total_tickets)} />
          <Ref label="Monto devuelto" value={formatCurrency(reconciliation.returned_amount)} />
          <Ref label="Diferencia" value={formatCurrency(reconciliation.difference_amount)} />
          <Ref label="Fecha de revisión" value={formatDateTime(reconciliation.reviewed_at)} />
          {reconciliation.reviewer_comment && (
            <div className={`${s.refCell} ${s.full}`}>
              <span className={s.refLabel}>Comentario del revisor</span>
              <span className={s.refValue}>{reconciliation.reviewer_comment}</span>
            </div>
          )}
        </div>
      ) : (
        <div className={`${s.notice} ${s.warning}`}>
          <span className={s.noticeTitle}>Sin comprobación</span>
          <span className={s.noticeDesc}>— Crea una comprobación para empezar a registrar tickets.</span>
        </div>
      )}

      {blockResult && <BlockResult result={blockResult} />}

      <div className={s.actions}>
        {canCreate && <button className={`${s.smallBtn} ${s.success}`} onClick={() => onCreateReconciliation(fund.id)}>Crear comprobación</button>}
        {editable && <button className={s.smallBtn} onClick={() => onAddTicket(reconciliation!.id)}>Agregar ticket</button>}
        {editable && <button className={`${s.smallBtn} ${s.info}`} onClick={() => onSubmit(reconciliation!.id)}>Enviar comprobación</button>}
        {canReviewNow && (
          <>
            <button className={`${s.smallBtn} ${s.success}`} onClick={() => onReview(reconciliation!.id, 'approved')}>Aprobar</button>
            <button className={`${s.smallBtn} ${s.danger}`} onClick={() => onReview(reconciliation!.id, 'rejected')}>Rechazar</button>
            <button className={`${s.smallBtn} ${s.warning}`} onClick={() => onReview(reconciliation!.id, 'correction_requested')}>Solicitar corrección</button>
          </>
        )}
        <button className={s.smallBtn} onClick={() => onVerifyBlock(fund.responsible_profile_id || '')}>Verificar bloqueo</button>
      </div>
      {showSubmittedNotice && (
        <div className={`${s.notice} ${s.warning}`} style={{ marginTop: 10 }}>
          <span className={s.noticeTitle}>En revisión</span>
          <span className={s.noticeDesc}>— Las decisiones las registra un perfil autorizado.</span>
        </div>
      )}

      <div className={s.sectionHeading}>Tickets / comprobantes</div>
      {!reconciliation ? (
        <div className={s.emptyBox}>Primero crea una comprobación para agregar tickets.</div>
      ) : (
        <div className={s.subTableWrap}>
          <table className={s.subTable}>
            <thead>
              <tr><th>Concepto</th><th>Proveedor</th><th>Partida</th><th>Monto</th><th>Fecha ticket</th><th>Estatus</th></tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>No hay tickets registrados.</td></tr>
              ) : (
                tickets.map((item) => {
                  const b = itemStatusBadge(item.status)
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className={s.cellMain}>{item.concept || 'Sin concepto'}</span>
                        {item.storage_path ? (
                          <button type="button" className={s.receiptLink} onClick={() => onOpenReceipt(item.storage_path!)}>Ver comprobante</button>
                        ) : (
                          <span className={s.cellSub}>Sin comprobante</span>
                        )}
                      </td>
                      <td>{lookups.providerName(item.proveedor_id)}</td>
                      <td>{lookups.budgetCategoryName(item.budget_category_id)}</td>
                      <td><span className={s.cellMain}>{formatCurrency(item.amount)}</span></td>
                      <td>{formatDate(item.ticket_date)}</td>
                      <td><Badge variant={b.variant}>{b.label}</Badge></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

function BlockResult({ result }: { result: CashBlockResult | 'loading' }) {
  if (result === 'loading') {
    return (
      <div className={`${s.notice} ${s.warning}`}>
        <span className={s.noticeTitle}>Verificando</span>
        <span className={s.noticeDesc}>— Consultando fondos pendientes...</span>
      </div>
    )
  }
  if (!result?.blocked) {
    return (
      <div className={`${s.notice} ${s.neutral}`}>
        <span className={s.noticeTitle}>Sin bloqueo</span>
        <span className={s.noticeDesc}>— El responsable no tiene fondos vencidos pendientes.</span>
      </div>
    )
  }
  const funds = Array.isArray(result.funds) ? result.funds : []
  return (
    <div className={`${s.notice} ${s.danger}`}>
      <span className={s.noticeTitle}>Fondos vencidos</span>
      <span className={s.noticeDesc}>
        — Pendiente total: {formatCurrency(result.total_pending || 0)}. Fondos vencidos: {String(result.overdue_count || funds.length || 0)}.
      </span>
    </div>
  )
}
