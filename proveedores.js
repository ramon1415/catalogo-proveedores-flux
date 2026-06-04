const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let proveedores = []
let currentEditingId = null
let originAccounts = []
let originCompanies = []
let editingOriginAccountId = null

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

  setupOriginAccountsAdmin()
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

// ── Tabs Proveedores / Cuentas origen ─────────────────────────

function setupOriginAccountsAdmin() {
  if (document.getElementById("originAccountsPanel")) return

  const page = document.querySelector(".page")
  const pageHeader = document.querySelector(".page-header")
  const suppliersTable = document.querySelector(".table-card")
  const newSupplierButton = document.getElementById("newSupplierBtn")

  if (!page || !pageHeader || !suppliersTable) return

  installOriginAccountsStyles()

  const tabs = document.createElement("div")
  tabs.className = "provider-tabs"
  tabs.innerHTML = `
    <button type="button" class="provider-tab active" data-panel="suppliers">Proveedores</button>
    <button type="button" class="provider-tab" data-panel="originAccounts">Cuentas origen</button>
  `
  pageHeader.insertAdjacentElement("afterend", tabs)

  const suppliersPanel = document.createElement("section")
  suppliersPanel.id = "suppliersPanel"
  suppliersPanel.className = "provider-panel active"
  page.insertBefore(suppliersPanel, suppliersTable)
  suppliersPanel.appendChild(suppliersTable)

  const originPanel = document.createElement("section")
  originPanel.id = "originAccountsPanel"
  originPanel.className = "provider-panel hidden"
  originPanel.innerHTML = `
    <div class="notice-v2 info" style="margin-bottom:12px">
      <span class="notice-icon">·</span>
      <span class="notice-text">
        <span class="notice-title">Cuentas origen</span>
        <span class="notice-sep">—</span>
        <span class="notice-desc">Son las cuentas de la empresa desde las que se realiza el pago. No son cuentas del proveedor.</span>
      </span>
    </div>
    <section class="table-card">
      <div class="origin-toolbar">
        <div>
          <h2>Cuentas origen</h2>
          <p>Estas cuentas alimentan solicitudes y layouts de pago.</p>
        </div>
        <button type="button" id="newOriginAccountBtn" class="primary-btn">+ Nueva cuenta origen</button>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Nombre de cuenta</th>
              <th>Banco</th>
              <th>Numero de cuenta</th>
              <th>CLABE</th>
              <th>Moneda</th>
              <th>Activa</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="originAccountsTableBody">
            <tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">Cargando cuentas origen...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `
  suppliersPanel.insertAdjacentElement("afterend", originPanel)

  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="originAccountDialog">
      <form id="originAccountForm" class="modal-content">
        <div class="modal-header">
          <div>
            <h2 id="originAccountModalTitle">Nueva cuenta origen</h2>
            <p>Completa la cuenta de la empresa desde la que se realizaran pagos.</p>
          </div>
          <button type="button" id="closeOriginAccountModalBtn" class="icon-btn">✕</button>
        </div>
        <div class="modal-scroll">
          <input type="hidden" id="originAccountId">
          <div class="form-grid">
            <label class="full-row">Empresa *<select id="originCompanyId" required></select></label>
            <label>Nombre de cuenta *<input id="originAccountName" required placeholder="Ej. BBVA Operadora"></label>
            <label>Banco *<input id="originBankName" required placeholder="BBVA, Santander, Banorte..."></label>
            <label>Numero de cuenta *<input id="originAccountNumber" required placeholder="Cuenta cargo"></label>
            <label>CLABE<input id="originClabe" maxlength="18" placeholder="18 digitos"></label>
            <label>Moneda *<select id="originCurrency" required><option value="MXN">MXN</option><option value="USD">USD</option></select></label>
            <label>Tipo de cuenta
              <select id="originAccountType">
                <option value="">Sin clasificar</option>
                <option value="bank">Cuenta bancaria</option>
                <option value="cash">Caja / efectivo</option>
                <option value="card_processor">Procesador de tarjeta</option>
                <option value="other">Otra</option>
              </select>
            </label>
            <label class="check-label"><input id="originAccountActive" type="checkbox" checked> Cuenta activa</label>
            <label class="full-row">Notas<textarea id="originNotes" rows="3" placeholder="Uso operativo, propiedad, restricciones..."></textarea></label>
          </div>
          <div id="originAccountFormMessage" class="notice-v2 danger hidden" style="margin-top:10px">
            <span class="notice-icon">✕</span>
            <span class="notice-text" id="originAccountFormMessageText"></span>
          </div>
        </div>
        <div class="modal-actions">
          <button type="button" id="cancelOriginAccountBtn" class="secondary-btn">Cancelar</button>
          <button type="submit" class="primary-btn">Guardar cuenta origen</button>
        </div>
      </form>
    </dialog>
  `)

  const activateProviderPanel = (panel) => {
    document.querySelectorAll(".provider-tab").forEach((item) => {
      item.classList.toggle("active", item.dataset.panel === panel)
    })
    suppliersPanel.classList.toggle("hidden", panel !== "suppliers")
    originPanel.classList.toggle("hidden", panel !== "originAccounts")
    if (newSupplierButton) newSupplierButton.classList.toggle("hidden", panel !== "suppliers")
    if (panel === "originAccounts") loadOriginAccountsAdmin()
  }

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".provider-tab")
    if (!button) return
    activateProviderPanel(button.dataset.panel)
  })

  document.getElementById("newOriginAccountBtn")?.addEventListener("click", openOriginAccountCreate)
  document.getElementById("closeOriginAccountModalBtn")?.addEventListener("click", closeOriginAccountModal)
  document.getElementById("cancelOriginAccountBtn")?.addEventListener("click", closeOriginAccountModal)
  document.getElementById("originAccountForm")?.addEventListener("submit", saveOriginAccount)
  document.getElementById("originAccountsTableBody")?.addEventListener("click", handleOriginAccountAction)

  const requestedTab = new URLSearchParams(window.location.search).get("tab")
  if (requestedTab === "cuentas-origen" || requestedTab === "originAccounts") {
    activateProviderPanel("originAccounts")
  }
}

async function loadOriginAccountsAdmin() {
  const tbody = document.getElementById("originAccountsTableBody")
  if (!tbody) return

  tbody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">Cargando cuentas origen...</td></tr>`

  const [companiesResult, accountsResult] = await Promise.all([
    supabaseClient.from("companies").select("id,name,legal_name,active").order("name", { ascending: true }),
    supabaseClient.from("company_bank_accounts").select("id,company_id,name,bank_name,currency,account_type,last4,active,notes,account_number,clabe").order("name", { ascending: true }),
  ])

  if (companiesResult.error || accountsResult.error) {
    const error = companiesResult.error || accountsResult.error
    const text = originRlsMessage(error, "select")
    tbody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--ruby)">${escapeHtml(text)}</td></tr>`
    return
  }

  originCompanies = (companiesResult.data || []).filter((c) => c.active !== false)
  originAccounts = accountsResult.data || []
  populateOriginCompanyOptions()
  renderOriginAccountsTable()
}

