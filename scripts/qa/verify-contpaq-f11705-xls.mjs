import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from '../../app/node_modules/xlsx/xlsx.mjs'

const dir = 'qa-artifact/contpaq-f11705-ui'
const files = fs.readdirSync(dir)
const diarioFile = files.find(f => f.endsWith('_diario.xls'))
const pagoFile = files.find(f => f.endsWith('_pago.xls'))
assert.ok(diarioFile, 'missing diario xls')
assert.ok(pagoFile, 'missing pago xls')

function values(file) {
  const bytes = fs.readFileSync(path.join(dir, file))
  const wb = XLSX.read(bytes, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })
  return rows.flat().map(v => String(v).replace(/-/g, '').trim())
}
const diario = values(diarioFile)
const pago = values(pagoFile)
const has = (arr, value) => arr.some(v => v.includes(value))

for (const code of ['60202002000','11901100000','20101202000']) {
  assert.ok(has(diario, code), `diario missing ${code}`)
}
assert.ok(!has(diario, '10201100000'), 'diario must not include bank')
assert.ok(!has(diario, '11801100000'), 'diario must not include paid VAT account')

for (const code of ['20101202000','10201100000','11801100000','11901100000']) {
  assert.ok(has(pago, code), `pago missing ${code}`)
}
assert.ok(!has(pago, '60202002000'), 'pago must not rebook expense')

for (const amount of ['80,161','12,825.76','92,986.76']) {
  const normalized = amount.replace(/,/g,'')
  const present = diario.concat(pago).some(v => v.replace(/,/g,'').includes(normalized))
  assert.ok(present, `missing amount ${amount}`)
}

console.log(JSON.stringify({
  result:'CONTPAQ_F11705_XLS_PASS',
  diario:diarioFile,
  pago:pagoFile,
  checks:{
    diario:['60202002000','11901100000','20101202000'],
    pago:['20101202000','10201100000','11801100000','11901100000'],
    expense_not_in_pago:true,
    bank_not_in_diario:true
  }
}, null, 2))
