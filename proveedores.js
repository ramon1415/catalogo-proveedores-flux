const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let proveedores = []
let currentEditingId = null
let currentProfileId = null
let currentCsfPath = null
let providerCsfUpload = null
let providerSaveInProgress = false
const providerQuery = new URLSearchParams(window.location.search)
const intakeProposalId = providerQuery.get("intake_id")
const intakeProposalReturn = providerQuery.get("return") === "provider_intakes"
let intakeProposal = null

const rootElement = document.documentElement
const tableBody = document.getElementById("suppliersTableBody")
const searchInput = document.getElementById("searchInput")
const statusFilter = document.getElementById("statusFilter")
const dialog = document.getElementById("supplierDialog")
const form = document.getElementById("supplierForm")

document.addEventListener("DOMContentLoaded", init)

async function init() {
  setupTheme()
  prepareSupplierFormUx()

  if (window.FluxAuth?.ready) await window.FluxAuth.ready()
  const profile = window.FluxAuth?.getProfile?.()
  const session = window.FluxAuth?.state?.session
  currentProfileId = profile?.id || null
  providerCsfUpload = window.FluxUpload?.initFileUpload("providerCsf") || { getFile: () => null, reset: () => {} }

  if (!session) {
    window.location.href = "./index.html"
    return
  }

  document.getElementById("userName").textContent = profile?.full_name || session.user?.email || "Usuario"
  document.getElementById("userEmail").textContent = profile?.email || session.user?.email || "Sesion activa"

  document.getElementById("logoutBtn").addEventListener("click", logout)
  document.getElementById("themeToggle").addEventListener("click", () => {
    const next = rootElement.dataset.theme === "dark" ? "light" : "dark"
    rootElement.dataset.theme = next
    localStorage.setItem("flux-theme", next)
  })
  document.getElementById("newSupplierBtn").addEventListener("click", openCreateModal)
  document.getElementById("closeModalBtn").addEventListener("click", closeModal)
  document.getElementById("cancelBtn").addEventListener("click", closeModal)
  document.getElementById("metodo_pago").addEventListener("change", handlePaymentMethodChange)
  document.getElementById("destination_type")?.addEventListener("change", handleDestinationTypeChange)
  document.getElementById("providerCsfLink")?.addEventListener("click", openCurrentCsf)
  document.getElementById("applyIntakeProposalBtn")?.addEventListener("click", () => applyIntakeProposal(true))

  searchInput.addEventListener("input", renderTable)
  statusFilter.addEventListener("change", renderTable)
  form.addEventListener("submit", saveSupplier)

  await loadSuppliers()
  await openProviderFromQuery()
}

async function openProviderFromQuery() {
  const providerId = providerQuery.get("provider_id")
  if (!providerId && !intakeProposalId) return
  if (intakeProposalId) await loadIntakeProposal()
  if (!providerId) {
    if (!canManageProviders()) {
      showToast("Sin permiso", "La administracion de proveedores corresponde a un usuario interno autorizado.", "warning")
      return
    }
    openCreateModal()
    applyIntakeProposal(false)
    return
  }
  const provider = proveedores.find((item) => item.id === providerId)
  if (!provider) {
    showToast("Proveedor no encontrado", "El proveedor solicitado ya no esta disponible en el catalogo.", "warning")
    return
  }
  window.openEditModal(providerId)
  if (intakeProposal) showIntakeProposal(true)
}

async function loadIntakeProposal() {
  const { data, error } = await supabaseClient.rpc("get_provider_intake_provider_proposal", {
    p_payment_intake_id: intakeProposalId,
  })
  if (error || !data?.payment_intake_id) {
    showToast("Propuesta no disponible", "No fue posible cargar los datos declarados del intake.", "warning")
    return
  }
  intakeProposal = data
}

function showIntakeProposal(requireExplicitApply) {
  if (!intakeProposal) return
  const panel = document.getElementById("intakeProposal")
  panel.hidden = false
  document.getElementById("intakeProposalFolio").textContent = intakeProposal.public_folio || "Intake de proveedor"
  document.getElementById("applyIntakeProposalBtn").hidden = !requireExplicitApply
}

