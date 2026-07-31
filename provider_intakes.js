const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const STATUS = Object.freeze({
  received: { label: "Recibida", event: "Solicitud recibida" },
  in_review: { label: "En revisión", event: "Revisión iniciada" },
  needs_correction: { label: "Requiere corrección", event: "Corrección solicitada" },
  rejected: { label: "Rechazada", event: "Solicitud rechazada" },
  converted: { label: "Convertida", event: "Solicitud convertida" },
  cancelled: { label: "Cancelada", event: "Solicitud cancelada" },
})

const EVENT_LABELS = Object.freeze({
  received: "Solicitud recibida",
  status_changed: "Estado actualizado",
  correction_requested: "Corrección solicitada",
  rejected: "Solicitud rechazada",
  internal_note: "Nota interna",
  file_uploaded: "Documento recibido",
  file_reviewed: "Documento revisado",
  provider_matched: "Proveedor relacionado",
  converted: "Solicitud convertida",
})

const FILE_KIND_LABELS = Object.freeze({
  invoice_pdf: "Factura PDF",
  invoice_xml: "Factura XML",
  bank_document: "Documento bancario",
  support: "Soporte",
  other: "Otro",
})

const MATCH_CONFIDENCE = Object.freeze({
  high: "Confianza alta",
  medium: "Confianza media",
  low: "Confianza baja",
  none: "Sin puntuación",
})

const COMPARISON_RESULT = Object.freeze({
  match: "Coincide",
  different: "Difiere",
  not_reported: "No informado",
})

const state = {
  page: 1,
  pageSize: 25,
  total: 0,
  items: [],
  summary: {},
  detail: null,
  action: null,
  loadVersion: 0,
  detailTrigger: null,
  actionTrigger: null,
  matchData: null,
  matchLoading: false,
  matchSearch: "",
  matchAction: null,
  matchTrigger: null,
}

const dom = {}
let searchTimer = null

document.addEventListener("DOMContentLoaded", init)

async function init() {
  bindDom()
  setupTheme()
  bindEvents()

  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  const session = window.FluxAuth?.state?.session
  const profile = window.FluxAuth?.getProfile?.()

  if (!session) {
    window.location.replace("./index.html")
    return
  }

  dom.userName.textContent = profile?.full_name || session.user?.email || "Usuario"
  dom.userEmail.textContent = profile?.email || session.user?.email || "Sesión activa"

  if (!window.FluxAuth?.canTriageProviderIntakes?.()) {
    renderAccessDenied()
    return
  }

  dom.accessState.hidden = true
  dom.triageWorkspace.hidden = false
  await loadList()
}

function bindDom() {
  const ids = [
    "userName", "userEmail", "logoutBtn", "themeToggle", "triageWorkspace", "accessState",
    "accessStateTitle", "accessStateMessage", "accessHomeLink", "refreshBtn", "filterForm",
    "folioFilter", "providerFilter", "companyFilter", "statusFilter", "dateFromFilter",
    "dateToFilter", "filesFilter", "sortFilter", "clearFiltersBtn", "resultsSummary",
    "intakeTableBody", "previousPageBtn", "nextPageBtn", "pageStatus", "countTotal",
    "countReceived", "countReview", "countCorrection", "countRejected", "detailDialog",
    "detailTitle", "detailSubtitle", "detailContent", "detailActions", "closeDetailBtn",
    "actionDialog", "actionForm", "actionTitle", "actionDescription", "actionNotes",
    "actionRequiredLabel", "actionNotesHint", "actionCounter", "actionError",
    "closeActionBtn", "cancelActionBtn", "confirmActionBtn",
    "matchDialog", "matchForm", "matchTitle", "matchDescription", "comparisonContent",
    "matchReasonFields", "matchReasonCode", "matchReason", "matchReasonRequired",
    "matchReasonHint", "matchReasonCounter", "matchError", "closeMatchBtn",
    "cancelMatchBtn", "confirmMatchBtn",
  ]
  ids.forEach((id) => { dom[id] = document.getElementById(id) })
}

function bindEvents() {
  dom.logoutBtn.addEventListener("click", logout)
  dom.themeToggle.addEventListener("click", toggleTheme)
  dom.refreshBtn.addEventListener("click", () => loadList({ announce: true }))
  dom.previousPageBtn.addEventListener("click", () => changePage(-1))
  dom.nextPageBtn.addEventListener("click", () => changePage(1))
  dom.clearFiltersBtn.addEventListener("click", clearFilters)
  dom.closeDetailBtn.addEventListener("click", () => dom.detailDialog.close())
  dom.closeActionBtn.addEventListener("click", closeActionDialog)
  dom.cancelActionBtn.addEventListener("click", closeActionDialog)
  dom.actionForm.addEventListener("submit", submitAction)
  dom.actionNotes.addEventListener("input", updateActionCounter)
  dom.matchForm.addEventListener("submit", submitMatch)
  dom.closeMatchBtn.addEventListener("click", closeMatchDialog)
  dom.cancelMatchBtn.addEventListener("click", closeMatchDialog)
  dom.matchReason.addEventListener("input", updateMatchReasonCounter)
  dom.detailDialog.addEventListener("close", restoreDetailFocus)
  dom.actionDialog.addEventListener("close", restoreActionFocus)
  dom.matchDialog.addEventListener("close", restoreMatchFocus)

  ;[dom.folioFilter, dom.providerFilter].forEach((input) => {
    input.addEventListener("input", () => {
      window.clearTimeout(searchTimer)
      searchTimer = window.setTimeout(() => resetAndLoad(), 350)
    })
  })

  ;[
    dom.companyFilter, dom.statusFilter, dom.dateFromFilter, dom.dateToFilter,
    dom.filesFilter, dom.sortFilter,
  ].forEach((control) => control.addEventListener("change", () => resetAndLoad()))

  document.querySelectorAll("[data-kpi-status]").forEach((button) => {
    button.addEventListener("click", () => applyKpiFilter(button.dataset.kpiStatus))
  })
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.dataset.theme = saved
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
  document.documentElement.dataset.theme = next
  localStorage.setItem("flux-theme", next)
}

async function logout() {
  await supabaseClient.auth.signOut()
  window.location.href = "./index.html"
}

