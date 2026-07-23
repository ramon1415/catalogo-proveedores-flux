const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const CXC_FILE_EXTENSION = "txt"
const CXC_MIME_TYPE = "text/plain;charset=utf-8"
const CXC_CURRENCY = "MXP"
const CXC_ACCOUNT_LENGTH = 18
const CXC_CURRENCY_LENGTH = 3
const CXC_AMOUNT_LENGTH = 16
const CXC_CONCEPT_LENGTH = 30
const CXC_LINE_LENGTH = CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH + CXC_CONCEPT_LENGTH
const CXC_LINE_BREAK = "\r\n"
const CXC_LINE_PATTERN = /^\d{18}\d{18}MXP\d{13}\.\d{2}[A-Z0-9 .,&\/-]{30}$/
const BBVA_FORMAT_SAME_BANK = "same_bank"
const BBVA_FORMAT_INTERBANK = "interbank"
const BBVA_INTERBANK_BENEFICIARY_LENGTH = 30
const BBVA_INTERBANK_REFERENCE_LENGTH = 5
const BBVA_INTERBANK_REFERENCE_INPUT_RULE = "1 a 5 digitos; el TXT completa con ceros a la izquierda"
const BBVA_INTERBANK_CONCEPT_LENGTH = 37
const BBVA_INTERBANK_INDICATOR = "H"
const BBVA_INTERBANK_LINE_LENGTH = CXC_ACCOUNT_LENGTH * 2 + CXC_CURRENCY_LENGTH + CXC_AMOUNT_LENGTH + BBVA_INTERBANK_BENEFICIARY_LENGTH + BBVA_INTERBANK_REFERENCE_LENGTH + BBVA_INTERBANK_CONCEPT_LENGTH + 1
const BBVA_INTERBANK_LINE_PATTERN = /^\d{18}\d{18}MXP\d{13}\.\d{2}[A-Z0-9 .,&\/-]{30}\d{5}[A-Z0-9 .,&\/-]{37}H$/

let layouts = []
let companies = []
let companyBankAccounts = []
let currentProfileId = null
let activeLinesLayoutId = null
let activeConfirmLayoutId = null
let activeRejectLineId = null
let activePagosintReferenceLineId = null
let activeLayoutLines = []
let layoutPagosintIssueCounts = new Map()
let layoutFormatSummaries = new Map()
let layoutEligibilityPreview = null
let layoutEligibilityPreviewParamsKey = null
let layoutPreviewRequestSequence = 0
let activeLayoutPreviewRequestId = 0
let inFlightLayoutPreviewRequestId = null
let activeLayoutRebatchItem = null
let activeLayoutCompletionRequest = null
let layoutActionConfirmResolve = null
const dom = {}

const rootElement = document.documentElement

document.addEventListener("DOMContentLoaded", initLayoutsPage)

async function initLayoutsPage() {
  cacheDom()
  bindEvents()

  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  const profile = window.FluxAuth?.getProfile?.()
  const session = window.FluxAuth?.state?.session

  if (!session) {
    window.location.href = "./index.html"
    return
  }

  dom.userName.textContent = profile?.full_name || session.user?.email || "Usuario"
  dom.userEmail.textContent = profile?.email || session.user?.email || "Sesion activa"
  currentProfileId = profile?.id || null

  try {
    await loadLayouts()
  } catch (error) {
    showToast("No fue posible iniciar", friendlyError(error), "danger")
  }
}

function cacheDom() {
  dom.userName = document.getElementById("userName")
  dom.userEmail = document.getElementById("userEmail")
  dom.logoutBtn = document.getElementById("logoutBtn")
  dom.newLayoutBtn = document.getElementById("newLayoutBtn")
  dom.refreshBtn = document.getElementById("refreshBtn")
  dom.searchInput = document.getElementById("searchInput")
  dom.statusFilter = document.getElementById("statusFilter")
  dom.layoutsTableBody = document.getElementById("layoutsTableBody")
  dom.newLayoutDialog = document.getElementById("newLayoutDialog")
  dom.newLayoutForm = document.getElementById("newLayoutForm")
  dom.layoutPeriodStart = document.getElementById("layoutPeriodStart")
  dom.layoutPeriodEnd = document.getElementById("layoutPeriodEnd")
  dom.layoutName = document.getElementById("layoutName")
  dom.layoutCompanyId = document.getElementById("layoutCompanyId")
  dom.layoutBankAccountId = document.getElementById("layoutBankAccountId")
  dom.reviewLayoutBtn = document.getElementById("reviewLayoutBtn")
  dom.layoutEligibilityPreview = document.getElementById("layoutEligibilityPreview")
  dom.layoutInvalidBox = document.getElementById("layoutInvalidBox")
  dom.closeNewLayoutModalBtn = document.getElementById("closeNewLayoutModalBtn")
  dom.cancelNewLayoutBtn = document.getElementById("cancelNewLayoutBtn")
  dom.submitNewLayoutBtn = document.getElementById("submitNewLayoutBtn")
  dom.layoutRebatchDialog = document.getElementById("layoutRebatchDialog")
  dom.layoutRebatchForm = document.getElementById("layoutRebatchForm")
  dom.layoutRebatchOriginal = document.getElementById("layoutRebatchOriginal")
  dom.layoutRebatchNote = document.getElementById("layoutRebatchNote")
  dom.layoutRebatchTarget = document.getElementById("layoutRebatchTarget")
  dom.closeLayoutRebatchBtn = document.getElementById("closeLayoutRebatchBtn")
  dom.cancelLayoutRebatchBtn = document.getElementById("cancelLayoutRebatchBtn")
  dom.submitLayoutRebatchBtn = document.getElementById("submitLayoutRebatchBtn")
  dom.layoutCompletionDialog = document.getElementById("layoutCompletionDialog")
  dom.layoutCompletionForm = document.getElementById("layoutCompletionForm")
  dom.layoutCompletionTitle = document.getElementById("layoutCompletionTitle")
  dom.layoutCompletionSummary = document.getElementById("layoutCompletionSummary")
  dom.layoutCompletionBankAccount = document.getElementById("layoutCompletionBankAccount")
  dom.layoutCompletionReference = document.getElementById("layoutCompletionReference")
  dom.layoutCompletionConcept = document.getElementById("layoutCompletionConcept")
  dom.layoutCompletionDate = document.getElementById("layoutCompletionDate")
  dom.layoutCompletionProviderFields = document.getElementById("layoutCompletionProviderFields")
  dom.layoutCompletionDestinationType = document.getElementById("layoutCompletionDestinationType")
  dom.layoutCompletionProviderBank = document.getElementById("layoutCompletionProviderBank")
  dom.layoutCompletionBeneficiary = document.getElementById("layoutCompletionBeneficiary")
  dom.layoutCompletionClabe = document.getElementById("layoutCompletionClabe")
  dom.layoutCompletionProviderAccount = document.getElementById("layoutCompletionProviderAccount")
  dom.layoutCompletionConvenio = document.getElementById("layoutCompletionConvenio")
  dom.layoutCompletionImpact = document.getElementById("layoutCompletionImpact")
  dom.closeLayoutCompletionBtn = document.getElementById("closeLayoutCompletionBtn")
  dom.cancelLayoutCompletionBtn = document.getElementById("cancelLayoutCompletionBtn")
  dom.submitLayoutCompletionBtn = document.getElementById("submitLayoutCompletionBtn")
  dom.linesDialog = document.getElementById("linesDialog")
  dom.linesTitle = document.getElementById("linesTitle")
  dom.linesSubtitle = document.getElementById("linesSubtitle")
  dom.linesFormatSummary = document.getElementById("linesFormatSummary")
  dom.linesTableBody = document.getElementById("linesTableBody")
  dom.closeLinesModalBtn = document.getElementById("closeLinesModalBtn")
  dom.pagosintReferenceDialog = document.getElementById("pagosintReferenceDialog")
  dom.pagosintReferenceForm = document.getElementById("pagosintReferenceForm")
  dom.pagosintReferenceTitle = document.getElementById("pagosintReferenceTitle")
  dom.pagosintReferenceInput = document.getElementById("pagosintReferenceInput")
  dom.pagosintBeneficiaryInput = document.getElementById("pagosintBeneficiaryInput")
  dom.pagosintConceptInput = document.getElementById("pagosintConceptInput")
  dom.closePagosintReferenceModalBtn = document.getElementById("closePagosintReferenceModalBtn")
  dom.cancelPagosintReferenceBtn = document.getElementById("cancelPagosintReferenceBtn")
  dom.submitPagosintReferenceBtn = document.getElementById("submitPagosintReferenceBtn")
  dom.confirmDialog = document.getElementById("confirmDialog")
  dom.confirmPaymentForm = document.getElementById("confirmPaymentForm")
  dom.confirmTitle = document.getElementById("confirmTitle")
  dom.paymentDate = document.getElementById("paymentDate")
  dom.bankReference = document.getElementById("bankReference")
  dom.receiptStoragePath = document.getElementById("receiptStoragePath")
  dom.closeConfirmModalBtn = document.getElementById("closeConfirmModalBtn")
  dom.cancelConfirmBtn = document.getElementById("cancelConfirmBtn")
  dom.submitConfirmBtn = document.getElementById("submitConfirmBtn")
  dom.layoutActionConfirmDialog = document.getElementById("layoutActionConfirmDialog")
  dom.layoutActionConfirmTitle = document.getElementById("layoutActionConfirmTitle")
  dom.layoutActionConfirmBody = document.getElementById("layoutActionConfirmBody")
  dom.layoutActionConfirmCloseBtn = document.getElementById("layoutActionConfirmCloseBtn")
  dom.layoutActionConfirmCancelBtn = document.getElementById("layoutActionConfirmCancelBtn")
  dom.layoutActionConfirmAcceptBtn = document.getElementById("layoutActionConfirmAcceptBtn")
  dom.rejectLineDialog = document.getElementById("rejectLineDialog")
  dom.rejectLineForm = document.getElementById("rejectLineForm")
  dom.rejectLineTitle = document.getElementById("rejectLineTitle")
  dom.rejectionReason = document.getElementById("rejectionReason")
  dom.closeRejectLineModalBtn = document.getElementById("closeRejectLineModalBtn")
  dom.cancelRejectLineBtn = document.getElementById("cancelRejectLineBtn")
  dom.submitRejectLineBtn = document.getElementById("submitRejectLineBtn")
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", logout)
  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = rootElement.dataset.theme === "dark" ? "light" : "dark"
    rootElement.dataset.theme = next
    localStorage.setItem("flux-theme", next)
  })

  dom.newLayoutBtn?.addEventListener("click", openNewLayoutModal)
  dom.refreshBtn?.addEventListener("click", loadLayouts)
  dom.searchInput?.addEventListener("input", renderLayoutsTable)
  dom.statusFilter?.addEventListener("change", renderLayoutsTable)
  dom.layoutCompanyId?.addEventListener("change", () => {
    renderLayoutBankAccountOptions()
    invalidateLayoutPreview({ filtersChanged: true })
  })
  ;[dom.layoutPeriodStart, dom.layoutPeriodEnd].forEach((field) => {
    field?.addEventListener("input", () => invalidateLayoutPreview({ filtersChanged: true }))
  })
  dom.layoutBankAccountId?.addEventListener("change", () => invalidateLayoutPreview({ filtersChanged: true }))
  dom.reviewLayoutBtn?.addEventListener("click", reviewLayoutEligibility)
  dom.layoutEligibilityPreview?.addEventListener("click", handleLayoutPreviewAction)
  dom.closeNewLayoutModalBtn?.addEventListener("click", closeNewLayoutModal)
  dom.cancelNewLayoutBtn?.addEventListener("click", closeNewLayoutModal)
  dom.newLayoutForm?.addEventListener("submit", submitNewLayout)
  dom.closeLayoutRebatchBtn?.addEventListener("click", closeLayoutRebatchDialog)
  dom.cancelLayoutRebatchBtn?.addEventListener("click", closeLayoutRebatchDialog)
  dom.layoutRebatchForm?.addEventListener("submit", submitLayoutRebatch)
  dom.closeLayoutCompletionBtn?.addEventListener("click", closeLayoutCompletionDialog)
  dom.cancelLayoutCompletionBtn?.addEventListener("click", closeLayoutCompletionDialog)
  dom.layoutCompletionDestinationType?.addEventListener("change", syncProviderExecutionDestinationRequirements)
  dom.layoutCompletionForm?.addEventListener("submit", submitLayoutCompletion)
  dom.closeLinesModalBtn?.addEventListener("click", closeLinesModal)
  dom.closePagosintReferenceModalBtn?.addEventListener("click", closePagosintReferenceModal)
  dom.cancelPagosintReferenceBtn?.addEventListener("click", closePagosintReferenceModal)
  dom.pagosintReferenceForm?.addEventListener("submit", submitPagosintReference)
  dom.closeConfirmModalBtn?.addEventListener("click", closeConfirmModal)
  dom.cancelConfirmBtn?.addEventListener("click", closeConfirmModal)
  dom.confirmPaymentForm?.addEventListener("submit", submitConfirmPayment)
  dom.layoutActionConfirmCloseBtn?.addEventListener("click", () => closeLayoutActionConfirmation(false))
  dom.layoutActionConfirmCancelBtn?.addEventListener("click", () => closeLayoutActionConfirmation(false))
  dom.layoutActionConfirmAcceptBtn?.addEventListener("click", () => closeLayoutActionConfirmation(true))
  dom.layoutActionConfirmDialog?.addEventListener("cancel", (event) => {
    event.preventDefault()
    closeLayoutActionConfirmation(false)
  })
  dom.closeRejectLineModalBtn?.addEventListener("click", closeRejectLineModal)
  dom.cancelRejectLineBtn?.addEventListener("click", closeRejectLineModal)
  dom.rejectLineForm?.addEventListener("submit", submitRejectLine)
}

// Carga y renderizado

