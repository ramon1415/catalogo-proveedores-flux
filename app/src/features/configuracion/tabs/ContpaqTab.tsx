import { useEffect, useId, useMemo, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { useAuth } from '../../../lib/auth'
import { Badge } from '../../../components/ui/Badge'
import {
  loadContpaqBase,
  loadContpaqCompanyData,
  deleteContpaqMapping,
  upsertContpaqMapping,
  updateBudgetCategoryGroup,
} from '../api'
import { errorMessage } from '../logic'
import { GrupoModal } from '../GrupoModal'
import type { BudgetCategory, ContpaqAccount, ContpaqCompany, ContpaqFilter } from '../types'
import s from '../Configuracion.module.css'

export function ContpaqTab() {
  const { showToast } = useToast()
  const { profile } = useAuth()
  const datalistId = useId()

  const [companies, setCompanies] = useState<ContpaqCompany[]>([])
  const [categories, setCategories] = useState<BudgetCategory[]>([])
  const [companyId, setCompanyId] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<Map<string, ContpaqAccount>>(new Map())
  const [mappings, setMappings] = useState<Map<string, string>>(new Map())
  const [review, setReview] = useState<Set<string>>(new Set())

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContpaqFilter>('todas')

  const [baseStatus, setBaseStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bodyMessage, setBodyMessage] = useState<string>('Cargando...')
  const [grupoCat, setGrupoCat] = useState<BudgetCategory | null>(null)

  // Carga base: empresas + partidas.
  useEffect(() => {
    ;(async () => {
      try {
        const { companies: cs, categories: cats } = await loadContpaqBase()
        setCompanies(cs)
        setCategories(cats)
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
      setBodyMessage('')
      return
    }
    setBodyMessage('Cargando catálogo...')
    setAccounts(new Map())
    try {
      const { accounts: accountsRows, mappings: mappingsRows } = await loadContpaqCompanyData(id)
      setAccounts(new Map(accountsRows.map((a) => [a.code, a])))
      setMappings(new Map(mappingsRows.map((m) => [m.budget_category_id, m.contpaq_account_code])))
      setReview(new Set(mappingsRows.filter((m) => m.needs_review).map((m) => m.budget_category_id)))
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
        const account = accounts.get(code)
        if (!account) {
          showToast('Cuenta no encontrada', `"${code}" no está en el catálogo CONTPAQ de esta empresa.`, 'error')
          return
        }
        if (!account.is_detail) {
          showToast('Cuenta de mayor', `${code} no es cuenta de detalle — elige una cuenta hoja.`, 'error')
          return
        }
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

  const hasAccounts = accounts.size > 0

  return (
    <div className={s.panel}>
      <section className={s.tableCard}>
        <div className={s.panelToolbar}>
          <div>
            <h2>Mapeo de partidas a cuentas CONTPAQ</h2>
            <div className={s.mapperCounter}>{baseStatus === 'loading' ? 'Cargando...' : counter}</div>
          </div>
          <div className={s.mapperControls}>
            <select value={companyId ?? ''} onChange={(e) => selectCompany(e.target.value || null)} style={{ minWidth: 200 }}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
          <datalist id={datalistId}>
            {detalleAccounts.map((a) => (
              <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
            ))}
          </datalist>
        </div>
      </section>

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
