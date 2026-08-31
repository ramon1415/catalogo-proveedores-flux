import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import {
  cxcDigits, cleanText, normalizeCxcText, formatBbvaReference, pagosintSaveHint,
  BBVA_INTERBANK_REFERENCE_LENGTH,
} from './logic'
import { updatePagosintReference } from './api'
import type { PaymentLayoutLine } from './types'
import s from './Layouts.module.css'

export function PagosintReferenceModal({
  line,
  onClose,
  onAfterSave,
}: {
  line: PaymentLayoutLine
  onClose: () => void
  // Recarga layouts + relee líneas y devuelve las líneas frescas para verificar persistencia.
  onAfterSave: (referenceDigits: string) => Promise<PaymentLayoutLine[]>
}) {
  const { showToast } = useToast()
  const [reference, setReference] = useState(cxcDigits(line.payment_reference))
  const [beneficiary, setBeneficiary] = useState(line.beneficiary_name || '')
  const [concept, setConcept] = useState(line.payment_concept || '')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const referenceDigits = cxcDigits(reference)
    const beneficiaryValue = cleanText(beneficiary)
    const conceptValue = cleanText(concept)

    if (!referenceDigits) {
      showToast('Referencia requerida', 'Captura una referencia numerica de 1 a 5 digitos para PAGOSINT.', 'warning')
      return
    }
    if (referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH) {
      showToast('Referencia invalida', 'La referencia PAGOSINT acepta maximo 5 digitos.', 'warning')
      return
    }
    if (!beneficiaryValue || !normalizeCxcText(beneficiaryValue)) {
      showToast('Titular requerido', 'Captura titular o beneficiario para PAGOSINT.', 'warning')
      return
    }
    if (!conceptValue || !normalizeCxcText(conceptValue)) {
      showToast('Motivo requerido', 'Captura motivo de pago para PAGOSINT.', 'warning')
      return
    }

    setSaving(true)
    try {
      const data = await updatePagosintReference({
        p_line_id: line.id,
        p_payment_reference: referenceDigits,
        p_beneficiary_name: beneficiaryValue,
        p_payment_concept: conceptValue,
      })
      const persistedLine = Array.isArray(data) ? data[0] : data
      const persistedReference = cxcDigits(persistedLine?.payment_reference)
      if (persistedReference !== referenceDigits) {
        throw new Error('La referencia no quedo persistida en payment_layout_lines.payment_reference.')
      }

      const refreshedLines = await onAfterSave(referenceDigits)
      const refreshedLine = refreshedLines.find((item) => item.id === line.id)
      const refreshedReference = cxcDigits(refreshedLine?.payment_reference)
      if (refreshedReference !== referenceDigits) {
        throw new Error('La referencia no reaparecio despues de refrescar la linea del layout.')
      }
      showToast('Referencia guardada', `PAGOSINT usara ${formatBbvaReference(referenceDigits)} en las posiciones 86-90.`, 'success')
      onClose()
    } catch (error) {
      showToast('No se pudo guardar', pagosintSaveHint(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title={`Completar referencia ${line.request_number || ''}`.trim()}
        subtitle="Completa los datos faltantes de la linea para generar el archivo interbancario."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar referencia'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Referencia numerica *
            <input
              type="text" inputMode="numeric" pattern="[0-9]{1,5}" maxLength={5}
              value={reference} onChange={(e) => setReference(e.target.value)}
              placeholder="Ej. 7, 42, 40002" required
            />
            <span className={s.fieldHint}>Captura de 1 a 5 digitos. El TXT completa con ceros a la izquierda.</span>
          </label>
          <label className={s.fullRow}>Titular / beneficiario
            <input type="text" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="Titular para PAGOSINT" />
          </label>
          <label className={s.fullRow}>Motivo de pago
            <input type="text" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Motivo para PAGOSINT" />
          </label>
        </div>
      </Modal>
    </form>
  )
}
