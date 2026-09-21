import { extractPdfLines } from '../../lib/pdfText'
import { prepareReceiptPdf, RECEIPT_ACCEPT, receiptPreparationError } from '../nomina/receiptUpload'
import { hasPdfSignature, loadPdfRuntime, sha256Hex } from './pdfRuntime'
import { formatBatchBytes } from './logic'
import type { BatchContext } from './types'

export const BATCH_RECEIPT_ACCEPT = RECEIPT_ACCEPT
export const BATCH_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const BATCH_READ_TIMEOUT_MS = 90_000

export function batchReceiptSelectionError(file: File, maxPdfBytes: number): string {
  const extension = file.name.match(/\.(pdf|jpe?g|png)$/i)?.[1].toLowerCase()
  if (!extension) return 'Selecciona un comprobante PDF, JPG o PNG.'
  const mime = extension === 'pdf' ? 'application/pdf' : extension === 'png' ? 'image/png' : 'image/jpeg'
  if (file.type && file.type !== mime) return 'El formato del archivo no coincide con su extensión. Selecciona el archivo original.'
  const max = extension === 'pdf' ? maxPdfBytes : Math.min(maxPdfBytes, BATCH_IMAGE_MAX_BYTES)
  if (file.size < 100 || file.size > max) return `El comprobante debe tener entre 100 bytes y ${formatBatchBytes(max)}.`
  return ''
}

// OCR cannot silently discard uncertain digits or take just the first payment
// from a collage. Native PDFs retain their existing parser/review behavior.
export function assertReadableImageReceipt(lines: string[], operation: Record<string, unknown>) {
  const normalized = lines.map(line => line.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()).filter(Boolean)
  const values = (label: RegExp) => normalized.flatMap((line, index) => {
    const match = line.match(label)
    if (!match) return []
    const raw = (match[1]?.trim() || normalized[index + 1] || '')
    // Two-column receipts put another labelled field on the same row.
    return [raw.replace(/\s+[A-Za-z][A-Za-z\s]{1,40}:.*$/, '').trim()]
  })
  const amounts = values(/\bimporte\s*:\s*(.*)$/i)
  const folios = values(/\bfolio\s+unico\s*:\s*(.*)$/i)
  const count = (label: RegExp) => normalized.reduce((sum, line) => sum + (line.match(label)?.length || 0), 0)
  if (count(/\bimporte\s*:/gi) > 1 || count(/\bfolio\s+unico\s*:/gi) > 1) throw new Error('batch_image_multiple_payments')
  const important = /importe|monto|cantidad|folio|cuenta|clabe|moneda|beneficiario|titular|estado|fecha.*aplicacion/i
  if (normalized.some((line, index) => important.test(line) && /\[ilegible\]/i.test(`${line} ${line.endsWith(':') ? normalized[index + 1] || '' : ''}`))) {
    throw new Error('batch_image_unreadable_fields')
  }
  const amount = amounts[0] || ''
  if (!/^(?:(?:MXN|MXP|USD|EUR)\s*)?\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}(?:\s*(?:MXN|MXP|USD|EUR))?$/i.test(amount)
    || folios.length !== 1 || !/^[A-Z0-9-]{8,120}$/i.test(folios[0])) {
    throw new Error('batch_image_unreadable_fields')
  }
  const source = values(/\bcuenta\s+de\s+retiro\s*:\s*(.*)$/i)
  const destination = values(/\bcuenta\s+de\s+deposito\s*:\s*(.*)$/i)
  const dates = values(/\bfecha\s+de\s+aplicacion\s*:\s*(.*)$/i)
  if (source.length !== 1 || !/^\d{10,18}$/.test(source[0])
    || destination.length > 1 || destination.some(value => !/^\d{10,18}$/.test(value))
    || dates.length !== 1 || !/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(dates[0])
    || (operation.review_issues as string[] | undefined)?.length) {
    throw new Error('batch_image_unreadable_fields')
  }
}

export async function readBatchReceipt({ file: source, context, onProgress, signal }: {
  file: File
  context: BatchContext
  onProgress: (percent: number, text: string) => void
  signal?: AbortSignal
}) {
  const maxBytes = Number(context.upload_policy?.max_file_bytes || 25 * 1024 * 1024)
  const selectionError = batchReceiptSelectionError(source, maxBytes)
  if (selectionError) throw new Error(selectionError)
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason || new Error('batch_read_cancelled'))
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new Error('batch_read_timeout')), BATCH_READ_TIMEOUT_MS)
  let abort: () => void = () => {}
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(controller.signal.reason)
    controller.signal.addEventListener('abort', abort, { once: true })
    if (controller.signal.aborted) abort()
  })
  const check = () => controller.signal.throwIfAborted()
  try {
    return await Promise.race([cancelled, (async () => {
      check()
      const image = !/\.pdf$/i.test(source.name)
      onProgress(5, image ? 'Preparando imagen…' : 'Leyendo y verificando PDF…')
      const runtime = await loadPdfRuntime()
      check()
      let file = source
      if (image) {
        try { file = (await prepareReceiptPdf(source, controller.signal, { deterministic: true })).file }
        catch (error) { check(); throw new Error(receiptPreparationError(error)) }
      }
      check()
      const bytes = await file.arrayBuffer()
      if (file.size > maxBytes) throw new Error('batch_converted_size')
      if (!hasPdfSignature(bytes)) throw new Error('invalid_pdf_signature')
      const pages: { pageNumber: number; items?: { str?: string }[]; lines?: string[] }[] = []
      if (image) {
        let lines: string[]
        try {
          lines = await extractPdfLines(file, 1, {
            ocr: true, signal: controller.signal,
            onOcrProgress: () => onProgress(20, 'Leyendo importe, beneficiario y datos bancarios de la imagen…'),
          })
        } catch { check(); throw new Error('batch_image_read_failed') }
        check()
        pages.push({ pageNumber: 1, lines })
      } else {
        const pdf = await runtime.pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise
        try {
          const maxPages = Number(context.upload_policy?.max_pages || 500)
          if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) throw new Error('invalid_pdf_page_count')
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            check()
            onProgress(8 + Math.round((pageNumber / pdf.numPages) * 22), `Leyendo página ${pageNumber} de ${pdf.numPages}…`)
            const page = await pdf.getPage(pageNumber)
            const content = await page.getTextContent()
            pages.push({ pageNumber, items: content.items })
          }
        } finally { await pdf.destroy() }
      }
      check()
      const parsed = runtime.parser.parseBbvaDocument(pages, { fileName: file.name })
      if (image) assertReadableImageReceipt(pages[0].lines!, parsed.operations[0])
      const sha256 = await sha256Hex(bytes)
      check()
      return { file, parsed, sha256, parserVersion: runtime.parser.PARSER_VERSION + (image ? '-image-ocr-v1' : '') }
    })()])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', abort)
  }
}