async function loadLayouts() {
  dom.layoutsTableBody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--text-3)">Cargando layouts...</td></tr>`

  const { data, error } = await supabaseClient
    .from("payment_layouts")
    .select("id,layout_number,name,period_start,period_end,status,generated_by,generated_at,storage_path,file_name,company_count,payment_count,total_amount,created_at,updated_at")
    .order("created_at", { ascending: false })

  if (error) {
    dom.layoutsTableBody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--ruby)">No fue posible cargar layouts.</td></tr>`
    showToast("Error al cargar", rlsHint("payment_layouts", "select", error), "danger")
    return
  }

  layouts = data || []
  await loadLayoutPagosintIssues()
  renderStats()
  renderLayoutsTable()
}

async function loadLayoutPagosintIssues() {
  layoutPagosintIssueCounts = new Map()
  layoutFormatSummaries = new Map()
  const layoutIds = layouts.map((layout) => layout.id).filter(Boolean)
  if (!layoutIds.length) return

  const { data, error } = await supabaseClient
    .from("payment_layout_lines")
    .select("id,layout_id,destination_type,payment_reference,beneficiary_name,payment_concept,amount,status")
    .in("layout_id", layoutIds)
    .neq("status", "bank_rejected")

  if (error) {
    console.warn("No se pudo revisar pendientes PAGOSINT", error)
    return
  }

  const linesByLayout = new Map()
  for (const line of data || []) {
    if (!linesByLayout.has(line.layout_id)) linesByLayout.set(line.layout_id, [])
    linesByLayout.get(line.layout_id).push(line)
    if (!lineNeedsPagosintReferenceCompletion(line)) continue
    layoutPagosintIssueCounts.set(line.layout_id, (layoutPagosintIssueCounts.get(line.layout_id) || 0) + 1)
  }

  for (const [layoutId, lines] of linesByLayout.entries()) {
    layoutFormatSummaries.set(layoutId, summarizeLayoutFormats(lines))
  }
}

function renderStats() {
  const total = layouts.length
  const draft = layouts.filter((l) => l.status === "draft").length
  const generated = layouts.filter((l) => l.status === "generated").length
  const amount = layouts.reduce((sum, l) => sum + numberValue(l.total_amount), 0)

  document.getElementById("totalLayouts").textContent = total
  document.getElementById("draftLayouts").textContent = draft
  document.getElementById("generatedLayouts").textContent = generated
  document.getElementById("totalAmount").textContent = compactCurrency(amount)
}

function renderLayoutsTable() {
  const query = normalize(dom.searchInput.value)
  const status = dom.statusFilter.value

  const rows = layouts.filter((l) => {
    const searchable = normalize([l.layout_number, l.name, l.period_start, l.period_end, l.file_name].join(" "))
    return searchable.includes(query) && (status === "todos" || l.status === status)
  })

  if (!rows.length) {
    dom.layoutsTableBody.innerHTML = `<tr><td colspan="9" style="padding:44px;text-align:center;color:var(--text-3)">No hay layouts para este filtro.</td></tr>`
    return
  }

  dom.layoutsTableBody.innerHTML = rows.map((l) => `
    <tr>
      <td><span class="cell-main">${escapeHtml(l.layout_number || "Sin folio")}</span><span class="cell-sub">${escapeHtml(l.name || "")}</span></td>
      <td><span class="cell-main">${escapeHtml(formatDate(l.period_start))}</span><span class="cell-sub">${escapeHtml(formatDate(l.period_end))}</span></td>
      <td>${layoutStatusBadge(l.status)}</td>
      <td>${numberValue(l.payment_count)}</td>
      <td>${numberValue(l.company_count)}</td>
      <td><strong>${escapeHtml(formatCurrency(l.total_amount))}</strong></td>
      <td>${escapeHtml(formatDate(l.generated_at || l.created_at))}</td>
      <td>${l.file_name ? `<span class="cell-main">${escapeHtml(l.file_name)}</span>` : `<span style="color:var(--text-3);font-size:11px">Sin archivo</span>`}</td>
      <td><div class="actions row-actions">${renderLayoutActions(l)}</div></td>
    </tr>`).join("")
}

function renderLayoutActions(l) {
  const actions = [`<button class="small-btn" type="button" onclick="openLayoutLines('${l.id}')" style="white-space:nowrap">Ver lineas</button>`]
  const pendingPagosintReferences = layoutPagosintIssueCounts.get(l.id) || 0
  const formatSummary = layoutFormatSummaries.get(l.id)
  const canGenerateFiles = ["draft", "generated"].includes(l.status)

  if (l.status !== "cancelled") {
    actions.push(`<button class="small-btn" type="button" onclick="validateLayoutCxc('${l.id}')" style="white-space:nowrap">Validar layout</button>`)
  }

  if (pendingPagosintReferences > 0 && l.status !== "cancelled") {
    actions.push(`<button class="small-btn warning" type="button" onclick="openLayoutLines('${l.id}')" style="white-space:nowrap">Completar referencias</button>`)
  }

  if (canGenerateFiles) {
    actions.push(...renderFormatDownloadActions(l, formatSummary))
  }

  if (l.status === "generated") {
    actions.push(`<button class="small-btn warning" type="button" onclick="markLayoutUploaded('${l.id}')" style="white-space:nowrap">Marcar subido</button>`)
    actions.push(`<button class="small-btn success" type="button" onclick="openConfirmPaymentModal('${l.id}')" style="white-space:nowrap">Confirmar pago</button>`)
  }

  if (l.status === "uploaded") {
    actions.push(`<button class="small-btn success" type="button" onclick="openConfirmPaymentModal('${l.id}')" style="white-space:nowrap">Confirmar pago</button>`)
  }

  return actions.join("")
}

function renderFormatDownloadActions(layout, summary) {
  if (!summary) {
    const label = layout.status === "draft" ? "Generar layout de pagos" : (layout.file_name ? "Descargar layout de pagos" : "Generar layout de pagos")
    return [`<button class="small-btn" type="button" onclick="downloadLayoutCxc('${layout.id}')" style="white-space:nowrap">${label}</button>`]
  }

  const actions = []
  const sameBank = summary[BBVA_FORMAT_SAME_BANK]
  const interbank = summary[BBVA_FORMAT_INTERBANK]
  const convenio = summary.convenio
  if (sameBank.count > 0) {
    actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${layout.id}','${BBVA_FORMAT_SAME_BANK}')" style="white-space:nowrap">▾ Pagos BBVA</button>`)
  }

  if (interbank.count > 0) {
    if (interbank.referenceIssues > 0) {
      actions.push(`<button class="small-btn warning" type="button" onclick="openLayoutLines('${layout.id}')" style="white-space:nowrap">Completar PAGOSINT</button>`)
    } else {
      actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${layout.id}','${BBVA_FORMAT_INTERBANK}')" style="white-space:nowrap">▾ Pagos Inter</button>`)
    }
  }

  if (convenio.count > 0) {
    actions.push(`<button class="small-btn secondary" type="button" onclick="openLayoutLines('${layout.id}')" style="white-space:nowrap">Ver CIE pendiente</button>`)
  }

  return actions.length ? actions : [`<button class="small-btn" type="button" onclick="downloadLayoutCxc('${layout.id}')" style="white-space:nowrap">Validar lineas</button>`]
}

// Nuevo layout

async function openNewLayoutModal() {
  if (!ensureActorProfile()) return

  resetNewLayoutForm()
  dom.newLayoutDialog.showModal()

  try {
    await loadLayoutCatalogs()
  } catch (error) {
    showToast("No se pudieron cargar catalogos", friendlyError(error), "danger")
  }
}

function closeNewLayoutModal() {
  invalidateLayoutPreview()
  if (dom.newLayoutDialog.open) dom.newLayoutDialog.close()
}

function resetNewLayoutForm() {
  dom.newLayoutForm?.reset()
  layoutEligibilityPreview = null
  layoutEligibilityPreviewParamsKey = null
  activeLayoutPreviewRequestId = ++layoutPreviewRequestSequence
  activeLayoutRebatchItem = null
  dom.layoutEligibilityPreview.classList.add("hidden")
  dom.layoutEligibilityPreview.innerHTML = ""
  dom.submitNewLayoutBtn.disabled = true
  dom.submitNewLayoutBtn.textContent = "Crear layout"
  dom.layoutInvalidBox.classList.add("hidden")
  dom.layoutInvalidBox.innerHTML = ""
  resetLayoutPreviewScrollPositions()

  const today = new Date()
  const endDate = new Date(today)
  endDate.setDate(today.getDate() + 6)
  dom.layoutPeriodStart.value = today.toISOString().slice(0, 10)
  dom.layoutPeriodEnd.value = endDate.toISOString().slice(0, 10)
}

async function loadLayoutCatalogs() {
  const [companiesResult, accountsResult] = await Promise.all([
    supabaseClient.from("companies").select("id,name,legal_name,active").eq("active", true).order("name", { ascending: true }),
    supabaseClient.from("company_bank_accounts").select("id,name,bank_name,account_number,last4,company_id,active").eq("active", true).order("name", { ascending: true }),
  ])

  if (companiesResult.error) throw companiesResult.error
  if (accountsResult.error) throw accountsResult.error

  companies = companiesResult.data || []
  companyBankAccounts = accountsResult.data || []
  renderLayoutCompanyOptions()
  renderLayoutBankAccountOptions()
}

function renderLayoutCompanyOptions() {
  const selected = dom.layoutCompanyId.value
  dom.layoutCompanyId.innerHTML = [
    `<option value="">Todas las empresas</option>`,
    ...companies.map((c) => `<option value="${c.id}">${escapeHtml(c.legal_name || c.name || "Empresa sin nombre")}</option>`),
  ].join("")
  if (selected && companies.some((c) => c.id === selected)) dom.layoutCompanyId.value = selected
}

function renderLayoutBankAccountOptions() {
  const selectedCompanyId = dom.layoutCompanyId.value
  const selected = dom.layoutBankAccountId.value
  let accounts = companyBankAccounts.filter((account) => cleanText(account.account_number))

  if (selectedCompanyId) {
    accounts = accounts.filter((a) => a.company_id === selectedCompanyId)
  }

  dom.layoutBankAccountId.innerHTML = [
    `<option value="">Todas las cuentas</option>`,
    ...accounts.map((a) => {
      const label = [a.name || "Cuenta origen", a.bank_name, a.account_number ? `cta ${a.account_number}` : a.last4 ? `termina ${a.last4}` : null].filter(Boolean).join(" - ")
      return `<option value="${a.id}">${escapeHtml(label)}</option>`
    }),
  ].join("")
  if (selected && accounts.some((a) => a.id === selected)) dom.layoutBankAccountId.value = selected
}

function invalidateLayoutPreview({ filtersChanged = false } = {}) {
  activeLayoutPreviewRequestId = ++layoutPreviewRequestSequence
  layoutEligibilityPreview = null
  layoutEligibilityPreviewParamsKey = null
  dom.layoutEligibilityPreview?.classList.add("hidden")
  if (dom.layoutEligibilityPreview) dom.layoutEligibilityPreview.innerHTML = ""
  if (dom.submitNewLayoutBtn) {
    dom.submitNewLayoutBtn.disabled = true
    dom.submitNewLayoutBtn.textContent = "Revisa solicitudes primero"
  }
  resetLayoutPreviewScrollPositions()
  if (filtersChanged) {
    renderLayoutNotice("Los filtros cambiaron. Revisa nuevamente las solicitudes.")
  }
}

function layoutPreviewParams() {
  return {
    p_period_start: dom.layoutPeriodStart.value,
    p_period_end: dom.layoutPeriodEnd.value,
    p_company_id: dom.layoutCompanyId.value || null,
    p_company_bank_account_id: dom.layoutBankAccountId.value || null,
  }
}

function layoutPreviewParamsKey(params = layoutPreviewParams()) {
  return JSON.stringify([
    params.p_period_start || "",
    params.p_period_end || "",
    params.p_company_id || "",
    params.p_company_bank_account_id || "",
  ])
}

async function reviewLayoutEligibility() {
  if (!ensureActorProfile()) return
  if (inFlightLayoutPreviewRequestId !== null) return
  const params = layoutPreviewParams()
  if (!params.p_period_start || !params.p_period_end) return showToast("Fechas requeridas", "Captura fecha inicio y fecha fin.", "warning")
  if (params.p_period_start > params.p_period_end) return showToast("Rango invalido", "La fecha inicio no puede ser mayor a la fecha fin.", "warning")

  const paramsKey = layoutPreviewParamsKey(params)
  const requestId = ++layoutPreviewRequestSequence
  activeLayoutPreviewRequestId = requestId
  inFlightLayoutPreviewRequestId = requestId
  layoutEligibilityPreview = null
  layoutEligibilityPreviewParamsKey = null
  dom.layoutEligibilityPreview?.classList.add("hidden")
  if (dom.layoutEligibilityPreview) dom.layoutEligibilityPreview.innerHTML = ""
  dom.submitNewLayoutBtn.disabled = true
  dom.submitNewLayoutBtn.textContent = "Revisa solicitudes primero"
  dom.layoutInvalidBox.classList.add("hidden")
  dom.layoutInvalidBox.innerHTML = ""
  resetLayoutPreviewScrollPositions()
  setButtonLoading(dom.reviewLayoutBtn, true, "Revisando...")
  try {
    const { data, error } = await supabaseClient.rpc("preview_payment_layout_eligibility", params)
    if (error) throw error
    if (requestId !== activeLayoutPreviewRequestId || paramsKey !== layoutPreviewParamsKey()) return
    layoutEligibilityPreview = data || {}
    layoutEligibilityPreviewParamsKey = paramsKey
    renderLayoutEligibilityPreview()
  } catch (error) {
    if (requestId !== activeLayoutPreviewRequestId) return
    layoutEligibilityPreview = null
    layoutEligibilityPreviewParamsKey = null
    renderLayoutNotice(friendlyRpcError(error))
    showToast("No se pudo revisar", friendlyRpcError(error), "danger")
  } finally {
    if (inFlightLayoutPreviewRequestId === requestId) {
      inFlightLayoutPreviewRequestId = null
      setButtonLoading(dom.reviewLayoutBtn, false, "Revisar solicitudes")
    }
  }
}

