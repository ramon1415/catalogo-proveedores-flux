const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  isFinance: false,
  isDirector: false,
  isAuthorized: false,
  view: "finance",
  batches: [],
  selectedId: null,
  detail: null,
  eligible: [],
  ineligible: [],
  companies: [],
  directorCandidates: [],
  directors: [],
  companySettings: [],
  companySettingsLoaded: false,
  releaseItemId: null,
  selectedEligibleIds: new Set(),
  addingProgress: null,
  confirmResolve: null,
  mutating: false,
  regularizations: [],
  regularization: null,
  regularizationDecision: null,
  companyScopeId: null,
  companyScopeRequired: false,
  companyScopeName: "",
}
const dom = {}

document.addEventListener("DOMContentLoaded", init)

async function init() {
  cacheDom()
  bindEvents()
  applyTheme()
  const params = new URLSearchParams(window.location.search)
  state.companyScopeRequired = params.has("company_id")
  state.companyScopeId = parseUuid(params.get("company_id"))
  const authorized = await resolveUser()
  if (!authorized) return
  if (state.companyScopeRequired && !state.companyScopeId) {
    renderCompanyScopeError("La empresa seleccionada no es valida. Regresa al sistema y vuelve a elegir una empresa.")
    return
  }
  try {
    await loadReferenceData()
    await loadDirectors()
    await loadDirectorCandidates()
    state.selectedId = params.get("batch_id") || null
    await loadBatches()
    await loadRegularizations()
  } catch (error) {
    showToast("No se pudo iniciar", friendlyError(error), "error")
  }
}

function cacheDom() {
  ;[
    "userName", "userEmail", "logoutBtn", "themeToggle", "refreshBtn", "directorConfigBtn",
    "createBatchBtn", "viewTabs", "batchSearch", "batchStatusFilter", "batchList",
    "batchDetail", "pageContext", "createBatchDialog", "createBatchForm", "createCompanyId",
    "createDirectorId", "createPeriodStart", "createPeriodEnd", "createLabel", "createNotes",
    "directorDialog", "directorForm", "directorCompanyId", "directorProfileId", "directorActive",
    "batchEnforcementEnabled", "batchEnforcementHelp", "directorList", "rebatchDialog",
    "rebatchForm", "rebatchNote", "rebatchOriginalReason", "rebatchTargetBatch", "confirmActionDialog",
    "confirmActionTitle", "confirmActionBody", "confirmActionCloseBtn", "confirmActionCancelBtn",
    "confirmActionConfirmBtn", "regularizationCard", "regularizationCount", "regularizationList",
    "regularizationDialog", "regularizationForm", "regularizationDialogTitle",
    "regularizationDialogSubtitle", "regularizationSummary", "regularizationNote",
    "closeRegularizationBtn", "cancelRegularizationBtn", "submitRegularizationBtn",
  ].forEach((id) => { dom[id] = document.getElementById(id) })
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", async () => {
    await supabaseClient.auth.signOut()
    window.location.href = "./index.html"
  })
  dom.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"
    document.documentElement.dataset.theme = next
    localStorage.setItem("flux-theme", next)
  })
  dom.refreshBtn?.addEventListener("click", refreshAll)
  dom.batchSearch?.addEventListener("input", renderBatchList)
  dom.batchStatusFilter?.addEventListener("change", renderBatchList)
  dom.viewTabs?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-view]")
    if (!button || button.dataset.view === state.view) return
    state.view = button.dataset.view
    state.selectedId = null
    state.detail = null
    state.eligible = []
    state.ineligible = []
    state.selectedEligibleIds.clear()
    await loadBatches()
  })
  dom.batchList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-batch-id]")
    if (button) openBatch(button.dataset.batchId)
  })
  dom.batchDetail?.addEventListener("click", handleDetailAction)
  dom.batchDetail?.addEventListener("change", handleDetailChange)
  dom.batchDetail?.addEventListener("input", handleDetailInput)
  dom.createBatchBtn?.addEventListener("click", openCreateDialog)
  dom.directorConfigBtn?.addEventListener("click", openDirectorDialog)
  dom.createBatchForm?.addEventListener("submit", createBatch)
  dom.directorForm?.addEventListener("submit", saveDirector)
  dom.rebatchForm?.addEventListener("submit", releaseRejectedItem)
  dom.regularizationList?.addEventListener("click", handleRegularizationAction)
  dom.regularizationForm?.addEventListener("submit", submitRegularization)
  dom.confirmActionConfirmBtn?.addEventListener("click", () => closeConfirmation(true))
  dom.confirmActionCancelBtn?.addEventListener("click", () => closeConfirmation(false))
  dom.confirmActionCloseBtn?.addEventListener("click", () => closeConfirmation(false))
  dom.confirmActionDialog?.addEventListener("cancel", (event) => {
    event.preventDefault()
    closeConfirmation(false)
  })
  dom.createCompanyId?.addEventListener("change", fillCreateDirectors)
  dom.directorCompanyId?.addEventListener("change", async () => {
    await loadDirectorCandidates(dom.directorCompanyId.value || null)
    syncEnforcementControl()
  })
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-close-dialog]")
    if (button) document.getElementById(button.dataset.closeDialog)?.close()
  })
}

function applyTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.dataset.theme = saved
}

function parseUuid(value) {
  const normalized = String(value || "").trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null
}

function isWithinCompanyScope(row) {
  return !state.companyScopeId || row?.company_id === state.companyScopeId || row?.id === state.companyScopeId
}

function scopeCompanyRows(rows) {
  return asArray(rows).filter(isWithinCompanyScope)
}

function renderCompanyScopeError(message) {
  state.batches = []
  state.selectedId = null
  state.detail = null
  dom.pageContext.textContent = "Empresa no disponible"
  dom.createBatchBtn.hidden = true
  dom.directorConfigBtn.hidden = true
  if (dom.batchList) dom.batchList.innerHTML = `<div class="batch-empty">${escapeHtml(message)}</div>`
  renderEmptyDetail(message)
}

async function resolveUser() {
  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  state.profile = window.FluxAuth?.getProfile?.() || null
  state.isFinance = Boolean(window.FluxAuth?.isAdminFinance?.())
  state.isDirector = Boolean(window.FluxAuth?.hasRole?.(["approver_2", "aprobador_2", "direccion", "director"]))
  state.isAuthorized = state.isFinance || state.isDirector
  const session = window.FluxAuth?.state?.session
  dom.userName.textContent = state.profile?.full_name || session?.user?.email || "Usuario"
  dom.userEmail.textContent = state.profile?.email || session?.user?.email || "Sesion activa"
  if (!state.isAuthorized) {
    renderUnauthorized()
    return false
  }
  state.view = state.isDirector ? "director" : "finance"
  dom.viewTabs.hidden = false
  dom.refreshBtn.hidden = false
  const listPanel = dom.batchList?.closest(".batch-list-panel")
  if (listPanel) listPanel.hidden = false
  const workspace = dom.batchDetail?.closest(".batch-workspace")
  if (workspace) workspace.style.removeProperty("grid-template-columns")
  renderViewTabs()
  return true
}

function renderUnauthorized() {
  dom.pageContext.textContent = "Acceso restringido"
  dom.viewTabs.hidden = true
  dom.createBatchBtn.hidden = true
  dom.directorConfigBtn.hidden = true
  dom.refreshBtn.hidden = true
  const listPanel = dom.batchList?.closest(".batch-list-panel")
  if (listPanel) listPanel.hidden = true
  const workspace = dom.batchDetail?.closest(".batch-workspace")
  if (workspace) workspace.style.gridTemplateColumns = "1fr"
  dom.batchDetail.innerHTML = `<div class="batch-empty" role="status"><h2 style="font-size:16px;color:var(--text-1);margin-bottom:7px">Acceso restringido</h2><p style="margin:0 auto 16px;max-width:520px">No tienes permisos para administrar o autorizar cortes semanales.</p><a class="primary-btn" style="display:inline-flex;text-decoration:none" href="./dashboard.html">Volver al dashboard</a></div>`
}

async function loadReferenceData() {
  if (!state.isFinance) return
  let companyQuery = supabaseClient.from("companies").select("id,name,legal_name,active").eq("active", true).order("name")
  if (state.companyScopeId) companyQuery = companyQuery.eq("id", state.companyScopeId)
  const companies = await companyQuery
  if (companies.error) throw companies.error
  state.companies = asArray(companies.data)
  if (state.companyScopeId && state.companies.length !== 1) throw new Error("selected_company_not_available")
  state.companyScopeName = state.companies.find((company) => company.id === state.companyScopeId)?.legal_name
    || state.companies.find((company) => company.id === state.companyScopeId)?.name
    || ""
  fillCompanyOptions()
  await loadCompanySettings()
}

async function loadCompanySettings() {
  state.companySettingsLoaded = false
  let settingsQuery = supabaseClient
    .from("approval_batch_company_settings")
    .select("company_id,regular_payments_require_closed_batch,enforcement_started_at,enabled_by,enabled_at,updated_at")
  if (state.companyScopeId) settingsQuery = settingsQuery.eq("company_id", state.companyScopeId)
  const { data, error } = await settingsQuery
  if (error) {
    state.companySettings = []
    syncEnforcementControl()
    return
  }
  const rows = data || []
  const enabledByIds = [...new Set(rows.map((row) => row.enabled_by).filter(Boolean))]
  let actorNames = new Map()
  if (enabledByIds.length) {
    const profiles = await supabaseClient.from("profiles").select("id,full_name,email").in("id", enabledByIds)
    actorNames = new Map((profiles.data || []).map((profile) => [profile.id, profile.full_name || profile.email || "Finanzas"]))
  }
  state.companySettings = rows.map((row) => ({
    ...row,
    enabled_by_name: actorNames.get(row.enabled_by) || "Finanzas",
  }))
  state.companySettingsLoaded = true
  syncEnforcementControl()
}

