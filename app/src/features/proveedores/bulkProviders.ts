import type { Provider, ProviderPayload } from './types'

export const MAX_BULK_ROWS = 200
export const MAX_BULK_CHARS = 200_000
export type ProviderIdentity = Pick<Provider, 'id' | 'alias' | 'nombre_completo' | 'rfc' | 'clabe' | 'activo'>
export type BulkStatus = 'ready' | 'invalid' | 'duplicate' | 'existing' | 'conflict' | 'created' | 'failed' | 'unconfirmed' | 'stopped'
export type BulkRow = {
  line: number
  cells: string[]
  payload: ProviderPayload
  status: BulkStatus
  message: string
  id?: string
}
export type BulkParse = { rows: BulkRow[]; error: string }
export type BulkPort = {
  identities: () => Promise<ProviderIdentity[]>
  create: (payload: ProviderPayload) => Promise<string>
  canContinue: () => boolean
  onResult?: (row: BulkRow) => void
}

const aliasKey = (s: string | null) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase()
const rfcKey = (s: string | null) => (s || '').trim().toUpperCase()
const clabeKey = (s: string | null) => (s || '').replace(/[\s-]/g, '')
const labelKey = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\s_]+/g, ' ')
const headings: Record<string, number> = {
  alias: 0, nombre: 1, 'nombre completo': 1, 'razon social': 1, 'nombre / razon social': 1,
  rfc: 2, metodo: 3, 'metodo pago': 3, 'metodo de pago': 3, banco: 4, clabe: 5,
}
const methods: Record<string, string> = {
  transferencia: 'Transferencia bancaria', 'transferencia bancaria': 'Transferencia bancaria',
  efectivo: 'Efectivo', cheque: 'Cheque', 'tarjeta en plataforma': 'Tarjeta en plataforma',
  'deposito a cuenta': 'Depósito a cuenta', otro: 'Otro',
}

// Delimiter is selected from the first logical record, ignoring quoted content.
function delimiterOf(text: string): string {
  let quoted = false
  const counts = new Map([['\t', 0], [',', 0], [';', 0]])
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { i++; continue }
      quoted = !quoted
    } else if (!quoted) {
      if (c === '\n' || c === '\r') {
        if ([...counts.values()].some(Boolean)) break
      } else if (counts.has(c)) counts.set(c, counts.get(c)! + 1)
    }
  }
  if (counts.get('\t')) return '\t' // Pasted Excel cells may contain commas.
  return counts.get(';')! > counts.get(',')! ? ';' : ','
}

// A small strict CSV/TSV reader: quotes, escaped quotes, CRLF and embedded newlines.
// No trim on whole rows: a leading TAB is an empty alias, not a shifted column.
function recordsOf(text: string): { cells: string[]; line: number }[] {
  const sep = delimiterOf(text)
  const records: { cells: string[]; line: number }[] = []
  let cells: string[] = [], cell = '', quoted = false, closed = false, line = 1, start = 1
  const field = () => { cells.push(cell.trim()); cell = ''; closed = false }
  const record = () => {
    field()
    if (cells.some(Boolean)) records.push({ cells, line: start })
    cells = []
    if (records.length > MAX_BULK_ROWS + 1) throw Error(`Máximo ${MAX_BULK_ROWS} proveedores por lote.`)
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true }
      } else if (c === '\r' || c === '\n') {
        if (c === '\r' && text[i + 1] === '\n') i++
        cell += '\n'; line++
      } else cell += c
    } else if (c === sep) field()
    else if (c === '\r' || c === '\n') {
      record(); if (c === '\r' && text[i + 1] === '\n') i++
      line++; start = line
    } else if (c === '"') {
      if (closed || cell.trim()) throw Error(`Comillas inesperadas en línea ${line}. Encierra el campo completo entre comillas.`)
      quoted = true; cell = ''
    } else {
      if (closed && c.trim()) throw Error(`Falta separador después de comillas en línea ${line}.`)
      if (!closed) cell += c
    }
  }
  if (quoted) throw Error(`Comillas sin cerrar desde la línea ${start}.`)
  record()
  return records
}

