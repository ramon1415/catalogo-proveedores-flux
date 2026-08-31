import logoFull from '../../assets/logo-flux-verde.webp'
import { useAuth } from '../../lib/auth'
import s from './AccessRequestPage.module.css'

export default function PendingAccessPage() {
  const { profile, group, signOut } = useAuth()
  const inactive = group === 'inactive'

  return (
    <main className={s.screen}>
      <section className={s.card}>
        <img className={s.logo} src={logoFull} alt="Flux" />
        <div className={`${s.icon} ${inactive ? s.danger : ''}`}>!</div>
        <h1>{inactive ? 'Perfil inactivo' : 'Acceso pendiente'}</h1>
        <p>
          {inactive
            ? 'Tu perfil conserva su historial, pero no tiene acceso operativo.'
            : 'Tu cuenta aún no tiene un rol y una empresa activos. Usa la liga de invitación que te envió el administrador o espera su aprobación.'}
        </p>
        {profile?.email && <div className={s.company}>{profile.email}</div>}
        <div className={s.actions}>
          <button className={s.button} type="button" onClick={() => window.location.reload()}>Actualizar acceso</button>
          <button className={`${s.button} ${s.secondary}`} type="button" onClick={signOut}>Cerrar sesión</button>
        </div>
        <p className={s.powered}>Powered by Quantta</p>
      </section>
    </main>
  )
}
