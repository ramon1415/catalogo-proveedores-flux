import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
const require = createRequire(import.meta.url)
const { createHandler } = require('../../api/pwa.js')
const env = { VERCEL_ENV: 'production', FLUX_ENV: 'prod', FLUX_SUPABASE_URL: 'https://ucantptjhwttexzmslvm.supabase.co', FLUX_SUPABASE_ANON_KEY: 'public-test-key' }
const accounts = {
  'ramon@quantta.mx': 'e514902e-aa2c-4430-aa88-515934c3d13b',
  'carlos@quantta.mx': '843c1a09-0293-40d8-a764-cbc0878fc620',
  'denise@quantta.mx': 'b014d1fb-903b-433c-ab51-0e8f5b5d91e1',
  'cesar@quantta.mx': '6f925d1c-1358-41bf-9d5c-06671cb8404a',
}
const token = 'verified.test.signature'
const authId = '11111111-1111-4111-8111-111111111111'
function fixture(email = 'ramon@quantta.mx', overrides = {}) {
  const calls = []
  const handler = createHandler({ ...env, ...overrides.env }, async (url, options) => {
    calls.push(url)
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    assert.equal(options.headers.apikey, 'public-test-key')
    if (overrides.throw) throw Error('unavailable')
    if (url.includes('/auth/')) return { ok: !overrides.expired, json: async () => ({ id: authId, email, email_confirmed_at: '2026-01-01', ...overrides.user }) }
    assert.ok(url.includes(`id=eq.${accounts[email]}`))
    assert.ok(url.includes(`auth_user_id=eq.${authId}`))
    return { ok: true, json: async () => overrides.empty ? [] : [{ id: accounts[email], email, auth_user_id: authId, active: true, ...overrides.profile }] }
  })
  return { calls, async send(method = 'POST', headers = {}) {
    const response = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(s) { this.statusCode = s; return this }, send(b) { this.body = JSON.parse(b); return this } }
    await handler({ method, headers: { host: 'flux.quantta.mx', origin: 'https://flux.quantta.mx', authorization: `Bearer ${token}`, ...headers } }, response)
    return response
  } }
}
for (const email of Object.keys(accounts)) test(`verified pilot account can retrieve private manifest: ${email}`, async () => {
  const f = fixture(email), post = await f.send()
  assert.equal(post.statusCode, 200)
  assert.deepEqual(post.body, { eligible: true, profileId: accounts[email] })
  assert.match(post.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/)
  const get = await f.send('GET', { cookie: post.headers['Set-Cookie'].split(';')[0] })
  assert.equal(get.statusCode, 200)
  assert.match(get.headers['Content-Type'], /application\/manifest\+json/)
  assert.equal(get.body.display, 'standalone')
  assert.equal(get.body.id, '/')
  assert.deepEqual(get.body.icons.map(i => i.sizes), ['192x192', '512x512', '512x512'])
  assert.ok(!JSON.stringify(get.body).includes(token))
  assert.match(get.headers['Cache-Control'], /private, no-store/)
})
test('all other accounts and unverified identities are denied', async () => {
  for (const [email, options] of [
    ['another@quantta.mx', {}], ['ramon@quantta.mx', { expired: true }],
    ['ramon@quantta.mx', { user: { email_confirmed_at: null } }],
    ['ramon@quantta.mx', { profile: { id: accounts['cesar@quantta.mx'] } }],
    ['ramon@quantta.mx', { profile: { active: false } }],
    ['ramon@quantta.mx', { profile: { auth_user_id: 'other' } }],
    ['ramon@quantta.mx', { profile: { email: 'other@quantta.mx' } }],
    ['ramon@quantta.mx', { empty: true }],
  ]) {
    const r = await fixture(email, options).send()
    assert.equal(r.statusCode, 403)
    assert.deepEqual(r.body, { eligible: false })
    assert.match(r.headers['Set-Cookie'], /Max-Age=0/)
  }
})
test('public requests, invalid credentials and identity spoofing cannot get a manifest', async () => {
  const f = fixture()
  for (const headers of [{}, { cookie: '__Secure-flux-pwa=bad' }, { 'x-user-email': 'ramon@quantta.mx' }]) assert.equal((await f.send('GET', headers)).statusCode, 403)
  assert.equal((await f.send('POST', { authorization: '' })).statusCode, 403)
  assert.equal(f.calls.length, 0)
})
test('preview, DEV, another project or another domain fail closed', async () => {
  for (const config of [{ VERCEL_ENV: 'preview' }, { FLUX_ENV: 'dev' }, { FLUX_SUPABASE_URL: 'https://dev.supabase.co' }, { FLUX_SUPABASE_ANON_KEY: '' }]) {
    const f = fixture(undefined, { env: config }); assert.equal((await f.send()).statusCode, 404); assert.equal(f.calls.length, 0)
  }
  assert.equal((await fixture().send('POST', { host: 'preview.vercel.app' })).statusCode, 404)
})
test('cross-origin mutations rejected; logout clears cookie; network errors fail closed', async () => {
  const f = fixture()
  assert.equal((await f.send('POST', { origin: 'https://other.example' })).statusCode, 403)
  assert.equal((await f.send('DELETE', { origin: '' })).statusCode, 403)
  const logout = await f.send('DELETE')
  assert.equal(logout.statusCode, 200)
  assert.match(logout.headers['Set-Cookie'], /Max-Age=0/)
  assert.equal(f.calls.length, 0)
  assert.equal((await fixture().send('PUT')).statusCode, 405)
  assert.equal((await fixture(undefined, { throw: true }).send()).statusCode, 503)
})
test('public entry document has no install manifest or standalone metadata; icon dimensions correct', () => {
  const html = readFileSync(new URL('../../app/index.html', import.meta.url), 'utf8')
  assert.doesNotMatch(html, /rel=["']manifest|mobile-web-app-capable/)
  for (const [name, size] of [['flux-192',192], ['flux-512',512], ['flux-maskable-512',512], ['flux-apple-180',180]]) {
    const png = readFileSync(new URL(`../../app/public/pwa/${name}.png`, import.meta.url))
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16), size); assert.equal(png.readUInt32BE(20), size)
  }
})