async function loadDirectors() {
  if (!state.isFinance) return
  const { data, error } = await supabaseClient.rpc("list_company_directors", { p_company_id: state.companyScopeId || null })
  if (error) return showToast("No se cargaron directores", friendlyError(error), "warning")
  state.directors = scopeCompanyRows(data)
  fillCreateDirectors()
  renderDirectorList()
}

async function loadDirectorCandidates(companyId = null) {
  if (!state.isFinance) return
  const requestedCompanyId = state.companyScopeId || companyId || null
  const { data, error } = await supabaseClient.rpc("list_approval_batch_director_candidates", { p_company_id: requestedCompanyId })
  if (error) {
    state.directorCandidates = []
    fillProfileOptions()
    return showToast("No se cargaron candidatos", friendlyError(error), "warning")
  }
  state.directorCandidates = asArray(data)
  fillProfileOptions()
}

async function loadBatches() {
  dom.refreshBtn.disabled = true
  try {
    const rpc = state.view === "finance" ? "list_finance_approval_batches" : "list_director_approval_batches"
    const { data, error } = await supabaseClient.rpc(rpc, { p_status: null })
    if (error) throw error
    state.batches = scopeCompanyRows(data)
    if (state.companyScopeId && !state.companyScopeName && state.batches.length) {
      state.companyScopeName = state.batches[0].company_name || ""
    }
    if (state.view === "director") {
      state.batches.sort((a, b) => Number(b.status === "submitted") - Number(a.status === "submitted") || String(b.created_at || "").localeCompare(String(a.created_at || "")))
    }
    if (state.selectedId && !state.batches.some((batch) => batch.id === state.selectedId)) {
      state.selectedId = null
      state.detail = null
    }
    renderViewTabs()
    renderBatchList()
    const selectedExists = state.batches.some((batch) => batch.id === state.selectedId)
    if (selectedExists) await openBatch(state.selectedId)
    else if (state.batches.length) await openBatch(state.batches[0].id)
    if (!state.batches.length) renderEmptyDetail("No hay cortes disponibles en esta vista.")
  } catch (error) {
    state.batches = []
    renderBatchList()
    renderEmptyDetail(friendlyError(error))
    showToast("No se pudieron cargar cortes", friendlyError(error), "error")
  } finally {
    dom.refreshBtn.disabled = false
  }
}

async function refreshAll() {
  await loadCompanySettings()
  await loadDirectors()
  await loadBatches()
  await loadRegularizations()
}

async function loadRegularizations() {
  if (!state.isAuthorized || !dom.regularizationList) return
  const { data, error } = await supabaseClient.rpc("list_extraordinary_regularizations", {
    p_company_id: state.companyScopeId || null,
  })
  if (error) {
    state.regularizations = []
    renderRegularizations()
    return showToast("No se cargaron contingencias", friendlyError(error), "warning")
  }
  state.regularizations = scopeCompanyRows(data)
  renderRegularizations()
}

function renderRegularizations() {
  const rows = state.regularizations
  const pending = rows.filter((row) => row.status === "consumed_pending_ratification").length
  dom.regularizationCount.textContent = `${pending} ${pending === 1 ? "pendiente" : "pendientes"}`
  dom.regularizationCount.className = `badge ${pending ? "warning" : "success"}`
  if (!rows.length) {
    dom.regularizationList.innerHTML = `<div class="regularization-empty">No hay contingencias consumidas por ratificar.</div>`
    return
  }
  dom.regularizationList.innerHTML = rows.map((row) => {
    const actions = [
      row.evidence_present
        ? `<button class="secondary-btn" type="button" data-regularization-action="evidence" data-authorization-id="${escapeHtml(row.authorization_id)}">Ver evidencia</button>`
        : "",
      row.can_decide && row.status === "consumed_pending_ratification"
        ? `<button class="secondary-btn" type="button" data-regularization-action="dispute" data-authorization-id="${escapeHtml(row.authorization_id)}">Registrar discrepancia</button><button class="primary-btn" type="button" data-regularization-action="ratify" data-authorization-id="${escapeHtml(row.authorization_id)}">Ratificar</button>`
        : "",
    ].join("")
    return `<div class="regularization-row"><div><strong>${escapeHtml(row.request_number || "Solicitud")}</strong><small>${escapeHtml(formatMoney(row.amount, row.currency))}</small></div><div><strong>${escapeHtml(extraordinaryCategoryLabel(row.category))}</strong><small>${escapeHtml(regularizationStatusLabel(row.status))}</small></div><div><strong>Consumida ${escapeHtml(formatDateTime(row.consumed_at))}</strong><small>${row.ratification_overdue_at ? "Vencida tras 2 cortes reales" : `Cortes reales transcurridos: ${Number(row.ratification_cut_count || 0)} de 2`}</small></div><div class="regularization-actions">${actions}</div></div>`
  }).join("")
}

async function handleRegularizationAction(event) {
  const button = event.target.closest("[data-regularization-action]")
  if (!button || state.mutating) return
  const row = state.regularizations.find((item) => item.authorization_id === button.dataset.authorizationId)
  if (!row) return
  if (button.dataset.regularizationAction === "evidence") {
    await openRegularizationEvidence(row)
    return
  }
  openRegularizationDialog(row, button.dataset.regularizationAction)
}

async function openRegularizationEvidence(row) {
  try {
    const { data: access, error: accessError } = await supabaseClient.rpc(
      "get_extraordinary_authorization_evidence_access",
      { p_authorization_id: row.authorization_id },
    )
    if (accessError) throw accessError
    const { data: signed, error: signedError } = await supabaseClient.storage
      .from(access.storage_bucket)
      .createSignedUrl(access.storage_path, Number(access.url_ttl_seconds || 120))
    if (signedError) throw signedError
    const link = document.createElement("a")
    link.href = signed.signedUrl
    link.target = "_blank"
    link.rel = "noopener noreferrer"
    link.click()
  } catch (error) {
    showToast("No se abrió la evidencia", friendlyError(error), "error")
  }
}

function openRegularizationDialog(row, decision) {
  if (!row.can_decide || !["ratify", "dispute"].includes(decision)) return
  state.regularization = row
  state.regularizationDecision = decision
  dom.regularizationForm.reset()
  const isDispute = decision === "dispute"
  dom.regularizationDialogTitle.textContent = isDispute ? "Registrar discrepancia" : "Ratificar contingencia"
  dom.regularizationDialogSubtitle.textContent = isDispute
    ? "La confirmación del pago permanecerá bloqueada."
    : "La ratificación habilita la confirmación posterior; no confirma el pago."
  dom.regularizationSummary.innerHTML = `<strong>${escapeHtml(row.request_number || "Solicitud")}</strong>${escapeHtml(formatMoney(row.amount, row.currency))}<br>${escapeHtml(extraordinaryCategoryLabel(row.category))} · consumida ${escapeHtml(formatDateTime(row.consumed_at))}`
  dom.regularizationNote.required = isDispute
  dom.regularizationNote.minLength = isDispute ? 20 : 0
  dom.regularizationNote.placeholder = isDispute
    ? "Explica la discrepancia en al menos 20 caracteres."
    : "Nota opcional de ratificación."
  dom.submitRegularizationBtn.textContent = isDispute ? "Registrar discrepancia" : "Ratificar"
  dom.regularizationDialog.showModal()
  dom.regularizationNote.focus()
}

async function submitRegularization(event) {
  event.preventDefault()
  if (state.mutating || !state.regularization || !state.regularizationDecision) return
  const note = dom.regularizationNote.value.trim()
  if (state.regularizationDecision === "dispute" && note.length < 20) {
    dom.regularizationNote.focus()
    return showToast("Motivo requerido", "Explica la discrepancia en al menos 20 caracteres.", "warning")
  }
  state.mutating = true
  dom.submitRegularizationBtn.disabled = true
  dom.closeRegularizationBtn.disabled = true
  dom.cancelRegularizationBtn.disabled = true
  try {
    const rpc = state.regularizationDecision === "dispute"
      ? "dispute_extraordinary_authorization"
      : "ratify_extraordinary_authorization"
    const params = {
      p_authorization_id: state.regularization.authorization_id,
      p_idempotency_key: `regularization:${state.regularization.authorization_id}:${state.regularizationDecision}:${crypto.randomUUID()}`,
      ...(state.regularizationDecision === "dispute"
        ? { p_reason: note }
        : { p_note: note || null }),
    }
    const { error } = await supabaseClient.rpc(rpc, params)
    if (error) throw error
    dom.regularizationDialog.close()
    showToast(
      state.regularizationDecision === "dispute" ? "Discrepancia registrada" : "Contingencia ratificada",
      state.regularizationDecision === "dispute"
        ? "La confirmación del pago sigue bloqueada."
        : "La ratificación quedó auditada; no se confirmó ningún pago.",
      state.regularizationDecision === "dispute" ? "warning" : "success",
    )
    state.regularization = null
    state.regularizationDecision = null
    await loadRegularizations()
  } catch (error) {
    showToast("No se guardó la decisión", friendlyError(error), "error")
  } finally {
    state.mutating = false
    dom.submitRegularizationBtn.disabled = false
    dom.closeRegularizationBtn.disabled = false
    dom.cancelRegularizationBtn.disabled = false
  }
}