function renderAccessDenied() {
  dom.triageWorkspace.hidden = true
  dom.accessState.hidden = false
  dom.accessStateTitle.textContent = "Acceso restringido"
  dom.accessStateMessage.textContent = "Esta bandeja está disponible únicamente para Finanzas, Administración y Sysadmin. No se consultó ninguna solicitud."
  dom.accessHomeLink.hidden = false
}

function selectedStatuses() {
  return Array.from(dom.statusFilter.selectedOptions).map((option) => option.value)
}

function filterPayload() {
  const filesValue = dom.filesFilter.value
  return {
    p_company_id: dom.companyFilter.value || null,
    p_statuses: selectedStatuses(),
    p_date_from: dom.dateFromFilter.value || null,
    p_date_to: dom.dateToFilter.value || null,
    p_has_files: filesValue === "" ? null : filesValue === "true",
    p_folio: dom.folioFilter.value.trim() || null,
    p_provider: dom.providerFilter.value.trim() || null,
    p_sort_direction: dom.sortFilter.value,
    p_page: state.page,
    p_page_size: state.pageSize,
  }
}

async function loadList({ announce = false } = {}) {
  const version = ++state.loadVersion
  setListLoading(true)
  const payload = filterPayload()

  if (payload.p_date_from && payload.p_date_to && payload.p_date_from > payload.p_date_to) {
    renderListError("La fecha inicial no puede ser posterior a la fecha final.")
    setListLoading(false)
    return
  }

  const { data, error } = await supabaseClient.rpc("list_provider_intakes", payload)
  if (version !== state.loadVersion) return

  if (error) {
    renderListError(friendlyError(error))
    setListLoading(false)
    return
  }

  const result = data && typeof data === "object" ? data : {}
  state.items = Array.isArray(result.items) ? result.items : []
  state.summary = result.summary || {}
  state.total = Number(result.total || 0)
  state.page = Number(result.page || state.page)
  state.pageSize = Number(result.page_size || state.pageSize)

  updateCompanyOptions(Array.isArray(result.companies) ? result.companies : [])
  renderSummary()
  renderTable()
  renderPagination()
  updateKpiState()
  setListLoading(false)

  if (announce) showToast("Bandeja actualizada", "Se consultó la información más reciente.", "success")
}

function setListLoading(loading) {
  dom.refreshBtn.disabled = loading
  dom.previousPageBtn.disabled = loading || state.page <= 1
  dom.nextPageBtn.disabled = loading || state.page * state.pageSize >= state.total
  dom.filterForm.setAttribute("aria-busy", String(loading))
  if (loading) dom.resultsSummary.textContent = "Actualizando resultados…"
}

function updateCompanyOptions(companies) {
  const selected = dom.companyFilter.value
  const fragment = document.createDocumentFragment()
  fragment.append(optionElement("", "Todas las permitidas"))
  companies.forEach((company) => {
    if (company?.id) fragment.append(optionElement(company.id, company.name || "Empresa"))
  })
  dom.companyFilter.replaceChildren(fragment)
  if (companies.some((company) => company.id === selected)) dom.companyFilter.value = selected
}

function renderSummary() {
  dom.countTotal.textContent = numberFormat(state.summary.total)
  dom.countReceived.textContent = numberFormat(state.summary.received)
  dom.countReview.textContent = numberFormat(state.summary.in_review)
  dom.countCorrection.textContent = numberFormat(state.summary.needs_correction)
  dom.countRejected.textContent = numberFormat(state.summary.rejected)

  if (!state.total) {
    dom.resultsSummary.textContent = "No hay solicitudes que coincidan con los filtros."
    return
  }
  const first = (state.page - 1) * state.pageSize + 1
  const last = Math.min(state.page * state.pageSize, state.total)
  dom.resultsSummary.textContent = `Mostrando ${first}–${last} de ${numberFormat(state.total)} solicitudes.`
}

function renderTable() {
  dom.intakeTableBody.replaceChildren()
  if (!state.items.length) {
    const row = document.createElement("tr")
    const cell = document.createElement("td")
    cell.colSpan = 10
    cell.className = "table-message"
    cell.textContent = "Sin resultados. Ajusta los filtros o actualiza la bandeja."
    row.append(cell)
    dom.intakeTableBody.append(row)
    return
  }

  const fragment = document.createDocumentFragment()
  state.items.forEach((item) => fragment.append(intakeRow(item)))
  dom.intakeTableBody.append(fragment)
}

function intakeRow(item) {
  const row = document.createElement("tr")
  row.append(
    cell(item.public_folio || "—", "folio-cell"),
    cell(formatDateTime(item.created_at)),
    cell(item.company_name || "—"),
    cell(item.provider_name || "—", "provider-cell", item.provider_name),
    cell(item.concept || "—", "concept-cell", item.concept),
    cell(formatMoney(item.amount_requested, item.currency), "numeric"),
    cell(`${Number(item.file_count || 0)} ${Number(item.file_count || 0) === 1 ? "archivo" : "archivos"}`),
    statusCell(item.status),
    cell(formatAge(item.created_at)),
  )

  const actionCell = document.createElement("td")
  const button = document.createElement("button")
  button.type = "button"
  button.className = "secondary-btn view-intake-btn"
  button.textContent = "Ver detalle"
  button.setAttribute("aria-label", `Ver detalle de ${item.public_folio || "la solicitud"}`)
  button.addEventListener("click", () => openDetail(item.id, button))
  actionCell.append(button)
  row.append(actionCell)
  const labels = ["Folio", "Recepción", "Empresa", "Proveedor", "Concepto", "Monto", "Archivos", "Estado", "Antigüedad", "Acción"]
  Array.from(row.children).forEach((node, index) => { node.dataset.label = labels[index] })
  return row
}

function cell(value, className = "", title = "") {
  const node = document.createElement("td")
  node.textContent = value
  if (className) node.className = className
  if (title) node.title = title
  return node
}

function statusCell(status) {
  const node = document.createElement("td")
  node.append(statusBadge(status))
  return node
}

function statusBadge(status) {
  const badge = document.createElement("span")
  badge.className = `status-badge status-${status}`
  badge.textContent = STATUS[status]?.label || "Estado no reconocido"
  return badge
}

