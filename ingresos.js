const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PENDING = ["pending", "partial", "overdue"];
const OPEN_INCIDENTS = ["open", "invoiced"];
const LINEAGES = ["SNR", "SNM", "PSN", "CSN", "FSN"];
const state = {
  profile: null,
  tab: "dashboard",
  quick: null,
  periodId: null,
  editMemberId: null,
  paymentChargeId: null,
  invoiceContext: null,
  invoicePayId: null,
  members: [], periods: [], charges: [], payments: [], incidents: [], invoices: [], companies: [], costCenters: [], categories: []
};
const d = {};
const $ = (id) => document.getElementById(id);

window.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheDom();
  setupTheme();
  bindEvents();
  try {
    await loadSession();
    await loadData();
  } catch (error) {
    showMessage(friendly(error), true);
    toast("No fue posible iniciar", friendly(error), "error");
  }
}

function cacheDom() {
  [
    "themeToggle", "userName", "userEmail", "logoutBtn", "refreshBtn", "messageBox", "toastStack", "filterStrip", "filterLabel", "clearFilterBtn",
    "activeMembersCount", "pendingFeesCount", "pendingAmountTotal", "openIncidentsCount", "pendingInvoicesCount", "dashboardSummary",
    "memberSearch", "memberStatusFilter", "memberLineageFilter", "membersTableBody", "periodsTableBody", "chargesTableBody", "chargesTitle", "chargesSubtitle", "generateFeesBtn",
    "paymentSearch", "paymentStatusFilter", "paymentPeriodFilter", "paymentsTableBody", "incidentSearch", "incidentStatusFilter", "incidentReceiverFilter", "incidentDateFilter", "incidentsTableBody",
    "invoiceSearch", "invoiceTypeFilter", "invoiceStatusFilter", "invoiceDateFilter", "invoicesTableBody",
    "memberDialog", "memberForm", "memberDialogTitle", "memberFullName", "memberRfc", "memberLineage", "memberFeeFactor", "memberEmail", "memberPhone", "memberNotes", "memberActive", "saveMemberBtn",
    "periodDialog", "periodForm", "periodYear", "periodName", "periodCutoffDate", "periodTotalBudget", "periodStatus", "savePeriodBtn",
    "paymentDialog", "paymentForm", "paymentDialogSubtitle", "paymentAmount", "paymentDate", "paymentBankReference", "paymentMethod", "paymentNotes", "savePaymentBtn",
    "incidentDialog", "incidentForm", "incidentReceiverType", "incidentMemberLabel", "incidentMemberId", "incidentExternalNameLabel", "incidentExternalName", "incidentExternalRfcLabel", "incidentExternalRfc", "incidentReferredByMemberId", "incidentCompanyId", "incidentCostCenterId", "incidentBudgetCategoryId", "incidentAmount", "incidentDate", "incidentDescription", "incidentNotes", "saveIncidentBtn",
    "invoiceDialog", "invoiceForm", "invoiceDialogTitle", "invoiceDialogSubtitle", "invoiceFiscalUuid", "invoiceSeriesFolio", "invoiceAmount", "invoiceIssueDate", "invoiceXmlPath", "invoicePdfPath", "saveInvoiceBtn",
    "invoicePayDialog", "invoicePayForm", "invoicePayDate", "invoicePayMethod", "invoicePayReference", "invoicePayNotes", "saveInvoicePayBtn", "statementDialog", "statementTitle", "statementContent"
  ].forEach(id => d[id] = $(id));
  d.statCards = [...document.querySelectorAll("[data-card-filter]")];
  d.tabButtons = [...document.querySelectorAll("[data-tab]")];
  d.panels = {
    dashboard: $("dashboardTab"), members: $("membersTab"), periods: $("periodsTab"), payments: $("paymentsTab"), incidents: $("incidentsTab"), invoices: $("invoicesTab")
  };
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  d.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("flux-theme", next);
  });
}