function regularizationStatusLabel(status) {
  return ({
    consumed_pending_ratification: "Ratificación pendiente",
    ratified: "Ratificada",
    disputed: "Con discrepancia",
  })[status] || status || "Sin estado"
}

function extraordinaryCategoryLabel(value) {
  return ({
    operational_emergency: "Emergencia operativa / fuga",
    urgent_reimbursement: "Reembolso urgente",
    urgent_termination: "Desvinculación o finiquito urgente",
    critical_service: "Servicio crítico",
    other: "Otro",
  })[value] || value || "Sin categoría"
}

function renderViewTabs() {
  dom.viewTabs.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view)
    if (button.dataset.view === "finance") button.hidden = !state.isFinance
  })
  dom.createBatchBtn.hidden = !state.isFinance || state.view !== "finance"
  dom.directorConfigBtn.hidden = !state.isFinance || state.view !== "finance"
  const context = state.view === "finance" ? "Preparacion por Finanzas" : "Decision de Direccion"
  dom.pageContext.textContent = state.companyScopeName ? `${context} · ${state.companyScopeName}` : context
}

function renderBatchList() {
  const search = normalize(dom.batchSearch.value)
  const status = dom.batchStatusFilter.value
  const rows = state.batches.filter((batch) => {
    const haystack = normalize(`${batch.label} ${batch.company_name} ${batch.director_name || ""}`)
    return (!search || haystack.includes(search)) && (!status || batch.status === status)
  })
  if (!rows.length) {
    dom.batchList.innerHTML = `<div class="batch-empty">No hay cortes para los filtros actuales.</div>`
    return
  }
  dom.batchList.innerHTML = rows.map((batch) => `
    <button class="batch-list-item ${batch.id === state.selectedId ? "active" : ""} ${state.view === "director" && batch.status === "submitted" ? "attention" : ""}" type="button" data-batch-id="${escapeHtml(batch.id)}">
      <span class="batch-list-head"><strong>${escapeHtml(batch.label)}</strong>${statusBadge(batch.status)}</span>
      <span class="batch-list-meta"><span>${escapeHtml(batch.company_name || "Sin empresa")}</span><span>${formatDate(batch.period_end)}</span></span>
      <span class="batch-list-meta"><span>${Number(batch.item_count || 0)} solicitudes</span><span>${escapeHtml(formatCurrencyTotals(asArray(batch.totals_by_currency)))}</span></span>
      ${state.view === "director" && batch.status === "submitted" ? `<span class="batch-list-meta"><strong>Pendiente de decision</strong></span>` : ""}
    </button>
  `).join("")
}

async function openBatch(batchId) {
  const listedBatch = state.batches.find((batch) => batch.id === batchId)
  if (!listedBatch || !isWithinCompanyScope(listedBatch)) {
    state.selectedId = null
    state.detail = null
    renderBatchList()
    renderEmptyDetail("Este corte no pertenece a la empresa seleccionada.")
    return
  }
  if (state.selectedId !== batchId) state.selectedEligibleIds.clear()
  state.selectedId = batchId
  renderBatchList()
  dom.batchDetail.innerHTML = `<div class="batch-empty">Cargando detalle...</div>`
  try {
    const { data, error } = await supabaseClient.rpc("get_approval_batch_detail", { p_batch_id: batchId })
    if (error) throw error
    state.detail = data || { batch: null, items: [] }
    if (!isWithinCompanyScope(state.detail.batch)) throw new Error("batch_company_scope_mismatch")
    state.eligible = []
    state.ineligible = []
    if (state.isFinance && state.detail.batch?.status === "draft") {
      const eligible = await supabaseClient.rpc("list_batch_eligible_requests", { p_company_id: state.detail.batch.company_id })
      if (eligible.error) throw eligible.error
      const included = new Set(asArray(state.detail.items).map((item) => item.payment_request_id))
      const candidates = asArray(eligible.data).filter((item) => !included.has(item.id))
      state.eligible = candidates.filter((item) => item.eligible !== false)
      state.ineligible = candidates.filter((item) => item.eligible === false)
      const eligibleIds = new Set(state.eligible.map((item) => item.id))
      state.selectedEligibleIds = new Set(Array.from(state.selectedEligibleIds).filter((id) => eligibleIds.has(id)))
    }
    renderDetail()
  } catch (error) {
    renderEmptyDetail(friendlyError(error))
    showToast("No se pudo abrir el corte", friendlyError(error), "error")
  }
}

function renderDetail() {
  const batch = state.detail?.batch
  const items = asArray(state.detail?.items)
  if (!batch) return renderEmptyDetail("No hay detalle disponible.")
  const currencyTotals = totalsByCurrency(items)
  const approved = items.filter((item) => item.director_status === "approved").length
  const rejected = items.filter((item) => item.director_status === "rejected").length
  const pending = items.filter((item) => item.director_status === "pending").length
  dom.batchDetail.innerHTML = `
    <div class="batch-detail-head">
      <div><h2>${escapeHtml(batch.label)}</h2><div class="batch-list-meta"><span>${escapeHtml(batch.company_name)}</span><span>${formatDate(batch.period_start)} - ${formatDate(batch.period_end)}</span><span>Director: ${escapeHtml(batch.director_name || "Sin asignar")}</span></div></div>
      <div class="batch-detail-actions">${detailActions(batch, items)}</div>
    </div>
    <div class="batch-metrics">${metric("Solicitudes", items.length)}${metric(currencyTotals.length > 1 ? "Varias monedas" : "Total", formatCurrencyTotals(currencyTotals))}${metric("Pendientes", pending)}${metric("Aprobadas / rechazadas", `${approved} / ${rejected}`)}</div>
    ${renderStatusBanner(batch, items)}
    ${renderDecisionBar(batch, items)}
    ${renderBreakdowns(items)}
    ${batch.notes ? `<div class="batch-section"><div class="batch-list-meta">Notas</div><div>${escapeHtml(batch.notes)}</div></div>` : ""}
    <div class="batch-section batch-section-focus" id="batchItemsSection" tabindex="-1"><div class="batch-section-head"><h3>Solicitudes del corte</h3><span class="batch-list-meta">${escapeHtml(statusLabel(batch.status))}</span></div>${renderItemsTable(batch, items)}</div>
    ${state.isFinance && batch.status === "draft" ? `${renderEligibleSection()}${renderIneligibleSection()}` : ""}
  `
  syncEligibleSelectionUi()
  syncDecisionUi()
}

function detailActions(batch, items) {
  const actions = [
    `<button class="secondary-btn" type="button" data-detail-action="csv">CSV</button>`,
    `<button class="secondary-btn" type="button" data-detail-action="pdf">PDF</button>`,
  ]
  if (state.isFinance && batch.status === "draft") actions.push(`<button class="primary-btn" type="button" data-detail-action="submit" aria-describedby="sendBatchHelp" title="${items.length ? `Enviar ${items.length} solicitudes a ${escapeHtml(batch.director_name || "Direccion")}` : "Agrega solicitudes antes de enviar"}" ${items.length && !state.addingProgress ? "" : "disabled"}>Enviar ${items.length} a Direccion</button><span class="batch-action-help" id="sendBatchHelp">${items.length ? `Se enviaran ${items.length} solicitudes a ${escapeHtml(batch.director_name || "Direccion")}.` : "Agrega al menos una solicitud para habilitar el envio."}</span>`)
  const hasApprovedItems = items.some((item) => item.director_status === "approved")
  if (state.isFinance && hasApprovedItems && ["approved", "partially_approved"].includes(batch.status)) actions.push(`<button class="primary-btn" type="button" data-detail-action="close">Liberar para pago</button>`)
  return actions.join("")
}

function renderStatusBanner(batch, items) {
  if (batch.status === "submitted") {
    return `<div class="batch-status-banner info"><div><strong>Corte enviado a Direccion</strong><span>Pendiente de decision de ${escapeHtml(batch.director_name || "la persona directora")}.</span></div><span>${escapeHtml(formatDateTime(batch.submitted_at))}</span></div>`
  }
  if (batch.status === "approved") {
    return `<div class="batch-status-banner success"><div><strong>Direccion aprobo</strong><span>${items.length} solicitudes esperan el cierre de Finanzas antes de continuar a pago.</span></div><span>${escapeHtml(formatDateTime(batch.decided_at))}</span></div>`
  }
  if (batch.status === "partially_approved") {
    const approved = items.filter((item) => item.director_status === "approved").length
    const rejected = items.filter((item) => item.director_status === "rejected").length
    if (!approved) {
      return `<div class="batch-status-banner warning"><div><strong>Direccion rechazo todas las solicitudes</strong><span>${rejected} solicitudes permanecen bloqueadas. Finanzas puede corregirlas y enviarlas nuevamente.</span></div><span>${escapeHtml(formatDateTime(batch.decided_at))}</span></div>`
    }
    return `<div class="batch-status-banner warning"><div><strong>Direccion decidio con rechazos</strong><span>${approved} aprobadas esperan cierre y ${rejected} permanecen bloqueadas con su motivo.</span></div><span>${escapeHtml(formatDateTime(batch.decided_at))}</span></div>`
  }
  if (batch.status === "closed") {
    const approved = items.filter((item) => item.director_status === "approved").length
    const rejected = items.filter((item) => item.director_status === "rejected").length
    return `<div class="batch-status-banner success"><div><strong>Liberado para pago</strong><span>${approved} pagos pueden continuar y ${rejected} permanecen rechazados.</span></div><span>${escapeHtml(formatDateTime(batch.closed_at))}</span></div>`
  }
  return ""
}