function previewRows(key) {
  const rows = layoutEligibilityPreview?.[key]
  return Array.isArray(rows) ? rows : []
}

function renderLayoutEligibilityPreview() {
  const regular = previewRows("ready_regular")
  const extraordinary = previewRows("ready_extraordinary")
  const legacy = previewRows("legacy_eligible")
  const rejected = previewRows("rejected_by_direction")
  const pendingClose = previewRows("pending_finance_close")
  const pendingDirector = previewRows("pending_director")
  const directionReapproval = previewRows("direction_reapproval_required")
  const invalid = previewRows("invalid_data")
  const ready = [...regular, ...extraordinary, ...legacy]
  const totals = aggregatePreviewTotals(ready)
  const noReadyMessage = invalid.length
    ? "Completa los datos pendientes"
    : pendingClose.length
      ? "Finanzas debe cerrar el corte"
      : pendingDirector.length
        ? "Pendiente de decisión de Dirección"
        : directionReapproval.length
          ? "Requiere nueva autorización de Dirección"
          : "No hay pagos liberados"

  dom.layoutEligibilityPreview.innerHTML = `
    <div class="layout-preview-summary">
      ${previewMetric("Listas para layout", ready.length)}
      ${previewMetric("Regulares / extraordinarias", `${regular.length + legacy.length} / ${extraordinary.length}`)}
      ${previewMetric("Rechazadas", rejected.length, rejected.length ? "layoutPreviewRejected" : null, "danger")}
      ${previewMetric("Cambio crítico", directionReapproval.length)}
      ${previewMetric("Datos por completar", invalid.length, invalid.length ? "layoutPreviewInvalid" : null, "warning")}
      ${previewMetric("Importe listo", totals.map((row) => formatPreviewMoney(row.amount, row.currency)).join(" | ") || "Sin importe")}
    </div>
    ${renderPreviewSection("Listas para layout", ready.length ? "Solo estas solicitudes se incluirán" : noReadyMessage, ready, "ready")}
    ${renderPreviewSection("Pendientes de cierre", "Direccion aprobo; Finanzas debe liberar el corte", pendingClose, "pending_close")}
    ${renderPreviewSection("Pendientes de Direccion", "No se incluiran en el layout", pendingDirector, "pending_director")}
    ${renderPreviewSection("Nueva autorización de Dirección", "Existe un cambio crítico posterior a la autorización", directionReapproval, "direction_reapproval")}
    ${renderPreviewSection("Rechazadas por Direccion", "Conservan rechazo, motivo e historial", rejected, "rejected", "layoutPreviewRejected")}
    ${renderPreviewSection("Solicitudes por completar", "Corrige aqui los datos faltantes para que vuelvan a evaluarse", invalid, "invalid", "layoutPreviewInvalid")}
  `
  dom.layoutEligibilityPreview.classList.remove("hidden")
  dom.submitNewLayoutBtn.disabled = ready.length === 0
  dom.submitNewLayoutBtn.textContent = ready.length
    ? `Crear layout con ${ready.length} ${ready.length === 1 ? "pago" : "pagos"}`
    : noReadyMessage
  resetLayoutPreviewScrollPositions()
}

function previewMetric(label, value, targetId = null, tone = "") {
  const content = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`
  if (!targetId) return `<div class="layout-preview-metric ${escapeHtml(tone)}">${content}</div>`
  return `<button class="layout-preview-metric layout-preview-metric-action ${escapeHtml(tone)}" type="button" data-preview-action="focus-section" data-target-id="${escapeHtml(targetId)}" aria-label="Ir a ${escapeHtml(label)}">${content}<small>Ver detalle</small></button>`
}

function renderPreviewSection(title, subtitle, rows, kind, sectionId = null) {
  const id = sectionId ? ` id="${escapeHtml(sectionId)}"` : ""
  const emphasized = rows.length && ["rejected", "invalid"].includes(kind) ? " layout-preview-section-attention" : ""
  if (!rows.length) return `<section${id} class="layout-preview-section"><div class="layout-preview-head"><h3>${escapeHtml(title)}</h3><span>0</span></div><div class="layout-preview-empty">${escapeHtml(subtitle)}</div></section>`
  return `<section${id} class="layout-preview-section${emphasized}" tabindex="-1"><div class="layout-preview-head"><h3>${escapeHtml(title)}</h3><span>${rows.length} · ${escapeHtml(subtitle)}</span></div><div class="layout-preview-list">${rows.map((row) => renderPreviewRow(row, kind)).join("")}</div></section>`
}

function renderPreviewRow(row, kind) {
  const batch = row.source_batch_label || "Sin corte"
  let detail = batch
  let detailIsHtml = false
  let actions = `<button class="small-btn" type="button" data-preview-action="open-request" data-request-id="${escapeHtml(row.payment_request_id)}">Abrir solicitud</button>`
  let rowClass = ""
  if (kind === "ready" && row.classification === "ready_extraordinary") {
    rowClass = " layout-extraordinary"
    detailIsHtml = true
    detail = `<strong>Extraordinario · ${escapeHtml(extraordinaryCategoryLabel(row.extraordinary_category))}</strong><small>${escapeHtml(row.extraordinary_reason || "Sin motivo registrado")}</small><small>Autorizo ${escapeHtml(row.extraordinary_authorized_by_name || "Finanzas")} · ${escapeHtml(formatDate(row.extraordinary_authorized_at))}</small>`
  } else if (kind === "pending_close") {
    detail = `${batch} · pendiente de cierre`
    actions += `<button class="small-btn" type="button" data-preview-action="open-batch" data-batch-id="${escapeHtml(row.source_batch_id || "")}">Ir al corte</button>`
  } else if (kind === "pending_director") {
    detail = `${batch} · ${row.source_batch_status || "sin decision"}`
  } else if (kind === "direction_reapproval") {
    detail = "Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte."
  } else if (kind === "rejected") {
    detailIsHtml = true
    detail = `<span class="layout-reject-reason">${escapeHtml(row.reject_reason || "Sin motivo registrado")}</span><small>${escapeHtml(batch)} · ${escapeHtml(formatDate(row.rejected_at))} · ${escapeHtml(row.rejected_by_name || "Direccion")}</small><small>${escapeHtml(row.latest_correction_note ? `Correccion: ${row.latest_correction_note}` : row.rebatch_status === "released" ? "Reingreso habilitado" : "Pendiente de correccion")}</small>${row.target_batch_label ? `<small>Destino: ${escapeHtml(row.target_batch_label)} · ${escapeHtml(row.target_batch_status || "borrador")}</small>` : ""}`
    if (row.rebatch_status === "blocked" && row.source_item_id) {
      actions += `<button class="small-btn warning" type="button" data-preview-action="rebatch" data-item-id="${escapeHtml(row.source_item_id)}">Enviar nuevamente</button>`
    } else if (row.target_batch_id) {
      actions += `<button class="small-btn" type="button" data-preview-action="open-batch" data-batch-id="${escapeHtml(row.target_batch_id)}">Abrir nuevo corte</button>`
    }
  } else if (kind === "invalid") {
    detailIsHtml = true
    detail = `<strong>Falta completar</strong><small>${escapeHtml(formatMissingFields(row.missing_fields))}</small>`
    const missing = Array.isArray(row.missing_fields) ? row.missing_fields : []
    if (missing.some((field) => (
      requestOwnedLayoutFields().includes(field)
      || providerExecutionLayoutFields().includes(field)
    ))) {
      actions += `<button class="small-btn warning" type="button" data-preview-action="complete-layout-data" data-request-id="${escapeHtml(row.payment_request_id)}">Completar datos</button>`
    }
    if (missing.some((field) => providerRecordLayoutFields().includes(field)) && row.proveedor_id) {
      actions += `<button class="small-btn" type="button" data-preview-action="open-provider" data-provider-id="${escapeHtml(row.proveedor_id)}">Completar proveedor</button>`
    }
  } else if (row.classification === "legacy_eligible") {
    detail = "Elegible por compatibilidad historica"
  }
  return `<div class="layout-preview-row${rowClass}"><div><strong>${escapeHtml(row.request_number || "Sin folio")}</strong><small>${escapeHtml(row.company_name || "Sin empresa")}</small></div><div>${escapeHtml(row.provider_name || "Sin proveedor")}</div><div><strong>${escapeHtml(formatPreviewMoney(row.amount, row.currency))}</strong></div><div>${detailIsHtml ? detail : escapeHtml(detail)}</div><div class="layout-preview-actions">${actions}</div></div>`
}

function extraordinaryCategoryLabel(value) {
  return ({
    operational_emergency: "Emergencia operativa / fuga",
    urgent_reimbursement: "Reembolso urgente",
    urgent_termination: "Desvinculacion o finiquito urgente",
    critical_service: "Servicio critico",
    other: "Otro",
  })[value] || value || "Autorizado por Finanzas"
}

function aggregatePreviewTotals(rows) {
  const totals = new Map()
  rows.forEach((row) => {
    const currency = String(row.currency || "MXN").toUpperCase()
    totals.set(currency, (totals.get(currency) || 0) + Number(row.amount || 0))
  })
  return Array.from(totals, ([currency, amount]) => ({ currency, amount }))
}

function formatPreviewMoney(value, currency = "MXN") {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: currency || "MXN", maximumFractionDigits: 2 }).format(Number(value || 0))
  } catch {
    return `${Number(value || 0).toFixed(2)} ${currency || "MXN"}`
  }
}

async function handleLayoutPreviewAction(event) {
  const button = event.target.closest("[data-preview-action]")
  if (!button) return
  if (button.dataset.previewAction === "focus-section") {
    const section = document.getElementById(button.dataset.targetId)
    scrollLayoutModalToSection(section)
    window.setTimeout(() => section?.focus({ preventScroll: true }), 250)
    return
  }
  if (button.dataset.previewAction === "open-request") {
    window.location.href = `./solicitudes.html?request_id=${encodeURIComponent(button.dataset.requestId)}`
    return
  }
  if (button.dataset.previewAction === "open-batch") {
    window.location.href = `./approval_batches.html?batch_id=${encodeURIComponent(button.dataset.batchId)}`
    return
  }
  if (button.dataset.previewAction === "open-provider") {
    window.location.href = `./proveedores.html?provider_id=${encodeURIComponent(button.dataset.providerId)}&return_to=layouts`
    return
  }
  if (button.dataset.previewAction === "complete-layout-data") {
    openLayoutCompletionDialog(button.dataset.requestId)
    return
  }
  if (button.dataset.previewAction === "rebatch") await openLayoutRebatchDialog(button.dataset.itemId)
}

function layoutModalScrollContainer() {
  return dom.newLayoutDialog?.querySelector(".modal-scroll") || null
}

function resetLayoutPreviewScrollPositions() {
  const container = layoutModalScrollContainer()
  if (container) container.scrollTop = 0
  dom.layoutEligibilityPreview?.querySelectorAll(".layout-preview-list").forEach((list) => {
    list.scrollTop = 0
  })
}

function scrollLayoutModalToSection(section) {
  const container = layoutModalScrollContainer()
  if (!section || !container) return
  const containerRect = container.getBoundingClientRect()
  const sectionRect = section.getBoundingClientRect()
  const targetTop = container.scrollTop + sectionRect.top - containerRect.top - 12
  container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" })
}

function requestOwnedLayoutFields() {
  return [
    "scheduled_payment_date",
    "company_bank_account_id",
    "company_bank_account_id_not_found",
    "company_bank_account_company_mismatch",
    "company_bank_account_inactive",
    "source_account_number",
    "source_account_number_invalid",
    "payment_reference",
    "payment_reference_invalid",
    "payment_concept",
    "payment_concept_invalid",
  ]
}

function providerExecutionLayoutFields() {
  return [
    "beneficiary_name",
    "beneficiary_name_invalid",
    "destination_type",
    "destination_type_invalid",
    "clabe",
    "clabe_invalid",
    "cuenta_bancaria",
    "cuenta_bancaria_invalid",
    "convenio_number",
    "convenio_number_invalid",
    "banco",
    "banco_invalid",
  ]
}

function providerRecordLayoutFields() {
  return ["proveedor_id", "proveedor_not_found", "proveedor_inactive"]
}

function findPreviewRequest(requestId) {
  return previewRows("invalid_data").find((row) => row.payment_request_id === requestId) || null
}

function openLayoutCompletionDialog(requestId) {
  const request = findPreviewRequest(requestId)
  if (!request || !dom.layoutCompletionDialog) return
  activeLayoutCompletionRequest = request
  const missing = Array.isArray(request.missing_fields) ? request.missing_fields : []
  const accounts = companyBankAccounts.filter((account) => (
    account.company_id === request.company_id
    && account.active
    && /^[0-9]{1,18}$/.test(cleanText(account.account_number).replace(/[\s-]/g, ""))
  ))
  dom.layoutCompletionTitle.textContent = `Completar ${request.request_number || "solicitud"}`
  dom.layoutCompletionSummary.innerHTML = `<strong>${escapeHtml(request.provider_name || "Sin proveedor")}</strong><span>${escapeHtml(formatPreviewMoney(request.amount, request.currency))}</span><small>Pendiente: ${escapeHtml(formatMissingFields(missing))}</small>`
  dom.layoutCompletionBankAccount.innerHTML = `<option value="">${accounts.length ? "Selecciona cuenta origen" : "No hay cuentas origen activas con numero"}</option>${accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(layoutAccountLabel(account))}</option>`).join("")}`
  dom.layoutCompletionBankAccount.value = accounts.some((account) => account.id === request.company_bank_account_id) ? request.company_bank_account_id : ""
  dom.layoutCompletionReference.value = request.payment_reference || ""
  dom.layoutCompletionConcept.value = request.payment_concept || ""
  dom.layoutCompletionDate.value = request.scheduled_payment_date || ""
  const providerMissing = missing.filter((field) => providerExecutionLayoutFields().includes(field))
  const showProviderFields = providerMissing.length > 0
  dom.layoutCompletionProviderFields.classList.toggle("hidden", !showProviderFields)
  dom.layoutCompletionDestinationType.value = request.destination_type || ""
  dom.layoutCompletionProviderBank.value = ""
  dom.layoutCompletionBeneficiary.value = request.beneficiary_name || ""
  dom.layoutCompletionClabe.value = request.destination_type === "clabe" ? request.destination_value || "" : ""
  dom.layoutCompletionProviderAccount.value = request.destination_type === "cuenta" ? request.destination_value || "" : ""
  dom.layoutCompletionConvenio.value = request.destination_type === "convenio"
    ? String(request.destination_value || "").replace(/^CONVENIO\s+/i, "")
    : ""
  dom.layoutCompletionBankAccount.required = missing.some((field) => [
    "company_bank_account_id",
    "company_bank_account_id_not_found",
    "company_bank_account_company_mismatch",
    "company_bank_account_inactive",
    "source_account_number",
    "source_account_number_invalid",
  ].includes(field))
  dom.layoutCompletionReference.required = missing.some((field) => ["payment_reference", "payment_reference_invalid"].includes(field))
  dom.layoutCompletionConcept.required = missing.some((field) => ["payment_concept", "payment_concept_invalid"].includes(field))
  dom.layoutCompletionDate.required = missing.includes("scheduled_payment_date")
  dom.layoutCompletionDestinationType.required = providerMissing.some((field) => ["destination_type", "destination_type_invalid"].includes(field))
  dom.layoutCompletionProviderBank.required = providerMissing.some((field) => ["banco", "banco_invalid"].includes(field))
  dom.layoutCompletionBeneficiary.required = providerMissing.some((field) => ["beneficiary_name", "beneficiary_name_invalid"].includes(field))
  dom.layoutCompletionClabe.required = providerMissing.some((field) => ["clabe", "clabe_invalid"].includes(field))
  dom.layoutCompletionProviderAccount.required = providerMissing.some((field) => ["cuenta_bancaria", "cuenta_bancaria_invalid"].includes(field))
  dom.layoutCompletionConvenio.required = providerMissing.some((field) => ["convenio_number", "convenio_number_invalid"].includes(field))
  syncProviderExecutionDestinationRequirements()
  dom.layoutCompletionImpact.textContent = request.direction_approval_current
    ? "Estos son datos operativos de ejecución. Al guardarlos se conserva la autorización vigente de Dirección."
    : "Al guardar, los datos operativos se reevaluarán sin alterar el contenido económico aprobado."
  dom.layoutCompletionDialog.showModal()
}

