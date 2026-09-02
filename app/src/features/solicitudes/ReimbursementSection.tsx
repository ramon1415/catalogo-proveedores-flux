// Modo reembolso del formulario de solicitud. Sustituye al combo de proveedor
// (el dinero va al EMPLEADO, no al catálogo) y al monto/partida únicos (los
// comprobantes vienen de comercios distintos y de partidas distintas).
import { useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { loadEmployeeBankAccount, upsertEmployeeBankAccount } from './api'
import {
  employeeBankAccountIssues, formatCurrencyC, isValidClabe, normalizeClabe,
  reimbursementTotals, validateReceiptFile,
} from './logic'
import { parseCfdiFile } from './cfdi'
import { parseCfdiXml } from '../../lib/contpaq/cfdiBrowser'
import type {
  BudgetAvailabilityRow, EmployeeBankAccount, Profile, ReimbursementDraftItem,
} from './types'
import s from './Solicitudes.module.css'

export function emptyReimbursementItem(): ReimbursementDraftItem {
  return {
    key: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    descripcion: '',
    amount: '',
    budgetCategoryId: '',
    deducible: true,
    file: null,
    fileHint: 'XML, PDF o imagen · máx. 10 MB',
    subtotalAmount: null,
    taxAmount: null,
    invoiceUuid: null,
    cfdiData: null,
  }
}

export function ReimbursementSection({
  profiles,
  canChooseBeneficiary,
  beneficiaryId,
  onBeneficiaryChange,
  bankAccount,
  bankLoading,
  onBankLoaded,
  items,
  onItemsChange,
  categoryRows,
  categoryLabel,
  categoryDisabled,
  currency,
}: {
  profiles: Profile[]
  canChooseBeneficiary: boolean
  beneficiaryId: string
  onBeneficiaryChange: (id: string) => void
  bankAccount: EmployeeBankAccount | null
  bankLoading: boolean
  onBankLoaded: (account: EmployeeBankAccount | null) => void
  items: ReimbursementDraftItem[]
  onItemsChange: (items: ReimbursementDraftItem[]) => void
  categoryRows: BudgetAvailabilityRow[]
  categoryLabel: (categoryId: string) => string
  categoryDisabled: boolean
  currency: string
}) {
  const { showToast } = useToast()
  const beneficiary = profiles.find((p) => p.id === beneficiaryId) || null
  const issues = employeeBankAccountIssues(bankAccount)
  const [editingBank, setEditingBank] = useState(false)
  const totals = reimbursementTotals(items)

  function patchItem(key: string, patch: Partial<ReimbursementDraftItem>) {
    onItemsChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  // Adjunto por renglón: el CFDI es del comercio emisor, no del empleado, así
  // que su subtotal/IVA/UUID pertenecen al renglón y no a la solicitud.
  async function onItemFile(key: string, file: File | null) {
    if (!file) {
      patchItem(key, {
        file: null, fileHint: 'XML, PDF o imagen · máx. 10 MB',
        subtotalAmount: null, taxAmount: null, invoiceUuid: null, cfdiData: null,
      })
      return
    }
    const check = validateReceiptFile(file)
    if (!check.ok) {
      patchItem(key, { file: null, fileHint: check.message })
      return
    }
    const isXml = /\.xml$/i.test(file.name) || file.type.includes('xml')
    if (!isXml) {
      patchItem(key, {
        file, fileHint: check.message,
        subtotalAmount: null, taxAmount: null, invoiceUuid: null, cfdiData: null,
      })
      return
    }

    const breakdown = await parseCfdiFile(file)
    let invoiceUuid: string | null = null
    let cfdiData: unknown = null
    try {
      const parsed = parseCfdiXml(await file.text())
      invoiceUuid = parsed.uuid
      cfdiData = parsed
    } catch {
      // XML que no cumple el contrato fiscal: se conserva el adjunto, sin folio.
    }
    const current = items.find((item) => item.key === key)
    const amount = current && !current.amount && breakdown?.total != null
      ? String(breakdown.total)
      : current?.amount ?? ''
    patchItem(key, {
      file,
      fileHint: invoiceUuid
        ? `${check.message} · CFDI ${invoiceUuid}`
        : `${check.message}${breakdown ? ' · desglose leído del CFDI' : ''}`,
      subtotalAmount: breakdown?.subtotal ?? null,
      taxAmount: breakdown?.traslados ?? null,
      invoiceUuid,
      cfdiData,
      amount,
    })
  }

  // Alta/actualización inline de los datos bancarios del beneficiario: sin
  // ellos Finanzas no puede dispersar el reembolso.
  async function saveBank(form: EmployeeBankAccount) {
    const clabe = normalizeClabe(form.clabe || '')
    if (clabe && !isValidClabe(clabe)) {
      showToast('CLABE inválida', 'La CLABE debe contener exactamente 18 dígitos.', 'warning')
      return
    }
    try {
      await upsertEmployeeBankAccount({ ...form, clabe: clabe || null })
      const fresh = await loadEmployeeBankAccount(form.profile_id)
      onBankLoaded(fresh ?? { ...form, clabe: clabe || null })
      setEditingBank(false)
      showToast('Datos bancarios guardados', 'Los datos del beneficiario quedaron registrados.', 'success')
    } catch (error: any) {
      showToast('No se pudieron guardar', error?.message || 'Intenta de nuevo.', 'error')
    }
  }

  return (
    <>
      <section className={s.formSection}>
        <h3>¿A quién se le reembolsa?</h3>
        <div className={`${s.fieldHint} ${s.fullRow}`}>
          En un reembolso el dinero va a la persona que pagó de su bolsa, no al comercio.
          Los comprobantes del desglose son de los comercios emisores.
        </div>
        <div className={s.formGrid}>
          <label className={s.fullRow}>Beneficiario *
            <select
              className={s.formControl}
              value={beneficiaryId}
              onChange={(e) => onBeneficiaryChange(e.target.value)}
              disabled={!canChooseBeneficiary}
              required
            >
              <option value="">Seleccionar beneficiario</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name || p.email || 'Sin nombre'}</option>
              ))}
            </select>
            <span className={s.fieldHint}>
              {canChooseBeneficiary
                ? 'Finanzas puede capturar el reembolso a nombre de otra persona.'
                : 'El reembolso se deposita a tu propia cuenta.'}
            </span>
          </label>

          <div className={s.fullRow}>
            {bankLoading ? (
              <div className={s.contextCard}><strong>Consultando datos bancarios…</strong></div>
            ) : issues.length ? (
              <div className={`${s.contextCard} ${s.contextError}`}>
                <strong>Sin datos bancarios completos — captúralos para poder dispersar</strong>
                <span>Falta: {issues.join(', ')}.</span>
              </div>
            ) : (
              <div className={`${s.contextCard} ${s.contextSuccess}`}>
                <strong>{bankAccount?.beneficiary_name}</strong>
                <span>
                  {bankAccount?.banco} · {bankAccount?.clabe ? `CLABE ${bankAccount.clabe}` : `Cuenta ${bankAccount?.cuenta}`}
                </span>
              </div>
            )}
          </div>

          {beneficiaryId && !bankLoading && (issues.length || editingBank) ? (
            <BankForm
              account={bankAccount}
              profileId={beneficiaryId}
              defaultName={beneficiary?.full_name || ''}
              onSave={saveBank}
              onCancel={issues.length ? null : () => setEditingBank(false)}
            />
          ) : beneficiaryId && !bankLoading ? (
            <div className={s.fullRow}>
              <button type="button" className={s.secondaryBtn} onClick={() => setEditingBank(true)}>
                Editar datos bancarios
              </button>
            </div>
          ) : null}
        </div>
      </section>

      <section className={s.formSection}>
        <h3>Desglose de gastos</h3>
        <div className={`${s.fieldHint} ${s.fullRow}`}>
          Un renglón por gasto. La partida es obligatoria en todos: es la que atribuye el
          gasto a su área, tenga comprobante fiscal o no. Marcar “sin comprobante fiscal”
          (propinas, notas) solo lo saca del IVA acreditable; sigue siendo gasto de esa partida.
        </div>

        <div className={s.itemsTable}>
          <div className={s.itemsHead}>
            <span>Descripción</span>
            <span>Monto</span>
            <span>Partida presupuestal *</span>
            <span>Sin comprobante</span>
            <span>Comprobante</span>
            <span />
          </div>
          {items.map((item, index) => (
            <div key={item.key} className={s.itemsRow}>
              <input
                className={s.formControl}
                type="text"
                placeholder={`Gasto ${index + 1}`}
                value={item.descripcion}
                onChange={(e) => patchItem(item.key, { descripcion: e.target.value })}
              />
              <input
                className={s.formControl}
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={item.amount}
                onChange={(e) => patchItem(item.key, { amount: e.target.value })}
              />
              <select
                className={s.formControl}
                value={item.budgetCategoryId}
                disabled={categoryDisabled}
                onChange={(e) => patchItem(item.key, { budgetCategoryId: e.target.value })}
              >
                <option value="">{categoryDisabled ? 'Selecciona empresa, CC y mes' : 'Seleccionar partida'}</option>
                {categoryRows.map((row) => (
                  <option key={row.budget_category_id} value={row.budget_category_id!}>
                    {categoryLabel(row.budget_category_id!)}
                  </option>
                ))}
              </select>
              {/* Desmarcar solo quita la exigencia de comprobante: el gasto
                  sigue cargando a su partida (atribución al área). */}
              <label className={s.checkboxCard}>
                <input
                  type="checkbox"
                  checked={!item.deducible}
                  onChange={(e) => patchItem(item.key, { deducible: !e.target.checked })}
                />
                Sin comprobante fiscal (no deducible)
              </label>
              <div className={s.itemsFile}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,text/xml,application/xml"
                  onChange={(e) => onItemFile(item.key, e.target.files?.[0] ?? null)}
                />
                <span className={s.fileHint}>
                  {item.deducible ? item.fileHint : 'Sin comprobante fiscal: el adjunto es opcional.'}
                </span>
              </div>
              <button
                type="button"
                className={s.iconBtn}
                aria-label={`Quitar gasto ${index + 1}`}
                onClick={() => onItemsChange(items.filter((row) => row.key !== item.key))}
              >✕</button>
            </div>
          ))}
        </div>

        <div className={s.itemsFooter}>
          <button
            type="button"
            className={s.secondaryBtn}
            onClick={() => onItemsChange([...items, emptyReimbursementItem()])}
          >+ Agregar gasto</button>
          <div className={s.itemsTotals}>
            <span>Total del reembolso</span>
            <strong>{formatCurrencyC(totals.total, currency)}</strong>
            {totals.subtotal != null && (
              <small>
                Desglose fiscal: subtotal {formatCurrencyC(totals.subtotal, currency)} · IVA acreditable {formatCurrencyC(totals.tax ?? 0, currency)}
              </small>
            )}
          </div>
        </div>
        <div className={s.fieldHint}>
          El monto y la partida de la solicitud se calculan del desglose: el total es la suma
          de los renglones y la partida es la del renglón de mayor monto (así el gate
          presupuestal sigue validando). El detalle real va renglón por renglón.
        </div>
      </section>
    </>
  )
}

