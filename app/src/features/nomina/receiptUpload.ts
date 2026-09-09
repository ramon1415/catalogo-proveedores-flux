// Images are embedded locally in a PDF without resampling or JPEG re-encoding.
// Storage verification, downloads and the closing email retain their PDF contract.
type EmbeddedImage = { width: number; height: number }
type PdfLibrary = {
  PDFDocument: { create: () => Promise<{
    embedJpg: (bytes: Uint8Array) => Promise<EmbeddedImage>
    embedPng: (bytes: Uint8Array) => Promise<EmbeddedImage>
    addPage: (size: [number, number]) => {
      pushOperators: (...operators: unknown[]) => void
      drawImage: (image: EmbeddedImage, options: { x: number; y: number; width: number; height: number }) => void
    }
    save: () => Promise<Uint8Array>
  }> }
  pushGraphicsState: () => unknown
  popGraphicsState: () => unknown
  concatTransformationMatrix: (a: number, b: number, c: number, d: number, e: number, f: number) => unknown
}

export const RECEIPT_ACCEPT = 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png'
const MAX_BYTES = 10 * 1024 * 1024
const PDF_LIB_SRC = '/pdf-lib-1.17.1.min.js?v=20260909-image-receipts'
let libraryPromise: Promise<PdfLibrary> | undefined

function loadLibrary(): Promise<PdfLibrary> {
  const existing = (window as { PDFLib?: PdfLibrary }).PDFLib
  if (existing) return Promise.resolve(existing)
  if (libraryPromise) return libraryPromise
  libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = PDF_LIB_SRC
    const fail = () => { libraryPromise = undefined; reject(new Error('receipt_conversion_unavailable')) }
    script.onerror = fail
    script.onload = () => {
      const library = (window as { PDFLib?: PdfLibrary }).PDFLib
      if (library) resolve(library)
      else fail()
    }
    document.head.appendChild(script)
  })
  return libraryPromise
}

export function receiptSelectionError(file: File): string | null {
  if (!/\.(?:pdf|jpe?g|png)$/i.test(file.name)) return 'Selecciona un comprobante PDF, JPG o PNG.'
  if (file.size < 100 || file.size > MAX_BYTES) return 'El comprobante debe tener entre 100 bytes y 10 MB.'
  return null
}

function exifOrientation(bytes: Uint8Array, start: number, end: number): number {
  if (end - start < 14 || String.fromCharCode(...bytes.slice(start, start + 6)) !== 'Exif\0\0') return 1
  const offset = start + 6
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, end - offset)
  const order = view.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return 1
  const little = order === 0x4949
  if (view.getUint16(2, little) !== 42) return 1
  const directory = view.getUint32(4, little)
  if (directory + 2 > view.byteLength) return 1
  const count = view.getUint16(directory, little)
  for (let index = 0; index < count; index += 1) {
    const pos = directory + 2 + index * 12
    if (pos + 12 > view.byteLength) break
    if (view.getUint16(pos, little) !== 0x0112) continue
    if (view.getUint16(pos + 2, little) !== 3 || view.getUint32(pos + 4, little) !== 1) return 1
    const orientation = view.getUint16(pos + 8, little)
    return orientation >= 1 && orientation <= 8 ? orientation : 1
  }
  return 1
}

// Inspect dimensions before a decoder allocates memory for an untrusted image.
export function receiptImageInfo(bytes: Uint8Array): { format: 'jpeg' | 'png'; width: number; height: number; orientation: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0, height = 0, orientation = 1
  let format: 'jpeg' | 'png'
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) {
    format = 'png'
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) throw new Error('receipt_image_invalid')
    width = view.getUint32(16); height = view.getUint32(20)
    let ended = false
    for (let pos = 8; pos + 12 <= bytes.length;) {
      const length = view.getUint32(pos), type = view.getUint32(pos + 4)
      if (pos + length + 12 > bytes.length) throw new Error('receipt_image_invalid')
      if (type === 0x6163544c) throw new Error('receipt_image_animated') // acTL: do not hide APNG frames
      if (type === 0x49454e44) { ended = true; break }
      pos += length + 12
    }
    if (!ended) throw new Error('receipt_image_invalid')
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    format = 'jpeg'
    for (let pos = 2; pos + 4 <= bytes.length;) {
      if (bytes[pos++] !== 0xff) throw new Error('receipt_image_invalid')
      while (bytes[pos] === 0xff) pos += 1
      const marker = bytes[pos++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (pos + 2 > bytes.length) throw new Error('receipt_image_invalid')
      const length = view.getUint16(pos)
      if (length < 2 || pos + length > bytes.length) throw new Error('receipt_image_invalid')
      if (marker === 0xe1) orientation = exifOrientation(bytes, pos + 2, pos + length)
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        height = view.getUint16(pos + 3); width = view.getUint16(pos + 5)
      }
      pos += length
    }
    if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('receipt_image_invalid')
  } else throw new Error('receipt_image_invalid')
  if (!width || !height) throw new Error('receipt_image_invalid')
  if (width > 12000 || height > 12000 || width * height > 20_000_000) throw new Error('receipt_image_dimensions')
  return { format, width, height, orientation }
}

