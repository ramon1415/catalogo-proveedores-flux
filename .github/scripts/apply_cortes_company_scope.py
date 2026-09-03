from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


js_path = Path("approval_batches.js")
html_path = Path("approval_batches.html")
frame_path = Path("app/src/pages/LegacyModuleFrame.tsx")

replace_once(
    js_path,
    """  regularizationDecision: null,
}""",
    """  regularizationDecision: null,
  companyScopeId: null,
  companyScopeRequired: false,
  companyScopeName: "",
}""",
)

replace_once(
    js_path,
    """async function init() {
  cacheDom()
  bindEvents()
  applyTheme()
  const authorized = await resolveUser()
  if (!authorized) return
  try {""",
    """async function init() {
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
  try {""",
)

replace_once(
    js_path,
    """    state.selectedId = new URLSearchParams(window.location.search).get("batch_id") || null""",
    """    state.selectedId = params.get("batch_id") || null""",
)

replace_once(
    js_path,
    """function applyTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.dataset.theme = saved
}
""",
    """function applyTheme() {
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
  return !state.companyScopeId || row?.company_id === state.companyScopeId
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
""",
)

replace_once(
    js_path,
    """async function loadReferenceData() {
  if (!state.isFinance) return
  const companies = await supabaseClient.from("companies").select("id,name,legal_name,active").eq("active", true).order("name")
  if (companies.error) throw companies.error
  state.companies = companies.data || []
  fillCompanyOptions()
  await loadCompanySettings()
}""",
    """async function loadReferenceData() {
  if (!state.isFinance) return
  let companyQuery = supabaseClient.from("companies").select("id,name,legal_name,active").eq("active", true).order("name")
  if (state.companyScopeId) companyQuery = companyQuery.eq("id", state.companyScopeId)
  const companies = await companyQuery
  if (companies.error) throw companies.error
  state.companies = scopeCompanyRows(companies.data)
  if (state.companyScopeId && state.companies.length !== 1) throw new Error("selected_company_not_available")
  state.companyScopeName = state.companies.find((company) => company.id === state.companyScopeId)?.legal_name
    || state.companies.find((company) => company.id === state.companyScopeId)?.name
    || ""
  fillCompanyOptions()
  await loadCompanySettings()
}""",
)

replace_once(
    js_path,
    """  const { data, error } = await supabaseClient
    .from("approval_batch_company_settings")
    .select("company_id,regular_payments_require_closed_batch,enforcement_started_at,enabled_by,enabled_at,updated_at")""",
    """  let settingsQuery = supabaseClient
    .from("approval_batch_company_settings")
    .select("company_id,regular_payments_require_closed_batch,enforcement_started_at,enabled_by,enabled_at,updated_at")
  if (state.companyScopeId) settingsQuery = settingsQuery.eq("company_id", state.companyScopeId)
  const { data, error } = await settingsQuery""",
)

replace_once(
    js_path,
    """  const { data, error } = await supabaseClient.rpc("list_company_directors", { p_company_id: null })""",
    """  const { data, error } = await supabaseClient.rpc("list_company_directors", { p_company_id: state.companyScopeId || null })""",
)

replace_once(
    js_path,
    """  state.directors = asArray(data)
  fillCreateDirectors()""",
    """  state.directors = scopeCompanyRows(data)
  fillCreateDirectors()""",
)

replace_once(
    js_path,
    """async function loadDirectorCandidates(companyId = null) {
  if (!state.isFinance) return
  const { data, error } = await supabaseClient.rpc("list_approval_batch_director_candidates", { p_company_id: companyId || null })""",
    """async function loadDirectorCandidates(companyId = null) {
  if (!state.isFinance) return
  const requestedCompanyId = state.companyScopeId || companyId || null
  const { data, error } = await supabaseClient.rpc("list_approval_batch_director_candidates", { p_company_id: requestedCompanyId })""",
)

replace_once(
    js_path,
    """    state.batches = asArray(data)
    if (state.view === "director") {""",
    """    state.batches = scopeCompanyRows(data)
    if (state.companyScopeId && !state.companyScopeName && state.batches.length) {
      state.companyScopeName = state.batches[0].company_name || ""
    }
    if (state.view === "director") {""",
)

