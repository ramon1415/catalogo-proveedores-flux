import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { BudgetPartida } from './types'
import { money, pct, REQUEST_STATUS_LABELS } from './logic'
import { fetchBudgetMovements, movementTotals, type BudgetMovement } from './budgetMovements'
import s from './Dashboard.module.css'
import d from './BudgetAccordion.module.css'

type Scope = { companyId: string; year: number; period: string; periodLabel: string; onRefresh: () => void }

export function BudgetAccordion({ curated, noUse, search, ...scope }: Scope & { curated: BudgetPartida[]; noUse: BudgetPartida[]; search: string }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [showNoUse, setShowNoUse] = useState(false)
  const row = (p: BudgetPartida) => <BudgetPartidaRow key={p.categoryId} p={p} open={openId === p.categoryId} onToggle={() => setOpenId(openId === p.categoryId ? null : p.categoryId)}>
    <BudgetMovementDetail p={p} {...scope} />
  </BudgetPartidaRow>
  if (!curated.length && !noUse.length) return <div className={s.tableMsg}>No hay partidas que coincidan con «{search}».</div>
  return <div className={s.budgetList}>
    {curated.map(row)}
    {!!noUse.length && <button className={s.secondaryBtn} type="button" aria-expanded={showNoUse} onClick={() => { setShowNoUse(!showNoUse); setOpenId(null) }}>{showNoUse ? 'Ocultar' : 'Ver'} {noUse.length} partidas sin uso</button>}
    {showNoUse && noUse.map(row)}
  </div>
}