function closeLayoutCompletionDialog() {
  activeLayoutCompletionRequest = null
  dom.layoutCompletionForm?.reset()
  if (dom.layoutCompletionDialog?.open) dom.layoutCompletionDialog.close()
}

function syncProviderExecutionDestinationRequirements() {
  const enabled = !dom.layoutCompletionProviderFields?.classList.contains("hidden")
  const destinationType = cleanText(dom.layoutCompletionDestinationType?.value)
  if (dom.layoutCompletionClabe) {
    dom.layoutCompletionClabe.required = enabled && destinationType === "clabe"
  }
  if (dom.layoutCompletionProviderAccount) {
    dom.layoutCompletionProviderAccount.required = enabled && destinationType === "cuenta"
  }
  if (dom.layoutCompletionConvenio) {
    dom.layoutCompletionConvenio.required = enabled && destinationType === "convenio"
  }
}

async function submitLayoutCompletion(event) {
  event.preventDefault()
  if (!activeLayoutCompletionRequest) return
  const reference = cleanText(dom.layoutCompletionReference.value)
  if (reference && !/^\d{1,5}$/.test(reference)) {
    showToast("Referencia invalida", "Captura de 1 a 5 digitos.", "warning")
    return
  }
  if (!dom.layoutCompletionProviderFields.classList.contains("hidden")) {
    const destinationType = cleanText(dom.layoutCompletionDestinationType.value)
    const clabe = cleanText(dom.layoutCompletionClabe.value).replace(/[\s-]/g, "")
    const account = cleanText(dom.layoutCompletionProviderAccount.value).replace(/[\s-]/g, "")
    const agreement = cleanText(dom.layoutCompletionConvenio.value)
    if (!["clabe", "cuenta", "convenio"].includes(destinationType)) {
      showToast("Tipo de destino requerido", "Selecciona CLABE, cuenta bancaria o convenio.", "warning")
      return
    }
    if (destinationType === "clabe" && !/^[0-9]{18}$/.test(clabe)) {
      showToast("CLABE inválida", "Captura exactamente 18 dígitos.", "warning")
      return
    }
    if (destinationType === "cuenta" && !/^[0-9]{1,18}$/.test(account)) {
      showToast("Cuenta inválida", "Captura de 1 a 18 dígitos.", "warning")
      return
    }
    if (destinationType === "convenio" && (!agreement || agreement.length > 30)) {
      showToast("Convenio inválido", "Captura un convenio de hasta 30 caracteres.", "warning")
      return
    }
  }
  setButtonLoading(dom.submitLayoutCompletionBtn, true, "Guardando...")
  try {
    if (!dom.layoutCompletionProviderFields.classList.contains("hidden")) {
      const { error: providerError } = await supabaseClient.rpc("complete_provider_payment_execution_data", {
        p_proveedor_id: activeLayoutCompletionRequest.proveedor_id,
        p_destination_type: cleanText(dom.layoutCompletionDestinationType.value) || null,
        p_clabe: cleanText(dom.layoutCompletionClabe.value) || null,
        p_cuenta_bancaria: cleanText(dom.layoutCompletionProviderAccount.value) || null,
        p_convenio_number: cleanText(dom.layoutCompletionConvenio.value) || null,
        p_beneficiary_name: cleanText(dom.layoutCompletionBeneficiary.value) || null,
        p_banco: cleanText(dom.layoutCompletionProviderBank.value) || null,
      })
      if (providerError) throw providerError
    }
    const { data, error } = await supabaseClient.rpc("complete_payment_request_layout_data", {
      p_payment_request_id: activeLayoutCompletionRequest.payment_request_id,
      p_company_bank_account_id: dom.layoutCompletionBankAccount.value || null,
      p_payment_reference: reference || null,
      p_payment_concept: cleanText(dom.layoutCompletionConcept.value) || null,
      p_scheduled_payment_date: dom.layoutCompletionDate.value || null,
    })
    if (error) throw error
    const requiresDirection = Boolean(data?.direction_reapproval_required)
    const approvalPreserved = data?.approval_preserved === true
    const remainingMissing = Array.isArray(data?.missing_fields) ? data.missing_fields : []
    closeLayoutCompletionDialog()
    await reviewLayoutEligibility()
    showToast(
      approvalPreserved && !requiresDirection && !remainingMissing.length
        ? "Datos de ejecución completados"
        : "Datos guardados",
      requiresDirection
        ? "La solicitud ya presenta un cambio crítico y requiere nueva autorización de Dirección."
        : approvalPreserved && !remainingMissing.length
          ? "Datos de ejecución completados. La autorización de Dirección se conserva."
          : approvalPreserved
            ? `La autorización de Dirección se conserva. Aún faltan: ${formatMissingFields(remainingMissing)}.`
          : "Los datos operativos se guardaron y la solicitud fue reevaluada.",
      requiresDirection ? "warning" : "success"
    )
  } catch (error) {
    showToast("No se pudieron guardar los datos", friendlyRpcError(error), "danger")
  } finally {
    setButtonLoading(dom.submitLayoutCompletionBtn, false, "Guardar y reevaluar")
  }
}

function layoutAccountLabel(account) {
  const suffix = account.account_number ? `cta ${account.account_number}` : account.last4 ? `termina ${account.last4}` : "sin numero"
  return [account.name || "Cuenta origen", account.bank_name, suffix].filter(Boolean).join(" - ")
}

async function openLayoutRebatchDialog(itemId) {
  const item = previewRows("rejected_by_direction").find((row) => row.source_item_id === itemId)
  if (!item) return
  activeLayoutRebatchItem = item
  dom.layoutRebatchNote.value = ""
  dom.layoutRebatchOriginal.innerHTML = `<strong>${escapeHtml(item.request_number || "Solicitud")}</strong><br>Motivo original: ${escapeHtml(item.reject_reason || "Sin motivo registrado")}`
  const { data, error } = await supabaseClient.rpc("list_finance_approval_batches", { p_status: "draft" })
  if (error) return showToast("No se cargaron cortes", friendlyRpcError(error), "danger")
  const drafts = (Array.isArray(data) ? data : []).filter((batch) => batch.company_id === item.company_id)
  dom.layoutRebatchTarget.innerHTML = `<option value="">Dejar disponible para siguiente corte</option>${drafts.map((batch) => `<option value="${escapeHtml(batch.id)}">${escapeHtml(batch.label)}</option>`).join("")}`
  dom.layoutRebatchDialog.showModal()
}

function closeLayoutRebatchDialog() {
  activeLayoutRebatchItem = null
  if (dom.layoutRebatchDialog?.open) dom.layoutRebatchDialog.close()
}

async function submitLayoutRebatch(event) {
  event.preventDefault()
  const note = cleanText(dom.layoutRebatchNote.value)
  if (!activeLayoutRebatchItem || !note || note.length < 10) return showToast("Correccion requerida", "Explica en al menos 10 caracteres que se corrigio.", "warning")
  setButtonLoading(dom.submitLayoutRebatchBtn, true, "Registrando...")
  try {
    const { data, error } = await supabaseClient.rpc("release_and_rebatch_rejected_request", {
      p_rejected_item_id: activeLayoutRebatchItem.source_item_id,
      p_correction_note: note,
      p_target_batch_id: dom.layoutRebatchTarget.value || null,
    })
    if (error) throw error
    closeLayoutRebatchDialog()
    showToast(
      "Reingreso registrado",
      data?.new_item_id
        ? "La solicitud requiere nueva aprobacion y cierre antes de entrar a un layout."
        : "La solicitud quedo disponible para el siguiente corte.",
      "success"
    )
    await reviewLayoutEligibility()
  } catch (error) {
    showToast("No se pudo reenviar", friendlyRpcError(error), "danger")
  } finally {
    setButtonLoading(dom.submitLayoutRebatchBtn, false, "Enviar nuevamente")
  }
}

async function submitNewLayout(event) {
  event.preventDefault()
  if (!ensureActorProfile()) return
  if (!layoutEligibilityPreview) {
    showToast("Revision requerida", "Revisa las solicitudes antes de crear el layout.", "warning")
    return
  }
  if (layoutEligibilityPreviewParamsKey !== layoutPreviewParamsKey()) {
    invalidateLayoutPreview({ filtersChanged: true })
    showToast("Revisión desactualizada", "Los filtros cambiaron. Revisa nuevamente las solicitudes.", "warning")
    return
  }

  const periodStart = dom.layoutPeriodStart.value
  const periodEnd = dom.layoutPeriodEnd.value
  const layoutName = cleanText(dom.layoutName.value)
  const companyId = dom.layoutCompanyId.value || null
  const bankAccountId = dom.layoutBankAccountId.value || null

  dom.layoutInvalidBox.classList.add("hidden")
  dom.layoutInvalidBox.innerHTML = ""

  if (!periodStart || !periodEnd) { showToast("Fechas requeridas", "Captura fecha inicio y fecha fin.", "warning"); return }
  if (periodStart > periodEnd) { showToast("Rango invalido", "La fecha inicio no puede ser mayor a la fecha fin.", "warning"); return }

  setButtonLoading(dom.submitNewLayoutBtn, true, "Creando layout...")
  try {
    const { data, error } = await supabaseClient.rpc("create_payment_layout", {
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_generated_by: currentProfileId,
      p_name: layoutName || null,
      p_company_id: companyId,
      p_company_bank_account_id: bankAccountId,
    })

    if (error) throw error

    await loadLayouts()

    if (data?.message === "no_valid_payment_requests") {
      renderLayoutNotice("No hay solicitudes validas para generar layout en este periodo.", data?.invalid_requests || [])
      showToast("Sin solicitudes validas", "No hay solicitudes validas para este periodo.", "warning")
      invalidateLayoutPreview()
      return
    }

    const invalidCount = numberValue(data?.invalid_count)
    const summary = [
      `${numberValue(data?.ready_regular_count) + numberValue(data?.legacy_count)} regulares liberados`,
      `${numberValue(data?.extraordinary_count)} extraordinarios`,
      `${numberValue(data?.rejected_count)} rechazados no incluidos`,
      `${numberValue(data?.pending_close_count)} pendientes de cierre`,
      `${numberValue(data?.direction_reapproval_count)} requieren nueva autorizacion de Direccion`,
      `${invalidCount} con datos incompletos`,
    ].join(" · ")
    renderLayoutNotice(`Layout ${data?.layout_number || "creado"} con ${numberValue(data?.payment_count)} pagos. ${summary}`, data?.invalid_requests || [])
    showToast(
      "Layout creado",
      summary,
      numberValue(data?.rejected_count) || numberValue(data?.pending_close_count) || numberValue(data?.direction_reapproval_count) || invalidCount ? "warning" : "success"
    )
    layoutEligibilityPreview = null
    layoutEligibilityPreviewParamsKey = null
    dom.layoutEligibilityPreview.classList.add("hidden")
    dom.submitNewLayoutBtn.disabled = true
    dom.submitNewLayoutBtn.textContent = "Revisa solicitudes primero"
  } catch (error) {
    renderLayoutNotice(friendlyRpcError(error))
    showToast("No se pudo crear layout", friendlyRpcError(error), "danger")
  } finally {
    setButtonLoading(dom.submitNewLayoutBtn, false, "Crear layout")
    if (!layoutEligibilityPreview) {
      dom.submitNewLayoutBtn.disabled = true
      dom.submitNewLayoutBtn.textContent = "Revisa solicitudes primero"
    }
  }
}

