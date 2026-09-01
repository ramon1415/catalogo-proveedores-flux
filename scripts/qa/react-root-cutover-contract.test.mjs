import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

const vite = read('app/vite.config.ts')
const main = read('app/src/main.tsx')
const auth = read('app/src/lib/auth.tsx')
const access = read('app/src/features/access/AccessRequestPage.tsx')
const build = read('scripts/build-vercel-static.mjs')
const vercel = JSON.parse(read('vercel.json'))

test('React is built and routed from the canonical root', () => {
  assert.match(vite, /base:\s*'\/'/)
  assert.doesNotMatch(main, /basename=["']\/app["']/)
  assert.match(auth, /redirectTo \|\| '\/'/)
  assert.match(access, /location\.replace\('\/solicitudes'\)/)
})

test('old /app bookmarks redirect to the same root route', () => {
  assert.deepEqual(vercel.redirects.slice(0, 2), [
    { source: '/app', destination: '/', permanent: false },
    { source: '/app/:path*', destination: '/:path*', permanent: false },
  ])
})

test('legacy internal links redirect to their React equivalents', () => {
  const redirects = new Map(vercel.redirects.map((item) => [item.source, item.destination]))
  assert.equal(redirects.get('/solicitudes.html'), '/solicitudes')
  assert.equal(redirects.get('/approval_batches.html'), '/cortes-semanales')
  assert.equal(redirects.get('/comprobantes_batch.html'), '/comprobantes-batch')
  assert.equal(redirects.get('/provider_intakes.html'), '/solicitudes-proveedores')
})

test('public token and quick-approval URLs remain canonical', () => {
  assert.match(build, /'solicitar\.html'/)
  assert.match(build, /'approval_batch_quick_approve\.html'/)
  assert.ok(!vercel.redirects.some((item) => item.source === '/solicitar.html'))
  assert.ok(!vercel.redirects.some((item) => item.source === '/approval_batch_quick_approve.html'))
})

test('vanilla rollback and legacy API bridge are explicit', () => {
  assert.match(build, /legacyOutput/)
  assert.ok(vercel.rewrites.some((item) => item.source === '/legacy/api/:path*' && item.destination === '/api/:path*'))
})

test('built artifact separates React, public links and vanilla rollback', { skip: process.env.VERIFY_VERCEL_ARTIFACT !== '1' }, () => {
  const rootIndex = read('.vercel-static/index.html')
  assert.match(rootIndex, /<div id="root"><\/div>/)
  assert.ok(existsSync(new URL('../../.vercel-static/legacy/solicitudes.html', import.meta.url)))
  assert.ok(existsSync(new URL('../../.vercel-static/solicitar.html', import.meta.url)))
  assert.ok(existsSync(new URL('../../.vercel-static/approval_batch_quick_approve.html', import.meta.url)))
  assert.ok(!existsSync(new URL('../../.vercel-static/solicitudes.html', import.meta.url)))
})