function renderListError(message) {
  state.items = []
  state.total = 0
  dom.intakeTableBody.replaceChildren()
  const row = document.createElement("tr")
  const cellNode = document.createElement("td")
  cellNode.colSpan = 10
  cellNode.className = "table-message"
  cellNode.textContent = message
  row.append(cellNode)
  dom.intakeTableBody.append(row)
  dom.resultsSummary.textContent = "No fue posible consultar la bandeja."
  renderPagination()
}

function renderPagination() {
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize))
  dom.pageStatus.textContent = `Página ${state.page} de ${pages}`
  dom.previousPageBtn.disabled = state.page <= 1
  dom.nextPageBtn.disabled = state.page >= pages || state.total === 0
}

function changePage(direction) {
  const next = state.page + direction
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize))
  if (next < 1 || next > pages) return
  state.page = next
  loadList()
  document.getElementById("intakeTableCaption")?.scrollIntoView({ block: "start" })
}

function resetAndLoad() {
  state.page = 1
  updateKpiState()
  loadList()
}

function clearFilters() {
  dom.filterForm.reset()
  Array.from(dom.statusFilter.options).forEach((option) => {
    option.selected = ["received", "in_review"].includes(option.value)
  })
  state.page = 1
  updateKpiState()
  loadList()
}

function applyKpiFilter(status) {
  Array.from(dom.statusFilter.options).forEach((option) => {
    option.selected = status ? option.value === status : false
  })
  state.page = 1
  updateKpiState()
  loadList()
}

function updateKpiState() {
  const statuses = selectedStatuses()
  const active = statuses.length === 0 ? "" : statuses.length === 1 ? statuses[0] : null
  document.querySelectorAll("[data-kpi-status]").forEach((button) => {
    const pressed = active !== null && button.dataset.kpiStatus === active
    button.classList.toggle("active", pressed)
    button.setAttribute("aria-pressed", String(pressed))
  })
}

async function openDetail(intakeId, trigger) {
  state.detailTrigger = trigger
  state.detail = null
  state.matchData = null
  dom.detailTitle.textContent = "Cargando solicitud…"
  dom.detailSubtitle.textContent = "Consultando información autorizada"
  dom.detailContent.replaceChildren(element("div", "detail-loading", "Cargando detalle…"))
  dom.detailActions.replaceChildren()
  dom.detailDialog.showModal()

  const { data, error } = await supabaseClient.rpc("get_provider_intake_detail", {
    p_payment_intake_id: intakeId,
  })

  if (error) {
    dom.detailTitle.textContent = "Detalle no disponible"
    dom.detailSubtitle.textContent = "No se pudo completar la consulta"
    dom.detailContent.replaceChildren(element("p", "empty-inline", friendlyError(error)))
    return
  }

  state.detail = data
  await loadMatchState()
  renderDetail()
}

function renderDetail() {
  const intake = state.detail?.intake
  if (!intake) {
    dom.detailContent.replaceChildren(element("p", "empty-inline", "La solicitud ya no está disponible."))
    return
  }

  dom.detailTitle.textContent = intake.public_folio || "Solicitud"
  dom.detailSubtitle.textContent = `${intake.company_name || "Empresa"} · recibida ${formatDateTime(intake.created_at)}`
  const content = document.createDocumentFragment()

  const identity = element("section", "intake-identity")
  const identityText = document.createElement("div")
  identityText.append(
    element("strong", "", intake.provider_name || "Proveedor no indicado"),
    element("p", "", `${intake.company_name || "Empresa"} · ${formatAge(intake.created_at)}`),
  )
  identity.append(identityText, statusBadge(intake.status))
  content.append(identity)

  const grid = element("div", "detail-grid")
  grid.append(
    detailSection("Proveedor declarado", [
      ["Nombre", intake.provider_name],
      ["RFC", intake.provider_rfc],
      ["Correo", intake.provider_email],
      ["Teléfono", intake.provider_phone],
    ]),
    detailSection("Solicitud de pago", [
      ["Concepto", intake.concept],
      ["Descripción", intake.description],
      ["Monto", formatMoney(intake.amount_requested, intake.currency)],
      ["Fecha solicitada", formatDate(intake.requested_payment_date)],
    ]),
    detailSection("Factura", [
      ["Folio", intake.invoice_folio],
      ["UUID", intake.invoice_uuid],
      ["Fecha", formatDate(intake.invoice_date)],
    ]),
    detailSection("Datos bancarios declarados", [
      ["Banco", intake.bank_name],
      ["Beneficiario", intake.beneficiary_name],
      ["Cuenta", intake.bank_account_masked, "sensitive-value"],
      ["CLABE", intake.bank_clabe_masked, "sensitive-value"],
    ]),
    providerMatchSection(intake),
    filesSection(state.detail.files || [], intake),
    eventsSection(state.detail.events || []),
  )
  content.append(grid)
  dom.detailContent.replaceChildren(content)
  renderDetailActions(intake)
}

function detailSection(title, rows) {
  const section = element("section", "detail-section")
  section.append(element("h3", "", title))
  const list = element("dl", "detail-list")
  rows.forEach(([label, value, valueClass]) => {
    const row = element("div", "detail-row")
    const term = element("dt", "", label)
    const description = element("dd", valueClass || "", displayValue(value))
    row.append(term, description)
    list.append(row)
  })
  section.append(list)
  return section
}

async function loadMatchState(search = state.matchSearch) {
  const intake = state.detail?.intake
  if (!intake) return
  const intakeId = intake.id
  state.matchLoading = true
  state.matchSearch = String(search || "").trim()

  const { data, error } = await supabaseClient.rpc("find_provider_intake_candidates", {
    p_payment_intake_id: intakeId,
    p_search: state.matchSearch || null,
    p_limit: 12,
  })
  if (state.detail?.intake?.id !== intakeId) return

  state.matchLoading = false
  state.matchData = error ? { error: friendlyError(error) } : data
}