function renderDecisionBar(batch, items) {
  const pending = items.filter((item) => item.director_status === "pending")
  if (!batch.can_director_decide || batch.status !== "submitted" || !pending.length) return ""
  return `<div class="batch-decision-bar" aria-label="Acciones de decision del corte">
    <div class="batch-decision-copy"><strong>${pending.length} solicitudes pendientes</strong><span>${escapeHtml(formatCurrencyTotals(totalsByCurrency(pending)))}</span><span class="batch-decision-stats" data-decision-counts aria-live="polite">0 aprobadas | 0 rechazadas | ${pending.length} sin decision</span></div>
    <div class="batch-decision-actions"><button class="secondary-btn" type="button" data-detail-action="approve-all">Aprobar todo</button><button class="primary-btn" type="button" data-detail-action="save-decisions" disabled>Guardar decisiones</button></div>
  </div>`
}

function renderItemsTable(batch, items) {
  if (!items.length) return `<div class="batch-empty">Agrega solicitudes elegibles antes de enviar el corte.</div>`
  const canDecide = batch.can_director_decide && batch.status === "submitted"
  const canRemove = state.isFinance && batch.status === "draft"
  const canReleaseAny = state.isFinance && ["partially_approved", "closed"].includes(batch.status) && items.some((item) => item.director_status === "rejected" && item.rebatch_status === "blocked")
  const hasActionColumn = canRemove || canReleaseAny
  return `<div class="batch-table-wrap batch-table-scroll"><table class="batch-table"><thead><tr><th>Folio / revision</th><th>Proveedor / beneficiario</th><th>Centro / partida</th><th>Metodo</th><th>Monto</th><th>Solicitante</th><th>Decision actual</th><th>Contexto</th>${hasActionColumn ? "<th></th>" : ""}</tr></thead><tbody>${items.map((item) => `
    <tr data-item-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(item.request_number || "-")}</strong><div class="batch-inline-badges">${item.previous_item_id ? `<span class="badge warning">Reenviada</span>` : ""}<span class="badge info">${escapeHtml(reviewSequenceLabel(item.review_sequence))}</span></div></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${escapeHtml(item.cost_center || "-")}<br><span class="batch-list-meta">${escapeHtml(item.budget_category || "-")}</span></td><td>${escapeHtml(paymentMethodLabel(item.payment_method))}</td><td>${formatMoney(item.amount, item.currency)}</td><td>${escapeHtml(item.requester_name || "-")}</td><td>${canDecide && item.director_status === "pending" ? `<select class="decision-select" data-decision-item="${escapeHtml(item.id)}" aria-label="Decision para ${escapeHtml(item.request_number || "solicitud")}"><option value="">Sin decision</option><option value="approved">Aprobar</option><option value="rejected">Rechazar</option></select>` : itemDecisionBadge(batch.status, item)}</td><td>${renderItemReviewContext(item, canDecide)}</td>${hasActionColumn ? `<td>${canRemove ? `<button class="secondary-btn" type="button" data-detail-action="remove" data-item-id="${escapeHtml(item.id)}">Quitar</button>` : item.director_status === "rejected" && item.rebatch_status === "blocked" ? `<button class="secondary-btn" type="button" data-detail-action="release-rebatch" data-item-id="${escapeHtml(item.id)}">Corregir y enviar nuevamente</button>` : ""}</td>` : ""}</tr>
  `).join("")}</tbody></table></div>`
}

function renderItemReviewContext(item, canDecide) {
  if (canDecide && item.director_status === "pending") {
    const previous = item.previous_item_id
      ? `<div class="batch-review-context"><strong>Rechazo anterior</strong><span>${escapeHtml(item.previous_reject_reason || "Sin motivo registrado")}</span><small>${escapeHtml(item.previous_batch_label || "Corte anterior")} · ${escapeHtml(formatDateTime(item.previous_rejected_at))}</small><strong>Correccion reportada</strong><span>${escapeHtml(item.resubmission_note || item.previous_correction_note || "Sin detalle de correccion")}</span></div>`
      : ""
    return `${previous}<input class="reason-input" data-reason-item="${escapeHtml(item.id)}" aria-label="Motivo para ${escapeHtml(item.request_number || "solicitud")}" placeholder="Obligatorio si rechaza" disabled>`
  }
  const current = item.reject_reason ? `<span>${escapeHtml(item.reject_reason)}</span>` : `<span class="batch-list-meta">Sin motivo vigente</span>`
  const correction = item.rebatch_status === "released" || item.rebatch_release_note
    ? `<small>Correccion: ${escapeHtml(item.rebatch_release_note || item.resubmission_note || "Registrada")}</small>`
    : ""
  return `<div class="batch-review-context compact">${current}${correction}</div>`
}

function renderEligibleSection() {
  const rows = state.eligible
  const selected = rows.filter((item) => state.selectedEligibleIds.has(item.id)).length
  return `<div class="batch-section"><div class="batch-section-head"><h3>Solicitudes elegibles</h3><span class="batch-list-meta">Enviadas con presupuesto disponible y aun no ejecutadas</span></div>${rows.length ? `<div class="batch-bulk-bar" data-eligible-toolbar>
    <label class="batch-select-all"><input class="batch-check" type="checkbox" data-select-all-eligible aria-label="Seleccionar todas las solicitudes elegibles"> Seleccionar todas</label>
    <span class="batch-selection-count" data-selected-count aria-live="polite">${selected} de ${rows.length} seleccionadas</span>
    <button class="secondary-btn" type="button" data-detail-action="clear-selection" ${selected ? "" : "disabled"}>Limpiar seleccion</button>
    <button class="primary-btn" type="button" data-detail-action="add-selected" ${selected && !state.addingProgress ? "" : "disabled"}>Agregar ${selected} al corte</button>
    <span class="batch-progress" data-add-progress aria-live="polite" ${state.addingProgress ? "" : "hidden"}>${state.addingProgress ? `Agregando ${state.addingProgress.current} de ${state.addingProgress.total}...` : ""}</span>
  </div><div class="batch-table-wrap batch-table-scroll"><table class="batch-table"><thead><tr><th></th><th>Folio</th><th>Proveedor / beneficiario</th><th>Centro / partida</th><th>Metodo</th><th>Monto</th><th>Presupuesto</th><th>Origen</th><th>Solicitante</th></tr></thead><tbody>${rows.map((item) => `
    <tr class="batch-eligible-row ${state.selectedEligibleIds.has(item.id) ? "selected" : ""}" data-eligible-row data-request-id="${escapeHtml(item.id)}"><td><input class="batch-check" type="checkbox" data-eligible-id="${escapeHtml(item.id)}" aria-label="Seleccionar ${escapeHtml(item.request_number)}" ${state.selectedEligibleIds.has(item.id) ? "checked" : ""}></td><td><strong>${escapeHtml(item.request_number)}</strong></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${escapeHtml(item.cost_center || "-")}<br><span class="batch-list-meta">${escapeHtml(item.budget_category || "-")}</span></td><td>${escapeHtml(paymentMethodLabel(item.payment_method))}</td><td>${formatMoney(item.amount, item.currency)}</td><td><span class="badge success">Presupuesto disponible</span>${item.budget_available != null ? `<small class="batch-cell-note">Disponible: ${formatMoney(item.budget_available, item.currency)}</small>` : ""}</td><td>${renderOriginContext(item)}</td><td>${escapeHtml(item.requester_name || "-")}</td></tr>
  `).join("")}</tbody></table></div>` : `<div class="batch-empty">No hay solicitudes elegibles para esta empresa.</div>`}</div>`
}

