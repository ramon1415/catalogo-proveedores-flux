import { jsPDF } from "jspdf";
import autoTableModule from "jspdf-autotable";

const autoTableCandidates: unknown[] = [
  autoTableModule,
  (autoTableModule as unknown as { default?: unknown }).default,
  (autoTableModule as unknown as { autoTable?: unknown }).autoTable,
];
const autoTable = autoTableCandidates.find((candidate) => typeof candidate === "function") as
  | ((doc: jsPDF, options: Record<string, unknown>) => void)
  | undefined;

type NotificationEvent = {
  id: string;
  event_type: string;
  source_table: string | null;
  source_id: string | null;
  source_folio: string | null;
  recipient_type: string;
  recipient_profile_id: string | null;
  recipient_email: string;
  subject: string | null;
  payload: Record<string, unknown>;
  attempt_count: number;
  priority: string | null;
};

type DispatchResult = {
  event_id: string;
  event_type: string;
  source_folio: string | null;
  intended_recipient_email: string;
  final_recipient_email: string;
  status: "sent" | "failed";
  provider_message_id?: string | null;
  attachment_sha256?: string;
  attachment_size_bytes?: number;
  error?: string;
};

type Runtime = {
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
};

type DispatchOptions = {
  limit: number;
  eventTypes: string[];
  createdAtFrom: string;
  createdAtAfterExclusive: string;
};

type NotificationAttachment = {
  bucket: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  filename: string;
};


type ApprovalBatchDecisionDocument = {
  event_id: string;
  recipient_email: string;
  recipient_profile_id: string;
  batch: {
    id: string;
    label: string;
    company: string | null;
    company_name: string | null;
    status: "approved" | "partially_approved";
    period_start: string | null;
    period_end: string | null;
    submitted_at: string | null;
    decided_at: string | null;
    director_name: string | null;
    item_count: number;
    approved_count: number;
    rejected_count: number;
    totals_by_currency: Array<{ currency: string; amount: number | string }>;
  };
  items: Array<{
    request_number: string | null;
    provider: string | null;
    provider_name: string | null;
    cost_center: string | null;
    budget_category: string | null;
    payment_method: string | null;
    amount: number | string | null;
    currency: string | null;
    requester_name: string | null;
    director_status: string | null;
    reject_reason: string | null;
    rebatch_release_note: string | null;
  }>;
};

type PreparedAttachment = {
  filename: string;
  content: string;
  sha256: string;
  sizeBytes: number;
};


const FLUX_URL = "https://flux.quantta.mx";
const SYSTEM_PDF_LOGO_URL = `${FLUX_URL}/assets/logo-flux-verde.webp`;
const MAX_APPROVAL_BATCH_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const allowedEventTypes = new Set([
  "payment_request.created",
  "payment_request.approved",
  "payment_request.rejected",
  "payment_request.changes_requested",
  "payment_request.exception_approved",
  "payment_request.exception_rejected",
  "approval_batch.submitted",
  "approval_batch.approved",
  "approval_batch.partially_approved",
  "approval_batch.item_rejected",
  "payment_request.extraordinary_authorized",
  "approval_batch.item_rebatched",
  "payment_receipt.linked",
]);

const EMAIL_LOGO_URL = "https://flux.quantta.mx/assets/email/flux-logo-email-white.png";
const EMAIL_LOGO_HTML = `<img src="${EMAIL_LOGO_URL}" width="110" alt="Flux" style="display:block;width:110px;max-width:100%;height:auto;border:0;" />`;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function requiredEnv(runtime: Runtime, name: string): string {
  const value = runtime.env(name);
  if (!value || !value.trim()) {
    throw new Error(`missing_required_secret:${name}`);
  }
  return value.trim();
}