function providerMatchSection(intake) {
  const section = element("section", "detail-section full provider-match-section")
  const heading = element("div", "provider-match-heading")
  const headingText = document.createElement("div")
  headingText.append(
    element("h3", "", "Proveedor maestro"),
    element("p", "provider-match-helper", "El dato declarado permanece intacto. El vínculo requiere confirmación explícita de Finanzas."),
  )
  heading.append(headingText)
  section.append(heading)

  if (state.matchLoading) {
    section.append(element("p", "empty-inline", "Buscando coincidencias de forma segura…"))
    return section
  }

  const matchData = state.matchData
  if (!matchData || matchData.error) {
    section.append(element("p", "match-error-inline", matchData?.error || "No fue posible consultar el matching."))
    return section
  }

  const current = matchData.current_match
  const eligible = Boolean(matchData.eligible)
  const candidates = Array.isArray(matchData.candidates) ? matchData.candidates : []
  const stateRow = element("div", "match-state-row")
  const stateBadge = element("span", matchStateClass(current, eligible, candidates), matchStateLabel(current, eligible, candidates))
  stateRow.append(stateBadge)
  if (!eligible) {
    stateRow.append(element("span", "match-readonly-note", matchReadonlyMessage(intake.status)))
  }
  section.append(stateRow)

  if (current) section.append(currentMatchCard(current, eligible))

  if (Number(matchData.duplicate_rfc_count || 0) > 1) {
    section.append(element(
      "p",
      "match-warning",
      "Se detectaron múltiples registros con el RFC declarado. Ninguno se seleccionará automáticamente; revisa cada candidato.",
    ))
  }

  if (eligible) {
    section.append(candidateSearchForm())
    if (candidates.length) {
      const list = element("div", "candidate-list")
      candidates.forEach((candidate) => list.append(candidateCard(candidate, current)))
      section.append(list)
    } else {
      section.append(element(
        "p",
        "empty-inline",
        state.matchSearch
          ? "Sin coincidencias para la búsqueda indicada."
          : "Sin coincidencias deterministas. Puedes buscar por nombre, alias o RFC.",
      ))
    }
  }

  section.append(matchHistory(matchData.history || []))
  section.append(element("p", "phase-two-inline", "Conversión disponible en Fase 2B. Esta fase no crea una solicitud de pago."))
  return section
}

function matchStateClass(current, eligible, candidates) {
  const base = "match-state-badge"
  if (current && !current.active) return `${base} match-state-inactive`
  if (current) return `${base} match-state-linked`
  if (!eligible) return `${base} match-state-review`
  if (candidates.length) return `${base} match-state-candidates`
  return `${base} match-state-empty`
}

function matchStateLabel(current, eligible, candidates) {
  if (current && !current.active) return "Proveedor inactivo"
  if (current) return "Vinculado"
  if (!eligible) return "Revisión requerida"
  if (candidates.length) return "Candidatos encontrados"
  return state.matchSearch ? "Sin coincidencias" : "Sin vincular"
}

function matchReadonlyMessage(status) {
  return ({
    received: "Inicia revisión para confirmar un vínculo.",
    needs_correction: "El vínculo se conserva en solo lectura; retoma revisión para modificarlo.",
    rejected: "Solicitud terminal en modo solo lectura.",
    converted: "Solicitud convertida en modo solo lectura.",
    cancelled: "Solicitud cancelada en modo solo lectura.",
  })[status] || "El estado actual no permite modificar el vínculo."
}

function currentMatchCard(current, eligible) {
  const card = element("article", `current-match-card${current.active ? "" : " inactive"}`)
  const body = element("div", "current-match-body")
  body.append(
    element("strong", "", current.alias || "Proveedor maestro"),
    element("span", "", current.legal_name || "Razón social no informada"),
    element("span", "match-bank-summary", `${displayValue(current.bank)} · CLABE ${displayValue(current.clabe_masked)} · Cuenta ${displayValue(current.account_masked)}`),
  )
  const actions = element("div", "current-match-actions")
  const view = element("a", "secondary-btn provider-master-link", "Abrir proveedor maestro")
  view.href = `./proveedores.html?provider_id=${encodeURIComponent(current.proveedor_id)}&mode=readonly`
  view.target = "_blank"
  view.rel = "noopener"
  const compare = element("button", "secondary-btn", "Comparar")
  compare.type = "button"
  compare.addEventListener("click", () => openMatchComparison(current.proveedor_id, compare))
  actions.append(view, compare)
  if (eligible) {
    const change = element("button", "secondary-btn", "Cambiar vínculo")
    change.type = "button"
    change.addEventListener("click", () => {
      document.getElementById("providerMatchSearch")?.focus()
    })
    const clear = element("button", "secondary-btn danger-action", "Retirar vínculo")
    clear.type = "button"
    clear.addEventListener("click", () => openClearMatch(clear))
    actions.append(change, clear)
  }
  card.append(body, actions)
  return card
}

function candidateSearchForm() {
  const form = element("form", "provider-candidate-search")
  form.setAttribute("aria-label", "Buscar proveedores maestros")
  const label = document.createElement("label")
  label.htmlFor = "providerMatchSearch"
  label.textContent = "Nombre, alias o RFC"
  const controls = element("div", "candidate-search-controls")
  const input = document.createElement("input")
  input.id = "providerMatchSearch"
  input.type = "search"
  input.autocomplete = "off"
  input.maxLength = 120
  input.value = state.matchSearch
  input.placeholder = "Buscar coincidencias"
  const button = element("button", "secondary-btn", "Buscar coincidencias")
  button.type = "submit"
  controls.append(input, button)
  form.append(label, controls)
  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    button.disabled = true
    button.textContent = "Buscando…"
    await loadMatchState(input.value)
    renderDetail()
    document.getElementById("providerMatchSearch")?.focus()
  })
  return form
}

