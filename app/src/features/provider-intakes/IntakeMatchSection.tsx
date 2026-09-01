import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/format'
import {
  findProviderIntakeCandidates, getProviderIntakeLinkTarget,
  getProviderIntakeMatchComparison, setProviderIntakeMatch,
} from './api'
import {
  MATCH_CONFIDENCE, COMPARISON_RESULT, MATCH_REASON_CODES, MATCH_ACTION_LABELS,
  matchReadonlyMessage, validateMatchReason, displayValue, maskedText,
  actorLabel, friendlyIntakeError, createUuid,
} from './logic'
import type { IntakeDetailData, MatchData, MatchComparison, MatchKind, LinkTarget } from './types'
import s from './ProviderIntakes.module.css'

// Rebanada 5: matching contra el proveedor maestro. El dato declarado nunca se
// modifica; el vínculo requiere confirmación explícita (set/replace/clear con
// razón auditada) y solo es editable con la solicitud en revisión (eligible).
type MatchDialog = {
  kind: MatchKind
  providerId: string | null
  providerAlias: string | null
  readonly: boolean
  actionId: string
  comparison: MatchComparison | null
}

export function IntakeMatchSection({ intake, onChanged }: { intake: IntakeDetailData; onChanged: () => Promise<void> | void }) {
  const { showToast } = useToast()
  const [matchData, setMatchData] = useState<MatchData | null>(null)
  const [matchErr, setMatchErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null)
  const [search, setSearch] = useState('')

  const [dialog, setDialog] = useState<MatchDialog | null>(null)
  const [reason, setReason] = useState('')
  const [reasonCode, setReasonCode] = useState('candidate_selected')
  const [dialogErr, setDialogErr] = useState('')
  const [saving, setSaving] = useState(false)

  const searchTimer = useRef<number | null>(null)

  const load = useCallback(async (query: string) => {
    setLoading(true)
    setMatchErr('')
    try {
      const [data, target] = await Promise.all([
        findProviderIntakeCandidates(intake.id, query),
        getProviderIntakeLinkTarget(intake.id).catch(() => null),
      ])
      setMatchData(data)
      setLinkTarget(target)
    } catch (e) {
      setMatchErr(friendlyIntakeError(e))
    } finally {
      setLoading(false)
    }
  }, [intake.id])

  useEffect(() => { load('') }, [load])

  function onSearchChange(value: string) {
    setSearch(value)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    if (value.trim().length === 1) return // espera un carácter más
    searchTimer.current = window.setTimeout(() => load(value), 320)
  }

  const current = matchData?.current_match ?? null
  const eligible = Boolean(matchData?.eligible)
  const currentId = current?.proveedor_id ?? null

  async function openCompare(providerId: string, alias: string | null) {
    const kind: MatchKind = currentId ? 'replace' : 'set'
    try {
      const comparison = await getProviderIntakeMatchComparison(intake.id, providerId)
      const readonly = !eligible || !comparison.provider_active || currentId === providerId
      setDialog({ kind, providerId, providerAlias: alias, readonly, actionId: createUuid(), comparison })
      setReason('')
      setReasonCode(kind === 'replace' ? 'match_corrected' : 'candidate_selected')
      setDialogErr('')
    } catch (e) {
      showToast('No fue posible comparar', friendlyIntakeError(e), 'error')
    }
  }

  function openClear() {
    if (!current || !eligible) return
    setDialog({ kind: 'clear', providerId: null, providerAlias: current.alias, readonly: false, actionId: createUuid(), comparison: null })
    setReason('')
    setReasonCode('no_longer_matches')
    setDialogErr('')
  }

  async function confirmMatch() {
    if (!dialog || dialog.readonly) return
    const trimmed = reason.trim()
    const validation = validateMatchReason(dialog.kind, trimmed)
    if (validation) { setDialogErr(validation); return }
    setSaving(true)
    setDialogErr('')
    try {
      await setProviderIntakeMatch({
        intakeId: intake.id,
        expectedStatus: intake.status,
        expectedUpdatedAt: intake.updated_at,
        expectedCurrentMatch: currentId,
        providerId: dialog.kind === 'clear' ? null : dialog.providerId,
        reason: trimmed,
        reasonCode,
        actionId: dialog.actionId,
      })
      setDialog(null)
      const title = dialog.kind === 'clear' ? 'Vínculo retirado' : dialog.kind === 'replace' ? 'Vínculo actualizado' : 'Proveedor vinculado'
      showToast(title, 'La operación quedó registrada en el historial append-only.', 'success')
      setSearch('')
      await load('')
      await onChanged()
    } catch (e) {
      setDialogErr(friendlyIntakeError(e))
    } finally {
      setSaving(false)
    }
  }

  const bankLine = (row: { bank: string | null; clabe_masked: string | null; account_masked: string | null }) =>
    `${maskedText(row.bank)} · CLABE ${displayValue(row.clabe_masked)} · Cuenta ${displayValue(row.account_masked)}`

  const stateBadge = () => {
    if (current && !current.active) return <Badge variant="danger">Proveedor inactivo</Badge>
    if (current) return <Badge variant="success">Vinculado</Badge>
    if (!eligible) return <Badge variant="warning">Revisión requerida</Badge>
    if (matchData?.candidates.length) return <Badge variant="info">Candidatos encontrados</Badge>
    return <Badge variant="neutral">{search ? 'Sin coincidencias' : 'Sin vincular'}</Badge>
  }

  const reasonRequired = dialog?.kind === 'replace' || dialog?.kind === 'clear'

  return (
    <section className={s.detailSection}>
      <h3>Proveedor maestro</h3>
      <p className="muted" style={{ margin: '0 0 8px', fontSize: '.85rem' }}>
        El dato declarado permanece intacto. El vínculo requiere confirmación explícita de Finanzas.
      </p>

      {loading && <p className="muted">Buscando coincidencias de forma segura…</p>}
      {!loading && matchErr && <p className={s.actionErr}>{matchErr}</p>}
      {!loading && !matchErr && matchData && (
        <>
          {linkTarget && (
            <div className={s.matchCard}>
              <div className={s.matchCardHead}>
                <div>
                  <span className="muted" style={{ fontSize: '.75rem' }}>Proveedor destinatario de la liga</span>
                  <div><strong>{linkTarget.alias || 'Proveedor maestro'}</strong> <Badge variant="info">Preseleccionado por liga</Badge></div>
                  <div className="muted" style={{ fontSize: '.85rem' }}>{displayValue(linkTarget.legal_name)} · RFC {displayValue(linkTarget.rfc_masked)}</div>
                </div>
              </div>
              {linkTarget.bank_review === 'REQUIRED'
                ? <p className={s.matchWarning}>⚠ El proveedor reportó nuevos datos bancarios. La identidad sigue siendo el mismo proveedor; Finanzas debe resolver el cambio.</p>
                : <p className="muted" style={{ fontSize: '.85rem' }}>Datos bancarios maestros confirmados vigentes · revisión bancaria no requerida.</p>}
              {(linkTarget.identity_differences?.length ?? 0) > 0 && (
                <div>
                  <strong style={{ fontSize: '.85rem' }}>Datos declarados diferentes al maestro</strong>
                  <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: '.85rem' }}>
                    {linkTarget.identity_differences!.map((d, i) => <li key={i}>{d.field}: {displayValue(d.declared)} → {displayValue(d.master)}</li>)}
                  </ul>
                </div>
              )}
              <div className={s.actionBar}>
                <button
                  className="primary-btn"
                  disabled={!eligible || !linkTarget.active || currentId === linkTarget.proveedor_id}
                  onClick={() => openCompare(linkTarget.proveedor_id, linkTarget.alias)}
                >
                  {currentId === linkTarget.proveedor_id ? 'Proveedor confirmado' : 'Confirmar proveedor'}
                </button>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>La liga prioriza este candidato, pero nunca crea ni confirma el vínculo automáticamente.</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
            {stateBadge()}
            {!eligible && <span className="muted" style={{ fontSize: '.85rem' }}>{matchReadonlyMessage(intake.status)}</span>}
          </div>

          {current && (
            <div className={s.matchCard}>
              <div className={s.matchCardHead}>
                <div>
                  <strong>{current.alias || 'Proveedor maestro'}</strong>
                  <div className="muted" style={{ fontSize: '.85rem' }}>{current.legal_name || 'Razón social no informada'}</div>
                  <div className="muted" style={{ fontSize: '.8rem' }}>{bankLine(current)}</div>
                </div>
                {!current.active && <Badge variant="danger">Inactivo</Badge>}
              </div>
              <div className={s.actionBar}>
                <button className="secondary-btn" onClick={() => openCompare(current.proveedor_id, current.alias)}>Comparar</button>
                {eligible && <button className="danger-btn" onClick={openClear}>Retirar vínculo</button>}
              </div>
            </div>
          )}

          {matchData.duplicate_rfc_count > 1 && (
            <p className={s.matchWarning}>Se detectaron múltiples registros con el RFC declarado. Ninguno se seleccionará automáticamente; revisa cada candidato.</p>
          )}

          {eligible && (
            <>
              <div style={{ margin: '8px 0' }}>
                <input
                  type="search"
                  maxLength={120}
                  autoComplete="off"
                  placeholder="Buscar coincidencias (nombre, alias o RFC)"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  style={{ width: '100%' }}
                />
                <p className="muted" style={{ margin: '4px 0 0', fontSize: '.8rem' }}>
                  {search.trim().length === 1
                    ? 'Escribe un carácter más para buscar de forma segura.'
                    : 'Escribe al menos 2 caracteres. Los resultados se actualizan sin seleccionar ni vincular automáticamente.'}
                </p>
              </div>

              {matchData.candidates.length === 0 ? (
                <p className="muted" style={{ fontSize: '.85rem' }}>
                  {search ? 'Sin coincidencias para la búsqueda indicada.' : 'Sin coincidencias deterministas. Puedes buscar por nombre, alias o RFC.'}
                </p>
              ) : (
                <ul className={s.fileList}>
                  {matchData.candidates.map((c) => {
                    const alreadyLinked = currentId === c.proveedor_id
                    return (
                      <li key={c.proveedor_id} className={s.matchCard}>
                        <div className={s.matchCardHead}>
                          <div>
                            <strong>{c.alias || 'Proveedor maestro'}</strong>
                            <div className="muted" style={{ fontSize: '.85rem' }}>{c.legal_name || 'Razón social no informada'}</div>
                            <div className="muted" style={{ fontSize: '.8rem' }}>{bankLine(c)}</div>
                          </div>
                          <Badge variant={c.confidence === 'high' ? 'success' : c.confidence === 'medium' ? 'info' : 'neutral'}>
                            {(MATCH_CONFIDENCE[c.confidence || 'low'] || 'Confianza baja')} · {Number(c.score || 0)}/100
                          </Badge>
                        </div>
                        <div className="muted" style={{ fontSize: '.8rem' }}>
                          Señales: {(c.reasons?.length ? c.reasons : ['Búsqueda manual']).join(' · ')}
                          {' — '}Diferencias: {(c.differences?.length ? c.differences : ['Sin diferencias informadas']).join(' · ')}
                        </div>
                        {!c.active && <p className={s.matchWarning}>Coincidencia crítica con un proveedor inactivo; no es seleccionable.</p>}
                        <div className={s.actionBar}>
                          <button className="secondary-btn" onClick={() => openCompare(c.proveedor_id, c.alias)}>Comparar</button>
                          <button
                            className="primary-btn"
                            disabled={!c.selectable || alreadyLinked || !c.active}
                            onClick={() => openCompare(c.proveedor_id, c.alias)}
                          >
                            {!c.active ? 'Proveedor inactivo' : alreadyLinked ? 'Vínculo actual' : current ? 'Seleccionar para cambio' : 'Seleccionar proveedor'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}

          {matchData.history.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: '.9rem' }}>Historial de matching</strong>
              <ol className={s.eventList} style={{ marginTop: 6 }}>
                {matchData.history.map((h, i) => (
                  <li key={i} className={s.eventItem}>
                    <div className={s.eventHead}>
                      <strong>{MATCH_ACTION_LABELS[h.action_kind || ''] || 'Matching actualizado'}</strong>
                      <time className="muted">{formatDateTime(h.created_at)}</time>
                    </div>
                    <div className="muted" style={{ fontSize: '.8rem' }}>{displayValue(h.previous_provider)} → {displayValue(h.new_provider)} · {actorLabel(h.actor_type)}</div>
                    {h.reason && <p style={{ margin: '4px 0 0', fontSize: '.85rem' }}>{h.reason}</p>}
                  </li>
                ))}
              </ol>
            </div>
          )}

          <p className="muted" style={{ margin: '8px 0 0', fontSize: '.8rem' }}>El vínculo maestro queda en modo de solo lectura después de la conversión.</p>
        </>
      )}

      {dialog && (
        <div className={s.overlay} onClick={() => !saving && setDialog(null)} style={{ zIndex: 60 }}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className={s.modalHead}>
              <div>
                <h2 style={{ fontSize: '1.1rem' }}>{dialog.kind === 'clear' ? 'Retirar vínculo' : 'Comparar proveedor'}</h2>
                <p className="muted">
                  {dialog.kind === 'clear'
                    ? 'La solicitud quedará sin proveedor maestro. El historial se conservará.'
                    : 'Revisa los datos declarados y maestros campo por campo.'}
                </p>
              </div>
              <button className="small-btn" disabled={saving} onClick={() => setDialog(null)}>Cerrar</button>
            </div>
            <div className={s.modalBody}>
              {dialog.kind === 'clear' && (
                <p className={s.matchWarning}>Vas a retirar el vínculo con {dialog.providerAlias || 'el proveedor maestro'}. Esta acción no modifica ni elimina al proveedor.</p>
              )}

              {dialog.comparison && (
                <div className={s.wrap}>
                  <table className={s.table}>
                    <thead><tr><th>Dato</th><th>Declarado en portal</th><th>Proveedor maestro</th><th>Resultado</th></tr></thead>
                    <tbody>
                      {dialog.comparison.rows.map((row, i) => {
                        const mask = row.field === 'Banco' || row.field === 'Beneficiario'
                        const fmt = mask ? maskedText : displayValue
                        return (
                          <tr key={i}>
                            <td>{row.field}</td>
                            <td>{fmt(row.declared)}</td>
                            <td>{fmt(row.master)}</td>
                            <td>{COMPARISON_RESULT[row.result || 'not_reported'] || 'No informado'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {!dialog.readonly && (
                <div className={s.actionForm}>
                  <strong>Confirmación auditada</strong>
                  <label className="muted" style={{ fontSize: '.85rem' }}>
                    Motivo
                    <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} style={{ display: 'block', marginTop: 4 }}>
                      {MATCH_REASON_CODES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </label>
                  <label className="muted" style={{ fontSize: '.85rem' }}>
                    Razón {reasonRequired ? '(obligatoria, mínimo 10 caracteres)' : '(opcional)'}
                    <textarea
                      rows={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={dialog.kind === 'replace'
                        ? 'Explica por qué se reemplaza el vínculo, sin incluir datos sensibles'
                        : dialog.kind === 'clear'
                          ? 'Explica por qué el vínculo ya no corresponde, sin incluir datos sensibles'
                          : 'Contexto opcional, sin incluir datos sensibles'}
                      style={{ display: 'block', width: '100%', marginTop: 4 }}
                    />
                  </label>
                  <p className="muted" style={{ margin: 0, fontSize: '.75rem' }}>
                    No incluyas RFC, cuentas, CLABE, correos, teléfonos ni otros datos sensibles. {reason.length} / 500
                  </p>
                  {dialogErr && <p className={s.actionErr} role="alert">{dialogErr}</p>}
                  <div className={s.actionFormBtns}>
                    <button className="secondary-btn" disabled={saving} onClick={() => setDialog(null)}>Cancelar</button>
                    <button className={dialog.kind === 'clear' ? 'danger-btn' : 'primary-btn'} disabled={saving} onClick={confirmMatch}>
                      {saving ? 'Guardando…' : dialog.kind === 'clear' ? 'Retirar vínculo' : dialog.kind === 'replace' ? 'Confirmar cambio' : 'Confirmar vínculo'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