function bindEvents() {
  d.logoutBtn?.addEventListener("click", logout);
  d.refreshBtn?.addEventListener("click", loadData);
  d.clearFilterBtn?.addEventListener("click", clearQuick);
  d.statCards.forEach(card => card.addEventListener("click", () => applyCard(card.dataset.cardFilter)));
  d.tabButtons.forEach(btn => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  document.querySelectorAll("[data-open-member]").forEach(btn => btn.addEventListener("click", openMember));
  document.querySelectorAll("[data-open-period]").forEach(btn => btn.addEventListener("click", openPeriod));
  document.querySelectorAll("[data-open-incident]").forEach(btn => btn.addEventListener("click", openIncident));
  document.querySelectorAll("[data-close-dialog]").forEach(btn => btn.addEventListener("click", () => closeDialog(btn.dataset.closeDialog)));

  [d.memberSearch, d.memberStatusFilter, d.memberLineageFilter].forEach(el => el?.addEventListener("input", renderMembers));
  [d.memberStatusFilter, d.memberLineageFilter].forEach(el => el?.addEventListener("change", renderMembers));
  [d.paymentSearch, d.paymentStatusFilter, d.paymentPeriodFilter].forEach(el => el?.addEventListener("input", renderPayments));
  [d.paymentStatusFilter, d.paymentPeriodFilter].forEach(el => el?.addEventListener("change", renderPayments));
  [d.incidentSearch, d.incidentStatusFilter, d.incidentReceiverFilter, d.incidentDateFilter].forEach(el => el?.addEventListener("input", renderIncidents));
  [d.incidentStatusFilter, d.incidentReceiverFilter, d.incidentDateFilter].forEach(el => el?.addEventListener("change", renderIncidents));
  [d.invoiceSearch, d.invoiceTypeFilter, d.invoiceStatusFilter, d.invoiceDateFilter].forEach(el => el?.addEventListener("input", renderInvoices));
  [d.invoiceTypeFilter, d.invoiceStatusFilter, d.invoiceDateFilter].forEach(el => el?.addEventListener("change", renderInvoices));

  d.generateFeesBtn?.addEventListener("click", generateFees);
  d.memberForm?.addEventListener("submit", saveMember);
  d.periodForm?.addEventListener("submit", savePeriod);
  d.paymentForm?.addEventListener("submit", savePayment);
  d.incidentReceiverType?.addEventListener("change", toggleIncidentReceiver);
  d.incidentCompanyId?.addEventListener("change", fillCostCenters);
  d.incidentForm?.addEventListener("submit", saveIncident);
  d.invoiceForm?.addEventListener("submit", saveInvoice);
  d.invoicePayForm?.addEventListener("submit", saveInvoicePay);

  d.membersTableBody?.addEventListener("click", onMembersAction);
  d.periodsTableBody?.addEventListener("click", onPeriodsAction);
  d.chargesTableBody?.addEventListener("click", onChargeAction);
  d.paymentsTableBody?.addEventListener("click", onChargeAction);
  d.incidentsTableBody?.addEventListener("click", onIncidentAction);
  d.invoicesTableBody?.addEventListener("click", onInvoiceAction);
}

async function loadSession() {
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!session) return window.location.href = "./index.html";
  d.userEmail.textContent = session.user.email || "Sesion activa";
  d.userName.textContent = session.user.user_metadata?.full_name || session.user.email || "Usuario";
  await resolveProfile(session);
}

async function resolveProfile(session) {
  state.profile = null;
  for (const lookup of [{ column: "auth_user_id", value: session.user.id }, { column: "email", value: session.user.email }].filter(x => x.value)) {
    const { data, error } = await supabaseClient.from("profiles").select("id,email,full_name,auth_user_id,active").eq(lookup.column, lookup.value).maybeSingle();
    if (!error && data?.id) {
      state.profile = data;
      d.userName.textContent = data.full_name || d.userName.textContent;
      return;
    }
  }
}

async function loadData() {
  showMessage("Cargando ingresos...");
  const reqs = await Promise.all([
    supabaseClient.from("members").select("*").order("full_name", { ascending: true }),
    supabaseClient.from("billing_periods").select("*").order("cutoff_date", { ascending: false }),
    supabaseClient.from("maintenance_fee_charges").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("maintenance_fee_payments").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("incident_charges").select("*").order("incident_date", { ascending: false }),
    supabaseClient.from("invoices").select("*").order("issue_date", { ascending: false }),
    supabaseClient.from("companies").select("id,name,legal_name,active").order("name", { ascending: true }),
    supabaseClient.from("cost_centers").select("id,name,code,company_id,active").order("name", { ascending: true }),
    supabaseClient.from("budget_categories").select("id,code,name,category,budget_type,active").order("code", { ascending: true })
  ]);
  const err = reqs.find(r => r.error)?.error;
  if (err) {
    showMessage(friendly(err), true);
    toast("No se pudo cargar", friendly(err), "error");
    return;
  }
  [state.members, state.periods, state.charges, state.payments, state.incidents, state.invoices, state.companies, state.costCenters, state.categories] = reqs.map(r => r.data || []);
  if (!state.periodId && state.periods.length) state.periodId = state.periods[0].id;
  hideMessage();
  fillCatalogs();
  renderAll();
}

function renderAll() { renderStats(); renderDashboard(); renderMembers(); renderPeriods(); renderCharges(); renderPayments(); renderIncidents(); renderInvoices(); renderTabs(); }
function switchTab(tab) { state.tab = tab || "dashboard"; renderTabs(); }
function renderTabs() { d.tabButtons.forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab)); Object.entries(d.panels).forEach(([k,p]) => p?.classList.toggle("hidden", k !== state.tab)); }
function applyCard(filter) {
  state.quick = filter;
  if (filter === "members") { switchTab("members"); d.memberStatusFilter.value = "active"; }
  if (filter === "pendingFees" || filter === "pendingAmount") { switchTab("payments"); d.paymentStatusFilter.value = "todos"; }
  if (filter === "openIncidents") { switchTab("incidents"); d.incidentStatusFilter.value = "todos"; }
  if (filter === "pendingInvoices") { switchTab("invoices"); d.invoiceStatusFilter.value = "issued"; }
  renderFilter(); renderAll();
}
function clearQuick() { state.quick = null; d.memberStatusFilter.value = "todos"; d.paymentStatusFilter.value = "todos"; d.incidentStatusFilter.value = "todos"; d.invoiceStatusFilter.value = "todos"; renderFilter(); renderAll(); }
function renderFilter() { const labels = { members:"Vista filtrada: Socios activos", pendingFees:"Vista filtrada: Cuotas pendientes", pendingAmount:"Vista filtrada: Monto pendiente", openIncidents:"Vista filtrada: Incidencias abiertas", pendingInvoices:"Vista filtrada: Facturas pendientes" }; d.filterLabel.textContent = labels[state.quick] || "Vista filtrada"; d.filterStrip.classList.toggle("hidden", !state.quick); }

