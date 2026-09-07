import { useEffect, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { Badge } from '../../../components/ui/Badge'
import { loadContpaqBase, loadProjects, createProject, updateProject, setProjectActive } from '../api'
import { errorMessage, projectErrorMessage, validateProject } from '../logic'
import type { ContpaqCompany, Project } from '../types'
import s from '../Configuracion.module.css'

// Catálogo de proyectos por empresa (Finanzas). Se usa poco y solo para poder
// sumar el costo de un esfuerzo que cruza varias facturas/proveedores, así que
// la pantalla se mantiene mínima: alta, edición inline y activar/desactivar.
export function ProyectosTab() {
  const { showToast } = useToast()

  // Mismo selector propio que Mapeo CONTPAQ: el catálogo se administra por
  // empresa y Finanzas suele capturar varias seguidas sin cambiar de contexto.
  const [companies, setCompanies] = useState<ContpaqCompany[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [baseStatus, setBaseStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [baseMessage, setBaseMessage] = useState('Cargando...')

  const [projects, setProjects] = useState<Project[]>([])
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listMessage, setListMessage] = useState('Cargando...')

  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Edición inline: solo un renglón a la vez, con su borrador aparte para poder
  // cancelar sin tocar la lista cargada.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDescription, setDraftDescription] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const { companies: cs } = await loadContpaqBase()
        setCompanies(cs)
        setBaseStatus('ready')
        setCompanyId(cs[0]?.id ?? null)
      } catch (err: any) {
        setBaseStatus('error')
        setBaseMessage(errorMessage(err))
      }
    })()
  }, [])

  useEffect(() => {
    if (!companyId) return
    let active = true
    ;(async () => {
      setListStatus('loading')
      try {
        const rows = await loadProjects(companyId)
        if (!active) return
        setProjects(rows)
        setListStatus('ready')
      } catch (err: any) {
        if (!active) return
        setListStatus('error')
        setListMessage(projectErrorMessage(err))
      }
    })()
    return () => { active = false }
  }, [companyId])

  async function refresh() {
    if (!companyId) return
    try {
      setProjects(await loadProjects(companyId))
    } catch (err: any) {
      showToast('No se pudo recargar', projectErrorMessage(err), 'error')
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    if (saving || !companyId) return
    const validation = validateProject(newName)
    if (validation) { showToast('Revisa el proyecto', validation, 'warning'); return }
    setSaving(true)
    try {
      await createProject(companyId, {
        name: newName.trim(),
        description: newDescription.trim() || null,
      })
      setNewName('')
      setNewDescription('')
      showToast('Proyecto creado', 'Ya puede etiquetarse en nuevas solicitudes.', 'success')
      await refresh()
    } catch (err: any) {
      showToast('No se pudo crear el proyecto', projectErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(p: Project) {
    setEditingId(p.id)
    setDraftName(p.name)
    setDraftDescription(p.description ?? '')
  }

  function cancelEdit() {
    setEditingId(null)
    setDraftName('')
    setDraftDescription('')
  }

  async function saveEdit(p: Project) {
    if (saving) return
    const validation = validateProject(draftName)
    if (validation) { showToast('Revisa el proyecto', validation, 'warning'); return }
    setSaving(true)
    try {
      await updateProject(p.id, { name: draftName.trim(), description: draftDescription.trim() || null })
      cancelEdit()
      showToast('Proyecto actualizado', '', 'success')
      await refresh()
    } catch (err: any) {
      showToast('No se pudo actualizar el proyecto', projectErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onToggleActive(p: Project) {
    if (saving) return
    setSaving(true)
    try {
      await setProjectActive(p.id, !p.active)
      showToast(
        p.active ? 'Proyecto desactivado' : 'Proyecto reactivado',
        p.active
          ? 'Deja de aparecer en nuevas solicitudes. Sus gastos históricos se conservan.'
          : 'Vuelve a aparecer en el selector de nuevas solicitudes.',
        'success',
      )
      await refresh()
    } catch (err: any) {
      showToast('No se pudo cambiar el estatus', projectErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (baseStatus === 'error') {
    return (
      <div className={s.panel}>
        <div className={`${s.notice} ${s.warning}`}>
          <span className={s.noticeIcon}>⚠</span>
          <span>{baseMessage}</span>
        </div>
      </div>
    )
  }

  return (
    <div className={s.panel}>
      <div className={s.panelToolbar} style={{ border: 0, padding: 0 }}>
        <div>
          <h3 className={s.sectionHeading}>Proyectos</h3>
          <p className={s.sectionNote}>
            Catálogo opcional para agrupar el gasto de un esfuerzo que cruza varias facturas o proveedores.
            Solo los proyectos activos aparecen al capturar una solicitud.
          </p>
        </div>
        <select
          value={companyId ?? ''}
          onChange={(e) => setCompanyId(e.target.value || null)}
          className={s.mapInput}
          style={{ minWidth: 200, width: 'auto' }}
          disabled={baseStatus === 'loading'}
        >
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <form className={s.formGrid} onSubmit={onCreate} style={{ marginBottom: 16 }}>
        <label>Nombre del proyecto *
          <input
            className={s.mapInput}
            type="text"
            value={newName}
            maxLength={120}
            placeholder="Ej. Implementación del sistema de pagos"
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <label>Descripción
          <input
            className={s.mapInput}
            type="text"
            value={newDescription}
            maxLength={300}
            placeholder="Opcional"
            onChange={(e) => setNewDescription(e.target.value)}
          />
        </label>
        <div className={s.rowActions}>
          <button type="submit" className={s.primaryBtn} disabled={saving || !companyId}>
            {saving ? 'Guardando…' : 'Agregar proyecto'}
          </button>
        </div>
      </form>

      <section className={s.tableCard}>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Proyecto</th>
                <th>Descripción</th>
                <th>Estatus</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {listStatus === 'loading' && <tr><td colSpan={4} className={s.tableMsg}>Cargando…</td></tr>}
              {listStatus === 'error' && <tr><td colSpan={4} className={s.tableErr}>{listMessage}</td></tr>}
              {listStatus === 'ready' && projects.length === 0 && (
                <tr><td colSpan={4} className={s.tableMsg}>Esta empresa no tiene proyectos. Agrega el primero arriba.</td></tr>
              )}
              {listStatus === 'ready' && projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    {editingId === p.id ? (
                      <input className={s.mapInput} type="text" value={draftName} maxLength={120}
                        onChange={(e) => setDraftName(e.target.value)} />
                    ) : (
                      <span className={s.cellMain}>{p.name}</span>
                    )}
                  </td>
                  <td>
                    {editingId === p.id ? (
                      <input className={s.mapInput} type="text" value={draftDescription} maxLength={300}
                        placeholder="Opcional" onChange={(e) => setDraftDescription(e.target.value)} />
                    ) : (
                      <span className={s.cellSub}>{p.description || '—'}</span>
                    )}
                  </td>
                  <td>
                    <Badge variant={p.active ? 'success' : 'neutral'}>{p.active ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td>
                    <div className={s.rowActions}>
                      {editingId === p.id ? (
                        <>
                          <button type="button" className={s.smallBtn} disabled={saving} onClick={() => saveEdit(p)}>Guardar</button>
                          <button type="button" className={s.smallBtn} disabled={saving} onClick={cancelEdit}>Cancelar</button>
                        </>
                      ) : (
                        <>
                          <button type="button" className={s.smallBtn} disabled={saving} onClick={() => startEdit(p)}>Editar</button>
                          <button
                            type="button"
                            className={s.smallBtn}
                            disabled={saving}
                            // Nunca se borra: un proyecto con gastos históricos
                            // debe seguir existiendo para el reporte de costo.
                            title={p.active ? 'Deja de ofrecerse en nuevas solicitudes' : 'Vuelve a ofrecerse en nuevas solicitudes'}
                            onClick={() => onToggleActive(p)}
                          >
                            {p.active ? 'Desactivar' : 'Reactivar'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
