import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { catalogApiQuery, captureDevCatalog } from './capture-database-catalog.mjs'

const sql = readFileSync(new URL('./database-catalog-readonly.sql', import.meta.url), 'utf8')
const fixture = () => Object.fromEntries([
  ['project_ref', 'scsirgbuqjcwoaxfacth'], ['read_only', 'on'], ['captured_at', new Date().toISOString()],
  ...['functions', 'tables', 'constraints', 'indexes', 'policies', 'triggers', 'buckets'].map(name => [name, [{}]]),
])

test('API capture sends the reviewed SELECT, leaving transaction ownership to the read-only API', async () => {
  let calls = 0
  const catalog = fixture()
  const result = await captureDevCatalog('fake-token', sql, async (url, options) => {
    calls++
    assert.equal(url, 'https://api.supabase.com/v1/projects/scsirgbuqjcwoaxfacth/database/query')
    assert.equal(options.method, 'POST')
    const body = JSON.parse(options.body)
    assert.equal(body.read_only, true)
    assert.equal(body.query, sql.slice(sql.indexOf('SELECT'), sql.lastIndexOf('COMMIT;')).trim())
    assert.doesNotMatch(body.query, /^BEGIN|COMMIT;\s*$/)
    return new Response(JSON.stringify([{ catalog }]), { status: 201 })
  })
  assert.equal(calls, 1)
  assert.deepEqual(result, catalog)
})

test('API adapter rejects missing transaction guards or trailing SQL before making a request', () => {
  for (const invalid of [sql.replace('READ ONLY', 'READ WRITE'), sql.replace('COMMIT;', ''), sql + '\nSELECT 1;', 'SELECT 1;']) {
    assert.throws(() => catalogApiQuery(invalid), /transaction guard/)
  }
})

test('an API error fails certification without retrying in write mode or exposing the token', async () => {
  let calls = 0
  await assert.rejects(captureDevCatalog('fake-token', sql, async () => {
    calls++
    return new Response(JSON.stringify({ message: 'invalid request fake-token Bearer private-value' }), { status: 400 })
  }), error => {
    assert.match(error.message, /HTTP 400/)
    assert.doesNotMatch(error.message, /fake-token|private-value/)
    return true
  })
  assert.equal(calls, 1)
})

test('a successful response still fails if the server did not use a read-only transaction', async () => {
  await assert.rejects(captureDevCatalog('fake-token', sql, async () => new Response(JSON.stringify([{ catalog: { ...fixture(), read_only: 'off' } }]))), /read-only transaction/)
})

test('a successful response still rejects stale captures and a different environment', async () => {
  for (const patch of [{ captured_at: '2000-01-01T00:00:00Z' }, { project_ref: 'different-project' }]) {
    await assert.rejects(captureDevCatalog('fake-token', sql, async () => new Response(JSON.stringify([{ catalog: { ...fixture(), ...patch } }]))))
  }
})