function renderIneligibleSection() {
  const rows = state.ineligible
  if (!rows.length) return ""
  return `<div class="batch-section batch-ineligible-section"><div class="batch-section-head"><div><h3>Solicitudes que aun no pueden agregarse</h3><span class="batch-list-meta">El motivo viene de la validacion del servidor; no necesitas revisar la consola.</span></div><span class="badge warning">${rows.length}</span></div><div class="batch-table-wrap batch-table-scroll"><table class="batch-table"><thead><tr><th>Folio</th><th>Proveedor / beneficiario</th><th>Monto</th><th>Estado</th><th>Que falta</th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${escapeHtml(item.request_number || "-")}</strong></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${formatMoney(item.amount, item.currency)}</td><td><span class="badge ${ineligibleTone(item.classification)}">${escapeHtml(classificationLabel(item.classification))}</span></td><td>${escapeHtml(classificationReasonLabel(item))}</td></tr>`).join("")}</tbody></table></div></div>`
}

function renderOriginContext(item) {
  const origin = item.origin || "new"
  const badge = origin === "resubmission" ? "Reingreso" : origin === "material_change_review" ? "Datos actualizados" : "Nueva"
  const tone = origin === "new" ? "info" : "warning"
  const context = origin === "new"
    ? ""
    : `<small class="batch-cell-note">${escapeHtml(item.previous_reject_reason || item.previous_correction_note || item.previous_batch_label || "Requiere nueva revision")}</small>`
  return `<span class="badge ${tone}">${escapeHtml(badge)}</span><small class="batch-cell-note">${escapeHtml(reviewSequenceLabel(item.review_sequence))}</small>${context}`
}

function reviewSequenceLabel(value) {
  const sequence = Math.max(1, Number(value || 1))
  return sequence === 1 ? "Primera revision" : `Revision ${sequence}`
}

function paymentMethodLabel(value) {
  return ({
    provider_payment: "Pago a proveedor",
    transfer: "Transferencia",
    cash: "Efectivo",
    check: "Cheque",
    online_purchase: "Compra en linea",
  })[value] || value || "Sin metodo"
}

function classificationLabel(value) {
  return ({
    budget_insufficient: "Presupuesto insuficiente",
    budget_validation_required: "Validar presupuesto",
    already_in_open_batch: "En otro corte",
    pending_direction: "Pendiente de Direccion",
    rejected_by_direction: "Rechazada",
    already_authorized: "Ya autorizada",
    pending_finance_close: "Pendiente de liberacion",
    already_executed: "Ya ejecutada",
    extraordinary: "Extraordinaria",
    invalid_data: "Informacion pendiente",
  })[value] || "No elegible"
}

function classificationReasonLabel(item) {
  const missing = asArray(item.missing_fields).map((field) => ({
    company_id: "empresa",
    requested_by: "solicitante",
    proveedor_id: "proveedor",
    cost_center_id: "centro de costo",
    budget_category_id: "partida presupuestal",
    budget_month: "mes presupuestal",
    amount_requested: "importe",
    currency: "moneda",
  })[field] || field)
  if (missing.length) return `Falta: ${missing.join(", ")}.`
  return ({
    sin_disponible: "El presupuesto disponible no cubre el importe.",
    partida_no_presupuestada: "La partida no tiene presupuesto configurado.",
    budget_validation_data_missing: "Faltan datos para validar el presupuesto.",
    payment_request_in_another_open_batch: "Ya pertenece a otro corte abierto.",
    direction_rejection_requires_correction: "Registra la correccion antes de enviarla nuevamente.",
    direction_approval_already_current: "Ya tiene autorizacion vigente de Direccion.",
    finance_close_required: "Direccion ya decidio; Finanzas debe liberar el corte.",
    payment_request_already_executed: "Ya existe una ejecucion registrada.",
    extraordinary_authorization_active: "Tiene una autorizacion extraordinaria activa.",
    request_status_not_batch_eligible: "El estado actual no permite incorporarla al corte.",
    payroll_uses_separate_flow: "Nomina utiliza un flujo independiente.",
    minimum_direction_data_missing: "Faltan datos minimos para presentarla a Direccion.",
  })[item.classification_reason || item.budget_reason] || "Revisa el estado y los datos de la solicitud."
}

function ineligibleTone(classification) {
  return classification === "budget_insufficient" || classification === "rejected_by_direction" ? "danger" : "warning"
}

function renderBreakdowns(items) {
  if (!items.length) return ""
  const groups = [
    ["Metodo de pago", groupTotals(items, (item) => paymentMethodLabel(item.payment_method))],
    ["Centro de costo", groupTotals(items, (item) => item.cost_center || "Sin centro")],
    ["Empresa", groupTotals(items, (item) => item.company_name || state.detail?.batch?.company_name || "Sin empresa")],
    ["Moneda", groupTotals(items, (item) => item.currency || "MXN")],
  ]
  return `<div class="batch-section"><div class="batch-section-head"><h3>Desglose del corte</h3></div><div class="modal-grid">${groups.map(([label, rows]) => `<div><div class="batch-list-meta" style="margin-bottom:6px">${escapeHtml(label)}</div>${rows.map((row) => `<div class="batch-list-head"><span>${escapeHtml(row.label)}</span><strong>${formatMoney(row.total, row.currency)}</strong></div>`).join("")}</div>`).join("")}</div></div>`
}

function groupTotals(items, keyFor) {
  const grouped = new Map()
  items.forEach((item) => {
    const label = keyFor(item)
    const currency = item.currency || "MXN"
    const key = `${label}|${currency}`
    const current = grouped.get(key) || { label, currency, total: 0 }
    current.total += Number(item.amount || 0)
    grouped.set(key, current)
  })
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total)
}

function totalsByCurrency(items) {
  return groupTotals(items, (item) => String(item.currency || "MXN").toUpperCase())
    .map((row) => ({ currency: row.label, amount: row.total }))
}

function formatCurrencyTotals(rows) {
  if (!rows.length) return "Sin importe"
  return rows.map((row) => formatMoney(row.amount, row.currency)).join(" | ")
}

async function handleDetailAction(event) {
  const eligibleRow = event.target.closest("[data-eligible-row]")
  const interactive = event.target.closest("button,input,select,textarea,a,label")
  if (eligibleRow && !interactive && !state.mutating) {
    toggleEligibleSelection(eligibleRow.dataset.requestId)
    return
  }
  const button = event.target.closest("[data-detail-action]")
  if (!button || button.disabled || !state.selectedId || state.mutating) return
  if (button.dataset.detailAction === "clear-selection") {
    state.selectedEligibleIds.clear()
    syncEligibleSelectionUi()
    return
  }
  try {
    state.mutating = true
    button.disabled = true
    const action = button.dataset.detailAction
    if (action === "add-selected") await addSelectedRequests()
    if (action === "remove") await runRpc("remove_request_from_approval_batch", { p_batch_id: state.selectedId, p_item_id: button.dataset.itemId }, "Solicitud retirada")
    if (action === "submit") await submitBatch()
    if (action === "approve-all") await approveEntireBatch()
    if (action === "save-decisions") await saveDecisions()
    if (action === "close") await closeBatch()
    if (action === "release-rebatch") openRebatchDialog(button.dataset.itemId)
    if (action === "csv") exportCsv()
    if (action === "pdf") exportPdf()
  } catch (error) {
    showToast("No se pudo completar", friendlyError(error), "error")
  } finally {
    button.disabled = false
    state.mutating = false
  }
}

function handleDetailChange(event) {
  const eligible = event.target.closest("[data-eligible-id]")
  if (eligible) {
    if (eligible.checked) state.selectedEligibleIds.add(eligible.dataset.eligibleId)
    else state.selectedEligibleIds.delete(eligible.dataset.eligibleId)
    syncEligibleSelectionUi()
    return
  }
  if (event.target.matches("[data-select-all-eligible]")) {
    state.selectedEligibleIds.clear()
    if (event.target.checked) state.eligible.forEach((item) => state.selectedEligibleIds.add(item.id))
    syncEligibleSelectionUi()
    return
  }
  if (event.target.matches("[data-decision-item]")) syncDecisionUi()
}

function handleDetailInput(event) {
  if (event.target.matches("[data-reason-item]")) syncDecisionUi()
}

function toggleEligibleSelection(requestId) {
  if (!requestId || state.addingProgress) return
  if (state.selectedEligibleIds.has(requestId)) state.selectedEligibleIds.delete(requestId)
  else state.selectedEligibleIds.add(requestId)
  syncEligibleSelectionUi()
}

function syncEligibleSelectionUi() {
  if (!dom.batchDetail) return
  const validIds = new Set(state.eligible.map((item) => item.id))
  state.selectedEligibleIds = new Set(Array.from(state.selectedEligibleIds).filter((id) => validIds.has(id)))
  const selected = state.selectedEligibleIds.size
  const total = state.eligible.length
  const busy = Boolean(state.addingProgress)
  dom.batchDetail.querySelectorAll("[data-eligible-id]").forEach((input) => {
    input.checked = state.selectedEligibleIds.has(input.dataset.eligibleId)
    input.disabled = busy
    input.closest("[data-eligible-row]")?.classList.toggle("selected", input.checked)
  })
  const master = dom.batchDetail.querySelector("[data-select-all-eligible]")
  if (master) {
    master.checked = total > 0 && selected === total
    master.indeterminate = selected > 0 && selected < total
    master.setAttribute("aria-checked", master.indeterminate ? "mixed" : String(master.checked))
    master.disabled = busy
  }
  const count = dom.batchDetail.querySelector("[data-selected-count]")
  if (count) count.textContent = `${selected} de ${total} seleccionadas`
  const clear = dom.batchDetail.querySelector('[data-detail-action="clear-selection"]')
  if (clear) clear.disabled = !selected || busy
  const add = dom.batchDetail.querySelector('[data-detail-action="add-selected"]')
  if (add) {
    add.textContent = `Agregar ${selected} al corte`
    add.disabled = !selected || busy
  }
  const progress = dom.batchDetail.querySelector("[data-add-progress]")
  if (progress) {
    progress.hidden = !busy
    progress.textContent = busy ? `Agregando ${state.addingProgress.current} de ${state.addingProgress.total}...` : ""
  }
  const send = dom.batchDetail.querySelector('[data-detail-action="submit"]')
  if (send) send.disabled = busy || !asArray(state.detail?.items).length
}

function syncDecisionUi() {
  if (!dom.batchDetail) return
  const selects = Array.from(dom.batchDetail.querySelectorAll("[data-decision-item]"))
  if (!selects.length) return
  let approved = 0
  let rejected = 0
  let undecided = 0
  let invalidReasons = 0
  selects.forEach((select) => {
    const reason = dom.batchDetail.querySelector(`[data-reason-item="${select.dataset.decisionItem}"]`)
    if (select.value === "approved") approved += 1
    else if (select.value === "rejected") rejected += 1
    else undecided += 1
    if (reason) {
      const needsReason = select.value === "rejected"
      reason.disabled = !needsReason
      reason.required = needsReason
      if (!needsReason) reason.value = ""
      if (needsReason && !reason.value.trim()) invalidReasons += 1
    }
  })
  const counts = dom.batchDetail.querySelector("[data-decision-counts]")
  if (counts) counts.textContent = `${approved} aprobadas | ${rejected} rechazadas | ${undecided} sin decision`
  const save = dom.batchDetail.querySelector('[data-detail-action="save-decisions"]')
  if (save) save.disabled = state.mutating || undecided > 0 || invalidReasons > 0
}

async function addSelectedRequests() {
  const eligibleIds = new Set(state.eligible.map((item) => item.id))
  const ids = Array.from(state.selectedEligibleIds).filter((id) => eligibleIds.has(id))
  if (!ids.length) throw new Error("Selecciona al menos una solicitud.")
  let added = 0
  let failure = null
  const addedIds = new Set()
  state.addingProgress = { current: 1, total: ids.length }
  syncEligibleSelectionUi()
  for (const [index, requestId] of ids.entries()) {
    state.addingProgress.current = index + 1
    syncEligibleSelectionUi()
    try {
      const { error } = await supabaseClient.rpc("add_request_to_approval_batch", { p_batch_id: state.selectedId, p_payment_request_id: requestId })
      if (error) throw error
      added += 1
      addedIds.add(requestId)
    } catch (error) {
      failure = error
      break
    }
  }
  state.addingProgress = null
  if (failure) state.selectedEligibleIds = new Set(ids.filter((id) => !addedIds.has(id)))
  else state.selectedEligibleIds.clear()
  await reloadSelected()
  focusBatchItems()
  if (failure) {
    showToast("Incorporacion parcial", `Se agregaron ${added} de ${ids.length}. ${friendlyError(failure)}`, "warning")
    return
  }
  showToast("Solicitudes agregadas", `${added} solicitudes fueron incorporadas al corte.`, "success")
}

async function saveDecisions() {
  if (state.detail?.batch?.status !== "submitted") throw new Error("El corte ya no esta pendiente de decision.")
  const selects = Array.from(dom.batchDetail.querySelectorAll("[data-decision-item]"))
  const decisions = selects.map((select) => {
    const reason = dom.batchDetail.querySelector(`[data-reason-item="${select.dataset.decisionItem}"]`)?.value?.trim() || ""
    if (!["approved", "rejected"].includes(select.value)) throw new Error("Selecciona una decision para cada solicitud.")
    if (select.value === "rejected" && !reason) throw new Error("Captura el motivo para cada solicitud rechazada.")
    return { item_id: select.dataset.decisionItem, status: select.value, reject_reason: reason || null }
  })
  if (!decisions.length) throw new Error("No hay decisiones pendientes.")
  const itemsById = new Map(asArray(state.detail?.items).map((item) => [item.id, item]))
  const approvedItems = decisions.filter((decision) => decision.status === "approved").map((decision) => itemsById.get(decision.item_id)).filter(Boolean)
  const rejectedItems = decisions.filter((decision) => decision.status === "rejected").map((decision) => ({ ...itemsById.get(decision.item_id), reason: decision.reject_reason })).filter((item) => item.id)
  const summary = [
    confirmationRow("Aprobadas", String(approvedItems.length)),
    confirmationTotalsRows(approvedItems, "Total aprobado"),
    confirmationRow("Rechazadas", String(rejectedItems.length)),
    confirmationTotalsRows(rejectedItems, "Total rechazado"),
  ].join("")
  const rejectedDetail = rejectedItems.length ? `<div><strong>Solicitudes rechazadas</strong><div class="confirm-summary-list">${rejectedItems.map((item) => `<div><strong>${escapeHtml(item.request_number || "-")}</strong><br>${escapeHtml(item.reason)}</div>`).join("")}</div></div>` : ""
  const decisionWarning = approvedItems.length
    ? "Las solicitudes aprobadas continuaran al flujo operativo. Esta accion no se puede deshacer desde esta pantalla."
    : "Todas las solicitudes quedaran rechazadas y bloqueadas. Finanzas podra corregirlas y enviarlas nuevamente."
  const confirmed = await showConfirmation({
    title: "Guardar decisiones del corte",
    bodyHtml: `<p>Revisa las decisiones antes de guardarlas.</p><div class="confirm-summary-list">${summary}</div>${rejectedDetail}<div class="confirm-warning">${decisionWarning}</div>`,
    confirmLabel: "Guardar decisiones",
  })
  if (!confirmed) return
  await runRpc("decide_approval_batch_items", { p_batch_id: state.selectedId, p_decisions: decisions }, "Decisiones guardadas")
}

async function submitBatch() {
  const batch = state.detail?.batch
  const items = asArray(state.detail?.items)
  if (!batch || !items.length) throw new Error("Agrega al menos una solicitud antes de enviar el corte.")
  const confirmed = await showConfirmation({
    title: "Enviar corte a Direccion",
    bodyHtml: `<p>Vas a enviar ${items.length} solicitudes a ${escapeHtml(batch.director_name || "Direccion")} para autorizacion.</p><div class="confirm-summary-list">${confirmationRow("Empresa", batch.company_name || "-")}${confirmationRow("Corte", batch.label || "-")}${confirmationRow("Solicitudes", String(items.length))}${confirmationRow("Director", batch.director_name || "Sin asignar")}${confirmationTotalsRows(items, "Importe")}</div><div class="confirm-warning">El corte quedara bloqueado para edicion y pasara a decision de Direccion.</div>`,
    confirmLabel: `Enviar ${items.length} solicitudes`,
  })
  if (confirmed) await runRpc("submit_approval_batch", { p_batch_id: state.selectedId }, "Corte enviado")
}

async function approveEntireBatch() {
  const batch = state.detail?.batch
  const pending = asArray(state.detail?.items).filter((item) => item.director_status === "pending")
  if (!pending.length) throw new Error("No hay solicitudes pendientes de decision.")
  const confirmed = await showConfirmation({
    title: "Autorizar corte semanal",
    bodyHtml: `<p>Esta accion autoriza la continuacion operativa de todos los pagos del corte.</p><div class="confirm-summary-list">${confirmationRow("Empresa", batch?.company_name || "-")}${confirmationRow("Corte", batch?.label || "-")}${confirmationRow("Solicitudes", String(pending.length))}${confirmationTotalsRows(pending, "Importe")}</div><div class="confirm-warning">Confirma que revisaste el corte completo antes de aprobarlo.</div>`,
    confirmLabel: `Aprobar ${pending.length} solicitudes`,
  })
  if (confirmed) await runRpc("approve_entire_batch", { p_batch_id: state.selectedId }, "Corte aprobado")
}

async function closeBatch() {
  const items = asArray(state.detail?.items)
  const rejected = items.filter((item) => item.director_status === "rejected").length
  const { data: preview, error: previewError } = await supabaseClient.rpc("preview_approval_batch_close", {
    p_batch_id: state.selectedId,
  })
  if (previewError) throw previewError
  const ready = Number(preview?.ready_count || 0)
  const blocked = Number(preview?.blocked_count || 0)
  const pending = Number(preview?.pending_count || 0)
  if (pending > 0) throw new Error("batch_has_pending_items")
  if (!preview?.can_close || ready === 0) throw new Error("batch_no_releasable_items")
  const readyItems = asArray(preview?.ready_items)
  const blockedItems = asArray(preview?.blocked_items)
  const blockedDetail = blockedItems.length
    ? `<div><strong>Se conservarán bloqueadas</strong><div class="confirm-summary-list">${blockedItems.slice(0, 8).map((item) => `<div><strong>${escapeHtml(item.request_number || "-")}</strong><br>${escapeHtml(closeBlockReasonLabel(item.reason))}</div>`).join("")}</div></div>`
    : ""
  const confirmed = await showConfirmation({
    title: "Liberar corte para pago",
    bodyHtml: `<p>El servidor revalidó cada solicitud. Solo las vigentes se liberarán; las demás conservarán su decisión e historial.</p><div class="confirm-summary-list">${confirmationRow("Pagos por liberar", String(ready))}${confirmationRow("Bloqueadas", String(blocked))}${confirmationRow("Rechazos incluidos", String(rejected))}${confirmationTotalsRows(readyItems, "Importe por liberar")}</div>${blockedDetail}<div class="confirm-warning">Los cambios materiales requieren una nueva revisión de Dirección. Un ítem bloqueado no impide liberar los válidos.</div>`,
    confirmLabel: `Liberar ${ready} pagos`,
  })
  if (!confirmed) return
  const { data, error } = await supabaseClient.rpc("close_approval_batch", { p_batch_id: state.selectedId })
  if (error) throw error
  showToast(
    "Corte liberado",
    `${Number(data?.approved_released_count || ready)} pagos pueden continuar y ${Number(data?.blocked_count || blocked)} permanecen bloqueados.`,
    "success"
  )
  await reloadSelected()
}

function closeBlockReasonLabel(value) {
  return ({
    direction_rejected: "Rechazada por Dirección.",
    direction_pending: "Pendiente de decisión de Dirección.",
    request_data_changed_after_direction_decision: "Los datos materiales cambiaron; requiere nueva revisión.",
    direction_reapproval_required: "Existe una revisión posterior pendiente o rechazada.",
    payment_request_already_executed: "La solicitud ya tiene una ejecución registrada.",
    extraordinary_authorization_active: "La solicitud tiene una contingencia extraordinaria vigente.",
    budget_validation_required: "El presupuesto ya no es liberable.",
  })[value] || value || "No cumple la revalidación de liberación."
}

async function runRpc(name, args, successTitle) {
  const { error } = await supabaseClient.rpc(name, args)
  if (error) throw error
  showToast(successTitle, "La operacion se registro correctamente.", "success")
  await reloadSelected()
}

async function confirmAndRun(title, bodyHtml, confirmLabel, name, args, successTitle) {
  if (await showConfirmation({ title, bodyHtml, confirmLabel })) await runRpc(name, args, successTitle)
}

function showConfirmation({ title, bodyHtml, confirmLabel }) {
  if (!dom.confirmActionDialog) return Promise.resolve(false)
  if (state.confirmResolve) closeConfirmation(false)
  dom.confirmActionTitle.textContent = title
  dom.confirmActionBody.innerHTML = bodyHtml
  dom.confirmActionConfirmBtn.textContent = confirmLabel
  dom.confirmActionDialog.showModal()
  return new Promise((resolve) => { state.confirmResolve = resolve })
}

function closeConfirmation(confirmed) {
  const resolve = state.confirmResolve
  state.confirmResolve = null
  if (dom.confirmActionDialog?.open) dom.confirmActionDialog.close()
  if (resolve) resolve(Boolean(confirmed))
}

function confirmationRow(label, value) {
  return `<div class="confirm-summary-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function confirmationTotalsRows(items, label) {
  const totals = totalsByCurrency(items)
  if (!totals.length) return confirmationRow(label, "Sin importe")
  return totals.map((row) => confirmationRow(totals.length > 1 ? `${label} ${row.currency}` : label, formatMoney(row.amount, row.currency))).join("")
}

