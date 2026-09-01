import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency } from '../../lib/format'
import s from './Ingresos.module.css'

type Template = {
  id: string
  company_id: string
  payer_name: string
  concept: string
  amount: number
  currency: string
  active: boolean
}
type Entry = {
  id: string
  template_id: string | null
  period: string | null
  payer_name: string
  concept: string
  amount: number
  currency: string
  status: 'pendiente' | 'cobrado' | 'cancelado'
  received_at: string | null
  source: 'manual' | 'recurring'
}

function currentPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

const STATUS_VARIANT: Record<Entry['status'], 'success' | 'warning' | 'danger'> = {
  cobrado: 'success',
  pendiente: 'warning',
  cancelado: 'danger',
}

const emptyTpl = { payer_name: '', concept: '', amount: '', currency: 'MXN' }
const emptyEntry = { payer_name: '', concept: '', amount: '', currency: 'MXN', received_at: '' }

export default function TenantIncomePanel() {
  const { companyId, companyName } = useCompany()
  const { showToast } = useToast()

  const [templates, setTemplates] = useState<Template[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [period, setPeriod] = useState(currentPeriod())
  const [busy, setBusy] = useState(false)
  const [tplForm, setTplForm] = useState(emptyTpl)
  const [entryForm, setEntryForm] = useState(emptyEntry)
  const [showTpl, setShowTpl] = useState(false)
  const [showEntry, setShowEntry] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    setStatus('loading')
    try {
      const [t, e] = await Promise.all([
        supabase.from('recurring_income_templates').select('*').eq('company_id', companyId).order('created_at', { ascending: true }),
        supabase.from('tenant_income_entries').select('*').eq('company_id', companyId).order('period', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }),
      ])
      if (t.error) throw t.error
      if (e.error) throw e.error
      setTemplates((t.data ?? []) as Template[])
      setEntries((e.data ?? []) as Entry[])
      setStatus('ready')
    } catch (err) {
      setStatus('error')
      showToast('No se pudo cargar', err instanceof Error ? err.message : 'Error inesperado', 'error')
    }
  }, [companyId, showToast])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    const inPeriod = entries.filter((e) => e.period === period)
    const sum = (arr: Entry[]) => arr.reduce((a, e) => a + Number(e.amount || 0), 0)
    return {
      recurringMonthly: templates.filter((t) => t.active).reduce((a, t) => a + Number(t.amount || 0), 0),
      periodTotal: sum(inPeriod),
      periodCobrado: sum(inPeriod.filter((e) => e.status === 'cobrado')),
      periodPendiente: sum(inPeriod.filter((e) => e.status === 'pendiente')),
    }
  }, [templates, entries, period])

  async function addTemplate() {
    const amount = Number(tplForm.amount)
    if (!tplForm.payer_name.trim() || !tplForm.concept.trim() || !(amount > 0)) {
      return showToast('Faltan datos', 'Captura pagador, concepto y un monto mayor a 0.', 'warning')
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('recurring_income_templates').insert({
        company_id: companyId, payer_name: tplForm.payer_name.trim(), concept: tplForm.concept.trim(),
        amount, currency: tplForm.currency,
      })
      if (error) throw error
      setTplForm(emptyTpl); setShowTpl(false)
      showToast('Plantilla creada', 'Ingreso recurrente agregado.', 'success')
      await load()
    } catch (err) {
      showToast('No se pudo guardar', err instanceof Error ? err.message : 'Error', 'error')
    } finally { setBusy(false) }
  }

  async function toggleTemplate(t: Template) {
    setBusy(true)
    try {
      const { error } = await supabase.from('recurring_income_templates').update({ active: !t.active }).eq('id', t.id)
      if (error) throw error
      await load()
    } catch (err) {
      showToast('No se pudo actualizar', err instanceof Error ? err.message : 'Error', 'error')
    } finally { setBusy(false) }
  }

  async function generate() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('generate_recurring_income', { p_company_id: companyId, p_period: period })
      if (error) throw error
      const n = Number(data ?? 0)
      showToast('Generación lista', n > 0 ? `${n} ingreso(s) recurrente(s) generado(s) para ${period}.` : `Sin nuevos: ${period} ya estaba generado.`, n > 0 ? 'success' : 'warning')
      await load()
    } catch (err) {
      showToast('No se pudo generar', err instanceof Error ? err.message : 'Error', 'error')
    } finally { setBusy(false) }
  }

  async function addEntry() {
    const amount = Number(entryForm.amount)
    if (!entryForm.payer_name.trim() || !entryForm.concept.trim() || !(amount > 0)) {
      return showToast('Faltan datos', 'Captura pagador, concepto y un monto mayor a 0.', 'warning')
    }
    setBusy(true)
    try {
      const { error } = await supabase.from('tenant_income_entries').insert({
        company_id: companyId, template_id: null, period,
        payer_name: entryForm.payer_name.trim(), concept: entryForm.concept.trim(),
        amount, currency: entryForm.currency, source: 'manual',
        received_at: entryForm.received_at || null,
        status: entryForm.received_at ? 'cobrado' : 'pendiente',
      })
      if (error) throw error
      setEntryForm(emptyEntry); setShowEntry(false)
      showToast('Ingreso agregado', 'Ingreso suelto registrado.', 'success')
      await load()
    } catch (err) {
      showToast('No se pudo guardar', err instanceof Error ? err.message : 'Error', 'error')
    } finally { setBusy(false) }
  }

  async function markCobrado(e: Entry) {
    setBusy(true)
    try {
      const { error } = await supabase.from('tenant_income_entries').update({ status: 'cobrado', received_at: e.received_at || today() }).eq('id', e.id)
      if (error) throw error
      await load()
    } catch (err) {
      showToast('No se pudo actualizar', err instanceof Error ? err.message : 'Error', 'error')
    } finally { setBusy(false) }
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Ingresos</h1>
          <p className="muted">{companyName ?? 'Empresa'} · ingresos fijos recurrentes y sueltos.</p>
        </div>
      </div>

      <div className={s.statsGrid}>
        <div className={s.statCard}><span className="muted">Recurrente / mes</span><strong>{formatCurrency(totals.recurringMonthly)}</strong></div>
        <div className={s.statCard}><span className="muted">Total {period}</span><strong>{formatCurrency(totals.periodTotal)}</strong></div>
        <div className={s.statCard}><span className="muted">Cobrado {period}</span><strong>{formatCurrency(totals.periodCobrado)}</strong></div>
        <div className={s.statCard}><span className="muted">Pendiente {period}</span><strong>{formatCurrency(totals.periodPendiente)}</strong></div>
      </div>

      {/* Ingresos recurrentes (plantillas) */}
      <section className={s.tableCard}>
        <div className={s.panelHeader}>
          <div>
            <h2>Ingresos recurrentes</h2>
            <p className="muted">Rentas fijas y otros ingresos que se repiten cada mes.</p>
          </div>
          <div className={s.rowActions}>
            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Periodo
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </label>
            <button className={s.secondaryBtn} disabled={busy || templates.filter((t) => t.active).length === 0} onClick={generate}>Generar mes</button>
            <button className={s.primaryBtn} disabled={busy} onClick={() => setShowTpl((v) => !v)}>{showTpl ? 'Cancelar' : 'Agregar recurrente'}</button>
          </div>
        </div>

        {showTpl && (
          <div className={s.formGrid} style={{ padding: '12px 16px' }}>
            <input placeholder="Pagador (ej. Operadora Tlacatecpan)" value={tplForm.payer_name} onChange={(e) => setTplForm({ ...tplForm, payer_name: e.target.value })} />
            <input placeholder="Concepto (ej. Renta interco)" value={tplForm.concept} onChange={(e) => setTplForm({ ...tplForm, concept: e.target.value })} />
            <input type="number" placeholder="Monto" value={tplForm.amount} onChange={(e) => setTplForm({ ...tplForm, amount: e.target.value })} />
            <select value={tplForm.currency} onChange={(e) => setTplForm({ ...tplForm, currency: e.target.value })}>
              <option value="MXN">MXN</option><option value="USD">USD</option>
            </select>
            <button className={s.primaryBtn} disabled={busy} onClick={addTemplate}>Guardar</button>
          </div>
        )}

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Pagador</th><th>Concepto</th><th>Monto</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={5} className={s.tableMsg}>Cargando…</td></tr>}
              {status === 'ready' && templates.length === 0 && <tr><td colSpan={5} className={s.tableMsg}>Sin ingresos recurrentes. Agrega el primero.</td></tr>}
              {templates.map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                  <td>{t.payer_name}</td>
                  <td>{t.concept}</td>
                  <td>{formatCurrency(Number(t.amount))}</td>
                  <td><Badge variant={t.active ? 'success' : 'danger'}>{t.active ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td><button className={s.smallBtn} disabled={busy} onClick={() => toggleTemplate(t)}>{t.active ? 'Desactivar' : 'Activar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Movimientos (entries) */}
      <section className={s.tableCard}>
        <div className={s.panelHeader}>
          <div>
            <h2>Movimientos</h2>
            <p className="muted">Ingresos generados del mes + ingresos sueltos (no periódicos).</p>
          </div>
          <button className={s.primaryBtn} disabled={busy} onClick={() => setShowEntry((v) => !v)}>{showEntry ? 'Cancelar' : 'Agregar ingreso suelto'}</button>
        </div>

        {showEntry && (
          <div className={s.formGrid} style={{ padding: '12px 16px' }}>
            <input placeholder="Pagador" value={entryForm.payer_name} onChange={(e) => setEntryForm({ ...entryForm, payer_name: e.target.value })} />
            <input placeholder="Concepto" value={entryForm.concept} onChange={(e) => setEntryForm({ ...entryForm, concept: e.target.value })} />
            <input type="number" placeholder="Monto" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })} />
            <select value={entryForm.currency} onChange={(e) => setEntryForm({ ...entryForm, currency: e.target.value })}>
              <option value="MXN">MXN</option><option value="USD">USD</option>
            </select>
            <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Recibido<input type="date" value={entryForm.received_at} onChange={(e) => setEntryForm({ ...entryForm, received_at: e.target.value })} /></label>
            <button className={s.primaryBtn} disabled={busy} onClick={addEntry}>Guardar</button>
          </div>
        )}

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Periodo</th><th>Pagador</th><th>Concepto</th><th>Monto</th><th>Origen</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={7} className={s.tableMsg}>Cargando…</td></tr>}
              {status === 'error' && <tr><td colSpan={7} className={s.tableMsg}>No se pudieron cargar los movimientos.</td></tr>}
              {status === 'ready' && entries.length === 0 && <tr><td colSpan={7} className={s.tableMsg}>Sin movimientos. Genera el mes o agrega un ingreso suelto.</td></tr>}
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.period ?? '—'}</td>
                  <td>{e.payer_name}</td>
                  <td>{e.concept}</td>
                  <td>{formatCurrency(Number(e.amount))}</td>
                  <td><Badge variant={e.source === 'recurring' ? 'accent' : 'neutral'}>{e.source === 'recurring' ? 'Recurrente' : 'Suelto'}</Badge></td>
                  <td><Badge variant={STATUS_VARIANT[e.status]}>{e.status}</Badge></td>
                  <td>{e.status === 'pendiente' && <button className={s.smallBtn} disabled={busy} onClick={() => markCobrado(e)}>Marcar cobrado</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
