const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentProfileId = null;
let paymentRequests = [];
let companies = [];
let costCenters = [];
let budgetCategories = [];
let proveedores = [];
let budgetAvailabilityRows = [];
let approverCandidates = [];
let approverLoadVersion = 0;
let approverReloadTimer = null;
let highlightedRequestId = null;
let currentDetailRequestId = null;
let requestFileUpload = null;
let editRequestFileUpload = null;
let extraordinaryFacultyCompanyIds = new Set();

const ACTIVE_REQUEST_STATUSES = [
  "submitted",
  "approved",
  "changes_requested",
  "finance_validation",
  "scheduled",
];

const STATUS_FILTER_LABELS = {
  todos: "Todas",
  activas: "Activas",
  submitted: "Submitted",
  approved: "Approved",
  changes_requested: "Changes requested",
  finance_validation: "Finance validation",
  scheduled: "Scheduled",
  paid: "Pagadas",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const html = document.documentElement;
const dom = {};

document.addEventListener("DOMContentLoaded", initSolicitudesPage);

async function initSolicitudesPage() {
  cacheDom();
  bindEvents();

  const stored = localStorage.getItem("flux-theme");
  if (stored) html.setAttribute("data-theme", stored);
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("flux-theme", next);
  });

  if (window.FluxAuth?.ready) await window.FluxAuth.ready();
  const profile = window.FluxAuth?.getProfile?.();
  const session  = window.FluxAuth?.state?.session;
  if (!session) { window.location.href = "./index.html"; return; }

  currentProfileId = profile?.id || null;
  if (dom.userName)  dom.userName.textContent  = profile?.full_name || session.user?.email || "Usuario";
  if (dom.userEmail) dom.userEmail.textContent = profile?.email || session.user?.email || "Sesion activa";

  try {
    await Promise.all([
      loadCompanies(),
      loadCostCenters(),
      loadBudgetCategories(),
      loadProveedores(),
      loadExtraordinaryFaculties(),
    ]);

    populateFilters();
    populateFormSelects();
    setDefaultMonth();
    updateSummaryPanel();
    await loadPaymentRequests();
  } catch (error) {
    showMessage(error.message || "No fue posible cargar la pantalla.", true);
    showToast("No fue posible iniciar", friendlyError(error), "error");
  }
}

function cacheDom() {
  dom.userName = document.getElementById("userName");
  dom.userEmail = document.getElementById("userEmail");
  dom.logoutBtn = document.getElementById("logoutBtn");
  dom.newRequestBtn = document.getElementById("newRequestBtn");
  dom.messageBox = document.getElementById("messageBox");
  dom.requestsTableBody = document.getElementById("requestsTableBody");
  dom.searchInput = document.getElementById("searchInput");
  dom.statusFilter = document.getElementById("statusFilter");
  dom.budgetDecisionFilter = document.getElementById("budgetDecisionFilter");
  dom.companyFilter = document.getElementById("companyFilter");
  dom.totalCard = document.getElementById("totalCard");
  dom.approvableCard = document.getElementById("approvableCard");
  dom.exceptionsCard = document.getElementById("exceptionsCard");
  dom.paidCard = document.getElementById("paidCard");
  dom.filterSummary = document.getElementById("filterSummary");
  dom.filterSummaryText = document.getElementById("filterSummaryText");
  dom.clearFiltersBtn = document.getElementById("clearFiltersBtn");
  dom.requestDialog = document.getElementById("requestDialog");
  dom.requestForm = document.getElementById("requestForm");
  dom.closeRequestModalBtn = document.getElementById("closeRequestModalBtn");
  dom.cancelRequestBtn = document.getElementById("cancelRequestBtn");
  dom.submitRequestBtn = document.getElementById("submitRequestBtn");
  dom.detailDialog = document.getElementById("detailDialog");
  dom.closeDetailModalBtn = document.getElementById("closeDetailModalBtn");
  dom.closeDetailFooterBtn = document.getElementById("closeDetailFooterBtn");
  dom.detailTitle = document.getElementById("detailTitle");
  dom.detailSubtitle = document.getElementById("detailSubtitle");
  dom.detailContent = document.getElementById("detailContent");
  dom.toastStack = document.getElementById("toastStack");

  dom.companyId = document.getElementById("companyId");
  dom.approverId = document.getElementById("approverId");
  dom.approverAssignmentId = document.getElementById("approverAssignmentId");
  dom.approverHelp = document.getElementById("approverHelp");
  dom.costCenterId = document.getElementById("costCenterId");
  dom.budgetCategoryId = document.getElementById("budgetCategoryId");
  dom.budgetCategorySearch = document.getElementById("budgetCategorySearch");
  dom.editBudgetCategorySearch = document.getElementById("editBudgetCategorySearch");
  dom.budgetCategoryHelp = document.getElementById("budgetCategoryHelp");
  dom.budgetCategorySearch?.addEventListener("input", () => filterBudgetCategoryOptions(dom.budgetCategoryId, dom.budgetCategorySearch.value));
  dom.editBudgetCategorySearch?.addEventListener("input", () => filterBudgetCategoryOptions(document.getElementById("editBudgetCategoryId"), dom.editBudgetCategorySearch.value));
  dom.budgetMonth = document.getElementById("budgetMonth");
  dom.providerSearch = document.getElementById("providerSearch");
  dom.proveedorId = document.getElementById("proveedorId");
  dom.amountRequested = document.getElementById("amountRequested");
  dom.currency = document.getElementById("currency");
  dom.exchangeRate = document.getElementById("exchangeRate");
  dom.exchangeRateRow = document.getElementById("exchangeRateRow");
  dom.isExtraordinaryAdjustment = document.getElementById("isExtraordinaryAdjustment");
  dom.extraordinaryIntentSection = document.getElementById("extraordinaryIntentSection");
  dom.requiresExtraordinaryTreatment = document.getElementById("requiresExtraordinaryTreatment");
  dom.extraordinaryIntentHelp = document.getElementById("extraordinaryIntentHelp");
  dom.description = document.getElementById("description");
  dom.notes = document.getElementById("notes");

  dom.summaryCompany = document.getElementById("summaryCompany");
  dom.summaryApprover = document.getElementById("summaryApprover");
  dom.summaryCostCenter = document.getElementById("summaryCostCenter");
  dom.summaryCategory = document.getElementById("summaryCategory");
  dom.summaryProvider = document.getElementById("summaryProvider");
  dom.summaryMonth = document.getElementById("summaryMonth");
  dom.summaryAmount = document.getElementById("summaryAmount");

  dom.editRequestBtn = document.getElementById("editRequestBtn");
  dom.editDialog = document.getElementById("editDialog");
  dom.editForm = document.getElementById("editForm");
  dom.closeEditModalBtn = document.getElementById("closeEditModalBtn");
  dom.cancelEditBtn = document.getElementById("cancelEditBtn");
  dom.submitEditBtn = document.getElementById("submitEditBtn");
  dom.editSubtitle = document.getElementById("editSubtitle");
  dom.editCompanyId = document.getElementById("editCompanyId");
  dom.editCostCenterId = document.getElementById("editCostCenterId");
  dom.editBudgetCategoryId = document.getElementById("editBudgetCategoryId");
  dom.editBudgetCategoryHelp = document.getElementById("editBudgetCategoryHelp");
  dom.editBudgetMonth = document.getElementById("editBudgetMonth");
  dom.editProviderSearch = document.getElementById("editProviderSearch");
  dom.editProveedorId = document.getElementById("editProveedorId");
  dom.editAmountRequested = document.getElementById("editAmountRequested");
  dom.editCurrency = document.getElementById("editCurrency");
  dom.editExchangeRate = document.getElementById("editExchangeRate");
  dom.editExchangeRateRow = document.getElementById("editExchangeRateRow");
  dom.editIsExtraordinaryAdjustment = document.getElementById("editIsExtraordinaryAdjustment");
  dom.editDescription = document.getElementById("editDescription");
  dom.editNotes = document.getElementById("editNotes");
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", logout);
  dom.newRequestBtn?.addEventListener("click", openNewRequestModal);
  dom.closeRequestModalBtn?.addEventListener("click", closeNewRequestModal);
  dom.cancelRequestBtn?.addEventListener("click", closeNewRequestModal);
  dom.requestForm?.addEventListener("submit", submitPaymentRequest);
  dom.closeDetailModalBtn?.addEventListener("click", closeRequestDetail);
  dom.closeDetailFooterBtn?.addEventListener("click", closeRequestDetail);
  dom.detailContent?.addEventListener("click", async e => {
    const link = e.target.closest(".invoice-link");
    if (!link) return;
    e.preventDefault();
    const url = await window.FluxUpload?.getReceiptUrl(link.dataset.path);
    if (url) window.open(url, "_blank");
    else showToast("No disponible", "No se pudo generar el link del comprobante.", "error");
  });
  dom.editRequestBtn?.addEventListener("click", () => openEditRequest(currentDetailRequestId));
  dom.closeEditModalBtn?.addEventListener("click", closeEditModal);
  dom.cancelEditBtn?.addEventListener("click", closeEditModal);
  dom.editForm?.addEventListener("submit", submitEditRequest);
  dom.editCompanyId?.addEventListener("change", handleEditScopeChange);
  dom.editCostCenterId?.addEventListener("change", handleEditScopeChange);
  dom.editBudgetMonth?.addEventListener("change", handleEditScopeChange);
  initEditProviderCombo();

  dom.searchInput?.addEventListener("input", renderPaymentRequestsTable);
  dom.statusFilter?.addEventListener("change", renderPaymentRequestsTable);
  dom.budgetDecisionFilter?.addEventListener("change", renderPaymentRequestsTable);
  dom.companyFilter?.addEventListener("change", renderPaymentRequestsTable);
  dom.totalCard?.addEventListener("click", showActiveRequests);
  dom.approvableCard?.addEventListener("click", showApprovableRequests);
  dom.exceptionsCard?.addEventListener("click", showExceptionRequests);
  dom.paidCard?.addEventListener("click", showPaidRequests);
  dom.clearFiltersBtn?.addEventListener("click", showAllRequests);

  [dom.totalCard, dom.approvableCard, dom.exceptionsCard, dom.paidCard].forEach(card => {
    card?.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        card.click();
      }
    });
  });

  dom.companyId?.addEventListener("change", async () => {
    await loadExtraordinaryFaculties();
    syncExtraordinaryIntentVisibility();
    handleCompanyScopeChange();
  });
  dom.approverId?.addEventListener("change", () => {
    syncApproverSelection();
    updateSummaryPanel();
  });
  dom.costCenterId?.addEventListener("change", handleBudgetAndApproverScopeChange);
  dom.budgetCategoryId?.addEventListener("change", updateSummaryPanel);
  dom.budgetMonth?.addEventListener("change", handleBudgetScopeChange);
  initProviderCombo();
  dom.proveedorId?.addEventListener("change", updateSummaryPanel);
  dom.amountRequested?.addEventListener("input", () => {
    updateSummaryPanel();
    scheduleApproverOptionsLoad();
  });
  dom.currency?.addEventListener("change", handleCurrencyChange);
  dom.exchangeRate?.addEventListener("input", updateSummaryPanel);
  dom.isExtraordinaryAdjustment?.addEventListener("change", updateSummaryPanel);
  dom.editCurrency?.addEventListener("change", handleEditCurrencyChange);
  requestFileUpload = window.FluxUpload?.initFileUpload("request");
  editRequestFileUpload = window.FluxUpload?.initFileUpload("editRequest");
}

