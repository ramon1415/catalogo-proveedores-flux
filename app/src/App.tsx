import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import SectionPending from './pages/SectionPending'
import { AppShell } from './components/ui/AppShell'
import ProveedoresPage from './features/proveedores/ProveedoresPage'
import EfectivoPage from './features/efectivo/EfectivoPage'

const LEGACY_ROUTES = [
  'solicitudes',
  'layouts',
  'comprobantes-batch',
  'ingresos',
  'incidencias',
  'solicitudes-proveedores',
  'dashboard',
  'dashboard-anual',
  'aprobaciones',
  'cortes-semanales',
  'configuracion',
]

export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="center muted">Cargando…</div>
  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/proveedores" replace />} />
        <Route path="proveedores" element={<ProveedoresPage />} />
        <Route path="efectivo" element={<EfectivoPage />} />
        {/* Secciones aún no migradas: puente a la app vanilla. */}
        {LEGACY_ROUTES.map((path) => <Route key={path} path={path} element={<SectionPending />} />)}
        <Route path="*" element={<Navigate to="/proveedores" replace />} />
      </Route>
    </Routes>
  )
}
