import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { CONFIG_TABS, TAB_LABELS, TAB_BADGES, canAccessConfigTab, resolveRequestedTab } from './logic'
import { MembersTab } from './tabs/MembersTab'
import { OriginAccountsTab } from './tabs/OriginAccountsTab'
import { BudgetsTab } from './tabs/BudgetsTab'
import { ContpaqTab } from './tabs/ContpaqTab'
import { SystemTab } from './tabs/SystemTab'
import type { ConfigTab } from './types'
import s from './Configuracion.module.css'

export default function ConfiguracionPage() {
  const { group, loading } = useAuth()
  const [params, setParams] = useSearchParams()

  const accessibleTabs = useMemo(() => CONFIG_TABS.filter((tab) => canAccessConfigTab(tab, group)), [group])
  const firstAllowed = accessibleTabs[0]

  const [active, setActive] = useState<ConfigTab | undefined>(undefined)
  const [permissionMsg, setPermissionMsg] = useState('')
  // La resolución inicial (espejo de openInitialTab) corre una sola vez, cuando
  // la sesión ya está lista, porque el grupo se resuelve de forma asíncrona.
  const initialized = useRef(false)

  useEffect(() => {
    if (loading || initialized.current) return
    initialized.current = true
    const requestedRaw = params.get('tab') || ''
    const requestedTab = resolveRequestedTab(requestedRaw)
    if (requestedRaw && !canAccessConfigTab(requestedTab, group)) {
      setPermissionMsg(`No tienes permiso para ver ${TAB_LABELS[requestedTab as ConfigTab] || 'esta seccion'}.`)
      if (firstAllowed) selectTab(firstAllowed)
      return
    }
    const target = canAccessConfigTab(requestedTab, group) ? (requestedTab as ConfigTab) : firstAllowed
    if (target) selectTab(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, group])

  function selectTab(tab: ConfigTab) {
    setActive(tab)
    const next = new URLSearchParams(params)
    next.set('tab', tab)
    setParams(next, { replace: true })
  }

  function openTab(tab: ConfigTab) {
    if (!canAccessConfigTab(tab, group)) {
      setPermissionMsg(`No tienes permiso para ver ${TAB_LABELS[tab] || 'esta seccion'}.`)
      return
    }
    setPermissionMsg('')
    selectTab(tab)
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Configuracion</h1>
          <p>Administra catalogos y parametros operativos.</p>
        </div>
      </div>

      {permissionMsg && (
        <div className={`${s.notice} ${s.warning}`}>
          <span className={s.noticeIcon}>⚠</span>
          <span>{permissionMsg}</span>
        </div>
      )}

      <div className={s.tabs} role="tablist">
        {accessibleTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            className={`${s.tab} ${active === tab ? s.active : ''}`}
            onClick={() => openTab(tab)}
          >
            {TAB_LABELS[tab]} <span className={s.tabBadge}>{TAB_BADGES[tab]}</span>
          </button>
        ))}
      </div>

      {!loading && !active && !permissionMsg && (
        <div className={`${s.notice} ${s.warning}`}>
          <span className={s.noticeIcon}>⚠</span>
          <span>No tienes permisos de configuracion disponibles.</span>
        </div>
      )}

      {active === 'members' && <MembersTab />}
      {active === 'originAccounts' && <OriginAccountsTab />}
      {active === 'budgets' && <BudgetsTab />}
      {active === 'contpaq' && <ContpaqTab />}
      {active === 'system' && <SystemTab />}
    </>
  )
}