async function loadCompanies() {
  const { data, error } = await supabaseClient
    .from("companies")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`No se pudieron cargar empresas. ${rlsHint("companies", "select", error)}`);
  companies = activeRows(data || []);
}

async function loadCostCenters() {
  const { data, error } = await supabaseClient
    .from("cost_centers")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw new Error(`No se pudieron cargar centros de costo. ${rlsHint("cost_centers", "select", error)}`);
  costCenters = activeRows(data || []);
}

async function loadBudgetCategories() {
  const { data, error } = await supabaseClient
    .from("budget_categories")
    .select("*")
    .order("code", { ascending: true });

  if (error) throw new Error(`No se pudieron cargar partidas presupuestales. ${rlsHint("budget_categories", "select", error)}`);
  budgetCategories = activeRows(data || []);
}

async function loadProveedores() {
  const { data, error } = await supabaseClient
    .from("proveedores")
    .select("id,alias,nombre_completo,rfc,banco,clabe,cuenta_bancaria,activo")
    .eq("activo", true)
    .order("alias", { ascending: true });

  if (error) throw new Error(`No se pudieron cargar proveedores. ${rlsHint("proveedores", "select", error)}`);
  proveedores = data || [];
}

async function loadExtraordinaryFaculties() {
  const { data, error } = await supabaseClient.rpc("current_extraordinary_faculty_company_ids");
  if (error) {
    extraordinaryFacultyCompanyIds = new Set();
    return;
  }
  const rows = Array.isArray(data) ? data : [];
  extraordinaryFacultyCompanyIds = new Set(
    rows.map(row => typeof row === "string" ? row : row?.company_id).filter(Boolean)
  );
  syncExtraordinaryIntentVisibility();
}

function ensureExtraordinaryIntentPlacement() {
  const section = dom.extraordinaryIntentSection || document.getElementById("extraordinaryIntentSection");
  const adjustment = dom.isExtraordinaryAdjustment || document.getElementById("isExtraordinaryAdjustment");
  const adjustmentLabel = adjustment?.closest("label");
  const targetGrid = adjustmentLabel?.parentElement;

  if (!section || !adjustmentLabel || !targetGrid) return false;
  if (section.parentElement !== targetGrid || adjustmentLabel.nextElementSibling !== section) {
    adjustmentLabel.insertAdjacentElement("afterend", section);
  }
  return section.parentElement === targetGrid && adjustmentLabel.nextElementSibling === section;
}

function syncExtraordinaryIntentVisibility() {
  ensureExtraordinaryIntentPlacement();
  const companyId = dom.companyId?.value || "";
  const hasAnyFaculty = extraordinaryFacultyCompanyIds.size > 0;
  const hasSelectedCompany = Boolean(companyId);
  const allowed = Boolean(hasSelectedCompany && extraordinaryFacultyCompanyIds.has(companyId));

  dom.extraordinaryIntentSection?.classList.toggle("hidden", !hasAnyFaculty);
  dom.extraordinaryIntentSection?.classList.toggle("is-disabled", hasAnyFaculty && !allowed);
  dom.extraordinaryIntentSection?.classList.toggle("is-enabled", allowed);

  if (dom.requiresExtraordinaryTreatment) {
    dom.requiresExtraordinaryTreatment.disabled = !allowed;
    dom.requiresExtraordinaryTreatment.setAttribute("aria-disabled", String(!allowed));
    if (!allowed) dom.requiresExtraordinaryTreatment.checked = false;
  }

  if (dom.extraordinaryIntentHelp) {
    if (!hasAnyFaculty) {
      dom.extraordinaryIntentHelp.textContent = "";
    } else if (!hasSelectedCompany) {
      dom.extraordinaryIntentHelp.textContent = "Selecciona una empresa autorizada para habilitar esta opción.";
    } else if (!allowed) {
      dom.extraordinaryIntentHelp.textContent = "Tu facultad extraordinaria no aplica para la empresa seleccionada.";
    } else {
      dom.extraordinaryIntentHelp.textContent = "La marca inicial registra intención solamente; la autorización externa se completa después de guardar y validar presupuesto.";
    }
  }
}

async function loadPaymentRequests() {
  showMessage("Cargando solicitudes...");

  const { data, error } = await supabaseClient
    .from("payment_requests")
    .select("id,request_number,extraordinary_state,proveedor_id,company_id,cost_center_id,budget_category_id,budget_month,amount_requested,currency,exchange_rate,status,description,notes,requested_by,approver_id,submitted_at,budget_decision,budget_block_reason,budget_available_before,budget_available_after,budget_shortfall,budget_checked_at,budget_result,is_extraordinary_adjustment,exception_status,exception_action,exception_reason,exception_approved_by,exception_approved_at,requires_budget_adjustment,operational_comments,invoice_storage_path,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    showMessage(`Error al cargar solicitudes. ${rlsHint("payment_requests", "select", error)}`, true);
    dom.requestsTableBody.innerHTML = `<tr><td colspan="11" class="message">No fue posible cargar solicitudes.</td></tr>`;
    return;
  }

  paymentRequests = data || [];
  hideMessage();
  renderStats();
  renderPaymentRequestsTable();
}

function populateFilters() {
  dom.companyFilter.innerHTML = `<option value="todos">Empresa: Todas</option>` +
    companies.map(company => `<option value="${escapeHtml(company.id)}">${escapeHtml(companyName(company))}</option>`).join("");
}

function populateFormSelects() {
  renderCompanyOptions();
  renderCostCenterOptions();
  resetBudgetCategorySelect("Selecciona empresa, centro de costo y mes");
  renderProveedorOptions("");
}

function renderCompanyOptions() {
  dom.companyId.innerHTML = optionPlaceholder("Seleccionar empresa") +
    companies.map(company => `<option value="${escapeHtml(company.id)}">${escapeHtml(companyName(company))}</option>`).join("");
}

function renderCostCenterOptions() {
  dom.costCenterId.innerHTML = optionPlaceholder("Seleccionar centro de costo") +
    costCenters.map(center => `<option value="${escapeHtml(center.id)}">${escapeHtml(costCenterName(center))}</option>`).join("");
}

async function handleBudgetScopeChange() {
  dom.budgetCategoryId.value = "";
  await loadAvailableBudgetCategories();
  updateSummaryPanel();
}

async function handleCompanyScopeChange() {
  approverLoadVersion += 1;
  resetApproverSelect("Cargando aprobadores disponibles...");
  await handleBudgetScopeChange();
  await loadPaymentRequestApproverOptions();
  updateSummaryPanel();
}

async function handleBudgetAndApproverScopeChange() {
  approverLoadVersion += 1;
  resetApproverSelect("Actualizando aprobadores disponibles...");
  await handleBudgetScopeChange();
  await loadPaymentRequestApproverOptions();
}

function scheduleApproverOptionsLoad() {
  window.clearTimeout(approverReloadTimer);
  approverLoadVersion += 1;
  resetApproverSelect("Actualizando aprobadores disponibles...");
  approverReloadTimer = window.setTimeout(loadPaymentRequestApproverOptions, 300);
}

function resetApproverSelect(label = "Completa empresa, centro de costo y monto") {
  approverCandidates = [];
  if (!dom.approverId) return;
  dom.approverId.disabled = true;
  dom.approverId.innerHTML = optionPlaceholder(label);
  if (dom.approverAssignmentId) dom.approverAssignmentId.value = "";
  if (dom.approverHelp) {
    dom.approverHelp.textContent = "Selecciona empresa, centro de costo y monto para cargar aprobadores disponibles.";
    dom.approverHelp.style.color = "";
  }
}

async function loadPaymentRequestApproverOptions() {
  const companyId = dom.companyId?.value || "";
  const costCenterId = dom.costCenterId?.value || null;
  const amount = numberValue(dom.amountRequested?.value);
  const requestVersion = ++approverLoadVersion;
  if (!companyId) {
    resetApproverSelect();
    updateSummaryPanel();
    return;
  }

  resetApproverSelect("Cargando aprobadores disponibles...");
  const { data, error } = await supabaseClient.rpc("list_payment_request_approver_options", {
    p_company_id: companyId,
    p_cost_center_id: costCenterId,
    p_amount: amount > 0 ? amount : null,
  });
  if (requestVersion !== approverLoadVersion) return;

  if (error) {
    resetApproverSelect("No se pudieron cargar aprobadores");
    if (dom.approverHelp) {
      dom.approverHelp.textContent = friendlyError(error, "list_payment_request_approver_options");
      dom.approverHelp.style.color = "var(--ruby)";
    }
    updateSummaryPanel();
    return;
  }

  approverCandidates = Array.isArray(data) ? data : [];
  if (!approverCandidates.length) {
    const scopeComplete = Boolean(costCenterId && amount > 0);
    resetApproverSelect(scopeComplete ? "Sin aprobadores disponibles" : "Completa centro de costo y monto");
    if (dom.approverHelp) {
      dom.approverHelp.textContent = scopeComplete
        ? "No hay aprobadores disponibles para esta empresa y condiciones. Solicita a un administrador configurar uno."
        : "Completa centro de costo y monto para evaluar las reglas de aprobación.";
      dom.approverHelp.style.color = "var(--amber)";
    }
    updateSummaryPanel();
    return;
  }

  dom.approverId.innerHTML = optionPlaceholder("Seleccionar aprobador") +
    approverCandidates.map(candidate => {
      const label = candidate.option_label || candidate.display_name || candidate.email || "Sin nombre";
      return `<option value="${escapeHtml(candidate.profile_id)}" data-assignment-id="${escapeHtml(candidate.assignment_id || "")}" data-source="${escapeHtml(candidate.source || "approval_rules")}">${escapeHtml(label)}</option>`;
    }).join("");

  dom.approverId.disabled = false;
  if (approverCandidates.length === 1) {
    dom.approverId.value = approverCandidates[0].profile_id;
  }
  syncApproverSelection();
  if (dom.approverHelp) {
    const source = approverCandidates[0]?.source;
    dom.approverHelp.textContent = source === "assigned"
      ? "Selecciona uno de los aprobadores configurados para ti en esta empresa."
      : "No tienes aprobadores configurados. Se muestran usuarios elegibles según las reglas de aprobación.";
    dom.approverHelp.style.color = source === "assigned" ? "var(--accent-text)" : "";
  }
  updateSummaryPanel();
}

