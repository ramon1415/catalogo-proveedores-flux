import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import {
  FILE_CARDS,
  accountLabel,
  accountsForCompany,
  captureStateLabel,
  channelLabel,
  costCenterLabel,
  costCentersForCompany,
  enabledSlots,
  formatMoney,
  friendlyError,
  inspectFile,
  parserErrorSlot,
  requiredSlots,
  slotLabel,
  slotsForChannel,
  sourceAccountCandidates,
  validateMetadata,
} from './logic'
import {
  acknowledgeTokaVariance,
  getCaptureSessions,
  getSubmissionSummary,
  listApproverOptions,
  materializeCapture,
  saveCaptureSession,
  submitForApproval,
  uploadReservedFile,
} from './api'
import type {
  ApproverCandidate,
  BankAccount,
  Company,
  CompanyCostCenter,
  CostCenter,
  CaptureSession,
  FileMap,
  PayrollChannel,
  PayrollSlot,
  PayrollSubtype,
  SubmissionSummary,
} from './types'
import s from './Nomina.module.css'

type Props = {
  session: CaptureSession | null
  companies: Company[]
  accounts: BankAccount[]
  costCenters: CostCenter[]
  mappings: CompanyCostCenter[]
  isFinance: boolean
  onClose: () => void
  onSaved: () => void
}