function requiredEnvAny(runtime: Runtime, names: string[], label: string): string {
  for (const name of names) {
    const value = runtime.env(name);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(label);
}

function optionalEnv(runtime: Runtime, name: string, fallback = ""): string {
  return (runtime.env(name) || fallback).trim();
}

function maskEmail(email: string | null | undefined): string {
  const value = String(email || "").trim();
  const [local, domain] = value.split("@");
  if (!local || !domain) return "missing";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value: unknown, currency: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = Number(value);
  const safeCurrency = String(currency || "MXN").slice(0, 8);
  if (!Number.isFinite(amount)) return null;
  return `${safeCurrency} ${amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyTotals(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const totals = value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      return money(item.amount, item.currency);
    })
    .filter((item): item is string => Boolean(item));
  return totals.length ? totals.join(" | ") : null;
}

function textValue(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function clampLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(Math.trunc(parsed), 1), 5);
}

export async function readDispatchOptions(req: Request, runtime: Runtime): Promise<DispatchOptions> {
  const url = new URL(req.url);
  const queryLimit = url.searchParams.get("limit");
  let body: Record<string, unknown> = {};
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      const candidate = await req.json();
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        body = candidate as Record<string, unknown>;
      }
    } catch {
      throw new Error("invalid_json_body");
    }
  }

  const rawEventTypes = Array.isArray(body.event_types)
    ? body.event_types
    : optionalEnv(runtime, "NOTIFICATION_EVENT_TYPES")
      .split(",")
      .filter(Boolean);
  const eventTypes = [...new Set(rawEventTypes.map((value) => String(value).trim()).filter(Boolean))];
  if (!eventTypes.length) throw new Error("notification_event_types_required");
  if (eventTypes.some((eventType) => !allowedEventTypes.has(eventType))) {
    throw new Error("notification_event_type_not_allowed");
  }
  if (
    eventTypes.includes("payment_request.created") &&
    (eventTypes.length !== 1 || eventTypes[0] !== "payment_request.created")
  ) {
    throw new Error("payment_request_created_dispatch_scope_must_be_exclusive");
  }

  const cutoffValue = String(
    body.created_at_from ?? optionalEnv(runtime, "NOTIFICATION_CUTOFF_AT"),
  ).trim();
  if (!cutoffValue) throw new Error("notification_cutoff_required");
  const cutoff = new Date(cutoffValue);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("notification_cutoff_invalid");
  if (cutoff.getTime() > Date.now() + 300_000) throw new Error("notification_cutoff_in_future");

  return {
    limit: clampLimit(queryLimit || body.limit),
    eventTypes,
    createdAtFrom: cutoff.toISOString(),
    createdAtAfterExclusive: cutoffValue,
  };
}

function baseSubject(event: NotificationEvent): string {
  const folio = event.source_folio || "sin folio";
  switch (event.event_type) {
    case "payment_request.created":
      return `Nueva solicitud de pago: ${folio}`;
    case "payment_request.approved":
      return `Solicitud aprobada: ${folio}`;
    case "payment_request.rejected":
      return `Solicitud rechazada: ${folio}`;
    case "payment_request.changes_requested":
      return `Cambios solicitados: ${folio}`;
    case "payment_request.exception_approved":
      return `Excepcion presupuestal aprobada: ${folio}`;
    case "payment_request.exception_rejected":
      return `Excepcion presupuestal rechazada: ${folio}`;
    case "approval_batch.submitted":
      return `Corte semanal por autorizar: ${folio}`;
    case "approval_batch.approved":
      return `Corte semanal aprobado: ${folio}`;
    case "approval_batch.partially_approved":
      return `Corte semanal con rechazos: ${folio}`;
    case "approval_batch.item_rejected":
      return `Pago rechazado en corte: ${folio}`;
    case "payment_request.extraordinary_authorized":
      return `Pago extraordinario autorizado: ${folio}`;
    case "approval_batch.item_rebatched":
      return `Pago habilitado para nueva autorizacion: ${folio}`;
    case "payment_receipt.linked":
      return `Comprobante de pago disponible — ${folio}`;
    default:
      return event.subject || `Notificacion Flux: ${folio}`;
  }
}

function actionText(eventType: string): string {
  switch (eventType) {
    case "payment_request.created":
      return "Se registro una nueva solicitud de pago. Accion requerida: revisar en Flux.";
    case "payment_request.approved":
      return "La solicitud fue aprobada. Siguiente paso: continuar el flujo operativo de pago.";
    case "payment_request.rejected":
      return "La solicitud fue rechazada. Revisa el comentario operativo en Flux.";
    case "payment_request.changes_requested":
      return "Se solicitaron cambios en la solicitud. Revisa y actualiza la informacion en Flux.";
    case "payment_request.exception_approved":
      return "La excepcion presupuestal fue aprobada. Continua el flujo segun corresponda.";
    case "payment_request.exception_rejected":
      return "La excepcion presupuestal fue rechazada. Revisa la solicitud en Flux.";
    case "approval_batch.submitted":
      return "Finanzas envio un corte semanal para autorizacion de Direccion.";
    case "approval_batch.approved":
      return "Direccion aprobo el corte semanal. Los pagos aprobados pueden continuar a ejecucion.";
    case "approval_batch.partially_approved":
      return "Direccion concluyo el corte semanal con partidas rechazadas. Revisa el detalle antes de ejecutar.";
    case "approval_batch.item_rejected":
      return "Direccion rechazo una partida del corte semanal. Revisa el motivo registrado.";
    case "payment_request.extraordinary_authorized":
      return "Finanzas autorizo un pago extraordinario. No requiere decision de Direccion.";
    case "approval_batch.item_rebatched":
      return "Finanzas documento la correccion y habilito la solicitud para una nueva autorizacion.";
    case "payment_receipt.linked":
      return "El pago fue confirmado y el comprobante individual se adjunta a este correo.";
    default:
      return "Hay una actualizacion disponible en Flux.";
  }
}

function requiresDecisionCommentFallback(eventType: string): boolean {
  return eventType === "payment_request.changes_requested" ||
    eventType === "payment_request.rejected";
}

function decisionCommentLabel(event: NotificationEvent): string | null {
  const payload = event.payload || {};
  const explicitLabel = textValue(payload.decision_label);
  if (explicitLabel) return explicitLabel;

  switch (event.event_type) {
    case "payment_request.rejected":
      return "Motivo de rechazo";
    case "payment_request.changes_requested":
      return "Motivo / comentario";
    case "payment_request.approved":
      return textValue(payload.decision_comment) ? "Comentario de aprobacion" : null;
    case "payment_request.exception_approved":
      return "Motivo / comentario de excepcion aprobada";
    case "payment_request.exception_rejected":
      return "Motivo / comentario de excepcion rechazada";
    case "approval_batch.item_rejected":
      return "Motivo de rechazo";
    case "payment_request.extraordinary_authorized":
      return "Motivo extraordinario";
    case "approval_batch.item_rebatched":
      return "Correccion documentada por Finanzas";
    default:
      return null;
  }
}

export function notificationRecipientRoles(event: NotificationEvent): string[] {
  const value = event.payload?.recipient_roles;
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((role) => String(role).trim()).filter(Boolean))];
}


function approvalBatchDecisionLabel(status: unknown): string {
  return status === "approved" ? "Aprobado" : "Aprobado con rechazos";
}

function approvalBatchItemStatusLabel(status: unknown): string {
  return ({
    approved: "Aprobada por Dirección",
    rejected: "Rechazada por Dirección",
    pending: "Pendiente",
  } as Record<string, string>)[String(status || "")] || String(status || "-");
}

function formatDecisionDate(value: unknown): string {
  const text = textValue(value);
  if (!text) return "No disponible";
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return text;
  return parsed.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Mexico_City",
  });
}

function approvalBatchDecisionFileStem(batch: ApprovalBatchDecisionDocument["batch"]): string {
  const company = String(batch.company_name || batch.company || "empresa")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `corte-semanal-final-${company}-${batch.period_end || "sin-fecha"}`;
}

async function fetchApprovalBatchPdfLogo(fetchFn: typeof fetch): Promise<Uint8Array | null> {
  try {
    const response = await fetchFn(SYSTEM_PDF_LOGO_URL, { cache: "no-store" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length ? bytes : null;
  } catch {
    return null;
  }
}

function approvalBatchDecisionRows(document: ApprovalBatchDecisionDocument): string[][] {
  return document.items.map((item) => [
    item.request_number || "-",
    item.provider_name || item.provider || "-",
    `${item.cost_center || "-"}
${item.budget_category || "-"}`,
    item.payment_method || "-",
    money(item.amount, item.currency) || "-",
    item.requester_name || "-",
    approvalBatchItemStatusLabel(item.director_status),
    `${item.reject_reason || "-"}${item.rebatch_release_note ? `
Reingreso: ${item.rebatch_release_note}` : ""}`,
  ]);
}

export function generateApprovalBatchDecisionPdfBytes(
  document: ApprovalBatchDecisionDocument,
  logoBytes: Uint8Array | null = null,
): { bytes: Uint8Array; pageCount: number } {
  if (!autoTable) throw new Error("jspdf_autotable_adapter_unavailable");

  const batch = document.batch;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();

  if (logoBytes?.length) {
    try {
      doc.addImage(logoBytes, "WEBP", pageWidth - 36 - 80, 22, 80, 32);
    } catch {
      // Preserve a valid PDF if the public logo cannot be decoded.
    }
  }

  doc.setTextColor(23, 45, 41);
  doc.setFontSize(15);
  doc.text(String(batch.label || "Corte semanal"), 36, 36);
  doc.setFontSize(9);
  doc.setTextColor(96, 110, 104);
  doc.text(
    `${batch.company_name || batch.company || "-"} | ${batch.period_start || "-"} a ${batch.period_end || "-"} | ${approvalBatchDecisionLabel(batch.status)}`,
    36,
    53,
  );

  autoTable(doc, {
    startY: 68,
    head: [["Folio", "Proveedor", "Centro / partida", "Metodo", "Monto", "Solicitante", "Decision", "Motivo"]],
    body: approvalBatchDecisionRows(document),
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", textColor: [21, 33, 29] },
    headStyles: { fillColor: [23, 45, 41], textColor: [247, 247, 245] },
    alternateRowStyles: { fillColor: [244, 246, 241] },
    didDrawPage: () => {
      doc.setFontSize(7.5);
      doc.setTextColor(150, 160, 155);
      doc.text("Flux Operadora — decisión final del corte semanal", 36, doc.internal.pageSize.getHeight() - 18);
    },
  });

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    pageCount: doc.getNumberOfPages(),
  };
}

async function prepareApprovalBatchDecisionAttachment(
  fetchFn: typeof fetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  eventId: string,
  workerId: string,
): Promise<PreparedAttachment> {
  const document = await callRpc<ApprovalBatchDecisionDocument>(
    fetchFn,
    supabaseUrl,
    serviceRoleKey,
    "get_approval_batch_decision_notification_document",
    { p_notification_event_id: eventId, p_worker_id: workerId },
  );
  const logoBytes = await fetchApprovalBatchPdfLogo(fetchFn);
  const { bytes } = generateApprovalBatchDecisionPdfBytes(document, logoBytes);
  if (bytes.length < 100 || bytes.length > MAX_APPROVAL_BATCH_ATTACHMENT_BYTES) {
    throw new Error("approval_batch_decision_pdf_size_invalid");
  }
  const signature = new TextDecoder().decode(bytes.subarray(0, 8));
  if (!signature.startsWith("%PDF-1.")) throw new Error("approval_batch_decision_pdf_signature_invalid");
  return {
    filename: `${approvalBatchDecisionFileStem(document.batch)}.pdf`,
    content: bytesToBase64(bytes),
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
  };
}

function renderApprovalBatchDecisionEmail(
  event: NotificationEvent,
  sendMode: string,
): { subject: string; text: string; html: string } {
  const payload = event.payload || {};
  const subjectPrefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${subjectPrefix}${event.subject || baseSubject(event)}`;
  const decision = approvalBatchDecisionLabel(payload.status);
  const period = payload.period_start || payload.period_end
    ? `${textValue(payload.period_start) || ""} - ${textValue(payload.period_end) || ""}`
    : null;
  const totals = moneyTotals(payload.totals_by_currency);
  const fluxUrl = sendMode === "test_only"
    ? "https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app"
    : FLUX_URL;
  const targetUrl = `${fluxUrl}/approval_batches.html?batch_id=${encodeURIComponent(String(event.source_id || ""))}`;
  const intro = event.event_type === "approval_batch.approved"
    ? "Dirección aprobó el corte semanal que enviaste."
    : "Dirección concluyó el corte semanal que enviaste con partidas rechazadas.";
  const rows = [
    ["Corte", payload.batch_label || event.source_folio],
    ["Empresa", payload.company],
    ["Periodo", period],
    ["Resultado", decision],
    ["Pagos incluidos", payload.item_count],
    ["Aprobados", payload.approved_count],
    ["Rechazados", payload.rejected_count],
    ["Total", totals],
    ["Director", payload.director_name],
    ["Fecha de decisión", formatDecisionDate(payload.decided_at)],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  const text = [
    intro,
    "El PDF final adjunto incluye la decisión y el motivo de cada partida.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Abrir corte en Flux: ${targetUrl}`,
    ...(sendMode === "test_only" ? ["", "Modo DEV TEST: este correo fue redirigido al destinatario de prueba."] : []),
  ].join("\n");

  const htmlRows = rows.map(([label, value]) =>
    `<tr><td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;line-height:1.35;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e8ece7;color:#1f2926;font-size:14px;line-height:1.35;vertical-align:top;"><strong>${escapeHtml(value)}</strong></td></tr>`
  ).join("");
  const testBanner = sendMode === "test_only"
    ? '<div style="margin-top:20px;padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;line-height:1.4;">Modo DEV TEST: este correo fue redirigido al destinatario de prueba.</div>'
    : "";

  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#eef1e9;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef1e9" style="width:100%;margin:0;padding:0;border-top:8px solid #16322d;background:#eef1e9;"><tr><td align="center" style="padding:24px 12px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;background:#ffffff;"><tr><td bgcolor="#16322d" style="padding:20px 28px;background:#16322d;">${EMAIL_LOGO_HTML}</td></tr><tr><td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;"><h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;color:#16322d;">Decisión del corte semanal</h1><p style="margin:0 0 10px;font-size:14px;line-height:1.5;">${escapeHtml(intro)}</p><p style="margin:0 0 16px;font-size:14px;line-height:1.5;">El PDF final adjunto incluye la decisión y el motivo de cada partida.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;"><tr><td bgcolor="#16322d" style="border-radius:6px;"><a href="${targetUrl}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">Abrir corte en Flux</a></td></tr></table>${testBanner}</td></tr></table><div style="padding:14px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#7b837f;text-align:center;">Flux Operadora &middot; Powered by Quantta</div></td></tr></table></body></html>`;
  return { subject, text, html };
}

function renderPaymentRequestCreatedEmail(
  event: NotificationEvent,
  sendMode: string,
): { subject: string; text: string; html: string } {
  const payload = event.payload || {};
  const folio = textValue(payload.folio) || event.source_folio || "sin folio";
  const subjectPrefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${subjectPrefix}${event.subject || `Nueva solicitud de pago: ${folio}`}`;
  const amountText = money(payload.amount, payload.currency);
  const rows = [
    ["Folio", folio],
    ["Empresa", payload.company],
    ["Solicitante", payload.requester],
    ["Proveedor", payload.provider],
    ["Importe", amountText],
    ["Centro de costo", payload.cost_center],
    ["Partida presupuestal", payload.budget_category],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  const approvalUrl = "https://flux.quantta.mx/aprobaciones.html";
  const intro = "Se generó una solicitud de pago que requiere tu revisión.";
  const textLines = [
    "Nueva solicitud por revisar",
    "",
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    `Revisar solicitud: ${approvalUrl}`,
    ...(sendMode === "test_only"
      ? ["", "Modo DEV TEST: este correo fue redirigido al destinatario de prueba."]
      : []),
  ];
  const htmlRows = rows
    .map(([label, value]) => `
      <tr>
        <td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;line-height:1.35;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e8ece7;color:#1f2926;font-size:14px;line-height:1.35;vertical-align:top;"><strong>${escapeHtml(value)}</strong></td>
      </tr>`)
    .join("");
  const testBanner = sendMode === "test_only"
    ? `<div style="margin-top:20px;padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;line-height:1.4;">Modo DEV TEST: este correo fue redirigido al destinatario de prueba.</div>`
    : "";

  return {
    subject,
    text: textLines.join("\n"),
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#eef1e9;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(subject)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef1e9" style="width:100%;margin:0;padding:0;border-top:8px solid #16322d;background:#eef1e9;">
      <tr>
        <td align="center" style="padding:24px 12px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;background:#ffffff;">
            <tr>
              <td bgcolor="#16322d" style="padding:20px 28px;background:#16322d;">${EMAIL_LOGO_HTML}</td>
            </tr>
            <tr>
              <td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;">
                <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;color:#16322d;">Nueva solicitud por revisar</h1>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#1f2926;">${escapeHtml(intro)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">
                  <tr>
                    <td bgcolor="#16322d" style="border-radius:6px;">
                      <a href="${approvalUrl}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">Revisar solicitud</a>
                    </td>
                  </tr>
                </table>
                ${testBanner}
              </td>
            </tr>
          </table>
          <div style="padding:14px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#7b837f;text-align:center;">Flux Operadora &middot; Powered by Quantta</div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

function renderReceiptLinkedEmail(
  event: NotificationEvent,
  sendMode: string,
): { subject: string; text: string; html: string } {
  const payload = event.payload || {};
  const roles = notificationRecipientRoles(event);
  const providerOnly = roles.includes("provider") && !roles.includes("requester");
  const folio = textValue(payload.folio) || event.source_folio || "sin folio";
  const subjectPrefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${subjectPrefix}${event.subject || (providerOnly ? `Comprobante de pago — ${folio}` : `Comprobante de pago disponible — ${folio}`)}`;
  const amountText = money(payload.amount, payload.currency);
  const rows = (providerOnly
    ? [
      ["Folio", folio],
      ["Empresa pagadora", payload.company],
      ["Concepto", payload.concept],
      ["Importe", amountText],
      ["Fecha de pago", payload.payment_date],
      ["Referencia", payload.reference_hint],
    ]
    : [
      ["Folio", folio],
      ["Proveedor", payload.provider],
      ["Empresa", payload.company],
      ["Concepto", payload.concept],
      ["Importe", amountText],
      ["Fecha de pago", payload.payment_date],
      ["Referencia", payload.reference_hint],
      ["Estatus", payload.status],
    ]).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  const internalUrl = "https://flux.quantta.mx/solicitudes.html";
  const intro = providerOnly
    ? "Confirmamos que el pago fue realizado. Adjuntamos el comprobante individual correspondiente."
    : "El pago fue confirmado. Adjuntamos el comprobante individual de una página.";
  const textLines = [
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(providerOnly ? [] : ["", `Abrir Flux: ${internalUrl}`]),
    ...(sendMode === "test_only" ? ["", "Modo DEV TEST: este correo fue redirigido al destinatario de prueba."] : []),
  ];
  const htmlRows = rows
    .map(([label, value]) => `
      <tr>
        <td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;line-height:1.35;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #e8ece7;color:#1f2926;font-size:14px;line-height:1.35;vertical-align:top;"><strong>${escapeHtml(value)}</strong></td>
      </tr>`)
    .join("");
  const internalLink = providerOnly
    ? ""
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;">
        <tr>
          <td bgcolor="#16322d" style="border-radius:6px;">
            <a href="${internalUrl}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">Abrir solicitud en Flux</a>
          </td>
        </tr>
      </table>`;
  const testBanner = sendMode === "test_only"
    ? `<div style="margin-top:20px;padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;line-height:1.4;">Modo DEV TEST: este correo fue redirigido al destinatario de prueba.</div>`
    : "";

  return {
    subject,
    text: textLines.join("\n"),
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#eef1e9;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(subject)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef1e9" style="width:100%;margin:0;padding:0;border-top:8px solid #16322d;background:#eef1e9;">
      <tr>
        <td align="center" style="padding:24px 12px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;background:#ffffff;">
            <tr>
              <td bgcolor="#16322d" style="padding:20px 28px;background:#16322d;">${EMAIL_LOGO_HTML}</td>
            </tr>
            <tr>
              <td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;">
                <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#1f2926;">${escapeHtml(intro)}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table>
                ${internalLink}
                ${testBanner}
              </td>
            </tr>
          </table>
          <div style="padding:14px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#7b837f;text-align:center;">Flux Operadora &middot; Powered by Quantta</div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export function renderEmail(event: NotificationEvent, sendMode: string): { subject: string; text: string; html: string } {
  if (event.event_type === "payment_request.created") {
    return renderPaymentRequestCreatedEmail(event, sendMode);
  }
  if (event.event_type === "payment_receipt.linked") {
    return renderReceiptLinkedEmail(event, sendMode);
  }
  if (event.event_type === "approval_batch.approved" || event.event_type === "approval_batch.partially_approved") {
    return renderApprovalBatchDecisionEmail(event, sendMode);
  }
  const payload = event.payload || {};
  const subjectPrefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${subjectPrefix}${event.subject || baseSubject(event)}`;
  const amountText = money(payload.amount, payload.currency);
  const totalsText = moneyTotals(payload.totals_by_currency);
  const commentLabel = decisionCommentLabel(event);
  const commentText = textValue(payload.decision_comment);
  const shouldRenderComment = Boolean(commentLabel && (commentText || requiresDecisionCommentFallback(event.event_type)));
  const renderedCommentText = commentText || "Sin comentario capturado.";
  const isBatchEvent = event.event_type.startsWith("approval_batch.");
  const targetPath = textValue(payload.path) || (isBatchEvent ? "/approval_batches.html" : "/solicitudes.html");
  const period = payload.period_start || payload.period_end
    ? `${textValue(payload.period_start) || ""} - ${textValue(payload.period_end) || ""}`
    : null;
  const rows = (isBatchEvent
    ? [
      ["Corte", payload.batch_label || event.source_folio],
      ["Folio", payload.folio],
      ["Proveedor", payload.provider],
      ["Totales", totalsText || amountText],
      ["Empresa", payload.company],
      ["Periodo", period],
      ["Pagos", payload.item_count],
      ["Estatus", payload.status],
    ]
    : [
      ["Folio", event.source_folio || payload.folio],
      ["Proveedor", payload.provider],
      ["Monto", amountText],
      ["Empresa", payload.company],
      ["Centro de costo", payload.cost_center],
      ["Partida", payload.budget_category],
      ["Solicitante", payload.requester],
      ["Estatus", payload.status],
    ]).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  const textLines = [
    actionText(event.event_type),
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(shouldRenderComment ? [
      "",
      `${commentLabel}:`,
      renderedCommentText,
    ] : []),
    "",
    `Abrir Flux: ${targetPath}`,
  ];

  const htmlRows = rows
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(label)}</td><td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join("");
  const htmlComment = shouldRenderComment
    ? `<div style="margin-top:18px;padding:12px;border-left:4px solid #d97706;background:#fff7ed">
        <div style="font-size:12px;color:#92400e;font-weight:700;margin-bottom:6px">${escapeHtml(commentLabel)}</div>
        <div style="white-space:pre-wrap;color:#111">${escapeHtml(renderedCommentText)}</div>
      </div>`
    : "";

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#111">
      <p>${escapeHtml(actionText(event.event_type))}</p>
      <table style="border-collapse:collapse">${htmlRows}</table>
      ${htmlComment}
      <p style="margin-top:18px;color:#555">Abrir Flux: <strong>${escapeHtml(targetPath)}</strong></p>
      ${sendMode === "test_only" ? `<p style="margin-top:18px;color:#b45309">Modo DEV TEST: este correo fue redirigido al destinatario de prueba.</p>` : ""}
    </div>
  `;

  return {
    subject,
    text: textLines.join("\n"),
    html,
  };
}

async function callRpc<T>(
  fetchFn: typeof fetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  rpcName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetchFn(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const message = await safeResponseText(res);
    throw new Error(`rpc_${rpcName}_failed:${res.status}:${message}`);
  }

  return await res.json() as T;
}

async function safeResponseText(res: Response): Promise<string> {
  try {
    return (await res.text()).replace(/\s+/g, " ").slice(0, 500);
  } catch {
    return "response_unreadable";
  }
}

export function validateAttachmentMetadata(value: NotificationAttachment): void {
  if (!value || typeof value !== "object") throw new Error("attachment_metadata_missing");
  if (value.bucket !== "payment-batch-documents") throw new Error("attachment_bucket_invalid");
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/evidence\/[0-9a-f-]{36}\.pdf$/.test(value.path || "")) {
    throw new Error("attachment_path_invalid");
  }
  if (value.mime_type !== "application/pdf") throw new Error("attachment_mime_invalid");
  if (!Number.isInteger(value.size_bytes) || value.size_bytes < 1 || value.size_bytes > 26_214_400) {
    throw new Error("attachment_size_invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(value.sha256 || "")) throw new Error("attachment_hash_invalid");
  if (!/^Comprobante_[A-Za-z0-9._-]+_[A-Za-z0-9._-]+\.pdf$/.test(value.filename || "") || value.filename.length > 120) {
    throw new Error("attachment_filename_invalid");
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function prepareReceiptAttachment(
  fetchFn: typeof fetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  eventId: string,
): Promise<PreparedAttachment> {
  const metadata = await callRpc<NotificationAttachment>(
    fetchFn,
    supabaseUrl,
    serviceRoleKey,
    "get_payment_receipt_notification_attachment",
    { p_notification_event_id: eventId },
  );
  validateAttachmentMetadata(metadata);

  const encodedPath = metadata.path.split("/").map(encodeURIComponent).join("/");
  const storageUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/authenticated/${encodeURIComponent(metadata.bucket)}/${encodedPath}`;
  const response = await fetchFn(storageUrl, {
    method: "GET",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  if (!response.ok) throw new Error(`attachment_download_failed:${response.status}`);
  const responseMime = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (responseMime && responseMime !== "application/pdf") throw new Error("attachment_download_mime_invalid");

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== metadata.size_bytes) throw new Error("attachment_download_size_mismatch");
  if (bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
    throw new Error("attachment_pdf_signature_invalid");
  }
  const actualHash = await sha256Hex(bytes);
  if (actualHash !== metadata.sha256) throw new Error("attachment_hash_mismatch");

  return {
    filename: metadata.filename,
    content: bytesToBase64(bytes),
    sha256: actualHash,
    sizeBytes: bytes.length,
  };
}

async function sendResendEmail(params: {
  fetchFn: typeof fetch;
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  attachment?: PreparedAttachment;
}): Promise<string | null> {
  const res = await params.fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": params.idempotencyKey,
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
      ...(params.attachment
        ? {
          attachments: [{
            filename: params.attachment.filename,
            content: params.attachment.content,
          }],
        }
        : {}),
    }),
  });

  const body = await safeResponseText(res);
  if (!res.ok) {
    throw new Error(`resend_send_failed:${res.status}:${body}`);
  }

  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

