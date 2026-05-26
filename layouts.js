const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const TEMPLATE_PATH = "./templates/FORMATO_pagos_semanales.xlsx";

let layouts = [];
let companies = [];
let companyBankAccounts = [];
let currentSession = null;
let currentProfileId = null;
let activeLinesLayoutId = null;
let activeConfirmLayoutId = null;
let activeRejectLineId = null;
const dom = {};

document.addEventListener("DOMContentLoaded", initLayoutsPage);

async function initLayoutsPage() {
  cacheDom();
  setupTheme();
  bindEvents();

  try {
    await loadSession();
    await loadLayouts();
  } catch (error) {
    showMessage(error.message || "No fue posible cargar layouts.", true);
    showToast("No fue posible iniciar", friendlyError(error), "error");
  }
}

function cacheDom() {
  dom.themeToggle = document.getElementById("themeToggle");
  dom.userName = document.getElementById("userName");
  dom.userEmail = document.getElementById("userEmail");
  dom.logoutBtn = document.getElementById("logoutBtn");
  dom.newLayoutBtn = document.getElementById("newLayoutBtn");
  dom.refreshBtn = document.getElementById("refreshBtn");
  dom.searchInput = document.getElementById("searchInput");
  dom.statusFilter = document.getElementById("statusFilter");
  dom.templateMode = document.getElementById("templateMode");
  dom.templateFile = document.getElementById("templateFile");
  dom.messageBox = document.getElementById("messageBox");
  dom.layoutsTableBody = document.getElementById("layoutsTableBody");
  dom.newLayoutDialog = document.getElementById("newLayoutDialog");
  dom.newLayoutForm = document.getElementById("newLayoutForm");
  dom.layoutPeriodStart = document.getElementById("layoutPeriodStart");
  dom.layoutPeriodEnd = document.getElementById("layoutPeriodEnd");
  dom.layoutName = document.getElementById("layoutName");
  dom.layoutCompanyId = document.getElementById("layoutCompanyId");
  dom.layoutBankAccountId = document.getElementById("layoutBankAccountId");
  dom.layoutInvalidBox = document.getElementById("layoutInvalidBox");
  dom.closeNewLayoutModalBtn = document.getElementById("closeNewLayoutModalBtn");
  dom.cancelNewLayoutBtn = document.getElementById("cancelNewLayoutBtn");
  dom.submitNewLayoutBtn = document.getElementById("submitNewLayoutBtn");
  dom.linesDialog = document.getElementById("linesDialog");
  dom.linesTitle = document.getElementById("linesTitle");
  dom.linesSubtitle = document.getElementById("linesSubtitle");
  dom.linesTableBody = document.getElementById("linesTableBody");
  dom.closeLinesModalBtn = document.getElementById("closeLinesModalBtn");
  dom.confirmDialog = document.getElementById("confirmDialog");
  dom.confirmPaymentForm = document.getElementById("confirmPaymentForm");
  dom.confirmTitle = document.getElementById("confirmTitle");
  dom.paymentDate = document.getElementById("paymentDate");
  dom.bankReference = document.getElementById("bankReference");
  dom.receiptStoragePath = document.getElementById("receiptStoragePath");
  dom.closeConfirmModalBtn = document.getElementById("closeConfirmModalBtn");
  dom.cancelConfirmBtn = document.getElementById("cancelConfirmBtn");
  dom.submitConfirmBtn = document.getElementById("submitConfirmBtn");
  dom.rejectLineDialog = document.getElementById("rejectLineDialog");
  dom.rejectLineForm = document.getElementById("rejectLineForm");
  dom.rejectLineTitle = document.getElementById("rejectLineTitle");
  dom.rejectionReason = document.getElementById("rejectionReason");
  dom.closeRejectLineModalBtn = document.getElementById("closeRejectLineModalBtn");
  dom.cancelRejectLineBtn = document.getElementById("cancelRejectLineBtn");
  dom.submitRejectLineBtn = document.getElementById("submitRejectLineBtn");
  dom.toastStack = document.getElementById("toastStack");
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  dom.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("flux-theme", next);
  });
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", logout);
  dom.newLayoutBtn?.addEventListener("click", openNewLayoutModal);
  dom.refreshBtn?.addEventListener("click", loadLayouts);
  dom.searchInput?.addEventListener("input", renderLayoutsTable);
  dom.statusFilter?.addEventListener("change", renderLayoutsTable);
  dom.layoutCompanyId?.addEventListener("change", renderLayoutBankAccountOptions);
  dom.closeNewLayoutModalBtn?.addEventListener("click", closeNewLayoutModal);
  dom.cancelNewLayoutBtn?.addEventListener("click", closeNewLayoutModal);
  dom.newLayoutForm?.addEventListener("submit", submitNewLayout);
  dom.templateMode?.addEventListener("change", () => {
    if (dom.templateMode.value === "file") dom.templateFile.click();
  });
  dom.closeLinesModalBtn?.addEventListener("click", closeLinesModal);
  dom.closeConfirmModalBtn?.addEventListener("click", closeConfirmModal);
  dom.cancelConfirmBtn?.addEventListener("click", closeConfirmModal);
  dom.confirmPaymentForm?.addEventListener("submit", submitConfirmPayment);
  dom.closeRejectLineModalBtn?.addEventListener("click", closeRejectLineModal);
  dom.cancelRejectLineBtn?.addEventListener("click", closeRejectLineModal);
  dom.rejectLineForm?.addEventListener("submit", submitRejectLine);
}

