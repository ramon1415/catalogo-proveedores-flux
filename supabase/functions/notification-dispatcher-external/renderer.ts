export const FIELD_LABELS = Object.freeze(
  {
    provider_name: "Nombre o razón social",
    provider_rfc: "RFC",
    provider_email: "Correo electrónico",
    provider_phone: "Teléfono",
    concept: "Concepto",
    description: "Descripción",
    amount_requested: "Importe solicitado",
    currency: "Moneda",
    requested_payment_date: "Fecha solicitada de pago",
    invoice_folio: "Folio de factura",
    invoice_uuid: "UUID de factura",
    invoice_date: "Fecha de factura",
    invoice_pdf: "Factura PDF",
    invoice_xml: "Factura XML",
    bank_document: "Documento bancario",
    beneficiary_name: "Nombre del beneficiario",
  } as const,
);

type EventType =
  | "provider_intake.received"
  | "provider_intake.correction_requested"
  | "provider_intake.rejected";

type RenderedEmail = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function exactKeys(
  payload: Record<string, unknown>,
  allowed: string[],
): boolean {
  const actual = Object.keys(payload).sort();
  return actual.length === allowed.length &&
    actual.every((key, index) => key === [...allowed].sort()[index]);
}

function commonPayload(
  payload: Record<string, unknown>,
): { folio: string; occurredOn: string } {
  if (
    payload.event_version !== 1 || payload.template_version !== 1 ||
    payload.locale !== "es-MX"
  ) {
    throw new Error("renderer_contract_failed");
  }
  const folio = String(payload.public_folio || "");
  const occurredOn = String(payload.occurred_on || "");
  if (
    !/^INT-\d{4}-\d{6}$/.test(folio) || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)
  ) {
    throw new Error("renderer_contract_failed");
  }
  return { folio, occurredOn };
}

function plainMessage(value: unknown): string {
  const message = String(value || "");
  if (
    message !== message.trim() || message.length < 10 || message.length > 1000
  ) {
    throw new Error("renderer_contract_failed");
  }
  if (
    /[\u0000-\u001F\u007F]/.test(message) || /<[^>]*>/.test(message) ||
    /(https?:\/\/|www\.|mailto:)/i.test(message) ||
    /[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(message) ||
    /\d{10,}/.test(message.replace(/[\s-]/g, "")) ||
    /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(message) ||
    /\b(aprobador(?:es)?|presupuesto|cuentas?|clabe|matching|match[_ -]?score|reason[_ -]?code)\b/i
      .test(message)
  ) {
    throw new Error("renderer_contract_failed");
  }
  return message;
}

function htmlParagraphs(lines: string[]): string {
  return lines.map((line) => line ? `<p>${escapeHtml(line)}</p>` : "<br>").join(
    "",
  );
}

export function renderExternalEmail(
  eventType: string,
  payload: Record<string, unknown>,
): RenderedEmail {
  const typedEvent = eventType as EventType;
  const common = commonPayload(payload);

  if (typedEvent === "provider_intake.received") {
    if (
      !exactKeys(payload, [
        "event_version",
        "template_version",
        "locale",
        "public_folio",
        "occurred_on",
      ])
    ) {
      throw new Error("renderer_contract_failed");
    }
    const subject = `Recibimos tu solicitud — ${common.folio}`;
    const text =
      `Recibimos tu solicitud ${common.folio} el ${common.occurredOn}.\nNuestro equipo la revisará y te informará si necesitamos información adicional.\n\nEste correo es informativo y no contiene enlaces.`;
    return { subject, text, html: htmlParagraphs(text.split("\n")) };
  }

  if (typedEvent === "provider_intake.rejected") {
    if (
      !exactKeys(payload, [
        "event_version",
        "template_version",
        "locale",
        "public_folio",
        "occurred_on",
        "external_message",
      ])
    ) {
      throw new Error("renderer_contract_failed");
    }
    const message = plainMessage(payload.external_message);
    const subject = `Resultado de tu solicitud — ${common.folio}`;
    const text =
      `Concluimos la revisión de tu solicitud ${common.folio}.\n\n${message}`;
    return { subject, text, html: htmlParagraphs(text.split("\n")) };
  }

  if (typedEvent === "provider_intake.correction_requested") {
    if (
      !exactKeys(payload, [
        "event_version",
        "template_version",
        "locale",
        "public_folio",
        "occurred_on",
        "external_message",
        "field_codes",
      ])
    ) {
      throw new Error("renderer_contract_failed");
    }
    const message = plainMessage(payload.external_message);
    if (
      !Array.isArray(payload.field_codes) || payload.field_codes.length === 0
    ) {
      throw new Error("renderer_contract_failed");
    }
    const unique = [...new Set(payload.field_codes.map(String))];
    if (
      unique.length !== payload.field_codes.length ||
      unique.some((code) => !(code in FIELD_LABELS))
    ) {
      throw new Error("renderer_contract_failed");
    }
    const labels = unique.sort().map((code) =>
      FIELD_LABELS[code as keyof typeof FIELD_LABELS]
    );
    const subject = `Necesitamos información adicional — ${common.folio}`;
    const text =
      `Necesitamos información adicional para continuar con tu solicitud\n${common.folio}.\n\n${message}\n\nCampos por revisar:\n${
        labels.map((label) => `- ${label}`).join("\n")
      }`;
    return { subject, text, html: htmlParagraphs(text.split("\n")) };
  }

  throw new Error("renderer_contract_failed");
}
