// Tipos laxos del motor vendorizado. La verdad del contrato vive en el JS
// certificado (golden tests en flux-contpaq-export); aquí solo la superficie
// que consume la app. Se tipa con unknown/Record para no duplicar el esquema.
export type Contrato = Record<string, unknown>
export type Asiento = { cuenta: string; tipoMovto: 'cargo' | 'abono'; importe: number; referencia: string; concepto: string }
export type MapeoEmpresa = {
  partida: Record<string, string>
  banco: Record<string, string>
  proveedor?: Record<string, { cuenta: string; idProveedor: number | string }>
  impuesto: {
    ivaAcreditablePagado?: string
    ivaRetenidoAcreditable?: string
    retIvaPasivo?: string
    retIsrPasivo?: string
  }
  cuentasEspeciales?: { ajusteRedondeo?: string; noDeducibles?: string }
}
export type EmpresaConfig = Record<string, unknown>
export type Poliza = { header: unknown[]; registros: unknown[][] } & Record<string, unknown>

export class ContratoError extends Error { detalles?: string[] }
export class MapeoError extends Error { faltantes?: string[] }
export class ValidacionError extends Error {}
export class CuentaError extends Error {}

export function paymentRequestAContrato(row: Record<string, unknown>, opts?: { empresa?: string }): Contrato
export function assertContrato(contrato: unknown): void
export function resolverAsientos(contrato: Contrato, mapeoEmpresa: MapeoEmpresa): Asiento[]
export function resolverFiscal(contrato: Contrato, mapeoEmpresa: MapeoEmpresa, opts?: Record<string, unknown>): Record<string, unknown>
export function buildPoliza(input: Record<string, unknown>, config: EmpresaConfig): Poliza
export function armarPolizaFiscal(input: Record<string, unknown>, config: EmpresaConfig): Poliza
export function validateCuadre(poliza: Poliza): void
export function renderLayout(polizas: Poliza[], config: EmpresaConfig): unknown[][]
export function aSerialExcel(fecha: string | Date): number
export function transformCuenta(codigo: string, config: EmpresaConfig): string
export const operadoraConfig: EmpresaConfig
export const soporteFersanaConfig: EmpresaConfig
export function crearFolioProvider(opts?: Record<string, unknown>): { siguiente: (tipo: string, periodo: string) => number }
export const FOLIO_CONFIG_DEFAULT: Record<string, unknown>
export function hashContenido(registrosPoliza: unknown[], hashFn?: (s: string) => string): string
export function planRegistro(poliza: Poliza, opts: Record<string, unknown>): Record<string, unknown>
export function yaExportado(filas: Array<Record<string, unknown>>, sourceFeeder: string, sourceId: string, kind?: string): boolean
export function sha256Sync(texto: string): string
