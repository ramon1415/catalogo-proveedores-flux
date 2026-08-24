import {
  SYSTEM_PDF_GENERATOR,
  generateApprovalBatchPdfBytes,
  systemCompanyName,
  systemFormatDate,
  systemFormatMoney,
} from "./system_pdf.ts";
import { prepareApprovalBatchAttachment } from "./system_pdf_attachment.ts";

export { generateApprovalBatchPdfBytes, prepareApprovalBatchAttachment };

const EVENT_TYPE = "approval_batch.submitted";
const FUNCTION_NAME = "approval-batch-submitted-dispatcher";
const DEFAULT_WORKER_ID = "edge-approval-batch-submitted-dev";
const EMAIL_LOGO_URL = "https://flux.quantta.mx/assets/email/flux-logo-email-white.png";
const FLUX_URL = "https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app";
const MAX_DISPATCH_LIMIT = 5;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function requiredEnv(runtime, name) {
  const value = runtime.env(name);
  if (!value || !value.trim()) throw new Error(`missing_required_secret:${name}`);
  return value.trim();
}

function requiredEnvAny(runtime, names, label) {
  for (const name of names) {
    const value = runtime.env(name);
    if (value && value.trim()) return value.trim();
  }
  throw new Error(label);
}

function optionalEnv(runtime, name, fallback = "") {
  return (runtime.env(name) || fallback).trim();
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAX_DISPATCH_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_DISPATCH_LIMIT);
}

