import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { CompanyCaptureContext } from '../../components/ui/CompanyCaptureContext'
import { useToast } from '../../components/ui/Toast'
import { cieReferenceError, isCfeCieConvenio, cieReferenceSaveError } from './logic'
import { updateCieInstructions } from './api'
import { ConvenioReceiptUpload } from '../solicitudes/ConvenioReceiptUpload'
import { convenioConceptError } from '../solicitudes/convenio'
import type { PaymentLayoutLine } from './types'
import s from './Layouts.module.css'

export function CieReferenceModal({ line, bankUploadRecorded, onClose, reload }: {
  line: PaymentLayoutLine
  bankUploadRecorded: boolean
  onClose: () => void
  reload: () => Promise<PaymentLayoutLine[]>
}) {
  const { showToast } = useToast()
  const [reference, setReference] = useState(line.payment_reference || '')
  const [concept, setConcept] = useState(line.payment_concept || '')
  const [reading, setReading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isCfe = isCfeCieConvenio(line.convenio_number)
  const validation = cieReferenceError(reference, line.convenio_number) || convenioConceptError(concept)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving || reading) return
    const problem = cieReferenceError(reference, line.convenio_number) || convenioConceptError(concept)
    if (problem) { setError(problem); return }
    if (bankUploadRecorded && !confirmed) { setError('Confirma que el banco rechazó este pago antes de corregirlo.'); return }
    setSaving(true)
    setError('')
    try {
      await updateCieInstructions({ p_line_id: line.id, p_payment_reference: reference.trim(), p_payment_concept: concept.trim(), p_expected_reference: line.payment_reference, p_expected_concept: line.payment_concept, p_bank_rejection_confirmed: confirmed })
      const fresh = await reload()
      const saved = fresh.find(item => item.id === line.id)
      if (saved?.payment_reference !== reference.trim() || saved?.payment_concept !== concept.trim()) throw new Error('Los datos no se confirmaron al recargar. Revisa la línea antes de descargar.')
      showToast('Datos CIE guardados', 'Vuelve a descargar el archivo CIE de este layout para usar la referencia y el concepto corregidos.', 'success')
      onClose()
    } catch (err) {
      const message = cieReferenceSaveError(err)
      setError(message)
      showToast('No se pudo guardar', message, 'error')
    } finally { setSaving(false) }
  }

  return <form onSubmit={save}>
    <Modal headerContext={<CompanyCaptureContext name={line.company_name} />}
      title="Corregir datos CIE"
      subtitle={`${line.request_number || ''} · ${line.beneficiary_name || 'Pago por convenio'}`}
      onClose={() => { if (!saving) onClose() }}
      actions={<><button type="button" className={s.secondaryBtn} disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className={s.primaryBtn} disabled={saving || reading || Boolean(validation) || (bankUploadRecorded && !confirmed)}>{saving ? 'Guardando...' : 'Guardar datos'}</button></>}
    >
      <div className={s.formGrid}>
        <div className={`${s.fullRow} ${s.completionSummary}`}><strong>Convenio {line.convenio_number}</strong><span>Importe autorizado: ${Number(line.amount).toFixed(2)}</span></div>
        <ConvenioReceiptUpload scopeKey={line.id} disabled={saving} onBusyChange={setReading} onRead={data => {
          if (data.convenio?.padStart(7, '0') !== line.convenio_number?.trim().padStart(7, '0')) return 'El convenio del recibo no coincide con esta línea. Selecciona el recibo correcto.'
          if (Number(data.amount) !== Number(line.amount)) return 'El Total a pagar del recibo no coincide con el importe autorizado. Revisa la solicitud.'
          const service = /\b(\d{12})\b/.exec(line.payment_concept || '')?.[1]
            || (/^01\d{18}$/.test(line.payment_reference || '') ? line.payment_reference!.slice(2, 14) : null)
          if (service && data.service && service !== data.service) return 'Este recibo corresponde a otro número de servicio. Selecciona el recibo de esta solicitud.'
          setReference(data.reference); setConcept(data.concept); setError('')
        }} />
        <label className={s.fullRow}>Línea de captura / referencia del recibo
          <input autoFocus type="text" autoComplete="off" spellCheck={false} value={reference} disabled={saving || reading} onChange={e => { setReference(e.target.value); setError('') }} placeholder="Copia la referencia completa del recibo" />
          <span className={s.fieldHint}>{reference.trim().length} / 20 caracteres. {isCfe ? 'CFE exige exactamente 20, sin espacios.' : 'La longitud depende del convenio, hasta 20 caracteres.'}</span>
          <span className={s.fieldHint}>No uses una fecha ni el número de servicio. Conserva los ceros del recibo; no agregues ceros de relleno.</span>
        </label>
        <label className={s.fullRow}>Concepto del pago CIE
          <input type="text" autoComplete="off" spellCheck={false} value={concept} disabled={saving || reading} onChange={e => { setConcept(e.target.value); setError('') }} />
          <span className={s.fieldHint}>{concept.trim().length} / 30 caracteres. Conserva todos los ceros del concepto indicado para pagar.</span>
        </label>
        {bankUploadRecorded && <label className={s.fullRow} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} /><span>Confirmo que el banco rechazó este pago y no lo ejecutó.</span></label>}
        {(error || validation) && <div className={`${s.fullRow} ${s.completionError}`} role="alert">{error || validation}</div>}
      </div>
    </Modal>
  </form>
}
