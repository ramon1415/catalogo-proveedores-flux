import { Fragment, useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { Badge } from '../../../components/ui/Badge'
import { hasPlatformPowerEmail } from '../../../lib/platformPower'
import {
  loadUsers, loadApproverRouting, listCompanyAccessRequests,
  approveCompanyAccessRequest, rejectCompanyAccessRequest,
  setProfileCompanyRole, listApproverCandidates, addApproverAssignment, removeApproverAssignment,
  assignRole, setProfileActive,
} from '../api'
import { normalize, GROUP_LABELS, GROUP_BADGE, ROLE_ALIASES, roleValueFromGroup, friendlyRoutingError, groupFromRoleNames } from '../logic'
import type {
  UserRow, RoutingCompany, RoutingMembership, RoutingAssignment, ApproverCandidate, CompanyAccessRequest,
} from '../types'
import s from '../Configuracion.module.css'

type ApproverAdd = { companyId: string; candidates: ApproverCandidate[]; selected: string } | null
type EditableCompanyRole = 'operator' | 'finance' | 'director'
type StatusFilter = 'activos' | 'inactivos'

function editableCompanyRole(role: RoutingMembership['role_key']): EditableCompanyRole | '' {
  return role === 'operator' || role === 'finance' || role === 'director' ? role : ''
}

// Administración de usuarios con filas expandibles (accordion): la tabla lista a
// todas las personas y, al expandir una, se edita TODO lo suyo inline (rol global,
// estado, membresías por empresa, aprobadores y solicitudes). Reusa la misma API
// que la versión anterior; solo cambia el layout.
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('activos')
  const [roleFilter, setRoleFilter] = useState('todos')
  const [expandedId, setExpandedId] = useState<string | null>(null)
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

  const activeMembershipsCount = (profileId: string) =>
    memberships.filter((m) => m.profile_id === profileId && m.active).length
  const pendingRequestsFor = (profileId: string) =>
    accessRequests.filter((r) => r.profile_id === profileId && r.status === 'pending')

  const activeCount = useMemo(() => users.filter((u) => u.active === true).length, [users])
  const inactiveCount = users.length - activeCount

  const filtered = useMemo(() => {
    const q = normalize(search)
    return users.filter((u) => {
      const text = normalize(`${u.full_name || ''} ${u.email || ''}`)
      const group = displayGroup(u)
      const isActive = u.active === true
      return (
        (statusFilter === 'activos' ? isActive : !isActive) &&
        (!q || text.includes(q)) &&
        (roleFilter === 'todos' || group === roleFilter)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users, memberships, search, statusFilter, roleFilter])

  const expanded = useMemo(() => users.find((u) => u.id === expandedId) ?? null, [users, expandedId])
  const membershipFor = (companyId: string) =>
    memberships.find((m) => m.profile_id === expandedId && m.company_id === companyId) ?? null
  const approversFor = (companyId: string) =>
    assignments.filter((a) => a.requester_id === expandedId && a.company_id === companyId && a.active)

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
    setApproverAdd(null)
  }

  async function reloadRouting() {
    const routing = await loadApproverRouting()
    setCompanies(routing.companies); setMemberships(routing.memberships); setAssignments(routing.assignments)
  }

  // Solo refresca perfiles/roles globales (para rol global y toggle activo).
  async function reloadUsers() {
    setUsers(await loadUsers())
  }

  async function changeGlobalRole(user: UserRow, value: string) {
    setBusy(true)
    try {
      await assignRole(user.id, value, ROLE_ALIASES[value] || [])
      showToast('Rol global actualizado', `${user.full_name || user.email || 'El usuario'} ahora es ${GROUP_LABELS[groupFromRoleNames([value])] || value}.`, 'success')
      await reloadUsers()
    } catch (error) {
      showToast('No se pudo actualizar el rol', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function toggleProfileActive(user: UserRow) {
    const next = user.active !== true
    setBusy(true)
    try {
      await setProfileActive(user.id, next)
      showToast(next ? 'Perfil activado' : 'Perfil desactivado', next ? 'Ya puede recibir membresías y ser aprobador.' : 'Conserva historial pero no puede operar.', 'success')
      await reloadUsers()
    } catch (error) {
      showToast('No se pudo actualizar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function toggleMembership(companyId: string) {
    if (!expanded) return
    const row = membershipFor(companyId)
    const role = editableCompanyRole(row?.role_key ?? null)
    if (!role) {
      showToast('Define primero el rol', 'Selecciona Operador, Finanzas o Director para esta empresa.', 'warning')
      return
    }
    setBusy(true)
    try {
      await setProfileCompanyRole(expanded.id, companyId, role, !(row?.active))
      await reloadRouting()
    } catch (error) {
      showToast('No se pudo actualizar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function changeCompanyRole(companyId: string, role: EditableCompanyRole) {
    if (!expanded) return
    setBusy(true)
    try {
      await setProfileCompanyRole(expanded.id, companyId, role, true)
      showToast('Rol actualizado', 'El cambio aplica únicamente a esta empresa.', 'success')
      await reloadRouting()
    } catch (error) {
      showToast('No se pudo actualizar', friendlyRoutingError(error), 'error')
    } finally { setBusy(false) }
  }

  async function openApproverAdd(companyId: string) {
    if (!expanded) return
    try {
      const candidates = await listApproverCandidates(companyId, expanded.id)
      setApproverAdd({ companyId, candidates, selected: '' })
      if (!candidates.length) showToast('Sin candidatos', 'No quedan aprobadores disponibles para agregar.', 'warning')
    } catch (error) {
      showToast('No se pudo cargar', friendlyRoutingError(error), 'error')
    }
  }

  async function confirmApproverAdd() {
    if (!expanded || !approverAdd || !approverAdd.selected) return
    setBusy(true)
    try {
      await addApproverAssignment(approverAdd.companyId, expanded.id, approverAdd.selected)
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

  async function approveAccess(row: CompanyAccessRequest, role: EditableCompanyRole) {
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

  function renderExpandedPanel(user: UserRow) {
    const pending = pendingRequestsFor(user.id)
    const missingCompanies = companies.filter((c) => !membershipFor(c.id)?.active)
    const hasPlatformPower = user.group === 'sysadmin' && hasPlatformPowerEmail(user.email)

    return (
      <div className={s.expandPanel}>
        {/* Datos del perfil + resumen de empresas sin acceso */}
        <div className={s.expandHead}>
          <div className={s.detailGrid}>
            <label>
              Nombre completo
              <input type="text" value={user.full_name || 'Sin nombre'} readOnly />
            </label>
            <label>
              Email
              <input type="text" value={user.email || ''} readOnly />
            </label>
            <label>
              Rol global
              <select
                value={roleValueFromGroup(user.group)}
                disabled={busy}
                onChange={(e) => changeGlobalRole(user, e.target.value)}
              >
                <option value="pending">Pendiente</option>
                <option value="solicitante">Operativo</option>
                <option value="finance">Financiero</option>
                <option value="director">Director</option>
                <option value="sysadmin">SysAdmin</option>
              </select>
            </label>
            <label className={s.toggleField}>
              Estatus del perfil
              <span className={s.toggleRow}>
                <input
                  type="checkbox"
                  checked={user.active === true}
                  disabled={busy}
                  onChange={() => toggleProfileActive(user)}
                />
                <span>{user.active === true ? 'Activo' : 'Inactivo'}</span>
              </span>
            </label>
          </div>
          <div className={s.expandSummary}>
            {hasPlatformPower && <span className={s.hint}>Poder total global (sysadmin de plataforma).</span>}
            {missingCompanies.length > 0
              ? <span>Sin membresía en {missingCompanies.map(companyLabel).join(' · ')}</span>
              : <span>Con membresía activa en todas las empresas.</span>}
          </div>
        </div>

        {user.active !== true && (
          <p className={s.inactiveNote}>Perfil inactivo: conserva historial pero no puede recibir membresías ni ser aprobador.</p>
        )}

        {/* Membresías: una tarjeta por empresa */}
        <div className={s.expandSectionTitle}>Membresías por empresa</div>
        <div className={s.companyCards}>
          {companies.map((c) => {
            const m = membershipFor(c.id)
            const role = editableCompanyRole(m?.role_key ?? null)
            const approvers = approversFor(c.id)
            const adding = approverAdd?.companyId === c.id
            return (
              <div key={c.id} className={s.companyCard}>
                <div className={s.companyCardHead}>
                  <label className={s.toggleRow}>
                    <input
                      type="checkbox"
                      checked={Boolean(m?.active)}
                      disabled={busy || user.active !== true}
                      onChange={() => toggleMembership(c.id)}
                    />
                    <strong>{companyLabel(c)}</strong>
                  </label>
                  <select
                    value={role}
                    disabled={busy || user.active !== true}
                    onChange={(e) => {
                      const nextRole = e.target.value as EditableCompanyRole
                      if (nextRole) changeCompanyRole(c.id, nextRole)
                    }}
                  >
                    <option value="" disabled>{m ? 'Definir rol' : 'Sin rol'}</option>
                    <option value="operator">Operador</option>
                    <option value="finance">Finanzas</option>
                    <option value="director">Director</option>
                  </select>
                </div>

                {/* Aprobadores de la persona en esta empresa (solo con membresía activa) */}
                {m?.active ? (
                  <div className={s.approverBlock}>
                    <span className={s.approverLabel}>Aprobadores</span>
                    <div className={s.approverChips}>
                      {approvers.length === 0 && !adding && <span className={s.hint}>Sin aprobadores asignados.</span>}
                      {approvers.map((a) => (
                        <span key={a.id} className={s.chip}>
                          {a.approver_name || a.approver_email || 'Sin nombre'}
                          <button
                            type="button" className={s.chipRemove} title="Quitar aprobador"
                            disabled={busy} onClick={() => removeApprover(a.id)}
                          >×</button>
                        </span>
                      ))}
                      {adding ? (
                        <span className={s.rowActions}>
                          <select
                            value={approverAdd?.selected}
                            onChange={(e) => setApproverAdd(approverAdd ? { ...approverAdd, selected: e.target.value } : null)}
                          >
                            <option value="">Seleccionar aprobador…</option>
                            {approverAdd?.candidates.map((cand) => (
                              <option key={cand.profile_id} value={cand.profile_id}>
                                {(cand.display_name || cand.email || 'Sin nombre') + (cand.eligible_roles?.length ? ` — ${cand.eligible_roles.join(', ')}` : '')}
                              </option>
                            ))}
                          </select>
                          <button type="button" className={s.primaryBtn} disabled={busy || !approverAdd?.selected} onClick={confirmApproverAdd}>Agregar</button>
                          <button type="button" className={s.smallBtn} onClick={() => setApproverAdd(null)}>Cancelar</button>
                        </span>
                      ) : (
                        <button type="button" className={s.smallBtn} onClick={() => openApproverAdd(c.id)}>+ Agregar</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className={s.hint}>Sin membresía activa{role ? '' : ' — define un rol para activarla'}.</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Solicitudes de acceso pendientes de la persona */}
        {pending.length > 0 && (
          <>
            <div className={s.expandSectionTitle}>Solicitudes de acceso pendientes</div>
            {pending.map((row) => (
              <div key={row.id} className={s.requestCard}>
                <strong>Acceso solicitado → {row.company_name || 'empresa'}</strong>
                <div className={s.rowActions}>
                  <button type="button" className={s.smallBtn} disabled={reviewing === row.id} onClick={() => approveAccess(row, 'operator')}>Aprobar: Operador</button>
                  <button type="button" className={`${s.smallBtn} ${s.info}`} disabled={reviewing === row.id} onClick={() => approveAccess(row, 'finance')}>Finanzas</button>
                  <button type="button" className={s.smallBtn} disabled={reviewing === row.id} onClick={() => approveAccess(row, 'director')}>Director</button>
                  <button type="button" className={`${s.smallBtn} ${s.danger}`} disabled={reviewing === row.id} onClick={() => rejectAccess(row)}>Rechazar</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    )
  }

  return (
    <section className={s.tableCard}>
      <div className={s.panelToolbar}>
        <div>
          <h2>Administración de usuarios</h2>
          <p>Expande una persona para gestionar su rol, empresas, aprobadores y accesos.</p>
        </div>
        <button type="button" className={s.secondaryBtn} onClick={reload}>Actualizar</button>
      </div>

      {/* Barra: pills de estatus + búsqueda + filtro de rol */}
      <div className={s.toolbar}>
        <div className={s.pillGroup}>
          <button
            type="button"
            className={`${s.pill} ${statusFilter === 'activos' ? s.pillActive : ''}`}
            onClick={() => setStatusFilter('activos')}
          >Activos ({activeCount})</button>
          <button
            type="button"
            className={`${s.pill} ${statusFilter === 'inactivos' ? s.pillActive : ''}`}
            onClick={() => setStatusFilter('inactivos')}
          >Inactivos ({inactiveCount})</button>
        </div>
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
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Estatus</th>
              <th>Empresas</th>
              <th>Pendientes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {status === 'loading' && <tr><td colSpan={7} className={s.tableMsg}>Cargando…</td></tr>}
            {status === 'error' && <tr><td colSpan={7} className={`${s.tableMsg} ${s.tableErr}`}>{errorMsg}</td></tr>}
            {status === 'ready' && filtered.length === 0 && <tr><td colSpan={7} className={s.tableMsg}>Sin resultados.</td></tr>}
            {filtered.map((u) => {
              const group = displayGroup(u)
              const nPending = pendingRequestsFor(u.id).length
              const isOpen = u.id === expandedId
              return (
                <Fragment key={u.id}>
                  <tr className={`${s.userRow} ${isOpen ? s.userRowOpen : ''}`} onClick={() => toggleExpand(u.id)}>
                    <td><span className={s.cellMain}>{u.full_name || 'Sin nombre'}</span></td>
                    <td><span className={s.cellSub} style={{ fontSize: 12 }}>{u.email || ''}</span></td>
                    <td><Badge variant={GROUP_BADGE[group] || 'neutral'}>{GROUP_LABELS[group] || group}</Badge></td>
                    <td><Badge variant={u.active === true ? 'success' : 'neutral'}>{u.active === true ? 'Activo' : 'Inactivo'}</Badge></td>
                    <td>{activeMembershipsCount(u.id)}</td>
                    <td>{nPending > 0 ? <span className={s.pendingBadge}>{nPending}</span> : <span className={s.hint}>—</span>}</td>
                    <td className={s.chevronCell}><span className={`${s.chevron} ${isOpen ? s.chevronOpen : ''}`}>▾</span></td>
                  </tr>
                  {isOpen && (
                    <tr className={s.expandRow}>
                      <td colSpan={7}>{renderExpandedPanel(u)}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