function syncApproverSelection() {
  const option = dom.approverId?.selectedOptions?.[0];
  if (dom.approverAssignmentId) {
    dom.approverAssignmentId.value = option?.dataset?.assignmentId || "";
  }
}

async function loadAvailableBudgetCategories() {
  const companyId = dom.companyId.value;
  const costCenterId = dom.costCenterId.value;
  const budgetMonth = monthInputToDate(dom.budgetMonth.value);

  budgetAvailabilityRows = [];

  if (!companyId || !costCenterId || !budgetMonth) {
    resetBudgetCategorySelect("Selecciona empresa, centro de costo y mes");
    setBudgetCategoryHelp("Selecciona empresa, centro de costo y mes para cargar partidas disponibles.");
    updateSummaryPanel();
    return;
  }

  dom.budgetCategoryId.disabled = true;
  dom.budgetCategoryId.innerHTML = optionPlaceholder("Cargando partidas disponibles...");
  setBudgetCategoryHelp("Consultando presupuesto activo para la combinacion seleccionada.");

  const { data, error } = await supabaseClient
    .from("budget_availability")
    .select("*")
    .eq("company_id", companyId)
    .eq("cost_center_id", costCenterId)
    .eq("budget_month", budgetMonth);

  if (error) {
    resetBudgetCategorySelect("No se pudieron cargar partidas");
    setBudgetCategoryHelp(rlsHint("budget_availability", "select", error), "error");
    showToast("Partidas no disponibles", friendlyError(error, "budget_availability"), "error");
    updateSummaryPanel();
    return;
  }

  budgetAvailabilityRows = dedupeAvailabilityRows(data || [])
    .filter(row => row.budget_category_id)
    .sort((a, b) => {
      const categoryA = budgetCategoryById(a.budget_category_id);
      const categoryB = budgetCategoryById(b.budget_category_id);
      return budgetCategoryLabel(categoryA).localeCompare(budgetCategoryLabel(categoryB), "es");
    });

  if (!budgetAvailabilityRows.length) {
    resetBudgetCategorySelect("Sin partidas disponibles");
    setBudgetCategoryHelp("No hay partidas presupuestales disponibles para esta empresa, centro de costo y mes.", "warning");
    updateSummaryPanel();
    return;
  }

  dom.budgetCategoryId.disabled = false;
  if (dom.budgetCategorySearch) { dom.budgetCategorySearch.disabled = false; dom.budgetCategorySearch.value = ""; }
  dom.budgetCategoryId.innerHTML = optionPlaceholder("Seleccionar partida presupuestal") +
    budgetAvailabilityRows.map(row => {
      const category = budgetCategoryById(row.budget_category_id);
      return `<option value="${escapeHtml(row.budget_category_id)}">${escapeHtml(budgetCategoryAvailabilityLabel(category, row))}</option>`;
    }).join("");

  setBudgetCategoryHelp(`${budgetAvailabilityRows.length} partidas disponibles para la combinacion seleccionada.`, "success");
  updateSummaryPanel();
}

function initProviderCombo() {
  const input = dom.providerSearch;
  const dropdown = document.getElementById("providerDropdown");
  if (!input || !dropdown) return;

  let activeIndex = -1;

  input.addEventListener("input", () => {
    activeIndex = -1;
    renderComboList(input.value);
    openCombo();
  });

  input.addEventListener("keydown", e => {
    const items = dropdown.querySelectorAll("li:not(.combo-empty)");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlightCombo(items, activeIndex);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, -1);
      highlightCombo(items, activeIndex);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].click();
    } else if (e.key === "Escape") {
      closeCombo();
    }
  });

  input.addEventListener("focus", () => {
    if (!dom.proveedorId.value) renderComboList(input.value);
    openCombo();
  });

  document.addEventListener("click", e => {
    if (!document.getElementById("providerCombo")?.contains(e.target)) closeCombo();
  });
}

function renderComboList(query = "") {
  const dropdown = document.getElementById("providerDropdown");
  if (!dropdown) return;
  const normalizedQuery = normalize(query);
  const filtered = proveedores
    .filter(p => {
      const text = normalize([p.alias, p.nombre_completo, p.rfc].join(" "));
      return !normalizedQuery || text.includes(normalizedQuery);
    })
    .slice(0, 200);

  if (!filtered.length) {
    dropdown.innerHTML = `<li class="combo-empty">Sin resultados</li>`;
    return;
  }
  dropdown.innerHTML = filtered.map(p => `
    <li role="option" data-id="${escapeHtml(p.id)}" data-label="${escapeHtml(proveedorLabel(p))}">
      <span class="combo-main">${escapeHtml(p.alias || p.nombre_completo || "")}</span>
      <span class="combo-sub">${escapeHtml(p.rfc || "")}${p.banco ? " · " + escapeHtml(p.banco) : ""}</span>
    </li>`).join("");

  dropdown.querySelectorAll("li[data-id]").forEach(li => {
    li.addEventListener("mousedown", e => { e.preventDefault(); selectProvider(li.dataset.id, li.dataset.label); });
  });
}

function highlightCombo(items, index) {
  items.forEach((li, i) => li.classList.toggle("combo-active", i === index));
  if (index >= 0) items[index]?.scrollIntoView({ block: "nearest" });
}

function openCombo() {
  const dropdown = document.getElementById("providerDropdown");
  if (dropdown) dropdown.classList.remove("hidden");
}

function closeCombo() {
  const dropdown = document.getElementById("providerDropdown");
  if (dropdown) dropdown.classList.add("hidden");
}

function selectProvider(id, label) {
  if (dom.providerSearch) dom.providerSearch.value = label;
  if (dom.proveedorId) {
    dom.proveedorId.value = id;
    dom.proveedorId.dispatchEvent(new Event("change"));
  }
  closeCombo();
}

// Hook para que la extensión (alta rápida de proveedor) inyecte el nuevo
// proveedor al combobox y lo seleccione sin recargar la página.
window.fluxRegisterProvider = function (prov) {
  if (!prov?.id) return;
  if (!proveedores.some((p) => p.id === prov.id)) {
    proveedores.push(prov);
    proveedores.sort((a, b) => (a.alias || "").localeCompare(b.alias || "", "es"));
  }
  selectProvider(prov.id, proveedorLabel(prov));
};

function renderProveedorOptions(query = "") {
  renderComboList(query);
}

function renderStats() {
  const activeRequests = paymentRequests.filter(isActiveRequest);
  const paidRequests = paymentRequests.filter(request => request.status === "paid");
  const aprobables = activeRequests.filter(request => request.budget_decision === "aprobable").length;
  const blocked = activeRequests.filter(isExceptionRequest).length;
  const amount = activeRequests.reduce((sum, request) => sum + numberValue(request.amount_requested), 0);

  document.getElementById("totalRequests").textContent = activeRequests.length;
  document.getElementById("approvableRequests").textContent = aprobables;
  document.getElementById("blockedRequests").textContent = blocked;
  document.getElementById("paidRequests").textContent = paidRequests.length;
  document.getElementById("requestedAmount").textContent = compactCurrency(amount);
}

function showActiveRequests() {
  dom.searchInput.value = "";
  dom.statusFilter.value = "activas";
  dom.budgetDecisionFilter.value = "todos";
  dom.companyFilter.value = "todos";
  renderPaymentRequestsTable();
}

function showAllRequests() {
  dom.searchInput.value = "";
  dom.statusFilter.value = "todos";
  dom.budgetDecisionFilter.value = "todos";
  dom.companyFilter.value = "todos";
  renderPaymentRequestsTable();
}

function showApprovableRequests() {
  dom.searchInput.value = "";
  dom.statusFilter.value = "activas";
  dom.budgetDecisionFilter.value = "aprobable";
  dom.companyFilter.value = "todos";
  renderPaymentRequestsTable();
}

function showExceptionRequests() {
  dom.searchInput.value = "";
  dom.statusFilter.value = "activas";
  dom.budgetDecisionFilter.value = "excepciones";
  dom.companyFilter.value = "todos";
  renderPaymentRequestsTable();
}

function showPaidRequests() {
  dom.searchInput.value = "";
  dom.statusFilter.value = "paid";
  dom.budgetDecisionFilter.value = "todos";
  dom.companyFilter.value = "todos";
  renderPaymentRequestsTable();
}

function budgetDecisionMatches(request, filter) {
  if (filter === "todos") return true;
  if (filter === "excepciones") return isExceptionRequest(request);
  return request.budget_decision === filter;
}

function isActiveRequest(request) {
  return ACTIVE_REQUEST_STATUSES.includes(request?.status);
}

function statusMatches(request, filter) {
  if (filter === "todos") return true;
  if (filter === "activas") return isActiveRequest(request);
  return request.status === filter;
}

function isExceptionRequest(request) {
  return request?.budget_decision === "bloqueado" || request?.is_extraordinary_adjustment === true;
}

function hasActiveFilters() {
  return Boolean(dom.searchInput.value.trim()) ||
    dom.statusFilter.value !== "todos" ||
    dom.budgetDecisionFilter.value !== "todos" ||
    dom.companyFilter.value !== "todos";
}

function renderFilterState() {
  const activeParts = [];

  if (dom.searchInput.value.trim()) activeParts.push("Busqueda");
  if (dom.statusFilter.value !== "todos") activeParts.push(STATUS_FILTER_LABELS[dom.statusFilter.value] || `Estatus: ${dom.statusFilter.value}`);
  if (dom.budgetDecisionFilter.value === "aprobable") activeParts.push("Aprobables");
  if (dom.budgetDecisionFilter.value === "excepciones") activeParts.push("Excepciones presupuestales");
  if (dom.companyFilter.value !== "todos") {
    const company = companyById(dom.companyFilter.value);
    activeParts.push(company ? companyName(company) : "Empresa filtrada");
  }

  dom.totalCard?.classList.toggle("active", dom.statusFilter.value === "activas" && dom.budgetDecisionFilter.value === "todos");
  dom.approvableCard?.classList.toggle("active", dom.statusFilter.value === "activas" && dom.budgetDecisionFilter.value === "aprobable");
  dom.exceptionsCard?.classList.toggle("active", dom.statusFilter.value === "activas" && dom.budgetDecisionFilter.value === "excepciones");
  dom.paidCard?.classList.toggle("active", dom.statusFilter.value === "paid");

  if (!activeParts.length) {
    dom.filterSummary.classList.add("hidden");
    dom.filterSummaryText.textContent = "Vista filtrada";
    return;
  }

  dom.filterSummary.classList.remove("hidden");
  dom.filterSummaryText.textContent = `Vista filtrada: ${activeParts.join(" · ")}`;
}