async function loadSession() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!session) {
    window.location.href = "./index.html";
    return;
  }

  currentSession = session;
  dom.userEmail.textContent = session.user.email || "Sesion activa";
  dom.userName.textContent = session.user.user_metadata?.full_name || session.user.email || "Usuario";
  await resolveCurrentProfile(session);
}

async function resolveCurrentProfile(session) {
  currentProfileId = null;

  const lookups = [
    { column: "auth_user_id", value: session.user.id },
    { column: "id", value: session.user.id },
    { column: "email", value: session.user.email },
  ].filter(item => item.value);

  for (const lookup of lookups) {
    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("id,email,full_name,auth_user_id,active")
        .eq(lookup.column, lookup.value)
        .maybeSingle();

      if (!error && data?.id) {
        currentProfileId = data.id;
        dom.userName.textContent = data.full_name || dom.userName.textContent;
        return;
      }
    } catch (_) {
      currentProfileId = null;
    }
  }
}

async function loadLayouts() {
  showMessage("Cargando layouts...");

  const { data, error } = await supabaseClient
    .from("payment_layouts")
    .select("id,layout_number,name,period_start,period_end,status,generated_by,generated_at,storage_path,file_name,company_count,payment_count,total_amount,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    showMessage(`Error al cargar layouts. ${rlsHint("payment_layouts", "select", error)}`, true);
    dom.layoutsTableBody.innerHTML = `<tr><td colspan="9" class="message">No fue posible cargar layouts.</td></tr>`;
    return;
  }

  layouts = data || [];
  hideMessage();
  renderStats();
  renderLayoutsTable();
}

function renderStats() {
  const total = layouts.length;
  const draft = layouts.filter(layout => layout.status === "draft").length;
  const generated = layouts.filter(layout => layout.status === "generated").length;
  const amount = layouts.reduce((sum, layout) => sum + numberValue(layout.total_amount), 0);

  document.getElementById("totalLayouts").textContent = total;
  document.getElementById("draftLayouts").textContent = draft;
  document.getElementById("generatedLayouts").textContent = generated;
  document.getElementById("totalAmount").textContent = compactCurrency(amount);
}

