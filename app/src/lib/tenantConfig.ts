// Empresas cuyo módulo de Ingresos usa el modelo LEGACY de Operadora
// (socios + cuotas de mantenimiento + eventos, vía income_payments/billing_periods,
// que NO está scopeado por company_id). Cualquier otra empresa usa el panel
// genérico tenant-scoped (recurring_income_templates / tenant_income_entries).
//
// Esto es intencionalmente explícito durante la etapa strangler: el subsistema de
// ingresos de Operadora es single-tenant. Cuando se generalice, reemplazar por un
// flag por empresa (p.ej. company_modules.metadata.ingresos_variant).
export const LEGACY_INCOME_COMPANY_IDS = [
  '9680353c-9b86-4730-82e1-fce664f048a2', // Operadora Tlacatecpan
  '55348443-03a1-4e0b-a10b-b08e7977d907', // Test - Demo Operadora
]

export function usesLegacyIncome(companyId: string | null | undefined): boolean {
  return !!companyId && LEGACY_INCOME_COMPANY_IDS.includes(companyId)
}
