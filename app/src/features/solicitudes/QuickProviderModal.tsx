import { useRef, useEffect, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { quickCreateProvider } from './api'
import { normalizePaymentMethod, friendlyError } from './logic'
import type { Proveedor } from './types'
import s from './Solicitudes.module.css'

// Alta mínima de proveedor sin salir de la solicitud (fase2 quick provider).
export function QuickProviderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (p: Proveedor) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const [f, setF] = useState({
    alias: '', nombre: '', metodo: 'Transferencia bancaria', destino: 'clabe',
    beneficiario: '', banco: '', clabe: '', cuenta: '', convenio: '',
  })

  useEffect(() => {
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
  }, [])

  function set<K extends keyof typeof f>(key: K, value: string) {
    setF((prev) => ({ ...prev, [key]: value }))
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    if (!f.alias.trim() || !f.nombre.trim() || !f.metodo) {
      showToast('Revisa el proveedor', 'Alias, nombre y metodo preferido son obligatorios.', 'warning')
      return
    }
    const bankRequired = normalizePaymentMethod(f.metodo) === 'transfer'
    const payload = {
      alias: f.alias.trim(),
      nombre_completo: f.nombre.trim(),
      metodo_pago: f.metodo,
      destination_type: bankRequired ? f.destino : null,
      beneficiary_name: f.beneficiario.trim() || f.nombre.trim(),
      banco: bankRequired ? f.banco.trim() || null : null,
      clabe: bankRequired && f.destino === 'clabe' ? f.clabe.trim() || null : null,
      cuenta_bancaria: bankRequired && f.destino === 'cuenta' ? f.cuenta.trim() || null : null,
      convenio_number: bankRequired && f.destino === 'convenio' ? f.convenio.trim() || null : null,
      tipo_cuenta: f.destino === 'cuenta' ? 'Cuenta' : f.destino === 'clabe' ? 'CLABE' : null,
      activo: true,
    }
    setSaving(true)
    try {
      const created = await quickCreateProvider(payload)
      showToast('Proveedor creado', 'Se precargo el metodo preferido en la solicitud.', 'success')
      onCreated(created)
    } catch (error) {
      showToast('No se pudo crear proveedor', friendlyError(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={dialogRef} className={`${s.dialog} ${s.narrow}`} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>Proveedor rapido</h2>
            <p>Alta minima para continuar la solicitud sin salir de la pantalla.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>
        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <label>Alias *
              <input className={s.formControl} value={f.alias} onChange={(e) => set('alias', e.target.value)} required />
            </label>
            <label>Nombre completo / razon social *
              <input className={s.formControl} value={f.nombre} onChange={(e) => set('nombre', e.target.value)} required />
            </label>
            <label>Metodo preferido *
              <select className={s.formControl} value={f.metodo} onChange={(e) => set('metodo', e.target.value)} required>
                <option value="Transferencia bancaria">Transferencia bancaria</option>
                <option value="Efectivo">Efectivo</option>
                <option value="Cheque">Cheque</option>
                <option value="Otro">Otro</option>
              </select>
            </label>
            <label>Destino
              <select className={s.formControl} value={f.destino} onChange={(e) => set('destino', e.target.value)}>
                <option value="clabe">CLABE</option>
                <option value="cuenta">Cuenta bancaria</option>
                <option value="convenio">Convenio</option>
              </select>
            </label>
            <label>Beneficiario para layout
              <input className={s.formControl} value={f.beneficiario} onChange={(e) => set('beneficiario', e.target.value)} />
            </label>
            <label>Banco
              <input className={s.formControl} value={f.banco} onChange={(e) => set('banco', e.target.value)} />
            </label>
            <label>CLABE
              <input className={s.formControl} value={f.clabe} onChange={(e) => set('clabe', e.target.value)} maxLength={18} />
            </label>
            <label>Cuenta bancaria
              <input className={s.formControl} value={f.cuenta} onChange={(e) => set('cuenta', e.target.value)} />
            </label>
            <label>Convenio
              <input className={s.formControl} value={f.convenio} onChange={(e) => set('convenio', e.target.value)} />
            </label>
          </div>
        </div>
        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>Cancelar</button>
          <button type="submit" className={s.primaryBtn} disabled={saving}>{saving ? 'Creando...' : 'Crear proveedor'}</button>
        </div>
      </form>
    </dialog>
  )
}
