import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { createCashFund, verifyCashBlock } from './api'
import { executionAuthorizationSourceLabel, formatCurrencyC, friendlyError } from './logic'
import type { Profile, RequestSummary, ExecutionContext } from './types'
import s from './Solicitudes.module.css'

// Registrar entrega de efectivo/cheque -> crea el fondo (cash_flow_extension).
export function CashFundModal({
  request,
  context,
  profiles,
  currentProfileId,
  method,
  draft,
  onClose,
  onDone,
}: {
  request: RequestSummary
  context: ExecutionContext
  profiles: Profile[]
  currentProfileId: string | null
  method: string
  draft: { responsible_profile_id?: string; due_date?: string; delivery_method?: string } | null
  onClose: () => void
  onDone: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const [responsibleId, setResponsibleId] = useState(draft?.responsible_profile_id || '')
  const [dueDate, setDueDate] = useState(draft?.due_date || '')
  const [notes, setNotes] = useState('')
  const [blockHint, setBlockHint] = useState('Selecciona quien comprobara este fondo.')
  const [saving, setSaving] = useState(false)
  const deliveryMethod = draft?.delivery_method || method

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
    if (responsibleId) void checkBlock(responsibleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkBlock(profileId: string) {
    if (!profileId) { setBlockHint('Selecciona quien comprobara este fondo.'); return }
    try {
      const result = await verifyCashBlock(profileId)
      if (result?.blocked) setBlockHint(`Responsable con fondos vencidos. Pendiente total: ${formatCurrencyC(result.total_pending || 0)}.`)
      else setBlockHint('El responsable no tiene fondos vencidos pendientes.')
    } catch {
      setBlockHint('No se pudo verificar el bloqueo del responsable.')
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!currentProfileId) { showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error'); return }
    if (!responsibleId) { showToast('Responsable requerido', 'Selecciona el responsable del gasto.', 'error'); return }
    if (!dueDate) { showToast('Fecha requerida', 'Captura la fecha limite de comprobacion.', 'error'); return }
    setSaving(true)
    try {
      await createCashFund({ requestId: request.id, responsibleProfileId: responsibleId, dueDate, deliveryMethod, deliveredBy: currentProfileId, notes: notes.trim() || null })
      showToast('Fondo creado', 'El responsable ya puede comprobar este fondo desde Efectivo y comprobaciones.', 'success')
      onDone()
    } catch (error) {
      showToast('No se pudo crear el fondo', friendlyError(error, 'create_cash_fund'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={s.dialog} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>{method === 'check' ? 'Registrar entrega de cheque' : 'Registrar entrega de efectivo'}</h2>
            <p>Crea el fondo para que el responsable pueda comprobarlo.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.fundSummary} aria-live="polite">
            <div><span>Solicitud</span><strong>{request.requestNumber || 'Solicitud'}</strong></div>
            <div><span>Importe</span><strong>{formatCurrencyC(request.amount)}</strong></div>
            <div><span>Autorizacion</span><strong>{executionAuthorizationSourceLabel(context?.execution_authorization_source)}</strong></div>
          </div>
          <div className={s.formGrid}>
            <label className={s.fullRow}>Responsable del gasto *
              <select className={s.formControl} value={responsibleId} onChange={(e) => { setResponsibleId(e.target.value); void checkBlock(e.target.value) }} required>
                <option value="">Seleccionar responsable</option>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email || 'Usuario'}</option>)}
              </select>
              <span className={s.fieldHint}>{blockHint}</span>
            </label>
            <label>Fecha limite de comprobacion *
              <input className={s.formControl} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </label>
            <label>Metodo de entrega *
              <select className={s.formControl} value={deliveryMethod} disabled>
                <option value="cash">Efectivo</option>
                <option value="check">Cheque</option>
              </select>
            </label>
            <label className={s.fullRow}>Notas
              <textarea className={s.formControl} rows={3} placeholder="Notas de entrega, folio de cheque o comentarios operativos..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Creando fondo...' : 'Crear fondo'}</button>
        </div>
      </form>
    </dialog>
  )
}
