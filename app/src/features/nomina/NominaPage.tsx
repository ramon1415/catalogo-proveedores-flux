import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { useToast } from '../../components/ui/Toast'
import { IcPlus } from '../../components/ui/icons'
import { captureStateLabel, hasFinanceRole } from './logic'
import { getCaptureSessions, loadAccountingScope, loadSourceAccounts } from './api'
import { CaptureModal } from './CaptureModal'
import type { BankAccount, Company, CompanyCostCenter, CostCenter, CaptureSession } from './types'
import s from './Nomina.module.css'

// Rail de captura de Nómina (N2B/N3G). Portado desde payroll_capture.js +
// budget_live_frontend_guards.js. DEV-only, exclusivo de Finanzas. Flux no
// calcula nómina, no genera layout bancario, no ejecuta pagos: sólo captura,
// confirma, envía a aprobación y exporta.
export default function NominaPage() {
  const { roles } = useAuth()
  const { companyId, companyName } = useCompany()
  const { showToast } = useToast()
  const isFinance = useMemo(() => hasFinanceRole(roles), [roles])
  const companies = useMemo<Company[]>(
    () => (companyId ? [{ id: companyId, name: companyName || 'Empresa activa' }] : []),
    [companyId, companyName],
  )

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sessions, setSessions] = useState<CaptureSession[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [mappings, setMappings] = useState<CompanyCostCenter[]>([])
  const [modal, setModal] = useState<{ session: CaptureSession | null } | null>(null)

  async function reloadSessions() {
    if (!companyId) return setSessions([])
    const visible = await getCaptureSessions(null)
    setSessions(visible.filter((session) => session.company_id === companyId))
  }

  useEffect(() => {
    setModal(null)
    setSessions([])
    setAccounts([])
    setCostCenters([])
    setMappings([])
    if (!isFinance || !companyId) {
      setStatus('ready')
      return
    }
    let cancelled = false
    ;(async () => {
      setStatus('loading')
      // Carga tolerante a fallos parciales, igual que el vanilla (Promise.allSettled).
      const [accountsRes, scopeRes, sessionsRes] = await Promise.allSettled([
        loadSourceAccounts(companyId),
        loadAccountingScope(companyId),
        getCaptureSessions(null),
      ])
      if (cancelled) return
      if (accountsRes.status === 'fulfilled') setAccounts(accountsRes.value)
      if (scopeRes.status === 'fulfilled') {
        setCostCenters(scopeRes.value.costCenters)
        setMappings(scopeRes.value.mappings)
      }
      if (sessionsRes.status === 'fulfilled') {
        setSessions(sessionsRes.value.filter((session) => session.company_id === companyId))
      }
      if ([accountsRes, scopeRes, sessionsRes].some((r) => r.status === 'rejected')) {
        showToast('Nómina parcialmente disponible', 'Algunos datos de contexto no se pudieron cargar.', 'warning')
      }
      setStatus('ready')
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFinance, companyId])

  if (!isFinance) {
    return (
      <>
        <div className={s.phead}>
          <div>
            <span className={s.eyebrow}>Nómina · Finance only</span>
            <h1>Captura de nómina</h1>
          </div>
        </div>
        <div className={s.notice}>
          La captura de nómina es exclusiva de Finanzas (roles finance, finanzas, treasury, tesorería o administración).
          Solicita acceso al equipo correspondiente.
        </div>
      </>
    )
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <span className={s.devPill}>Nómina N3G</span>
          <h1>Capturas de nómina</h1>
          <p className="muted">
            Paquetes privados de {companyName || 'la empresa activa'} y su estado de validación. Flux valida el paquete físico y envía el total de
            Tesorería a aprobación; no calcula sueldos ni ejecuta pagos.
          </p>
        </div>
        <button className={s.primaryBtn} disabled={!companyId} onClick={() => setModal({ session: null })}>
          <IcPlus size={16} /> Nueva captura
        </button>
      </div>

      <section className={s.board}>
        <div className={s.boardHead}>
          <div>
            <span className={s.devPill}>Nómina N3G</span>
            <h2>Capturas de nómina</h2>
            <p>Paquetes privados de {companyName || 'la empresa activa'} y su estado de validación.</p>
          </div>
          <span className={s.privatePill}>Finance only</span>
        </div>

        <div className={s.boardList}>
          {status === 'loading' && <div className={s.boardEmpty}>Cargando capturas…</div>}
          {status === 'error' && <div className={s.boardEmpty}>Las capturas no están disponibles.</div>}
          {status === 'ready' && sessions.length === 0 && <div className={s.boardEmpty}>Aún no hay capturas de nómina.</div>}
          {status === 'ready' &&
            sessions.map((session) => {
              const materialized = session.capture_state === 'materialized'
              return (
                <article key={session.id} className={s.boardItem}>
                  <div>
                    <strong>{session.concept}</strong>
                    <span>
                      {session.period_start} → {session.period_end}
                      {session.materialized_payment_request_id ? ' · Materializada' : ''}
                    </span>
                  </div>
                  <span className={`${s.state} ${materialized ? s.stateSuccess : s.stateWarning}`}>
                    {captureStateLabel(session.capture_state)}
                  </span>
                  <button className={s.secondaryBtn} onClick={() => setModal({ session })}>
                    Abrir
                  </button>
                </article>
              )
            })}
        </div>
      </section>

      {modal && companyId && (
        <CaptureModal
          session={modal.session}
          companies={companies}
          accounts={accounts}
          costCenters={costCenters}
          mappings={mappings}
          isFinance={isFinance}
          activeCompanyId={companyId}
          onClose={() => setModal(null)}
          onSaved={reloadSessions}
        />
      )}
    </>
  )
}
