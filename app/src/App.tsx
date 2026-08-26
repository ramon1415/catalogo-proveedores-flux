import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth'
import Login from './pages/Login'
import SectionPending from './pages/SectionPending'
import { AppShell } from './components/ui/AppShell'
import ProveedoresPage from './features/proveedores/ProveedoresPage'

export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="center muted">Cargando…</div>
  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/proveedores" replace />} />
        <Route path="proveedores" element={<ProveedoresPage />} />
        {/* Secciones aún no migradas: puente a la app vanilla. */}
        <Route path="solicitudes" element={<SectionPending />} />
        <Route path="layouts" element={<SectionPending />} />
        <Route path="efectivo" element={<SectionPending />} />
        <Route path="ingresos" element={<SectionPending />} />
        <Route path="incidencias" element={<SectionPending />} />
        <Route path="dashboard" element={<SectionPending />} />
        <Route path="aprobaciones" element={<SectionPending />} />
        <Route path="configuracion" element={<SectionPending />} />
        <Route path="*" element={<Navigate to="/proveedores" replace />} />
      </Route>
    </Routes>
  )
}
