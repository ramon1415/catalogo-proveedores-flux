const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let proveedores = []
let currentEditingId = null

const rootElement = document.documentElement
const toggle = document.getElementById("themeToggle")
const tableBody = document.getElementById("suppliersTableBody")
const searchInput = document.getElementById("searchInput")
const statusFilter = document.getElementById("statusFilter")
const messageBox = document.getElementById("messageBox")
const dialog = document.getElementById("supplierDialog")
const form = document.getElementById("supplierForm")

init()

async function init() {
  setupTheme()

  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  if (!session) {
    window.location.href = "./index.html"
    return
  }

  document.getElementById("userEmail").textContent =
    session.user.email || "Sesión activa"

  document.getElementById("userName").textContent =
    session.user.user_metadata?.full_name || "Usuario"

  document.getElementById("logoutBtn").addEventListener("click", logout)
  document.getElementById("newSupplierBtn").addEventListener("click", openCreateModal)
  document.getElementById("closeModalBtn").addEventListener("click", closeModal)
  document.getElementById("cancelBtn").addEventListener("click", closeModal)
  document.getElementById("metodo_pago").addEventListener("change", handlePaymentMethodChange)

  searchInput.addEventListener("input", renderTable)
  statusFilter.addEventListener("change", renderTable)
  form.addEventListener("submit", saveSupplier)

  await loadSuppliers()
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme")

  if (saved) {
    rootElement.setAttribute("data-theme", saved)
  }

  if (toggle) {
    toggle.addEventListener("click", () => {
      const next =
        rootElement.getAttribute("data-theme") === "dark" ? "light" : "dark"

      rootElement.setAttribute("data-theme", next)
      localStorage.setItem("flux-theme", next)
    })
  }
}

async function loadSuppliers() {
  showMessage("Cargando proveedores...")

  const { data, error } = await supabaseClient
    .from("proveedores")
    .select("*")
    .order("alias", { ascending: true })

  if (error) {
    const errorMessage = `Error al cargar proveedores: ${error.message}`

    showMessage(errorMessage, true)
    showToast(errorMessage, "error")

    tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="message">
          No fue posible cargar proveedores.
        </td>
      </tr>
    `

    return
  }

  proveedores = data || []

  hideMessage()
  renderStats()
  renderTable()
}

function renderStats() {
  document.getElementById("totalCount").textContent = proveedores.length

  document.getElementById("activeCount").textContent = proveedores.filter(
    (p) => p.activo
  ).length

  document.getElementById("inactiveCount").textContent = proveedores.filter(
    (p) => !p.activo
  ).length

  document.getElementById("transferCount").textContent = proveedores.filter((p) =>
    normalize(p.metodo_pago).includes("transferencia")
  ).length
}

function renderTable() {
  const query = normalize(searchInput.value)
  const filter = statusFilter.value

  const rows = proveedores.filter((p) => {
    const searchable = normalize(
      [
        p.alias,
        p.nombre_completo,
        p.rfc,
        p.banco,
        p.email,
        p.telefono,
        p.metodo_pago,
      ].join(" ")
    )

    const matchesSearch = searchable.includes(query)

    const matchesStatus =
      filter === "todos" ||
      (filter === "activos" && p.activo) ||
      (filter === "inactivos" && !p.activo)

    return matchesSearch && matchesStatus
  })

  if (!rows.length) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="9" class="message">
          No se encontraron proveedores.
        </td>
      </tr>
    `
    return
  }

  tableBody.innerHTML = rows
    .map(
      (p) => `
      <tr>
        <td>
          <strong>${escapeHtml(p.alias || "")}</strong>
        </td>

        <td>
          ${escapeHtml(p.nombre_completo || "")}
          ${
            p.es_personal_eventual
              ? `&nbsp;<span class="badge badge-inactive">Personal eventual</span>`
              : ""
          }
        </td>

        <td>${escapeHtml(p.metodo_pago || "")}</td>

        <td>${escapeHtml(p.banco || "")}</td>

        <td>
          ${
            p.clabe || p.cuenta_bancaria
              ? `<span class="clabe-num">${escapeHtml(
                  p.clabe || p.cuenta_bancaria || ""
                )}</span>`
              : ""
          }
          ${
            p.tipo_cuenta
              ? `<span class="clabe-label">${escapeHtml(p.tipo_cuenta)}</span>`
              : ""
          }
        </td>

        <td>${escapeHtml(p.rfc || "")}</td>

        <td>
          ${escapeHtml(p.email || "")}
          ${
            p.telefono
              ? `<br><span class="clabe-label">${escapeHtml(p.telefono)}</span>`
              : ""
          }
        </td>

        <td>
          <span class="badge ${p.activo ? "badge-active" : "badge-inactive"}">
            ${p.activo ? "Activo" : "Inactivo"}
          </span>
        </td>

        <td>
          <div class="actions">
            <button class="small-btn" onclick="openEditModal('${p.id}')">
              Editar
            </button>

            ${
              p.activo
                ? `<button class="small-btn danger" onclick="toggleSupplier('${p.id}', false)">
                    Desactivar
                  </button>`
                : `<button class="small-btn" onclick="toggleSupplier('${p.id}', true)">
                    Reactivar
                  </button>`
            }
          </div>
        </td>
      </tr>
    `
    )
    .join("")
}

