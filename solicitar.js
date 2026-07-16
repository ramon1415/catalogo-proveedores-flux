import { PUBLIC_INTAKE_CONFIG } from "./solicitar-config.js";
import {
  IntakeStateMachine,
  IdempotencyController,
  estimateMultipartBytes,
  fitsTotalBudget,
  formatBytes,
  isAllowedFileKind,
  mapPublicResponse,
  materialVersion,
  parseSubmissionSuccess,
  suggestFileKind,
  tokenFromLocation,
  urlWithoutFragment,
  validateFileBatch,
  validatePayload,
} from "./solicitar-core.js";

const byId = (id) => document.getElementById(id);
const machine = new IntakeStateMachine();
const idempotency = new IdempotencyController();
let intakeToken = null;
let linkInfo = null;
let currentStep = 1;
let selectedFiles = [];
let captchaToken = null;
let turnstileWidgetId = null;
let lastSafeErrorCode = "";
let flowHasData = false;

const views = {
  boot: byId("boot-view"),
  unavailable: byId("unavailable-view"),
  temporary: byId("temporary-error-view"),
  portal: byId("portal-view"),
  success: byId("success-view"),
};

const form = byId("intake-form");
const nextButton = byId("next-button");
const backButton = byId("back-button");
const submitButton = byId("submit-button");
const formStatus = byId("form-status");

function showOnly(viewName) {
  Object.entries(views).forEach(([name, element]) => { element.hidden = name !== viewName; });
}

function focusHeading(id) {
  requestAnimationFrame(() => byId(id)?.focus());
}

function transition(next) {
  if (machine.state === next) return;
  machine.transition(next);
}

function unavailable(message) {
  intakeToken = null;
  if (machine.state !== "unavailable") transition("unavailable");
  showOnly("unavailable");
  byId("unavailable-message").textContent = message || "Solicita un enlace vigente a tu contacto de Finanzas.";
  focusHeading("unavailable-title");
}

function temporaryError(message) {
  if (machine.state === "link_validating") transition("recoverable_error");
  showOnly("temporary");
  byId("temporary-error-message").textContent = message || "Revisa tu conexión y vuelve a intentarlo.";
  focusHeading("temporary-error-title");
}

function parseLinkInfo(value) {
  const companyName = value?.company?.display_name;
  const link = value?.link;
  const privacyUrl = value?.privacy_notice?.url;
  let parsedPrivacy;
  try { parsedPrivacy = new URL(privacyUrl); } catch { return null; }
  if (
    typeof companyName !== "string" || !companyName.trim() || companyName.length > 200 ||
    !link || !Number.isFinite(link.max_file_mb) || link.max_file_mb <= 0 ||
    !Number.isInteger(link.max_files) || link.max_files < 0 || link.max_files > 3 ||
    !Number.isFinite(link.max_total_mb) || link.max_total_mb <= 0 || link.max_total_mb > 15 ||
    !Array.isArray(link.allowed_file_types) ||
    parsedPrivacy.protocol !== "https:"
  ) return null;
  return {
    companyName: companyName.trim(),
    maxFileMb: link.max_file_mb,
    maxFiles: link.max_files,
    maxTotalMb: link.max_total_mb,
    allowedFileTypes: link.allowed_file_types.map((type) => String(type).toLowerCase()),
    privacyUrl: parsedPrivacy.href,
  };
}

