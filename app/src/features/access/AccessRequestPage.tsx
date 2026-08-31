import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import logoFull from '../../assets/logo-flux-verde.webp'
import { requestCompanyAccess } from './api'
import type { CompanyAccessResult } from './api'
import s from './AccessRequestPage.module.css'

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; result: CompanyAccessResult }
  | { kind: 'error'; message: string }

const FRIENDLY_ERRORS: Record<string, string> = {
  company_access_link_not_found: 'La liga no corresponde a una empresa activa.',
  profile_required: 'No fue posible registrar tu perfil. Cierra sesión e inténtalo nuevamente.',
  authenticated_email_required: 'Tu cuenta de Google no proporcionó un correo válido.',
  profile_email_already_linked: 'Este correo ya está vinculado a otra identidad. Contacta al administrador.',
}

function friendlyError(error: any): string {
  const raw = error?.message || String(error || '')
  const key = Object.keys(FRIENDLY_ERRORS).find((item) => raw.includes(item))
  return key ? FRIENDLY_ERRORS[key] : 'No pudimos registrar la solicitud. Inténtalo nuevamente o contacta al administrador.'
}

export default function AccessRequestPage({ code }: { code: string }) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    requestCompanyAccess(code)
      .then((result) => { if (!cancelled) setState({ kind: 'ready', result }) })
      .catch((error) => { if (!cancelled) setState({ kind: 'error', message: friendlyError(error) }) })
    return () => { cancelled = true }
  }, [code])

  const ready = state.kind === 'ready' ? state.result : null
  const alreadyGranted = ready?.status === 'already_member' || ready?.status === 'approved'

  return (
    <main className={s.screen}>
      <section className={s.card} aria-live="polite">
        <img className={s.logo} src={logoFull} alt="Flux" />
        <div className={`${s.icon} ${state.kind === 'error' ? s.danger : ready ? s.success : ''}`}>
          {state.kind === 'loading' ? '…' : state.kind === 'error' ? '!' : alreadyGranted ? '✓' : '✓'}
        </div>

        {state.kind === 'loading' && (
          <>
            <h1>Registrando tu solicitud</h1>
            <p>Estamos identificando la empresa asociada a esta liga.</p>
          </>
        )}

        {state.kind === 'error' && (
          <>
            <h1>No se pudo solicitar acceso</h1>
            <p>{state.message}</p>
            <div className={s.actions}>
              <button className={s.button} type="button" onClick={() => window.location.reload()}>Reintentar</button>
            </div>
          </>
        )}

        {ready && !alreadyGranted && (
          <>
            <h1>Solicitud enviada</h1>
            <p>Tu cuenta quedó registrada. Un administrador debe asignarte un rol antes de que puedas entrar.</p>
            <div className={s.company}>{ready.company_name}</div>
            <div className={s.actions}>
              <button className={s.button} type="button" onClick={() => window.location.reload()}>Actualizar acceso</button>
            </div>
          </>
        )}

        {ready && alreadyGranted && (
          <>
            <h1>Acceso disponible</h1>
            <p>Tu cuenta ya pertenece a esta empresa.</p>
            <div className={s.company}>{ready.company_name}</div>
            <div className={s.actions}>
              <button className={s.button} type="button" onClick={() => navigate('/solicitudes', { replace: true })}>Entrar a Flux</button>
            </div>
          </>
        )}

        <p className={s.powered}>Powered by Quantta</p>
      </section>
    </main>
  )
}