function payloadOf(cells: string[]): ProviderPayload {
  const [alias = '', name = '', rfc = '', method = '', bank = '', clabe = ''] = cells
  const key = labelKey(method)
  const payment = Object.prototype.hasOwnProperty.call(methods, key) ? methods[key] : method || 'Transferencia bancaria'
  const supplied = Boolean(bank || clabe)
  return {
    alias, nombre_completo: name, rfc: rfcKey(rfc) || null, metodo_pago: payment,
    banco: bank || null, clabe: clabeKey(clabe) || null,
    tipo_cuenta: clabe ? 'CLABE' : null, destination_type: clabe ? 'clabe' : null,
    beneficiary_name: supplied ? name : null,
    cuenta_bancaria: null, convenio_number: null, persona_tipo: null, email: null,
    telefono: null, tipo_proveedor: null, notas: null, es_personal_eventual: false, activo: true,
    updated_at: '', // Timestamp belongs to execution, not parsing/rendering.
  }
}

export function validateBulkPayload(p: ProviderPayload): string {
  if (!p.alias?.trim()) return 'Falta alias.'
  if (!p.nombre_completo?.trim()) return 'Falta nombre / razón social.'
  if (/[\r\n\t]/.test(p.alias + p.nombre_completo)) return 'Alias y razón social deben estar en una sola línea.'
  if (p.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(p.rfc)) return 'RFC con formato inválido.'
  if (!Object.values(methods).includes(p.metodo_pago || '')) return 'Método no reconocido. Usa transferencia, efectivo, cheque, tarjeta en plataforma, depósito a cuenta u otro.'
  if ((p.banco || p.clabe) && p.metodo_pago !== 'Transferencia bancaria') return 'Los datos bancarios de este listado requieren Transferencia bancaria. Usa el alta individual para otros destinos.'
  if (p.clabe && !/^\d{18}$/.test(p.clabe)) return 'La CLABE debe conservar 18 dígitos. En Excel usa formato Texto; no notación científica.'
  if (p.clabe && !p.banco) return 'Falta banco para la CLABE.'
  if (p.banco && !p.clabe) return 'Falta CLABE. Para cuenta o convenio utiliza el alta individual.'
  return ''
}

export function parseBulkProviders(raw: string): BulkParse {
  if (raw.length > MAX_BULK_CHARS) return { rows: [], error: 'El listado es demasiado grande. Divide el archivo en lotes.' }
  try {
    let records = recordsOf(raw.replace(/^\uFEFF/, ''))
    if (!records.length) return { rows: [], error: '' }
    const first = records[0].cells.map(labelKey)
    let order: number[] | null = null
    // Only an explicit alias + name header is a header, never a fuzzy regex.
    if (first.includes('alias') && first.some(k => headings[k] === 1)) {
      order = first.map(k => Object.prototype.hasOwnProperty.call(headings, k) ? headings[k] : -1)
      if (order.includes(-1) || new Set(order).size !== order.length) {
        return { rows: [], error: 'Encabezado inválido o repetido. Columnas: alias, nombre, RFC, método, banco, CLABE.' }
      }
      records = records.slice(1)
    }
    if (records.length > MAX_BULK_ROWS) return { rows: [], error: `Máximo ${MAX_BULK_ROWS} proveedores por lote.` }
    const rows = records.map(({ cells, line }): BulkRow => {
      let ordered = cells
      let error = ''
      if (order) {
        if (cells.length !== order.length) error = 'La fila no coincide con las columnas del encabezado.'
        ordered = Array<string>(6).fill('')
        order.forEach((target, i) => { ordered[target] = cells[i] || '' })
      } else if (cells.length < 2 || cells.length > 6) error = 'Se esperan entre 2 y 6 columnas. Encierra las razones sociales con comas entre comillas.'
      const payload = payloadOf(ordered)
      error ||= validateBulkPayload(payload)
      return { line, cells: ordered, payload, status: error ? 'invalid' : 'ready', message: error }
    })
    return { rows: markDuplicates(rows), error: '' }
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : 'No se pudo leer el listado.' }
  }
}

function identityKeys(p: Pick<ProviderPayload, 'alias' | 'rfc' | 'clabe'>): string[] {
  return [p.rfc && `rfc:${rfcKey(p.rfc)}`, p.alias && `alias:${aliasKey(p.alias)}`, p.clabe && `clabe:${clabeKey(p.clabe)}`].filter(Boolean) as string[]
}

function markDuplicates(rows: BulkRow[]): BulkRow[] {
  const seen = new Map<string, number>()
  return rows.map(row => {
    if (row.status !== 'ready') return row
    const keys = identityKeys(row.payload)
    const prior = keys.map(k => seen.get(k)).find(n => n !== undefined)
    if (prior !== undefined) return { ...row, status: 'duplicate', message: `RFC, alias o CLABE repetido en la línea ${prior}. No se creará dos veces.` }
    keys.forEach(k => seen.set(k, row.line))
    return row
  })
}

