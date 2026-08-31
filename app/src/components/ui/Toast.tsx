import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import s from './Toast.module.css'

export type ToastVariant = 'success' | 'error' | 'warning' | 'info'
type Toast = { id: number; title: string; desc?: string; variant: ToastVariant }

type ToastApi = { showToast: (title: string, desc?: string, variant?: ToastVariant) => void }

const Ctx = createContext<ToastApi | undefined>(undefined)

export function useToast(): ToastApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return v
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const showToast = useCallback((title: string, desc?: string, variant: ToastVariant = 'success') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, title, desc, variant }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <div className={s.stack}>
        {toasts.map((t) => {
          const assertive = t.variant === 'error' || t.variant === 'warning'
          return (
            <div
              key={t.id}
              className={`${s.toast} ${s[t.variant]}`}
              role={assertive ? 'alert' : 'status'}
              aria-live={assertive ? 'assertive' : 'polite'}
              aria-atomic="true"
            >
              <b>{t.title}</b>
              {t.desc && <span>{t.desc}</span>}
              <button
                className={s.close}
                type="button"
                aria-label={`Cerrar notificación: ${t.title}`}
                onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}
