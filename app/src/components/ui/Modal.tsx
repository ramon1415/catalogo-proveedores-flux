import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import s from './Modal.module.css'

export function Modal({
  title,
  subtitle,
  children,
  actions,
  onClose,
  size = 'md',
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  actions?: ReactNode
  onClose: () => void
  size?: 'md' | 'lg'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dlg = ref.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])
  function close() {
    ref.current?.close()
    onClose()
  }
  return (
    <dialog ref={ref} className={`${s.dialog} ${size === 'lg' ? s.lg : ''}`} onCancel={(event) => { event.preventDefault(); close() }} onClose={onClose}>
      <div className={s.content}>
        <div className={s.head}>
          <div>
            <h2>{title}</h2>
            {subtitle != null && <p className="muted">{subtitle}</p>}
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={close}>✕</button>
        </div>
        <div className={s.scroll}>{children}</div>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
    </dialog>
  )
}
