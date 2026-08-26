import { useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { assignRole } from './api'
import { GROUP_LABELS, ROLE_ALIASES, roleValueFromGroup } from './logic'
import type { UserRow } from './types'
import s from './Configuracion.module.css'

const OPTIONS: Array<{ value: string; title: string; desc: string }> = [
  { value: 'pending', title: 'Pendiente', desc: 'Sin acceso al sistema. Puede iniciar sesión pero no ver nada.' },
  { value: 'solicitante', title: 'Operativo', desc: 'Solo puede crear y ver sus propias solicitudes de pago.' },
  {
    value: 'finance',
    title: 'Financiero',
    desc: 'Acceso completo a solicitudes, layouts, efectivo, ingresos, proveedores y dashboard.',
  },
  { value: 'director', title: 'Director', desc: 'Mismo acceso que financiero más aprobaciones y cola de decisión.' },
  {
    value: 'sysadmin',
    title: 'SysAdmin',
    desc: 'Acceso total incluyendo gestión de usuarios, roles y configuración del sistema.',
  },
]

export function AssignRoleModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const [selected, setSelected] = useState(roleValueFromGroup(user.group))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  const subtitle = `${user.full_name || user.email} - rol actual: ${
    GROUP_LABELS[user.group] || user.group
  }. Perfil ${user.active === true ? 'activo' : 'inactivo'}; cambiar el rol no modifica este estado.`

  async function save() {
    if (!selected) {
      showToast('Selecciona un rol', 'Elige un nivel de acceso.', 'warning')
      return
    }
    setSaving(true)
    try {
      const aliases = ROLE_ALIASES[selected] || [selected]
      await assignRole(user.id, selected, aliases)
      showToast(
        'Rol actualizado',
        user.active === true
          ? 'El acceso del usuario fue actualizado correctamente.'
          : 'El rol se guardó, pero el perfil continúa inactivo y sin acceso operativo.',
        'success',
      )
      onSaved()
    } catch (err: any) {
      showToast('Error al guardar', err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <div className={s.modal}>
        <div className={s.modalHead}>
          <div>
            <h2>Asignar rol</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.roleOptions}>
            {OPTIONS.map((opt) => (
              <label key={opt.value} className={s.roleOption}>
                <input
                  type="radio"
                  name="assignRole"
                  value={opt.value}
                  checked={selected === opt.value}
                  onChange={() => setSelected(opt.value)}
                />
                <div className={s.roleOptionBody}>
                  <span className={s.roleOptionTitle}>{opt.title}</span>
                  <span className={s.roleOptionDesc}>{opt.desc}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="button" className={s.primaryBtn} disabled={saving} onClick={save}>
            {saving ? 'Guardando…' : 'Guardar rol'}
          </button>
        </div>
      </div>
    </dialog>
  )
}
