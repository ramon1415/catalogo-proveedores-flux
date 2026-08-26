import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { numberValue } from '../../lib/format'
import { LINEAGES, rpcError } from './logic'
import { saveMember as apiSaveMember } from './api'
import type { Member } from './types'
import s from './Ingresos.module.css'

export function MemberModal({
  member,
  onClose,
  onSaved,
}: {
  member: Member | null // null = nuevo
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const editing = Boolean(member)
  const [fullName, setFullName] = useState(member?.full_name || '')
  const [rfc, setRfc] = useState(member?.rfc || '')
  const [lineage, setLineage] = useState(member?.lineage || '')
  const [feeFactor, setFeeFactor] = useState(editing ? String(member?.fee_factor ?? 1) : '1')
  const [email, setEmail] = useState(member?.email || '')
  const [phone, setPhone] = useState(member?.phone || '')
  const [notes, setNotes] = useState(member?.notes || '')
  const [active, setActive] = useState(member ? member.active !== false : true)
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const name = fullName.trim()
    const fee = numberValue(feeFactor)
    const lin = lineage.trim() || null
    if (!name) return showToast('Falta nombre', 'Captura el nombre completo del socio.', 'warning')
    if (!fee || fee <= 0) return showToast('Factor invalido', 'El factor de cuota debe ser mayor a cero.', 'warning')
    setSaving(true)
    try {
      await apiSaveMember(
        {
          full_name: name,
          rfc: rfc.trim() || null,
          lineage: lin,
          fee_factor: fee,
          email: email.trim() || null,
          phone: phone.trim() || null,
          notes: notes.trim() || null,
          active,
          updated_at: new Date().toISOString(),
        },
        member?.id ?? null,
      )
      showToast('Socio guardado', 'El socio se guardo correctamente.', 'success')
      onSaved()
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title={editing ? 'Editar socio' : 'Nuevo socio'}
        subtitle="Registra datos base del socio y su factor de cuota."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar socio'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label className={s.fullRow}>Nombre completo *
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>
          <label>RFC
            <input value={rfc} onChange={(e) => setRfc(e.target.value)} />
          </label>
          <label>Estirpe
            <select value={lineage} onChange={(e) => setLineage(e.target.value)}>
              <option value="">Sin estirpe</option>
              {LINEAGES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          <label>Factor cuota *
            <input type="number" min="0.0001" step="0.001" value={feeFactor} onChange={(e) => setFeeFactor(e.target.value)} required />
          </label>
          <label>Correo
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>Telefono
            <input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className={s.fullRow}>Notas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className={`${s.fullRow} ${s.checkLabel}`}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo
          </label>
        </div>
      </Modal>
    </form>
  )
}
