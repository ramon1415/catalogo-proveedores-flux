import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { numberValue } from '../../lib/format'
import { rpcError } from './logic'
import { savePeriod as apiSavePeriod } from './api'
import s from './Ingresos.module.css'

export function PeriodModal({
  profileId,
  onClose,
  onSaved,
}: {
  profileId: string | null
  onClose: () => void
  onSaved: (newPeriodId: string | null) => void
}) {
  const { showToast } = useToast()
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [name, setName] = useState('')
  const [cutoff, setCutoff] = useState('')
  const [totalBudget, setTotalBudget] = useState('')
  const [status, setStatus] = useState('open')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profileId) return showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error')
    const y = Number(year)
    const nm = name.trim()
    const total = numberValue(totalBudget)
    if (!y || !nm || !cutoff) return showToast('Periodo incompleto', 'Captura ano, nombre y fecha corte.', 'warning')
    setSaving(true)
    try {
      const newId = await apiSavePeriod({ year: y, name: nm, cutoff_date: cutoff, total_budget: total, status: status || 'open', created_by: profileId })
      showToast('Periodo creado', 'El periodo de cobro se guardo correctamente.', 'success')
      onSaved(newId)
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Nuevo periodo"
        subtitle="Define corte y presupuesto para generar cuotas."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar periodo'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Ano *
            <input type="number" min="2000" max="2100" value={year} onChange={(e) => setYear(e.target.value)} required />
          </label>
          <label>Fecha corte *
            <input type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} required />
          </label>
          <label className={s.fullRow}>Nombre *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Q2 2026" required />
          </label>
          <label>Presupuesto total *
            <input type="number" min="0" step="0.01" value={totalBudget} onChange={(e) => setTotalBudget(e.target.value)} required />
          </label>
          <label>Estatus
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="open">Abierto</option>
              <option value="closed">Cerrado</option>
              <option value="cancelled">Cancelado</option>
            </select>
          </label>
        </div>
      </Modal>
    </form>
  )
}