function renderOriginAccountsTable() {
  const tbody = document.getElementById("originAccountsTableBody")
  if (!tbody) return

  if (!originAccounts.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:44px;text-align:center;color:var(--text-3)">No hay cuentas origen capturadas.</td></tr>`
    return
  }

  tbody.innerHTML = originAccounts.map((account) => {
    const company = originCompanies.find((item) => item.id === account.company_id)
    return `
      <tr>
        <td><strong>${escapeHtml(companyNameForOrigin(company))}</strong></td>
        <td>${escapeHtml(account.name || "")}</td>
        <td>${escapeHtml(account.bank_name || "")}</td>
        <td><span class="clabe-num">${escapeHtml(account.account_number || "")}</span></td>
        <td>${escapeHtml(account.clabe || "")}</td>
        <td>${escapeHtml(account.currency || "MXN")}</td>
        <td>${Components.badge(account.active === false ? "Inactiva" : "Activa", account.active === false ? "neutral" : "success")}</td>
        <td>
          <div class="actions row-actions">
            <button type="button" class="small-btn" data-origin-action="edit" data-id="${escapeHtml(account.id)}">Editar</button>
            ${account.active === false
              ? `<button type="button" class="small-btn" data-origin-action="toggle" data-active="true" data-id="${escapeHtml(account.id)}">Reactivar</button>`
              : `<button type="button" class="small-btn danger" data-origin-action="toggle" data-active="false" data-id="${escapeHtml(account.id)}">Inactivar</button>`}
          </div>
        </td>
      </tr>
    `
  }).join("")
}