async function validateLink() {
  if (!intakeToken) return;
  if (machine.state === "booting" || machine.state === "recoverable_error") transition("link_validating");
  showOnly("boot");
  focusHeading("boot-title");
  try {
    const response = await fetch(`${PUBLIC_INTAKE_CONFIG.functionBaseUrl}/link-info`, {
      method: "GET",
      headers: { "X-Intake-Token": intakeToken },
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const contentType = response.headers.get("content-type") || "";
    let body = null;
    if (contentType.toLowerCase().includes("application/json")) {
      try { body = await response.json(); } catch { body = null; }
    }
    if (!response.ok) {
      if (body?.error === "link_not_available" || body?.code === "link_not_available" || response.status === 404) {
        unavailable();
      } else {
        lastSafeErrorCode = `link_info_${response.status}`;
        temporaryError("No pudimos validar el enlace en este momento. Vuelve a intentarlo.");
      }
      return;
    }
    const parsed = parseLinkInfo(body);
    if (!parsed) {
      lastSafeErrorCode = "link_info_contract";
      temporaryError("El servicio devolvió una respuesta incompleta. Vuelve a intentarlo más tarde.");
      return;
    }
    linkInfo = parsed;
    transition("link_valid");
    initializePortal();
  } catch {
    lastSafeErrorCode = "link_info_network";
    temporaryError("Revisa tu conexión y vuelve a intentarlo.");
  }
}

function initializePortal() {
  byId("company-name").textContent = linkInfo.companyName;
  byId("summary-company").textContent = linkInfo.companyName;
  byId("privacy-link").href = linkInfo.privacyUrl;
  byId("file-limit-copy").textContent = `Máximo ${linkInfo.maxFiles} archivos, ${linkInfo.maxFileMb} MB por archivo. Formatos: ${formatAllowedTypes(linkInfo.allowedFileTypes)}.`;
  byId("total-budget-copy").textContent = `Límite total: ${linkInfo.maxTotalMb} MB incluyendo archivos y datos del formulario.`;
  form.querySelectorAll("input, select, textarea, button").forEach((element) => { element.disabled = false; });
  submitButton.disabled = true;
  showOnly("portal");
  transition("editing");
  showStep(1, false);
}

function formatAllowedTypes(types) {
  const labels = { "application/pdf":"PDF", "application/xml":"XML", "text/xml":"XML", "image/jpeg":"JPG", "image/png":"PNG", "image/webp":"WEBP" };
  return [...new Set(types.map((type) => labels[type] || type))].join(", ");
}

function rawPayload() {
  const data = new FormData(form);
  const result = {};
  for (const name of [
    "provider_name", "provider_rfc", "provider_email", "provider_phone", "concept", "description",
    "amount_requested", "currency", "requested_payment_date", "invoice_folio", "invoice_uuid", "invoice_date",
    "bank_name", "bank_account", "bank_clabe", "beneficiary_name",
  ]) result[name] = data.get(name) || "";
  return result;
}

function validation() {
  return validatePayload(rawPayload(), {
    maxAmount: PUBLIC_INTAKE_CONFIG.maxAmount,
    allowedCurrencies: PUBLIC_INTAKE_CONFIG.allowedCurrencies,
  });
}

function setFieldError(name, message) {
  const input = form.elements.namedItem(name);
  const error = byId(`${name.replaceAll("_", "-")}-error`);
  if (input instanceof HTMLElement) input.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message || "";
}

function clearErrors() {
  Object.keys(rawPayload()).forEach((name) => setFieldError(name, ""));
  byId("file-global-error").textContent = "";
}

function validateStep(step, focus = true) {
  clearErrors();
  const result = validation();
  const fields = step === 1
    ? ["provider_name", "provider_rfc", "provider_email", "provider_phone"]
    : ["concept", "description", "amount_requested", "currency", "requested_payment_date", "invoice_folio", "invoice_uuid", "invoice_date", "bank_name", "bank_account", "bank_clabe", "beneficiary_name"];
  const stepErrors = fields.filter((name) => result.errors[name]);
  stepErrors.forEach((name) => setFieldError(name, result.errors[name]));
  if (step === 3) {
    const kindsValid = selectedFiles.every((entry) => isAllowedFileKind(entry.kind));
    if (!kindsValid) byId("file-global-error").textContent = "Selecciona un tipo válido para cada documento.";
    if (!budgetState().fits) byId("file-global-error").textContent = `El tamaño total excede el límite permitido de ${linkInfo.maxTotalMb} MB.`;
    if (!kindsValid || !budgetState().fits) stepErrors.push("files");
  }
  if (stepErrors.length && focus) {
    const first = stepErrors[0] === "files" ? byId("file-global-error") : form.elements.namedItem(stepErrors[0]);
    first?.focus();
    formStatus.textContent = "Revisa los campos marcados antes de continuar.";
  } else formStatus.textContent = "";
  return stepErrors.length === 0;
}

function showStep(step, focus = true) {
  currentStep = step;
  document.querySelectorAll(".form-step").forEach((section) => { section.hidden = Number(section.dataset.step) !== step; });
  document.querySelectorAll("[data-step-indicator]").forEach((item) => {
    const itemStep = Number(item.dataset.stepIndicator);
    item.classList.toggle("is-current", itemStep === step);
    item.classList.toggle("is-complete", itemStep < step);
    if (itemStep === step) item.setAttribute("aria-current", "step"); else item.removeAttribute("aria-current");
  });
  backButton.hidden = step === 1;
  nextButton.hidden = step === 4;
  submitButton.hidden = step !== 4;
  if (step === 4) {
    renderReview();
    if (machine.state === "editing") transition("reviewing");
    if (machine.state === "reviewing") transition("captcha_pending");
    loadTurnstile().catch(() => {
      lastSafeErrorCode = "captcha_load";
      byId("captcha-error").textContent = "No pudimos cargar el control de seguridad. Revisa tu conexión.";
    });
    updateSubmitReadiness();
  }
  if (focus) focusHeading(`step-${step}-title`);
}

function goBack() {
  if (currentStep <= 1 || machine.state === "submitting") return;
  if (currentStep === 4) {
    resetCaptcha();
    if (["reviewing", "captcha_pending", "ready_to_submit", "recoverable_error"].includes(machine.state)) transition("editing");
  }
  showStep(currentStep - 1);
}

function goNext() {
  if (machine.state === "submitting" || !validateStep(currentStep)) return;
  if (currentStep < 4) showStep(currentStep + 1);
}

function setText(id, value, fallback = "Sin capturar") {
  byId(id).textContent = value || fallback;
}

function updateSummary() {
  const raw = rawPayload();
  setText("summary-provider", String(raw.provider_name).trim());
  const amount = Number(raw.amount_requested);
  setText("summary-amount", Number.isFinite(amount) && amount > 0 ? new Intl.NumberFormat("es-MX", { style:"currency", currency:"MXN" }).format(amount) : "");
  byId("summary-files").textContent = `${selectedFiles.length} ${selectedFiles.length === 1 ? "archivo" : "archivos"}`;
  const compact = byId("mobile-summary-content");
  compact.replaceChildren();
  for (const text of [linkInfo?.companyName || "", String(raw.provider_name || "Sin proveedor"), byId("summary-amount").textContent, byId("summary-files").textContent]) {
    const p = document.createElement("p"); p.textContent = text; compact.append(p);
  }
  updateUsage();
}

function reviewCard(title, pairs) {
  const card = document.createElement("section");
  card.className = "review-card";
  const heading = document.createElement("h3"); heading.textContent = title; card.append(heading);
  const list = document.createElement("dl");
  pairs.forEach(([label, value]) => {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = value || "No capturado";
    wrapper.append(term, detail); list.append(wrapper);
  });
  card.append(list);
  return card;
}

function renderReview() {
  const result = validation();
  const payload = result.payload;
  const money = payload.amount_requested ? new Intl.NumberFormat("es-MX", { style:"currency", currency:payload.currency || "MXN" }).format(payload.amount_requested) : "";
  const content = byId("review-content");
  content.replaceChildren(
    reviewCard("Proveedor", [["Nombre o razón social",payload.provider_name],["RFC",payload.provider_rfc],["Correo",payload.provider_email],["Teléfono",payload.provider_phone]]),
    reviewCard("Pago y factura", [["Concepto",payload.concept],["Monto",money],["Fecha solicitada",payload.requested_payment_date],["Folio de factura",payload.invoice_folio],["UUID fiscal",payload.invoice_uuid],["Fecha de factura",payload.invoice_date]]),
    reviewCard("Información bancaria", [["Banco",payload.bank_name],["Cuenta",masked(payload.bank_account)],["CLABE",masked(payload.bank_clabe)],["Beneficiario",payload.beneficiary_name]]),
    reviewCard("Documentos", selectedFiles.length ? selectedFiles.map((entry) => [entry.file.name, fileKindLabel(entry.kind)]) : [["Archivos", "Sin archivos adjuntos"]]),
  );
}

function masked(value) {
  if (!value) return "";
  const text = String(value);
  return `${"•".repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`;
}

function fileKindLabel(value) {
  return { invoice_pdf:"Factura PDF", invoice_xml:"Factura XML", bank_document:"Documento bancario", support:"Soporte", other:"Otro" }[value] || "Otro";
}

function budgetState() {
  const result = validation();
  return fitsTotalBudget(result.payload, selectedFiles.map((entry) => entry.file), selectedFiles.map((entry) => entry.kind), linkInfo?.maxTotalMb || 0, {
    safetyBytes: PUBLIC_INTAKE_CONFIG.maxClientSafetyOverheadBytes,
    baseBytes: PUBLIC_INTAKE_CONFIG.multipartBaseOverheadBytes,
    perFileBytes: PUBLIC_INTAKE_CONFIG.multipartPerFileOverheadBytes,
  });
}

function updateUsage() {
  if (!linkInfo) return;
  const state = budgetState();
  const percent = Math.min(100, Math.round((state.estimatedBytes / state.maxBytes) * 100));
  byId("usage-copy").textContent = `${formatBytes(state.estimatedBytes)} de ${linkInfo.maxTotalMb} MB`;
  byId("usage-bar").style.width = `${percent}%`;
  const progress = document.querySelector(".usage-track");
  progress.setAttribute("aria-valuenow", String(percent));
  byId("usage-bar").style.background = state.fits ? "var(--teal-600)" : "var(--red-700)";
}

async function addFiles(files) {
  if (!linkInfo || !files.length) return;
  const combined = [...selectedFiles.map((entry) => entry.file), ...files];
  const result = await validateFileBatch(combined, linkInfo);
  if (!result.valid) {
    byId("file-global-error").textContent = result.errors.join(" ");
    byId("dropzone").focus();
    return;
  }
  selectedFiles = result.files.map((file, index) => ({
    file,
    kind: selectedFiles[index]?.file === file ? selectedFiles[index].kind : suggestFileKind(file),
  }));
  byId("file-global-error").textContent = "";
  renderFiles();
  markMaterialChange();
}

function renderFiles() {
  const list = byId("file-list");
  list.replaceChildren();
  selectedFiles.forEach((entry, index) => {
    const row = document.createElement("div"); row.className = "file-row";
    const meta = document.createElement("div"); meta.className = "file-meta";
    const name = document.createElement("strong"); name.textContent = entry.file.name;
    const size = document.createElement("span"); size.textContent = `${formatBytes(entry.file.size)} · ${entry.file.type}`;
    meta.append(name, size);
    const label = document.createElement("label");
    const selectId = `file-kind-${index}`; label.htmlFor = selectId; label.textContent = "Tipo documental";
    const select = document.createElement("select"); select.id = selectId;
    [["invoice_pdf","Factura PDF"],["invoice_xml","Factura XML"],["bank_document","Documento bancario"],["support","Soporte"],["other","Otro"]].forEach(([value,text]) => {
      const option = document.createElement("option"); option.value = value; option.textContent = text; option.selected = entry.kind === value; select.append(option);
    });
    select.addEventListener("change", () => { entry.kind = select.value; markMaterialChange(); });
    label.append(select);
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-file"; remove.textContent = "Quitar"; remove.setAttribute("aria-label", `Quitar ${entry.file.name}`);
    remove.addEventListener("click", () => { selectedFiles.splice(index, 1); renderFiles(); markMaterialChange(); });
    row.append(meta, label, remove); list.append(row);
  });
  updateSummary();
}

function markMaterialChange() {
  flowHasData = Boolean([...form.elements].some((element) => element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? Boolean(element.value) : false) || selectedFiles.length);
  updateSummary();
}

function loadTurnstileApi() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-intake-turnstile="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.turnstile), { once:true });
      existing.addEventListener("error", reject, { once:true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true; script.defer = true; script.referrerPolicy = "no-referrer"; script.dataset.intakeTurnstile = "true";
    script.addEventListener("load", () => resolve(window.turnstile), { once:true });
    script.addEventListener("error", reject, { once:true });
    document.head.append(script);
  });
}

async function loadTurnstile() {
  if (!linkInfo || turnstileWidgetId !== null) return;
  const api = await loadTurnstileApi();
  if (!api) throw new Error("turnstile_unavailable");
  turnstileWidgetId = api.render(byId("turnstile-widget"), {
    sitekey: PUBLIC_INTAKE_CONFIG.turnstileSiteKey,
    action: PUBLIC_INTAKE_CONFIG.action,
    appearance: "always",
    retry: "never",
    callback(token) {
      captchaToken = token;
      byId("captcha-error").textContent = "";
      updateSubmitReadiness();
    },
    "expired-callback"() {
      captchaToken = null;
      byId("captcha-error").textContent = "La verificación expiró. Complétala nuevamente.";
      updateSubmitReadiness();
    },
    "error-callback"() {
      captchaToken = null;
      byId("captcha-error").textContent = "No pudimos completar la verificación. Inténtalo nuevamente.";
      updateSubmitReadiness();
      return true;
    },
  });
}

function resetCaptcha() {
  captchaToken = null;
  if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
  updateSubmitReadiness();
}

function readyConditions() {
  const result = validation();
  return result.valid && byId("privacy-accepted").checked && byId("dev-data-confirmed").checked &&
    Boolean(captchaToken) && selectedFiles.every((entry) => isAllowedFileKind(entry.kind)) && budgetState().fits &&
    Boolean(intakeToken) && !idempotency.active;
}

function updateSubmitReadiness() {
  const ready = currentStep === 4 && readyConditions();
  submitButton.disabled = !ready;
  if (ready && machine.state === "captcha_pending") transition("ready_to_submit");
  else if (!ready && machine.state === "ready_to_submit") transition("captcha_pending");
}

function parseXhrResponse(xhr) {
  const contentType = xhr.getResponseHeader("content-type") || "";
  let body = null;
  if (contentType.toLowerCase().includes("application/json")) {
    try { body = JSON.parse(xhr.responseText); } catch { body = null; }
  }
  return { contentType, body };
}

function sendMultipart(data, key) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${PUBLIC_INTAKE_CONFIG.functionBaseUrl}/submit`, true);
    xhr.withCredentials = false;
    xhr.timeout = 120000;
    xhr.setRequestHeader("X-Intake-Token", intakeToken);
    xhr.setRequestHeader("Idempotency-Key", key);
    xhr.upload.addEventListener("progress", (event) => {
      const progress = byId("upload-progress-bar");
      if (event.lengthComputable) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        progress.value = percent; byId("upload-progress-label").textContent = `${percent}%`;
      } else {
        progress.removeAttribute("value"); byId("upload-progress-label").textContent = "En progreso";
      }
    });
    xhr.addEventListener("load", () => resolve(xhr));
    xhr.addEventListener("error", () => reject(new Error("network")));
    xhr.addEventListener("timeout", () => reject(new Error("timeout")));
    xhr.send(data);
  });
}

async function submit(event) {
  event.preventDefault();
  if (machine.state !== "ready_to_submit" || !validateStep(1, false) || !validateStep(2, false) || !validateStep(3, false) || !readyConditions()) {
    updateSubmitReadiness();
    formStatus.textContent = "Revisa los datos, las confirmaciones y el control de seguridad.";
    return;
  }
  const result = validation();
  const files = selectedFiles.map((entry) => entry.file);
  const fileKinds = selectedFiles.map((entry) => entry.kind);
  const budget = fitsTotalBudget(result.payload, files, fileKinds, linkInfo.maxTotalMb, {
    safetyBytes: PUBLIC_INTAKE_CONFIG.maxClientSafetyOverheadBytes,
    baseBytes: PUBLIC_INTAKE_CONFIG.multipartBaseOverheadBytes,
    perFileBytes: PUBLIC_INTAKE_CONFIG.multipartPerFileOverheadBytes,
  });
  if (!budget.fits) {
    byId("file-global-error").textContent = `El tamaño total excede el límite permitido de ${linkInfo.maxTotalMb} MB.`;
    showStep(3);
    return;
  }
  const version = materialVersion(result.payload, files, fileKinds);
  if (!idempotency.begin(version)) return;
  transition("submitting");
  submitButton.disabled = true; backButton.disabled = true;
  byId("submit-error").hidden = true;
  byId("upload-progress").hidden = false;
  const data = new FormData();
  data.append("payload", JSON.stringify(result.payload));
  data.append("captcha_token", captchaToken);
  data.append("honeypot", byId("website-confirmation").value);
  data.append("file_kinds", JSON.stringify(fileKinds));
  files.forEach((file) => data.append("files", file, file.name));
  try {
    const xhr = await sendMultipart(data, idempotency.keyFor(version));
    const { contentType, body } = parseXhrResponse(xhr);
    const success = parseSubmissionSuccess(xhr.status, contentType, body);
    if (success) {
      transition("submit_success");
      showSuccess(success.folio, success.duplicate);
      return;
    }
    const mapped = mapPublicResponse(xhr.status, contentType, body, linkInfo.maxTotalMb);
    lastSafeErrorCode = mapped.code;
    transition("recoverable_error");
    showSubmitError(mapped);
  } catch (error) {
    lastSafeErrorCode = error?.message === "timeout" ? "submit_timeout" : "submit_network";
    transition("recoverable_error");
    showSubmitError({ message:"No pudimos completar el envío. Revisa tu conexión y vuelve a intentarlo.", requestId:"" });
  } finally {
    if (machine.state !== "submit_success") {
      idempotency.finish();
      backButton.disabled = false;
      byId("upload-progress").hidden = true;
      resetCaptcha();
      if (machine.state === "recoverable_error") transition("captcha_pending");
    }
  }
}

function showSubmitError(mapped) {
  byId("submit-error").hidden = false;
  byId("submit-error-message").textContent = mapped.message;
  const reference = byId("request-reference");
  reference.hidden = !mapped.requestId;
  reference.textContent = mapped.requestId ? `Referencia técnica: ${mapped.requestId}` : "";
  byId("submit-error").scrollIntoView({ block:"center" });
}

function showSuccess(folio, duplicate) {
  const companyName = linkInfo.companyName;
  resetSensitiveState();
  byId("success-company").textContent = companyName;
  byId("public-folio").textContent = folio;
  byId("success-message").textContent = duplicate
    ? "Esta solicitud ya había sido recibida. Conserva tu folio."
    : "Conserva este folio para cualquier aclaración.";
  byId("success-date").textContent = `Fecha local: ${new Intl.DateTimeFormat("es-MX", { dateStyle:"long", timeStyle:"short" }).format(new Date())} · Ambiente DEV`;
  showOnly("success");
  focusHeading("success-title");
}

function resetSensitiveState() {
  form.reset();
  selectedFiles = [];
  captchaToken = null;
  intakeToken = null;
  linkInfo = { ...linkInfo };
  idempotency.clear();
  flowHasData = false;
  renderFiles();
  if (turnstileWidgetId !== null && window.turnstile) window.turnstile.reset(turnstileWidgetId);
}

function copyFolio() {
  const folio = byId("public-folio").textContent;
  if (!navigator.clipboard?.writeText) {
    byId("copy-status").textContent = "Selecciona el folio y cópialo manualmente.";
    return;
  }
  navigator.clipboard.writeText(folio).then(
    () => { byId("copy-status").textContent = "Folio copiado."; },
    () => { byId("copy-status").textContent = "No fue posible copiarlo. Selecciónalo manualmente."; },
  );
}

function bindEvents() {
  nextButton.addEventListener("click", goNext);
  backButton.addEventListener("click", goBack);
  form.addEventListener("submit", submit);
  form.addEventListener("input", (event) => {
    if (event.target === byId("provider-rfc") || event.target === byId("invoice-uuid")) event.target.value = event.target.value.toUpperCase();
    byId("description-count").textContent = String(byId("description").value.length);
    markMaterialChange();
    if (currentStep === 4) updateSubmitReadiness();
  });
  form.addEventListener("change", () => { markMaterialChange(); if (currentStep === 4) updateSubmitReadiness(); });
  byId("retry-link-button").addEventListener("click", validateLink);
  byId("choose-files-button").addEventListener("click", (event) => { event.stopPropagation(); byId("file-input").click(); });
  byId("file-input").addEventListener("change", (event) => { addFiles([...event.target.files]); event.target.value = ""; });
  const dropzone = byId("dropzone");
  dropzone.addEventListener("click", () => byId("file-input").click());
  dropzone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); byId("file-input").click(); } });
  dropzone.addEventListener("dragover", (event) => { event.preventDefault(); dropzone.classList.add("is-dragging"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
  dropzone.addEventListener("drop", (event) => { event.preventDefault(); dropzone.classList.remove("is-dragging"); addFiles([...event.dataTransfer.files]); });
  byId("limits-help-button").addEventListener("click", () => {
    const help = byId("limits-help"); help.hidden = !help.hidden;
    byId("limits-help-button").setAttribute("aria-expanded", String(!help.hidden));
  });
  byId("copy-folio-button").addEventListener("click", copyFolio);
  byId("print-button").addEventListener("click", () => window.print());
  byId("finish-button").addEventListener("click", () => {
    document.querySelector(".success-actions").hidden = true;
    byId("copy-status").textContent = "Proceso finalizado. Ya puedes cerrar esta ventana.";
  });
  window.addEventListener("beforeunload", (event) => {
    if (flowHasData && machine.state !== "submit_success") { event.preventDefault(); event.returnValue = ""; }
  });
}

function bootstrap() {
  bindEvents();
  const result = tokenFromLocation({ hash:location.hash, search:location.search, historyState:history.state });
  if (location.hash || new URLSearchParams(location.search).has("token")) {
    const prior = history.state && typeof history.state === "object" ? history.state : {};
    history.replaceState({ ...prior, intakeFragmentConsumed:result.ok === true }, "", urlWithoutFragment(location));
  }
  if (!result.ok) {
    if (machine.state === "booting") transition("unavailable");
    const reloadMessage = result.reason === "fragment_consumed"
      ? "Vuelve a abrir el enlace original que te proporcionó Finanzas."
      : "Solicita un enlace vigente a tu contacto de Finanzas.";
    showOnly("unavailable");
    byId("unavailable-message").textContent = reloadMessage;
    focusHeading("unavailable-title");
    return;
  }
  intakeToken = result.token;
  validateLink();
}

bootstrap();
