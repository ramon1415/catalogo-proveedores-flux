import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { IcSearch, IcPlus } from '../../components/ui/icons'
import { formatCurrency, compactCurrency, numberValue } from '../../lib/format'
import {
  loadLayouts as apiLoadLayouts, loadLayoutIssueLines, loadLayoutCatalogs, fetchLayoutLines,
  markPaymentLayoutUploaded, updateLayoutFileState, downloadTextFile,
} from './api'
import {
  filterLayouts, formatDate, layoutStatusBadge, summarizeLayoutFormats, lineNeedsPagosintReferenceCompletion, detectBbvaLayoutFormat,
  validateLayoutLines, buildBbvaLayoutFiles, formatInvalidLayoutLineMessage, invalidLineNeedsPagosintReference,
  mergeLayoutFileName, bbvaFormatLabel, maskBbvaLine, rlsHint, friendlyError, friendlyRpcError,
  CXC_MIME_TYPE, BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE,
} from './logic'
import { NewLayoutModal } from './NewLayoutModal'
import { LinesModal } from './LinesModal'
import { ConfirmPaymentModal } from './ConfirmPaymentModal'
import { ActionConfirmModal } from './ActionConfirmModal'
import type {
  PaymentLayout, PaymentLayoutLine, LayoutCompany, CompanyBankAccount, FormatSummary, BbvaFormat,
} from './types'
import s from './Layouts.module.css'

