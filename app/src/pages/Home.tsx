import { useAuth } from '../lib/auth'
import { useCompany } from '../lib/company'

// F1: pantalla de prueba del kernel. Demuestra sesión hidratada + empresa activa.
// (El switcher aquí es solo para el gate; la UI final saca el select de la interfaz.)
export default function Home() {
  const { profile, session, memberships, signOut } = useAuth()
  const { companyId, companyName, schema, setCompany } = useCompany()

  return (
    <div className="center">
      <div className="card">
        <h2>F1 · Kernel + auth ✓</h2>
        <p className="muted">Sesión hidratada sin re-login (compartida con lo vanilla si mismo origen).</p>

        <div className="row"><span className="k">Usuario</span><b>{profile?.full_name ?? session?.user.email}</b></div>
        <div className="row"><span className="k">Correo</span><b>{session?.user.email}</b></div>
        <div className="row"><span className="k">Empresa activa</span><b>{companyName ?? companyId ?? '—'}</b> <code>schema: {schema}</code></div>

        <div className="row">
          <span className="k">Cambiar empresa</span>
          <select value={companyId ?? ''} onChange={(e) => setCompany(e.target.value)}>
            {memberships.length === 0 && <option value="">(sin membresías)</option>}
            {memberships.map((m) => (
              <option key={m.company_id} value={m.company_id}>{m.company_name}</option>
            ))}
          </select>
        </div>

        <button className="btn" onClick={signOut}>Cerrar sesión</button>
      </div>
    </div>
  )
}
