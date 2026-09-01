import { useEffect, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { fetchClosures } from './api'
import { closureStatusBadge, fmtDateTime, isRealUrl, friendlyError } from './logic'
import type { MonthlyClosure } from './types'
import s from './Dashboard.module.css'

function LinkOrDash({ url }: { url: string | null }) {
  return isRealUrl(url) ? (
    <a className={s.linkA} href={url as string} target="_blank" rel="noopener">Abrir</a>
  ) : (
    <>—</>
  )
}

export function HistoryModal({ onClose, onError }: { onClose: () => void; onError: (msg: string) => void }) {
  const [rows, setRows] = useState<MonthlyClosure[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchClosures()
      .then((data) => { if (!cancelled) setRows(data) })
      .catch((err) => { if (!cancelled) { setRows([]); onError(friendlyError(err)) } })
    return () => { cancelled = true }
  }, [onError])

  return (
    <Modal
      title="Historial de cierres"
      subtitle="Cierres mensuales registrados en el sistema."
      onClose={onClose}
      size="lg"
      actions={<button className={s.secondaryBtn} type="button" onClick={onClose}>Cerrar</button>}
    >
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr><th>Periodo</th><th>Estatus</th><th>Fecha cierre</th><th>Sheet</th><th>Slides</th><th>PDF</th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className={s.tableMsg}>Cargando...</td></tr>}
            {rows !== null && rows.length === 0 && (
              <tr><td colSpan={6} className={s.tableMsg}>Sin cierres registrados.</td></tr>
            )}
            {rows !== null && rows.map((r) => {
              const b = closureStatusBadge(r.status)
              return (
                <tr key={r.id}>
                  <td><span className={s.cellMain}>{r.period_key}</span></td>
                  <td><Badge variant={b.variant}>{b.label}</Badge></td>
                  <td>{r.closed_at ? fmtDateTime(r.closed_at) : '—'}</td>
                  <td><LinkOrDash url={r.sheet_url} /></td>
                  <td><LinkOrDash url={r.slides_url} /></td>
                  <td><LinkOrDash url={r.pdf_url} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
