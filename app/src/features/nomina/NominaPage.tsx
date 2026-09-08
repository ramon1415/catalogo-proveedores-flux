import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useCompany } from '../../lib/company'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../components/ui/Toast'
import { IcPlus } from '../../components/ui/icons'
import { captureStateLabel, channelLabel, formatMoney, friendlyError, hasFinanceRole } from './logic'
import {
  confirmPayrollFinanceReview,
  getCaptureSessions,
  getSubmissionSummary,
  loadAccountingScope,
  loadSourceAccounts,
} from './api'
import { CaptureModal } from './CaptureModal'
import type { BankAccount, Company, CompanyCostCenter, CostCenter, CaptureSession, SubmissionSummary } from './types'
import s from './Nomina.module.css'

// Rail de captura de Nómina. DEV-only en esta etapa. Flux no calcula nómina,
// no genera layouts bancarios y no ejecuta pagos. La corrida se valida,
// Finanzas confirma los montos y después continúa por su flujo propio de pago.
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
  const [amountConfirmation, setAmountConfirmation] = useState<SubmissionSummary | null>(null)
  const [confirmationBusy, setConfirmationBusy] = useState(false)

  async function openAmountConfirmation(session: CaptureSession): Promise<void> {
    if (!session.materialized_payment_request_id || !session.finance_confirmation_pending) return
    try {
      const summary = await getSubmissionSummary(session.materialized_payment_request_id)
      if (summary.finance_confirmation_pending ?? summary.status === 'draft') setAmountConfirmation(summary)
    } catch (error) {
      showToast('No se pudo abrir la confirmación', friendlyError(error), 'warning')
    }
  }

  async function reloadSessions(showNewestPending = false) {
    if (!companyId) {
      setSessions([])
      return
    }
    const visible = (await getCaptureSessions(null)).filter((session) => session.company_id === companyId)
    setSessions(visible)
    if (showNewestPending) {
      const pending = visible.find(
        (session) => session.finance_confirmation_pending && Boolean(session.materialized_payment_request_id),
      )
      if (pending) await openAmountConfirmation(pending)
    }
  }

  async function confirmAmounts(): Promise<void> {
    if (!amountConfirmation || confirmationBusy) return
    setConfirmationBusy(true)
    try {
      await confirmPayrollFinanceReview(amountConfirmation.payment_request_id)
      setAmountConfirmation(null)
      await reloadSessions(false)
      showToast(
        'Montos confirmados',
        'La corrida quedó lista para el flujo propio de pago de Nómina. No entra al corte semanal y Flux no ejecutó ningún pago.',
        'success',
      )
    } catch (error) {
      showToast('No se pudo confirmar la corrida', friendlyError(error), 'error')
    } finally {
      setConfirmationBusy(false)
    }
  }

  useEffect(() => {
    setModal(null)
    setAmountConfirmation(null)
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
            Paquetes privados de {companyName || 'la empresa activa'}. Flux valida los archivos y sus totales; Finanzas confirma los montos y la corrida continúa por su flujo propio de pago. No usa presupuesto ni corte semanal.
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
            <p>Paquetes privados de {companyName || 'la empresa activa'} y su estado dentro del flujo de Nómina.</p>
          </div>
          <span className={s.privatePill}>Finance only</span>
        </div>

        <div className={s.boardList}>
          {status === 'loading' && <div className={s.boardEmpty}>Cargando capturas…</div>}
          {status === 'error' && <div className={s.boardEmpty}>Las capturas no están disponibles.</div>}
          {status === 'ready' && sessions.length === 0 && <div className={s.boardEmpty}>Aún no hay capturas de nómina.</div>}
          {status === 'ready' &&
            sessions.map((session) => {
              const pendingConfirmation = session.finance_confirmation_pending === true
              const readyForPayment = session.payment_ready === true || session.payment_request_status === 'approved'
              const materialized = session.capture_state === 'materialized'
              const label = pendingConfirmation
                ? 'Pendiente de confirmar montos'
                : readyForPayment
                  ? 'Lista para pago de nómina'
                  : captureStateLabel(session.capture_state)
              return (
                <article key={session.id} className={s.boardItem}>
                  <div>
                    <strong>{session.concept}</strong>
                    <span>
                      {session.period_start} → {session.period_end}
                      {session.payment_request_number ? ` · ${session.payment_request_number}` : session.materialized_payment_request_id ? ' · Materializada' : ''}
                    </span>
                  </div>
                  <span className={`${s.state} ${readyForPayment || materialized ? s.stateSuccess : s.stateWarning}`}>
                    {label}
                  </span>
                  <button
                    className={s.secondaryBtn}
                    onClick={() => {
                      setModal({ session })
                      if (pendingConfirmation) void openAmountConfirmation(session)
                    }}
                  >
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
          onSaved={() => reloadSessions(true)}
        />
      )}

      {amountConfirmation && (
        <Modal
          title="¿Confirmas que los montos son correctos?"
          subtitle="Revisa los totales autoritativos validados por el servidor. Esta confirmación sustituye la aprobación individual de Nómina."
          size="md"
          onClose={() => setAmountConfirmation(null)}
          actions={
            <>
              <button type="button" className={s.secondaryBtn} onClick={() => setAmountConfirmation(null)} disabled={confirmationBusy}>
                Confirmar después
              </button>
              <button type="button" className={s.primaryBtn} onClick={() => void confirmAmounts()} disabled={confirmationBusy}>
                {confirmationBusy ? 'Confirmando…' : 'Confirmar montos correctos'}
              </button>
            </>
          }
        >
          <div className={s.section}>
            <div className={s.inlineNotice}>
              <strong>{amountConfirmation.request_number || 'Corrida de nómina'}</strong>
              <span>
                Si confirmas, queda lista para el flujo propio de pago de Nómina. No entra al corte semanal y Flux no ejecuta transferencias.
              </span>
            </div>
            <div className={s.summaryMetrics}>
              <div className={s.metric}>
                <span>Neto empleados</span>
                <strong>{formatMoney(amountConfirmation.employee_net)}</strong>
              </div>
              <div className={s.metric}>
                <span>Salida Tesorería</span>
                <strong>{formatMoney(amountConfirmation.amount_requested)}</strong>
              </div>
            </div>
            <div className={s.channelList}>
              {(amountConfirmation.channels || []).map((channel) => (
                <div key={channel.channel} className={s.channelRow}>
                  <span>{channelLabel(channel.channel)}</span>
                  <strong>{formatMoney(channel.amount)}</strong>
                </div>
              ))}
            </div>
            <p className={s.piiNote}>
              Esta confirmación sólo muestra totales. El detalle por persona no se renderiza en Flux.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
