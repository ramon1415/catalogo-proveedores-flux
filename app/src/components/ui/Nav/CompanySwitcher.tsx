import { useState } from 'react'
import { useAuth } from '../../../lib/auth'
import { useCompany, companyColor } from '../../../lib/company'
import { Modal } from '../Modal'
import fluxMark from '../../../assets/favicon-512.png'
import s from './Nav.module.css'

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
  const color = companyColor(current)

  return (
    <>
      <button
        type="button"
        className={`${s.companyLauncher} ${compact ? s.companyCompact : ''}`}
        onClick={() => canSwitch && setOpen(true)}
        disabled={!canSwitch}
        title={canSwitch ? `${current} · cambiar empresa` : current}
        aria-label={canSwitch ? `Empresa activa: ${current}. Cambiar` : `Empresa: ${current}`}
        style={{ '--company-accent': color } as React.CSSProperties}
      >
        {/* La etiqueta compacta usa el tono completo para identificar la empresa. */}
        <span className={s.companyIcon} style={{ background: color }}><img className={s.companyGlyph} src={fluxMark} alt="" aria-hidden="true" /></span>
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
                  <span className={s.companyOptionIcon} style={{ background: companyColor(m.company_name) }}><img className={s.companyGlyph} src={fluxMark} alt="" aria-hidden="true" /></span>
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