function populateOriginCompanyOptions() {
  const select = document.getElementById("originCompanyId")
  if (!select) return
  select.innerHTML = '<option value="">Seleccionar empresa...</option>' +
    originCompanies.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(companyNameForOrigin(c))}</option>`).join("")
}

function openOriginAccountCreate() {
  editingOriginAccountId = null
  document.getElementById("originAccountForm")?.reset()
  populateOriginCompanyOptions()
  document.getElementById("originAccountModalTitle").textContent = "Nueva cuenta origen"
  setOriginValue("originCurrency", "MXN")
  document.getElementById("originAccountActive").checked = true
  hideOriginFormMessage()
  document.getElementById("originAccountDialog")?.showModal()
}

function openOriginAccountEdit(id) {
  const account = originAccounts.find((item) => item.id === id)
  if (!account) return
  editingOriginAccountId = id
  populateOriginCompanyOptions()
  document.getElementById("originAccountModalTitle").textContent = "Editar cuenta origen"
  setOriginValue("originAccountId", account.id)
  setOriginValue("originCompanyId", account.company_id)
  setOriginValue("originAccountName", account.name)
  setOriginValue("originBankName", account.bank_name)
  setOriginValue("originAccountNumber", account.account_number)
  setOriginValue("originClabe", account.clabe)
  setOriginValue("originCurrency", account.currency || "MXN")
  setOriginValue("originAccountType", account.account_type)
  setOriginValue("originNotes", account.notes)
  document.getElementById("originAccountActive").checked = account.active !== false
  hideOriginFormMessage()
  document.getElementById("originAccountDialog")?.showModal()
}

async function saveOriginAccount(event) {
  event.preventDefault()
  const payload = {
    company_id: getOriginValue("originCompanyId"),
    name: getOriginValue("originAccountName"),
    bank_name: getOriginValue("originBankName"),
    account_number: getOriginValue("originAccountNumber"),
    clabe: getOriginValue("originClabe"),
    currency: getOriginValue("originCurrency") || "MXN",
    account_type: getOriginValue("originAccountType"),
    notes: getOriginValue("originNotes"),
    active: document.getElementById("originAccountActive")?.checked !== false,
  }
  payload.last4 = payload.account_number ? payload.account_number.slice(-4) : null

  const validation = validateOriginAccount(payload)
  if (validation) { showOriginFormMessage(validation); return }
  hideOriginFormMessage()

  const result = editingOriginAccountId
    ? await supabaseClient.from("company_bank_accounts").update(payload).eq("id", editingOriginAccountId)
    : await supabaseClient.from("company_bank_accounts").insert(payload)

  if (result.error) { showOriginFormMessage(originRlsMessage(result.error, editingOriginAccountId ? "update" : "insert")); return }

  closeOriginAccountModal()
  showToast("Cuenta origen guardada", "Los datos se guardaron correctamente.", "success")
  await loadOriginAccountsAdmin()
}

function validateOriginAccount(payload) {
  if (!payload.company_id) return "Selecciona la empresa."
  if (!payload.name) return "Captura el nombre de la cuenta."
  if (!payload.bank_name) return "Captura el banco."
  if (!payload.account_number) return "Captura el numero de cuenta."
  if (!payload.currency) return "Selecciona la moneda."
  return ""
}

async function handleOriginAccountAction(event) {
  const button = event.target.closest("[data-origin-action]")
  if (!button) return
  const action = button.dataset.originAction
  const id = button.dataset.id
  if (action === "edit") { openOriginAccountEdit(id); return }
  if (action === "toggle") await toggleOriginAccount(id, button.dataset.active === "true")
}

async function toggleOriginAccount(id, active) {
  const confirmed = confirm(active ? "Seguro que deseas reactivar esta cuenta origen?" : "Seguro que deseas inactivar esta cuenta origen?")
  if (!confirmed) return
  const { error } = await supabaseClient.from("company_bank_accounts").update({ active }).eq("id", id)
  if (error) { showToast("Error al actualizar", originRlsMessage(error, "update"), "error"); return }
  showToast(active ? "Cuenta reactivada" : "Cuenta inactivada", "", "success")
  await loadOriginAccountsAdmin()
}

function closeOriginAccountModal() {
  document.getElementById("originAccountDialog")?.close()
  hideOriginFormMessage()
  editingOriginAccountId = null
}

function showOriginFormMessage(text) {
  const msg = document.getElementById("originAccountFormMessage")
  const msgText = document.getElementById("originAccountFormMessageText")
  if (!msg) return
  if (msgText) msgText.textContent = text
  msg.classList.remove("hidden")
}

function hideOriginFormMessage() {
  document.getElementById("originAccountFormMessage")?.classList.add("hidden")
}

function originRlsMessage(error, operation) {
  const message = error?.message || ""
  const code = error?.code || ""
  const isPermission = code === "42501" || message.toLowerCase().includes("row-level security") || message.toLowerCase().includes("permission")
  if (code === "23502") return `Falta un dato obligatorio: ${message}`
  if (code === "23505") return "Ya existe una cuenta origen con esos datos."
  if (message.includes("company_account_type")) return "Tipo de cuenta no permitido."
  if (!isPermission) return `Error en cuentas origen: ${message}`
  if (operation === "select") return "No se pudieron cargar las cuentas origen. Falta policy select sobre company_bank_accounts."
  if (operation === "insert") return "No se pudo crear la cuenta origen. Falta policy insert sobre company_bank_accounts."
  return "No se pudo actualizar la cuenta origen. Falta policy update sobre company_bank_accounts."
}

function companyNameForOrigin(company) {
  if (!company) return "Sin empresa"
  return company.legal_name || company.name || "Empresa sin nombre"
}

function getOriginValue(id) {
  const element = document.getElementById(id)
  return element ? element.value.trim() || null : null
}

function setOriginValue(id, value) {
  const element = document.getElementById(id)
  if (element) element.value = value || ""
}

function installOriginAccountsStyles() {
  if (document.getElementById("originAccountsStyle")) return
  const style = document.createElement("style")
  style.id = "originAccountsStyle"
  style.textContent = `
    .provider-tabs{display:inline-flex;gap:4px;width:fit-content;padding:4px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.018)}
    .provider-tab{min-height:32px;padding:7px 13px;border:0;border-radius:7px;background:transparent;color:var(--text-3);font-family:'Plus Jakarta Sans',sans-serif;font-size:12.5px;font-weight:700;cursor:pointer}
    .provider-tab.active{color:var(--accent-text);background:var(--accent-dim)}
    .provider-panel.hidden,.hidden{display:none!important}
    .origin-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 16px;border-bottom:1px solid var(--border)}
    .origin-toolbar h2{color:var(--text-1);font-size:14px;margin:0 0 2px}
    .origin-toolbar p{color:var(--text-3);font-size:12px;margin:0}
    @media(max-width:760px){.origin-toolbar{align-items:stretch;flex-direction:column}}
  `
  document.head.appendChild(style)
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