export function CaptureModal({ session, companies, accounts, costCenters, mappings, isFinance, onClose, onSaved }: Props) {
  const { showToast } = useToast()

  // Metadata (equivalente a los campos del form de Solicitudes en modo nómina).
  const [companyId, setCompanyId] = useState('')
  const [sourceAccountId, setSourceAccountId] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [subtype, setSubtype] = useState<PayrollSubtype>('ordinaria')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [concept, setConcept] = useState('')
  const [notes, setNotes] = useState('')
  const [channels, setChannels] = useState<PayrollChannel[]>([])
  const [files, setFiles] = useState<FileMap>({})

  // Estado de sesión / materialización.
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionVersion, setSessionVersion] = useState<number | null>(null)
  const [materializedRequestId, setMaterializedRequestId] = useState<string | null>(null)
  const persistedCompanyId = useRef<string | null>(null)
  const persistedSourceAccountId = useRef<string | null>(null)

  // Resumen de submission + aprobadores.
  const [summary, setSummary] = useState<SubmissionSummary | null>(null)
  const [approvers, setApprovers] = useState<ApproverCandidate[]>([])
  const [approverValue, setApproverValue] = useState('')
  const [varianceNote, setVarianceNote] = useState('')

  const [saving, setSaving] = useState(false)
  const [materializing, setMaterializing] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const locked = materializedRequestId !== null

  // Hidratar desde una sesión existente (resume) o abrir en limpio.
  useEffect(() => {
    if (!session) return
    setSessionId(session.id)
    setSessionVersion(session.version)
    setMaterializedRequestId(session.materialized_payment_request_id || null)
    persistedCompanyId.current = session.company_id
    persistedSourceAccountId.current = session.company_bank_account_id
    setCompanyId(session.company_id)
    setSourceAccountId(session.company_bank_account_id)
    setCostCenterId(session.cost_center_id || '')
    setSubtype(session.payroll_subtype)
    setPeriodStart(session.period_start)
    setPeriodEnd(session.period_end)
    setConcept(session.concept)
    setNotes(session.notes || '')
    setChannels(session.expected_channels || [])
    const hydrated: FileMap = {}
    ;(session.files || []).forEach((f) => {
      hydrated[f.kind] = {
        present: true,
        uploaded: true,
        uploadable: false,
        status: f.parsing_status || 'server_verification_pending',
        recordCount: f.record_count,
        totalAmountMinor: f.total_amount_minor,
        issueCodes: f.issue_codes || [],
      }
    })
    setFiles(hydrated)
    if (session.materialized_payment_request_id) void loadSubmissionSummary(session.materialized_payment_request_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const companyAccounts = useMemo(() => accountsForCompany(accounts, companyId), [accounts, companyId])
  const companyCostCenters = useMemo(
    () => costCentersForCompany(costCenters, mappings, companyId),
    [costCenters, mappings, companyId],
  )
  const selectedAccount = useMemo(() => accounts.find((a) => a.id === sourceAccountId), [accounts, sourceAccountId])
  const candidates = useMemo(() => sourceAccountCandidates(selectedAccount), [selectedAccount])

  const required = useMemo(() => requiredSlots(channels), [channels])
  const enabled = useMemo(() => enabledSlots(channels), [channels])
  const missing = useMemo(() => required.filter((slot) => !files[slot]?.uploaded), [required, files])

  // ── Cambios de empresa / cuenta (locks tras subir evidencia) ──────────────
  function handleCompanyChange(next: string) {
    const hasPersisted = Object.values(files).some((f) => f?.uploaded)
    if (sessionId && persistedCompanyId.current && next !== persistedCompanyId.current && hasPersisted) {
      showToast('Empresa protegida', 'La empresa queda fija después de subir evidencia.', 'warning')
      return
    }
    setCompanyId(next)
    setSourceAccountId('')
    setCostCenterId('')
    clearLocalFileSelections()
  }

  function handleSourceAccountChange(next: string) {
    const encodedUploaded = files.layout_spei?.uploaded || files.layout_toka?.uploaded
    if (sessionId && persistedSourceAccountId.current && encodedUploaded && next !== persistedSourceAccountId.current) {
      showToast('Cuenta origen protegida', 'La cuenta queda fija después de subir un layout que la codifica.', 'warning')
      return
    }
    setSourceAccountId(next)
    // Descartar selecciones locales de layouts que codifican la cuenta.
    setFiles((prev) => {
      const copy = { ...prev }
      ;(['layout_spei', 'layout_toka'] as PayrollSlot[]).forEach((slot) => {
        if (copy[slot]?.file) delete copy[slot]
      })
      return copy
    })
  }

  function clearLocalFileSelections() {
    setFiles((prev) => {
      const copy = { ...prev }
      Object.keys(copy).forEach((k) => {
        if (copy[k as PayrollSlot]?.file) delete copy[k as PayrollSlot]
      })
      return copy
    })
  }

  // ── Canales ───────────────────────────────────────────────────────────────
  function toggleChannel(channel: PayrollChannel) {
    const isOn = channels.includes(channel)
    if (isOn) {
      const slots = slotsForChannel(channel)
      if (slots.some((slot) => files[slot]?.uploaded)) {
        showToast('Canal protegido', 'No puedes retirar un canal después de subir su evidencia. Crea una captura nueva.', 'warning')
        return
      }
      setChannels((prev) => prev.filter((c) => c !== channel))
      setFiles((prev) => {
        const copy = { ...prev }
        slots.forEach((slot) => delete copy[slot])
        return copy
      })
    } else {
      setChannels((prev) => [...prev, channel])
    }
  }

  // ── Archivos ────────────────────────────────────────────────────────────────
  async function handleFile(slot: PayrollSlot, file: File | null) {
    if (!file) {
      setFiles((prev) => {
        const copy = { ...prev }
        delete copy[slot]
        return copy
      })
      return
    }
    try {
      const fs = await inspectFile(slot, file, candidates)
      setFiles((prev) => ({ ...prev, [slot]: fs }))
    } catch {
      setFiles((prev) => ({ ...prev, [slot]: parserErrorSlot() }))
    }
  }

  // ── Guardar captura + subir archivos reservados ──────────────────────────
  async function save() {
    if (saving || locked) return
    const validation = validateMetadata({
      isFinance,
      companyId,
      sourceAccountId,
      costCenterId,
      subtype,
      periodStart,
      periodEnd,
      concept,
      channels,
    })
    if (validation) {
      showToast('Revisa la captura', validation, 'warning')
      return
    }
    setSaving(true)
    try {
      const saved = await saveCaptureSession({
        sessionId,
        expectedVersion: sessionVersion,
        companyId,
        companyBankAccountId: sourceAccountId,
        costCenterId,
        payrollSubtype: subtype,
        periodStart,
        periodEnd,
        concept: concept.trim(),
        notes: notes.trim() || null,
        expectedChannels: channels,
      })
      let version = saved.version
      const currentId = saved.id
      setSessionId(currentId)
      setSessionVersion(version)
      // Subir en dos fases cada archivo pendiente (reserve → storage → confirm).
      // Se marca cada slot como subido y se avanza la versión conforme progresa,
      // para que un reintento tras fallo parcial use la versión correcta (fidelidad
      // con la mutación por-archivo de uploadReservedFile del vanilla).
      const uploads = (Object.entries(files) as Array<[PayrollSlot, FileMap[PayrollSlot]]>).filter(
        ([, fs]) => fs?.uploadable && !fs?.uploaded,
      )
      for (const [slot, fs] of uploads) {
        version = await uploadReservedFile(currentId, version, slot, fs!)
        setSessionVersion(version)
        setFiles((prev) => {
          const existing = prev[slot]
          if (!existing) return prev
          return { ...prev, [slot]: { ...existing, uploaded: true, uploadable: false, file: undefined } }
        })
      }
      // Rehidratar desde el servidor.
      const list = await getCaptureSessions(currentId)
      const current = list.find((x) => x.id === currentId)
      if (current) hydrate(current)
      onSaved()
      showToast('Captura guardada', 'El paquete privado quedó guardado. Cuando estén todos los archivos podrás validar y materializar.', 'success')
    } catch (error) {
      showToast('No se pudo guardar', friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  // Rehidrata el estado local a partir de una sesión del servidor (sin reabrir efecto).
  function hydrate(current: CaptureSession) {
    setSessionId(current.id)
    setSessionVersion(current.version)
    setMaterializedRequestId(current.materialized_payment_request_id || null)
    persistedCompanyId.current = current.company_id
    persistedSourceAccountId.current = current.company_bank_account_id
    setCompanyId(current.company_id)
    setSourceAccountId(current.company_bank_account_id)
    setCostCenterId(current.cost_center_id || '')
    setSubtype(current.payroll_subtype)
    setPeriodStart(current.period_start)
    setPeriodEnd(current.period_end)
    setConcept(current.concept)
    setNotes(current.notes || '')
    setChannels(current.expected_channels || [])
    const hydrated: FileMap = {}
    ;(current.files || []).forEach((f) => {
      hydrated[f.kind] = {
        present: true,
        uploaded: true,
        uploadable: false,
        status: f.parsing_status || 'server_verification_pending',
        recordCount: f.record_count,
        totalAmountMinor: f.total_amount_minor,
        issueCodes: f.issue_codes || [],
      }
    })
    setFiles(hydrated)
    if (current.materialized_payment_request_id) void loadSubmissionSummary(current.materialized_payment_request_id)
  }

  // ── Materializar (Edge Function) ─────────────────────────────────────────
  async function materialize() {
    if (materializing || !sessionId || sessionVersion === null) return
    if (missing.length) {
      showToast('Paquete incompleto', 'Faltan archivos requeridos.', 'warning')
      return
    }
    setMaterializing(true)
    try {
      const result = await materializeCapture(sessionId, sessionVersion)
      const requestId = result.payment_request_id || materializedRequestId
      setMaterializedRequestId(requestId)
      const list = await getCaptureSessions(sessionId)
      const current = list.find((x) => x.id === sessionId)
      if (current) hydrate(current)
      else if (requestId) await loadSubmissionSummary(requestId)
      onSaved()
      showToast('Nómina validada', 'El servidor verificó el paquete y materializó la solicitud.', 'success')
    } catch (error) {
      showToast('Validación no completada', friendlyError(error), 'error')
    } finally {
      setMaterializing(false)
    }
  }

  // ── Resumen de submission + aprobadores ──────────────────────────────────
  async function loadSubmissionSummary(requestId: string) {
    try {
      const data = await getSubmissionSummary(requestId)
      setSummary(data)
      if (data.status === 'draft') {
        try {
          const opts = await listApproverOptions(data.company_id, data.cost_center_id, Number(data.amount_requested))
          setApprovers(opts)
        } catch (error) {
          setApprovers([])
          showToast('Aprobadores no disponibles', friendlyError(error), 'warning')
        }
      } else {
        setApprovers([])
      }
    } catch (error) {
      showToast('No se pudo leer el resumen', friendlyError(error), 'error')
    }
  }

  async function acknowledgeVariance() {
    if (!summary || !materializedRequestId) return
    const note = varianceNote.trim()
    if (!note) {
      showToast('Nota requerida', 'Documenta la revisión de la diferencia TOKA.', 'warning')
      return
    }
    try {
      await acknowledgeTokaVariance(materializedRequestId, note)
      setVarianceNote('')
      await loadSubmissionSummary(materializedRequestId)
      showToast('Diferencia revisada', 'Finanzas dejó evidencia de la revisión del fondeo TOKA.', 'success')
    } catch (error) {
      showToast('No se pudo reconocer la diferencia', friendlyError(error), 'error')
    }
  }

  async function submit() {
    if (submitting || !summary || !materializedRequestId) return
    const option = approvers.find((a) => a.profile_id === approverValue)
    if (!option) {
      showToast('Aprobador requerido', 'Selecciona un aprobador elegible.', 'warning')
      return
    }
    // Gate de presupuesto (budget_live_frontend_guards): bloquear si draft y no listo.
    if (summary.status === 'draft' && summary.budget_ready === false) {
      showToast('Presupuesto requerido', 'Configura y valida el presupuesto antes de enviar la Nómina a aprobación.', 'warning')
      return
    }
    setSubmitting(true)
    try {
      await submitForApproval(materializedRequestId, option.profile_id, option.assignment_id || null)
      await loadSubmissionSummary(materializedRequestId)
      onSaved()
      showToast('Enviada a aprobación', 'La Nómina quedó enviada al aprobador seleccionado.', 'success')
    } catch (error) {
      showToast('No se pudo enviar', friendlyError(error), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Derivados de render ────────────────────────────────────────────────────
  const captureState = locked ? 'Materializada' : missing.length ? 'Archivos pendientes' : 'Lista para validación server-side'
  const totalText = summary ? formatMoney(summary.amount_requested) : 'Se calcula en servidor'
  const spei = files.layout_spei
  const speiText = spei?.recordCount ? String(spei.recordCount) : spei?.uploaded ? 'Servidor validará' : 'Pendiente'

  const channelSummary = summary && Array.isArray(summary.channels) ? summary.channels : []
  const valesChannel = channelSummary.find((c) => c.channel === 'vales')
  const variance = Number(valesChannel?.funding_variance || 0)
  const needsReview = variance !== 0 && !valesChannel?.funding_variance_acknowledged
  const isDraft = summary?.status === 'draft'
  const budgetReady = summary?.budget_ready === true
  const approvalReady = isDraft && !needsReview && budgetReady
  const budgetBlocked = summary?.budget_decision === 'bloqueado'

  function renderFileStatus(slot: PayrollSlot, isRequired: boolean) {
    const f = files[slot]
    if (!isRequired) return <span className={`${s.state} ${s.stateNeutral}`}>No requerido</span>
    if (!f) {
      return (
        <>
          <span className={`${s.state} ${s.stateWarning}`}>Pendiente de archivo</span>
          <small>MISSING_USER_FILE</small>
        </>
      )
    }
    if (f.status === 'parser_error' || f.status === 'failed') {
      return (
        <>
          <span className={`${s.state} ${s.stateDanger}`}>Error de formato</span>
          <small>No se subirá</small>
        </>
      )
    }
    if (locked) {
      return (
        <>
          <span className={`${s.state} ${s.stateSuccess}`}>Verificado en servidor</span>
          <small>Evidencia vinculada a la corrida materializada</small>
        </>
      )
    }
    if (f.uploaded) {
      return (
        <>
          <span className={`${s.state} ${s.stateSuccess}`}>Archivo privado recibido</span>
          <small>{slot === 'layout_spei' ? 'Diagnóstico local PASS · servidor revalidará' : 'Verificación server-side pendiente'}</small>
        </>
      )
    }
    return (
      <>
        <span className={`${s.state} ${s.stateWarning}`}>Listo para subir</span>
        <small>Se verificará en servidor</small>
      </>
    )
  }

  const actions = (
    <>
      <button type="button" className={s.secondaryBtn} onClick={onClose}>
        Cerrar
      </button>
      <button type="button" className={s.secondaryBtn} onClick={save} disabled={locked || saving}>
        {saving ? 'Guardando…' : 'Guardar captura'}
      </button>
      <button
        type="button"
        className={s.primaryBtn}
        onClick={materialize}
        disabled={locked || !sessionId || missing.length > 0 || materializing}
      >
        {materializing ? 'Validando en servidor…' : 'Validar paquete y materializar'}
      </button>
    </>
  )

  return (
    <Modal
      title="Captura de nómina"
      subtitle="Carga el paquete físico, valida en servidor y envía el total de Tesorería a aprobación."
      size="lg"
      onClose={onClose}
      actions={actions}
    >
      <div className={s.section}>
        <span className={s.devPill}>DEV · N3G</span>
        <p className={s.sectionCopy}>
          Flux no calcula nómina. Valida el paquete físico, materializa la corrida y la envía a aprobación individual.
        </p>

        <div className={s.grid}>
          <label>
            Empresa *
            <select value={companyId} onChange={(e) => handleCompanyChange(e.target.value)} disabled={locked}>
              <option value="">Seleccionar empresa</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tipo de corrida *
            <select value={subtype} onChange={(e) => setSubtype(e.target.value as PayrollSubtype)} disabled={locked}>
              <option value="ordinaria">Ordinaria</option>
              <option value="extraordinaria">Extraordinaria</option>
            </select>
          </label>
          <label>
            Cuenta origen *
            <select value={sourceAccountId} onChange={(e) => handleSourceAccountChange(e.target.value)} disabled={locked || !companyId}>
              <option value="">{companyId ? 'Seleccionar cuenta origen' : 'Selecciona empresa primero'}</option>
              {companyAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountLabel(a)}
                </option>
              ))}
            </select>
            <span className={s.hint}>Cuenta de Tesorería; siempre se muestra enmascarada.</span>
          </label>
          <label>
            Centro de costo *
            <select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} disabled={locked || !companyId}>
              <option value="">{companyId ? 'Seleccionar centro de costo' : 'Selecciona empresa primero'}</option>
              {companyCostCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {costCenterLabel(c)}
                </option>
              ))}
            </select>
            <span className={s.hint}>Define el contexto contable y las reglas de aprobación.</span>
          </label>
          <label>
            Periodo inicio *
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={locked} />
          </label>
          <label>
            Periodo fin *
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={locked} />
          </label>
          <label className={s.fullRow}>
            Concepto *
            <input value={concept} onChange={(e) => setConcept(e.target.value)} disabled={locked} placeholder="Concepto o descripción de la corrida" />
          </label>
          <label className={s.fullRow}>
            Notas
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} disabled={locked} />
          </label>
        </div>

        <fieldset className={s.channelPicker}>
          <legend>Canales de la corrida *</legend>
          {[
            { value: 'banco' as PayrollChannel, label: 'BBVA mismo banco' },
            { value: 'spei' as PayrollChannel, label: 'SPEI' },
            { value: 'vales' as PayrollChannel, label: 'Vales / TOKA' },
          ].map((ch) => (
            <label key={ch.value}>
              <input type="checkbox" checked={channels.includes(ch.value)} onChange={() => toggleChannel(ch.value)} disabled={locked} />
              {ch.label}
            </label>
          ))}
        </fieldset>

        <div>
          <span className={s.privatePill}>Privado · Finanzas</span>
        </div>

        <div className={s.fileGrid}>
          {FILE_CARDS.map((card) => {
            const isRequired = required.includes(card.slot)
            const slotEnabled = enabled[card.slot]
            return (
              <article key={card.slot} className={`${s.fileCard} ${slotEnabled ? '' : s.fileCardDisabled}`}>
                <div className={s.fileCardHead}>
                  <strong>{card.title}</strong>
                  <span>{card.badge}</span>
                </div>
                <p>{card.copy}</p>
                <input
                  type="file"
                  accept={card.accept}
                  aria-label={card.title}
                  disabled={locked || !slotEnabled}
                  onChange={(e) => handleFile(card.slot, e.target.files?.[0] || null)}
                />
                <div className={s.fileStatus}>{renderFileStatus(card.slot, isRequired)}</div>
              </article>
            )
          })}
        </div>

        <section className={s.validationPanel} aria-live="polite">
          <div className={s.validationRow}>
            <span className={s.summaryLabel}>Estado</span>
            <strong>{captureState}</strong>
          </div>
          <div className={s.validationRow}>
            <span className={s.summaryLabel}>Monto</span>
            <strong>{totalText}</strong>
          </div>
          <div className={s.validationRow}>
            <span className={s.summaryLabel}>SPEI</span>
            <strong>{speiText}</strong>
          </div>
          <div className={s.issues}>
            {missing.length ? (
              missing.map((slot) => (
                <span key={slot} className={s.issueChip}>
                  MISSING_USER_FILE · {slotLabel(slot)}
                </span>
              ))
            ) : (
              <span className={s.issueChip}>Paquete completo para verificación</span>
            )}
          </div>
          <p className={s.piiNote}>
            Esta vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias de empleados.
          </p>
        </section>

        {summary && (
          <section className={s.summary}>
            <div className={s.metrics}>
              <div className={s.metric}>
                <span>Neto empleados</span>
                <strong>{formatMoney(summary.employee_net)}</strong>
              </div>
              <div className={s.metric}>
                <span>Salida Tesorería</span>
                <strong>{formatMoney(summary.amount_requested)}</strong>
              </div>
            </div>

            <div className={s.channelList}>
              {channelSummary.map((c) => {
                let detail = formatMoney(c.amount)
                if (c.channel === 'vales') {
                  detail += ` · beneficio ${formatMoney(c.benefit_amount)} · comisión ${formatMoney(c.fee_amount)} · IVA ${formatMoney(c.tax_amount)}`
                }
                return (
                  <div key={c.channel} className={s.channelRow}>
                    <span>{channelLabel(c.channel)}</span>
                    <strong>{detail}</strong>
                  </div>
                )
              })}
            </div>

            {needsReview && valesChannel && (
              <div className={s.review}>
                <strong>Revisión de fondeo TOKA requerida</strong>
                <p>
                  Fondeo real {formatMoney(valesChannel.amount)} vs esperado {formatMoney(valesChannel.expected_funding_amount)} · diferencia{' '}
                  {formatMoney(variance)}.
                </p>
                <textarea
                  maxLength={500}
                  value={varianceNote}
                  onChange={(e) => setVarianceNote(e.target.value)}
                  placeholder="Documenta por qué Finanzas acepta la diferencia antes de enviar a aprobación."
                />
                <div className={s.actionsRow}>
                  <button type="button" className={s.secondaryBtn} onClick={acknowledgeVariance}>
                    Reconocer diferencia
                  </button>
                </div>
              </div>
            )}

            {/* Gate de presupuesto (budget_live_frontend_guards, plegado). */}
            {isDraft && !budgetReady && (
              <div className={`${s.budgetGate} ${budgetBlocked ? s.budgetBlocked : s.budgetPending}`}>
                <div>
                  <strong>{budgetBlocked ? 'Presupuesto bloqueado' : 'Presupuesto pendiente'}</strong>
                  <p>
                    {budgetBlocked
                      ? summary.budget_block_reason || 'La disponibilidad vigente no permite enviar esta Nómina a aprobación.'
                      : 'Configura mes y partida presupuestal antes de seleccionar aprobador.'}
                  </p>
                </div>
                {materializedRequestId && (
                  <a className={s.secondaryBtn} href={`/nomina_presupuesto.html?request_id=${encodeURIComponent(materializedRequestId)}`}>
                    Configurar presupuesto
                  </a>
                )}
              </div>
            )}

            {isDraft && budgetReady && (
              <div className={`${s.budgetGate} ${s.budgetReady}`}>
                <div>
                  <strong>Presupuesto listo</strong>
                  <p>
                    Disponible después: {formatMoney(summary.budget_available_after)} · {String(summary.budget_month || '').slice(0, 7)}
                  </p>
                </div>
              </div>
            )}

            {approvalReady && (
              <div className={s.approval}>
                <label>
                  Aprobador *
                  <select value={approverValue} onChange={(e) => setApproverValue(e.target.value)}>
                    <option value="">Selecciona aprobador</option>
                    {approvers.map((a) => (
                      <option key={a.profile_id} value={a.profile_id}>
                        {a.option_label || a.display_name || a.email || a.profile_id}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={s.primaryBtn} onClick={submit} disabled={!approvers.length || submitting}>
                  Enviar a aprobación
                </button>
              </div>
            )}

            <p className={s.submissionState}>
              {isDraft
                ? needsReview
                  ? 'Reconoce la diferencia TOKA antes de enviar.'
                  : !budgetReady
                    ? 'Configura y valida el presupuesto antes de seleccionar aprobador.'
                    : approvers.length
                      ? 'Lista para seleccionar aprobador.'
                      : 'No hay aprobadores elegibles para este contexto.'
                : `Estado de solicitud: ${summary.status}`}
            </p>
          </section>
        )}

        {session && (
          <p className={s.hint}>Sesión: {captureStateLabel(session.capture_state)}</p>
        )}
      </div>
    </Modal>
  )
}
