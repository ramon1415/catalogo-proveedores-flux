import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import type { BudgetCategory } from './types'
import s from './Configuracion.module.css'

const NUEVO_GRUPO = '__nuevo__'

export function GrupoModal({
  category,
  categories,
  onClose,
  onSave,
}: {
  category: BudgetCategory
  categories: BudgetCategory[]
  onClose: () => void
  onSave: (grupo: string) => Promise<void> | void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const current = category.category || 'Sin grupo'
  const [selected, setSelected] = useState(current)
  const [nuevo, setNuevo] = useState('')

  const grupos = useMemo(
    () => [...new Set(categories.map((c) => c.category || 'Sin grupo'))].sort((a, b) => a.localeCompare(b, 'es')),
    [categories],
  )

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    let grupo = selected
    if (grupo === NUEVO_GRUPO) {
      grupo = nuevo.trim()
      if (!grupo) {
        showToast('Falta el nombre', 'Escribe el nombre de la nueva agrupación.', 'error')
        return
      }
    }
    await onSave(grupo)
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>Cambiar agrupación</h2>
            <p>{`${category.name} — hoy en "${current}"`}</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <label className={s.fullRow}>Agrupación
              <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                {grupos.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
                <option value={NUEVO_GRUPO}>➕ Crear nueva agrupación...</option>
              </select>
            </label>
            {selected === NUEVO_GRUPO && (
              <label className={s.fullRow}>Nombre de la nueva agrupación
                <input type="text" value={nuevo} autoFocus onChange={(e) => setNuevo(e.target.value)} placeholder="Ej. Servicios digitales" />
              </label>
            )}
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn}>Guardar</button>
        </div>
      </form>
    </dialog>
  )
}
