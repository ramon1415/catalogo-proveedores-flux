import { useEffect, useRef, useState } from 'react'
import { extractPdfLines } from '../../lib/pdfText'
import { prepareReceiptPdf, RECEIPT_ACCEPT, receiptSelectionError } from '../nomina/receiptUpload'
import { parseConvenioReceipt, type ConvenioReceiptData } from './convenioReceipt'
import s from './Solicitudes.module.css'

export function ConvenioReceiptUpload({ scopeKey, disabled, onPrepared, onRead, onBusyChange }: {
  scopeKey: string
  disabled?: boolean
  onPrepared?: (file: File | null) => void
  onRead: (data: ConvenioReceiptData) => string | void
  onBusyChange: (busy: boolean) => void
}) {
  const controller = useRef<AbortController | null>(null)
  const [hint, setHint] = useState('PDF, JPG o PNG · máx. 10 MB. Completa los campos desde el recibo y revísalos antes de enviar.')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setBusy(false)
    setHint('PDF, JPG o PNG · máx. 10 MB. Completa los campos desde el recibo y revísalos antes de enviar.')
    return () => { controller.current?.abort(); controller.current = null; onBusyChange(false) }
  }, [scopeKey, onBusyChange])

  async function read(source: File | null) {
    controller.current?.abort()
    controller.current = null
    onPrepared?.(null)
    setBusy(false); onBusyChange(false)
    if (!source) { setHint('Selecciona el recibo o captura los datos manualmente.'); return }
    const problem = receiptSelectionError(source)
    if (problem) { setHint(problem); return }
    const current = new AbortController()
    controller.current = current
    setBusy(true); onBusyChange(true); setHint(`Leyendo ${source.name}…`)
    const timer = setTimeout(() => current.abort(new Error('La lectura tardó demasiado. Usa un recibo más nítido o captura los datos manualmente.')), 90000)
    try {
      const prepared = await prepareReceiptPdf(source, current.signal)
      if (controller.current !== current) return
      onPrepared?.(prepared.file)
      const lines = await extractPdfLines(prepared.file, 20, { ocr: true, signal: current.signal,
        onOcrProgress: (page, pages) => { if (controller.current === current) setHint(`Leyendo imagen · página ${page} de ${pages}…`) },
      })
      current.signal.throwIfAborted()
      if (controller.current !== current) return
      const result = parseConvenioReceipt(lines)
      const warning = onRead(result)
      setHint(warning || `Datos leídos de ${source.name}${result.service ? ` · servicio ${result.service}` : ''}. Revisa proveedor, monto, referencia y concepto antes de enviar.`)
    } catch (error) {
      if (controller.current !== current) return
      const message = error instanceof Error ? error.message : ''
      setHint(message && !/^[a-z_]+$/.test(message) ? message : 'No se pudo leer el recibo. Usa un PDF, JPG o PNG nítido o captura los datos manualmente.')
    } finally {
      clearTimeout(timer)
      if (controller.current === current) { controller.current = null; setBusy(false); onBusyChange(false) }
    }
  }

  return <div className={s.fullRow}>
    <label>Cargar convenio o recibo
      <input key={scopeKey} type="file" accept={RECEIPT_ACCEPT} disabled={disabled} onChange={event => read(event.target.files?.[0] ?? null)} />
    </label>
    <p className={s.fieldHint} role="status" aria-live="polite" aria-busy={busy}>{hint}</p>
  </div>
}
