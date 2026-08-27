import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const [indexHtml, tokens, nav, navModel, requestModal, app, legacyFrame] = await Promise.all([
  read('app/index.html'),
  read('app/src/theme/tokens.css'),
  read('app/src/components/ui/Nav/Nav.tsx'),
  read('app/src/components/ui/Nav/navModel.tsx'),
  read('app/src/features/solicitudes/RequestModal.tsx'),
  read('app/src/App.tsx'),
  read('app/src/pages/LegacyModuleFrame.tsx'),
])

assert.match(indexHtml, /rel="icon"[^>]+favicon-32\.png/)
assert.match(indexHtml, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/)
assert.match(tokens, /dialog:modal\s*\{\s*margin:\s*auto/)

assert.match(nav, /it\.vanillaHref\s*\?\s*\(/)
assert.match(nav, /href=\{it\.vanillaHref\}/)
assert.doesNotMatch(navModel, /comprobantes-batch[^\n]+vanillaHref/)
assert.doesNotMatch(navModel, /cortes-semanales[^\n]+vanillaHref/)
assert.match(app, /path="comprobantes-batch"[\s\S]+LegacyModuleFrame src="\/comprobantes_batch\.html"/)
assert.match(app, /path="cortes-semanales"[\s\S]+LegacyModuleFrame src="\/approval_batches\.html"/)
assert.match(legacyFrame, /\.sidebar,[\s\S]+\.topbar,[\s\S]+display:\s*none\s*!important/)
assert.match(legacyFrame, /contentDocument/)

const sections = [
  'Datos del pago',
  'Proveedor / beneficiario',
  'Clasificacion presupuestal',
  'Contexto operativo',
  'Datos de entrega',
  'Revisión final',
]
let previous = -1
for (const section of sections) {
  const current = requestModal.indexOf(section)
  assert.ok(current > previous, `La sección ${section} debe conservar el orden de la pantalla funcional`)
  previous = current
}
assert.match(requestModal, /notesWithIncidentMarker/)
assert.match(requestModal, /\[Visita\/incidencia asociada:/)

console.log('PASS react corrective parity contract')