function renderExtraordinaryStateBadge(state) {
  const map = {
    extraordinary_requested: ["Extraordinaria solicitada", "warning"],
    extraordinary_draft: ["Extraordinaria solicitada", "warning"],
    extraordinary_active: ["Extraordinaria activa", "success"],
    consumed_pending_ratification: ["Extraordinaria / pendiente de ratificación", "warning"],
    ratified: ["Extraordinaria ratificada", "success"],
    disputed: ["Extraordinaria en disputa", "danger"],
    revoked: ["Extraordinaria revocada", "neutral"],
    expired: ["Extraordinaria vencida", "neutral"],
    materially_invalidated: ["Extraordinaria invalidada", "danger"],
  };
  const entry = map[state];
  return entry ? Components.badge(entry[0], entry[1]) : "";
}

function renderPaymentRequestsTable() {
  const query = normalize(dom.searchInput.value);
  const statusFilter = dom.statusFilter.value;
  const decisionFilter = dom.budgetDecisionFilter.value;
  const companyFilter = dom.companyFilter.value;
  renderFilterState();

  const rows = paymentRequests.filter(request => {
    const proveedor = proveedorById(request.proveedor_id);
    const company = companyById(request.company_id);
    const center = costCenterById(request.cost_center_id);
    const category = budgetCategoryById(request.budget_category_id);
    const searchable = normalize([
      request.request_number,
      request.description,
      request.notes,
      proveedorLabel(proveedor),
      companyName(company),
      costCenterName(center),
      budgetCategoryLabel(category),
    ].join(" "));

    return searchable.includes(query) &&
      statusMatches(request, statusFilter) &&
      budgetDecisionMatches(request, decisionFilter) &&
      (companyFilter === "todos" || request.company_id === companyFilter);
  });

  if (!rows.length) {
    const filtered = hasActiveFilters();
    dom.requestsTableBody.innerHTML = `
      <tr><td colspan="6">${Components.emptyState({
        icon: filtered ? "🔍" : "📋",
        title: filtered ? "Sin resultados" : "Sin solicitudes",
        desc: filtered ? "Ninguna solicitud coincide con los filtros aplicados." : "Crea una nueva solicitud de pago para iniciar la bandeja.",
        actionHtml: filtered ? `<button class="secondary-btn" onclick="document.getElementById('clearFiltersBtn').click()">Limpiar filtros</button>` : "",
        variant: filtered ? "compact" : "full",
      })}</td></tr>`;
    return;
  }

  dom.requestsTableBody.innerHTML = rows.map(request => {
    const proveedor = proveedorById(request.proveedor_id);
    const company = companyById(request.company_id);
    const center = costCenterById(request.cost_center_id);
    const category = budgetCategoryById(request.budget_category_id);
    const isHighlighted = highlightedRequestId && request.id === highlightedRequestId;

    const budgetAdjustmentBadge = request.is_extraordinary_adjustment
      ? Components.badge("Ajuste presupuestal", "violet")
      : "";
    const extraordinaryBadge = renderExtraordinaryStateBadge(request.extraordinary_state);
    const folioExtra = `${budgetAdjustmentBadge}${extraordinaryBadge}`;
    const statusCell = `${renderStatusBadge(request.status)} ${renderBudgetDecisionBadge(request.budget_decision, request.budget_block_reason)}`;

    return `
      <tr class="${isHighlighted ? "highlight-row" : ""}">
        <td>
          <span class="cell-main">${escapeHtml(request.request_number || "Sin folio")}</span>${folioExtra}
          <span class="cell-sub">${escapeHtml(formatDate(request.submitted_at || request.created_at))}</span>
        </td>
        <td>
          <span class="cell-main">${escapeHtml(proveedorAlias(proveedor))}</span>
          <span class="cell-sub">${escapeHtml(companyName(company))} · ${escapeHtml(costCenterName(center))}</span>
        </td>
        <td>
          <span class="cell-main">${escapeHtml(category?.code || "Sin partida")}</span>
          <span class="cell-sub">${escapeHtml(category?.name || "")} · ${escapeHtml(formatMonth(request.budget_month))}</span>
        </td>
        <td>
          <span class="cell-main">${escapeHtml(formatCurrency(request.amount_requested, request.currency || "MXN"))}</span>
        </td>
        <td>${statusCell}</td>
        <td>
          <div class="actions row-actions">
            <button class="small-btn" type="button" onclick="openRequestDetail('${request.id}')" style="white-space:nowrap">Ver detalle</button>
          </div>
        </td>
      </tr>`;
  }).join("");

  if (highlightedRequestId) {
    window.setTimeout(() => {
      highlightedRequestId = null;
      renderPaymentRequestsTable();
    }, 3500);
  }
}

async function openNewRequestModal() {
  dom.requestForm.reset();
  dom.currency.value = "MXN";
  dom.exchangeRate.value = "1";
  handleCurrencyChange();
  requestFileUpload?.reset();
  dom.submitRequestBtn.disabled = false;
  dom.submitRequestBtn.textContent = "Crear solicitud";
  setDefaultMonth();
  if (dom.providerSearch) dom.providerSearch.value = "";
  if (dom.proveedorId) { dom.proveedorId.value = ""; dom.proveedorId.dispatchEvent(new Event("change")); }
  renderProveedorOptions("");
  resetApproverSelect();
  budgetAvailabilityRows = [];
  resetBudgetCategorySelect("Selecciona empresa, centro de costo y mes");
  setBudgetCategoryHelp("Selecciona empresa, centro de costo y mes para cargar partidas disponibles.");
  handleCurrencyChange();
  await loadExtraordinaryFaculties();
  ensureExtraordinaryIntentPlacement();
  syncExtraordinaryIntentVisibility();
  dom.requestDialog.showModal();
  [0, 60, 180, 420, 900].forEach(delay => {
    window.setTimeout(() => {
      ensureExtraordinaryIntentPlacement();
      syncExtraordinaryIntentVisibility();
    }, delay);
  });
}

// Botón Demo: rellena el formulario con datos de prueba para presentaciones.
// Busca una combinación empresa+CC+mes que SÍ tenga presupuesto para que la
// partida cargue, y selecciona el primer proveedor disponible.
async function fillDemoRequest() {
  const btn = document.getElementById("demoFillBtn");
  if (btn) { btn.disabled = true; btn.textContent = "⚡ Llenando…"; }
  try {
    dom.amountRequested.value = "5000";
    const { data } = await supabaseClient
      .from("budget_availability")
      .select("company_id,cost_center_id,budget_month,budget_category_id")
      .limit(1);
    const row = data?.[0];

    if (row) {
      dom.companyId.value = row.company_id;
      dom.costCenterId.value = row.cost_center_id;
      dom.budgetMonth.value = String(row.budget_month).slice(0, 7);
      await handleCompanyScopeChange();
      if (row.budget_category_id) dom.budgetCategoryId.value = row.budget_category_id;
    } else {
      if (dom.companyId.options.length > 1) dom.companyId.selectedIndex = 1;
      if (dom.costCenterId.options.length > 1) dom.costCenterId.selectedIndex = 1;
      await handleCompanyScopeChange();
    }

    if (!dom.approverId.disabled && !dom.approverId.value && dom.approverId.options.length > 1) {
      dom.approverId.selectedIndex = 1;
      syncApproverSelection();
    }

    if (proveedores.length) selectProvider(proveedores[0].id, proveedorLabel(proveedores[0]));

    dom.currency.value = "MXN";
    handleCurrencyChange();
    dom.description.value = "Demo - pago de servicios de prueba";
    dom.notes.value = "Solicitud generada con el botón Demo";
    updateSummaryPanel();
  } catch (err) {
    showToast("Demo", friendlyError(err), "warning");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ Demo"; }
  }
}

function closeNewRequestModal() {
  if (dom.requestDialog.open) dom.requestDialog.close();
}

async function submitPaymentRequest(event) {
  event.preventDefault();

  const payload = collectRequestPayload();
  const validation = validateRequestPayload(payload);
  if (validation) {
    showToast("Revisa la solicitud", validation, "warning");
    return;
  }

  dom.submitRequestBtn.disabled = true;
  dom.submitRequestBtn.textContent = "Creando solicitud y validando presupuesto...";

  try {
    const { data, error } = await supabaseClient.rpc("create_payment_request_with_extraordinary_intent", {
      p_proveedor_id: payload.proveedor_id,
      p_company_id: payload.company_id,
      p_cost_center_id: payload.cost_center_id,
      p_budget_category_id: payload.budget_category_id,
      p_budget_month: payload.budget_month,
      p_amount_requested: payload.amount_requested,
      p_currency: payload.currency,
      p_exchange_rate: payload.exchange_rate,
      p_description: payload.description,
      p_notes: payload.notes,
      p_requested_by: currentProfileId,
      p_is_extraordinary_adjustment: payload.is_extraordinary_adjustment,
      p_approver_id: payload.approver_id,
      p_approver_assignment_id: payload.approver_assignment_id,
      p_extraordinary_requested: payload.extraordinary_requested,
    });

    if (error) throw error;

    const result = normalizeRpcResult(data);
    const folio = result.request_number || "Solicitud";
    const decision = result.budget_decision || result.budget_result?.status || "sin_decision";
    const reason = result.budget_block_reason || result.budget_result?.reason || "";

    if (decision === "aprobable") {
      showToast(
        "Solicitud creada",
        `${folio} creada correctamente. El sistema la valido como aprobable.`,
        "success"
      );
    } else {
      showToast(
        "Solicitud creada con bloqueo",
        `${folio} creada correctamente, pero el sistema detecto bloqueo presupuestal: ${reason || "requiere revision"}.`,
        "warning"
      );
    }

    const newRequestId = result.payment_request_id || result.id || null;
    const requestFile = requestFileUpload?.getFile();
    if (requestFile && newRequestId) {
      try {
        const storagePath = await window.FluxUpload.uploadReceipt(requestFile, `solicitudes/${newRequestId}`);
        const { error: uploadErr } = await supabaseClient.from("payment_requests").update({ invoice_storage_path: storagePath }).eq("id", newRequestId);
        if (uploadErr) showToast("Comprobante no vinculado", "La solicitud se creó pero el comprobante no pudo vincularse.", "warning");
      } catch (uploadErr) {
        showToast("Comprobante no vinculado", "La solicitud se creó pero el comprobante no pudo subirse.", "warning");
      }
    }
    closeNewRequestModal();
    highlightedRequestId = newRequestId;
    await loadPaymentRequests();
    if (payload.extraordinary_requested && newRequestId) {
      openRequestDetail(newRequestId);
      document.dispatchEvent(new CustomEvent("flux:extraordinary-intent-created", {
        detail: { paymentRequestId: newRequestId },
      }));
      showToast(
        "Extraordinaria solicitada",
        "La solicitud quedó guardada, pero todavía no está disponible para layout. Completa la autorización externa.",
        "warning"
      );
    }
  } catch (error) {
    showToast("No se pudo crear la solicitud", friendlyError(error, "create_payment_request_with_extraordinary_intent"), "error");
    dom.submitRequestBtn.disabled = false;
    dom.submitRequestBtn.textContent = "Crear solicitud";
  }
}

