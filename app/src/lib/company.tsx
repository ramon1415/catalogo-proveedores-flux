import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'

type CompanyState = {
  companyId: string | null
  companyName: string | null
  schema: string
  setCompany: (id: string) => void
}

const Ctx = createContext<CompanyState | undefined>(undefined)

export function useCompany(): CompanyState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCompany debe usarse dentro de <CompanyProvider>')
  return v
}

const KEY = 'flux.company'

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { memberships } = useAuth()
  const [companyId, setCompanyId] = useState<string | null>(() => sessionStorage.getItem(KEY))

  useEffect(() => {
    if (!companyId && memberships.length) setCompany(memberships[0].company_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberships])

  function setCompany(id: string) {
    setCompanyId(id)
    sessionStorage.setItem(KEY, id)
  }

  const companyName = memberships.find((m) => m.company_id === companyId)?.company_name ?? null
  // La empresa activa selecciona el schema del cliente Supabase (.schema(schema)).
  const schema = companyId ?? 'public'

  return (
    <Ctx.Provider value={{ companyId, companyName, schema, setCompany }}>
      {children}
    </Ctx.Provider>
  )
}