function renderLayoutNotice(message, invalidRequests = []) {
  const list = invalidRequests.length
    ? `<ul style="margin:6px 0 0 16px">${invalidRequests.slice(0, 8).map((item) => {
        const fields = formatMissingFields(item.missing_fields)
        return `<li><strong>${escapeHtml(item.request_number || item.payment_request_id || "Solicitud")}</strong>: ${escapeHtml(fields)}</li>`
      }).join("")}</ul>` : ""
  const more = invalidRequests.length > 8 ? `<p style="margin-top:4px;color:var(--text-3)">Y ${invalidRequests.length - 8} mas.</p>` : ""
  dom.layoutInvalidBox.innerHTML = `<strong>${escapeHtml(message)}</strong>${list}${more}`
  dom.layoutInvalidBox.classList.remove("hidden")
}

function renderInvalidRequests(invalidRequests) {
  if (!invalidRequests.length) return
  renderLayoutNotice("Solicitudes fuera del layout por datos incompletos", invalidRequests)
}

function formatMissingFields(fields) {
  const values = Array.isArray(fields) ? fields : fields ? [fields] : ["datos incompletos"]
  const labels = {
    payment_reference: "referencia de pago requerida",
    payment_concept: "concepto de pago requerido",
    company_bank_account_id: "cuenta origen requerida",
    company_bank_account_id_not_found: "cuenta origen no encontrada",
    company_bank_account_company_mismatch: "la cuenta origen no pertenece a la empresa",
    company_bank_account_inactive: "cuenta origen inactiva",
    source_account_number: "numero de cuenta origen requerido",
    source_account_number_invalid: "numero de cuenta origen invalido",
    scheduled_payment_date: "fecha programada requerida",
    company_id: "empresa requerida",
    company_not_found: "empresa no encontrada",
    company_inactive: "empresa inactiva",
    company_name: "nombre de empresa requerido",
    proveedor_id: "proveedor requerido",
    proveedor_not_found: "proveedor no encontrado",
    proveedor_inactive: "proveedor inactivo",
    beneficiary_name: "beneficiario requerido",
    beneficiary_name_invalid: "beneficiario invalido",
    destination_type: "tipo de cuenta destino requerido",
    destination_type_invalid: "tipo de cuenta destino invalido",
    clabe: "CLABE del proveedor requerida",
    clabe_invalid: "CLABE del proveedor invalida",
    cuenta_bancaria: "cuenta del proveedor requerida",
    cuenta_bancaria_invalid: "cuenta del proveedor invalida",
    convenio_number: "numero de convenio requerido",
    convenio_number_invalid: "numero de convenio invalido",
    banco: "banco del proveedor requerido",
    banco_invalid: "banco del proveedor invalido",
    payment_reference_invalid: "referencia de pago invalida",
    payment_concept_invalid: "concepto de pago invalido",
    unsupported_layout_currency: "moneda no compatible con layout",
    invalid_amount: "importe invalido",
    budget_revalidation_required: "presupuesto por revalidar",
    finance_reapproval_required: "revalidacion de presupuesto requerida",
    direction_reapproval_required: "nueva autorizacion de Direccion requerida",
    extraordinary_reauthorization_required: "revocar y autorizar nuevamente el extraordinario",
  }
  return values.map((field) => labels[field] || field || "datos incompletos").join(", ")
}

// Lineas

async function openLayoutLines(layoutId) {
  const layout = layouts.find((item) => item.id === layoutId)
  if (!layout) return

  activeLinesLayoutId = layoutId
  dom.linesTitle.textContent = layout.layout_number || "Lineas del layout"
  dom.linesSubtitle.textContent = `${layout.name || ""} - archivo CxC BBVA`.trim()
  dom.linesTableBody.innerHTML = `<tr><td colspan="10" style="padding:44px;text-align:center;color:var(--text-3)">Cargando lineas...</td></tr>`
  dom.linesDialog.showModal()

  await refreshLayoutLines(layoutId)
}

async function refreshLayoutLines(layoutId) {
  const { data, error } = await fetchLayoutLines(layoutId)
  if (error) {
    dom.linesTableBody.innerHTML = `<tr><td colspan="10" style="padding:44px;text-align:center;color:var(--ruby)">${escapeHtml(rlsHint("payment_layout_lines", "select", error))}</td></tr>`
    return
  }
  updateLayoutPagosintIssueCount(layoutId, data || [])
  renderLayoutsTable()
  renderLinesTable(data || [])
}

function updateLayoutPagosintIssueCount(layoutId, lines) {
  const count = (lines || []).filter((line) => lineNeedsPagosintReferenceCompletion(line)).length
  if (count) layoutPagosintIssueCounts.set(layoutId, count)
  else layoutPagosintIssueCounts.delete(layoutId)
  layoutFormatSummaries.set(layoutId, summarizeLayoutFormats((lines || []).filter((line) => line.status !== "bank_rejected")))
}

function closeLinesModal() {
  activeLinesLayoutId = null
  activeLayoutLines = []
  if (dom.linesFormatSummary) dom.linesFormatSummary.innerHTML = ""
  if (dom.linesDialog.open) dom.linesDialog.close()
}

function renderLinesTable(lines) {
  activeLayoutLines = lines || []
  renderLinesFormatSummary(activeLayoutLines)
  if (!lines.length) {
    dom.linesTableBody.innerHTML = `<tr><td colspan="10" style="padding:44px;text-align:center;color:var(--text-3)">Este layout no tiene lineas.</td></tr>`
    return
  }

  dom.linesTableBody.innerHTML = lines.map((line) => `
    <tr>
      <td>${escapeHtml(line.source_account_number || "")}</td>
      <td>${escapeHtml(line.company_name || "")}</td>
      <td>${escapeHtml(line.destination_value || "")}</td>
      <td><span class="cell-main">${escapeHtml(line.beneficiary_name || "")}</span></td>
      <td>${escapeHtml(formatCurrency(line.amount))}</td>
      <td>${renderLineReferenceCell(line)}</td>
      <td>${escapeHtml(line.payment_concept || "")}</td>
      <td>${escapeHtml(line.request_number || "")}</td>
      <td>${lineStatusBadge(line.status)}</td>
      <td>${renderLineActions(line)}</td>
    </tr>`).join("")
}

