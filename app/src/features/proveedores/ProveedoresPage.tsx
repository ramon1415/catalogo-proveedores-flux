import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import { IcSearch, IcPlus } from '../../components/ui/icons'
import { listProviders, setProviderActive } from './api'
import { matchesFilters, normalize } from './logic'
import { ProviderModal } from './ProviderModal'
import type { ModalMode } from './ProviderModal'
import type { Provider, StatusFilter } from './types'
import s from './Proveedores.module.css'

type ModalState = { mode: ModalMode; provider: Provider | null } | null

export default function ProveedoresPage() {
  const { canManageProviders } = useAuth()
  const { showToast } = useToast()
  const [params] = useSearchParams()
  const readonlyMode = params.get('mode') === 'readonly'

  const [providers, setProviders] = useState<Provider[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('todos')
  const [modal, setModal] = useState<ModalState>(null)

  const canManage = canManageProviders() && !readonlyMode

  async function reload() {
    setStatus('loading')
    try {
      setProviders(await listProviders())
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // Deep-link: ?provider_id abre el detalle (readonly si mode=readonly).
  useEffect(() => {
    if (status !== 'ready') return
    const pid = params.get('provider_id')
    if (!pid) return
    const p = providers.find((x) => x.id === pid)
    if (!p) {
      showToast('Proveedor no encontrado', 'El proveedor solicitado ya no está disponible en el catálogo.', 'warning')
      return
    }
    if (readonlyMode) setModal({ mode: 'readonly', provider: p })
    else if (canManageProviders()) setModal({ mode: 'edit', provider: p })
    else setModal({ mode: 'readonly', provider: p })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const rows = useMemo(() => {
    const q = normalize(query)
    return providers.filter((p) => matchesFilters(p, q, filter))
  }, [providers, query, filter])

  function openEdit(p: Provider) {
    if (!canManageProviders()) {
      showToast('Sin permiso', 'La administración de proveedores corresponde a Finanzas, Dirección o Sysadmin.', 'warning')
      return
    }
    setModal({ mode: 'edit', provider: p })
  }

  async function toggle(p: Provider, activo: boolean) {
    if (!canManageProviders()) {
      showToast('Sin permiso', 'La administración de proveedores corresponde a Finanzas, Dirección o Sysadmin.', 'warning')
      return
    }
    const ok = window.confirm(
      activo ? '¿Seguro que deseas reactivar este proveedor?' : '¿Seguro que deseas desactivar este proveedor?',
    )
    if (!ok) return
    try {
      await setProviderActive(p.id, activo)
      await reload()
      showToast(activo ? 'Proveedor reactivado' : 'Proveedor desactivado', '', 'success')
    } catch {
      showToast('No fue posible actualizar el proveedor. Inténtalo nuevamente.', '', 'error')
    }
  }

  return (
    <>
      <div className={s.phead}>
        <div>
          <h1>Proveedores</h1>
          <p className="muted">Administra proveedores, métodos de pago, datos bancarios y estatus operativo.</p>
        </div>
        {!readonlyMode && (
          <button className={s.primaryBtn} onClick={() => setModal({ mode: 'create', provider: null })}>
            <IcPlus size={16} /> Nuevo proveedor
          </button>
        )}
      </div>

      <section className={s.tableCard}>
        <div className={s.toolbar}>
          <div className={s.searchBox}>
            <IcSearch size={16} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar alias, razón social, RFC, banco..."
              aria-label="Buscar proveedores"
            />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)} aria-label="Filtrar por estatus">
            <option value="todos">Estatus: Todos</option>
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
          </select>
        </div>

        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Alias</th>
                <th>Nombre completo</th>
                <th>Método</th>
                <th>Banco</th>
                <th>CLABE / Cuenta</th>
                <th>RFC</th>
                <th>Estatus</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && (
                <tr><td colSpan={8} className={s.tableMsg}>Cargando proveedores...</td></tr>
              )}
              {status === 'error' && (
                <tr><td colSpan={8} className={`${s.tableMsg} ${s.tableErr}`}>No fue posible cargar proveedores.</td></tr>
              )}
              {status === 'ready' && rows.length === 0 && (
                <tr><td colSpan={8} className={s.tableMsg}>No se encontraron proveedores.</td></tr>
              )}
              {status === 'ready' && rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.alias ?? ''}</strong>
                    {p.es_personal_eventual && <> <Badge variant="info">Personal eventual</Badge></>}
                  </td>
                  <td>{p.nombre_completo ?? ''}</td>
                  <td>{p.metodo_pago ?? ''}</td>
                  <td>{p.banco ?? ''}</td>
                  <td>
                    {(p.clabe || p.cuenta_bancaria) && (
                      <span className={s.clabeNum}>{p.clabe || p.cuenta_bancaria}</span>
                    )}
                    {p.tipo_cuenta && <span className={s.clabeLabel}>{p.tipo_cuenta}</span>}
                  </td>
                  <td>{p.rfc ?? ''}</td>
                  <td><Badge variant={p.activo ? 'success' : 'neutral'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge></td>
                  <td>
                    {canManage ? (
                      <div className={s.rowActions}>
                        <button className={s.smallBtn} onClick={() => openEdit(p)}>Editar</button>
                        {p.activo ? (
                          <button className={`${s.smallBtn} ${s.danger}`} onClick={() => toggle(p, false)}>Desactivar</button>
                        ) : (
                          <button className={s.smallBtn} onClick={() => toggle(p, true)}>Reactivar</button>
                        )}
                      </div>
                    ) : (
                      <span className={s.hint}>Solo lectura</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <ProviderModal
          mode={modal.mode}
          provider={modal.provider}
          canManageProviders={canManageProviders()}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            reload()
          }}
        />
      )}
    </>
  )
}
