const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

let proveedores = []
let currentEditingId = null
let originAccounts = []
let originCompanies = []
let editingOriginAccountId = null

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
  document.getElementById("destination_type")?.addEventListener("change", handleDestinationTypeChange)

  searchInput.addEventListener("input", renderTable)
  statusFilter.addEventListener("change", renderTable)
  form.addEventListener("submit", saveSupplier)

  setupOriginAccountsAdmin()

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

function setupOriginAccountsAdmin() {
  if (document.getElementById("originAccountsPanel")) return

  const page = document.querySelector(".page")
  const pageHeader = document.querySelector(".page-header")
  const statsGrid = document.querySelector(".stats-grid")
  const suppliersTable = document.querySelector(".table-card")
  const newSupplierButton = document.getElementById("newSupplierBtn")

  if (!page || !pageHeader || !statsGrid || !suppliersTable) return

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
  page.insertBefore(suppliersPanel, statsGrid)
  suppliersPanel.appendChild(statsGrid)
  suppliersPanel.appendChild(suppliersTable)

  const originPanel = document.createElement("section")
  originPanel.id = "originAccountsPanel"
  originPanel.className = "provider-panel hidden"
  originPanel.innerHTML = `
    <div class="origin-help-card">
      <strong>Cuentas origen</strong>
      <p>La cuenta origen es la cuenta de la empresa desde la que se realizara el pago. No es la cuenta del proveedor.</p>
    </div>
    <section class="table-card">
      <div class="origin-toolbar">
        <div>
          <h2>Cuentas origen</h2>
          <p>Estas cuentas alimentan solicitudes y layouts de pago.</p>
        </div>
        <button type="button" id="newOriginAccountBtn" class="primary-btn">+ Nueva cuenta origen</button>
      </div>
      <div id="originAccountsMessage" class="message hidden">Cargando cuentas origen...</div>
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
            <tr><td colspan="8" class="message">Cargando cuentas origen...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `
  suppliersPanel.insertAdjacentElement("afterend", originPanel)

  document.body.insertAdjacentHTML("beforeend", `
    <dialog id="originAccountDialog" class="modal">
      <form id="originAccountForm" method="dialog" class="modal-content">
        <div class="modal-header">
          <div>
            <h2 id="originAccountModalTitle">Nueva cuenta origen</h2>
            <p>Completa la cuenta de la empresa desde la que se realizaran pagos.</p>
          </div>
          <button type="button" id="closeOriginAccountModalBtn" class="icon-btn">x</button>
        </div>
        <input type="hidden" id="originAccountId">
        <div class="form-grid">
          <label class="full-row">Empresa *
            <select id="originCompanyId" required></select>
          </label>
          <label>Nombre de cuenta *
            <input id="originAccountName" required placeholder="Ej. BBVA Operadora">
          </label>
          <label>Banco *
            <input id="originBankName" required placeholder="BBVA, Santander, Banorte...">
          </label>
          <label>Numero de cuenta *
            <input id="originAccountNumber" required placeholder="Cuenta cargo">
          </label>
          <label>CLABE
            <input id="originClabe" maxlength="18" placeholder="18 digitos">
          </label>
          <label>Moneda *
            <select id="originCurrency" required>
              <option value="MXN">MXN</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label>Tipo de cuenta
            <select id="originAccountType">
              <option value="">Sin clasificar</option>
              <option value="checking">Cuenta de cheques</option>
              <option value="savings">Cuenta de ahorro</option>
              <option value="cash">Caja / efectivo</option>
              <option value="credit">Credito</option>
              <option value="debit">Debito</option>
              <option value="investment">Inversion</option>
              <option value="other">Otra</option>
            </select>
          </label>
          <label class="check-label"><input id="originAccountActive" type="checkbox" checked> Cuenta activa</label>
          <label class="full-row">Notas
            <textarea id="originNotes" rows="3" placeholder="Uso operativo, propiedad, restricciones..."></textarea>
          </label>
        </div>
        <div id="originAccountFormMessage" class="origin-form-message hidden"></div>
        <div class="modal-actions">
          <button type="button" id="cancelOriginAccountBtn" class="secondary-btn">Cancelar</button>
          <button type="submit" class="primary-btn">Guardar cuenta origen</button>
        </div>
      </form>
    </dialog>
  `)

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest(".provider-tab")
    if (!button) return

    const panel = button.dataset.panel
    document.querySelectorAll(".provider-tab").forEach((item) => {
      item.classList.toggle("active", item === button)
    })

    suppliersPanel.classList.toggle("hidden", panel !== "suppliers")
    originPanel.classList.toggle("hidden", panel !== "originAccounts")

    if (newSupplierButton) {
      newSupplierButton.classList.toggle("hidden", panel !== "suppliers")
    }

    if (panel === "originAccounts") {
      loadOriginAccountsAdmin()
    }
  })

  document
    .getElementById("newOriginAccountBtn")
    ?.addEventListener("click", openOriginAccountCreate)
  document
    .getElementById("closeOriginAccountModalBtn")
    ?.addEventListener("click", closeOriginAccountModal)
  document
    .getElementById("cancelOriginAccountBtn")
    ?.addEventListener("click", closeOriginAccountModal)
  document
    .getElementById("originAccountForm")
    ?.addEventListener("submit", saveOriginAccount)
  document
    .getElementById("originAccountsTableBody")
    ?.addEventListener("click", handleOriginAccountAction)
}

