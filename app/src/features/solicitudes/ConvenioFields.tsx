import { cieReferenceError, isCfeCieConvenio } from '../layouts/logic'
import { convenioConceptError } from './convenio'
import type { Proveedor } from './types'
import s from './Solicitudes.module.css'

export function ConvenioFields({ provider, reference, concept, onReference, onConcept, disabled }: {
  disabled?: boolean
  provider: Proveedor | null
  reference: string
  concept: string
  onReference: (value: string) => void
  onConcept: (value: string) => void
}) {
  const referenceError = reference ? cieReferenceError(reference, provider?.convenio_number) : null
  const conceptError = concept ? convenioConceptError(concept) : null
  return (
    <section className={s.formSection}>
      <h3>Datos del convenio BBVA CIE</h3>
      <p className={s.fieldHint}>Copia los datos de este recibo. La referencia y el concepto se guardan por solicitud y se incluyen en el layout CIE.</p>
      <div className={s.formGrid}>
        <label className={s.fullRow}>Número de convenio
          <input className={s.formControl} type="text" value={provider?.convenio_number || ''} readOnly placeholder="Selecciona el proveedor" />
          <span className={s.fieldHint}>Registrado en Proveedores. Si falta o es incorrecto, Finanzas debe actualizarlo antes de solicitar el pago.</span>
        </label>
        <label className={s.fullRow}>Referencia / línea de captura *
          <input className={s.formControl} type="text" autoComplete="off" spellCheck={false} value={reference}
            onChange={(e) => onReference(e.target.value)} required disabled={!provider || disabled} aria-invalid={!!referenceError} aria-describedby="cie-reference-hint" />
          <span id="cie-reference-hint" className={`${s.fieldHint} ${referenceError ? s.error : ''}`}>
            {referenceError || `${reference.trim().length}/20 caracteres${isCfeCieConvenio(provider?.convenio_number) ? ' · CFE requiere exactamente 20, sin espacios.' : ' como máximo. Conserva los ceros iniciales.'}`}
          </span>
        </label>
        <label className={s.fullRow}>Concepto del pago CIE *
          <input className={s.formControl} type="text" autoComplete="off" spellCheck={false} value={concept}
            onChange={(e) => onConcept(e.target.value)} required disabled={!provider || disabled} aria-invalid={!!conceptError} aria-describedby="cie-concept-hint" />
          <span id="cie-concept-hint" className={`${s.fieldHint} ${conceptError ? s.error : ''}`}>
            {conceptError || `${concept.trim().length}/30 caracteres · Usa el concepto indicado para pagar el recibo; conserva sus ceros iniciales.`}
          </span>
        </label>
        <p className={`${s.fieldHint} ${s.fullRow}`}>Referencia y concepto son campos separados. No unas el código de barras completo ni uses la descripción interna como sustituto.</p>
      </div>
    </section>
  )
}
