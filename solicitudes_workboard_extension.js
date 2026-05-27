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
        lines,
        layouts,
        cashFunds,
      ] = await Promise.all([
        client.from("payment_requests").select("id,request_number,request_type,status,budget_decision,budget_block_reason,is_extraordinary_adjustment,amount_requested,currency,submitted_at,created_at,proveedor_id,company_id,cost_center_id,budget_category_id,budget_month,description,notes").order("created_at", { ascending: false }),
        client.from("proveedores").select("id,alias,nombre_completo"),
        client.from("companies").select("id,name,legal_name"),
        client.from("cost_centers").select("id,code,name"),
        client.from("budget_categories").select("id,code,name"),
        client.from("payment_layout_lines").select("id,payment_request_id,layout_id,status"),
        client.from("payment_layouts").select("id,status,layout_number"),
        client.from("cash_funds").select("id,payment_request_id,status,pending_amount"),
      ]);

      [requests, providers, companies, centers, categories, lines, layouts, cashFunds].forEach((result) => {
        if (result.error) throw result.error;
      });

      state.requests = requests.data || [];
      state.providers = providers.data || [];
      state.companies = companies.data || [];
      state.centers = centers.data || [];
      state.categories = categories.data || [];
      state.layoutLines = lines.data || [];
      state.layouts = layouts.data || [];
      state.cashFunds = cashFunds.data || [];
    } catch (error) {
      console.warn("No se pudo cargar bandeja operativa", error);
    } finally {
      state.loading = false;
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
    `;
    document.head.appendChild(style);
  }
})();