function maskEmail(value) {
  const email = String(value || "").trim();
  const [local, domain] = email.split("@");
  if (!local || !domain) return "missing";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(local.length - visible.length, 2))}@${domain}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDateTime(value) {
  const text = String(value || "").trim();
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

function totalsText(value) {
  if (!Array.isArray(value) || !value.length) return "Sin total disponible";
  return value
    .map((row) => row && typeof row === "object" ? systemFormatMoney(row.amount, row.currency) : null)
    .filter(Boolean)
    .join(" | ");
}

export function renderApprovalBatchSubmittedEmail(document, sendMode, deliveryMode = "test_recipient") {
  const batch = document.batch;
  const prefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${prefix}Corte semanal por autorizar: ${batch.label}`;
  const targetUrl = `${FLUX_URL}/approval_batches.html?batch_id=${encodeURIComponent(batch.id)}`;
  const summaryRows = [
    ["Corte", batch.label],
    ["Empresa", systemCompanyName(batch)],
    ["Periodo", `${systemFormatDate(batch.period_start)} - ${systemFormatDate(batch.period_end)}`],
    ["Pagos por revisar", batch.item_count],
    ["Total", totalsText(batch.totals_by_currency)],
    ["Enviado por Finanzas", formatDateTime(batch.submitted_at)],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  const devNotice = sendMode === "test_only"
    ? deliveryMode === "director"
      ? "Entorno DEV: este correo se envió al Director seleccionado para validar el flujo."
      : "Modo DEV TEST: este correo fue redirigido al destinatario de prueba."
    : "";
  const text = [
    "Tienes un corte semanal por autorizar.", "",
    "Finanzas envio un corte semanal que requiere tu revision y decision en Flux.",
    "El PDF adjunto es el mismo reporte disponible para descarga dentro del corte.", "",
    ...summaryRows.map(([label, value]) => `${label}: ${value}`), "",
    `Revisar y autorizar: ${targetUrl}`,
    ...(devNotice ? ["", devNotice] : []),
  ].join("\n");
  const htmlRows = summaryRows.map(([label, value]) => `<tr><td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;line-height:1.35;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e8ece7;color:#1f2926;font-size:14px;line-height:1.35;vertical-align:top;"><strong>${escapeHtml(value)}</strong></td></tr>`).join("");
  const banner = devNotice ? `<div style="margin-top:20px;padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;line-height:1.4;">${escapeHtml(devNotice)}</div>` : "";
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#eef1e9;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef1e9" style="width:100%;margin:0;padding:0;border-top:8px solid #16322d;background:#eef1e9;"><tr><td align="center" style="padding:24px 12px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;background:#ffffff;"><tr><td bgcolor="#16322d" style="padding:20px 28px;background:#16322d;"><img src="${EMAIL_LOGO_URL}" width="110" alt="Flux" style="display:block;width:110px;max-width:100%;height:auto;border:0;" /></td></tr><tr><td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;"><h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;color:#16322d;">Tienes un corte por autorizar</h1><p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#1f2926;">Finanzas envió un corte semanal que requiere tu revisión y decisión en Flux.</p><p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#1f2926;">El PDF adjunto es el mismo reporte disponible para descarga dentro del corte.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;"><tr><td bgcolor="#16322d" style="border-radius:6px;"><a href="${targetUrl}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">Revisar y autorizar corte</a></td></tr></table>${banner}</td></tr></table><div style="padding:14px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#7b837f;text-align:center;">Flux Operadora &middot; Powered by Quantta</div></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function safeResponseText(response) {
  try { return (await response.text()).replace(/\s+/g, " ").slice(0, 500); }
  catch { return "response_unreadable"; }
}

async function callRpc(fetchFn, supabaseUrl, serviceRoleKey, rpcName, payload) {
  const response = await fetchFn(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`, {
    method: "POST",
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`rpc_${rpcName}_failed:${response.status}:${await safeResponseText(response)}`);
  return await response.json();
}

async function sendResendEmail(params) {
  const response = await params.fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${params.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": params.idempotencyKey },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
      attachments: [{ filename: params.attachment.filename, content: params.attachment.content }],
    }),
  });
  const body = await safeResponseText(response);
  if (!response.ok) throw new Error(`resend_send_failed:${response.status}:${body}`);
  try { const parsed = JSON.parse(body); return typeof parsed?.id === "string" ? parsed.id : null; }
  catch { return null; }
}

export async function readDispatchOptions(req, runtime) {
  let body = {};
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed;
    } catch { throw new Error("invalid_json_body"); }
  }
  const cutoffValue = String(body.created_at_after ?? optionalEnv(runtime, "APPROVAL_BATCH_SUBMITTED_CUTOFF_AT")).trim();
  if (!cutoffValue) throw new Error("approval_batch_submitted_cutoff_required");
  const cutoff = new Date(cutoffValue);
  if (!Number.isFinite(cutoff.getTime())) throw new Error("approval_batch_submitted_cutoff_invalid");
  if (cutoff.getTime() > Date.now() + 300_000) throw new Error("approval_batch_submitted_cutoff_in_future");
  return { limit: clampLimit(body.limit), createdAtAfter: cutoffValue };
}

function isStaleBatchError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("approval_batch_no_longer_submitted") || message.includes("approval_batch_notification_recipient_drift");
}

export async function handleRequest(req, runtime) {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  try {
    const expectedSecret = requiredEnv(runtime, "NOTIFICATION_DISPATCHER_SECRET");
    if ((req.headers.get("x-notification-dispatcher-secret") || "") !== expectedSecret) return jsonResponse({ error: "unauthorized" }, 401);
    const sendMode = optionalEnv(runtime, "NOTIFICATION_SEND_MODE", "disabled");
    if (!["disabled", "test_only", "real"].includes(sendMode)) return jsonResponse({ error: "invalid_notification_send_mode" }, 500);
    const deliveryMode = optionalEnv(runtime, "APPROVAL_BATCH_SUBMITTED_DELIVERY_MODE", "director");
    if (!["director", "test_recipient"].includes(deliveryMode)) return jsonResponse({ error: "invalid_approval_batch_submitted_delivery_mode" }, 500);
    if (sendMode === "disabled") return jsonResponse({ processed: 0, sent: 0, failed: 0, cancelled: 0, mode: sendMode, delivery_mode: deliveryMode, event_type: EVENT_TYPE, pdf_generator: SYSTEM_PDF_GENERATOR, message: `${FUNCTION_NAME} disabled; no events claimed` });

    const supabaseUrl = requiredEnvAny(runtime, ["SUPABASE_URL", "SUPABASEURL"], "missing_supabase_url");
    const serviceRoleKey = requiredEnvAny(runtime, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASESERVICEROLEKEY"], "missing_supabase_service_role_key");
    const resendApiKey = requiredEnv(runtime, "RESEND_API_KEY");
    const fromEmail = requiredEnv(runtime, "NOTIFICATION_FROM_EMAIL");
    const testEmail = deliveryMode === "test_recipient" ? requiredEnv(runtime, "NOTIFICATION_TEST_EMAIL") : "";
    const workerId = optionalEnv(runtime, "APPROVAL_BATCH_SUBMITTED_WORKER_ID", DEFAULT_WORKER_ID).slice(0, 120);
    const options = await readDispatchOptions(req, runtime);
    const events = await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "claim_approval_batch_submitted_events_for_dispatcher", {
      p_limit: options.limit,
      p_worker_id: workerId,
      p_created_at_after: options.createdAtAfter,
    });

    const results = [];
    let sent = 0, failed = 0, cancelled = 0;
    for (const event of events) {
      const intendedRecipient = event.recipient_email;
      const finalRecipient = deliveryMode === "test_recipient" ? testEmail : intendedRecipient;
      let providerMessageId = null;
      try {
        if (event.event_type !== EVENT_TYPE) throw new Error("unexpected_event_type_claimed");
        const document = await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "get_approval_batch_submitted_notification_document", {
          p_notification_event_id: event.id,
          p_worker_id: workerId,
        });
        const rendered = renderApprovalBatchSubmittedEmail(document, sendMode, deliveryMode);
        const attachment = await prepareApprovalBatchAttachment(document);
        providerMessageId = await sendResendEmail({
          fetchFn: runtime.fetch,
          apiKey: resendApiKey,
          from: fromEmail,
          to: finalRecipient,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          idempotencyKey: `approval-batch-submitted/${event.id}`,
          attachment,
        });
        await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "mark_notification_processed_for_dispatcher", {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_provider_message_id: providerMessageId,
          p_resend_email_id: providerMessageId,
        });
        sent += 1;
        results.push({ event_id: event.id, event_type: EVENT_TYPE, source_folio: event.source_folio, intended_recipient_email: maskEmail(intendedRecipient), final_recipient_email: maskEmail(finalRecipient), status: "sent", provider_message_id: providerMessageId, attachment_filename: attachment.filename, attachment_sha256: attachment.sha256, attachment_size_bytes: attachment.sizeBytes, attachment_pages: attachment.pageCount, pdf_generator: attachment.generator });
      } catch (error) {
        const message = error instanceof Error ? error.message : "approval_batch_submitted_dispatch_failed";
        if (isStaleBatchError(error)) {
          try {
            await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "cancel_approval_batch_submitted_event_for_dispatcher", { p_event_id: event.id, p_worker_id: workerId, p_reason: "approval_batch_no_longer_submitted" });
            cancelled += 1;
            results.push({ event_id: event.id, event_type: EVENT_TYPE, source_folio: event.source_folio, intended_recipient_email: maskEmail(intendedRecipient), final_recipient_email: maskEmail(finalRecipient), status: "cancelled" });
            continue;
          } catch { }
        }
        let markError = "";
        try {
          await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "mark_notification_failed_for_dispatcher", {
            p_event_id: event.id,
            p_error_message: providerMessageId ? `send_succeeded_but_mark_processed_failed:${message}` : message,
            p_worker_id: workerId,
            p_resend_email_id: providerMessageId,
          });
        } catch (markFailure) {
          markError = markFailure instanceof Error ? `;mark_failed_error:${markFailure.message}` : ";mark_failed_error:unknown";
        }
        failed += 1;
        results.push({ event_id: event.id, event_type: EVENT_TYPE, source_folio: event.source_folio, intended_recipient_email: maskEmail(intendedRecipient), final_recipient_email: maskEmail(finalRecipient), status: "failed", error: `${message}${markError}`.slice(0, 300) });
      }
    }
    return jsonResponse({ processed: events.length, sent, failed, cancelled, mode: sendMode, delivery_mode: deliveryMode, event_type: EVENT_TYPE, pdf_generator: SYSTEM_PDF_GENERATOR, events: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "approval_batch_submitted_dispatcher_error";
    return jsonResponse({ error: message.slice(0, 300) }, 500);
  }
}

if (typeof Deno !== "undefined") {
  Deno.serve((req) => handleRequest(req, { env: (name) => Deno.env.get(name), fetch: globalThis.fetch.bind(globalThis) }));
}
