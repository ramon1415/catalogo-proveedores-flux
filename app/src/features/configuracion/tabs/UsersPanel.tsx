import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { Badge } from '../../../components/ui/Badge'
import { hasPlatformPowerEmail } from '../../../lib/platformPower'
import {
  loadUsers, loadApproverRouting, listCompanyAccessRequests,
  approveCompanyAccessRequest, rejectCompanyAccessRequest,
  setProfileCompanyRole, listApproverCandidates, addApproverAssignment, removeApproverAssignment,
} from '../api'
import { normalize, GROUP_LABELS, GROUP_BADGE, friendlyRoutingError, groupFromRoleNames } from '../logic'
import type {
  UserRow, RoutingCompany, RoutingMembership, RoutingAssignment, ApproverCandidate, CompanyAccessRequest,
} from '../types'
import s from '../Configuracion.module.css'

type ApproverAdd = { companyId: string; candidates: ApproverCandidate[]; selected: string } | null
type EditableCompanyRole = 'operator' | 'finance' | 'director'

function editableCompanyRole(role: RoutingMembership['role_key']): EditableCompanyRole | '' {
  return role === 'operator' || role === 'finance' || role === 'director' ? role : ''
}

// Vista centrada en el usuario: una sola lista de personas; al seleccionar una,
// se gestionan TODAS sus cosas (rol, membresías por empresa, aprobadores y
// solicitudes de acceso) desde un solo panel — en vez de repetir la lista de
// usuarios en cada sub-sección. Reusa la misma API que la versión anterior.
export function UsersPanel() {
  const { showToast } = useToast()

  const [users, setUsers] = useState<UserRow[]>([])
  const [companies, setCompanies] = useState<RoutingCompany[]>([])
  const [memberships, setMemberships] = useState<RoutingMembership[]>([])
  const [assignments, setAssignments] = useState<RoutingAssignment[]>([])
  const [accessRequests, setAccessRequests] = useState<CompanyAccessRequest[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('todos')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reviewing, setReviewing] = useState('')
  const [approverAdd, setApproverAdd] = useState<ApproverAdd>(null)

  async function reload() {
    setStatus('loading')
    try {
      const [u, routing, reqs] = await Promise.all([loadUsers(), loadApproverRouting(), listCompanyAccessRequests()])
      setUsers(u)
      setCompanies(routing.companies)
      setMemberships(routing.memberships)
      setAssignments(routing.assignments)
      setAccessRequests(reqs)
      setStatus('ready')
    } catch (error) {
      setErrorMsg(friendlyRoutingError(error))
      setStatus('error')
    }
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [])

  const companyRolesFor = (profileId: string) => memberships
    .filter((membership) => membership.profile_id === profileId && membership.active)
    .map((membership) => editableCompanyRole(membership.role_key))
    .filter(Boolean) as EditableCompanyRole[]
  const displayGroup = (user: UserRow) =>
    user.group === 'sysadmin' && hasPlatformPowerEmail(user.email)
      ? 'sysadmin'
      : groupFromRoleNames(companyRolesFor(user.id))

  const filtered = useMemo(() => {
    const q = normalize(search)
    return users.filter((u) => {
      const text = normalize(`${u.full_name || ''} ${u.email || ''}`)
      const group = displayGroup(u)
      return (!q || text.includes(q)) && (roleFilter === 'todos' || group === roleFilter)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, memberships, search, roleFilter])

  const selected = useMemo(() => users.find((u) => u.id === selectedId) ?? null, [users, selectedId])
  const membershipFor = (companyId: string) =>
    memberships.find((m) => m.profile_id === selectedId && m.company_id === companyId) ?? null
  const approversFor = (companyId: string) =>
    assignments.filter((a) => a.requester_id === selectedId && a.company_id === companyId && a.active)
  const pendingRequestsFor = (profileId: string) =>
    accessRequests.filter((r) => r.profile_id === profileId && r.status === 'pending')

  const activeMemberCompanies = useMemo(
    () => companies.filter((c) => membershipFor(c.id)?.active),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, memberships, selectedId],
  )

  async function toggleMembership(companyId: string) {
    if (!selected) return
    const row = membershipFor(companyId)
    const role = editableCompanyRole(row?.role_key ?? null)
    if (!role) {
      showToast('Define primero el rol', 'Selecciona Operador, Finanzas o Director para esta empresa.', 'warning')
      return
    }
    setBusy(true)
    try {
      await setProfileCompanyRole(selected.id, companyId, role, !(row?.active))
      await reloadRouting()
    } catch (error) {
      showToast('No se pudo actualizar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function changeCompanyRole(companyId: string, role: 'operator' | 'finance' | 'director') {
    if (!selected) return
    setBusy(true)
    try {
      await setProfileCompanyRole(selected.id, companyId, role, true)
      showToast('Rol actualizado', 'El cambio aplica únicamente a esta empresa.', 'success')
      await reloadRouting()
    } catch (error) {
      showToast('No se pudo actualizar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function reloadRouting() {
    const routing = await loadApproverRouting()
    setCompanies(routing.companies); setMemberships(routing.memberships); setAssignments(routing.assignments)
  }

  async function openApproverAdd(companyId: string) {
    if (!selected) return
    try {
      const candidates = await listApproverCandidates(companyId, selected.id)
      setApproverAdd({ companyId, candidates, selected: '' })
      if (!candidates.length) showToast('Sin candidatos', 'No quedan aprobadores disponibles para agregar.', 'warning')
    } catch (error) {
      showToast('No se pudo cargar', friendlyRoutingError(error), 'error')
    }
  }

  async function confirmApproverAdd() {
    if (!selected || !approverAdd || !approverAdd.selected) return
    setBusy(true)
    try {
      await addApproverAssignment(approverAdd.companyId, selected.id, approverAdd.selected)
      showToast('Aprobador agregado', 'Quedó disponible para esta persona y empresa.', 'success')
      setApproverAdd(null)
      await reloadRouting()
    } catch (error) {
      showToast('No se pudo guardar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function removeApprover(assignmentId: string) {
    setBusy(true)
    try {
      await removeApproverAssignment(assignmentId)
      showToast('Aprobador quitado', 'Los demás aprobadores no cambian.', 'success')
      await reloadRouting()
    } catch (error) {
      showToast('No se pudo quitar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function approveAccess(row: CompanyAccessRequest, role: 'operator' | 'finance' | 'director') {
    setReviewing(row.id)
    try {
      await approveCompanyAccessRequest(row.id, role)
      showToast('Acceso aprobado', `${row.profile_name || row.profile_email || 'El usuario'} ya pertenece a ${row.company_name || 'la empresa'}.`, 'success')
      await reload()
    } catch (error) {
      showToast('No se pudo aprobar', friendlyRoutingError(error), 'error')
    } finally { setReviewing('') }
  }
  async function rejectAccess(row: CompanyAccessRequest) {
    setReviewing(row.id)
    try {
      await rejectCompanyAccessRequest(row.id)
      showToast('Solicitud rechazada', 'No se concedió ningún rol ni membresía.', 'success')
      await reload()
    } catch (error) {
      showToast('No se pudo rechazar', friendlyRoutingError(error), 'error')
    } finally { setReviewing('') }
  }

  const companyLabel = (c: RoutingCompany) => c.legal_name || c.name || 'Sin empresa'
  const selectedHasPlatformPower = Boolean(
    selected && selected.group === 'sysadmin' && hasPlatformPowerEmail(selected.email),
  )

  return (
    <section className={s.tableCard}>
      <div className={s.panelToolbar}>
        <div>
          <h2>Usuarios y permisos</h2>
          <p>Selecciona una persona y gestiona todo lo suyo: rol, empresas, aprobadores y accesos.</p>
        </div>
        <button type="button" className={s.secondaryBtn} onClick={reload}>Actualizar</button>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Lista maestra de usuarios */}
        <div style={{ flex: '1 1 300px', minWidth: 280, maxWidth: 420 }}>
          <div className={s.toolbar}>
            <div className={s.searchBox}>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o email…" />
            </div>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
              <option value="todos">Todos los roles</option>
              <option value="pending">Pendiente</option>
              <option value="operation">Operativo</option>
              <option value="admin_finance">Financiero</option>
              <option value="direction">Director</option>
              <option value="sysadmin">SysAdmin</option>
            </select>
          </div>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead><tr><th>Usuario</th><th>Rol</th></tr></thead>
              <tbody>
                {status === 'loading' && <tr><td colSpan={2} className={s.tableMsg}>Cargando…</td></tr>}
                {status === 'error' && <tr><td colSpan={2} className={`${s.tableMsg} ${s.tableErr}`}>{errorMsg}</td></tr>}
                {status === 'ready' && filtered.length === 0 && <tr><td colSpan={2} className={s.tableMsg}>Sin resultados.</td></tr>}
                {filtered.map((u) => {
                  const nPending = pendingRequestsFor(u.id).length
                  const group = displayGroup(u)
                  return (
                    <tr key={u.id} onClick={() => { setSelectedId(u.id); setApproverAdd(null) }}
                      style={{ cursor: 'pointer', background: u.id === selectedId ? 'var(--bg-hover, rgba(120,120,120,.12))' : undefined }}>
                      <td>
                        <span className={s.cellMain}>{u.full_name || 'Sin nombre'}{nPending ? ' 🔔' : ''}</span>
                        <span className={s.cellSub}>{u.email || ''}</span>
                      </td>
                      <td><Badge variant={GROUP_BADGE[group] || 'neutral'}>{GROUP_LABELS[group] || group}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detalle del usuario seleccionado */}
        <div style={{ flex: '2 1 420px', minWidth: 320 }}>
          {!selected ? (
            <div className={s.sectionNote}><p>Selecciona una persona de la lista para ver y editar sus permisos.</p></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Encabezado + alcance */}
              <div className={s.sectionNote}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{selected.full_name || 'Sin nombre'}</strong>
                    <p>{selected.email || ''}</p>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                      <Badge variant={selected.active === true ? 'success' : 'neutral'}>{selected.active === true ? 'Perfil activo' : 'Perfil inactivo'}</Badge>
                      <Badge variant={GROUP_BADGE[displayGroup(selected)] || 'neutral'}>{GROUP_LABELS[displayGroup(selected)] || displayGroup(selected)}</Badge>
                      <span className={s.cellSub}>{selectedHasPlatformPower ? 'Poder total global' : 'Roles definidos por empresa'}</span>
                    </div>
                  </div>
                </div>
                {selected.active !== true && <p style={{ color: 'var(--ruby)' }}>Perfil inactivo: conserva historial pero no puede recibir membresías ni ser aprobador.</p>}
              </div>

              {/* Solicitudes de acceso pendientes de esta persona */}
              {pendingRequestsFor(selected.id).map((row) => (
                <div key={row.id} className={s.sectionNote} style={{ borderLeft: '3px solid var(--amber, #f8ae00)' }}>
                  <strong>Solicitud de acceso pendiente → {row.company_name || 'empresa'}</strong>
                  <div className={s.rowActions} style={{ marginTop: 8 }}>
                    <button className={s.smallBtn} disabled={reviewing === row.id} onClick={() => approveAccess(row, 'operator')}>Aprobar: Operador</button>
                    <button className={`${s.smallBtn} ${s.info}`} disabled={reviewing === row.id} onClick={() => approveAccess(row, 'finance')}>Finanzas</button>
                    <button className={s.smallBtn} disabled={reviewing === row.id} onClick={() => approveAccess(row, 'director')}>Director</button>
                    <button className={`${s.smallBtn} ${s.danger}`} disabled={reviewing === row.id} onClick={() => rejectAccess(row)}>Rechazar</button>
                  </div>
                </div>
              ))}

              {/* Empresas (membresías) */}
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead><tr><th>Empresa</th><th>Rol en esta empresa</th><th>Membresía</th><th></th></tr></thead>
                  <tbody>
                    <tr><td colSpan={4} className={s.cellSub} style={{ fontWeight: 600 }}>Cada empresa conserva su propio rol.</td></tr>
                    {companies.map((c) => {
                      const m = membershipFor(c.id)
                      const role = editableCompanyRole(m?.role_key ?? null)
                      return (
                        <tr key={c.id}>
                          <td>{companyLabel(c)}</td>
                          <td>
                            <select
                              value={role}
                              disabled={busy || selected.active !== true}
                              onChange={(event) => {
                                const nextRole = event.target.value as EditableCompanyRole
                                if (nextRole) changeCompanyRole(c.id, nextRole)
                              }}
                            >
                              <option value="" disabled>{m ? 'Definir rol' : 'Sin rol'}</option>
                              <option value="operator">Operador</option>
                              <option value="finance">Finanzas</option>
                              <option value="director">Director</option>
                            </select>
                          </td>
                          <td>{m ? <Badge variant={m.active ? 'success' : 'neutral'}>{m.active ? 'Activa' : 'Inactiva'}</Badge> : <span className={s.cellSub}>Sin membresía</span>}</td>
                          <td>
                            <button className={s.smallBtn} disabled={busy || selected.active !== true || !role} onClick={() => toggleMembership(c.id)}>
                              {!role ? 'Define rol' : m?.active ? 'Desactivar' : 'Activar'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Aprobadores por empresa (solo donde es miembro activo) */}
              <div>
                <div className={s.sectionNote}><strong>Aprobadores por empresa</strong><p>Quién puede revisar las solicitudes de esta persona en cada empresa donde opera.</p></div>
                {activeMemberCompanies.length === 0 && <p className={s.cellSub}>Agrega una membresía activa para poder asignar aprobadores.</p>}
                {activeMemberCompanies.map((c) => {
                  const list = approversFor(c.id)
                  const adding = approverAdd?.companyId === c.id
                  return (
                    <div key={c.id} className={s.tableWrap} style={{ marginBottom: 10 }}>
                      <table className={s.table}>
                        <thead><tr><th>{companyLabel(c)}</th><th>Aprobador</th><th></th></tr></thead>
                        <tbody>
                          {list.length === 0 && <tr><td colSpan={3} className={s.tableMsg}>Sin aprobadores asignados.</td></tr>}
                          {list.map((a) => (
                            <tr key={a.id}>
                              <td></td>
                              <td><span className={s.cellMain}>{a.approver_name || 'Sin nombre'}</span><span className={s.cellSub}>{a.approver_email || ''}</span></td>
                              <td><button className={`${s.smallBtn} ${s.danger}`} disabled={busy} onClick={() => removeApprover(a.id)}>Quitar</button></td>
                            </tr>
                          ))}
                          <tr>
                            <td colSpan={3}>
                              {adding ? (
                                <div className={s.rowActions}>
                                  <select value={approverAdd?.selected} onChange={(e) => setApproverAdd(approverAdd ? { ...approverAdd, selected: e.target.value } : null)}>
                                    <option value="">Seleccionar aprobador…</option>
                                    {approverAdd?.candidates.map((cand) => (
                                      <option key={cand.profile_id} value={cand.profile_id}>
                                        {(cand.display_name || cand.email || 'Sin nombre') + (cand.eligible_roles?.length ? ` — ${cand.eligible_roles.join(', ')}` : '')}
                                      </option>
                                    ))}
                                  </select>
                                  <button className={s.primaryBtn} disabled={busy || !approverAdd?.selected} onClick={confirmApproverAdd}>Agregar</button>
                                  <button className={s.smallBtn} onClick={() => setApproverAdd(null)}>Cancelar</button>
                                </div>
                              ) : (
                                <button className={s.smallBtn} onClick={() => openApproverAdd(c.id)}>+ Agregar aprobador</button>
                              )}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

    </section>
  )
}
