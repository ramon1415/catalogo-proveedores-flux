import { UsersPanel } from './UsersPanel'
import s from '../Configuracion.module.css'

// Pestaña Usuarios (SysAdmin): lista y detalle de permisos por empresa, como PROD.
// El onboarding de empresas vive ahora en su propio tab (EmpresasTab).
export function SystemTab() {
  return (
    <div className={s.panel}>
      <UsersPanel />
    </div>
  )
}
