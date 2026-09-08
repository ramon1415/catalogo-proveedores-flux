import { parseObligationDocument } from '../../../app/src/features/nomina/obligationDocuments.ts'
import { parseReceiptFields } from '../../../app/src/features/nomina/receiptFields.ts'

type Runtime = { env: (name: string) => string | undefined; fetch: typeof fetch; pdfLines?: (bytes: Uint8Array) => Promise<string[]> }
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers })
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function extractObligationPdfLines(bytes: Uint8Array): Promise<string[]> {
  // Version pinned for the same server parser in DEV and future releases.
  const { getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(bytes, { isEvalSupported: false })
  try {
    if (pdf.numPages < 1 || pdf.numPages > 20) throw new Error('OBLIGATION_PDF_PAGE_LIMIT')
    const lines: string[] = []; let length = 0
    for (let n = 1; n <= pdf.numPages; n++) {
      const { items } = await (await pdf.getPage(n)).getTextContent()
      const rows: { y: number; parts: { x: number; text: string }[] }[] = []
      for (const item of items) {
        if (!('str' in item) || !item.str.trim()) continue
        length += item.str.length
        if (length > 300_000) throw new Error('OBLIGATION_PDF_TEXT_LIMIT')
        const y = item.transform[5], x = item.transform[4]
        let row = rows.find(r => Math.abs(r.y - y) < 2)
        if (!row) { row = { y, parts: [] }; rows.push(row) }
        row.parts.push({ x, text: item.str.trim() })
      }
      lines.push(...rows.sort((a, b) => b.y - a.y).map(r => r.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ')), '')
    }
    return lines
  } finally { await pdf.destroy() }
}

export async function handleRequest(req: Request, runtime: Runtime): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)
  try {
    const base = runtime.env('SUPABASE_URL')?.replace(/\/$/, '')
    const key = runtime.env('SUPABASE_SERVICE_ROLE_KEY')
    const token = req.headers.get('authorization') || ''
    if (!/^Bearer \S+$/i.test(token)) return json({ error: 'OBLIGATION_AUTH_REQUIRED' }, 401)
    if (!base || !key) throw new Error('OBLIGATION_CONFIGURATION_REQUIRED')
    const input = await req.json()
    if (!uuid.test(input.file_id) || !['verify', 'download'].includes(input.action)) return json({ error: 'OBLIGATION_INPUT_INVALID' }, 400)
    const user = await runtime.fetch(`${base}/auth/v1/user`, { headers: { apikey: key, Authorization: token } })
    if (!user.ok) return json({ error: 'OBLIGATION_AUTH_REQUIRED' }, 401)
    async function rpc(name: string, body: unknown, service = false): Promise<any> {
      const result = await runtime.fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, Authorization: service ? `Bearer ${key}` : token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!result.ok) {
        const body = await result.json().catch(() => ({})); const message = body.message || ''
        throw new Error(/^OBLIGATION_[A-Z_]+$/.test(message) ? message : 'OBLIGATION_RPC_FAILED')
      }
      return result.status === 204 ? null : result.json()
    }
    const context = await rpc('get_payroll_obligation_file_context', { p_file_id: input.file_id, p_action: input.action })
    if (context.file_id !== input.file_id || !uuid.test(context.company_id) || !uuid.test(context.obligation_id) || !uuid.test(context.actor_id)
      || context.bucket !== 'payroll-obligations' || context.path !== `${context.company_id}/${context.obligation_id}/${context.file_id}.pdf`) throw new Error('OBLIGATION_FILE_SCOPE_INVALID')
    const path = context.path.split('/').map(encodeURIComponent).join('/')
    if (input.action === 'download') {
      const signed = await runtime.fetch(`${base}/storage/v1/object/sign/payroll-obligations/${path}`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 120 }) })
      const payload = await signed.json()
      if (!signed.ok || typeof payload.signedURL !== 'string' || !payload.signedURL.startsWith('/object/sign/payroll-obligations/')) throw new Error('OBLIGATION_DOWNLOAD_FAILED')
      return json({ url: `${base}/storage/v1${payload.signedURL}`, expires_in: 120 })
    }
    if (!Number.isSafeInteger(Number(context.size_bytes)) || context.size_bytes < 100 || context.size_bytes > 10 * 1024 * 1024) throw new Error('OBLIGATION_FILE_SIZE_INVALID')
    const response = await runtime.fetch(`${base}/storage/v1/object/authenticated/payroll-obligations/${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!response.ok) throw new Error('OBLIGATION_FILE_MISSING')
    // Bound reads even if Storage metadata is inconsistent.
    const reader = response.body!.getReader(); const chunks: Uint8Array[] = []; let size = 0
    try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length
      if (size > Number(context.size_bytes)) { await reader.cancel(); throw new Error('OBLIGATION_FILE_SIZE_INVALID') } chunks.push(value) } } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(v => v.toString(16).padStart(2, '0')).join('')
    if (size !== Number(context.size_bytes) || hash !== context.sha256 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-'
      || !new TextDecoder().decode(bytes.slice(-4096)).includes('%%EOF')) throw new Error('OBLIGATION_FILE_INTEGRITY_INVALID')
    const lines = await (runtime.pdfLines || extractObligationPdfLines)(bytes)
    const document = parseObligationDocument(lines)
    let parsed: unknown
    if (context.kind === 'receipt') {
      if (document.kind !== 'unknown' || document.issues.some(i => i.code === 'MIXED_DOCUMENT_TYPES')) throw new Error('OBLIGATION_PAYMENT_FORM_IS_NOT_RECEIPT')
      parsed = parseReceiptFields(lines)
    } else {
      if (document.kind !== context.kind || document.issues.length) throw new Error('OBLIGATION_DOCUMENT_INVALID')
      if (document.taxpayerRfc !== String(context.company_rfc || '').toUpperCase().replace(/[^A-Z0-9Ñ&]/g, '')) throw new Error('OBLIGATION_COMPANY_RFC_MISMATCH')
      parsed = document
    }
    await rpc('complete_payroll_obligation_file', { p_file_id: context.file_id, p_actor_id: context.actor_id, p_sha256: hash, p_parsed: parsed }, true)
    return json({ verified: true, parsed })
  } catch (error) {
    const message = error instanceof Error && /^OBLIGATION_[A-Z_]+$/.test(error.message) ? error.message : 'OBLIGATION_FILE_FAILED'
    return json({ error: message }, message.includes('ACCESS') ? 403 : 409)
  }
}
if (import.meta.main) Deno.serve((req: Request) => handleRequest(req, { env: name => Deno.env.get(name), fetch }))
