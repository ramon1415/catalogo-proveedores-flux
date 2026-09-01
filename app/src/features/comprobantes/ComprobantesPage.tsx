import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/format'
import { getBatchContext, listBatches, getBatchDetail, getLinkPreview } from './api'
import {
  friendlyBatchError, statusLabel, statusTone, batchStatus, batchOperations,
  operationStatus, formatMinor, shortBatchId, normalizeText,
} from './logic'
import { UploadBatchModal } from './UploadBatchModal'
import { OperationModal } from './OperationModal'
import { BulkLinkModal } from './BulkLinkModal'
import type { BatchContext, BatchListItem, BatchDetail, BatchOperation, CreateBatchResult } from './types'
import s from './Comprobantes.module.css'

// Migración a React de comprobantes_batch.html: bandeja de batches BBVA +
// flujo de vinculación 1:1 comprobante ↔ solicitud aprobada.
const SUMMARY_FILTERS: { key: string; label: string; subtitle: string; tone: string; statuses: string[] }[] = [
  { key: '', label: 'Total', subtitle: 'Batches visibles', tone: 'total', statuses: [] },
  { key: 'processing', label: 'Procesando', subtitle: 'Ingesta o extracción', tone: 'processing', statuses: ['awaiting_upload', 'extracting'] },
  { key: 'review_required', label: 'Por revisar', subtitle: 'Extracciones', tone: 'review', statuses: ['review_required'] },
  { key: 'ready', label: 'Listos', subtitle: 'Revisión terminada', tone: 'ready', statuses: ['ready'] },
  { key: 'failed', label: 'Con incidencia', subtitle: 'Requieren atención', tone: 'failed', statuses: ['failed', 'cancelled'] },
]

const FLOW_STEPS = [
  ['1', 'Revisar comprobante', 'Abre una sola página'],
  ['2', 'Buscar solicitud aprobada', 'Consulta sin modificar datos'],
  ['3', 'Confirmar coincidencia', 'Importe y moneda exactos'],
  ['4', 'Comprobante vinculado', 'Solicitud marcada como pagada'],
]

