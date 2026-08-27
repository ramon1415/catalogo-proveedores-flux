import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import { useModules } from './lib/moduleAccess'
import Login from './pages/Login'
import LegacyModuleFrame from './pages/LegacyModuleFrame'
import { AppShell } from './components/ui/AppShell'

export default function App() {
  const { session, loading } = useAuth()
  const { enabled } = useModules()
  if (loading) return <div className="center muted">Cargando…</div>
  if (!session) return <Login />

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
          <Route path="comprobantes-batch" element={<LegacyModuleFrame src="/comprobantes_batch.html" title="Comprobantes batch" />} />
          <Route path="solicitudes-proveedores" element={<LegacyModuleFrame src="/provider_intakes.html" title="Solicitudes de proveedores" />} />
          <Route path="cortes-semanales" element={<LegacyModuleFrame src="/approval_batches.html" title="Cortes semanales" />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
