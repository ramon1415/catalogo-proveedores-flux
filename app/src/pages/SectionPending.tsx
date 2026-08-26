import { useLocation } from 'react-router-dom'
import { itemForPath } from '../components/ui/Nav/navModel'

// Sección todavía servida por la app vanilla. Mientras se migra (strangler),
// mostramos un puente que lleva a la página actual en el mismo origen.
export default function SectionPending() {
  const { pathname } = useLocation()
  const item = itemForPath(pathname)
  const label = item?.label ?? 'Esta sección'
  const href = item?.vanillaHref

  return (
    <div className="phead">
      <div>
        <h1>{label}</h1>
        <p className="muted">Esta sección todavía vive en la aplicación actual. Se migrará a la plataforma en una fase próxima.</p>
      </div>
      {href && (
        <a className="btn primary" href={href}>Abrir versión actual</a>
      )}
    </div>
  )
}
