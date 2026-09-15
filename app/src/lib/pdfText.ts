import type { Block, Worker as OcrWorker } from 'tesseract.js'

type PdfPage = {
  getTextContent: () => Promise<{ items: PdfTextItem[] }>
  getViewport: (options: { scale: number }) => { width: number; height: number }
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number }; background: string }) => { promise: Promise<void>; cancel: () => void }
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>
}
type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  OPS?: { paintImageXObject: number; paintInlineImageXObject: number }
  getDocument: (opts: { data: ArrayBuffer | Uint8Array; isEvalSupported: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<PdfPage>
      destroy: () => Promise<void>
    }>
  }
}

type ReceiptReadOptions = {
  ocr?: boolean
  signal?: AbortSignal
  onOcrProgress?: (page: number, pages: number) => void
}

export const RECEIPT_OCR_ASSETS = '/ocr/tesseract-6.0.1-spa-1.0.0'

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('receipt_read_cancelled'))
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

// OCR can return a two-column receipt in column order. Rebuild visible rows
// using word positions, just as we do with native PDF text below.
export function ocrWordsToLines(blocks: Block[] | null): string[] {
  const rows: { y: number; height: number; words: { x: number; text: string }[] }[] = []
  const words = (blocks || []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words)))
  for (const word of words.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)) {
    if (!word.text.trim()) continue
    const y = (word.bbox.y0 + word.bbox.y1) / 2
    const height = word.bbox.y1 - word.bbox.y0
    let row = rows.find((candidate) => Math.abs(candidate.y - y) <= Math.min(candidate.height, height) * 0.5)
    if (!row) { row = { y, height, words: [] }; rows.push(row) }
    // Keep an unreadable token in place rather than silently dropping a digit
    // and turning it into a different amount or reference.
    row.words.push({ x: word.bbox.x0, text: word.confidence < 50 ? '[ilegible]' : word.text })
  }
  return rows.sort((a, b) => a.y - b.y).map((row) => row.words.sort((a, b) => a.x - b.x).map((word) => word.text).join(' '))
}

async function hasReceiptImage(page: PdfPage, pdfjs: PdfJsModule): Promise<boolean> {
  if (!pdfjs.OPS) return false
  const operators = await page.getOperatorList()
  return operators.fnArray.some((op, i) => {
    const args = operators.argsArray[i]
    if (op === pdfjs.OPS!.paintImageXObject) return Number(args[1]) * Number(args[2]) >= 500_000
    if (op === pdfjs.OPS!.paintInlineImageXObject) {
      const image = args[0] as { width?: number; height?: number }
      return Number(image.width) * Number(image.height) >= 500_000
    }
    return false
  })
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
export async function extractPdfLines(file: File, maxPages = 20, options: ReceiptReadOptions = {}): Promise<string[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('invalid_pdf_signature')
  const pdfjs = await loadPdfjs()
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise
  let workerPromise: Promise<OcrWorker> | undefined
  let disposed = false
  const disposeOcr = () => {
    if (disposed) return
    disposed = true
    if (workerPromise) void workerPromise.then((worker) => worker.terminate()).catch(() => {})
  }
  options.signal?.addEventListener('abort', disposeOcr, { once: true })
  try {
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > maxPages) throw new Error('receipt_page_limit')
    const lines: string[] = []
    let characters = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      options.signal?.throwIfAborted()
      const page = await pdf.getPage(pageNumber)
      const { items } = await page.getTextContent()
      const nativeCharacters = items.reduce((sum, item) => sum + (item.str || '').trim().length, 0)
      if (options.ocr && (nativeCharacters < 80 || await hasReceiptImage(page, pdfjs))) {
        options.onOcrProgress?.(pageNumber, pdf.numPages)
        if (!workerPromise) {
          const { createWorker, PSM } = await import('tesseract.js')
          options.signal?.throwIfAborted()
          workerPromise = createWorker('spa', 1, {
            workerPath: `${RECEIPT_OCR_ASSETS}/worker.min.js`,
            corePath: RECEIPT_OCR_ASSETS,
            langPath: RECEIPT_OCR_ASSETS,
            workerBlobURL: false,
            cacheMethod: 'none',
            // Let the read promise/timeout show the inline fallback instead
            // of Tesseract's default uncaught worker error.
            errorHandler: () => {},
          }).then(async (worker) => {
            try {
              if (!disposed) await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, user_defined_dpi: '180' })
              return worker
            } catch (error) { await worker.terminate(); throw error }
          })
        }
        const worker = await withAbort(workerPromise, options.signal)
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height))
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('receipt_image_unavailable')
        const render = page.render({ canvasContext: context, viewport, background: '#ffffff' })
        const cancelRender = () => render.cancel()
        options.signal?.addEventListener('abort', cancelRender, { once: true })
        try {
          await withAbort(render.promise, options.signal)
          const { data } = await withAbort(worker.recognize(canvas, {}, { text: true, blocks: true }), options.signal)
          const imageLines = ocrWordsToLines(data.blocks)
          characters += imageLines.join('').length
          if (characters > 300_000) throw new Error('receipt_text_limit')
          if (!imageLines.length) throw new Error('receipt_image_unreadable')
          lines.push(...imageLines, '')
        } finally {
          options.signal?.removeEventListener('abort', cancelRender)
          canvas.width = canvas.height = 0
        }
        continue
      }
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
    disposeOcr()
    options.signal?.removeEventListener('abort', disposeOcr)
    await pdf.destroy()
  }
}
