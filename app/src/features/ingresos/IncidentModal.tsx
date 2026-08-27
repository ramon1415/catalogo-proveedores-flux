import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { numberValue, todayValue } from '../../lib/format'
import { activeMembers, activeCompanies, costCentersForCompany, rpcError } from './logic'
import type { Lookups } from './logic'
import { createIncident } from './api'
import type { IngresosData } from './types'
import s from './Ingresos.module.css'

export function IncidentModal({
  data,
  lookups,
  profileId,
  activeCompanyId,
  allowedCompanyIds,
  onClose,
  onSaved,
}: {
  data: IngresosData
  lookups: Lookups
  profileId: string | null
  activeCompanyId: string | null
  allowedCompanyIds: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [receiverType, setReceiverType] = useState<'member' | 'external'>('member')
  const [memberId, setMemberId] = useState('')
  const [externalName, setExternalName] = useState('')
  const [externalRfc, setExternalRfc] = useState('')
  const [referredBy, setReferredBy] = useState('')
  const [companyId, setCompanyId] = useState(activeCompanyId || '')
  const [costCenterId, setCostCenterId] = useState('')
  const [budgetCategoryId, setBudgetCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayValue())
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const members = activeMembers(data)
  const allowed = new Set(allowedCompanyIds)
  const companies = activeCompanies(data).filter((company) => company.id === activeCompanyId && allowed.has(company.id))
  const costCenters = costCentersForCompany(data, companyId)
  const isMember = receiverType === 'member'

  function onCompanyChange(value: string) {
    setCompanyId(value)
    setCostCenterId('') // fillCostCenters reinicia el select a "Sin centro"
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!profileId) return showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error')
    const mId = isMember ? memberId.trim() || null : null
    const ext = !isMember ? externalName.trim() : null
    const amt = numberValue(amount)
    const desc = description.trim()
    if (isMember && !mId) return showToast('Selecciona socio', 'Selecciona el socio receptor.', 'warning')
    if (!isMember && !ext) return showToast('Captura externo', 'Captura el nombre del receptor externo.', 'warning')
    if (!desc) return showToast('Descripcion requerida', 'Captura descripcion.', 'warning')
    if (!amt || amt <= 0) return showToast('Monto invalido', 'El monto debe ser mayor a cero.', 'warning')
    if (!date) return showToast('Fecha requerida', 'Captura fecha.', 'warning')
    setSaving(true)
    try {
      const result = await createIncident({
        memberId: mId,
        externalName: ext,
        externalRfc: !isMember ? externalRfc.trim() || null : null,
        referredByMemberId: referredBy.trim() || null,
        companyId: companyId.trim() || null,
        costCenterId: costCenterId.trim() || null,
        budgetCategoryId: budgetCategoryId.trim() || null,
        description: desc,
        amount: amt,
        incidentDate: date,
        registeredBy: profileId,
        notes: notes.trim() || null,
      })
      showToast('Incidencia creada', result?.message || 'Incidencia creada correctamente.', 'success')
      onSaved()
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Nueva incidencia"
        subtitle="Registra un cargo recuperable a socio o externo."
        size="lg"
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Creando...' : 'Crear incidencia'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Tipo receptor *
            <select value={receiverType} onChange={(e) => setReceiverType(e.target.value as 'member' | 'external')} required>
              <option value="member">Socio</option>
              <option value="external">Externo</option>
            </select>
          </label>
          {isMember && (
            <label>Socio *
              <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Seleccionar socio</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </label>
          )}
          {!isMember && (
            <label>Nombre externo *
              <input value={externalName} onChange={(e) => setExternalName(e.target.value)} />
            </label>
          )}
          {!isMember && (
            <label>RFC externo
              <input value={externalRfc} onChange={(e) => setExternalRfc(e.target.value)} />
            </label>
          )}
          <label>Referido por socio
            <select value={referredBy} onChange={(e) => setReferredBy(e.target.value)}>
              <option value="">Sin referidor</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
            </select>
          </label>
          <label>Empresa
            <select value={companyId} onChange={(e) => onCompanyChange(e.target.value)} disabled={Boolean(activeCompanyId)}>
              {!activeCompanyId && <option value="">Sin empresa activa</option>}
              {companies.map((c) => <option key={c.id} value={c.id}>{lookups.companyName(c.id)}</option>)}
            </select>
          </label>
          <label>Centro de costo
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
              <option value="">Sin centro</option>
              {costCenters.map((c) => <option key={c.id} value={c.id}>{lookups.centerLabel(c)}</option>)}
            </select>
          </label>
          <label>Partida
            <select value={budgetCategoryId} onChange={(e) => setBudgetCategoryId(e.target.value)}>
              <option value="">Sin partida</option>
              {data.categories.map((c) => <option key={c.id} value={c.id}>{lookups.catLabel(c)}</option>)}
            </select>
          </label>
          <label>Monto *
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>Fecha *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className={s.fullRow}>Descripcion *
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} required />
          </label>
          <label className={s.fullRow}>Notas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </Modal>
    </form>
  )
}
