import { useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { bulkCreateProviders } from './api'
import type { ProviderPayload } from './types'
import s from './Proveedores.module.css'

// Alta masiva por listado (junta Fersana 7-sep): pegar CSV/TSV de los
// proveedores recurrentes y crearlos de golpe, en vez de uno por uno. Reusa el
// mismo RPC de alta (validación + RLS por fila). No expone ningún dato nuevo.
//
// Formato (una fila por proveedor, separado por TAB o coma; encabezado opcional):
//   alias, nombre / razón social, RFC, método, banco, CLABE
// Solo alias y nombre son obligatorios; el resto es opcional.

type ParsedRow = { payload: ProviderPayload; error: string }

const HEADER_HINT = /alias|nombre|raz[oó]n|rfc/i

function splitCells(line: string): string[] {
  const byTab = line.split('\t')
  const cells = byTab.length > 1 ? byTab : line.split(',')
  return cells.map((c) => c.trim())
}

function buildPayload(cells: string[]): ProviderPayload {
  const [alias = '', nombre = '', rfc = '', metodo = '', banco = '', clabe = ''] = cells
  const metodoPago = metodo.trim() || 'Transferencia bancaria'
  const isTransfer = /transfer/i.test(metodoPago)
  const clabeClean = clabe.replace(/\s+/g, '')
  const hasClabe = isTransfer && clabeClean.length > 0
  return {
    alias: alias.trim(),
    nombre_completo: nombre.trim(),
    rfc: rfc.trim().toUpperCase() || null,
    metodo_pago: metodoPago,
    tipo_cuenta: hasClabe ? 'CLABE' : null,
    destination_type: hasClabe ? 'clabe' : null,
    beneficiary_name: nombre.trim(),
    banco: isTransfer ? banco.trim() || null : null,
    clabe: hasClabe ? clabeClean : null,
    cuenta_bancaria: null,
    convenio_number: null,
    persona_tipo: null,
    email: null,
    telefono: null,
    tipo_proveedor: null,
    notas: null,
    es_personal_eventual: false,
    activo: true,
    updated_at: new Date().toISOString(),
  }
}

function validate(p: ProviderPayload): string {
  if (!p.alias) return 'Falta alias'
  if (!p.nombre_completo) return 'Falta nombre / razón social'
  if (p.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(p.rfc)) return 'RFC con formato inválido'
  if (p.clabe && !/^\d{18}$/.test(p.clabe)) return 'CLABE debe tener 18 dígitos'
  return ''
}

export function BulkProviderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const [raw, setRaw] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  const rows = useMemo<ParsedRow[]>(() => {
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length && HEADER_HINT.test(lines[0]) && /rfc|método|metodo|banco|clabe/i.test(lines[0])) lines.shift()
    return lines.map((line) => {
      const payload = buildPayload(splitCells(line))
      return { payload, error: validate(payload) }
    })
  }, [raw])

  const validRows = rows.filter((r) => !r.error)
  const invalidCount = rows.length - validRows.length

  async function onSubmit() {
    if (saving || !validRows.length) return
    setSaving(true)
    try {
      const results = await bulkCreateProviders(validRows.map((r) => r.payload))
      const ok = results.filter((r) => r.ok).length
      const failed = results.filter((r) => !r.ok)
      if (failed.length) {
        showToast(
          `${ok} creados, ${failed.length} con error`,
          failed.slice(0, 3).map((f) => `${f.alias}: ${f.error}`).join(' · '),
          ok ? 'warning' : 'error',
        )
      } else {
        showToast('Proveedores creados', `${ok} proveedores dados de alta.`, 'success')
      }
      if (ok) onSaved()
    } catch (error) {
      showToast('No se pudo cargar el lote', (error as { message?: string })?.message || 'error', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={s.dialog} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={(e) => { e.preventDefault(); void onSubmit() }}>
        <div className={s.modalHead}>
          <div>
            <h2>Alta masiva de proveedores</h2>
            <p>Pega un proveedor por línea. Columnas: alias, nombre / razón social, RFC, método, banco, CLABE. Solo alias y nombre son obligatorios.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <label className={s.fullRow}>Listado (TAB o coma como separador)
            <textarea
              className={s.formControl}
              rows={7}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={'CFE Suministrador, CFE SUMINISTRADOR SA, CSS160330CP7, Transferencia, Santander\nTOKA, TOKA INTERNACIONAL SAPI DE CV, TIN090211JC9, Transferencia, BBVA, 012180001135096214'}
              style={{ fontFamily: 'var(--mono)', fontSize: '12.5px' }}
            />
          </label>

          {rows.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>{validRows.length} válidos</span>
              {invalidCount > 0 && <span style={{ color: 'var(--ruby, #c93047)' }}>{invalidCount} con error</span>}
            </div>
          )}

          {rows.length > 0 && (
            <div className={s.tableWrap} style={{ marginTop: 8 }}>
              <table className={s.table}>
                <thead><tr><th>Alias</th><th>Nombre / razón social</th><th>RFC</th><th>Método</th><th>Estado</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.payload.alias || '—'}</td>
                      <td>{r.payload.nombre_completo || '—'}</td>
                      <td>{r.payload.rfc || '—'}</td>
                      <td>{r.payload.metodo_pago}</td>
                      <td style={{ color: r.error ? 'var(--ruby, #c93047)' : 'var(--emerald, #0d9f57)', fontWeight: 500 }}>
                        {r.error || 'Listo'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving || !validRows.length}>
            {saving ? 'Creando…' : `Crear ${validRows.length} proveedor${validRows.length === 1 ? '' : 'es'}`}
          </button>
        </div>
      </form>
    </dialog>
  )
}