function renderLinesFormatSummary(lines) {
  if (!dom.linesFormatSummary) return

  const activeLines = (lines || []).filter((line) => line.status !== "bank_rejected")
  if (!activeLines.length) {
    dom.linesFormatSummary.innerHTML = `<span style="color:var(--text-3);font-size:12px">Sin lineas activas para generar archivos BBVA.</span>`
    return
  }

  const summary = summarizeLayoutFormats(activeLines)
  const rows = [
    renderFormatSummaryRow(summary[BBVA_FORMAT_SAME_BANK], BBVA_FORMAT_SAME_BANK),
    renderFormatSummaryRow(summary[BBVA_FORMAT_INTERBANK], BBVA_FORMAT_INTERBANK),
    renderFormatSummaryRow(summary.convenio, "convenio"),
    renderFormatSummaryRow(summary.unsupported, "unsupported"),
  ].filter(Boolean).join("")

  dom.linesFormatSummary.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px">
      <strong style="color:var(--text-1);font-size:13px">Archivos del layout</strong>
      <span style="color:var(--text-3);font-size:11px">Los formatos BBVA se descargan separados.</span>
    </div>
    <div class="table-wrapper" style="border-radius:8px;max-height:none;overflow:auto">
      <table style="min-width:720px">
        <thead>
          <tr>
            <th>Formato</th>
            <th>Pagos</th>
            <th>Monto total</th>
            <th>Estado</th>
            <th>Accion</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

function renderFormatSummaryRow(item, key) {
  if (!item || item.count <= 0) return ""

  const amount = escapeHtml(formatCurrency(item.amount))
  const count = numberValue(item.count)
  let status = `<span class="badge success">Listo</span>`
  let action = `<span style="color:var(--text-3);font-size:11px">-</span>`

  if (key === BBVA_FORMAT_SAME_BANK) {
    action = `<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${activeLinesLayoutId}','${BBVA_FORMAT_SAME_BANK}')">▾ Pagos BBVA</button>`
  } else if (key === BBVA_FORMAT_INTERBANK) {
    if (item.referenceIssues > 0) {
      status = `<span class="badge warning">${item.referenceIssues} referencia(s) pendiente(s)</span>`
      action = `<button class="small-btn warning" type="button" onclick="focusFirstPagosintReferenceLine()">Completar referencias</button>`
    } else {
      action = `<button class="small-btn" type="button" onclick="downloadLayoutBbvaFormat('${activeLinesLayoutId}','${BBVA_FORMAT_INTERBANK}')">▾ Pagos Inter</button>`
    }
  } else if (key === "convenio") {
    status = `<span class="badge warning">Pendiente CIE</span>`
    action = `<span style="color:var(--text-2);font-size:12px">Formato CIE/convenio pendiente de configurar</span>`
  } else {
    status = `<span class="badge danger">No soportado</span>`
    action = `<span style="color:var(--text-2);font-size:12px">Revisar tipo de destino</span>`
  }

  return `
    <tr>
      <td><span class="cell-main">${escapeHtml(item.label)}</span></td>
      <td>${count}</td>
      <td><strong>${amount}</strong></td>
      <td>${status}</td>
      <td>${action}</td>
    </tr>`
}

function renderLineActions(line) {
  if (line.status !== "included") return `<span style="color:var(--text-3);font-size:11px">-</span>`
  const actions = []
  if (lineNeedsPagosintReferenceCompletion(line)) {
    actions.push(`<button class="small-btn warning" type="button" onclick="openPagosintReferenceModal('${line.id}')" style="white-space:nowrap">Completar referencia</button>`)
  }
  actions.push(`<button class="small-btn danger" type="button" onclick="openRejectLineModal('${line.id}')" style="white-space:nowrap">Rechazar</button>`)
  return actions.join("")
}

function renderLineReferenceCell(line) {
  const value = escapeHtml(line.payment_reference || "")
  if (!lineNeedsPagosintCompletion(line)) return value || `<span style="color:var(--text-3);font-size:11px">-</span>`
  const badgeLabel = lineNeedsPagosintReferenceCompletion(line) ? "Referencia pendiente" : "Datos PAGOSINT incompletos"
  return [
    value ? `<span class="cell-main">${value}</span>` : `<span style="color:var(--text-3);font-size:11px">Sin referencia</span>`,
    `<span class="badge warning" style="margin-top:4px">${badgeLabel}</span>`,
  ].join("")
}

function lineNeedsPagosintCompletion(line) {
  if (line.status !== "included" || !isPagosintLine(line)) return false
  return pagosintLineIssues(line).length > 0
}

function lineNeedsPagosintReferenceCompletion(line) {
  if (line.status !== "included" || !isPagosintLine(line)) return false
  const referenceDigits = cxcDigits(line.payment_reference)
  return !referenceDigits || referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH
}

function isPagosintLine(line) {
  try {
    return detectBbvaLayoutFormat(line) === BBVA_FORMAT_INTERBANK
  } catch {
    return false
  }
}

function pagosintLineIssues(line) {
  const issues = []
  const referenceDigits = cxcDigits(line.payment_reference)
  if (!referenceDigits) issues.push("referencia numerica")
  else if (referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH) issues.push("referencia numerica mayor a 5 digitos")
  if (!notBlank(line.beneficiary_name) || !normalizeCxcText(line.beneficiary_name)) issues.push("titular")
  if (!notBlank(line.payment_concept) || !normalizeCxcText(line.payment_concept)) issues.push("motivo")
  return issues
}

// Archivo BBVA

async function downloadLayoutCxc(layoutId) {
  const layout = layouts.find((item) => item.id === layoutId)
  if (!layout) return

  if (layout.status === "cancelled") {
    showToast("Layout cancelado", "No se puede generar archivo CxC BBVA de un layout cancelado.", "danger")
    return
  }

  const { data: lines, error } = await fetchLayoutLines(layoutId)
  if (error) { showToast("No se pudo leer el layout", rlsHint("payment_layout_lines", "select", error), "danger"); return }

  if (!lines?.length) { showToast("Sin lineas", "Este layout no tiene lineas para generar archivo BBVA.", "warning"); return }

  const cxcLines = lines.filter((line) => line.status !== "bank_rejected")
  if (!cxcLines.length) { showToast("Sin lineas activas", "Este layout no tiene lineas activas para generar archivo BBVA.", "warning"); return }

  const invalidLines = validateLayoutLines(cxcLines)
  if (invalidLines.length) {
    const pagosintReferenceLine = invalidLines.find(invalidLineNeedsPagosintReference)
    const first = pagosintReferenceLine || invalidLines[0]
    showToast("Lineas invalidas", formatInvalidLayoutLineMessage(first), "danger")
    if (pagosintReferenceLine) await openLayoutLines(layoutId)
    return
  }

  try {
    const files = buildBbvaLayoutFiles(cxcLines, layout)
    const invalidFile = files.find((file) => !file.validation.ok)

    if (invalidFile) {
      showToast("Layout invalido", invalidFile.validation.errors[0], "danger")
      return
    }

    files.forEach((file) => downloadTextFile(file.content, file.fileName))

    const fileName = files.map((file) => file.fileName).join(" + ")
    const update = await supabaseClient.from("payment_layouts").update({ file_name: fileName, status: "generated", updated_at: new Date().toISOString() }).eq("id", layoutId)

    if (update.error) {
      showToast("Layout BBVA descargado", "El archivo fue generado, pero no se pudo actualizar el estado del layout.", "warning")
      return
    }

    const summary = files.map((file) => `${file.label}: ${file.validation.lineCount} linea(s) de ${file.lineLength}`).join("; ")
    showToast("Layout BBVA generado", `${fileName} se descargo correctamente. ${summary}.`, "success")
    await loadLayouts()
  } catch (error) {
    showToast("No se pudo generar CxC BBVA", friendlyError(error), "danger")
  }
}

// Confirmar pago

async function markLayoutUploaded(layoutId) {
  if (!ensureActorProfile()) return
  const layout = layouts.find((item) => item.id === layoutId)
  const confirmed = await showLayoutActionConfirmation({
    title: "Marcar layout como subido",
    message: `Se registrara ${layout?.layout_number || "este layout"} como enviado al banco. Esta accion no confirma el pago.`,
    confirmLabel: "Marcar como subido",
  })
  if (!confirmed) return

  try {
    const { data, error } = await supabaseClient.rpc("mark_payment_layout_uploaded", {
      p_layout_id: layoutId,
      p_actor_profile_id: currentProfileId,
      p_comments: null,
    })
    if (error) throw error
    showToast("Layout actualizado", data?.message || "El layout fue marcado como subido.", "success")
    await loadLayouts()
  } catch (error) {
    showToast("No se pudo marcar como subido", friendlyRpcError(error), "danger")
  }
}

function showLayoutActionConfirmation({ title, message, confirmLabel }) {
  if (!dom.layoutActionConfirmDialog) return Promise.resolve(false)
  if (layoutActionConfirmResolve) closeLayoutActionConfirmation(false)
  dom.layoutActionConfirmTitle.textContent = title
  dom.layoutActionConfirmBody.textContent = message
  dom.layoutActionConfirmAcceptBtn.textContent = confirmLabel
  dom.layoutActionConfirmDialog.showModal()
  return new Promise((resolve) => { layoutActionConfirmResolve = resolve })
}

function closeLayoutActionConfirmation(confirmed) {
  const resolve = layoutActionConfirmResolve
  layoutActionConfirmResolve = null
  if (dom.layoutActionConfirmDialog?.open) dom.layoutActionConfirmDialog.close()
  if (resolve) resolve(Boolean(confirmed))
}

function openConfirmPaymentModal(layoutId) {
  if (!ensureActorProfile()) return
  const layout = layouts.find((item) => item.id === layoutId)
  activeConfirmLayoutId = layoutId
  dom.confirmTitle.textContent = `Confirmar pago ${layout?.layout_number || ""}`.trim()
  dom.paymentDate.value = new Date().toISOString().slice(0, 10)
  dom.bankReference.value = ""
  dom.receiptStoragePath.value = ""
  dom.confirmDialog.showModal()
}

function closeConfirmModal() {
  activeConfirmLayoutId = null
  dom.confirmPaymentForm.reset()
  if (dom.confirmDialog.open) dom.confirmDialog.close()
}

async function submitConfirmPayment(event) {
  event.preventDefault()
  if (!activeConfirmLayoutId || !ensureActorProfile()) return

  if (!dom.paymentDate.value) { showToast("Fecha requerida", "Captura la fecha de pago.", "warning"); return }

  setButtonLoading(dom.submitConfirmBtn, true, "Confirmando...")

  try {
    const { data, error } = await supabaseClient.rpc("confirm_payment_layout", {
      p_layout_id: activeConfirmLayoutId,
      p_payment_date: dom.paymentDate.value,
      p_bank_reference: cleanText(dom.bankReference.value) || null,
      p_storage_path: cleanText(dom.receiptStoragePath.value) || null,
      p_registered_by: currentProfileId,
    })
    if (error) throw error
    showToast("Pago confirmado", `${data?.paid_count || 0} pagos confirmados por ${formatCurrency(data?.total_paid || 0)}.`, "success")
    closeConfirmModal()
    await loadLayouts()
    if (activeLinesLayoutId) await refreshLayoutLines(activeLinesLayoutId)
  } catch (error) {
    showToast("No se pudo confirmar pago", friendlyRpcError(error), "danger")
  } finally {
    setButtonLoading(dom.submitConfirmBtn, false, "Confirmar pago")
  }
}

// Completar datos PAGOSINT

function openPagosintReferenceModal(lineId) {
  if (!ensureActorProfile()) return
  const line = activeLayoutLines.find((item) => item.id === lineId)
  if (!line) {
    showToast("Linea no encontrada", "Vuelve a abrir las lineas del layout e intenta de nuevo.", "warning")
    return
  }
  if (!isPagosintLine(line)) {
    showToast("No aplica", "La referencia PAGOSINT solo aplica a lineas interbancarias.", "warning")
    return
  }

  activePagosintReferenceLineId = lineId
  dom.pagosintReferenceTitle.textContent = `Completar referencia ${line.request_number || ""}`.trim()
  dom.pagosintReferenceInput.value = cxcDigits(line.payment_reference)
  dom.pagosintBeneficiaryInput.value = line.beneficiary_name || ""
  dom.pagosintConceptInput.value = line.payment_concept || ""
  dom.pagosintReferenceDialog.showModal()
}

function closePagosintReferenceModal() {
  activePagosintReferenceLineId = null
  dom.pagosintReferenceForm.reset()
  if (dom.pagosintReferenceDialog.open) dom.pagosintReferenceDialog.close()
}

async function submitPagosintReference(event) {
  event.preventDefault()
  if (!activePagosintReferenceLineId || !ensureActorProfile()) return

  const lineId = activePagosintReferenceLineId
  const referenceDigits = cxcDigits(dom.pagosintReferenceInput.value)
  const beneficiary = cleanText(dom.pagosintBeneficiaryInput.value)
  const concept = cleanText(dom.pagosintConceptInput.value)

  if (!referenceDigits) {
    showToast("Referencia requerida", "Captura una referencia numerica de 1 a 5 digitos para PAGOSINT.", "warning")
    return
  }
  if (referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH) {
    showToast("Referencia invalida", "La referencia PAGOSINT acepta maximo 5 digitos.", "warning")
    return
  }
  if (!beneficiary || !normalizeCxcText(beneficiary)) {
    showToast("Titular requerido", "Captura titular o beneficiario para PAGOSINT.", "warning")
    return
  }
  if (!concept || !normalizeCxcText(concept)) {
    showToast("Motivo requerido", "Captura motivo de pago para PAGOSINT.", "warning")
    return
  }

  setButtonLoading(dom.submitPagosintReferenceBtn, true, "Guardando...")

  try {
    const { data, error } = await supabaseClient.rpc("update_payment_layout_line_pagosint_reference", {
      p_line_id: lineId,
      p_payment_reference: referenceDigits,
      p_beneficiary_name: beneficiary,
      p_payment_concept: concept,
    })

    if (error) throw error

    const layoutId = activeLinesLayoutId
    const persistedLine = Array.isArray(data) ? data[0] : data
    const persistedReference = cxcDigits(persistedLine?.payment_reference)
    if (persistedReference !== referenceDigits) {
      throw new Error("La referencia no quedo persistida en payment_layout_lines.payment_reference.")
    }

    closePagosintReferenceModal()
    await loadLayouts()
    if (layoutId) {
      const refreshed = await fetchLayoutLines(layoutId)
      if (refreshed.error) throw refreshed.error
      updateLayoutPagosintIssueCount(layoutId, refreshed.data || [])
      renderLayoutsTable()
      renderLinesTable(refreshed.data || [])

      const refreshedLine = (refreshed.data || []).find((line) => line.id === lineId)
      const refreshedReference = cxcDigits(refreshedLine?.payment_reference)
      if (refreshedReference !== referenceDigits) {
        throw new Error("La referencia no reaparecio despues de refrescar la linea del layout.")
      }
    }
    showToast("Referencia guardada", `PAGOSINT usara ${formatBbvaReference(referenceDigits)} en las posiciones 86-90.`, "success")
  } catch (error) {
    showToast("No se pudo guardar", pagosintSaveHint(error), "danger")
  } finally {
    setButtonLoading(dom.submitPagosintReferenceBtn, false, "Guardar referencia")
  }
}

// Rechazar linea

function openRejectLineModal(lineId) {
  if (!ensureActorProfile()) return
  activeRejectLineId = lineId
  dom.rejectionReason.value = ""
  dom.rejectLineTitle.textContent = "Rechazar linea bancaria"
  dom.rejectLineDialog.showModal()
}

function closeRejectLineModal() {
  activeRejectLineId = null
  dom.rejectLineForm.reset()
  if (dom.rejectLineDialog.open) dom.rejectLineDialog.close()
}

async function submitRejectLine(event) {
  event.preventDefault()
  if (!activeRejectLineId || !ensureActorProfile()) return

  const reason = cleanText(dom.rejectionReason.value)
  if (!reason) { showToast("Motivo requerido", "Captura el motivo del rechazo bancario.", "warning"); return }

  setButtonLoading(dom.submitRejectLineBtn, true, "Rechazando...")

  try {
    const { data, error } = await supabaseClient.rpc("reject_payment_layout_line", {
      p_line_id: activeRejectLineId,
      p_reason: reason,
      p_actor_profile_id: currentProfileId,
    })
    if (error) throw error
    showToast("Linea rechazada", data?.message || "La linea fue rechazada y la solicitud regreso a aprobada.", "success")
    closeRejectLineModal()
    await loadLayouts()
    if (activeLinesLayoutId) await refreshLayoutLines(activeLinesLayoutId)
  } catch (error) {
    showToast("No se pudo rechazar linea", friendlyRpcError(error), "danger")
  } finally {
    setButtonLoading(dom.submitRejectLineBtn, false, "Rechazar linea")
  }
}

// Expuestos en window

window.openLayoutLines = openLayoutLines
window.downloadLayoutCxc = downloadLayoutCxc
window.downloadLayoutBbvaFormat = downloadLayoutBbvaFormat
window.validateLayoutCxc = validateLayoutCxc
window.generateLayoutExcel = downloadLayoutCxc
window.markLayoutUploaded = markLayoutUploaded
window.openConfirmPaymentModal = openConfirmPaymentModal
window.openPagosintReferenceModal = openPagosintReferenceModal
window.focusFirstPagosintReferenceLine = focusFirstPagosintReferenceLine
window.openRejectLineModal = openRejectLineModal

// Supabase helpers

async function fetchLayoutLines(layoutId) {
  return supabaseClient
    .from("payment_layout_lines")
    .select("id,layout_id,payment_request_id,company_id,proveedor_id,company_bank_account_id,source_account_number,company_name,destination_type,destination_value,beneficiary_name,amount,payment_reference,payment_concept,request_number,status,bank_rejection_reason,created_at,updated_at")
    .eq("layout_id", layoutId)
    .order("source_account_number", { ascending: true })
    .order("company_name", { ascending: true })
    .order("beneficiary_name", { ascending: true })
    .order("request_number", { ascending: true })
}

function summarizeLayoutFormats(lines) {
  const summary = {
    [BBVA_FORMAT_SAME_BANK]: { key: BBVA_FORMAT_SAME_BANK, label: "PAGOSBBV", count: 0, amount: 0, referenceIssues: 0 },
    [BBVA_FORMAT_INTERBANK]: { key: BBVA_FORMAT_INTERBANK, label: "PAGOSINT", count: 0, amount: 0, referenceIssues: 0 },
    convenio: { key: "convenio", label: "Convenio/CIE", count: 0, amount: 0, referenceIssues: 0 },
    unsupported: { key: "unsupported", label: "No soportado", count: 0, amount: 0, referenceIssues: 0 },
  }

  for (const line of lines || []) {
    if (line.status === "bank_rejected") continue
    const amount = numberValue(line.amount)

    try {
      const format = detectBbvaLayoutFormat(line)
      summary[format].count += 1
      summary[format].amount += amount
      if (format === BBVA_FORMAT_INTERBANK && lineNeedsPagosintReferenceCompletion(line)) summary[format].referenceIssues += 1
    } catch (error) {
      const type = normalizeDestinationType(line.destination_type)
      const key = type === "convenio" ? "convenio" : "unsupported"
      summary[key].count += 1
      summary[key].amount += amount
    }
  }

  return summary
}

async function downloadLayoutBbvaFormat(layoutId, format) {
  const layout = layouts.find((item) => item.id === layoutId)
  if (!layout) return

  if (![BBVA_FORMAT_SAME_BANK, BBVA_FORMAT_INTERBANK].includes(format)) {
    showToast("Formato no soportado", "Solo se pueden descargar PAGOSBBV o PAGOSINT.", "warning")
    return
  }

  if (layout.status === "cancelled") {
    showToast("Layout cancelado", "No se puede descargar archivo BBVA de un layout cancelado.", "danger")
    return
  }

  const { data: lines, error } = await fetchLayoutLines(layoutId)
  if (error) { showToast("No se pudo leer el layout", rlsHint("payment_layout_lines", "select", error), "danger"); return }

  const activeLines = (lines || []).filter((line) => line.status !== "bank_rejected")
  const selectedLines = activeLines.filter((line) => {
    try {
      return detectBbvaLayoutFormat(line) === format
    } catch {
      return false
    }
  })

  if (!selectedLines.length) {
    showToast("Sin lineas", `Este layout no tiene lineas ${bbvaFormatLabel(format)} para descargar.`, "warning")
    return
  }

  const invalidLines = validateLayoutLines(selectedLines)
  if (invalidLines.length) {
    const pagosintReferenceLine = invalidLines.find(invalidLineNeedsPagosintReference)
    const first = pagosintReferenceLine || invalidLines[0]
    showToast("Lineas invalidas", formatInvalidLayoutLineMessage(first), "danger")
    if (pagosintReferenceLine) await openLayoutLines(layoutId)
    return
  }

  try {
    const files = buildBbvaLayoutFiles(selectedLines, layout)
    const file = files.find((item) => item.format === format)
    if (!file) {
      showToast("Sin archivo", `No se pudo construir ${bbvaFormatLabel(format)} para este layout.`, "warning")
      return
    }

    if (!file.validation.ok) {
      showToast("Layout invalido", file.validation.errors[0], "danger")
      return
    }

    downloadTextFile(file.content, file.fileName)

    const update = await supabaseClient
      .from("payment_layouts")
      .update({ file_name: mergeLayoutFileName(layout.file_name, file.fileName), status: "generated", updated_at: new Date().toISOString() })
      .eq("id", layoutId)

    if (update.error) {
      showToast(`${file.label} descargado`, "El archivo fue generado, pero no se pudo actualizar el estado del layout.", "warning")
      return
    }

    showToast(`${file.label} generado`, `${file.fileName} se descargo correctamente. ${file.validation.lineCount} linea(s) de ${file.lineLength}.`, "success")
    await loadLayouts()
  } catch (error) {
    showToast(`No se pudo generar ${bbvaFormatLabel(format)}`, friendlyError(error), "danger")
  }
}

function mergeLayoutFileName(currentValue, nextFileName) {
  const names = String(currentValue || "")
    .split(" + ")
    .map((item) => item.trim())
    .filter(Boolean)
  if (!names.includes(nextFileName)) names.push(nextFileName)
  return names.join(" + ") || nextFileName
}

function focusFirstPagosintReferenceLine() {
  const line = activeLayoutLines.find((item) => lineNeedsPagosintReferenceCompletion(item))
  if (line) openPagosintReferenceModal(line.id)
}

function validateLayoutLines(lines) {
  return lines
    .filter((line) => line.status !== "bank_rejected")
    .map((line) => {
      const missing = []
      const sourceDigits = cxcDigits(line.source_account_number)
      const destinationDigits = cxcDigits(line.destination_value)
      const amount = numberValue(line.amount)
      const amountText = formatCxcAmount(line.amount)
      const conceptText = normalizeCxcText(line.payment_concept)
      const beneficiaryText = normalizeCxcText(line.beneficiary_name)
      const referenceDigits = cxcDigits(line.payment_reference)
      let format = null

      try {
        format = detectBbvaLayoutFormat(line)
      } catch (error) {
        missing.push(error.message)
      }

      if (!sourceDigits) missing.push("cuenta origen requerida")
      else if (sourceDigits.length > CXC_ACCOUNT_LENGTH) missing.push("cuenta origen excede 18 digitos")

      if (!destinationDigits) missing.push("cuenta destino requerida")
      else if (destinationDigits.length > CXC_ACCOUNT_LENGTH) missing.push("cuenta destino excede 18 digitos")

      if (!amount) missing.push("monto requerido")
      else if (amountText.length > CXC_AMOUNT_LENGTH) missing.push("monto excede 16 caracteres")

      if (!notBlank(line.payment_concept)) missing.push("concepto requerido")
      else if (!conceptText) missing.push("concepto sin caracteres validos para BBVA")

      if (format === BBVA_FORMAT_INTERBANK) {
        if (!notBlank(line.beneficiary_name)) missing.push("titular requerido para PAGOSINT")
        else if (!beneficiaryText) missing.push("titular sin caracteres validos para PAGOSINT")
        if (!referenceDigits) missing.push("referencia numerica requerida para PAGOSINT")
        else if (referenceDigits.length > BBVA_INTERBANK_REFERENCE_LENGTH) missing.push("referencia numerica para PAGOSINT acepta maximo 5 digitos")
      }

      return { line_id: line.id, payment_request_id: line.payment_request_id, request_number: line.request_number, missing_fields: missing }
    })
    .filter((item) => item.missing_fields.length)
}

function formatInvalidLayoutLineMessage(item) {
  const request = item.request_number || item.payment_request_id || "la solicitud"
  const missing = item.missing_fields || []
  if (invalidLineNeedsPagosintReference(item)) {
    return `La solicitud ${request} requiere referencia numerica para generar PAGOSINT. Da clic en Completar referencia.`
  }
  return `No se puede generar el archivo BBVA. Solicitud ${request}: ${missing.join(", ")}.`
}

function invalidLineNeedsPagosintReference(item) {
  const missing = item?.missing_fields || []
  return missing.some((field) => String(field).includes("referencia numerica") && String(field).includes("PAGOSINT"))
}

function buildBbvaLayoutFiles(lines, layout) {
  const groups = new Map([
    [BBVA_FORMAT_SAME_BANK, []],
    [BBVA_FORMAT_INTERBANK, []],
  ])

  lines.forEach((line) => {
    const format = detectBbvaLayoutFormat(line)
    groups.get(format).push(line)
  })

  return Array.from(groups.entries())
    .filter(([, groupLines]) => groupLines.length)
    .map(([format, groupLines]) => {
      const sameBank = format === BBVA_FORMAT_SAME_BANK
      const content = sameBank ? buildCxcContent(groupLines) : buildBbvaInterbankContent(groupLines)
      const validation = sameBank ? validateCxcContent(content) : validateBbvaInterbankContent(content)
      return {
        format,
        label: bbvaFormatLabel(format),
        fileName: buildBbvaFileName(layout, format),
        content,
        validation,
        lineLength: sameBank ? CXC_LINE_LENGTH : BBVA_INTERBANK_LINE_LENGTH,
      }
    })
}

function detectBbvaLayoutFormat(line) {
  const type = normalizeDestinationType(line.destination_type)
  if (["cuenta", "cuenta_bancaria", "cuenta_bbva", "mismo_banco", "bbva"].includes(type)) return BBVA_FORMAT_SAME_BANK
  if (["clabe", "interbancario", "transferencia_interbancaria", "tarjeta", "tdc"].includes(type)) return BBVA_FORMAT_INTERBANK
  if (type === "convenio") throw new Error("Destino convenio requiere layout CIE; no se incluye en PAGOSBBV/PAGOSINT.")
  throw new Error("Tipo de destino no soportado para layout BBVA; define cuenta o CLABE.")
}

function normalizeDestinationType(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function bbvaFormatLabel(format) {
  if (format === BBVA_FORMAT_INTERBANK) return "PAGOSINT"
  return "PAGOSBBV"
}

function buildCxcContent(lines) {
  return buildBbvaContent(lines, buildBbvaSameBankRecord85)
}

function buildBbvaInterbankContent(lines) {
  return buildBbvaContent(lines, buildBbvaInterbankRecord128)
}

function buildBbvaContent(lines, recordBuilder) {
  const rows = lines.map(recordBuilder)
  return rows.length ? `${rows.join(CXC_LINE_BREAK)}${CXC_LINE_BREAK}` : ""
}

function buildCxcLine(line) {
  return buildBbvaSameBankRecord85(line)
}

function buildBbvaSameBankRecord85(line) {
  const row = [
    formatCxcAccount(line.destination_value, "cuenta destino"),
    formatCxcAccount(line.source_account_number, "cuenta origen"),
    CXC_CURRENCY,
    formatCxcAmount(line.amount).padStart(CXC_AMOUNT_LENGTH, "0"),
    formatBbvaText(line.payment_concept, CXC_CONCEPT_LENGTH, "concepto PAGOSBBV"),
  ].join("")

  if (row.length !== CXC_LINE_LENGTH) {
    throw new Error(`cxc_line_length_invalid_${row.length}`)
  }

  if (!CXC_LINE_PATTERN.test(row)) {
    throw new Error("cxc_line_invalid_characters")
  }

  return row
}

function buildBbvaInterbankRecord128(line) {
  const row = [
    formatCxcAccount(line.destination_value, "cuenta destino interbancaria"),
    formatCxcAccount(line.source_account_number, "cuenta origen"),
    CXC_CURRENCY,
    formatCxcAmount(line.amount).padStart(CXC_AMOUNT_LENGTH, "0"),
    formatBbvaText(line.beneficiary_name, BBVA_INTERBANK_BENEFICIARY_LENGTH, "titular PAGOSINT"),
    formatBbvaReference(line.payment_reference),
    formatBbvaText(line.payment_concept, BBVA_INTERBANK_CONCEPT_LENGTH, "motivo PAGOSINT"),
    BBVA_INTERBANK_INDICATOR,
  ].join("")

  if (row.length !== BBVA_INTERBANK_LINE_LENGTH) {
    throw new Error(`bbva_interbank_line_length_invalid_${row.length}`)
  }

  if (!BBVA_INTERBANK_LINE_PATTERN.test(row)) {
    throw new Error("bbva_interbank_line_invalid_characters")
  }

  return row
}

function validateCxcContent(content) {
  return validateBbvaContent(content, {
    formatLabel: "PAGOSBBV",
    lineLength: CXC_LINE_LENGTH,
    linePattern: CXC_LINE_PATTERN,
    validateLine: validateBbvaSameBankFields,
  })
}

function validateBbvaInterbankContent(content) {
  return validateBbvaContent(content, {
    formatLabel: "PAGOSINT",
    lineLength: BBVA_INTERBANK_LINE_LENGTH,
    linePattern: BBVA_INTERBANK_LINE_PATTERN,
    validateLine: validateBbvaInterbankFields,
  })
}

function validateBbvaContent(content, options) {
  const errors = []
  const hasContent = typeof content === "string" && content.length > 0
  const hasFinalTerminator = hasContent && content.endsWith(CXC_LINE_BREAK)
  const hasDoubleFinalTerminator = hasContent && content.endsWith(`${CXC_LINE_BREAK}${CXC_LINE_BREAK}`)

  if (!hasContent) errors.push(`Layout ${options.formatLabel} invalido: el archivo no tiene lineas para descargar.`)
  if (hasContent && content.charCodeAt(0) === 0xfeff) errors.push(`Layout ${options.formatLabel} invalido: el archivo tiene BOM al inicio.`)
  if (hasContent && (content.startsWith("\r") || content.startsWith("\n"))) errors.push(`Layout ${options.formatLabel} invalido: existe una linea vacia al inicio del archivo.`)
  if (hasContent && !hasFinalTerminator) errors.push(`Layout ${options.formatLabel} invalido: el ultimo registro debe cerrar con CRLF.`)
  if (hasDoubleFinalTerminator) errors.push(`Layout ${options.formatLabel} invalido: existe una linea vacia real al final del archivo.`)
  if (hasContent && content.includes("|")) errors.push(`Layout ${options.formatLabel} invalido: el archivo contiene el separador | y debe ser ancho fijo.`)

  const contentWithoutCrLf = hasContent ? content.replaceAll(CXC_LINE_BREAK, "") : ""
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u00a0\u2000-\u200f\u2028\u2029\ufeff]/.test(contentWithoutCrLf)) {
    errors.push(`Layout ${options.formatLabel} invalido: el archivo contiene caracteres invisibles o no permitidos.`)
  }
  if (/[\r\n]/.test(contentWithoutCrLf)) {
    errors.push(`Layout ${options.formatLabel} invalido: los saltos de linea deben ser CRLF.`)
  }

  const body = hasContent && hasFinalTerminator ? content.slice(0, -CXC_LINE_BREAK.length) : content || ""
  const lines = body ? body.split(CXC_LINE_BREAK) : []
  const lineLengths = lines.map((line) => line.length)

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (!line) {
      errors.push(`Layout ${options.formatLabel} invalido: linea ${lineNumber} esta vacia.`)
      return
    }
    if (line.length !== options.lineLength) {
      errors.push(`Layout ${options.formatLabel} invalido: linea ${lineNumber} tiene longitud ${line.length}, esperada ${options.lineLength}.`)
    }
    options.validateLine(line, lineNumber, errors)
    if (!options.linePattern.test(line)) errors.push(`Layout ${options.formatLabel} invalido: linea ${lineNumber} no cumple la estructura esperada.`)
  })

  return {
    ok: errors.length === 0,
    errors,
    lines,
    lineCount: lines.length,
    lineLengths,
    hasFinalTerminator,
    hasDoubleFinalTerminator,
    byteLength: content ? content.length : 0,
  }
}

