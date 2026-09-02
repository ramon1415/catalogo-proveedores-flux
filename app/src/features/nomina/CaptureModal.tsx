import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { isDevSupabaseProject } from '../../lib/supabase'
import {
  ALL_SLOTS,
  SLOT_CONFIG,
  accountLabel,
  accountsForCompany,
  channelLabel,
  channelsFromFiles,
  costCenterLabel,
  costCentersForCompany,
  defaultPayrollConcept,
  formatMoney,
  friendlyError,
  inferPayrollPeriodFromFileNames,
  inspectFile,
  requiredSlots,
  slotLabel,
  sourceAccountCandidates,
  validateMetadata,
} from './logic'
import { classifyPayrollFile } from './physicalParsers'
import {
  acknowledgeTokaVariance,
  getCaptureSessions,
  getSubmissionSummary,
  listApproverOptions,
  materializeCapture,
  revalidateMaterializedCapture,
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
  FileSlotState,
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
  activeCompanyId: string
  onClose: () => void
  onSaved: () => void
}

type UnrecognizedFile = {
  id: string
  file: File
  message: string
}

function storageKey(kind: 'account' | 'cost-center', companyId: string): string {
  return `flux:payroll:${kind}:${companyId}`
}

function readRemembered(kind: 'account' | 'cost-center', companyId: string): string {
  try {
    return window.localStorage.getItem(storageKey(kind, companyId)) || ''
  } catch {
    return ''
  }
}

function remember(kind: 'account' | 'cost-center', companyId: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(storageKey(kind, companyId), value)
  } catch {
    // El almacenamiento local es sólo una comodidad; nunca bloquea la captura.
  }
}

function fileId(file: File, index: number): string {
  return `${file.name}:${file.size}:${file.lastModified}:${index}`
}

function moneyFromMinor(value: number | null | undefined): string {
  return Number.isSafeInteger(value) ? formatMoney(Number(value) / 100) : '—'
}

