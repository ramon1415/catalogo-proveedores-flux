import { loadPdfRuntime, sha256Hex, hasPdfSignature } from './pdfRuntime'
import {
  createBatch, finalizeBatchUpload, submitExtractions, privateBucket,
  prepareEvidence, finalizeEvidence, reviewEvidence, getEvidenceAccess,
  evidenceFilenameParts,
} from './api'
import { minorToDecimal, safeMinorInteger, sanitizeFilenamePart } from './logic'
import type { BatchContext, CreateBatchResult, IndividualReceipt, LinkEvidence } from './types'

// ── Ingesta del lote (espejo de submitBatch del vanilla) ───────────────────
export type UploadProgress = (percent: number, text: string) => void

export type UploadResult =
  | { kind: 'ok'; batchId: string; pageCount: number; parserVersion: string }
  | { kind: 'duplicate'; batchId: string; created: CreateBatchResult }

export async function uploadBatchWorkflow(params: {
  companyId: string
  file: File
  context: BatchContext
  onProgress: UploadProgress
}): Promise<UploadResult> {
  const { companyId, file, context, onProgress } = params
  onProgress(5, 'Leyendo y verificando PDF…')
  const runtime = await loadPdfRuntime()
  const bytes = await file.arrayBuffer()
  if (!hasPdfSignature(bytes)) throw new Error('invalid_pdf_signature')
  const sha256 = await sha256Hex(bytes)

  // Extracción local: pdfjs texto por página → parser BBVA. El servidor solo
  // recibe los campos extraídos, nunca el PDF por página.
  const pdf = await runtime.pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise
  const maxPages = Number(context.upload_policy?.max_pages || 500)
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) {
    throw new Error('invalid_pdf_page_count')
  }
  const pagesRaw: { pageNumber: number; items: { str?: string }[] }[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress(8 + Math.round((pageNumber / pdf.numPages) * 22), `Extrayendo página ${pageNumber} de ${pdf.numPages}…`)
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pagesRaw.push({ pageNumber, items: content.items })
  }
  const parsed = runtime.parser.parseBbvaDocument(pagesRaw as never, { fileName: file.name })

  // source_account / destination_account son propiedades no enumerables del
  // parser: se leen explícitamente, igual que el vanilla.
  const pages = (parsed.operations as Record<string, unknown>[]).map((op) => {
    const issues = (op.review_issues as string[]) || []
    return {
      page_number: op.source_page,
      amount: minorToDecimal(safeMinorInteger(op.amount_minor)),
      currency: op.currency,
      bank_name: op.bank_name,
      bank_status: op.bank_status,
      bank_unique_folio: op.bank_unique_folio,
      application_date: op.application_date,
      beneficiary_name: op.beneficiary_name,
      payment_reason: op.payment_reason,
      source_account: op.source_account,
      destination_account: op.destination_account,
      confidence: issues.length === 0 ? 0.99 : issues.length <= 2 ? 0.75 : 0.4,
    }
  })
  onProgress(35, `Extracción local: ${parsed.page_count} página(s).`)

  const created = await createBatch({ companyId, fileName: file.name, fileSizeBytes: file.size, sha256 })
  const { batch_id: batchId, document_id, storage_bucket, storage_path } = created
  if (!batchId || !document_id || !storage_bucket || !storage_path) throw new Error('upload_contract_incomplete')

  const resumeExtraction = created.duplicate && created.status === 'extracting'
  if (created.duplicate && !['awaiting_upload', 'extracting'].includes(created.status || '')) {
    onProgress(100, 'Este archivo ya fue cargado. No se creó otro lote.')
    return { kind: 'duplicate', batchId, created }
  }

  if (!resumeExtraction) {
    let uploadFinalized = false
    if (created.duplicate) {
      onProgress(50, 'Verificando el PDF recibido anteriormente…')
      const { error } = await finalizeBatchUpload(batchId, parsed.page_count)
      if (!error) uploadFinalized = true
      else if (!isMissingPaymentBatchUpload(error)) throw error
    }
    if (!uploadFinalized) {
      onProgress(54, created.duplicate ? 'Reanudando carga interrumpida…' : 'Subiendo al bucket privado autorizado…')
      const bucket = await privateBucket(storage_bucket)
      const upload = await bucket.upload(storage_path, file, { contentType: 'application/pdf', upsert: false })
      if (upload.error) throw upload.error
      onProgress(68, 'Finalizando documento…')
      const { error } = await finalizeBatchUpload(batchId, parsed.page_count)
      if (error) throw error
    }
  }

  onProgress(78, resumeExtraction ? 'Retomando extracción interrumpida…' : 'Enviando extracción a revisión interna…')
  await submitExtractions(batchId, runtime.parser.PARSER_VERSION, pages)
  onProgress(100, 'Batch recibido; extracción enviada a revisión.')
  return { kind: 'ok', batchId, pageCount: parsed.page_count, parserVersion: runtime.parser.PARSER_VERSION }
}

