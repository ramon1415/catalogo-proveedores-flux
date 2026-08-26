import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/Badge'
import type { BadgeVariant } from '../../components/ui/Badge'
import type { Member, SociosData } from './types'
import {
  formatCurrency,
  formatNumber,
  formatDate,
  memberBalance,
  chargeStatusBadge,
  incidentStatusBadge,
  invoiceStatusBadge,
  paymentMethodLabel,
} from './logic'
import s from './Configuracion.module.css'

function Section({ title, headers, rows }: { title: string; headers: string[]; rows: ReactNode[] }) {
  return (
    <>
      <div className={s.sectionHeading}>{title}</div>
      {rows.length ? (
        <div className={s.historyTableWrapper}>
          <table className={s.historyTable}>
            <thead>
              <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <p className={s.historyEmpty}>Sin registros.</p>
      )}
    </>
  )
}

export function MemberHistoryModal({
  member,
  data,
  onClose,
}: {
  member: Member
  data: SociosData
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  const id = member.id
  const charges = data.charges.filter((c) => c.member_id === id)
  const payments = data.payments.filter((p) => p.member_id === id)
  const incidents = data.incidents.filter((i) => i.member_id === id)
  const invoices = data.invoices.filter((inv) => inv.member_id === id)
  const balance = memberBalance(id, data.charges, data.payments, data.incidents, data.invoices)

  const paymentsHaveNotes = payments.some((p) => p.notes)

  const badge = ([label, variant]: [string, BadgeVariant]) => <Badge variant={variant}>{label}</Badge>

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.history}`} onCancel={onClose} onClose={onClose}>
      <div className={s.modal}>
        <div className={s.modalHead}>
          <div>
            <h2>{member.full_name || 'Historial'}</h2>
            <p>Cuotas, pagos, incidencias y facturas vinculadas al socio.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.refGrid}>
            <div className={s.refCell}>
              <span className={s.refLabel}>Saldo pendiente</span>
              <span className={s.refValue} style={{ color: balance.pending > 0 ? 'var(--amber)' : 'var(--emerald)' }}>
                {formatCurrency(balance.pending)}
              </span>
            </div>
            <div className={s.refCell}>
              <span className={s.refLabel}>Total historico</span>
              <span className={s.refValue}>{formatCurrency(balance.historic)}</span>
            </div>
            <div className={s.refCell}>
              <span className={s.refLabel}>Factor</span>
              <span className={s.refValue}>{formatNumber(member.fee_factor || 1)}</span>
            </div>
          </div>

          <Section
            title="Cuotas"
            headers={['Descripcion', 'Monto', 'Estatus', 'Vencimiento']}
            rows={charges.map((c, idx) => (
              <tr key={idx}>
                <td>{c.description || c.period_label || 'Cuota'}</td>
                <td>{formatCurrency(c.amount)}</td>
                <td>{badge(chargeStatusBadge(c.status))}</td>
                <td>{formatDate(c.due_date)}</td>
              </tr>
            ))}
          />

          <Section
            title="Pagos"
            headers={paymentsHaveNotes ? ['Fecha', 'Monto', 'Metodo', 'Notas'] : ['Fecha', 'Monto', 'Metodo']}
            rows={payments.map((p, idx) => (
              <tr key={idx}>
                <td>{formatDate(p.payment_date)}</td>
                <td>{formatCurrency(p.amount)}</td>
                <td>{paymentMethodLabel(p.payment_method)}</td>
                {p.notes ? <td>{p.notes}</td> : null}
              </tr>
            ))}
          />

          <Section
            title="Visitas / Incidencias"
            headers={['Fecha', 'Descripcion', 'Cargo', 'Estatus']}
            rows={incidents.map((i, idx) => (
              <tr key={idx}>
                <td>{formatDate(i.incident_date)}</td>
                <td>{i.description || ''}</td>
                <td>{formatCurrency(i.amount)}</td>
                <td>{badge(incidentStatusBadge(i.status))}</td>
              </tr>
            ))}
          />

          <Section
            title="Facturas"
            headers={['Folio', 'Total', 'Estatus', 'Emision']}
            rows={invoices.map((inv, idx) => (
              <tr key={idx}>
                <td>{inv.folio || '—'}</td>
                <td>{formatCurrency(inv.total)}</td>
                <td>{badge(invoiceStatusBadge(inv.status))}</td>
                <td>{formatDate(inv.issue_date)}</td>
              </tr>
            ))}
          />
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </dialog>
  )
}
