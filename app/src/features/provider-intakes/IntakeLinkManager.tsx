import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { formatDateTime } from '../../lib/format'
import {
  getLinkManagementContext, findLinkProviders, getLinkScope,
  createIntakeLink, revokeIntakeLink, regenerateIntakeLink,
} from './api'
import { friendlyIntakeError, displayValue } from './logic'
import type { LinkManagementContext, LinkProviderResult, ActiveLink } from './types'
import s from './ProviderIntakes.module.css'

// Rebanada 7: administración de ligas públicas de captura. El token completo
// solo se muestra una vez (viaja en el fragmento #token=, nunca en query);
// después solo queda el prefijo. Una liga activa por empresa+destinatario.
const FILE_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF', 'application/xml': 'XML', 'text/xml': 'XML',
  'image/jpeg': 'JPG/JPEG', 'image/png': 'PNG', 'image/webp': 'WEBP',
}

function allowedTypesLabel(types: string[] | undefined): string {
  if (!types?.length) return 'formatos definidos por el backend'
  return [...new Set(types.map((t) => FILE_TYPE_LABELS[t] || t))].join(', ')
}

export function IntakeLinkManager({ onClose }: { onClose: () => void }) {
  const [context, setContext] = useState<LinkManagementContext | null>(null)
  const [ctxErr, setCtxErr] = useState('')

  const [companyId, setCompanyId] = useState('')
  const [recipient, setRecipient] = useState<'existing' | 'generic'>('existing')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<LinkProviderResult[]>([])
  const [searching, setSearching] = useState(false)
  const [provider, setProvider] = useState<LinkProviderResult | null>(null)

  const [scope, setScope] = useState<ActiveLink | null>(null)
  const [scopeLoading, setScopeLoading] = useState(false)

  const [label, setLabel] = useState('')
  const [duration, setDuration] = useState(72)
  const [mutating, setMutating] = useState(false)
  const [err, setErr] = useState('')

  const [oneTimeUrl, setOneTimeUrl] = useState('')
  const [copyStatus, setCopyStatus] = useState('')

  const searchTimer = useRef<number | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const ctx = await getLinkManagementContext()
        setContext(ctx)
        setDuration(Number(ctx.defaults?.duration_hours || 72))
        if (ctx.companies.length === 1) setCompanyId(ctx.companies[0].id)
      } catch (e) {
        setCtxErr(friendlyIntakeError(e))
      }
    })()
  }, [])

  const company = context?.companies.find((c) => c.id === companyId) ?? null

  // Al cambiar empresa: destinatario por defecto según proveedores activos.
  useEffect(() => {
    if (!company) return
    setRecipient(Number(company.active_provider_count || 0) > 0 ? 'existing' : 'generic')
    setProvider(null)
    setResults([])
    setSearch('')
    setOneTimeUrl('')
  }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const isExisting = recipient === 'existing'
  const scopeReady = Boolean(company) && (!isExisting || Boolean(provider))

  const loadScope = useCallback(async () => {
    if (!scopeReady || !company) { setScope(null); return }
    setScopeLoading(true)
    setErr('')
    try {
      setScope(await getLinkScope(company.id, isExisting ? provider!.proveedor_id : null))
    } catch (e) {
      setErr(friendlyIntakeError(e))
      setScope(null)
    } finally {
      setScopeLoading(false)
    }
  }, [scopeReady, company, isExisting, provider])

  useEffect(() => { loadScope() }, [loadScope])

  function onSearchChange(value: string) {
    setSearch(value)
    setProvider(null)
    if (searchTimer.current) window.clearTimeout(searchTimer.current)
    const q = value.trim()
    if (q.length < 2) { setResults([]); return }
    searchTimer.current = window.setTimeout(async () => {
      if (!company) return
      setSearching(true)
      try {
        setResults(await findLinkProviders(company.id, q))
      } catch (e) {
        setErr(friendlyIntakeError(e))
      } finally {
        setSearching(false)
      }
    }, 320)
  }

  const isActive = scope?.status === 'active' && (!scope.expires_at || new Date(scope.expires_at) > new Date())

  function showOneTime(rawToken: string) {
    if (!rawToken) {
      setErr('La liga fue creada, pero la URL de una sola visualización no estuvo disponible. Regenera para obtener otra.')
      return
    }
    // El token viaja SIEMPRE en el fragmento; la página pública vive en la raíz.
    setOneTimeUrl(`${window.location.origin}/solicitar.html#token=${rawToken}`)
    setCopyStatus('')
  }

  async function create() {
    if (!scopeReady || !company || mutating) return
    setMutating(true)
    setErr('')
    try {
      const raw = await createIntakeLink({
        companyId: company.id,
        proveedorId: isExisting ? provider!.proveedor_id : null,
        label,
        durationHours: Number(duration),
        maxSubmissionsPerDay: Number(context?.defaults?.max_submissions_per_day ?? 20),
        maxFileMb: Number(context?.defaults?.max_file_mb ?? 10),
      })
      showOneTime(raw)
      await loadScope()
    } catch (e) {
      setErr(friendlyIntakeError(e))
    } finally {
      setMutating(false)
    }
  }

  async function revoke() {
    if (!scope || !company || mutating) return
    if (!window.confirm(`¿Revocar la liga activa de ${company.name}? El enlace dejará de aceptar nuevos envíos.`)) return
    setMutating(true)
    setErr('')
    try {
      await revokeIntakeLink(scope.id)
      setOneTimeUrl('')
      await loadScope()
    } catch (e) {
      setErr(friendlyIntakeError(e))
    } finally {
      setMutating(false)
    }
  }

  async function regenerate() {
    if (!scope || !company || mutating) return
    if (!window.confirm(`¿Revocar y regenerar la liga de ${company.name}? La URL anterior dejará de funcionar inmediatamente.`)) return
    setMutating(true)
    setErr('')
    try {
      const raw = await regenerateIntakeLink(scope.id, Number(duration))
      showOneTime(raw)
      await loadScope()
    } catch (e) {
      setErr(friendlyIntakeError(e))
    } finally {
      setMutating(false)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(oneTimeUrl)
      setCopyStatus('Liga copiada.')
    } catch {
      setCopyStatus('Selecciona y copia manualmente la URL.')
    }
  }

  const d = context?.defaults

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <div className={s.modalHead}>
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>Ligas públicas de proveedor</h2>
            <p className="muted">Genera y administra las ligas de captura sin crear intakes ni proveedores.</p>
          </div>
          <button className="small-btn" onClick={onClose}>Cerrar</button>
        </div>

        <div className={s.modalBody}>
          {ctxErr && <p className={s.actionErr}>{ctxErr}</p>}
          {!ctxErr && !context && <p className="muted">Consultando tu alcance por empresa…</p>}
          {context && context.companies.length === 0 && (
            <p className="muted">No tienes empresas autorizadas para generar ligas de proveedor.</p>
          )}
          {context && context.companies.length > 0 && (
            <>
              <label className={s.draftField}>
                Empresa
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">Selecciona una empresa autorizada…</option>
                  {context.companies.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
                </select>
              </label>

              {company && (
                <>
                  <div className={s.draftField}>
                    Destinatario
                    <div style={{ display: 'flex', gap: 14 }}>
                      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="radio" checked={recipient === 'existing'} onChange={() => { setRecipient('existing'); setOneTimeUrl('') }} />
                        Proveedor existente
                      </label>
                      <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="radio" checked={recipient === 'generic'} onChange={() => { setRecipient('generic'); setProvider(null); setOneTimeUrl('') }} />
                        Genérica (proveedor nuevo / no identificado)
                      </label>
                    </div>
                  </div>

                  {isExisting && (
                    <div className={s.draftField}>
                      Proveedor
                      <input
                        type="search"
                        maxLength={120}
                        autoComplete="off"
                        placeholder="Buscar proveedor activo…"
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                      />
                      <span className="muted" style={{ fontSize: '.8rem' }}>
                        {provider ? 'Proveedor seleccionado explícitamente.'
                          : searching ? 'Buscando proveedores activos…'
                            : search.trim().length === 1 ? 'Escribe un carácter más para buscar de forma segura.'
                              : 'Escribe al menos 2 caracteres. La selección siempre es explícita.'}
                      </span>
                      {!provider && results.length > 0 && (
                        <ul className={s.fileList}>
                          {results.map((r) => (
                            <li key={r.proveedor_id} className={s.fileItem}>
                              <div>
                                <div>{r.alias || r.legal_name || 'Proveedor'}</div>
                                <div className="muted" style={{ fontSize: '.8rem' }}>{displayValue(r.legal_name)} · RFC {displayValue(r.rfc_masked)}</div>
                              </div>
                              <button className="small-btn" onClick={() => { setProvider(r); setResults([]) }}>Seleccionar</button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!provider && !searching && search.trim().length >= 2 && results.length === 0 && (
                        <span className="muted" style={{ fontSize: '.8rem' }}>No hay proveedores activos que coincidan.</span>
                      )}
                      {provider && (
                        <div className={s.matchCard}>
                          <div className={s.matchCardHead}>
                            <div>
                              <strong>{provider.alias || provider.legal_name || 'Proveedor'}</strong>
                              <div className="muted" style={{ fontSize: '.85rem' }}>{displayValue(provider.legal_name)} · RFC {displayValue(provider.rfc_masked)}</div>
                            </div>
                            <button className="small-btn" onClick={() => setProvider(null)}>Cambiar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {scopeLoading && <p className="muted" style={{ fontSize: '.85rem' }}>Consultando liga de este destinatario…</p>}

                  {!scopeLoading && scopeReady && isActive && scope && (
                    <div className={s.matchCard}>
                      <div className={s.matchCardHead}>
                        <div>
                          <strong>{isExisting ? 'Liga activa para este proveedor' : 'Liga genérica activa para esta empresa'}</strong>
                          <div className="muted" style={{ fontSize: '.85rem' }}>
                            {[scope.label, scope.token_prefix ? `prefijo ${scope.token_prefix}` : null, scope.expires_at ? `vence ${formatDateTime(scope.expires_at)}` : null].filter(Boolean).join(' · ')}
                          </div>
                          <div className="muted" style={{ fontSize: '.8rem' }}>{Number(scope.current_intakes || 0)} intake(s) creados con esta liga.</div>
                        </div>
                        <Badge variant="success">Activa</Badge>
                      </div>
                      <p className="muted" style={{ margin: 0, fontSize: '.75rem' }}>
                        El token completo no se almacena ni puede recuperarse. Regenera la liga para obtener una nueva URL de una sola visualización.
                      </p>
                      <div className={s.actionBar}>
                        <button className="secondary-btn" disabled={mutating} onClick={regenerate}>Regenerar</button>
                        <button className="danger-btn" disabled={mutating} onClick={revoke}>Revocar</button>
                      </div>
                    </div>
                  )}

                  {!scopeLoading && scopeReady && !isActive && (
                    <div className={s.actionForm}>
                      <strong>{scope?.status === 'expired' ? 'La liga anterior expiró' : 'Sin liga activa'}</strong>
                      <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
                        Puedes crear una liga nueva para este destinatario sin crear intakes, proveedores ni solicitudes de pago.
                      </p>
                      <label className={s.draftField}>
                        Vigencia
                        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                          <option value={24}>24 horas</option>
                          <option value={72}>72 horas</option>
                          <option value={168}>7 días</option>
                        </select>
                      </label>
                      <label className={s.draftField}>
                        Etiqueta interna (opcional)
                        <input type="text" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} />
                      </label>
                      <p className="muted" style={{ margin: 0, fontSize: '.8rem' }}>
                        Contrato vigente: {d?.max_files ?? 3} archivos · {d?.max_file_mb ?? 10} MB por archivo · {d?.max_total_mb ?? 12} MB totales · {d?.max_submissions_per_day ?? 20} envíos diarios · {allowedTypesLabel(d?.allowed_file_types)}.
                      </p>
                      <div className={s.actionFormBtns}>
                        <button className="primary-btn" disabled={mutating} onClick={create}>{mutating ? 'Creando…' : 'Generar liga'}</button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {err && <p className={s.actionErr} role="alert">{err}</p>}

              {oneTimeUrl && (
                <div className={s.actionForm}>
                  <strong>Liga lista para compartir</strong>
                  <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
                    Esta liga se muestra completa únicamente ahora. Guárdala o compártela de forma segura. El token viaja en el fragmento <code>#token=</code>.
                  </p>
                  <textarea rows={3} readOnly value={oneTimeUrl} aria-label="URL pública de proveedor" onFocus={(e) => e.currentTarget.select()} />
                  <div className={s.actionFormBtns} style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
                    <button className="secondary-btn" onClick={copyLink}>Copiar liga</button>
                    <span role="status" aria-live="polite" className="muted" style={{ fontSize: '.85rem' }}>{copyStatus}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