function fillCatalogs() {
  const lineage = d.memberLineageFilter.value || "todos";
  d.memberLineageFilter.innerHTML = `<option value="todos">Estirpe: Todas</option>${LINEAGES.map(x => `<option value="${x}">${x}</option>`).join("")}`;
  d.memberLineageFilter.value = LINEAGES.includes(lineage) ? lineage : "todos";
  const period = d.paymentPeriodFilter.value || "todos";
  d.paymentPeriodFilter.innerHTML = `<option value="todos">Periodo: Todos</option>${state.periods.map(p => `<option value="${esc(p.id)}">${esc(periodLabel(p))}</option>`).join("")}`;
  d.paymentPeriodFilter.value = state.periods.some(p => p.id === period) ? period : "todos";
  const activeMembers = state.members.filter(m => m.active !== false).map(m => `<option value="${esc(m.id)}">${esc(m.full_name)}</option>`).join("");
  d.incidentMemberId.innerHTML = `<option value="">Seleccionar socio</option>${activeMembers}`;
  d.incidentReferredByMemberId.innerHTML = `<option value="">Sin referidor</option>${activeMembers}`;
  d.incidentCompanyId.innerHTML = `<option value="">Sin empresa</option>${state.companies.filter(c => c.active !== false).map(c => `<option value="${esc(c.id)}">${esc(companyName(c.id))}</option>`).join("")}`;
  fillCostCenters();
  d.incidentBudgetCategoryId.innerHTML = `<option value="">Sin partida</option>${state.categories.map(c => `<option value="${esc(c.id)}">${esc(catLabel(c))}</option>`).join("")}`;
}
function fillCostCenters() { const companyId = d.incidentCompanyId.value; const rows = state.costCenters.filter(c => !companyId || c.company_id === companyId); d.incidentCostCenterId.innerHTML = `<option value="">Sin centro</option>${rows.map(c => `<option value="${esc(c.id)}">${esc(centerLabel(c))}</option>`).join("")}`; }

function renderStats() {
  const activeMembers = state.members.filter(m => m.active !== false).length;
  const pendingCharges = state.charges.filter(c => PENDING.includes(c.status)).length;
  const pendingAmount = state.charges.filter(c => PENDING.includes(c.status)).reduce((s,c) => s + num(c.pending_amount), 0);
  const openIncidents = state.incidents.filter(i => OPEN_INCIDENTS.includes(i.status)).length;
  const pendingInvoices = state.invoices.filter(i => i.status === "issued").length;
  d.activeMembersCount.textContent = activeMembers; d.pendingFeesCount.textContent = pendingCharges; d.pendingAmountTotal.textContent = moneySmall(pendingAmount); d.openIncidentsCount.textContent = openIncidents; d.pendingInvoicesCount.textContent = pendingInvoices;
  d.statCards.forEach(c => c.classList.toggle("selected", c.dataset.cardFilter === state.quick));
}
function renderDashboard() {
  const expected = sum(state.charges, "expected_amount"), collected = sum(state.charges, "paid_amount");
  const pending = state.charges.filter(c => PENDING.includes(c.status)).reduce((s,c) => s + num(c.pending_amount), 0);
  const inc = state.incidents.filter(i => OPEN_INCIDENTS.includes(i.status)).reduce((s,i) => s + num(i.amount), 0);
  const inv = state.invoices.filter(i => i.status === "issued").reduce((s,i) => s + num(i.amount), 0);
  d.dashboardSummary.innerHTML = [rowSummary("Cuotas esperadas", money(expected)), rowSummary("Cuotas cobradas", money(collected)), rowSummary("Cuotas pendientes", money(pending)), rowSummary("Incidencias abiertas/facturadas", money(inc)), rowSummary("Facturas emitidas pendientes", money(inv))].join("");
}

