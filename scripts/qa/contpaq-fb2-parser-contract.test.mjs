import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const coreSource = fs.readFileSync('lib/parsers/cfdiCore.js', 'utf8')
const browserSource = fs.readFileSync('lib/parsers/cfdiBrowser.js', 'utf8')
const coreUrl = `data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`
const core = await import(coreUrl)

function executableSource(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function validTree(overrides = {}) {
  const comprobante = {
    '@_Version': '4.0',
    '@_Fecha': '2026-08-25T10:15:00',
    '@_TipoDeComprobante': 'I',
    '@_MetodoPago': 'PUE',
    '@_FormaPago': '03',
    '@_Moneda': 'MXN',
    '@_SubTotal': '100.00',
    '@_Total': '116.00',
    'cfdi:Emisor': {
      '@_Rfc': 'AAA010101AAA',
      '@_Nombre': 'Proveedor Sintetico',
      '@_RegimenFiscal': '601',
    },
    'cfdi:Receptor': {
      '@_Rfc': 'BBB010101BBB',
      '@_Nombre': 'Empresa Sintetica',
      '@_UsoCFDI': 'G03',
    },
    'cfdi:Impuestos': {
      '@_TotalImpuestosTrasladados': '16.00',
      'cfdi:Traslados': {
        'cfdi:Traslado': {
          '@_Base': '100.00',
          '@_Impuesto': '002',
          '@_TipoFactor': 'Tasa',
          '@_TasaOCuota': '0.160000',
          '@_Importe': '16.00',
        },
      },
    },
    'cfdi:Complemento': {
      'tfd:TimbreFiscalDigital': {
        '@_UUID': '11111111-2222-3333-4444-555555555555',
      },
    },
    ...overrides,
  }
  return { 'cfdi:Comprobante': comprobante }
}

function paymentTree() {
  return validTree({
    '@_TipoDeComprobante': 'P',
    '@_Moneda': 'XXX',
    '@_SubTotal': '0',
    '@_Total': '0',
    'cfdi:Complemento': {
      'pago20:Pagos': {
        '@_Version': '2.0',
        'pago20:Totales': { '@_MontoTotalPagos': '62391.01' },
        'pago20:Pago': {
          '@_FechaPago': '2026-06-27T00:00:00',
          '@_FormaDePagoP': '03',
          '@_MonedaP': 'MXN',
          '@_TipoCambioP': '1',
          '@_Monto': '62391.01',
          'pago20:DoctoRelacionado': {
            '@_IdDocumento': 'DDDD6666-EEEE-7777-FFFF-888899990000',
            '@_ImpSaldoAnt': '62391.01',
            '@_ImpPagado': '62391.01',
            '@_ImpSaldoInsoluto': '0',
          },
        },
      },
      'tfd:TimbreFiscalDigital': {
        '@_UUID': '12121212-3434-5656-7878-909090909090',
      },
    },
  })
}

test('FB-2 parser core has zero imports and no executable Node/browser/network dependencies', () => {
  const runtime = executableSource(coreSource)
  assert.doesNotMatch(runtime, /^\s*import\s/m)
  assert.doesNotMatch(runtime, /fast-xml-parser|\brequire\s*\(|node:|\bfs\b|DOMParser|fetch\s*\(|XMLHttpRequest|WebSocket|supabase/i)
})

test('FB-2 browser entry imports only the core, handles parsererror and rejects DOCTYPE before DOMParser', () => {
  const imports = Array.from(browserSource.matchAll(/^\s*import\s+.*?from\s+['"]([^'"]+)['"]/gm), (m) => m[1])
  const runtime = executableSource(browserSource)
  assert.deepEqual(imports, ['./cfdiCore.js'])
  assert.match(runtime, /<!DOCTYPE/i)
  assert.match(runtime, /XML con DOCTYPE rechazado/)
  assert.match(runtime, /new DOMParser\(\)\.parseFromString/)
  assert.match(runtime, /querySelector\(['"]parsererror['"]\)/)
  assert.doesNotMatch(runtime, /fast-xml-parser|\brequire\s*\(|node:|\bfs\b|fetch\s*\(|XMLHttpRequest|WebSocket|supabase/i)
})

test('FB-2 core parses the certified nested shape used by Flux adapter', () => {
  const parsed = core.parseCfdiDesdeArbol(validTree())
  assert.equal(parsed.version, '4.0')
  assert.equal(parsed.comprobante.moneda, 'MXN')
  assert.equal(parsed.comprobante.total, 116)
  assert.equal(parsed.emisor.rfc, 'AAA010101AAA')
  assert.equal(parsed.receptor.rfc, 'BBB010101BBB')
  assert.equal(parsed.uuid, '11111111-2222-3333-4444-555555555555')
  assert.equal(parsed.impuestos.traslados.length, 1)
  assert.equal(parsed.impuestos.traslados[0].importe, 16)
})

test('FB-2 core exposes Pagos 2.0 effective evidence without changing pagos array contract', () => {
  const parsed = core.parseCfdiDesdeArbol(paymentTree())
  assert.equal(parsed.comprobante.tipoDeComprobante, 'P')
  assert.equal(parsed.comprobante.total, 0)
  assert.equal(parsed.comprobante.moneda, 'XXX')
  assert.equal(parsed.pagosTotales.montoTotalPagos, 62391.01)
  assert.equal(Array.isArray(parsed.pagos), true)
  assert.equal(parsed.pagos.length, 1)
  assert.equal(parsed.pagos[0].monedaP, 'MXN')
  assert.equal(parsed.pagos[0].tipoCambioP, 1)
  assert.equal(parsed.pagos[0].montoP, 62391.01)
})

test('FB-2 core rejects non-CFDI and unsupported version with typed errors', () => {
  assert.throws(() => core.parseCfdiDesdeArbol({ root: {} }), (error) => error?.name === 'CfdiParseError')
  const tree = validTree({ '@_Version': '3.3' })
  assert.throws(
    () => core.parseCfdiDesdeArbol(tree),
    (error) => error?.name === 'CfdiParseError' && /Versión de CFDI no soportada/.test(error.message),
  )
})

test('FB-2 parser contains no accounting resolution or export path', () => {
  const source = `${executableSource(coreSource)}\n${executableSource(browserSource)}`
  assert.doesNotMatch(source, /213-|216-|contpaq_account|tax_resolver|budget_account_mappings|exportar.*p[oó]liza/i)
})
