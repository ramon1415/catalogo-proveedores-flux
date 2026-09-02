import { extractPdfText } from './pdfText'

export type CsfData = {
  rfc: string | null
  nombre: string | null
  personaTipo: 'fisica' | 'moral' | null
  codigoPostal: string | null
  regimen: string | null
  idCif: string | null
}

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})\b/

function fieldAfter(text: string, label: RegExp): string | null {
  const match = text.match(label)
  if (!match || match.index == null) return null
  const rest = text.slice(match.index + match[0].length).replace(/^[:\s]+/, '')
  const stop = rest.search(
    /(?:RFC|CURP|Nombre\s*\(s\)|Primer\s+Apellido|Segundo\s+Apellido|Denominaci[oó]n|Raz[oó]n\s+Social|R[eé]gimen|Fecha|C[oó]digo\s+Postal|Tipo\s+de\s+Vialidad|Nombre\s+de\s+Vialidad|Entidad|Municipio|Colonia|Correo|Estatus|idCIF|:)/i,
  )
  const value = (stop >= 0 ? rest.slice(0, stop) : rest).trim()
  return value || null
}

export function parseCsfText(text: string): CsfData | null {
  const flat = text.replace(/\s+/g, ' ')
  const rfc = flat.match(RFC_RE)?.[1] ?? null
  if (!rfc && !/Constancia de Situaci[oó]n Fiscal/i.test(flat)) return null

  const personaTipo: CsfData['personaTipo'] = rfc ? (rfc.length === 12 ? 'moral' : 'fisica') : null
  let nombre: string | null = null

  if (personaTipo === 'moral') {
    nombre =
      fieldAfter(flat, /Denominaci[oó]n(?:\s*\/\s*|\s+o\s+)?Raz[oó]n\s+Social\s*/i) ??
      fieldAfter(flat, /Raz[oó]n\s+Social\s*/i)
  } else {
    const nombres = fieldAfter(flat, /Nombre\s*\(s\)\s*/i)
    const apellido1 = fieldAfter(flat, /Primer\s+Apellido\s*/i)
    const apellido2 = fieldAfter(flat, /Segundo\s+Apellido\s*/i)
    nombre = [nombres, apellido1, apellido2].filter(Boolean).join(' ').trim() || null
  }

  const codigoPostal = fieldAfter(flat, /C[oó]digo\s+Postal\s*/i)?.match(/\d{5}/)?.[0] ?? null
  const regimen = fieldAfter(flat, /R[eé]gimen(?:es)?\s*(?:Fiscal(?:es)?)?\s*/i)
  const idCif = flat.match(/idCIF[:\s]*(\d{8,13})/i)?.[1] ?? null

  if (!rfc && !nombre) return null
  return { rfc, nombre, personaTipo, codigoPostal, regimen, idCif }
}

export async function parseCsfFile(file: File): Promise<CsfData | null> {
  try {
    const text = await extractPdfText(file)
    if (!text.trim()) return null
    return parseCsfText(text)
  } catch {
    return null
  }
}
