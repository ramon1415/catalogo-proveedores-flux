import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import {
  cleanText, friendlyRpcError, resultFriendlyError, layoutPreviewParamsKey,
  readyPreviewRows, noReadyPreviewMessage, findInvalidPreviewRequest, findRejectedPreviewItem,
} from './logic'
import { previewEligibility, createLayout, collectCandidateDiagnostics } from './api'
import { EligibilityPreview } from './EligibilityPreview'
import type { PreviewAction } from './EligibilityPreview'
import { LayoutResultPanel } from './LayoutResultPanel'
import { LayoutCompletionModal } from './LayoutCompletionModal'
import { LayoutRebatchModal } from './LayoutRebatchModal'
import type { LayoutCompany, CompanyBankAccount, EligibilityPreview as Preview, CreateLayoutResult, NotIncludedItem, PreviewRow } from './types'
import s from './Layouts.module.css'

function defaultDates() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() + 6)
  return { start: today.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

type CreateBtn = null | 'creating' | 'done'
type ResultState = { kind: 'ok'; data: CreateLayoutResult; notIncluded: NotIncludedItem[] } | { kind: 'error'; message: string } | null

export function NewLayoutModal({
  companies,
  accounts,
  profileId,
  activeCompanyId,
  onClose,
  onLayoutsChanged,
  onOpenLines,
}: {
  companies: LayoutCompany[]
  accounts: CompanyBankAccount[]
  profileId: string | null
  activeCompanyId: string | null
  onClose: () => void
  onLayoutsChanged: () => Promise<void> | void
  onOpenLines: (layoutId: string) => void
}) {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const initial = useMemo(defaultDates, [])

  const [periodStart, setPeriodStart] = useState(initial.start)
  const [periodEnd, setPeriodEnd] = useState(initial.end)
  const [name, setName] = useState('')
  const [companyId, setCompanyId] = useState(activeCompanyId || '')
  const [bankAccountId, setBankAccountId] = useState('')

  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [notice, setNotice] = useState('')
  const [result, setResult] = useState<ResultState>(null)
  const [createBtn, setCreateBtn] = useState<CreateBtn>(null)
  const [creating, setCreating] = useState(false)

  const [completionRequest, setCompletionRequest] = useState<PreviewRow | null>(null)
  const [rebatchItem, setRebatchItem] = useState<PreviewRow | null>(null)

  const companyOptions = companies
  const accountOptions = useMemo(() => {
    let list = accounts.filter((a) => cleanText(a.account_number))
    if (companyId) list = list.filter((a) => a.company_id === companyId)
    return list
  }, [accounts, companyId])

  function accountLabel(a: CompanyBankAccount) {
    return [a.name || 'Cuenta origen', a.bank_name, a.account_number ? `cta ${a.account_number}` : a.last4 ? `termina ${a.last4}` : null].filter(Boolean).join(' - ')
  }

  function params() {
    return { p_period_start: periodStart, p_period_end: periodEnd, p_company_id: companyId || null, p_company_bank_account_id: bankAccountId || null }
  }

  function invalidate(filtersChanged: boolean) {
    setPreview(null)
    setPreviewKey(null)
    setResult(null)
    setCreateBtn(null)
    if (filtersChanged) setNotice('Los filtros cambiaron. Revisa nuevamente las solicitudes.')
  }

  function onCompanyChange(value: string) {
    setCompanyId(value)
    // Conserva la cuenta si sigue perteneciendo a la empresa; si no, la limpia.
    setBankAccountId((prev) => {
      const still = accounts.some((a) => a.id === prev && cleanText(a.account_number) && (!value || a.company_id === value))
      return still ? prev : ''
    })
    invalidate(true)
  }

  async function runReview() {
    if (reviewing) return
    const p = params()
    if (!p.p_period_start || !p.p_period_end) return showToast('Fechas requeridas', 'Captura fecha inicio y fecha fin.', 'warning')
    if (!p.p_company_id) return showToast('Empresa requerida', 'Selecciona una empresa activa antes de revisar solicitudes.', 'warning')
    if (p.p_period_start > p.p_period_end) return showToast('Rango invalido', 'La fecha inicio no puede ser mayor a la fecha fin.', 'warning')
    const key = layoutPreviewParamsKey(p)
    setReviewing(true)
    setPreview(null)
    setPreviewKey(null)
    setNotice('')
    setCreateBtn(null)
    try {
      const data = await previewEligibility(p)
      // Solo aplica si los filtros no cambiaron mientras se consultaba.
      if (key !== layoutPreviewParamsKey(params())) return
      setPreview(data)
      setPreviewKey(key)
    } catch (error) {
      setPreview(null)
      setPreviewKey(null)
      setNotice(friendlyRpcError(error))
      showToast('No se pudo revisar', friendlyRpcError(error), 'error')
    } finally {
      setReviewing(false)
    }
  }

  // Flujo de creación efectivo = layouts_result_extension (handler de captura que
  // sobreescribe el submit base de layouts.js con stopImmediatePropagation).
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setResult(null)
    if (!profileId) return showToast('Perfil no identificado', 'No se pudo identificar tu perfil de usuario.', 'error')
    if (!companyId) return showToast('Empresa requerida', 'Selecciona una empresa activa antes de crear el layout.', 'error')
    if (!periodStart || !periodEnd) return showToast('Fechas requeridas', 'Captura fecha inicio y fecha fin.', 'error')
    if (periodStart > periodEnd) return showToast('Rango invalido', 'La fecha inicio no puede ser mayor a la fecha fin.', 'error')

    setCreating(true)
    setCreateBtn('creating')
    try {
      const data = await createLayout({
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_generated_by: profileId,
        p_name: cleanText(name) || null,
        p_company_id: companyId || null,
        p_company_bank_account_id: bankAccountId || null,
      })
      await onLayoutsChanged()
      const diagnostics = await collectCandidateDiagnostics({
        data,
        periodStart,
        periodEnd,
        companyId: companyId || null,
        bankAccountId: bankAccountId || null,
      })
      setResult({ kind: 'ok', data, notIncluded: diagnostics.notIncluded })

      const invalidCount = Number(data?.invalid_count || 0)
      if (data?.message === 'no_valid_payment_requests') {
        showToast('Solicitudes incompletas', 'No se creo layout porque las solicitudes aprobadas tienen datos pendientes.', 'warning')
      } else {
        showToast(
          'Layout creado correctamente',
          invalidCount
            ? `${data?.layout_number || 'El layout'} se creo con ${Number(data?.payment_count || 0)} registros. ${invalidCount} solicitudes quedaron fuera.`
            : `${data?.layout_number || 'El layout'} quedo en borrador con ${Number(data?.payment_count || 0)} registros.`,
          invalidCount ? 'warning' : 'success',
        )
      }
    } catch (error) {
      setResult({ kind: 'error', message: resultFriendlyError(error) })
      showToast('No se pudo crear layout', resultFriendlyError(error), 'error')
    } finally {
      setCreating(false)
      setCreateBtn('done')
    }
  }

  function handlePreviewAction(action: PreviewAction) {
    switch (action.type) {
      case 'focus-section': {
        const el = document.getElementById(action.targetId)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        window.setTimeout(() => (el as HTMLElement | null)?.focus?.(), 250)
        break
      }
      case 'open-request':
        navigate(`/solicitudes?request_id=${encodeURIComponent(action.requestId)}`)
        break
      case 'open-batch':
        window.location.assign(`/approval_batches.html?batch_id=${encodeURIComponent(action.batchId)}`)
        break
      case 'open-provider':
        navigate(`/proveedores?provider_id=${encodeURIComponent(action.providerId)}&return_to=layouts`)
        break
      case 'complete-layout-data': {
        const req = preview ? findInvalidPreviewRequest(preview, action.requestId) : null
        if (req) setCompletionRequest(req)
        break
      }
      case 'rebatch': {
        const item = preview ? findRejectedPreviewItem(preview, action.itemId) : null
        if (item) setRebatchItem(item)
        break
      }
    }
  }

  // Estado del botón "Crear layout".
  const ready = preview ? readyPreviewRows(preview) : []
  let submitDisabled: boolean
  let submitText: string
  if (createBtn === 'creating') { submitDisabled = true; submitText = 'Creando layout...' }
  else if (createBtn === 'done') { submitDisabled = false; submitText = 'Crear layout' }
  else if (reviewing || !preview) { submitDisabled = true; submitText = 'Revisa solicitudes primero' }
  else if (ready.length) { submitDisabled = false; submitText = `Crear y descargar layout con ${ready.length} ${ready.length === 1 ? 'pago' : 'pagos'}` }
  else { submitDisabled = true; submitText = noReadyPreviewMessage(preview) }

  return (
    <>
      <form onSubmit={onSubmit}>
        <Modal
          title="Nuevo layout de pago"
          subtitle="Revisa que cada pago este liberado antes de crear el archivo."
          size="lg"
          onClose={onClose}
          actions={
            <>
              <button type="button" className={s.secondaryBtn} onClick={onClose} disabled={creating}>Cancelar</button>
              <button type="submit" className={s.primaryBtn} disabled={submitDisabled} title={submitText}>{submitText}</button>
            </>
          }
        >
          <div className={s.formGrid}>
            <label>Fecha inicio *
              <input type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); invalidate(true) }} disabled={creating} required />
            </label>
            <label>Fecha fin *
              <input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); invalidate(true) }} disabled={creating} required />
            </label>
            <label className={s.fullRow}>Nombre del layout
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" disabled={creating} />
            </label>
            <label>Empresa
              <select value={companyId} onChange={(e) => onCompanyChange(e.target.value)} disabled={creating || Boolean(activeCompanyId)}>
                {!activeCompanyId && <option value="">Sin empresa activa</option>}
                {companyOptions.map((c) => <option key={c.id} value={c.id}>{c.legal_name || c.name || 'Empresa sin nombre'}</option>)}
              </select>
            </label>
            <label>Cuenta origen
              <select value={bankAccountId} onChange={(e) => { setBankAccountId(e.target.value); invalidate(true) }} disabled={creating}>
                <option value="">Todas las cuentas</option>
                {accountOptions.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
              </select>
            </label>
          </div>

          <div className={s.reviewActions}>
            <button type="button" className={s.secondaryBtn} onClick={runReview} disabled={reviewing || creating}>
              {reviewing ? 'Revisando...' : 'Revisar solicitudes'}
            </button>
          </div>

          {preview && <EligibilityPreview preview={preview} onAction={handlePreviewAction} />}

          {result?.kind === 'ok' && (
            <LayoutResultPanel
              data={result.data}
              notIncluded={result.notIncluded}
              onOpenLines={onOpenLines}
              onOpenRequest={(id) => navigate(`/solicitudes?request_id=${encodeURIComponent(id)}`)}
            />
          )}
          {result?.kind === 'error' && (
            <div className={`${s.result} ${s.warning}`}>
              <div className={s.resultHeader}>
                <div>
                  <span className={s.resultKicker}>No se pudo crear</span>
                  <strong>{result.message}</strong>
                  <p>Revisa el periodo y los datos requeridos antes de intentar nuevamente.</p>
                </div>
              </div>
            </div>
          )}

          {notice && !result && <div className={s.invalidBox}><strong>{notice}</strong></div>}
        </Modal>
      </form>

      {completionRequest && (
        <LayoutCompletionModal
          request={completionRequest}
          accounts={accounts}
          onClose={() => setCompletionRequest(null)}
          onSaved={async () => { setCompletionRequest(null); await runReview() }}
        />
      )}
      {rebatchItem && (
        <LayoutRebatchModal
          item={rebatchItem}
          onClose={() => setRebatchItem(null)}
          onSubmitted={async () => { setRebatchItem(null); await runReview() }}
        />
      )}
    </>
  )
}
