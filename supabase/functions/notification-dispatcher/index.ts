type NotificationEvent = {
  id: string;
  event_type: string;
  source_folio: string | null;
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
  error?: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-notification-dispatcher-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value || !value.trim()) {
    throw new Error(`missing_required_secret:${name}`);
  }
  return value.trim();
}

function requiredEnvAny(names: string[], label: string): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value && value.trim()) {
      return value.trim();
    }
  }
  throw new Error(label);
}

function optionalEnv(name: string, fallback = ""): string {
  return (Deno.env.get(name) || fallback).trim();
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

async function readLimit(req: Request): Promise<number> {
  const url = new URL(req.url);
  const queryLimit = url.searchParams.get("limit");
  if (queryLimit) return clampLimit(queryLimit);

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return 5;

  try {
    const body = await req.json();
    return clampLimit(body?.limit);
  } catch {
    return 5;
  }
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

function renderEmail(event: NotificationEvent, sendMode: string): { subject: string; text: string; html: string } {
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
  supabaseUrl: string,
  serviceRoleKey: string,
  rpcName: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${rpcName}`, {
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

async function sendResendEmail(params: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
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

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    const expectedSecret = requiredEnv("NOTIFICATION_DISPATCHER_SECRET");
    const providedSecret = req.headers.get("x-notification-dispatcher-secret") || "";
    if (providedSecret !== expectedSecret) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const sendMode = optionalEnv("NOTIFICATION_SEND_MODE", "disabled");
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

    const supabaseUrl = requiredEnvAny(["SUPABASE_URL", "SUPABASEURL"], "Missing Supabase URL");
    const serviceRoleKey = requiredEnvAny(
      ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASESERVICEROLEKEY"],
      "Missing Supabase service role key",
    );
    const resendApiKey = requiredEnv("RESEND_API_KEY");
    const fromEmail = requiredEnv("NOTIFICATION_FROM_EMAIL");
    const testEmail = sendMode === "test_only" ? requiredEnv("NOTIFICATION_TEST_EMAIL") : "";
    const workerId = optionalEnv("NOTIFICATION_WORKER_ID", "edge-notification-dispatcher-dev");
    const limit = await readLimit(req);

    const events = await callRpc<NotificationEvent[]>(
      supabaseUrl,
      serviceRoleKey,
      "claim_notification_events_for_dispatcher",
      { p_limit: limit, p_worker_id: workerId },
    );

    const results: DispatchResult[] = [];
    let sent = 0;
    let failed = 0;

    for (const event of events) {
      const intendedRecipient = event.recipient_email;
      const finalRecipient = sendMode === "test_only" ? testEmail : intendedRecipient;
      const rendered = renderEmail(event, sendMode);
      let providerMessageId: string | null = null;

      try {
        providerMessageId = await sendResendEmail({
          apiKey: resendApiKey,
          from: fromEmail,
          to: finalRecipient,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        });

        await callRpc(supabaseUrl, serviceRoleKey, "mark_notification_processed_for_dispatcher", {
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
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "notification_dispatch_failed";
        let markError = "";
        try {
          await callRpc(supabaseUrl, serviceRoleKey, "mark_notification_failed_for_dispatcher", {
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
});