export function receiptImageMatrix(orientation: number, width: number, height: number): [number, number, number, number, number, number] {
  const transforms: Record<number, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, width, 0],
    3: [-1, 0, 0, -1, width, height], 4: [1, 0, 0, -1, 0, height],
    5: [0, -1, -1, 0, height, width], 6: [0, -1, 1, 0, 0, width],
    7: [0, 1, 1, 0, 0, 0], 8: [0, 1, -1, 0, height, 0],
  }
  return transforms[orientation] || transforms[1]
}

export async function prepareReceiptPdf(source: File, signal?: AbortSignal): Promise<{ file: File; converted: boolean }> {
  const error = receiptSelectionError(source)
  if (error) throw new Error('receipt_selection_invalid')
  signal?.throwIfAborted()
  if (/\.pdf$/i.test(source.name)) return { file: source, converted: false }
  const bytes = new Uint8Array(await source.arrayBuffer())
  const info = receiptImageInfo(bytes)
  if ((info.format === 'png') !== /\.png$/i.test(source.name)) throw new Error('receipt_image_invalid')
  signal?.throwIfAborted()
  const library = await loadLibrary()
  signal?.throwIfAborted()
  let output: Uint8Array
  try {
    const pdf = await library.PDFDocument.create()
    const image = await (info.format === 'png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes))
    signal?.throwIfAborted()
    if (image.width !== info.width || image.height !== info.height) throw new Error('receipt_image_invalid')
    const swapped = info.orientation >= 5
    const page = pdf.addPage([0.5 * (swapped ? info.height : info.width), 0.5 * (swapped ? info.width : info.height)])
    const matrix = receiptImageMatrix(info.orientation, info.width, info.height).map((value) => value * 0.5) as [number, number, number, number, number, number]
    page.pushOperators(library.pushGraphicsState(), library.concatTransformationMatrix(...matrix))
    page.drawImage(image, { x: 0, y: 0, width: info.width, height: info.height })
    page.pushOperators(library.popGraphicsState())
    output = await pdf.save()
  } catch {
    signal?.throwIfAborted()
    throw new Error('receipt_image_invalid')
  }
  signal?.throwIfAborted()
  if (output.byteLength > MAX_BYTES) throw new Error('receipt_converted_size')
  const base = source.name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\u007f/\\]/g, '_').slice(0, 160) || 'comprobante'
  return { file: new File([output.slice().buffer as ArrayBuffer], `${base}.pdf`, { type: 'application/pdf' }), converted: true }
}

export function receiptPreparationError(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'receipt_image_dimensions') return 'La imagen es demasiado grande: máximo 20 megapíxeles y 12,000 píxeles por lado. Reduce sus dimensiones y vuelve a intentarlo.'
  if (code === 'receipt_image_animated') return 'Selecciona una imagen JPG o PNG estática; no se admiten imágenes animadas.'
  if (code === 'receipt_converted_size') return 'El PDF generado supera 10 MB. Usa una imagen de menor tamaño.'
  if (code === 'receipt_conversion_unavailable') return 'No se pudo preparar la imagen. Actualiza Flux e inténtalo de nuevo, o adjunta un PDF.'
  if (code === 'receipt_read_timeout') return 'No se pudo preparar la imagen a tiempo. Usa una imagen de menor tamaño o adjunta un PDF.'
  return 'La imagen no es un JPG o PNG válido. Selecciona el archivo original o adjunta un PDF.'
}
