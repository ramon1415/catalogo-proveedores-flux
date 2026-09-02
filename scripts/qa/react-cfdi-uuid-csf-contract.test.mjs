import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = resolve(new URL('../..', import.meta.url).pathname)
const read = (path) => readFileSync(resolve(root, path), 'utf8')

const requestModal = read('app/src/features/solicitudes/RequestModal.tsx')
const requestApi = read('app/src/features/solicitudes/api.ts')
const requestTypes = read('app/src/features/solicitudes/types.ts')
const cfdi = read('app/src/features/solicitudes/cfdi.ts')
const providerModal = read('app/src/features/proveedores/ProviderModal.tsx')
const pdfText = read('app/src/lib/pdfText.ts')
const vercelBuild = read('scripts/build-vercel-static.mjs')

test('el UUID del CFDI viaja desde el XML hasta la RPC', () => {
  assert.match(cfdi, /TimbreFiscalDigital/)
  assert.match(cfdi, /getAttribute\('UUID'\).*toUpperCase\(\)/)
  assert.match(requestModal, /invoice_uuid:\s*invoiceUuid \|\| null/)
  assert.match(requestTypes, /invoice_uuid:\s*string \| null/)
  assert.match(requestApi, /p_invoice_uuid:\s*payload\.invoice_uuid/)
})

test('cambiar o limpiar el archivo nunca reutiliza un UUID anterior', () => {
  assert.match(requestModal, /const parseVersion = \+\+cfdiParseVersion\.current/)
  assert.match(requestModal, /if \(parseVersion !== cfdiParseVersion\.current\) return/)
  assert.match(requestModal, /function onFile\([\s\S]*?setInvoiceUuid\(''\)/)
  assert.match(requestModal, /if \(cfdi\.uuid\) setInvoiceUuid\(cfdi\.uuid\)/)
  assert.match(requestModal, /setSubtotal\(''\);[\s\S]*?setInvoiceUuid\(''\); setCfdiHint\(''\)/)
})

test('la CSF sólo completa campos vacíos y conserva captura manual', () => {
  assert.match(providerModal, /const parseVersion = \+\+csfParseVersion\.current/)
  assert.match(providerModal, /if \(parseVersion !== csfParseVersion\.current\) return/)
  assert.match(providerModal, /rfc:\s*prev\.rfc \|\| \(csf\.rfc \?\? ''\)/)
  assert.match(providerModal, /nombre_completo:\s*prev\.nombre_completo \|\| \(csf\.nombre \?\? ''\)/)
  assert.match(providerModal, /persona_tipo:\s*prev\.persona_tipo \|\| \(csf\.personaTipo \?\? ''\)/)
  assert.match(providerModal, /prev\.notas \|\|/)
  assert.match(providerModal, /Captura los datos manualmente/)
})

test('el runtime PDF usado por la CSF se publica en la raíz de React', () => {
  assert.match(pdfText, /\/pdfjs-3\.11\.174\.min\.js/)
  assert.match(pdfText, /\/pdfjs-worker-3\.11\.174\.min\.js/)
  assert.match(vercelBuild, /'pdfjs-3\.11\.174\.min\.js'/)
  assert.match(vercelBuild, /'pdfjs-worker-3\.11\.174\.min\.js'/)
})

test('el parser separa etiquetas en personas morales y físicas', () => {
  const compileDir = mkdtempSync(join(tmpdir(), 'csf-parser-'))
  try {
    const tsc = resolve(root, 'app/node_modules/.bin/tsc')
    const compiled = spawnSync(
      tsc,
      [
        resolve(root, 'app/src/lib/csf.ts'),
        resolve(root, 'app/src/lib/pdfText.ts'),
        '--outDir',
        compileDir,
        '--module',
        'commonjs',
        '--target',
        'es2020',
        '--lib',
        'es2020,dom',
        '--skipLibCheck',
      ],
      { encoding: 'utf8' },
    )
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout)

    const require = createRequire(import.meta.url)
    const { parseCsfText } = require(resolve(compileDir, 'csf.js'))

    assert.deepEqual(
      parseCsfText(
        'Constancia de Situación Fiscal RFC: ABC0102031A2 Denominación / Razón Social: EMPRESA PRUEBA SA DE CV Régimen Fiscal: General de Ley Personas Morales Código Postal: 01234 idCIF: 12345678',
      ),
      {
        rfc: 'ABC0102031A2',
        nombre: 'EMPRESA PRUEBA SA DE CV',
        personaTipo: 'moral',
        codigoPostal: '01234',
        regimen: 'General de Ley Personas Morales',
        idCif: '12345678',
      },
    )

    assert.deepEqual(
      parseCsfText(
        'Constancia de Situación Fiscal RFC: RAMR800101AB1 Nombre (s): RAMONA Primer Apellido: RAMÍREZ Segundo Apellido: RÍOS Código Postal: 64000',
      ),
      {
        rfc: 'RAMR800101AB1',
        nombre: 'RAMONA RAMÍREZ RÍOS',
        personaTipo: 'fisica',
        codigoPostal: '64000',
        regimen: null,
        idCif: null,
      },
    )

    assert.equal(parseCsfText('Documento que no es una constancia fiscal'), null)
  } finally {
    rmSync(compileDir, { recursive: true, force: true })
  }
})
