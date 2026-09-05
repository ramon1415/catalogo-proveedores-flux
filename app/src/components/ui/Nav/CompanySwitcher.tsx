import { useState } from 'react'
import { useAuth } from '../../../lib/auth'
import { useCompany } from '../../../lib/company'
import { Modal } from '../Modal'
import s from './Nav.module.css'

// Ícono de empresa (edificio) — inline para no depender del set global.
function IcBuilding() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M6 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16M14 21V9h3a1 1 0 0 1 1 1v11" />
      <path d="M9 8h2M9 12h2M9 16h2" />
    </svg>
  )
}
function IcSwap() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4 4 7l3 3M4 7h11M17 20l3-3-3-3M20 17H9" />
    </svg>
  )
}
function IcCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5 9-10" />
    </svg>
  )
}

// Launcher de empresa activa (junto al logo). Muestra la empresa actual; si hay
// más de una, abre un modal para cambiarla. Se apoya en profile_company_memberships
// (via useAuth) + useCompany (activa/persistida).
export function CompanySwitcher({ compact = false }: { compact?: boolean }) {
  const { memberships } = useAuth()
  const { companyId, companyName, setCompany } = useCompany()
  const [open, setOpen] = useState(false)

  if (memberships.length === 0) return null

  const current = companyName ?? memberships[0]?.company_name ?? 'Empresa'
  const canSwitch = memberships.length > 1

  return (
    <>
      <button
        type="button"
        className={`${s.companyLauncher} ${compact ? s.companyCompact : ''}`}
        onClick={() => canSwitch && setOpen(true)}
        disabled={!canSwitch}
        title={canSwitch ? `${current} · cambiar empresa` : current}
        aria-label={canSwitch ? `Empresa activa: ${current}. Cambiar` : `Empresa: ${current}`}
      >
        <span className={s.companyIcon}><IcBuilding /></span>
        <span className={`${s.companyName} ${s.txt}`}>{current}</span>
        {canSwitch && <span className={`${s.companyCaret} ${s.txt}`}><IcSwap /></span>}
      </button>

      {open && (
        <Modal title="Cambiar empresa" subtitle="Elige la empresa activa" onClose={() => setOpen(false)}>
          <div className={s.companyList}>
            {memberships.map((m) => {
              const active = m.company_id === companyId
              return (
                <button
                  key={m.company_id}
                  type="button"
                  className={`${s.companyOption} ${active ? s.companyOptionActive : ''}`}
                  onClick={() => { setCompany(m.company_id); setOpen(false) }}
                >
                  <span className={s.companyOptionIcon}><IcBuilding /></span>
                  <span className={s.companyOptionName}>{m.company_name}</span>
                  {active && <span className={s.companyOptionCheck}><IcCheck /></span>}
                </button>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}
