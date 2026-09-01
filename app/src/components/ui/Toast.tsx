import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
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
  const [activeDialog, setActiveDialog] = useState<HTMLDialogElement | null>(null)
  const seq = useRef(0)

  // Native modal dialogs live in the browser's top layer. A fixed toast mounted
  // under <body> can never paint above that layer, regardless of z-index. Keep
  // the viewport inside the topmost open dialog and move it back automatically
  // when the dialog closes.
  useEffect(() => {
    const syncActiveDialog = () => {
      const openDialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
      setActiveDialog(openDialogs.item(openDialogs.length - 1))
    }

    syncActiveDialog()
    const observer = new MutationObserver(syncActiveDialog)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    })
    return () => observer.disconnect()
  }, [])

  const showToast = useCallback((title: string, desc?: string, variant: ToastVariant = 'success') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, title, desc, variant }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000)
  }, [])

  const viewport = (
    <div className={s.stack} data-toast-viewport>
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
  )

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      {activeDialog ? createPortal(viewport, activeDialog) : viewport}
    </Ctx.Provider>
  )
}