function renderMembers() {
  const q = norm(d.memberSearch.value), status = d.memberStatusFilter.value, lineage = d.memberLineageFilter.value;
  const rows = state.members.filter(m => (!q || norm([m.full_name,m.rfc,m.email].join(" ")).includes(q)) && (status === "todos" || (status === "active" ? m.active !== false : m.active === false)) && (lineage === "todos" || m.lineage === lineage) && (state.quick !== "members" || m.active !== false));
  d.membersTableBody.innerHTML = rows.length ? rows.map(m => `<tr><td><strong>${esc(m.full_name)}</strong><span class="muted-line">${esc(m.email || "Sin correo")}</span></td><td>${esc(m.rfc || "Sin RFC")}</td><td>${esc(m.lineage || "Sin estirpe")}</td><td>${formatNum(m.fee_factor)}</td><td>${esc(m.email || "Sin correo")}</td><td>${esc(m.phone || "Sin telefono")}</td><td>${badge(m.active === false ? "inactive" : "active", m.active === false ? "Inactivo" : "Activo")}</td><td><div class="actions"><button class="small-btn info" data-action="statement" data-id="${esc(m.id)}">Estado de cuenta</button><button class="small-btn" data-action="edit" data-id="${esc(m.id)}">Editar</button></div></td></tr>`).join("") : empty(8, "No hay socios para este filtro.");
}
function renderPeriods() {
  d.periodsTableBody.innerHTML = state.periods.length ? state.periods.map(p => `<tr><td><strong>${esc(p.name)}</strong><span class="muted-line">${p.id === state.periodId ? "Seleccionado" : "Periodo"}</span></td><td>${esc(p.year)}</td><td>${date(p.cutoff_date)}</td><td>${money(p.total_budget)}</td><td>${badge(p.status)}</td><td><button class="small-btn ${p.id === state.periodId ? "success" : "info"}" data-action="select" data-id="${esc(p.id)}">Ver cuotas</button></td></tr>`).join("") : empty(6, "No hay periodos de cobro.");
}
function renderCharges() {
  const p = periodById(state.periodId), rows = state.charges.filter(c => c.billing_period_id === state.periodId);
  d.chargesTitle.textContent = p ? `Cuotas de ${p.name}` : "Cuotas del periodo";
  d.chargesSubtitle.textContent = p ? `Presupuesto ${money(p.total_budget)} con corte ${date(p.cutoff_date)}.` : "Selecciona un periodo para ver o generar cuotas.";
  d.chargesTableBody.innerHTML = !p ? empty(7, "Selecciona un periodo.") : rows.length ? rows.map(chargeRow).join("") : empty(7, "Este periodo todavia no tiene cuotas generadas.");
}
function renderPayments() {
  const q = norm(d.paymentSearch.value), status = d.paymentStatusFilter.value, period = d.paymentPeriodFilter.value;
  let rows = state.charges.filter(c => PENDING.includes(c.status));
  if (state.quick === "pendingFees" || state.quick === "pendingAmount") rows = rows.filter(c => num(c.pending_amount) > 0);
  rows = rows.filter(c => (!q || norm([memberName(c.member_id), periodLabel(periodById(c.billing_period_id))].join(" ")).includes(q)) && (status === "todos" || c.status === status) && (period === "todos" || c.billing_period_id === period));
  d.paymentsTableBody.innerHTML = rows.length ? rows.map(chargeRow).join("") : empty(8, "No hay cuotas pendientes para este filtro.");
}
function chargeRow(c) { const m = memberById(c.member_id), p = periodById(c.billing_period_id), inv = invoiceById(c.invoice_id); return `<tr><td><strong>${esc(m?.full_name || "Socio no encontrado")}</strong><span class="muted-line">${esc(m?.rfc || "Sin RFC")}</span></td><td>${esc(periodLabel(p))}</td><td>${money(c.expected_amount)}</td><td>${money(c.paid_amount)}</td><td>${money(c.pending_amount)}</td><td>${badge(c.status, chargeLabel(c.status))}</td><td>${inv ? `${badge(inv.status, invoiceStatus(inv.status))}<span class="muted-line">${esc(inv.series_folio || inv.fiscal_uuid || "Factura")}</span>` : badge("neutral", "Sin factura")}</td><td><div class="actions">${PENDING.includes(c.status) ? `<button class="small-btn success" data-action="pay" data-id="${esc(c.id)}">Registrar cobro</button>` : ""}${!c.invoice_id && c.status !== "cancelled" ? `<button class="small-btn info" data-action="invoice-charge" data-id="${esc(c.id)}">Crear factura</button>` : ""}</div></td></tr>`; }
function renderIncidents() {
  const q = norm(d.incidentSearch.value), status = d.incidentStatusFilter.value, receiver = d.incidentReceiverFilter.value, dateFilter = d.incidentDateFilter.value;
  const rows = state.incidents.filter(i => (!q || norm([incidentReceiver(i), i.external_rfc, i.description, memberName(i.referred_by_member_id)].join(" ")).includes(q)) && (status === "todos" || i.status === status) && (receiver === "todos" || receiverType(i) === receiver) && (!dateFilter || String(i.incident_date).slice(0,10) === dateFilter) && (state.quick !== "openIncidents" || OPEN_INCIDENTS.includes(i.status)));
  d.incidentsTableBody.innerHTML = rows.length ? rows.map(i => { const inv = invoiceById(i.invoice_id); return `<tr><td><strong>${esc(incidentReceiver(i))}</strong><span class="muted-line">${esc(i.external_rfc || memberById(i.member_id)?.rfc || "Sin RFC")}</span></td><td>${receiverType(i) === "member" ? "Socio" : "Externo"}</td><td>${esc(memberName(i.referred_by_member_id) || "Sin referidor")}</td><td><strong>${esc(i.description)}</strong><span class="muted-line">${esc(companyName(i.company_id) || "Sin empresa")}</span></td><td>${money(i.amount)}</td><td>${date(i.incident_date)}</td><td>${badge(i.status, incidentLabel(i.status))}</td><td>${inv ? `${badge(inv.status, invoiceStatus(inv.status))}<span class="muted-line">${esc(inv.series_folio || inv.fiscal_uuid || "Factura")}</span>` : badge("neutral", "Sin factura")}</td><td><div class="actions">${!i.invoice_id && i.status !== "cancelled" ? `<button class="small-btn info" data-action="invoice-incident" data-id="${esc(i.id)}">Crear factura</button>` : ""}${inv?.status === "issued" ? `<button class="small-btn success" data-action="pay-invoice" data-id="${esc(inv.id)}">Marcar pagada</button>` : ""}</div></td></tr>`; }).join("") : empty(9, "No hay incidencias para este filtro.");
}
function renderInvoices() {
  const q = norm(d.invoiceSearch.value), type = d.invoiceTypeFilter.value, status = d.invoiceStatusFilter.value, dateFilter = d.invoiceDateFilter.value;
  const rows = state.invoices.filter(i => (!q || norm([invoiceReceiver(i), i.receiver_rfc, i.fiscal_uuid, i.series_folio].join(" ")).includes(q)) && (type === "todos" || i.invoice_type === type) && (status === "todos" || i.status === status) && (!dateFilter || String(i.issue_date).slice(0,10) === dateFilter) && (state.quick !== "pendingInvoices" || i.status === "issued"));
  d.invoicesTableBody.innerHTML = rows.length ? rows.map(i => `<tr><td>${i.invoice_type === "maintenance_fee" ? "Cuota" : "Incidencia"}</td><td><strong>${esc(invoiceReceiver(i))}</strong></td><td>${esc(i.receiver_rfc || memberById(i.member_id)?.rfc || "Sin RFC")}</td><td>${esc(invoiceRef(i))}</td><td>${esc(i.fiscal_uuid || "Sin folio fiscal")}</td><td>${esc(i.series_folio || "Sin serie")}</td><td>${money(i.amount)}</td><td>${date(i.issue_date)}</td><td>${date(i.payment_date)}</td><td>${badge(i.status, invoiceStatus(i.status))}</td><td><div class="actions">${i.status === "issued" ? `<button class="small-btn success" data-action="pay-invoice" data-id="${esc(i.id)}">Marcar pagada</button>` : ""}</div></td></tr>`).join("") : empty(11, "No hay facturas para este filtro.");
}

