// Diálogo "Crear corte semanal" (espejo de createBatchDialog + createBatch del vanilla).
import { useMemo, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { createApprovalBatch } from './api'
import { defaultPeriod, eligibleDirectorsForCompany, friendlyError } from './logic'
import type { Company, DirectorRow } from './types'
import s from './Cortes.module.css'

export function CreateBatchDialog({
  companies,
  directors,
  onClose,
  onCreated,
}: {
  companies: Company[]
  directors: DirectorRow[]
  onClose: () => void
  // Recibe el batch_id creado para seleccionarlo tras recargar la lista.
  onCreated: (batchId: string | null) => Promise<void>
}) {
  const period = useMemo(defaultPeriod, [])
  const [companyId, setCompanyId] = useState('')
  const [directorId, setDirectorId] = useState('')
  const [periodStart, setPeriodStart] = useState(period.start)
  const [periodEnd, setPeriodEnd] = useState(period.end)
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const { showToast } = useToast()

  // Solo directores activos y elegibles de la empresa elegida (fillCreateDirectors).
  const directorRows = useMemo(() => eligibleDirectorsForCompany(directors, companyId), [directors, companyId])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const data = await createApprovalBatch({
        companyId,
        label: label.trim() || null,
        periodStart,
        periodEnd,
        directorId,
        notes: notes.trim() || null,
      })
      showToast('Corte creado', data?.label || 'El corte quedo en borrador.', 'success')
      await onCreated(data?.batch_id || null)
      onClose()
    } catch (error) {
      showToast('No se pudo crear', friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Crear corte semanal" subtitle="Nuevo corte para decision de Direccion." onClose={onClose}>
      <form onSubmit={submit}>
        <div className={s.modalGrid}>
          <label>
            Empresa
            <select
              className={s.field}
              required
              value={companyId}
              onChange={(e) => { setCompanyId(e.target.value); setDirectorId('') }}
            >
              <option value="">Selecciona...</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.legal_name || company.name}</option>
              ))}
            </select>
          </label>
          <label>
            Director
            <select className={s.field} required value={directorId} onChange={(e) => setDirectorId(e.target.value)}>
              <option value="">Selecciona...</option>
              {directorRows.map((row) => (
                <option key={row.director_profile_id} value={row.director_profile_id}>
                  {row.director_name || row.director_email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Inicio
            <input className={s.field} type="date" required value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </label>
          <label>
            Fin
            <input className={s.field} type="date" required value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </label>
          <label className={s.full}>
            Nombre
            <input className={s.field} placeholder="Corte Operadora 2026-W28" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label className={s.full}>
            Notas
            <textarea className={s.field} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>Crear corte</button>
        </div>
      </form>
    </Modal>
  )
}
