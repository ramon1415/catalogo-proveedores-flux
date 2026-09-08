import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../app/package.json', import.meta.url))
const ts = require('typescript'), React = require('react')
const { act, create } = require('react-test-renderer')
function load(file, imports = {}) {
  const source = readFileSync(new URL(`../../app/src/features/install/${file}`, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    if (name.startsWith('react')) return require(name)
    throw Error(`Unexpected dependency ${name}`)
  }, module, module.exports)
  return module.exports
}
const signedIn = () => ({ session: { access_token: 'session-1' }, profile: { id: 'profile-1', active: true }, loading: false, signOut: async () => {} })
async function mount(options = {}) {
  const listeners = {}, calls = [], metadata = []
  let auth = options.auth || signedIn(), state, renderer
  globalThis.window = { location: { hostname: options.hostname || 'flux.quantta.mx' }, matchMedia: () => ({ matches: !!options.standalone, addEventListener() {}, removeEventListener() {} }), addEventListener(k,v) { listeners[k] = v }, removeEventListener(k) { delete listeners[k] } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  globalThis.document = {}
  globalThis.fetch = async (url, config) => {
    assert.equal(url, '/api/pwa'); calls.push(config.method)
    if (options.fetch) return options.fetch(config)
    return { ok: !options.denied, json: async () => ({ eligible: !options.denied && config.method === 'POST', profileId: 'profile-1' }) }
  }
  const module = load('InstallProvider.tsx', {
    '../../lib/auth': { useAuth: () => auth },
    './InstallGuide': { InstallGuide: () => React.createElement('aside', null, 'guide') },
    './installMetadata': { enableInstallMetadata() { const entry = { removed: false }; metadata.push(entry); return () => { entry.removed = true } } },
  })
  const { InstallFluxButton } = load('InstallFluxButton.tsx', { './InstallProvider': module, './Install.module.css': { default: {} } })
  function Child() { state = module.useInstall(); return React.createElement('main', null, 'Flux browser', React.createElement(InstallFluxButton)) }
  const tree = () => React.createElement(module.InstallProvider, null, React.createElement(Child))
  await act(async () => { renderer = create(tree()) })
  return { renderer, calls, metadata, listeners, state: () => state,
    async update(value) { auth = value; await act(async () => renderer.update(tree())) },
    close() { act(() => renderer.unmount()) },
  }
}
test('allowed account gets install button; no native prompt opens manual instructions', async () => {
  const f = await mount()
  try {
    assert.equal(f.state().eligible, true); assert.equal(f.metadata.length, 1)
    assert.equal(f.renderer.root.findByType('button').props['aria-label'], 'Instalar Flux')
    await act(async () => f.state().install())
    assert.equal(f.renderer.root.findAllByType('aside').length, 1)
  } finally { f.close() }
  assert.equal(f.metadata[0].removed, true)
})
test('anonymous, denied, inactive and preview users retain browser without installation', async () => {
  for (const options of [{ auth: { session: null, profile: null, loading: false } }, { denied: true }, { auth: { ...signedIn(), profile: { id: 'profile-1', active: false } } }, { hostname: 'preview.vercel.app' }]) {
    const f = await mount(options)
    try { assert.equal(f.state().eligible, false); assert.equal(f.metadata.length, 0); assert.equal(f.renderer.root.findAllByType('button').length, 0); assert.equal(f.renderer.root.findAllByType('main').length, 1) }
    finally { f.close() }
  }
})
test('logout removes manifest and guide and clears the server cookie', async () => {
  const f = await mount()
  try {
    await act(async () => f.state().install())
    await f.update({ session: null, profile: null, loading: false })
    assert.equal(f.metadata[0].removed, true); assert.equal(f.state().eligible, false)
    assert.equal(f.renderer.root.findAllByType('aside').length, 0)
    assert.deepEqual(f.calls, ['POST', 'DELETE'])
  } finally { f.close() }
})
test('late authorization response cannot restore eligibility after logout; cookie writes ordered', async () => {
  let resolveOld
  const f = await mount({ fetch: config => config.method === 'POST' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ ok: true, json: async () => ({ eligible: false }) }) })
  try {
    await f.update({ session: null, profile: null, loading: false })
    assert.deepEqual(f.calls, ['POST'])
    await act(async () => { resolveOld({ ok: true, json: async () => ({ eligible: true, profileId: 'profile-1' }) }) })
    assert.deepEqual(f.calls, ['POST', 'DELETE']); assert.equal(f.metadata.length, 0); assert.equal(f.state().eligible, false)
  } finally { f.close() }
})
test('account switch removes old manifest and rechecks the new session', async () => {
  const f = await mount()
  try {
    await f.update({ ...signedIn(), session: { access_token: 'session-2' }, profile: { id: 'other-profile', active: true } })
    assert.equal(f.metadata[0].removed, true); assert.equal(f.metadata.length, 1)
    assert.equal(f.state().eligible, false); assert.deepEqual(f.calls, ['POST', 'POST'])
  } finally { f.close() }
})
test('native prompt is single use, appinstalled hides installation', async () => {
  const f = await mount(); let prompted = 0, prevented = 0
  try {
    f.listeners.beforeinstallprompt({ preventDefault() { prevented++ }, prompt: async () => { prompted++ }, userChoice: Promise.resolve({ outcome: 'dismissed' }) })
    await act(async () => f.state().install()); await act(async () => f.state().install())
    assert.equal(prompted, 1); assert.equal(prevented, 1)
    await act(async () => f.listeners.appinstalled())
    assert.equal(f.state().installed, true); assert.equal(f.renderer.root.findAllByType('button').length, 0)
  } finally { f.close() }
})
test('installed app checks account eligibility while allowing unauthenticated login', async () => {
  for (const [options, blocked] of [[{ standalone: true, denied: true }, true], [{ standalone: true }, false], [{ standalone: true, auth: { session: null, profile: null, loading: false } }, false]]) {
    const f = await mount(options)
    try { assert.equal(f.renderer.root.findAllByType('main').length, blocked ? 0 : 1); if (blocked) assert.equal(f.renderer.root.findByType('h2').children[0], 'Instalación no disponible para esta cuenta') }
    finally { f.close() }
  }
})
test('manifest uses credentialed same-origin endpoint and all injected metadata is removed', () => {
  const nodes = []
  const doc = { createElement(tag) { return { tag, dataset: {}, sizes: {}, remove() { this.removed = true } } }, head: { appendChild(node) { nodes.push(node) } } }
  const { enableInstallMetadata } = load('installMetadata.ts')
  const cleanup = enableInstallMetadata(doc)
  const manifest = nodes.find(n => n.rel === 'manifest')
  assert.equal(manifest.href, '/api/pwa'); assert.equal(manifest.crossOrigin, 'use-credentials')
  assert.ok(nodes.every(n => n.dataset.fluxPwa === 'pilot'))
  cleanup(); assert.ok(nodes.every(n => n.removed))
})
