import { useEffect, useRef, useState } from 'react'
import { extractPdfLines } from '../../lib/pdfText'
import { parseReceiptFields, type ReceiptFields } from './receiptFields'
import { prepareReceiptPdf, receiptPreparationError, receiptSelectionError } from './receiptUpload'

type Draft = ReceiptFields & { file?: File; reading: boolean; notice: string; invalid: boolean }
export const emptyReceiptDraft = (): Draft => ({ amount: '', paymentDate: '', reference: '', currency: null, reading: false, notice: '', invalid: false })

export function useReceiptAutofill(scopeKey: string) {
  const [state, setState] = useState<{ scope: string; drafts: Record<string, Draft> }>({ scope: scopeKey, drafts: {} })
  const requests = useRef(new Map<string, AbortController>())
  useEffect(() => {
    requests.current.forEach((request) => request.abort())
    requests.current.clear()
    setState({ scope: scopeKey, drafts: {} })
    return () => {
      requests.current.forEach((request) => request.abort())
      requests.current.clear()
    }
  }, [scopeKey])

  function setDraft(channelId: string, draft: Draft) {
    setState((current) => ({ scope: scopeKey, drafts: { ...(current.scope === scopeKey ? current.drafts : {}), [channelId]: draft } }))
  }

  function clearReceipt(channelId: string) {
    requests.current.get(channelId)?.abort()
    requests.current.delete(channelId)
    setDraft(channelId, emptyReceiptDraft())
  }

  async function selectReceipt(channelId: string, file?: File) {
    requests.current.get(channelId)?.abort()
    const request = new AbortController()
    requests.current.set(channelId, request)
    if (!file) { clearReceipt(channelId); return }
    const selectionError = receiptSelectionError(file)
    if (selectionError) {
      requests.current.delete(channelId)
      setDraft(channelId, { ...emptyReceiptDraft(), invalid: true, notice: selectionError })
      return
    }
    setDraft(channelId, { ...emptyReceiptDraft(), reading: true, notice: /\.pdf$/i.test(file.name)
      ? 'Leyendo importe, fecha y referencia del PDF…' : 'Preparando imagen como PDF y leyendo sus datos…' })
    let timer: ReturnType<typeof setTimeout> | undefined
    let usedOcr = false
    let preparedFile: File | undefined
    let converted = false
    try {
      const lines = await Promise.race([
        (async () => {
          const prepared = await prepareReceiptPdf(file, request.signal)
          request.signal.throwIfAborted()
          preparedFile = prepared.file
          converted = prepared.converted
          return extractPdfLines(preparedFile, 20, {
            ocr: true, signal: request.signal,
            onOcrProgress: (page, pages) => {
              usedOcr = true
              if (requests.current.get(channelId) === request) setDraft(channelId, {
                ...emptyReceiptDraft(), file: preparedFile, reading: true,
                notice: `Leyendo imagen del PDF, página ${page} de ${pages}… Puede tardar unos segundos.`,
              })
            },
          })
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          const error = new Error('receipt_read_timeout')
          request.abort(error)
          reject(error)
        }, 90_000) }),
      ])
      if (requests.current.get(channelId) !== request) return
      const fields = parseReceiptFields(lines)
      const missing = [!fields.amount && 'importe', !fields.paymentDate && 'fecha de pago', !fields.reference && 'referencia'].filter(Boolean)
      const notice = (converted ? 'Imagen convertida automáticamente a PDF. ' : '') + (missing.length
        ? `No se pudo leer: ${missing.join(', ')}. Revisa el comprobante y completa los datos faltantes.`
        : usedOcr
          ? 'Datos leídos de la imagen. Verifica importe, fecha y referencia contra el comprobante antes de conciliar.'
          : 'Datos leídos del PDF. Revísalos antes de conciliar.')
      setDraft(channelId, { ...fields, file: preparedFile, reading: false, invalid: false, notice })
    } catch (error) {
      if (requests.current.get(channelId) === request) setDraft(channelId, {
        ...emptyReceiptDraft(), file: error instanceof Error && error.message === 'invalid_pdf_signature' ? undefined : preparedFile,
        invalid: !preparedFile || (error instanceof Error && error.message === 'invalid_pdf_signature'),
        notice: !preparedFile ? receiptPreparationError(error) : error instanceof Error && error.message === 'invalid_pdf_signature'
          ? 'El archivo no es un PDF válido. Selecciona el comprobante original.'
          : error instanceof Error && error.message === 'receipt_read_timeout'
            ? `${converted ? 'Imagen convertida a PDF. ' : ''}La lectura tardó demasiado. Revisa el comprobante y completa importe, fecha y referencia.`
          : `${converted ? 'Imagen convertida a PDF. ' : ''}No pudimos leer los datos de este comprobante. Revísalo y completa importe, fecha y referencia.`,
      })
    } finally {
      clearTimeout(timer)
      if (requests.current.get(channelId) === request) requests.current.delete(channelId)
    }
  }

  function updateReceipt(channelId: string, field: 'amount' | 'paymentDate' | 'reference', value: string) {
    setState((current) => current.scope !== scopeKey ? current : {
      ...current, drafts: { ...current.drafts, [channelId]: { ...(current.drafts[channelId] || emptyReceiptDraft()), [field]: value } },
    })
  }

  return { drafts: state.scope === scopeKey ? state.drafts : {}, selectReceipt, updateReceipt, clearReceipt }
}
