const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const state = {
  profile: null,
  isFinance: false,
  view: "finance",
  batches: [],
  selectedId: null,
  detail: null,
  eligible: [],
  companies: [],
  directorCandidates: [],
  directors: [],
  releaseItemId: null,
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
    "directorList", "rebatchDialog", "rebatchForm", "rebatchNote",
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
    await loadBatches()
  })
  dom.batchList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-batch-id]")
    if (button) openBatch(button.dataset.batchId)
  })
  dom.batchDetail?.addEventListener("click", handleDetailAction)
  dom.createBatchBtn?.addEventListener("click", openCreateDialog)
  dom.directorConfigBtn?.addEventListener("click", openDirectorDialog)
  dom.createBatchForm?.addEventListener("submit", createBatch)
  dom.directorForm?.addEventListener("submit", saveDirector)
  dom.rebatchForm?.addEventListener("submit", releaseRejectedItem)
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
  const session = window.FluxAuth?.state?.session
  dom.userName.textContent = state.profile?.full_name || session?.user?.email || "Usuario"
  dom.userEmail.textContent = state.profile?.email || session?.user?.email || "Sesion activa"
  dom.createBatchBtn.hidden = !state.isFinance
  dom.directorConfigBtn.hidden = !state.isFinance
  if (!state.isFinance) state.view = "director"
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
    <button class="batch-list-item ${batch.id === state.selectedId ? "active" : ""}" type="button" data-batch-id="${escapeHtml(batch.id)}">
      <span class="batch-list-head"><strong>${escapeHtml(batch.label)}</strong>${statusBadge(batch.status)}</span>
      <span class="batch-list-meta"><span>${escapeHtml(batch.company_name || "Sin empresa")}</span><span>${formatDate(batch.period_end)}</span></span>
      <span class="batch-list-meta"><span>${Number(batch.item_count || 0)} solicitudes</span><span>${escapeHtml(formatCurrencyTotals(asArray(batch.totals_by_currency)))}</span></span>
    </button>
  `).join("")
}

async function openBatch(batchId) {
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
    ${renderBreakdowns(items)}
    ${batch.notes ? `<div class="batch-section"><div class="batch-list-meta">Notas</div><div>${escapeHtml(batch.notes)}</div></div>` : ""}
    <div class="batch-section"><div class="batch-section-head"><h3>Solicitudes del corte</h3><span class="batch-list-meta">${escapeHtml(statusLabel(batch.status))}</span></div>${renderItemsTable(batch, items)}</div>
    ${state.isFinance && batch.status === "draft" ? renderEligibleSection() : ""}
  `
}

function detailActions(batch, items) {
  const actions = [
    `<button class="secondary-btn" type="button" data-detail-action="csv">CSV</button>`,
    `<button class="secondary-btn" type="button" data-detail-action="pdf">PDF</button>`,
  ]
  if (state.isFinance && batch.status === "draft") actions.push(`<button class="primary-btn" type="button" data-detail-action="submit" ${items.length ? "" : "disabled"}>Enviar a Direccion</button>`)
  if (batch.can_director_decide && batch.status === "submitted") {
    actions.push(`<button class="secondary-btn" type="button" data-detail-action="save-decisions">Guardar decisiones</button>`)
    actions.push(`<button class="primary-btn" type="button" data-detail-action="approve-all">Aprobar todo</button>`)
  }
  if (state.isFinance && ["approved", "partially_approved"].includes(batch.status)) actions.push(`<button class="primary-btn" type="button" data-detail-action="close">Cerrar corte</button>`)
  return actions.join("")
}

function renderItemsTable(batch, items) {
  if (!items.length) return `<div class="batch-empty">Agrega solicitudes elegibles antes de enviar el corte.</div>`
  const canDecide = batch.can_director_decide && batch.status === "submitted"
  const canRemove = state.isFinance && batch.status === "draft"
  const canReleaseAny = state.isFinance && ["partially_approved", "closed"].includes(batch.status) && items.some((item) => item.director_status === "rejected" && item.rebatch_status === "blocked")
  const hasActionColumn = canRemove || canReleaseAny
  return `<div class="batch-table-wrap"><table class="batch-table"><thead><tr><th>Folio</th><th>Proveedor</th><th>Centro / partida</th><th>Metodo</th><th>Monto</th><th>Solicitante</th><th>Decision</th><th>Motivo</th>${hasActionColumn ? "<th></th>" : ""}</tr></thead><tbody>${items.map((item) => `
    <tr data-item-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(item.request_number || "-")}</strong></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${escapeHtml(item.cost_center || "-")}<br><span class="batch-list-meta">${escapeHtml(item.budget_category || "-")}</span></td><td>${escapeHtml(item.payment_method || "-")}</td><td>${formatMoney(item.amount, item.currency)}</td><td>${escapeHtml(item.requester_name || "-")}</td><td>${canDecide && item.director_status === "pending" ? `<select class="decision-select" data-decision-item="${escapeHtml(item.id)}"><option value="approved">Aprobar</option><option value="rejected">Rechazar</option></select>` : statusBadge(item.director_status)}</td><td>${canDecide && item.director_status === "pending" ? `<input class="reason-input" data-reason-item="${escapeHtml(item.id)}" placeholder="Obligatorio si rechaza">` : `${escapeHtml(item.reject_reason || "-")}${item.rebatch_status === "released" ? `<br><span class="batch-list-meta">Reingreso habilitado: ${escapeHtml(item.rebatch_release_note || "")}</span>` : ""}`}</td>${hasActionColumn ? `<td>${canRemove ? `<button class="secondary-btn" type="button" data-detail-action="remove" data-item-id="${escapeHtml(item.id)}">Quitar</button>` : item.director_status === "rejected" && item.rebatch_status === "blocked" ? `<button class="secondary-btn" type="button" data-detail-action="release-rebatch" data-item-id="${escapeHtml(item.id)}">Habilitar siguiente corte</button>` : ""}</td>` : ""}</tr>
  `).join("")}</tbody></table></div>`
}

