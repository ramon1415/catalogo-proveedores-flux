import { useEffect, useId, useMemo, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { Badge } from '../../../components/ui/Badge'
import {
  loadContpaqBase,
  loadContpaqCompanyData,
  loadContpaqCompanyExtras,
  loadContpaqProveedores,
  deleteContpaqMapping,
  upsertContpaqMapping,
  updateBudgetCategoryGroup,
  upsertTaxMapping,
  deleteTaxMapping,
  upsertProviderMapping,
  deleteProviderMapping,
  upsertBankMapping,
  deleteBankMapping,
} from '../api'
import { errorMessage } from '../logic'
import { GrupoModal } from '../GrupoModal'
import type {
  BudgetCategory,
  ContpaqAccount,
  ContpaqCompany,
  ContpaqFilter,
  ContpaqSubTab,
  TaxKey,
  ContpaqTercero,
  ProveedorRow,
  BankAccountRow,
} from '../types'
import type { MapeoEmpresa } from '../../../lib/contpaq/export'
import { ExportarSection } from '../ExportarSection'
import s from '../Configuracion.module.css'

// Lista FIJA de llaves fiscales que consume el módulo contable — el orden es el de captura.
const TAX_KEYS: { key: TaxKey; label: string; desc: string }[] = [
  { key: 'ivaAcreditablePagado', label: 'IVA acreditable pagado', desc: 'IVA efectivamente pagado en el periodo' },
  { key: 'ivaRetenidoAcreditable', label: 'IVA retenido acreditable', desc: 'IVA que nos retuvieron y podemos acreditar' },
  { key: 'retIvaPasivo', label: 'Retención IVA (pasivo)', desc: 'IVA retenido a terceros pendiente de enterar' },
  { key: 'retIsrPasivo', label: 'Retención ISR (pasivo)', desc: 'ISR retenido a terceros pendiente de enterar' },
  { key: 'ivaPendiente', label: 'IVA pendiente de acreditar (provisión)', desc: 'IVA de facturas provisionadas aún no pagadas' },
  { key: 'ajusteRedondeo', label: 'Ajuste por redondeo', desc: 'Diferencias de centavos al cuadrar la póliza' },
  { key: 'noDeducibles', label: 'No deducibles', desc: 'Gastos sin requisitos fiscales' },
]

// Tooltip de la discrepancia detectada en Operadora (213 vs 216).
const REVIEW_TOOLTIP =
  "El layout real usa 213-08/09; 'Información solicitada' decía 216-04/10 — confirmar con contabilidad"

type TaxState = { code: string; needsReview: boolean }
type ProvState = { code: string | null; terceroId: string | null }

export function ContpaqTab() {
  const { showToast } = useToast()
  const { profile } = useAuth()
  const datalistId = useId()
  const tercerosListId = useId()

  const [subTab, setSubTab] = useState<ContpaqSubTab>('partidas')

  const [companies, setCompanies] = useState<ContpaqCompany[]>([])
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<Map<string, ContpaqAccount>>(new Map())
  const [mappings, setMappings] = useState<Map<string, string>>(new Map())
  const [review, setReview] = useState<Set<string>>(new Set())

  // Capas extra del mapeoEmpresa (impuestos / proveedores / bancos).
  const [taxMap, setTaxMap] = useState<Map<TaxKey, TaxState>>(new Map())
  const [provMap, setProvMap] = useState<Map<string, ProvState>>(new Map())
  const [bankMap, setBankMap] = useState<Map<string, string>>(new Map())
  const [terceros, setTerceros] = useState<ContpaqTercero[]>([])
  const [bankAccounts, setBankAccounts] = useState<BankAccountRow[]>([])

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContpaqFilter>('todas')

  const [baseStatus, setBaseStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bodyMessage, setBodyMessage] = useState<string>('Cargando...')
  const [grupoCat, setGrupoCat] = useState<BudgetCategory | null>(null)

  // Carga base: empresas + partidas + proveedores Flux activos.
  useEffect(() => {
    ;(async () => {
      try {
        const [{ companies: cs, categories: cats }, provs] = await Promise.all([
          loadContpaqBase(),
          loadContpaqProveedores(),
        ])
        setCompanies(cs)
        setCategories(cats)
        setProveedores(provs)
        setBaseStatus('ready')
        await selectCompany(cs[0]?.id || null)
      } catch (err: any) {
        setBaseStatus('error')
        setBodyMessage(errorMessage(err))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function selectCompany(id: string | null) {
    setCompanyId(id)
    if (!id) {
      setAccounts(new Map())
      setMappings(new Map())
      setReview(new Set())
      setTaxMap(new Map())
      setProvMap(new Map())
      setBankMap(new Map())
      setTerceros([])
      setBankAccounts([])
      setBodyMessage('')
      return
    }
    setBodyMessage('Cargando catálogo...')
    setAccounts(new Map())
    try {
      const [{ accounts: accountsRows, mappings: mappingsRows }, extras] = await Promise.all([
        loadContpaqCompanyData(id),
        loadContpaqCompanyExtras(id),
      ])
      setAccounts(new Map(accountsRows.map((a) => [a.code, a])))
      setMappings(new Map(mappingsRows.map((m) => [m.budget_category_id, m.contpaq_account_code])))
      setReview(new Set(mappingsRows.filter((m) => m.needs_review).map((m) => m.budget_category_id)))
      setTaxMap(
        new Map(
          extras.taxMappings.map((t) => [t.tax_key, { code: t.contpaq_account_code, needsReview: t.needs_review }]),
        ),
      )
      setProvMap(
        new Map(
          extras.providerMappings.map((p) => [
            p.proveedor_id,
            { code: p.contpaq_account_code, terceroId: p.contpaq_provider_id },
          ]),
        ),
      )
      setBankMap(new Map(extras.bankMappings.map((b) => [b.company_bank_account_id, b.contpaq_account_code])))
      setTerceros(extras.terceros)
      setBankAccounts(extras.bankAccounts)
    } catch (err: any) {
      setBodyMessage(`${errorMessage(err)} — ¿ya corriste el DDL del mapper en esta base?`)
    }
  }

  // datalist: solo cuentas de detalle (mapeables), gasto (código 6...) primero.
  const detalleAccounts = useMemo(() => {
    const detalle = [...accounts.values()].filter((a) => a.is_detail)
    detalle.sort(
      (a, b) => (a.code[0] === '6' ? 0 : 1) - (b.code[0] === '6' ? 0 : 1) || a.code.localeCompare(b.code),
    )
    return detalle
  }, [accounts])

  // Terceros tipo proveedor para el picker (id — nombre (RFC)).
  const tercerosProveedor = useMemo(
    () => terceros.filter((t) => t.tipo_tercero === 'proveedor'),
    [terceros],
  )
  const tercerosById = useMemo(
    () => new Map(tercerosProveedor.map((t) => [t.id_contpaq, t])),
    [tercerosProveedor],
  )
  // Índice por RFC para sugerir el tercero cuando coincide con el proveedor Flux.
  const tercerosByRfc = useMemo(() => {
    const idx = new Map<string, ContpaqTercero>()
    for (const t of tercerosProveedor) {
      const rfc = (t.rfc || '').trim().toUpperCase()
      if (rfc && !idx.has(rfc)) idx.set(rfc, t)
    }
    return idx
  }, [tercerosProveedor])

  const filteredCats = useMemo(() => {
    const q = query.trim().toLowerCase()
    return categories.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !String(c.category || '').toLowerCase().includes(q)) return false
      const mapeada = Boolean(accounts.get(mappings.get(c.id) || ''))
      if (filter === 'sinmapear') return !mapeada
      if (filter === 'revisar') return review.has(c.id)
      return true
    })
  }, [categories, query, filter, accounts, mappings, review])

  const grupos = useMemo(() => {
    const porGrupo = new Map<string, BudgetCategory[]>()
    for (const cat of filteredCats) {
      const g = cat.category || 'Sin grupo'
      if (!porGrupo.has(g)) porGrupo.set(g, [])
      porGrupo.get(g)!.push(cat)
    }
    return [...porGrupo.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }, [filteredCats])

  const counter = useMemo(() => {
    const total = categories.length
    const mapped = categories.filter((c) => accounts.get(mappings.get(c.id) || '')).length
    const rev = review.size
    return `${mapped} de ${total} partidas mapeadas${mapped < total ? ` · ${total - mapped} sin mapear` : ''}${
      rev ? ` · ⚠ ${rev} por revisar` : ''
    }${mapped === total && !rev ? ' · completo ✓' : ''}`
  }, [categories, accounts, mappings, review])

  // Pendientes por sección para los puntitos de la sub-nav.
  const pendientes = useMemo(() => {
    const partidas =
      categories.filter((c) => !accounts.get(mappings.get(c.id) || '')).length + review.size
    const impuestos = TAX_KEYS.filter((t) => {
      const st = taxMap.get(t.key)
      return !st?.code || st.needsReview
    }).length
    const provs = proveedores.filter((p) => !provMap.get(p.id)?.code).length
    const bancos = bankAccounts.filter((b) => !bankMap.get(b.id)).length
    return { partidas, impuestos, proveedores: provs, bancos }
  }, [categories, accounts, mappings, review, taxMap, proveedores, provMap, bankAccounts, bankMap])

  // Valida contra el catálogo antes de guardar; regresa null si la cuenta no sirve.
  function validateAccount(code: string): ContpaqAccount | null {
    const account = accounts.get(code)
    if (!account) {
      showToast('Cuenta no encontrada', `"${code}" no está en el catálogo CONTPAQ de esta empresa.`, 'error')
      return null
    }
    if (!account.is_detail) {
      showToast('Cuenta de mayor', `${code} no es cuenta de detalle — elige una cuenta hoja.`, 'error')
      return null
    }
    return account
  }

  async function saveMapping(categoryId: string, code: string) {
    if (!companyId) return
    try {
      if (!code) {
        await deleteContpaqMapping(companyId, categoryId)
        setMappings((prev) => {
          const next = new Map(prev)
          next.delete(categoryId)
          return next
        })
      } else {
        if (!validateAccount(code)) return
        await upsertContpaqMapping(companyId, categoryId, code, profile?.id ?? null)
        setMappings((prev) => new Map(prev).set(categoryId, code))
        setReview((prev) => {
          const next = new Set(prev)
          next.delete(categoryId)
          return next
        })
      }
    } catch (err: any) {
      showToast('No se pudo guardar', errorMessage(err), 'error')
    }
  }

  async function saveTax(taxKey: TaxKey, code: string) {
    if (!companyId) return
    try {
      if (!code) {
        await deleteTaxMapping(companyId, taxKey)
        setTaxMap((prev) => {
          const next = new Map(prev)
          next.delete(taxKey)
          return next
        })
      } else {
        if (!validateAccount(code)) return
        // Guardar manualmente resuelve la revisión pendiente (needs_review → false).
        await upsertTaxMapping(companyId, taxKey, code)
        setTaxMap((prev) => new Map(prev).set(taxKey, { code, needsReview: false }))
      }
    } catch (err: any) {
      showToast('No se pudo guardar', errorMessage(err), 'error')
    }
  }

  async function saveProvider(proveedorId: string, patch: Partial<ProvState>) {
    if (!companyId) return
    const current = provMap.get(proveedorId) || { code: null, terceroId: null }
    const next: ProvState = { ...current, ...patch }
    try {
      if (!next.code && !next.terceroId) {
        await deleteProviderMapping(companyId, proveedorId)
        setProvMap((prev) => {
          const map = new Map(prev)
          map.delete(proveedorId)
          return map
        })
      } else {
        if (next.code && !validateAccount(next.code)) return
        await upsertProviderMapping(companyId, proveedorId, next.code, next.terceroId)
        setProvMap((prev) => new Map(prev).set(proveedorId, next))
      }
    } catch (err: any) {
      showToast('No se pudo guardar', errorMessage(err), 'error')
    }
  }

  async function saveBank(bankAccountId: string, code: string) {
    if (!companyId) return
    try {
      if (!code) {
        await deleteBankMapping(companyId, bankAccountId)
        setBankMap((prev) => {
          const next = new Map(prev)
          next.delete(bankAccountId)
          return next
        })
      } else {
        if (!validateAccount(code)) return
        await upsertBankMapping(companyId, bankAccountId, code)
        setBankMap((prev) => new Map(prev).set(bankAccountId, code))
      }
    } catch (err: any) {
      showToast('No se pudo guardar', errorMessage(err), 'error')
    }
  }

  async function saveGrupo(grupo: string) {
    if (!grupoCat) return
    try {
      await updateBudgetCategoryGroup(grupoCat.id, grupo)
      setCategories((prev) => prev.map((c) => (c.id === grupoCat.id ? { ...c, category: grupo } : c)))
      setGrupoCat(null)
      showToast('Agrupación actualizada', `Ahora vive en "${grupo}".`, 'success')
    } catch (err: any) {
      const msg = /policy|permission|denied/i.test(errorMessage(err))
        ? 'La base aún no permite editar partidas — falta correr rls_budget_categories_write.sql'
        : errorMessage(err)
      showToast('No se pudo guardar', msg, 'error')
    }
  }

  // Parsea la selección del datalist de terceros: acepta "id" o "id — nombre (RFC)".
  function parseTerceroInput(raw: string): string | null {
    const value = raw.trim()
    if (!value) return null
    const id = value.split('—')[0].trim()
    return tercerosById.has(id) ? id : tercerosById.has(value) ? value : null
  }

  function terceroLabel(t: ContpaqTercero): string {
    return `${t.id_contpaq} — ${t.nombre}${t.rfc ? ` (${t.rfc})` : ''}`
  }

  const hasAccounts = accounts.size > 0

  const subTabs: { key: ContpaqSubTab; label: string; pending: number }[] = [
    { key: 'partidas', label: 'Partidas', pending: pendientes.partidas },
    { key: 'impuestos', label: 'Impuestos', pending: pendientes.impuestos },
    { key: 'proveedores', label: 'Proveedores', pending: pendientes.proveedores },
    { key: 'bancos', label: 'Bancos', pending: pendientes.bancos },
    { key: 'exportar', label: 'Exportar', pending: 0 },
  ]

  // mapeoEmpresa con la forma que consume el motor de export (FB-7): las
  // mismas capas que capturan las otras secciones, indexadas por id de negocio.
  const mapeoEmpresa = useMemo<MapeoEmpresa>(() => {
    const partida: Record<string, string> = {}
    mappings.forEach((code, id) => { partida[id] = code })
    const banco: Record<string, string> = {}
    bankMap.forEach((code, id) => { banco[id] = code })
    const proveedor: Record<string, { cuenta: string; idProveedor: number | string }> = {}
    provMap.forEach((st, id) => {
      // Solo cuenta como mapeado si tiene tercero CONTPAQ (idProveedor es lo
      // que consumen los registros fiscales I/V).
      if (st.terceroId) proveedor[id] = { cuenta: st.code ?? '', idProveedor: st.terceroId }
    })
    const impuesto: MapeoEmpresa['impuesto'] = {
      ivaAcreditablePagado: taxMap.get('ivaAcreditablePagado')?.code,
      ivaRetenidoAcreditable: taxMap.get('ivaRetenidoAcreditable')?.code,
      retIvaPasivo: taxMap.get('retIvaPasivo')?.code,
      retIsrPasivo: taxMap.get('retIsrPasivo')?.code,
    }
    const cuentasEspeciales = {
      ajusteRedondeo: taxMap.get('ajusteRedondeo')?.code,
      noDeducibles: taxMap.get('noDeducibles')?.code,
    }
    return { partida, banco, proveedor, impuesto, cuentasEspeciales }
  }, [mappings, bankMap, provMap, taxMap])

  // Etiquetas para que los faltantes del export se lean con nombre, no uuid.
  const nombrePartida = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories])
  const nombreBanco = useMemo(
    () => new Map(bankAccounts.map((b) => [b.id, [b.name, b.bank_name].filter(Boolean).join(' · ') || b.id])),
    [bankAccounts],
  )
  const nombreProveedor = useMemo(
    () => new Map(proveedores.map((p) => [p.id, p.alias || p.nombre_completo || p.id])),
    [proveedores],
  )

  // Contadores "X de Y" por sección.
  const taxCounter = `${TAX_KEYS.filter((t) => taxMap.get(t.key)?.code).length} de ${TAX_KEYS.length} impuestos mapeados`
  const provCounter = `${proveedores.filter((p) => provMap.get(p.id)?.code).length} de ${proveedores.length} proveedores mapeados`
  const bankCounter = `${bankAccounts.filter((b) => bankMap.get(b.id)).length} de ${bankAccounts.length} cuentas mapeadas`

  return (
    <div className={s.panel}>
      {/* Sub-navegación + selector de empresa compartido entre las 4 secciones */}
      <div className={s.panelToolbar} style={{ border: 0, padding: 0 }}>
        <div className={s.tabs} style={{ marginBottom: 0 }}>
          {subTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${s.tab} ${subTab === t.key ? s.active : ''}`}
              onClick={() => setSubTab(t.key)}
            >
              {t.label}
              {t.pending > 0 && baseStatus === 'ready' && (
                <span className={s.tabBadge} title={`${t.pending} pendientes`}>{t.pending}</span>
              )}
            </button>
          ))}
        </div>
        <select value={companyId ?? ''} onChange={(e) => selectCompany(e.target.value || null)} className={s.mapInput} style={{ minWidth: 200, width: 'auto' }}>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {subTab === 'partidas' && (
        <section className={s.tableCard}>
          <div className={s.panelToolbar}>
            <div>
              <h2>Mapeo de partidas a cuentas CONTPAQ</h2>
              <div className={s.mapperCounter}>{baseStatus === 'loading' ? 'Cargando...' : counter}</div>
            </div>
            <div className={s.mapperControls}>
              <select value={filter} onChange={(e) => setFilter(e.target.value as ContpaqFilter)}>
                <option value="todas">Ver: todas</option>
                <option value="revisar">⚠ Por revisar</option>
                <option value="sinmapear">Sin mapear</option>
              </select>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar partida..." style={{ minWidth: 180 }} />
            </div>
          </div>
          <div className={s.mapperWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Partida del presupuesto</th>
                  <th style={{ minWidth: 260 }}>→ Cuenta CONTPAQ</th>
                  <th>Nombre (verificación)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {baseStatus === 'error' && (
                  <tr><td colSpan={4} className={`${s.tableMsg} ${s.tableErr}`}>{bodyMessage}</td></tr>
                )}
                {baseStatus !== 'error' && !hasAccounts && (
                  <tr><td colSpan={4} className={s.tableMsg}>
                    {bodyMessage || 'Esta empresa no tiene catálogo CONTPAQ cargado.'}
                  </td></tr>
                )}
                {baseStatus !== 'error' && hasAccounts && grupos.map(([grupo, lista]) => {
                  const mapeadas = lista.filter((c) => accounts.get(mappings.get(c.id) || '')).length
                  return (
                    <FragmentGroup key={grupo}>
                      <tr className={s.groupRow}>
                        <td colSpan={4}>
                          {grupo} <span className={s.groupCount}>· {mapeadas}/{lista.length}</span>
                        </td>
                      </tr>
                      {lista.map((cat) => {
                        const code = mappings.get(cat.id) || ''
                        const account = code ? accounts.get(code) : null
                        const ok = Boolean(account)
                        const revisar = review.has(cat.id)
                        const rowClass = !ok ? s.rowUnmapped : revisar ? s.rowReview : ''
                        return (
                          <tr key={cat.id} className={rowClass}>
                            <td style={{ paddingLeft: 26 }}>
                              <span className={s.catName}>
                                <span className={s.cellMain}>{cat.name}</span>
                                <button type="button" className={s.iconBtn} title="Cambiar agrupación" onClick={() => setGrupoCat(cat)}>✎</button>
                              </span>
                            </td>
                            <td>
                              <input
                                list={datalistId}
                                className={s.mapInput}
                                defaultValue={code}
                                key={`${cat.id}:${code}`}
                                placeholder="Código o buscar..."
                                onBlur={(e) => {
                                  const v = e.target.value.trim()
                                  if (v !== code) saveMapping(cat.id, v)
                                }}
                              />
                            </td>
                            <td style={{ color: 'var(--text-2)' }}>{account ? account.name : '—'}</td>
                            <td>
                              {!ok ? (
                                <Badge variant="warning">Sin mapear</Badge>
                              ) : revisar ? (
                                <Badge variant="warning">⚠ Revisar</Badge>
                              ) : (
                                <Badge variant="success">Mapeada</Badge>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </FragmentGroup>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'impuestos' && (
        <section className={s.tableCard}>
          <div className={s.panelToolbar}>
            <div>
              <h2>Cuentas de impuestos y ajustes</h2>
              <div className={s.mapperCounter}>{baseStatus === 'loading' ? 'Cargando...' : taxCounter}</div>
            </div>
          </div>
          <div className={s.mapperWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th style={{ minWidth: 260 }}>→ Cuenta CONTPAQ</th>
                  <th>Nombre (verificación)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {baseStatus === 'error' && (
                  <tr><td colSpan={4} className={`${s.tableMsg} ${s.tableErr}`}>{bodyMessage}</td></tr>
                )}
                {baseStatus !== 'error' && !hasAccounts && (
                  <tr><td colSpan={4} className={s.tableMsg}>
                    {bodyMessage || 'Esta empresa no tiene catálogo CONTPAQ cargado.'}
                  </td></tr>
                )}
                {baseStatus !== 'error' && hasAccounts && TAX_KEYS.map((tax) => {
                  const st = taxMap.get(tax.key)
                  const code = st?.code || ''
                  const account = code ? accounts.get(code) : null
                  const ok = Boolean(account)
                  const revisar = Boolean(st?.needsReview)
                  const rowClass = !ok ? s.rowUnmapped : revisar ? s.rowReview : ''
                  return (
                    <tr key={tax.key} className={rowClass}>
                      <td>
                        <span className={s.cellMain}>{tax.label}</span>
                        <span className={s.cellSub}>{tax.desc}</span>
                      </td>
                      <td>
                        <input
                          list={datalistId}
                          className={s.mapInput}
                          defaultValue={code}
                          key={`${tax.key}:${code}`}
                          placeholder="Código o buscar..."
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v !== code) saveTax(tax.key, v)
                          }}
                        />
                      </td>
                      <td style={{ color: 'var(--text-2)' }}>{account ? account.name : '—'}</td>
                      <td>
                        {!ok ? (
                          <Badge variant="warning">Sin mapear</Badge>
                        ) : revisar ? (
                          <span title={REVIEW_TOOLTIP} style={{ cursor: 'help' }}>
                            <Badge variant="warning">⚠ Revisar con contabilidad</Badge>
                          </span>
                        ) : (
                          <Badge variant="success">Mapeada</Badge>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'proveedores' && (
        <section className={s.tableCard}>
          <div className={s.panelToolbar}>
            <div>
              <h2>Proveedores → tercero y cuenta CONTPAQ</h2>
              <div className={s.mapperCounter}>{baseStatus === 'loading' ? 'Cargando...' : provCounter}</div>
            </div>
            <div className={s.mapperControls}>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar proveedor..." style={{ minWidth: 180 }} />
            </div>
          </div>
          <div className={s.mapperWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Proveedor Flux</th>
                  <th style={{ minWidth: 260 }}>→ Tercero CONTPAQ</th>
                  <th style={{ minWidth: 220 }}>→ Cuenta CONTPAQ</th>
                  <th>Nombre (verificación)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {baseStatus === 'error' && (
                  <tr><td colSpan={5} className={`${s.tableMsg} ${s.tableErr}`}>{bodyMessage}</td></tr>
                )}
                {baseStatus !== 'error' && !hasAccounts && (
                  <tr><td colSpan={5} className={s.tableMsg}>
                    {bodyMessage || 'Esta empresa no tiene catálogo CONTPAQ cargado.'}
                  </td></tr>
                )}
                {baseStatus !== 'error' && hasAccounts && proveedores
                  .filter((p) => {
                    const q = query.trim().toLowerCase()
                    if (!q) return true
                    return (
                      String(p.alias || '').toLowerCase().includes(q) ||
                      String(p.nombre_completo || '').toLowerCase().includes(q) ||
                      String(p.rfc || '').toLowerCase().includes(q)
                    )
                  })
                  .map((prov) => {
                    const st = provMap.get(prov.id)
                    const code = st?.code || ''
                    const terceroId = st?.terceroId || ''
                    const tercero = terceroId ? tercerosById.get(terceroId) : null
                    const account = code ? accounts.get(code) : null
                    const ok = Boolean(account)
                    // Sugerencia por coincidencia de RFC (solo visual, no se guarda sola).
                    const rfc = (prov.rfc || '').trim().toUpperCase()
                    const sugerido = !terceroId && rfc ? tercerosByRfc.get(rfc) : undefined
                    return (
                      <tr key={prov.id} className={!ok ? s.rowUnmapped : ''}>
                        <td>
                          <span className={s.cellMain}>{prov.alias || prov.nombre_completo || '—'}</span>
                          <span className={s.cellSub}>{prov.nombre_completo || ''}{prov.rfc ? ` · ${prov.rfc}` : ''}</span>
                        </td>
                        <td>
                          <input
                            list={tercerosListId}
                            className={s.mapInput}
                            defaultValue={tercero ? terceroLabel(tercero) : ''}
                            key={`${prov.id}:t:${terceroId}`}
                            placeholder="ID o buscar tercero..."
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              const parsed = parseTerceroInput(raw)
                              if (raw && !parsed) {
                                showToast('Tercero no encontrado', `"${raw}" no está en los terceros CONTPAQ de esta empresa.`, 'error')
                                return
                              }
                              if ((parsed || null) !== (terceroId || null)) {
                                saveProvider(prov.id, { terceroId: parsed })
                              }
                            }}
                          />
                          {sugerido && (
                            <span className={s.hint}>
                              Sugerencia por RFC: {terceroLabel(sugerido)}{' '}
                              <button
                                type="button"
                                className={s.smallBtn}
                                onClick={() => saveProvider(prov.id, { terceroId: sugerido.id_contpaq })}
                              >
                                Usar
                              </button>
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            list={datalistId}
                            className={s.mapInput}
                            defaultValue={code}
                            key={`${prov.id}:c:${code}`}
                            placeholder="Código o buscar... (201-01-1XX)"
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              if (v !== code) saveProvider(prov.id, { code: v || null })
                            }}
                          />
                        </td>
                        <td style={{ color: 'var(--text-2)' }}>{account ? account.name : '—'}</td>
                        <td>
                          {ok ? <Badge variant="success">Mapeado</Badge> : <Badge variant="warning">Sin mapear</Badge>}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'bancos' && (
        <section className={s.tableCard}>
          <div className={s.panelToolbar}>
            <div>
              <h2>Cuentas bancarias → cuenta contable CONTPAQ</h2>
              <div className={s.mapperCounter}>{baseStatus === 'loading' ? 'Cargando...' : bankCounter}</div>
            </div>
          </div>
          <div className={s.mapperWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Cuenta bancaria</th>
                  <th style={{ minWidth: 260 }}>→ Cuenta CONTPAQ</th>
                  <th>Nombre (verificación)</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {baseStatus === 'error' && (
                  <tr><td colSpan={4} className={`${s.tableMsg} ${s.tableErr}`}>{bodyMessage}</td></tr>
                )}
                {baseStatus !== 'error' && !hasAccounts && (
                  <tr><td colSpan={4} className={s.tableMsg}>
                    {bodyMessage || 'Esta empresa no tiene catálogo CONTPAQ cargado.'}
                  </td></tr>
                )}
                {baseStatus !== 'error' && hasAccounts && bankAccounts.length === 0 && (
                  <tr><td colSpan={4} className={s.tableMsg}>Esta empresa no tiene cuentas bancarias activas.</td></tr>
                )}
                {baseStatus !== 'error' && hasAccounts && bankAccounts.map((cuenta) => {
                  const code = bankMap.get(cuenta.id) || ''
                  const account = code ? accounts.get(code) : null
                  const ok = Boolean(account)
                  return (
                    <tr key={cuenta.id} className={!ok ? s.rowUnmapped : ''}>
                      <td>
                        <span className={s.cellMain}>{cuenta.name || '—'}</span>
                        <span className={s.cellSub}>
                          {cuenta.bank_name || ''}
                          {cuenta.last4 ? ` · ****${cuenta.last4}` : ''}
                        </span>
                      </td>
                      <td>
                        <input
                          list={datalistId}
                          className={s.mapInput}
                          defaultValue={code}
                          key={`${cuenta.id}:${code}`}
                          placeholder="Código o buscar..."
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v !== code) saveBank(cuenta.id, v)
                          }}
                        />
                      </td>
                      <td style={{ color: 'var(--text-2)' }}>{account ? account.name : '—'}</td>
                      <td>
                        {ok ? <Badge variant="success">Mapeada</Badge> : <Badge variant="warning">Sin mapear</Badge>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {subTab === 'exportar' && (
        <ExportarSection
          companyId={companyId}
          companyName={companies.find((c) => c.id === companyId)?.name ?? 'empresa'}
          mapeo={mapeoEmpresa}
          nombrePartida={nombrePartida}
          nombreBanco={nombreBanco}
          nombreProveedor={nombreProveedor}
          cuentasDatalistId={datalistId}
        />
      )}

      {/* Datalists compartidos por todas las secciones */}
      <datalist id={datalistId}>
        {detalleAccounts.map((a) => (
          <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
        ))}
      </datalist>
      <datalist id={tercerosListId}>
        {tercerosProveedor.map((t) => (
          <option key={t.id_contpaq} value={terceroLabel(t)} />
        ))}
      </datalist>

      {grupoCat && (
        <GrupoModal category={grupoCat} categories={categories} onClose={() => setGrupoCat(null)} onSave={saveGrupo} />
      )}
    </div>
  )
}

// tbody no admite Fragment con key directamente en algunos linters; wrapper simple.
function FragmentGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
