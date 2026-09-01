import { useCallback, useEffect, useState } from 'react'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatCurrency, formatDateTime } from '../../lib/format'
import { listProviderIntakes } from './api'
import { INTAKE_STATUS, INTAKE_STATUS_ORDER, friendlyIntakeError } from './logic'
import { IntakeDetailModal } from './IntakeDetailModal'
import type { IntakeFilters, IntakeItem, IntakeSummary, IntakeStatus } from './types'
import s from './ProviderIntakes.module.css'

// Rebanada 1 de la migración de provider_intakes.html: bandeja (lista + filtros + KPIs).
// El detalle / draft de pago / matching / links llegan en rebanadas siguientes.
const PAGE_SIZE = 20

function initialFilters(companyId: string | null): IntakeFilters {
  return { companyId, status: '', dateFrom: '', dateTo: '', hasFiles: '', folio: '', provider: '', sort: 'desc', page: 1, pageSize: PAGE_SIZE }
}

export default function ProviderIntakesPage() {
  const { companyId } = useCompany()
  useToast()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<IntakeFilters>(() => initialFilters(companyId))
  const [items, setItems] = useState<IntakeItem[]>([])
  const [summary, setSummary] = useState<IntakeSummary>({})
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  // La empresa activa manda: si hay una, el alcance queda fijo a ella.
  useEffect(() => { setFilters((f) => ({ ...f, companyId, page: 1 })) }, [companyId])

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const r = await listProviderIntakes(filters)
      setItems(r.items)
      setSummary(r.summary)
      setTotal(r.total)
      setStatus('ready')
    } catch (e) {
      setErr(friendlyIntakeError(e))
      setStatus('error')
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  function patch(p: Partial<IntakeFilters>) { setFilters((f) => ({ ...f, ...p, page: 1 })) }

  const kpiTotal = INTAKE_STATUS_ORDER.reduce((a, k) => a + Number(summary[k] || 0), 0)
  const first = total ? (filters.page - 1) * filters.pageSize + 1 : 0
  const last = Math.min(filters.page * filters.pageSize, total)
  const canPrev = filters.page > 1
  const canNext = filters.page * filters.pageSize < total

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Solicitudes de proveedores</h1>
          <p className="muted">Bandeja de altas de proveedores (intake).</p>
        </div>
        <button className="secondary-btn" onClick={load}>Actualizar</button>
      </div>

      <div className={s.kpis}>
        <button className={`${s.kpi} ${filters.status === '' ? s.active : ''}`} onClick={() => patch({ status: '' })}>
          <strong>{kpiTotal}</strong><span>Total</span>
        </button>
        {INTAKE_STATUS_ORDER.map((k) => (
          <button key={k} className={`${s.kpi} ${filters.status === k ? s.active : ''}`} onClick={() => patch({ status: filters.status === k ? '' : (k as IntakeStatus) })}>
            <strong>{Number(summary[k] || 0)}</strong><span>{INTAKE_STATUS[k].label}</span>
          </button>
        ))}
      </div>

      <div className={s.card}>
        <div className={s.toolbar}>
          <input placeholder="Folio…" value={filters.folio} onChange={(e) => patch({ folio: e.target.value })} />
          <input placeholder="Proveedor…" value={filters.provider} onChange={(e) => patch({ provider: e.target.value })} />
          <select value={filters.status} onChange={(e) => patch({ status: e.target.value as IntakeStatus | '' })}>
            <option value="">Todos los estados</option>
            {INTAKE_STATUS_ORDER.map((k) => <option key={k} value={k}>{INTAKE_STATUS[k].label}</option>)}
          </select>
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Desde<input type="date" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} /></label>
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>Hasta<input type="date" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} /></label>
          <select value={filters.hasFiles} onChange={(e) => patch({ hasFiles: e.target.value as '' | 'true' | 'false' })}>
            <option value="">Con y sin archivos</option>
            <option value="true">Con archivos</option>
            <option value="false">Sin archivos</option>
          </select>
          <select value={filters.sort} onChange={(e) => patch({ sort: e.target.value })}>
            <option value="desc">Más recientes</option>
            <option value="asc">Más antiguas</option>
          </select>
        </div>

        <div className={s.wrap}>
          <table className={s.table}>
            <thead><tr><th>Folio</th><th>Proveedor</th><th>Empresa</th><th>Monto</th><th>Estado</th><th>Recepción</th><th></th></tr></thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={7} className={s.msg}>Cargando…</td></tr>}
              {status === 'error' && <tr><td colSpan={7} className={s.msg}>{err}</td></tr>}
              {status === 'ready' && items.length === 0 && <tr><td colSpan={7} className={s.msg}>Sin resultados. Ajusta los filtros.</td></tr>}
              {items.map((it) => (
                <tr key={it.id}>
                  <td>{it.public_folio || '—'}</td>
                  <td title={it.provider_name || ''}>{it.provider_name || '—'}</td>
                  <td>{it.company_name || '—'}</td>
                  <td className={s.numeric}>{it.amount_requested != null ? formatCurrency(it.amount_requested) : '—'}</td>
                  <td><Badge variant={INTAKE_STATUS[it.status]?.variant ?? 'neutral'}>{INTAKE_STATUS[it.status]?.label ?? it.status}</Badge></td>
                  <td>{formatDateTime(it.created_at)}</td>
                  <td><button className="small-btn" onClick={() => setSelectedId(it.id)}>Ver detalle</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {status === 'ready' && total > 0 && (
          <div className={s.pager}>
            <span className={s.info}>Mostrando {first}–{last} de {total}</span>
            <button className="small-btn" disabled={!canPrev} onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}>Anterior</button>
            <button className="small-btn" disabled={!canNext} onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}>Siguiente</button>
          </div>
        )}
      </div>

      {selectedId && <IntakeDetailModal intakeId={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />}
    </>
  )
}