function isMissingPaymentBatchUpload(error: unknown): boolean {
  return String((error as { message?: string })?.message || '').includes('payment_batch_upload_not_found')
}

// ── Derivación local de la página individual ───────────────────────────────
// Descarga el PDF fuente del bucket (con token de sesión) y deriva SOLO la
// página de la operación; nunca se muestra el documento multi-página.
export async function deriveIndividualReceipt(params: {
  extractionId: string
  storageBucket: string
  storagePath: string
  pageNumber: number
}): Promise<IndividualReceipt> {
  const runtime = await loadPdfRuntime()
  const bucket = await privateBucket(params.storageBucket)
  const { data, error } = await bucket.download(params.storagePath)
  if (error || !data) throw error || new Error('source_pdf_download_unavailable')
  const sourceBlobUrl = URL.createObjectURL(data)
  try {
    const bytes = await runtime.singlePage.deriveSinglePageFromUrl({
      sourceUrl: sourceBlobUrl,
      pageNumber: params.pageNumber,
      pdfLib: runtime.pdfLib,
    })
    await runtime.singlePage.assertSinglePageBytes(bytes, runtime.pdfLib)
    const sha256 = await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
    const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
    return { extractionId: params.extractionId, bytes, blobUrl, pageCount: 1, sha256 }
  } finally {
    URL.revokeObjectURL(sourceBlobUrl)
  }
}

// ── Apertura/descarga de la evidencia persistida ───────────────────────────
// `preview` debe abrirse SÍNCRONO en el handler del click (anti popup-block);
// aquí solo se le asigna la URL. En descarga, preview es null.
export async function openPersistedEvidence(params: {
  evidenceId: string
  preview: Window | null
  download: boolean
  linkedRequestId?: string | null
  linkedRequestNumber?: string | null
}): Promise<void> {
  const runtime = await loadPdfRuntime()
  const access = await getEvidenceAccess(params.evidenceId)
  if (!access.storage_bucket || !access.storage_path) throw new Error('evidence_download_failed')
  const bucket = await privateBucket(access.storage_bucket)
  const file = await bucket.download(access.storage_path)
  if (file.error || !file.data) throw file.error || new Error('evidence_download_failed')
  const bytes = new Uint8Array(await file.data.arrayBuffer())
  await runtime.singlePage.assertSinglePageBytes(bytes, runtime.pdfLib)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }))
  if (!params.download) {
    params.preview?.location.replace(url)
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    return
  }
  let requestNumber = params.linkedRequestNumber || 'Solicitud'
  let providerName = 'Proveedor'
  if (params.linkedRequestId) {
    const identity = await evidenceFilenameParts(params.linkedRequestId).catch(() => null)
    if (identity?.requestNumber) requestNumber = identity.requestNumber
    if (identity?.providerName) providerName = identity.providerName
  }
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${sanitizeFilenamePart(requestNumber, `Solicitud-${params.evidenceId.slice(-8)}`)}_${sanitizeFilenamePart(providerName, 'Proveedor')}_Comprobante.pdf`
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// ── Persistencia de la evidencia (máquina de estados sobre evidence.status) ─
export async function persistIndividualReceipt(operationId: string, evidence: LinkEvidence | null, receipt: IndividualReceipt): Promise<void> {
  if (!receipt.bytes || receipt.pageCount !== 1) throw new Error('single_page_receipt_required')
  let current: LinkEvidence = evidence ?? {}
  if (current.status === 'shareable') return // idempotente

  if (!current.id) {
    if (current.evidence_id) current = { ...current, id: current.evidence_id }
    else current = await prepareEvidence(operationId)
  }
  const evidenceId = current.id || current.evidence_id
  if (!evidenceId) throw new Error('payment_evidence_identifier_missing')

  if (current.status === 'pending_upload' || !current.status) {
    if (!current.storage_bucket || !current.storage_path) throw new Error('payment_evidence_identifier_missing')
    const bucket = await privateBucket(current.storage_bucket)
    const blob = new Blob([receipt.bytes as BlobPart], { type: 'application/pdf' })
    const upload = await bucket.upload(current.storage_path, blob, { contentType: 'application/pdf', upsert: false })
    if (upload.error && !/duplicate|already exists|409/i.test(String(upload.error.message || ''))) {
      throw upload.error
    }
    current = await finalizeEvidence(evidenceId, receipt.sha256, receipt.bytes.byteLength)
  }

  if (current.status === 'pending_review') {
    current = await reviewEvidence(evidenceId)
  }
  if (current.status !== 'shareable') throw new Error('shareable_single_page_evidence_required')
}
