import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { useCompany } from './company'
import { MODULE_REGISTRY } from './modules'
import type { ModuleDef } from './modules'

type ModuleState = {
  loading: boolean
  enabled: ModuleDef[]
  isEnabled: (key: string) => boolean
  // Versión fijada del módulo para la empresa activa (para el version-gate); null si no hay dato.
  versionFor: (key: string) => number | null
}

const Ctx = createContext<ModuleState | undefined>(undefined)

export function useModules(): ModuleState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useModules debe usarse dentro de <ModulesProvider>')
  return v
}

// Ergonomía para features que ramifican por versión.
export function useModuleVersion(key: string): number | null {
  return useModules().versionFor(key)
}

export function ModulesProvider({ children }: { children: ReactNode }) {
  const { companyId } = useCompany()
  // Fail-open: por defecto todos los módulos (comportamiento actual) hasta que
  // company_modules diga otra cosa.
  const [enabled, setEnabled] = useState<ModuleDef[]>(MODULE_REGISTRY)
  const [versions, setVersions] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!companyId) {
      setEnabled(MODULE_REGISTRY)
      setVersions({})
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('company_modules')
      .select('module_key, enabled, version')
      .eq('company_id', companyId)
      .then(({ data, error }) => {
        if (cancelled) return
        const rows = (data ?? []) as { module_key: string; enabled: boolean; version: number }[]
        // Fail-open cuando la migración no está aplicada (error) o el tenant no tiene
        // filas sembradas (rows vacío): mostrar todo, no romper la app.
        if (error || rows.length === 0) {
          setEnabled(MODULE_REGISTRY)
          setVersions({})
        } else {
          const byKey = new Map(rows.map((r) => [r.module_key, r]))
          setEnabled(MODULE_REGISTRY.filter((m) => byKey.get(m.key)?.enabled === true))
          setVersions(Object.fromEntries(rows.map((r) => [r.module_key, r.version])))
        }
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const value: ModuleState = {
    loading,
    enabled,
    isEnabled: (key) => enabled.some((m) => m.key === key),
    versionFor: (key) => (key in versions ? versions[key] : null),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