export function BudgetMovementDetail({ p, companyId, year, period, periodLabel, onRefresh }: Scope & { p: BudgetPartida }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ rows: BudgetMovement[] | null; error: boolean } | null>(null)
  useEffect(() => {
    let cancelled = false
    setResult(null)
    fetchBudgetMovements(companyId, year, p.categoryId, period).then(
      rows => { if (!cancelled) setResult({ rows, error: false }) },
      () => { if (!cancelled) setResult({ rows: null, error: true }) },
    )
    return () => { cancelled = true }
  }, [companyId, year, p.categoryId, period, attempt])
  const rows = result?.rows
  const totals = rows ? movementTotals(rows) : null
  const matches = !!totals && Math.abs(totals.used - p.used) < 0.01 && Math.abs(totals.executed - p.executed) < 0.01
  const requestsOnly = rows?.every(row => row.source === 'request')
  return <section className={d.detail} aria-label={`Detalle de ${p.name}`}>
    <div className={d.detailHead}><strong>{requestsOnly ? 'Solicitudes de esta partida' : 'Movimientos de esta partida'}</strong><span>{rows ? `${rows.length} ${requestsOnly ? 'solicitudes' : 'movimientos'} · ` : ''}{periodLabel} · MXN</span></div>
    {!result && <p role="status">Cargando detalle…</p>}
    {result?.error && <p role="alert">No se pudo cargar el detalle. <button className={s.secondaryBtn} type="button" onClick={() => setAttempt(v => v + 1)}>Reintentar</button></p>}
    {rows && <>
      {!matches && <p className={d.notice} role="status">El detalle y el resumen no coinciden; puede haber movimientos recientes. <button type="button" className={s.secondaryBtn} onClick={onRefresh}>Actualizar resumen</button></p>}
      {!rows.length ? <p>Sin movimientos que consuman presupuesto en este periodo.</p> : <>
        {rows.length > 4 && <p className={d.scrollHint}>Desplázate dentro de la tabla para ver los {rows.length} movimientos.</p>}
        <div className={d.viewport} tabIndex={0} role="region" aria-label={`Movimientos de ${p.name}; tabla con desplazamiento interno`}>
          <table className={d.table}>
            <thead><tr><th scope="col">Folio</th><th scope="col">Fecha</th><th scope="col">Proveedor / Concepto</th><th scope="col">Estado</th><th scope="col" className={d.amount}>Consumo MXN</th><th scope="col"><span className={d.srOnly}>Acciones</span></th></tr></thead>
            <tbody>{rows.map(row => <tr key={`${row.source}-${row.id}`}>
              <td><span className={d.truncate} title={row.reference || 'Sin folio'}>{row.reference || 'Sin folio'}</span></td>
              <td>{row.date ? row.date.split('-').reverse().join('/') : '—'}</td>
              <td><strong className={d.truncate} title={row.title}>{row.title}</strong><span className={d.truncate} title={row.description}>{row.description || 'Sin concepto'}</span></td>
              <td><span className={row.status === 'paid' ? d.paid : d.pending}>{row.source === 'historical' ? 'Contabilizado' : REQUEST_STATUS_LABELS[row.status] || row.status}</span></td>
              <td className={d.amount}>{row.amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</td>
              <td>{row.source === 'request' ? <Link className={d.link} to={`/solicitudes?request_id=${encodeURIComponent(row.id)}`}>Ver solicitud ↗</Link> : row.source === 'obligation' ? <Link className={d.link} to="/nomina">Ver nómina ↗</Link> : <span className={d.source}>Consolidado mensual</span>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
      <div className={d.footer}><span>Consumo presupuestal: subtotal en MXN; puede diferir del importe a pagar.{rows.some(r => r.source === 'historical') && ' El histórico certificado se presenta consolidado por mes y reemplaza los movimientos operativos de ese mes.'}</span><strong>{matches ? 'Total de la partida' : 'Total del detalle'} {totals!.used.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })}</strong></div>
    </>}
  </section>
}

function BudgetPartidaRow({ p, open, onToggle, children }: { p: BudgetPartida; open: boolean; onToggle: () => void; children: ReactNode }) {
  // Escala: 100% = presupuestado; si está sobregirado, el usado (mayor) llena la
  // barra. base = max(presupuestado, usado) para no perder proporción al sobregirar.
  const base = Math.max(p.budgeted, p.used, 1)
  const exW = (p.executed / base) * 100
  const comW = (p.committed / base) * 100
  const availW = p.available > 0 ? (p.available / base) * 100 : 0
  const hasBudget = p.budgeted > 0
  const excess = Math.max(0, p.used - p.budgeted)
  const excessPct = hasBudget ? excess / p.budgeted * 100 : 0
  const excessLabel = excessPct > 0 && excessPct < 0.1 ? '<0.1%' : pct(excessPct)
  const rowCls = `${s.budgetRow} ${p.over ? s.alert : p.warn ? s.warn : !hasBudget ? s.unbudgeted : ''}`
  const pctCls = `${s.budgetPct} ${p.over ? s.alert : p.warn ? s.warn : !hasBudget ? s.unbudgeted : ''}`
  const pctText = !hasBudget ? 'Sin presupuesto asignado' : p.over ? `${excessLabel} por encima` : `${pct(p.pctUsed)} utilizado`
  return (
    <div className={rowCls}>
      <button type="button" className={`${s.budgetRowHead} ${d.toggle}`} aria-expanded={open} aria-controls={`budget-detail-${p.categoryId}`} onClick={onToggle}>
        <span>
          <span className={s.budgetPartida}>{p.name}</span>
          {p.group && p.group !== 'Sin grupo' && <span className={s.budgetGroup}>{p.group}</span>}
        </span>
        <span className={d.toggleRight}><span className={pctCls}>
          {(p.over || !hasBudget) && <span aria-hidden="true">{p.over ? '↑' : 'ⓘ'}</span>}
          {pctText}
        </span><span className={d.toggleLabel}>{open ? 'Ocultar detalle' : 'Ver detalle'} <span aria-hidden="true">{open ? '⌃' : '⌄'}</span></span></span>
      </button>
      {hasBudget && <div className={s.budgetBar} role="img" aria-label={p.over ? `Excedente de ${money(excess)}; ${excessLabel} por encima del presupuesto de ${money(p.budgeted)}` : `Utilizado ${pct(p.pctUsed)} del presupuesto de ${money(p.budgeted)}`}>
        <div className={`${s.budgetSeg} ${s.executed}`} style={{ width: `${exW}%` }} />
        <div className={`${s.budgetSeg} ${s.committed}`} style={{ width: `${comW}%` }} />
        {availW > 0 && <div className={s.budgetSeg} style={{ width: `${availW}%` }} />}
        {p.over && <>
          <div className={s.budgetExcess} style={{ width: `${excess / base * 100}%` }} />
          <span className={s.budgetLimit} style={{ left: `${p.budgeted / base * 100}%` }} />
        </>}
      </div>}
      <div className={s.budgetFigures}>
        <span>Presupuestado<strong>{hasBudget ? money(p.budgeted) : 'Sin asignar'}</strong></span>
        <span>Ejecutado<strong>{money(p.executed)}</strong></span>
        <span>Pendiente de pago<strong>{money(p.committed)}</strong></span>
        <span>Usado<strong>{money(p.used)}</strong></span>
        {hasBudget && <span>{p.over ? 'Excedente' : 'Disponible'}<strong className={p.over ? s.alert : undefined}>{money(p.over ? excess : p.available)}</strong></span>}
      </div>
      {open && <div id={`budget-detail-${p.categoryId}`}>{children}</div>}
    </div>
  )
}