async function reloadSelected() {
  const id = state.selectedId
  await loadBatches()
  if (id) await openBatch(id)
}

function focusBatchItems() {
  const section = dom.batchDetail?.querySelector("#batchItemsSection")
  if (!section) return
  section.scrollIntoView({ behavior: "smooth", block: "start" })
  window.setTimeout(() => section.focus({ preventScroll: true }), 250)
}

function openCreateDialog() {
  setDefaultPeriod()
  fillCompanyOptions()
  fillCreateDirectors()
  dom.createBatchDialog.showModal()
}

async function createBatch(event) {
  event.preventDefault()
  const submit = dom.createBatchForm.querySelector('[type="submit"]')
  submit.disabled = true
  try {
    const companyId = dom.createCompanyId.value
    if (!companyId) throw new Error("select_company")
    if (state.companyScopeId && companyId !== state.companyScopeId) throw new Error("company_scope_mismatch")
    const { data, error } = await supabaseClient.rpc("create_approval_batch", {
      p_company_id: companyId,
      p_label: dom.createLabel.value.trim() || null,
      p_period_start: dom.createPeriodStart.value,
      p_period_end: dom.createPeriodEnd.value,
      p_director_id: dom.createDirectorId.value,
      p_notes: dom.createNotes.value.trim() || null,
    })
    if (error) throw error
    dom.createBatchDialog.close()
    dom.createBatchForm.reset()
    state.selectedId = data?.batch_id || null
    showToast("Corte creado", data?.label || "El corte quedo en borrador.", "success")
    await loadBatches()
    if (state.selectedId) await openBatch(state.selectedId)
  } catch (error) {
    showToast("No se pudo crear", friendlyError(error), "error")
  } finally {
    submit.disabled = false
  }
}

