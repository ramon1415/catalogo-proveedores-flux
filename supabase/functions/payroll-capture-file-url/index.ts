import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

type Input = { p_file_id?: string; file_type?: 'capture' | 'receipt' }
type DownloadContext = {
  file_id: string
  storage_bucket: string
  storage_path: string
  download_name: string
}

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`missing_required_secret:${name}`)
  return value.replace(/\/$/, '')
}

function bearer(req: Request): string {
  const value = req.headers.get('authorization') || ''
  if (!/^Bearer\s+\S+$/i.test(value)) throw new Error('PAYROLL_AUTH_REQUIRED')
  return value.replace(/^Bearer\s+/i, '')
}

async function apiJson(url: string, init: RequestInit, code: string): Promise<any> {
  const result = await fetch(url, init)
  if (!result.ok) {
    let rpcCode = ''
    try {
      const payload = await result.clone().json() as { message?: unknown }
      const message = typeof payload?.message === 'string' ? payload.message : ''
      const match = message.match(/PAYROLL_[A-Z0-9_]+/)
      rpcCode = match?.[0] || ''
    } catch {
      // Fall through to the stable wrapper code below.
    }
    throw new Error(rpcCode || code)
  }
  return await result.json()
}

async function rpc(base: string, key: string, token: string, name: string, body: unknown): Promise<any> {
  return await apiJson(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, `PAYROLL_RPC_${name.toUpperCase()}_FAILED`)
}

function errorStatus(code: string): number {
  if (code === 'PAYROLL_AUTH_REQUIRED') return 401
  if (code.includes('FINANCE_REQUIRED') || code.includes('MEMBERSHIP_REQUIRED')) return 403
  if (code === 'PAYROLL_CAPTURE_FILE_NOT_FOUND') return 404
  return 409
}

async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return response(405, { error: 'METHOD_NOT_ALLOWED' })

  try {
    const base = requiredEnv('SUPABASE_URL')
    const serviceKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
    const token = bearer(req)
    const input = await req.json() as Input

    if (!input.p_file_id || !/^[0-9a-f-]{36}$/i.test(input.p_file_id)) {
      return response(400, { error: 'PAYROLL_CAPTURE_FILE_ID_REQUIRED' })
    }

    await apiJson(`${base}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    }, 'PAYROLL_AUTH_REQUIRED')

    // Authorization happens with the caller JWT. The RPC returns the storage
    // context only to this server-side function; the browser never sees it.
    if (input.file_type && !['capture', 'receipt'].includes(input.file_type)) return response(400, { error: 'PAYROLL_FILE_TYPE_INVALID' })
    const context = await rpc(base, serviceKey, token, input.file_type === 'receipt' ? 'get_payroll_receipt_file_url' : 'get_payroll_capture_file_url', {
      p_file_id: input.p_file_id,
    }) as DownloadContext

    if (
      context.file_id !== input.p_file_id ||
      context.storage_bucket !== 'payroll-private' ||
      !context.storage_path
    ) {
      throw new Error('PAYROLL_CAPTURE_FILE_SCOPE_MISMATCH')
    }

    const admin = createClient(base, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await admin.storage
      .from(context.storage_bucket)
      .createSignedUrl(context.storage_path, 120, { download: true })

    if (error || !data?.signedUrl) throw new Error('PAYROLL_CAPTURE_FILE_SIGN_FAILED')

    return response(200, {
      url: data.signedUrl,
      expires_in: 120,
      file_id: context.file_id,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PAYROLL_CAPTURE_FILE_URL_FAILED'
    const safe = /^PAYROLL_[A-Z0-9_]+$/.test(code) ? code : 'PAYROLL_CAPTURE_FILE_URL_FAILED'
    return response(errorStatus(safe), { error: safe })
  }
}

Deno.serve(handler)
export { handler }
