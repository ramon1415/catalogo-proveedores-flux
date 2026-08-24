import {
  SYSTEM_PDF_GENERATOR,
  generateApprovalBatchPdfBytes,
  systemCompanyName,
  systemFormatDate,
} from "./system_pdf.ts";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function fileStem(batch) {
  const company = String(systemCompanyName(batch) || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `corte-semanal-${company}-${systemFormatDate(batch?.period_end)}`;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareApprovalBatchAttachment(document) {
  const { bytes, pageCount } = generateApprovalBatchPdfBytes(document);
  if (bytes.length < 100 || bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new Error("approval_batch_pdf_size_invalid");
  }
  const signature = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!signature.startsWith("%PDF-1.")) {
    throw new Error("approval_batch_pdf_signature_invalid");
  }
  return {
    filename: `${fileStem(document.batch)}.pdf`,
    content: bytesToBase64(bytes),
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    pageCount,
    generator: SYSTEM_PDF_GENERATOR,
  };
}
