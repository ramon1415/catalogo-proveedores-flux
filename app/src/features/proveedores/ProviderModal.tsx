import { useEffect, useMemo, useRef, useState } from 'react'
import type { Provider, ProviderPayload, DestinationType } from './types'
import {
  requiresBankDetails,
  inferDestinationType,
  validateDestination,
  messageForSaveError,
} from './logic'
import { saveProvider, uploadProviderCsf, getCsfSignedUrl } from './api'
import { parseCsfFile } from '../../lib/csf'
import { useToast } from '../../components/ui/Toast'
import s from './Proveedores.module.css'

export type ModalMode = 'create' | 'edit' | 'readonly'

type FormState = {
  alias: string
  nombre_completo: string
  tipo_proveedor: string
  metodo_pago: string
  tipo_cuenta: string
  destination_type: DestinationType
  beneficiary_name: string
  banco: string
  clabe: string
  cuenta_bancaria: string
  convenio_number: string
  rfc: string
  persona_tipo: string
  email: string
  telefono: string
  notas: string
  es_personal_eventual: boolean
  activo: boolean
}

const EMPTY: FormState = {
  alias: '', nombre_completo: '', tipo_proveedor: '', metodo_pago: '', tipo_cuenta: '',
  destination_type: '', beneficiary_name: '', banco: '', clabe: '', cuenta_bancaria: '',
  convenio_number: '', rfc: '', persona_tipo: '', email: '', telefono: '', notas: '',
  es_personal_eventual: false, activo: true,
}

function fromProvider(p: Provider): FormState {
  return {
    alias: p.alias ?? '',
    nombre_completo: p.nombre_completo ?? '',
    tipo_proveedor: p.tipo_proveedor ?? '',
    metodo_pago: p.metodo_pago ?? '',
    tipo_cuenta: p.tipo_cuenta ?? '',
    destination_type: (p.destination_type as DestinationType) ?? '',
    beneficiary_name: p.beneficiary_name ?? '',
    banco: p.banco ?? '',
    clabe: p.clabe ?? '',
    cuenta_bancaria: p.cuenta_bancaria ?? '',
    convenio_number: p.convenio_number ?? '',
    rfc: p.rfc ?? '',
    persona_tipo: p.persona_tipo ?? '',
    email: p.email ?? '',
    telefono: p.telefono ?? '',
    notas: p.notas ?? '',
    es_personal_eventual: Boolean(p.es_personal_eventual),
    activo: Boolean(p.activo),
  }
}

// null si viene vacío, para replicar getValue() del vanilla (trim -> null).
function nn(v: string): string | null {
  const t = v.trim()
  return t === '' ? null : t
}

