;(function layoutsResultExtension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase();
  if (pageName !== "layouts.html") return;

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!client) return;

  const PREVIEW_LIMIT = 30;
  const FIELD_LABELS = {
    company_bank_account_id: "Falta seleccionar cuenta origen en la solicitud.",
    source_account_number: "La cuenta origen seleccionada no tiene numero de cuenta capturado.",
    destination_type: "Falta definir el tipo de destino de pago del proveedor: CLABE, cuenta o convenio.",
    destination_value: "Falta capturar el destino de pago del proveedor.",
    beneficiary_name: "Falta beneficiario para layout en el proveedor.",
    company_name: "Falta nombre de la empresa origen.",
    proveedor_id: "Falta proveedor en la solicitud.",
    clabe: "El proveedor esta configurado para CLABE, pero no tiene CLABE capturada.",
    cuenta_bancaria: "El proveedor esta configurado para cuenta bancaria, pero no tiene cuenta capturada.",
    convenio_number: "El proveedor esta configurado para convenio, pero no tiene numero de convenio.",
    payment_reference: "Falta referencia de pago en la solicitud.",
    payment_concept: "Falta concepto de pago en la solicitud.",
    amount: "Falta monto del pago.",
    amount_requested: "Falta monto solicitado.",
  };
  const SHORT_LABELS = {
    company_bank_account_id: "Cuenta origen",
    source_account_number: "Numero de cuenta origen",
    destination_type: "Tipo de destino",
    destination_value: "Destino de pago",
    beneficiary_name: "Beneficiario",
    company_name: "Empresa origen",
    proveedor_id: "Proveedor",
    clabe: "CLABE",
    cuenta_bancaria: "Cuenta bancaria",
    convenio_number: "Convenio",
    payment_reference: "Referencia de pago",
    payment_concept: "Concepto de pago",
    amount: "Monto",
    amount_requested: "Monto solicitado",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => window.setTimeout(init, 0));
  } else {
    window.setTimeout(init, 0);
  }

  function init() {
    injectStyles();
    const form = document.getElementById("newLayoutForm");
    if (!form || form.dataset.resultExtensionBound === "true") return;
    form.dataset.resultExtensionBound = "true";
    form.addEventListener("submit", submitNewLayoutWithResult, true);
  }

  async function submitNewLayoutWithResult(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const dom = getDom();
    clearResult(dom);

    const profileId = await resolveProfileId();
    if (!profileId) {
      toast("Perfil no identificado", "No se pudo identificar tu perfil de usuario.", "error");
      return;
    }

    const periodStart = dom.periodStart.value;
    const periodEnd = dom.periodEnd.value;
    if (!periodStart || !periodEnd) {
      toast("Fechas requeridas", "Captura fecha inicio y fecha fin.", "error");
      return;
    }
    if (periodStart > periodEnd) {
      toast("Rango invalido", "La fecha inicio no puede ser mayor a la fecha fin.", "error");
      return;
    }

    setButton(dom.submitBtn, true, "Creando layout...");
    try {
      const { data, error } = await client.rpc("create_payment_layout", {
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_generated_by: profileId,
        p_name: clean(dom.layoutName.value) || null,
        p_company_id: dom.companyId.value || null,
        p_company_bank_account_id: dom.bankAccountId.value || null,
      });
      if (error) throw error;

      await refreshLayouts();
      const diagnostics = await collectCandidateDiagnostics({
        data: data || {},
        periodStart,
        periodEnd,
        companyId: dom.companyId.value || null,
        bankAccountId: dom.bankAccountId.value || null,
      });
      renderResult(dom, data || {}, diagnostics);

      const invalidCount = Number(data?.invalid_count || 0);
      if (data?.message === "no_valid_payment_requests") {
        toast(
          "Solicitudes incompletas",
          "No se creo layout porque las solicitudes aprobadas tienen datos pendientes.",
          "warning"
        );
        return;
      }

      toast(
        "Layout creado correctamente",
        invalidCount
          ? `${data?.layout_number || "El layout"} se creo con ${Number(data?.payment_count || 0)} registros. ${invalidCount} solicitudes quedaron fuera.`
          : `${data?.layout_number || "El layout"} quedo en borrador con ${Number(data?.payment_count || 0)} registros.`,
        invalidCount ? "warning" : "success"
      );
    } catch (error) {
      renderError(dom, friendlyError(error));
      toast("No se pudo crear layout", friendlyError(error), "error");
    } finally {
      setButton(dom.submitBtn, false, "Crear layout");
    }
  }

  function getDom() {
    return {
      periodStart: document.getElementById("layoutPeriodStart"),
      periodEnd: document.getElementById("layoutPeriodEnd"),
      layoutName: document.getElementById("layoutName"),
      companyId: document.getElementById("layoutCompanyId"),
      bankAccountId: document.getElementById("layoutBankAccountId"),
      resultBox: document.getElementById("layoutInvalidBox"),
      submitBtn: document.getElementById("submitNewLayoutBtn"),
      toastStack: document.getElementById("toastStack"),
    };
  }

  function clearResult(dom) {
    dom.resultBox.classList.add("hidden");
    dom.resultBox.innerHTML = "";
  }

  async function collectCandidateDiagnostics({ data, periodStart, periodEnd, companyId, bankAccountId }) {
    try {
      const [requestsResult, linesResult, layoutsResult] = await Promise.all([
        client
          .from("payment_requests")
          .select("id,request_number,request_type,status,company_id,company_bank_account_id,scheduled_payment_date,updated_at,currency,amount_requested,payment_reference,payment_concept,proveedor_id")
          .eq("status", "approved")
          .limit(1000),
        client
          .from("payment_layout_lines")
          .select("id,payment_request_id,layout_id,status")
          .limit(2000),
        client
          .from("payment_layouts")
          .select("id,layout_number,status")
          .limit(1000),
      ]);

      if (requestsResult.error || linesResult.error || layoutsResult.error) return { notIncluded: [] };

      const invalidIds = new Set((data.invalid_requests || []).map((item) => item.payment_request_id).filter(Boolean));
      const includedIds = new Set((linesResult.data || [])
        .filter((line) => line.layout_id === data.layout_id)
        .map((line) => line.payment_request_id));
      const layoutsById = new Map((layoutsResult.data || []).map((layout) => [layout.id, layout]));
      const linesByRequest = new Map();
      (linesResult.data || []).forEach((line) => {
        const layout = layoutsById.get(line.layout_id);
        if (!layout || layout.status === "cancelled") return;
        if (!linesByRequest.has(line.payment_request_id)) linesByRequest.set(line.payment_request_id, []);
        linesByRequest.get(line.payment_request_id).push({ ...line, layout });
      });

      const notIncluded = (requestsResult.data || [])
        .filter((request) => !invalidIds.has(request.id) && !includedIds.has(request.id))
        .map((request) => {
          const reasons = exclusionReasons(request, {
            periodStart,
            periodEnd,
            companyId,
            bankAccountId,
            lines: linesByRequest.get(request.id) || [],
          });
          return reasons.length ? { request, reasons } : null;
        })
        .filter(Boolean);

      return { notIncluded };
    } catch (_) {
      return { notIncluded: [] };
    }
  }

  function exclusionReasons(request, context) {
    const reasons = [];
    const type = request.request_type || "provider_payment";
    const effectiveDate = (request.scheduled_payment_date || request.updated_at || "").slice(0, 10);

    if (type === "cash" || type === "check") {
      reasons.push(type === "cash" ? "Es solicitud de efectivo; se opera en Efectivo y comprobaciones." : "Es solicitud de cheque; se opera en Efectivo y comprobaciones.");
    } else if (!["provider_payment", "transfer", "transferencia", "", null].includes(type)) {
      reasons.push("El tipo de solicitud no corresponde a layout de pago por transferencia.");
    }

    if (context.companyId && request.company_id !== context.companyId) {
      reasons.push("No coincide con la empresa seleccionada en el filtro.");
    }

    if (context.bankAccountId && request.company_bank_account_id !== context.bankAccountId) {
      reasons.push("No coincide con la cuenta origen seleccionada en el filtro.");
    }

    if (!effectiveDate) {
      reasons.push("No tiene fecha programada ni fecha de actualizacion para ubicarla en el periodo.");
    } else if (effectiveDate < context.periodStart || effectiveDate > context.periodEnd) {
      reasons.push(`Fuera del periodo seleccionado (${formatDate(effectiveDate)}).`);
    }

    if (request.currency && request.currency !== "MXN") {
      reasons.push("La moneda no es MXN.");
    }

    if (Number(request.amount_requested || 0) <= 0) {
      reasons.push("El monto solicitado no es mayor a cero.");
    }

    const previousLine = context.lines.find((line) => line.layout_id !== undefined);
    if (previousLine?.layout) {
      reasons.push(`Ya esta ligada al layout ${previousLine.layout.layout_number || "sin folio"} (${statusLabel(previousLine.layout.status)}).`);
    }

    return reasons;
  }

  function renderResult(dom, data, diagnostics = { notIncluded: [] }) {
    const invalidRequests = data.invalid_requests || [];
    const hasLayout = Boolean(data.layout_id || data.layout_number);
    const included = Number(data.payment_count || 0);
    const invalidCount = Number(data.invalid_count ?? invalidRequests.length ?? 0);
    const companyCount = Number(data.company_count || 0);
    const totalAmount = Number(data.total_amount || 0);
    const noValid = data.message === "no_valid_payment_requests" || (!hasLayout && !included);
    const title = noValid
      ? (invalidRequests.length ? "No se pudo crear layout porque las solicitudes aprobadas tienen datos incompletos." : "No hay solicitudes validas para generar layout en este periodo.")
      : `${data.layout_number || "Layout creado"} generado en borrador`;
    const subtitle = noValid
      ? "No se creo ningun layout porque no hubo solicitudes completas para incluir."
      : invalidCount
        ? "El layout se creo con las solicitudes completas. Las solicitudes con datos pendientes quedaron fuera."
        : "Todas las solicitudes validas del periodo quedaron incluidas en el layout.";

    dom.resultBox.innerHTML = `
      <div class="layout-result ${noValid ? "warning" : "success"}">
        <div class="layout-result-header">
          <div>
            <span class="layout-result-kicker">${noValid ? "Resultado de validacion" : "Layout creado"}</span>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(subtitle)}</p>
          </div>
          ${hasLayout ? `<span class="layout-result-number">${escapeHtml(data.layout_number || "Layout")}</span>` : ""}
        </div>
        <div class="layout-result-metrics">
          ${metric("Registros incluidos", included)}
          ${metric("Solicitudes fuera", invalidCount)}
          ${metric("Empresas", companyCount)}
          ${metric("Monto incluido", formatCurrency(totalAmount))}
        </div>
        ${data.layout_id && included ? `
          <div class="layout-result-actions">
            <button type="button" class="small-btn success" data-open-created-lines="${escapeHtml(data.layout_id)}">Ver lineas generadas</button>
            <span class="field-hint">El archivo CxC BBVA se descarga despues desde la tabla de layouts.</span>
          </div>
        ` : ""}
        ${invalidRequests.length ? invalidPanel(invalidRequests) : ""}
        ${diagnostics.notIncluded?.length ? notIncludedPanel(diagnostics.notIncluded) : ""}
      </div>`;
    dom.resultBox.classList.remove("hidden");
    dom.resultBox.querySelector("[data-open-created-lines]")?.addEventListener("click", (click) => {
      window.openLayoutLines?.(click.currentTarget.dataset.openCreatedLines);
    });
  }

  function notIncludedPanel(items) {
    const visible = items.slice(0, PREVIEW_LIMIT);
    const remaining = items.length - visible.length;
    return `
      <div class="layout-invalid-panel layout-not-included-panel">
        <div class="layout-invalid-summary">
          <div>
            <strong>Aprobadas no consideradas</strong>
            <p>Estas solicitudes estan aprobadas, pero la funcion no las tomo como candidatas para este layout.</p>
          </div>
          <span>${items.length}</span>
        </div>
        <div class="layout-invalid-scroll">
          <ul class="layout-invalid-list">${visible.map(notIncludedItem).join("")}</ul>
        </div>
        ${remaining > 0 ? `<p class="muted-line">Mostrando ${visible.length} de ${items.length}. Hay ${remaining} adicionales.</p>` : ""}
      </div>`;
  }

  function notIncludedItem(item) {
    const request = item.request || {};
    const requestUrl = request.id ? `./solicitudes.html?request_id=${encodeURIComponent(request.id)}` : "./solicitudes.html";
    return `
      <li>
        <div>
          <strong>${escapeHtml(request.request_number || request.id || "Solicitud")}</strong>
          <span class="muted-line">No considerada</span>
        </div>
        <div class="layout-not-included-reasons">${item.reasons.map((reason) => `<span>${escapeHtml(reason)}</span>`).join("")}</div>
        <a class="small-btn" href="${escapeHtml(requestUrl)}">Ver solicitud</a>
      </li>`;
  }

  function renderError(dom, message) {
    dom.resultBox.innerHTML = `
      <div class="layout-result warning">
        <div class="layout-result-header">
          <div>
            <span class="layout-result-kicker">No se pudo crear</span>
            <strong>${escapeHtml(message)}</strong>
            <p>Revisa el periodo y los datos requeridos antes de intentar nuevamente.</p>
          </div>
        </div>
      </div>`;
    dom.resultBox.classList.remove("hidden");
  }

  function metric(label, value) {
    return `
      <div class="layout-result-metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </div>`;
  }

  function invalidPanel(invalidRequests) {
    const visible = invalidRequests.slice(0, PREVIEW_LIMIT);
    const remaining = invalidRequests.length - visible.length;
    return `
      <div class="layout-invalid-panel">
        <div class="layout-invalid-summary">
          <div>
            <strong>Solicitudes fuera del layout</strong>
            <p>Corrige primero los faltantes mas repetidos. Si son muchos registros, la lista queda contenida aqui.</p>
          </div>
          <span>${invalidRequests.length}</span>
        </div>
        ${missingSummary(invalidRequests)}
        <div class="layout-invalid-scroll">
          <ul class="layout-invalid-list">${visible.map(invalidItem).join("")}</ul>
        </div>
        ${remaining > 0 ? `<p class="muted-line">Mostrando ${visible.length} de ${invalidRequests.length}. Hay ${remaining} solicitudes adicionales con datos pendientes.</p>` : ""}
      </div>`;
  }

  function missingSummary(invalidRequests) {
    const counts = new Map();
    invalidRequests.forEach((item) => {
      missingFields(item.missing_fields).forEach((field) => counts.set(field, (counts.get(field) || 0) + 1));
    });
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!top.length) return "";
    return `<div class="layout-missing-summary">${top.map(([field, count]) => `<span class="layout-missing-pill">${escapeHtml(shortLabel(field))}: ${count}</span>`).join("")}</div>`;
  }

  function invalidItem(item) {
    const requestId = item.payment_request_id || "";
    const requestUrl = requestId ? `./solicitudes.html?request_id=${encodeURIComponent(requestId)}` : "./solicitudes.html";
    return `
      <li>
        <div>
          <strong>${escapeHtml(item.request_number || item.payment_request_id || "Solicitud")}</strong>
          <span class="muted-line">Fuera del layout</span>
        </div>
        <div class="layout-invalid-fields">${missingTags(item.missing_fields)}</div>
        <a class="small-btn" href="${escapeHtml(requestUrl)}">Ver solicitud</a>
      </li>`;
  }

  function missingTags(fields) {
    return missingFields(fields)
      .map((field) => `<span class="layout-missing-tag" title="${escapeHtml(FIELD_LABELS[field] || humanize(field))}">${escapeHtml(shortLabel(field))}</span>`)
      .join("");
  }

  function missingFields(fields) {
    const list = Array.isArray(fields) ? fields : String(fields || "datos incompletos").split(",");
    return list.map((field) => String(field).trim()).filter(Boolean);
  }

  function shortLabel(field) {
    return SHORT_LABELS[field] || humanize(field);
  }

  function humanize(field) {
    return String(field || "datos incompletos").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  async function resolveProfileId() {
    const { data: { session }, error } = await client.auth.getSession();
    if (error || !session?.user) return null;
    const lookups = [
      { column: "auth_user_id", value: session.user.id },
      { column: "id", value: session.user.id },
      { column: "email", value: session.user.email },
    ].filter((item) => item.value);

    for (const lookup of lookups) {
      const { data } = await client
        .from("profiles")
        .select("id")
        .eq(lookup.column, lookup.value)
        .maybeSingle();
      if (data?.id) return data.id;
    }
    return null;
  }

  async function refreshLayouts() {
    if (typeof window.loadLayouts === "function") {
      await window.loadLayouts();
      return;
    }
    document.getElementById("refreshBtn")?.click();
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Error desconocido");
    const known = {
      generated_by_profile_not_found: "No se pudo identificar tu perfil de usuario.",
      no_valid_payment_requests: "No hay solicitudes validas para este periodo.",
      period_dates_required: "Captura fecha inicio y fecha fin.",
      invalid_period_range: "La fecha inicio no puede ser mayor a la fecha fin.",
      company_not_found: "La empresa seleccionada no existe.",
      company_bank_account_not_found_or_inactive: "La cuenta origen no existe o esta inactiva.",
    };
    const key = Object.keys(known).find((item) => message.includes(item));
    if (key) return known[key];
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "La operacion fue bloqueada por permisos.";
    return message;
  }

  function setButton(button, loading, text) {
    if (!button) return;
    button.disabled = loading;
    button.textContent = text;
  }

  function toast(title, message, type = "success") {
    if (typeof window.showToast === "function") {
      window.showToast(title, message, type);
      return;
    }
    const stack = document.getElementById("toastStack");
    if (!stack) return window.alert(`${title}\n${message}`);
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    stack.appendChild(node);
    window.setTimeout(() => node.remove(), 6200);
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return "sin fecha";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function statusLabel(status) {
    const labels = {
      draft: "borrador",
      generated: "generado",
      uploaded: "subido",
      confirmed: "confirmado",
      cancelled: "cancelado",
    };
    return labels[status] || status || "sin estatus";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function injectStyles() {
    if (document.getElementById("layoutsResultExtensionStyles")) return;
    const style = document.createElement("style");
    style.id = "layoutsResultExtensionStyles";
    style.textContent = `
      #layoutInvalidBox { padding:0; color:var(--text-2); }
      .layout-result { border:1px solid var(--border-strong); border-radius:16px; padding:14px; background:rgba(255,255,255,.018); display:flex; flex-direction:column; gap:13px; }
      .layout-result.success { border-color:rgba(18,183,106,.24); }
      .layout-result.warning { border-color:rgba(245,158,11,.28); }
      .layout-result-header { display:flex; justify-content:space-between; align-items:flex-start; gap:14px; }
      .layout-result-kicker { display:block; margin-bottom:5px; color:var(--text-3); font-size:10px; font-weight:800; letter-spacing:.65px; text-transform:uppercase; }
      .layout-result-header strong { display:block; color:var(--text-1); font-size:14px; }
      .layout-result-header p { margin-top:4px; color:var(--text-3); font-size:12px; line-height:1.45; }
      .layout-result-number { flex-shrink:0; border-radius:999px; padding:7px 11px; background:var(--accent-dim); color:var(--accent-text); border:1px solid rgba(94,234,212,.24); font-size:12px; font-weight:800; }
      .layout-result-metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
      .layout-result-metric { border:1px solid var(--border); border-radius:12px; padding:10px; background:var(--bg-input); }
      .layout-result-metric span { display:block; color:var(--text-3); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.45px; }
      .layout-result-metric strong { display:block; margin-top:4px; color:var(--text-1); font-size:15px; }
      .layout-result-actions { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
      .layout-invalid-panel { border-top:1px solid var(--border); padding-top:13px; display:flex; flex-direction:column; gap:10px; }
      .layout-invalid-summary { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
      .layout-invalid-summary strong { display:block; color:var(--text-1); font-size:13px; }
      .layout-invalid-summary p { margin-top:3px; color:var(--text-3); font-size:12px; line-height:1.45; }
      .layout-invalid-summary > span { flex-shrink:0; border-radius:999px; padding:6px 10px; background:var(--amber-dim); color:var(--amber); border:1px solid rgba(245,158,11,.28); font-weight:800; }
      .layout-missing-summary { display:flex; flex-wrap:wrap; gap:7px; }
      .layout-missing-pill, .layout-missing-tag { display:inline-flex; align-items:center; border-radius:999px; border:1px solid rgba(245,158,11,.22); background:var(--amber-dim); color:var(--amber); font-size:11px; font-weight:800; }
      .layout-missing-pill { padding:6px 9px; }
      .layout-missing-tag { padding:4px 8px; }
      .layout-invalid-scroll { max-height:270px; overflow:auto; border:1px solid var(--border); border-radius:13px; background:rgba(0,0,0,.08); }
      .layout-invalid-list { display:flex; flex-direction:column; gap:0; margin:0; padding:0; list-style:none; }
      .layout-invalid-list li { display:grid; grid-template-columns:minmax(145px,.55fr) minmax(220px,1fr) auto; gap:10px; align-items:center; padding:10px 12px; border-bottom:1px solid var(--border); }
      .layout-invalid-list li:last-child { border-bottom:none; }
      .layout-invalid-list strong { color:var(--text-1); }
      .layout-invalid-fields { display:flex; flex-wrap:wrap; gap:6px; }
      .layout-not-included-panel { border-top-color:rgba(46,144,250,.18); }
      .layout-not-included-reasons { display:flex; flex-direction:column; gap:4px; color:var(--text-2); font-size:12px; line-height:1.35; }
      .layout-not-included-reasons span::before { content:"- "; color:var(--sky); }
      @media (max-width:760px) {
        .layout-result-header, .layout-invalid-summary { flex-direction:column; }
        .layout-result-metrics { grid-template-columns:1fr 1fr; }
        .layout-invalid-list li { grid-template-columns:1fr; align-items:stretch; }
      }
    `;
    document.head.appendChild(style);
  }
})();