function applyIntakeProposal(requireConfirmation) {
  if (!intakeProposal) return
  if (requireConfirmation && !confirm("Aplicar los datos declarados como propuesta editable? Ningun cambio se guardara hasta que confirmes Guardar proveedor.")) return
  const hasBankData = Boolean(intakeProposal.bank_name || intakeProposal.bank_account || intakeProposal.bank_clabe || intakeProposal.beneficiary_name)
  setValue("alias", intakeProposal.provider_name)
  setValue("nombre_completo", intakeProposal.provider_name)
  setValue("rfc", intakeProposal.provider_rfc)
  setValue("email", intakeProposal.provider_email)
  setValue("telefono", intakeProposal.provider_phone)
  setValue("banco", intakeProposal.bank_name)
  setValue("cuenta_bancaria", intakeProposal.bank_account)
  setValue("clabe", intakeProposal.bank_clabe)
  setValue("beneficiary_name", intakeProposal.beneficiary_name)
  if (hasBankData) {
    setValue("metodo_pago", "Transferencia bancaria")
    setValue("destination_type", intakeProposal.bank_clabe ? "clabe" : "cuenta")
  }
  handlePaymentMethodChange()
  handleDestinationTypeChange()
  showIntakeProposal(false)
  document.getElementById("intakeProposalCopy").textContent = "Propuesta cargada en el formulario. Revisa, corrige, completa o elimina cualquier valor antes de guardar."
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) rootElement.setAttribute("data-theme", saved)
}

function prepareSupplierFormUx() {
  const grid = form?.querySelector(".form-grid")
  if (!grid) return

  const orderedControls = [
    "alias", "nombre_completo", "tipo_proveedor", "destination_type",
    "metodo_pago", "tipo_cuenta", "beneficiary_name", "banco", "clabe",
    "cuenta_bancaria", "convenio_number", "rfc", "persona_tipo", "email", "telefono",
    "providerCsfFile", "es_personal_eventual", "activo", "notas",
  ]

  orderedControls.map(labelForControl).filter(Boolean).forEach((label) => grid.appendChild(label))

  labelForControl("tipo_cuenta")?.classList.add("hidden")
  labelForControl("banco")?.setAttribute("data-bank-field", "true")
  labelForControl("clabe")?.setAttribute("data-destination-field", "clabe")
  labelForControl("cuenta_bancaria")?.setAttribute("data-destination-field", "cuenta")
  labelForControl("convenio_number")?.setAttribute("data-destination-field", "convenio")

  updateDestinationFieldVisibility()
}

function labelForControl(controlId) {
  return document.getElementById(controlId)?.closest("label") || null
}

function setControlLabelVisible(controlId, visible) {
  const label = labelForControl(controlId)
  if (!label) return
  label.classList.toggle("hidden", !visible)
}

// ── Carga de datos ────────────────────────────────────────────

async function loadSuppliers() {
  tableBody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">Cargando proveedores...</td></tr>`

  const { data, error } = await supabaseClient
    .from("proveedores")
    .select("*")
    .order("alias", { ascending: true })

  if (error) {
    tableBody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--ruby)">No fue posible cargar proveedores.</td></tr>`
    logSupplierSaveDiagnostic(error, { stage: "load", operation: "select" })
    showToast("No fue posible cargar proveedores.", "", "error")
    return
  }

  proveedores = data || []

  renderTable()
}


function renderTable() {
  const query = normalize(searchInput.value)
  const filter = statusFilter.value
  const canManage = canManageProviders()

  const rows = proveedores.filter((p) => {
    const haystack = normalize([p.alias, p.nombre_completo, p.rfc, p.banco, p.email, p.telefono, p.metodo_pago].join(" "))
    return haystack.includes(query) &&
      (filter === "todos" || (filter === "activos" && p.activo) || (filter === "inactivos" && !p.activo))
  })

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">No se encontraron proveedores.</td></tr>`
    return
  }

  tableBody.innerHTML = rows.map((p) => `
    <tr>
      <td>
        <strong>${escapeHtml(p.alias || "")}</strong>
        ${p.es_personal_eventual ? Components.badge("Personal eventual", "info") : ""}
      </td>
      <td>${escapeHtml(p.nombre_completo || "")}</td>
      <td>${escapeHtml(p.metodo_pago || "")}</td>
      <td>${escapeHtml(p.banco || "")}</td>
      <td>
        ${p.clabe || p.cuenta_bancaria ? `<span class="clabe-num">${escapeHtml(p.clabe || p.cuenta_bancaria || "")}</span>` : ""}
        ${p.tipo_cuenta ? `<span class="clabe-label">${escapeHtml(p.tipo_cuenta)}</span>` : ""}
      </td>
      <td>${escapeHtml(p.rfc || "")}</td>
      <td>${Components.badge(p.activo ? "Activo" : "Inactivo", p.activo ? "success" : "neutral")}</td>
      <td>
        ${canManage
          ? `<div class="actions row-actions">
              <button class="small-btn" type="button" onclick="openEditModal('${escapeHtml(p.id)}')">Editar</button>
              ${p.activo
                ? `<button class="small-btn danger" type="button" onclick="toggleSupplier('${escapeHtml(p.id)}', false)">Desactivar</button>`
                : `<button class="small-btn" type="button" onclick="toggleSupplier('${escapeHtml(p.id)}', true)">Reactivar</button>`}
            </div>`
          : '<span class="field-hint">Solo lectura</span>'}
      </td>
    </tr>
  `).join("")
}

