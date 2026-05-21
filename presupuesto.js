const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const rootElement = document.documentElement
const themeToggle = document.getElementById("themeToggle")
const logoutBtn = document.getElementById("logoutBtn")
const userName = document.getElementById("userName")
const userEmail = document.getElementById("userEmail")

const companySelect = document.getElementById("companySelect")
const costCenterSelect = document.getElementById("costCenterSelect")
const categorySelect = document.getElementById("categorySelect")
const budgetMonth = document.getElementById("budgetMonth")
const amountInput = document.getElementById("amountInput")
const extraordinaryCheck = document.getElementById("extraordinaryCheck")
const budgetForm = document.getElementById("budgetForm")
const validateBtn = document.getElementById("validateBtn")
const resultContainer = document.getElementById("resultContainer")
const availabilityTableBody = document.getElementById("availabilityTableBody")

let companies = []
let costCenters = []
let categories = []

init()

async function init() {
  setupTheme()
  setDefaultMonth()

  const {
    data: { session },
    error,
  } = await supabaseClient.auth.getSession()

  if (error) {
    showToast(`Error de sesión: ${error.message}`, "error")
    return
  }

  if (!session) {
    window.location.href = "./index.html"
    return
  }

  userEmail.textContent = session.user.email || "Sesión activa"
  userName.textContent = session.user.user_metadata?.full_name || session.user.email || "Usuario"

  logoutBtn.addEventListener("click", logout)
  budgetForm.addEventListener("submit", validateBudget)

  await Promise.all([
    loadCompanies(),
    loadCostCenters(),
    loadCategories(),
    loadAvailability(),
  ])
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) rootElement.setAttribute("data-theme", saved)

  themeToggle.addEventListener("click", () => {
    const next = rootElement.getAttribute("data-theme") === "dark" ? "light" : "dark"
    rootElement.setAttribute("data-theme", next)
    localStorage.setItem("flux-theme", next)
  })
}

function setDefaultMonth() {
  const today = new Date()
  const yyyy = today.getFullYear()
  const mm = String(today.getMonth() + 1).padStart(2, "0")
  budgetMonth.value = `${yyyy}-${mm}`
}

async function loadCompanies() {
  const { data, error } = await supabaseClient
    .from("companies")
    .select("id, name, legal_name, active")
    .eq("active", true)
    .order("name", { ascending: true })

  if (error) {
    setSelectError(companySelect, "No se pudieron cargar empresas")
    showToast(`Error cargando empresas: ${error.message}`, "error")
    return
  }

  companies = data || []
  fillSelect(companySelect, companies, "Selecciona empresa", (item) => item.name)
}

async function loadCostCenters() {
  const { data, error } = await supabaseClient
    .from("cost_centers")
    .select("id, name, code, active")
    .eq("active", true)
    .order("name", { ascending: true })

  if (error) {
    setSelectError(costCenterSelect, "No se pudieron cargar centros")
    showToast(`Error cargando centros de costo: ${error.message}`, "error")
    return
  }

  costCenters = data || []
  fillSelect(costCenterSelect, costCenters, "Selecciona centro de costo", (item) =>
    item.code ? `${item.name} (${item.code})` : item.name
  )
}

async function loadCategories() {
  const { data, error } = await supabaseClient
    .from("budget_categories")
    .select("id, code, name, category, budget_type, active")
    .eq("active", true)
    .order("code", { ascending: true })

  if (error) {
    setSelectError(categorySelect, "No se pudieron cargar partidas")
    showToast(`Error cargando partidas: ${error.message}`, "error")
    return
  }

  categories = data || []
  fillSelect(categorySelect, categories, "Selecciona partida", (item) =>
    item.code ? `${item.code} — ${item.name}` : item.name
  )
}

async function loadAvailability() {
  availabilityTableBody.innerHTML = `<tr><td colspan="8">Cargando disponibilidad...</td></tr>`

  const { data, error } = await supabaseClient
    .from("budget_availability")
    .select(`
      company_id,
      cost_center_id,
      budget_category_id,
      budget_month,
      budgeted,
      committed,
      executed,
      available
    `)
    .order("budget_month", { ascending: true })

  if (error) {
    availabilityTableBody.innerHTML = `<tr><td colspan="8">No se pudo cargar disponibilidad: ${escapeHtml(error.message)}</td></tr>`
    showToast(`Error cargando disponibilidad: ${error.message}`, "error")
    return
  }

  if (!data || data.length === 0) {
    availabilityTableBody.innerHTML = `<tr><td colspan="8">No hay disponibilidad presupuestal registrada.</td></tr>`
    return
  }

  const rows = data.map((row) => {
    const company = companies.find((item) => item.id === row.company_id)
    const center = costCenters.find((item) => item.id === row.cost_center_id)
    const category = categories.find((item) => item.id === row.budget_category_id)

    return `
      <tr>
        <td>${escapeHtml(company?.name || row.company_id)}</td>
        <td>${escapeHtml(center?.name || row.cost_center_id)}</td>
        <td>${escapeHtml(category ? `${category.code || ""} ${category.name}`.trim() : row.budget_category_id)}</td>
        <td>${formatMonth(row.budget_month)}</td>
        <td>${formatCurrency(row.budgeted)}</td>
        <td>${formatCurrency(row.committed)}</td>
        <td>${formatCurrency(row.executed)}</td>
        <td><strong>${formatCurrency(row.available)}</strong></td>
      </tr>
    `
  })

  availabilityTableBody.innerHTML = rows.join("")
}