function openCreateModal() {
  currentEditingId = null

  document.getElementById("modalTitle").textContent = "Nuevo proveedor"

  form.reset()

  document.getElementById("activo").checked = true

  handlePaymentMethodChange()

  dialog.showModal()
}

window.openEditModal = function (id) {
  const p = proveedores.find((item) => item.id === id)

  if (!p) return

  currentEditingId = id

  document.getElementById("modalTitle").textContent = "Editar proveedor"

  setValue("supplierId", p.id)
  setValue("alias", p.alias)
  setValue("nombre_completo", p.nombre_completo)
  setValue("metodo_pago", p.metodo_pago)
  setValue("tipo_cuenta", p.tipo_cuenta)
  setValue("banco", p.banco)
  setValue("clabe", p.clabe)
  setValue("cuenta_bancaria", p.cuenta_bancaria)
  setValue("rfc", p.rfc)
  setValue("email", p.email)
  setValue("telefono", p.telefono)
  setValue("tipo_proveedor", p.tipo_proveedor)
  setValue("notas", p.notas)

  document.getElementById("es_personal_eventual").checked = Boolean(
    p.es_personal_eventual
  )

  document.getElementById("activo").checked = Boolean(p.activo)

  handlePaymentMethodChange()

  dialog.showModal()
}

function handlePaymentMethodChange() {
  const metodoPago = document.getElementById("metodo_pago").value

  const tipoCuenta = document.getElementById("tipo_cuenta")
  const banco = document.getElementById("banco")
  const clabe = document.getElementById("clabe")
  const cuentaBancaria = document.getElementById("cuenta_bancaria")

  const camposBancarios = [tipoCuenta, banco, clabe, cuentaBancaria]

  if (metodoPago === "Efectivo" || metodoPago === "Tarjeta en plataforma") {
    tipoCuenta.value = ""
    banco.value = ""
    clabe.value = ""
    cuentaBancaria.value = ""

    camposBancarios.forEach((campo) => {
      campo.disabled = true
      campo.classList.add("field-disabled")
    })

    return
  }

  camposBancarios.forEach((campo) => {
    campo.disabled = false
    campo.classList.remove("field-disabled")
  })

  if (metodoPago === "Transferencia bancaria" && !tipoCuenta.value) {
    tipoCuenta.value = "CLABE"
  }
}

