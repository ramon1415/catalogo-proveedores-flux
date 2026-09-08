type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (opts: { data: ArrayBuffer | Uint8Array; isEvalSupported: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: PdfTextItem[] }> }>
      destroy: () => Promise<void>
    }>
  }
}

type PdfTextItem = { str?: string; transform?: number[]; hasEOL?: boolean }

const PDFJS_SRC = '/pdfjs-3.11.174.min.js?v=20260723-vendored-root'
const PDF_WORKER = '/pdfjs-worker-3.11.174.min.js?v=20260723-vendored-root'

let pdfjsPromise: Promise<PdfJsModule> | null = null

function loadPdfjs(): Promise<PdfJsModule> {
  if (pdfjsPromise) return pdfjsPromise
  pdfjsPromise = new Promise((resolve, reject) => {
    const existing = (window as { pdfjsLib?: PdfJsModule }).pdfjsLib
    if (existing) {
      existing.GlobalWorkerOptions.workerSrc = PDF_WORKER
      resolve(existing)
      return
    }

    const element = document.createElement('script')
    element.src = PDFJS_SRC
    element.onload = () => {
      const lib = (window as { pdfjsLib?: PdfJsModule }).pdfjsLib
      if (!lib) {
        pdfjsPromise = null
        reject(new Error('pdfjs_unavailable'))
        return
      }
      lib.GlobalWorkerOptions.workerSrc = PDF_WORKER
      resolve(lib)
    }
    element.onerror = () => {
      pdfjsPromise = null
      reject(new Error('pdfjs_unavailable'))
    }
    document.head.appendChild(element)
  })
  return pdfjsPromise
}

export async function extractPdfText(file: File, maxPages = 3): Promise<string> {
  const pdfjs = await loadPdfjs()
  const bytes = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise
  const parts: string[] = []
  const pages = Math.min(pdf.numPages, maxPages)
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    parts.push(content.items.map((item) => item.str || '').join(' '))
  }
  return parts.join('\n')
}

// Preserve label/value rows and inspect the entire receipt. Silently truncating
// a multi-page receipt could hide a second payment or a conflicting amount.
export async function extractPdfLines(file: File, maxPages = 20): Promise<string[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('invalid_pdf_signature')
  const pdfjs = await loadPdfjs()
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  try {
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) throw new Error('receipt_page_limit')
    const lines: string[] = []
    let characters = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const { items } = await page.getTextContent()
      const rows: { y: number; parts: { x: number; text: string }[] }[] = []
      for (const item of items) {
        const text = (item.str || '').trim()
        if (!text) continue
        characters += text.length
        if (characters > 300_000) throw new Error('receipt_text_limit')
        const y = item.transform?.[5]
        const x = item.transform?.[4] || 0
        if (typeof y !== 'number') { lines.push(text); continue }
        let row = rows.find((candidate) => Math.abs(candidate.y - y) < 2)
        if (!row) { row = { y, parts: [] }; rows.push(row) }
        row.parts.push({ x, text })
      }
      lines.push(...rows.sort((a, b) => b.y - a.y).map((row) => row.parts.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ')), '')
    }
    return lines
  } finally {
    await pdf.destroy()
  }
}
