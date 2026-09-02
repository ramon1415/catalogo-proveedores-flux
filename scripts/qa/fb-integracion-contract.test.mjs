// Contrato de FB-Integración CONTPAQ (PR #498, revisión de Ramón 2-sep):
//  1. Las tres migraciones aplicadas en DEV se conservan con el DDL exacto
//     (md5 sin comentarios ni espacios = el de supabase_migrations en DEV).
//  2. El forward-fix trae FKs compuestas, índices y RLS por operación.
//  3. Continuidad con #504 (UUID CFDI + CSF) y FB-2 (snapshot cfdi_data).
//  4. Semilla reproducible: MANIFEST con sha256, conteos y 18 needs_review.
//  5. Lógica pura vendorizada: ledger idempotente, reversa, folios por
//     tipo/mes y serialización determinista del layout.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

import { hashContenido, yaExportado, reglaCancelacion, serializarFilas } from '../../app/src/lib/contpaq/ledger/contract.js'
import { crearFolioProvider, periodoDeFecha, FolioError } from '../../app/src/lib/contpaq/ciclo/folio.js'
import { buildPoliza } from '../../app/src/lib/contpaq/serializer/buildPoliza.js'
import { renderLayout } from '../../app/src/lib/contpaq/serializer/renderLayout.js'
import { operadoraConfig } from '../../app/src/lib/contpaq/serializer/configs/operadora.js'
import { sha256Sync } from '../../app/src/lib/contpaq/sha256sync.js'

const root = resolve(new URL('../..', import.meta.url).pathname)
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const sha256 = (p) => createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex')
// Misma normalización que la evidencia tomada en DEV:
//   md5(regexp_replace(regexp_replace(statements, '--[^\n]*', '', 'g'), '\s', '', 'g'))
const md5Ddl = (sql) => createHash('md5').update(sql.replace(/--[^\n]*/g, '').replace(/\s/g, '')).digest('hex')

const MIG = 'supabase/migrations/'
const APLICADAS = {
  '20260901232529_fb_integracion_contable.sql': 'f3ee43ae4302474dba0b4f140638d209',
  '20260901235805_contpaq_accounts_relax_detail_check.sql': '529b8687b0b1217e14b537558add6c6b',
  '20260902045510_fb_integracion_tanda2_mapeos.sql': 'eb87c8537542872ab6a4739cff2c1a43',
}
const FORWARD_FIX = '20260902200000_fb_integracion_forward_fix_tenant_integrity.sql'
const FORWARD_FIX_2 = '20260902201500_accounting_exports_reversal_covering_index.sql'

test('1. las migraciones aplicadas en DEV conservan su DDL exacto (versión = la de la BD)', () => {
  for (const [file, md5] of Object.entries(APLICADAS)) {
    assert.ok(existsSync(resolve(root, MIG + file)), `falta ${file}`)
    assert.equal(md5Ddl(read(MIG + file)), md5, `${file}: el DDL cambió respecto a lo aplicado en DEV`)
  }
  // Los nombres viejos (timestamps locales) ya no existen: no puede haber dos copias.
  for (const viejo of ['20260902090000_fb_integracion_contable.sql', '20260902110000_contpaq_accounts_relax_detail_check.sql', '20260902130000_fb_integracion_tanda2_mapeos.sql']) {
    assert.ok(!existsSync(resolve(root, MIG + viejo)), `${viejo} debe haberse renombrado a la versión de DEV`)
  }
})

