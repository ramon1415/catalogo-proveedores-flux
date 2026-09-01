import { extractPdfText } from './pdfText'

// Parseo local de la Constancia de Situación Fiscal (SAT) para precargar el
// alta de proveedor. Heurísticas sobre el texto extraído: si el PDF es un
// escaneo sin capa de texto, devuelve null y la captura queda manual.
export type CsfData = {
  rfc: string | null
  nombre: string | null // razón social (moral) o nombre completo (física)
  personaTipo: 'fisica' | 'moral' | null
  codigoPostal: string | null
  regimen: string | null
  idCif: string | null
}

const RFC_RE = /\b([A-ZÑ&]{3,4}\d{6}[A-Z\d]{3})\b/

// Corta el valor de una etiqueta hasta la siguiente etiqueta conocida.
function fieldAfter(text: string, label: RegExp): string | null {
  const m = text.match(label)
  if (!m || m.index == null) return null
  const rest = text.slice(m.index + m[0].length)
  const stop = rest.search(/(?:RFC|CURP|Nombre\s*\(s\)|Primer\s+Apellido|Segundo\s+Apellido|Denominaci[oó]n|Raz[oó]n\s+Social|R[eé]gimen|Fecha|C[oó]digo\s+Postal|Tipo\s+de\s+Vialidad|Nombre\s+de\s+Vialidad|Entidad|Municipio|Colonia|Correo|Estatus|idCIF|:)/i)
  const value = (stop > 0 ? rest.slice(0, stop) : rest).replace(/^[:\s]+/, '').trim()
  return value || null
}

export function parseCsfText(text: string): CsfData | null {
  const flat = text.replace(/\s+/g, ' ')
  const rfc = flat.match(RFC_RE)?.[1] ?? null
  if (!rfc && !/Constancia de Situaci[oó]n Fiscal/i.test(flat)) return null

  // 12 caracteres = moral, 13 = física (regla del SAT).
  const personaTipo: CsfData['personaTipo'] = rfc ? (rfc.length === 12 ? 'moral' : 'fisica') : null

  let nombre: string | null = null
  if (personaTipo === 'moral') {
    nombre = fieldAfter(flat, /Denominaci[oó]n(?:\s*\/\s*|\s+o\s+)?Raz[oó]n\s+Social\s*/i)
      ?? fieldAfter(flat, /Raz[oó]n\s+Social\s*/i)
  } else {
    const nombres = fieldAfter(flat, /Nombre\s*\(s\)\s*/i)
    const apellido1 = fieldAfter(flat, /Primer\s+Apellido\s*/i)
    const apellido2 = fieldAfter(flat, /Segundo\s+Apellido\s*/i)
    const full = [nombres, apellido1, apellido2].filter(Boolean).join(' ').trim()
    nombre = full || null
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
