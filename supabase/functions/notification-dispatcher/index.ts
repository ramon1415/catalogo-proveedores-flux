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

function money(value: unknown, currency: unknown): string {
  const amount = Number(value || 0);
  const safeCurrency = String(currency || "MXN").slice(0, 8);
  if (!Number.isFinite(amount)) return safeCurrency;
  return `${safeCurrency} ${amount.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function clampLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(Math.max(Math.trunc(parsed), 1), 10);
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
    default:
      return "Hay una actualizacion disponible en Flux.";
  }
}

function renderEmail(event: NotificationEvent, sendMode: string): { subject: string; text: string; html: string } {
  const payload = event.payload || {};
  const subjectPrefix = sendMode === "test_only" ? "[DEV TEST] " : "";
  const subject = `${subjectPrefix}${event.subject || baseSubject(event)}`;
  const rows = [
    ["Folio", event.source_folio || payload.folio],
    ["Proveedor", payload.provider],
    ["Monto", money(payload.amount, payload.currency)],
    ["Empresa", payload.company],
    ["Centro de costo", payload.cost_center],
    ["Partida", payload.budget_category],
    ["Solicitante", payload.requester],
    ["Estatus", payload.status],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");

  const textLines = [
    actionText(event.event_type),
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Abrir Flux: /solicitudes.html",
  ];

  const htmlRows = rows
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(label)}</td><td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td></tr>`)
    .join("");

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.45;color:#111">
      <p>${escapeHtml(actionText(event.event_type))}</p>
      <table style="border-collapse:collapse">${htmlRows}</table>
      <p style="margin-top:18px;color:#555">Abrir Flux: <strong>/solicitudes.html</strong></p>
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

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
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