// Captura inline de la cuenta del empleado. Estado local: no tiene por qué
// vivir en el formulario grande.
function BankForm({
  account,
  profileId,
  defaultName,
  onSave,
  onCancel,
}: {
  account: EmployeeBankAccount | null
  profileId: string
  defaultName: string
  onSave: (account: EmployeeBankAccount) => void | Promise<void>
  onCancel: (() => void) | null
}) {
  const [banco, setBanco] = useState(account?.banco || '')
  const [clabe, setClabe] = useState(account?.clabe || '')
  const [cuenta, setCuenta] = useState(account?.cuenta || '')
  const [name, setName] = useState(account?.beneficiary_name || defaultName)
  const [saving, setSaving] = useState(false)

  const clabeInvalid = clabe.trim() !== '' && !isValidClabe(clabe)

  async function submit() {
    setSaving(true)
    try {
      await onSave({
        profile_id: profileId,
        banco: banco.trim() || null,
        clabe: clabe.trim() || null,
        cuenta: cuenta.trim() || null,
        beneficiary_name: name.trim() || null,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${s.fullRow} ${s.bankForm}`}>
      <div className={s.formGrid}>
        <label className={s.fullRow}>Nombre del beneficiario *
          <input className={s.formControl} type="text" maxLength={180} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>Banco *
          <input className={s.formControl} type="text" maxLength={100} value={banco} onChange={(e) => setBanco(e.target.value)} />
        </label>
        <label>CLABE
          <input className={s.formControl} type="text" inputMode="numeric" maxLength={24} value={clabe} onChange={(e) => setClabe(e.target.value)} />
          <span className={`${s.fieldHint} ${clabeInvalid ? s.error : ''}`}>
            {clabeInvalid ? 'La CLABE debe contener exactamente 18 dígitos.' : '18 dígitos. Si no la tienes, captura la cuenta.'}
          </span>
        </label>
        <label>Cuenta bancaria
          <input className={s.formControl} type="text" inputMode="numeric" maxLength={24} value={cuenta} onChange={(e) => setCuenta(e.target.value)} />
        </label>
        <div className={`${s.fullRow} ${s.bankFormActions}`}>
          {onCancel && <button type="button" className={s.secondaryBtn} onClick={onCancel}>Cancelar</button>}
          <button type="button" className={s.primaryBtn} disabled={saving || clabeInvalid} onClick={submit}>
            {saving ? 'Guardando…' : 'Guardar datos bancarios'}
          </button>
        </div>
      </div>
    </div>
  )
}
