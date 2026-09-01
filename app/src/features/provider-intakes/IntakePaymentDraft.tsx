import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/format'
import {
  getPaymentDraftContext, savePaymentDraft, convertIntakeToPaymentRequest,
  confirmMasterBanking, listApproverOptions,
} from './api'
import {
  PAYMENT_DRAFT_STATE, PAYMENT_DRAFT_FIELD_LABELS, PAYMENT_DRAFT_BLOCKER_LABELS,
  BANKING_FIELD_LABELS, validatePaymentDraft, friendlyIntakeError, createUuid, displayValue,
} from './logic'
import type { PaymentDraftContext, PaymentDraftForm, ApproverOption } from './types'
import s from './ProviderIntakes.module.css'

// Rebanada 6: preparación interna de la solicitud de pago + conversión.
// Guardar (parcial permitido) y convertir son RPCs separadas: la conversión
// no reenvía el formulario, el servidor lee el draft persistido — por eso
// convertir con cambios sin guardar está prohibido.
const EMPTY_FORM: PaymentDraftForm = {
  cost_center_id: null, budget_category_id: null, budget_month: null,
  company_bank_account_id: null, payment_method: null,
  requested_by_profile_id: null, approver_profile_id: null, approver_assignment_id: null,
  final_amount: null, currency: null, scheduled_payment_date: null,
  internal_concept: null, internal_notes: null, amount_change_reason: null,
}

function monthValue(v: string | null | undefined): string {
  return v ? v.slice(0, 7) : ''
}

export function IntakePaymentDraftSection({ intakeId, intakeUpdatedAt, onChanged }: {
  intakeId: string
  intakeUpdatedAt: string | null
  onChanged: () => Promise<void> | void
}) {
  const [context, setContext] = useState<PaymentDraftContext | null>(null)
  const [ctxErr, setCtxErr] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setCtxErr('')
    try {
      setContext(await getPaymentDraftContext(intakeId))
    } catch (e) {
      setCtxErr(friendlyIntakeError(e))
    }
  // Matching y transiciones cambian updated_at sin cerrar el detalle. Volver a
  // leer el contexto evita guardar o convertir contra una versión anterior.
  }, [intakeId, intakeUpdatedAt])

  useEffect(() => { load() }, [load])

  if (ctxErr) return <section className={s.detailSection}><h3>Solicitud de pago interna</h3><p className={s.actionErr}>{ctxErr}</p></section>
  if (!context) return <section className={s.detailSection}><h3>Solicitud de pago interna</h3><p className="muted">Cargando preparación…</p></section>

  const derived = context.state?.derived_state || 'NOT_STARTED'
  const stateInfo = PAYMENT_DRAFT_STATE[derived] || PAYMENT_DRAFT_STATE.NOT_STARTED
  const missing = (context.state?.missing_fields || []).filter((f) => f !== 'amount_change_reason')
  const buttonLabel = derived === 'NOT_STARTED' ? 'Preparar solicitud de pago'
    : derived === 'DRAFT_INCOMPLETE' ? 'Continuar preparación' : 'Revisar solicitud preparada'

  return (
    <section className={s.detailSection}>
      <h3>Solicitud de pago interna</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge variant={stateInfo.variant}>{stateInfo.label}</Badge>
        {missing.length > 0 && <span className="muted" style={{ fontSize: '.85rem' }}>{missing.length} campos pendientes</span>}
        {context.intake?.created_payment_request_id && (
          <a className="small-btn" href={`/solicitudes?request_id=${context.intake.created_payment_request_id}`}>Abrir solicitud de pago</a>
        )}
      </div>
      {(context.state?.blockers || []).length > 0 && (
        <ul className="muted" style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: '.85rem' }}>
          {context.state!.blockers.map((b) => <li key={b}>{PAYMENT_DRAFT_BLOCKER_LABELS[b] || b}</li>)}
        </ul>
      )}
      {context.can_prepare && (
        <div className={s.actionBar} style={{ marginTop: 8 }}>
          <button className="primary-btn" onClick={() => setOpen(true)}>{buttonLabel}</button>
        </div>
      )}
      {open && (
        <PaymentDraftModal
          context={context}
          onClose={() => setOpen(false)}
          onReload={load}
          onConverted={async () => { setOpen(false); await load(); await onChanged() }}
        />
      )}
    </section>
  )
}