async function loadOriginAccountsAdmin() {
  const message = document.getElementById("originAccountsMessage")
  const tbody = document.getElementById("originAccountsTableBody")

  if (!tbody) return

  showOriginMessage("Cargando cuentas origen...")

  const [companiesResult, accountsResult] = await Promise.all([
    supabaseClient
      .from("companies")
      .select("id,name,legal_name,active")
      .order("name", { ascending: true }),
    supabaseClient
      .from("company_bank_accounts")
      .select("id,company_id,name,bank_name,currency,account_type,last4,active,notes,account_number,clabe")
      .order("name", { ascending: true }),
  ])

  if (companiesResult.error || accountsResult.error) {
    const error = companiesResult.error || accountsResult.error
    const text = originRlsMessage(error, "select")

    if (message) {
      message.textContent = text
      message.classList.remove("hidden")
      message.style.color = "var(--ruby)"
    }

    tbody.innerHTML = `<tr><td colspan="8" class="message">${escapeHtml(text)}</td></tr>`
    return
  }

  originCompanies = (companiesResult.data || []).filter(
    (company) => company.active !== false
  )
  originAccounts = accountsResult.data || []

  populateOriginCompanyOptions()
  hideOriginMessage()
  renderOriginAccountsTable()
}

function renderOriginAccountsTable() {
  const tbody = document.getElementById("originAccountsTableBody")

  if (!tbody) return

  if (!originAccounts.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="message">No hay cuentas origen capturadas.</td>
      </tr>
    `
    return
  }

  tbody.innerHTML = originAccounts
    .map((account) => {
      const company = originCompanies.find((item) => item.id === account.company_id)

      return `
        <tr>
          <td><strong>${escapeHtml(companyNameForOrigin(company))}</strong></td>
          <td>${escapeHtml(account.name || "")}</td>
          <td>${escapeHtml(account.bank_name || "")}</td>
          <td><span class="clabe-num">${escapeHtml(account.account_number || "")}</span></td>
          <td>${escapeHtml(account.clabe || "")}</td>
          <td>${escapeHtml(account.currency || "MXN")}</td>
          <td>
            <span class="badge ${account.active === false ? "badge-inactive" : "badge-active"}">
              ${account.active === false ? "Inactiva" : "Activa"}
            </span>
          </td>
          <td>
            <div class="actions">
              <button type="button" class="small-btn" data-origin-action="edit" data-id="${escapeHtml(account.id)}">Editar</button>
              ${
                account.active === false
                  ? `<button type="button" class="small-btn" data-origin-action="toggle" data-active="true" data-id="${escapeHtml(account.id)}">Reactivar</button>`
                  : `<button type="button" class="small-btn danger" data-origin-action="toggle" data-active="false" data-id="${escapeHtml(account.id)}">Inactivar</button>`
              }
            </div>
          </td>
        </tr>
      `
    })
    .join("")
}

function populateOriginCompanyOptions() {
  const select = document.getElementById("originCompanyId")

  if (!select) return

  select.innerHTML =
    '<option value="">Seleccionar empresa...</option>' +
    originCompanies
      .map(
        (company) =>
          `<option value="${escapeHtml(company.id)}">${escapeHtml(
            companyNameForOrigin(company)
          )}</option>`
      )
      .join("")
}

function openOriginAccountCreate() {
  editingOriginAccountId = null

  const form = document.getElementById("originAccountForm")
  form?.reset()

  populateOriginCompanyOptions()

  document.getElementById("originAccountModalTitle").textContent =
    "Nueva cuenta origen"
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

  document.getElementById("originAccountModalTitle").textContent =
    "Editar cuenta origen"
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

  if (validation) {
    showOriginFormMessage(validation)
    return
  }
  hideOriginFormMessage()

  const result = editingOriginAccountId
    ? await supabaseClient
        .from("company_bank_accounts")
        .update(payload)
        .eq("id", editingOriginAccountId)
    : await supabaseClient.from("company_bank_accounts").insert(payload)

  if (result.error) {
    showOriginFormMessage(
      originRlsMessage(result.error, editingOriginAccountId ? "update" : "insert")
    )
    return
  }

  closeOriginAccountModal()
  showToast("Cuenta origen guardada correctamente.")
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

  if (action === "edit") {
    openOriginAccountEdit(id)
    return
  }

  if (action === "toggle") {
    const active = button.dataset.active === "true"
    await toggleOriginAccount(id, active)
  }
}

async function toggleOriginAccount(id, active) {
  const confirmed = confirm(
    active
      ? "Seguro que deseas reactivar esta cuenta origen?"
      : "Seguro que deseas inactivar esta cuenta origen?"
  )

  if (!confirmed) return

  const { error } = await supabaseClient
    .from("company_bank_accounts")
    .update({ active })
    .eq("id", id)

  if (error) {
    showToast(originRlsMessage(error, "update"), "error")
    return
  }

  showToast(active ? "Cuenta origen reactivada." : "Cuenta origen inactivada.")
  await loadOriginAccountsAdmin()
}

function closeOriginAccountModal() {
  document.getElementById("originAccountDialog")?.close()
  hideOriginFormMessage()
  editingOriginAccountId = null
}

function showOriginFormMessage(text) {
  const message = document.getElementById("originAccountFormMessage")

  if (!message) return

  message.textContent = text
  message.classList.remove("hidden")
}

function hideOriginFormMessage() {
  document.getElementById("originAccountFormMessage")?.classList.add("hidden")
}

function showOriginMessage(text) {
  const message = document.getElementById("originAccountsMessage")

  if (!message) return

  message.textContent = text
  message.classList.remove("hidden")
  message.style.color = "var(--text-3)"
}

function hideOriginMessage() {
  document.getElementById("originAccountsMessage")?.classList.add("hidden")
}

function originRlsMessage(error, operation) {
  const message = error?.message || ""
  const code = error?.code || ""
  const isPermissionError =
    code === "42501" ||
    message.toLowerCase().includes("row-level security") ||
    message.toLowerCase().includes("permission")

  if (code === "23502") {
    return `No se pudo guardar porque falta un dato obligatorio en la base: ${message}`
  }

  if (code === "23505") {
    return "No se pudo guardar porque ya existe una cuenta origen con esos datos."
  }

  if (message.includes("company_account_type")) {
    return "Tipo de cuenta no permitido. Selecciona una opcion del menu desplegable o deja el campo en Sin clasificar."
  }

  if (!isPermissionError) return `Error en cuentas origen: ${message}`

  if (operation === "select") {
    return "No se pudieron cargar las cuentas origen. Puede faltar policy select sobre company_bank_accounts."
  }

  if (operation === "insert") {
    return "No se pudo crear la cuenta origen. Puede faltar policy insert sobre company_bank_accounts."
  }

  return "No se pudo actualizar la cuenta origen. Puede faltar policy update sobre company_bank_accounts."
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

  if (element) {
    element.value = value || ""
  }
}

function installOriginAccountsStyles() {
  if (document.getElementById("originAccountsStyle")) return

  const style = document.createElement("style")
  style.id = "originAccountsStyle"
  style.textContent = `
    .provider-tabs {
      display: inline-flex;
      gap: 4px;
      width: fit-content;
      padding: 4px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(255,255,255,0.018);
    }
    .provider-tab {
      min-height: 32px;
      padding: 7px 13px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--text-3);
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12.5px;
      font-weight: 800;
      cursor: pointer;
    }
    .provider-tab.active {
      color: var(--accent-text);
      background: var(--accent-dim);
    }
    .provider-panel.hidden,
    .hidden {
      display: none !important;
    }
    .origin-help-card {
      margin-bottom: 12px;
      padding: 14px 16px;
      border: 1px solid rgba(15,118,110,0.22);
      border-radius: 13px;
      background: linear-gradient(180deg, rgba(15,118,110,0.12), rgba(255,255,255,0.014));
    }
    .origin-help-card strong {
      display: block;
      color: var(--accent-text);
      font-size: 13px;
      margin-bottom: 4px;
    }
    .origin-help-card p {
      margin: 0;
      color: var(--text-2);
      font-size: 12px;
    }
    .origin-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }
    .origin-toolbar h2 {
      color: var(--text-1);
      font-size: 14px;
      margin: 0 0 2px;
    }
    .origin-toolbar p {
      color: var(--text-3);
      font-size: 12px;
      margin: 0;
    }
    .origin-form-message {
      padding: 11px 12px;
      border-radius: 10px;
      border: 1px solid rgba(224,62,82,0.28);
      background: rgba(224,62,82,0.10);
      color: var(--ruby);
      font-size: 12.5px;
      line-height: 1.45;
      font-weight: 700;
    }
    @media (max-width: 760px) {
      .origin-toolbar {
        align-items: stretch;
        flex-direction: column;
      }
    }
  `

  document.head.appendChild(style)
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

  document.getElementById("es_personal_eventual").checked = Boolean(
    p.es_personal_eventual
  )

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

  if (metodoPago === "Transferencia bancaria" && !destinationType.value) {
    destinationType.value = inferDestinationType()
  }

  handleDestinationTypeChange()
}

function handleDestinationTypeChange() {
  const destinationType = getValue("destination_type")
  const tipoCuenta = document.getElementById("tipo_cuenta")

  if (destinationType === "clabe") {
    tipoCuenta.value = "CLABE"
  }

  if (destinationType === "cuenta") {
    tipoCuenta.value = "Cuenta"
  }

  if (destinationType === "convenio") {
    tipoCuenta.value = ""
  }
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
    payload.destination_type = null
    payload.banco = null
    payload.clabe = null
    payload.cuenta_bancaria = null
    payload.convenio_number = null
  }

  const destinationValidation = validateDestination(payload)

  if (destinationValidation) {
    showMessage(destinationValidation, true)
    showToast(destinationValidation, "error")
    return
  }

  if (payload.destination_type === "clabe") payload.tipo_cuenta = "CLABE"
  if (payload.destination_type === "cuenta") payload.tipo_cuenta = "Cuenta"
  if (payload.destination_type === "convenio") payload.tipo_cuenta = null

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
    const errorMessage = result.error.message?.toLowerCase().includes("row-level security") || result.error.code === "42501"
      ? "No se pudo guardar el proveedor. Puede faltar permiso update sobre proveedores."
      : `Error guardando proveedor: ${result.error.message}`

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

function validateDestination(payload) {
  if (
    payload.metodo_pago === "Efectivo" ||
    payload.metodo_pago === "Tarjeta en plataforma"
  ) {
    return ""
  }

  if (!payload.destination_type) {
    return "Selecciona el tipo de destino de pago: CLABE, cuenta bancaria o convenio."
  }

  if (payload.metodo_pago === "Transferencia bancaria" && !payload.banco) {
    return "Para transferencia bancaria captura el banco o institucion."
  }

  if (payload.destination_type === "clabe" && !payload.clabe) {
    return "Para destino CLABE captura la CLABE del proveedor."
  }

  if (payload.destination_type === "cuenta" && !payload.cuenta_bancaria) {
    return "Para destino cuenta bancaria captura la cuenta del proveedor."
  }

  if (payload.destination_type === "convenio" && !payload.convenio_number) {
    return "Para destino convenio captura el numero de convenio."
  }

  return ""
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