export function classifyBulkRow(row: BulkRow, catalog: ProviderIdentity[]): BulkRow {
  if (['invalid', 'duplicate', 'created', 'existing'].includes(row.status)) return row
  const p = row.payload
  const byRfc = p.rfc ? catalog.filter(c => rfcKey(c.rfc) === rfcKey(p.rfc)) : []
  const byAlias = catalog.filter(c => aliasKey(c.alias) === aliasKey(p.alias))
  const byClabe = p.clabe ? catalog.filter(c => clabeKey(c.clabe) === clabeKey(p.clabe)) : []
  const matched = [...new Map([...byRfc, ...byAlias, ...byClabe].map(c => [c.id, c])).values()]
  if (!matched.length) return { ...row, status: 'ready', message: !p.banco && p.metodo_pago === 'Transferencia bancaria' ? 'Listo. Sin datos bancarios; completar antes de pagar.' : 'Listo para crear.' }
  const conflicting = matched.length > 1 || (!byRfc.length && Boolean(p.rfc && matched[0].rfc && rfcKey(p.rfc) !== rfcKey(matched[0].rfc))) || (!byRfc.length && !byAlias.length)
  if (conflicting) return { ...row, status: 'conflict', message: 'RFC, alias o CLABE coinciden con identidades distintas. Revisa el catálogo; no se modificará ningún proveedor.' }
  return { ...row, status: 'existing', id: matched[0].id, message: `Ya existe por ${byRfc.length ? 'RFC' : 'alias'}${matched[0].activo === false ? ' (inactivo)' : ''}. No se creará, actualizará ni reactivará.` }
}

// Paginated identity-only reads: no hidden 1,000-row cutoff. Adapter must enforce
// deterministic id ordering; errors propagate, never masquerade as empty catalog.
export async function collectProviderIdentities(
  page: (after: string | null, limit: number) => Promise<ProviderIdentity[]>,
  pageSize = 500,
): Promise<ProviderIdentity[]> {
  const all: ProviderIdentity[] = []
  let after: string | null = null
  for (;;) {
    const rows = await page(after, pageSize)
    if (rows.length && rows[rows.length - 1].id === after) throw Error('CATALOG_PAGINATION_STALLED')
    all.push(...rows)
    if (rows.length < pageSize) return all
    after = rows[rows.length - 1].id
  }
}

// Existing unique indexes are the final concurrency guard. This orchestrator
// never updates a provider and never resubmits a confirmed row within the session.
// An ambiguous transport result stops further writes; the next explicit retry
// reloads the catalog before any create (also handles lost successful responses).
export async function runBulkProviders(rows: BulkRow[], port: BulkPort): Promise<BulkRow[]> {
  if (!port.canContinue()) return rows.map(r => r.status === 'ready' ? { ...r, status: 'stopped', message: 'Lote detenido: revisa empresa y permisos.' } : r)
  const catalog = await port.identities()
  const results: BulkRow[] = []
  let uncertain = false
  for (const row of rows) {
    let result = classifyBulkRow(row, catalog)
    if (result.status === 'ready') {
      if (uncertain || !port.canContinue()) result = { ...row, status: 'stopped', message: 'Pendiente: no se envió. Revisa el catálogo antes de continuar.' }
      else {
        try {
          const id = await port.create({ ...row.payload, updated_at: new Date().toISOString() })
          if (!id) throw Error('provider_rpc_response_invalid')
          result = { ...row, id, status: 'created', message: 'Creado.' }
          catalog.push({ id, alias: row.payload.alias, nombre_completo: row.payload.nombre_completo, rfc: row.payload.rfc, clabe: row.payload.clabe, activo: true })
        } catch (error) {
          const code = String((error as { code?: unknown })?.code || '')
          // SQLSTATE errors are definite server rejections. Other errors may be
          // lost responses after commit: stop; never automatically retry a write.
          if (/^[0-9A-Z]{5}$/.test(code)) {
            result = { ...row, status: 'failed', message: code === '23505' ? 'El catálogo cambió: ya existe RFC, alias o cuenta. Verifica antes de reintentar.' : 'El servidor rechazó esta fila. Revisa datos y permisos.' }
          } else {
            result = { ...row, status: 'unconfirmed', message: 'No se confirmó el guardado. El lote se detuvo; verifica el catálogo antes de reintentar.' }
            uncertain = true
          }
        }
      }
    }
    results.push(result)
    port.onResult?.(result)
  }
  return results
}

export function pendingBulkText(rows: BulkRow[]): string {
  const pending = rows.filter(r => !['created', 'existing', 'duplicate'].includes(r.status))
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`
  return pending.map(r => r.cells.map(quote).join('\t')).join('\n')
}
