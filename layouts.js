const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const CXC_FILE_EXTENSION = "txt"
const CXC_MIME_TYPE = "text/plain;charset=utf-8"
const CXC_DELIMITER = "|"
const CXC_COLUMNS = [
  { key: "source_account_number", label: "CTA_CARGO", value: (line) => line.source_account_number },
  { key: "company_name", label: "TITULAR", value: (line) => line.company_name },
  { key: "destination_value", label: "DESTINO", value: (line) => line.destination_value },
  { key: "beneficiary_name", label: "BENEFICIARIO", value: (line) => line.beneficiary_name },
  { key: "amount", label: "MONTO", value: (line) => formatCxcAmount(line.amount) },
  { key: "payment_reference", label: "REFERENCIA", value: (line) => line.payment_reference },
  { key: "payment_concept", label: "CONCEPTO", value: (line) => line.payment_concept },
]

let layouts = []
let companies = []
let companyBankAccounts = []
let currentProfileId = null
let activeLinesLayoutId = null
let activeConfirmLayoutId = null
let activeRejectLineId = null
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
  dom.layoutInvalidBox = document.getElementById("layoutInvalidBox")
  dom.closeNewLayoutModalBtn = document.getElementById("closeNewLayoutModalBtn")
  dom.cancelNewLayoutBtn = document.getElementById("cancelNewLayoutBtn")
  dom.submitNewLayoutBtn = document.getElementById("submitNewLayoutBtn")
  dom.linesDialog = document.getElementById("linesDialog")
  dom.linesTitle = document.getElementById("linesTitle")
  dom.linesSubtitle = document.getElementById("linesSubtitle")
  dom.linesTableBody = document.getElementById("linesTableBody")
  dom.closeLinesModalBtn = document.getElementById("closeLinesModalBtn")
  dom.confirmDialog = document.getElementById("confirmDialog")
  dom.confirmPaymentForm = document.getElementById("confirmPaymentForm")
  dom.confirmTitle = document.getElementById("confirmTitle")
  dom.paymentDate = document.getElementById("paymentDate")
  dom.bankReference = document.getElementById("bankReference")
  dom.receiptStoragePath = document.getElementById("receiptStoragePath")
  dom.closeConfirmModalBtn = document.getElementById("closeConfirmModalBtn")
  dom.cancelConfirmBtn = document.getElementById("cancelConfirmBtn")
  dom.submitConfirmBtn = document.getElementById("submitConfirmBtn")
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
  dom.layoutCompanyId?.addEventListener("change", renderLayoutBankAccountOptions)
  dom.closeNewLayoutModalBtn?.addEventListener("click", closeNewLayoutModal)
  dom.cancelNewLayoutBtn?.addEventListener("click", closeNewLayoutModal)
  dom.newLayoutForm?.addEventListener("submit", submitNewLayout)
  dom.closeLinesModalBtn?.addEventListener("click", closeLinesModal)
  dom.closeConfirmModalBtn?.addEventListener("click", closeConfirmModal)
  dom.cancelConfirmBtn?.addEventListener("click", closeConfirmModal)
  dom.confirmPaymentForm?.addEventListener("submit", submitConfirmPayment)
  dom.closeRejectLineModalBtn?.addEventListener("click", closeRejectLineModal)
  dom.cancelRejectLineBtn?.addEventListener("click", closeRejectLineModal)
  dom.rejectLineForm?.addEventListener("submit", submitRejectLine)
}

// ── Carga y renderizado ─────────────────────────────────────────

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
  renderStats()
  renderLayoutsTable()
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

  if (l.status === "draft") {
    actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutCxc('${l.id}')" style="white-space:nowrap">Generar CxC</button>`)
  }

  if (l.status === "generated") {
    actions.push(`<button class="small-btn" type="button" onclick="downloadLayoutCxc('${l.id}')" style="white-space:nowrap">${l.file_name ? "Descargar CxC" : "Generar CxC"}</button>`)
    actions.push(`<button class="small-btn warning" type="button" onclick="markLayoutUploaded('${l.id}')" style="white-space:nowrap">Marcar subido</button>`)
    actions.push(`<button class="small-btn success" type="button" onclick="openConfirmPaymentModal('${l.id}')" style="white-space:nowrap">Confirmar pago</button>`)
  }

  if (l.status === "uploaded") {
    actions.push(`<button class="small-btn success" type="button" onclick="openConfirmPaymentModal('${l.id}')" style="white-space:nowrap">Confirmar pago</button>`)
  }

  return actions.join("")
}

// ── Nuevo layout ────────────────────────────────────────────────

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
  if (dom.newLayoutDialog.open) dom.newLayoutDialog.close()
}