// ── Modal proveedor ───────────────────────────────────────────

function openCreateModal() {
  currentEditingId = null
  currentCsfPath = null
  document.getElementById("modalTitle").textContent = "Nuevo proveedor"
  form.reset()
  document.getElementById("activo").checked = true
  resetCsfControls()
  updateCsfPermissionState()
  handlePaymentMethodChange()
  dialog.showModal()
}

window.openEditModal = function(id) {
  if (!canManageProviders()) {
    showToast("Sin permiso", "La administracion de proveedores corresponde a Finanzas, Direccion o Sysadmin.", "warning")
    return
  }
  const p = proveedores.find((item) => item.id === id)
  if (!p) return
  currentEditingId = id
  currentCsfPath = p.csf_file_path || null
  document.getElementById("modalTitle").textContent = "Editar proveedor"
  setValue("supplierId", p.id)
  setValue("alias", p.alias)
  setValue("nombre_completo", p.nombre_completo)
  setValue("metodo_pago", p.metodo_pago)
  setValue("tipo_cuenta", p.tipo_cuenta)
  setValue("destination_type", p.destination_type)
  setValue("beneficiary_name", p.beneficiary_name)
  setValue("banco", p.banco)
  setValue("clabe", p.clabe)
  setValue("cuenta_bancaria", p.cuenta_bancaria)
  setValue("convenio_number", p.convenio_number)
  setValue("rfc", p.rfc)
  setValue("persona_tipo", p.persona_tipo)
  setValue("email", p.email)
  setValue("telefono", p.telefono)
  setValue("tipo_proveedor", p.tipo_proveedor)
  setValue("notas", p.notas)
  document.getElementById("es_personal_eventual").checked = Boolean(p.es_personal_eventual)
  document.getElementById("activo").checked = Boolean(p.activo)
  resetCsfControls()
  updateCsfPermissionState()
  renderCsfLink()
  handlePaymentMethodChange()
  handleDestinationTypeChange()
  dialog.showModal()
}

function handlePaymentMethodChange() {
  const metodoPago = document.getElementById("metodo_pago").value
  const tipoCuenta = document.getElementById("tipo_cuenta")
  const destinationType = document.getElementById("destination_type")
  const banco = document.getElementById("banco")
  const clabe = document.getElementById("clabe")
  const cuentaBancaria = document.getElementById("cuenta_bancaria")
  const convenioNumber = document.getElementById("convenio_number")
  const camposBancarios = [tipoCuenta, destinationType, banco, clabe, cuentaBancaria, convenioNumber]

  if (metodoPago === "Efectivo" || metodoPago === "Tarjeta en plataforma") {
    tipoCuenta.value = ""
    destinationType.value = ""
    banco.value = ""
    clabe.value = ""
    cuentaBancaria.value = ""
    convenioNumber.value = ""
    camposBancarios.forEach((c) => { c.disabled = true; c.classList.add("field-disabled") })
    updateDestinationFieldVisibility()
    return
  }

  camposBancarios.forEach((c) => { c.disabled = false; c.classList.remove("field-disabled") })
  if (metodoPago === "Transferencia bancaria" && !tipoCuenta.value) tipoCuenta.value = "CLABE"
  if (metodoPago === "Transferencia bancaria" && !destinationType.value) destinationType.value = inferDestinationType()
  handleDestinationTypeChange()
}

function handleDestinationTypeChange() {
  const destinationType = getValue("destination_type")
  const tipoCuenta = document.getElementById("tipo_cuenta")
  if (destinationType === "clabe") tipoCuenta.value = "CLABE"
  if (destinationType === "cuenta") tipoCuenta.value = "Cuenta"
  if (destinationType === "convenio") tipoCuenta.value = ""
  updateDestinationFieldVisibility()
}