function renderLayoutsTable() {
  const query = normalize(dom.searchInput.value);
  const status = dom.statusFilter.value;

  const rows = layouts.filter(layout => {
    const searchable = normalize([
      layout.layout_number,
      layout.name,
      layout.period_start,
      layout.period_end,
      layout.file_name,
    ].join(" "));

    return searchable.includes(query) && (status === "todos" || layout.status === status);
  });

  if (!rows.length) {
    dom.layoutsTableBody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <strong>No hay layouts para mostrar</strong>
            Genera un layout desde solicitudes aprobadas para verlo aqui.
          </div>
        </td>
      </tr>`;
    return;
  }

  dom.layoutsTableBody.innerHTML = rows.map(layout => `
    <tr>
      <td><strong>${escapeHtml(layout.layout_number || "Sin folio")}</strong><span class="muted-line">${escapeHtml(layout.name || "")}</span></td>
      <td>${escapeHtml(formatDate(layout.period_start))}<span class="muted-line">${escapeHtml(formatDate(layout.period_end))}</span></td>
      <td>${renderStatusBadge(layout.status)}</td>
      <td>${numberValue(layout.payment_count)}</td>
      <td>${numberValue(layout.company_count)}</td>
      <td><strong>${escapeHtml(formatCurrency(layout.total_amount))}</strong></td>
      <td>${escapeHtml(formatDate(layout.generated_at || layout.created_at))}</td>
      <td>${layout.file_name ? `<strong>${escapeHtml(layout.file_name)}</strong>` : `<span class="muted-line">Sin archivo</span>`}</td>
      <td><div class="actions">${renderLayoutActions(layout)}</div></td>
    </tr>`).join("");
}

function renderLayoutActions(layout) {
  const actions = [
    `<button class="small-btn" type="button" onclick="openLayoutLines('${layout.id}')">Ver lineas</button>`,
  ];

  if (layout.status === "draft") {
    actions.push(`<button class="small-btn" type="button" onclick="generateLayoutExcel('${layout.id}')">Generar Excel</button>`);
  }

  if (layout.status === "generated") {
    actions.push(`<button class="small-btn" type="button" onclick="generateLayoutExcel('${layout.id}')">${layout.file_name ? "Descargar Excel" : "Generar Excel"}</button>`);
    actions.push(`<button class="small-btn warning" type="button" onclick="markLayoutUploaded('${layout.id}')">Marcar como subido</button>`);
    actions.push(`<button class="small-btn success" type="button" onclick="openConfirmPaymentModal('${layout.id}')">Confirmar pago</button>`);
  }

  if (layout.status === "uploaded") {
    actions.push(`<button class="small-btn success" type="button" onclick="openConfirmPaymentModal('${layout.id}')">Confirmar pago</button>`);
  }

  return actions.join("");
}

async function openNewLayoutModal() {
  if (!ensureActorProfile()) return;

  resetNewLayoutForm();
  dom.newLayoutDialog.showModal();

  try {
    await loadLayoutCatalogs();
  } catch (error) {
    showToast("No se pudieron cargar catalogos", friendlyError(error), "error");
  }
}

function closeNewLayoutModal() {
  if (dom.newLayoutDialog.open) dom.newLayoutDialog.close();
}

function resetNewLayoutForm() {
  dom.newLayoutForm?.reset();
  dom.layoutInvalidBox.classList.add("hidden");
  dom.layoutInvalidBox.innerHTML = "";

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(today.getDate() + 6);
  dom.layoutPeriodStart.value = today.toISOString().slice(0, 10);
  dom.layoutPeriodEnd.value = endDate.toISOString().slice(0, 10);
}

async function loadLayoutCatalogs() {
  const [companiesResult, accountsResult] = await Promise.all([
    supabaseClient
      .from("companies")
      .select("id,name,legal_name,active")
      .eq("active", true)
      .order("name", { ascending: true }),
    supabaseClient
      .from("company_bank_accounts")
      .select("id,name,bank_name,account_number,last4,company_id,active")
      .eq("active", true)
      .order("name", { ascending: true }),
  ]);

  if (companiesResult.error) throw companiesResult.error;
  if (accountsResult.error) throw accountsResult.error;

  companies = companiesResult.data || [];
  companyBankAccounts = accountsResult.data || [];
  renderLayoutCompanyOptions();
  renderLayoutBankAccountOptions();
}

function renderLayoutCompanyOptions() {
  const selected = dom.layoutCompanyId.value;
  dom.layoutCompanyId.innerHTML = [
    `<option value="">Todas las empresas</option>`,
    ...companies.map(company => {
      const label = company.legal_name || company.name || "Empresa sin nombre";
      return `<option value="${company.id}">${escapeHtml(label)}</option>`;
    })
  ].join("");

  if (selected && companies.some(company => company.id === selected)) {
    dom.layoutCompanyId.value = selected;
  }
}

function renderLayoutBankAccountOptions() {
  const selectedCompanyId = dom.layoutCompanyId.value;
  const selected = dom.layoutBankAccountId.value;
  let accounts = companyBankAccounts;

  if (selectedCompanyId) {
    const companyAccounts = companyBankAccounts.filter(account => account.company_id === selectedCompanyId);
    accounts = companyAccounts.length ? companyAccounts : companyBankAccounts;
  }

  dom.layoutBankAccountId.innerHTML = [
    `<option value="">Todas las cuentas</option>`,
    ...accounts.map(account => {
      const label = [
        account.name || "Cuenta origen",
        account.bank_name,
        account.account_number ? `cta ${account.account_number}` : account.last4 ? `termina ${account.last4}` : null,
      ].filter(Boolean).join(" · ");
      return `<option value="${account.id}">${escapeHtml(label)}</option>`;
    })
  ].join("");

  if (selected && accounts.some(account => account.id === selected)) {
    dom.layoutBankAccountId.value = selected;
  }
}

async function submitNewLayout(event) {
  event.preventDefault();
  if (!ensureActorProfile()) return;

  const periodStart = dom.layoutPeriodStart.value;
  const periodEnd = dom.layoutPeriodEnd.value;
  const layoutName = cleanText(dom.layoutName.value);
  const companyId = dom.layoutCompanyId.value || null;
  const bankAccountId = dom.layoutBankAccountId.value || null;

  dom.layoutInvalidBox.classList.add("hidden");
  dom.layoutInvalidBox.innerHTML = "";

  if (!periodStart || !periodEnd) {
    showToast("Fechas requeridas", "Captura fecha inicio y fecha fin.", "error");
    return;
  }

  if (periodStart > periodEnd) {
    showToast("Rango invalido", "La fecha inicio no puede ser mayor a la fecha fin.", "error");
    return;
  }

  setButtonLoading(dom.submitNewLayoutBtn, true, "Creando layout...");
  try {
    const { data, error } = await supabaseClient.rpc("create_payment_layout", {
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_generated_by: currentProfileId,
      p_name: layoutName || null,
      p_company_id: companyId,
      p_company_bank_account_id: bankAccountId,
    });

    if (error) throw error;

    await loadLayouts();
    renderInvalidRequests(data?.invalid_requests || []);

    if (data?.message === "no_valid_payment_requests") {
      showToast("Sin solicitudes validas", "No hay solicitudes validas para este periodo.", "warning");
      return;
    }

    const invalidCount = numberValue(data?.invalid_count);
    showToast(
      "Layout creado correctamente",
      invalidCount
        ? "Algunas solicitudes no entraron al layout por datos incompletos."
        : `${data?.layout_number || "El layout"} quedo en draft.`,
      invalidCount ? "warning" : "success"
    );

    if (!invalidCount) closeNewLayoutModal();
  } catch (error) {
    showToast("No se pudo crear layout", friendlyRpcError(error), "error");
  } finally {
    setButtonLoading(dom.submitNewLayoutBtn, false, "Crear layout");
  }
}

function renderInvalidRequests(invalidRequests) {
  if (!invalidRequests.length) return;

  const items = invalidRequests.slice(0, 8).map(item => {
    const fields = Array.isArray(item.missing_fields) ? item.missing_fields.join(", ") : item.missing_fields || "datos incompletos";
    return `<li><strong>${escapeHtml(item.request_number || item.payment_request_id || "Solicitud")}</strong>: ${escapeHtml(fields)}</li>`;
  }).join("");

  const remaining = invalidRequests.length > 8 ? `<p class="muted-line">Y ${invalidRequests.length - 8} mas.</p>` : "";
  dom.layoutInvalidBox.innerHTML = `
    <strong>Solicitudes fuera del layout por datos incompletos</strong>
    <ul>${items}</ul>
    ${remaining}`;
  dom.layoutInvalidBox.classList.remove("hidden");
}

async function openLayoutLines(layoutId) {
  const layout = layouts.find(item => item.id === layoutId);
  if (!layout) return;

  activeLinesLayoutId = layoutId;
  dom.linesTitle.textContent = layout.layout_number || "Lineas del layout";
  dom.linesSubtitle.textContent = `${layout.name || ""} - columnas B:H del Excel`;
  dom.linesTableBody.innerHTML = `<tr><td colspan="10" class="message">Cargando lineas...</td></tr>`;
  dom.linesDialog.showModal();

  await refreshLayoutLines(layoutId);
}

async function refreshLayoutLines(layoutId) {
  const { data, error } = await fetchLayoutLines(layoutId);
  if (error) {
    dom.linesTableBody.innerHTML = `<tr><td colspan="10" class="message">No fue posible cargar lineas. ${escapeHtml(rlsHint("payment_layout_lines", "select", error))}</td></tr>`;
    return;
  }

  renderLinesTable(data || []);
}

function closeLinesModal() {
  activeLinesLayoutId = null;
  if (dom.linesDialog.open) dom.linesDialog.close();
}

function renderLinesTable(lines) {
  if (!lines.length) {
    dom.linesTableBody.innerHTML = `<tr><td colspan="10" class="message">Este layout no tiene lineas.</td></tr>`;
    return;
  }

  dom.linesTableBody.innerHTML = lines.map(line => `
    <tr>
      <td>${escapeHtml(line.source_account_number || "")}</td>
      <td>${escapeHtml(line.company_name || "")}</td>
      <td>${escapeHtml(line.destination_value || "")}</td>
      <td><strong>${escapeHtml(line.beneficiary_name || "")}</strong></td>
      <td>${escapeHtml(formatCurrency(line.amount))}</td>
      <td>${escapeHtml(line.payment_reference || "")}</td>
      <td>${escapeHtml(line.payment_concept || "")}</td>
      <td>${escapeHtml(line.request_number || "")}</td>
      <td>${renderLineStatusBadge(line.status)}</td>
      <td><div class="actions">${renderLineActions(line)}</div></td>
    </tr>`).join("");
}

function renderLineActions(line) {
  if (line.status !== "included") return `<span class="muted-line">Sin acciones</span>`;
  return `<button class="small-btn danger" type="button" onclick="openRejectLineModal('${line.id}')">Rechazar linea</button>`;
}

async function generateLayoutExcel(layoutId) {
  const layout = layouts.find(item => item.id === layoutId);
  if (!layout) return;

  if (layout.status === "cancelled") {
    showToast("Layout cancelado", "No se puede generar Excel de un layout cancelado.", "error");
    return;
  }

  const { data: lines, error } = await fetchLayoutLines(layoutId);
  if (error) {
    showToast("No se pudo leer el layout", rlsHint("payment_layout_lines", "select", error), "error");
    return;
  }

  if (!lines?.length) {
    showToast("Sin lineas", "Este layout no tiene lineas para generar Excel.", "warning");
    return;
  }

  const invalidLines = validateLayoutLines(lines);
  if (invalidLines.length) {
    const first = invalidLines[0];
    showToast(
      "Lineas incompletas",
      `No se puede generar el Excel. Solicitud ${first.request_number || first.payment_request_id}: falta ${first.missing_fields.join(", ")}.`,
      "error"
    );
    return;
  }

  try {
    const workbook = await loadTemplateWorkbook();
    const sheetName = workbook.SheetNames.includes("Hoja 1") ? "Hoja 1" : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    writeLayoutToSheet(sheet, lines);

    const fileName = `${sanitizeFileName(layout.layout_number || "layout-pagos")}.xlsx`;
    XLSX.writeFile(workbook, fileName, { bookType: "xlsx", compression: true });

    const update = await supabaseClient
      .from("payment_layouts")
      .update({
        file_name: fileName,
        status: "generated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", layoutId);

    if (update.error) {
      showToast(
        "Excel descargado",
        "El Excel fue generado, pero no se pudo actualizar el estado del layout.",
        "warning"
      );
      return;
    }

    showToast("Excel generado", `${fileName} se descargo correctamente.`, "success");
    await loadLayouts();
  } catch (error) {
    showToast("No se pudo generar Excel", friendlyError(error), "error");
  }
}

async function markLayoutUploaded(layoutId) {
  if (!ensureActorProfile()) return;

  const layout = layouts.find(item => item.id === layoutId);
  const label = layout?.layout_number || "este layout";
  const confirmed = window.confirm(`Marcar ${label} como subido al banco?`);
  if (!confirmed) return;

  try {
    const { data, error } = await supabaseClient.rpc("mark_payment_layout_uploaded", {
      p_layout_id: layoutId,
      p_actor_profile_id: currentProfileId,
      p_comments: null,
    });

    if (error) throw error;

    showToast("Layout actualizado", data?.message || "El layout fue marcado como subido.", "success");
    await loadLayouts();
  } catch (error) {
    showToast("No se pudo marcar como subido", friendlyRpcError(error), "error");
  }
}

function openConfirmPaymentModal(layoutId) {
  if (!ensureActorProfile()) return;

  const layout = layouts.find(item => item.id === layoutId);
  activeConfirmLayoutId = layoutId;
  dom.confirmTitle.textContent = `Confirmar pago ${layout?.layout_number || ""}`.trim();
  dom.paymentDate.value = new Date().toISOString().slice(0, 10);
  dom.bankReference.value = "";
  dom.receiptStoragePath.value = "";
  dom.confirmDialog.showModal();
}

function closeConfirmModal() {
  activeConfirmLayoutId = null;
  dom.confirmPaymentForm.reset();
  if (dom.confirmDialog.open) dom.confirmDialog.close();
}

async function submitConfirmPayment(event) {
  event.preventDefault();
  if (!activeConfirmLayoutId || !ensureActorProfile()) return;

  const paymentDate = dom.paymentDate.value;
  if (!paymentDate) {
    showToast("Fecha requerida", "Captura la fecha de pago.", "error");
    return;
  }

  setButtonLoading(dom.submitConfirmBtn, true, "Confirmando...");

  try {
    const { data, error } = await supabaseClient.rpc("confirm_payment_layout", {
      p_layout_id: activeConfirmLayoutId,
      p_payment_date: paymentDate,
      p_bank_reference: cleanText(dom.bankReference.value) || null,
      p_storage_path: cleanText(dom.receiptStoragePath.value) || null,
      p_registered_by: currentProfileId,
    });

    if (error) throw error;

    showToast(
      "Pago confirmado",
      `${data?.paid_count || 0} pagos confirmados por ${formatCurrency(data?.total_paid || 0)}.`,
      "success"
    );
    closeConfirmModal();
    await loadLayouts();
    if (activeLinesLayoutId) await refreshLayoutLines(activeLinesLayoutId);
  } catch (error) {
    showToast("No se pudo confirmar pago", friendlyRpcError(error), "error");
  } finally {
    setButtonLoading(dom.submitConfirmBtn, false, "Confirmar pago");
  }
}

function openRejectLineModal(lineId) {
  if (!ensureActorProfile()) return;

  activeRejectLineId = lineId;
  dom.rejectionReason.value = "";
  dom.rejectLineTitle.textContent = "Rechazar linea bancaria";
  dom.rejectLineDialog.showModal();
}

function closeRejectLineModal() {
  activeRejectLineId = null;
  dom.rejectLineForm.reset();
  if (dom.rejectLineDialog.open) dom.rejectLineDialog.close();
}

async function submitRejectLine(event) {
  event.preventDefault();
  if (!activeRejectLineId || !ensureActorProfile()) return;

  const reason = cleanText(dom.rejectionReason.value);
  if (!reason) {
    showToast("Motivo requerido", "Captura el motivo del rechazo bancario.", "error");
    return;
  }

  setButtonLoading(dom.submitRejectLineBtn, true, "Rechazando...");

  try {
    const { data, error } = await supabaseClient.rpc("reject_payment_layout_line", {
      p_line_id: activeRejectLineId,
      p_reason: reason,
      p_actor_profile_id: currentProfileId,
    });

    if (error) throw error;

    showToast(
      "Linea rechazada",
      data?.message || "La linea fue rechazada y la solicitud regreso a aprobada.",
      "success"
    );
    closeRejectLineModal();
    await loadLayouts();
    if (activeLinesLayoutId) await refreshLayoutLines(activeLinesLayoutId);
  } catch (error) {
    showToast("No se pudo rechazar linea", friendlyRpcError(error), "error");
  } finally {
    setButtonLoading(dom.submitRejectLineBtn, false, "Rechazar linea");
  }
}

window.openLayoutLines = openLayoutLines;
window.generateLayoutExcel = generateLayoutExcel;
window.markLayoutUploaded = markLayoutUploaded;
window.openConfirmPaymentModal = openConfirmPaymentModal;
window.openRejectLineModal = openRejectLineModal;

async function fetchLayoutLines(layoutId) {
  return await supabaseClient
    .from("payment_layout_lines")
    .select("id,layout_id,payment_request_id,company_id,proveedor_id,company_bank_account_id,source_account_number,company_name,destination_type,destination_value,beneficiary_name,amount,payment_reference,payment_concept,request_number,status,bank_rejection_reason,created_at,updated_at")
    .eq("layout_id", layoutId)
    .order("source_account_number", { ascending: true })
    .order("company_name", { ascending: true })
    .order("beneficiary_name", { ascending: true })
    .order("request_number", { ascending: true });
}

function validateLayoutLines(lines) {
  return lines
    .filter(line => line.status !== "bank_rejected")
    .map(line => {
      const missing = [];
      if (!notBlank(line.source_account_number)) missing.push("source_account_number");
      if (!notBlank(line.company_name)) missing.push("company_name");
      if (!notBlank(line.destination_value)) missing.push("destination_value");
      if (!notBlank(line.beneficiary_name)) missing.push("beneficiary_name");
      if (!numberValue(line.amount)) missing.push("amount");
      if (!notBlank(line.payment_reference)) missing.push("payment_reference");
      if (!notBlank(line.payment_concept)) missing.push("payment_concept");

      return {
        payment_request_id: line.payment_request_id,
        request_number: line.request_number,
        missing_fields: missing,
      };
    })
    .filter(item => item.missing_fields.length);
}

async function loadTemplateWorkbook() {
  if (dom.templateMode.value === "file") {
    const file = dom.templateFile.files?.[0];
    if (!file) {
      throw new Error("Selecciona la plantilla local FORMATO_pagos_semanales.xlsx antes de generar.");
    }

    const buffer = await file.arrayBuffer();
    return XLSX.read(buffer, { type: "array", cellStyles: true });
  }

  const response = await fetch(TEMPLATE_PATH);
  if (!response.ok) {
    throw new Error("No se encontro la plantilla en /templates/FORMATO_pagos_semanales.xlsx.");
  }

  const buffer = await response.arrayBuffer();
  return XLSX.read(buffer, { type: "array", cellStyles: true });
}

function writeLayoutToSheet(sheet, lines) {
  sheet["B3"] = sheet["B3"] || { t: "s", v: "CTA. CARGO" };
  sheet["C3"] = sheet["C3"] || { t: "s", v: "NOMBRE TITULAR" };

  const exportLines = lines.filter(line => line.status !== "bank_rejected");
  clearDataRange(sheet, 4, 101, 2, 8);

  exportLines.forEach((line, index) => {
    const row = 4 + index;
    setCell(sheet, `B${row}`, line.source_account_number, "s");
    setCell(sheet, `C${row}`, line.company_name, "s");
    setCell(sheet, `D${row}`, line.destination_value, "s");
    setCell(sheet, `E${row}`, line.beneficiary_name, "s");
    setCell(sheet, `F${row}`, numberValue(line.amount), "n");
    setCell(sheet, `G${row}`, line.payment_reference, "s");
    setCell(sheet, `H${row}`, line.payment_concept, "s");
  });

  const lastRow = Math.max(4 + exportLines.length - 1, 101);
  sheet["!ref"] = `A1:H${lastRow}`;
}

function clearDataRange(sheet, startRow, endRow, startCol, endCol) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      delete sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })];
    }
  }
}

function setCell(sheet, address, value, type) {
  sheet[address] = { t: type, v: value ?? "" };
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "./index.html";
}

function ensureActorProfile() {
  if (currentProfileId) return true;
  showToast(
    "Perfil no identificado",
    "No se pudo identificar el perfil del usuario para registrar la accion.",
    "error"
  );
  return false;
}

function renderStatusBadge(status) {
  const normalized = status || "draft";
  return `<span class="badge badge-${escapeHtml(normalized)}">${escapeHtml(statusLabel(normalized))}</span>`;
}

function renderLineStatusBadge(status) {
  const normalized = status || "included";
  return `<span class="badge badge-${escapeHtml(normalized)}">${escapeHtml(statusLabel(normalized))}</span>`;
}

function statusLabel(status) {
  const labels = {
    draft: "Draft",
    generated: "Generated",
    uploaded: "Uploaded",
    confirmed: "Confirmed",
    cancelled: "Cancelled",
    included: "Included",
    paid: "Paid",
    bank_rejected: "Bank rejected",
  };
  return labels[status] || status;
}

function showMessage(message, isError = false) {
  dom.messageBox.textContent = message;
  dom.messageBox.classList.remove("hidden");
  dom.messageBox.style.color = isError ? "var(--ruby)" : "var(--text-3)";
}

function hideMessage() {
  dom.messageBox.classList.add("hidden");
}

function showToast(title, message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  dom.toastStack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 6200);
}

function friendlyRpcError(error) {
  const message = error?.message || String(error || "Error desconocido");
  const known = {
    layout_not_found: "No se encontro el layout.",
    actor_profile_not_found: "No se pudo identificar el perfil del usuario.",
    registered_by_profile_not_found: "No se pudo identificar el perfil del usuario.",
    layout_must_be_generated_first: "Primero genera el Excel antes de marcar el layout como subido.",
    invalid_layout_status_for_upload: "El layout no esta en un estado valido para marcarse como subido.",
    invalid_layout_status_for_confirmation: "El layout no esta en un estado valido para confirmar pago.",
    no_included_lines_to_confirm: "No hay lineas pendientes para confirmar pago.",
    payment_date_required: "Captura la fecha de pago.",
    line_not_found: "No se encontro la linea del layout.",
    line_already_paid: "La linea ya fue pagada y no puede rechazarse.",
    rejection_reason_required: "Captura el motivo del rechazo bancario.",
    generated_by_profile_not_found: "No se pudo identificar tu perfil de usuario.",
    no_valid_payment_requests: "No hay solicitudes validas para este periodo.",
    period_dates_required: "Captura fecha inicio y fecha fin.",
    invalid_period_range: "La fecha inicio no puede ser mayor a la fecha fin.",
    company_not_found: "La empresa seleccionada no existe.",
    company_bank_account_not_found_or_inactive: "La cuenta origen no existe o esta inactiva.",
  };

  const key = Object.keys(known).find(item => message.includes(item));
  if (key) return known[key];
  return friendlyError(error);
}

function friendlyError(error) {
  const message = error?.message || String(error || "Error desconocido");
  if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("url scheme")) {
    return "No se pudo cargar la plantilla. Si estas probando con file://, usa la opcion Plantilla local o despliega en Vercel.";
  }
  if (message.toLowerCase().includes("row-level security") || error?.code === "42501") {
    return "La operacion fue bloqueada por RLS. Revisa policies para usuarios autenticados.";
  }
  if (message.toLowerCase().includes("permission denied")) {
    return "Faltan permisos para ejecutar la operacion.";
  }
  return message;
}

function rlsHint(table, operation, error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("row-level security") || error?.code === "42501" || message.toLowerCase().includes("permission denied")) {
    return `Operacion ${operation} bloqueada por RLS en ${table}; puede requerir una policy para usuarios autenticados.`;
  }
  return message;
}

function setButtonLoading(button, loading, text) {
  if (!button) return;
  button.disabled = loading;
  button.textContent = text;
}

function formatCurrency(value) {
  const amount = numberValue(value);
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(amount);
}

function compactCurrency(value) {
  const amount = numberValue(value);
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function notBlank(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function cleanText(value) {
  return String(value || "").trim();
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function sanitizeFileName(value) {
  return String(value || "layout-pagos").replace(/[\\/:*?"<>|]+/g, "-").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
