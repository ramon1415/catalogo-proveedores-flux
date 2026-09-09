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


function loadModalUi(file, imports) {
  const path = resolve(root, 'app/src', file)
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw new Error(`Unisolated modal dependency: ${name}`)
  }, module, module.exports)
  return module.exports
}

function modalPresentation(activeName) {
  const company = loadModalUi('lib/company.tsx', { './auth': {} })
  const context = loadModalUi('components/ui/CompanyCaptureContext.tsx', {
    '../../lib/company': { ...company, useCompany: () => ({ companyName: activeName() }) },
    '../../assets/favicon-512.png': 'flux-mark',
    './CompanyCaptureContext.module.css': {},
  })
  const { Modal } = loadModalUi('components/ui/Modal.tsx', { './Modal.module.css': {}, './CompanyCaptureContext': context })
  return { Modal, context }
}

test('operational modal follows active company; explicit form/record company overrides it without duplicates', () => {
  let activeName = 'Operadora Tlacatecpan'
  const { Modal, context } = modalPresentation(() => activeName)
  const props = { title: 'Principal', onClose() {} }
  const nativeDialog = { open: false, showModal() { this.open = true }, close() { this.open = false } }
  let view
  act(() => { view = create(React.createElement(Modal, props, 'Contenido'), { createNodeMock: n => n.type === 'dialog' ? nativeDialog : {} }) })
  try {
    assert.match(text(view.toJSON()), /Empresa activaOperadora Tlacatecpan/)
    assert.equal(view.root.findByType('img').parent.props.style.backgroundColor, '#b7cbdd')
    activeName = 'Soporte Fersana'
    act(() => view.update(React.createElement(Modal, props, 'Contenido')))
    assert.match(text(view.toJSON()), /Empresa activaSoporte Fersana/)
    assert.equal(view.root.findByType('img').parent.props.style.backgroundColor, '#c8c5b1')
    const headerContext = React.createElement(context.CompanyCaptureContext, { company: { name: 'Operadora Tlacatecpan' } })
    act(() => view.update(React.createElement(Modal, { ...props, headerContext }, 'Contenido')))
    assert.match(text(view.toJSON()), /EmpresaOperadora Tlacatecpan/)
    assert.doesNotMatch(text(view.toJSON()), /Soporte Fersana/)
    assert.equal(view.root.findAllByType('img').length, 1)
    const empty = React.createElement(context.CompanyCaptureContext, { company: null })
    act(() => view.update(React.createElement(Modal, { ...props, headerContext: empty }, 'Contenido')))
    assert.match(text(view.toJSON()), /Sin seleccionar/)
    assert.doesNotMatch(text(view.toJSON()), /Soporte Fersana/)
    act(() => view.update(React.createElement(Modal, { ...props, headerContext: null }, 'Contenido')))
    assert.equal(view.root.findAllByType('img').length, 0, 'company switcher can retain its own existing list')
  } finally { act(() => view.unmount()) }
})

test('embedded modal company follows its own selector, refreshes on open/change, and removes observers/hosts on unmount', () => {
  const { context } = modalPresentation(() => 'Operadora Tlacatecpan')
  const { LegacyCompanyModalContexts, legacyModalCompany } = loadModalUi('pages/LegacyCompanyModalContexts.tsx', {
    'react-dom': { createPortal: (child, _host, key) => React.cloneElement(child, { key }) },
    '../components/ui/CompanyCaptureContext': context,
    '../components/ui/CompanyCaptureContext.module.css?inline': '/* shared styles */',
  })
  let selection = { value: '', selectedOptions: [{ textContent: 'Selecciona…' }] }
  const dialog = { querySelector: () => selection }
  assert.deepEqual(legacyModalCompany(dialog, 'Operadora Tlacatecpan'), { name: null, label: 'Empresa' })
  assert.deepEqual(legacyModalCompany({ querySelector: () => null }, 'Operadora Tlacatecpan'), { name: 'Operadora Tlacatecpan', label: 'Empresa activa' })
  const elements = [], listeners = new Map(), hosts = []
  const header = { closest: () => dialog, appendChild: element => hosts.push(element) }
  const doc = {
    head: { appendChild() {} }, body: {}, querySelectorAll: () => [header],
    createElement: () => { const element = { removed: false, remove() { this.removed = true } }; elements.push(element); return element },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  }
  const previousObserver = globalThis.MutationObserver
  let observer, view
  globalThis.MutationObserver = class {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {}
    disconnect() { this.disconnected = true }
  }
  try {
    act(() => { view = create(React.createElement(LegacyCompanyModalContexts, { doc, companyName: 'Operadora Tlacatecpan' })) })
    assert.match(text(view.toJSON()), /Sin seleccionar/)
    selection = { value: 'fersana', selectedOptions: [{ textContent: 'Soporte Fersana' }] }
    act(() => listeners.get('change')())
    assert.match(text(view.toJSON()), /Soporte Fersana/)
    assert.equal(view.root.findByType('img').parent.props.style.backgroundColor, '#c8c5b1')
    selection = { value: 'operadora', selectedOptions: [{ textContent: 'Operadora Tlacatecpan' }] }
    act(() => observer.callback())
    assert.match(text(view.toJSON()), /Operadora Tlacatecpan/)
    act(() => observer.callback())
    assert.equal(hosts.length, 1, 'repeated DOM updates must not add duplicate company headers')
    assert.equal(selection.value, 'operadora', 'presentation does not change the form selection')
    act(() => view.unmount()); view = null
    assert.equal(observer.disconnected, true)
    assert.equal(listeners.size, 0)
    assert.ok(elements.every(element => element.removed))
  } finally {
    if (view) act(() => view.unmount())
    globalThis.MutationObserver = previousObserver
  }
})