async function saveSupplier(event) {
  event.preventDefault()

  const payload = {
    alias: getValue("alias"),
    nombre_completo: getValue("nombre_completo"),
    metodo_pago: getValue("metodo_pago"),
    tipo_cuenta: getValue("tipo_cuenta"),
    banco: getValue("banco"),
    clabe: getValue("clabe"),
    cuenta_bancaria: getValue("cuenta_bancaria"),
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
    const validationMessage =
      "Alias, nombre completo y método de pago son obligatorios."

    showMessage(validationMessage, true)
    showToast(validationMessage, "error")
    return
  }

  if (
    payload.metodo_pago === "Efectivo" ||
    payload.metodo_pago === "Tarjeta en plataforma"
  ) {
    payload.tipo_cuenta = null
    payload.banco = null
    payload.clabe = null
    payload.cuenta_bancaria = null
  }

  if (
    payload.metodo_pago === "Transferencia bancaria" &&
    (!payload.tipo_cuenta ||
      !payload.banco ||
      (!payload.clabe && !payload.cuenta_bancaria))
  ) {
    const validationMessage =
      "Para transferencia bancaria captura tipo de cuenta, banco y CLABE o cuenta bancaria."

    showMessage(validationMessage, true)
    showToast(validationMessage, "error")
    return
  }

  let result

  if (currentEditingId) {
    result = await supabaseClient
      .from("proveedores")
      .update(payload)
      .eq("id", currentEditingId)
  } else {
    result = await supabaseClient.from("proveedores").insert(payload)
  }

  if (result.error) {
    const errorMessage = `Error guardando proveedor: ${result.error.message}`

    showMessage(errorMessage, true)
    showToast(errorMessage, "error")
    return
  }

  form.reset()
  currentEditingId = null

  if (dialog.open) {
    dialog.close()
  }

  await loadSuppliers()

  showToast("Proveedor guardado correctamente.")
}

window.toggleSupplier = async function (id, activo) {
  const action = activo ? "reactivar" : "desactivar"

  const confirmed = confirm(`¿Seguro que deseas ${action} este proveedor?`)

  if (!confirmed) return

  const { error } = await supabaseClient
    .from("proveedores")
    .update({
      activo,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    const errorMessage = `Error al actualizar proveedor: ${error.message}`

    showMessage(errorMessage, true)
    showToast(errorMessage, "error")
    return
  }

  await loadSuppliers()

  showToast(`Proveedor ${activo ? "reactivado" : "desactivado"} correctamente.`)
}

async function logout() {
  await supabaseClient.auth.signOut()
  window.location.href = "./index.html"
}

function closeModal() {
  if (dialog.open) {
    dialog.close()
  }

  currentEditingId = null
}

function getValue(id) {
  const element = document.getElementById(id)

  if (!element) return null

  return element.value.trim() || null
}

function setValue(id, value) {
  const element = document.getElementById(id)

  if (element) {
    element.value = value || ""
  }
}

function showMessage(message, isError = false) {
  messageBox.textContent = message
  messageBox.classList.remove("hidden")
  messageBox.style.color = isError ? "var(--ruby)" : "var(--text-3)"
}

function hideMessage() {
  messageBox.classList.add("hidden")
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function showToast(message, type = "success") {
  const existingToast = document.getElementById("toastMessage")

  if (existingToast) {
    existingToast.remove()
  }

  const toast = document.createElement("div")

  toast.id = "toastMessage"
  toast.textContent = message

  toast.style.position = "fixed"
  toast.style.top = "22px"
  toast.style.right = "22px"
  toast.style.zIndex = "99999"
  toast.style.padding = "13px 16px"
  toast.style.borderRadius = "10px"
  toast.style.fontWeight = "700"
  toast.style.fontSize = "13px"
  toast.style.boxShadow = "0 16px 40px rgba(0,0,0,0.35)"
  toast.style.border = "1px solid rgba(255,255,255,0.12)"
  toast.style.backdropFilter = "blur(16px)"
  toast.style.transition = "opacity 200ms ease, transform 200ms ease"

  if (type === "success") {
    toast.style.background = "rgba(15, 118, 110, 0.95)"
    toast.style.color = "#ffffff"
  } else {
    toast.style.background = "rgba(224, 62, 82, 0.95)"
    toast.style.color = "#ffffff"
  }

  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = "0"
    toast.style.transform = "translateY(-8px)"
  }, 2200)

  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove()
    }
  }, 2600)
}
