import { formatMinor } from './logic'
import type { BatchOperation, IndividualReceipt, ReceiptCandidate } from './types'
import s from './Comprobantes.module.css'

export function ReceiptComparison({ operation, receipt, candidate, loading = false, onExpand }: {
  operation: BatchOperation
  receipt: (Pick<IndividualReceipt, 'previewDataUrl'> & Partial<Pick<IndividualReceipt, 'blobUrl'>>) | null
  candidate: ReceiptCandidate | null
  loading?: boolean
  onExpand?: () => void
}) {
  const page = operation.page_number || operation.source_page || 1
  return (
    <div className={s.comparisonGrid}>
      <section className={s.receiptPanel} aria-label={`Comprobante página ${page}`}>
        <div className={s.sectionHeading}>
          <span>Comprobante · página {page}</span>
          {receipt?.blobUrl ? <a href={receipt.blobUrl} target="_blank" rel="noopener noreferrer">Ampliar PDF</a>
            : receipt && onExpand ? <button className="small-btn" onClick={onExpand}>Ampliar PDF</button> : null}
        </div>
        {receipt
          ? <img className={s.receiptImage} src={receipt.previewDataUrl} alt={`Vista del comprobante individual, página ${page}`} />
          : <p className={s.msg}>{loading ? 'Preparando vista del comprobante…' : 'Vista del comprobante no disponible.'}</p>}
      </section>
      <section className={s.comparisonDetails} aria-label="Comparación de comprobante y solicitud">
        <div className={s.sectionHeading}><span>Datos leídos del PDF</span></div>
        <dl className={s.comparisonFacts}>
          <div><dt>Beneficiario</dt><dd>{operation.beneficiary_name || 'Por identificar'}</dd></div>
          <div><dt>Importe del comprobante</dt><dd className={s.comparisonAmount}>{formatMinor(operation.amount_minor, operation.currency || 'MXN')} {operation.currency}</dd></div>
          <div><dt>Fecha de pago</dt><dd>{operation.application_date || operation.operation_date || 'Sin fecha'}</dd></div>
          <div><dt>Referencia bancaria</dt><dd>{operation.bank_unique_folio || operation.bank_reference || 'Sin referencia'}</dd></div>
        </dl>
        {candidate && <div className={s.suggestedRequest}>
          <span className={s.modalEyebrow}>Solicitud propuesta</span>
          <h3>{candidate.request_number || 'Solicitud'}</h3>
          <dl className={s.comparisonFacts}>
            <div><dt>Proveedor</dt><dd>{candidate.proveedor_name || 'Proveedor'}</dd></div>
            <div><dt>Importe de la solicitud</dt><dd className={s.comparisonAmount}>{formatMinor(candidate.amount_minor, candidate.currency || 'MXN')} {candidate.currency}</dd></div>
            {candidate.concept && <div><dt>Concepto</dt><dd>{candidate.concept}</dd></div>}
          </dl>
          <p className={s.matchExplanation}>Importe y moneda coinciden · {candidate.account_match ? 'Cuenta bancaria compatible' : 'Beneficiario compatible'}</p>
        </div>}
      </section>
    </div>
  )
}
