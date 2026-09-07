import { useInstall } from './InstallProvider'
import s from './Install.module.css'

export function InstallFluxButton({ className = '', labelClassName = '', variant = 'menu' }: {
  className?: string; labelClassName?: string; variant?: 'menu' | 'login'
}) {
  const { installed, busy, install } = useInstall()
  if (installed) return null
  const label = busy ? 'Ver instrucciones de instalación' : 'Instalar Flux'
  return (
    <button type="button" className={`${s.button} ${variant === 'login' ? s.login : ''} ${className}`}
      title={label} aria-label={label} onClick={install}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={labelClassName}>{busy ? 'Ver instrucciones' : 'Instalar Flux'}</span>
    </button>
  )
}
