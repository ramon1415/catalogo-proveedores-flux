import { supabase } from '../../lib/supabase'
import type { ProjectCostData, ProjectRow, TaggedRequest } from './types'

// Carga todo lo que el reporte de costo por proyecto necesita para un año.
// Se traen también los proyectos inactivos: uno desactivado puede conservar
// gasto histórico y su costo debe seguir siendo visible.
export async function loadProjectCostData(companyId: string, year: number): Promise<ProjectCostData> {
  const from = `${year}-01-01`
  const to = `${year + 1}-01-01`

  const [projectsR, requestsR] = await Promise.all([
    supabase
      .from('projects')
      .select('id,name,description,active')
      .eq('company_id', companyId)
      .order('name', { ascending: true }),
    supabase
      .from('payment_requests')
      .select('id,request_number,project_id,amount_requested,status,created_at,proveedor_id,beneficiary_profile_id')
      .eq('company_id', companyId)
      .not('project_id', 'is', null)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false }),
  ])
  if (projectsR.error) throw projectsR.error
  if (requestsR.error) throw requestsR.error

  const projects = (projectsR.data ?? []) as ProjectRow[]
  const requests = (requestsR.data ?? []) as TaggedRequest[]

  // Los nombres se resuelven con dos catálogos aparte en vez de un embed de
  // PostgREST: no dependemos de cómo estén declaradas las FK y el reporte no
  // se cae si una relación cambia de nombre.
  const proveedorIds = [...new Set(requests.map((r) => r.proveedor_id).filter(Boolean))] as string[]
  const profileIds = [...new Set(requests.map((r) => r.beneficiary_profile_id).filter(Boolean))] as string[]

  const [proveedoresR, profilesR] = await Promise.all([
    proveedorIds.length
      ? supabase.from('proveedores').select('id,alias,nombre_completo').in('id', proveedorIds)
      : Promise.resolve({ data: [], error: null }),
    profileIds.length
      ? supabase.from('profiles').select('id,full_name').in('id', profileIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const proveedorNames = new Map<string, string>()
  for (const p of (proveedoresR.data ?? []) as Array<{ id: string; alias: string | null; nombre_completo: string | null }>) {
    proveedorNames.set(p.id, p.alias || p.nombre_completo || 'Proveedor sin nombre')
  }
  const profileNames = new Map<string, string>()
  for (const p of (profilesR.data ?? []) as Array<{ id: string; full_name: string | null }>) {
    profileNames.set(p.id, p.full_name || 'Sin nombre')
  }

  return { projects, requests, proveedorNames, profileNames }
}
