import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { CompanyCaptureContext } from '../../components/ui/CompanyCaptureContext'
import { useToast } from '../../components/ui/Toast'
import { cieReferenceError, isCfeCieConvenio, cieReferenceSaveError } from './logic'
import { updateCieReference } from './api'
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
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isCfe = isCfeCieConvenio(line.convenio_number)
  const validation = cieReferenceError(reference, line.convenio_number)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const problem = cieReferenceError(reference, line.convenio_number)
    if (problem) { setError(problem); return }
    if (bankUploadRecorded && !confirmed) { setError('Confirma que el banco rechazó este pago antes de corregirlo.'); return }
    setSaving(true)
    setError('')
    try {
      await updateCieReference({ p_line_id: line.id, p_payment_reference: reference.trim(), p_expected_reference: line.payment_reference, p_bank_rejection_confirmed: confirmed })
      const fresh = await reload()
      if (fresh.find(item => item.id === line.id)?.payment_reference !== reference.trim()) throw new Error('La referencia no se confirmó al recargar. Revisa la línea antes de descargar.')
      showToast('Referencia CIE guardada', 'Vuelve a descargar el archivo CIE de este layout para usar la referencia corregida.', 'success')
      onClose()
    } catch (err) {
      const message = cieReferenceSaveError(err)
      setError(message)
      showToast('No se pudo guardar', message, 'error')
    } finally { setSaving(false) }
  }

  return <form onSubmit={save}>
    <Modal headerContext={<CompanyCaptureContext name={line.company_name} />}
      title="Corregir referencia CIE"
      subtitle={`${line.request_number || ''} · ${line.beneficiary_name || 'Pago por convenio'}`}
      onClose={() => { if (!saving) onClose() }}
      actions={<><button type="button" className={s.secondaryBtn} disabled={saving} onClick={onClose}>Cancelar</button><button type="submit" className={s.primaryBtn} disabled={saving || Boolean(validation) || (bankUploadRecorded && !confirmed)}>{saving ? 'Guardando...' : 'Guardar referencia'}</button></>}
    >
      <div className={s.formGrid}>
        <div className={`${s.fullRow} ${s.completionSummary}`}><strong>Convenio {line.convenio_number}</strong><span>{line.payment_concept}</span></div>
        <label className={s.fullRow}>Línea de captura / referencia del recibo
          <input autoFocus type="text" autoComplete="off" spellCheck={false} value={reference} disabled={saving} onChange={e => { setReference(e.target.value); setError('') }} placeholder="Copia la referencia completa del recibo" />
          <span className={s.fieldHint}>{reference.trim().length} / 20 caracteres. {isCfe ? 'CFE exige exactamente 20, sin espacios.' : 'La longitud depende del convenio, hasta 20 caracteres.'}</span>
          <span className={s.fieldHint}>No uses una fecha ni el número de servicio. Conserva los ceros del recibo; no agregues ceros de relleno.</span>
        </label>
        {bankUploadRecorded && <label className={s.fullRow} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><input type="checkbox" style={{ width: 'auto', flexShrink: 0 }} checked={confirmed} disabled={saving} onChange={e => setConfirmed(e.target.checked)} /><span>Confirmo que el banco rechazó este pago y no lo ejecutó.</span></label>}
        {(error || validation) && <div className={`${s.fullRow} ${s.completionError}`} role="alert">{error || validation}</div>}
      </div>
    </Modal>
  </form>
}
