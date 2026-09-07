import { TenantOnboardingWizard } from '../TenantOnboardingWizard'
import s from '../Configuracion.module.css'

// Pestaña Empresas (SysAdmin): onboarding de tenant separado de la gestión de
// usuarios para que cada tab tenga un propósito único.
export function EmpresasTab() {
  return (
    <div className={s.panel}>
      <TenantOnboardingWizard />
    </div>
  )
}