function candidateCard(candidate, current) {
  const card = element("article", `candidate-card${candidate.active ? "" : " inactive"}`)
  const header = element("div", "candidate-card-header")
  const identity = document.createElement("div")
  identity.append(
    element("strong", "", candidate.alias || "Proveedor maestro"),
    element("span", "", candidate.legal_name || "Razón social no informada"),
  )
  const confidence = element(
    "span",
    `confidence-badge confidence-${candidate.confidence || "low"}`,
    `${MATCH_CONFIDENCE[candidate.confidence] || "Confianza baja"} · ${Number(candidate.score || 0)}/100`,
  )
  header.append(identity, confidence)

  const summary = element(
    "p",
    "candidate-summary",
    `${displayValue(candidate.bank)} · CLABE ${displayValue(candidate.clabe_masked)} · Cuenta ${displayValue(candidate.account_masked)}`,
  )
  const reasons = matchTagList("Señales", candidate.reasons || [], "reason")
  const differences = matchTagList("Diferencias", candidate.differences || [], "difference")
  const actions = element("div", "candidate-actions")
  const compare = element("button", "secondary-btn", "Comparar")
  compare.type = "button"
  compare.addEventListener("click", () => openMatchComparison(candidate.proveedor_id, compare))
  actions.append(compare)

  const alreadyLinked = current?.proveedor_id === candidate.proveedor_id
  const select = element(
    "button",
    "primary-btn",
    alreadyLinked ? "Vínculo actual" : current ? "Seleccionar para cambio" : "Seleccionar proveedor",
  )
  select.type = "button"
  select.disabled = !candidate.selectable || alreadyLinked
  if (!candidate.active) {
    select.textContent = "Proveedor inactivo"
    select.setAttribute("aria-describedby", `inactive-${candidate.proveedor_id}`)
    const warning = element("p", "match-warning", "Coincidencia crítica con un proveedor inactivo; no es seleccionable.")
    warning.id = `inactive-${candidate.proveedor_id}`
    card.append(warning)
  }
  select.addEventListener("click", () => openMatchComparison(candidate.proveedor_id, select))
  actions.append(select)
  card.append(header, summary, reasons, differences, actions)
  return card
}

function matchTagList(label, values, type) {
  const wrapper = element("div", "match-tag-group")
  wrapper.append(element("span", "match-tag-label", label))
  const list = element("ul", "match-tag-list")
  if (!values.length) {
    list.append(element("li", "match-tag neutral", type === "reason" ? "Búsqueda manual" : "Sin diferencias informadas"))
  } else {
    values.forEach((value) => list.append(element("li", `match-tag ${type}`, value)))
  }
  wrapper.append(list)
  return wrapper
}

function matchHistory(history) {
  const wrapper = element("div", "match-history")
  wrapper.append(element("h4", "", "Historial de matching"))
  if (!history.length) {
    wrapper.append(element("p", "empty-inline", "Aún no hay operaciones de matching."))
    return wrapper
  }
  const list = element("ol", "match-history-list")
  history.forEach((entry) => {
    const item = element("li", "match-history-item")
    const action = ({
      match_set: "Vínculo confirmado",
      match_replace: "Vínculo reemplazado",
      match_clear: "Vínculo retirado",
    })[entry.action_kind] || "Matching actualizado"
    item.append(
      element("strong", "", action),
      element("span", "", `${displayValue(entry.previous_provider)} → ${displayValue(entry.new_provider)}`),
      element("span", "event-meta", `${actorLabel(entry.actor_type)} · ${formatDateTime(entry.created_at)}`),
    )
    if (entry.reason) item.append(element("p", "event-note", entry.reason))
    list.append(item)
  })
  wrapper.append(list)
  return wrapper
}

async function openMatchComparison(providerId, trigger) {
  const intake = state.detail?.intake
  const matchData = state.matchData
  if (!intake || !matchData) return

  state.matchTrigger = trigger
  state.matchAction = null
  dom.matchTitle.textContent = "Comparar proveedor"
  dom.matchDescription.textContent = "Revisa los datos declarados y maestros campo por campo."
  dom.comparisonContent.replaceChildren(element("p", "empty-inline", "Preparando comparación…"))
  dom.matchReasonFields.hidden = true
  dom.confirmMatchBtn.hidden = true
  dom.matchError.textContent = ""
  dom.matchDialog.showModal()

  const { data, error } = await supabaseClient.rpc("get_provider_intake_match_comparison", {
    p_payment_intake_id: intake.id,
    p_proveedor_id: providerId,
  })
  if (error) {
    dom.comparisonContent.replaceChildren(element("p", "match-error-inline", friendlyError(error)))
    return
  }

  const currentId = matchData.current_match?.proveedor_id || null
  const readonly = !matchData.eligible || !data.provider_active || currentId === providerId
  const kind = currentId ? "replace" : "set"
  state.matchAction = {
    kind,
    providerId,
    providerAlias: data.provider_alias,
    readonly,
    actionId: createUuid(),
  }
  renderMatchComparison(data)
  configureMatchConfirmation(kind, readonly)
}

function renderMatchComparison(comparison) {
  const wrapper = element("div", "comparison-wrapper")
  const summary = element("div", "comparison-summary")
  summary.append(
    element("strong", "", comparison.provider_alias || "Proveedor maestro"),
    element("span", comparison.provider_active ? "status-text active" : "status-text inactive", comparison.provider_active ? "Proveedor activo" : "Proveedor inactivo"),
  )
  wrapper.append(summary)

  const tableWrap = element("div", "comparison-table-wrap")
  const table = element("table", "comparison-table")
  const caption = element("caption", "sr-only", "Comparación entre datos declarados y proveedor maestro")
  const thead = document.createElement("thead")
  const headRow = document.createElement("tr")
  ;["Dato", "Declarado en portal", "Proveedor maestro", "Resultado"].forEach((label) => {
    const th = element("th", "", label)
    th.scope = "col"
    headRow.append(th)
  })
  thead.append(headRow)
  const tbody = document.createElement("tbody")
  ;(comparison.rows || []).forEach((row) => {
    const tr = document.createElement("tr")
    const field = element("th", "", row.field || "Dato")
    field.scope = "row"
    const declared = element("td", "", displayValue(row.declared))
    const master = element("td", "", displayValue(row.master))
    const result = element("td", `comparison-result result-${row.result || "not_reported"}`, COMPARISON_RESULT[row.result] || "No informado")
    tr.append(field, declared, master, result)
    tbody.append(tr)
  })
  table.append(caption, thead, tbody)
  tableWrap.append(table)
  wrapper.append(tableWrap)
  dom.comparisonContent.replaceChildren(wrapper)
}

function configureMatchConfirmation(kind, readonly) {
  dom.matchReason.value = ""
  dom.matchError.textContent = ""
  dom.matchReasonFields.hidden = readonly
  dom.confirmMatchBtn.hidden = readonly
  dom.matchReasonCode.value = kind === "replace" ? "match_corrected" : "candidate_selected"
  dom.matchReasonRequired.textContent = kind === "replace" ? "(obligatoria, mínimo 10 caracteres)" : "(opcional)"
  dom.matchReason.placeholder = kind === "replace"
    ? "Explica por qué se reemplaza el vínculo, sin incluir datos sensibles"
    : "Contexto opcional, sin incluir datos sensibles"
  dom.confirmMatchBtn.textContent = kind === "replace" ? "Confirmar cambio" : "Confirmar vínculo"
  updateMatchReasonCounter()
  if (!readonly) window.setTimeout(() => dom.matchReasonCode.focus(), 0)
}

