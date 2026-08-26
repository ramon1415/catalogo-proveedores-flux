import { useAuth } from '../lib/auth'

export default function Login() {
  const { signInWithGoogle } = useAuth()
  return (
    <div className="center">
      <div className="card login">
        <h1>Flux</h1>
        <p className="muted">Plataforma de gestión</p>
        <button className="btn primary" onClick={signInWithGoogle}>
          Continuar con Google
        </button>
      </div>
    </div>
  )
}
