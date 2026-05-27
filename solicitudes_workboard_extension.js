;(function solicitudesWorkboardExtension() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase();
  if (pageName !== "solicitudes.html") return;

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  if (!client) return;

  const state = {
    requests: [],
    providers: [],
    companies: [],
    centers: [],
    categories: [],
    accounts: [],
    layoutLines: [],
    layouts: [],
    cashFunds: [],
    view: "attention",
    loading: false,
  };

  const views = {
    attention: "Por atender",
    approval: "Pendientes de aprobacion",
    ready: "Listas para operar",
    operation: "En operacion",
    history: "Historico / Cerradas",
    all: "Todas",
    manual: "Vista filtrada",
  };

  const requestTypeLabels = {
    provider_payment: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    reimbursement: "Reembolso",
    deposit_refund: "Devolucion de deposito",
    other: "Otro",
  };

  const statusLabels = {
    submitted: "Pendiente de aprobacion",
    pending_approval: "Pendiente de aprobacion",
    approved: "Aprobada",
    changes_requested: "Correccion requerida",
    finance_validation: "Validacion financiera",
    scheduled: "Programada",
    paid: "Pagada",
    rejected: "Rechazada",
    cancelled: "Cancelada",
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  async function init() {
    injectStyles();
    reframeCards();
    ensureTypeHeader();
    bindEvents();
    await loadData();
    observeDetailLayoutReadiness();
    render();
    window.setTimeout(render, 1200);
    window.setTimeout(render, 3200);
  }

  function reframeCards() {
    setCard("totalCard", "Por atender", "totalRequests", "attention");
    setCard("approvableCard", "Pendientes de aprobacion", "approvableRequests", "approval");
    setCard("exceptionsCard", "Listas para operar", "blockedRequests", "ready");
    setCard("paidCard", "En operacion", "paidRequests", "operation");

    const amountCard = document.getElementById("requestedAmount")?.closest(".stat-card");
    if (amountCard) {
      amountCard.id = "historyCard";
      amountCard.dataset.workboardView = "history";
      amountCard.classList.add("is-clickable", "workboard-card");
      amountCard.setAttribute("role", "button");
      amountCard.tabIndex = 0;
      const label = amountCard.querySelector("p");
      const value = amountCard.querySelector("strong");
      if (label) label.textContent = "Historico / Cerradas";
      if (value) value.textContent = "0";
    }

    const statusFilter = document.getElementById("statusFilter");
    if (statusFilter && !statusFilter.querySelector('option[value="pending_approval"]')) {
      statusFilter.insertAdjacentHTML("beforeend", '<option value="pending_approval">Pending approval</option>');
    }
  }

  function setCard(cardId, label, valueId, view) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.dataset.workboardView = view;
    card.classList.add("workboard-card");
    if (view === "ready") {
      card.classList.remove("blocked");
      card.classList.add("ready");
    }
    const labelNode = card.querySelector("p");
    if (labelNode) labelNode.textContent = label;
    const valueNode = document.getElementById(valueId);
    if (valueNode) valueNode.textContent = "0";
  }

  function ensureTypeHeader() {
    const headerRow = document.querySelector("thead tr");
    if (!headerRow) return;
    const headers = Array.from(headerRow.children).map((cell) => normalize(cell.textContent));
    if (headers.includes("tipo")) return;
    const folioHeader = headerRow.children[0];
    if (!folioHeader) return;
    folioHeader.insertAdjacentHTML("afterend", "<th>Tipo</th>");
  }

  function bindEvents() {
    document.querySelectorAll("[data-workboard-view]").forEach((card) => {
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        state.view = card.dataset.workboardView || "attention";
        clearSelectFilters();
        render();
      }, true);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          card.click();
        }
      }, true);
    });

    document.getElementById("clearFiltersBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      state.view = "all";
      clearSelectFilters();
      render();
    }, true);

    ["searchInput", "statusFilter", "budgetDecisionFilter", "companyFilter"].forEach((id) => {
      document.getElementById(id)?.addEventListener("input", () => {
        state.view = "manual";
        render();
      });
      document.getElementById(id)?.addEventListener("change", () => {
        state.view = "manual";
        render();
      });
    });
  }

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    try {
      const [
        requests,
        providers,
        companies,
        centers,
        categories,
        accounts,
        lines,
        layouts,
        cashFunds,
      ] = await Promise.all([
        client.from("payment_requests").select("id,request_number,request_type,status,budget_decision,budget_block_reason,is_extraordinary_adjustment,exception_status,exception_action,amount_requested,currency,submitted_at,created_at,proveedor_id,company_id,cost_center_id,budget_category_id,budget_month,description,notes").order("created_at", { ascending: false }),
        client.from("proveedores").select("id,alias,nombre_completo,beneficiary_name,destination_type,clabe,cuenta_bancaria,convenio_number"),
        client.from("companies").select("id,name,legal_name"),
        client.from("cost_centers").select("id,code,name"),
        client.from("budget_categories").select("id,code,name"),
        client.from("company_bank_accounts").select("id,company_id,name,bank_name,account_number,last4,active"),
        client.from("payment_layout_lines").select("id,payment_request_id,layout_id,status"),
        client.from("payment_layouts").select("id,status,layout_number"),
        client.from("cash_funds").select("id,payment_request_id,status,pending_amount"),
      ]);

      [requests, providers, companies, centers, categories, accounts, lines, layouts, cashFunds].forEach((result) => {
        if (result.error) throw result.error;
      });

      state.requests = requests.data || [];
      state.providers = providers.data || [];
      state.companies = companies.data || [];
      state.centers = centers.data || [];
      state.categories = categories.data || [];
      state.accounts = (accounts.data || []).filter((item) => item.active !== false);
      state.layoutLines = lines.data || [];
      state.layouts = layouts.data || [];
      state.cashFunds = cashFunds.data || [];
    } catch (error) {
      console.warn("No se pudo cargar bandeja operativa", error);
    } finally {
      state.loading = false;
    }
  }

  function observeDetailLayoutReadiness() {
    const target = document.getElementById("detailContent");
    if (!target) return;
    const observer = new MutationObserver(() => window.setTimeout(appendLayoutReadinessSection, 140));
    observer.observe(target, { childList: true, subtree: false });
  }

  async function appendLayoutReadinessSection() {
    const target = document.getElementById("detailContent");
    if (!target || target.querySelector("[data-layout-readiness-extension]")) return;

    const requestNumber = document.getElementById("detailTitle")?.textContent?.trim();
    const request = state.requests.find((item) => item.request_number === requestNumber);
    if (!request || isCashOrCheck(request)) return;
    if (/Preparacion para layout/i.test(target.textContent)) return;

    const freshRequest = await fetchRequestForLayout(request.id);
    if (!freshRequest) return;
    Object.assign(request, freshRequest);

    const section = document.createElement("section");
    section.className = "decision-card layout-readiness-card";
    section.dataset.layoutReadinessExtension = "true";
    section.innerHTML = renderLayoutReadinessSection(request);

    const decisionPanel = Array.from(target.children).find((node) => /Decision del aprobador/i.test(node.textContent || ""));
    if (decisionPanel) target.insertBefore(section, decisionPanel);
    else target.appendChild(section);

    section.querySelector("[data-open-layout-data]")?.addEventListener("click", () => openLayoutDataEditor(request.id));
    section.querySelector("[data-edit-provider]")?.addEventListener("click", () => window.open("./proveedores.html", "_blank", "noopener"));
  }

  async function fetchRequestForLayout(requestId) {
    const { data, error } = await client
      .from("payment_requests")
      .select("id,request_number,request_type,status,company_id,proveedor_id,company_bank_account_id,scheduled_payment_date,payment_reference,payment_concept")
      .eq("id", requestId)
      .maybeSingle();
    if (error) {
      console.warn("No se pudo cargar datos de layout de solicitud", error);
      return null;
    }
    return data;
  }

  function renderLayoutReadinessSection(request) {
    const items = layoutReadinessItems(request);
    const missing = items.filter((item) => !item.complete);
    const canEdit = !["paid", "cancelled"].includes(request.status);
    return `
      <div class="layout-card-header">
        <div>
          <span class="section-kicker">Preparacion para layout</span>
          <h3>${missing.length ? "Faltan datos para generar el layout" : "Lista para layout de pago"}</h3>
          <p>Cada solicitud conserva su propia cuenta origen. El layout solo agrupa solicitudes que ya tienen datos completos.</p>
        </div>
        <span class="layout-count ${missing.length ? "warning" : "success"}">${missing.length ? `${missing.length} pendientes` : "Completo"}</span>
      </div>
      <div class="layout-checklist">
        ${items.map((item) => `
          <div class="layout-checkitem ${item.complete ? "complete" : "missing"}">
            <div class="layout-checktext">
              <strong>${escapeHtml(item.label)}</strong>
              ${item.complete ? "" : `<small>${escapeHtml(item.message)}</small>`}
            </div>
            <span class="layout-state ${item.complete ? "complete" : "missing"}">${item.complete ? "Completo" : "Faltante"}</span>
          </div>
        `).join("")}
      </div>
      ${(canEdit || missing.some((item) => item.source === "provider")) ? `<div class="decision-actions">
        ${canEdit ? '<button type="button" class="decision-btn approve" data-open-layout-data>Completar datos para layout</button>' : ""}
        ${missing.some((item) => item.source === "provider") ? '<button type="button" class="decision-btn change" data-edit-provider>Editar proveedor</button>' : ""}
      </div>` : ""}
    `;
  }

  function layoutReadinessItems(request) {
    const provider = findById(state.providers, request.proveedor_id);
    const account = findById(state.accounts, request.company_bank_account_id);
    const destination = providerDestinationValue(provider);
    const beneficiary = provider?.beneficiary_name || provider?.nombre_completo || provider?.alias || "";
    return [
      { source: "request", label: "Cuenta origen seleccionada", complete: Boolean(request.company_bank_account_id), message: "Falta seleccionar cuenta origen en la solicitud." },
      { source: "account", label: "Numero de cuenta origen", complete: Boolean(account?.account_number), message: "La cuenta origen seleccionada no tiene numero de cuenta capturado." },
      { source: "provider", label: "Tipo de destino del proveedor", complete: Boolean(provider?.destination_type), message: "Falta definir tipo de destino de pago en el proveedor." },
      { source: "provider", label: "Destino de pago del proveedor", complete: Boolean(destination), message: providerDestinationMissingMessage(provider) },
      { source: "provider", label: "Beneficiario", complete: Boolean(beneficiary), message: "Falta beneficiario para layout en el proveedor." },
      { source: "request", label: "Fecha programada de pago", complete: Boolean(request.scheduled_payment_date), message: "Falta fecha programada de pago en la solicitud." },
      { source: "request", label: "Referencia de pago", complete: Boolean(request.payment_reference), message: "Falta referencia de pago en la solicitud." },
      { source: "request", label: "Concepto de pago", complete: Boolean(request.payment_concept), message: "Falta concepto de pago en la solicitud." },
    ];
  }

  function providerDestinationValue(provider) {
    if (!provider) return "";
    if (provider.destination_type === "clabe") return provider.clabe || "";
    if (provider.destination_type === "cuenta") return provider.cuenta_bancaria || "";
    if (provider.destination_type === "convenio") return provider.convenio_number || "";
    return "";
  }

  function providerDestinationMissingMessage(provider) {
    if (!provider?.destination_type) return "Falta definir tipo de destino de pago del proveedor: CLABE, cuenta o convenio.";
    if (provider.destination_type === "clabe") return "El proveedor esta configurado para CLABE, pero no tiene CLABE capturada.";
    if (provider.destination_type === "cuenta") return "El proveedor esta configurado para cuenta bancaria, pero no tiene cuenta capturada.";
    if (provider.destination_type === "convenio") return "El proveedor esta configurado para convenio, pero no tiene numero de convenio.";
    return "Falta destino de pago del proveedor.";
  }

  function ensureLayoutDataDialog() {
    if (document.getElementById("layoutDataExtensionDialog")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="layoutDataExtensionDialog">
        <form id="layoutDataExtensionForm" class="modal-content">
          <div class="modal-header">
            <div>
              <h2>Datos para layout de pago</h2>
              <p>Completa la informacion necesaria para incluir esta solicitud en un archivo de pago.</p>
            </div>
            <button type="button" id="closeLayoutDataExtensionBtn" class="icon-btn" aria-label="Cerrar">x</button>
          </div>
          <div class="form-grid">
            <label class="full-row">Cuenta origen
              <select id="layoutDataAccountId" class="form-control"></select>
              <span class="field-hint">La cuenta origen es de la empresa que paga, no del proveedor.</span>
            </label>
            <label>Fecha programada de pago
              <input id="layoutDataScheduledDate" class="form-control" type="date">
            </label>
            <label>Referencia de pago
              <input id="layoutDataReference" class="form-control" type="text" placeholder="Ej. FACTURA 123, RECIBO MAYO...">
            </label>
            <label class="full-row">Concepto de pago
              <input id="layoutDataConcept" class="form-control" type="text" placeholder="Ej. Mantenimiento mayo, servicio CFE...">
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" id="cancelLayoutDataExtensionBtn" class="secondary-btn">Cancelar</button>
            <button type="submit" id="saveLayoutDataExtensionBtn" class="primary-btn">Guardar datos de layout</button>
          </div>
        </form>
      </dialog>
    `);
    document.getElementById("closeLayoutDataExtensionBtn").addEventListener("click", closeLayoutDataEditor);
    document.getElementById("cancelLayoutDataExtensionBtn").addEventListener("click", closeLayoutDataEditor);
    document.getElementById("layoutDataExtensionForm").addEventListener("submit", saveLayoutDataEditor);
  }

  let activeLayoutRequestId = null;

  async function openLayoutDataEditor(requestId) {
    ensureLayoutDataDialog();
    activeLayoutRequestId = requestId;
    const request = await fetchRequestForLayout(requestId);
    if (!request) return;
    Object.assign(state.requests.find((item) => item.id === requestId) || {}, request);
    renderAccountOptions(request);
    document.getElementById("layoutDataScheduledDate").value = request.scheduled_payment_date || "";
    document.getElementById("layoutDataReference").value = request.payment_reference || "";
    document.getElementById("layoutDataConcept").value = request.payment_concept || "";
    document.getElementById("layoutDataExtensionDialog").showModal();
  }

  function closeLayoutDataEditor() {
    activeLayoutRequestId = null;
    document.getElementById("layoutDataExtensionDialog")?.close();
  }

  function renderAccountOptions(request) {
    const select = document.getElementById("layoutDataAccountId");
    if (!select) return;
    const companyAccounts = state.accounts.filter((account) => account.company_id === request.company_id);
    const options = companyAccounts.length ? companyAccounts : state.accounts;
    select.innerHTML = '<option value="">Seleccionar cuenta origen</option>' + options.map((account) => {
      const label = [account.account_number || "Sin numero", account.name, account.bank_name].filter(Boolean).join(" - ");
      return `<option value="${escapeHtml(account.id)}">${escapeHtml(label)}</option>`;
    }).join("");
    select.value = request.company_bank_account_id || "";
  }

  async function saveLayoutDataEditor(event) {
    event.preventDefault();
    if (!activeLayoutRequestId) return;
    const button = document.getElementById("saveLayoutDataExtensionBtn");
    button.disabled = true;
    button.textContent = "Guardando...";
    try {
      const payload = {
        company_bank_account_id: document.getElementById("layoutDataAccountId").value || null,
        scheduled_payment_date: document.getElementById("layoutDataScheduledDate").value || null,
        payment_reference: document.getElementById("layoutDataReference").value.trim() || null,
        payment_concept: document.getElementById("layoutDataConcept").value.trim() || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await client.from("payment_requests").update(payload).eq("id", activeLayoutRequestId);
      if (error) throw error;
      toast("Datos actualizados", "Datos de layout actualizados correctamente.", "success");
      closeLayoutDataEditor();
      await loadData();
      document.querySelector("[data-layout-readiness-extension]")?.remove();
      appendLayoutReadinessSection();
      render();
    } catch (error) {
      toast("No se pudieron guardar los datos", friendlyError(error), "error");
    } finally {
      button.disabled = false;
      button.textContent = "Guardar datos de layout";
    }
  }

  function render() {
    if (!state.requests.length) return;
    renderStats();
    renderFilterState();
    renderTable();
  }

  function renderStats() {
    setValue("totalRequests", countByView("attention"));
    setValue("approvableRequests", countByView("approval"));
    setValue("blockedRequests", countByView("ready"));
    setValue("paidRequests", countByView("operation"));
    setValue("requestedAmount", countByView("history"));
  }

  function renderFilterState() {
    document.querySelectorAll("[data-workboard-view]").forEach((card) => {
      card.classList.toggle("active-filter", card.dataset.workboardView === state.view);
    });

    const summary = document.getElementById("filterSummary");
    const summaryText = document.getElementById("filterSummaryText");
    if (!summary || !summaryText) return;

    if (state.view === "all") {
      summary.classList.add("hidden");
      summaryText.textContent = "Vista filtrada";
      return;
    }

    summary.classList.remove("hidden");
    summaryText.textContent = `Vista filtrada: ${views[state.view] || views.manual}`;
  }

  function renderTable() {
    const tbody = document.getElementById("requestsTableBody");
    if (!tbody) return;
    ensureTypeHeader();

    const rows = state.requests.filter((request) => matchesView(request) && matchesUiFilters(request));

    if (!rows.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="12">
            <div class="empty-state">
              <strong>No hay solicitudes para esta vista.</strong>
              Cambia el filtro o usa Ver todas para consultar el historico completo.
            </div>
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = rows.map((request) => {
      const provider = findById(state.providers, request.proveedor_id);
      const company = findById(state.companies, request.company_id);
      const center = findById(state.centers, request.cost_center_id);
      const category = findById(state.categories, request.budget_category_id);
      return `
        <tr>
          <td><strong>${escapeHtml(request.request_number || "Sin folio")}</strong>${request.is_extraordinary_adjustment ? '<span class="badge badge-extra">Ajuste extraordinario</span>' : ""}</td>
          <td>${renderTypeBadge(request)}</td>
          <td>${escapeHtml(formatDate(request.submitted_at || request.created_at))}</td>
          <td><strong>${escapeHtml(provider?.alias || provider?.nombre_completo || "Sin proveedor")}</strong><span class="muted-line">${escapeHtml(provider?.nombre_completo || "")}</span></td>
          <td>${escapeHtml(company?.legal_name || company?.name || "Sin empresa")}</td>
          <td>${escapeHtml(center?.name || center?.code || "Sin centro")}</td>
          <td><strong>${escapeHtml(category?.code || "")}</strong><span class="muted-line">${escapeHtml(category?.name || "Sin partida")}</span></td>
          <td>${escapeHtml(formatMonth(request.budget_month))}</td>
          <td><strong>${escapeHtml(formatCurrency(request.amount_requested, request.currency || "MXN"))}</strong></td>
          <td>${renderOperationalBadge(request)}</td>
          <td>${renderBudgetBadge(request)}</td>
          <td><div class="actions"><button class="small-btn" type="button" onclick="openRequestDetail('${escapeHtml(request.id)}')">Ver detalle</button></div></td>
        </tr>`;
    }).join("");
  }

  function matchesView(request) {
    if (state.view === "all") return true;
    if (state.view === "attention") return isAttention(request);
    if (state.view === "approval") return isPendingApproval(request);
    if (state.view === "ready") return isReadyToOperate(request);
    if (state.view === "operation") return isInOperation(request);
    if (state.view === "history") return isHistorical(request);
    return true;
  }

  function matchesUiFilters(request) {
    const search = normalize(document.getElementById("searchInput")?.value || "");
    const status = document.getElementById("statusFilter")?.value || "todos";
    const budget = document.getElementById("budgetDecisionFilter")?.value || "todos";
    const companyFilter = document.getElementById("companyFilter")?.value || "todos";

    if (state.view !== "manual") return true;

    const provider = findById(state.providers, request.proveedor_id);
    const company = findById(state.companies, request.company_id);
    const searchable = normalize([
      request.request_number,
      request.description,
      request.notes,
      provider?.alias,
      provider?.nombre_completo,
      company?.legal_name,
      company?.name,
    ].join(" "));

    const budgetMatches = budget === "todos" ||
      (budget === "excepciones" ? isBudgetException(request) : request.budget_decision === budget);

    return searchable.includes(search) &&
      (status === "todos" || status === "activas" || request.status === status) &&
      budgetMatches &&
      (companyFilter === "todos" || request.company_id === companyFilter);
  }

  function countByView(view) {
    return state.requests.filter((request) => {
      const previous = state.view;
      state.view = view;
      const result = matchesView(request);
      state.view = previous;
      return result;
    }).length;
  }

  function isAttention(request) {
    if (isHistorical(request)) return false;
    if (isCorrectionRequired(request)) return true;
    if (isCashOrCheck(request) && cashFundFor(request)) return false;
    if (isProviderPayment(request) && hasLayoutLine(request)) return false;
    return isPendingApproval(request) ||
      request.status === "changes_requested" ||
      request.status === "finance_validation" ||
      isReadyToOperate(request);
  }

  function isPendingApproval(request) {
    return request.status === "submitted" || request.status === "pending_approval";
  }

  function isReadyToOperate(request) {
    if (request.status !== "approved") return false;
    return isCashOrCheck(request) ? !cashFundFor(request) : !hasLayoutLine(request);
  }

  function isInOperation(request) {
    if (isHistorical(request)) return false;
    if (isCorrectionRequired(request)) return false;
    if (isCashOrCheck(request)) {
      const fund = cashFundFor(request);
      return Boolean(fund && ["active", "pending_receipt", "blocked", "receipt_review"].includes(fund.status));
    }
    return hasLayoutLine(request) || request.status === "finance_validation" || request.status === "scheduled";
  }

  function isHistorical(request) {
    if (["paid", "rejected", "cancelled"].includes(request.status)) return true;
    return isCashOrCheck(request) && cashFundFor(request)?.status === "closed";
  }

  function renderOperationalBadge(request) {
    const stateInfo = operationalState(request);
    return `<span class="badge ${stateInfo.className}">${escapeHtml(stateInfo.label)}</span>`;
  }

  function operationalState(request) {
    if (isCorrectionRequired(request)) {
      return { label: correctionLabel(request), className: "badge-warning" };
    }

    if (isCashOrCheck(request)) {
      const fund = cashFundFor(request);
      if (fund?.status === "closed") return { label: "Fondo cerrado", className: "badge-success" };
      if (fund?.status === "receipt_review") return { label: "Comprobacion en revision", className: "badge-info" };
      if (fund?.status === "pending_receipt") return { label: "Pendiente de comprobar", className: "badge-warning" };
      if (fund?.status === "blocked") return { label: "Bloqueado por comprobacion", className: "badge-danger" };
      if (fund?.status === "active") return { label: "Fondo activo", className: "badge-info" };
      if (request.status === "approved") return { label: request.request_type === "check" ? "Cheque pendiente de registrar" : "Fondo pendiente de registrar", className: "badge-warning" };
    }

    if (request.status === "paid") return { label: "Pagada", className: "badge-success" };
    if (request.status === "rejected") return { label: "Rechazada", className: "badge-danger" };
    if (request.status === "cancelled") return { label: "Cancelada", className: "badge-neutral" };
    if (request.status === "changes_requested") return { label: "Correccion requerida", className: "badge-warning" };
    if (isPendingApproval(request)) return { label: "Pendiente de aprobacion", className: "badge-info" };
    if (hasLayoutLine(request)) return { label: layoutLabel(request), className: "badge-info" };
    if (request.status === "approved") return { label: "Aprobada sin layout", className: "badge-warning" };
    return { label: statusLabels[request.status] || request.status || "Sin estatus", className: "badge-neutral" };
  }

  function layoutLabel(request) {
    const line = layoutLineFor(request);
    const layout = findById(state.layouts, line?.layout_id);
    if (!layout) return "En layout";
    if (layout.status === "confirmed") return "Layout confirmado";
    if (layout.status === "uploaded") return "Layout subido";
    if (layout.status === "generated") return "Layout generado";
    if (layout.status === "draft") return "En layout";
    return "En layout";
  }

  function renderTypeBadge(request) {
    const type = request.request_type || "provider_payment";
    const className = type === "cash" ? "badge-warning" : type === "check" ? "badge-extra" : "badge-neutral";
    return `<span class="badge ${className}">${escapeHtml(requestTypeLabels[type] || type)}</span>`;
  }

  function renderBudgetBadge(request) {
    if (request.budget_decision === "aprobable") return '<span class="badge badge-success">Aprobable</span>';
    if (request.budget_decision === "bloqueado") {
      return `<span class="badge badge-danger">Excepcion: ${escapeHtml(request.budget_block_reason || "revision")}</span>`;
    }
    return '<span class="badge badge-neutral">Sin validacion</span>';
  }

  function toast(title, message, type = "success") {
    const stack = document.getElementById("toastStack");
    if (!stack) return window.alert(`${title}\n${message}`);
    const node = document.createElement("div");
    node.className = `toast ${type}`;
    node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
    stack.appendChild(node);
    window.setTimeout(() => node.remove(), 5500);
  }

  function friendlyError(error) {
    const message = error?.message || String(error || "Error desconocido");
    if (message.toLowerCase().includes("row-level security") || error?.code === "42501") {
      return "No se pudo guardar por permisos. Puede faltar permiso update sobre payment_requests.";
    }
    return message;
  }

  function clearSelectFilters() {
    setSelect("statusFilter", "todos");
    setSelect("budgetDecisionFilter", "todos");
    setSelect("companyFilter", "todos");
    const search = document.getElementById("searchInput");
    if (search) search.value = "";
  }

  function setSelect(id, value) {
    const select = document.getElementById(id);
    if (select) select.value = value;
  }

  function setValue(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function isProviderPayment(request) {
    return !isCashOrCheck(request);
  }

  function isCashOrCheck(request) {
    return request.request_type === "cash" || request.request_type === "check";
  }

  function isBudgetException(request) {
    return request.budget_decision === "bloqueado" || request.is_extraordinary_adjustment === true;
  }

  function isCorrectionRequired(request) {
    return request.status === "changes_requested" ||
      request.exception_status === "changes_requested" ||
      ["amount_change_requested", "category_change_requested", "budget_adjustment_requested"].includes(request.exception_action);
  }

  function correctionLabel(request) {
    const labels = {
      amount_change_requested: "Cambio de monto solicitado",
      category_change_requested: "Cambio de partida solicitado",
      budget_adjustment_requested: "Ajuste presupuestal solicitado",
    };
    return labels[request.exception_action] || "Correccion requerida";
  }

  function cashFundFor(request) {
    return state.cashFunds.find((fund) => fund.payment_request_id === request.id);
  }

  function layoutLineFor(request) {
    return state.layoutLines.find((line) => {
      const layout = findById(state.layouts, line.layout_id);
      return line.payment_request_id === request.id && layout?.status !== "cancelled";
    });
  }

  function hasLayoutLine(request) {
    return Boolean(layoutLineFor(request));
  }

  function findById(list, id) {
    return list.find((item) => item.id === id);
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function formatDate(value) {
    if (!value) return "Sin fecha";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function formatMonth(value) {
    if (!value) return "Sin mes";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return "Sin mes";
    return new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" }).format(date);
  }

  function formatCurrency(value, currency) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN", maximumFractionDigits: 2 }).format(Number(value || 0));
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
    if (document.getElementById("workboardSolicitudesStyles")) return;
    const style = document.createElement("style");
    style.id = "workboardSolicitudesStyles";
    style.textContent = `
      .workboard-card { cursor: pointer; }
      .workboard-card:hover { border-color: var(--border-strong); transform: translateY(-1px); }
      .workboard-card.active-filter { border-color: rgba(94,234,212,.38); box-shadow: 0 0 0 3px var(--accent-dim); }
      .stat-card.ready::after { background: linear-gradient(90deg, var(--amber), transparent 55%); }
      .stat-card.ready strong { color: var(--amber); }
      .badge-success { background: var(--emerald-dim); color: var(--emerald); }
      .badge-danger { background: var(--ruby-dim); color: var(--ruby); }
      .badge-warning { background: var(--amber-dim); color: var(--amber); }
      .badge-info { background: var(--sky-dim); color: var(--sky); }
      .badge-neutral { background: var(--bg-hover); color: var(--text-2); border: 1px solid var(--border); }
      .layout-readiness-card { margin-top: 12px; }
      .layout-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
      .layout-card-header h3 { margin: 4px 0 6px; color: var(--text-1); font-size: 15px; }
      .layout-card-header p { color: var(--text-3); font-size: 12.5px; }
      .section-kicker { display: block; color: var(--text-3); font-size: 10.5px; font-weight: 800; letter-spacing: .65px; text-transform: uppercase; }
      .layout-count { flex-shrink: 0; border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 800; }
      .layout-count.warning { background: var(--amber-dim); color: var(--amber); border: 1px solid rgba(245,158,11,.28); }
      .layout-count.success { background: var(--emerald-dim); color: var(--emerald); border: 1px solid rgba(18,183,106,.28); }
      .layout-checklist { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .layout-checkitem { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 72px; border: 1px solid var(--border); border-radius: 12px; padding: 13px; background: rgba(255,255,255,.015); }
      .layout-checkitem.complete { border-color: rgba(18,183,106,.22); }
      .layout-checkitem.missing { border-color: rgba(224,62,82,.28); }
      .layout-checktext strong { display: block; color: var(--text-1); font-size: 13px; }
      .layout-checktext small { display: block; margin-top: 4px; color: var(--ruby); font-size: 12px; line-height: 1.35; }
      .layout-state { flex-shrink: 0; border-radius: 999px; padding: 6px 10px; font-size: 11px; font-weight: 800; }
      .layout-state.complete { color: var(--emerald); background: var(--emerald-dim); border: 1px solid rgba(18,183,106,.24); }
      .layout-state.missing { color: var(--ruby); background: var(--ruby-dim); border: 1px solid rgba(224,62,82,.28); }
      @media (max-width: 760px) { .layout-card-header, .layout-checkitem { align-items: stretch; flex-direction: column; } .layout-checklist { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }
})();
