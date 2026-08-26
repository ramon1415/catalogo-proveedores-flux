import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { Badge } from '../../../components/ui/Badge'
import { loadSocios } from '../api'
import { normalize, memberBalance, memberMatches, formatCurrency, formatNumber, friendlyError } from '../logic'
import { MemberModal } from '../MemberModal'
import { MemberHistoryModal } from '../MemberHistoryModal'
import type { Member, SociosData, MemberStatusFilter } from '../types'
import s from '../Configuracion.module.css'

const EMPTY_DATA: SociosData = { members: [], charges: [], payments: [], incidents: [], invoices: [], periods: [] }

export function MembersTab() {
  const { showToast } = useToast()
  const [data, setData] = useState<SociosData>(EMPTY_DATA)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<MemberStatusFilter>('all')
  const [lineageFilter, setLineageFilter] = useState('all')

  const [modal, setModal] = useState<{ member: Member | null } | null>(null)
  const [history, setHistory] = useState<Member | null>(null)

  async function reload() {
    setStatus('loading')
    try {
      setData(await loadSocios())
      setStatus('ready')
    } catch (error: any) {
      setErrorMsg(friendlyError(error))
      setStatus('error')
      showToast('No se pudo cargar socios', friendlyError(error), 'error')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const rows = useMemo(() => {
    const q = normalize(query)
    return data.members.filter((m) => memberMatches(m, q, statusFilter, lineageFilter))
  }, [data.members, query, statusFilter, lineageFilter])

  function clearFilters() {
    setQuery('')
    setStatusFilter('all')
    setLineageFilter('all')
  }

  return (
    <div className={s.panel}>
      <section className={s.tableCard}>
        <div className={s.panelToolbar}>
          <div>
            <h2>Socios</h2>
            <p>Administra titulares y consulta su historial de cuotas, pagos e incidencias.</p>
          </div>
          <button className={s.primaryBtn} onClick={() => setModal({ member: null })}>+ Nuevo socio</button>
        </div>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar socio, RFC o correo" />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as MemberStatusFilter)}>
            <option value="all">Estatus: Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
          <select value={lineageFilter} onChange={(e) => setLineageFilter(e.target.value)}>
            <option value="all">Estirpe: Todas</option>
            <option value="SNR">SNR</option>
            <option value="SNM">SNM</option>
            <option value="PSN">PSN</option>
            <option value="CSN">CSN</option>
            <option value="FSN">FSN</option>
          </select>
          <button className={s.secondaryBtn} onClick={clearFilters}>Ver todos</button>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Socio</th>
                <th>RFC</th>
                <th>Estirpe</th>
                <th>Factor</th>
                <th>Saldo pendiente</th>
                <th>Incidencias</th>
                <th>Facturas</th>
                <th>Estatus</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={9} className={s.tableMsg}>Cargando socios...</td></tr>}
              {status === 'error' && <tr><td colSpan={9} className={`${s.tableMsg} ${s.tableErr}`}>{errorMsg}</td></tr>}
              {status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={9} className={s.tableMsg}>No hay socios para este filtro.</td></tr>
              )}
              {status === 'ready' && rows.map((m) => {
                const balance = memberBalance(m.id, data.charges, data.payments, data.incidents, data.invoices)
                return (
                  <tr key={m.id}>
                    <td>
                      <span className={s.cellMain}>{m.full_name || 'Sin nombre'}</span>
                      <span className={s.cellSub}>{m.email || ''}</span>
                    </td>
                    <td>{m.rfc || ''}</td>
                    <td>{m.lineage || ''}</td>
                    <td>{formatNumber(m.fee_factor || 1)}</td>
                    <td><span className={s.cellMain}>{formatCurrency(balance.pending)}</span></td>
                    <td>
                      <Badge variant={balance.openIncidents > 0 ? 'warning' : 'neutral'}>{balance.openIncidents} abiertas</Badge>
                    </td>
                    <td>
                      <Badge variant={balance.pendingInvoices > 0 ? 'warning' : 'neutral'}>{balance.pendingInvoices} pendientes</Badge>
                    </td>
                    <td>
                      <Badge variant={m.active === false ? 'neutral' : 'success'}>{m.active === false ? 'Inactivo' : 'Activo'}</Badge>
                    </td>
                    <td>
                      <div className={s.rowActions}>
                        <button className={`${s.smallBtn} ${s.info}`} onClick={() => setHistory(m)} style={{ whiteSpace: 'nowrap' }}>Historial</button>
                        <button className={s.smallBtn} onClick={() => setModal({ member: m })}>Editar</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <MemberModal
          member={modal.member}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            showToast('Socio guardado', 'Los datos se guardaron correctamente.', 'success')
            reload()
          }}
        />
      )}
      {history && <MemberHistoryModal member={history} data={data} onClose={() => setHistory(null)} />}
    </div>
  )
}
