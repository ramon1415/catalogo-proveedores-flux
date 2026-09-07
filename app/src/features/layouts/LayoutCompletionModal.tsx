import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import {
  cleanText, friendlyRpcError, formatMissingFields, formatPreviewMoney, layoutAccountLabel,
  providerExecutionLayoutFields,
} from './logic'
import {
  completeProviderPaymentExecutionData, completePaymentRequestLayoutData,
  loadReimbursementBeneficiary,
} from './api'
import type { PreviewRow, CompanyBankAccount } from './types'
import s from './Layouts.module.css'

export function LayoutCompletionModal({
  request,
  accounts,
  onClose,
  onSaved,
}: {
  request: PreviewRow
  accounts: CompanyBankAccount[]
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { showToast } = useToast()
  const missing = Array.isArray(request.missing_fields) ? request.missing_fields : []

  // Cuentas origen elegibles para la empresa de la solicitud.
  const eligibleAccounts = useMemo(
    () => accounts.filter((account) => (
      account.company_id === request.company_id &&
      account.active &&
      /^[0-9]{1,18}$/.test(cleanText(account.account_number).replace(/[\s-]/g, ''))
    )),
    [accounts, request.company_id],
  )

  const providerMissing = useMemo(() => missing.filter((field) => providerExecutionLayoutFields().includes(field)), [missing])

  // Reembolso: los datos bancarios que faltan son los del EMPLEADO, no los de
  // un proveedor. Escribirlos con complete_provider_payment_execution_data
  // volcaría la CLABE de una persona sobre un registro del catálogo de
  // proveedores, así que en ese caso ese RPC no se llama.
  const [reimbursement, setReimbursement] = useState<Awaited<ReturnType<typeof loadReimbursementBeneficiary>>>(null)
  const isReimbursement = reimbursement?.isReimbursement === true
  const showProviderFields = providerMissing.length > 0 && !isReimbursement

  const [bankAccount, setBankAccount] = useState(
    eligibleAccounts.some((a) => a.id === request.company_bank_account_id) ? (request.company_bank_account_id as string) : '',
  )
  const [reference, setReference] = useState(request.payment_reference || '')
  const [concept, setConcept] = useState(request.payment_concept || '')
  const [date, setDate] = useState(request.scheduled_payment_date || '')
  const [destinationType, setDestinationType] = useState(request.destination_type || '')
  const [providerBank, setProviderBank] = useState('')
  const [beneficiary, setBeneficiary] = useState(request.beneficiary_name || '')
  const [clabe, setClabe] = useState(request.destination_type === 'clabe' ? request.destination_value || '' : '')
  const [providerAccount, setProviderAccount] = useState(request.destination_type === 'cuenta' ? request.destination_value || '' : '')
  const [convenio, setConvenio] = useState(
    request.destination_type === 'convenio' ? String(request.destination_value || '').replace(/^CONVENIO\s+/i, '') : '',
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const refs = {
    bankAccount: useRef<HTMLSelectElement>(null),
    reference: useRef<HTMLInputElement>(null),
    concept: useRef<HTMLInputElement>(null),
    date: useRef<HTMLInputElement>(null),
    destinationType: useRef<HTMLSelectElement>(null),
    beneficiary: useRef<HTMLInputElement>(null),
    clabe: useRef<HTMLInputElement>(null),
    providerAccount: useRef<HTMLInputElement>(null),
    convenio: useRef<HTMLInputElement>(null),
    providerBank: useRef<HTMLInputElement>(null),
  }

  useEffect(() => {
    let cancelled = false
    loadReimbursementBeneficiary(request.payment_request_id)
      .then((data) => { if (!cancelled) setReimbursement(data) })
      .catch(() => { /* best-effort: sin dato se comporta como pago a proveedor */ })
    return () => { cancelled = true }
  }, [request.payment_request_id])

  const impact = request.direction_approval_current
    ? 'Estos son datos operativos de ejecución. Al guardarlos se conserva la autorización vigente de Dirección.'
    : 'Al guardar, los datos operativos se reevaluarán sin alterar el contenido económico aprobado.'

  function fieldError(ref: React.RefObject<HTMLElement | null>, message: string) {
    setError(message)
    ref.current?.focus()
    showToast('Revisa los datos', message, 'warning')
  }

  function focusFromRpcError(err: any) {
    const raw = String(err?.message || err || '').toLowerCase()
    const table: [string[], React.RefObject<HTMLElement | null>][] = [
      [['company_bank_account', 'source_account'], refs.bankAccount],
      [['payment_reference', 'reference'], refs.reference],
      [['payment_concept', 'concept'], refs.concept],
      [['scheduled_payment_date', 'payment_date'], refs.date],
      [['destination_type'], refs.destinationType],
      [['beneficiary'], refs.beneficiary],
      [['clabe'], refs.clabe],
      [['cuenta_bancaria', 'bank_account'], refs.providerAccount],
      [['convenio'], refs.convenio],
      [['banco', 'bank'], refs.providerBank],
    ]
    const found = table.find(([keys]) => keys.some((key) => raw.includes(key)))
    found?.[1].current?.focus()
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const referenceValue = cleanText(reference)
    if (referenceValue && !/^\d{1,5}$/.test(referenceValue)) {
      return fieldError(refs.reference, 'La referencia debe contener de 1 a 5 dígitos.')
    }
    if (showProviderFields) {
      const dType = cleanText(destinationType)
      const clabeValue = cleanText(clabe).replace(/[\s-]/g, '')
      const accountValue = cleanText(providerAccount).replace(/[\s-]/g, '')
      const agreement = cleanText(convenio)
      if (!['clabe', 'cuenta', 'convenio'].includes(dType)) {
        return fieldError(refs.destinationType, 'Selecciona CLABE, cuenta bancaria o convenio.')
      }
      if (dType === 'clabe' && !/^[0-9]{18}$/.test(clabeValue)) {
        return fieldError(refs.clabe, 'La CLABE debe contener exactamente 18 dígitos.')
      }
      if (dType === 'cuenta' && !/^[0-9]{1,18}$/.test(accountValue)) {
        return fieldError(refs.providerAccount, 'La cuenta bancaria debe contener de 1 a 18 dígitos.')
      }
      if (dType === 'convenio' && (!agreement || agreement.length > 30)) {
        return fieldError(refs.convenio, 'El convenio es obligatorio y admite hasta 30 caracteres.')
      }
    }

    setSaving(true)
    try {
      if (showProviderFields) {
        await completeProviderPaymentExecutionData({
          p_proveedor_id: request.proveedor_id ?? null,
          p_destination_type: cleanText(destinationType) || null,
          p_clabe: cleanText(clabe) || null,
          p_cuenta_bancaria: cleanText(providerAccount) || null,
          p_convenio_number: cleanText(convenio) || null,
          p_beneficiary_name: cleanText(beneficiary) || null,
          p_banco: cleanText(providerBank) || null,
        })
      }
      const data = await completePaymentRequestLayoutData({
        p_payment_request_id: request.payment_request_id,
        p_company_bank_account_id: bankAccount || null,
        p_payment_reference: referenceValue || null,
        p_payment_concept: cleanText(concept) || null,
        p_scheduled_payment_date: date || null,
      })
      const requiresDirection = Boolean(data?.direction_reapproval_required)
      const approvalPreserved = data?.approval_preserved === true
      const remainingMissing = Array.isArray(data?.missing_fields) ? data.missing_fields : []

      await onSaved()
      showToast(
        approvalPreserved && !requiresDirection && !remainingMissing.length
          ? 'Datos de ejecución completados'
          : 'Datos guardados',
        requiresDirection
          ? 'La solicitud ya presenta un cambio crítico y requiere nueva autorización de Dirección.'
          : approvalPreserved && !remainingMissing.length
            ? 'Datos de ejecución completados. La autorización de Dirección se conserva.'
            : approvalPreserved
              ? `La autorización de Dirección se conserva. Aún faltan: ${formatMissingFields(remainingMissing)}.`
              : 'Los datos operativos se guardaron y la solicitud fue reevaluada.',
        requiresDirection ? 'warning' : 'success',
      )
    } catch (err) {
      const message = friendlyRpcError(err)
      setError(message)
      focusFromRpcError(err)
      showToast('No se pudieron guardar los datos', message, 'error')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Modal
        title={`Completar ${request.request_number || 'solicitud'}`}
        subtitle="Corrige lo necesario sin salir de la generacion del layout."
        onClose={onClose}
        actions={
          <>
            <button type="button" className={s.secondaryBtn} onClick={onClose} disabled={saving}>Cancelar</button>
            <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Guardando...' : 'Guardar y reevaluar'}</button>
          </>
        }
      >
        <div className={s.formGrid}>
          <div className={`${s.fullRow} ${s.completionSummary}`}>
            <strong>{request.provider_name || 'Sin proveedor'}</strong>
            <span>{formatPreviewMoney(request.amount, request.currency ?? undefined)}</span>
            <small>Pendiente: {formatMissingFields(missing)}</small>
          </div>

          <label className={s.fullRow}>Cuenta origen
            <select ref={refs.bankAccount} value={bankAccount} onChange={(e) => setBankAccount(e.target.value)}>
              <option value="">{eligibleAccounts.length ? 'Selecciona cuenta origen' : 'No hay cuentas origen activas con numero'}</option>
              {eligibleAccounts.map((account) => <option key={account.id} value={account.id}>{layoutAccountLabel(account)}</option>)}
            </select>
          </label>

          <label>Referencia de pago
            <input ref={refs.reference} type="text" inputMode="numeric" pattern="[0-9]{1,5}" maxLength={5} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ej. 7, 42 o 40002" />
            <span className={s.fieldHint}>De 1 a 5 digitos.</span>
          </label>

          <label>Fecha programada
            <input ref={refs.date} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className={s.fullRow}>Concepto de pago
            <input ref={refs.concept} type="text" maxLength={120} value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Concepto que aparecera en el layout" />
          </label>

          {isReimbursement && (
            <fieldset className={`${s.fullRow} ${s.providerFields}`}>
              <legend>Reembolso a empleado</legend>
              <div className={s.fieldHint}>
                {reimbursement?.beneficiaryProfileId ? (
                  reimbursement.clabe || reimbursement.cuenta ? (
                    <>
                      Destino real del pago: <strong>{reimbursement.beneficiaryName || 'Beneficiario sin nombre'}</strong>
                      {' · '}{reimbursement.banco || 'Sin banco'}
                      {' · '}{reimbursement.clabe ? `CLABE ${reimbursement.clabe}` : `Cuenta ${reimbursement.cuenta}`}.
                      {' '}Estos datos están registrados en la cuenta del empleado; no se capturan aquí para no
                      escribirlos sobre un proveedor del catálogo.
                      {providerMissing.length > 0 && (
                        <>
                          {' '}<strong>El layout todavía arma la línea con los datos del proveedor</strong>, así que
                          esta solicitud no se dispersará al empleado hasta que se ajuste el lado servidor.
                        </>
                      )}
                    </>
                  ) : (
                    <>El beneficiario no tiene datos bancarios completos. Deben capturarse desde la solicitud de reembolso, no aquí.</>
                  )
                ) : (
                  <>Esta solicitud es un reembolso pero no tiene beneficiario registrado. Corrígelo en la solicitud.</>
                )}
              </div>
            </fieldset>
          )}

          {showProviderFields && (
            <fieldset className={`${s.fullRow} ${s.providerFields}`}>
              <legend>Datos bancarios del mismo proveedor</legend>
              <div className={s.formGrid}>
                <label>Tipo de destino
                  <select ref={refs.destinationType} value={destinationType} onChange={(e) => setDestinationType(e.target.value)}>
                    <option value="">Selecciona...</option>
                    <option value="clabe">CLABE</option>
                    <option value="cuenta">Cuenta bancaria</option>
                    <option value="convenio">Convenio</option>
                  </select>
                </label>
                <label>Banco
                  <input ref={refs.providerBank} type="text" maxLength={100} autoComplete="off" value={providerBank} onChange={(e) => setProviderBank(e.target.value)} />
                </label>
                <label className={s.fullRow}>Beneficiario
                  <input ref={refs.beneficiary} type="text" maxLength={180} autoComplete="off" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} />
                </label>
                <label>CLABE
                  <input ref={refs.clabe} type="text" inputMode="numeric" maxLength={24} autoComplete="off" value={clabe} onChange={(e) => setClabe(e.target.value)} />
                </label>
                <label>Cuenta bancaria
                  <input ref={refs.providerAccount} type="text" inputMode="numeric" maxLength={24} autoComplete="off" value={providerAccount} onChange={(e) => setProviderAccount(e.target.value)} />
                </label>
                <label className={s.fullRow}>Convenio
                  <input ref={refs.convenio} type="text" maxLength={30} autoComplete="off" value={convenio} onChange={(e) => setConvenio(e.target.value)} />
                </label>
              </div>
            </fieldset>
          )}

          <div className={`${s.fullRow} ${s.completionImpact}`}>{impact}</div>
          {error && <div className={`${s.fullRow} ${s.completionError}`} role="alert" aria-live="assertive">{error}</div>}
        </div>
      </Modal>
    </form>
  )
}
