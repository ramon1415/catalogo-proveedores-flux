import { SYSTEM_PDF_LOGO_DATA_URL } from "./pdf_logo.ts";

export function addEmbeddedSystemPdfLogo(doc) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.addImage(SYSTEM_PDF_LOGO_DATA_URL, "PNG", pageWidth - 36 - 80, 22, 80, 32);
  return doc;
}
