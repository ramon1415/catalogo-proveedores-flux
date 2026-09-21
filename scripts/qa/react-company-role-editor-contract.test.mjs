import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const panelUrl = new URL(
  '../../app/src/features/configuracion/tabs/UsersPanel.tsx',
  import.meta.url,
)
const platformPowerUrl = new URL(
  '../../app/src/lib/platformPower.ts',
  import.meta.url,
)

const panel = await readFile(panelUrl, 'utf8')
const platformPower = await readFile(platformPowerUrl, 'utf8')

test('company role editor never presents a missing or legacy role as operator', () => {
  assert.match(panel, /function editableCompanyRole/)
  assert.match(panel, /value=\{role\}/)
  assert.match(panel, /<option value="" disabled>\{m \? 'Definir rol' : 'Sin rol'\}<\/option>/)
  assert.doesNotMatch(panel, /value=\{m\?\.role_key \|\| 'operator'\}/)
})

test('legacy global admin state does not lock company role editing', () => {
  assert.match(panel, /disabled=\{busy \|\| selected\.active !== true\}/)
  assert.doesNotMatch(panel, /disabled=\{[^}]*selected\.group === 'sysadmin'/)
})

test('membership activation requires an explicit editable company role', () => {
  assert.match(panel, /if \(!role\) \{[\s\S]*Define primero el rol/)
  assert.match(panel, /disabled=\{busy \|\| selected\.active !== true \|\| !role\}/)
  assert.doesNotMatch(panel, /row\?\.role_key[^\n]*: 'operator'/)
})

test('global power label is restricted to the two approved platform accounts', () => {
  assert.match(platformPower, /'carlos@quantta\.mx'/)
  assert.match(platformPower, /'ramon@quantta\.mx'/)
  assert.match(panel, /selectedHasPlatformPower \? 'Poder total global' : 'Roles definidos por empresa'/)
  assert.doesNotMatch(panel, /selected\.group === 'sysadmin' \? 'Poder total global'/)
})