function collectRequestPayload() {
  const currency = dom.currency.value || "MXN";
  const exchangeRate = currency === "MXN" ? 1 : numberValue(dom.exchangeRate.value);
  const selectedApprover = approverCandidates.find(candidate => candidate.profile_id === dom.approverId?.value);

  return {
    proveedor_id: dom.proveedorId.value || null,
    company_id: dom.companyId.value || null,
    approver_id: dom.approverId?.value || null,
    approver_assignment_id: selectedApprover?.assignment_id || null,
    cost_center_id: dom.costCenterId.value || null,
    budget_category_id: dom.budgetCategoryId.value || null,
    budget_month: monthInputToDate(dom.budgetMonth.value),
    amount_requested: numberValue(dom.amountRequested.value),
    currency,
    exchange_rate: exchangeRate,
    description: dom.description.value.trim(),
    notes: dom.notes.value.trim() || null,
    is_extraordinary_adjustment: dom.isExtraordinaryAdjustment.checked,
    extraordinary_requested:
      !dom.extraordinaryIntentSection?.classList.contains("hidden")
      && Boolean(dom.requiresExtraordinaryTreatment?.checked),
  };
}

function validateRequestPayload(payload) {
  if (!payload.company_id) return "Selecciona una empresa.";
  if (!payload.approver_id) return "Selecciona quién revisará esta solicitud.";
  const selectedApprover = approverCandidates.find(candidate => candidate.profile_id === payload.approver_id);
  if (!selectedApprover) return "El aprobador seleccionado ya no es válido. Vuelve a cargar las opciones.";
  if (selectedApprover.source === "assigned" && !payload.approver_assignment_id) return "La opción configurada perdió su referencia. Vuelve a seleccionarla.";
  if (!payload.cost_center_id) return "Selecciona un centro de costo.";
  if (!payload.budget_category_id) return "Selecciona una partida presupuestal.";
  if (!availabilityForCategory(payload.budget_category_id)) return "La partida seleccionada no esta disponible para la empresa, centro de costo y mes.";
  if (!payload.budget_month) return "Selecciona el mes presupuestal.";
  if (!payload.proveedor_id) return "Selecciona un proveedor.";
  if (!payload.amount_requested || payload.amount_requested <= 0) return "El monto solicitado debe ser mayor a 0.";
  if (!payload.currency) return "Selecciona la moneda.";
  if (!payload.exchange_rate || payload.exchange_rate <= 0) return "El tipo de cambio debe ser mayor a 0.";
  if (!payload.description) return "Captura una descripcion.";
  return "";
}

function openRequestDetail(id) {
  const request = paymentRequests.find(item => item.id === id);
  if (!request) return;

  currentDetailRequestId = id;
  const proveedor = proveedorById(request.proveedor_id);
  const company = companyById(request.company_id);
  const center = costCenterById(request.cost_center_id);
  const category = budgetCategoryById(request.budget_category_id);
  const exception = isExceptionRequest(request);
  const isPaid = request.status === "paid";
  const decisionText = isPaid
    ? "Esta solicitud ya fue pagada."
    : request.budget_decision === "aprobable" && !exception
    ? "Validada automaticamente con presupuesto disponible."
    : "Requiere revision por excepcion presupuestal.";
  const detailNotice = isPaid
    ? Components.notice("Pagada", "Esta solicitud ya fue pagada.", "success")
    : exception
    ? Components.notice("Excepción presupuestal", "Requiere revisión por excepción presupuestal.", "warning")
    : Components.notice("Presupuesto disponible", "Validada automáticamente con presupuesto disponible.", "info");

  dom.detailTitle.textContent = request.request_number || "Detalle de solicitud";
  dom.detailSubtitle.textContent = `${proveedorAlias(proveedor)} · ${formatMonth(request.budget_month)}`;
  dom.detailContent.innerHTML = `
    ${detailNotice}

    <div style="font-size:28px;font-weight:700;color:var(--accent-text);font-variant-numeric:tabular-nums;padding:4px 0">
      ${escapeHtml(formatCurrency(request.amount_requested, request.currency || "MXN"))}
    </div>

    ${Components.refGrid([
      { label: "Proveedor",      value: escapeHtml(proveedorAlias(proveedor)) },
      { label: "Empresa",        value: escapeHtml(companyName(company)) },
      { label: "Aprobador seleccionado", value: `<span id="detailApproverRouting">Cargando...</span>`, full: true },
      { label: "Centro de costo",value: escapeHtml(costCenterName(center)), muted: true },
      { label: "Mes presupuestal",value: escapeHtml(formatMonth(request.budget_month)), muted: true },
      { label: "Partida",        value: escapeHtml(budgetCategoryLabel(category)), muted: true, full: true },
    ])}

    ${Components.dataSection([
      { label: "Estatus",              value: renderStatusBadge(request.status) },
      { label: "Validación presupuestal", value: renderBudgetDecisionBadge(request.budget_decision, request.budget_block_reason) },
      { label: "Descripción",          value: escapeHtml(request.description || "Sin descripción"), muted: true },
      ...(request.notes ? [{ label: "Notas", value: escapeHtml(request.notes), muted: true }] : []),
      ...(request.invoice_storage_path ? [{ label: "Comprobante", value: `<a href="#" class="invoice-link" data-path="${escapeHtml(request.invoice_storage_path)}">Ver comprobante</a>` }] : []),
    ])}

    ${Components.dataSection([
      { label: "Disponible antes",  value: escapeHtml(formatCurrency(request.budget_available_before, request.currency || "MXN")), muted: true },
      { label: "Disponible después", value: escapeHtml(formatCurrency(request.budget_available_after, request.currency || "MXN")), muted: true },
      { label: "Faltante",          value: escapeHtml(formatCurrency(request.budget_shortfall, request.currency || "MXN")), muted: true },
    ], "Impacto presupuestal")}

    ${renderDecisionPanel(request)}

    ${renderPaymentInfoSection(request)}

    ${window.FluxAuth?.canApprove?.() ? `
    <div id="detailIncidenciaSection" style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px;display:flex;flex-direction:column;gap:8px">
      <div style="font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.4px">Incidencia asociada</div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center">
        <select id="detailIncidenciaSelect" class="form-control" style="height:36px">
          <option value="">Cargando incidencias…</option>
        </select>
        <button type="button" id="detailIncidenciaBtn" class="primary-btn" style="height:36px;white-space:nowrap">Asociar</button>
      </div>
      <div id="detailIncidenciaHint" style="font-size:11px;color:var(--text-3)">Cargando…</div>
    </div>` : ""}`;

  const isTerminal = ["paid", "cancelled", "rejected", "approved", "scheduled"].includes(request.status);
  const canEdit = window.FluxAuth?.canApprove?.() && !isTerminal;
  if (dom.editRequestBtn) dom.editRequestBtn.style.display = canEdit ? "" : "none";

  loadApprovalHistory(request.id);
  loadDetailApprover(request.id);
  if (isPaid) loadPaymentInfo(request.id);
  if (!dom.detailDialog.open) dom.detailDialog.showModal();
  if (window.FluxAuth?.canApprove?.()) loadDetailIncidencias(request);
}

async function loadDetailApprover(paymentRequestId) {
  const target = document.getElementById("detailApproverRouting");
  if (!target) return;
  const { data, error } = await supabaseClient.rpc("get_payment_request_approver_details", {
    p_payment_request_id: paymentRequestId,
  });
  if (error) {
    target.textContent = "No disponible";
    return;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.profile_id) {
    target.textContent = "Sin revisor asignado";
    return;
  }
  const roles = Array.isArray(row.eligible_roles) && row.eligible_roles.length ? ` · ${row.eligible_roles.join(", ")}` : "";
  const source = row.source === "assigned"
    ? " · Configurado por administración"
    : row.source === "approval_rules"
      ? " · Elegible por reglas"
      : "";
  target.textContent = `${row.display_name || "Sin nombre"}${roles}${source}`;
}

window.openRequestDetail = openRequestDetail;

async function loadDetailIncidencias(request) {
  const select = document.getElementById("detailIncidenciaSelect");
  const hint = document.getElementById("detailIncidenciaHint");
  const btn = document.getElementById("detailIncidenciaBtn");
  if (!select || !hint || !btn) return;

  // Detect current linked incidencia from notes
  const currentMarker = (request.notes || "").match(/\[Visita\/incidencia asociada: ([^\s\]]+)/);
  const currentIncidenciaId = currentMarker ? currentMarker[1] : null;

  try {
    const [{ data: incidents, error: ie }, { data: members, error: me }] = await Promise.all([
      supabaseClient.from("incident_charges").select("id,member_id,external_name,description,amount,incident_date,status").order("incident_date", { ascending: false }).limit(100),
      supabaseClient.from("members").select("id,full_name").eq("active", true),
    ]);
    if (ie) throw ie;

    const membersById = new Map((members || []).map(m => [m.id, m.full_name]));

    const label = inc => {
      const receiver = inc.member_id ? (membersById.get(inc.member_id) || "Socio") : (inc.external_name || "Externo");
      const statusMap = { open: "Abierta", invoiced: "Facturada", paid: "Pagada", cancelled: "Cancelada" };
      return [formatDate(inc.incident_date), receiver, inc.description || "Sin descripcion", formatCurrency(inc.amount, "MXN"), statusMap[inc.status] || inc.status].filter(Boolean).join(" | ");
    };

    select.innerHTML = `<option value="">Sin incidencia asociada</option>` +
      (incidents || []).map(inc => `<option value="${escapeHtml(inc.id)}">${escapeHtml(label(inc))}</option>`).join("");

    if (currentIncidenciaId) {
      select.value = currentIncidenciaId;
      hint.textContent = "Incidencia actualmente vinculada. Puedes cambiarla o quitarla.";
    } else {
      hint.textContent = "Asocia una incidencia de Ingresos a esta solicitud. Se guardará en notas.";
    }

    btn.onclick = async () => {
      const incId = select.value;
      const inc = (incidents || []).find(i => i.id === incId) || null;
      const cleanNotes = (request.notes || "").replace(/\n?\[Visita\/incidencia asociada:[^\]]+\]/g, "").trim();
      const marker = inc ? `[Visita/incidencia asociada: ${inc.id} - ${label(inc)}]` : "";
      const newNotes = [cleanNotes, marker].filter(Boolean).join("\n") || null;

      btn.disabled = true;
      btn.textContent = "Guardando…";
      const { error } = await supabaseClient.from("payment_requests").update({ notes: newNotes, updated_at: new Date().toISOString() }).eq("id", request.id);
      btn.disabled = false;
      btn.textContent = "Asociar";
      if (error) { showToast("Error", error.message, "error"); return; }
      showToast("Incidencia actualizada", inc ? "Incidencia vinculada correctamente." : "Incidencia desvinculada.", "success");
      await loadPaymentRequests();
      openRequestDetail(request.id);
    };
  } catch (err) {
    select.innerHTML = `<option value="">No se pudieron cargar incidencias</option>`;
    hint.textContent = err.message || "Error al cargar incidencias.";
  }
}

