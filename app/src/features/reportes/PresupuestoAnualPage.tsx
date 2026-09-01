import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useCompany } from '../../lib/company'
import { formatCurrency } from '../../lib/format'
import s from './Reportes.module.css'

// Reporte read-only: presupuesto del AÑO vs comprometido acumulado, por partida.
// El gate de aprobación sigue siendo mensual; esto es solo seguimiento anual.
type Row = { budget_category_id: string; budgeted: number; committed: number; available: number; budget_month: string }
type Cat = { id: string; name: string | null; code: string | null }

const YEAR = new Date().getFullYear()

export default function PresupuestoAnualPage() {
  const { companyId, companyName } = useCompany()
  const [rows, setRows] = useState<Row[]>([])
  const [cats, setCats] = useState<Map<string, Cat>>(new Map())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!companyId) return
    let active = true
    ;(async () => {
      setStatus('loading')
      try {
        const [av, bc] = await Promise.all([
          supabase.from('budget_availability').select('budget_category_id,budgeted,committed,available,budget_month').eq('company_id', companyId),
          supabase.from('budget_categories').select('id,name,code'),
        ])
        if (av.error) throw av.error
        if (bc.error) throw bc.error
        if (!active) return
        setRows(((av.data ?? []) as Row[]).filter((r) => String(r.budget_month || '').startsWith(String(YEAR))))
        setCats(new Map(((bc.data ?? []) as Cat[]).map((c) => [c.id, c])))
        setStatus('ready')
      } catch (e) {
        if (!active) return
        setErr(e instanceof Error ? e.message : 'Error inesperado')
        setStatus('error')
      }
    })()
    return () => { active = false }
  }, [companyId])

  const agg = useMemo(() => {
    const m = new Map<string, { budgeted: number; committed: number; available: number }>()
    for (const r of rows) {
      const a = m.get(r.budget_category_id) ?? { budgeted: 0, committed: 0, available: 0 }
      a.budgeted += Number(r.budgeted || 0)
      a.committed += Number(r.committed || 0)
      a.available += Number(r.available || 0)
      m.set(r.budget_category_id, a)
    }
    const list = [...m.entries()]
      .map(([id, v]) => ({ id, cat: cats.get(id), ...v, pct: v.budgeted > 0 ? v.committed / v.budgeted : 0 }))
      .sort((x, y) => (x.cat?.code || '').localeCompare(y.cat?.code || ''))
    const total = list.reduce(
      (t, x) => ({ budgeted: t.budgeted + x.budgeted, committed: t.committed + x.committed, available: t.available + x.available }),
      { budgeted: 0, committed: 0, available: 0 },
    )
    return { list, total, pct: total.budgeted > 0 ? total.committed / total.budgeted : 0 }
  }, [rows, cats])

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Presupuesto anual {YEAR}</h1>
          <p className="muted">{companyName ?? 'Empresa'} · presupuesto del año vs comprometido (acumulado). Solo lectura.</p>
        </div>
      </div>

      <div className={s.stats}>
        <div className={s.stat}><span className="muted">Presupuesto anual</span><strong>{formatCurrency(agg.total.budgeted)}</strong></div>
        <div className={s.stat}><span className="muted">Comprometido</span><strong>{formatCurrency(agg.total.committed)}</strong></div>
        <div className={s.stat}><span className="muted">Disponible</span><strong>{formatCurrency(agg.total.available)}</strong></div>
        <div className={s.stat}><span className="muted">% ejecución</span><strong>{(agg.pct * 100).toFixed(0)}%</strong></div>
      </div>

      <div className={s.card}>
        <div className={s.wrap}>
          <table className={s.table}>
            <thead><tr><th>Partida</th><th>Anual</th><th>Comprometido</th><th>Disponible</th><th>% ejec.</th></tr></thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={5} className={s.msg}>Cargando…</td></tr>}
              {status === 'error' && <tr><td colSpan={5} className={s.msg}>{err}</td></tr>}
              {status === 'ready' && agg.list.length === 0 && <tr><td colSpan={5} className={s.msg}>Sin presupuesto para {YEAR}.</td></tr>}
              {agg.list.map((x) => (
                <tr key={x.id}>
                  <td>{x.cat?.name ?? x.id}</td>
                  <td>{formatCurrency(x.budgeted)}</td>
                  <td>{formatCurrency(x.committed)}</td>
                  <td>{formatCurrency(x.available)}</td>
                  <td>{(x.pct * 100).toFixed(0)}%</td>
                </tr>
              ))}
              {status === 'ready' && agg.list.length > 0 && (
                <tr className={s.totalRow}>
                  <td><strong>TOTAL</strong></td>
                  <td><strong>{formatCurrency(agg.total.budgeted)}</strong></td>
                  <td><strong>{formatCurrency(agg.total.committed)}</strong></td>
                  <td><strong>{formatCurrency(agg.total.available)}</strong></td>
                  <td><strong>{(agg.pct * 100).toFixed(0)}%</strong></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
