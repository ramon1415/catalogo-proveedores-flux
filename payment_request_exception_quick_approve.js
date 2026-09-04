(() => {
  "use strict";

  const DEFAULT_REVIEW_URL = "/aprobaciones.html";
  const DEFAULT_REVIEW_LABEL = "Revisar primero en Flux";
  const DEFAULT_PRIVACY_MESSAGE = "Este enlace sólo permite autorizar esta excepción. No permite editar, rechazar ni modificar el monto. Para rechazar o pedir cambios entra a Flux.";
  const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
  let token = null;
  let endpoint = null;
  let reviewUrl = DEFAULT_REVIEW_URL;

  const elements = {
    title: document.getElementById("page-title"),
    message: document.getElementById("message"),
    icon: document.getElementById("status-icon"),
    banner: document.getElementById("exception-banner"),
    bannerDetail: document.getElementById("exception-detail"),
    summary: document.getElementById("summary"),
    folio: document.getElementById("folio"),
    provider: document.getElementById("provider"),
    amount: document.getElementById("amount"),
    budgetCategory: document.getElementById("budget-category"),
    costCenter: document.getElementById("cost-center"),
    requester: document.getElementById("requester"),
    shortfallRow: document.getElementById("shortfall-row"),
    shortfall: document.getElementById("shortfall"),
    confirmation: document.getElementById("confirmation"),
    approve: document.getElementById("approve-button"),
    review: document.getElementById("review-link"),
    privacy: document.getElementById("privacy-note"),
  };

  function base64UrlToText(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  function endpointFromToken(value) {
    const segments = String(value || "").split(".");
    if (segments.length !== 2) return null;
    try {
      const payload = JSON.parse(base64UrlToText(segments[0]));
      const projectRef = String(payload?.project_ref || "");
      if (!PROJECT_REF_PATTERN.test(projectRef)) return null;
      return `https://${projectRef}.supabase.co/functions/v1/payment-request-exception-quick-approve`;
    } catch {
      return null;
    }
  }

  function formatMoney(value, currency) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    const safeCurrency = typeof currency === "string" && currency ? currency : "MXN";
    try {
      return new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: safeCurrency,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${safeCurrency}`;
    }
  }

  function normalizedReviewUrl(value) {
    try {
      const parsed = new URL(String(value || DEFAULT_REVIEW_URL), location.origin);
      if (
        parsed.origin !== location.origin ||
        parsed.pathname !== "/aprobaciones.html"
      ) return DEFAULT_REVIEW_URL;
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return DEFAULT_REVIEW_URL;
    }
  }

  function setReview(url, visible = true) {
    reviewUrl = normalizedReviewUrl(url);
    elements.review.href = reviewUrl;
    elements.review.hidden = !visible;
  }

  function reset() {
    elements.summary.hidden = true;
    elements.banner.hidden = true;
    elements.confirmation.hidden = true;
    elements.approve.hidden = true;
    elements.approve.disabled = false;
    elements.shortfallRow.hidden = true;
    elements.icon.classList.remove("visible");
    elements.icon.textContent = "";
    elements.review.textContent = DEFAULT_REVIEW_LABEL;
    elements.privacy.textContent = DEFAULT_PRIVACY_MESSAGE;
  }

  function showState(state, data = {}) {
    reset();

    if (state === "ready") {
      elements.title.textContent = "Autorizar excepción";
      elements.message.textContent =
        "Revisa el detalle antes de autorizar esta excepción de presupuesto.";

      const currency = typeof data.currency === "string" ? data.currency : "MXN";
      const isExtraordinary = data.is_extraordinary_adjustment === true;
      elements.bannerDetail.textContent = isExtraordinary
        ? "Ajuste extraordinario fuera del presupuesto aprobado."
        : "Esta solicitud excede el presupuesto disponible de la partida.";
      elements.banner.hidden = false;

      elements.folio.textContent = String(data.folio || "—");
      elements.provider.textContent = String(data.provider || "—");
      elements.amount.textContent = formatMoney(data.amount, currency) || "—";
      elements.budgetCategory.textContent = String(data.budget_category || "—");
      elements.costCenter.textContent = String(data.cost_center || "—");
      elements.requester.textContent = String(data.requester || "—");

      const shortfall = formatMoney(data.budget_shortfall, currency);
      if (shortfall && Number(data.budget_shortfall) > 0) {
        elements.shortfall.textContent = shortfall;
        elements.shortfallRow.hidden = false;
      }

      elements.summary.hidden = false;
      elements.confirmation.hidden = false;
      elements.approve.hidden = false;
      setReview(data.review_url, true);
      return;
    }

    if (state === "approved" || state === "already_approved") {
      elements.icon.textContent = "✓";
      elements.icon.classList.add("visible");
      elements.title.textContent = "Excepción autorizada";
      elements.message.textContent = state === "approved"
        ? "✓ La excepción quedó autorizada correctamente."
        : "✓ Esta excepción ya fue autorizada.";
      elements.review.textContent = "Continuar en Flux";
      elements.privacy.textContent =
        "La autorización quedó registrada. Puedes cerrar esta ventana con seguridad o continuar en Flux.";
      setReview(data.review_url, true);
      return;
    }
    if (state === "expired") {
      elements.title.textContent = "Enlace expirado";
      elements.message.textContent =
        "Este enlace expiró. Revisa la solicitud en Flux.";
      setReview(data.review_url, true);
      return;
    }
    if (state === "changed") {
      elements.title.textContent = "La solicitud cambió";
      elements.message.textContent =
        "La solicitud cambió desde que se generó este correo (monto, partida o estatus). Revísala nuevamente en Flux.";
      setReview(data.review_url, true);
      return;
    }

    elements.title.textContent = "Enlace no válido";
    elements.message.textContent = "Este enlace no es válido.";
    setReview(null, false);
  }

  async function request(action) {
    if (!endpoint) return { state: "invalid" };
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ action, token }),
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      // Controlled below.
    }
    if (!body || typeof body !== "object") return { state: "invalid" };
    return body;
  }

  async function preview() {
    try {
      const result = await request("preview");
      showState(result.state, result);
    } catch {
      showState("invalid");
    }
  }

  elements.approve.addEventListener("click", async () => {
    elements.approve.disabled = true;
    elements.approve.textContent = "Autorizando...";
    elements.message.textContent = "Confirmando autorización segura...";
    try {
      const result = await request("approve");
      showState(result.state, result);
    } catch {
      showState("invalid");
    } finally {
      elements.approve.textContent = "Confirmar autorización";
    }
  });

  const fragment = new URLSearchParams(location.hash.slice(1));
  token = fragment.get("token");
  endpoint = endpointFromToken(token);
  history.replaceState(
    null,
    document.title,
    `${location.pathname}${location.search}`,
  );

  if (!token || !endpoint) showState("invalid");
  else preview();
})();
