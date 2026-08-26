import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { todayValue, numberValue } from '../../lib/format'
import { rlsHint } from './logic'
import { saveTicket } from './api'
import type { BudgetCategory, ProviderLite } from './types'
import s from './Efectivo.module.css'

export function TicketModal({
  reconciliationId,
  providers,
  budgetCategories,
  onClose,
  onSaved,
}: {
  reconciliationId: string
  providers: ProviderLite[]
  budgetCategories: BudgetCategory[]
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [concept, setConcept] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayValue())
  const [providerId, setProviderId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const activeProviders = providers.filter((p) => p.activo !== false)
  const activeCategories = budgetCategories.filter((c) => c.active !== false && c.activo !== false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const concpt = concept.trim()
    const amt = numberValue(amount)
    if (!concpt) return showToast('Concepto requerido', 'Captura el concepto del ticket.', 'error')
    if (amt <= 0) return showToast('Monto requerido', 'Captura un monto mayor a cero.', 'error')
    if (!date) return showToast('Fecha requerida', 'Captura la fecha del ticket.', 'error')
    setSaving(true)
    try {
      await saveTicket(
        {
          reconciliation_id: reconciliationId,
          concept: concpt,
          amount: amt,
          ticket_date: date || null,
          proveedor_id: providerId || null,
          budget_category_id: categoryId || null,
          status: 'valid',
        },
        file,
      )
      showToast('Ticket agregado', 'Ticket agregado correctamente.', 'success')
      onSaved()
    } catch (err: any) {
      showToast('No se pudo guardar ticket', err?.message || rlsHint('cash_reconciliation_items', 'insert', err), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title="Nuevo ticket de comprobación"
        subtitle="Registra el gasto comprobado."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar ticket'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label className={s.fullRow}>Concepto *
            <input value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Material, alimento, servicio..." required />
          </label>
          <label>Monto *
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" required />
          </label>
          <label>Fecha ticket *
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label>Proveedor
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Sin proveedor</option>
              {activeProviders.map((p) => (
                <option key={p.id} value={p.id}>{p.alias || p.nombre_completo || p.rfc || 'Proveedor'}</option>
              ))}
            </select>
          </label>
          <label>Partida presupuestal
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin partida</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>{`${c.code ? `${c.code} - ` : ''}${c.name || c.nombre || 'Sin nombre'}`}</option>
              ))}
            </select>
          </label>
          <label className={s.fullRow}>Comprobante (foto o PDF)
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <span className={s.hint}>JPG, PNG, WEBP o PDF · máx. 10 MB</span>
          </label>
        </div>
      </Modal>
    </form>
  )
}
