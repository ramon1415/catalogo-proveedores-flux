;(function singlePageReceiptPdf(root) {
  "use strict"

  async function fetchPdfBytes(url, fetchImpl = root.fetch) {
    if (typeof fetchImpl !== "function") throw new Error("pdf_fetch_unavailable")
    const response = await fetchImpl(url, {
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
    })
    if (!response?.ok) throw new Error("pdf_download_failed")
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase()
    if (contentType && !contentType.includes("application/pdf")) {
      throw new Error("pdf_content_type_invalid")
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < 5
      || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
      throw new Error("pdf_signature_invalid")
    }
    return bytes
  }

  async function assertSinglePageBytes(bytes, pdfLib = root.PDFLib) {
    if (!pdfLib?.PDFDocument?.load) throw new Error("pdf_lib_unavailable")
    const document = await pdfLib.PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    })
    if (document.getPageCount() !== 1) throw new Error("individual_receipt_must_have_one_page")
    return true
  }

  async function downloadAndVerifySinglePage(url, options = {}) {
    const bytes = await fetchPdfBytes(url, options.fetchImpl)
    await assertSinglePageBytes(bytes, options.pdfLib)
    return bytes
  }

  async function deriveSinglePageFromUrl({
    sourceUrl,
    pageNumber,
    pdfLib = root.PDFLib,
    fetchImpl = root.fetch,
  }) {
    if (!pdfLib?.PDFDocument?.load || !pdfLib?.PDFDocument?.create) {
      throw new Error("pdf_lib_unavailable")
    }
    const sourceBytes = await fetchPdfBytes(sourceUrl, fetchImpl)
    const source = await pdfLib.PDFDocument.load(sourceBytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    })
    const pageIndex = Number(pageNumber) - 1
    if (!Number.isInteger(pageIndex)
      || pageIndex < 0
      || pageIndex >= source.getPageCount()) {
      throw new Error("source_page_out_of_range")
    }
    const target = await pdfLib.PDFDocument.create()
    const [page] = await target.copyPages(source, [pageIndex])
    target.addPage(page)
    target.setTitle("Comprobante bancario individual")
    target.setSubject("Evidencia de pago de una sola página")
    target.setCreator("Flux Operadora")
    target.setProducer("Flux Operadora")
    const derived = new Uint8Array(await target.save({
      addDefaultPage: false,
      useObjectStreams: false,
      updateFieldAppearances: false,
    }))
    await assertSinglePageBytes(derived, pdfLib)
    return derived
  }

  root.FluxSinglePagePdf = Object.freeze({
    assertSinglePageBytes,
    deriveSinglePageFromUrl,
    downloadAndVerifySinglePage,
    fetchPdfBytes,
  })
})(typeof window === "undefined" ? globalThis : window)