replace_once(
    js_path,
    """async function refreshAll() {
  await loadCompanySettings()
  await loadDirectors()
  await loadBatches()
}""",
    """async function refreshAll() {
  await loadCompanySettings()
  await loadDirectors()
  await loadBatches()
  await loadRegularizations()
}""",
)

replace_once(
    js_path,
    """  const { data, error } = await supabaseClient.rpc("list_extraordinary_regularizations", {
    p_company_id: null,
  })""",
    """  const { data, error } = await supabaseClient.rpc("list_extraordinary_regularizations", {
    p_company_id: state.companyScopeId || null,
  })""",
)

replace_once(
    js_path,
    """  state.regularizations = asArray(data)
  renderRegularizations()""",
    """  state.regularizations = scopeCompanyRows(data)
  renderRegularizations()""",
)

replace_once(
    js_path,
    """  dom.pageContext.textContent = state.view === "finance" ? "Preparacion por Finanzas" : "Decision de Direccion"""",
    """  const context = state.view === "finance" ? "Preparacion por Finanzas" : "Decision de Direccion"
  dom.pageContext.textContent = state.companyScopeName ? `${context} · ${state.companyScopeName}` : context""",
)

replace_once(
    js_path,
    """async function openBatch(batchId) {
  if (state.selectedId !== batchId) state.selectedEligibleIds.clear()
  state.selectedId = batchId""",
    """async function openBatch(batchId) {
  const listedBatch = state.batches.find((batch) => batch.id === batchId)
  if (!listedBatch || !isWithinCompanyScope(listedBatch)) {
    state.selectedId = null
    state.detail = null
    renderBatchList()
    renderEmptyDetail("Este corte no pertenece a la empresa seleccionada.")
    return
  }
  if (state.selectedId !== batchId) state.selectedEligibleIds.clear()
  state.selectedId = batchId""",
)

replace_once(
    js_path,
    """    state.detail = data || { batch: null, items: [] }
    state.eligible = []""",
    """    state.detail = data || { batch: null, items: [] }
    if (!isWithinCompanyScope(state.detail.batch)) throw new Error("batch_company_scope_mismatch")
    state.eligible = []""",
)

replace_once(
    js_path,
    """async function createBatch(event) {
  event.preventDefault()
  const submit = dom.createBatchForm.querySelector('[type="submit"]')
  submit.disabled = true
  try {
    const { data, error } = await supabaseClient.rpc("create_approval_batch", {
      p_company_id: dom.createCompanyId.value,""",
    """async function createBatch(event) {
  event.preventDefault()
  const submit = dom.createBatchForm.querySelector('[type="submit"]')
  submit.disabled = true
  try {
    const companyId = dom.createCompanyId.value
    if (!companyId) throw new Error("select_company")
    if (state.companyScopeId && companyId !== state.companyScopeId) throw new Error("company_scope_mismatch")
    const { data, error } = await supabaseClient.rpc("create_approval_batch", {
      p_company_id: companyId,""",
)

replace_once(
    js_path,
    """  try {
    const { error } = await supabaseClient.rpc("set_company_batch_configuration", {
      p_company_id: dom.directorCompanyId.value,""",
    """  try {
    const companyId = dom.directorCompanyId.value
    if (!companyId) throw new Error("select_company")
    if (state.companyScopeId && companyId !== state.companyScopeId) throw new Error("company_scope_mismatch")
    const { error } = await supabaseClient.rpc("set_company_batch_configuration", {
      p_company_id: companyId,""",
)

replace_once(
    js_path,
    """function fillCompanyOptions() {
  const options = state.companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.legal_name || company.name)}</option>`).join("")
  ;[dom.createCompanyId, dom.directorCompanyId].forEach((select) => {
    if (!select) return
    const current = select.value
    select.innerHTML = `<option value="">Selecciona...</option>${options}`
    if (state.companies.some((company) => company.id === current)) select.value = current
  })
}""",
    """function fillCompanyOptions() {
  const companies = scopeCompanyRows(state.companies)
  const options = companies.map((company) => `<option value="${escapeHtml(company.id)}">${escapeHtml(company.legal_name || company.name)}</option>`).join("")
  ;[dom.createCompanyId, dom.directorCompanyId].forEach((select) => {
    if (!select) return
    const current = state.companyScopeId || select.value
    select.innerHTML = `<option value="">Selecciona...</option>${options}`
    if (companies.some((company) => company.id === current)) select.value = current
    select.disabled = Boolean(state.companyScopeId)
  })
}""",
)

