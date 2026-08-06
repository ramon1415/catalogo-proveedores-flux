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
};

type NotificationAttachment = {
  bucket: string;
  path: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  filename: string;
};

type PreparedAttachment = {
  filename: string;
  content: string;
  sha256: string;
  sizeBytes: number;
};

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

// ── Identidad Flux para correos (paleta: verde #172d29, crema #cfe1cb) ──
const FLUX_EMAIL_LOGO_URL = "https://flux.quantta.mx/assets/logo-flux-email.png";

function brandEmailHtml(inner: string): string {
  // La URL del logo es la unica referencia a flux.quantta.mx permitida en correos
  // a proveedores (aceptada por Carlos/Ramon 6-ago-2026); el contract test la exceptua.
  const logo = `<img src="${FLUX_EMAIL_LOGO_URL}" width="110" height="44" alt="Flux" style="display:block;border:0">`;
  return `<div style="background:#eef0ea;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%">
        <tr><td style="background:#172d29;border-radius:12px 12px 0 0;padding:20px 28px">
          ${logo}
        </td></tr>
        <tr><td style="background:#ffffff;border:1px solid #dde3da;border-top:0;border-radius:0 0 12px 12px;padding:26px 28px;color:#2c3a34;font-size:14px;line-height:1.5">${inner}</td></tr>
        <tr><td style="padding:14px 8px;text-align:center;color:#8a978f;font-size:11px">Flux Operadora &middot; Powered by Quantta</td></tr>
      </table>
    </td></tr></table>
  </div>`;
}

function brandEmailRows(rows: Array<[string, unknown]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;width:100%">${
    rows.map(([label, value]) =>
      `<tr><td style="padding:7px 16px 7px 0;color:#6b7a72;font-size:13px;border-bottom:1px solid #eef1ec;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:7px 0;color:#172d29;font-weight:bold;font-size:13.5px;border-bottom:1px solid #eef1ec">${escapeHtml(value)}</td></tr>`
    ).join("")
  }</table>`;
}

function brandEmailButton(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px"><tr>
    <td bgcolor="#cfe1cb" style="border-radius:8px"><a href="${url}" style="display:inline-block;padding:11px 22px;color:#172d29;font-weight:bold;text-decoration:none;font-size:14px">${escapeHtml(label)}</a></td>
  </tr></table>`;
}

const BRAND_TEST_BANNER = `<p style="margin-top:20px;padding:10px 14px;background:#fff7ed;border-left:4px solid #d97706;color:#92400e;font-size:13px">Modo DEV TEST: este correo fue redirigido al destinatario de prueba.</p>`;

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
  const htmlRows = brandEmailRows(rows);
  const internalLink = providerOnly ? "" : brandEmailButton(internalUrl, "Abrir solicitud en Flux");
  const testBanner = sendMode === "test_only" ? BRAND_TEST_BANNER : "";

  return {
    subject,
    text: textLines.join("\n"),
    html: brandEmailHtml(`<p style="margin:0">${escapeHtml(intro)}</p>${htmlRows}${internalLink}${testBanner}`),
  };
}

export function renderEmail(event: NotificationEvent, sendMode: string): { subject: string; text: string; html: string } {
  if (event.event_type === "payment_receipt.linked") {
    return renderReceiptLinkedEmail(event, sendMode);
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

  const htmlRows = brandEmailRows(rows);
  const htmlComment = shouldRenderComment
    ? `<div style="margin-top:18px;padding:12px;border-left:4px solid #d97706;background:#fff7ed">
        <div style="font-size:12px;color:#92400e;font-weight:700;margin-bottom:6px">${escapeHtml(commentLabel)}</div>
        <div style="white-space:pre-wrap;color:#2c3a34">${escapeHtml(renderedCommentText)}</div>
      </div>`
    : "";

  const html = brandEmailHtml(`<p style="margin:0">${escapeHtml(actionText(event.event_type))}</p>${htmlRows}${htmlComment}${
    brandEmailButton(`https://flux.quantta.mx${targetPath}`, "Abrir Flux")
  }${sendMode === "test_only" ? BRAND_TEST_BANNER : ""}`);

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

    const events = await callRpc<NotificationEvent[]>(
      runtime.fetch,
      supabaseUrl,
      serviceRoleKey,
      "claim_notification_events_for_dispatcher_v2",
      {
        p_limit: options.limit,
        p_worker_id: workerId,
        p_event_types: options.eventTypes,
        p_created_at_from: options.createdAtFrom,
      },
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
