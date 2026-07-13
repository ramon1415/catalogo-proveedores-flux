const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  isFinance: false,
  isDirector: false,
  view: "finance",
  batches: [],
  selectedId: null,
  detail: null,
  eligible: [],
  companies: [],
  directorCandidates: [],
  directors: [],
  releaseItemId: null,
  selectedEligibleIds: new Set(),
  addingProgress: null,
  confirmResolve: null,
  mutating: false,
}
const dom = {}

document.addEventListener("DOMContentLoaded", init)

async function init() {
  cacheDom()
  bindEvents()
  applyTheme()
  await resolveUser()
  try {
    await loadReferenceData()
    await loadDirectors()
    await loadDirectorCandidates()
    await loadBatches()
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
    "directorList", "rebatchDialog", "rebatchForm", "rebatchNote", "confirmActionDialog",
    "confirmActionTitle", "confirmActionBody", "confirmActionCloseBtn", "confirmActionCancelBtn",
    "confirmActionConfirmBtn",
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
  dom.confirmActionConfirmBtn?.addEventListener("click", () => closeConfirmation(true))
  dom.confirmActionCancelBtn?.addEventListener("click", () => closeConfirmation(false))
  dom.confirmActionCloseBtn?.addEventListener("click", () => closeConfirmation(false))
  dom.confirmActionDialog?.addEventListener("cancel", (event) => {
    event.preventDefault()
    closeConfirmation(false)
  })
  dom.createCompanyId?.addEventListener("change", fillCreateDirectors)
  dom.directorCompanyId?.addEventListener("change", () => loadDirectorCandidates(dom.directorCompanyId.value || null))
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-close-dialog]")
    if (button) document.getElementById(button.dataset.closeDialog)?.close()
  })
}

function applyTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.dataset.theme = saved
}

async function resolveUser() {
  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  state.profile = window.FluxAuth?.getProfile?.() || null
  state.isFinance = Boolean(window.FluxAuth?.isAdminFinance?.())
  state.isDirector = Boolean(window.FluxAuth?.hasRole?.(["approver_2", "aprobador_2", "direccion", "director"]))
  const session = window.FluxAuth?.state?.session
  dom.userName.textContent = state.profile?.full_name || session?.user?.email || "Usuario"
  dom.userEmail.textContent = state.profile?.email || session?.user?.email || "Sesion activa"
  state.view = state.isDirector ? "director" : "finance"
  renderViewTabs()
}

async function loadReferenceData() {
  if (!state.isFinance) return
  const companies = await supabaseClient.from("companies").select("id,name,legal_name,active").eq("active", true).order("name")
  if (companies.error) throw companies.error
  state.companies = companies.data || []
  fillCompanyOptions()
}

async function loadDirectors() {
  if (!state.isFinance) return
  const { data, error } = await supabaseClient.rpc("list_company_directors", { p_company_id: null })
  if (error) return showToast("No se cargaron directores", friendlyError(error), "warning")
  state.directors = asArray(data)
  fillCreateDirectors()
  renderDirectorList()
}

async function loadDirectorCandidates(companyId = null) {
  if (!state.isFinance) return
  const { data, error } = await supabaseClient.rpc("list_approval_batch_director_candidates", { p_company_id: companyId || null })
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
    state.batches = asArray(data)
    if (state.view === "director") {
      state.batches.sort((a, b) => Number(b.status === "submitted") - Number(a.status === "submitted") || String(b.created_at || "").localeCompare(String(a.created_at || "")))
    }
    if (state.selectedId && !state.batches.some((batch) => batch.id === state.selectedId)) {
      state.selectedId = null
      state.detail = null
    }
    renderViewTabs()
    renderBatchList()
    if (!state.selectedId && state.batches.length) await openBatch(state.batches[0].id)
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
  await loadDirectors()
  await loadBatches()
  if (state.selectedId) await openBatch(state.selectedId)
}

