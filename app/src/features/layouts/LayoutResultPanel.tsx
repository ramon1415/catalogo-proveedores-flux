import { formatCurrency } from '../../lib/format'
import { RESULT_FIELD_LABELS, resultMissingFields, resultShortLabel, humanizeField } from './logic'
import type { CreateLayoutResult, InvalidRequest, NotIncludedItem } from './types'
import s from './Layouts.module.css'

const PREVIEW_LIMIT = 30

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className={s.resultMetric}><span>{label}</span><strong>{value}</strong></div>
}

function MissingSummary({ invalidRequests }: { invalidRequests: InvalidRequest[] }) {
  const counts = new Map<string, number>()
  invalidRequests.forEach((item) => {
    resultMissingFields(item.missing_fields).forEach((field) => counts.set(field, (counts.get(field) || 0) + 1))
  })
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (!top.length) return null
  return (
    <div className={s.missingSummary}>
      {top.map(([field, count]) => <span key={field} className={s.missingPill}>{resultShortLabel(field)}: {count}</span>)}
    </div>
  )
}

function MissingTags({ fields }: { fields: InvalidRequest['missing_fields'] }) {
  return (
    <>
      {resultMissingFields(fields).map((field, i) => (
        <span key={`${field}-${i}`} className={s.missingTag} title={RESULT_FIELD_LABELS[field] || humanizeField(field)}>{resultShortLabel(field)}</span>
      ))}
    </>
  )
}

export function LayoutResultPanel({
  data,
  notIncluded,
  onOpenLines,
  onOpenRequest,
}: {
  data: CreateLayoutResult
  notIncluded: NotIncludedItem[]
  onOpenLines: (layoutId: string) => void
  onOpenRequest: (requestId: string) => void
}) {
  const invalidRequests = data.invalid_requests || []
  const hasLayout = Boolean(data.layout_id || data.layout_number)
  const included = Number(data.payment_count || 0)
  const invalidCount = Number(data.invalid_count ?? invalidRequests.length ?? 0)
  const companyCount = Number(data.company_count || 0)
  const totalAmount = Number(data.total_amount || 0)
  const noValid = data.message === 'no_valid_payment_requests' || (!hasLayout && !included)

  const title = noValid
    ? (invalidRequests.length ? 'No se pudo crear layout porque las solicitudes aprobadas tienen datos incompletos.' : 'No hay solicitudes validas para generar layout en este periodo.')
    : `${data.layout_number || 'Layout creado'} generado en borrador`
  const subtitle = noValid
    ? 'No se creo ningun layout porque no hubo solicitudes completas para incluir.'
    : invalidCount
      ? 'El layout se creo con las solicitudes completas. Las solicitudes con datos pendientes quedaron fuera.'
      : 'Todas las solicitudes validas del periodo quedaron incluidas en el layout.'

  const visibleInvalid = invalidRequests.slice(0, PREVIEW_LIMIT)
  const remainingInvalid = invalidRequests.length - visibleInvalid.length
  const visibleNot = notIncluded.slice(0, PREVIEW_LIMIT)
  const remainingNot = notIncluded.length - visibleNot.length

  return (
    <div className={`${s.result} ${noValid ? s.warning : s.success}`}>
      <div className={s.resultHeader}>
        <div>
          <span className={s.resultKicker}>{noValid ? 'Resultado de validacion' : 'Layout creado'}</span>
          <strong>{title}</strong>
          <p>{subtitle}</p>
        </div>
        {hasLayout && <span className={s.resultNumber}>{data.layout_number || 'Layout'}</span>}
      </div>

      <div className={s.resultMetrics}>
        <Metric label="Registros incluidos" value={included} />
        <Metric label="Solicitudes fuera" value={invalidCount} />
        <Metric label="Empresas" value={companyCount} />
        <Metric label="Monto incluido" value={formatCurrency(totalAmount)} />
      </div>

      {data.layout_id && included ? (
        <div className={s.resultActions}>
          <button type="button" className={`${s.smallBtn} ${s.success}`} onClick={() => onOpenLines(data.layout_id as string)}>Ver lineas generadas</button>
          <span className={s.fieldHint}>El archivo CxC BBVA se descarga despues desde la tabla de layouts.</span>
        </div>
      ) : null}

      {invalidRequests.length > 0 && (
        <div className={s.invalidPanel}>
          <div className={s.invalidSummary}>
            <div>
              <strong>Solicitudes fuera del layout</strong>
              <p>Corrige primero los faltantes mas repetidos. Si son muchos registros, la lista queda contenida aqui.</p>
            </div>
            <span className={s.invalidCount}>{invalidRequests.length}</span>
          </div>
          <MissingSummary invalidRequests={invalidRequests} />
          <div className={s.invalidScroll}>
            <ul className={s.invalidList}>
              {visibleInvalid.map((item, i) => (
                <li key={item.payment_request_id || i}>
                  <div><strong>{item.request_number || item.payment_request_id || 'Solicitud'}</strong><span className={s.mutedLine}>Fuera del layout</span></div>
                  <div className={s.invalidFields}><MissingTags fields={item.missing_fields} /></div>
                  {item.payment_request_id
                    ? <button type="button" className={s.smallBtn} onClick={() => onOpenRequest(item.payment_request_id as string)}>Ver solicitud</button>
                    : <span className={s.smallBtn}>Ver solicitud</span>}
                </li>
              ))}
            </ul>
          </div>
          {remainingInvalid > 0 && <p className={s.mutedLine}>Mostrando {visibleInvalid.length} de {invalidRequests.length}. Hay {remainingInvalid} solicitudes adicionales con datos pendientes.</p>}
        </div>
      )}

      {notIncluded.length > 0 && (
        <div className={`${s.invalidPanel} ${s.notIncludedPanel}`}>
          <div className={s.invalidSummary}>
            <div>
              <strong>Aprobadas no consideradas</strong>
              <p>Estas solicitudes estan aprobadas, pero la funcion no las tomo como candidatas para este layout.</p>
            </div>
            <span className={s.invalidCount}>{notIncluded.length}</span>
          </div>
          <div className={s.invalidScroll}>
            <ul className={s.invalidList}>
              {visibleNot.map((item, i) => (
                <li key={item.request.id || i}>
                  <div><strong>{item.request.request_number || item.request.id || 'Solicitud'}</strong><span className={s.mutedLine}>No considerada</span></div>
                  <div className={s.notIncludedReasons}>{item.reasons.map((reason, j) => <span key={j}>{reason}</span>)}</div>
                  {item.request.id
                    ? <button type="button" className={s.smallBtn} onClick={() => onOpenRequest(item.request.id as string)}>Ver solicitud</button>
                    : <span className={s.smallBtn}>Ver solicitud</span>}
                </li>
              ))}
            </ul>
          </div>
          {remainingNot > 0 && <p className={s.mutedLine}>Mostrando {visibleNot.length} de {notIncluded.length}. Hay {remainingNot} adicionales.</p>}
        </div>
      )}
    </div>
  )
}
