const EVENT_TYPE = "approval_batch.submitted";
const FUNCTION_NAME = "approval-batch-submitted-dispatcher";
const DEFAULT_WORKER_ID = "edge-approval-batch-submitted-dev";
const EMAIL_LOGO_URL = "https://flux.quantta.mx/assets/email/flux-logo-email-white.png";
const FLUX_URL = "https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app";
const MAX_DISPATCH_LIMIT = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const PDF_ROWS_PER_PAGE = 11;

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

function textValue(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeCurrency(value) {
  return String(value || "MXN").trim().toUpperCase().slice(0, 8) || "MXN";
}

function money(value, currency) {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${normalizeCurrency(currency)} ${safeAmount.toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value) {
  const text = textValue(value);
  if (!text) return "No disponible";
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return text.slice(0, 10);
  return parsed.toLocaleDateString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
}

function formatDateTime(value) {
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

function totalsText(value) {
  if (!Array.isArray(value) || !value.length) return "Sin total disponible";
  return value
    .map((row) => row && typeof row === "object" ? money(row.amount, row.currency) : null)
    .filter(Boolean)
    .join(" | ");
}

function ascii(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFilename(value) {
  const normalized = ascii(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || "corte_semanal";
}

function pdfEscape(value) {
  return ascii(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function truncate(value, maxChars) {
  const text = ascii(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(maxChars - 3, 0))}...`;
}

function wrap(value, maxChars, maxLines = 2) {
  const text = ascii(value);
  if (!text) return ["-"];
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? word.slice(0, maxChars) : word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (text.length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = truncate(lines[lines.length - 1], Math.max(maxChars - 3, 1));
  }
  return lines.slice(0, maxLines);
}

function textCommand(font, size, x, y, value, color = "0.12 0.16 0.15") {
  return `${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(value)}) Tj ET\n`;
}

function rightAlignedTextCommand(font, size, rightX, y, value, color = "0.12 0.16 0.15") {
  const text = ascii(value);
  const approxWidth = text.length * size * 0.52;
  return textCommand(font, size, Math.max(rightX - approxWidth, 0), y, text, color);
}

function pdfPageContent(document, pageIndex, pageCount, pageItems) {
  const batch = document.batch;
  const left = 36;
  const right = 806;
  const top = 559;
  const tableTop = 420;
  const rowHeight = 30;
  const columns = [36, 60, 165, 340, 500, 625, 806];
  let out = "";

  out += "0.086 0.196 0.176 rg 0 523 842 72 re f\n";
  out += textCommand("F2", 20, left, top - 12, "FLUX OPERADORA", "1 1 1");
  out += textCommand("F1", 9, left, top - 31, "Corte semanal para autorizacion", "0.82 0.90 0.85");
  out += rightAlignedTextCommand("F2", 10, right, top - 10, `Pagina ${pageIndex + 1} de ${pageCount}`, "1 1 1");
  out += rightAlignedTextCommand("F1", 8, right, top - 29, `Enviado ${formatDateTime(batch.submitted_at)}`, "0.82 0.90 0.85");

  out += textCommand("F2", 16, left, 498, batch.label || "Corte semanal", "0.086 0.196 0.176");
  out += textCommand("F1", 9, left, 480, `Empresa: ${batch.company || "No disponible"}`);
  out += textCommand("F1", 9, left, 465, `Periodo: ${formatDate(batch.period_start)} - ${formatDate(batch.period_end)}`);
  out += textCommand("F1", 9, 360, 480, `Director: ${batch.director_name || batch.director_email}`);
  out += textCommand("F1", 9, 360, 465, `Enviado: ${formatDateTime(batch.submitted_at)}`);
  out += textCommand("F2", 10, left, 445, `Pagos: ${batch.item_count}   Total: ${totalsText(batch.totals_by_currency)}`, "0.086 0.196 0.176");

  out += "0.812 0.882 0.796 rg 36 396 770 24 re f\n";
  ["#", "Folio", "Proveedor", "Concepto", "Centro / Partida", "Importe"].forEach((header, index) => {
    out += textCommand("F2", 8.5, [42, 65, 170, 345, 505, 630][index], 404, header, "0.086 0.196 0.176");
  });

  pageItems.forEach((item, index) => {
    const globalIndex = pageIndex * PDF_ROWS_PER_PAGE + index + 1;
    const yTop = tableTop - 24 - index * rowHeight;
    const yBottom = yTop - rowHeight + 4;
    if (index % 2 === 1) out += `0.965 0.972 0.958 rg ${left} ${yBottom.toFixed(2)} 770 ${rowHeight} re f\n`;
    out += `0.87 0.89 0.86 RG 0.35 w ${left} ${yBottom.toFixed(2)} m ${right} ${yBottom.toFixed(2)} l S\n`;
    out += textCommand("F1", 8, 42, yTop - 11, String(globalIndex));
    out += textCommand("F2", 8, 65, yTop - 11, truncate(item.request_number || "-", 19));
    wrap(item.provider, 28, 2).forEach((line, lineIndex) => {
      out += textCommand(lineIndex === 0 ? "F2" : "F1", 7.6, 170, yTop - 9 - lineIndex * 10, line);
    });
    wrap(item.concept, 25, 2).forEach((line, lineIndex) => {
      out += textCommand("F1", 7.4, 345, yTop - 9 - lineIndex * 10, line);
    });
    const centerLine = [item.cost_center, item.budget_category].filter(Boolean).join(" / ") || "-";
    wrap(centerLine, 21, 2).forEach((line, lineIndex) => {
      out += textCommand("F1", 7.2, 505, yTop - 9 - lineIndex * 10, line);
    });
    out += rightAlignedTextCommand("F2", 8.2, 798, yTop - 11, money(item.amount, item.currency));
  });

  out += `0.87 0.89 0.86 RG 0.5 w ${left} 46 m ${right} 46 l S\n`;
  out += textCommand("F1", 7.5, left, 30, "Documento informativo. La decision oficial debe registrarse dentro de Flux.", "0.38 0.44 0.41");
  out += rightAlignedTextCommand("F1", 7.5, right, 30, truncate(batch.label, 50), "0.38 0.44 0.41");
  columns.slice(1, -1).forEach((x) => {
    out += `0.91 0.92 0.90 RG 0.25 w ${x} 46 m ${x} 420 l S\n`;
  });
  return out;
}

function buildPdf(objects) {
  const encoder = new TextEncoder();
  const pieces = ["%PDF-1.4\n% Flux Operadora\n"];
  const offsets = [0];
  let byteLength = encoder.encode(pieces[0]).length;
  objects.forEach((body, index) => {
    offsets[index + 1] = byteLength;
    const piece = `${index + 1} 0 obj\n${body}\nendobj\n`;
    pieces.push(piece);
    byteLength += encoder.encode(piece).length;
  });
  const xrefOffset = byteLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  pieces.push(xref);
  return encoder.encode(pieces.join(""));
}

export function generateApprovalBatchPdfBytes(document) {
  const items = Array.isArray(document.items) ? document.items : [];
  const pageCount = Math.max(Math.ceil(items.length / PDF_ROWS_PER_PAGE), 1);
  const pageObjectIds = Array.from({ length: pageCount }, (_, index) => 5 + index * 2);
  const contentObjectIds = Array.from({ length: pageCount }, (_, index) => 6 + index * 2);
  const objects = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageItems = items.slice(pageIndex * PDF_ROWS_PER_PAGE, (pageIndex + 1) * PDF_ROWS_PER_PAGE);
    const content = pdfPageContent(document, pageIndex, pageCount, pageItems);
    const pageObjectId = pageObjectIds[pageIndex];
    const contentObjectId = contentObjectIds[pageIndex];
    objects[pageObjectId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
    objects[contentObjectId - 1] = `<< /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}endstream`;
  }
  return { bytes: buildPdf(objects), pageCount };
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
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "%PDF-1.4") throw new Error("approval_batch_pdf_signature_invalid");
  return {
    filename: `Corte_semanal_${cleanFilename(document.batch.label)}.pdf`,
    content: bytesToBase64(bytes),
    sha256: await sha256Hex(bytes),
    sizeBytes: bytes.length,
    pageCount,
  };
}

export function renderApprovalBatchSubmittedEmail(document, sendMode) {
  const batch = document.batch;
  const prefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${prefix}Corte semanal por autorizar: ${batch.label}`;
  const targetUrl = `${FLUX_URL}/approval_batches.html?batch_id=${encodeURIComponent(batch.id)}`;
  const summaryRows = [
    ["Corte", batch.label],
    ["Empresa", batch.company],
    ["Periodo", `${formatDate(batch.period_start)} - ${formatDate(batch.period_end)}`],
    ["Pagos por revisar", batch.item_count],
    ["Total", totalsText(batch.totals_by_currency)],
    ["Enviado por Finanzas", formatDateTime(batch.submitted_at)],
  ].filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  const text = [
    "Tienes un corte semanal por autorizar.", "",
    "Finanzas envio un corte semanal que requiere tu revision y decision en Flux.",
    "El PDF adjunto contiene el detalle de los pagos incluidos.", "",
    ...summaryRows.map(([label, value]) => `${label}: ${value}`), "",
    `Revisar y autorizar: ${targetUrl}`,
    ...(sendMode === "test_only" ? ["", "Modo DEV TEST: este correo fue redirigido al destinatario de prueba."] : []),
  ].join("\n");
  const htmlRows = summaryRows.map(([label, value]) => `<tr><td style="width:42%;padding:10px 12px 10px 0;border-bottom:1px solid #e8ece7;color:#68716d;font-size:14px;line-height:1.35;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:10px 0;border-bottom:1px solid #e8ece7;color:#1f2926;font-size:14px;line-height:1.35;vertical-align:top;"><strong>${escapeHtml(value)}</strong></td></tr>`).join("");
  const banner = sendMode === "test_only" ? `<div style="margin-top:20px;padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed;color:#7c2d12;font-size:13px;line-height:1.4;">Modo DEV TEST: este correo fue redirigido al destinatario de prueba.</div>` : "";
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#eef1e9;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(subject)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef1e9" style="width:100%;margin:0;padding:0;border-top:8px solid #16322d;background:#eef1e9;"><tr><td align="center" style="padding:24px 12px 18px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:560px;border:1px solid #d8ddd5;border-radius:14px;border-collapse:separate;overflow:hidden;background:#ffffff;"><tr><td bgcolor="#16322d" style="padding:20px 28px;background:#16322d;"><img src="${EMAIL_LOGO_URL}" width="110" alt="Flux" style="display:block;width:110px;max-width:100%;height:auto;border:0;" /></td></tr><tr><td style="padding:24px 28px 30px;font-family:Arial,Helvetica,sans-serif;color:#1f2926;"><h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.2;color:#16322d;">Tienes un corte por autorizar</h1><p style="margin:0 0 10px;font-size:14px;line-height:1.5;color:#1f2926;">Finanzas envió un corte semanal que requiere tu revisión y decisión en Flux.</p><p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#1f2926;">El PDF adjunto contiene el detalle de los pagos incluidos.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;">${htmlRows}</table><table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;"><tr><td bgcolor="#16322d" style="border-radius:6px;"><a href="${targetUrl}" style="display:inline-block;padding:11px 18px;color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">Revisar y autorizar corte</a></td></tr></table>${banner}</td></tr></table><div style="padding:14px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#7b837f;text-align:center;">Flux Operadora &middot; Powered by Quantta</div></td></tr></table></body></html>`;
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
    if (sendMode === "disabled") return jsonResponse({ processed: 0, sent: 0, failed: 0, cancelled: 0, mode: sendMode, event_type: EVENT_TYPE, message: `${FUNCTION_NAME} disabled; no events claimed` });

    const supabaseUrl = requiredEnvAny(runtime, ["SUPABASE_URL", "SUPABASEURL"], "missing_supabase_url");
    const serviceRoleKey = requiredEnvAny(runtime, ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASESERVICEROLEKEY"], "missing_supabase_service_role_key");
    const resendApiKey = requiredEnv(runtime, "RESEND_API_KEY");
    const fromEmail = requiredEnv(runtime, "NOTIFICATION_FROM_EMAIL");
    const testEmail = sendMode === "test_only" ? requiredEnv(runtime, "NOTIFICATION_TEST_EMAIL") : "";
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
      const finalRecipient = sendMode === "test_only" ? testEmail : intendedRecipient;
      let providerMessageId = null;
      try {
        if (event.event_type !== EVENT_TYPE) throw new Error("unexpected_event_type_claimed");
        const document = await callRpc(runtime.fetch, supabaseUrl, serviceRoleKey, "get_approval_batch_submitted_notification_document", {
          p_notification_event_id: event.id,
          p_worker_id: workerId,
        });
        const rendered = renderApprovalBatchSubmittedEmail(document, sendMode);
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
        results.push({ event_id: event.id, event_type: EVENT_TYPE, source_folio: event.source_folio, intended_recipient_email: maskEmail(intendedRecipient), final_recipient_email: maskEmail(finalRecipient), status: "sent", provider_message_id: providerMessageId, attachment_sha256: attachment.sha256, attachment_size_bytes: attachment.sizeBytes, attachment_pages: attachment.pageCount });
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
    return jsonResponse({ processed: events.length, sent, failed, cancelled, mode: sendMode, event_type: EVENT_TYPE, events: results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "approval_batch_submitted_dispatcher_error";
    return jsonResponse({ error: message.slice(0, 300) }, 500);
  }
}

if (typeof Deno !== "undefined") {
  Deno.serve((req) => handleRequest(req, { env: (name) => Deno.env.get(name), fetch: globalThis.fetch.bind(globalThis) }));
}
