import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'

const root = resolve(new URL('../..', import.meta.url).pathname)
const require = createRequire(resolve(root, 'app/package.json'))
const ts = require('typescript'), React = require('react')
const { create, act } = require('react-test-renderer')
const memberships = [{ company_id: 'opt', company_name: 'Operadora Tlacatecpan' }, { company_id: 'sf', company_name: 'Soporte Fersana' }]
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? text(node.children) : node?.props ? text(node.props.children) : ''

async function mount({ single = false, installed = false, theme } = {}) {
  const stored = new Map(), events = [], cache = new Map()
  globalThis.document = { documentElement: { dataset: theme ? { theme } : {} } }
  globalThis.sessionStorage = { getItem: k => stored.get(k) ?? null, setItem: (k,v) => stored.set(k,v) }
  globalThis.window = { dispatchEvent: e => events.push(e), addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }
  const auth = { memberships: single ? memberships.slice(1) : memberships, group: 'sysadmin', profile: { full_name: 'QA' }, session: { user: { email: 'qa@example.test' } }, signOut() {} }
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    if (path.endsWith('/lib/auth.tsx')) return { useAuth: () => auth }
    if (path.endsWith('/lib/moduleAccess.tsx')) return { useModules: () => ({ isEnabled: () => true }) }
    if (path.endsWith('/nomina/usePayrollAccess.ts')) return { usePayrollAccess: () => ({ can_capture: true }) }
    if (path.endsWith('/install/InstallProvider.tsx')) return { useInstall: () => ({ eligible: true, installed, busy: false, install() {} }) }
    if (path.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_,k) => k }) }
    if (/\.(png|webp)$/.test(path)) return { __esModule: true, default: 'qa-image' }
    const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } })
    const module = { exports: {} }; cache.set(path, module.exports)
    new Function('require', 'module', 'exports', outputText)(name => {
      if (name === 'react-router-dom') return { useLocation: () => ({ pathname: '/nomina' }), Outlet: () => React.createElement('main', null, 'Solicitudes'), NavLink: p => React.createElement('a', { href: p.to }, p.children) }
      if (name.startsWith('react')) return require(name)
      let dep = resolve(dirname(path), name)
      if (!existsSync(dep)) dep = ['.tsx','.ts'].map(ext => dep+ext).find(existsSync)
      if (!dep) throw Error(`Unresolved ${name}`)
      return load(dep)
    }, module, module.exports)
    cache.set(path, module.exports); return module.exports
  }
  const { CompanyProvider } = load(resolve(root, 'app/src/lib/company.tsx'))
  const { AppShell } = load(resolve(root, 'app/src/components/ui/AppShell.tsx'))
  let renderer
  await act(async () => { renderer = create(React.createElement(CompanyProvider, null, React.createElement(AppShell))) })
  return { renderer, events, stored, topbar: () => renderer.root.findByProps({ className: 'topbar' }), close: () => act(() => renderer.unmount()) }
}

test('company stays visible in browser and installed app; installation action stays out of topbar', async () => {
  for (const installed of [false, true]) {
    const f = await mount({ installed })
    try {
      assert.match(text(f.topbar()), /Operadora Tlacatecpan/)
      assert.equal(f.topbar().props.style['--company-accent'], '#b7cbdd')
      assert.doesNotMatch(text(f.topbar()), /Instalar Flux/)
      assert.equal(f.renderer.root.findAllByType('button').filter(b => String(b.props['aria-label']).startsWith('Empresa activa:')).length, 1)
      const sidebar = f.renderer.root.findByType('aside')
      assert.doesNotMatch(text(sidebar), /Operadora Tlacatecpan/)
      assert.equal(f.topbar().findAllByType('img').length, 0)
      assert.equal(text(sidebar).includes('Instalar Flux'), !installed)
    } finally { f.close() }
  }
})

test('changing company from the sole topbar selector updates header color and existing company event', async () => {
  const f = await mount()
  try {
    await act(async () => f.topbar().findAllByType('button').find(b => String(b.props['aria-label']).startsWith('Empresa activa:')).props.onClick())
    const dialog = f.renderer.root.findByType('dialog')
    const choices = dialog.findAllByType('button').filter(b => memberships.some(m => m.company_name === text(b)))
    assert.equal(choices.length, 2)
    await act(async () => choices.find(b => text(b) === 'Soporte Fersana').props.onClick())
    assert.match(text(f.topbar()), /Soporte Fersana/)
    assert.doesNotMatch(text(f.renderer.root.findByType('aside')), /Soporte Fersana/)
    assert.equal(f.renderer.root.findAllByType('button').filter(b => String(b.props['aria-label']).startsWith('Empresa activa:')).length, 1)
    assert.equal(f.topbar().props.style['--company-accent'], '#c8c5b1')
    assert.equal(f.stored.get('flux.company'), 'sf')
    assert.equal(f.events.at(-1).detail.companyId, 'sf')
    assert.equal(f.renderer.root.findAllByType('dialog').length, 0)
  } finally { f.close() }
})

test('single-company user sees their company without a switch option', async () => {
  const f = await mount({ single: true })
  try {
    assert.match(text(f.topbar()), /Soporte Fersana/)
    const company = f.topbar().findAllByType('button').find(b => String(b.props['aria-label']).startsWith('Empresa:'))
    assert.equal(company.props.disabled, true)
    await act(async () => company.props.onClick())
    assert.equal(f.renderer.root.findAllByType('dialog').length, 0)
  } finally { f.close() }
})


test('theme control reflects the current theme and toggles both ways', async () => {
  for (const initial of [undefined, 'light']) {
    const f = await mount({ theme: initial })
    try {
      const button = () => f.topbar().findAllByType('button').find(b => b.props.title === 'Tema claro / oscuro')
      let dark = initial !== 'light'
      for (let click = 0; click < 2; click++) {
        assert.equal(button().props['aria-label'], dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro')
        assert.equal(button().findAllByType('circle').length, dark ? 0 : 1)
        await act(async () => button().props.onClick())
        dark = !dark
        assert.equal(document.documentElement.dataset.theme, dark ? 'dark' : 'light')
        assert.equal(button().props['aria-label'], dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro')
        assert.equal(button().findAllByType('circle').length, dark ? 0 : 1)
      }
    } finally { f.close() }
  }
})
