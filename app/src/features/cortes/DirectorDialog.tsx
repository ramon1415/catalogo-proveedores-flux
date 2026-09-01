// Diálogo "Directores activos para futuros cortes" (espejo de directorDialog,
// syncDirectorForm, syncDirectorCandidateStatus, addDirector y removeDirector).
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { addCompanyDirector, listDirectorCandidates, removeCompanyDirector } from './api'
import { asArray, friendlyError } from './logic'
import type { Company, DirectorCandidate, DirectorRow } from './types'
import s from './Cortes.module.css'

export function DirectorDialog({
  companies,
  directors,
  activeCompanyId,
  onClose,
  onPoolChanged,
  askConfirmation,
}: {
  companies: Company[]
  directors: DirectorRow[]
  activeCompanyId: string | null
  onClose: () => void
  // El padre recarga el pool de directores; el prop `directors` baja actualizado.
  onPoolChanged: () => Promise<void>
  askConfirmation: (title: string, body: ReactNode, confirmLabel: string) => Promise<boolean>
}) {
  const [companyId, setCompanyId] = useState('')
  const [profileId, setProfileId] = useState('')
  const [candidates, setCandidates] = useState<DirectorCandidate[]>([])
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const { showToast } = useToast()

  async function loadCandidates(company: string | null) {
    try {
      setCandidates(await listDirectorCandidates(company || activeCompanyId))
    } catch (error) {
      setCandidates([])
      showToast('No se cargaron candidatos', friendlyError(error), 'warning')
    }
  }

  // Al abrir (y al cambiar de empresa) se consultan los candidatos del servidor.
  useEffect(() => { loadCandidates(companyId || null) }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeRows = useMemo(
    () => directors.filter((row) => row.company_id === companyId && row.active),
    [directors, companyId],
  )
  // Solo perfiles aún no asignados como activos.
  const available = useMemo(
    () => candidates.filter((profile) => profile.assigned_active !== true),
    [candidates],
  )
  const selected = available.find((profile) => profile.profile_id === profileId) || null

  // Si el seleccionado deja de estar disponible, se limpia (syncDirectorForm).
  useEffect(() => {
    if (profileId && !available.some((profile) => profile.profile_id === profileId)) setProfileId('')
  }, [available, profileId])

  const candidateStatus = !companyId
    ? 'Selecciona una empresa para consultar candidatos.'
    : selected
      ? `Perfil activo · Rol: ${asArray<string>(selected.roles).join(', ') || 'Dirección'} · Membresía activa.`
      : available.length
        ? 'Selecciona un perfil para continuar.'
        : 'No hay Directores elegibles pendientes de agregar.'

  const formHelp = !companyId
    ? 'Solo se muestran perfiles activos con rol Dirección y membresía activa.'
    : candidates.length
      ? 'Agregar un Director no reemplaza a los existentes. Quitar solo afecta cortes futuros.'
      : 'No hay perfiles activos con rol Dirección y membresía activa disponibles.'

  async function addDirector(event: React.FormEvent) {
    event.preventDefault()
    if (!companyId || !profileId) {
      showToast('Datos incompletos', 'Selecciona una empresa y un perfil activo con rol Dirección.', 'warning')
      return
    }
    setSaving(true)
    try {
      const data = await addCompanyDirector(companyId, profileId)
      showToast(
        data?.changed ? 'Director agregado' : 'Director ya activo',
        'El pool de futuros cortes se actualizó sin reemplazar a otros Directores ni modificar cortes existentes.',
        'success',
      )
      await onPoolChanged()
      await loadCandidates(companyId)
    } catch (error) {
      showToast('No se pudo guardar', friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function removeDirector(row: DirectorRow) {
    if (!companyId || removingId) return
    const directorName = row.director_name || row.director_email || 'Director'
    const confirmed = await askConfirmation(
      'Quitar Director',
      (
        <>
          <p>Quitarás a <strong>{directorName}</strong> del pool para cortes futuros.</p>
          <div className={s.confirmWarning}>Los cortes existentes conservan al Director asignado y no se modifican.</div>
        </>
      ),
      'Quitar',
    )
    if (!confirmed) return
    setRemovingId(row.director_profile_id)
    try {
      const data = await removeCompanyDirector(companyId, row.director_profile_id)
      showToast(
        data?.changed ? 'Director quitado' : 'Director ya inactivo',
        'Los cortes existentes y sus decisiones permanecen intactos.',
        'success',
      )
      await onPoolChanged()
      await loadCandidates(companyId)
    } catch (error) {
      showToast('No se pudo quitar', friendlyError(error), 'error')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Modal
      title="Directores activos para futuros cortes"
      subtitle="Cada corte conserva un solo Director responsable."
      onClose={onClose}
    >
      <form onSubmit={addDirector}>
        <div className={s.modalGrid}>
          <label className={s.full}>
            Empresa
            <select className={s.field} required value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProfileId('') }}>
              <option value="">Selecciona...</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>{company.legal_name || company.name}</option>
              ))}
            </select>
          </label>

          <div className={`${s.full} ${s.directorPool}`} aria-live="polite">
            <div className={s.directorPoolHead}>
              <strong>Directores activos</strong>
              <Badge variant="info">{companyId ? String(activeRows.length) : '0'}</Badge>
            </div>
            <div className={s.directorActiveList}>
              {!companyId && <div className={s.directorActiveEmpty}>Selecciona una empresa.</div>}
              {companyId && !activeRows.length && (
                <div className={s.directorActiveEmpty}>No hay Directores activos para futuros cortes.</div>
              )}
              {companyId && activeRows.map((row) => {
                const eligible = row.director_profile_active !== false
                  && row.director_role_valid !== false
                  && row.director_membership_active !== false
                const status = [
                  `Perfil: ${row.director_profile_active === false ? 'inactivo' : 'activo'}`,
                  `Rol: ${row.director_role_valid === false ? 'inválido' : 'Dirección'}`,
                  `Membresía: ${row.director_membership_active === false ? 'inactiva' : 'activa'}`,
                ].join(' · ')
                return (
                  <div key={row.director_profile_id} className={s.directorActiveCard}>
                    <div>
                      <strong>{row.director_name || row.director_email || 'Perfil sin nombre'}</strong>
                      <small>{status}</small>
                      {!eligible && (
                        <small className={s.cellNote}>No es elegible para cortes nuevos hasta corregir su perfil, rol o membresía.</small>
                      )}
                    </div>
                    <button
                      className={`${s.smallBtn} ${s.danger}`}
                      type="button"
                      disabled={activeRows.length <= 1 || removingId != null}
                      onClick={() => removeDirector(row)}
                    >
                      Quitar
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <label className={s.full}>
            Agregar Director
            <select
              className={s.field}
              required
              value={profileId}
              disabled={!companyId || !available.length}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">Selecciona...</option>
              {available.map((profile) => (
                <option key={profile.profile_id} value={profile.profile_id}>
                  {profile.name || profile.email || profile.profile_id}
                </option>
              ))}
            </select>
          </label>
          <div className={`${s.full} ${s.directorStatusLine}`}>{candidateStatus}</div>
          <div className={`${s.full} ${s.listMeta}`}>{formHelp}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cerrar</button>
          <button type="submit" className={s.primaryBtn} disabled={!selected || saving}>Agregar Director</button>
        </div>
      </form>
    </Modal>
  )
}
