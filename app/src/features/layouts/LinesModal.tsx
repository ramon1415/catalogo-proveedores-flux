import { useMemo, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency } from '../../lib/format'
import { numberValue } from '../../lib/format'
import {
  summarizeLayoutFormats, layoutSourceAccountDisplay, layoutDestinationDisplay, lineStatusBadge,
  lineNeedsPagosintCompletion, lineNeedsPagosintReferenceCompletion, isPagosintLine,
  BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE,
} from './logic'
import { PagosintReferenceModal } from './PagosintReferenceModal'
import { RejectLineModal } from './RejectLineModal'
import type { PaymentLayout, PaymentLayoutLine, BbvaFormat } from './types'
import s from './Layouts.module.css'

export function LinesModal({
  layout,
  lines,
  profileId,
  onClose,
  onDownloadFormat,
  reload,
}: {
  layout: PaymentLayout
  lines: PaymentLayoutLine[]
  profileId: string | null
  onClose: () => void
  onDownloadFormat: (format: BbvaFormat) => void
  // Recarga layouts + relee líneas, actualiza el estado y devuelve las líneas frescas.
  reload: () => Promise<PaymentLayoutLine[]>
}) {
  const [pagosintLine, setPagosintLine] = useState<PaymentLayoutLine | null>(null)
  const [rejectLineId, setRejectLineId] = useState<string | null>(null)

  const activeLines = useMemo(() => lines.filter((line) => line.status === 'included'), [lines])
  const summary = useMemo(() => summarizeLayoutFormats(activeLines), [activeLines])

  function focusFirstPagosintReferenceLine() {
    const line = lines.find((item) => lineNeedsPagosintReferenceCompletion(item))
    if (line) setPagosintLine(line)
  }

  function openPagosint(line: PaymentLayoutLine) {
    if (!isPagosintLine(line)) return
    setPagosintLine(line)
  }

  const summaryRows = [
    { item: summary[BBVA_FORMAT_SAME_BANK], key: BBVA_FORMAT_SAME_BANK },
    { item: summary[BBVA_FORMAT_INTERBANK], key: BBVA_FORMAT_INTERBANK },
    { item: summary[BBVA_FORMAT_CIE], key: BBVA_FORMAT_CIE },
    { item: summary.unsupported, key: 'unsupported' as const },
  ].filter(({ item }) => item && item.count > 0)

  return (
    <>
      <Modal
        title={layout.layout_number || 'Lineas del layout'}
        subtitle={`${layout.name || ''} - archivo CxC BBVA`.trim()}
        size="lg"
        onClose={onClose}
      >
        {/* Resumen de formatos */}
        <div className={s.formatSummary}>
          {!activeLines.length ? (
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>Sin lineas activas para generar archivos BBVA.</span>
          ) : (
            <>
              <div className={s.formatSummaryHead}>
                <strong>Archivos del layout</strong>
                <span>Los formatos BBVA se descargan separados.</span>
              </div>
              <div className={s.subTableWrap}>
                <table className={s.subTable}>
                  <thead>
                    <tr><th>Formato</th><th>Pagos</th><th>Monto total</th><th>Estado</th><th>Accion</th></tr>
                  </thead>
                  <tbody>
                    {summaryRows.map(({ item, key }) => {
                      let statusNode: React.ReactNode = <Badge variant="success">Listo</Badge>
                      let actionNode: React.ReactNode = <span style={{ color: 'var(--text-3)', fontSize: 11 }}>-</span>
                      if (key === BBVA_FORMAT_SAME_BANK) {
                        actionNode = <button className={s.smallBtn} type="button" onClick={() => onDownloadFormat(BBVA_FORMAT_SAME_BANK)}>▾ Pagos BBVA</button>
                      } else if (key === BBVA_FORMAT_INTERBANK) {
                        if (item.referenceIssues > 0) {
                          statusNode = <Badge variant="warning">{item.referenceIssues} referencia(s) pendiente(s)</Badge>
                          actionNode = <button className={`${s.smallBtn} ${s.warning}`} type="button" onClick={focusFirstPagosintReferenceLine}>Completar referencias</button>
                        } else {
                          actionNode = <button className={s.smallBtn} type="button" onClick={() => onDownloadFormat(BBVA_FORMAT_INTERBANK)}>▾ Pagos Inter</button>
                        }
                      } else if (key === BBVA_FORMAT_CIE) {
                        if (item.validationIssues > 0) {
                          statusNode = <Badge variant="warning">{item.validationIssues} linea(s) CIE por corregir</Badge>
                          actionNode = <span style={{ color: 'var(--text-2)', fontSize: 12 }}>Revisa convenio, referencia, cuenta, importe y concepto</span>
                        } else {
                          actionNode = <button className={s.smallBtn} type="button" onClick={() => onDownloadFormat(BBVA_FORMAT_CIE)}>▾ Descargar CIE</button>
                        }
                      } else {
                        statusNode = <Badge variant="danger">No soportado</Badge>
                        actionNode = <span style={{ color: 'var(--text-2)', fontSize: 12 }}>Revisar tipo de destino</span>
                      }
                      return (
                        <tr key={key}>
                          <td><span className={s.cellMain}>{item.label}</span></td>
                          <td>{numberValue(item.count)}</td>
                          <td><strong>{formatCurrency(item.amount)}</strong></td>
                          <td>{statusNode}</td>
                          <td>{actionNode}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Tabla de líneas */}
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Origen</th><th>Titular</th><th>Destino</th><th>Beneficiario</th><th>Importe</th>
                <th>Referencia</th><th>Concepto</th><th>Solicitud</th><th>Estatus</th><th>Accion</th>
              </tr>
            </thead>
            <tbody>
              {!lines.length && <tr><td colSpan={10} className={s.tableMsg}>Este layout no tiene lineas.</td></tr>}
              {lines.map((line) => {
                const b = lineStatusBadge(line.status)
                return (
                  <tr key={line.id}>
                    <td>{layoutSourceAccountDisplay(line)}</td>
                    <td>{line.company_name || ''}</td>
                    <td>{layoutDestinationDisplay(line)}</td>
                    <td><span className={s.cellMain}>{line.beneficiary_name || ''}</span></td>
                    <td>{formatCurrency(line.amount)}</td>
                    <td><ReferenceCell line={line} /></td>
                    <td>{line.payment_concept || ''}</td>
                    <td>{line.request_number || ''}</td>
                    <td><Badge variant={b.variant}>{b.label}</Badge></td>
                    <td>
                      {line.status !== 'included' ? (
                        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>-</span>
                      ) : (
                        <div className={s.rowActions}>
                          {lineNeedsPagosintReferenceCompletion(line) && (
                            <button className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => openPagosint(line)}>Completar referencia</button>
                          )}
                          <button className={`${s.smallBtn} ${s.danger}`} type="button" onClick={() => setRejectLineId(line.id)}>Rechazar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Modal>

      {pagosintLine && (
        <PagosintReferenceModal
          line={pagosintLine}
          onClose={() => setPagosintLine(null)}
          onAfterSave={async () => reload()}
        />
      )}
      {rejectLineId && (
        <RejectLineModal
          lineId={rejectLineId}
          actorProfileId={profileId}
          onClose={() => setRejectLineId(null)}
          onRejected={async () => { setRejectLineId(null); await reload() }}
        />
      )}
    </>
  )
}

function ReferenceCell({ line }: { line: PaymentLayoutLine }) {
  const value = line.payment_reference || ''
  if (!lineNeedsPagosintCompletion(line)) {
    return value ? <>{value}</> : <span style={{ color: 'var(--text-3)', fontSize: 11 }}>-</span>
  }
  const badgeLabel = lineNeedsPagosintReferenceCompletion(line) ? 'Referencia pendiente' : 'Datos PAGOSINT incompletos'
  return (
    <>
      {value ? <span className={s.cellMain}>{value}</span> : <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Sin referencia</span>}
      <span style={{ marginTop: 4, display: 'inline-block' }}><Badge variant="warning">{badgeLabel}</Badge></span>
    </>
  )
}
