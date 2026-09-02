import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

const [indexHtml, tokens, nav, navModel, requestModal, app] = await Promise.all([
  read('app/index.html'),
  read('app/src/theme/tokens.css'),
  read('app/src/components/ui/Nav/Nav.tsx'),
  read('app/src/components/ui/Nav/navModel.tsx'),
  read('app/src/features/solicitudes/RequestModal.tsx'),
  read('app/src/App.tsx'),
])

assert.match(indexHtml, /rel="icon"[^>]+favicon-32\.png/)
assert.match(indexHtml, /rel="apple-touch-icon"[^>]+apple-touch-icon\.png/)
assert.match(tokens, /dialog:modal\s*\{\s*margin:\s*auto/)

assert.match(nav, /it\.vanillaHref\s*\?\s*\(/)
assert.match(nav, /href=\{it\.vanillaHref\}/)
assert.doesNotMatch(navModel, /comprobantes-batch[^\n]+vanillaHref/)
assert.doesNotMatch(navModel, /cortes-semanales[^\n]+vanillaHref/)
// Paridad alcanzada: comprobantes y cortes dejaron de ser iframes del vanilla
// y son pantallas React propias (#489/#492). Antes esto exigía
// `LegacyModuleFrame src="/comprobantes_batch.html"`; exigirlo hoy fijaría el
// andamio en vez del resultado. Se verifica la ruta, el componente React y su
// carga diferida.
assert.match(app, /path="comprobantes-batch" element=\{<ComprobantesPage \/>\}/)
assert.match(app, /path="cortes-semanales" element=\{<CortesPage \/>\}/)
assert.match(app, /const ComprobantesPage = lazy\(\(\) => import\('\.\/features\/comprobantes\/ComprobantesPage'\)\)/)
assert.match(app, /const CortesPage = lazy\(\(\) => import\('\.\/features\/cortes\/CortesPage'\)\)/)
assert.doesNotMatch(app, /LegacyModuleFrame/)

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
