import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { groupFromRoles, perms, ROLE_GROUPS } from './roles'
import type { RoleGroup } from './roles'

export type Profile = {
  id: string
  email: string | null
  full_name: string | null
  auth_user_id: string | null
  active: boolean | null
}

export type Membership = { company_id: string; company_name: string; role: string }

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
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return v
}

// Resuelve el perfil por auth_user_id y luego por email (espejo de resolveProfile
// en config.js). NO auto-crea perfil: eso queda del lado del onboarding vanilla.
async function resolveProfile(session: Session): Promise<Profile | null> {
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [roles, setRoles] = useState<string[]>([])
  const [group, setGroup] = useState<RoleGroup>(ROLE_GROUPS.PENDING)
  const [memberships, setMemberships] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Hidrata la sesión existente (compartida con lo vanilla si mismo origen).
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!session) {
      setProfile(null)
      setRoles([])
      setGroup(ROLE_GROUPS.PENDING)
      setMemberships([])
      return
    }
    ;(async () => {
      const prof = await resolveProfile(session)
      if (cancelled) return
      setProfile(prof)
      if (!prof) {
        setRoles([])
        setGroup(ROLE_GROUPS.PENDING)
        setMemberships([])
        return
      }
      if (prof.active === false) {
        setRoles([])
        setGroup(ROLE_GROUPS.INACTIVE)
        setMemberships([])
        return
      }
      const r = await resolveRoles(prof.id)
      if (cancelled) return
      setRoles(r)
      setGroup(groupFromRoles(r))
      // Placeholder de empresa: hoy el RBAC es global (una sola empresa, Operadora).
      // Migrar a memberships(profile_id, company_id, role) con el multi-empresa (F5).
      setMemberships(
        r.length
          ? [{ company_id: 'operadora', company_name: 'Operadora Tlacatecpan', role: r[0] }]
          : [],
      )
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  async function signInWithGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

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
