import { useEffect, useRef, useState } from 'react'
import type { Member, MemberPayload } from './types'
import { friendlyError } from './logic'
import { saveMember } from './api'
import s from './Configuracion.module.css'

type FormState = {
  full_name: string
  rfc: string
  lineage: string
  fee_factor: string
  email: string
  phone: string
  notes: string
  active: boolean
}

const EMPTY: FormState = {
  full_name: '',
  rfc: '',
  lineage: '',
  fee_factor: '1',
  email: '',
  phone: '',
  notes: '',
  active: true,
}

function nn(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

export function MemberModal({
  member,
  onClose,
  onSaved,
}: {
  member: Member | null
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [f, setF] = useState<FormState>(EMPTY)
  const [error, setError] = useState('')

  const isEdit = Boolean(member)

  useEffect(() => {
    if (member) {
      setF({
        full_name: member.full_name ?? '',
        rfc: member.rfc ?? '',
        lineage: member.lineage ?? '',
        fee_factor: String(member.fee_factor || 1),
        email: member.email ?? '',
        phone: member.phone ?? '',
        notes: member.notes ?? '',
        active: member.active !== false,
      })
    } else {
      setF(EMPTY)
    }
    setError('')
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload: MemberPayload = {
      full_name: nn(f.full_name),
      rfc: nn(f.rfc),
      lineage: nn(f.lineage),
      fee_factor: Number(nn(f.fee_factor)) || 1,
      email: nn(f.email),
      phone: nn(f.phone),
      notes: nn(f.notes),
      active: f.active,
    }
    if (!payload.full_name) {
      setError('El nombre completo es obligatorio.')
      return
    }
    setError('')
    try {
      await saveMember(member?.id ?? null, payload)
      onSaved()
    } catch (err: any) {
      setError(friendlyError(err))
    }
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>{isEdit ? 'Editar socio' : 'Nuevo socio'}</h2>
            <p>El factor define la proporcion con la que participa en cuotas de mantenimiento.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <label className={s.fullRow}>Nombre completo *
              <input value={f.full_name} onChange={(e) => set('full_name', e.target.value)} required />
            </label>
            <label>RFC
              <input value={f.rfc} onChange={(e) => set('rfc', e.target.value)} />
            </label>
            <label>Estirpe
              <select value={f.lineage} onChange={(e) => set('lineage', e.target.value)}>
                <option value="">Sin estirpe</option>
                <option value="SNR">SNR</option>
                <option value="SNM">SNM</option>
                <option value="PSN">PSN</option>
                <option value="CSN">CSN</option>
                <option value="FSN">FSN</option>
              </select>
            </label>
            <label>Factor de participacion *
              <input type="number" min="0.0001" step="any" value={f.fee_factor} onChange={(e) => set('fee_factor', e.target.value)} required />
            </label>
            <label>Correo
              <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
            </label>
            <label>Telefono
              <input value={f.phone} onChange={(e) => set('phone', e.target.value)} />
            </label>
            <label className={s.fullRow}>Notas
              <textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </label>
            <label className={s.checkLabel}>
              <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Activo
            </label>
          </div>
          {error && <div className={s.formMsg}>{error}</div>}
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn}>Guardar socio</button>
        </div>
      </form>
    </dialog>
  )
}
