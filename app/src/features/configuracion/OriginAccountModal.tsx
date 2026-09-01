import { useEffect, useRef, useState } from 'react'
import type { Company, OriginAccount, OriginAccountPayload } from './types'
import { validateOriginAccount, originRlsMessage } from './logic'
import { saveOriginAccount } from './api'
import s from './Configuracion.module.css'

type FormState = {
  company_id: string
  name: string
  bank_name: string
  account_number: string
  clabe: string
  currency: string
  account_type: string
  notes: string
  active: boolean
}

const EMPTY: FormState = {
  company_id: '',
  name: '',
  bank_name: '',
  account_number: '',
  clabe: '',
  currency: 'MXN',
  account_type: '',
  notes: '',
  active: true,
}

function nn(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

export function OriginAccountModal({
  account,
  companies,
  onClose,
  onSaved,
}: {
  account: OriginAccount | null
  companies: Company[]
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [f, setF] = useState<FormState>(EMPTY)
  const [message, setMessage] = useState('')

  const isEdit = Boolean(account)

  useEffect(() => {
    if (account) {
      setF({
        company_id: account.company_id ?? '',
        name: account.name ?? '',
        bank_name: account.bank_name ?? '',
        account_number: account.account_number ?? '',
        clabe: account.clabe ?? '',
        currency: account.currency || 'MXN',
        account_type: account.account_type ?? '',
        notes: account.notes ?? '',
        active: account.active !== false,
      })
    } else {
      setF(EMPTY)
    }
    setMessage('')
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const accountNumber = nn(f.account_number)
    const payload: OriginAccountPayload = {
      company_id: nn(f.company_id),
      name: nn(f.name),
      bank_name: nn(f.bank_name),
      account_number: accountNumber,
      clabe: nn(f.clabe),
      currency: nn(f.currency) || 'MXN',
      account_type: nn(f.account_type),
      notes: nn(f.notes),
      active: f.active,
      last4: accountNumber ? accountNumber.slice(-4) : null,
    }

    const validation = validateOriginAccount(payload)
    if (validation) {
      setMessage(validation)
      return
    }
    setMessage('')

    try {
      await saveOriginAccount(account?.id ?? null, payload)
      onSaved()
    } catch (error: any) {
      setMessage(originRlsMessage(error, error?.__op || (isEdit ? 'update' : 'insert')))
    }
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>{isEdit ? 'Editar cuenta origen' : 'Nueva cuenta origen'}</h2>
            <p>Cuenta de la empresa desde la que se realizaran pagos.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <label className={s.fullRow}>Empresa *
              <select value={f.company_id} onChange={(e) => set('company_id', e.target.value)} required>
                <option value="">Seleccionar empresa...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legal_name || c.name || 'Empresa sin nombre'}</option>
                ))}
              </select>
            </label>
            <label>Nombre de cuenta *
              <input value={f.name} onChange={(e) => set('name', e.target.value)} required placeholder="Ej. BBVA Operadora" />
            </label>
            <label>Banco *
              <input value={f.bank_name} onChange={(e) => set('bank_name', e.target.value)} required placeholder="BBVA, Santander, Banorte..." />
            </label>
            <label>Numero de cuenta *
              <input value={f.account_number} onChange={(e) => set('account_number', e.target.value)} required placeholder="Cuenta cargo" />
            </label>
            <label>CLABE
              <input value={f.clabe} onChange={(e) => set('clabe', e.target.value)} maxLength={18} placeholder="18 digitos" />
            </label>
            <label>Moneda *
              <select value={f.currency} onChange={(e) => set('currency', e.target.value)} required>
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>Tipo de cuenta
              <select value={f.account_type} onChange={(e) => set('account_type', e.target.value)}>
                <option value="">Sin clasificar</option>
                <option value="bank">Cuenta bancaria</option>
                <option value="cash">Caja / efectivo</option>
                <option value="card_processor">Procesador de tarjeta</option>
                <option value="other">Otra</option>
              </select>
            </label>
            <label className={s.checkLabel}>
              <input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Cuenta activa
            </label>
            <label className={s.fullRow}>Notas
              <textarea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Uso operativo, propiedad, restricciones..." />
            </label>
          </div>
          {message && <div className={s.formMsg}>{message}</div>}
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn}>Guardar cuenta origen</button>
        </div>
      </form>
    </dialog>
  )
}
