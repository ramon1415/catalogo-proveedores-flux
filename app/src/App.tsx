import { useAuth } from './lib/auth'
import Login from './pages/Login'
import { AppShell } from './components/ui/AppShell'

export default function App() {
  const { session, loading } = useAuth()
  if (loading) return <div className="center muted">Cargando…</div>
  if (!session) return <Login />

  return (
    <AppShell kicker="Operación · Solicitudes">
      <div className="phead">
        <div>
          <h1>Solicitudes de pago</h1>
          <p className="muted">Bandeja de solicitudes del periodo</p>
        </div>
      </div>
      <div className="card wide">
        <b>F2 · Design system + menú ✓</b>
        <p className="muted">
          El shell con nav colapsable (expande en hover), íconos SVG, tema claro/oscuro y contexto de empresa.
          Las features (tabla, filtros, modal) llegan al migrar cada pantalla en F3+.
        </p>
      </div>
    </AppShell>
  )
}
