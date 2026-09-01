// Carga perezosa de los scripts vendored del sitio raíz (los mismos que usa el
// vanilla): pdfjs + pdf-lib + parser BBVA + derivador de página única. El
// parser y la derivación corren SIEMPRE en el navegador; el servidor nunca
// recibe el PDF por página.
type ParserModule = {
  PARSER_VERSION: string
  parseBbvaDocument: (pages: { pageNumber: number; text: string }[], opts: { fileName: string }) => {
    page_count: number
    operations: Record<string, unknown>[]
  }
  parseMoneyToMinor: (value: string) => number | null
  formatMinorForDisplay: (minor: number, currency?: string) => string
}

type SinglePageModule = {
  deriveSinglePageFromUrl: (opts: { sourceUrl: string; pageNumber: number; pdfLib: unknown }) => Promise<Uint8Array>
  assertSinglePageBytes: (bytes: Uint8Array, pdfLib?: unknown) => Promise<void>
}

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (opts: { data: ArrayBuffer | Uint8Array; isEvalSupported: boolean }) => { promise: Promise<PdfDocument> }
}

export type PdfDocument = {
  numPages: number
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>
}

type PdfRuntime = {
  parser: ParserModule
  singlePage: SinglePageModule
  pdfjs: PdfJsModule
  pdfLib: unknown
}

const SCRIPTS = [
  '/pdfjs-3.11.174.min.js?v=20260723-vendored-root',
  '/pdf-lib-1.17.1.min.js?v=20260723-vendored-root',
  '/payment_batch_parser.js?v=20260721-v1',
  '/payment_batch_single_page_pdf.js?v=20260723-one-to-one',
]

const PDF_WORKER = '/pdfjs-worker-3.11.174.min.js?v=20260723-vendored-root'

let runtimePromise: Promise<PdfRuntime> | null = null

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return }
    const el = document.createElement('script')
    el.src = src
    el.async = false // preservar orden: pdfjs/pdf-lib antes que sus consumidores
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`script_load_failed:${src}`))
    document.head.appendChild(el)
  })
}

export function loadPdfRuntime(): Promise<PdfRuntime> {
  if (runtimePromise) return runtimePromise
  runtimePromise = (async () => {
    for (const src of SCRIPTS) await injectScript(src)
    const w = window as unknown as {
      pdfjsLib?: PdfJsModule
      PDFLib?: unknown
      FluxPaymentBatchParser?: ParserModule
      FluxSinglePagePdf?: SinglePageModule
    }
    if (!w.pdfjsLib || !w.PDFLib || !w.FluxPaymentBatchParser || !w.FluxSinglePagePdf) {
      runtimePromise = null
      throw new Error('pdf_runtime_unavailable')
    }
    w.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER
    return { parser: w.FluxPaymentBatchParser, singlePage: w.FluxSinglePagePdf, pdfjs: w.pdfjsLib, pdfLib: w.PDFLib }
  })()
  return runtimePromise
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function hasPdfSignature(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 5))
  return head.length === 5 && String.fromCharCode(...head) === '%PDF-'
}
