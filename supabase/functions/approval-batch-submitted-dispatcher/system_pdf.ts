import { jsPDF } from "jspdf";
import * as autoTablePackage from "jspdf-autotable";

export const SYSTEM_PDF_GENERATOR = "approval_batches.js/exportPdf@jspdf-2.5.2+autotable-3.8.4";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const FLUX_PDF_LOGO = "data:image/png;base64,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";

const autoTable =
  autoTablePackage.autoTable ||
  autoTablePackage.default?.autoTable ||
  autoTablePackage.default;

function textValue(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function systemCompanyName(batch) {
  return textValue(batch?.company_name) || textValue(batch?.company) || "No disponible";
}

function normalizeCurrency(value) {
  return String(value || "MXN").trim().toUpperCase().slice(0, 8) || "MXN";
}

export function systemFormatMoney(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: normalizeCurrency(currency),
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function systemFormatDate(value) {
  const text = textValue(value);
  return text ? text.slice(0, 10) : "-";
}

export function systemStatusLabel(status) {
  return ({
    draft: "Borrador",
    submitted: "Pendiente de decisión de Dirección",
    approved: "Dirección aprobó · pendiente de liberación",
    partially_approved: "Dirección decidió con rechazos",
    closed: "Liberado para pago",
    pending: "Pendiente",
    rejected: "Rechazada por Dirección",
    active: "Activo",
    inactive: "Inactivo",
  })[status] || String(status || "-");
}

function providerName(item) {
  return textValue(item?.provider_name) || textValue(item?.provider) || "-";
}

function requesterName(item) {
  return textValue(item?.requester_name) || "-";
}

function itemReason(item) {
  const reason = textValue(item?.reject_reason) || "-";
  const rebatch = textValue(item?.rebatch_release_note);
  return rebatch ? `${reason}\nReingreso: ${rebatch}` : reason;
}

function fileStem(batch) {
  const company = String(systemCompanyName(batch) || "empresa")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `corte-semanal-${company}-${systemFormatDate(batch?.period_end)}`;
}

function buildSystemPdfDocument(document) {
  if (typeof autoTable !== "function") throw new Error("jspdf_autotable_not_available");
  const batch = document?.batch || {};
  const items = Array.isArray(document?.items) ? document.items : [];
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  try {
    doc.addImage(FLUX_PDF_LOGO, "PNG", pageWidth - 36 - 80, 22, 80, 32);
  } catch {
    // Match approval_batches.js: PDF remains valid if image decoding fails.
  }
  doc.setTextColor(23, 45, 41);
  doc.setFontSize(15);
  doc.text(String(batch.label || "Corte semanal"), 36, 36);
  doc.setFontSize(9);
  doc.setTextColor(96, 110, 104);
  doc.text(`${systemCompanyName(batch)} | ${systemFormatDate(batch.period_start)} a ${systemFormatDate(batch.period_end)} | ${systemStatusLabel(batch.status)}`, 36, 53);

  autoTable(doc, {
    startY: 68,
    head: [["Folio", "Proveedor", "Centro / partida", "Metodo", "Monto", "Solicitante", "Decision", "Motivo"]],
    body: items.map((item) => [
      item.request_number || "-",
      providerName(item),
      `${item.cost_center || "-"}\n${item.budget_category || "-"}`,
      item.payment_method || "-",
      systemFormatMoney(item.amount, item.currency),
      requesterName(item),
      systemStatusLabel(item.director_status || "pending"),
      itemReason(item),
    ]),
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", textColor: [21, 33, 29] },
    headStyles: { fillColor: [23, 45, 41], textColor: [247, 247, 245] },
    alternateRowStyles: { fillColor: [244, 246, 241] },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(150, 160, 155);
      doc.text("Flux Operadora — corte semanal", 36, doc.internal.pageSize.getHeight() - 18);
    },
  });
  return doc;
}

export function generateApprovalBatchPdfBytes(document) {
  const doc = buildSystemPdfDocument(document);
  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pageCount: doc.getNumberOfPages(),
  };
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
  if (bytes.length < 100 || bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("approval_batch_pdf_size_invalid");
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "%PDF-1.") throw new Error("approval_batch_pdf_signature_invalid");
  return {
    filename: `${fileStem(document.batch)}.pdf`,
    content: bytesToBase64(bytes),
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    pageCount,
    generator: SYSTEM_PDF_GENERATOR,
  };
}
