import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..', '..')
const toast = fs.readFileSync(path.join(root, 'app/src/components/ui/Toast.tsx'), 'utf8')
const requestModal = fs.readFileSync(path.join(root, 'app/src/features/solicitudes/RequestModal.tsx'), 'utf8')

test('global toast viewport follows the topmost native dialog', () => {
  assert.match(toast, /import \{ createPortal \} from 'react-dom'/)
  assert.match(toast, /querySelectorAll<HTMLDialogElement>\('dialog\[open\]'\)/)
  assert.match(toast, /openDialogs\.item\(openDialogs\.length - 1\)/)
  assert.match(toast, /new MutationObserver\(syncActiveDialog\)/)
  assert.match(toast, /attributeFilter: \['open'\]/)
  assert.match(toast, /activeDialog \? createPortal\(viewport, activeDialog\) : viewport/)
})

test('dialog validation remains assertive and uses the shared visible toast', () => {
  assert.match(toast, /role=\{assertive \? 'alert' : 'status'\}/)
  assert.match(toast, /aria-live=\{assertive \? 'assertive' : 'polite'\}/)
  assert.match(requestModal, /showToast\('Desglose fiscal', fiscalValidation, 'warning'\)/)
})
