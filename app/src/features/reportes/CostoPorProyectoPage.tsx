import { Fragment, useEffect, useMemo, useState } from 'react'
import { useCompany } from '../../lib/company'
import { formatCurrency, formatDate } from '../../lib/format'
import { Badge } from '../../components/ui/Badge'
import { statusBadge } from '../solicitudes/logic'
import { loadProjectCostData } from './api'
import { totalsFor, yearOptions } from './logic'
import type { ProjectCostData } from './types'
import s from './Reportes.module.css'

// Objetivo real de la feature: saber cuánto costó un esfuerzo que se repartió
// entre varias facturas y proveedores. Read-only, por empresa activa y año.
export default function CostoPorProyectoPage() {
  const { companyId, companyName } = useCompany()
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState<ProjectCostData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let active = true
    ;(async () => {
      setStatus('loading')
      setOpenId(null)
      try {
        const result = await loadProjectCostData(companyId, year)
        if (!active) return
        setData(result)
        setStatus('ready')
      } catch (e) {
        if (!active) return
        setErr(e instanceof Error ? e.message : 'Error inesperado')
        setStatus('error')
      }
    })()
    return () => { active = false }
  }, [companyId, year])

  const rows = useMemo(() => {
    if (!data) return []
    const byProject = new Map<string, typeof data.requests>()
    for (const r of data.requests) {
      const list = byProject.get(r.project_id) ?? []
      list.push(r)
      byProject.set(r.project_id, list)
    }
    // Un proyecto desactivado sigue apareciendo si tuvo gasto en el año: se
    // desactiva para no ofrecerlo en nuevas solicitudes, no para esconder su costo.
    return data.projects
      .filter((p) => p.active || byProject.has(p.id))
      .map((p) => {
        const requests = byProject.get(p.id) ?? []
        return { project: p, requests, totals: totalsFor(requests) }
      })
      .sort((a, b) => b.totals.requested - a.totals.requested || a.project.name.localeCompare(b.project.name))
  }, [data])

  const grand = useMemo(
    () => rows.reduce(
      (t, r) => ({
        requested: t.requested + r.totals.requested,
        approved: t.approved + r.totals.approved,
        paid: t.paid + r.totals.paid,
        count: t.count + r.totals.count,
      }),
      { requested: 0, approved: 0, paid: 0, count: 0 },
    ),
    [rows],
  )

  const hasTagged = grand.count > 0

  function counterparty(r: ProjectCostData['requests'][number]): string {
    if (r.proveedor_id) return data?.proveedorNames.get(r.proveedor_id) ?? 'Proveedor'
    if (r.beneficiary_profile_id) return data?.profileNames.get(r.beneficiary_profile_id) ?? 'Beneficiario'
    return '—'
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Costo por proyecto</h1>
          <p className="muted">
            {companyName ?? 'Empresa'} · gasto etiquetado por proyecto. Solo lectura.
          </p>
        </div>
        <label className={s.yearFilter}>
          Año
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
      </div>

      <div className={s.stats}>
        <div className={s.stat}><span className="muted">Solicitado</span><strong>{formatCurrency(grand.requested)}</strong></div>
        <div className={s.stat}><span className="muted">Aprobado</span><strong>{formatCurrency(grand.approved)}</strong></div>
        <div className={s.stat}><span className="muted">Pagado</span><strong>{formatCurrency(grand.paid)}</strong></div>
        <div className={s.stat}><span className="muted">Solicitudes etiquetadas</span><strong>{grand.count}</strong></div>
      </div>

      <div className={s.card}>
        <div className={s.wrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Solicitado</th>
                <th>Aprobado</th>
                <th>Pagado</th>
                <th>Solicitudes</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={5} className={s.msg}>Cargando…</td></tr>}
              {status === 'error' && <tr><td colSpan={5} className={s.msg}>{err}</td></tr>}
              {status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={5} className={s.msg}>
                  Esta empresa no tiene proyectos activos. Finanzas los da de alta en Configuración › Proyectos.
                </td></tr>
              )}
              {status === 'ready' && rows.length > 0 && !hasTagged && (
                <tr><td colSpan={5} className={s.msg}>
                  Ningún gasto de {year} está etiquetado con un proyecto. El campo es opcional al capturar la solicitud.
                </td></tr>
              )}
              {status === 'ready' && hasTagged && rows.map(({ project, requests, totals }) => (
                <Fragment key={project.id}>
                  <tr
                    className={s.clickableRow}
                    onClick={() => setOpenId(openId === project.id ? null : project.id)}
                  >
                    <td>
                      <span className={s.projectName}>
                        {openId === project.id ? '▾' : '▸'} {project.name}
                      </span>
                      {!project.active && <> <Badge variant="neutral">Inactivo</Badge></>}
                      {project.description && <div className={s.projectDesc}>{project.description}</div>}
                    </td>
                    <td>{formatCurrency(totals.requested)}</td>
                    <td>{formatCurrency(totals.approved)}</td>
                    <td>{formatCurrency(totals.paid)}</td>
                    <td>{totals.count}</td>
                  </tr>
                  {openId === project.id && (
                    <tr>
                      <td colSpan={5} className={s.detailCell}>
                        {requests.length === 0 ? (
                          <div className={s.msg}>Sin gastos etiquetados en {year}.</div>
                        ) : (
                          <table className={s.table}>
                            <thead>
                              <tr>
                                <th>Folio</th>
                                <th>Proveedor / Beneficiario</th>
                                <th>Monto</th>
                                <th>Estatus</th>
                                <th>Fecha</th>
                              </tr>
                            </thead>
                            <tbody>
                              {requests.map((r) => {
                                const badge = statusBadge(r.status)
                                return (
                                  <tr key={r.id}>
                                    <td>{r.request_number || '—'}</td>
                                    <td>{counterparty(r)}</td>
                                    <td>{formatCurrency(r.amount_requested)}</td>
                                    <td><Badge variant={badge.variant}>{badge.label}</Badge></td>
                                    <td>{formatDate(r.created_at)}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {status === 'ready' && hasTagged && (
                <tr className={s.totalRow}>
                  <td><strong>TOTAL</strong></td>
                  <td><strong>{formatCurrency(grand.requested)}</strong></td>
                  <td><strong>{formatCurrency(grand.approved)}</strong></td>
                  <td><strong>{formatCurrency(grand.paid)}</strong></td>
                  <td><strong>{grand.count}</strong></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className={s.footnote}>
        Las solicitudes rechazadas o canceladas se listan en el detalle pero no suman: nunca llegaron a ser costo.
      </p>
    </>
  )
}
