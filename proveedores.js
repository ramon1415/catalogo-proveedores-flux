const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let proveedores = []
let currentEditingId = null

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

  searchInput.addEventListener("input", renderTable)
  statusFilter.addEventListener("change", renderTable)
  form.addEventListener("submit", saveSupplier)

  await loadSuppliers()
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
    "cuenta_bancaria", "convenio_number", "rfc", "email", "telefono",
    "es_personal_eventual", "activo", "notas",
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
    showToast("Error al cargar", error.message, "error")
    return
  }

  proveedores = data || []

  renderTable()
}


function renderTable() {
  const query = normalize(searchInput.value)
  const filter = statusFilter.value

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
        <div class="actions row-actions">
          <button class="small-btn" type="button" onclick="openEditModal('${escapeHtml(p.id)}')">Editar</button>
          ${p.activo
            ? `<button class="small-btn danger" type="button" onclick="toggleSupplier('${escapeHtml(p.id)}', false)">Desactivar</button>`
            : `<button class="small-btn" type="button" onclick="toggleSupplier('${escapeHtml(p.id)}', true)">Reactivar</button>`}
        </div>
      </td>
    </tr>
  `).join("")
}

// ── Modal proveedor ───────────────────────────────────────────

function openCreateModal() {
  currentEditingId = null
  document.getElementById("modalTitle").textContent = "Nuevo proveedor"
  form.reset()
  document.getElementById("activo").checked = true
  handlePaymentMethodChange()
  dialog.showModal()
}

window.openEditModal = function(id) {
  const p = proveedores.find((item) => item.id === id)
  if (!p) return
  currentEditingId = id
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
  setValue("email", p.email)
  setValue("telefono", p.telefono)
  setValue("tipo_proveedor", p.tipo_proveedor)
  setValue("notas", p.notas)
  document.getElementById("es_personal_eventual").checked = Boolean(p.es_personal_eventual)
  document.getElementById("activo").checked = Boolean(p.activo)
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

  const result = currentEditingId
    ? await supabaseClient.from("proveedores").update(payload).eq("id", currentEditingId)
    : await supabaseClient.from("proveedores").insert(payload)

  if (result.error) {
    const msg = result.error.message?.toLowerCase().includes("row-level security") || result.error.code === "42501"
      ? "No se pudo guardar. Puede faltar permiso update sobre proveedores."
      : `Error guardando proveedor: ${result.error.message}`
    showToast("Error al guardar", msg, "error")
    return
  }

  form.reset()
  currentEditingId = null
  if (dialog.open) dialog.close()
  await loadSuppliers()
  showToast("Proveedor guardado", "Los datos se guardaron correctamente.", "success")
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
  const confirmed = confirm(activo ? "Seguro que deseas reactivar este proveedor?" : "Seguro que deseas desactivar este proveedor?")
  if (!confirmed) return
  const { error } = await supabaseClient.from("proveedores").update({ activo, updated_at: new Date().toISOString() }).eq("id", id)
  if (error) { showToast("Error al actualizar", error.message, "error"); return }
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
}
