import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const root = new URL('../../', import.meta.url)
const require = createRequire(new URL('app/package.json', root))
const ts = require('typescript')
const { create, act } = require('react-test-renderer')
function load(path, mocks = {}) {
  const exports = {}
  const source = readFileSync(new URL(path, root), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, fileName: path }).outputText
  vm.runInNewContext(compiled, { exports, require: name => name in mocks ? mocks[name] : require(name) })
  return exports
}
const logic = load('app/src/features/proveedores/logic.ts')
const legacySource = readFileSync(new URL('proveedores.js', root), 'utf8')
const legacy = vm.runInNewContext(legacySource.slice(legacySource.indexOf('const PROVIDER_SAVE_ERROR_MESSAGES'), legacySource.indexOf('function logSupplierSaveDiagnostic')) + '\n({ messageForSaveError: e => PROVIDER_SAVE_ERROR_MESSAGES[providerSaveErrorCode(e)] })')

for (const [label, api] of [['React', logic], ['legacy', legacy]]) {
  test(`${label}: custom duplicate alias error takes priority over SQLSTATE and explains inactive records`, () => {
    const message = api.messageForSaveError({ code: '23505', message: 'alias_duplicado: el alias Ejemplo ya pertenece a otro proveedor' })
    assert.match(message, /alias/)
    assert.match(message, /Todos o Inactivos/)
    assert.match(message, /edita o reactiva/)
    assert.doesNotMatch(message, /permiso|Ejemplo|23505/)
  })
  for (const [constraint, field] of [
    ['proveedores_rfc_normalized_uidx', /RFC/], ['proveedores_clabe_normalized_uidx', /CLABE/],
    ['proveedores_bank_account_normalized_uidx', /cuenta bancaria/],
  ]) test(`${label}: ${constraint} identifies the conflicting field without leaking SQL details`, () => {
    const message = api.messageForSaveError({ code: '23505', message: `duplicate key value violates unique constraint "${constraint}"`, details: 'Key=(PRIVATE_VALUE) already exists.' })
    assert.match(message, field)
    assert.doesNotMatch(message, /PRIVATE_VALUE|constraint|23505/)
  })
  test(`${label}: invalid data and permission errors are distinct`, () => {
    assert.match(api.messageForSaveError({ code: 'P0001', message: 'rfc_invalido: use un RFC mexicano' }), /RFC inválido/)
    assert.match(api.messageForSaveError({ code: 'P0001', message: 'clabe_invalida: se requieren exactamente 18 digitos' }), /18 dígitos/)
    assert.match(api.messageForSaveError({ code: 'P0001', message: 'provider_create_role_required' }), /permiso/)
    assert.match(api.messageForSaveError({ code: '42501', message: 'permission denied for table proveedores' }), /permiso/)
    assert.match(api.messageForSaveError({ message: 'proveedor_not_found_or_inactive' }), /inactivo/)
  })
}

test('bank and RFC validation follow server formats without rejecting a valid 10-digit account', () => {
  const valid = { metodo_pago: 'Transferencia bancaria', destination_type: 'cuenta', banco: 'BANCO', cuenta_bancaria: '0123456789', nombre_completo: 'Proveedor de prueba' }
  assert.equal(logic.validateDestination(valid), '')
  assert.equal(logic.validateDestination({ ...valid, cuenta_bancaria: '0123-456 789' }), '')
  assert.match(logic.validateDestination({ ...valid, cuenta_bancaria: '123ABC' }), /Cuenta bancaria inválida/)
  assert.match(logic.validateDestination({ ...valid, destination_type: 'clabe', clabe: '123' }), /18 dígitos/)
  assert.equal(logic.validateDestination({ ...valid, destination_type: 'clabe', clabe: '012345-678901-234567' }), '')
  assert.match(logic.validateDestination({ ...valid, banco: 'b'.repeat(101) }), /Banco inválido/)
  assert.match(logic.validateDestination({ ...valid, beneficiary_name: 'x'.repeat(181) }), /Beneficiario inválido/)
  assert.match(logic.validateDestination({ ...valid, destination_type: 'convenio', convenio_number: 'x'.repeat(31) }), /Convenio inválido/)
  assert.equal(logic.validateProviderRfc('xaxx010101000'), '')
  assert.equal(logic.validateProviderRfc(null), '')
  assert.match(logic.validateProviderRfc('incorrecto'), /RFC inválido/)
  assert.doesNotMatch(logic.messageForSaveError({ message: 'private SQL statement' }), /private SQL/)
})

const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.children ? node.children.map(text).join('') : ''
test('modal preserves entered values, displays a persistent alert, blocks invalid fields and allows corrected retry', async () => {
  let calls = 0, saved = 0
  const { ProviderModal } = load('app/src/features/proveedores/ProviderModal.tsx', {
    './logic': logic,
    './Proveedores.module.css': { __esModule: true, default: {} },
    '../../components/ui/CompanyCaptureContext': { ActiveCompanyCaptureContext: () => null },
    '../../components/ui/Toast': { useToast: () => ({ showToast() {} }) },
    './api': { saveProvider: async () => { calls++; if (calls === 1) throw { code: '23505', message: 'alias_duplicado: el alias Ejemplo ya pertenece a otro proveedor' }; return 'provider-id' } },
  })
  let view
  await act(async () => { view = create(require('react').createElement(ProviderModal, { mode: 'create', provider: null, canManageProviders: true, onClose() {}, onSaved() { saved++ } })) })
  const field = label => view.root.findAllByType('label').find(n => text(n).startsWith(label)).find(n => ['input', 'select'].includes(n.type))
  const change = async (label, value) => act(async () => field(label).props.onChange({ target: { value } }))
  const submit = async () => act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  await change('Alias del proveedor', 'Ejemplo')
  await change('Nombre completo', 'Proveedor de prueba')
  await change('Método de pago', 'Efectivo')
  await submit()
  assert.match(text(view.root.findByProps({ role: 'alert' })), /Todos o Inactivos/)
  assert.equal(field('Alias del proveedor').props.value, 'Ejemplo')
  assert.equal(field('Nombre completo').props.value, 'Proveedor de prueba')
  assert.equal(saved, 0)
  await change('RFC', 'incorrecto')
  await submit()
  assert.equal(calls, 1)
  assert.match(text(view.root.findByProps({ role: 'alert' })), /RFC inválido/)
  await change('RFC', 'XAXX010101000')
  await change('Alias del proveedor', 'Ejemplo distinto')
  await submit()
  assert.equal(calls, 2)
  assert.equal(saved, 1)
  assert.equal(view.root.findAllByProps({ role: 'alert' }).length, 0)
  act(() => view.unmount())
})