function closeRequestDetail() {
  if (dom.detailDialog.open) dom.detailDialog.close();
  currentDetailRequestId = null;
}

// ── Edit modal ──────────────────────────────────────────────────────────────

async function openEditRequest(id) {
  const request = paymentRequests.find(r => r.id === id);
  if (!request) return;

  dom.editSubtitle.textContent = `${request.request_number || "Sin folio"} · editando todos los campos`;

  dom.editCompanyId.innerHTML = companies.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(companyName(c))}</option>`).join("");
  dom.editCostCenterId.innerHTML = costCenters.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(costCenterName(c))}</option>`).join("");

  dom.editCompanyId.value = request.company_id || "";
  dom.editCostCenterId.value = request.cost_center_id || "";
  dom.editBudgetMonth.value = request.budget_month ? request.budget_month.slice(0, 7) : "";

  await loadEditBudgetCategories();
  dom.editBudgetCategoryId.value = request.budget_category_id || "";

  const proveedor = proveedorById(request.proveedor_id);
  dom.editProviderSearch.value = proveedor ? proveedorLabel(proveedor) : "";
  dom.editProveedorId.value = request.proveedor_id || "";

  dom.editAmountRequested.value = request.amount_requested || "";
  dom.editCurrency.value = request.currency || "MXN";
  dom.editExchangeRate.value = request.exchange_rate || "1";
  handleEditCurrencyChange();
  dom.editIsExtraordinaryAdjustment.checked = !!request.is_extraordinary_adjustment;
  dom.editDescription.value = request.description || "";
  dom.editNotes.value = request.notes || "";
  editRequestFileUpload?.reset();

  dom.submitEditBtn.disabled = false;
  dom.submitEditBtn.textContent = "Guardar cambios";

  if (!dom.editDialog.open) dom.editDialog.showModal();
}

function closeEditModal() {
  if (dom.editDialog.open) dom.editDialog.close();
}

async function handleEditScopeChange() {
  dom.editBudgetCategoryId.value = "";
  await loadEditBudgetCategories();
}

async function loadEditBudgetCategories() {
  const companyId = dom.editCompanyId.value;
  const costCenterId = dom.editCostCenterId.value;
  const budgetMonth = monthInputToDate(dom.editBudgetMonth.value);

  if (!companyId || !costCenterId || !budgetMonth) {
    dom.editBudgetCategoryId.innerHTML = `<option value="">Selecciona empresa, centro de costo y mes</option>`;
    dom.editBudgetCategoryHelp.textContent = "Selecciona empresa, centro de costo y mes para cargar partidas disponibles.";
    return;
  }

  dom.editBudgetCategoryId.disabled = true;
  dom.editBudgetCategoryId.innerHTML = `<option value="">Cargando partidas...</option>`;

  const { data, error } = await supabaseClient
    .from("budget_availability")
    .select("*")
    .eq("company_id", companyId)
    .eq("cost_center_id", costCenterId)
    .eq("budget_month", budgetMonth);

  dom.editBudgetCategoryId.disabled = false;

  if (error) {
    dom.editBudgetCategoryId.innerHTML = `<option value="">No se pudieron cargar partidas</option>`;
    dom.editBudgetCategoryHelp.textContent = friendlyError(error, "budget_availability");
    return;
  }

  const rows = dedupeAvailabilityRows(data || []).filter(r => r.budget_category_id).sort((a, b) => {
    return budgetCategoryLabel(budgetCategoryById(a.budget_category_id)).localeCompare(budgetCategoryLabel(budgetCategoryById(b.budget_category_id)), "es");
  });

  if (!rows.length) {
    dom.editBudgetCategoryId.innerHTML = `<option value="">Sin partidas disponibles para esta combinación</option>`;
    dom.editBudgetCategoryHelp.textContent = "No hay partidas activas para empresa, centro de costo y mes seleccionados.";
    return;
  }

  dom.editBudgetCategoryId.innerHTML = `<option value="">Seleccionar partida presupuestal</option>` +
    rows.map(row => {
      const cat = budgetCategoryById(row.budget_category_id);
      return `<option value="${escapeHtml(row.budget_category_id)}">${escapeHtml(budgetCategoryAvailabilityLabel(cat, row))}</option>`;
    }).join("");
  if (dom.editBudgetCategorySearch) { dom.editBudgetCategorySearch.disabled = false; dom.editBudgetCategorySearch.value = ""; }
  dom.editBudgetCategoryHelp.textContent = `${rows.length} partidas disponibles para esta combinación.`;
}

function initEditProviderCombo() {
  const input = dom.editProviderSearch;
  const dropdown = document.getElementById("editProviderDropdown");
  if (!input || !dropdown) return;

  let activeIndex = -1;

  input.addEventListener("input", () => {
    activeIndex = -1;
    renderEditComboList(input.value);
    dropdown.classList.remove("hidden");
  });

  input.addEventListener("keydown", e => {
    const items = dropdown.querySelectorAll("li:not(.combo-empty)");
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); highlightEditCombo(items, activeIndex); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, -1); highlightEditCombo(items, activeIndex); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].click(); }
    else if (e.key === "Escape") dropdown.classList.add("hidden");
  });

  input.addEventListener("focus", () => { renderEditComboList(input.value); dropdown.classList.remove("hidden"); });

  document.addEventListener("click", e => {
    if (!document.getElementById("editProviderCombo")?.contains(e.target)) dropdown.classList.add("hidden");
  });
}

function renderEditComboList(query = "") {
  const dropdown = document.getElementById("editProviderDropdown");
  if (!dropdown) return;
  const nq = normalize(query);
  const filtered = proveedores.filter(p => {
    const text = normalize([p.alias, p.nombre_completo, p.rfc].join(" "));
    return !nq || text.includes(nq);
  }).slice(0, 200);

  if (!filtered.length) { dropdown.innerHTML = `<li class="combo-empty">Sin resultados</li>`; return; }
  dropdown.innerHTML = filtered.map(p => `
    <li role="option" data-id="${escapeHtml(p.id)}" data-label="${escapeHtml(proveedorLabel(p))}">
      <span class="combo-main">${escapeHtml(p.alias || p.nombre_completo || "")}</span>
      <span class="combo-sub">${escapeHtml(p.rfc || "")}${p.banco ? " · " + escapeHtml(p.banco) : ""}</span>
    </li>`).join("");
  dropdown.querySelectorAll("li[data-id]").forEach(li => {
    li.addEventListener("mousedown", e => { e.preventDefault(); dom.editProviderSearch.value = li.dataset.label; dom.editProveedorId.value = li.dataset.id; dropdown.classList.add("hidden"); });
  });
}

function highlightEditCombo(items, index) {
  items.forEach((li, i) => li.classList.toggle("combo-active", i === index));
  if (index >= 0) items[index]?.scrollIntoView({ block: "nearest" });
}

async function submitEditRequest(event) {
  event.preventDefault();
  const id = currentDetailRequestId;
  if (!id) return;

  if (!dom.editProveedorId.value) { showToast("Revisa la solicitud", "Selecciona un proveedor.", "warning"); return; }
  if (!dom.editBudgetCategoryId.value) { showToast("Revisa la solicitud", "Selecciona una partida presupuestal.", "warning"); return; }

  dom.submitEditBtn.disabled = true;
  dom.submitEditBtn.textContent = "Guardando...";

  const payload = {
    proveedor_id: dom.editProveedorId.value,
    company_id: dom.editCompanyId.value,
    cost_center_id: dom.editCostCenterId.value,
    budget_category_id: dom.editBudgetCategoryId.value,
    budget_month: monthInputToDate(dom.editBudgetMonth.value),
    amount_requested: numberValue(dom.editAmountRequested.value),
    currency: dom.editCurrency.value,
    exchange_rate: numberValue(dom.editExchangeRate.value) || 1,
    is_extraordinary_adjustment: dom.editIsExtraordinaryAdjustment.checked,
    description: dom.editDescription.value.trim(),
    notes: dom.editNotes.value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  try {
    const editFile = editRequestFileUpload?.getFile();
    if (editFile) {
      const storagePath = await window.FluxUpload.uploadReceipt(editFile, `solicitudes/${id}`);
      payload.invoice_storage_path = storagePath;
    }
    const { error } = await supabaseClient.from("payment_requests").update(payload).eq("id", id);
    if (error) throw error;
    showToast("Solicitud actualizada", "Los cambios se guardaron correctamente.", "success");
    closeEditModal();
    await loadPaymentRequests();
    openRequestDetail(id);
  } catch (err) {
    showToast("Error al guardar", err.message || "No se pudo actualizar la solicitud.", "error");
    dom.submitEditBtn.disabled = false;
    dom.submitEditBtn.textContent = "Guardar cambios";
  }
}

function renderPaymentInfoSection(request) {
  if (request.status !== "paid") return "";

  return `
    <section class="decision-card">
      <h3>Informacion de pago</h3>
      <p>Datos registrados al confirmar el pago del layout.</p>
      <div id="paymentInfoContent" class="history-list">
        <div class="history-item">Cargando informacion de pago...</div>
      </div>
    </section>`;
}

async function loadPaymentInfo(paymentRequestId) {
  const container = document.getElementById("paymentInfoContent");
  if (!container) return;

  const { data, error } = await supabaseClient
    .from("payment_receipts")
    .select("id,layout_id,payment_date,amount,bank_reference,storage_path,created_at")
    .eq("payment_request_id", paymentRequestId)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<div class="history-item">No fue posible cargar la informacion de pago. ${escapeHtml(rlsHint("payment_receipts", "select", error))}</div>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = `<div class="history-item">Pago registrado. La lectura de comprobantes queda como mejora pendiente si no hay recibos disponibles.</div>`;
    return;
  }

  container.innerHTML = data.map(receipt => `
    <div class="history-item">
      <strong>${escapeHtml(formatCurrency(receipt.amount, "MXN"))}</strong>
      Fecha de pago: ${escapeHtml(formatDate(receipt.payment_date))}
      <span>Referencia: ${escapeHtml(receipt.bank_reference || "Sin referencia")} · Layout: ${escapeHtml(receipt.layout_id || "Sin layout")}</span>
    </div>
  `).join("");
}