function renderViewTabs() {
  dom.viewTabs.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view)
    if (button.dataset.view === "finance") button.hidden = !state.isFinance
  })
  dom.createBatchBtn.hidden = !state.isFinance || state.view !== "finance"
  dom.directorConfigBtn.hidden = !state.isFinance || state.view !== "finance"
  dom.pageContext.textContent = state.view === "finance" ? "Preparacion por Finanzas" : "Decision de Direccion"
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
  if (state.selectedId !== batchId) state.selectedEligibleIds.clear()
  state.selectedId = batchId
  renderBatchList()
  dom.batchDetail.innerHTML = `<div class="batch-empty">Cargando detalle...</div>`
  try {
    const { data, error } = await supabaseClient.rpc("get_approval_batch_detail", { p_batch_id: batchId })
    if (error) throw error
    state.detail = data || { batch: null, items: [] }
    state.eligible = []
    if (state.isFinance && state.detail.batch?.status === "draft") {
      const eligible = await supabaseClient.rpc("list_batch_eligible_requests", { p_company_id: state.detail.batch.company_id })
      if (eligible.error) throw eligible.error
      const included = new Set(asArray(state.detail.items).map((item) => item.payment_request_id))
      state.eligible = asArray(eligible.data).filter((item) => !included.has(item.id))
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
    ${state.isFinance && batch.status === "draft" ? renderEligibleSection() : ""}
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
  if (state.isFinance && ["approved", "partially_approved"].includes(batch.status)) actions.push(`<button class="primary-btn" type="button" data-detail-action="close">Cerrar corte</button>`)
  return actions.join("")
}

function renderStatusBanner(batch, items) {
  if (batch.status === "submitted") {
    return `<div class="batch-status-banner info"><div><strong>Corte enviado a Direccion</strong><span>Pendiente de decision de ${escapeHtml(batch.director_name || "la persona directora")}.</span></div><span>${escapeHtml(formatDateTime(batch.submitted_at))}</span></div>`
  }
  if (batch.status === "approved") {
    return `<div class="batch-status-banner success"><div><strong>Corte aprobado</strong><span>${items.length} solicitudes continuan al flujo operativo.</span></div><span>${escapeHtml(formatDateTime(batch.decided_at))}</span></div>`
  }
  if (batch.status === "partially_approved") {
    const approved = items.filter((item) => item.director_status === "approved").length
    const rejected = items.filter((item) => item.director_status === "rejected").length
    return `<div class="batch-status-banner warning"><div><strong>Corte aprobado con partidas rechazadas</strong><span>${approved} aprobadas y ${rejected} rechazadas. Los motivos quedan visibles por solicitud.</span></div><span>${escapeHtml(formatDateTime(batch.decided_at))}</span></div>`
  }
  if (batch.status === "closed") {
    return `<div class="batch-status-banner success"><div><strong>Corte cerrado</strong><span>La revision de Direccion y el cierre de Finanzas quedaron registrados.</span></div><span>${escapeHtml(formatDateTime(batch.closed_at))}</span></div>`
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
  return `<div class="batch-table-wrap ${items.length > 10 ? "batch-table-scroll" : ""}"><table class="batch-table"><thead><tr><th>Folio</th><th>Proveedor</th><th>Centro / partida</th><th>Metodo</th><th>Monto</th><th>Solicitante</th><th>Decision</th><th>Motivo</th>${hasActionColumn ? "<th></th>" : ""}</tr></thead><tbody>${items.map((item) => `
    <tr data-item-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(item.request_number || "-")}</strong></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${escapeHtml(item.cost_center || "-")}<br><span class="batch-list-meta">${escapeHtml(item.budget_category || "-")}</span></td><td>${escapeHtml(item.payment_method || "-")}</td><td>${formatMoney(item.amount, item.currency)}</td><td>${escapeHtml(item.requester_name || "-")}</td><td>${canDecide && item.director_status === "pending" ? `<select class="decision-select" data-decision-item="${escapeHtml(item.id)}" aria-label="Decision para ${escapeHtml(item.request_number || "solicitud")}"><option value="">Sin decision</option><option value="approved">Aprobar</option><option value="rejected">Rechazar</option></select>` : statusBadge(item.director_status)}</td><td>${canDecide && item.director_status === "pending" ? `<input class="reason-input" data-reason-item="${escapeHtml(item.id)}" aria-label="Motivo para ${escapeHtml(item.request_number || "solicitud")}" placeholder="Obligatorio si rechaza" disabled>` : `${escapeHtml(item.reject_reason || "-")}${item.rebatch_status === "released" ? `<br><span class="batch-list-meta">Reingreso habilitado: ${escapeHtml(item.rebatch_release_note || "")}</span>` : ""}`}</td>${hasActionColumn ? `<td>${canRemove ? `<button class="secondary-btn" type="button" data-detail-action="remove" data-item-id="${escapeHtml(item.id)}">Quitar</button>` : item.director_status === "rejected" && item.rebatch_status === "blocked" ? `<button class="secondary-btn" type="button" data-detail-action="release-rebatch" data-item-id="${escapeHtml(item.id)}">Habilitar siguiente corte</button>` : ""}</td>` : ""}</tr>
  `).join("")}</tbody></table></div>`
}

function renderEligibleSection() {
  const rows = state.eligible
  const selected = rows.filter((item) => state.selectedEligibleIds.has(item.id)).length
  return `<div class="batch-section"><div class="batch-section-head"><h3>Solicitudes elegibles</h3><span class="batch-list-meta">Aprobadas por Finanzas y aun no ejecutadas</span></div>${rows.length ? `<div class="batch-bulk-bar" data-eligible-toolbar>
    <label class="batch-select-all"><input class="batch-check" type="checkbox" data-select-all-eligible aria-label="Seleccionar todas las solicitudes elegibles"> Seleccionar todas</label>
    <span class="batch-selection-count" data-selected-count aria-live="polite">${selected} de ${rows.length} seleccionadas</span>
    <button class="secondary-btn" type="button" data-detail-action="clear-selection" ${selected ? "" : "disabled"}>Limpiar seleccion</button>
    <button class="primary-btn" type="button" data-detail-action="add-selected" ${selected && !state.addingProgress ? "" : "disabled"}>Agregar ${selected} al corte</button>
    <span class="batch-progress" data-add-progress aria-live="polite" ${state.addingProgress ? "" : "hidden"}>${state.addingProgress ? `Agregando ${state.addingProgress.current} de ${state.addingProgress.total}...` : ""}</span>
  </div><div class="batch-table-wrap batch-table-scroll"><table class="batch-table"><thead><tr><th></th><th>Folio</th><th>Proveedor</th><th>Centro / partida</th><th>Metodo</th><th>Monto</th><th>Solicitante</th></tr></thead><tbody>${rows.map((item) => `
    <tr class="batch-eligible-row ${state.selectedEligibleIds.has(item.id) ? "selected" : ""}" data-eligible-row data-request-id="${escapeHtml(item.id)}"><td><input class="batch-check" type="checkbox" data-eligible-id="${escapeHtml(item.id)}" aria-label="Seleccionar ${escapeHtml(item.request_number)}" ${state.selectedEligibleIds.has(item.id) ? "checked" : ""}></td><td><strong>${escapeHtml(item.request_number)}</strong></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${escapeHtml(item.cost_center || "-")}<br><span class="batch-list-meta">${escapeHtml(item.budget_category || "-")}</span></td><td>${escapeHtml(item.payment_method || "-")}</td><td>${formatMoney(item.amount, item.currency)}</td><td>${escapeHtml(item.requester_name || "-")}</td></tr>
  `).join("")}</tbody></table></div>` : `<div class="batch-empty">No hay solicitudes elegibles para esta empresa.</div>`}</div>`
}

function renderBreakdowns(items) {
  if (!items.length) return ""
  const groups = [
    ["Metodo de pago", groupTotals(items, (item) => item.payment_method || "Sin metodo")],
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
    if (action === "close") await confirmAndRun("Cerrar corte", `<p>El corte quedara cerrado para ejecucion y ya no aceptara nuevas decisiones.</p>`, "Cerrar corte", "close_approval_batch", { p_batch_id: state.selectedId }, "Corte cerrado")
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
  const alreadyApproved = asArray(state.detail?.items).filter((item) => item.director_status === "approved").length
  if (!approvedItems.length && !alreadyApproved) throw new Error("El corte debe conservar al menos una solicitud aprobada.")
  const summary = [
    confirmationRow("Aprobadas", String(approvedItems.length)),
    confirmationTotalsRows(approvedItems, "Total aprobado"),
    confirmationRow("Rechazadas", String(rejectedItems.length)),
    confirmationTotalsRows(rejectedItems, "Total rechazado"),
  ].join("")
  const rejectedDetail = rejectedItems.length ? `<div><strong>Solicitudes rechazadas</strong><div class="confirm-summary-list">${rejectedItems.map((item) => `<div><strong>${escapeHtml(item.request_number || "-")}</strong><br>${escapeHtml(item.reason)}</div>`).join("")}</div></div>` : ""
  const confirmed = await showConfirmation({
    title: "Guardar decisiones del corte",
    bodyHtml: `<p>Revisa la decision mixta antes de autorizar la continuacion operativa.</p><div class="confirm-summary-list">${summary}</div>${rejectedDetail}<div class="confirm-warning">Las solicitudes aprobadas continuaran al flujo operativo. Esta accion no se puede deshacer desde esta pantalla.</div>`,
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
    const { data, error } = await supabaseClient.rpc("create_approval_batch", {
      p_company_id: dom.createCompanyId.value,
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
  renderDirectorList()
  dom.directorDialog.showModal()
}

async function saveDirector(event) {
  event.preventDefault()
  const submit = dom.directorForm.querySelector('[type="submit"]')
  submit.disabled = true
  try {
    const { error } = await supabaseClient.rpc("set_company_director", {
      p_company_id: dom.directorCompanyId.value,
      p_director_profile_id: dom.directorProfileId.value,
      p_active: dom.directorActive.checked,
    })
    if (error) throw error
    showToast("Director actualizado", "La configuracion de empresa quedo guardada.", "success")
    await loadDirectors()
  } catch (error) {
    showToast("No se pudo guardar", friendlyError(error), "error")
  } finally {
    submit.disabled = false
  }
}

function openRebatchDialog(itemId) {
  state.releaseItemId = itemId
  dom.rebatchNote.value = ""
  dom.rebatchDialog.showModal()
}

async function releaseRejectedItem(event) {
  event.preventDefault()
  if (state.mutating) return
  const note = dom.rebatchNote.value.trim()
  if (!state.releaseItemId || !note) return showToast("Nota requerida", "Explica que informacion fue complementada antes del reingreso.", "warning")
  const submit = dom.rebatchForm.querySelector('[type="submit"]')
  state.mutating = true
  submit.disabled = true
  try {
    const { error } = await supabaseClient.rpc("release_rejected_batch_item_for_rebatch", {
      p_item_id: state.releaseItemId,
      p_note: note,
    })
    if (error) throw error
    dom.rebatchDialog.close()
    state.releaseItemId = null
    showToast("Reingreso habilitado", "La solicitud puede incorporarse a un siguiente corte.", "success")
    await reloadSelected()
  } catch (error) {
    showToast("No se pudo habilitar", friendlyError(error), "error")
  } finally {
    submit.disabled = false
    state.mutating = false
  }
}

function fillCompanyOptions() {
  const options = state.companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.legal_name || company.name)}</option>`).join("")
  ;[dom.createCompanyId, dom.directorCompanyId].forEach((select) => {
    if (!select) return
    const current = select.value
    select.innerHTML = `<option value="">Selecciona...</option>${options}`
    if (state.companies.some((company) => company.id === current)) select.value = current
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

function renderDirectorList() {
  if (!dom.directorList) return
  dom.directorList.innerHTML = state.directors.length ? `<div class="batch-table-wrap"><table class="batch-table" style="min-width:520px"><thead><tr><th>Empresa</th><th>Director</th><th>Estado</th></tr></thead><tbody>${state.directors.map((row) => `<tr><td>${escapeHtml(row.company_name)}</td><td>${escapeHtml(row.director_name || row.director_email)}</td><td>${statusBadge(row.active && row.director_profile_active !== false && row.director_role_valid !== false ? "active" : "inactive")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="batch-empty">No hay directores configurados.</div>`
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
  const header = ["corte", "empresa", "periodo_inicio", "periodo_fin", "estatus_corte", "folio", "proveedor", "centro_costo", "partida", "metodo_pago", "moneda", "monto", "solicitante", "decision_director", "motivo_rechazo", "estatus_reingreso", "nota_reingreso"]
  const rows = items.map((item) => [batch.label, batch.company_name, batch.period_start, batch.period_end, batch.status, item.request_number, item.provider_name, item.cost_center, item.budget_category, item.payment_method, item.currency, item.amount, item.requester_name, item.director_status, item.reject_reason || "", item.rebatch_status, item.rebatch_release_note || ""])
  const content = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")
  downloadBlob(new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" }), `${fileStem(batch)}.csv`)
}

function exportPdf() {
  const batch = state.detail?.batch
  const items = asArray(state.detail?.items)
  if (!batch || !window.jspdf?.jsPDF) return showToast("PDF no disponible", "No se cargo el generador de PDF.", "error")
  const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "letter" })
  doc.setFontSize(15)
  doc.text(batch.label, 36, 36)
  doc.setFontSize(9)
  doc.text(`${batch.company_name} | ${batch.period_start} a ${batch.period_end} | ${statusLabel(batch.status)}`, 36, 53)
  doc.autoTable({
    startY: 68,
    head: [["Folio", "Proveedor", "Centro / partida", "Metodo", "Monto", "Solicitante", "Decision", "Motivo"]],
    body: items.map((item) => [item.request_number, item.provider_name || "-", `${item.cost_center || "-"}\n${item.budget_category || "-"}`, item.payment_method || "-", formatMoney(item.amount, item.currency), item.requester_name || "-", statusLabel(item.director_status), `${item.reject_reason || "-"}${item.rebatch_release_note ? `\nReingreso: ${item.rebatch_release_note}` : ""}`]),
    styles: { fontSize: 7, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [34, 40, 49] },
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

function statusLabel(status) {
  return ({ draft: "Borrador", submitted: "Enviado", approved: "Aprobado", partially_approved: "Con rechazos", closed: "Cerrado", pending: "Pendiente", rejected: "Rechazado", active: "Activo", inactive: "Inactivo" })[status] || String(status || "-")
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
    batch_director_required: "Solo el director asignado puede decidir este corte.",
    company_director_required: "Configura un director activo para la empresa.",
    select_company_director: "Selecciona uno de los directores activos.",
    batch_requires_items: "Agrega al menos una solicitud al corte.",
    payment_request_not_batch_eligible: "La solicitud ya no es elegible para este corte.",
    payment_request_in_another_open_batch: "La solicitud ya pertenece a otro corte abierto.",
    reject_reason_required: "El motivo de rechazo es obligatorio.",
    director_role_required: "El perfil seleccionado no tiene un rol activo de Direccion.",
    rebatch_release_note_required: "La nota de reingreso es obligatoria.",
    batch_item_already_released: "Esta solicitud ya fue habilitada para otro corte.",
    batch_requires_at_least_one_approved_item: "El corte debe conservar al menos una solicitud aprobada.",
  }
  const key = Object.keys(known).find((item) => raw.includes(item))
  return key ? known[key] : raw
}

function showToast(title, message, type = "success") {
  const variants = { error: "danger", warning: "warning", success: "success", info: "info" }
  if (window.Components?.showToast) {
    window.Components.showToast({ title: escapeHtml(title), desc: escapeHtml(message), variant: variants[type] || "info", duration: 6 })
  } else {
    window.alert(`${title}: ${message}`)
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char])
}
