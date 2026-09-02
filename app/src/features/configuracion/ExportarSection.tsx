// FB-7 · Sub-sección "Exportar" del tab Mapeo CONTPAQ: previsualiza y genera
// el export contable del mes (pagos pagados → pólizas de egreso → .xls +
// registro en accounting_exports).
import { useEffect, useState } from 'react'
import { useToast } from '../../components/ui/Toast'
import { Badge } from '../../components/ui/Badge'
import type { MapeoEmpresa } from '../../lib/contpaq/export'
import { insertAccountingExports, loadExportLedger, loadPaidRequestsForExport } from './api'
import { errorMessage } from './logic'
import {
  agruparFaltantes,
  descargarXls,
  empresaConfigDe,
  generarExport,
  nombreArchivoExport,
  procesarPagos,
  type ResultadoPipeline,
} from './exportarPolizas'
import s from './Configuracion.module.css'

// Etiquetas humanas de las llaves de impuesto/cuentas especiales del motor.
const TAX_LABELS: Record<string, string> = {
  ivaAcreditablePagado: 'IVA acreditable pagado',
  ivaRetenidoAcreditable: 'IVA retenido acreditable',
  retIvaPasivo: 'Retención IVA (pasivo)',
  retIsrPasivo: 'Retención ISR (pasivo)',
  ajusteRedondeo: 'Ajuste por redondeo',
  noDeducibles: 'No deducibles',
}

// Dónde se arregla cada tipo de faltante (sección del propio tab).
const SECCION_DE_TIPO: Record<string, string> = {
  partida: 'sección Partidas',
  banco: 'sección Bancos',
  proveedor: 'sección Proveedores',
  impuesto: 'sección Impuestos',
}

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

type Props = {
  companyId: string | null
  companyName: string
  mapeo: MapeoEmpresa
  // Etiquetas para mostrar faltantes con nombre y no solo uuid.
  nombrePartida: Map<string, string>
  nombreBanco: Map<string, string>
  nombreProveedor: Map<string, string>
}

type PreviewState = {
  resultado: ResultadoPipeline
  foliosPorTipo: Record<string, number>
  mes: string
}

