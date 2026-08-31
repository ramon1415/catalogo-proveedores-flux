import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { Badge } from '../../../components/ui/Badge'
import {
  loadUsers,
  listCompanyAccessRequests,
  approveCompanyAccessRequest,
  rejectCompanyAccessRequest,
  loadApproverRouting,
  setProfileCompanyMembership,
  listApproverCandidates,
  addApproverAssignment,
  removeApproverAssignment,
} from '../api'
import { normalize, formatDate, GROUP_LABELS, GROUP_BADGE, friendlyRoutingError } from '../logic'
import { AssignRoleModal } from '../AssignRoleModal'
import { TenantOnboardingWizard } from '../TenantOnboardingWizard'
import type {
  UserRow,
  RoutingCompany,
  RoutingMembership,
  RoutingAssignment,
  ApproverCandidate,
  CompanyAccessRequest,
} from '../types'
import s from '../Configuracion.module.css'

export function SystemTab() {
  const { showToast } = useToast()

  const [users, setUsers] = useState<UserRow[]>([])
  const [companies, setCompanies] = useState<RoutingCompany[]>([])
  const [memberships, setMemberships] = useState<RoutingMembership[]>([])
  const [assignments, setAssignments] = useState<RoutingAssignment[]>([])
  const [usersStatus, setUsersStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [usersError, setUsersError] = useState('')
  const [routingError, setRoutingError] = useState('')
  const [accessRequests, setAccessRequests] = useState<CompanyAccessRequest[]>([])
  const [accessRequestsStatus, setAccessRequestsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [accessRequestsError, setAccessRequestsError] = useState('')
  const [reviewingRequest, setReviewingRequest] = useState('')

  // Filtros de usuarios
  const [usersSearch, setUsersSearch] = useState('')
  const [usersRoleFilter, setUsersRoleFilter] = useState('todos')

  // Asignar rol
  const [assignTarget, setAssignTarget] = useState<UserRow | null>(null)

  // Membresías (alta)
  const [membershipProfile, setMembershipProfile] = useState('')
  const [membershipCompany, setMembershipCompany] = useState('')
  const [savingMembership, setSavingMembership] = useState(false)

  // Aprobadores (alta)
  const [requester, setRequester] = useState('')
  const [assignmentCompany, setAssignmentCompany] = useState('')
  const [approver, setApprover] = useState('')
  const [approverOptions, setApproverOptions] = useState<ApproverCandidate[]>([])
  const [assignmentHelp, setAssignmentHelp] = useState({ text: 'Selecciona un solicitante con membresía activa.', err: false })
  const [savingAssignment, setSavingAssignment] = useState(false)

  async function reloadAll() {
    await Promise.all([loadUsersData(), loadRouting(), loadAccessRequests()])
  }

  async function loadAccessRequests() {
    setAccessRequestsStatus('loading')
    try {
      setAccessRequests(await listCompanyAccessRequests())
      setAccessRequestsError('')
      setAccessRequestsStatus('ready')
    } catch (error: any) {
      setAccessRequestsError(friendlyRoutingError(error))
      setAccessRequestsStatus('error')
    }
  }

  async function loadUsersData() {
    setUsersStatus('loading')
    try {
      setUsers(await loadUsers())
      setUsersStatus('ready')
    } catch (err: any) {
      setUsersError(err.message)
      setUsersStatus('error')
    }
  }

  async function loadRouting() {
    try {
      const { companies: cs, memberships: ms, assignments: as } = await loadApproverRouting()
      setCompanies(cs)
      setMemberships(ms)
      setAssignments(as)
      setRoutingError('')
    } catch (error: any) {
      setRoutingError(friendlyRoutingError(error))
    }
  }

  useEffect(() => {
    reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeUsers = useMemo(() => users.filter((u) => u.active === true), [users])

  const filteredUsers = useMemo(() => {
    const query = normalize(usersSearch)
    return users.filter((u) => {
      const text = normalize(`${u.full_name || ''} ${u.email || ''}`)
      const matchText = !query || text.includes(query)
      const matchGroup = usersRoleFilter === 'todos' || u.group === usersRoleFilter
      return matchText && matchGroup
    })
  }, [users, usersSearch, usersRoleFilter])

  // ── Enrutamiento: requester → empresas con membresía activa ──
  const requesterActiveMemberships = useMemo(
    () => memberships.filter((row) => row.profile_id === requester && row.active),
    [memberships, requester],
  )

  function onRequesterChange(value: string) {
    setRequester(value)
    setAssignmentCompany('')
    setApprover('')
    setApproverOptions([])
    const active = memberships.filter((row) => row.profile_id === value && row.active)
    setAssignmentHelp({
      text: active.length
        ? 'Selecciona la empresa para cargar aprobadores elegibles.'
        : 'El solicitante necesita una membresía activa.',
      err: false,
    })
  }

  async function onAssignmentCompanyChange(value: string) {
    setAssignmentCompany(value)
    setApprover('')
    setApproverOptions([])
    if (!requester || !value) {
      return
    }
    try {
      const data = await listApproverCandidates(value, requester)
      setApproverOptions(data)
      setAssignmentHelp({
        text: data.length
          ? 'Se excluyen los aprobadores que ya están activos en este pool.'
          : 'No quedan aprobadores disponibles para agregar.',
        err: !data.length,
      })
    } catch (error: any) {
      setApproverOptions([])
      setAssignmentHelp({ text: friendlyRoutingError(error), err: true })
    }
  }

  async function saveMembership() {
    if (!membershipProfile || !membershipCompany) {
      showToast('Datos incompletos', 'Selecciona usuario y empresa.', 'warning')
      return
    }
    setSavingMembership(true)
    try {
      await setProfileCompanyMembership(membershipProfile, membershipCompany, true)
      showToast('Membresía guardada', 'El alcance usuario–empresa quedó activo.', 'success')
      await loadRouting()
    } catch (error: any) {
      showToast('No se pudo guardar', friendlyRoutingError(error), 'error')
    } finally {
      setSavingMembership(false)
    }
  }

  async function toggleMembership(row: RoutingMembership) {
    try {
      await setProfileCompanyMembership(row.profile_id, row.company_id, !row.active)
      showToast('Membresía actualizada', !row.active ? 'Membresía activada.' : 'Membresía desactivada.', 'success')
      await loadRouting()
    } catch (error: any) {
      showToast('No se pudo actualizar', friendlyRoutingError(error), 'error')
    }
  }

  async function saveAssignment(e: React.FormEvent) {
    e.preventDefault()
    if (!requester || !assignmentCompany || !approver) {
      showToast('Datos incompletos', 'Selecciona solicitante, empresa y aprobador.', 'warning')
      return
    }
    setSavingAssignment(true)
    try {
      await addApproverAssignment(assignmentCompany, requester, approver)
      showToast('Aprobador agregado correctamente', 'El aprobador quedó disponible para este solicitante y empresa.', 'success')
      await loadRouting()
    } catch (error: any) {
      showToast('No se pudo guardar', friendlyRoutingError(error), 'error')
    } finally {
      setSavingAssignment(false)
    }
  }

  async function assignmentAction(row: RoutingAssignment) {
    try {
      if (row.active) {
        await removeApproverAssignment(row.id)
        showToast('Aprobador eliminado correctamente', 'Los demás aprobadores configurados permanecen sin cambios.', 'success')
      } else {
        await addApproverAssignment(row.company_id, row.requester_id, row.approver_id)
        showToast('Aprobador activado correctamente', 'Volvió a quedar disponible en el pool.', 'success')
      }
      await loadRouting()
    } catch (error: any) {
      showToast('No se pudo quitar', friendlyRoutingError(error), 'error')
    }
  }

  async function approveAccess(row: CompanyAccessRequest, role: 'solicitante' | 'finance' | 'director') {
    setReviewingRequest(row.id)
    try {
      await approveCompanyAccessRequest(row.id, role)
      showToast(
        'Acceso aprobado',
        `${row.profile_name || row.profile_email || 'El usuario'} ya pertenece a ${row.company_name || 'la empresa'}.`,
        'success',
      )
      await reloadAll()
    } catch (error: any) {
      showToast('No se pudo aprobar', friendlyRoutingError(error), 'error')
    } finally {
      setReviewingRequest('')
    }
  }

  async function rejectAccess(row: CompanyAccessRequest) {
    setReviewingRequest(row.id)
    try {
      await rejectCompanyAccessRequest(row.id)
      showToast('Solicitud rechazada', 'No se concedió ningún rol ni membresía.', 'success')
      await loadAccessRequests()
    } catch (error: any) {
      showToast('No se pudo rechazar', friendlyRoutingError(error), 'error')
    } finally {
      setReviewingRequest('')
    }
  }

  const companyOptionLabel = (c: RoutingCompany) => c.legal_name || c.name || 'Sin empresa'
  const userOptionLabel = (u: UserRow) => u.full_name || u.email || 'Sin nombre'

  return (
    <div className={s.panel}>
      <TenantOnboardingWizard />

      {/* Solicitudes de acceso por liga de empresa */}
      <section className={s.tableCard}>
        <div className={s.panelToolbar}>
          <div>
            <h2>Solicitudes de acceso por empresa</h2>
            <p>La liga identifica la empresa; SysAdmin confirma únicamente el rol permitido.</p>
          </div>
          <button type="button" className={s.secondaryBtn} onClick={loadAccessRequests}>Actualizar</button>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Usuario</th><th>Empresa solicitada</th><th>Fecha</th><th>Estatus</th><th>Acción</th></tr></thead>
            <tbody>
              {accessRequestsStatus === 'loading' && <tr><td colSpan={5} className={s.tableMsg}>Cargando solicitudes…</td></tr>}
              {accessRequestsStatus === 'error' && <tr><td colSpan={5} className={`${s.tableMsg} ${s.tableErr}`}>{accessRequestsError}</td></tr>}
              {accessRequestsStatus === 'ready' && accessRequests.length === 0 && (
                <tr><td colSpan={5} className={s.tableMsg}>No hay solicitudes de acceso.</td></tr>
              )}
              {accessRequestsStatus === 'ready' && accessRequests.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={s.cellMain}>{row.profile_name || 'Sin nombre'}</span>
                    <span className={s.cellSub}>{row.profile_email || ''}</span>
                    {row.current_roles?.length ? <span className={s.cellSub}>Rol actual: {row.current_roles.join(', ')}</span> : null}
                  </td>
                  <td>{row.company_name || 'Sin empresa'}</td>
                  <td><span className={s.cellSub}>{formatDate(row.requested_at)}</span></td>
                  <td>
                    <Badge variant={row.status === 'pending' ? 'warning' : row.status === 'approved' ? 'success' : 'neutral'}>
                      {row.status === 'pending' ? 'Pendiente' : row.status === 'approved' ? 'Aprobada' : 'Rechazada'}
                    </Badge>
                    {row.approved_role && <span className={s.cellSub}>{row.approved_role}</span>}
                  </td>
                  <td>
                    {row.status === 'pending' ? (
                      <div className={s.rowActions}>
                        <button type="button" className={s.smallBtn} disabled={reviewingRequest === row.id} onClick={() => approveAccess(row, 'solicitante')}>Solicitante</button>
                        <button type="button" className={`${s.smallBtn} ${s.info}`} disabled={reviewingRequest === row.id} onClick={() => approveAccess(row, 'finance')}>Finanzas</button>
                        <button type="button" className={s.smallBtn} disabled={reviewingRequest === row.id} onClick={() => approveAccess(row, 'director')}>Director</button>
                        <button type="button" className={`${s.smallBtn} ${s.danger}`} disabled={reviewingRequest === row.id} onClick={() => rejectAccess(row)}>Rechazar</button>
                      </div>
                    ) : <span className={s.cellSub}>Revisada</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Usuarios */}
      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <input type="search" value={usersSearch} onChange={(e) => setUsersSearch(e.target.value)} placeholder="Buscar por nombre o email…" />
          </div>
          <select value={usersRoleFilter} onChange={(e) => setUsersRoleFilter(e.target.value)}>
            <option value="todos">Todos los roles</option>
            <option value="pending">Pendiente</option>
            <option value="operation">Operativo</option>
            <option value="admin_finance">Financiero</option>
            <option value="direction">Director</option>
            <option value="sysadmin">SysAdmin</option>
          </select>
          <button type="button" className={s.secondaryBtn} onClick={loadUsersData}>Actualizar</button>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Estado del perfil</th>
                <th>Rol actual</th>
                <th>Nivel de acceso</th>
                <th>Registrado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usersStatus === 'loading' && <tr><td colSpan={6} className={s.tableMsg}>Cargando…</td></tr>}
              {usersStatus === 'error' && <tr><td colSpan={6} className={`${s.tableMsg} ${s.tableErr}`}>{usersError}</td></tr>}
              {usersStatus === 'ready' && filteredUsers.length === 0 && (
                <tr><td colSpan={6} className={s.tableMsg}>Sin resultados.</td></tr>
              )}
              {usersStatus === 'ready' && filteredUsers.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className={s.cellMain}>{u.full_name || 'Sin nombre'}</span>
                    <span className={s.cellSub}>{u.email || ''}</span>
                  </td>
                  <td>
                    <Badge variant={u.active === true ? 'success' : 'neutral'}>{u.active === true ? 'Activo' : 'Inactivo'}</Badge>
                    {u.active === true ? null : (
                      <span className={s.cellSub}>Este perfil conserva historial, pero no puede agregarse a una membresía ni utilizarse como aprobador.</span>
                    )}
                  </td>
                  <td>{u.roleNames.length ? u.roleNames.join(', ') : <Badge variant="neutral">Sin rol</Badge>}</td>
                  <td><Badge variant={GROUP_BADGE[u.group] || 'neutral'}>{GROUP_LABELS[u.group] || u.group}</Badge></td>
                  <td><span className={s.cellSub}>{formatDate(u.created_at)}</span></td>
                  <td><button className={s.smallBtn} onClick={() => setAssignTarget(u)}>Cambiar rol</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Membresías */}
      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <select value={membershipProfile} onChange={(e) => setMembershipProfile(e.target.value)} aria-label="Usuario para membresía">
            <option value="">Seleccionar usuario...</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{userOptionLabel(u)}</option>)}
          </select>
          <select value={membershipCompany} onChange={(e) => setMembershipCompany(e.target.value)} aria-label="Empresa para membresía">
            <option value="">Seleccionar empresa...</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{companyOptionLabel(c)}</option>)}
          </select>
          <button type="button" className={s.primaryBtn} disabled={savingMembership} onClick={saveMembership}>Agregar membresía</button>
        </div>
        <div className={s.sectionNote}>
          <strong>Alcance usuario–empresa</strong>
          <p>Define en qué empresas puede operar cada perfil.</p>
          <p>Solo los perfiles activos pueden recibir una membresía. El rol y el estado del perfil son controles independientes.</p>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Usuario</th><th>Empresa</th><th>Estatus</th><th>Acción</th></tr></thead>
            <tbody>
              {routingError && <tr><td colSpan={4} className={`${s.tableMsg} ${s.tableErr}`}>{routingError}</td></tr>}
              {!routingError && memberships.length === 0 && (
                <tr><td colSpan={4} className={s.tableMsg}>No hay membresías configuradas.</td></tr>
              )}
              {!routingError && memberships.map((row) => {
                const userActive = users.find((u) => u.id === row.profile_id)?.active === true
                return (
                  <tr key={row.id}>
                    <td>
                      <span className={s.cellMain}>{row.profile_name || 'Sin nombre'}</span>
                      <span className={s.cellSub}>{row.profile_email || ''}</span>
                      {userActive ? null : <span className={s.cellSub} style={{ color: 'var(--ruby)' }}>Perfil inactivo; se conserva solo por historial.</span>}
                    </td>
                    <td>{row.company_name || 'Sin empresa'}</td>
                    <td><Badge variant={row.active ? 'success' : 'neutral'}>{row.active ? 'Activa' : 'Inactiva'}</Badge></td>
                    <td><button type="button" className={s.smallBtn} onClick={() => toggleMembership(row)}>{row.active ? 'Desactivar' : 'Activar'}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Aprobadores disponibles */}
      <section className={s.tableCard}>
        <div className={s.sectionNote}>
          <strong>Aprobadores disponibles por solicitante</strong>
          <p>Define las personas que un solicitante puede elegir para revisar sus solicitudes en cada empresa.</p>
        </div>
        <form className={s.toolbar} onSubmit={saveAssignment}>
          <select value={requester} onChange={(e) => onRequesterChange(e.target.value)} aria-label="Solicitante" required>
            <option value="">Seleccionar solicitante...</option>
            {activeUsers.map((u) => <option key={u.id} value={u.id}>{userOptionLabel(u)}</option>)}
          </select>
          <select
            value={assignmentCompany}
            onChange={(e) => onAssignmentCompanyChange(e.target.value)}
            aria-label="Empresa"
            required
            disabled={!requester || !requesterActiveMemberships.length}
          >
            <option value="">Seleccionar empresa...</option>
            {requesterActiveMemberships.map((row) => (
              <option key={row.company_id} value={row.company_id}>{row.company_name || 'Sin empresa'}</option>
            ))}
          </select>
          <select value={approver} onChange={(e) => setApprover(e.target.value)} aria-label="Aprobador disponible" required disabled={!approverOptions.length}>
            {!requester || !assignmentCompany ? (
              <option value="">Selecciona solicitante y empresa</option>
            ) : (
              <>
                <option value="">Seleccionar aprobador...</option>
                {approverOptions.map((row) => {
                  const roles = Array.isArray(row.eligible_roles) ? row.eligible_roles.join(', ') : ''
                  return (
                    <option key={row.profile_id} value={row.profile_id}>
                      {(row.display_name || row.email || 'Sin nombre') + (roles ? ` - ${roles}` : '')}
                    </option>
                  )
                })}
              </>
            )}
          </select>
          <button type="submit" className={s.primaryBtn} disabled={savingAssignment}>Agregar aprobador</button>
        </form>
        <div className={`${s.fieldHint} ${assignmentHelp.err ? s.err : ''}`}>{assignmentHelp.text}</div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>Solicitante</th><th>Empresa</th><th>Aprobador disponible</th><th>Rol</th><th>Estatus</th><th>Acción</th></tr></thead>
            <tbody>
              {routingError && <tr><td colSpan={6} className={`${s.tableMsg} ${s.tableErr}`}>{routingError}</td></tr>}
              {!routingError && assignments.length === 0 && (
                <tr><td colSpan={6} className={s.tableMsg}>No hay aprobadores disponibles configurados.</td></tr>
              )}
              {!routingError && assignments.map((row) => (
                <tr key={row.id}>
                  <td>
                    <span className={s.cellMain}>{row.requester_name || 'Sin nombre'}</span>
                    <span className={s.cellSub}>{row.requester_email || ''}</span>
                  </td>
                  <td>{row.company_name || 'Sin empresa'}</td>
                  <td>
                    <span className={s.cellMain}>{row.approver_name || 'Sin nombre'}</span>
                    <span className={s.cellSub}>{row.approver_email || ''}</span>
                  </td>
                  <td>{Array.isArray(row.approver_roles) && row.approver_roles.length ? row.approver_roles.join(', ') : 'Sin rol elegible'}</td>
                  <td><Badge variant={row.active ? 'success' : 'neutral'}>{row.active ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td>
                    <button type="button" className={`${s.smallBtn} ${row.active ? s.danger : ''}`} onClick={() => assignmentAction(row)}>
                      {row.active ? 'Quitar' : 'Activar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {assignTarget && (
        <AssignRoleModal
          user={assignTarget}
          onClose={() => setAssignTarget(null)}
          onSaved={() => {
            setAssignTarget(null)
            reloadAll()
          }}
        />
      )}
    </div>
  )
}
