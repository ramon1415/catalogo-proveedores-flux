import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { loadTenantOnboarding, saveTenantModuleConfiguration } from './api'
import type {
  RoutingCompany,
  TenantModule,
  TenantModuleConfig,
  TenantModuleDraft,
  TenantModuleRelease,
} from './types'
import s from './Configuracion.module.css'

type Step = 1 | 2 | 3

function companyLabel(company: RoutingCompany | undefined): string {
  return company?.legal_name || company?.name || 'Empresa sin nombre'
}

export function TenantOnboardingWizard() {
  const { profile } = useAuth()
  const { showToast } = useToast()
  const [step, setStep] = useState<Step>(1)
  const [companies, setCompanies] = useState<RoutingCompany[]>([])
  const [modules, setModules] = useState<TenantModule[]>([])
  const [releases, setReleases] = useState<TenantModuleRelease[]>([])
  const [configs, setConfigs] = useState<TenantModuleConfig[]>([])
  const [companyId, setCompanyId] = useState('')
  const [drafts, setDrafts] = useState<Record<string, TenantModuleDraft>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading')
  const [error, setError] = useState('')

  async function load() {
    setStatus('loading')
    try {
      const data = await loadTenantOnboarding()
      setCompanies(data.companies)
      setModules(data.modules)
      setReleases(data.releases)
      setConfigs(data.configs)
      setStatus('ready')
      setError('')
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar el registro de módulos.')
      setStatus('error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedCompany = companies.find((company) => company.id === companyId)
  const configsForCompany = useMemo(
    () => configs.filter((config) => config.company_id === companyId),
    [configs, companyId],
  )
  const releasesByModule = useMemo(() => {
    const grouped: Record<string, TenantModuleRelease[]> = {}
    for (const release of releases) {
      if (!grouped[release.module_key]) grouped[release.module_key] = []
      grouped[release.module_key].push(release)
    }
    return grouped
  }, [releases])

  function chooseCompany(id: string) {
    setCompanyId(id)
    setStep(1)
    setConfirmed(false)
    const next: Record<string, TenantModuleDraft> = {}
    for (const module of modules) {
      const current = configs.find((config) => config.company_id === id && config.module_key === module.module_key)
      const versions = releasesByModule[module.module_key] || []
      const latest = versions.reduce((max, release) => Math.max(max, release.version), 1)
      next[module.module_key] = {
        module_key: module.module_key,
        enabled: current?.enabled ?? false,
        version: current?.version ?? latest,
        channel: current?.channel ?? 'stable',
      }
    }
    setDrafts(next)
  }

  function patchDraft(key: string, patch: Partial<TenantModuleDraft>) {
    setConfirmed(false)
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }))
  }

  const changedDrafts = useMemo(
    () => modules
      .map((module) => drafts[module.module_key])
      .filter(Boolean)
      .filter((draft) => {
        const current = configsForCompany.find((config) => config.module_key === draft.module_key)
        return !current || current.enabled !== draft.enabled || current.version !== draft.version || current.channel !== draft.channel
      }),
    [configsForCompany, drafts, modules],
  )
  const enabledCount = Object.values(drafts).filter((draft) => draft.enabled).length
  const heldKeys = new Set(configsForCompany.filter((config) => config.hold).map((config) => config.module_key))

  async function save() {
    if (!companyId || !confirmed || enabledCount === 0 || changedDrafts.length === 0) return
    setStatus('saving')
    try {
      await saveTenantModuleConfiguration(companyId, changedDrafts, profile?.id || null)
      showToast('Tenant configurado', `${companyLabel(selectedCompany)} quedó actualizado sin modificar usuarios ni roles.`, 'success')
      await load()
      setStep(1)
      setCompanyId('')
      setDrafts({})
      setConfirmed(false)
    } catch (err: any) {
      setStatus('ready')
      showToast('No se pudo configurar el tenant', err?.message || 'La operación fue bloqueada.', 'error')
    }
  }

  return (
    <section className={s.tableCard} aria-labelledby="tenant-onboarding-title">
      <div className={s.panelToolbar}>
        <div>
          <h2 id="tenant-onboarding-title">Onboarding de módulos por empresa</h2>
          <p>Configura el menú y las rutas de una empresa existente. Sólo SysAdmin.</p>
        </div>
        <div className={s.wizardSteps} aria-label={`Paso ${step} de 3`}>
          {[1, 2, 3].map((value) => <span key={value} className={step === value ? s.currentStep : ''}>{value}</span>)}
        </div>
      </div>

      {status === 'loading' && <div className={s.wizardState}>Cargando registro de módulos…</div>}
      {status === 'error' && (
        <div className={s.wizardState}>
          <span className={s.tableErr}>{error}</span>
          <button type="button" className={s.secondaryBtn} onClick={load}>Reintentar</button>
        </div>
      )}

      {(status === 'ready' || status === 'saving') && step === 1 && (
        <div className={s.wizardBody}>
          <div className={s.sectionNote}>
            <strong>1. Selecciona una empresa activa</strong>
            <p>El wizard no crea empresas, usuarios, roles ni membresías.</p>
          </div>
          <label className={s.wizardField}>
            Empresa
            <select value={companyId} onChange={(event) => chooseCompany(event.target.value)}>
              <option value="">Seleccionar empresa…</option>
              {companies.map((company) => <option key={company.id} value={company.id}>{companyLabel(company)}</option>)}
            </select>
          </label>
          <div className={s.wizardActions}>
            <button type="button" className={s.primaryBtn} disabled={!companyId} onClick={() => setStep(2)}>Continuar</button>
          </div>
        </div>
      )}

      {(status === 'ready' || status === 'saving') && step === 2 && (
        <div className={s.wizardBody}>
          <div className={s.sectionNote}>
            <strong>2. Elige módulos y versiones para {companyLabel(selectedCompany)}</strong>
            <p>Todo módulo nuevo parte apagado. Nómina nunca se habilita automáticamente.</p>
          </div>
          <div className={s.moduleGrid}>
            {modules.map((module) => {
              const draft = drafts[module.module_key]
              const versions = releasesByModule[module.module_key] || []
              const current = configsForCompany.find((config) => config.module_key === module.module_key)
              const held = heldKeys.has(module.module_key)
              if (!draft) return null
              return (
                <article key={module.module_key} className={s.moduleCard}>
                  <label className={s.moduleToggle}>
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      disabled={held}
                      onChange={(event) => patchDraft(module.module_key, { enabled: event.target.checked })}
                    />
                    <span>
                      <strong>{module.name}</strong>
                      <small>{module.kind === 'tenant_variant' ? 'Variante por empresa' : 'Compartido'}</small>
                    </span>
                    <Badge variant={draft.enabled ? 'success' : 'neutral'}>{draft.enabled ? 'Activo' : 'Apagado'}</Badge>
                  </label>
                  <div className={s.moduleControls}>
                    <label>
                      Versión
                      <select
                        value={draft.version}
                        disabled={held || versions.length === 0}
                        onChange={(event) => patchDraft(module.module_key, { version: Number(event.target.value) })}
                      >
                        {versions.map((release) => <option key={release.version} value={release.version}>v{release.version}</option>)}
                      </select>
                    </label>
                    <label>
                      Canal
                      <select
                        value={draft.channel}
                        disabled={held}
                        onChange={(event) => patchDraft(module.module_key, { channel: event.target.value as 'stable' | 'canary' })}
                      >
                        <option value="stable">Stable</option>
                        <option value="canary">Canary</option>
                      </select>
                    </label>
                  </div>
                  {held && <p className={s.holdNote}>En hold: {current?.hold_reason || 'cambio bloqueado'}</p>}
                </article>
              )
            })}
          </div>
          {enabledCount === 0 && <div className={`${s.notice} ${s.warning}`}>Debe quedar al menos un módulo habilitado.</div>}
          <div className={s.wizardActions}>
            <button type="button" className={s.secondaryBtn} onClick={() => setStep(1)}>Atrás</button>
            <button type="button" className={s.primaryBtn} disabled={enabledCount === 0} onClick={() => setStep(3)}>Revisar cambios</button>
          </div>
        </div>
      )}

      {(status === 'ready' || status === 'saving') && step === 3 && (
        <div className={s.wizardBody}>
          <div className={s.sectionNote}>
            <strong>3. Confirma la configuración</strong>
            <p>Empresa: {companyLabel(selectedCompany)} · {enabledCount} módulos activos · {changedDrafts.length} cambios.</p>
          </div>
          {changedDrafts.length === 0 ? (
            <div className={`${s.notice} ${s.info}`}>La empresa ya tiene esta configuración; no hay cambios por guardar.</div>
          ) : (
            <div className={s.reviewList}>
              {changedDrafts.map((draft) => {
                const module = modules.find((item) => item.module_key === draft.module_key)
                return (
                  <div key={draft.module_key} className={s.reviewRow}>
                    <strong>{module?.name || draft.module_key}</strong>
                    <span>{draft.enabled ? 'Habilitado' : 'Deshabilitado'} · v{draft.version} · {draft.channel}</span>
                  </div>
                )
              })}
            </div>
          )}
          <label className={s.confirmRow}>
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            Confirmo que esta configuración corresponde únicamente a {companyLabel(selectedCompany)}.
          </label>
          <div className={s.wizardActions}>
            <button type="button" className={s.secondaryBtn} disabled={status === 'saving'} onClick={() => setStep(2)}>Atrás</button>
            <button
              type="button"
              className={s.primaryBtn}
              disabled={!confirmed || changedDrafts.length === 0 || status === 'saving'}
              onClick={save}
            >
              {status === 'saving' ? 'Guardando…' : 'Aplicar configuración'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
