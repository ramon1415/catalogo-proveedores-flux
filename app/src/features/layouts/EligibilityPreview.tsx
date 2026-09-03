import { Fragment } from 'react'
import {
  formatDate, aggregatePreviewTotals, formatPreviewMoney, extraordinaryCategoryLabel, formatMissingFields,
  requestOwnedLayoutFields, providerExecutionLayoutFields, providerRecordLayoutFields,
} from './logic'
import type { EligibilityPreview as Preview, PreviewRow } from './types'
import s from './Layouts.module.css'

export type PreviewAction =
  | { type: 'focus-section'; targetId: string }
  | { type: 'open-request'; requestId: string }
  | { type: 'open-batch'; batchId: string }
  | { type: 'open-provider'; providerId: string }
  | { type: 'complete-layout-data'; requestId: string }
  | { type: 'rebatch'; itemId: string }

function rows(preview: Preview, key: string): PreviewRow[] {
  const value = preview?.[key]
  return Array.isArray(value) ? value : []
}

export function readyRows(preview: Preview): PreviewRow[] {
  return [...rows(preview, 'ready_regular'), ...rows(preview, 'ready_extraordinary'), ...rows(preview, 'legacy_eligible')]
}

function Metric({ label, value, targetId, tone, onAction }: { label: string; value: string | number; targetId?: string; tone?: string; onAction: (a: PreviewAction) => void }) {
  if (!targetId) {
    return <div className={`${s.previewMetric} ${tone ? (s as any)[tone] || '' : ''}`}><span>{label}</span><strong>{value}</strong></div>
  }
  return (
    <button
      className={`${s.previewMetric} ${s.previewMetricAction} ${tone ? (s as any)[tone] || '' : ''}`}
      type="button"
      aria-label={`Ir a ${label}`}
      onClick={() => onAction({ type: 'focus-section', targetId })}
    >
      <span>{label}</span><strong>{value}</strong><small>Ver detalle</small>
    </button>
  )
}

function Row({ row, kind, onAction }: { row: PreviewRow; kind: string; onAction: (a: PreviewAction) => void }) {
  const batch = row.source_batch_label || 'Sin corte'
  let detailNode: React.ReactNode = batch
  let rowClass = ''
  const actions: React.ReactNode[] = [
    <button key="open" className={s.smallBtn} type="button" onClick={() => onAction({ type: 'open-request', requestId: row.payment_request_id })}>Abrir solicitud</button>,
  ]

  if (kind === 'ready' && row.classification === 'ready_extraordinary') {
    rowClass = ` ${s.extraordinary}`
    detailNode = (
      <>
        <strong>Extraordinario · {extraordinaryCategoryLabel(row.extraordinary_category)}</strong>
        <small>{row.extraordinary_reason || 'Sin motivo registrado'}</small>
        <small>Autorizo {row.extraordinary_authorized_by_name || 'Finanzas'} · {formatDate(row.extraordinary_authorized_at)}</small>
      </>
    )
  } else if (kind === 'pending_close') {
    detailNode = `${batch} · pendiente de cierre`
    actions.push(<button key="batch" className={s.smallBtn} type="button" onClick={() => onAction({ type: 'open-batch', batchId: row.source_batch_id || '' })}>Ir al corte</button>)
  } else if (kind === 'pending_director') {
    detailNode = `${batch} · ${row.source_batch_status || 'sin decision'}`
  } else if (kind === 'direction_reapproval') {
    detailNode = 'Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.'
  } else if (kind === 'rejected') {
    detailNode = (
      <>
        <span className={s.rejectReason}>{row.reject_reason || 'Sin motivo registrado'}</span>
        <small>{batch} · {formatDate(row.rejected_at)} · {row.rejected_by_name || 'Direccion'}</small>
        <small>{row.latest_correction_note ? `Correccion: ${row.latest_correction_note}` : row.rebatch_status === 'released' ? 'Reingreso habilitado' : 'Pendiente de correccion'}</small>
        {row.target_batch_label ? <small>Destino: {row.target_batch_label} · {row.target_batch_status || 'borrador'}</small> : null}
      </>
    )
    if (row.rebatch_status === 'blocked' && row.source_item_id) {
      actions.push(<button key="rebatch" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => onAction({ type: 'rebatch', itemId: row.source_item_id as string })}>Corregir y enviar nuevamente</button>)
    } else if (row.target_batch_id) {
      actions.push(<button key="tbatch" className={s.smallBtn} type="button" onClick={() => onAction({ type: 'open-batch', batchId: row.target_batch_id as string })}>Abrir nuevo corte</button>)
    }
  } else if (kind === 'invalid') {
    const missing = Array.isArray(row.missing_fields) ? row.missing_fields : []
    detailNode = (
      <>
        <strong>Falta completar</strong>
        <small>{formatMissingFields(row.missing_fields)}</small>
      </>
    )
    if (missing.some((field) => requestOwnedLayoutFields().includes(field) || providerExecutionLayoutFields().includes(field))) {
      actions.push(<button key="complete" className={`${s.smallBtn} ${s.warning}`} type="button" onClick={() => onAction({ type: 'complete-layout-data', requestId: row.payment_request_id })}>Completar datos</button>)
    }
    if (missing.some((field) => providerRecordLayoutFields().includes(field)) && row.proveedor_id) {
      actions.push(<button key="provider" className={s.smallBtn} type="button" onClick={() => onAction({ type: 'open-provider', providerId: row.proveedor_id as string })}>Completar proveedor</button>)
    }
  } else if (row.classification === 'legacy_eligible') {
    detailNode = 'Elegible por compatibilidad historica'
  }

  return (
    <div className={`${s.previewRow}${rowClass}`}>
      <div><strong>{row.request_number || 'Sin folio'}</strong><small>{row.company_name || 'Sin empresa'}</small></div>
      <div>{row.provider_name || 'Sin proveedor / beneficiario'}</div>
      <div><strong>{formatPreviewMoney(row.amount, row.currency ?? undefined)}</strong></div>
      <div>{detailNode}</div>
      <div className={s.previewActions}>{actions}</div>
    </div>
  )
}

