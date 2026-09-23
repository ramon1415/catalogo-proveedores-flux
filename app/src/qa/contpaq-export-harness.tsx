import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ToastProvider } from '../components/ui/Toast'
import { ExportarSection } from '../features/configuracion/ExportarSection'
import type { MapeoEmpresa } from '../lib/contpaq/export'
import '../theme/tokens.css'

type Fixture = {
  companyId: string
  companyName: string
  row: {
    budget_category_id: string
    company_bank_account_id: string
    proveedor_id: string
  }
  mappings: {
    expense: string
    bank: string
    provider: string
    providerTerceroId: string
    ivaPendiente: string
    ivaPagado: string
  }
  names: {
    budget: string
    bank: string
    provider: string
  }
}

function Harness() {
  const [fixture, setFixture] = useState<Fixture | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/qa-contpaq-fixture.json')
      .then((r) => {
        if (!r.ok) throw new Error('No se pudo cargar fixture QA')
        return r.json()
      })
      .then(setFixture)
      .catch((e) => setError(String(e)))
  }, [])

  const mapeo = useMemo<MapeoEmpresa | null>(() => {
    if (!fixture) return null
    return {
      partida: { [fixture.row.budget_category_id]: fixture.mappings.expense },
      banco: { [fixture.row.company_bank_account_id]: fixture.mappings.bank },
      proveedor: {
        [fixture.row.proveedor_id]: {
          cuenta: fixture.mappings.provider,
          idProveedor: fixture.mappings.providerTerceroId,
        },
      },
      impuesto: {
        ivaAcreditablePagado: fixture.mappings.ivaPagado,
        ivaAcreditablePendiente: fixture.mappings.ivaPendiente,
      },
    }
  }, [fixture])

  if (error) return <pre>{error}</pre>
  if (!fixture || !mapeo) return <div>Cargando fixture F-11705…</div>

  return (
    <div style={{ padding: 24 }}>
      <h1>QA F-11705 · UI real Exportar CONTPAQ</h1>
      <ExportarSection
        companyId={fixture.companyId}
        companyName={fixture.companyName}
        mapeo={mapeo}
        nombrePartida={new Map([[fixture.row.budget_category_id, fixture.names.budget]])}
        nombreBanco={new Map([[fixture.row.company_bank_account_id, fixture.names.bank]])}
        nombreProveedor={new Map([[fixture.row.proveedor_id, fixture.names.provider]])}
      />
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <Harness />
    </ToastProvider>
  </React.StrictMode>,
)