export async function handleRequest(req: Request, runtime: Runtime): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const expectedSecret = requiredEnv(runtime, "NOTIFICATION_DISPATCHER_SECRET");
    const providedSecret = req.headers.get("x-notification-dispatcher-secret") || "";
    if (providedSecret !== expectedSecret) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const sendMode = optionalEnv(runtime, "NOTIFICATION_SEND_MODE", "disabled");
    if (!["disabled", "test_only", "real"].includes(sendMode)) {
      return jsonResponse({ error: "invalid_notification_send_mode" }, 500);
    }

    if (sendMode === "disabled") {
      return jsonResponse({
        processed: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        mode: sendMode,
        message: "notification dispatcher disabled; no events claimed",
      });
    }

    const supabaseUrl = requiredEnvAny(runtime, ["SUPABASE_URL", "SUPABASEURL"], "Missing Supabase URL");
    const serviceRoleKey = requiredEnvAny(
      runtime,
      ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASESERVICEROLEKEY"],
      "Missing Supabase service role key",
    );
    const resendApiKey = requiredEnv(runtime, "RESEND_API_KEY");
    const fromEmail = requiredEnv(runtime, "NOTIFICATION_FROM_EMAIL");
    const testEmail = sendMode === "test_only" ? requiredEnv(runtime, "NOTIFICATION_TEST_EMAIL") : "";
    const workerId = optionalEnv(runtime, "NOTIFICATION_WORKER_ID", "edge-notification-dispatcher-dev");
    const options = await readDispatchOptions(req, runtime);

    const createdOnly = options.eventTypes.length === 1 &&
      options.eventTypes[0] === "payment_request.created";
    const decisionEventTypes = new Set([
      "approval_batch.approved",
      "approval_batch.partially_approved",
    ]);
    const decisionOnly = options.eventTypes.length > 0 &&
      options.eventTypes.every((eventType) => decisionEventTypes.has(eventType));
    const claimRpcName = createdOnly
      ? "claim_payment_request_created_events_for_dispatcher"
      : decisionOnly
      ? "claim_approval_batch_decision_events_for_dispatcher"
      : "claim_notification_events_for_dispatcher_v2";
    const claimPayload = createdOnly || decisionOnly
      ? {
        p_limit: options.limit,
        p_worker_id: workerId,
        p_created_at_after: options.createdAtAfterExclusive,
      }
      : {
        p_limit: options.limit,
        p_worker_id: workerId,
        p_event_types: options.eventTypes,
        p_created_at_from: options.createdAtFrom,
      };

    const events = await callRpc<NotificationEvent[]>(
      runtime.fetch,
      supabaseUrl,
      serviceRoleKey,
      claimRpcName,
      claimPayload,
    );

    const results: DispatchResult[] = [];
    let sent = 0;
    let failed = 0;

    for (const event of events) {
      const intendedRecipient = event.recipient_email;
      const finalRecipient = sendMode === "test_only" ? testEmail : intendedRecipient;
      const rendered = renderEmail(event, sendMode);
      let providerMessageId: string | null = null;
      let attachment: PreparedAttachment | undefined;

      try {
        if (event.event_type === "payment_receipt.linked") {
          attachment = await prepareReceiptAttachment(
            runtime.fetch,
            supabaseUrl,
            serviceRoleKey,
            event.id,
          );
        } else if (
          event.event_type === "approval_batch.approved" ||
          event.event_type === "approval_batch.partially_approved"
        ) {
          attachment = await prepareApprovalBatchDecisionAttachment(
            runtime.fetch,
            supabaseUrl,
            serviceRoleKey,
            event.id,
            workerId,
          );
        }

        providerMessageId = await sendResendEmail({
          fetchFn: runtime.fetch,
          apiKey: resendApiKey,
          from: fromEmail,
          to: finalRecipient,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          idempotencyKey: `notification/${event.id}`,
          attachment,
        });

        await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "mark_notification_processed_for_dispatcher", {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_provider_message_id: providerMessageId,
          p_resend_email_id: providerMessageId,
        });

        sent += 1;
        results.push({
          event_id: event.id,
          event_type: event.event_type,
          source_folio: event.source_folio,
          intended_recipient_email: maskEmail(intendedRecipient),
          final_recipient_email: maskEmail(finalRecipient),
          status: "sent",
          provider_message_id: providerMessageId,
          ...(attachment
            ? {
              attachment_sha256: attachment.sha256,
              attachment_size_bytes: attachment.sizeBytes,
            }
            : {}),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "notification_dispatch_failed";
        let markError = "";
        try {
          await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "mark_notification_failed_for_dispatcher", {
            p_event_id: event.id,
            p_error_message: providerMessageId
              ? `send_succeeded_but_mark_processed_failed:${message}`
              : message,
            p_worker_id: workerId,
            p_resend_email_id: providerMessageId,
          });
        } catch (markFailure) {
          markError = markFailure instanceof Error ? `; mark_failed_error:${markFailure.message}` : "; mark_failed_error:unknown";
        }

        failed += 1;
        results.push({
          event_id: event.id,
          event_type: event.event_type,
          source_folio: event.source_folio,
          intended_recipient_email: maskEmail(intendedRecipient),
          final_recipient_email: maskEmail(finalRecipient),
          status: "failed",
          error: `${message}${markError}`.slice(0, 300),
        });
      }
    }

    return jsonResponse({
      processed: events.length,
      sent,
      failed,
      skipped: 0,
      mode: sendMode,
      events: results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "notification_dispatcher_error";
    return jsonResponse({ error: message.slice(0, 300) }, 500);
  }
}

const edgeRuntime = (globalThis as unknown as {
  Deno?: {
    env: { get: (name: string) => string | undefined };
    serve: (handler: (req: Request) => Response | Promise<Response>) => void;
  };
}).Deno;

if (edgeRuntime) {
  edgeRuntime.serve((req) => handleRequest(req, {
    env: (name) => edgeRuntime.env.get(name),
    fetch: globalThis.fetch.bind(globalThis),
  }));
}