function updateDestinationFieldVisibility() {
  const metodoPago = getValue("metodo_pago")
  const destinationType = getValue("destination_type")
  const hidesBankFields = metodoPago === "Efectivo" || metodoPago === "Tarjeta en plataforma"
  setControlLabelVisible("tipo_cuenta", false)
  setControlLabelVisible("destination_type", !hidesBankFields)
  setControlLabelVisible("banco", !hidesBankFields && Boolean(destinationType))
  setControlLabelVisible("clabe", !hidesBankFields && destinationType === "clabe")
  setControlLabelVisible("cuenta_bancaria", !hidesBankFields && destinationType === "cuenta")
  setControlLabelVisible("convenio_number", !hidesBankFields && destinationType === "convenio")
}

function inferDestinationType() {
  const tipoCuenta = getValue("tipo_cuenta")
  if (tipoCuenta === "Cuenta") return "cuenta"
  if (getValue("cuenta_bancaria") && !getValue("clabe")) return "cuenta"
  if (getValue("convenio_number")) return "convenio"
  return "clabe"
}

async function saveSupplier(event) {
  event.preventDefault()
  if (providerSaveInProgress) return

  const operation = currentEditingId ? "update" : "insert"
  providerSaveInProgress = true
  const submitButton = form.querySelector('button[type="submit"]')
  const submitButtonLabel = submitButton?.textContent || "Guardar proveedor"
  if (submitButton) {
    submitButton.disabled = true
    submitButton.textContent = "Guardando..."
  }

  try {
    await persistSupplier(operation)
  } catch (error) {
    showSupplierSaveError(error, { stage: "unexpected", operation })
  } finally {
    providerSaveInProgress = false
    if (submitButton) {
      submitButton.disabled = false
      submitButton.textContent = submitButtonLabel
    }
  }
}

async function persistSupplier(operation) {
  const csfFile = providerCsfUpload?.getFile?.() || null
  const canUploadCsf = currentEditingId ? canManageProviderCsf() : canCreateProviderCsf()

  if (csfFile && !canUploadCsf) {
    showToast("Sin permiso", "Tu usuario no tiene permiso para cargar CSF de proveedores.", "error")
    return
  }

  const payload = {
    alias: getValue("alias"),
    nombre_completo: getValue("nombre_completo"),
    metodo_pago: getValue("metodo_pago"),
    tipo_cuenta: getValue("tipo_cuenta"),
    destination_type: getValue("destination_type") || inferDestinationType(),
    beneficiary_name: getValue("beneficiary_name"),
    banco: getValue("banco"),
    clabe: getValue("clabe"),
    cuenta_bancaria: getValue("cuenta_bancaria"),
    convenio_number: getValue("convenio_number"),
    rfc: getValue("rfc"),
    persona_tipo: getValue("persona_tipo"),
    email: getValue("email"),
    telefono: getValue("telefono"),
    tipo_proveedor: getValue("tipo_proveedor"),
    notas: getValue("notas"),
    es_personal_eventual: document.getElementById("es_personal_eventual").checked,
    activo: document.getElementById("activo").checked,
    updated_at: new Date().toISOString(),
  }

  if (!payload.alias || !payload.nombre_completo || !payload.metodo_pago) {
    showToast("Datos incompletos", "Alias, nombre completo y metodo de pago son obligatorios.", "error")
    return
  }

  if (payload.metodo_pago === "Efectivo" || payload.metodo_pago === "Tarjeta en plataforma") {
    payload.tipo_cuenta = null
    payload.destination_type = null
    payload.banco = null
    payload.clabe = null
    payload.cuenta_bancaria = null
    payload.convenio_number = null
  }

  const destinationValidation = validateDestination(payload)
  if (destinationValidation) { showToast("Datos incompletos", destinationValidation, "error"); return }

  if (payload.destination_type === "clabe") payload.tipo_cuenta = "CLABE"
  if (payload.destination_type === "cuenta") payload.tipo_cuenta = "Cuenta"
  if (payload.destination_type === "convenio") payload.tipo_cuenta = null

  if (isPreviewEnvironment()) {
    showToast("Este entorno es una vista previa. Los cambios no se guardan.", "", "error")
    return
  }

  const result = await supabaseClient.rpc("save_provider_catalog_with_payment_execution_data", {
    p_proveedor_id: currentEditingId || null,
    p_payload: payload,
  })

  if (result.error) {
    showSupplierSaveError(result.error, { stage: "persist", operation })
    return
  }

  const providerId = result.data?.id
  if (!providerId) {
    showSupplierSaveError(
      { code: "provider_rpc_response_invalid", message: "provider_rpc_response_invalid" },
      { stage: "persist", operation },
    )
    return
  }

  let csfUploadFailed = false

  if (csfFile && providerId) {
    try {
      const storagePath = await window.FluxUpload.uploadReceipt(csfFile, `csf/${providerId}`)
      const { error: csfError } = await supabaseClient
        .from("proveedores")
        .update({
          csf_file_path: storagePath,
          csf_uploaded_at: new Date().toISOString(),
          csf_uploaded_by: currentProfileId,
        })
        .eq("id", providerId)
      if (csfError) throw csfError
    } catch (error) {
      csfUploadFailed = true
      logSupplierSaveDiagnostic(error, { stage: "csf_upload", operation })
    }
  }

  if (intakeProposalReturn && intakeProposalId && providerId && !csfUploadFailed) {
    const params = new URLSearchParams({ intake_id: intakeProposalId, provider_candidate_id: providerId })
    window.location.assign(`./provider_intakes.html?${params.toString()}`)
    return
  }

  form.reset()
  resetCsfControls()
  currentEditingId = null
  currentCsfPath = null
  if (dialog.open) dialog.close()
  await loadSuppliers()
  if (csfUploadFailed) {
    showToast("CSF no vinculado", "Proveedor guardado, pero la CSF no pudo subirse.", "warning")
  } else {
    showToast("Proveedor guardado correctamente.", "", "success")
  }
}

