type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument: (opts: { data: ArrayBuffer | Uint8Array; isEvalSupported: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>
    }>
  }
}

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
