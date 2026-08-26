import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import SectionPending from './pages/SectionPending'
import { AppShell } from './components/ui/AppShell'

// Code-splitting por ruta: cada feature carga bajo demanda.
const ProveedoresPage = lazy(() => import('./features/proveedores/ProveedoresPage'))
const EfectivoPage = lazy(() => import('./features/efectivo/EfectivoPage'))
const AprobacionesPage = lazy(() => import('./features/aprobaciones/AprobacionesPage'))
const ConfiguracionPage = lazy(() => import('./features/configuracion/ConfiguracionPage'))
const IngresosPage = lazy(() => import('./features/ingresos/IngresosPage'))
const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'))
const SolicitudesPage = lazy(() => import('./features/solicitudes/SolicitudesPage'))
const LayoutsPage = lazy(() => import('./features/layouts/LayoutsPage'))

export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="center muted">Cargando…</div>
  if (!session) return <Login />

  return (
    <Suspense fallback={<div className="center muted">Cargando…</div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/solicitudes" replace />} />
          <Route path="proveedores" element={<ProveedoresPage />} />
          <Route path="efectivo" element={<EfectivoPage />} />
          <Route path="aprobaciones" element={<AprobacionesPage />} />
          <Route path="ingresos" element={<IngresosPage />} />
          <Route path="incidencias" element={<IngresosPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="dashboard-anual" element={<DashboardPage />} />
          <Route path="solicitudes" element={<SolicitudesPage />} />
          <Route path="layouts" element={<LayoutsPage />} />
          <Route path="configuracion" element={<ConfiguracionPage />} />
          <Route path="comprobantes-batch" element={<SectionPending />} />
          <Route path="solicitudes-proveedores" element={<SectionPending />} />
          <Route path="cortes-semanales" element={<SectionPending />} />
          <Route path="*" element={<Navigate to="/solicitudes" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
