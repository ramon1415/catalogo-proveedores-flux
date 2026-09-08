// Installation pilot: use the caller's verified session, never service-role credentials.
const ORIGIN = 'https://flux.quantta.mx'
const SUPABASE = 'https://ucantptjhwttexzmslvm.supabase.co'
const COOKIE = '__Secure-flux-pwa'
const PILOT = Object.freeze({
  'ramon@quantta.mx': 'e514902e-aa2c-4430-aa88-515934c3d13b',
  'carlos@quantta.mx': '843c1a09-0293-40d8-a764-cbc0878fc620',
  'denise@quantta.mx': 'b014d1fb-903b-433c-ab51-0e8f5b5d91e1',
  'cesar@quantta.mx': '6f925d1c-1358-41bf-9d5c-06671cb8404a',
})
const MANIFEST = Object.freeze({
  id: '/', name: 'Flux', short_name: 'Flux', lang: 'es-MX',
  description: 'Solicitudes, aprobaciones y seguimiento de pagos.',
  start_url: '/', scope: '/', display: 'standalone',
  background_color: '#172d29', theme_color: '#172d29', prefer_related_applications: false,
  icons: [
    { src: '/pwa/flux-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/pwa/flux-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/pwa/flux-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
})
function cookie(value = '') {
  return `${COOKIE}=${value}; Path=/api/pwa; Max-Age=${value ? 3600 : 0}; HttpOnly; Secure; SameSite=Strict`
}
async function allowedProfile(token, env, requestFetch) {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) || token.length > 3800) return null
  const headers = { apikey: env.FLUX_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  const userResponse = await requestFetch(`${SUPABASE}/auth/v1/user`, { headers, signal: AbortSignal.timeout(8000) })
  if (!userResponse.ok) return null
  const user = await userResponse.json()
  const email = String(user.email || '').trim().toLowerCase()
  const profileId = PILOT[email]
  if (!profileId || !user.email_confirmed_at || !/^[a-f0-9-]{36}$/.test(user.id || '')) return null
  const url = `${SUPABASE}/rest/v1/profiles?select=id,email,auth_user_id,active&id=eq.${profileId}&auth_user_id=eq.${user.id}&active=eq.true`
  const profileResponse = await requestFetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!profileResponse.ok) return null
  const rows = await profileResponse.json()
  const profile = Array.isArray(rows) && rows.length === 1 ? rows[0] : null
  return profile?.id === profileId && profile.auth_user_id === user.id && profile.active === true
    && String(profile.email || '').toLowerCase() === email ? profileId : null
}
function createHandler(env = process.env, requestFetch = fetch) {
  return async function pwa(request, response) {
    response.setHeader('Cache-Control', 'private, no-store, max-age=0')
    response.setHeader('Vary', 'Cookie, Authorization')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    const send = (status, body) => response.status(status).send(JSON.stringify(body))
    if (env.VERCEL_ENV !== 'production' || !['prod', 'production'].includes(env.FLUX_ENV || env.VERCEL_ENV)
      || env.FLUX_SUPABASE_URL !== SUPABASE || !env.FLUX_SUPABASE_ANON_KEY
      || request.headers.host !== 'flux.quantta.mx') return send(404, { eligible: false })
    if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
      response.setHeader('Allow', 'GET, POST, DELETE'); return send(405, { eligible: false })
    }
    if (request.method !== 'GET' && request.headers.origin !== ORIGIN) return send(403, { eligible: false })
    if (request.method === 'DELETE') { response.setHeader('Set-Cookie', cookie()); return send(200, { eligible: false }) }
    const token = request.method === 'POST'
      ? String(request.headers.authorization || '').replace(/^Bearer /, '')
      : String(request.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1) || ''
    try {
      const profileId = await allowedProfile(token, env, requestFetch)
      if (!profileId) { response.setHeader('Set-Cookie', cookie()); return send(403, { eligible: false }) }
      if (request.method === 'POST') {
        response.setHeader('Set-Cookie', cookie(token))
        return send(200, { eligible: true, profileId })
      }
      response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
      return send(200, MANIFEST)
    } catch {
      response.setHeader('Set-Cookie', cookie())
      return send(503, { eligible: false })
    }
  }
}
module.exports = createHandler()
module.exports.createHandler = createHandler
