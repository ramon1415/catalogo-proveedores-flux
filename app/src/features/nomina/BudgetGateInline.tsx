import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { formatMoney, friendlyError } from './logic'
import { getPayrollBudgetOptions, setPayrollBudgetContext } from './api'
import type { PayrollBudgetOption, SubmissionSummary } from './types'
import s from './Nomina.module.css'

// Asignación de mes + partida presupuestal DENTRO del modal (antes era la
// pantalla legacy nomina_presupuesto.html). Menos clicks: se resuelve el gate
// sin salir de la captura. Mismos RPCs que payroll_budget_gate.js.

function monthOf(value: string | null | undefined): string {
  const text = String(value || '')
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : new Date().toISOString().slice(0, 7)
}

export function BudgetGateInline({
  requestId,
  summary,
  onUpdated,
}: {
  requestId: string
  summary: SubmissionSummary
  onUpdated: () => Promise<void> | void
}) {
  const { showToast } = useToast()
  const blocked = summary.budget_decision === 'bloqueado'
  const [month, setMonth] = useState(monthOf(summary.budget_month || summary.period_start))
  const [categoryId, setCategoryId] = useState(summary.budget_category_id || '')
  const [options, setOptions] = useState<PayrollBudgetOption[]>([])
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingOptions(true)
    getPayrollBudgetOptions(requestId, month)
      .then((rows) => { if (!cancelled) setOptions(rows) })
      .catch((error) => { if (!cancelled) showToast('No se pudieron cargar las partidas', friendlyError(error), 'error') })
      .finally(() => { if (!cancelled) setLoadingOptions(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId, month])

  const selected = useMemo(() => options.find((o) => o.budget_category_id === categoryId) || null, [options, categoryId])

  async function save() {
    if (!month || !categoryId) return showToast('Falta información', 'Selecciona mes y partida presupuestal.', 'warning')
    setSaving(true)
    try {
      const { status } = await setPayrollBudgetContext(requestId, categoryId, month)
      await onUpdated()
      showToast(
        status === 'aprobable' ? 'Presupuesto aprobable' : 'Presupuesto bloqueado',
        status === 'aprobable' ? 'La nómina ya puede continuar.' : 'La partida no tiene disponible suficiente.',
        status === 'aprobable' ? 'success' : 'warning',
      )
    } catch (error) {
      showToast('No se pudo guardar', friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${s.budgetGate} ${blocked ? s.budgetBlocked : s.budgetPending}`}>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <strong>{blocked ? 'Presupuesto bloqueado' : 'Presupuesto pendiente'}</strong>
          <p>{summary.budget_block_reason || 'Asigna mes y partida presupuestal para continuar.'}</p>
        </div>

        <div className={s.budgetInlineGrid}>
          <label>Mes presupuestal
            <input type="month" value={month} disabled={saving} onChange={(e) => setMonth(e.target.value)} />
          </label>
          <label>Partida
            <select value={categoryId} disabled={saving || loadingOptions} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{loadingOptions ? 'Cargando…' : 'Selecciona partida'}</option>
              {options.map((o) => (
                <option key={o.budget_category_id} value={o.budget_category_id}>
                  {[o.code, o.name].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selected && (
          <div className={s.budgetInlineKpis}>
            <span>Presupuestado <strong>{formatMoney(Number(selected.budgeted ?? 0))}</strong></span>
            <span>Ejecutado <strong>{formatMoney(Number(selected.executed ?? 0))}</strong></span>
            <span>Disponible <strong>{formatMoney(Number(selected.available ?? 0))}</strong></span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className={s.primaryBtn} disabled={saving || !categoryId} onClick={() => void save()}>
            {saving ? 'Validando…' : 'Guardar y validar'}
          </button>
        </div>
      </div>
    </div>
  )
}
