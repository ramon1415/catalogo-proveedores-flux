import { lazy, Suspense } from 'react'
import { useCompany } from '../../lib/company'
import { usesLegacyIncome } from '../../lib/tenantConfig'

// Ingresos varía por empresa (el módulo está marcado tenant_variant):
// - Operadora → UI legacy de socios/cuotas/eventos (IngresosPage).
// - Cualquier otra empresa → panel genérico de ingresos recurrentes + sueltos.
const IngresosPage = lazy(() => import('./IngresosPage'))
const TenantIncomePanel = lazy(() => import('./TenantIncomePanel'))

export default function IngresosRoute() {
  const { companyId } = useCompany()
  // Mientras no se resuelve la empresa activa, no montamos ninguna variante
  // (evita cargar data de Operadora en la sesión de otra empresa).
  if (!companyId) return <div className="center muted">Cargando…</div>
  const Panel = usesLegacyIncome(companyId) ? IngresosPage : TenantIncomePanel
  return (
    <Suspense fallback={<div className="center muted">Cargando…</div>}>
      <Panel />
    </Suspense>
  )
}
