import { useEffect, useState } from 'react'
import { useToast } from '../../../components/ui/Toast'
import { Badge } from '../../../components/ui/Badge'
import { loadOriginData, toggleOriginAccount } from '../api'
import { originCompanyName, originRlsMessage } from '../logic'
import { OriginAccountModal } from '../OriginAccountModal'
import type { Company, OriginAccount } from '../types'
import s from '../Configuracion.module.css'

export function OriginAccountsTab() {
  const { showToast } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [accounts, setAccounts] = useState<OriginAccount[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [modal, setModal] = useState<{ account: OriginAccount | null } | null>(null)

  async function reload() {
    setStatus('loading')
    try {
      const { companies: cs, accounts: acs } = await loadOriginData()
      setCompanies(cs)
      setAccounts(acs)
      setStatus('ready')
    } catch (error: any) {
      setErrorMsg(originRlsMessage(error, 'select'))
      setStatus('error')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function toggle(account: OriginAccount, active: boolean) {
    const ok = window.confirm(
      active ? 'Seguro que deseas reactivar esta cuenta origen?' : 'Seguro que deseas inactivar esta cuenta origen?',
    )
    if (!ok) return
    try {
      await toggleOriginAccount(account.id, active)
      showToast(active ? 'Cuenta reactivada' : 'Cuenta inactivada', '', 'success')
      await reload()
    } catch (error: any) {
      showToast('Error al actualizar', originRlsMessage(error, 'update'), 'error')
    }
  }

  return (
    <div className={s.panel}>
      <div className={`${s.notice} ${s.info}`}>
        <span className={s.noticeIcon}>·</span>
        <span>
          <span className={s.noticeTitle}>Cuentas origen</span> —{' '}
          <span className={s.noticeDesc}>
            Son las cuentas bancarias de la empresa desde las que se realizan pagos. No son cuentas del proveedor.
          </span>
        </span>
      </div>

      <section className={s.tableCard}>
        <div className={s.panelToolbar}>
          <div>
            <h2>Cuentas origen</h2>
            <p>Estas cuentas alimentan solicitudes y layouts de pago.</p>
          </div>
          <button className={s.primaryBtn} onClick={() => setModal({ account: null })}>+ Nueva cuenta origen</button>
        </div>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Empresa</th>
                <th>Nombre de cuenta</th>
                <th>Banco</th>
                <th>Numero de cuenta</th>
                <th>CLABE</th>
                <th>Moneda</th>
                <th>Estatus</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {status === 'loading' && (
                <tr><td colSpan={8} className={s.tableMsg}>Cargando cuentas origen...</td></tr>
              )}
              {status === 'error' && (
                <tr><td colSpan={8} className={`${s.tableMsg} ${s.tableErr}`}>{errorMsg}</td></tr>
              )}
              {status === 'ready' && accounts.length === 0 && (
                <tr><td colSpan={8} className={s.tableMsg}>No hay cuentas origen capturadas.</td></tr>
              )}
              {status === 'ready' && accounts.map((account) => {
                const company = companies.find((c) => c.id === account.company_id)
                return (
                  <tr key={account.id}>
                    <td><strong>{originCompanyName(company)}</strong></td>
                    <td>{account.name || ''}</td>
                    <td>{account.bank_name || ''}</td>
                    <td><span className={s.clabeNum}>{account.account_number || ''}</span></td>
                    <td>{account.clabe || ''}</td>
                    <td>{account.currency || 'MXN'}</td>
                    <td>
                      <Badge variant={account.active === false ? 'neutral' : 'success'}>
                        {account.active === false ? 'Inactiva' : 'Activa'}
                      </Badge>
                    </td>
                    <td>
                      <div className={s.rowActions}>
                        <button className={s.smallBtn} onClick={() => setModal({ account })}>Editar</button>
                        {account.active === false ? (
                          <button className={s.smallBtn} onClick={() => toggle(account, true)}>Reactivar</button>
                        ) : (
                          <button className={`${s.smallBtn} ${s.danger}`} onClick={() => toggle(account, false)}>Inactivar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {modal && (
        <OriginAccountModal
          account={modal.account}
          companies={companies}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            showToast('Cuenta origen guardada', 'Los datos se guardaron correctamente.', 'success')
            reload()
          }}
        />
      )}
    </div>
  )
}