function validateBbvaSameBankFields(line, lineNumber, errors) {
  const fields = parseCxcLine(line)
  if (!/^\d{18}$/.test(fields.destinationAccount)) errors.push(`Layout invalido: cuenta destino de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (!/^\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout invalido: cuenta origen de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (fields.currency !== CXC_CURRENCY) errors.push(`Layout invalido: moneda de linea ${lineNumber} debe ser ${CXC_CURRENCY}.`)
  if (!/^\d{13}\.\d{2}$/.test(fields.amount)) errors.push(`Layout invalido: importe de linea ${lineNumber} debe medir 16 caracteres con punto decimal y 2 decimales.`)
  if (!/^[A-Z0-9 .,&\/-]{30}$/.test(fields.concept)) errors.push(`Layout invalido: concepto de linea ${lineNumber} contiene caracteres no permitidos.`)
}

function validateBbvaInterbankFields(line, lineNumber, errors) {
  const fields = parseBbvaInterbankLine(line)
  if (!/^\d{18}$/.test(fields.destinationAccount)) errors.push(`Layout PAGOSINT invalido: cuenta destino de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (!/^\d{18}$/.test(fields.sourceAccount)) errors.push(`Layout PAGOSINT invalido: cuenta origen de linea ${lineNumber} debe tener 18 digitos sin espacios.`)
  if (fields.currency !== CXC_CURRENCY) errors.push(`Layout PAGOSINT invalido: moneda de linea ${lineNumber} debe ser ${CXC_CURRENCY}.`)
  if (!/^\d{13}\.\d{2}$/.test(fields.amount)) errors.push(`Layout PAGOSINT invalido: importe de linea ${lineNumber} debe medir 16 caracteres con punto decimal y 2 decimales.`)
  if (!/^[A-Z0-9 .,&\/-]{30}$/.test(fields.beneficiary)) errors.push(`Layout PAGOSINT invalido: titular de linea ${lineNumber} contiene caracteres no permitidos.`)
  if (!/^\d{5}$/.test(fields.numericReference)) errors.push(`Layout PAGOSINT invalido: referencia numerica de linea ${lineNumber} debe ocupar 5 posiciones numericas; ${BBVA_INTERBANK_REFERENCE_INPUT_RULE}.`)
  if (!/^[A-Z0-9 .,&\/-]{37}$/.test(fields.concept)) errors.push(`Layout PAGOSINT invalido: motivo de linea ${lineNumber} contiene caracteres no permitidos.`)
  if (fields.indicator !== BBVA_INTERBANK_INDICATOR) errors.push(`Layout PAGOSINT invalido: indicador de linea ${lineNumber} debe ser ${BBVA_INTERBANK_INDICATOR}.`)
}

function parseCxcLine(line) {
  return {
    destinationAccount: line.slice(0, 18),
    sourceAccount: line.slice(18, 36),
    currency: line.slice(36, 39),
    amount: line.slice(39, 55),
    concept: line.slice(55, 85),
  }
}

function parseBbvaInterbankLine(line) {
  return {
    destinationAccount: line.slice(0, 18),
    sourceAccount: line.slice(18, 36),
    currency: line.slice(36, 39),
    amount: line.slice(39, 55),
    beneficiary: line.slice(55, 85),
    numericReference: line.slice(85, 90),
    concept: line.slice(90, 127),
    indicator: line.slice(127, 128),
  }
}

function maskCxcLine(line) {
  const fields = parseCxcLine(line.padEnd(CXC_LINE_LENGTH, " "))
  const mask = (value) => value ? `****${String(value).slice(-4)}` : "****"
  return [
    `destino ${mask(fields.destinationAccount)}`,
    `origen ${mask(fields.sourceAccount)}`,
    `moneda ${fields.currency || "---"}`,
    `importe ${fields.amount || "---"}`,
    `concepto ${fields.concept.trim().slice(0, 18) || "---"}`,
  ].join(" | ")
}

function maskBbvaLine(line, format) {
  if (format === BBVA_FORMAT_INTERBANK) {
    const fields = parseBbvaInterbankLine(line.padEnd(BBVA_INTERBANK_LINE_LENGTH, " "))
    const mask = (value) => value ? `****${String(value).slice(-4)}` : "****"
    return [
      `destino ${mask(fields.destinationAccount)}`,
      `origen ${mask(fields.sourceAccount)}`,
      `moneda ${fields.currency || "---"}`,
      `importe ${fields.amount || "---"}`,
      `titular ${fields.beneficiary.trim().slice(0, 18) || "---"}`,
      `ref ${fields.numericReference || "---"}`,
      `motivo ${fields.concept.trim().slice(0, 18) || "---"}`,
      `ind ${fields.indicator || "---"}`,
    ].join(" | ")
  }
  return maskCxcLine(line)
}

async function validateLayoutCxc(layoutId) {
  const layout = layouts.find((item) => item.id === layoutId)
  if (!layout) return

  const { data: lines, error } = await fetchLayoutLines(layoutId)
  if (error) { showToast("No se pudo validar", rlsHint("payment_layout_lines", "select", error), "danger"); return }

  const cxcLines = (lines || []).filter((line) => line.status !== "bank_rejected")
  if (!cxcLines.length) { showToast("Sin lineas", "Este layout no tiene lineas activas para validar.", "warning"); return }

  const invalidLines = validateLayoutLines(cxcLines)
  if (invalidLines.length) {
    const first = invalidLines[0]
    showToast("Layout invalido", formatInvalidLayoutLineMessage(first), "danger")
    return
  }

  try {
    const files = buildBbvaLayoutFiles(cxcLines, layout)
    const invalidFile = files.find((file) => !file.validation.ok)
    const diagnostics = files.map((file) => ({
      format: file.label,
      expectedLength: file.lineLength,
      lineCount: file.validation.lineCount,
      lineLengths: file.validation.lineLengths,
      hasFinalTerminator: file.validation.hasFinalTerminator,
      hasDoubleFinalTerminator: file.validation.hasDoubleFinalTerminator,
      byteLength: file.validation.byteLength,
      firstLine: maskBbvaLine(file.validation.lines[0] || "", file.format),
      errors: file.validation.errors,
    }))

    if (invalidFile) {
      showToast("Layout invalido", invalidFile.validation.errors[0], "danger")
      console.warn("Diagnostico BBVA", { layout: layout.layout_number || layout.id, files: diagnostics })
      return
    }

    console.info("Diagnostico BBVA", { layout: layout.layout_number || layout.id, files: diagnostics })
    showToast("Layout valido", diagnostics.map((item) => `${item.format}: ${item.lineCount} linea(s) de ${item.expectedLength}; CRLF final: ${item.hasFinalTerminator ? "si" : "no"}`).join(" | "), "success")
  } catch (error) {
    showToast("Layout invalido", friendlyError(error), "danger")
  }
}

function buildCxcFileName(layout) {
  return buildBbvaFileName(layout, BBVA_FORMAT_SAME_BANK)
}

function buildBbvaFileName(layout, format) {
  const folio = sanitizeCxcFileToken(layout.layout_number || layout.name || "LAYOUT")
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  const prefix = format === BBVA_FORMAT_INTERBANK ? "PAGOSINT" : "PAGOSBBV"
  return `${prefix}_FLUX_${folio}_${today}.${CXC_FILE_EXTENSION}`
}

function formatCxcAccount(value, label) {
  const digits = cxcDigits(value)
  if (!digits) throw new Error(`${label} requerida`)
  if (digits.length > CXC_ACCOUNT_LENGTH) throw new Error(`${label} excede ${CXC_ACCOUNT_LENGTH} digitos`)
  return digits.padStart(CXC_ACCOUNT_LENGTH, "0")
}

function formatCxcAmount(value) {
  const text = numberValue(value).toFixed(2)
  if (text.length > CXC_AMOUNT_LENGTH) throw new Error("monto excede 16 caracteres")
  return text
}

function formatCxcConcept(value) {
  return formatBbvaText(value, CXC_CONCEPT_LENGTH, "concepto CxC")
}

function formatBbvaText(value, length, label) {
  const text = normalizeCxcText(value)
  if (!text) throw new Error(`${label} requerido`)
  return text.slice(0, length).padEnd(length, " ")
}

function formatBbvaReference(value) {
  const digits = cxcDigits(value)
  if (!digits) throw new Error("referencia numerica PAGOSINT requerida")
  if (digits.length > BBVA_INTERBANK_REFERENCE_LENGTH) throw new Error("referencia numerica PAGOSINT acepta maximo 5 digitos")
  return digits.padStart(BBVA_INTERBANK_REFERENCE_LENGTH, "0")
}

function normalizeCxcText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .,&/\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cxcDigits(value) {
  return String(value ?? "").replace(/\D/g, "")
}

function sanitizeCxcFileToken(value) {
  const token = normalizeCxcText(value).replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return token || "LAYOUT"
}

function downloadTextFile(content, fileName) {
  const blob = new Blob([content], { type: CXC_MIME_TYPE })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Badges

function layoutStatusBadge(status) {
  const map = {
    draft: ["Draft", "warning"],
    generated: ["Generado", "info"],
    uploaded: ["Subido", "accent"],
    confirmed: ["Confirmado", "success"],
    paid: ["Pagado", "success"],
    cancelled: ["Cancelado", "neutral"],
  }
  const [label, variant] = map[status] || [status || "-", "neutral"]
  return Components.badge(label, variant)
}

function lineStatusBadge(status) {
  const map = {
    included: ["Incluido", "info"],
    paid: ["Pagado", "success"],
    bank_rejected: ["Rechazado", "danger"],
    cancelled: ["Cancelado", "neutral"],
  }
  const [label, variant] = map[status] || [status || "-", "neutral"]
  return Components.badge(label, variant)
}

// Utilidades

async function logout() { await supabaseClient.auth.signOut(); window.location.href = "./index.html" }

function ensureActorProfile() {
  if (currentProfileId) return true
  showToast("Perfil no identificado", "No se pudo identificar el perfil del usuario para registrar la accion.", "danger")
  return false
}

function setButtonLoading(button, loading, text) {
  if (!button) return
  button.disabled = loading
  button.textContent = text
}

function showToast(title, desc, variant = "success") {
  Components.showToast({ title, desc, variant, duration: 6 })
}

function friendlyRpcError(error) {
  const message = error?.message || String(error || "Error desconocido")
  const known = {
    layout_not_found: "No se encontro el layout.",
    actor_profile_not_found: "No se pudo identificar el perfil del usuario.",
    registered_by_profile_not_found: "No se pudo identificar el perfil del usuario.",
    layout_must_be_generated_first: "Primero genera el archivo CxC BBVA antes de marcar el layout como subido.",
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
    company_bank_account_not_found_inactive_or_company_mismatch: "La cuenta origen debe estar activa y pertenecer a la empresa de la solicitud.",
    finance_role_required: "Se requiere rol de Finanzas.",
    finance_reapproval_required: "La solicitud requiere revalidacion de presupuesto por un cambio material.",
    rebatch_correction_note_too_short: "Explica en al menos 10 caracteres que se corrigio.",
    payment_request_in_another_open_batch: "La solicitud ya pertenece a otro corte abierto.",
    target_batch_must_be_draft: "El corte destino ya no esta en borrador.",
    target_batch_company_mismatch: "El corte destino pertenece a otra empresa.",
    payment_request_already_in_target_batch: "La solicitud ya esta en el corte destino.",
    closed_batch_authorization_required: "El pago regular requiere aprobacion de Direccion y corte cerrado.",
    payment_request_layout_data_locked: "La solicitud ya fue pagada o tiene una ejecucion y sus datos de layout estan bloqueados.",
    payment_reference_must_be_numeric: "La referencia debe contener solo digitos.",
    payment_reference_too_long: "La referencia acepta de 1 a 5 digitos.",
    payment_concept_too_long: "El concepto acepta hasta 120 caracteres.",
    payment_concept_invalid_characters: "El concepto contiene caracteres no permitidos.",
    payment_request_provider_not_found_or_inactive: "El proveedor no existe o está inactivo.",
    proveedor_not_found_or_inactive: "El proveedor no existe o está inactivo.",
    approval_material_timestamp_changed_by_execution_data: "No se guardó: los datos operativos intentaron alterar la autorización de Dirección.",
    operational_update_changed_approval_material_timestamp: "No se guardó: los datos operativos intentaron alterar la autorización de Dirección.",
    operational_update_invalidated_direction_approval: "No se guardó: la autorización de Dirección no pudo conservarse.",
    payment_execution_rpc_required: "Los datos de ejecución solo pueden modificarse mediante el flujo autorizado de Finanzas.",
    provider_payment_execution_rpc_required: "Los datos bancarios del proveedor solo pueden modificarse mediante el flujo autorizado de Finanzas.",
    provider_payment_execution_data_invalid: "Corrige los datos bancarios del proveedor antes de continuar.",
  }
  const key = Object.keys(known).find((k) => message.includes(k))
  if (key) return known[key]
  return friendlyError(error)
}

function friendlyError(error) {
  const message = error?.message || String(error || "Error desconocido")
  if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("url scheme")) {
    return "No se pudo conectar con Supabase. Revisa la conexion y vuelve a intentar."
  }
  if (message.includes("cxc_line_length_invalid_")) return `Layout invalido: una linea no tiene ${CXC_LINE_LENGTH} caracteres.`
  if (message.includes("cxc_line_invalid_characters")) return "Layout invalido: una linea contiene caracteres no permitidos."
  if (message.toLowerCase().includes("row-level security") || error?.code === "42501") return "La operacion fue bloqueada por RLS. Revisa policies."
  if (message.toLowerCase().includes("permission denied")) return "Faltan permisos para ejecutar la operacion."
  return message
}

function rlsHint(table, operation, error) {
  const message = error?.message || ""
  if (message.toLowerCase().includes("row-level security") || error?.code === "42501" || message.toLowerCase().includes("permission denied")) {
    return `Operacion ${operation} bloqueada por RLS en ${table}.`
  }
  return message
}

function pagosintSaveHint(error) {
  const raw = String(error?.message || error?.hint || error || "")
  const message = raw.toLowerCase()
  if (message.includes("row-level security") || error?.code === "42501" || message.includes("permission denied")) {
    return "No se pudo guardar la referencia PAGOSINT porque la operacion fue bloqueada por permisos en payment_layout_lines."
  }
  if (message.includes("not_authorized_to_update_layout_lines")) {
    return "Tu usuario no tiene permisos para completar referencias PAGOSINT en este layout."
  }
  if (message.includes("payment_layout_line_not_found")) {
    return "La linea del layout ya no existe o cambio; vuelve a abrir el layout e intenta de nuevo."
  }
  if (message.includes("pagosint_reference_only_for_interbank_lines")) {
    return "La referencia numerica solo aplica a lineas interbancarias PAGOSINT."
  }
  if (message.includes("pagosint_reference_required")) {
    return "Captura una referencia numerica de 1 a 5 digitos para PAGOSINT."
  }
  if (message.includes("pagosint_reference_too_long")) {
    return "La referencia PAGOSINT acepta maximo 5 digitos."
  }
  if (message.includes("persistida") || message.includes("reaparecio")) {
    return raw
  }
  return raw || "No se pudo guardar la referencia PAGOSINT."
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(numberValue(value))
}

function compactCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", notation: "compact", maximumFractionDigits: 1 }).format(numberValue(value))
}

function formatDate(value) {
  if (!value) return "-"
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return isNaN(d) ? "-" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(d)
}

function numberValue(value) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function notBlank(value) { return value !== null && value !== undefined && String(value).trim() !== "" }
function cleanText(value) { return String(value || "").trim() }
function normalize(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") }
function sanitizeFileName(value) { return String(value || "layout-pagos").replace(/[\\/:*?"<>|]+/g, "-").trim() }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }
