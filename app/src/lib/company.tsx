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

// Tono de marca por empresa: pista pre-atentiva de "en qué empresa estoy" en el
// topbar y el switcher. Son los tonos suaves del grupo (durazno, amarillo, gris
// verdoso, lavanda, azul), con el logo/glifo en verde oscuro encima — igual que
// los lockups de marca. Se busca por palabra clave del NOMBRE (no por id) para
// que sea estable entre ambientes: los company_id difieren prod/dev.
const BRAND_TINTS: Array<[RegExp, string]> = [
  [/operadora/i, '#b7cbdd'],  // azul suave (mismo registro que la paleta)
  [/soporte/i, '#c8c5b1'],    // gris verdoso
  [/financiera/i, '#efceb0'], // durazno
  [/capital/i, '#f2e3a4'],    // amarillo
  [/systems/i, '#ddcee9'],    // lavanda
]

// Verde oscuro de marca: color del glifo/logo sobre cualquiera de los tintes.
export const COMPANY_INK = '#172d29'

export function companyColor(name: string | null | undefined): string {
  const n = (name ?? '').trim()
  if (!n) return 'hsl(70 10% 78%)'
  for (const [re, hex] of BRAND_TINTS) if (re.test(n)) return hex
  // Empresa aún no curada → pastel estable derivado del nombre, mismo registro.
  let h = 0
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 40% 80%)`
}

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
    if (!memberships.length) return
    const known = memberships.some((m) => m.company_id === companyId)
    // Sin empresa activa, o con una persistida que ya no pertenece al usuario → primera.
    if (!companyId || !known) setCompany(memberships[0].company_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberships])

  function setCompany(id: string) {
    setCompanyId(id)
    sessionStorage.setItem(KEY, id)
    window.dispatchEvent(new CustomEvent('flux:company-change', { detail: { companyId: id } }))
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