function isPreviewEnvironment() {
  return String(window.FLUX_CONFIG?.env || "").trim().toLowerCase() === "preview"
}

const PROVIDER_SAVE_ERROR_MESSAGES = Object.freeze({
  finance_role_required: "Los datos bancarios del proveedor solo pueden ser guardados por Finanzas.",
  provider_payment_execution_data_invalid: "Revisa los datos bancarios del proveedor.",
  provider_create_role_required: "No tienes permiso para crear proveedores.",
  provider_update_role_required: "No tienes permiso para actualizar proveedores.",
  provider_payload_contains_unsupported_fields: "El formulario contiene campos no admitidos. Actualiza la pagina e intentalo nuevamente.",
  provider_rpc_response_invalid: "El proveedor se guardo sin una confirmacion valida. Actualiza el catalogo antes de reintentar.",
})

function providerSaveErrorCode(error) {
  const candidates = [error?.message, error?.details, error?.hint, error?.code]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
  const knownCode = Object.keys(PROVIDER_SAVE_ERROR_MESSAGES)
    .find((code) => candidates.some((candidate) => candidate.includes(code)))
  if (knownCode) return knownCode

  const transportCode = candidates.find((candidate) =>
    /^pgrst\d{3}$/.test(candidate) || /^[0-9a-z]{5}$/.test(candidate),
  )
  return transportCode || "unclassified_save_error"
}

function logSupplierSaveDiagnostic(error, { stage, operation }) {
  const code = providerSaveErrorCode(error)
  const statusCandidate = Number(error?.statusCode || error?.status)
  const diagnostic = { stage, operation, code }
  if (Number.isInteger(statusCandidate) && statusCandidate >= 100 && statusCandidate <= 599) {
    diagnostic.status = statusCandidate
  }
  console.warn("[Flux] Provider save failed", diagnostic)
}

function showSupplierSaveError(error, { stage, operation }) {
  const code = providerSaveErrorCode(error)
  logSupplierSaveDiagnostic(error, { stage, operation })

  const message = isPreviewEnvironment()
    ? "Este entorno es una vista previa. Los cambios no se guardan."
    : PROVIDER_SAVE_ERROR_MESSAGES[code]
      || "No fue posible guardar el proveedor. Verifica la informacion e intentalo nuevamente."
  showToast(message, "", "error")
}

function validateDestination(payload) {
  if (payload.metodo_pago === "Efectivo" || payload.metodo_pago === "Tarjeta en plataforma") return ""
  if (!payload.destination_type) return "Selecciona el tipo de destino de pago: CLABE, cuenta bancaria o convenio."
  if (payload.metodo_pago === "Transferencia bancaria" && !payload.banco) return "Para transferencia bancaria captura el banco o institucion."
  if (payload.destination_type === "clabe" && !payload.clabe) return "Para destino CLABE captura la CLABE del proveedor."
  if (payload.destination_type === "cuenta" && !payload.cuenta_bancaria) return "Para destino cuenta bancaria captura la cuenta del proveedor."
  if (payload.destination_type === "convenio" && !payload.convenio_number) return "Para destino convenio captura el numero de convenio."
  return ""
}

