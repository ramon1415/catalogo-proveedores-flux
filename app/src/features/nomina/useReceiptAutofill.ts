import { useEffect, useRef, useState } from 'react'
import { extractPdfLines } from '../../lib/pdfText'
import { parseReceiptFields, type ReceiptFields } from './receiptFields'

type Draft = ReceiptFields & { file?: File; reading: boolean; notice: string; invalid: boolean }
export const emptyReceiptDraft = (): Draft => ({ amount: '', paymentDate: '', reference: '', currency: null, reading: false, notice: '', invalid: false })

export function useReceiptAutofill(scopeKey: string) {
  const [state, setState] = useState<{ scope: string; drafts: Record<string, Draft> }>({ scope: scopeKey, drafts: {} })
  const requests = useRef(new Map<string, symbol>())
  useEffect(() => {
    requests.current.clear()
    setState({ scope: scopeKey, drafts: {} })
    return () => { requests.current.clear() }
  }, [scopeKey])

  function setDraft(channelId: string, draft: Draft) {
    setState((current) => ({ scope: scopeKey, drafts: { ...(current.scope === scopeKey ? current.drafts : {}), [channelId]: draft } }))
  }

  function clearReceipt(channelId: string) {
    requests.current.delete(channelId)
    setDraft(channelId, emptyReceiptDraft())
  }

  async function selectReceipt(channelId: string, file?: File) {
    const request = Symbol()
    requests.current.set(channelId, request)
    if (!file) { clearReceipt(channelId); return }
    if (!file.name.toLowerCase().endsWith('.pdf') || file.size < 100 || file.size > 10 * 1024 * 1024) {
      setDraft(channelId, { ...emptyReceiptDraft(), invalid: true, notice: 'Selecciona un comprobante PDF de hasta 10 MB.' })
      return
    }
    setDraft(channelId, { ...emptyReceiptDraft(), file, reading: true, notice: 'Leyendo importe, fecha y referencia del PDF…' })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const lines = await Promise.race([
        extractPdfLines(file),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('receipt_read_timeout')), 20_000) }),
      ])
      if (requests.current.get(channelId) !== request) return
      const fields = parseReceiptFields(lines)
      const missing = [!fields.amount && 'importe', !fields.paymentDate && 'fecha de pago', !fields.reference && 'referencia'].filter(Boolean)
      const notice = missing.length
        ? `No se pudo leer: ${missing.join(', ')}. Revisa el PDF y completa los datos faltantes.`
        : 'Datos leídos del PDF. Revísalos antes de conciliar.'
      setDraft(channelId, { ...fields, file, reading: false, invalid: false, notice })
    } catch (error) {
      if (requests.current.get(channelId) === request) setDraft(channelId, {
        ...emptyReceiptDraft(), file: error instanceof Error && error.message === 'invalid_pdf_signature' ? undefined : file,
        invalid: error instanceof Error && error.message === 'invalid_pdf_signature',
        notice: error instanceof Error && error.message === 'invalid_pdf_signature'
          ? 'El archivo no es un PDF válido. Selecciona el comprobante original.'
          : 'No pudimos leer los datos de este PDF. Revisa el documento y completa importe, fecha y referencia.',
      })
    } finally {
      clearTimeout(timer)
    }
  }

  function updateReceipt(channelId: string, field: 'amount' | 'paymentDate' | 'reference', value: string) {
    setState((current) => current.scope !== scopeKey ? current : {
      ...current, drafts: { ...current.drafts, [channelId]: { ...(current.drafts[channelId] || emptyReceiptDraft()), [field]: value } },
    })
  }

  return { drafts: state.scope === scopeKey ? state.drafts : {}, selectReceipt, updateReceipt, clearReceipt }
}