export function ProviderModal({
  mode,
  provider,
  canManageProviders,
  onClose,
  onSaved,
}: {
  mode: ModalMode
  provider: Provider | null
  canManageProviders: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const csfParseVersion = useRef(0)
  const { showToast } = useToast()
  const [f, setF] = useState<FormState>(EMPTY)
  const [csfFile, setCsfFile] = useState<File | null>(null)
  const [csfParseHint, setCsfParseHint] = useState('')
  const [saving, setSaving] = useState(false)

  const readonly = mode === 'readonly'
  const isEdit = mode === 'edit'
  // CSF: en el vanilla tanto crear como editar exigen canManageProviders.
  const canUploadCsf = canManageProviders
  const currentCsfPath = provider?.csf_file_path ?? null

  useEffect(() => {
    setF(provider && (isEdit || readonly) ? fromProvider(provider) : EMPTY)
    setCsfFile(null)
    const dlg = dialogRef.current
    if (dlg && !dlg.open) dlg.showModal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bankRequired = requiresBankDetails(f.metodo_pago)
  // Visibilidad idéntica a updateDestinationFieldVisibility() del vanilla.
  const show = {
    destination: true,
    banco: bankRequired && Boolean(f.destination_type),
    clabe: bankRequired && f.destination_type === 'clabe',
    cuenta: bankRequired && f.destination_type === 'cuenta',
    convenio: bankRequired && f.destination_type === 'convenio',
  }

  const title = readonly ? 'Consultar proveedor' : isEdit ? 'Editar proveedor' : 'Nuevo proveedor'

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }))
  }

  function onMetodoChange(value: string) {
    setF((prev) => {
      const next = { ...prev, metodo_pago: value }
      if (!requiresBankDetails(value)) {
        next.tipo_cuenta = ''
        next.destination_type = ''
        next.banco = ''
        next.clabe = ''
        next.cuenta_bancaria = ''
        next.convenio_number = ''
        return next
      }
      if (value === 'Transferencia bancaria' && !next.tipo_cuenta) next.tipo_cuenta = 'CLABE'
      if (value === 'Transferencia bancaria' && !next.destination_type) {
        next.destination_type = inferDestinationType(next)
      }
      return next
    })
  }

  function onDestinationChange(value: DestinationType) {
    setF((prev) => {
      const next = { ...prev, destination_type: value }
      if (value === 'clabe') next.tipo_cuenta = 'CLABE'
      if (value === 'cuenta') next.tipo_cuenta = 'Cuenta'
      if (value === 'convenio') next.tipo_cuenta = ''
      return next
    })
  }

  async function onCsfFile(file: File | null) {
    const parseVersion = ++csfParseVersion.current
    setCsfFile(file)
    setCsfParseHint('')
    if (!file || (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name))) return

    const csf = await parseCsfFile(file)
    if (parseVersion !== csfParseVersion.current) return
    if (!csf) {
      setCsfParseHint('No se pudo leer la CSF (¿es un escaneo?). Captura los datos manualmente.')
      return
    }

    setF((prev) => ({
      ...prev,
      rfc: prev.rfc || (csf.rfc ?? ''),
      nombre_completo: prev.nombre_completo || (csf.nombre ?? ''),
      persona_tipo: prev.persona_tipo || (csf.personaTipo ?? ''),
      notas:
        prev.notas ||
        [
          csf.regimen && `Régimen: ${csf.regimen}`,
          csf.codigoPostal && `CP: ${csf.codigoPostal}`,
          csf.idCif && `idCIF: ${csf.idCif}`,
        ]
          .filter(Boolean)
          .join(' · '),
    }))
    setCsfParseHint('Datos precargados desde la CSF. Verifícalos antes de guardar.')
  }

  async function onViewCsf() {
    if (!currentCsfPath) return
    try {
      const url = await getCsfSignedUrl(currentCsfPath)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      showToast('CSF no disponible', 'No se pudo generar el link temporal de la CSF.', 'error')
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readonly || saving) return

    if (csfFile && !canUploadCsf) {
      showToast('Sin permiso', 'Tu usuario no tiene permiso para cargar CSF de proveedores.', 'error')
      return
    }

    const payload: ProviderPayload = {
      alias: nn(f.alias),
      nombre_completo: nn(f.nombre_completo),
      metodo_pago: nn(f.metodo_pago),
      tipo_cuenta: nn(f.tipo_cuenta),
      destination_type: nn(f.destination_type) || inferDestinationType(f),
      beneficiary_name: nn(f.beneficiary_name),
      banco: nn(f.banco),
      clabe: nn(f.clabe),
      cuenta_bancaria: nn(f.cuenta_bancaria),
      convenio_number: nn(f.convenio_number),
      rfc: nn(f.rfc),
      persona_tipo: nn(f.persona_tipo),
      email: nn(f.email),
      telefono: nn(f.telefono),
      tipo_proveedor: nn(f.tipo_proveedor),
      notas: nn(f.notas),
      es_personal_eventual: f.es_personal_eventual,
      activo: f.activo,
      updated_at: new Date().toISOString(),
    }

    if (!payload.alias || !payload.nombre_completo || !payload.metodo_pago) {
      showToast('Datos incompletos', 'Alias, nombre completo y metodo de pago son obligatorios.', 'error')
      return
    }

    if (!requiresBankDetails(payload.metodo_pago)) {
      payload.tipo_cuenta = null
      payload.destination_type = null
      payload.banco = null
      payload.clabe = null
      payload.cuenta_bancaria = null
      payload.convenio_number = null
    }

    const destErr = validateDestination(payload)
    if (destErr) {
      showToast('Datos incompletos', destErr, 'error')
      return
    }

    if (payload.destination_type === 'clabe') payload.tipo_cuenta = 'CLABE'
    if (payload.destination_type === 'cuenta') payload.tipo_cuenta = 'Cuenta'
    if (payload.destination_type === 'convenio') payload.tipo_cuenta = null

    setSaving(true)
    try {
      const providerId = await saveProvider(provider?.id ?? null, payload)
      let csfFailed = false
      if (csfFile && providerId) {
        try {
          await uploadProviderCsf(providerId, csfFile, null)
        } catch {
          csfFailed = true
        }
      }
      if (csfFailed) {
        showToast('CSF no vinculado', 'Proveedor guardado, pero la CSF no pudo subirse.', 'warning')
      } else {
        showToast('Proveedor guardado correctamente.', '', 'success')
      }
      onSaved()
    } catch (error) {
      showToast(messageForSaveError(error), '', 'error')
    } finally {
      setSaving(false)
    }
  }

  const dis = readonly
  const csfHint = useMemo(
    () =>
      canUploadCsf
        ? 'CSF en PDF (max 10 MB)'
        : 'La Constancia de Situacion Fiscal sera administrada por Finanzas.',
    [canUploadCsf],
  )

  return (
    <dialog ref={dialogRef} className={s.dialog} onCancel={onClose} onClose={onClose}>
      <form className={s.modal} onSubmit={onSubmit}>
        <div className={s.modalHead}>
          <div>
            <h2>{title}</h2>
            <p className="muted">Completa los datos principales del proveedor.</p>
          </div>
          <button type="button" className={s.iconBtn} aria-label="Cerrar" onClick={onClose}>✕</button>
        </div>

        <div className={s.modalScroll}>
          <div className={s.formGrid}>
            <label>Alias del proveedor *
              <input value={f.alias} onChange={(e) => set('alias', e.target.value)} required disabled={dis} placeholder="ej. ACROCARPUS" />
            </label>
            <label>Nombre completo / razón social *
              <input value={f.nombre_completo} onChange={(e) => set('nombre_completo', e.target.value)} required disabled={dis} placeholder="Razón social completa" />
            </label>
            <label>Categoría del proveedor
              <input value={f.tipo_proveedor} onChange={(e) => set('tipo_proveedor', e.target.value)} disabled={dis} placeholder="Servicios, materiales, arrendamiento..." />
              <span className={s.hint}>Clasificación operativa; no corresponde al tipo de persona fiscal.</span>
            </label>
            <label>Método de pago *
              <select value={f.metodo_pago} onChange={(e) => onMetodoChange(e.target.value)} required disabled={dis}>
                <option value="">Seleccionar...</option>
                <option>Transferencia bancaria</option>
                <option>Efectivo</option>
                <option>Tarjeta en plataforma</option>
                <option>Cheque</option>
                <option>Otro</option>
              </select>
            </label>

            {show.destination && (
              <label>Tipo de destino de pago
                <select value={f.destination_type} onChange={(e) => onDestinationChange(e.target.value as DestinationType)} disabled={dis || !bankRequired}>
                  <option value="">Seleccionar...</option>
                  <option value="clabe">CLABE</option>
                  <option value="cuenta">Cuenta bancaria</option>
                  <option value="convenio">Convenio</option>
                </select>
              </label>
            )}

            <label>Beneficiario para layout
              <input value={f.beneficiary_name} onChange={(e) => set('beneficiary_name', e.target.value)} disabled={dis} placeholder="Nombre que aparece en el layout" />
            </label>

            {show.banco && (
              <label>Banco
                <input value={f.banco} onChange={(e) => set('banco', e.target.value)} disabled={dis} placeholder="BBVA, Banorte, HSBC..." />
              </label>
            )}
            {show.clabe && (
              <label>CLABE
                <input value={f.clabe} onChange={(e) => set('clabe', e.target.value)} disabled={dis} maxLength={18} placeholder="18 dígitos" />
              </label>
            )}
            {show.cuenta && (
              <label>Cuenta bancaria
                <input value={f.cuenta_bancaria} onChange={(e) => set('cuenta_bancaria', e.target.value)} disabled={dis} placeholder="Número de cuenta" />
              </label>
            )}
            {show.convenio && (
              <label>Número de convenio
                <input value={f.convenio_number} onChange={(e) => set('convenio_number', e.target.value)} disabled={dis} placeholder="Convenio de pago" />
              </label>
            )}

            <label>RFC
              <input value={f.rfc} onChange={(e) => set('rfc', e.target.value)} disabled={dis} placeholder="RFC del proveedor" />
            </label>
            <label>Tipo de persona fiscal
              <select value={f.persona_tipo} onChange={(e) => set('persona_tipo', e.target.value)} disabled={dis}>
                <option value="">No especificado</option>
                <option value="fisica">Persona física</option>
                <option value="moral">Persona moral</option>
              </select>
              <span className={s.hint}>Según la Constancia de Situación Fiscal.</span>
            </label>
            <label>Correo
              <input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} disabled={dis} placeholder="correo@dominio.com" />
            </label>
            <label>Teléfono
              <input value={f.telefono} onChange={(e) => set('telefono', e.target.value)} disabled={dis} placeholder="+52 ..." />
            </label>

            <label className={s.fullRow}>Constancia de Situación Fiscal (CSF)
              <input type="file" accept="application/pdf,image/*" disabled={dis || !canUploadCsf}
                onChange={(e) => void onCsfFile(e.target.files?.[0] ?? null)} />
              <span className={s.hint}>{csfParseHint || csfHint}</span>
              {isEdit && currentCsfPath && !readonly && (
                <button type="button" className={s.smallBtn} onClick={onViewCsf}>Ver CSF</button>
              )}
            </label>

            <label className={s.checkLabel}>
              <input type="checkbox" checked={f.es_personal_eventual} disabled={dis}
                onChange={(e) => set('es_personal_eventual', e.target.checked)} /> Es personal eventual
            </label>
            <label className={s.checkLabel}>
              <input type="checkbox" checked={f.activo} disabled={dis}
                onChange={(e) => set('activo', e.target.checked)} /> Proveedor activo
            </label>
            <label className={s.fullRow}>Notas
              <textarea rows={3} value={f.notas} onChange={(e) => set('notas', e.target.value)} disabled={dis} placeholder="Información adicional..." />
            </label>
          </div>
        </div>

        <div className={s.modalActions}>
          <button type="button" className={s.secondaryBtn} onClick={onClose}>
            {readonly ? 'Cerrar' : 'Cancelar'}
          </button>
          {!readonly && (
            <button type="submit" className={s.primaryBtn} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar proveedor'}
            </button>
          )}
        </div>
      </form>
    </dialog>
  )
}