function openMember() { state.editMemberId = null; d.memberDialogTitle.textContent = "Nuevo socio"; d.memberForm.reset(); d.memberFeeFactor.value = "1"; d.memberActive.checked = true; d.memberDialog.showModal(); }
function openPeriod() { d.periodForm.reset(); d.periodYear.value = new Date().getFullYear(); d.periodStatus.value = "open"; d.periodDialog.showModal(); }
function openIncident() { d.incidentForm.reset(); d.incidentReceiverType.value = "member"; d.incidentDate.value = today(); toggleIncidentReceiver(); fillCostCenters(); d.incidentDialog.showModal(); }
function closeDialog(id) { const el = $(id); if (el?.open) el.close(); }

async function saveMember(e) { e.preventDefault(); const fullName = clean(d.memberFullName.value), fee = num(d.memberFeeFactor.value), lineage = clean(d.memberLineage.value) || null; if (!fullName) return toast("Falta nombre", "Captura el nombre completo del socio.", "warning"); if (!fee || fee <= 0) return toast("Factor invalido", "El factor de cuota debe ser mayor a cero.", "warning"); const payload = { full_name: fullName, rfc: clean(d.memberRfc.value) || null, lineage, fee_factor: fee, email: clean(d.memberEmail.value) || null, phone: clean(d.memberPhone.value) || null, notes: clean(d.memberNotes.value) || null, active: d.memberActive.checked, updated_at: new Date().toISOString() }; await runButton(d.saveMemberBtn, "Guardando...", "Guardar socio", async () => { const q = state.editMemberId ? supabaseClient.from("members").update(payload).eq("id", state.editMemberId) : supabaseClient.from("members").insert(payload); const { error } = await q; if (error) throw error; closeDialog("memberDialog"); toast("Socio guardado", "El socio se guardo correctamente."); await loadData(); }); }
async function savePeriod(e) { e.preventDefault(); if (!profileOk()) return; const year = Number(d.periodYear.value), name = clean(d.periodName.value), cutoff = d.periodCutoffDate.value, total = num(d.periodTotalBudget.value); if (!year || !name || !cutoff) return toast("Periodo incompleto", "Captura ano, nombre y fecha corte.", "warning"); await runButton(d.savePeriodBtn, "Guardando...", "Guardar periodo", async () => { const { data, error } = await supabaseClient.from("billing_periods").insert({ year, name, cutoff_date: cutoff, total_budget: total, status: d.periodStatus.value || "open", created_by: state.profile.id }).select("id").single(); if (error) throw error; state.periodId = data?.id || state.periodId; closeDialog("periodDialog"); toast("Periodo creado", "El periodo de cobro se guardo correctamente."); await loadData(); switchTab("periods"); }); }
async function generateFees() { if (!state.periodId) return toast("Selecciona un periodo", "Selecciona un periodo para generar cuotas.", "warning"); await runButton(d.generateFeesBtn, "Generando...", "Generar cuotas", async () => { const { data, error } = await supabaseClient.rpc("generate_maintenance_fees_for_period", { p_billing_period_id: state.periodId }); if (error) throw error; toast("Cuotas generadas", `${data?.charges_generated || 0} cuotas generadas correctamente.`); await loadData(); }); }
function openPayment(chargeId) { const c = state.charges.find(x => x.id === chargeId); if (!c) return toast("Cuota no encontrada", "No se encontro la cuota.", "error"); state.paymentChargeId = chargeId; d.paymentForm.reset(); d.paymentAmount.value = num(c.pending_amount).toFixed(2); d.paymentDate.value = today(); d.paymentMethod.value = "transfer"; d.paymentDialogSubtitle.textContent = `${memberName(c.member_id)} - pendiente ${money(c.pending_amount)}.`; d.paymentDialog.showModal(); }
async function savePayment(e) { e.preventDefault(); if (!profileOk()) return; const amount = num(d.paymentAmount.value), payDate = d.paymentDate.value; if (!amount || amount <= 0) return toast("Monto invalido", "El monto debe ser mayor a cero.", "warning"); if (!payDate) return toast("Fecha requerida", "Captura fecha de pago.", "warning"); await runButton(d.savePaymentBtn, "Registrando...", "Registrar cobro", async () => { const { data, error } = await supabaseClient.rpc("register_maintenance_fee_payment", { p_charge_id: state.paymentChargeId, p_amount: amount, p_payment_date: payDate, p_bank_reference: clean(d.paymentBankReference.value) || null, p_payment_method: d.paymentMethod.value || "transfer", p_registered_by: state.profile.id, p_notes: clean(d.paymentNotes.value) || null }); if (error) throw error; closeDialog("paymentDialog"); toast("Cobro registrado", data?.message || "Cobro registrado correctamente."); await loadData(); }); }
async function saveIncident(e) { e.preventDefault(); if (!profileOk()) return; const type = d.incidentReceiverType.value, memberId = type === "member" ? val(d.incidentMemberId.value) : null, external = type === "external" ? clean(d.incidentExternalName.value) : null, amount = num(d.incidentAmount.value), incDate = d.incidentDate.value, desc = clean(d.incidentDescription.value); if (type === "member" && !memberId) return toast("Selecciona socio", "Selecciona el socio receptor.", "warning"); if (type === "external" && !external) return toast("Captura externo", "Captura el nombre del receptor externo.", "warning"); if (!desc) return toast("Descripcion requerida", "Captura descripcion.", "warning"); if (!amount || amount <= 0) return toast("Monto invalido", "El monto debe ser mayor a cero.", "warning"); if (!incDate) return toast("Fecha requerida", "Captura fecha.", "warning"); await runButton(d.saveIncidentBtn, "Creando...", "Crear incidencia", async () => { const { data, error } = await supabaseClient.rpc("create_incident_charge", { p_member_id: memberId, p_external_name: external, p_external_rfc: type === "external" ? clean(d.incidentExternalRfc.value) || null : null, p_referred_by_member_id: val(d.incidentReferredByMemberId.value), p_company_id: val(d.incidentCompanyId.value), p_cost_center_id: val(d.incidentCostCenterId.value), p_budget_category_id: val(d.incidentBudgetCategoryId.value), p_description: desc, p_amount: amount, p_incident_date: incDate, p_registered_by: state.profile.id, p_notes: clean(d.incidentNotes.value) || null }); if (error) throw error; closeDialog("incidentDialog"); toast("Incidencia creada", data?.message || "Incidencia creada correctamente."); await loadData(); switchTab("incidents"); }); }
function openInvoice(type, id) { state.invoiceContext = { type, id }; d.invoiceForm.reset(); d.invoiceIssueDate.value = today(); if (type === "maintenance_fee") { const c = state.charges.find(x => x.id === id); d.invoiceDialogTitle.textContent = "Registrar factura de cuota"; d.invoiceDialogSubtitle.textContent = `${memberName(c?.member_id)} - ${periodLabel(periodById(c?.billing_period_id))}`; d.invoiceAmount.value = num(c?.pending_amount || c?.expected_amount).toFixed(2); } else { const i = state.incidents.find(x => x.id === id); d.invoiceDialogTitle.textContent = "Registrar factura de incidencia"; d.invoiceDialogSubtitle.textContent = incidentReceiver(i); d.invoiceAmount.value = num(i?.amount).toFixed(2); } d.invoiceDialog.showModal(); }
async function saveInvoice(e) { e.preventDefault(); const amount = num(d.invoiceAmount.value), issue = d.invoiceIssueDate.value; if (!state.invoiceContext) return toast("Referencia faltante", "No se encontro la cuota o incidencia.", "warning"); if (amount < 0) return toast("Monto invalido", "El monto no puede ser negativo.", "warning"); if (!issue) return toast("Fecha requerida", "Captura fecha de emision.", "warning"); await runButton(d.saveInvoiceBtn, "Registrando...", "Registrar factura", async () => { const { data, error } = await supabaseClient.rpc("create_invoice_record", { p_invoice_type: state.invoiceContext.type, p_reference_id: state.invoiceContext.id, p_fiscal_uuid: clean(d.invoiceFiscalUuid.value) || null, p_series_folio: clean(d.invoiceSeriesFolio.value) || null, p_amount: amount, p_issue_date: issue, p_storage_path_xml: clean(d.invoiceXmlPath.value) || null, p_storage_path_pdf: clean(d.invoicePdfPath.value) || null }); if (error) throw error; closeDialog("invoiceDialog"); toast("Factura registrada", data?.message || "Factura registrada."); await loadData(); }); }
function openInvoicePay(id) { const inv = state.invoices.find(x => x.id === id); if (!inv) return toast("Factura no encontrada", "No se encontro la factura.", "error"); state.invoicePayId = id; d.invoicePayForm.reset(); d.invoicePayDate.value = today(); d.invoicePayMethod.value = "transfer"; d.invoicePayDialog.showModal(); }
async function saveInvoicePay(e) { e.preventDefault(); if (!profileOk()) return; if (!d.invoicePayDate.value) return toast("Fecha requerida", "Captura fecha de pago.", "warning"); await runButton(d.saveInvoicePayBtn, "Marcando...", "Marcar pagada", async () => { const { data, error } = await supabaseClient.rpc("mark_invoice_paid", { p_invoice_id: state.invoicePayId, p_payment_date: d.invoicePayDate.value, p_bank_reference: clean(d.invoicePayReference.value) || null, p_payment_method: d.invoicePayMethod.value || "transfer", p_registered_by: state.profile.id, p_notes: clean(d.invoicePayNotes.value) || null }); if (error) throw error; closeDialog("invoicePayDialog"); toast("Factura pagada", data?.message || "Factura marcada como pagada."); await loadData(); }); }

