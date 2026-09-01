(() => {
  "use strict";

  const ENDPOINT = "https://ucantptjhwttexzmslvm.supabase.co/functions/v1/approval-batch-quick-approve";
  const DEFAULT_REVIEW_URL = "approval_batches.html";
  const DEFAULT_REVIEW_LABEL = "Revisar primero en Flux";
  const DEFAULT_PRIVACY_MESSAGE = "Este enlace sólo permite aprobar todas las partidas pendientes. No permite editar, rechazar ni liberar para pago.";
  let token = null;
  let reviewUrl = DEFAULT_REVIEW_URL;

  const elements = {
    title: document.getElementById("page-title"),
    message: document.getElementById("message"),
    icon: document.getElementById("status-icon"),
    summary: document.getElementById("summary"),
    label: document.getElementById("batch-label"),
    company: document.getElementById("company"),
    period: document.getElementById("period"),
    count: document.getElementById("item-count"),
    totals: document.getElementById("totals"),
    confirmation: document.getElementById("confirmation"),
    approve: document.getElementById("approve-button"),
    review: document.getElementById("review-link"),
    privacy: document.getElementById("privacy-note"),
  };

  function formatDate(value) {
    if (typeof value !== "string") return "—";
    const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "UTC" }).format(parsed)
      : "—";
  }

  function formatTotals(value) {
    if (!Array.isArray(value) || value.length === 0) return "—";
    return value.map((row) => {
      const currency = typeof row?.currency === "string" ? row.currency : "MXN";
      const amount = Number(row?.amount);
      if (!Number.isFinite(amount)) return null;
      try {
        return new Intl.NumberFormat("es-MX", { style: "currency", currency }).format(amount);
      } catch {
        return `${amount.toFixed(2)} ${currency}`;
      }
    }).filter(Boolean).join(" · ") || "—";
  }

  function setReview(url, visible = true) {
    if (typeof url === "string" && url.startsWith("https://flux.quantta.mx/approval_batches.html?batch_id=")) {
      reviewUrl = url;
    }
    elements.review.href = reviewUrl;
    elements.review.hidden = !visible;
  }

  function showState(state, data = {}) {
    elements.summary.hidden = true;
    elements.confirmation.hidden = true;
    elements.approve.hidden = true;
    elements.approve.disabled = false;
    elements.icon.classList.remove("visible");
    elements.icon.textContent = "";
    elements.review.textContent = DEFAULT_REVIEW_LABEL;
    elements.privacy.textContent = DEFAULT_PRIVACY_MESSAGE;

    if (state === "ready") {
      elements.title.textContent = "Confirmar aprobación";
      elements.message.textContent = "Revisa el resumen antes de aprobar el corte completo.";
      elements.label.textContent = String(data.label || "—");
      elements.company.textContent = String(data.company || "—");
      elements.period.textContent = `${formatDate(data.period_start)} – ${formatDate(data.period_end)}`;
      elements.count.textContent = String(data.item_count ?? "—");
      elements.totals.textContent = formatTotals(data.totals_by_currency);
      elements.summary.hidden = false;
      elements.confirmation.hidden = false;
      elements.approve.hidden = false;
      setReview(data.review_url, true);
      return;
    }

    if (state === "approved") {
      elements.icon.textContent = "✓";
      elements.icon.classList.add("visible");
      elements.title.textContent = "Corte aprobado";
      elements.message.textContent = "✓ Corte aprobado correctamente.";
      elements.review.textContent = "Continuar en Flux";
      elements.privacy.textContent = "La aprobación quedó registrada. Puedes cerrar esta ventana con seguridad o continuar en Flux.";
      setReview(data.review_url, true);
      return;
    }
    if (state === "already_approved") {
      elements.icon.textContent = "✓";
      elements.icon.classList.add("visible");
      elements.title.textContent = "Corte aprobado";
      elements.message.textContent = "✓ Este corte ya fue aprobado.";
      elements.review.textContent = "Continuar en Flux";
      elements.privacy.textContent = "La aprobación quedó registrada. Puedes cerrar esta ventana con seguridad o continuar en Flux.";
      setReview(data.review_url, true);
      return;
    }
    if (state === "expired") {
      elements.title.textContent = "Enlace expirado";
      elements.message.textContent = "Este enlace expiró. Revisa el corte en Flux.";
      setReview(data.review_url, true);
      return;
    }
    if (state === "decisions_recorded") {
      elements.title.textContent = "Revisión requerida";
      elements.message.textContent = "Este corte ya tiene decisiones registradas. Revísalo en Flux.";
      setReview(data.review_url, true);
      return;
    }
    if (state === "changed") {
      elements.title.textContent = "El corte cambió";
      elements.message.textContent = "El corte cambió desde que se generó este correo. Revísalo nuevamente en Flux.";
      setReview(data.review_url, true);
      return;
    }

    elements.title.textContent = "Enlace no válido";
    elements.message.textContent = "Este enlace no es válido.";
    setReview(null, false);
  }

  async function request(action) {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({ action, token }),
    });
    let body = {};
    try { body = await response.json(); } catch { /* controlled below */ }
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
    elements.approve.textContent = "Aprobando...";
    elements.message.textContent = "Confirmando aprobación segura...";
    try {
      const result = await request("approve");
      showState(result.state, result);
    } catch {
      showState("invalid");
    } finally {
      elements.approve.textContent = "Confirmar aprobación";
    }
  });

  const fragment = new URLSearchParams(location.hash.slice(1));
  token = fragment.get("token");
  history.replaceState(null, document.title, `${location.pathname}${location.search}`);

  if (!token) showState("invalid");
  else preview();
})();