function PaymentDraftModal({ context: initialContext, onClose, onReload, onConverted }: {
  context: PaymentDraftContext
  onClose: () => void
  onReload: () => Promise<void>
  onConverted: () => Promise<void>
}) {
  const { showToast } = useToast()
  const [context, setContext] = useState(initialContext)
  const [form, setForm] = useState<PaymentDraftForm>(EMPTY_FORM)
  const [snapshot, setSnapshot] = useState('')
  const [approvers, setApprovers] = useState<ApproverOption[]>(initialContext.approver_options || [])
  const [approverErr, setApproverErr] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const draftActionId = useRef(createUuid())
  const conversionActionId = useRef(createUuid())
  const approverTimer = useRef<number | null>(null)

  // Precarga: draft persistido con fallback a defaults.
  const populate = useCallback((ctx: PaymentDraftContext) => {
    const d = ctx.draft
    const def = ctx.defaults || {}
    const next: PaymentDraftForm = {
      cost_center_id: d?.cost_center_id ?? null,
      budget_category_id: d?.budget_category_id ?? null,
      budget_month: d?.budget_month ?? null,
      company_bank_account_id: d?.company_bank_account_id ?? null,
      payment_method: d?.payment_method ?? null,
      requested_by_profile_id: d?.requested_by_profile_id ?? def.requested_by_profile_id ?? null,
      approver_profile_id: d?.approver_profile_id ?? null,
      approver_assignment_id: d?.approver_assignment_id ?? null,
      final_amount: d?.final_amount ?? (def.final_amount != null ? String(def.final_amount) : null),
      currency: d?.currency ?? def.currency ?? null,
      scheduled_payment_date: d?.scheduled_payment_date ?? def.scheduled_payment_date ?? null,
      internal_concept: d?.internal_concept ?? def.internal_concept ?? null,
      internal_notes: d?.internal_notes ?? null,
      amount_change_reason: d?.amount_change_reason ?? null,
    }
    setForm(next)
    setSnapshot(JSON.stringify(next))
  }, [])

  useEffect(() => { populate(initialContext) }, [initialContext, populate])

  const dirty = JSON.stringify(form) !== snapshot

  function patch(p: Partial<PaymentDraftForm>) {
    setForm((f) => {
      const next = { ...f, ...p }
      // El cambio de método limpia la cuenta origen cuando no es transferencia.
      if (next.payment_method !== 'transfer') next.company_bank_account_id = null
      // El cambio de centro de costo invalida la categoría si ya no aplica.
      if (p.cost_center_id !== undefined && p.cost_center_id !== f.cost_center_id) next.budget_category_id = null
      // Si el monto vuelve a coincidir, la razón de cambio se limpia sola.
      if (next.final_amount != null && context.intake.amount_requested != null && Number(next.final_amount) === context.intake.amount_requested) {
        next.amount_change_reason = null
      }
      return next
    })
    draftActionId.current = createUuid() // editar produce una acción nueva
    setErr('')
  }

  // Aprobadores dinámicos: dependen de empresa + centro de costo + monto.
  useEffect(() => {
    const amount = Number(form.final_amount || 0)
    if (!form.cost_center_id || !form.requested_by_profile_id || !(amount > 0)) return
    if (approverTimer.current) window.clearTimeout(approverTimer.current)
    approverTimer.current = window.setTimeout(async () => {
      try {
        setApproverErr('')
        const options = await listApproverOptions(context.intake.company_id, form.cost_center_id!, amount)
        setApprovers(options)
      } catch (e) {
        setApproverErr(friendlyIntakeError(e))
      }
    }, 250)
    return () => { if (approverTimer.current) window.clearTimeout(approverTimer.current) }
  }, [form.cost_center_id, form.final_amount, form.requested_by_profile_id, context.intake.company_id])

  const categories = useMemo(
    () => (context.catalogs?.budget_categories || []).filter((c) => !form.cost_center_id || c.cost_center_id === form.cost_center_id),
    [context.catalogs, form.cost_center_id],
  )

  const amountChanged = form.final_amount != null && context.intake.amount_requested != null
    && form.final_amount !== '' && Number(form.final_amount) !== context.intake.amount_requested

  const derived = context.state?.derived_state
  const banking = context.state?.banking ?? null
  const savedApproverInvalid = Boolean(form.approver_profile_id && approvers.length > 0 && !approvers.some((a) => a.profile_id === form.approver_profile_id))

  async function reloadContext() {
    try {
      const fresh = await getPaymentDraftContext(context.intake.id)
      setContext(fresh)
      populate(fresh)
      draftActionId.current = createUuid()
      await onReload()
    } catch (e) {
      setErr(friendlyIntakeError(e))
    }
  }

  async function save() {
    if (!context.can_save || saving) return
    const validation = validatePaymentDraft(form, context.intake.amount_requested)
    if (validation) { setErr(validation); return }
    setSaving(true)
    setErr('')
    try {
      const budgetMonth = form.budget_month ? `${monthValue(form.budget_month)}-01` : null
      await savePaymentDraft({
        intakeId: context.intake.id,
        expectedIntakeStatus: context.intake.status,
        expectedIntakeUpdatedAt: context.intake.updated_at,
        expectedDraftVersion: context.draft?.version ?? null,
        form: {
          ...form,
          budget_month: budgetMonth,
          approver_assignment_id: form.approver_profile_id
            ? (approvers.find((a) => a.profile_id === form.approver_profile_id)?.assignment_id ?? form.approver_assignment_id)
            : null,
        },
        actionId: draftActionId.current,
      })
      showToast('Borrador guardado', 'La preparación interna quedó actualizada sin convertir el intake.', 'success')
      await reloadContext()
    } catch (e) {
      setErr(friendlyIntakeError(e))
    } finally {
      setSaving(false)
    }
  }

  async function convert() {
    if (converting) return
    if (dirty) {
      setErr('Primero guarda el borrador antes de convertir.')
      showToast('Cambios sin guardar', 'Guarda el borrador antes de convertir.', 'warning')
      return
    }
    if (derived !== 'READY_FOR_CONVERSION') {
      setErr('El intake ya no está listo para conversión. Recarga el borrador.')
      return
    }
    setConverting(true)
    setErr('')
    try {
      const result = await convertIntakeToPaymentRequest({
        intakeId: context.intake.id,
        expectedIntakeUpdatedAt: context.intake.updated_at,
        expectedDraftVersion: context.draft?.version ?? null,
        actionId: conversionActionId.current,
      })
      showToast('Solicitud de pago creada', `${result.request_number || 'La solicitud'} entró como ${result.request_status || 'submitted'} con presupuesto ${result.budget_decision || 'validado'}.`, 'success')
      await onConverted()
    } catch (e) {
      setErr(friendlyIntakeError(e))
      setConfirmConvert(false)
    } finally {
      setConverting(false)
    }
  }

  async function resolveBanking() {
    if (!banking || dirty) return
    if (!window.confirm('¿Usar los datos maestros vigentes para resolver la revisión bancaria?')) return
    try {
      await confirmMasterBanking({
        intakeId: context.intake.id,
        expectedIntakeUpdatedAt: context.intake.updated_at,
        expectedProviderUpdatedAt: banking.provider_updated_at,
        actionId: createUuid(),
      })
      showToast('Decisión bancaria auditada', 'La revisión de datos bancarios quedó resuelta.', 'success')
      await reloadContext()
    } catch (e) {
      setErr(friendlyIntakeError(e))
    }
  }

  function requestClose() {
    if (dirty) { setConfirmDiscard(true); return }
    onClose()
  }

  const missing = (context.state?.missing_fields || []).filter((f) => f !== 'amount_change_reason')
  const completed = 11 - missing.length

  return (
    <div className={s.overlay} onClick={requestClose} style={{ zIndex: 60 }}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 880 }}>
        <div className={s.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>Preparación de solicitud de pago</h2>
            <p className="muted">{context.intake.public_folio || ''} · {context.intake.company_name || ''} · {completed}/11 campos completos</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Badge variant={(PAYMENT_DRAFT_STATE[derived || ''] || PAYMENT_DRAFT_STATE.NOT_STARTED).variant}>
              {(PAYMENT_DRAFT_STATE[derived || ''] || PAYMENT_DRAFT_STATE.NOT_STARTED).label}
            </Badge>
            <button className="small-btn" onClick={requestClose}>Cerrar</button>
          </div>
        </div>

        <div className={s.modalBody}>
          {/* Resumen declarado (solo lectura) */}
          <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
            Declarado: {displayValue(context.intake.provider_name)} · {displayValue(context.intake.concept)} ·
            monto solicitado {context.intake.amount_requested != null ? context.intake.amount_requested.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' }) : 'No indicado'}
          </p>

          {/* Revisión bancaria */}
          {banking?.material_mismatch && context.provider && (
            <div className={s.actionForm}>
              <strong>Revisión de datos bancarios</strong>
              <div className="muted" style={{ fontSize: '.85rem' }}>
                Diferencias: {(banking.difference_fields || []).map((f) => BANKING_FIELD_LABELS[f] || f).join(' · ') || '—'}
              </div>
              {banking.resolution_valid
                ? <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>Resuelto {banking.resolution?.created_at ? `· ${formatDateTime(banking.resolution.created_at)}` : ''}</p>
                : form.payment_method === 'transfer'
                  ? (
                    <div className={s.actionFormBtns} style={{ justifyContent: 'flex-start' }}>
                      <button className="secondary-btn" disabled={dirty || context.draft?.payment_method !== 'transfer'} onClick={resolveBanking}>
                        Usar datos maestros vigentes
                      </button>
                      {dirty && <span className="muted" style={{ fontSize: '.8rem' }}>Guarda el borrador primero.</span>}
                    </div>
                  )
                  : <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>El método actual no requiere resolución bancaria, pero revisa las diferencias.</p>}
            </div>
          )}

          {/* Formulario */}
          <div className={s.detailGrid}>
            <label className={s.draftField}>
              Empresa
              <input type="text" readOnly value={context.intake.company_name || ''} />
            </label>
            <label className={s.draftField}>
              Centro de costo
              <select value={form.cost_center_id || ''} onChange={(e) => patch({ cost_center_id: e.target.value || null })}>
                <option value="">Pendiente</option>
                {(context.catalogs?.cost_centers || []).map((c) => <option key={c.id} value={c.id}>{[c.code, c.name].filter(Boolean).join(' · ')}</option>)}
              </select>
            </label>
            <label className={s.draftField}>
              Categoría presupuestal
              <select value={form.budget_category_id || ''} onChange={(e) => patch({ budget_category_id: e.target.value || null })}>
                <option value="">Pendiente</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>)}
              </select>
            </label>
            <label className={s.draftField}>
              Mes presupuestal
              <input type="month" value={monthValue(form.budget_month)} onChange={(e) => patch({ budget_month: e.target.value ? `${e.target.value}-01` : null })} />
            </label>
            <label className={s.draftField}>
              Método de pago
              <select value={form.payment_method || ''} onChange={(e) => patch({ payment_method: e.target.value || null })}>
                <option value="">Pendiente</option>
                <option value="transfer">Transferencia</option>
                <option value="cash">Efectivo</option>
                <option value="check">Cheque</option>
                <option value="other">Otro</option>
              </select>
            </label>
            {form.payment_method === 'transfer' && (
              <label className={s.draftField}>
                Cuenta origen
                <select value={form.company_bank_account_id || ''} onChange={(e) => patch({ company_bank_account_id: e.target.value || null })}>
                  <option value="">Pendiente</option>
                  {(context.catalogs?.origin_accounts || []).map((a) => (
                    <option key={a.id} value={a.id}>{[a.name, a.bank_name, a.last4 ? `terminación ${a.last4}` : null].filter(Boolean).join(' · ')}</option>
                  ))}
                </select>
              </label>
            )}
            <label className={s.draftField}>
              Monto final
              <input type="number" min={0.01} step={0.01} value={form.final_amount ?? ''} onChange={(e) => patch({ final_amount: e.target.value || null })} />
            </label>
            <label className={s.draftField}>
              Moneda
              <select value={form.currency || ''} onChange={(e) => patch({ currency: e.target.value || null })}>
                <option value="">Pendiente</option>
                {(context.catalogs?.currencies || []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={s.draftField}>
              Fecha programada
              <input type="date" value={form.scheduled_payment_date || ''} onChange={(e) => patch({ scheduled_payment_date: e.target.value || null })} />
            </label>
            <label className={s.draftField}>
              Solicitante
              <select value={form.requested_by_profile_id || ''} onChange={(e) => patch({ requested_by_profile_id: e.target.value || null })}>
                <option value="">Pendiente</option>
                {(context.requester_options || []).map((r) => <option key={r.profile_id} value={r.profile_id}>{r.display_name || r.profile_id}</option>)}
              </select>
            </label>
            <label className={s.draftField}>
              Aprobador
              <select value={form.approver_profile_id || ''} onChange={(e) => {
                const opt = approvers.find((a) => a.profile_id === e.target.value)
                patch({ approver_profile_id: e.target.value || null, approver_assignment_id: opt?.assignment_id ?? null })
              }}>
                <option value="">{form.cost_center_id && Number(form.final_amount || 0) > 0 ? 'Pendiente' : 'Completa centro de costo, monto y solicitante…'}</option>
                {approvers.map((a) => <option key={a.profile_id} value={a.profile_id}>{a.option_label || a.display_name || a.profile_id}</option>)}
              </select>
              {approverErr && <span className={s.actionErr}>{approverErr}</span>}
              {savedApproverInvalid && <span className={s.actionErr}>El aprobador guardado ya no es válido para la regla vigente.</span>}
            </label>
          </div>

          <label className={s.draftField}>
            Concepto interno
            <input type="text" minLength={3} maxLength={500} value={form.internal_concept ?? ''} onChange={(e) => patch({ internal_concept: e.target.value || null })} />
          </label>
          <label className={s.draftField}>
            Notas internas (opcional)
            <textarea rows={3} maxLength={2000} value={form.internal_notes ?? ''} onChange={(e) => patch({ internal_notes: e.target.value || null })} />
          </label>
          {amountChanged && (
            <label className={s.draftField}>
              Razón del cambio de monto (mínimo 10 caracteres)
              <textarea rows={2} minLength={10} maxLength={1000} value={form.amount_change_reason ?? ''} onChange={(e) => patch({ amount_change_reason: e.target.value || null })} />
            </label>
          )}

          {err && <p className={s.actionErr} role="alert">{err}</p>}

          {confirmConvert ? (
            <div className={s.actionForm}>
              <strong>Confirmar conversión</strong>
              <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
                Se creará exactamente una solicitud real, se validará presupuesto y entrará en estado Submitted.
                Esta acción no aprueba, no crea batch, no ejecuta pago ni envía una notificación externa.
              </p>
              <div className={s.actionFormBtns}>
                <button className="secondary-btn" disabled={converting} onClick={() => setConfirmConvert(false)}>Cancelar</button>
                <button className="primary-btn" disabled={converting} onClick={convert}>{converting ? 'Convirtiendo…' : 'Crear solicitud de pago'}</button>
              </div>
            </div>
          ) : confirmDiscard ? (
            <div className={s.actionForm}>
              <strong>Tienes cambios sin guardar</strong>
              <div className={s.actionFormBtns}>
                <button className="secondary-btn" onClick={() => setConfirmDiscard(false)}>Seguir editando</button>
                <button className="danger-btn" onClick={onClose}>Descartar cambios</button>
              </div>
            </div>
          ) : (
            <div className={s.actionFormBtns}>
              <button className="secondary-btn" onClick={reloadContext}>Recargar borrador</button>
              <button className="secondary-btn" disabled={!context.can_save || saving} onClick={save}>{saving ? 'Guardando…' : 'Guardar borrador'}</button>
              {derived === 'READY_FOR_CONVERSION' && !savedApproverInvalid && (
                <button className="primary-btn" disabled={converting} onClick={() => setConfirmConvert(true)}>Convertir a solicitud de pago</button>
              )}
            </div>
          )}

          {missing.length > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>
              Pendientes: {missing.map((f) => PAYMENT_DRAFT_FIELD_LABELS[f] || f).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
