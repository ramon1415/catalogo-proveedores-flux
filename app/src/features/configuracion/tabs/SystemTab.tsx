import { TenantOnboardingWizard } from '../TenantOnboardingWizard'
import { UsersPanel } from './UsersPanel'
import s from '../Configuracion.module.css'

// Pestaña Sistema (SysAdmin): onboarding de tenant + gestión de usuarios/permisos
// centrada en la persona (una sola lista; el detalle gestiona rol, membresías,
// aprobadores y accesos). Antes eran 4 sub-tablas que repetían la lista de usuarios.
export function SystemTab() {
  return (
    <div className={s.panel}>
      <TenantOnboardingWizard />
      <UsersPanel />
    </div>
  )
}
