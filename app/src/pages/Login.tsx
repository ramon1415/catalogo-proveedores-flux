import { useAuth } from '../lib/auth'
import logoFull from '../assets/logo-flux-verde.webp'

export default function Login() {
  const { signInWithGoogle } = useAuth()
  return (
    <div className="center">
      <div className="card login">
        <img className="login-logo" src={logoFull} alt="Flux" />
        <p className="muted">Plataforma de gestión</p>
        <button className="btn primary" onClick={signInWithGoogle}>
          Continuar con Google
        </button>
      </div>
    </div>
  )
}