export default function ComprobantesPage() {
  const { companyId } = useCompany()
  const { showToast } = useToast()

  const [context, setContext] = useState<BatchContext | null>(null)
  const [blocked, setBlocked] = useState<{ title: string; message: string } | null>(null)
  const [batches, setBatches] = useState<BatchListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<BatchDetail | null>(null)
  const [linkStatuses, setLinkStatuses] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [summaryFilter, setSummaryFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const [uploadOpen, setUploadOpen] = useState(false)
  const [operation, setOperation] = useState<BatchOperation | null>(null)
  const [duplicate, setDuplicate] = useState<{ id: string; folio: string; status: string } | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  const capabilities = useMemo(() => {
    const caps = context?.capabilities && Object.keys(context.capabilities).length ? context.capabilities : context
    return caps ?? {}
  }, [context])

  const loadBatchesList = useCallback(async () => {
    try {
      const items = await listBatches(companyId)
      setBatches(items)
      return items
    } catch (e) {
      showToast('No se pudieron cargar los batches', friendlyBatchError(e), 'error')
      return []
    }
  }, [companyId, showToast])

  const loadDetail = useCallback(async (batchId: string) => {
    try {
      const d = await getBatchDetail(batchId)
      setDetail(d)
      // Conciliación por operación: N previews en paralelo (contrato vanilla).
      const ops = batchOperations(d).filter((op) => op.bank_operation_id)
      const entries = await Promise.all(ops.map(async (op) => {
        try {
          const preview = await getLinkPreview(op.bank_operation_id!)
          return [op.bank_operation_id!, preview.link?.id ? 'linked' : (op.reconciliation_status || 'unreconciled')] as const
        } catch {
          return [op.bank_operation_id!, op.reconciliation_status || 'unreconciled'] as const
        }
      }))
      setLinkStatuses(Object.fromEntries(entries))
    } catch (e) {
      showToast('No se pudo abrir el batch', friendlyBatchError(e), 'error')
    }
  }, [showToast])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const ctx = await getBatchContext()
        if (ctx.allowed === false || ctx.can_access === false) {
          setBlocked({ title: 'Acceso restringido', message: ctx.block_reason || 'No tienes capacidad asignada para consultar conciliaciones.' })
          return
        }
        setContext(ctx)
        await loadBatchesList()
      } catch (e) {
        setBlocked({ title: 'Backend pendiente', message: friendlyBatchError(e) })
      } finally {
        setLoading(false)
      }
    })()
  }, [loadBatchesList])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    else setDetail(null)
  }, [selectedId, loadDetail])

  async function refreshAll() {
    const items = await loadBatchesList()
    if (selectedId && items.some((b) => b.id === selectedId)) await loadDetail(selectedId)
    showToast('Bandeja actualizada', 'Se consultó el estado más reciente.', 'success')
  }

  const counts = useMemo(() => {
    const byKey: Record<string, number> = { '': batches.length }
    for (const f of SUMMARY_FILTERS.slice(1)) {
      byKey[f.key] = batches.filter((b) => f.statuses.includes(batchStatus(b))).length
    }
    return byKey
  }, [batches])

  const filtered = useMemo(() => {
    const q = normalizeText(search)
    const summary = SUMMARY_FILTERS.find((f) => f.key === summaryFilter)
    return batches.filter((b) => {
      const st = batchStatus(b)
      if (summary && summary.statuses.length && !summary.statuses.includes(st)) return false
      if (statusFilter && st !== statusFilter) return false
      if (q) {
        const text = normalizeText([b.batch_number, b.public_folio, b.company_name, b.original_file_name].filter(Boolean).join(' '))
        if (!text.includes(q)) return false
      }
      return true
    })
  }, [batches, search, statusFilter, summaryFilter])

  const operations = useMemo(() => batchOperations(detail), [detail])
  const reviewCount = operations.filter((op) => operationStatus(op) === 'review_required').length
  const acceptedCount = operations.filter((op) => op.bank_operation_id).length

  if (loading && !context && !blocked) return <p className="muted">Cargando…</p>
  if (blocked) {
    return (
      <div className={s.blockedCard}>
        <h1>{blocked.title}</h1>
        <p className="muted">{blocked.message}</p>
      </div>
    )
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <span className={s.eyebrow}>Comprobantes bancarios · BBVA PDF V1</span>
          <h1>Comprobantes batch</h1>
          <p className="muted">Sube un lote, revisa cada operación y vincúlala con la solicitud aprobada correspondiente.</p>
        </div>
        <div className={s.headActions}>
          <button className="secondary-btn" onClick={refreshAll}>Actualizar</button>
          {capabilities.can_ingest === true && (
            <button className="primary-btn" onClick={() => setUploadOpen(true)}>Nuevo batch</button>
          )}
        </div>
      </div>

      <div className={s.safetyBanner}>
        <strong>! &nbsp;Vinculación 1:1 protegida</strong>
        <span>Cada comprobante se vincula con una sola solicitud aprobada. El importe y la moneda se leen del PDF y nunca se capturan durante la vinculación.</span>
      </div>

      <ol className={s.flowSteps} aria-label="Flujo de vinculación de comprobantes">
        {FLOW_STEPS.map(([number, title, copy]) => (
          <li key={number}>
            <span className={s.stepNumber}>{number}</span>
            <span><strong>{title}</strong><small>{copy}</small></span>
          </li>
        ))}
      </ol>

      <div className={s.helpNote}>
        <strong>¿Ya aparece un lote?</strong>
        <span>Fue cargado anteriormente. Para iniciar otro usa <b>Nuevo batch</b>. Si subes exactamente el mismo PDF, Flux abrirá el lote original para evitar duplicados.</span>
      </div>

      <div className={s.kpis}>
        {SUMMARY_FILTERS.map((f) => (
          <button
            key={f.key}
            className={`${s.kpi} ${s[f.tone]} ${summaryFilter === f.key ? s.active : ''}`}
            aria-pressed={summaryFilter === f.key}
            onClick={() => setSummaryFilter(summaryFilter === f.key && f.key !== '' ? '' : f.key)}
          >
            <span>{f.label}</span>
            <strong>{counts[f.key] ?? 0}</strong>
            <small>{f.subtitle}</small>
          </button>
        ))}
      </div>

      <div className={s.split}>
        {/* Lista */}
        <div className={s.listPane}>
          <div className={s.toolbar}>
            <input placeholder="Buscar batch…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos los estados</option>
              {['awaiting_upload', 'extracting', 'review_required', 'ready', 'failed', 'cancelled'].map((k) => (
                <option key={k} value={k}>{statusLabel(k)}</option>
              ))}
            </select>
          </div>
          <ul className={s.batchList}>
            {filtered.length === 0 && <li className={s.msg}>No hay batches para este filtro.</li>}
            {filtered.map((b) => (
              <li key={b.id}>
                <button className={`${s.batchItem} ${selectedId === b.id ? s.active : ''}`} onClick={() => setSelectedId(b.id)}>
                  <div className={s.batchItemHead}>
                    <strong>{b.batch_number || b.public_folio || shortBatchId(b.id)}</strong>
                    <Badge variant={statusTone(batchStatus(b))}>{statusLabel(batchStatus(b))}</Badge>
                  </div>
                  <span className="muted" style={{ fontSize: '.8rem' }}>{b.company_name || '—'} · {b.original_file_name || '—'}</span>
                  <span className="muted" style={{ fontSize: '.75rem' }}>{formatDateTime(b.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Detalle */}
        <div className={s.detailPane}>
          {!detail && (
            <div className={s.emptyState}>
              <span className={s.emptyIcon}>B</span>
              <strong>Selecciona un batch</strong>
              <p>Aquí verás sus documentos, operaciones,<br />conciliación e historial.</p>
            </div>
          )}
          {detail && (
            <div className={s.detailBody}>
              <div className={s.metricRow}>
                <div className={s.metric}><strong>{(detail.documents?.length ?? (detail.document ? 1 : 0))}</strong><span>Documentos</span></div>
                <div className={s.metric}><strong>{operations.length}</strong><span>Páginas / extracciones</span></div>
                <div className={s.metric}><strong>{reviewCount}</strong><span>Por revisar</span></div>
                <div className={s.metric}><strong>{acceptedCount}</strong><span>Aceptadas</span></div>
              </div>

              {capabilities.can_link === true && operations.some((op) => op.bank_operation_id && linkStatuses[op.bank_operation_id!] !== 'linked') && (
                <div>
                  <button className="secondary-btn" onClick={() => setBulkOpen(true)}>Vincular coincidencias exactas</button>
                </div>
              )}

              <div className={s.wrap}>
                <table className={s.table}>
                  <thead>
                    <tr><th>Página</th><th>Fecha / referencia</th><th>Beneficiario / concepto</th><th>Importe</th><th>Extracción</th><th>Conciliación</th><th></th></tr>
                  </thead>
                  <tbody>
                    {operations.length === 0 && (
                      <tr><td colSpan={7} className={s.msg}><strong>Sin operaciones</strong> — La extracción puede seguir en proceso.</td></tr>
                    )}
                    {operations.map((op, i) => {
                      const recon = (op.bank_operation_id && linkStatuses[op.bank_operation_id]) || op.reconciliation_status || 'unreconciled'
                      return (
                        <tr key={op.extraction_id || op.bank_operation_id || i}>
                          <td>{op.source_page || op.page_number || '—'}</td>
                          <td>
                            {op.application_date || op.operation_date || 'Sin fecha'}
                            <div className="muted" style={{ fontSize: '.75rem' }}>{op.bank_unique_folio || op.bank_reference || 'Sin referencia'}</div>
                          </td>
                          <td>
                            {op.beneficiary_name || 'Por identificar'}
                            <div className="muted" style={{ fontSize: '.75rem' }}>{op.payment_reason || op.concept || 'Sin concepto'}</div>
                          </td>
                          <td className={s.numeric}>{formatMinor(op.amount_minor, op.currency || 'MXN')}</td>
                          <td><Badge variant={statusTone(operationStatus(op))}>{statusLabel(operationStatus(op))}</Badge></td>
                          <td><Badge variant={statusTone(recon)}>{statusLabel(recon)}</Badge></td>
                          <td><button className="small-btn" onClick={() => setOperation(op)}>Revisar</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {(detail.events?.length ?? 0) > 0 && (
                <div>
                  <strong style={{ fontSize: '.9rem' }}>Historial</strong>
                  <ul className={s.eventList}>
                    {detail.events!.map((e, i) => (
                      <li key={i} className="muted" style={{ fontSize: '.85rem' }}>
                        {e.label || e.event_type || 'Evento'} · {e.actor_name || 'Sistema'} · {formatDateTime(e.created_at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {uploadOpen && context && (
        <UploadBatchModal
          context={context}
          defaultCompanyId={companyId}
          onClose={() => setUploadOpen(false)}
          onUploaded={async (batchId) => {
            setUploadOpen(false)
            setSelectedId(batchId)
            await loadBatchesList()
          }}
          onDuplicate={async (batchId, created: CreateBatchResult) => {
            setUploadOpen(false)
            const items = await loadBatchesList()
            const existing = items.find((b) => b.id === batchId)
            setDuplicate({
              id: batchId,
              folio: existing?.batch_number || existing?.public_folio || created.batch_number || created.public_folio || shortBatchId(batchId),
              status: batchStatus(existing || { status: created.status || 'awaiting_upload' }),
            })
          }}
        />
      )}

      {duplicate && (
        <div className={s.overlay} onClick={() => setDuplicate(null)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className={s.modalHead}>
              <h2 style={{ fontSize: '1.05rem' }}>Lote ya cargado</h2>
              <button className="small-btn" onClick={() => setDuplicate(null)}>Cerrar</button>
            </div>
            <div className={s.modalBody}>
              <p style={{ margin: 0 }}>
                Este archivo ya fue cargado anteriormente como <strong>{duplicate.folio}</strong> ({statusLabel(duplicate.status)}).
                No se creó otro lote.
              </p>
              <div className={s.formBtns}>
                <button className="secondary-btn" onClick={() => setDuplicate(null)}>Entendido</button>
                <button className="primary-btn" onClick={() => { setSelectedId(duplicate.id); setDuplicate(null) }}>Abrir lote existente</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {bulkOpen && (
        <BulkLinkModal
          operations={operations}
          onClose={() => setBulkOpen(false)}
          onLinked={async () => {
            await loadBatchesList()
            if (selectedId) await loadDetail(selectedId)
          }}
        />
      )}

      {operation && detail && (
        <OperationModal
          operation={operation}
          detail={detail}
          capabilities={capabilities}
          onClose={() => setOperation(null)}
          onStartNewBatch={() => {
            setOperation(null)
            setUploadOpen(true)
          }}
          onChanged={async () => {
            await loadBatchesList()
            if (selectedId) await loadDetail(selectedId)
          }}
        />
      )}
    </>
  )
}
