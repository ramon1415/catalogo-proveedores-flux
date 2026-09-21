import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { bulkCreateProviders, listBulkProviderIdentities } from './api'
import { classifyBulkRow, MAX_BULK_CHARS, parseBulkProviders, pendingBulkText } from './bulkProviders'
import type { BulkRow, BulkStatus } from './bulkProviders'
import s from './Proveedores.module.css'
import b from './BulkProviderModal.module.css'

const labels: Record<BulkStatus, string> = {
  ready: 'Listo', invalid: 'Revisar datos', duplicate: 'Repetido en listado', existing: 'Ya existe',
  conflict: 'Conflicto', created: 'Creado', failed: 'No creado', unconfirmed: 'Por verificar', stopped: 'Pendiente',
}

export function BulkProviderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { companyId, companyName } = useCompany()
  const { canManageProviders, memberships, profile } = useAuth()
  const [params] = useSearchParams()
  const allowed = Boolean(profile?.id) && canManageProviders() && params.get('mode') !== 'readonly' && Boolean(companyId && memberships.some(m => m.company_id === companyId))
  const initialCompany = useRef({ id: companyId, name: companyName, actor: profile?.id })
  const context = useRef({ companyId, allowed, actor: profile?.id })
  context.current = { companyId, allowed, actor: profile?.id }
  const dialog = useRef<HTMLDialogElement>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const stop = useRef(false)
  const readVersion = useRef(0)
  const createdAny = useRef(false)
  const [raw, setRaw] = useState('')
  const [reviewed, setReviewed] = useState<BulkRow[] | null>(null)
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [notice, setNotice] = useState('')
  const [attempted, setAttempted] = useState(false)
  const parsed = useMemo(() => parseBulkProviders(raw), [raw])
  const rows = reviewed ?? parsed.rows
  const contextValid = allowed && companyId === initialCompany.current.id && profile?.id === initialCompany.current.actor
  const canContinue = () => alive.current && !stop.current && context.current.allowed && context.current.companyId === initialCompany.current.id && context.current.actor === initialCompany.current.actor
  const eligible = rows.filter(r => ['ready', 'failed', 'unconfirmed', 'stopped'].includes(r.status)).length
  const count = (status: BulkStatus) => rows.filter(r => r.status === status).length

  useEffect(() => {
    alive.current = true
    if (dialog.current && !dialog.current.open) dialog.current.showModal()
    return () => { alive.current = false; stop.current = true; readVersion.current++ }
  }, [])

  useEffect(() => {
    if (!contextValid) {
      stop.current = true
      readVersion.current++
      setNotice('Cambió la empresa o el permiso. Cierra este lote y ábrelo desde la empresa correcta. No se enviarán nuevas filas.')
    }
  }, [contextValid])

  useEffect(() => {
    if (busy !== 'save') return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [busy])

  function close() {
    if (busyRef.current) {
      if (busy === 'save') stop.current = true
      setNotice('Se detendrá al terminar la fila en curso. Los proveedores ya creados se conservarán.')
      return
    }
    // Parent's onSaved closes and reloads: defer it until the user has reviewed
    // ALL results, rather than closing on the first partial success.
    if (createdAny.current) onSaved()
    else onClose()
  }

  function changeRaw(value: string) {
    readVersion.current++
    setRaw(value); setReviewed(null); setAttempted(false); setNotice('')
  }

  async function readFile(file?: File) {
    if (!file || busyRef.current || !contextValid) return
    if (file.size > MAX_BULK_CHARS) { setNotice('Archivo demasiado grande. Divide el listado en lotes.'); return }
    const version = ++readVersion.current
    busyRef.current = true; setBusy('read')
    try {
      const text = await file.text()
      if (alive.current && version === readVersion.current && context.current.companyId === initialCompany.current.id) changeRaw(text)
    } catch {
      if (alive.current) setNotice('No se pudo leer el archivo. Puedes pegar el listado desde Excel.')
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(null)
    }
  }

  async function review() {
    if (busyRef.current || !contextValid || parsed.error || !rows.length) return
    stop.current = false; busyRef.current = true; setBusy('read'); setNotice('')
    const version = ++readVersion.current
    try {
      const catalog = await listBulkProviderIdentities()
      if (canContinue() && version === readVersion.current) {
        setReviewed(rows.map(row => classifyBulkRow(row, catalog)))
        setNotice('Catálogo verificado. Los existentes se omiten sin cambiar sus datos.')
      }
    } catch {
      if (alive.current) { setReviewed(null); setNotice('No se pudo verificar el catálogo. No se habilitará la creación hasta verificarlo.') }
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(null)
    }
  }

  async function submit() {
    if (busyRef.current || !reviewed || !eligible || !contextValid) return
    stop.current = false; busyRef.current = true; setBusy('save'); setAttempted(true); setNotice('')
    const snapshot = reviewed
    try {
      const results = await bulkCreateProviders(snapshot, {
        canContinue,
        onResult: row => {
          if (row.status === 'created') createdAny.current = true
          if (alive.current) setReviewed(prev => (prev ?? snapshot).map(r => r.line === row.line ? row : r))
        },
      })
      if (alive.current) {
        setReviewed(results)
        setNotice(results.some(r => ['failed', 'unconfirmed', 'stopped', 'conflict', 'invalid'].includes(r.status))
          ? 'Hay filas pendientes. Conservamos el resultado de cada una; no se reenviarán las confirmadas.'
          : 'Revisión terminada. Puedes consultar los resultados y cerrar el lote.')
      }
    } catch {
      if (alive.current) setNotice('No se pudo completar el lote. Conserva los resultados y verifica el catálogo antes de reintentar.')
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(null)
    }
  }

  const hasPending = rows.some(r => !['created', 'existing', 'duplicate'].includes(r.status))
  return (
    <dialog ref={dialog} className={b.dialog} aria-labelledby="bulk-title" aria-describedby="bulk-help"
      onCancel={event => { event.preventDefault(); close() }} onClose={close}>
      <form className={b.modal} onSubmit={event => { event.preventDefault(); void submit() }} aria-busy={Boolean(busy)}>
        <header className={b.header}>
          <div>
            <h2 id="bulk-title">Alta masiva de proveedores</h2>
            <p className={b.company}>Empresa de captura: <strong>{initialCompany.current.name || 'Sin empresa'}</strong></p>
            <p id="bulk-help">Catálogo compartido. No cambiaremos proveedores existentes ni sus datos bancarios.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar alta masiva" disabled={Boolean(busy)} onClick={close}>✕</button>
        </header>
        <div className={b.body}>
          <p>Columnas: <strong>alias, nombre, RFC, método, banco, CLABE</strong>. Alias y nombre son obligatorios. Si omites el método se usa Transferencia bancaria; los datos bancarios pueden completarse después.</p>
          <p>Admite CSV, TSV y pegar desde Excel. Conserva RFC y CLABE como <strong>Texto</strong>. Máximo 200 filas. Cuenta bancaria y convenio se capturan desde el alta individual.</p>
          <label className={b.field}>Archivo CSV o TSV (opcional)
            <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" disabled={Boolean(busy) || !contextValid || Boolean(reviewed)}
              onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void readFile(file) }} />
          </label>
          <label className={b.field}>Listado de proveedores
            <textarea value={raw} onChange={event => changeRaw(event.target.value)} rows={5} spellCheck={false}
              disabled={Boolean(busy) || !contextValid || Boolean(reviewed)} placeholder={'alias,nombre,RFC,método,banco,CLABE\nProveedor QA,"Proveedor de prueba, SA",ABC010101AA1,Efectivo,,'} />
          </label>
          {parsed.error && <p role="alert" className={b.error}>{parsed.error}</p>}
          {!contextValid && <p role="alert" className={b.error}>Este lote pertenece a la empresa con la que se abrió. Cierra y vuelve a abrir.</p>}
          <div className={b.summary} role="status" aria-live="polite">
            <span>{rows.length} filas</span><span>{count('ready')} listas</span><span>{count('created')} creadas</span>
            <span>{count('existing')} existentes</span><span>{count('duplicate')} repetidas</span>
            <span>{rows.filter(r => ['invalid', 'conflict', 'failed', 'unconfirmed', 'stopped'].includes(r.status)).length} por revisar</span>
          </div>
          {notice && <p role="status" className={b.notice}>{notice}</p>}
          {rows.length > 0 && (
            <div className={b.tableWrap} tabIndex={0} role="region" aria-label="Revisión por proveedor; tabla con desplazamiento interno">
              <table className={b.table}>
                <thead><tr><th>Línea</th><th>Alias</th><th>Razón social</th><th>RFC</th><th>Método</th><th>Banco</th><th>CLABE</th><th>Resultado</th></tr></thead>
                <tbody>{rows.map(row => (
                  <tr key={row.line}>
                    <td>{row.line}</td><td>{row.payload.alias || '—'}</td><td>{row.payload.nombre_completo || '—'}</td>
                    <td>{row.payload.rfc || '—'}</td><td>{row.payload.metodo_pago}</td><td>{row.payload.banco || '—'}</td>
                    <td className={b.account}>{row.payload.clabe || '—'}</td>
                    <td><strong>{reviewed || row.status !== 'ready' ? labels[row.status] : 'Por verificar'}</strong><small>{row.message}</small></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <footer className={b.actions}>
          <button type="button" className={s.secondaryBtn} disabled={Boolean(busy)} onClick={close}>{createdAny.current ? 'Cerrar y actualizar catálogo' : 'Cerrar'}</button>
          {reviewed && hasPending && <button type="button" className={s.secondaryBtn} disabled={Boolean(busy) || !contextValid}
            onClick={() => changeRaw(pendingBulkText(rows))}>Corregir solo pendientes</button>}
          <button type="button" className={s.secondaryBtn} disabled={Boolean(busy) || !contextValid || !!parsed.error || !rows.length}
            onClick={() => void review()}>{busy === 'read' ? 'Verificando…' : 'Verificar catálogo'}</button>
          {busy === 'save' ? <button type="button" className={s.secondaryBtn} onClick={() => { stop.current = true; setNotice('Deteniendo después de la fila en curso…') }}>Detener después de esta fila</button>
            : <button type="submit" className={s.primaryBtn} disabled={Boolean(busy) || !contextValid || !reviewed || !eligible}>
              {attempted ? `Reintentar ${eligible} pendientes` : `Crear ${eligible} proveedores`}
            </button>}
        </footer>
      </form>
    </dialog>
  )
}