function openClearMatch(trigger) {
  const current = state.matchData?.current_match
  if (!current || !state.matchData?.eligible) return
  state.matchTrigger = trigger
  state.matchAction = {
    kind: "clear",
    providerId: null,
    providerAlias: current.alias,
    readonly: false,
    actionId: createUuid(),
  }
  dom.matchTitle.textContent = "Retirar vínculo"
  dom.matchDescription.textContent = "La solicitud quedará sin proveedor maestro. El historial se conservará."
  dom.comparisonContent.replaceChildren(element(
    "p",
    "clear-match-warning",
    `Vas a retirar el vínculo con ${current.alias || "el proveedor maestro"}. Esta acción no modifica ni elimina al proveedor.`,
  ))
  dom.matchReasonFields.hidden = false
  dom.confirmMatchBtn.hidden = false
  dom.matchReasonCode.value = "no_longer_matches"
  dom.matchReason.value = ""
  dom.matchReasonRequired.textContent = "(obligatoria, mínimo 10 caracteres)"
  dom.matchReason.placeholder = "Explica por qué el vínculo ya no corresponde, sin incluir datos sensibles"
  dom.confirmMatchBtn.textContent = "Retirar vínculo"
  dom.matchError.textContent = ""
  updateMatchReasonCounter()
  dom.matchDialog.showModal()
  window.setTimeout(() => dom.matchReason.focus(), 0)
}

async function submitMatch(event) {
  event.preventDefault()
  const intake = state.detail?.intake
  const action = state.matchAction
  const currentId = state.matchData?.current_match?.proveedor_id || null
  if (!intake || !action || action.readonly) return

  const reason = dom.matchReason.value.trim()
  if (["replace", "clear"].includes(action.kind) && (reason.length < 10 || reason.length > 500)) {
    dom.matchError.textContent = "La razón obligatoria debe tener entre 10 y 500 caracteres."
    dom.matchReason.focus()
    return
  }
  if (/@|[0-9]{8,}|<[^>]*>/.test(reason)) {
    dom.matchError.textContent = "Retira datos sensibles, números extensos o etiquetas del motivo."
    dom.matchReason.focus()
    return
  }

  dom.matchError.textContent = ""
  dom.confirmMatchBtn.disabled = true
  const originalLabel = dom.confirmMatchBtn.textContent
  dom.confirmMatchBtn.textContent = "Guardando…"

  const { error } = await supabaseClient.rpc("set_provider_intake_match", {
    p_payment_intake_id: intake.id,
    p_expected_status: intake.status,
    p_expected_updated_at: intake.updated_at,
    p_expected_current_match: currentId,
    p_proveedor_id: action.providerId,
    p_reason: reason || null,
    p_reason_code: dom.matchReasonCode.value,
    p_action_id: action.actionId,
  })

  dom.confirmMatchBtn.disabled = false
  dom.confirmMatchBtn.textContent = originalLabel
  if (error) {
    dom.matchError.textContent = friendlyError(error)
    return
  }

  closeMatchDialog()
  showToast(
    action.kind === "clear" ? "Vínculo retirado" : action.kind === "replace" ? "Vínculo actualizado" : "Proveedor vinculado",
    "La operación quedó registrada en el historial append-only.",
    "success",
  )
  await refreshOpenDetail()
  await loadList()
}

async function refreshOpenDetail() {
  const intakeId = state.detail?.intake?.id
  if (!intakeId) return
  const { data, error } = await supabaseClient.rpc("get_provider_intake_detail", {
    p_payment_intake_id: intakeId,
  })
  if (error) {
    showToast("No fue posible recargar", friendlyError(error), "error")
    return
  }
  state.detail = data
  state.matchSearch = ""
  await loadMatchState()
  renderDetail()
}

function closeMatchDialog() {
  if (dom.matchDialog.open) dom.matchDialog.close()
}

function updateMatchReasonCounter() {
  dom.matchReasonCounter.textContent = `${dom.matchReason.value.length} / 500`
}

function filesSection(files, intake) {
  const section = element("section", "detail-section full")
  section.append(element("h3", "", "Documentos privados"))
  if (!files.length) {
    section.append(element("p", "empty-inline", "Esta solicitud no contiene documentos."))
    return section
  }
  const list = element("ul", "file-list")
  files.forEach((file) => {
    const item = element("li", "file-item")
    const info = document.createElement("div")
    info.append(
      element("div", "file-name", file.original_filename || "Documento"),
      element("div", "file-meta", `${FILE_KIND_LABELS[file.file_kind] || "Documento"} · ${file.mime_type || "Tipo no indicado"} · ${formatBytes(file.size_bytes)} · ${quarantineLabel(file.quarantine_status)}`),
    )
    const button = element("button", "secondary-btn", "Abrir temporalmente")
    button.type = "button"
    button.setAttribute("aria-label", `Generar enlace temporal para ${file.original_filename || "documento"}`)
    button.addEventListener("click", () => openTemporaryFile(intake.id, file.id, button))
    item.append(info, button)
    list.append(item)
  })
  section.append(list)
  return section
}

function eventsSection(events) {
  const section = element("section", "detail-section full")
  section.append(element("h3", "", "Historial append-only"))
  if (!events.length) {
    section.append(element("p", "empty-inline", "No hay eventos disponibles."))
    return section
  }
  const list = element("ol", "event-list")
  events.forEach((event) => {
    const item = element("li", "event-item")
    const head = element("div", "event-head")
    head.append(
      element("span", "event-title", eventTitle(event)),
      element("time", "event-meta", formatDateTime(event.created_at)),
    )
    item.append(
      head,
      element("div", "event-meta", `${event.actor_name || "Sistema"} · ${actorLabel(event.actor_type)}`),
    )
    if (event.notes) item.append(element("p", "event-note", event.notes))
    list.append(item)
  })
  section.append(list)
  return section
}

