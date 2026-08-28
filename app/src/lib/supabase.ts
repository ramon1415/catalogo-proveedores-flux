import { createClient } from '@supabase/supabase-js'

type FluxRuntimeConfig = {
  supabaseUrl?: string
  supabaseAnonKey?: string
}

declare global {
  interface Window {
    FLUX_ENV_CONFIG?: FluxRuntimeConfig
  }
}

const runtime = window.FLUX_ENV_CONFIG
const url = import.meta.env.VITE_SUPABASE_URL || runtime?.supabaseUrl
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY || runtime?.supabaseAnonKey

if (!url || !anon) {
  throw new Error('Falta configuración pública de Supabase para Flux')
}

// Un solo cliente. Mismo proyecto + mismo origen que lo vanilla => sesión compartida:
// supabase-js persiste en localStorage bajo `sb-<project-ref>-auth-token`, así que la
// SPA lee la sesión existente sin re-login. (Este es el GATE de F1.)
export const supabase = createClient(url, anon)

export const isDevSupabaseProject = (() => {
  try {
    return new URL(url).hostname.split('.')[0] === 'scsirgbuqjcwoaxfacth'
  } catch {
    return false
  }
})()