function resetNewLayoutForm() {
  dom.newLayoutForm?.reset()
  dom.layoutInvalidBox.classList.add("hidden")
  dom.layoutInvalidBox.innerHTML = ""

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
  let accounts = companyBankAccounts

  if (selectedCompanyId) {
    const filtered = companyBankAccounts.filter((a) => a.company_id === selectedCompanyId)
    if (filtered.length) accounts = filtered
  }

  dom.layoutBankAccountId.innerHTML = [
    `<option value="">Todas las cuentas</option>`,
    ...accounts.map((a) => {
      const label = [a.name || "Cuenta origen", a.bank_name, a.account_number ? `cta ${a.account_number}` : a.last4 ? `termina ${a.last4}` : null].filter(Boolean).join(" · ")
      return `<option value="${a.id}">${escapeHtml(label)}</option>`
    }),
  ].join("")
  if (selected && accounts.some((a) => a.id === selected)) dom.layoutBankAccountId.value = selected
}

async function submitNewLayout(event) {
  event.preventDefault()
  if (!ensureActorProfile()) return

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
      return
    }

    const invalidCount = numberValue(data?.invalid_count)
    renderInvalidRequests(data?.invalid_requests || [])
    showToast(
      "Layout creado",
      invalidCount ? "Algunas solicitudes no entraron al layout por datos incompletos." : `${data?.layout_number || "El layout"} quedo en draft.`,
      invalidCount ? "warning" : "success"
    )

    if (!invalidCount) closeNewLayoutModal()
  } catch (error) {
    renderLayoutNotice(friendlyRpcError(error))
    showToast("No se pudo crear layout", friendlyRpcError(error), "danger")
  } finally {
    setButtonLoading(dom.submitNewLayoutBtn, false, "Crear layout")
  }
}

function renderLayoutNotice(message, invalidRequests = []) {
  const list = invalidRequests.length
    ? `<ul style="margin:6px 0 0 16px">${invalidRequests.slice(0, 8).map((item) => {
        const fields = Array.isArray(item.missing_fields) ? item.missing_fields.join(", ") : item.missing_fields || "datos incompletos"
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

// ── Lineas ──────────────────────────────────────────────────────

async function openLayoutLines(layoutId) {
  const layout = layouts.find((item) => item.id === layoutId)
  if (!layout) return

  activeLinesLayoutId = layoutId
  dom.linesTitle.textContent = layout.layout_number || "Lineas del layout"
  dom.linesSubtitle.textContent = `${layout.name || ""} — archivo CxC`.trim()
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
  renderLinesTable(data || [])
}

function closeLinesModal() {
  activeLinesLayoutId = null
  if (dom.linesDialog.open) dom.linesDialog.close()
}

function renderLinesTable(lines) {
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
      <td>${escapeHtml(line.payment_reference || "")}</td>
      <td>${escapeHtml(line.payment_concept || "")}</td>
      <td>${escapeHtml(line.request_number || "")}</td>
      <td>${lineStatusBadge(line.status)}</td>
      <td>${renderLineActions(line)}</td>
    </tr>`).join("")
}

function renderLineActions(line) {
  if (line.status !== "included") return `<span style="color:var(--text-3);font-size:11px">—</span>`
  return `<button class="small-btn danger" type="button" onclick="openRejectLineModal('${line.id}')" style="white-space:nowrap">Rechazar</button>`
}

// ── Archivo CxC ─────────────────────────────────────────────────

async function downloadLayoutCxc(layoutId) {
  const layout = layouts.find((item) => item.id === layoutId)
  if (!layout) return

  if (layout.status === "cancelled") {
    showToast("Layout cancelado", "No se puede generar archivo CxC de un layout cancelado.", "danger")
    return
  }

  const { data: lines, error } = await fetchLayoutLines(layoutId)
  if (error) { showToast("No se pudo leer el layout", rlsHint("payment_layout_lines", "select", error), "danger"); return }

  if (!lines?.length) { showToast("Sin lineas", "Este layout no tiene lineas para generar archivo CxC.", "warning"); return }

  const invalidLines = validateLayoutLines(lines)
  if (invalidLines.length) {
    const first = invalidLines[0]
    showToast("Lineas incompletas", `No se puede generar el archivo CxC. Solicitud ${first.request_number || first.payment_request_id}: falta ${first.missing_fields.join(", ")}.`, "danger")
    return
  }

  try {
    const cxcLines = lines.filter((line) => line.status !== "bank_rejected")
    const fileName = buildCxcFileName(layout)
    const content = buildCxcContent(cxcLines)

    downloadTextFile(content, fileName)

    const update = await supabaseClient.from("payment_layouts").update({ file_name: fileName, status: "generated", updated_at: new Date().toISOString() }).eq("id", layoutId)

    if (update.error) {
      showToast("Archivo CxC descargado", "El archivo fue generado, pero no se pudo actualizar el estado del layout.", "warning")
      return
    }

    showToast("Archivo CxC generado", `${fileName} se descargo correctamente.`, "success")
    await loadLayouts()
  } catch (error) {
    showToast("No se pudo generar CxC", friendlyError(error), "danger")
  }
}

