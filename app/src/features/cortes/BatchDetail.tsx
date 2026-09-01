// Detalle del corte: encabezado, KPIs, banner, barra de decisión, tablas de
// solicitudes, elegibles y no elegibles. Espejo de renderDetail() y auxiliares.
import type { MutableRefObject } from 'react'
import { Badge } from '../../components/ui/Badge'
import {
  classificationLabel, classificationReasonLabel, formatCurrencyTotals, formatDate,
  formatDateTime, formatMoney, groupTotals, ineligibleTone, originBadge,
  paymentMethodLabel, reviewSequenceLabel, statusLabel, statusVariant, totalsByCurrency,
} from './logic'
import type {
  AddingProgress, BatchDetail as BatchDetailData, BatchDetailBatch, BatchItem,
  DecisionDraft, EligibleRequest,
} from './types'
import s from './Cortes.module.css'

type Props = {
  detail: BatchDetailData
  isFinance: boolean
  mutating: boolean
  eligible: EligibleRequest[]
  ineligible: EligibleRequest[]
  selectedEligibleIds: Set<string>
  addingProgress: AddingProgress
  decisions: Record<string, DecisionDraft>
  itemsSectionRef: MutableRefObject<HTMLDivElement | null>
  onToggleEligible: (id: string) => void
  onSelectAllEligible: (checked: boolean) => void
  onClearSelection: () => void
  onAddSelected: () => void
  onRemoveItem: (itemId: string) => void
  onSubmitBatch: () => void
  onApproveAll: () => void
  onSaveDecisions: () => void
  onCloseBatch: () => void
  onOpenRebatch: (itemId: string) => void
  onExportCsv: () => void
  onExportPdf: () => void
  onDecisionChange: (itemId: string, status: '' | 'approved' | 'rejected') => void
  onReasonChange: (itemId: string, reason: string) => void
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={s.metric}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

// Espejo de itemDecisionBadge del vanilla.
function ItemDecisionBadge({ batchStatus, item }: { batchStatus: string; item: BatchItem }) {
  const itemStatus = item.director_status
  if (itemStatus === 'rejected') return <Badge variant="danger">Rechazada por Dirección</Badge>
  if (itemStatus === 'approved' && batchStatus === 'closed') return <Badge variant="success">Aprobada y liberada para pago</Badge>
  if (itemStatus === 'approved' && ['approved', 'partially_approved'].includes(batchStatus)) {
    return <Badge variant="success">Dirección aprobó · pendiente de liberación</Badge>
  }
  if (itemStatus === 'pending' && batchStatus === 'submitted') return <Badge variant="warning">Pendiente de decisión de Dirección</Badge>
  return <Badge variant={statusVariant(itemStatus)}>{statusLabel(itemStatus)}</Badge>
}

// Espejo de renderStatusBanner.
function StatusBanner({ batch, items }: { batch: BatchDetailBatch; items: BatchItem[] }) {
  if (batch.status === 'submitted') {
    return (
      <div className={`${s.statusBanner} ${s.bannerInfo}`}>
        <div>
          <strong>Corte enviado a Direccion</strong>
          <span>Pendiente de decision de {batch.director_name || 'la persona directora'}.</span>
        </div>
        <span>{formatDateTime(batch.submitted_at)}</span>
      </div>
    )
  }
  if (batch.status === 'approved') {
    return (
      <div className={`${s.statusBanner} ${s.bannerSuccess}`}>
        <div>
          <strong>Direccion aprobo</strong>
          <span>{items.length} solicitudes esperan el cierre de Finanzas antes de continuar a pago.</span>
        </div>
        <span>{formatDateTime(batch.decided_at)}</span>
      </div>
    )
  }
  if (batch.status === 'partially_approved') {
    const approved = items.filter((item) => item.director_status === 'approved').length
    const rejected = items.filter((item) => item.director_status === 'rejected').length
    if (!approved) {
      return (
        <div className={`${s.statusBanner} ${s.bannerWarning}`}>
          <div>
            <strong>Direccion rechazo todas las solicitudes</strong>
            <span>{rejected} solicitudes permanecen bloqueadas. Finanzas puede corregirlas y enviarlas nuevamente.</span>
          </div>
          <span>{formatDateTime(batch.decided_at)}</span>
        </div>
      )
    }
    return (
      <div className={`${s.statusBanner} ${s.bannerWarning}`}>
        <div>
          <strong>Direccion decidio con rechazos</strong>
          <span>{approved} aprobadas esperan cierre y {rejected} permanecen bloqueadas con su motivo.</span>
        </div>
        <span>{formatDateTime(batch.decided_at)}</span>
      </div>
    )
  }
  if (batch.status === 'closed') {
    const approved = items.filter((item) => item.director_status === 'approved').length
    const rejected = items.filter((item) => item.director_status === 'rejected').length
    return (
      <div className={`${s.statusBanner} ${s.bannerSuccess}`}>
        <div>
          <strong>Liberado para pago</strong>
          <span>{approved} pagos pueden continuar y {rejected} permanecen rechazados.</span>
        </div>
        <span>{formatDateTime(batch.closed_at)}</span>
      </div>
    )
  }
  return null
}

// Espejo de renderItemReviewContext (columna "Contexto").
function ItemReviewContext({
  item, canDecide, decision, onReasonChange,
}: {
  item: BatchItem
  canDecide: boolean
  decision: DecisionDraft | undefined
  onReasonChange: (itemId: string, reason: string) => void
}) {
  if (canDecide && item.director_status === 'pending') {
    const needsReason = decision?.status === 'rejected'
    return (
      <>
        {item.previous_item_id && (
          <div className={s.reviewContext}>
            <strong>Rechazo anterior</strong>
            <span>{item.previous_reject_reason || 'Sin motivo registrado'}</span>
            <small>{item.previous_batch_label || 'Corte anterior'} · {formatDateTime(item.previous_rejected_at)}</small>
            <strong>Correccion reportada</strong>
            <span>{item.resubmission_note || item.previous_correction_note || 'Sin detalle de correccion'}</span>
          </div>
        )}
        <input
          className={s.reasonInput}
          aria-label={`Motivo para ${item.request_number || 'solicitud'}`}
          placeholder="Obligatorio si rechaza"
          disabled={!needsReason}
          required={needsReason}
          value={needsReason ? decision?.reason ?? '' : ''}
          onChange={(e) => onReasonChange(item.id, e.target.value)}
        />
      </>
    )
  }
  const correction = item.rebatch_status === 'released' || item.rebatch_release_note
    ? `Correccion: ${item.rebatch_release_note || item.resubmission_note || 'Registrada'}`
    : ''
  return (
    <div className={s.reviewContextCompact}>
      {item.reject_reason ? <span>{item.reject_reason}</span> : <span className={s.listMeta}>Sin motivo vigente</span>}
      {correction && <small>{correction}</small>}
    </div>
  )
}

export function BatchDetail(props: Props) {
  const {
    detail, isFinance, mutating, eligible, ineligible, selectedEligibleIds,
    addingProgress, decisions, itemsSectionRef,
  } = props
  const batch = detail.batch
  const items = detail.items
  if (!batch) return <div className={s.empty}>No hay detalle disponible.</div>

  const currencyTotals = totalsByCurrency(items)
  const approved = items.filter((item) => item.director_status === 'approved').length
  const rejected = items.filter((item) => item.director_status === 'rejected').length
  const pending = items.filter((item) => item.director_status === 'pending').length
  const pendingItems = items.filter((item) => item.director_status === 'pending')

  const busy = Boolean(addingProgress)
  const canDecide = Boolean(batch.can_director_decide) && batch.status === 'submitted'
  const canRemove = isFinance && batch.status === 'draft'
  const canReleaseAny = isFinance && ['partially_approved', 'closed'].includes(batch.status)
    && items.some((item) => item.director_status === 'rejected' && item.rebatch_status === 'blocked')
  const hasActionColumn = canRemove || canReleaseAny
  const hasApprovedItems = items.some((item) => item.director_status === 'approved')

  // Conteos vivos de la barra de decisión (espejo de syncDecisionUi).
  const decisionCounts = pendingItems.reduce(
    (acc, item) => {
      const draft = decisions[item.id]
      if (draft?.status === 'approved') acc.approved += 1
      else if (draft?.status === 'rejected') {
        acc.rejected += 1
        if (!draft.reason.trim()) acc.invalidReasons += 1
      } else acc.undecided += 1
      return acc
    },
    { approved: 0, rejected: 0, undecided: 0, invalidReasons: 0 },
  )
  const saveDisabled = mutating || decisionCounts.undecided > 0 || decisionCounts.invalidReasons > 0

  const selectedCount = eligible.filter((item) => selectedEligibleIds.has(item.id)).length
  const eligibleTotal = eligible.length

  const breakdownGroups: [string, ReturnType<typeof groupTotals>][] = items.length ? [
    ['Metodo de pago', groupTotals(items, (item) => paymentMethodLabel(item.payment_method))],
    ['Centro de costo', groupTotals(items, (item) => item.cost_center || 'Sin centro')],
    ['Empresa', groupTotals(items, (item) => item.company_name || batch.company_name || 'Sin empresa')],
    ['Moneda', groupTotals(items, (item) => item.currency || 'MXN')],
  ] : []

  return (
    <>
      <div className={s.detailHead}>
        <div>
          <h2>{batch.label}</h2>
          <div className={s.listMeta}>
            <span>{batch.company_name}</span>
            <span>{formatDate(batch.period_start)} - {formatDate(batch.period_end)}</span>
            <span>Director: {batch.director_name || 'Sin asignar'}</span>
          </div>
        </div>
        <div className={s.detailActions}>
          <button className={s.secondaryBtn} type="button" disabled={mutating} onClick={props.onExportCsv}>CSV</button>
          <button className={s.secondaryBtn} type="button" disabled={mutating} onClick={props.onExportPdf}>PDF</button>
          {isFinance && batch.status === 'draft' && (
            <>
              <button
                className={s.primaryBtn}
                type="button"
                aria-describedby="sendBatchHelp"
                title={items.length
                  ? `Enviar ${items.length} solicitudes a ${batch.director_name || 'Direccion'}`
                  : 'Agrega solicitudes antes de enviar'}
                disabled={!items.length || busy || mutating}
                onClick={props.onSubmitBatch}
              >
                Enviar {items.length} a Direccion
              </button>
              <span className={s.actionHelp} id="sendBatchHelp">
                {items.length
                  ? `Se enviaran ${items.length} solicitudes a ${batch.director_name || 'Direccion'}.`
                  : 'Agrega al menos una solicitud para habilitar el envio.'}
              </span>
            </>
          )}
          {isFinance && hasApprovedItems && ['approved', 'partially_approved'].includes(batch.status) && (
            <button className={s.primaryBtn} type="button" disabled={mutating} onClick={props.onCloseBatch}>
              Liberar para pago
            </button>
          )}
        </div>
      </div>

      <div className={s.metrics}>
        <Metric label="Solicitudes" value={items.length} />
        <Metric label={currencyTotals.length > 1 ? 'Varias monedas' : 'Total'} value={formatCurrencyTotals(currencyTotals)} />
        <Metric label="Pendientes" value={pending} />
        <Metric label="Aprobadas / rechazadas" value={`${approved} / ${rejected}`} />
      </div>

      <StatusBanner batch={batch} items={items} />

      {canDecide && pendingItems.length > 0 && (
        <div className={s.decisionBar} aria-label="Acciones de decision del corte">
          <div className={s.decisionCopy}>
            <strong>{pendingItems.length} solicitudes pendientes</strong>
            <span>{formatCurrencyTotals(totalsByCurrency(pendingItems))}</span>
            <span className={s.decisionStats} aria-live="polite">
              {decisionCounts.approved} aprobadas | {decisionCounts.rejected} rechazadas | {decisionCounts.undecided} sin decision
            </span>
          </div>
          <div className={s.decisionActions}>
            <button className={s.secondaryBtn} type="button" disabled={mutating} onClick={props.onApproveAll}>Aprobar todo</button>
            <button className={s.primaryBtn} type="button" disabled={saveDisabled} onClick={props.onSaveDecisions}>Guardar decisiones</button>
          </div>
        </div>
      )}

      {breakdownGroups.length > 0 && (
        <div className={s.section}>
          <div className={s.sectionHead}><h3>Desglose del corte</h3></div>
          <div className={s.breakdownGrid}>
            {breakdownGroups.map(([label, rows]) => (
              <div key={label}>
                <div className={s.breakdownLabel}>{label}</div>
                {rows.map((row) => (
                  <div key={`${row.label}|${row.currency}`} className={s.breakdownRow}>
                    <span>{row.label}</span>
                    <strong>{formatMoney(row.total, row.currency)}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {batch.notes && (
        <div className={s.section}>
          <div className={s.listMeta}>Notas</div>
          <div>{batch.notes}</div>
        </div>
      )}

      <div className={`${s.section} ${s.sectionFocus}`} ref={itemsSectionRef} tabIndex={-1}>
        <div className={s.sectionHead}>
          <h3>Solicitudes del corte</h3>
          <span className={s.listMeta}>{statusLabel(batch.status)}</span>
        </div>
        {!items.length ? (
          <div className={s.empty}>Agrega solicitudes elegibles antes de enviar el corte.</div>
        ) : (
          <div className={`${s.tableWrap} ${s.tableScroll}`}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Folio / revision</th><th>Proveedor</th><th>Centro / partida</th><th>Metodo</th>
                  <th>Monto</th><th>Solicitante</th><th>Decision actual</th><th>Contexto</th>
                  {hasActionColumn && <th></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.request_number || '-'}</strong>
                      <div className={s.inlineBadges}>
                        {item.previous_item_id && <Badge variant="warning">Reenviada</Badge>}
                        <Badge variant="info">{reviewSequenceLabel(item.review_sequence)}</Badge>
                      </div>
                    </td>
                    <td>{item.provider_name || '-'}</td>
                    <td>
                      {item.cost_center || '-'}
                      <br />
                      <span className={s.listMeta}>{item.budget_category || '-'}</span>
                    </td>
                    <td>{paymentMethodLabel(item.payment_method)}</td>
                    <td>{formatMoney(item.amount, item.currency)}</td>
                    <td>{item.requester_name || '-'}</td>
                    <td>
                      {canDecide && item.director_status === 'pending' ? (
                        <select
                          className={s.decisionSelect}
                          aria-label={`Decision para ${item.request_number || 'solicitud'}`}
                          value={decisions[item.id]?.status ?? ''}
                          disabled={mutating}
                          onChange={(e) => props.onDecisionChange(item.id, e.target.value as '' | 'approved' | 'rejected')}
                        >
                          <option value="">Sin decision</option>
                          <option value="approved">Aprobar</option>
                          <option value="rejected">Rechazar</option>
                        </select>
                      ) : (
                        <ItemDecisionBadge batchStatus={batch.status} item={item} />
                      )}
                    </td>
                    <td>
                      <ItemReviewContext
                        item={item}
                        canDecide={canDecide}
                        decision={decisions[item.id]}
                        onReasonChange={props.onReasonChange}
                      />
                    </td>
                    {hasActionColumn && (
                      <td>
                        {canRemove ? (
                          <button className={s.secondaryBtn} type="button" disabled={mutating} onClick={() => props.onRemoveItem(item.id)}>
                            Quitar
                          </button>
                        ) : item.director_status === 'rejected' && item.rebatch_status === 'blocked' ? (
                          <button className={s.secondaryBtn} type="button" disabled={mutating} onClick={() => props.onOpenRebatch(item.id)}>
                            Corregir y enviar nuevamente
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isFinance && batch.status === 'draft' && (
        <>
          <div className={s.section}>
            <div className={s.sectionHead}>
              <h3>Solicitudes elegibles</h3>
              <span className={s.listMeta}>Enviadas con presupuesto disponible y aun no ejecutadas</span>
            </div>
            {!eligible.length ? (
              <div className={s.empty}>No hay solicitudes elegibles para esta empresa.</div>
            ) : (
              <>
                <div className={s.bulkBar}>
                  <label className={s.selectAll}>
                    <input
                      className={s.check}
                      type="checkbox"
                      aria-label="Seleccionar todas las solicitudes elegibles"
                      checked={eligibleTotal > 0 && selectedCount === eligibleTotal}
                      disabled={busy}
                      ref={(el) => { if (el) el.indeterminate = selectedCount > 0 && selectedCount < eligibleTotal }}
                      onChange={(e) => props.onSelectAllEligible(e.target.checked)}
                    />
                    {' '}Seleccionar todas
                  </label>
                  <span className={s.selectionCount} aria-live="polite">{selectedCount} de {eligibleTotal} seleccionadas</span>
                  <button className={s.secondaryBtn} type="button" disabled={!selectedCount || busy} onClick={props.onClearSelection}>
                    Limpiar seleccion
                  </button>
                  <button className={s.primaryBtn} type="button" disabled={!selectedCount || busy || mutating} onClick={props.onAddSelected}>
                    Agregar {selectedCount} al corte
                  </button>
                  {busy && addingProgress && (
                    <span className={s.progress} aria-live="polite">
                      Agregando {addingProgress.current} de {addingProgress.total}...
                    </span>
                  )}
                </div>
                <div className={`${s.tableWrap} ${s.tableScroll}`}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th></th><th>Folio</th><th>Proveedor</th><th>Centro / partida</th><th>Metodo</th>
                        <th>Monto</th><th>Presupuesto</th><th>Origen</th><th>Solicitante</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligible.map((item) => {
                        const selected = selectedEligibleIds.has(item.id)
                        const origin = originBadge(item)
                        return (
                          <tr
                            key={item.id}
                            className={`${s.eligibleRow} ${selected ? s.eligibleRowSelected : ''}`}
                            onClick={(event) => {
                              // El click en la fila alterna la selección, salvo sobre controles.
                              const interactive = (event.target as HTMLElement).closest('button,input,select,textarea,a,label')
                              if (interactive || mutating || busy) return
                              props.onToggleEligible(item.id)
                            }}
                          >
                            <td>
                              <input
                                className={s.check}
                                type="checkbox"
                                aria-label={`Seleccionar ${item.request_number}`}
                                checked={selected}
                                disabled={busy}
                                onChange={() => props.onToggleEligible(item.id)}
                              />
                            </td>
                            <td><strong>{item.request_number}</strong></td>
                            <td>{item.provider_name || '-'}</td>
                            <td>
                              {item.cost_center || '-'}
                              <br />
                              <span className={s.listMeta}>{item.budget_category || '-'}</span>
                            </td>
                            <td>{paymentMethodLabel(item.payment_method)}</td>
                            <td>{formatMoney(item.amount, item.currency)}</td>
                            <td>
                              <Badge variant="success">Presupuesto disponible</Badge>
                              {item.budget_available != null && (
                                <small className={s.cellNote}>Disponible: {formatMoney(item.budget_available, item.currency)}</small>
                              )}
                            </td>
                            <td>
                              <Badge variant={origin.tone}>{origin.label}</Badge>
                              <small className={s.cellNote}>{reviewSequenceLabel(item.review_sequence)}</small>
                              {origin.context && <small className={s.cellNote}>{origin.context}</small>}
                            </td>
                            <td>{item.requester_name || '-'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {ineligible.length > 0 && (
            <div className={`${s.section} ${s.ineligibleSection}`}>
              <div className={s.sectionHead}>
                <div className={s.ineligibleHeadCopy}>
                  <h3>Solicitudes que aun no pueden agregarse</h3>
                  <span className={s.listMeta}>El motivo viene de la validacion del servidor; no necesitas revisar la consola.</span>
                </div>
                <Badge variant="warning">{ineligible.length}</Badge>
              </div>
              <div className={`${s.tableWrap} ${s.tableScroll}`}>
                <table className={s.table}>
                  <thead>
                    <tr><th>Folio</th><th>Proveedor</th><th>Monto</th><th>Estado</th><th>Que falta</th></tr>
                  </thead>
                  <tbody>
                    {ineligible.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.request_number || '-'}</strong></td>
                        <td>{item.provider_name || '-'}</td>
                        <td>{formatMoney(item.amount, item.currency)}</td>
                        <td><Badge variant={ineligibleTone(item.classification)}>{classificationLabel(item.classification)}</Badge></td>
                        <td>{classificationReasonLabel(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