function renderDecisionPanel(request) {
  const exception = isExceptionRequest(request);
  const finalStatus = isFinalDecisionStatus(request.status);
  const isPaid = request.status === "paid";
  const canDecide = Boolean(window.FluxAuth?.canApprove?.())
    && (!request.approver_id || request.approver_id === currentProfileId);
  const noteClass = isPaid ? "success" : finalStatus ? "neutral" : exception ? "warning" : "success";
  const noteText = isPaid
    ? "Esta solicitud ya fue pagada."
    : finalStatus
    ? "Esta solicitud ya tiene una decisión registrada."
    : exception
      ? "Esta solicitud requiere decisión por excepción presupuestal."
      : "Esta solicitud fue validada automáticamente con presupuesto disponible.";

  const controls = finalStatus
    ? `<div class="decision-note neutral">Esta solicitud ya tiene una decisión registrada.</div>`
    : !canDecide
    ? `<div class="decision-note neutral">Solo el aprobador seleccionado puede registrar una decisión.</div>`
    : `
      <textarea id="decisionComments" placeholder="${exception ? "Comentario obligatorio para resolver la excepción..." : "Comentario para la decisión..."}"></textarea>
      <div id="decisionError" class="decision-error"></div>
      <div class="decision-actions">${renderDecisionButtons(request)}</div>`;

  return `
    <section class="decision-card">
      <h3>Decisión del aprobador</h3>
      <p>Registra la acción que seguirá esta solicitud.</p>
      <div class="decision-note ${noteClass}">${noteText}</div>
      ${controls}
      <div class="approval-history">
        <h4>Historial de decisiones</h4>
        <div id="approvalHistoryList" class="history-list">
          <div class="history-item">Cargando historial...</div>
        </div>
      </div>
    </section>`;
}

function renderDecisionButtons(request) {
  if (isExceptionRequest(request)) {
    return [
      decisionActionButton("Autorizar excepción", "exception_approved", "approve"),
      decisionActionButton("Rechazar excepción", "exception_rejected", "reject"),
      decisionActionButton("Solicitar cambio de monto", "amount_change_requested", "change"),
      decisionActionButton("Solicitar cambio de partida", "category_change_requested", "change"),
      decisionActionButton("Solicitar ajuste presupuestal", "budget_adjustment_requested", "adjust"),
    ].join("");
  }

  return [
    decisionActionButton("Aprobar", "approved", "approve"),
    decisionActionButton("Rechazar", "rejected", "reject"),
    decisionActionButton("Solicitar cambios", "changes_requested", "change"),
  ].join("");
}

function decisionActionButton(label, action, variant) {
  return `<button type="button" class="decision-btn ${variant}" data-action="${escapeHtml(action)}" onclick="decidePaymentRequest('${escapeHtml(currentDetailRequestId)}', '${escapeHtml(action)}')">${escapeHtml(label)}</button>`;
}

function isFinalDecisionStatus(status) {
  return [
    "approved",
    "rejected",
    "changes_requested",
    "scheduled",
    "paid",
    "cancelled",
  ].includes(status);
}