async function validateBudget(event) {
  event.preventDefault()

  const companyId = companySelect.value
  const costCenterId = costCenterSelect.value
  const categoryId = categorySelect.value
  const monthValue = budgetMonth.value
  const amount = Number(amountInput.value)
  const isExtraordinary = extraordinaryCheck.checked

  if (!companyId || !costCenterId || !categoryId || !monthValue || !amount || amount <= 0) {
    showToast("Completa empresa, centro, partida, mes y monto válido.", "error")
    return
  }

  validateBtn.disabled = true
  validateBtn.textContent = "Validando..."

  const firstDayOfMonth = `${monthValue}-01`

  const { data, error } = await supabaseClient.rpc("verify_budget_availability", {
    p_company_id: companyId,
    p_cost_center_id: costCenterId,
    p_budget_category_id: categoryId,
    p_budget_month: firstDayOfMonth,
    p_amount: amount,
    p_is_extraordinary_adjustment: isExtraordinary,
  })

  validateBtn.disabled = false
  validateBtn.textContent = "Validar presupuesto"

  if (error) {
    showToast(`Error validando presupuesto: ${error.message}`, "error")
    resultContainer.innerHTML = `
      <div class="result-box blocked">
        <div class="result-status blocked">Error</div>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `
    return
  }

  renderResult(data)
  await loadAvailability()
}

function renderResult(result) {
  const status = result?.status || "sin_status"
  const motivo = result?.motivo || "Sin motivo"
  const isSuccess = status === "aprobable"

  resultContainer.innerHTML = `
    <div class="result-box ${isSuccess ? "success" : "blocked"}">
      <div class="result-status ${isSuccess ? "success" : "blocked"}">
        ${isSuccess ? "✓ Aprobable" : "⚠ Bloqueado"}
      </div>

      <div class="metrics">
        <div class="metric">
          <span>Status</span>
          <strong>${escapeHtml(status)}</strong>
        </div>
        <div class="metric">
          <span>Motivo</span>
          <strong>${escapeHtml(motivo)}</strong>
        </div>
        <div class="metric">
          <span>Disponible actual</span>
          <strong>${formatCurrency(result?.disponible_actual)}</strong>
        </div>
        <div class="metric">
          <span>Disponible después</span>
          <strong>${formatCurrency(result?.disponible_despues)}</strong>
        </div>
        <div class="metric">
          <span>Faltante</span>
          <strong>${formatCurrency(result?.faltante)}</strong>
        </div>
      </div>
    </div>
  `

  showToast(isSuccess ? "Presupuesto aprobable." : `Bloqueado: ${motivo}`, isSuccess ? "success" : "error")
}

function fillSelect(select, items, placeholder, labelFn) {
  select.innerHTML = `<option value="">${placeholder}</option>`

  items.forEach((item) => {
    const option = document.createElement("option")
    option.value = item.id
    option.textContent = labelFn(item)
    select.appendChild(option)
  })
}

function setSelectError(select, message) {
  select.innerHTML = `<option value="">${message}</option>`
}

async function logout() {
  await supabaseClient.auth.signOut()
  window.location.href = "./index.html"
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === "") return "—"

  return Number(value).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  })
}

function formatMonth(value) {
  if (!value) return "—"

  const date = new Date(`${value}T00:00:00`)
  return date.toLocaleDateString("es-MX", {
    month: "short",
    year: "numeric",
  })
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
  if (existingToast) existingToast.remove()

  const toast = document.createElement("div")
  toast.id = "toastMessage"
  toast.className = `toast ${type === "error" ? "error" : ""}`
  toast.textContent = message

  document.body.appendChild(toast)

  setTimeout(() => {
    toast.style.opacity = "0"
    toast.style.transform = "translateY(-8px)"
  }, 2200)

  setTimeout(() => {
    if (toast.parentNode) toast.remove()
  }, 2600)
}
