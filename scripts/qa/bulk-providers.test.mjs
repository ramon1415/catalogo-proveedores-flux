import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const root = new URL('../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
const source = read('app/src/features/proveedores/bulkProviders.ts')
const lib = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`)
const { parseBulkProviders: parse, classifyBulkRow: classify, collectProviderIdentities, runBulkProviders: run, pendingBulkText } = lib
const row = (text = 'QA A,Proveedor A,ABC010101AA1,Efectivo') => parse(text).rows[0]
const identity = (r, overrides = {}) => ({ id: 'id-1', ...r.payload, ...overrides })
const ready = n => row(`QA ${n},Proveedor ${n},,, ,`)
const port = overrides => ({ identities: async () => [], create: async () => 'created-id', canContinue: () => true, ...overrides })

test('quoted CSV preserves legal-name commas and escaped quotes', () => {
  const r = row('QA,"Proveedor, ""Norte"" SA",ABC010101AA1,Efectivo,,')
  assert.equal(r.payload.nombre_completo, 'Proveedor, "Norte" SA')
  assert.equal(r.payload.rfc, 'ABC010101AA1'); assert.equal(r.status, 'ready')
})
test('Excel TSV preserves commas, blank leading cells and exact CLABE zeros', () => {
  const p = parse('QA\tProveedor, SA\tABC010101AA1\tTransferencia\tBanco QA\t012345678901234567\n\tSin alias\t\tEfectivo\t\t')
  assert.equal(p.rows[0].payload.nombre_completo, 'Proveedor, SA')
  assert.equal(p.rows[0].payload.clabe, '012345678901234567')
  assert.equal(p.rows[1].status, 'invalid'); assert.equal(p.rows[1].payload.nombre_completo, 'Sin alias')
})
test('BOM, CRLF, empty lines and optional header retain source line numbers', () => {
  const p = parse('\uFEFFalias,nombre,RFC,método,banco,CLABE\r\n\r\nQA,Proveedor,ABC010101AA1,Efectivo,,\r\n')
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0].line, 3); assert.equal(p.error, '')
})
test('header can be reordered without shifting fields', () => {
  const p = parse('RFC;razón social;alias;método\nABC010101AA1;Proveedor, SA;QA;Efectivo')
  assert.equal(p.rows[0].payload.alias, 'QA'); assert.equal(p.rows[0].payload.nombre_completo, 'Proveedor, SA')
})
test('two-column header works without RFC or bank hints', () => {
  assert.equal(parse('alias,nombre\nQA,Proveedor').rows.length, 1)
})
test('data containing banco and RFC words is not thrown away as header', () => {
  const p = parse('Banco QA,Proveedor RFC de prueba,,Efectivo')
  assert.equal(p.rows.length, 1); assert.equal(p.rows[0].line, 1)
})
for (const raw of ['alias,nombre,nombre\nQA,A,A', 'alias,nombre,desconocido\nQA,A,X']) {
  test(`unknown/duplicate header is rejected: ${raw.split('\n')[0]}`, () => assert.ok(parse(raw).error))
}
for (const raw of ['QA,"sin cierre', 'QA,"Nombre"texto,Efectivo', 'QA,Nombre "suelto",,Efectivo']) {
  test(`malformed quote is never shifted or imported: ${raw}`, () => assert.ok(parse(raw).error))
}
test('extra columns and header row-width mismatch are visible errors', () => {
  assert.equal(row('QA,Proveedor,SA,ABC010101AA1,Efectivo,,,').status, 'invalid')
  assert.equal(parse('alias,nombre,rfc\nQA,Proveedor').rows[0].status, 'invalid')
})
test('quoted multiline name is parsed as one record then flagged for correction', () => {
  const p = parse('QA,"Proveedor\nNorte",,Efectivo\nQB,Segundo,,Efectivo')
  assert.equal(p.rows.length, 2); assert.equal(p.rows[0].status, 'invalid'); assert.equal(p.rows[1].line, 3)
})
for (const [input, expected] of [['transferencia', 'Transferencia bancaria'], ['TRANSFERENCIA BANCARIA', 'Transferencia bancaria'], ['deposito a cuenta', 'Depósito a cuenta'], ['cheque', 'Cheque'], ['Efectivo', 'Efectivo'], ['tarjeta en plataforma', 'Tarjeta en plataforma']]) {
  test(`canonical method ${input}`, () => assert.equal(row(`QA,Nombre,,${input}`).payload.metodo_pago, expected))
}
test('unknown payment method is rejected rather than silently replaced', () => assert.equal(row('QA,Nombre,,SPEI equivocado').status, 'invalid'))
test('only alias/name allows identity-only capture without bank execution fields', () => {
  const r = row('QA,Proveedor'); assert.equal(r.status, 'ready'); assert.equal(r.payload.beneficiary_name, null)
  assert.equal(r.payload.destination_type, null); assert.equal(r.payload.metodo_pago, 'Transferencia bancaria')
})
test('supplied banking data cannot be silently discarded for nontransfer methods', () => {
  assert.equal(row('QA,Nombre,,Efectivo,Banco QA,012345678901234567').status, 'invalid')
})
for (const text of ['QA,Nombre,,Transferencia,,012345678901234567', 'QA,Nombre,,Transferencia,Banco QA,', 'QA,Nombre,,Transferencia,Banco QA,1.2345E+17', 'QA,Nombre,INVALIDO,Efectivo', ',Nombre,,Efectivo']) {
  test(`invalid field does not reach ready: ${text}`, () => assert.equal(row(text).status, 'invalid'))
}
test('RFC uppercase and CLABE whitespace/hyphens normalize like canonical keys', () => {
  const r = row('QA,Nombre,abc010101aa1,transferencia,Banco QA,012-345 678901234567')
  assert.equal(r.payload.rfc, 'ABC010101AA1'); assert.equal(r.payload.clabe, '012345678901234567'); assert.equal(r.status, 'ready')
})
test('200-row limit blocks entire overlarge input, not silent truncation', () => {
  assert.equal(parse(Array.from({ length: 200 }, (_, n) => `QA ${n},Nombre ${n}`).join('\n')).rows.length, 200)
  assert.ok(parse(Array.from({ length: 201 }, (_, n) => `QA ${n},Nombre ${n}`).join('\n')).error)
  assert.ok(parse('x'.repeat(lib.MAX_BULK_CHARS + 1)).error)
})
test('blank input yields no rows', () => assert.deepEqual(parse('\n\r\n\t\t\n'), { rows: [], error: '' }))
test('duplicate RFC and normalized alias in same list are skipped', () => {
  const p = parse('QA A,Primero,ABC010101AA1,Efectivo\nQA B,Segundo,abc010101aa1,Efectivo\n qa  a ,Tercero,,Efectivo')
  assert.deepEqual(p.rows.map(r => r.status), ['ready', 'duplicate', 'duplicate'])
})
test('duplicate CLABE in same list is visible even with different alias', () => {
  const p = parse('QA A,A,,Transferencia,Banco,012345678901234567\nQA B,B,,Transferencia,Banco,012345678901234567')
  assert.equal(p.rows[1].status, 'duplicate')
})
test('existing RFC is omitted, never updated or reactivated', () => {
  const r = row(), c = identity(r, { alias: 'OTRO', activo: false })
  const result = classify(r, [c]); assert.equal(result.status, 'existing'); assert.match(result.message, /inactivo/)
})
test('same alias with conflicting RFC blocks instead of associating identities', () => {
  assert.equal(classify(row(), [identity(row(), { rfc: 'DEF010101AA2' })]).status, 'conflict')
})
test('alias and RFC pointing to different records is a conflict', () => {
  const r = row()
  assert.equal(classify(r, [identity(r), identity(r, { id: 'id-2', rfc: 'DEF010101AA2' })]).status, 'conflict')
})
test('same CLABE alone is not proof of provider identity', () => {
  const r = row('QA,Nombre,,Transferencia,Banco,012345678901234567')
  assert.equal(classify(r, [identity(r, { alias: 'DISTINTO' })]).status, 'conflict')
})
test('no-RFC row has stable alias fallback', () => {
  assert.equal(classify(ready(1), [identity(ready(1), { alias: ' qa  1 ' })]).status, 'existing')
})
test('pagination includes matches beyond first 1000 providers', async () => {
  const catalog = Array.from({ length: 1001 }, (_, n) => identity(ready(n), { id: String(n).padStart(6, '0') }))
  const calls = []
  const all = await collectProviderIdentities(async (after, limit) => {
    calls.push(after); const start = after === null ? 0 : Number(after) + 1
    return catalog.slice(start, start + limit)
  })
  assert.equal(all.length, 1001); assert.equal(calls.length, 3); assert.equal(classify(ready(1000), all).status, 'existing')
})
test('pagination errors propagate; cannot become an empty catalog', async () => {
  await assert.rejects(collectProviderIdentities(async () => { throw Error('denied') }), /denied/)
})
test('repeated pagination cursor fails closed', async () => {
  await assert.rejects(collectProviderIdentities(async () => [identity(ready(1))], 1), /STALLED/)
})
test('no permissions: no reads and no writes', async () => {
  let calls = 0
  const result = await run([ready(1)], port({ canContinue: () => false, identities: async () => { calls++; return [] }, create: async () => { calls++; return 'id' } }))
  assert.equal(calls, 0); assert.equal(result[0].status, 'stopped')
})
test('failed catalog precheck makes no writes', async () => {
  let writes = 0
  await assert.rejects(run([ready(1)], port({ identities: async () => { throw Error('read denied') }, create: async () => { writes++; return 'id' } })))
  assert.equal(writes, 0)
})
test('permission/context change during catalog read blocks first write', async () => {
  let allowed = true, writes = 0
  const result = await run([ready(1)], port({ canContinue: () => allowed, identities: async () => { allowed = false; return [] }, create: async () => { writes++; return 'id' } }))
  assert.equal(writes, 0); assert.equal(result[0].status, 'stopped')
})
test('stop after current row conserves success and prevents next write', async () => {
  let allowed = true, writes = 0
  const result = await run([ready(1), ready(2)], port({ canContinue: () => allowed, create: async () => { writes++; allowed = false; return 'new' } }))
  assert.deepEqual(result.map(r => r.status), ['created', 'stopped']); assert.equal(writes, 1)
})
test('existing RFC bypasses create', async () => {
  let writes = 0
  const r = row(), result = await run([r], port({ identities: async () => [identity(r)], create: async () => { writes++; return 'wrong' } }))
  assert.equal(writes, 0); assert.equal(result[0].status, 'existing')
})
test('mixed results retain original line numbers and only retry unconfirmed rows', async () => {
  const rows = [ready(1), ready(2), ready(3)]
  rows.forEach((r, i) => { r.line = i + 2 })
  let writes = 0
  const first = await run(rows, port({ create: async () => { writes++; if (writes === 2) throw { code: '23514' }; return `id-${writes}` } }))
  assert.deepEqual(first.map(r => r.status), ['created', 'failed', 'created'])
  const retried = []
  const second = await run(first, port({ create: async p => { retried.push(p.alias); return 'recovered' } }))
  assert.deepEqual(retried, ['QA 2']); assert.deepEqual(second.map(r => r.line), [2, 3, 4])
})
test('lost successful response stops batch and next retry finds existing provider', async () => {
  const catalog = [], rows = [ready(1), ready(2)]
  let writes = 0
  const first = await run(rows, port({ identities: async () => [...catalog], create: async p => { writes++; catalog.push({ id: 'persisted', ...p }); throw TypeError('Network disconnected') } }))
  assert.equal(writes, 1); assert.deepEqual(first.map(r => r.status), ['unconfirmed', 'stopped'])
  const second = await run(first, port({ identities: async () => [...catalog], create: async p => { writes++; return 'next' } }))
  assert.equal(writes, 2); assert.deepEqual(second.map(r => r.status), ['existing', 'created'])
})
test('invalid RPC confirmation is not claimed as a successful create', async () => {
  const result = await run([ready(1), ready(2)], port({ create: async () => '' }))
  assert.deepEqual(result.map(r => r.status), ['unconfirmed', 'stopped'])
})
test('concurrent uniqueness conflict cannot cause update or a blind retry', async () => {
  let calls = 0
  const first = await run([row()], port({ create: async () => { calls++; throw { code: '23505' } } }))
  assert.equal(first[0].status, 'failed'); assert.equal(calls, 1)
  const next = await run(first, port({ identities: async () => [identity(row())], create: async () => { throw Error('must not write') } }))
  assert.equal(next[0].status, 'existing')
})
test('empty catalog + duplicate session rows: only one create even with direct caller', async () => {
  let writes = 0
  const result = await run([ready(1), { ...ready(1), line: 2 }], port({ create: async () => { writes++; return 'id' } }))
  assert.equal(writes, 1); assert.deepEqual(result.map(r => r.status), ['created', 'existing'])
})
test('created payload timestamp belongs to execution, not preview', async () => {
  const r = ready(1); assert.equal(r.payload.updated_at, '')
  await run([r], port({ create: async p => { assert.ok(!Number.isNaN(Date.parse(p.updated_at))); return 'id' } }))
  assert.equal(r.payload.updated_at, '')
})
test('correction carries only pending rows, preserves quoted text', () => {
  const rows = [ { ...row(), status: 'created' }, { ...row('QB,"Nombre, SA"'), status: 'failed' } ]
  const next = parse(pendingBulkText(rows)).rows
  assert.equal(next.length, 1); assert.equal(next[0].payload.nombre_completo, 'Nombre, SA')
})
test('adapter retains canonical RPC, does not invent company column or insert/update route', () => {
  const api = read('app/src/features/proveedores/api.ts')
  assert.match(api, /save_provider_catalog_with_payment_execution_data/)
  assert.match(api, /create: payload => saveProvider\(null, payload\)/)
  assert.match(api, /query\.gt\('id', after\)/)
  const bulk = api.slice(api.indexOf('export async function listBulkProviderIdentities'), api.indexOf('// Activar/desactivar'))
  assert.doesNotMatch(bulk, /\.insert\(|\.update\(|service_role|company_id.*eq/)
})
test('modal keeps results, permission guard, close deferral and stop controls', () => {
  const ui = read('app/src/features/proveedores/BulkProviderModal.tsx')
  assert.match(ui, /createdAny\.current\) onSaved\(\)/)
  assert.match(ui, /context\.current\.allowed/)
  assert.match(ui, /readVersion\.current\+\+/)
  assert.match(ui, /onCancel=.*event\.preventDefault\(\)/)
  assert.match(ui, /canContinue,/)
  assert.match(ui, /Corregir solo pendientes/)
  assert.match(ui, /Detener después de esta fila/)
  assert.doesNotMatch(ui.slice(ui.indexOf('async function submit'), ui.indexOf('const hasPending')), /onSaved\(\)/)
})
test('bulk layout uses independent two-axis scroll and touch-size controls', () => {
  const css = read('app/src/features/proveedores/BulkProviderModal.module.css')
  assert.match(css, /\.tableWrap\s*\{[^}]*overflow: auto/s)
  assert.match(css, /\.body\s*\{[^}]*min-height: 0[^}]*overflow-y: auto/s)
  assert.match(css, /94dvh/); assert.match(css, /min-height: 44px/); assert.match(css, /flex-wrap: wrap/)
})

test('prototype property names cannot masquerade as supported header/method', () => {
  assert.ok(parse('alias,nombre,constructor\nQA,Nombre,ignored').error)
  assert.equal(row('QA,Nombre,,constructor').status, 'invalid')
})
test('modal binds actor identity as well as company and permissions', () => {
  const ui = read('app/src/features/proveedores/BulkProviderModal.tsx')
  assert.match(ui, /Boolean\(profile\?\.id\)/)
  assert.match(ui, /context\.current\.actor === initialCompany\.current\.actor/)
})