function onMembersAction(e) { const b = e.target.closest("button[data-action]"); if (!b) return; if (b.dataset.action === "statement") showStatement(b.dataset.id); if (b.dataset.action === "edit") editMember(b.dataset.id); }
function onPeriodsAction(e) { const b = e.target.closest("button[data-action='select']"); if (!b) return; state.periodId = b.dataset.id; renderPeriods(); renderCharges(); }
function onChargeAction(e) { const b = e.target.closest("button[data-action]"); if (!b) return; if (b.dataset.action === "pay") openPayment(b.dataset.id); if (b.dataset.action === "invoice-charge") openInvoice("maintenance_fee", b.dataset.id); }
function onIncidentAction(e) { const b = e.target.closest("button[data-action]"); if (!b) return; if (b.dataset.action === "invoice-incident") openInvoice("incident", b.dataset.id); if (b.dataset.action === "pay-invoice") openInvoicePay(b.dataset.id); }
function onInvoiceAction(e) { const b = e.target.closest("button[data-action='pay-invoice']"); if (b) openInvoicePay(b.dataset.id); }
function editMember(id) { const m = memberById(id); if (!m) return; state.editMemberId = id; d.memberDialogTitle.textContent = "Editar socio"; d.memberFullName.value = m.full_name || ""; d.memberRfc.value = m.rfc || ""; d.memberLineage.value = m.lineage || ""; d.memberFeeFactor.value = m.fee_factor || 1; d.memberEmail.value = m.email || ""; d.memberPhone.value = m.phone || ""; d.memberNotes.value = m.notes || ""; d.memberActive.checked = m.active !== false; d.memberDialog.showModal(); }
function showStatement(id) { const m = memberById(id); if (!m) return; const cs = state.charges.filter(c => c.member_id === id), is = state.incidents.filter(i => i.member_id === id), refs = state.incidents.filter(i => i.referred_by_member_id === id && i.member_id !== id); const expected = sum(cs,"expected_amount"), paid = sum(cs,"paid_amount"), pending = cs.filter(c => PENDING.includes(c.status)).reduce((s,c) => s + num(c.pending_amount),0), openInc = is.filter(i => OPEN_INCIDENTS.includes(i.status)).reduce((s,i) => s + num(i.amount),0), paidInc = is.filter(i => i.status === "paid").reduce((s,i)=>s+num(i.amount),0), refOpen = refs.filter(i => OPEN_INCIDENTS.includes(i.status)).reduce((s,i)=>s+num(i.amount),0); d.statementTitle.textContent = `Estado de cuenta - ${m.full_name}`; d.statementContent.innerHTML = `<div class="dashboard-grid"><div class="table-card"><div class="summary-list">${rowSummary("Cuotas esperadas", money(expected))}${rowSummary("Cuotas cobradas", money(paid))}${rowSummary("Cuotas pendientes", money(pending))}${rowSummary("Incidencias abiertas directas", money(openInc))}${rowSummary("Incidencias pagadas directas", money(paidInc))}${rowSummary("Incidencias referidas abiertas", money(refOpen))}${rowSummary("Total por cobrar directo", money(pending + openInc))}</div></div><div class="notice warning">Las incidencias donde el socio solo es referidor se muestran separadas y no se suman como deuda directa.</div></div>`; d.statementDialog.showModal(); }
function toggleIncidentReceiver() { const isMember = d.incidentReceiverType.value === "member"; d.incidentMemberLabel.classList.toggle("hidden", !isMember); d.incidentExternalNameLabel.classList.toggle("hidden", isMember); d.incidentExternalRfcLabel.classList.toggle("hidden", isMember); }