async function openDirectorDialog() {
  fillCompanyOptions()
  await loadDirectorCandidates(dom.directorCompanyId.value || null)
  fillProfileOptions()
  syncEnforcementControl()
  renderDirectorList()
  dom.directorDialog.showModal()
}

async function saveDirector(event) {
  event.preventDefault()
  if (!state.companySettingsLoaded) {
    showToast("Configuracion no disponible", "No se pudo leer el control de cierre. Recarga la pantalla antes de guardar para evitar un cambio accidental.", "warning")
    return
  }
  const submit = dom.directorForm.querySelector('[type="submit"]')
  submit.disabled = true
  try {
    const companyId = dom.directorCompanyId.value
    if (!companyId) throw new Error("select_company")
    if (state.companyScopeId && companyId !== state.companyScopeId) throw new Error("company_scope_mismatch")
    const { error } = await supabaseClient.rpc("set_company_batch_configuration", {
      p_company_id: companyId,
      p_director_profile_id: dom.directorProfileId.value,
      p_director_active: dom.directorActive.checked,
      p_enable_enforcement: Boolean(dom.batchEnforcementEnabled.checked),
    })
    if (error) throw error
    showToast("Configuracion actualizada", "Director y control de cierre quedaron guardados para la empresa.", "success")
    await loadCompanySettings()
    await loadDirectors()
  } catch (error) {
    showToast("No se pudo guardar", friendlyError(error), "error")
  } finally {
    submit.disabled = false
  }
}

function openRebatchDialog(itemId) {
  const item = asArray(state.detail?.items).find((row) => row.id === itemId)
  const companyId = state.detail?.batch?.company_id
  state.releaseItemId = itemId
  dom.rebatchNote.value = ""
  dom.rebatchOriginalReason.innerHTML = `<strong>Motivo original de Direccion</strong>${escapeHtml(item?.reject_reason || "Sin motivo registrado.")}`
  const draftBatches = state.batches.filter((batch) => batch.status === "draft" && batch.company_id === companyId && batch.id !== state.detail?.batch?.id)
  dom.rebatchTargetBatch.innerHTML = `<option value="">Dejar disponible para siguiente corte</option>${draftBatches.map((batch) => `<option value="${escapeHtml(batch.id)}">${escapeHtml(batch.label)}</option>`).join("")}`
  dom.rebatchDialog.showModal()
}

async function releaseRejectedItem(event) {
  event.preventDefault()
  if (state.mutating) return
  const note = dom.rebatchNote.value.trim()
  if (!state.releaseItemId || note.length < 10) return showToast("Nota requerida", "Explica en al menos 10 caracteres que informacion fue corregida.", "warning")
  const submit = dom.rebatchForm.querySelector('[type="submit"]')
  state.mutating = true
  submit.disabled = true
  try {
    const { data, error } = await supabaseClient.rpc("release_and_rebatch_rejected_request", {
      p_rejected_item_id: state.releaseItemId,
      p_correction_note: note,
      p_target_batch_id: dom.rebatchTargetBatch.value || null,
    })
    if (error) throw error
    dom.rebatchDialog.close()
    state.releaseItemId = null
    showToast(
      "Reingreso registrado",
      data?.new_item_id
        ? "La solicitud entro como pendiente en el nuevo corte; requiere nueva aprobacion y cierre."
        : "La solicitud quedo disponible para incorporarse a un siguiente corte.",
      "success"
    )
    await reloadSelected()
  } catch (error) {
    showToast("No se pudo habilitar", friendlyError(error), "error")
  } finally {
    submit.disabled = false
    state.mutating = false
  }
}

function fillCompanyOptions() {
  const companies = scopeCompanyRows(state.companies)
  const options = companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.legal_name || company.name)}</option>`).join("")
  ;[dom.createCompanyId, dom.directorCompanyId].forEach((select) => {
    if (!select) return
    const current = state.companyScopeId || select.value
    select.innerHTML = `<option value="">Selecciona...</option>${options}`
    if (companies.some((company) => company.id === current)) select.value = current
    select.disabled = Boolean(state.companyScopeId)
  })
}

function fillProfileOptions() {
  dom.directorProfileId.innerHTML = `<option value="">Selecciona...</option>${state.directorCandidates.map((profile) => `<option value="${escapeHtml(profile.profile_id)}">${escapeHtml(profile.name || profile.email || profile.profile_id)}</option>`).join("")}`
}

function fillCreateDirectors() {
  const companyId = dom.createCompanyId?.value
  const rows = state.directors.filter((row) => row.active && row.director_profile_active !== false && row.director_role_valid !== false && (!companyId || row.company_id === companyId))
  dom.createDirectorId.innerHTML = `<option value="">Selecciona...</option>${rows.map((row) => `<option value="${escapeHtml(row.director_profile_id)}">${escapeHtml(row.director_name || row.director_email)}</option>`).join("")}`
}

function syncEnforcementControl() {
  if (!dom.batchEnforcementEnabled) return
  dom.batchEnforcementEnabled.disabled = !state.companySettingsLoaded
  if (!state.companySettingsLoaded) {
    dom.batchEnforcementEnabled.checked = false
    dom.batchEnforcementHelp.textContent = "El control de cierre no esta disponible hasta que la configuracion 022 pueda leerse."
    return
  }
  const companyId = dom.directorCompanyId?.value
  const setting = state.companySettings.find((row) => row.company_id === companyId)
  const alreadyActivated = Boolean(setting?.enforcement_started_at)
  dom.batchEnforcementEnabled.checked = alreadyActivated || Boolean(setting?.regular_payments_require_closed_batch)
  dom.batchEnforcementEnabled.disabled = !state.companySettingsLoaded || alreadyActivated
  dom.batchEnforcementHelp.textContent = alreadyActivated
    ? `Activo desde ${formatDateTime(setting.enforcement_started_at)} por ${setting.enabled_by_name || "Finanzas"}. El control ya esta activo y no puede deshabilitarse desde el MVP.`
    : "Inactivo. Puede activarse una sola vez; las solicitudes posteriores requeriran un corte cerrado."
}

function renderDirectorList() {
  if (!dom.directorList) return
  dom.directorList.innerHTML = state.directors.length ? `<div class="batch-table-wrap"><table class="batch-table" style="min-width:620px"><thead><tr><th>Empresa</th><th>Director</th><th>Estado</th><th>Pagos regulares</th></tr></thead><tbody>${state.directors.map((row) => {
    const enforced = state.companySettings.some((setting) => setting.company_id === row.company_id && setting.regular_payments_require_closed_batch)
    return `<tr><td>${escapeHtml(row.company_name)}</td><td>${escapeHtml(row.director_name || row.director_email)}</td><td>${statusBadge(row.active && row.director_profile_active !== false && row.director_role_valid !== false ? "active" : "inactive")}</td><td>${enforced ? "Corte cerrado obligatorio" : "Compatibilidad legacy"}</td></tr>`
  }).join("")}</tbody></table></div>` : `<div class="batch-empty">No hay directores configurados.</div>`
}

function setDefaultPeriod() {
  const today = new Date()
  const end = new Date(today)
  end.setDate(today.getDate() + ((3 - today.getDay() + 7) % 7))
  const start = new Date(end)
  start.setDate(end.getDate() - 6)
  dom.createPeriodStart.value = toDateInput(start)
  dom.createPeriodEnd.value = toDateInput(end)
}

function exportCsv() {
  const batch = state.detail?.batch
  const items = asArray(state.detail?.items)
  if (!batch) return
  const header = ["corte", "empresa", "periodo_inicio", "periodo_fin", "estatus_corte", "folio", "proveedor_o_beneficiario", "centro_costo", "partida", "metodo_pago", "moneda", "monto", "solicitante", "decision_director", "motivo_rechazo", "estatus_reingreso", "nota_reingreso"]
  const rows = items.map((item) => [batch.label, batch.company_name, batch.period_start, batch.period_end, batch.status, item.request_number, item.provider_name, item.cost_center, item.budget_category, item.payment_method, item.currency, item.amount, item.requester_name, item.director_status, item.reject_reason || "", item.rebatch_status, item.rebatch_release_note || ""])
  const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  downloadBlob(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }), `${fileStem(batch)}.csv`)
}

// Wordmark Flux en verde #172d29 (300x120), embebido para el encabezado del PDF
const FLUX_PDF_LOGO = "data:image/png;base64,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"

function exportPdf() {
  const batch = state.detail?.batch
  const items = asArray(state.detail?.items)
  if (!batch || !window.jspdf?.jsPDF) return showToast("PDF no disponible", "No se cargo el generador de PDF.", "error")
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "letter" })
  const pageWidth = doc.internal.pageSize.getWidth()
  try { doc.addImage(FLUX_PDF_LOGO, "PNG", pageWidth - 36 - 80, 22, 80, 32) } catch (_) { /* sin logo si falla el decode */ }
  doc.setTextColor(23, 45, 41)
  doc.setFontSize(15)
  doc.text(batch.label, 36, 36)
  doc.setFontSize(9)
  doc.setTextColor(96, 110, 104)
  doc.text(`${batch.company_name} | ${batch.period_start} a ${batch.period_end} | ${statusLabel(batch.status)}`, 36, 53)
  doc.autoTable({
    startY: 68,
    head: [["Folio", "Proveedor / beneficiario", "Centro / partida", "Metodo", "Monto", "Solicitante", "Decision", "Motivo"]],
    body: items.map((item) => [item.request_number, item.provider_name || "-", `${item.cost_center || "-"}\n${item.budget_category || "-"}`, item.payment_method || "-", formatMoney(item.amount, item.currency), item.requester_name || "-", statusLabel(item.director_status), `${item.reject_reason || "-"}${item.rebatch_release_note ? `\nReingreso: ${item.rebatch_release_note}` : ""}`]),
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak", textColor: [21, 33, 29] },
    headStyles: { fillColor: [23, 45, 41], textColor: [247, 247, 245] },
    alternateRowStyles: { fillColor: [244, 246, 241] },
    didDrawPage: () => {
      doc.setFontSize(7.5)
      doc.setTextColor(150, 160, 155)
      doc.text("Flux Operadora — corte semanal", 36, doc.internal.pageSize.getHeight() - 18)
    },
  })
  doc.save(`${fileStem(batch)}.pdf`)
}

function fileStem(batch) {
  const company = String(batch.company_name || "empresa").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()
  return `corte-semanal-${company}-${batch.period_end}`
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function renderEmptyDetail(message) { dom.batchDetail.innerHTML = `<div class="batch-empty">${escapeHtml(message)}</div>` }
function metric(label, value) { return `<div class="batch-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>` }