test('2. forward-fix: FKs compuestas por empresa, índices de FK y RLS por operación', () => {
  const sql = read(MIG + FORWARD_FIX)
  // C) integridad por empresa
  assert.match(sql, /company_bank_accounts_company_id_id_uq[\s\S]*\(company_id, id\)/)
  assert.match(sql, /bank_account_mappings_company_scope_fkey[\s\S]*foreign key \(company_id, company_bank_account_id\)[\s\S]*references public\.company_bank_accounts \(company_id, id\)/)
  assert.match(sql, /accounting_exports_reversal_same_company_fkey[\s\S]*foreign key \(company_id, reversal_of\)[\s\S]*references public\.accounting_exports \(company_id, id\)/)
  // D) índices
  for (const idx of ['bank_account_mappings_company_bank_account_id_idx', 'provider_account_mappings_proveedor_id_idx']) {
    assert.match(sql, new RegExp(`create index if not exists ${idx}`))
  }
  // Forward-fix 2: la FK compuesta de la reversa se cubre con (company_id, reversal_of)
  const fix2 = read(MIG + FORWARD_FIX_2)
  assert.match(fix2, /create index if not exists accounting_exports_company_reversal_of_idx\s+on public\.accounting_exports \(company_id, reversal_of\)/)
  assert.match(fix2, /drop index if exists public\.accounting_exports_reversal_of_idx/)
  // E) RLS: nada FOR ALL, todo TO authenticated, delete solo donde el contrato lo permite
  assert.doesNotMatch(sql, /create policy[^;]*for all/i)
  assert.match(sql, /for select to authenticated/)
  assert.match(sql, /for insert to authenticated/)
  assert.match(sql, /for update to authenticated/)
  assert.match(sql, /Sin política DELETE: el ledger no se borra/)
  assert.match(sql, /revoke all on table public\.accounting_exports from anon, authenticated/)
  assert.match(sql, /grant select, insert, update on table public\.accounting_exports to authenticated/)
  const ddl = sql.replace(/--[^\n]*/g, '')
  assert.doesNotMatch(ddl, /grant[^;]*\bdelete\b[^;]*accounting_exports/, 'authenticated no recibe DELETE sobre el ledger')
  // Postcheck que aborta la migración si el contrato no quedó
  assert.match(sql, /raise exception 'fb_forward_fix: anon conserva privilegios'/)
  // No toca las migraciones aplicadas
  assert.doesNotMatch(sql, /supabase_migrations|migration repair|db reset/i)
})