async function logout() { await supabaseClient.auth.signOut(); window.location.href = "./index.html"; }
function profileOk() { if (state.profile?.id) return true; toast("Perfil no identificado", "No se pudo identificar tu perfil de usuario.", "error"); return false; }
async function runButton(btn, loading, normal, fn) { try { if (btn) { btn.disabled = true; btn.textContent = loading; } await fn(); } catch (error) { toast("Operacion no completada", rpcError(error), "error"); } finally { if (btn) { btn.disabled = false; btn.textContent = normal; } } }
function toast(title, message, type = "success") { const el = document.createElement("div"); el.className = `toast ${type}`; el.innerHTML = `<strong>${esc(title)}</strong><span>${esc(message)}</span>`; d.toastStack.appendChild(el); setTimeout(() => el.remove(), 6500); }
function showMessage(msg, error=false) { d.messageBox.textContent = msg; d.messageBox.classList.remove("hidden"); d.messageBox.style.color = error ? "var(--red)" : "var(--soft)"; }
function hideMessage() { d.messageBox.classList.add("hidden"); }
function rpcError(error) { const m = error?.message || String(error || "Error desconocido"); const map = { billing_period_required:"Selecciona un periodo.", billing_period_not_found:"No se encontro el periodo.", billing_period_not_open:"El periodo no esta abierto.", billing_period_total_budget_required:"Captura presupuesto total.", no_active_members:"No hay socios activos para generar cuotas.", charge_required:"No se encontro la cuota.", charge_not_found:"La cuota no existe.", invalid_payment_amount:"El monto debe ser mayor a cero.", payment_date_required:"Captura fecha de pago.", invalid_payment_method:"Metodo de pago invalido.", charge_cancelled:"La cuota esta cancelada.", incident_receiver_required:"Selecciona socio o captura externo.", incident_receiver_must_be_member_or_external:"Elige solo un tipo de receptor.", member_not_found:"No se encontro el socio.", referred_member_not_found:"No se encontro el socio referidor.", description_required:"Captura descripcion.", invalid_incident_amount:"El monto debe ser mayor a cero.", incident_date_required:"Captura fecha.", invalid_invoice_type:"Tipo de factura invalido.", invoice_reference_required:"No se encontro la referencia de factura.", invalid_invoice_amount:"El monto de factura no puede ser negativo.", issue_date_required:"Captura fecha de emision.", incident_charge_not_found:"No se encontro la incidencia.", invoice_required:"No se encontro la factura.", invoice_not_found:"La factura no existe.", invoice_cancelled:"La factura esta cancelada.", invoice_already_paid:"La factura ya estaba pagada.", invoice_missing_charge:"La factura no tiene cuota asociada.", invoice_missing_incident:"La factura no tiene incidencia asociada." }; const key = Object.keys(map).find(k => m.includes(k)); return key ? map[key] : friendly(error); }
function friendly(error) { const m = error?.message || String(error || "Error desconocido"); if (m.toLowerCase().includes("row-level security") || error?.code === "42501" || m.toLowerCase().includes("permission denied")) return "No tienes permiso para realizar esta accion."; return m; }

