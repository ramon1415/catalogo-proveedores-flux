import { useAuth } from '../lib/auth'
import logoFull from '../assets/logo-flux-verde.webp'
import s from './Login.module.css'

export default function Login() {
  const { signInWithGoogle } = useAuth()
  return (
    <div className={s.screen}>
      <main className={s.card}>
        <img className={s.logo} src={logoFull} alt="Flux Operadora" />
        <p className={s.sub}>Plataforma de gestión</p>
        <button className={s.button} onClick={signInWithGoogle}>Continuar con Google</button>
        <p className={s.powered}>Powered by <span>Quantta</span></p>
      </main>
    </div>
  )
}