window.toggleSupplier = async function(id, activo) {
  if (!canManageProviders()) {
    showToast("Sin permiso", "La administracion de proveedores corresponde a Finanzas, Direccion o Sysadmin.", "warning")
    return
  }
  const confirmed = confirm(activo ? "Seguro que deseas reactivar este proveedor?" : "Seguro que deseas desactivar este proveedor?")
  if (!confirmed) return
  const { error } = await supabaseClient.from("proveedores").update({ activo, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) {
    logSupplierSaveDiagnostic(error, { stage: "status_update", operation: "update" })
    showToast("No fue posible actualizar el proveedor. Inténtalo nuevamente.", "", "error")
    return
  }
  await loadSuppliers()
  showToast(activo ? "Proveedor reactivado" : "Proveedor desactivado", "", "success")
}

async function logout() {
  await supabaseClient.auth.signOut()
  window.location.href = "./index.html"
}

function closeModal() {
  if (dialog.open) dialog.close()
  currentEditingId = null
  currentCsfPath = null
  resetCsfControls()
  document.getElementById("intakeProposal").hidden = true
}

function resetCsfControls() {
  providerCsfUpload?.reset?.()
  const link = document.getElementById("providerCsfLink")
  if (link) {
    link.classList.add("hidden")
    link.removeAttribute("data-path")
  }
  const hint = document.getElementById("providerCsfHint")
  if (hint) {
    hint.textContent = hint.dataset.default || "CSF en PDF (max 10 MB)"
    hint.style.color = ""
  }
}

function updateCsfPermissionState() {
  const input = document.getElementById("providerCsfFile")
  if (!input) return
  const allowed = currentEditingId ? canManageProviderCsf() : canCreateProviderCsf()
  input.disabled = !allowed
  input.classList.toggle("field-disabled", !allowed)
  const hint = document.getElementById("providerCsfHint")
  if (hint) {
    hint.textContent = allowed
      ? hint.dataset.default || "CSF en PDF (max 10 MB)"
      : hint.dataset.restricted || "La Constancia de Situacion Fiscal sera administrada por Finanzas."
    hint.style.color = allowed ? "" : "var(--text-3)"
  }
}

function renderCsfLink() {
  const link = document.getElementById("providerCsfLink")
  if (!link) return
  if (!currentCsfPath) {
    link.classList.add("hidden")
    link.removeAttribute("data-path")
    return
  }
  link.dataset.path = currentCsfPath
  link.classList.remove("hidden")
}

async function openCurrentCsf() {
  if (!currentCsfPath) return
  try {
    const url = await window.FluxUpload?.getReceiptUrl?.(currentCsfPath)
    if (!url) throw new Error("signed_url_unavailable")
    window.open(url, "_blank", "noopener,noreferrer")
  } catch (error) {
    showToast("CSF no disponible", "No se pudo generar el link temporal de la CSF.", "error")
  }
}

function canCreateProviderCsf() {
  return canManageProviders()
}

function canManageProviderCsf() {
  return canManageProviders()
}

function canManageProviders() {
  return Boolean(window.FluxAuth?.canManageProviders?.())
}

// ── Utilidades ────────────────────────────────────────────────

function getValue(id) {
  const element = document.getElementById(id)
  return element ? element.value.trim() || null : null
}

function setValue(id, value) {
  const element = document.getElementById(id)
  if (element) element.value = value || ""
}

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

function escapeHtml(value) {
  return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;")
}

function showToast(title, message, type = "success") {
  const variantMap = { success: "success", error: "danger", warning: "warning", info: "info" }
  Components.showToast({ title: escapeHtml(title), desc: escapeHtml(message), variant: variantMap[type] ?? "info", duration: 6 })
  const stack = document.getElementById("toastStack")
  const toast = stack?.lastElementChild
  if (!toast) return

  const assertive = type === "error" || type === "warning"
  toast.setAttribute("role", assertive ? "alert" : "status")
  toast.setAttribute("aria-live", assertive ? "assertive" : "polite")
  toast.setAttribute("aria-atomic", "true")
  toast.setAttribute("aria-label", [title, message].filter(Boolean).join(". "))

  const closeButton = toast.querySelector(".toast-v2-close")
  if (closeButton) {
    closeButton.type = "button"
    closeButton.setAttribute("aria-label", `Cerrar notificación: ${title}`)
  }
}
