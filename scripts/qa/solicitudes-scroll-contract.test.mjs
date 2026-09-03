import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const solicitudesCss = fs.readFileSync(
  'app/src/features/solicitudes/Solicitudes.module.css',
  'utf8',
)
const appShellCss = fs.readFileSync(
  'app/src/components/ui/AppShell.module.css',
  'utf8',
)

test('payment requests card keeps its content height inside the scrollable page', () => {
  assert.match(solicitudesCss, /\.tableCard\s*\{[^}]*flex-shrink:\s*0;/)
  assert.match(solicitudesCss, /\.tableCard\s*\{[^}]*overflow:\s*hidden;/)
  assert.match(appShellCss, /\.page\s*\{[^}]*overflow:\s*auto;/)
})
