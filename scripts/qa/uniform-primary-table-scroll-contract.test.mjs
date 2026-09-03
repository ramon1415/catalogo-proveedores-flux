import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const modules = {
  solicitudes: fs.readFileSync('app/src/features/solicitudes/Solicitudes.module.css', 'utf8'),
  layouts: fs.readFileSync('app/src/features/layouts/Layouts.module.css', 'utf8'),
  proveedores: fs.readFileSync('app/src/features/proveedores/Proveedores.module.css', 'utf8'),
}
const shell = fs.readFileSync('app/src/components/ui/AppShell.module.css', 'utf8')

test('the app shell remains a flex viewport with page-level fallback scroll', () => {
  assert.match(shell, /\.content\s*\{[^}]*height:\s*100vh[^}]*overflow:\s*hidden/s)
  assert.match(shell, /\.page\s*\{[^}]*flex:\s*1[^}]*overflow:\s*auto[^}]*display:\s*flex[^}]*flex-direction:\s*column/s)
})

test('Solicitudes, Layouts and Proveedores share one internal table-scroll contract', () => {
  for (const [name, css] of Object.entries(modules)) {
    assert.match(css, /\.tableCard\s*\{[^}]*flex:\s*1 1 0[^}]*min-height:\s*240px[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s, `${name}: table card must fill the remaining viewport`)
    assert.match(css, /\.tableWrap\s*\{[^}]*flex:\s*1[^}]*min-height:\s*0[^}]*overflow:\s*auto[^}]*overscroll-behavior:\s*contain[^}]*scrollbar-gutter:\s*stable[^}]*scrollbar-width:\s*thin/s, `${name}: table wrapper must own vertical and horizontal scroll`)
    assert.match(css, /\.tableWrap::\-webkit-scrollbar\s*\{[^}]*width:\s*9px[^}]*height:\s*9px/s, `${name}: Chrome scrollbar must be visible and uniform`)
    assert.match(css, /\.tableWrap::\-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--border-strong\)[^}]*border-radius:\s*999px/s, `${name}: scrollbar thumb must use the shared visual treatment`)
    assert.match(css, /\.table thead th\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*z-index:\s*1/s, `${name}: table headers must stay visible while scrolling`)
  }
})

test('headers and filters remain fixed above the internal table scroll', () => {
  assert.match(modules.solicitudes, /\.phead\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(modules.solicitudes, /\.statsGrid\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(modules.layouts, /\.phead\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(modules.layouts, /\.statsGrid\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(modules.layouts, /\.toolbar\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(modules.proveedores, /\.phead\s*\{[^}]*flex-shrink:\s*0/s)
  assert.match(modules.proveedores, /\.toolbar\s*\{[^}]*flex-shrink:\s*0/s)
})
