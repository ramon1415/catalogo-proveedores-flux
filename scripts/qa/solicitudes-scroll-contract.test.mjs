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

test('payment requests keep KPIs visible and scroll only inside the requests card', () => {
  assert.match(solicitudesCss, /\.phead\s*\{[^}]*flex-shrink:\s*0;/)
  assert.match(solicitudesCss, /\.statsGrid\s*\{[^}]*flex-shrink:\s*0;/)
  assert.match(solicitudesCss, /\.tableCard\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*240px;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/)
  assert.match(solicitudesCss, /\.tableWrap\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;[^}]*scrollbar-gutter:\s*stable;/)
  assert.match(solicitudesCss, /\.table thead th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;[^}]*z-index:\s*1;/)
  assert.match(appShellCss, /\.page\s*\{[^}]*overflow:\s*auto;/)
})