function renderEligibleSection() {
  const rows = state.eligible
  return `<div class="batch-section"><div class="batch-section-head"><h3>Solicitudes elegibles</h3><span class="batch-list-meta">Aprobadas por Finanzas y aun no ejecutadas</span></div>${rows.length ? `<div class="batch-table-wrap"><table class="batch-table"><thead><tr><th></th><th>Folio</th><th>Proveedor</th><th>Centro / partida</th><th>Metodo</th><th>Monto</th><th>Solicitante</th></tr></thead><tbody>${rows.map((item) => `
    <tr><td><input class="batch-check" type="checkbox" data-eligible-id="${escapeHtml(item.id)}" aria-label="Seleccionar ${escapeHtml(item.request_number)}"></td><td><strong>${escapeHtml(item.request_number)}</strong></td><td>${escapeHtml(item.provider_name || "-")}</td><td>${escapeHtml(item.cost_center || "-")}<br><span class="batch-list-meta">${escapeHtml(item.budget_category || "-")}</span></td><td>${escapeHtml(item.payment_method || "-")}</td><td>${formatMoney(item.amount, item.currency)}</td><td>${escapeHtml(item.requester_name || "-")}</td></tr>
  `).join("")}</tbody></table></div><div class="batch-toolbar" style="margin-top:10px"><button class="primary-btn" type="button" data-detail-action="add-selected">Agregar seleccionadas</button></div>` : `<div class="batch-empty">No hay solicitudes elegibles para esta empresa.</div>`}</div>`
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
  const button = event.target.closest("[data-detail-action]")
  if (!button || button.disabled || !state.selectedId || state.mutating) return
  try {
    state.mutating = true
    button.disabled = true
    const action = button.dataset.detailAction
    if (action === "add-selected") await addSelectedRequests()
    if (action === "remove") await runRpc("remove_request_from_approval_batch", { p_batch_id: state.selectedId, p_item_id: button.dataset.itemId }, "Solicitud retirada")
    if (action === "submit") await confirmAndRun("Enviar corte", "El director recibira el corte para su decision.", "submit_approval_batch", { p_batch_id: state.selectedId }, "Corte enviado")
    if (action === "approve-all") await confirmAndRun("Aprobar corte completo", approveAllSummary(), "approve_entire_batch", { p_batch_id: state.selectedId }, "Corte aprobado")
    if (action === "save-decisions") await saveDecisions()
    if (action === "close") await confirmAndRun("Cerrar corte", "El corte quedara cerrado para ejecucion.", "close_approval_batch", { p_batch_id: state.selectedId }, "Corte cerrado")
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

async function addSelectedRequests() {
  const ids = Array.from(dom.batchDetail.querySelectorAll("[data-eligible-id]:checked")).map((input) => input.dataset.eligibleId)
  if (!ids.length) throw new Error("Selecciona al menos una solicitud.")
  let added = 0
  try {
    for (const requestId of ids) {
      const { error } = await supabaseClient.rpc("add_request_to_approval_batch", { p_batch_id: state.selectedId, p_payment_request_id: requestId })
      if (error) throw error
      added += 1
    }
    showToast("Solicitudes agregadas", `${added} solicitud(es) incorporadas al corte.`, "success")
  } catch (error) {
    throw new Error(`${friendlyError(error)} Se agregaron ${added} de ${ids.length}; el detalle fue actualizado.`)
  } finally {
    await reloadSelected()
  }
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
    `Vas a aprobar ${approvedItems.length} pago(s) y rechazar ${rejectedItems.length}.`,
    `Aprobado por moneda: ${formatCurrencyTotals(totalsByCurrency(approvedItems))}.`,
    `Rechazado por moneda: ${formatCurrencyTotals(totalsByCurrency(rejectedItems))}.`,
    ...(rejectedItems.length ? ["", "Folios rechazados:", ...rejectedItems.map((item) => `- ${item.request_number}: ${item.reason}`)] : []),
    "",
    "Esta decision autoriza la continuacion operativa de los pagos aprobados. Confirmas?",
  ].join("\n")
  if (!window.confirm(summary)) return
  await runRpc("decide_approval_batch_items", { p_batch_id: state.selectedId, p_decisions: decisions }, "Decisiones guardadas")
}

function approveAllSummary() {
  const pending = asArray(state.detail?.items).filter((item) => item.director_status === "pending")
  return `Vas a aprobar ${pending.length} pago(s) por ${formatCurrencyTotals(totalsByCurrency(pending))}. Esta decision permite que continuen al flujo operativo. Confirmas?`
}

async function runRpc(name, args, successTitle) {
  const { error } = await supabaseClient.rpc(name, args)
  if (error) throw error
  showToast(successTitle, "La operacion se registro correctamente.", "success")
  await reloadSelected()
}

async function confirmAndRun(title, message, name, args, successTitle) {
  if (window.confirm(`${title}\n\n${message}`)) await runRpc(name, args, successTitle)
}

async function reloadSelected() {
  const id = state.selectedId
  await loadBatches()
  if (id) await openBatch(id)
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