// ── Confirmar pago ──────────────────────────────────────────────

async function markLayoutUploaded(layoutId) {
  if (!ensureActorProfile()) return
  const layout = layouts.find((item) => item.id === layoutId)
  if (!confirm(`Marcar ${layout?.layout_number || "este layout"} como subido al banco?`)) return

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

// ── Rechazar linea ───────────────────────────────────────────────

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

// ── Expuestos en window ──────────────────────────────────────────

window.openLayoutLines = openLayoutLines
window.downloadLayoutCxc = downloadLayoutCxc
window.generateLayoutExcel = downloadLayoutCxc
window.markLayoutUploaded = markLayoutUploaded
window.openConfirmPaymentModal = openConfirmPaymentModal
window.openRejectLineModal = openRejectLineModal

// ── Supabase helpers ─────────────────────────────────────────────

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

function validateLayoutLines(lines) {
  return lines
    .filter((line) => line.status !== "bank_rejected")
    .map((line) => {
      const missing = []
      if (!notBlank(line.source_account_number)) missing.push("source_account_number")
      if (!notBlank(line.company_name)) missing.push("company_name")
      if (!notBlank(line.destination_value)) missing.push("destination_value")
      if (!notBlank(line.beneficiary_name)) missing.push("beneficiary_name")
      if (!numberValue(line.amount)) missing.push("amount")
      if (!notBlank(line.payment_reference)) missing.push("payment_reference")
      if (!notBlank(line.payment_concept)) missing.push("payment_concept")
      return { payment_request_id: line.payment_request_id, request_number: line.request_number, missing_fields: missing }
    })
    .filter((item) => item.missing_fields.length)
}

function buildCxcContent(lines) {
  const rows = lines.map((line) => CXC_COLUMNS.map((column) => formatCxcField(column.value(line))).join(CXC_DELIMITER))
  return `${rows.join("\r\n")}\r\n`
}

function buildCxcFileName(layout) {
  const folio = sanitizeFileName(layout.layout_number || layout.name || "layout")
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "")
  return `layout_CxC_${folio}_${today}.${CXC_FILE_EXTENSION}`
}

function formatCxcField(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[|\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function formatCxcAmount(value) {
  return numberValue(value).toFixed(2)
}

function downloadTextFile(content, fileName) {
  const blob = new Blob(["\ufeff", content], { type: CXC_MIME_TYPE })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ── Badges ───────────────────────────────────────────────────────

function layoutStatusBadge(status) {
  const map = {
    draft: ["Draft", "warning"],
    generated: ["Generado", "info"],
    uploaded: ["Subido", "accent"],
    confirmed: ["Confirmado", "success"],
    paid: ["Pagado", "success"],
    cancelled: ["Cancelado", "neutral"],
  }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

function lineStatusBadge(status) {
  const map = {
    included: ["Incluido", "info"],
    paid: ["Pagado", "success"],
    bank_rejected: ["Rechazado", "danger"],
    cancelled: ["Cancelado", "neutral"],
  }
  const [label, variant] = map[status] || [status || "—", "neutral"]
  return Components.badge(label, variant)
}

// ── Utilidades ───────────────────────────────────────────────────

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
    layout_must_be_generated_first: "Primero genera el archivo CxC antes de marcar el layout como subido.",
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
  }
  const key = Object.keys(known).find((k) => message.includes(k))
  if (key) return known[key]
  return friendlyError(error)
}

function friendlyError(error) {
  const message = error?.message || String(error || "Error desconocido")
  if (message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("url scheme")) {
    return "No se pudo cargar la plantilla. Si estas en file://, usa la opcion Plantilla local o despliega en Vercel."
  }
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

function formatCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 2 }).format(numberValue(value))
}

function compactCurrency(value) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", notation: "compact", maximumFractionDigits: 1 }).format(numberValue(value))
}

function formatDate(value) {
  if (!value) return "—"
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00`)
  return isNaN(d) ? "—" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(d)
}

function numberValue(value) { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function notBlank(value) { return value !== null && value !== undefined && String(value).trim() !== "" }
function cleanText(value) { return String(value || "").trim() }
function normalize(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") }
function sanitizeFileName(value) { return String(value || "layout-pagos").replace(/[\\/:*?"<>|]+/g, "-").trim() }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }
