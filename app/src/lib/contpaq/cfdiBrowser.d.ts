// Tipos del parser certificado del módulo CONTPAQ (vendored de
// carlosquantta/flux-contpaq-export, src/parsers/cfdiBrowser.js + cfdiCore.js).
// La lógica fiscal vive en el módulo; aquí solo se declara la superficie.
export type CfdiParsed = {
  version: string | null
  comprobante: Record<string, unknown>
  emisor: Record<string, unknown> | null
  receptor: Record<string, unknown> | null
  impuestos: Record<string, unknown> | null
  uuid: string | null
  cfdiRelacionados: unknown[]
  pagos: unknown[] | null
  nomina: Record<string, unknown> | null
}

export function parseCfdiXml(xmlString: string): CfdiParsed
export class CfdiParseError extends Error {}