function Section({ title, subtitle, list, kind, sectionId, onAction }: { title: string; subtitle: string; list: PreviewRow[]; kind: string; sectionId?: string; onAction: (a: PreviewAction) => void }) {
  const emphasized = list.length && ['rejected', 'invalid'].includes(kind) ? ` ${s.attention}` : ''
  if (!list.length) {
    return (
      <section id={sectionId} className={s.previewSection}>
        <div className={s.previewHead}><h3>{title}</h3><span>0</span></div>
        <div className={s.previewEmpty}>{subtitle}</div>
      </section>
    )
  }
  return (
    <section id={sectionId} className={`${s.previewSection}${emphasized}`} tabIndex={-1}>
      <div className={s.previewHead}><h3>{title}</h3><span>{list.length} · {subtitle}</span></div>
      <div className={s.previewList}>{list.map((row) => <Row key={row.payment_request_id} row={row} kind={kind} onAction={onAction} />)}</div>
    </section>
  )
}

export function EligibilityPreview({ preview, onAction }: { preview: Preview; onAction: (a: PreviewAction) => void }) {
  const regular = rows(preview, 'ready_regular')
  const extraordinary = rows(preview, 'ready_extraordinary')
  const legacy = rows(preview, 'legacy_eligible')
  const rejected = rows(preview, 'rejected_by_direction')
  const pendingClose = rows(preview, 'pending_finance_close')
  const pendingDirector = rows(preview, 'pending_director')
  const directionReapproval = rows(preview, 'direction_reapproval_required')
  const invalid = rows(preview, 'invalid_data')
  const ready = [...regular, ...extraordinary, ...legacy]
  const totals = aggregatePreviewTotals(ready)
  const noReadyMessage = invalid.length
    ? 'Completa los datos pendientes'
    : pendingClose.length
      ? 'Finanzas debe cerrar el corte'
      : pendingDirector.length
        ? 'Pendiente de decisión de Dirección'
        : directionReapproval.length
          ? 'Requiere nueva autorización de Dirección'
          : 'No hay pagos liberados'

  return (
    <div className={s.preview} aria-live="polite">
      <div className={s.previewSummary}>
        <Metric label="Listas para layout" value={ready.length} onAction={onAction} />
        <Metric label="Regulares / extraordinarias" value={`${regular.length + legacy.length} / ${extraordinary.length}`} onAction={onAction} />
        <Metric label="Rechazadas" value={rejected.length} targetId={rejected.length ? 'layoutPreviewRejected' : undefined} tone="danger" onAction={onAction} />
        <Metric label="Cambio crítico" value={directionReapproval.length} onAction={onAction} />
        <Metric label="Datos por completar" value={invalid.length} targetId={invalid.length ? 'layoutPreviewInvalid' : undefined} tone="warning" onAction={onAction} />
        <Metric label="Importe listo" value={totals.map((row) => formatPreviewMoney(row.amount, row.currency)).join(' | ') || 'Sin importe'} onAction={onAction} />
      </div>
      <Fragment>
        <Section title="Listas para layout" subtitle={ready.length ? 'Solo estas solicitudes se incluirán' : noReadyMessage} list={ready} kind="ready" onAction={onAction} />
        <Section title="Pendientes de cierre" subtitle="Direccion aprobo; Finanzas debe liberar el corte" list={pendingClose} kind="pending_close" onAction={onAction} />
        <Section title="Pendientes de Direccion" subtitle="No se incluiran en el layout" list={pendingDirector} kind="pending_director" onAction={onAction} />
        <Section title="Nueva autorización de Dirección" subtitle="Existe un cambio crítico posterior a la autorización" list={directionReapproval} kind="direction_reapproval" onAction={onAction} />
        <Section title="Rechazadas por Direccion" subtitle="Conservan rechazo, motivo e historial" list={rejected} kind="rejected" sectionId="layoutPreviewRejected" onAction={onAction} />
        <Section title="Solicitudes por completar" subtitle="Corrige aqui los datos faltantes para que vuelvan a evaluarse" list={invalid} kind="invalid" sectionId="layoutPreviewInvalid" onAction={onAction} />
      </Fragment>
    </div>
  )
}