function renderDetailActions(intake) {
  dom.detailActions.replaceChildren()
  const actions = []
  if (intake.status === "received") {
    actions.push(actionButton("Iniciar revisión", "transition", "in_review"))
  }
  if (intake.status === "in_review") {
    actions.push(actionButton("Pedir corrección", "transition", "needs_correction"))
    actions.push(actionButton("Rechazar", "transition", "rejected", true))
  }
  if (intake.status === "needs_correction") {
    actions.push(actionButton("Retomar revisión", "transition", "in_review"))
    actions.push(actionButton("Rechazar", "transition", "rejected", true))
  }
  actions.push(actionButton("Agregar nota interna", "note", null))
  dom.detailActions.append(...actions)
}

function actionButton(label, kind, toStatus, danger = false) {
  const button = element("button", danger ? "secondary-btn danger-action" : "secondary-btn", label)
  button.type = "button"
  button.addEventListener("click", () => openActionDialog({ kind, toStatus, trigger: button }))
  return button
}

function openActionDialog({ kind, toStatus, trigger }) {
  const intake = state.detail?.intake
  if (!intake) return
  state.actionTrigger = trigger
  state.action = { kind, toStatus, actionId: createUuid() }
  dom.actionNotes.value = ""
  dom.actionError.textContent = ""
  dom.confirmActionBtn.disabled = false

  if (kind === "note") {
    dom.actionTitle.textContent = "Agregar nota interna"
    dom.actionDescription.textContent = `La nota se agregará al historial de ${intake.public_folio}. No modifica el payload original.`
    dom.actionRequiredLabel.textContent = "(obligatorio)"
    dom.actionNotes.placeholder = "Contexto operativo para el equipo interno"
    dom.confirmActionBtn.textContent = "Agregar nota"
  } else {
    const config = transitionCopy(toStatus)
    dom.actionTitle.textContent = config.title
    dom.actionDescription.textContent = `${config.description} Estado actual: ${STATUS[intake.status]?.label || intake.status}.`
    dom.actionRequiredLabel.textContent = config.required ? "(obligatorio, mínimo 10 caracteres)" : "(opcional)"
    dom.actionNotes.placeholder = config.placeholder
    dom.confirmActionBtn.textContent = config.button
  }
  updateActionCounter()
  dom.actionDialog.showModal()
  window.setTimeout(() => dom.actionNotes.focus(), 0)
}

function closeActionDialog() {
  if (dom.actionDialog.open) dom.actionDialog.close()
}

async function submitAction(event) {
  event.preventDefault()
  const intake = state.detail?.intake
  const action = state.action
  if (!intake || !action) return

  const notes = dom.actionNotes.value.trim()
  const validation = validateAction(action, notes)
  if (validation) {
    dom.actionError.textContent = validation
    dom.actionNotes.focus()
    return
  }

  dom.actionError.textContent = ""
  dom.confirmActionBtn.disabled = true
  const originalLabel = dom.confirmActionBtn.textContent
  dom.confirmActionBtn.textContent = "Guardando…"

  const request = action.kind === "note"
    ? supabaseClient.rpc("add_provider_intake_note", {
        p_payment_intake_id: intake.id,
        p_expected_updated_at: intake.updated_at,
        p_notes: notes,
        p_action_id: action.actionId,
      })
    : supabaseClient.rpc("transition_provider_intake", {
        p_payment_intake_id: intake.id,
        p_expected_status: intake.status,
        p_expected_updated_at: intake.updated_at,
        p_to_status: action.toStatus,
        p_notes: notes || null,
        p_action_id: action.actionId,
      })

  const { error } = await request
  dom.confirmActionBtn.disabled = false
  dom.confirmActionBtn.textContent = originalLabel

  if (error) {
    dom.actionError.textContent = friendlyError(error)
    return
  }

  closeActionDialog()
  showToast(
    action.kind === "note" ? "Nota agregada" : "Estado actualizado",
    action.kind === "note" ? "El historial conserva la nueva nota interna." : "Se registró un único evento de auditoría.",
    "success",
  )
  await Promise.all([reloadOpenDetail(), loadList()])
}

function validateAction(action, notes) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(notes) || /<[^>]*>/.test(notes)) {
    return "El comentario contiene caracteres o etiquetas no permitidos."
  }
  if (notes.length > 2000) return "El comentario no puede exceder 2000 caracteres."
  if (action.kind === "note" && notes.length < 3) return "Escribe una nota de al menos 3 caracteres."
  if (["needs_correction", "rejected"].includes(action.toStatus) && notes.length < 10) {
    return "Explica el motivo operativo en al menos 10 caracteres."
  }
  return ""
}

async function reloadOpenDetail() {
  const intakeId = state.detail?.intake?.id
  if (!intakeId || !dom.detailDialog.open) return
  const { data, error } = await supabaseClient.rpc("get_provider_intake_detail", {
    p_payment_intake_id: intakeId,
  })
  if (error) {
    dom.detailContent.replaceChildren(element("p", "empty-inline", friendlyError(error)))
    return
  }
  state.detail = data
  renderDetail()
}

async function openTemporaryFile(intakeId, fileId, button) {
  const originalLabel = button.textContent
  button.disabled = true
  button.textContent = "Generando enlace…"
  try {
    const { data: { session } } = await supabaseClient.auth.getSession()
    if (!session?.access_token) throw new Error("auth_required")

    const response = await fetch("./api/provider-intake-file-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        payment_intake_id: intakeId,
        file_id: fileId,
      }),
      cache: "no-store",
      credentials: "same-origin",
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok || !result.url) throw new Error(result.error || "signed_url_unavailable")

    const url = new URL(result.url)
    if (url.protocol !== "https:") throw new Error("signed_url_unavailable")
    window.open(url.toString(), "_blank", "noopener,noreferrer")
    showToast("Enlace temporal generado", `El acceso expira en ${Number(result.expires_in || 120)} segundos.`, "info")
  } catch (error) {
    showToast("Documento no disponible", friendlyError(error), "error")
  } finally {
    button.disabled = false
    button.textContent = originalLabel
  }
}