test('3. continuidad tras el merge: #504 (UUID CFDI, CSF) y FB-2 (cfdi_data) conviven', () => {
  const modal = read('app/src/features/solicitudes/RequestModal.tsx')
  const api = read('app/src/features/solicitudes/api.ts')
  const cfdi = read('app/src/features/solicitudes/cfdi.ts')
  // #504
  assert.match(cfdi, /TimbreFiscalDigital/)
  assert.match(cfdi, /getAttribute\('UUID'\).*toUpperCase\(\)/)
  assert.match(modal, /const parseVersion = \+\+cfdiParseVersion\.current/)
  assert.match(modal, /if \(parseVersion !== cfdiParseVersion\.current\) return/)
  assert.match(modal, /if \(cfdi\.uuid\) setInvoiceUuid\(cfdi\.uuid\)/)
  assert.match(modal, /invoice_uuid:\s*invoiceUuid \|\| null/)
  assert.match(api, /p_invoice_uuid:\s*payload\.invoice_uuid/)
  // desglose fiscal → subtotal para presupuesto (solo rellena vacíos)
  assert.match(modal, /setSubtotal\(\(prev\) => prev \|\| String\(cfdi\.subtotal\)\)/)
  // FB-2: snapshot completo con el parser certificado, reseteado con el adjunto
  assert.match(modal, /import \{ parseCfdiXml, type CfdiParsed \} from '\.\.\/\.\.\/lib\/contpaq\/cfdiBrowser'/)
  assert.match(modal, /function onFile\([\s\S]*?setInvoiceUuid\(''\)\s*\n\s*cfdiFull\.current = null/)
  assert.match(modal, /cfdiFull\.current = parseCfdiXml\(xml\)/)
  assert.match(modal, /const cfdiWarning = await saveCfdiData\(requestId, cfdiFull\.current\)/)
  assert.match(api, /export async function saveCfdiData\(requestId: string, cfdi: unknown\)/)
  assert.match(api, /\.update\(\{ cfdi_data: cfdi/)
  // Precarga CSF (de #504) sigue en ProviderModal
  const provider = read('app/src/features/proveedores/ProviderModal.tsx')
  assert.match(provider, /rfc:\s*prev\.rfc \|\| \(csf\.rfc \?\? ''\)/)
})

test('4. semilla reproducible: MANIFEST íntegro, conteos y 18 needs_review sin aprobar', () => {
  const dir = 'supabase/seed/contpaq/'
  const manifest = read(dir + 'MANIFEST.txt')
  const entradas = [...manifest.matchAll(/^([0-9a-f]{64})\s{2}(\S+)$/gm)]
  assert.ok(entradas.length >= 8, 'el MANIFEST lista los archivos de la semilla')
  for (const [, sha, rel] of entradas) assert.equal(sha256(dir + rel), sha, `${rel} no coincide con el MANIFEST`)

  const filas = (p) => (read(dir + p).match(/^\s+\(:company_id,/gm) || []).length
  assert.equal(filas('10_catalogo_operadora.sql'), 1646)
  assert.equal(filas('11_catalogo_soporte_fersana.sql'), 694)
  assert.equal(filas('20_renglones_operadora.sql'), 95)
  assert.equal(filas('21_renglones_soporte_fersana.sql'), 396)
  assert.equal(filas('30_terceros_operadora.sql'), 187)

  const json = JSON.parse(read(dir + 'data/mapeos_soporte_fersana.json'))
  assert.equal(json.mapeos.length, 60)
  assert.equal(new Set(json.mapeos.map((m) => m[0])).size, 60, 'partidas distintas')
  assert.equal(json.mapeos.filter((m) => m[2] === true).length, 18, '18 needs_review')
  const sf = read(dir + '40_mapeos_soporte_fersana.sql')
  assert.equal((sf.match(/^\s+\('SF-2026-\d{3}'/gm) || []).length, 60)
  assert.match(sf, /on conflict \(company_id, budget_category_id, contpaq_account_code\) do nothing;/, 'la recarga no pisa decisiones de Finanzas')
  assert.doesNotMatch(sf, /needs_review\s*=\s*false/, 'la semilla nunca aprueba un mapeo')

  assert.match(read(dir + '30_terceros_operadora.sql'), /on conflict \(company_id, id_contpaq\) do update set/)
  const apply = read(dir + 'apply.sh')
  assert.match(apply, /set -euo pipefail/)
  assert.match(apply, /python3 tools\/verificar_manifest\.py/)
  assert.match(apply, /echo 'begin;'[\s\S]*echo 'commit;'/, 'una sola transacción')
  assert.match(apply, /-v ON_ERROR_STOP=1/)
  assert.match(read(dir + 'postcheck.sql'), /needs_review[\s\S]*18/)
})

// ── 5. lógica pura vendorizada ─────────────────────────────────────────────
test('5a. ledger: idempotencia por (source, kind); cancelar libera el origen', () => {
  const src = { feeder: 'flux', id: 'pr-1' }
  const registros = [{ source_feeder: 'flux', source_id: 'pr-1', source_kind: 'provision', status: 'exported' }]
  assert.equal(yaExportado(registros, src, 'provision'), true)
  assert.equal(yaExportado(registros, src, 'pago'), false, 'el pago del mismo source no está exportado')
  assert.equal(yaExportado(registros, src), true)
  registros[0].status = 'cancelled'
  assert.equal(yaExportado(registros, src, 'provision'), false, 'cancelada ⇒ re-exportable')
  const legado = [{ source_feeder: 'flux', source_id: 'pr-2', status: 'exported' }]
  assert.equal(yaExportado(legado, { feeder: 'flux', id: 'pr-2' }, 'directo'), true, 'filas pre-F3 = directo')
  assert.throws(() => yaExportado(registros, src, 'otro'), /kind "otro" inválido/)
})

test('5b. ledger: reversa — provisión cancelada bloquea el pago con razón accionable', () => {
  const src = { feeder: 'flux', id: 'pr-9' }
  const base = { source_feeder: 'flux', source_id: 'pr-9' }
  assert.deepEqual(reglaCancelacion([], src), { pagoBloqueado: false, razon: null })
  assert.equal(reglaCancelacion([{ ...base, source_kind: 'provision', status: 'exported' }], src).pagoBloqueado, false)
  const bloqueo = reglaCancelacion([{ ...base, source_kind: 'provision', status: 'cancelled' }], src)
  assert.equal(bloqueo.pagoBloqueado, true)
  assert.match(bloqueo.razon, /flux:pr-9/)
  assert.equal(
    reglaCancelacion([{ ...base, source_kind: 'provision', status: 'cancelled' }, { ...base, source_kind: 'provision', status: 'exported' }], src).pagoBloqueado,
    false, 'cancelada y re-exportada ⇒ desbloqueado',
  )
  assert.equal(reglaCancelacion([{ source_feeder: 'flux', source_id: 'pr-otro', source_kind: 'provision', status: 'cancelled' }], src).pagoBloqueado, false, 'otro source no interfiere')
})

test('5c. ledger: content_hash determinista con el hasher del navegador (sin node:crypto)', () => {
  const filas = [['P', 46174, 2, 1, 1, '0', 'Pago CFE', 0, 11, 0, 0, ' ', 'GUID-1'], ['M1', '60201000000', 'Pago CFE', 0, 100, 0, 0, '', ' ', 'GUID-2', 46174]]
  const h1 = hashContenido(filas, sha256Sync)
  const h2 = hashContenido(filas.map((f) => [...f]), sha256Sync)
  assert.equal(h1, h2)
  assert.equal(h1, createHash('sha256').update(serializarFilas(filas)).digest('hex'), 'sha256Sync == node:crypto')
  assert.notEqual(hashContenido([[...filas[0]], [...filas[1].slice(0, 4), 101, ...filas[1].slice(5)]], sha256Sync), h1, 'cambiar un importe cambia el hash')
  assert.throws(() => hashContenido(filas), /hash_fn_required/, 'sin hasher inyectado truena explícito')
})

test('5d. folio: consecutivo por tipo, reinicio mensual y estado reanudable', () => {
  const p = crearFolioProvider({ estrategia: 'consecutivo-por-tipo', reinicio: 'mensual' })
  assert.equal(p.asignarFolio(2, '2026-06-01'), 1)
  assert.equal(p.asignarFolio(2, '2026-06-02'), 2)
  assert.equal(p.asignarFolio(1, '2026-06-02'), 1, 'los ingresos llevan su propia secuencia')
  assert.equal(p.asignarFolio(3, '2026-06-03'), 1)
  assert.equal(p.asignarFolio(2, '2026-07-01'), 1, 'julio reinicia')
  assert.equal(p.estado.periodo, '2026-07')
  assert.throws(() => p.asignarFolio(2, '2026-06-30'), (e) => e instanceof FolioError && /fuera de orden/.test(e.message))
  assert.equal(periodoDeFecha(46174), '2026-06', 'serial de Excel también es fecha')
  // Reanudar desde lo persistido en accounting_exports (max folio por tipo del periodo)
  const persistido = { ultimos: { 2: 47, 1: 13, 3: 16 }, periodo: '2026-06' }
  const r1 = crearFolioProvider({ estado: JSON.parse(JSON.stringify(persistido)) })
  assert.equal(r1.asignarFolio(2, '2026-06-30'), 48)
  const r2 = crearFolioProvider({ estado: JSON.parse(JSON.stringify(persistido)) })
  assert.equal(r2.asignarFolio(2, '2026-07-01'), 1, 'mismo estado, otro mes: reinicia')
  assert.throws(() => crearFolioProvider({ estrategia: 'aleatorio' }), /inválida/)
})

test('5e. serializer: la misma póliza produce el mismo layout (Guid inyectado, sin aleatoriedad)', () => {
  const poliza = {
    tipo: 'egreso', fecha: '2026-06-15', folio: 7, concepto: 'Pago CFE', guid: 'AAAAAAAA-0000-4000-8000-000000000001',
    asientos: [
      { cuenta: '602-01-000-000', tipoMovto: 'cargo', importe: 1160, concepto: 'CFE junio', guid: 'AAAAAAAA-0000-4000-8000-000000000002' },
      { cuenta: '102-01-100-000', tipoMovto: 'abono', importe: 1160, concepto: 'CFE junio', guid: 'AAAAAAAA-0000-4000-8000-000000000003' },
    ],
  }
  const nunca = () => { throw new Error('no debe generar Guids') }
  const a = buildPoliza(structuredClone(poliza), operadoraConfig, { generarGuid: nunca })
  const b = buildPoliza(structuredClone(poliza), operadoraConfig, { generarGuid: nunca })
  assert.deepEqual(a, b)
  assert.equal(a.header[0], 'P'); assert.equal(a.header[2], 2, 'TipoPol egreso OPT = 2'); assert.equal(a.header[3], 7)
  assert.equal(a.registros[0][1], '60201000000', 'cuenta OPT sin guiones, 11 dígitos')
  const la = renderLayout([a], operadoraConfig); const lb = renderLayout([b], operadoraConfig)
  assert.deepEqual(la, lb)
  assert.equal(hashContenido([a.header, ...a.registros], sha256Sync), hashContenido([b.header, ...b.registros], sha256Sync))
  // Descuadre: no se serializa
  const mala = structuredClone(poliza); mala.asientos[1].importe = 1000
  assert.throws(() => buildPoliza(mala, operadoraConfig, { generarGuid: nunca }), /descuadrada/)
})