export function ExportarSection({ companyId, companyName, mapeo, nombrePartida, nombreBanco, nombreProveedor }: Props) {
  const { showToast } = useToast()
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7))
  const [busy, setBusy] = useState<'preview' | 'export' | null>(null)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const config = companyId ? empresaConfigDe(companyId) : null

  // La previsualización caduca si cambia empresa, mes o algún mapeo.
  useEffect(() => {
    setPreview(null)
    setError(null)
  }, [companyId, mes, mapeo])

  function rangoMes(m: string): { inicio: string; fin: string } {
    const [y, mm] = m.split('-').map(Number)
    const fin = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, '0')}-01`
    return { inicio: `${m}-01`, fin }
  }

  async function previsualizar() {
    if (!companyId || !config) return
    setBusy('preview')
    setError(null)
    try {
      const { inicio, fin } = rangoMes(mes)
      const rows = await loadPaidRequestsForExport(companyId, inicio, fin)
      const { exportadosIds, foliosPorTipo } = await loadExportLedger(companyId, inicio, rows.map((r) => r.id))
      const resultado = procesarPagos(rows, mapeo, config, exportadosIds)
      setPreview({ resultado, foliosPorTipo, mes })
    } catch (err: unknown) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  async function exportar() {
    if (!preview || !companyId || !config) return
    const { listos } = preview.resultado
    if (!listos.length) return
    setBusy('export')
    let descargado = false
    try {
      const gen = generarExport(listos, config, preview.mes, preview.foliosPorTipo)
      // Primero el archivo, luego el ledger: si el insert falla, el usuario
      // ya tiene el .xls y se le avisa que el registro quedó pendiente.
      descargarXls(gen.filas, nombreArchivoExport(companyName, preview.mes))
      descargado = true
      await insertAccountingExports(gen.ledgerRows)
      showToast('Export generado', `${gen.ledgerRows.length} póliza(s) descargadas y registradas en el ledger.`, 'success')
      setPreview(null)
    } catch (err: unknown) {
      if (descargado) {
        showToast(
          'Archivo descargado, registro pendiente',
          `El .xls ya se descargó, pero el registro en accounting_exports falló: ${errorMessage(err)}. ` +
            'No importes el archivo a CONTPAQ hasta resolverlo — sin ledger, un re-export duplicaría las pólizas.',
          'error',
        )
      } else {
        showToast('No se pudo exportar', errorMessage(err), 'error')
      }
    } finally {
      setBusy(null)
    }
  }

  function nombreFaltante(tipo: string, id: string): string {
    if (tipo === 'partida') return nombrePartida.get(id) ?? id
    if (tipo === 'banco') return nombreBanco.get(id) ?? id
    if (tipo === 'proveedor') return nombreProveedor.get(id) ?? id
    if (tipo === 'impuesto') return TAX_LABELS[id] ?? id
    return id
  }

  const resultado = preview?.resultado ?? null
  const problemasMapeo = resultado?.problemas.filter((p) => p.kind === 'mapeo') ?? []
  const problemasDatos = resultado?.problemas.filter((p) => p.kind === 'datos') ?? []
  const faltantes = agruparFaltantes(problemasMapeo)
  const listos = resultado?.listos ?? []
  const sumaListos = listos.reduce((acc, p) => acc + p.monto, 0)
  const elegibles = resultado ? listos.length + resultado.problemas.length : 0
  const puedeExportar = Boolean(resultado && listos.length > 0 && resultado.problemas.length === 0 && !busy)

  return (
    <section className={s.tableCard}>
      <div className={s.panelToolbar}>
        <div>
          <h2>Exportar pólizas a CONTPAQ</h2>
          <div className={s.mapperCounter}>
            Pagos pagados del mes → pólizas de egreso (modo egreso-directo) → archivo .xls listo para importar.
          </div>
        </div>
        <div className={s.mapperControls}>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className={s.mapInput}
            style={{ width: 'auto' }}
            disabled={busy !== null}
          />
          <button type="button" className={s.secondaryBtn} onClick={previsualizar} disabled={busy !== null || !config}>
            {busy === 'preview' ? 'Calculando...' : 'Previsualizar'}
          </button>
          <button type="button" className={s.primaryBtn} onClick={exportar} disabled={!puedeExportar}>
            {busy === 'export' ? 'Exportando...' : `Exportar ${listos.length || ''} póliza${listos.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>

      {!config && (
        <div className={s.tableMsg}>
          Esta empresa aún no tiene configuración de export CONTPAQ certificada — por ahora solo Operadora y Soporte
          Fersana.
        </div>
      )}

      {config && error && <div className={`${s.tableMsg} ${s.tableErr}`}>{error}</div>}

      {config && !error && !resultado && (
        <div className={s.tableMsg}>
          {busy === 'preview'
            ? 'Corriendo el pipeline (sin escribir nada)...'
            : 'Elige el mes y presiona "Previsualizar" para ver qué se exportaría.'}
        </div>
      )}

      {config && resultado && (
        <>
          {/* Resumen del mes previsualizado */}
          <div className={s.panelToolbar} style={{ borderTop: 0 }}>
            <div className={s.mapperCounter}>
              {elegibles} pago{elegibles === 1 ? '' : 's'} elegible{elegibles === 1 ? '' : 's'} en {preview!.mes} ·{' '}
              {listos.length} póliza{listos.length === 1 ? '' : 's'} lista{listos.length === 1 ? '' : 's'} ·{' '}
              suma {money.format(sumaListos)}
              {resultado.yaExportados.length > 0 && ` · ${resultado.yaExportados.length} ya exportado(s) (se excluyen)`}
            </div>
          </div>

          {/* Faltantes de mapeo, agrupados y accionables */}
          {faltantes.total > 0 && (
            <div className={s.panelToolbar} style={{ display: 'block', borderTop: 0 }}>
              <div className={s.tableErr} style={{ fontWeight: 600, marginBottom: 6 }}>
                {faltantes.total} mapeo{faltantes.total === 1 ? '' : 's'} sin asignar — asígnalos en este mismo tab y
                vuelve a previsualizar:
              </div>
              {[...faltantes.porTipo.entries()].map(([tipo, ids]) => (
                <div key={tipo} style={{ marginBottom: 4 }}>
                  <span className={s.cellMain} style={{ textTransform: 'capitalize' }}>{tipo}</span>{' '}
                  <span className={s.hint}>({SECCION_DE_TIPO[tipo] ?? 'este tab'})</span>
                  <ul style={{ margin: '2px 0 0 18px', padding: 0 }}>
                    {[...ids].map((id) => (
                      <li key={id} style={{ fontSize: 12 }}>{nombreFaltante(tipo, id)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {/* Detalle por pago */}
          <div className={s.mapperWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Solicitud</th>
                  <th>Proveedor</th>
                  <th>Pagado</th>
                  <th style={{ textAlign: 'right' }}>Monto</th>
                  <th>CFDI</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {elegibles === 0 && resultado.yaExportados.length === 0 && (
                  <tr>
                    <td colSpan={6} className={s.tableMsg}>
                      No hay pagos pagados de esta empresa en {preview!.mes}.
                    </td>
                  </tr>
                )}
                {listos.map((p) => (
                  <tr key={p.row.id}>
                    <td><span className={s.cellMain}>{p.row.request_number || p.row.id.slice(0, 8)}</span></td>
                    <td>{p.row.proveedores?.nombre_completo || '—'}</td>
                    <td>{(p.row.paid_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>{money.format(p.monto)}</td>
                    <td>{p.row.cfdi_data ? 'Con CFDI' : 'Sin CFDI'}</td>
                    <td><Badge variant="success">Lista</Badge></td>
                  </tr>
                ))}
                {problemasMapeo.map((p) => (
                  <tr key={p.row.id} className={s.rowUnmapped}>
                    <td><span className={s.cellMain}>{p.row.request_number || p.row.id.slice(0, 8)}</span></td>
                    <td>{p.row.proveedores?.nombre_completo || '—'}</td>
                    <td>{(p.row.paid_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>{money.format(Number(p.row.amount_requested) || 0)}</td>
                    <td>{p.row.cfdi_data ? 'Con CFDI' : 'Sin CFDI'}</td>
                    <td>
                      <span title={p.faltantes.join('\n')} style={{ cursor: 'help' }}>
                        <Badge variant="warning">Faltan mapeos ({p.faltantes.length})</Badge>
                      </span>
                    </td>
                  </tr>
                ))}
                {problemasDatos.map((p) => (
                  <tr key={p.row.id} className={s.rowUnmapped}>
                    <td><span className={s.cellMain}>{p.row.request_number || p.row.id.slice(0, 8)}</span></td>
                    <td>{p.row.proveedores?.nombre_completo || '—'}</td>
                    <td>{(p.row.paid_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>{money.format(Number(p.row.amount_requested) || 0)}</td>
                    <td>{p.row.cfdi_data ? 'Con CFDI' : 'Sin CFDI'}</td>
                    <td>
                      <span title={p.mensaje} style={{ cursor: 'help' }}>
                        <Badge variant="warning">Datos incompletos</Badge>
                      </span>
                    </td>
                  </tr>
                ))}
                {resultado.yaExportados.map((row) => (
                  <tr key={row.id}>
                    <td><span className={s.cellMain}>{row.request_number || row.id.slice(0, 8)}</span></td>
                    <td>{row.proveedores?.nombre_completo || '—'}</td>
                    <td>{(row.paid_at || '').slice(0, 10)}</td>
                    <td style={{ textAlign: 'right' }}>{money.format(Number(row.amount_requested) || 0)}</td>
                    <td>{row.cfdi_data ? 'Con CFDI' : 'Sin CFDI'}</td>
                    <td><Badge variant="neutral">Ya exportado</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