function statusBadge(status) {
  const tone = ["approved", "closed", "active", "sent"].includes(status) ? "success" : ["rejected", "partially_approved", "inactive"].includes(status) ? "danger" : ["submitted", "pending"].includes(status) ? "warning" : "info"
  return `<span class="badge ${tone}">${escapeHtml(statusLabel(status))}</span>`
}

function itemDecisionBadge(batchStatus, item) {
  const itemStatus = item?.director_status
  if (itemStatus === "rejected") return `<span class="badge danger">Rechazada por Dirección</span>`
  if (itemStatus === "approved" && batchStatus === "closed") return `<span class="badge success">Aprobada y liberada para pago</span>`
  if (itemStatus === "approved" && ["approved", "partially_approved"].includes(batchStatus)) {
    return `<span class="badge success">Dirección aprobó &middot; pendiente de liberación</span>`
  }
  if (itemStatus === "pending" && batchStatus === "submitted") return `<span class="badge warning">Pendiente de decisión de Dirección</span>`
  return statusBadge(itemStatus)
}

function statusLabel(status) {
  return ({ draft: "Borrador", submitted: "Pendiente de decisión de Dirección", approved: "Dirección aprobó · pendiente de liberación", partially_approved: "Dirección decidió con rechazos", closed: "Liberado para pago", pending: "Pendiente", rejected: "Rechazada por Dirección", active: "Activo", inactive: "Inactivo" })[status] || String(status || "-")
}

function formatMoney(value, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN", maximumFractionDigits: 2 }).format(Number(value || 0))
}

function formatDate(value) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${String(value).slice(0, 10)}T12:00:00`))
}

function formatDateTime(value) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

function toDateInput(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"` }
function asArray(value) { return Array.isArray(value) ? value : [] }
function normalize(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() }

function friendlyError(error) {
  const raw = String(error?.message || error || "Error no identificado")
  const known = {
    finance_role_required: "Se requiere rol de Finanzas.",
    selected_company_not_available: "La empresa seleccionada no esta activa o no esta disponible para esta vista.",
    company_scope_mismatch: "La operacion no corresponde a la empresa seleccionada.",
    batch_company_scope_mismatch: "El corte solicitado pertenece a otra empresa.",
    select_company: "Selecciona una empresa antes de continuar.",
    batch_director_required: "Solo el director asignado puede decidir este corte.",
    company_director_required: "Configura un director activo para la empresa.",
    select_company_director: "Selecciona uno de los directores activos.",
    batch_requires_items: "Agrega al menos una solicitud al corte.",
    payment_request_not_batch_eligible: "La solicitud ya no es elegible para este corte.",
    payment_request_in_another_open_batch: "La solicitud ya pertenece a otro corte abierto.",
    reject_reason_required: "El motivo de rechazo es obligatorio.",
    director_role_required: "El perfil seleccionado no tiene un rol activo de Direccion.",
    rebatch_release_note_required: "La nota de reingreso es obligatoria.",
    rebatch_correction_note_too_short: "Explica en al menos 10 caracteres que se corrigio.",
    batch_item_already_released: "Esta solicitud ya fue habilitada para otro corte.",
    batch_requires_at_least_one_approved_item: "El corte debe conservar al menos una solicitud aprobada.",
    batch_no_releasable_items: "Ninguna solicitud conserva una autorización vigente para liberarse. Corrige o envía las afectadas a una nueva revisión.",
    batch_has_pending_items: "Dirección aún no decide todas las solicitudes del corte.",
    registered_external_director_required: "Solo el Director externo registrado y todavía activo puede decidir esta contingencia.",
    extraordinary_authorization_not_pending_ratification: "La contingencia ya no está pendiente de ratificación.",
    ratification_window_elapsed: "La ventana de ratificación terminó. La confirmación permanece bloqueada.",
    extraordinary_authorization_materially_stale: "La solicitud cambió después de la autorización externa.",
    dispute_reason_too_short: "Explica la discrepancia en al menos 20 caracteres.",
    extraordinary_evidence_access_denied: "No tienes permiso para consultar esta evidencia.",
    extraordinary_evidence_not_finalized: "La evidencia aún no está finalizada.",
    finance_reapproval_required: "La solicitud cambio despues de la decision anterior. El sistema debe revalidar presupuesto y Direccion debe revisarla nuevamente.",
    request_data_changed_after_direction_decision: "Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.",
    direction_reapproval_required: "La autorizacion de Direccion ya no esta vigente. La solicitud debe enviarse nuevamente a un corte.",
    payment_request_already_executed: "La solicitud ya tiene una ejecucion registrada.",
    extraordinary_authorization_active: "La solicitud tiene una autorizacion extraordinaria activa y no puede liberarse en este corte.",
    batch_close_validation_failed: "El corte no se libero porque una solicitud ya no supera la revalidacion de presupuesto o de Direccion.",
    batch_contains_ineligible_request: "El corte contiene una solicitud que ya no cumple presupuesto, datos o estado. Actualiza el detalle para identificarla.",
    batch_enforcement_cannot_be_disabled_in_mvp: "El control ya esta activo y no puede deshabilitarse desde el MVP.",
    target_batch_must_be_draft: "El corte destino ya no esta en borrador.",
    target_batch_company_mismatch: "El corte destino pertenece a otra empresa.",
    payment_request_already_in_target_batch: "La solicitud ya esta en el corte destino.",
  }
  const key = Object.keys(known).find((item) => raw.includes(item))
  return key ? known[key] : raw
}

function showToast(title, message, type = "success") {
  const variants = { error: "danger", warning: "warning", success: "success", info: "info" }
  if (window.Components?.showToast) {
    window.Components.showToast({ title: escapeHtml(title), desc: escapeHtml(message), variant: variants[type] || "info", duration: 6 })
    return
  }
  const stack = document.getElementById("toastStack") || document.body
  const toast = document.createElement("div")
  toast.className = `toast-v2 ${variants[type] || "info"}`
  toast.setAttribute("role", type === "error" ? "alert" : "status")
  const heading = document.createElement("strong")
  heading.textContent = title
  const description = document.createElement("span")
  description.textContent = message
  toast.append(heading, description)
  stack.appendChild(toast)
  window.setTimeout(() => toast.remove(), 6000)
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char])
}