async function loadApprovalHistory(paymentRequestId) {
  const container = document.getElementById("approvalHistoryList");
  if (!container) return;

  const { data, error } = await supabaseClient
    .from("payment_request_approvals")
    .select("id,action,from_status,to_status,comments,approval_level,created_at,actor_profile_id,role_id")
    .eq("payment_request_id", paymentRequestId)
    .order("created_at", { ascending: false });

  if (error) {
    container.innerHTML = `<div class="history-item">No fue posible cargar el historial de decisiones.</div>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = `<div class="history-item">Aún no hay decisiones registradas.</div>`;
    return;
  }

  container.innerHTML = data.map(item => `
    <div class="history-item">
      <strong>${escapeHtml(decisionActionLabel(item.action))}</strong>
      ${escapeHtml(item.comments || "Sin comentario")}
      <span>${escapeHtml(formatDateTime(item.created_at))} · ${escapeHtml(item.from_status || "-")} → ${escapeHtml(item.to_status || "-")}</span>
    </div>
  `).join("");
}

async function decidePaymentRequest(paymentRequestId, action, comments) {
  const request = paymentRequests.find(item => item.id === paymentRequestId);
  if (!request) return;

  const commentBox = document.getElementById("decisionComments");
  const errorBox = document.getElementById("decisionError");
  const cleanComments = String(comments ?? commentBox?.value ?? "").trim();
  const commentRequired = isDecisionCommentRequired(request, action);

  if (errorBox) errorBox.textContent = "";

  if (!currentProfileId) {
    const message = "No se pudo identificar el perfil del usuario para registrar la decisión.";
    if (errorBox) errorBox.textContent = message;
    showToast("Perfil no identificado", message, "error");
    return;
  }

  if (commentRequired && !cleanComments) {
    const message = "Captura un comentario para registrar esta decisión.";
    if (errorBox) errorBox.textContent = message;
    commentBox?.focus();
    return;
  }

  setDecisionButtonsDisabled(true);

  try {
    const { data, error } = await supabaseClient.rpc("decide_payment_request", {
      p_payment_request_id: paymentRequestId,
      p_actor_profile_id: currentProfileId,
      p_action: action,
      p_comments: cleanComments || null,
    });

    if (error) throw error;

    const result = normalizeRpcResult(data);
    showToast(
      "Decisión registrada",
      `${decisionActionLabel(action)} registrada correctamente.`,
      action.includes("reject") || action === "exception_rejected" ? "warning" : "success"
    );

    await loadPaymentRequests();
    const updated = paymentRequests.find(item => item.id === (result.payment_request_id || paymentRequestId));
    if (updated) openRequestDetail(updated.id);
  } catch (error) {
    const message = friendlyDecisionError(error);
    if (errorBox) errorBox.textContent = message;
    showToast("No se pudo registrar la decisión", message, "error");
  } finally {
    setDecisionButtonsDisabled(false);
  }
}

window.decidePaymentRequest = decidePaymentRequest;

function setDecisionButtonsDisabled(disabled) {
  document.querySelectorAll(".decision-btn").forEach(button => {
    button.disabled = disabled;
  });
}

function isDecisionCommentRequired(request, action) {
  if (action === "approved" && !isExceptionRequest(request)) return false;
  return action === "rejected" ||
    action === "changes_requested" ||
    action.startsWith("exception_") ||
    action === "amount_change_requested" ||
    action === "category_change_requested" ||
    action === "budget_adjustment_requested";
}

function decisionActionLabel(action) {
  const labels = {
    approved: "Aprobada",
    rejected: "Rechazada",
    changes_requested: "Cambios solicitados",
    exception_approved: "Excepción autorizada",
    exception_rejected: "Excepción rechazada",
    amount_change_requested: "Cambio de monto solicitado",
    category_change_requested: "Cambio de partida solicitado",
    budget_adjustment_requested: "Ajuste presupuestal solicitado",
  };
  return labels[action] || action || "Decisión";
}

function renderBudgetDecisionBadge(decision, reason = "") {
  if (decision === "aprobable") return Components.badge("Aprobable", "success");
  if (decision === "bloqueado") return Components.badge(reason ? `Excepción: ${escapeHtml(reason)}` : "Excepción", "violet");
  return Components.badge(decision ? escapeHtml(decision) : "Sin validar", "neutral");
}

function renderStatusBadge(status) {
  const map = {
    submitted:          ["Enviada",      "info"],
    approved:           ["Aprobada",     "success"],
    paid:               ["Pagado",       "success"],
    rejected:           ["Rechazada",    "danger"],
    cancelled:          ["Cancelada",    "warning"],
    changes_requested:  ["Con corrección","warning"],
    finance_validation: ["En revisión",  "info"],
    scheduled:          ["Programado",   "info"],
  };
  const [label, variant] = map[status] ?? [escapeHtml(status || "Sin estatus"), "neutral"];
  return Components.badge(label, variant);
}

function updateSummaryPanel() {
  const company = companyById(dom.companyId.value);
  const approver = approverCandidates.find(candidate => candidate.profile_id === dom.approverId?.value);
  const center = costCenterById(dom.costCenterId.value);
  const category = budgetCategoryById(dom.budgetCategoryId.value);
  const availability = availabilityForCategory(dom.budgetCategoryId.value);
  const proveedor = proveedorById(dom.proveedorId.value);
  const amount = numberValue(dom.amountRequested.value);
  const currency = dom.currency?.value || "MXN";

  dom.summaryCompany.textContent = company ? companyName(company) : "Sin seleccionar";
  if (dom.summaryApprover) {
    dom.summaryApprover.textContent = approver
      ? `${approver.display_name || approver.email}${approver.source === "assigned" ? " · Configurado" : " · Por reglas"}`
      : "Sin seleccionar";
  }
  dom.summaryCostCenter.textContent = center ? costCenterName(center) : "Sin seleccionar";
  dom.summaryCategory.textContent = category
    ? `${budgetCategoryLabel(category)} | Disp. ${formatCurrency(getAvailableAmount(availability), "MXN")}`
    : "Sin seleccionar";
  dom.summaryProvider.textContent = proveedor ? proveedorLabel(proveedor) : "Sin seleccionar";
  dom.summaryMonth.textContent = dom.budgetMonth.value ? formatMonth(`${dom.budgetMonth.value}-01`) : "Sin seleccionar";
  dom.summaryAmount.textContent = formatCurrency(amount, currency);
}

function handleCurrencyChange() {
  const isUsd = dom.currency.value === "USD";
  dom.exchangeRateRow?.classList.toggle("hidden", !isUsd);
  if (!isUsd) {
    dom.exchangeRate.value = "1";
  } else if (!dom.exchangeRate.value || Number(dom.exchangeRate.value) <= 0) {
    dom.exchangeRate.value = "1";
  }
  updateSummaryPanel();
}

function handleEditCurrencyChange() {
  const isUsd = dom.editCurrency.value === "USD";
  dom.editExchangeRateRow?.classList.toggle("hidden", !isUsd);
  if (!isUsd) {
    dom.editExchangeRate.value = "1";
  } else if (!dom.editExchangeRate.value || Number(dom.editExchangeRate.value) <= 0) {
    dom.editExchangeRate.value = "1";
  }
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "./index.html";
}

function setDefaultMonth() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  dom.budgetMonth.value = `${yyyy}-${mm}`;
}

function activeRows(rows) {
  return rows.filter(row => row.active !== false && row.activo !== false && row.is_active !== false);
}

function optionPlaceholder(label) {
  return `<option value="">${escapeHtml(label)}</option>`;
}

function resetBudgetCategorySelect(label) {
  dom.budgetCategoryId.disabled = true;
  dom.budgetCategoryId.innerHTML = optionPlaceholder(label);
  if (dom.budgetCategorySearch) { dom.budgetCategorySearch.disabled = true; dom.budgetCategorySearch.value = ""; }
}

// Filtro ligero sobre el <select> de partida: oculta opciones que no matchean.
// No toca el valor ni la validacion (el select nativo sigue igual).
function filterBudgetCategoryOptions(select, query) {
  if (!select) return;
  const q = normalize(query || "");
  Array.from(select.options).forEach((opt) => {
    opt.hidden = q && opt.value ? !normalize(opt.textContent).includes(q) : false;
  });
}

function setBudgetCategoryHelp(message, state = "") {
  if (!dom.budgetCategoryHelp) return;
  dom.budgetCategoryHelp.textContent = message;
  dom.budgetCategoryHelp.classList.remove("success", "warning", "error");
  if (state) dom.budgetCategoryHelp.classList.add(state);
}

function dedupeAvailabilityRows(rows) {
  const byCategory = new Map();

  rows.forEach(row => {
    const categoryId = row.budget_category_id;
    if (!categoryId) return;

    const current = byCategory.get(categoryId);
    if (!current || getAvailableAmount(row) > getAvailableAmount(current)) {
      byCategory.set(categoryId, row);
    }
  });

  return Array.from(byCategory.values());
}

function companyById(id) {
  return companies.find(item => item.id === id) || null;
}

function costCenterById(id) {
  return costCenters.find(item => item.id === id) || null;
}

function budgetCategoryById(id) {
  return budgetCategories.find(item => item.id === id) || null;
}

function proveedorById(id) {
  return proveedores.find(item => item.id === id) || null;
}

function companyName(company) {
  if (!company) return "Sin empresa";
  return company.name || company.legal_name || company.display_name || "Sin nombre";
}

function costCenterName(center) {
  if (!center) return "Sin centro";
  const code = center.code ? `${center.code} - ` : "";
  return `${code}${center.name || center.display_name || "Sin nombre"}`;
}

function budgetCategoryLabel(category) {
  if (!category) return "Sin partida";
  const section = category.category ? ` (${category.category})` : "";
  return `${category.name || "Sin nombre"}${section}`;
}

function budgetCategoryAvailabilityLabel(category, availabilityRow) {
  const categoryLabel = budgetCategoryLabel(category);
  const available = formatCurrency(getAvailableAmount(availabilityRow), "MXN");
  return `${categoryLabel} | Disponible ${available}`;
}

function availabilityForCategory(categoryId) {
  return budgetAvailabilityRows.find(row => row.budget_category_id === categoryId) || null;
}

function getAvailableAmount(row) {
  if (!row) return 0;
  const candidates = [
    row.available_amount,
    row.amount_available,
    row.disponible,
    row.available,
    row.budget_available,
    row.current_available,
    row.remaining_amount,
    row.available_before,
  ];
  const firstNumber = candidates.find(value => value !== null && value !== undefined && value !== "");
  return numberValue(firstNumber);
}

function monthInputToDate(value) {
  return value ? `${value}-01` : null;
}

function proveedorAlias(proveedor) {
  if (!proveedor) return "Sin proveedor";
  return proveedor.alias || proveedor.nombre_completo || "Sin alias";
}

function proveedorName(proveedor) {
  if (!proveedor) return "";
  return proveedor.nombre_completo || proveedor.alias || "";
}

function proveedorLabel(proveedor) {
  if (!proveedor) return "Sin proveedor";
  const alias = proveedor.alias || proveedor.nombre_completo || "Proveedor";
  const name = proveedor.nombre_completo && proveedor.nombre_completo !== alias ? ` - ${proveedor.nombre_completo}` : "";
  const rfc = proveedor.rfc ? ` | RFC ${proveedor.rfc}` : "";
  const bank = proveedor.banco ? ` | ${proveedor.banco}` : "";
  return `${alias}${name}${rfc}${bank}`;
}

function detailCard(label, value, isHtml = false, extraClass = "") {
  return `
    <div class="detail-card ${extraClass}">
      <span>${escapeHtml(label)}</span>
      <strong>${isHtml ? value : escapeHtml(value)}</strong>
    </div>`;
}

function normalizeRpcResult(data) {
  if (Array.isArray(data)) return data[0] || {};
  return data || {};
}

function formatCurrency(value, currency = "MXN") {
  const amount = numberValue(value);
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch (_) {
    return `$${amount.toFixed(2)} ${currency || "MXN"}`;
  }
}

function compactCurrency(value) {
  const amount = numberValue(value);
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch (_) {
    return `$${Math.round(amount).toLocaleString("es-MX")}`;
  }
}

function formatDate(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatMonth(value) {
  if (!value) return "Sin mes";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Sin mes";
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(date);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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
  const variantMap = { success: "success", error: "danger", warning: "warning", info: "info" };
  Components.showToast({ title: escapeHtml(title), desc: escapeHtml(message), variant: variantMap[type] ?? "info", duration: 6 });
}

function friendlyError(error, operation = "") {
  const message = error?.message || String(error || "Error desconocido");
  const routingErrors = {
    company_scope_required: "Tu perfil no tiene membresía activa en la empresa seleccionada.",
    approver_id_required: "Selecciona quién revisará esta solicitud.",
    approver_assignment_id_required: "Selecciona uno de los aprobadores configurados para ti.",
    approver_assignment_not_allowed_without_pool: "La opción elegida ya no corresponde al origen disponible. Vuelve a cargar los aprobadores.",
    approver_assignment_not_active: "El aprobador configurado fue desactivado. Selecciona otra opción.",
    approver_assignment_snapshot_mismatch: "La opción seleccionada no coincide con la empresa o el solicitante.",
    approver_not_in_configured_pool: "El aprobador ya no pertenece a tu lista configurada.",
    approver_must_come_from_configured_pool: "Debes elegir un aprobador de tu lista configurada.",
    approver_not_allowed_by_approval_rules: "El aprobador ya no cumple las reglas para esta empresa, centro de costo y monto.",
    configured_approver_no_longer_eligible: "El aprobador configurado ya no tiene membresía o rol elegible.",
    approver_not_eligible_for_company: "El aprobador ya no es elegible para esta empresa.",
    requester_company_membership_required: "El solicitante no tiene membresía activa en la empresa.",
    requester_cannot_be_own_approver: "El solicitante no puede aprobar su propia solicitud.",
  };
  const routingKey = Object.keys(routingErrors).find(key => message.includes(key));
  if (routingKey) return routingErrors[routingKey];
  if (message.toLowerCase().includes("row-level security") || error?.code === "42501") {
    return `${operation ? `${operation}: ` : ""}la operacion fue bloqueada por RLS. Revisa policies para usuarios autenticados.`;
  }
  if (message.toLowerCase().includes("permission denied")) {
    return `${operation ? `${operation}: ` : ""}faltan permisos para ejecutar la operacion.`;
  }
  return message;
}

function friendlyDecisionError(error) {
  const message = error?.message || String(error || "Error desconocido");
  const known = {
    payment_request_not_found: "No se encontró la solicitud.",
    actor_profile_not_found: "No se pudo identificar el perfil del usuario para registrar la decisión.",
    invalid_action: "La acción seleccionada no es válida.",
    comments_required_for_exception_action: "El comentario es obligatorio para decisiones de excepción.",
    comments_required_for_changes_requested: "El comentario es obligatorio para solicitar cambios.",
    exception_action_not_allowed_for_approvable_request: "Esta solicitud es aprobable; no admite una acción de excepción.",
    normal_approval_not_allowed_for_budget_exception: "Una excepción presupuestal no puede aprobarse como solicitud normal.",
    invalid_exception_action: "La acción no es válida para una excepción presupuestal.",
    actor_has_no_role: "Tu usuario no tiene un rol asignado para decidir solicitudes.",
    approval_rule_not_found: "No existe una regla de aprobación activa para tu rol, monto y alcance.",
    actor_cannot_approve: "Tu rol no tiene permiso para aprobar esta solicitud.",
    actor_cannot_approve_exception: "Tu rol no tiene permiso para autorizar excepciones presupuestales.",
    actor_cannot_reject: "Tu rol no tiene permiso para rechazar esta solicitud.",
    actor_cannot_request_changes: "Tu rol no tiene permiso para solicitar cambios.",
    actor_cannot_request_budget_adjustment: "Tu rol no tiene permiso para solicitar ajuste presupuestal.",
    selected_approver_only: "Solo el aprobador seleccionado para esta solicitud puede registrar la decisión.",
    approver_assignment_snapshot_invalid: "No se pudo validar el origen administrativo del aprobador seleccionado.",
    selected_approver_cannot_approve: "El aprobador seleccionado ya no cumple la regla para aprobar esta solicitud.",
    selected_approver_cannot_approve_exception: "El aprobador seleccionado no puede autorizar esta excepción.",
    selected_approver_cannot_reject: "El aprobador seleccionado no cumple la regla para rechazar esta solicitud.",
    selected_approver_cannot_request_changes: "El aprobador seleccionado no cumple la regla para solicitar cambios.",
    selected_approver_cannot_request_budget_adjustment: "El aprobador seleccionado no puede solicitar este ajuste presupuestal.",
    actor_profile_must_match_current_profile: "La sesión no coincide con el perfil que intenta decidir.",
  };

  const key = Object.keys(known).find(item => message.includes(item));
  if (key) return known[key];
  return friendlyError(error, "decide_payment_request");
}

function rlsHint(table, operation, error) {
  const message = error?.message || "";
  if (message.toLowerCase().includes("row-level security") || error?.code === "42501" || message.toLowerCase().includes("permission denied")) {
    return `Operacion ${operation} bloqueada por RLS en ${table}; haria falta una policy para usuarios autenticados.`;
  }
  return message;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