replace_once(
    js_path,
    """    finance_role_required: "Se requiere rol de Finanzas.",""",
    """    finance_role_required: "Se requiere rol de Finanzas.",
    selected_company_not_available: "La empresa seleccionada no esta activa o no esta disponible para esta vista.",
    company_scope_mismatch: "La operacion no corresponde a la empresa seleccionada.",
    batch_company_scope_mismatch: "El corte solicitado pertenece a otra empresa.",
    select_company: "Selecciona una empresa antes de continuar.",""",
)

replace_once(
    html_path,
    """  <script src="./approval_batches.js?v=20260805-extraordinary-regularization"></script>""",
    """  <script src="./approval_batches.js?v=20260903-company-scope"></script>""",
)

qa_path = Path("scripts/qa/approval-batches-company-scope-contract.test.mjs")
qa_path.write_text(
    """import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const cuts = fs.readFileSync('approval_batches.js', 'utf8')
const html = fs.readFileSync('approval_batches.html', 'utf8')
const frame = fs.readFileSync('app/src/pages/LegacyModuleFrame.tsx', 'utf8')

test('React passes the active company to the embedded weekly-cuts module', () => {
  assert.match(frame, /company_id=\$\{encodeURIComponent\(companyId\)\}/)
  assert.match(frame, /const \{ companyId \} = useCompany\(\)/)
})

test('weekly cuts parse a valid company scope and fail closed on an invalid requested scope', () => {
  assert.match(cuts, /companyScopeRequired:\s*false/)
  assert.match(cuts, /state\.companyScopeRequired = params\.has\("company_id"\)/)
  assert.match(cuts, /state\.companyScopeId = parseUuid\(params\.get\("company_id"\)\)/)
  assert.match(cuts, /state\.companyScopeRequired && !state\.companyScopeId[\s\S]*renderCompanyScopeError/)
})

test('batch, director, settings and regularization reads are scoped to the selected company', () => {
  assert.match(cuts, /state\.batches = scopeCompanyRows\(data\)/)
  assert.match(cuts, /list_company_directors", \{ p_company_id: state\.companyScopeId \|\| null \}/)
  assert.match(cuts, /settingsQuery = settingsQuery\.eq\("company_id", state\.companyScopeId\)/)
  assert.match(cuts, /list_extraordinary_regularizations", \{[\s\S]*p_company_id: state\.companyScopeId \|\| null/)
  assert.match(cuts, /state\.regularizations = scopeCompanyRows\(data\)/)
})

test('a cross-company deep link cannot render or mutate a cut', () => {
  assert.match(cuts, /const listedBatch = state\.batches\.find\(\(batch\) => batch\.id === batchId\)/)
  assert.match(cuts, /!listedBatch \|\| !isWithinCompanyScope\(listedBatch\)/)
  assert.match(cuts, /!isWithinCompanyScope\(state\.detail\.batch\)[\s\S]*batch_company_scope_mismatch/)
})

test('create and configuration selectors are locked to the active company', () => {
  assert.match(cuts, /const current = state\.companyScopeId \|\| select\.value/)
  assert.match(cuts, /select\.disabled = Boolean\(state\.companyScopeId\)/)
  assert.equal((cuts.match(/companyId !== state\.companyScopeId/g) || []).length, 2)
})

test('legacy asset uses a fresh cache key for the company-scope hotfix', () => {
  assert.match(html, /approval_batches\.js\?v=20260903-company-scope/)
})
""",
    encoding="utf-8",
)

# The parent frame already carries the active company; guard against accidental
# changes while the patch is prepared.
frame = frame_path.read_text(encoding="utf-8")
if "company_id=${encodeURIComponent(companyId)}" not in frame:
    raise SystemExit("LegacyModuleFrame no longer passes the active company_id")
