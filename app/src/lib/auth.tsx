import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Membership = { company_id: string; company_name: string; role: string }

type AuthState = {
  session: Session | null
  profile: any | null
  memberships: Membership[]
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return v
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<any | null>(null)
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
    if (!session) {
      setProfile(null)
      setMemberships([])
      return
    }
    const uid = session.user.id
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
      .then(({ data }) => setProfile(data))
    // Placeholder: memberships desde user_roles (RBAC global de hoy).
    // Migrar a memberships(profile_id, company_id, role) con el multi-empresa.
    supabase.from('user_roles').select('roles(name)').eq('profile_id', uid)
      .then(({ data }) => {
        const roles = (data ?? []).map((r: any) => r?.roles?.name).filter(Boolean)
        setMemberships(
          roles.length
            ? [{ company_id: 'operadora', company_name: 'Operadora Tlacatecpan', role: roles[0] }]
            : [],
        )
      })
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

  return (
    <Ctx.Provider value={{ session, profile, memberships, loading, signInWithGoogle, signOut }}>
      {children}
    </Ctx.Provider>
  )
}