export default function LayoutsPage() {
  const { profile } = useAuth()
  const { showToast } = useToast()
  const profileId = (profile?.id as string | undefined) ?? null

  const [layouts, setLayouts] = useState<PaymentLayout[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [issueCounts, setIssueCounts] = useState<Map<string, number>>(new Map())
  const [formatSummaries, setFormatSummaries] = useState<Map<string, FormatSummary>>(new Map())

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('todos')

  const [catalogs, setCatalogs] = useState<{ companies: LayoutCompany[]; accounts: CompanyBankAccount[] } | null>(null)
  const [showNew, setShowNew] = useState(false)

  const [linesLayoutId, setLinesLayoutId] = useState<string | null>(null)
  const [linesLines, setLinesLines] = useState<PaymentLayoutLine[]>([])

  const [confirmLayoutId, setConfirmLayoutId] = useState<string | null>(null)
  const [uploadConfirm, setUploadConfirm] = useState<PaymentLayout | null>(null)

  // ── Carga ──────────────────────────────────────────────────────────────
  async function loadLayouts() {
    try {
      const data = await apiLoadLayouts()
      setLayouts(data)
      // Pendientes PAGOSINT + resúmenes por formato.
      const counts = new Map<string, number>()
      const summaries = new Map<string, FormatSummary>()
      const ids = data.map((l) => l.id).filter(Boolean)
      if (ids.length) {
        const { data: lines, error } = await loadLayoutIssueLines(ids)
        if (!error) {
          const byLayout = new Map<string, PaymentLayoutLine[]>()
          for (const line of (lines as PaymentLayoutLine[]) || []) {
            const layoutId = line.layout_id as string
            if (!byLayout.has(layoutId)) byLayout.set(layoutId, [])
            byLayout.get(layoutId)!.push(line)
            if (lineNeedsPagosintReferenceCompletion(line)) counts.set(layoutId, (counts.get(layoutId) || 0) + 1)
          }
          for (const [layoutId, ls] of byLayout.entries()) summaries.set(layoutId, summarizeLayoutFormats(ls))
        }
      }
      setIssueCounts(counts)
      setFormatSummaries(summaries)
      setStatus('ready')
    } catch (error) {
      setErrorMsg(rlsHint('payment_layouts', 'select', error))
      setStatus('error')
      showToast('Error al cargar', rlsHint('payment_layouts', 'select', error), 'error')
    }
  }

  useEffect(() => {
    loadLayouts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => filterLayouts(layouts, query, statusFilter), [layouts, query, statusFilter])

  const stats = useMemo(() => ({
    total: layouts.length,
    draft: layouts.filter((l) => l.status === 'draft').length,
    generated: layouts.filter((l) => l.status === 'generated').length,
    amount: layouts.reduce((sum, l) => sum + numberValue(l.total_amount), 0),
  }), [layouts])

  function ensureProfile(): boolean {
    if (profileId) return true
    showToast('Perfil no identificado', 'No se pudo identificar el perfil del usuario para registrar la accion.', 'error')
    return false
  }

  // ── Nuevo layout ───────────────────────────────────────────────────────
  async function openNewLayout() {
    if (!ensureProfile()) return
    try {
      const cat = await loadLayoutCatalogs()
      setCatalogs(cat)
      setShowNew(true)
    } catch (error) {
      showToast('No se pudieron cargar catalogos', friendlyError(error), 'error')
    }
  }

  // ── Líneas ─────────────────────────────────────────────────────────────
  function applyIssuesForLayout(layoutId: string, lines: PaymentLayoutLine[]) {
    const count = lines.filter((line) => lineNeedsPagosintReferenceCompletion(line)).length
    setIssueCounts((prev) => {
      const next = new Map(prev)
      if (count) next.set(layoutId, count)
      else next.delete(layoutId)
      return next
    })
    setFormatSummaries((prev) => {
      const next = new Map(prev)
      next.set(layoutId, summarizeLayoutFormats(lines.filter((line) => line.status !== 'bank_rejected')))
      return next
    })
  }

  async function openLayoutLines(layoutId: string) {
    const layout = layouts.find((l) => l.id === layoutId)
    if (!layout) return
    setLinesLayoutId(layoutId)
    setLinesLines([])
    const { data, error } = await fetchLayoutLines(layoutId)
    if (error) {
      showToast('No se pudieron leer las lineas', rlsHint('payment_layout_lines', 'select', error), 'error')
      return
    }
    applyIssuesForLayout(layoutId, data || [])
    setLinesLines(data || [])
  }

  // Recarga usada por acciones dentro del modal de líneas (pagosint/reject).
  async function reloadLines(layoutId: string): Promise<PaymentLayoutLine[]> {
    const { data, error } = await fetchLayoutLines(layoutId)
    if (error) throw error
    const fresh = data || []
    applyIssuesForLayout(layoutId, fresh)
    setLinesLines(fresh)
    await loadLayouts()
    return fresh
  }

  // ── Descargas / validación ─────────────────────────────────────────────
  async function downloadLayoutBbvaFormat(layoutId: string, format: BbvaFormat) {
    const layout = layouts.find((l) => l.id === layoutId)
    if (!layout) return
    if (![BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK, BBVA_FORMAT_CIE].includes(format)) {
      showToast('Formato no soportado', 'Solo se pueden descargar PAGOSBBV, PAGOSINT o CIE.', 'warning')
      return
    }
    if (layout.status === 'cancelled') {
      showToast('Layout cancelado', 'No se puede descargar archivo BBVA de un layout cancelado.', 'error')
      return
    }
    const { data: lines, error } = await fetchLayoutLines(layoutId)
    if (error) { showToast('No se pudo leer el layout', rlsHint('payment_layout_lines', 'select', error), 'error'); return }
    const activeLines = (lines || []).filter((line) => line.status !== 'bank_rejected')
    const selectedLines = activeLines.filter((line) => { try { return detectBbvaLayoutFormat(line) === format } catch { return false } })
    if (!selectedLines.length) {
      showToast('Sin lineas', `Este layout no tiene lineas ${bbvaFormatLabel(format)} para descargar.`, 'warning')
      return
    }
    const invalidLines = validateLayoutLines(selectedLines)
    if (invalidLines.length) {
      const pagosintReferenceLine = invalidLines.find(invalidLineNeedsPagosintReference)
      const first = pagosintReferenceLine || invalidLines[0]
      showToast('Lineas invalidas', formatInvalidLayoutLineMessage(first), 'error')
      if (pagosintReferenceLine) await openLayoutLines(layoutId)
      return
    }
    try {
      const files = buildBbvaLayoutFiles(selectedLines, layout)
      const file = files.find((item) => item.format === format)
      if (!file) { showToast('Sin archivo', `No se pudo construir ${bbvaFormatLabel(format)} para este layout.`, 'warning'); return }
      if (!file.validation.ok) { showToast('Layout invalido', file.validation.errors[0], 'error'); return }
      downloadTextFile(file.content, file.fileName, CXC_MIME_TYPE)
      const update = await updateLayoutFileState(layoutId, mergeLayoutFileName(layout.file_name, file.fileName))
      if (update.error) { showToast(`${file.label} descargado`, 'El archivo fue generado, pero no se pudo actualizar el estado del layout.', 'warning'); return }
      showToast(`${file.label} generado`, `${file.fileName} se descargo correctamente. ${file.validation.lineCount} linea(s) de ${file.lineLength}.`, 'success')
      await loadLayouts()
    } catch (error) {
      showToast(`No se pudo generar ${bbvaFormatLabel(format)}`, friendlyError(error), 'error')
    }
  }

  async function downloadLayoutCxc(layoutId: string) {
    const layout = layouts.find((l) => l.id === layoutId)
    if (!layout) return
    if (layout.status === 'cancelled') {
      showToast('Layout cancelado', 'No se puede generar archivo CxC BBVA de un layout cancelado.', 'error')
      return
    }
    const { data: lines, error } = await fetchLayoutLines(layoutId)
    if (error) { showToast('No se pudo leer el layout', rlsHint('payment_layout_lines', 'select', error), 'error'); return }
    if (!lines?.length) { showToast('Sin lineas', 'Este layout no tiene lineas para generar archivo BBVA.', 'warning'); return }
    const cxcLines = lines.filter((line) => line.status !== 'bank_rejected')
    if (!cxcLines.length) { showToast('Sin lineas activas', 'Este layout no tiene lineas activas para generar archivo BBVA.', 'warning'); return }
    const invalidLines = validateLayoutLines(cxcLines)
    if (invalidLines.length) {
      const pagosintReferenceLine = invalidLines.find(invalidLineNeedsPagosintReference)
      const first = pagosintReferenceLine || invalidLines[0]
      showToast('Lineas invalidas', formatInvalidLayoutLineMessage(first), 'error')
      if (pagosintReferenceLine) await openLayoutLines(layoutId)
      return
    }
    try {
      const files = buildBbvaLayoutFiles(cxcLines, layout)
      const invalidFile = files.find((file) => !file.validation.ok)
      if (invalidFile) { showToast('Layout invalido', invalidFile.validation.errors[0], 'error'); return }
      files.forEach((file) => downloadTextFile(file.content, file.fileName, CXC_MIME_TYPE))
      const fileName = files.map((file) => file.fileName).join(' + ')
      const update = await updateLayoutFileState(layoutId, fileName)
      if (update.error) { showToast('Layout BBVA descargado', 'El archivo fue generado, pero no se pudo actualizar el estado del layout.', 'warning'); return }
      const summary = files.map((file) => `${file.label}: ${file.validation.lineCount} linea(s) de ${file.lineLength}`).join('; ')
      showToast('Layout BBVA generado', `${fileName} se descargo correctamente. ${summary}.`, 'success')
      await loadLayouts()
    } catch (error) {
      showToast('No se pudo generar CxC BBVA', friendlyError(error), 'error')
    }
  }

  async function validateLayoutCxc(layoutId: string) {
    const layout = layouts.find((l) => l.id === layoutId)
    if (!layout) return
    const { data: lines, error } = await fetchLayoutLines(layoutId)
    if (error) { showToast('No se pudo validar', rlsHint('payment_layout_lines', 'select', error), 'error'); return }
    const cxcLines = (lines || []).filter((line) => line.status !== 'bank_rejected')
    if (!cxcLines.length) { showToast('Sin lineas', 'Este layout no tiene lineas activas para validar.', 'warning'); return }
    const invalidLines = validateLayoutLines(cxcLines)
    if (invalidLines.length) {
      showToast('Layout invalido', formatInvalidLayoutLineMessage(invalidLines[0]), 'error')
      return
    }
    try {
      const files = buildBbvaLayoutFiles(cxcLines, layout)
      const invalidFile = files.find((file) => !file.validation.ok)
      const diagnostics = files.map((file) => ({
        format: file.label,
        expectedLength: file.lineLength,
        lineCount: file.validation.lineCount,
        lineLengths: file.validation.lineLengths,
        hasFinalTerminator: file.validation.hasFinalTerminator,
        hasDoubleFinalTerminator: file.validation.hasDoubleFinalTerminator,
        byteLength: file.validation.byteLength,
        firstLine: maskBbvaLine(file.validation.lines[0] || '', file.format),
        errors: file.validation.errors,
      }))
      if (invalidFile) {
        showToast('Layout invalido', invalidFile.validation.errors[0], 'error')
        console.warn('Diagnostico BBVA', { layout: layout.layout_number || layout.id, files: diagnostics })
        return
      }
      console.info('Diagnostico BBVA', { layout: layout.layout_number || layout.id, files: diagnostics })
      showToast('Layout valido', diagnostics.map((item) => `${item.format}: ${item.lineCount} linea(s) de ${item.expectedLength}; CRLF final: ${item.hasFinalTerminator ? 'si' : 'no'}`).join(' | '), 'success')
    } catch (error) {
      showToast('Layout invalido', friendlyError(error), 'error')
    }
  }

  // ── Marcar subido ──────────────────────────────────────────────────────
  async function confirmMarkUploaded() {
    if (!uploadConfirm || !ensureProfile()) { setUploadConfirm(null); return }
    const layoutId = uploadConfirm.id
    setUploadConfirm(null)
    try {
      const data = await markPaymentLayoutUploaded(layoutId, profileId)
      showToast('Layout actualizado', data?.message || 'El layout fue marcado como subido.', 'success')
      await loadLayouts()
    } catch (error) {
      showToast('No se pudo marcar como subido', friendlyRpcError(error), 'error')
    }
  }

  // ── Render de acciones por fila ────────────────────────────────────────
  function renderFormatDownloadActions(layout: PaymentLayout, summary: FormatSummary | undefined): React.ReactNode[] {
    if (!summary) {
      const label = layout.status === 'draft' ? 'Generar layout de pagos' : (layout.file_name ? 'Descargar layout de pagos' : 'Generar layout de pagos')
      return [<button key="cxc" className={s.smallBtn} type="button" onClick={() => downloadLayoutCxc(layout.id)}>{label}</button>]
    }
    const actions: React.ReactNode[] = []
    const sameBank = summary[BBVA_FORMAT_SAME_BANK]
    const interbank = summary[BBVA_FORMAT_INTERBANK]
    const cie = summary[BBVA_FORMAT_CIE]
    if (sameBank.count > 0) {
      actions.push(<button key="bbv" className={s.smallBtn} type="button" onClick={() => downloadLayoutBbvaFormat(layout.id, BBVA_FORMAT_SAME_BANK)}>▾ Pagos BBVA</button>)
    }
    if (interbank.count > 0) {
      if (interbank.referenceIssues > 0) actions.push(<button key="int-w" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => openLayoutLines(layout.id)}>Completar PAGOSINT</button>)
      else actions.push(<button key="int" className={s.smallBtn} type="button" onClick={() => downloadLayoutBbvaFormat(layout.id, BBVA_FORMAT_INTERBANK)}>▾ Pagos Inter</button>)
    }
    if (cie.count > 0) {
      if (cie.validationIssues > 0) actions.push(<button key="cie-w" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => openLayoutLines(layout.id)}>Revisar CIE ({cie.validationIssues})</button>)
      else actions.push(<button key="cie" className={s.smallBtn} type="button" onClick={() => downloadLayoutBbvaFormat(layout.id, BBVA_FORMAT_CIE)}>▾ Descargar CIE</button>)
    }
    return actions.length ? actions : [<button key="val" className={s.smallBtn} type="button" onClick={() => downloadLayoutCxc(layout.id)}>Validar lineas</button>]
  }

  function renderLayoutActions(layout: PaymentLayout): React.ReactNode[] {
    const actions: React.ReactNode[] = [
      <button key="ver" className={s.smallBtn} type="button" onClick={() => openLayoutLines(layout.id)}>Ver lineas</button>,
    ]
    const pendingPagosint = issueCounts.get(layout.id) || 0
    const summary = formatSummaries.get(layout.id)
    const canGenerate = ['draft', 'generated'].includes(layout.status || '')

    if (layout.status !== 'cancelled') {
      actions.push(<button key="val" className={s.smallBtn} type="button" onClick={() => validateLayoutCxc(layout.id)}>Validar layout</button>)
    }
    if (pendingPagosint > 0 && layout.status !== 'cancelled') {
      actions.push(<button key="cref" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => openLayoutLines(layout.id)}>Completar referencias</button>)
    }
    if (canGenerate) actions.push(...renderFormatDownloadActions(layout, summary))
    if (layout.status === 'generated') {
      actions.push(<button key="up" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => { if (ensureProfile()) setUploadConfirm(layout) }}>Marcar subido</button>)
      actions.push(<button key="conf" className={`${s.smallBtn} ${s.success}`} type="button" onClick={() => { if (ensureProfile()) setConfirmLayoutId(layout.id) }}>Confirmar pago</button>)
    }
    if (layout.status === 'uploaded') {
      actions.push(<button key="conf" className={`${s.smallBtn} ${s.success}`} type="button" onClick={() => { if (ensureProfile()) setConfirmLayoutId(layout.id) }}>Confirmar pago</button>)
    }
    return actions
  }

  const linesLayout = linesLayoutId ? layouts.find((l) => l.id === linesLayoutId) ?? null : null
  const confirmLayout = confirmLayoutId ? layouts.find((l) => l.id === confirmLayoutId) ?? null : null

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Layouts de pago</h1>
          <p className="muted">Genera archivos semanales a partir de solicitudes liberadas para pago.</p>
        </div>
        <div className={s.headActions}>
          <button className={s.secondaryBtn} onClick={loadLayouts}>Actualizar</button>
          <button className={s.primaryBtn} onClick={openNewLayout}><IcPlus size={16} /> Nuevo layout</button>
        </div>
      </div>

      <div className={s.statsGrid}>
        <div className={`${s.statCard} ${s.accent}`}><p>Total layouts</p><strong>{stats.total}</strong></div>
        <div className={`${s.statCard} ${s.warning}`}><p>Draft</p><strong>{stats.draft}</strong></div>
        <div className={`${s.statCard} ${s.success}`}><p>Generados</p><strong>{stats.generated}</strong></div>
        <div className={`${s.statCard} ${s.info}`}><p>Monto total</p><strong>{compactCurrency(stats.amount)}</strong></div>
      </div>

      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <IcSearch size={16} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por folio, nombre o periodo..." />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="todos">Estatus: Todos</option>
            <option value="draft">Draft</option>
            <option value="generated">Generado</option>
            <option value="uploaded">Subido</option>
            <option value="confirmed">Confirmado</option>
            <option value="cancelled">Cancelado</option>
          </select>
        </div>

        {/* Nota ux2: la tabla principal muestra el resumen operativo. */}
        <div className={s.ux2Note}>La tabla principal muestra el resumen operativo. Los datos bancarios y el detalle pesado viven en Ver lineas.</div>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Folio layout</th><th>Periodo</th><th>Empresa</th><th>Cuenta origen</th>
                <th>Total</th><th>Lineas</th><th>Estatus</th><th>Fecha creacion</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && <tr><td colSpan={9} className={s.tableMsg}>Cargando layouts...</td></tr>}
              {status === 'error' && <tr><td colSpan={9} className={`${s.tableMsg} ${s.tableErr}`}>{errorMsg || 'No fue posible cargar layouts.'}</td></tr>}
              {status === 'ready' && rows.length === 0 && <tr><td colSpan={9} className={s.tableMsg}>No hay layouts para este filtro.</td></tr>}
              {status === 'ready' && rows.map((l) => {
                const b = layoutStatusBadge(l.status)
                return (
                  <tr key={l.id}>
                    <td><span className={s.cellMain}>{l.layout_number || 'Sin folio'}</span><span className={s.cellSub}>{l.name || ''}</span></td>
                    <td><span className={s.cellMain}>{formatDate(l.period_start)}</span><span className={s.cellSub}>{formatDate(l.period_end)}</span></td>
                    <td><strong>{numberValue(l.company_count)}</strong><span className={s.mutedLine}>Empresa(s)</span></td>
                    <td><span className={s.cellMain}>Por solicitud</span><span className={s.mutedLine}>Ver lineas para revisar cuenta origen</span></td>
                    <td><strong>{formatCurrency(l.total_amount)}</strong></td>
                    <td><strong>{numberValue(l.payment_count)}</strong><span className={s.mutedLine}>Lineas</span></td>
                    <td><Badge variant={b.variant}>{b.label}</Badge></td>
                    <td>{formatDate(l.generated_at || l.created_at)}</td>
                    <td><div className={s.rowActions}>{renderLayoutActions(l)}</div></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {showNew && catalogs && (
        <NewLayoutModal
          companies={catalogs.companies}
          accounts={catalogs.accounts}
          profileId={profileId}
          onClose={() => setShowNew(false)}
          onLayoutsChanged={loadLayouts}
          onOpenLines={(id) => { setShowNew(false); openLayoutLines(id) }}
        />
      )}

      {linesLayout && (
        <LinesModal
          layout={linesLayout}
          lines={linesLines}
          profileId={profileId}
          onClose={() => { setLinesLayoutId(null); setLinesLines([]) }}
          onDownloadFormat={(format) => downloadLayoutBbvaFormat(linesLayout.id, format)}
          reload={() => reloadLines(linesLayout.id)}
        />
      )}

      {confirmLayout && (
        <ConfirmPaymentModal
          layoutId={confirmLayout.id}
          layoutNumber={confirmLayout.layout_number}
          registeredBy={profileId}
          onClose={() => setConfirmLayoutId(null)}
          onConfirmed={async () => {
            setConfirmLayoutId(null)
            await loadLayouts()
            if (linesLayoutId) await reloadLines(linesLayoutId)
          }}
        />
      )}

      {uploadConfirm && (
        <ActionConfirmModal
          title="Marcar layout como subido"
          message={`Se registrara ${uploadConfirm.layout_number || 'este layout'} como enviado al banco. Esta accion no confirma el pago.`}
          confirmLabel="Marcar como subido"
          onConfirm={confirmMarkUploaded}
          onCancel={() => setUploadConfirm(null)}
        />
      )}
    </>
  )
}
