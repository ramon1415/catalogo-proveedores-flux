import { useEffect, useRef, useState } from 'react'
import { extractPdfLines } from '../../lib/pdfText'
import { parseReceiptFields, type ReceiptFields } from './receiptFields'

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
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size < 100 || file.size > 10 * 1024 * 1024) {
      setDraft(channelId, { ...emptyReceiptDraft(), invalid: true, notice: 'Selecciona un comprobante PDF de hasta 10 MB.' })
      return
    }
    setDraft(channelId, { ...emptyReceiptDraft(), file, reading: true, notice: 'Leyendo importe, fecha y referencia del PDF…' })
    let timer: ReturnType<typeof setTimeout> | undefined
    let usedOcr = false
    try {
      const lines = await Promise.race([
        extractPdfLines(file, 20, {
          ocr: true, signal: request.signal,
          onOcrProgress: (page, pages) => {
            usedOcr = true
            if (requests.current.get(channelId) === request) setDraft(channelId, {
              ...emptyReceiptDraft(), file, reading: true,
              notice: `Leyendo imagen del PDF, página ${page} de ${pages}… Puede tardar unos segundos.`,
            })
          },
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => {
          const error = new Error('receipt_read_timeout')
          request.abort(error)
          reject(error)
        }, 90_000) }),
      ])
      if (requests.current.get(channelId) !== request) return
      const fields = parseReceiptFields(lines)
      const missing = [!fields.amount && 'importe', !fields.paymentDate && 'fecha de pago', !fields.reference && 'referencia'].filter(Boolean)
      const notice = missing.length
        ? `No se pudo leer: ${missing.join(', ')}. Revisa el PDF y completa los datos faltantes.`
        : usedOcr
          ? 'Datos leídos de la imagen. Verifica importe, fecha y referencia contra el PDF antes de conciliar.'
          : 'Datos leídos del PDF. Revísalos antes de conciliar.'
      setDraft(channelId, { ...fields, file, reading: false, invalid: false, notice })
    } catch (error) {
      if (requests.current.get(channelId) === request) setDraft(channelId, {
        ...emptyReceiptDraft(), file: error instanceof Error && error.message === 'invalid_pdf_signature' ? undefined : file,
        invalid: error instanceof Error && error.message === 'invalid_pdf_signature',
        notice: error instanceof Error && error.message === 'invalid_pdf_signature'
          ? 'El archivo no es un PDF válido. Selecciona el comprobante original.'
          : error instanceof Error && error.message === 'receipt_read_timeout'
            ? 'La lectura tardó demasiado. Revisa el PDF y completa importe, fecha y referencia.'
          : 'No pudimos leer los datos de este PDF. Revisa el documento y completa importe, fecha y referencia.',
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
