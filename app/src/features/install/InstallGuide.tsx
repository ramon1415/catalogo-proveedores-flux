import { useEffect, useId, useRef } from 'react'
import s from './Install.module.css'

export function InstallGuide({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/i.test(navigator.userAgent)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  return (
    <dialog ref={ref} className={s.dialog} aria-labelledby={titleId} onCancel={onClose} onClose={onClose}>
      <div className={s.guide}>
        <header className={s.head}>
          <div><p className={s.eyebrow}>Flux en tu celular</p><h2 id={titleId}>Un toque para entrar</h2></div>
          <button type="button" className={s.close} onClick={onClose} aria-label="Cerrar instrucciones">✕</button>
        </header>
        <div className={s.body}>
          <p>Agrega Flux a tu pantalla de inicio para abrirlo desde su ícono.</p>
          {failed && <p role="status">No se pudo abrir la instalación. Puedes agregar Flux desde el menú de tu navegador.</p>}
          {ios ? (
            <ol className={s.steps}>
              <li>Abre esta dirección en <strong>Safari</strong>.</li>
              <li>Toca <strong>Compartir</strong> y elige <strong>Agregar a Inicio</strong> o <strong>Añadir a pantalla de inicio</strong>.</li>
              <li>Si aparece <strong>Abrir como app web</strong>, actívalo. Toca <strong>Agregar</strong>.</li>
            </ol>
          ) : android ? (
            <ol className={s.steps}>
              <li>Abre esta dirección en <strong>Chrome</strong>.</li>
              <li>Toca el menú <strong>⋮</strong> y busca <strong>Instalar aplicación</strong> o <strong>Instalar y crear acceso directo</strong>. En algunas versiones dice <strong>Agregar a la pantalla principal</strong>.</li>
              <li>Elige <strong>Instalar</strong>, si está disponible, y confirma.</li>
            </ol>
          ) : (
            <div className={s.steps}>
              <p>En un navegador compatible, abre su menú y busca la opción para <strong>instalar Flux</strong>.</p>
              <p>En Android, utiliza Chrome. En iPhone, abre Flux en Safari y elige <strong>Compartir → Agregar a Inicio</strong>.</p>
            </div>
          )}
          <p className={s.note}>Usarás tu misma cuenta. Es posible que debas iniciar sesión al abrirlo por primera vez. Necesitas conexión a internet para trabajar en Flux.</p>
        </div>
        <footer className={s.actions}><button type="button" className={s.done} onClick={onClose}>Entendido</button></footer>
      </div>
    </dialog>
  )
}