function transitionCopy(toStatus) {
  return ({
    in_review: {
      title: "Iniciar o retomar revisión",
      description: "La solicitud quedará asignada al flujo interno de revisión.",
      placeholder: "Contexto opcional para el historial",
      button: "Confirmar revisión",
      required: false,
    },
    needs_correction: {
      title: "Pedir corrección",
      description: "Registra exactamente qué información debe corregirse. Esta fase no envía notificaciones externas.",
      placeholder: "Describe la corrección requerida",
      button: "Solicitar corrección",
      required: true,
    },
    rejected: {
      title: "Rechazar solicitud",
      description: "Explica el motivo operativo. La solicitud quedará sin transiciones disponibles en esta fase.",
      placeholder: "Motivo del rechazo",
      button: "Rechazar solicitud",
      required: true,
    },
  })[toStatus] || {
    title: "Actualizar solicitud",
    description: "Confirma la acción.",
    placeholder: "Comentario",
    button: "Confirmar",
    required: false,
  }
}

function friendlyError(error) {
  const raw = String(error?.message || error || "")
  const code = Object.keys(ERROR_MESSAGES).find((key) => raw.includes(key))
  return code ? ERROR_MESSAGES[code] : "No fue posible completar la operación. Actualiza la bandeja e inténtalo de nuevo."
}

const ERROR_MESSAGES = Object.freeze({
  provider_intake_auth_required: "Tu sesión ya no es válida. Inicia sesión nuevamente.",
  auth_required: "Tu sesión ya no es válida. Inicia sesión nuevamente.",
  provider_intake_access_denied: "No tienes permisos para revisar solicitudes de proveedores.",
  access_denied: "No tienes permisos para acceder a este documento.",
  provider_intake_company_access_denied: "La solicitud pertenece a una empresa fuera de tu acceso.",
  provider_intake_not_found: "La solicitud ya no está disponible.",
  file_not_found: "El documento no existe o no pertenece a esta solicitud.",
  provider_intake_conflict: "Esta solicitud fue actualizada por otro usuario. Recarga el detalle.",
  provider_intake_invalid_transition: "El estado actual no permite esta transición.",
  provider_intake_comment_length: "El comentario obligatorio debe tener entre 10 y 2000 caracteres.",
  provider_intake_comment_invalid: "El comentario contiene caracteres o etiquetas no permitidos.",
  provider_intake_note_length: "La nota debe tener entre 3 y 2000 caracteres.",
  provider_intake_note_invalid: "La nota contiene caracteres o etiquetas no permitidos.",
  provider_intake_action_id_conflict: "La acción no pudo validarse de forma idempotente. Actualiza el detalle.",
  provider_intake_action_id_material_conflict: "La acción cambió después de iniciarse. Actualiza el detalle.",
  provider_intake_action_id_legacy_conflict: "La acción no cumple el contrato vigente. Actualiza el detalle.",
  provider_intake_search_too_short: "Escribe al menos dos caracteres para buscar.",
  provider_intake_comparison_fields_required: "Selecciona un proveedor para comparar.",
  provider_intake_match_fields_required: "Faltan datos de confirmación. Actualiza el detalle.",
  provider_intake_match_unchanged: "El proveedor seleccionado ya es el vínculo actual.",
  provider_intake_match_reason_code_invalid: "Selecciona un motivo válido.",
  provider_intake_match_reason_required: "La razón obligatoria debe tener entre 10 y 500 caracteres.",
  provider_intake_match_reason_sensitive: "Retira datos sensibles del motivo.",
  provider_intake_match_status_invalid: "El matching solo puede modificarse mientras la solicitud está en revisión.",
  provider_intake_match_converted: "La solicitud ya fue convertida y el vínculo es de solo lectura.",
  provider_intake_provider_not_found: "El proveedor maestro ya no está disponible.",
  provider_intake_provider_inactive: "El proveedor maestro está inactivo y no puede seleccionarse.",
  file_service_unavailable: "El servicio de documentos temporales aún no está configurado en este ambiente.",
  signed_url_unavailable: "No se pudo generar el enlace temporal. Inténtalo de nuevo.",
})

function eventTitle(event) {
  if (event.from_status && event.to_status && event.from_status !== event.to_status) {
    return `${STATUS[event.from_status]?.label || event.from_status} → ${STATUS[event.to_status]?.label || event.to_status}`
  }
  return EVENT_LABELS[event.event_type] || "Evento de auditoría"
}

function actorLabel(actorType) {
  return ({
    public_provider: "Proveedor externo",
    finance: "Finanzas",
    admin: "Administración",
    sysadmin: "Sysadmin",
    system: "Sistema",
  })[actorType] || "Actor interno"
}

function quarantineLabel(status) {
  return ({
    pending: "En cuarentena",
    accepted: "Aceptado",
    rejected: "Rechazado",
  })[status] || "Estado no indicado"
}

function restoreDetailFocus() {
  const trigger = state.detailTrigger
  state.detailTrigger = null
  state.detail = null
  state.matchData = null
  state.matchSearch = ""
  if (trigger?.isConnected) trigger.focus()
}

function restoreActionFocus() {
  const trigger = state.actionTrigger
  state.actionTrigger = null
  state.action = null
  if (trigger?.isConnected) trigger.focus()
}

function restoreMatchFocus() {
  const trigger = state.matchTrigger
  state.matchTrigger = null
  state.matchAction = null
  if (trigger?.isConnected) trigger.focus()
}

function updateActionCounter() {
  dom.actionCounter.textContent = `${dom.actionNotes.value.length} / 2000`
}

function element(tag, className = "", text = null) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== null) node.textContent = String(text)
  return node
}

function optionElement(value, label) {
  const option = document.createElement("option")
  option.value = value
  option.textContent = label
  return option
}

function displayValue(value) {
  return value === null || value === undefined || value === "" ? "No indicado" : String(value)
}

function formatDate(value) {
  if (!value) return "No indicada"
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return "No indicada"
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date)
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Fecha no disponible"
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

function formatMoney(value, currency = "MXN") {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "Monto no indicado"
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      maximumFractionDigits: 2,
    }).format(amount)
  } catch (_) {
    return `${amount.toFixed(2)} ${currency || "MXN"}`
  }
}

function formatAge(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  if (days === 0) return "Hoy"
  if (days === 1) return "1 día"
  return `${days} días`
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return "Tamaño no indicado"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function numberFormat(value) {
  return new Intl.NumberFormat("es-MX").format(Number(value || 0))
}

function createUuid() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  window.crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

function showToast(title, message, type = "info") {
  const variant = ({ success: "success", error: "danger", warning: "warning", info: "info" })[type] || "info"
  Components.showToast({ title, desc: message, variant, duration: 6 })
}
