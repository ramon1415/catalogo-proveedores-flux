import { Modal } from '../../components/ui/Modal'
import { isRealUrl } from './logic'
import type { KpiCierre } from './types'
import s from './Dashboard.module.css'

// Espejo de openExport(): lista URLs reales existentes; los 3 botones sólo emiten
// un toast "Exportacion pendiente" (la conexión a Drive/n8n sigue sin implementar).
export function ExportModal({
  cierre,
  onExportPending,
  onClose,
}: {
  cierre: KpiCierre
  onExportPending: () => void
  onClose: () => void
}) {
  const links = ([
    ['Sheet existente', cierre.sheet_url],
    ['Reporte Slides', cierre.slides_url],
    ['PDF existente', cierre.pdf_url],
  ] as [string, string | null | undefined][]).filter(([, url]) => isRealUrl(url))

  return (
    <Modal
      title="Exportar a Google Drive"
      subtitle="La conexion real se implementara mediante n8n."
      onClose={onClose}
      actions={<button className={s.secondaryBtn} type="button" onClick={onClose}>Cerrar</button>}
    >
      <div className={s.summaryList}>
        {links.length ? (
          links.map(([label, url]) => (
            <div key={label} className={s.summaryRow}>
              <span>{label}</span>
              <strong><a className={s.linkA} href={url as string} target="_blank" rel="noopener">Abrir</a></strong>
            </div>
          ))
        ) : (
          <p className={s.emptyNote}>La exportacion a Google Drive se conectara mediante n8n.</p>
        )}
      </div>
      <div className={s.exportButtons}>
        <button className={s.secondaryBtn} type="button" onClick={onExportPending}>Actualizar Sheet</button>
        <button className={s.secondaryBtn} type="button" onClick={onExportPending}>Generar reporte</button>
        <button className={s.primaryBtn} type="button" onClick={onExportPending}>Exportar ambos</button>
      </div>
    </Modal>
  )
}
