import { useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { numberValue, todayValue } from '../../lib/format'
import { rpcError, validateUploadFile } from './logic'
import { createInvoice, uploadReceipt } from './api'
import type { InvoiceType } from './types'
import s from './Ingresos.module.css'

export function InvoiceModal({
  type,
  referenceId,
  title,
  subtitle,
  initialAmount,
  onClose,
  onSaved,
}: {
  type: InvoiceType
  referenceId: string
  title: string
  subtitle: string
  initialAmount: string
  onClose: () => void
  onSaved: () => void
}) {
  const { showToast } = useToast()
  const [fiscalUuid, setFiscalUuid] = useState('')
  const [seriesFolio, setSeriesFolio] = useState('')
  const [amount, setAmount] = useState(initialAmount)
  const [issueDate, setIssueDate] = useState(todayValue())
  const [xmlFile, setXmlFile] = useState<File | null>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  function onXml(e: React.ChangeEvent<HTMLInputElement>) {
    const r = validateUploadFile(e.target.files?.[0] ?? null)
    if (!r.file) e.target.value = ''
    setXmlFile(r.file)
  }
  function onPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const r = validateUploadFile(e.target.files?.[0] ?? null)
    if (!r.file) e.target.value = ''
    setPdfFile(r.file)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const amt = numberValue(amount)
    if (amt < 0) return showToast('Monto invalido', 'El monto no puede ser negativo.', 'warning')
    if (!issueDate) return showToast('Fecha requerida', 'Captura fecha de emision.', 'warning')
    setSaving(true)
    try {
      const folder = `facturas/${type}/${referenceId}`
      const [xmlPath, pdfPath] = await Promise.all([uploadReceipt(xmlFile, folder), uploadReceipt(pdfFile, folder)])
      const data = await createInvoice({
        type,
        referenceId,
        fiscalUuid: fiscalUuid.trim() || null,
        seriesFolio: seriesFolio.trim() || null,
        amount: amt,
        issueDate,
        storagePathXml: xmlPath || null,
        storagePathPdf: pdfPath || null,
      })
      showToast('Factura registrada', data?.message || 'Factura registrada.', 'success')
      onSaved()
    } catch (error) {
      showToast('Operacion no completada', rpcError(error), 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Registrando...' : 'Registrar factura'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <label>Folio fiscal
            <input value={fiscalUuid} onChange={(e) => setFiscalUuid(e.target.value)} />
          </label>
          <label>Serie/Folio
            <input value={seriesFolio} onChange={(e) => setSeriesFolio(e.target.value)} />
          </label>
          <label>Monto *
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label>Fecha emision *
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} required />
          </label>
          <label>XML (CFDI)
            <input type="file" accept="text/xml,application/xml,.xml" onChange={onXml} />
          </label>
          <label>PDF
            <input type="file" accept="application/pdf,.pdf" onChange={onPdf} />
          </label>
        </div>
        <div className={s.notice} style={{ marginTop: 12 }}>
          <span className={s.noticeTitle}>Solo registro</span>
          <span>—</span>
          <span className={s.noticeDesc}>Esta accion no timbra CFDI; solo registra la factura emitida.</span>
        </div>
      </Modal>
    </form>
  )
}