function memberById(id){return state.members.find(x=>x.id===id)} function periodById(id){return state.periods.find(x=>x.id===id)} function invoiceById(id){return state.invoices.find(x=>x.id===id)} function memberName(id){return memberById(id)?.full_name || ""} function companyName(id){const c=state.companies.find(x=>x.id===id);return c?.legal_name||c?.name||""} function periodLabel(p){return p?`${p.name||"Periodo"} ${p.year||""}`.trim():"Sin periodo"} function centerLabel(c){return [c.code,c.name].filter(Boolean).join(" - ")||c.id} function catLabel(c){return [c.code,c.name||c.category||c.description].filter(Boolean).join(" - ")||c.id} function receiverType(i){return i?.member_id?"member":"external"} function incidentReceiver(i){return !i?"Sin receptor":i.member_id?(memberName(i.member_id)||"Socio no encontrado"):(i.external_name||"Externo")} function invoiceReceiver(i){if(!i)return"Sin receptor"; if(i.member_id)return memberName(i.member_id)||"Socio no encontrado"; if(i.external_name)return i.external_name; if(i.charge_id)return memberName(state.charges.find(c=>c.id===i.charge_id)?.member_id)||"Socio no encontrado"; if(i.incident_charge_id)return incidentReceiver(state.incidents.find(x=>x.id===i.incident_charge_id)); return"Sin receptor"} function invoiceRef(i){if(i.invoice_type==="maintenance_fee"){const c=state.charges.find(x=>x.id===i.charge_id);return `Cuota ${periodLabel(periodById(c?.billing_period_id))}`} const inc=state.incidents.find(x=>x.id===i.incident_charge_id);return `Incidencia ${inc?.description||""}`.trim()} function chargeLabel(s){return ({pending:"Pendiente",partial:"Parcial",paid:"Pagada",overdue:"Vencida",cancelled:"Cancelada"})[s]||s||"Sin estatus"} function incidentLabel(s){return ({open:"Abierta",invoiced:"Facturada",paid:"Cobrada",cancelled:"Cancelada"})[s]||s||"Sin estatus"} function invoiceStatus(s){return ({issued:"Emitida",paid:"Pagada",cancelled:"Cancelada"})[s]||s||"Sin estatus"} function badge(s,label){return `<span class="badge badge-${esc(s||"neutral")}">${esc(label||s||"Sin estatus")}</span>`} function rowSummary(a,b){return `<div class="summary-row"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`} function empty(cols,msg){return `<tr><td colspan="${cols}" class="empty-state"><strong>${esc(msg)}</strong><span>Actualiza filtros o registra informacion nueva.</span></td></tr>`} function money(v){return new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:2}).format(num(v))} function moneySmall(v){return new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",notation:"compact",maximumFractionDigits:1}).format(num(v))} function date(v){if(!v)return"Sin fecha";const dt=new Date(`${String(v).slice(0,10)}T00:00:00`);return Number.isNaN(dt.getTime())?"Sin fecha":new Intl.DateTimeFormat("es-MX",{day:"2-digit",month:"short",year:"numeric"}).format(dt)} function formatNum(v){return new Intl.NumberFormat("es-MX",{maximumFractionDigits:3}).format(num(v))} function num(v){const n=Number(v);return Number.isFinite(n)?n:0} function sum(rows,key){return rows.reduce((s,r)=>s+num(r[key]),0)} function val(v){const x=clean(v);return x||null} function clean(v){return String(v||"").trim()} function norm(v){return clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()} function today(){return new Date().toISOString().slice(0,10)} function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
