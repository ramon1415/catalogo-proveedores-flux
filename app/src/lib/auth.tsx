import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { groupFromRoles, perms, ROLE_GROUPS } from './roles'
import { hasPlatformPowerEmail } from './platformPower'
import type { RoleGroup } from './roles'

export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  auth_user_id: string | null
  active: boolean | null
}

export type Membership = { company_id: string; company_name: string; role: string | null }

type AuthState = {
  session: Session | null
  profile: Profile | null
  roles: string[]
  group: RoleGroup
  memberships: Membership[]
  loading: boolean
  // Permisos (espejo de FluxAuth.* del vanilla)
  canManageProviders: () => boolean
  canCreateProviders: () => boolean
  isPending: () => boolean
  signInWithGoogle: (redirectTo?: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return v
}

// Resuelve o crea el perfil autenticado mediante una función server-side. La
// función valida auth.uid() contra auth.users y puede enlazar de forma segura un
// perfil previamente sembrado por email. El fallback conserva compatibilidad
// mientras la migración se publica en un Preview.
async function resolveProfile(session: Session): Promise<Profile | null> {
  const ensured = await supabase.rpc('ensure_current_profile')
  const ensuredRow = Array.isArray(ensured.data) ? ensured.data[0] : ensured.data
  if (ensuredRow?.id) return ensuredRow as Profile

  const missingRpc = ensured.error && ['42883', 'PGRST202'].includes(ensured.error.code || '')
  if (ensured.error && !missingRpc) throw ensured.error

  const lookups: Array<[string, string | undefined]> = [
    ['auth_user_id', session.user.id],
    ['email', session.user.email ?? undefined],
  ]
  for (const [column, value] of lookups) {
    if (!value) continue
    const { data } = await supabase
      .from('profiles')
      .select('id,email,full_name,auth_user_id,active')
      .eq(column, value)
      .maybeSingle()
    if (data?.id) return data as Profile
  }
  return null
}

async function resolveRoles(profileId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role_id, roles(name)')
    .eq('profile_id', profileId)
  if (error) return []
  return (data ?? [])
    .map((row: any) => String(row?.roles?.name ?? '').trim().toLowerCase())
    .filter(Boolean)
}

// Empresas y rol efectivo de cada una. Durante previews anteriores a la
// migración, role_key puede no existir: ese caso queda sin rol (fail-closed).
async function resolveMemberships(profileId: string, legacyRoles: string[]): Promise<Membership[]> {
  let { data, error } = await supabase
    .from('profile_company_memberships')
    .select('company_id, role_key, active, companies(id, name, legal_name, active)')
    .eq('profile_id', profileId)
    .eq('active', true)
  let legacyRole: string | null = null
  if (error && ['42703', 'PGRST204'].includes(error.code || '')) {
    const fallback = await supabase
      .from('profile_company_memberships')
      .select('company_id, active, companies(id, name, legal_name, active)')
      .eq('profile_id', profileId)
      .eq('active', true)
    data = fallback.data as any
    error = fallback.error
    legacyRole = legacyRoles[0] ?? null
  }
  if (error) return []
  return (data ?? [])
    .filter((m: any) => m.companies && m.companies.active !== false)
    .map((m: any) => ({
      company_id: m.company_id,
      company_name: m.companies.name || m.companies.legal_name || 'Empresa',
      role: m.role_key ? String(m.role_key).trim().toLowerCase() : legacyRole,
    }))
    .sort((a, b) => a.company_name.localeCompare(b.company_name))
}

function sameAuthSession(current: Session | null, next: Session | null): boolean {
  if (current === next) return true
  if (!current || !next) return current === next
  return current.user.id === next.user.id && current.access_token === next.access_token
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [globalRoles, setGlobalRoles] = useState<string[]>([])
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    () => sessionStorage.getItem('flux.company'),
  )
  const [sessionReady, setSessionReady] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Hidrata la sesión existente (compartida con lo vanilla si mismo origen).
    supabase.auth.getSession().then(({ data }) => {
      setSession((current) => sameAuthSession(current, data.session) ? current : data.session)
      setSessionReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession((current) => sameAuthSession(current, s) ? current : s)
      setSessionReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const syncCompany = (event: Event) => {
      const detail = (event as CustomEvent<{ companyId?: string }>).detail
      setSelectedCompanyId(detail?.companyId || sessionStorage.getItem('flux.company'))
    }
    window.addEventListener('flux:company-change', syncCompany)
    return () => window.removeEventListener('flux:company-change', syncCompany)
  }, [])

  useEffect(() => {
    if (!sessionReady) return
    let cancelled = false
    setLoading(true)
    if (!session) {
      setProfile(null)
      setGlobalRoles([])
      setMemberships([])
      setLoading(false)
      return
    }
    ;(async () => {
      const prof = await resolveProfile(session)
      if (cancelled) return
      setProfile(prof)
      if (!prof) {
        setGlobalRoles([])
        setMemberships([])
        setLoading(false)
        return
      }
      if (prof.active === false) {
        setGlobalRoles([])
        setMemberships([])
        setLoading(false)
        return
      }
      const r = await resolveRoles(prof.id)
      if (cancelled) return
      setGlobalRoles(r)
      const mem = await resolveMemberships(prof.id, r)
      if (cancelled) return
      setMemberships(mem)
      setLoading(false)
    })().catch(() => {
      if (cancelled) return
      setProfile(null)
      setGlobalRoles([])
      setMemberships([])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
    // Perfil, roles y memberships pertenecen a la identidad. Un refresh del
    // token no debe volver a loading ni desmontar rutas/iframes ya autenticados.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, sessionReady])

  async function signInWithGoogle(redirectTo?: string) {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: new URL(redirectTo || '/app/', window.location.origin).toString() },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  const globalGroup = useMemo(() => groupFromRoles(globalRoles), [globalRoles])
  const hasPlatformPower = globalGroup === ROLE_GROUPS.SYSADMIN
    && hasPlatformPowerEmail(profile?.email)
  const effectiveMembership = useMemo(
    () => memberships.find((membership) => membership.company_id === selectedCompanyId) ?? memberships[0] ?? null,
    [memberships, selectedCompanyId],
  )
  const roles = useMemo(
    () => hasPlatformPower
      ? globalRoles
      : effectiveMembership?.role
        ? [effectiveMembership.role]
        : [],
    [effectiveMembership, globalRoles, hasPlatformPower],
  )
  const group = profile?.active === false ? ROLE_GROUPS.INACTIVE : groupFromRoles(roles)

  const value: AuthState = {
    session,
    profile,
    roles,
    group,
    memberships,
    loading,
    canManageProviders: () => perms.canManageProviders(group),
    canCreateProviders: () => perms.canCreateProviders(group),
    isPending: () => perms.isPending(group),
    signInWithGoogle,
    signOut,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
