import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { useModules } from './lib/moduleAccess'
import Login from './pages/Login'
import LegacyModuleFrame from './pages/LegacyModuleFrame'
import { AppShell } from './components/ui/AppShell'
import AccessRequestPage from './features/access/AccessRequestPage'
import PendingAccessPage from './features/access/PendingAccessPage'
import PresupuestoAnualPage from './features/reportes/PresupuestoAnualPage'

// Intake ya completó su QA funcional. Comprobantes y Cortes conservan sus
// respaldos vanilla hasta que terminen sus validaciones independientes.
const ProviderIntakesPage = lazy(() => import('./features/provider-intakes/ProviderIntakesPage'))

export default function App() {
  const { session, profile, group, memberships, loading } = useAuth()
  const { enabled } = useModules()
  const { pathname } = useLocation()
  const accessMatch = pathname.match(/^\/acceso\/([a-z0-9_-]+)$/i)
  if (loading) return <div className="center muted">Cargando…</div>
  if (!session) return <Login />
  if (accessMatch) return <AccessRequestPage code={accessMatch[1].toLowerCase()} />
  if (!profile || group === 'pending' || group === 'inactive' || memberships.length === 0) {
    return <PendingAccessPage />
  }

  // Rutas construidas desde los módulos habilitados de la empresa activa
  // (registro ∩ company_modules). Cada módulo aporta su ruta + rutas extra.
  const routes = enabled.flatMap((m) => [
    { path: m.path, Comp: m.component },
    ...(m.extraPaths ?? []).map((p) => ({ path: p, Comp: m.component })),
  ])
  const home = enabled[0]?.path ?? '/solicitudes'

  return (
    <Suspense fallback={<div className="center muted">Cargando…</div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to={home} replace />} />
          {routes.map(({ path, Comp }) => (
            <Route key={path} path={path.slice(1)} element={<Comp />} />
          ))}
          <Route path="comprobantes-batch" element={<LegacyModuleFrame src="/legacy/comprobantes_batch.html" title="Comprobantes batch" />} />
          <Route path="solicitudes-proveedores" element={<ProviderIntakesPage />} />
          <Route path="cortes-semanales" element={<LegacyModuleFrame src="/legacy/approval_batches.html" title="Cortes semanales" />} />
          <Route path="presupuesto-anual" element={<PresupuestoAnualPage />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
