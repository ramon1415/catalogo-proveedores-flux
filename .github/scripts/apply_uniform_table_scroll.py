from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:90]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


scroll_block = """.tableWrap { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
.tableWrap::-webkit-scrollbar { width: 9px; height: 9px; }
.tableWrap::-webkit-scrollbar-track { background: transparent; }
.tableWrap::-webkit-scrollbar-thumb { background: var(--border-strong); border: 2px solid transparent; border-radius: 999px; background-clip: padding-box; }
.tableWrap::-webkit-scrollbar-corner { background: transparent; }"""

layouts = Path("app/src/features/layouts/Layouts.module.css")
replace_once(
    layouts,
    ".phead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }",
    ".phead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-shrink: 0; }",
)
replace_once(
    layouts,
    ".statsGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }",
    ".statsGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; flex-shrink: 0; }",
)
replace_once(
    layouts,
    ".tableCard { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }",
    ".tableCard { flex: 1 1 0; min-height: 240px; display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }",
)
replace_once(
    layouts,
    ".toolbar { display: flex; gap: 10px; padding: 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }",
    ".toolbar { display: flex; gap: 10px; padding: 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; flex-shrink: 0; }",
)
replace_once(
    layouts,
    ".ux2Note { margin: 10px 16px 0; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: rgba(255,255,255,.018); color: var(--text-3); font-size: 12px; }",
    ".ux2Note { margin: 10px 16px 0; border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; background: rgba(255,255,255,.018); color: var(--text-3); font-size: 12px; flex-shrink: 0; }",
)
replace_once(layouts, ".tableWrap { overflow-x: auto; }", scroll_block)
replace_once(
    layouts,
    ".table thead th { text-align: left; font-size: 10px;",
    ".table thead th { position: sticky; top: 0; z-index: 1; text-align: left; font-size: 10px;",
)

providers = Path("app/src/features/proveedores/Proveedores.module.css")
replace_once(
    providers,
    ".phead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }",
    ".phead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; flex-shrink: 0; }",
)
replace_once(
    providers,
    ".tableCard { background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }",
    ".tableCard { flex: 1 1 0; min-height: 240px; display: flex; flex-direction: column; background: var(--bg-card); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }",
)
replace_once(
    providers,
    ".toolbar { display: flex; gap: 10px; padding: 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }",
    ".toolbar { display: flex; gap: 10px; padding: 14px; border-bottom: 1px solid var(--border); flex-wrap: wrap; flex-shrink: 0; }",
)
replace_once(providers, ".tableWrap { overflow-x: auto; }", scroll_block)
replace_once(
    providers,
    ".table thead th { text-align: left; font-size: 10px;",
    ".table thead th { position: sticky; top: 0; z-index: 1; text-align: left; font-size: 10px;",
)

requests = Path("app/src/features/solicitudes/Solicitudes.module.css")
replace_once(
    requests,
    ".tableWrap { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }",
    scroll_block,
)

test_path = Path("scripts/qa/uniform-primary-table-scroll-contract.test.mjs")
test_path.write_text(
    """import assert from 'node:assert/strict'
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
""",
    encoding="utf-8",
)