export function CaptureModal({ session, companies, accounts, costCenters, mappings, isFinance, activeCompanyId, onClose, onSaved }: Props) {
  const { showToast } = useToast()

  const [companyId, setCompanyId] = useState(activeCompanyId)
  const [sourceAccountId, setSourceAccountId] = useState('')
  const [costCenterId, setCostCenterId] = useState('')
  const [subtype, setSubtype] = useState<PayrollSubtype>('ordinaria')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [concept, setConcept] = useState('')
  const [notes, setNotes] = useState('')
  const [channels, setChannels] = useState<PayrollChannel[]>([])
  const [files, setFiles] = useState<FileMap>({})
  const [unrecognized, setUnrecognized] = useState<UnrecognizedFile[]>([])

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionVersion, setSessionVersion] = useState<number | null>(null)
  const [materializedRequestId, setMaterializedRequestId] = useState<string | null>(null)
  const persistedSourceAccountId = useRef<string | null>(null)

  const [summary, setSummary] = useState<SubmissionSummary | null>(null)
  const [approvers, setApprovers] = useState<ApproverCandidate[]>([])
  const [approverValue, setApproverValue] = useState('')
  const [varianceNote, setVarianceNote] = useState('')

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [workflowBusy, setWorkflowBusy] = useState(false)
  const [revalidating, setRevalidating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [replacementNotice, setReplacementNotice] = useState('')
  const classificationEpoch = useRef(0)
  const conceptIsAutomatic = useRef(true)

  const locked = materializedRequestId !== null

  const companyAccounts = useMemo(() => accountsForCompany(accounts, companyId), [accounts, companyId])
  const companyCostCenters = useMemo(
    () => costCentersForCompany(costCenters, mappings, companyId),
    [costCenters, mappings, companyId],
  )
  const selectedAccount = useMemo(() => accounts.find((account) => account.id === sourceAccountId), [accounts, sourceAccountId])
  const sourceCandidates = useMemo(() => sourceAccountCandidates(selectedAccount), [selectedAccount])
  const required = useMemo(() => requiredSlots(channels), [channels])
  const missing = useMemo(
    () => required.filter((slot) => !files[slot]?.uploaded && !files[slot]?.uploadable),
    [required, files],
  )
  const hasParserErrors = useMemo(
    () => Object.values(files).some((file) => file?.status === 'parser_error' || file?.status === 'failed'),
    [files],
  )

  useEffect(() => {
    if (!session) {
      setCompanyId(activeCompanyId)
      return
    }
    if (session.company_id !== activeCompanyId) {
      showToast('Captura fuera de alcance', 'La captura no pertenece a la empresa activa.', 'error')
      onClose()
      return
    }
    hydrate(session)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, activeCompanyId])

  useEffect(() => {
    if (session || !companyId || sourceAccountId || !companyAccounts.length) return
    const remembered = readRemembered('account', companyId)
    const preferred = companyAccounts.find((account) => account.id === remembered) || (companyAccounts.length === 1 ? companyAccounts[0] : null)
    if (preferred) setSourceAccountId(preferred.id)
  }, [session, companyId, companyAccounts, sourceAccountId])

  useEffect(() => {
    if (session || !companyId || costCenterId || !companyCostCenters.length) return
    const remembered = readRemembered('cost-center', companyId)
    const preferred =
      companyCostCenters.find((center) => center.id === remembered) || (companyCostCenters.length === 1 ? companyCostCenters[0] : null)
    if (preferred) setCostCenterId(preferred.id)
  }, [session, companyId, companyCostCenters, costCenterId])

  useEffect(() => {
    if (!conceptIsAutomatic.current || locked) return
    setConcept(defaultPayrollConcept(subtype, periodStart, periodEnd))
  }, [subtype, periodStart, periodEnd, locked])

  function hydrate(current: CaptureSession, loadSummary = true) {
    setSessionId(current.id)
    setSessionVersion(current.version)
    setMaterializedRequestId(current.materialized_payment_request_id || null)
    persistedSourceAccountId.current = current.company_bank_account_id
    setCompanyId(current.company_id)
    setSourceAccountId(current.company_bank_account_id)
    setCostCenterId(current.cost_center_id || '')
    setSubtype(current.payroll_subtype)
    setPeriodStart(current.period_start)
    setPeriodEnd(current.period_end)
    setConcept(current.concept)
    conceptIsAutomatic.current = false
    setNotes(current.notes || '')
    setChannels(current.expected_channels || [])
    setUnrecognized([])
    const hydrated: FileMap = {}
    ;(current.files || []).forEach((file) => {
      hydrated[file.kind] = {
        present: true,
        uploaded: true,
        uploadable: false,
        status: file.parsing_status || 'server_verification_pending',
        fileName: slotLabel(file.kind),
        recordCount: file.record_count,
        totalAmountMinor: file.total_amount_minor,
        issueCodes: file.issue_codes || [],
      }
    })
    setFiles(hydrated)
    if (loadSummary && current.materialized_payment_request_id) void loadSubmissionSummary(current.materialized_payment_request_id)
  }

  function handleSourceAccountChange(next: string) {
    const encodedUploaded = files.layout_spei?.uploaded || files.layout_toka?.uploaded
    if (sessionId && persistedSourceAccountId.current && encodedUploaded && next !== persistedSourceAccountId.current) {
      showToast('Cuenta origen protegida', 'La cuenta queda fija después de subir un layout que la codifica.', 'warning')
      return
    }
    setSourceAccountId(next)
    remember('account', companyId, next)
  }

  function handleCostCenterChange(next: string) {
    setCostCenterId(next)
    remember('cost-center', companyId, next)
  }

  function selectedFileNames(nextFiles: FileMap, nextUnrecognized: UnrecognizedFile[]): string[] {
    return [
      ...Object.values(nextFiles).map((state) => state?.fileName || '').filter(Boolean),
      ...nextUnrecognized.map((entry) => entry.file.name),
    ]
  }

  function applyPeriodInference(nextFiles: FileMap, nextUnrecognized: UnrecognizedFile[]): boolean {
    if (periodStart && periodEnd) return true
    const inferred = inferPayrollPeriodFromFileNames(selectedFileNames(nextFiles, nextUnrecognized))
    if (!inferred) return false
    setPeriodStart(inferred.periodStart)
    setPeriodEnd(inferred.periodEnd)
    return true
  }

  async function addFiles(incoming: File[]) {
    if (locked || !incoming.length || classifying) return
    const epoch = ++classificationEpoch.current
    setClassifying(true)
    setProgressText(`Identificando ${incoming.length} archivo${incoming.length === 1 ? '' : 's'}…`)
    try {
      const results = await Promise.all(
        incoming.map(async (file, index) => {
          try {
            const classified = await classifyPayrollFile(file)
            if (!classified) return { kind: 'unknown' as const, entry: { id: fileId(file, index), file, message: 'No reconocido' } }
            const inspected = await inspectFile(classified.slot, file, sourceCandidates)
            return {
              kind: 'known' as const,
              slot: classified.slot,
              state: {
                ...inspected,
                fileName: file.name,
                recordCount: classified.diagnostic.recordCount,
                totalAmountMinor: classified.diagnostic.totalAmountMinor,
                localDiagnostic: classified.diagnostic,
              } satisfies FileSlotState,
            }
          } catch {
            return { kind: 'unknown' as const, entry: { id: fileId(file, index), file, message: 'No reconocido' } }
          }
        }),
      )
      if (classificationEpoch.current !== epoch) return

      const nextFiles: FileMap = { ...files }
      const nextUnknown = [...unrecognized]
      const replaced: string[] = []
      for (const result of results) {
        if (result.kind === 'unknown') {
          nextUnknown.push(result.entry)
          continue
        }
        if (nextFiles[result.slot]?.uploaded) {
          nextUnknown.push({
            id: fileId(result.state.file as File, nextUnknown.length),
            file: result.state.file as File,
            message: `${slotLabel(result.slot)} ya está guardado; crea una captura nueva para reemplazarlo`,
          })
          continue
        }
        if (nextFiles[result.slot]) replaced.push(slotLabel(result.slot))
        nextFiles[result.slot] = result.state
      }
      const totalFiles = Object.keys(nextFiles).length + nextUnknown.length
      if (totalFiles > 5) {
        nextUnknown.splice(Math.max(0, nextUnknown.length - (totalFiles - 5)), totalFiles - 5)
        showToast('Máximo cinco archivos', 'La captura admite hasta cinco archivos; los adicionales no se agregaron.', 'warning')
      }
      setFiles(nextFiles)
      setUnrecognized(nextUnknown)
      setChannels(channelsFromFiles(nextFiles))
      const hasPeriod = applyPeriodInference(nextFiles, nextUnknown)
      if (replaced.length) setReplacementNotice(`Se reemplazó el archivo anterior de ${Array.from(new Set(replaced)).join(', ')}.`)

      const inferredChannels = channelsFromFiles(nextFiles)
      const inferredRequired = requiredSlots(inferredChannels)
      const inferredMissing = inferredRequired.filter((slot) => !nextFiles[slot]?.uploadable && !nextFiles[slot]?.uploaded)
      if (!sourceAccountId || !costCenterId || !hasPeriod || inferredMissing.length) setDetailsOpen(true)
    } finally {
      if (classificationEpoch.current === epoch) {
        setClassifying(false)
        setProgressText('')
      }
    }
  }

  async function assignManualSlot(entry: UnrecognizedFile, slot: PayrollSlot) {
    if (files[slot]?.uploaded) {
      showToast('Archivo protegido', `${slotLabel(slot)} ya está guardado en esta captura.`, 'warning')
      return
    }
    try {
      const inspected = await inspectFile(slot, entry.file, sourceCandidates)
      const nextFiles = { ...files, [slot]: { ...inspected, fileName: entry.file.name } }
      const nextUnknown = unrecognized.filter((item) => item.id !== entry.id)
      setFiles(nextFiles)
      setUnrecognized(nextUnknown)
      setChannels(channelsFromFiles(nextFiles))
      applyPeriodInference(nextFiles, nextUnknown)
    } catch (error) {
      showToast('Archivo no compatible', friendlyError(error), 'warning')
    }
  }

  function removeFile(slot: PayrollSlot) {
    const current = files[slot]
    if (!current || current.uploaded || locked) return
    const next = { ...files }
    delete next[slot]
    setFiles(next)
    setChannels(channelsFromFiles(next))
  }

  async function validatePendingFiles(): Promise<FileMap> {
    const checked: FileMap = { ...files }
    for (const [slot, state] of Object.entries(files) as Array<[PayrollSlot, FileSlotState | undefined]>) {
      if (!state?.file || state.uploaded) continue
      const inspected = await inspectFile(slot, state.file, sourceCandidates)
      checked[slot] = {
        ...inspected,
        fileName: state.fileName,
        localDiagnostic: state.localDiagnostic,
        recordCount: state.localDiagnostic?.recordCount ?? inspected.recordCount,
        totalAmountMinor: state.localDiagnostic?.totalAmountMinor ?? inspected.totalAmountMinor,
      }
      if (!inspected.uploadable || inspected.status === 'parser_error') throw new Error('PAYROLL_SOURCE_ACCOUNT_MISMATCH')
    }
    setFiles(checked)
    return checked
  }

  async function loadSubmissionSummary(requestId: string): Promise<{ data: SubmissionSummary; options: ApproverCandidate[] }> {
    const data = await getSubmissionSummary(requestId)
    setSummary(data)
    let options: ApproverCandidate[] = []
    if (data.status === 'draft') {
      try {
        options = await listApproverOptions(data.company_id, data.cost_center_id, Number(data.amount_requested))
      } catch (error) {
        showToast('Aprobadores no disponibles', friendlyError(error), 'warning')
      }
    }
    setApprovers(options)
    setApproverValue((current) => {
      if (options.some((option) => option.profile_id === current)) return current
      return options.length === 1 ? options[0].profile_id : ''
    })
    return { data, options }
  }

  async function registerAndAdvance() {
    if (workflowBusy || locked) return
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
      setDetailsOpen(true)
      showToast('Revisa la captura', validation, 'warning')
      return
    }
    if (missing.length || hasParserErrors) {
      showToast('Paquete incompleto', 'Falta un archivo requerido o alguno no pasó la validación local.', 'warning')
      return
    }

    setWorkflowBusy(true)
    try {
      setProgressText('Revisando archivos…')
      const checkedFiles = await validatePendingFiles()
      setProgressText('Registrando corrida…')
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
      remember('account', companyId, sourceAccountId)
      remember('cost-center', companyId, costCenterId)

      const uploads = (Object.entries(checkedFiles) as Array<[PayrollSlot, FileSlotState | undefined]>).filter(
        ([, state]) => state?.uploadable && !state.uploaded,
      )
      for (let index = 0; index < uploads.length; index += 1) {
        const [slot, state] = uploads[index]
        setProgressText(`Subiendo ${index + 1} de ${uploads.length}…`)
        version = await uploadReservedFile(currentId, version, slot, state as FileSlotState)
        setSessionVersion(version)
        setFiles((current) => {
          const existing = current[slot]
          if (!existing) return current
          return { ...current, [slot]: { ...existing, uploaded: true, uploadable: false, file: undefined } }
        })
      }

      setProgressText('Validando paquete en servidor…')
      const result = await materializeCapture(currentId, version)
      const list = await getCaptureSessions(currentId)
      const current = list.find((item) => item.id === currentId)
      const requestId = result.payment_request_id || current?.materialized_payment_request_id || materializedRequestId
      if (!requestId) throw new Error('PAYROLL_MATERIALIZATION_FAILED')
      setMaterializedRequestId(requestId)
      if (current) hydrate(current, false)

      setProgressText('Preparando aprobación…')
      const loaded = await loadSubmissionSummary(requestId)
      const vales = loaded.data.channels?.find((channel) => channel.channel === 'vales')
      const variance = Number(vales?.funding_variance || 0)
      if (variance !== 0 && !vales?.funding_variance_acknowledged) {
        showToast('Corrida registrada', 'Revisa y reconoce la diferencia TOKA para continuar a aprobación.', 'warning')
        onSaved()
        return
      }
      if (loaded.data.budget_ready !== true) {
        showToast('Corrida registrada', 'El paquete quedó validado; falta completar el gate presupuestal.', 'warning')
        onSaved()
        return
      }
      if (loaded.options.length !== 1) {
        showToast(
          'Corrida registrada',
          loaded.options.length > 1 ? 'Selecciona el aprobador para completar el envío.' : 'No hay un aprobador elegible para este contexto.',
          'warning',
        )
        onSaved()
        return
      }

      setProgressText('Enviando a aprobación…')
      const option = loaded.options[0]
      await submitForApproval(requestId, option.profile_id, option.assignment_id || null)
      await loadSubmissionSummary(requestId)
      onSaved()
      showToast('Nómina enviada', 'La corrida quedó registrada y enviada a aprobación.', 'success')
    } catch (error) {
      showToast('No se pudo completar la corrida', friendlyError(error), 'error')
    } finally {
      setWorkflowBusy(false)
      setProgressText('')
    }
  }

  async function revalidate() {
    if (revalidating || !locked || !sessionId || sessionVersion === null || !isFinance || !isDevSupabaseProject) return
    setRevalidating(true)
    try {
      const result = await revalidateMaterializedCapture(sessionId, sessionVersion)
      showToast(
        'Paquete revalidado sin cambios',
        `${result.file_count} archivos · ${result.employee_record_count} registros · ${result.channels.length} canales.`,
        'success',
      )
    } catch (error) {
      showToast('No se pudo revalidar', friendlyError(error), 'error')
    } finally {
      setRevalidating(false)
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
    const option = approvers.find((candidate) => candidate.profile_id === approverValue)
    if (!option) {
      showToast('Aprobador requerido', 'Selecciona un aprobador elegible.', 'warning')
      return
    }
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

  const coverDiagnostic = files.caratula?.localDiagnostic
  const bankDiagnostic = files.layout_mismo_banco?.localDiagnostic
  const speiDiagnostic = files.layout_spei?.localDiagnostic
  const tokaDiagnostic = files.layout_toka?.localDiagnostic
  const cfdiDiagnostic = files.cfdi_vales?.localDiagnostic
  const cashLayoutsMinor = (bankDiagnostic?.totalAmountMinor ?? 0) + (speiDiagnostic?.totalAmountMinor ?? 0)
  const cashDifference = coverDiagnostic?.cashAmountMinor == null ? null : cashLayoutsMinor - coverDiagnostic.cashAmountMinor
  const vouchersDifference =
    coverDiagnostic?.vouchersAmountMinor == null || cfdiDiagnostic?.benefitAmountMinor == null
      ? null
      : cfdiDiagnostic.benefitAmountMinor - coverDiagnostic.vouchersAmountMinor
  const localVariance =
    tokaDiagnostic?.totalAmountMinor == null || cfdiDiagnostic?.expectedFundingAmountMinor == null
      ? null
      : tokaDiagnostic.totalAmountMinor - cfdiDiagnostic.expectedFundingAmountMinor

  const channelSummary = summary && Array.isArray(summary.channels) ? summary.channels : []
  const valesChannel = channelSummary.find((channel) => channel.channel === 'vales')
  const variance = Number(valesChannel?.funding_variance || 0)
  const needsReview = variance !== 0 && !valesChannel?.funding_variance_acknowledged
  const isDraft = summary?.status === 'draft'
  const budgetReady = summary?.budget_ready === true
  const approvalReady = isDraft && !needsReview && budgetReady
  const budgetBlocked = summary?.budget_decision === 'bloqueado'

  const metadataMissing = !sourceAccountId || !costCenterId || !periodStart || !periodEnd || concept.trim().length < 3
  const packageReady =
    channels.length > 0 && missing.length === 0 && !hasParserErrors && unrecognized.length === 0 && Boolean(files.caratula)

  const actions = (
    <>
      <button type="button" className={s.secondaryBtn} onClick={onClose}>
        Cerrar
      </button>
      {locked && isFinance && isDevSupabaseProject && (
        <button type="button" className={s.secondaryBtn} onClick={revalidate} disabled={revalidating}>
          {revalidating ? 'Revalidando paquete…' : 'Revalidar paquete en servidor'}
        </button>
      )}
    </>
  )

  return (
    <Modal
      title="Captura de nómina"
      subtitle="Arrastra el paquete, revisa el resumen y envíalo con una sola acción."
      size="lg"
      onClose={onClose}
      actions={actions}
    >
      <div className={s.section}>
        <div className={s.introRow}>
          <div>
            <span className={s.devPill}>DEV · Captura simplificada</span>
            <p className={s.sectionCopy}>
              Flux valida archivos y registra la corrida; no calcula sueldos, no genera layouts y no ejecuta pagos.
            </p>
          </div>
          <span className={s.privatePill}>Privado · Finanzas</span>
        </div>

        {!locked && (
          <label
            className={`${s.dropzone} ${dropActive ? s.dropzoneActive : ''}`}
            onDragEnter={(event) => {
              event.preventDefault()
              setDropActive(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault()
              if (event.currentTarget === event.target) setDropActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDropActive(false)
              void addFiles(Array.from(event.dataTransfer.files))
            }}
          >
            <strong>{classifying ? 'Identificando archivos…' : 'Arrastra aquí los archivos de la corrida'}</strong>
            <span>Carátula XLSX y layouts TXT/XML, en cualquier orden · máximo 5 archivos</span>
            <span className={s.dropzoneAction}>Seleccionar archivos</span>
            <input
              type="file"
              multiple
              accept=".xlsx,.txt,.xml,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,application/xml,text/xml"
              disabled={classifying}
              onChange={(event) => {
                void addFiles(Array.from(event.target.files || []))
                event.currentTarget.value = ''
              }}
            />
          </label>
        )}

        {replacementNotice && <div className={s.inlineNotice}>{replacementNotice}</div>}

        <section className={s.detectedPanel} aria-live="polite">
          <div className={s.panelHeading}>
            <div>
              <span className={s.summaryLabel}>Archivos detectados</span>
              <strong>{Object.keys(files).length} de hasta 5</strong>
            </div>
            {channels.length > 0 && (
              <div className={s.channelChips}>
                {channels.map((channel) => <span key={channel}>{channelLabel(channel)}</span>)}
              </div>
            )}
          </div>

          <div className={s.fileRows}>
            {(Object.entries(files) as Array<[PayrollSlot, FileSlotState]>).map(([slot, state]) => (
              <article key={slot} className={s.fileRow}>
                <div>
                  <strong>{state.fileName || slotLabel(slot)}</strong>
                  <span>{slotLabel(slot)} · detectado por contenido</span>
                </div>
                <div className={s.fileAggregate}>
                  {state.recordCount != null && <span>{state.recordCount} registros</span>}
                  {state.totalAmountMinor != null && <strong>{moneyFromMinor(state.totalAmountMinor)}</strong>}
                </div>
                <span className={`${s.state} ${state.status === 'parser_error' ? s.stateDanger : state.uploaded ? s.stateSuccess : s.stateWarning}`}>
                  {state.status === 'parser_error' ? 'Revisar' : state.uploaded ? 'Guardado' : 'Listo'}
                </span>
                {!state.uploaded && !locked && (
                  <button type="button" className={s.iconBtn} onClick={() => removeFile(slot)} aria-label={`Quitar ${slotLabel(slot)}`}>
                    Quitar
                  </button>
                )}
              </article>
            ))}

            {unrecognized.map((entry) => (
              <article key={entry.id} className={`${s.fileRow} ${s.fileRowDanger}`}>
                <div>
                  <strong>{entry.file.name}</strong>
                  <span>{entry.message} — elige el tipo manualmente</span>
                </div>
                <select defaultValue="" onChange={(event) => event.target.value && void assignManualSlot(entry, event.target.value as PayrollSlot)}>
                  <option value="">Elegir tipo…</option>
                  {ALL_SLOTS.map((slot) => <option key={slot} value={slot}>{slotLabel(slot)} ({SLOT_CONFIG[slot].extension.toUpperCase()})</option>)}
                </select>
                <span className={`${s.state} ${s.stateDanger}`}>No reconocido</span>
                <button type="button" className={s.iconBtn} onClick={() => setUnrecognized((items) => items.filter((item) => item.id !== entry.id))}>
                  Quitar
                </button>
              </article>
            ))}

            {!Object.keys(files).length && !unrecognized.length && <div className={s.boardEmpty}>Aún no has agregado archivos.</div>}
          </div>
        </section>

        <section className={s.onePageSummary}>
          <div className={s.summaryTop}>
            <div>
              <span className={s.summaryLabel}>Resumen de la corrida</span>
              <strong>{periodStart && periodEnd ? `${periodStart} → ${periodEnd}` : 'Periodo pendiente de inferir'}</strong>
            </div>
            <span className={`${s.state} ${packageReady && !metadataMissing ? s.stateSuccess : s.stateWarning}`}>
              {locked ? 'Validada por servidor' : packageReady && !metadataMissing ? 'Lista para registrar' : 'Requiere revisión'}
            </span>
          </div>

          <div className={s.summaryMetrics}>
            <div className={s.metric}>
              <span>Total neto</span>
              <strong>{summary ? formatMoney(summary.employee_net) : moneyFromMinor(coverDiagnostic?.totalAmountMinor)}</strong>
            </div>
            <div className={s.metric}>
              <span>Empleados</span>
              <strong>{coverDiagnostic?.recordCount ?? 'Servidor validará'}</strong>
            </div>
            <div className={s.metric}>
              <span>Canales</span>
              <strong>{channels.length || '—'}</strong>
            </div>
          </div>

          {channels.length > 0 && (
            <div className={s.channelList}>
              {channels.includes('banco') && <div className={s.channelRow}><span>BBVA mismo banco</span><strong>{moneyFromMinor(bankDiagnostic?.totalAmountMinor)}</strong></div>}
              {channels.includes('spei') && <div className={s.channelRow}><span>SPEI interbancario</span><strong>{moneyFromMinor(speiDiagnostic?.totalAmountMinor)}</strong></div>}
              {channels.includes('vales') && <div className={s.channelRow}><span>TOKA / vales</span><strong>{moneyFromMinor(tokaDiagnostic?.totalAmountMinor)}</strong></div>}
            </div>
          )}

          {(cashDifference !== null || vouchersDifference !== null || localVariance !== null) && (
            <div className={s.localChecks}>
              {cashDifference !== null && <span className={cashDifference === 0 ? s.checkPass : s.checkWarning}>Efectivo vs layouts: {cashDifference === 0 ? 'coincide' : `diferencia ${moneyFromMinor(cashDifference)}`}</span>}
              {vouchersDifference !== null && <span className={vouchersDifference === 0 ? s.checkPass : s.checkWarning}>Vales vs CFDI: {vouchersDifference === 0 ? 'coincide' : `diferencia ${moneyFromMinor(vouchersDifference)}`}</span>}
              {localVariance !== null && localVariance !== 0 && <span className={s.checkWarning}>Fondeo TOKA: diferencia preliminar {moneyFromMinor(localVariance)}</span>}
            </div>
          )}

          {missing.length > 0 && <div className={s.issues}>{missing.map((slot) => <span key={slot} className={s.issueChip}>Falta {slotLabel(slot)}</span>)}</div>}
          {unrecognized.length > 0 && (
            <div className={s.issues}>
              <span className={s.issueChip}>Clasifica o quita los archivos no reconocidos</span>
            </div>
          )}

          <details className={s.details} open={detailsOpen} onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
            <summary>Ver/editar detalles {metadataMissing ? '· faltan datos' : '· completos'}</summary>
            <div className={s.grid}>
              <label>
                Empresa
                <select value={companyId} disabled>
                  {companies.map((company) => <option key={company.id} value={company.id}>{company.name || company.id}</option>)}
                </select>
              </label>
              <label>
                Tipo de corrida
                <select value={subtype} onChange={(event) => setSubtype(event.target.value as PayrollSubtype)} disabled={locked}>
                  <option value="ordinaria">Ordinaria</option>
                  <option value="extraordinaria">Extraordinaria</option>
                </select>
              </label>
              <label>
                Cuenta origen *
                <select value={sourceAccountId} onChange={(event) => handleSourceAccountChange(event.target.value)} disabled={locked}>
                  <option value="">Seleccionar cuenta origen</option>
                  {companyAccounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
                </select>
              </label>
              <label>
                Centro de costo *
                <select value={costCenterId} onChange={(event) => handleCostCenterChange(event.target.value)} disabled={locked}>
                  <option value="">Seleccionar centro de costo</option>
                  {companyCostCenters.map((center) => <option key={center.id} value={center.id}>{costCenterLabel(center)}</option>)}
                </select>
              </label>
              <label>
                Periodo inicio *
                <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} disabled={locked} />
              </label>
              <label>
                Periodo fin *
                <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} disabled={locked} />
              </label>
              <label className={s.fullRow}>
                Concepto *
                <input value={concept} onChange={(event) => { conceptIsAutomatic.current = false; setConcept(event.target.value) }} disabled={locked} />
              </label>
              <label className={s.fullRow}>
                Notas
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={locked} />
              </label>
            </div>
          </details>

          {!locked && (
            <div className={s.primaryAction}>
              <button
                type="button"
                className={`${s.primaryBtn} ${s.primaryWide}`}
                onClick={registerAndAdvance}
                disabled={workflowBusy || classifying || !packageReady || metadataMissing}
              >
                {workflowBusy ? progressText || 'Procesando…' : 'Registrar y enviar a aprobación'}
              </button>
              <small>Se conservan las mismas RPC, carga privada, SHA-256, validación del servidor y auditoría.</small>
            </div>
          )}
        </section>

        {summary && (
          <section className={s.summary}>
            <div className={s.metrics}>
              <div className={s.metric}><span>Neto empleados</span><strong>{formatMoney(summary.employee_net)}</strong></div>
              <div className={s.metric}><span>Salida Tesorería</span><strong>{formatMoney(summary.amount_requested)}</strong></div>
            </div>

            <div className={s.channelList}>
              {channelSummary.map((channel) => <div key={channel.channel} className={s.channelRow}><span>{channelLabel(channel.channel)}</span><strong>{formatMoney(channel.amount)}</strong></div>)}
            </div>

            {needsReview && valesChannel && (
              <div className={s.review}>
                <strong>Revisión de fondeo TOKA requerida</strong>
                <p>Fondeo real {formatMoney(valesChannel.amount)} vs esperado {formatMoney(valesChannel.expected_funding_amount)} · diferencia {formatMoney(variance)}.</p>
                <textarea maxLength={500} value={varianceNote} onChange={(event) => setVarianceNote(event.target.value)} placeholder="Documenta por qué Finanzas acepta la diferencia." />
                <button type="button" className={s.secondaryBtn} onClick={acknowledgeVariance}>Reconocer diferencia</button>
              </div>
            )}

            {isDraft && !budgetReady && (
              <div className={`${s.budgetGate} ${budgetBlocked ? s.budgetBlocked : s.budgetPending}`}>
                <div>
                  <strong>{budgetBlocked ? 'Presupuesto bloqueado' : 'Presupuesto pendiente'}</strong>
                  <p>{summary.budget_block_reason || 'Configura mes y partida presupuestal antes de enviar.'}</p>
                </div>
                {materializedRequestId && <a className={s.secondaryBtn} href={`/nomina_presupuesto.html?request_id=${encodeURIComponent(materializedRequestId)}`}>Configurar presupuesto</a>}
              </div>
            )}

            {approvalReady && (
              <div className={s.approval}>
                <label>
                  Aprobador *
                  <select value={approverValue} onChange={(event) => setApproverValue(event.target.value)}>
                    <option value="">Selecciona aprobador</option>
                    {approvers.map((approver) => <option key={approver.profile_id} value={approver.profile_id}>{approver.option_label || approver.display_name || approver.email || approver.profile_id}</option>)}
                  </select>
                </label>
                <button type="button" className={s.primaryBtn} onClick={submit} disabled={!approverValue || submitting}>{submitting ? 'Enviando…' : 'Continuar y enviar a aprobación'}</button>
              </div>
            )}

            <p className={s.submissionState}>
              {isDraft
                ? needsReview
                  ? 'Reconoce la diferencia TOKA antes de continuar.'
                  : !budgetReady
                    ? 'Completa el gate presupuestal antes de continuar.'
                    : approvers.length
                      ? 'Lista para enviar.'
                      : 'No hay aprobadores elegibles para este contexto.'
                : `Estado de solicitud: ${summary.status}`}
            </p>
          </section>
        )}

        <p className={s.piiNote}>
          Esta vista no muestra nombres, RFC, CURP, NSS, cuentas, CLABE ni referencias de empleados. La validación final siempre ocurre en el servidor.
        </p>
      </div>
    </Modal>
  )
}
