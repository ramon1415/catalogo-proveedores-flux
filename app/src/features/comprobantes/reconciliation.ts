import { acceptExtraction, findReceiptCandidates, getLinkPreview, linkReceiptToRequest, previewReceiptCandidates } from './api'
import { persistIndividualReceipt } from './workflows'
import type { BatchOperation, IndividualReceipt, ReceiptCandidate } from './types'

export type ExactReceiptMatch = { operation: BatchOperation; candidate: ReceiptCandidate }

// Two individually unique suggestions can still compete for the same request
// or bank folio. Neither is safe to include in the batch confirmation.
export function nonConflictingMatches<T extends ExactReceiptMatch>(matches: T[]): { exact: T[]; conflicts: T[] } {
  const requests = new Map<string, number>()
  const folios = new Map<string, number>()
  for (const match of matches) {
    const id = match.candidate.payment_request_id
    requests.set(id, (requests.get(id) || 0) + 1)
    const folio = match.operation.bank_unique_folio
    if (folio) folios.set(folio, (folios.get(folio) || 0) + 1)
  }
  const conflicting = (match: T) => (requests.get(match.candidate.payment_request_id) || 0) > 1
    || Boolean(match.operation.bank_unique_folio && (folios.get(match.operation.bank_unique_folio) || 0) > 1)
  return { exact: matches.filter(m => !conflicting(m)), conflicts: matches.filter(conflicting) }
}

// Called ONLY from the explicit confirmation button. Merely viewing a PDF or
// loading suggestions must never record a human review or create a payment.
export async function confirmReceiptMatch({ operation, candidate, receipt }: {
  operation: BatchOperation
  candidate: ReceiptCandidate
  receipt: IndividualReceipt
}): Promise<{ request_number?: string }> {
  const extractionId = operation.extraction_id
  if (!extractionId || receipt.extractionId !== extractionId || receipt.pageCount !== 1 || !receipt.previewDataUrl) {
    throw new Error('single_page_receipt_required')
  }
  // Also resolves by extraction id, making a retry safe after acceptance or a
  // successful link whose response was lost. Other read errors are not hidden.
  let preview = await getLinkPreview(operation.bank_operation_id || extractionId).catch(error => {
    if (String(error?.message || error).includes('bank_payment_operation_not_found')) return null
    throw error
  })
  if (preview?.link?.id) {
    if (preview.link.payment_request_id !== candidate.payment_request_id) throw new Error('bank_receipt_already_linked')
    return { request_number: preview.link.request_number || candidate.request_number || undefined }
  }
  // Recheck the exact extraction the user saw, including when another session
  // accepted it meanwhile. Never attest changed data using a stale screen.
  const freshPreview = await previewReceiptCandidates(extractionId, operation.extraction_updated_at || null)
  if (!freshPreview.items.some(item => item.payment_request_id === candidate.payment_request_id)) {
    throw new Error('receipt_candidate_changed')
  }
  let operationId = preview?.operation_id || operation.bank_operation_id
  if (!operationId) {
    const accepted = await acceptExtraction(extractionId, operation.extraction_updated_at || null)
    operationId = accepted.operation_id
    if (!operationId) throw new Error('bank_payment_operation_identifier_missing')
    preview = await getLinkPreview(operationId)
  }
  await persistIndividualReceipt(operationId, preview?.evidence || null, receipt)
  const fresh = await findReceiptCandidates(operationId)
  if (!fresh.some(item => item.payment_request_id === candidate.payment_request_id)) {
    throw new Error('receipt_candidate_changed')
  }
  // Server rechecks amount, currency, provider, eligibility, one-to-one links
  // and evidence under locks. UI suggestions are never a payment authority.
  return linkReceiptToRequest(operationId, candidate.payment_request_id)
}
