const configClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const dom = {}
const TAB_LABELS = {
  members: "Socios",
  originAccounts: "Cuentas origen",
  budgets: "Presupuestos",
  system: "Sistema",
}

document.addEventListener("DOMContentLoaded", initConfigurationPage)

async function initConfigurationPage() {
  cacheDom()
  setupTheme()
  bindEvents()

  const session = await loadSession()
  if (!session) return

  await window.FluxAuth?.ready?.()
  updateVisibleTabs()
  openInitialTab()
}

function cacheDom() {
  dom.themeToggle = document.getElementById("themeToggle")
  dom.userName = document.getElementById("userName")
  dom.userEmail = document.getElementById("userEmail")
  dom.logoutBtn = document.getElementById("logoutBtn")
  dom.permissionMessage = document.getElementById("permissionMessage")
  dom.tabs = Array.from(document.querySelectorAll("[data-config-tab]"))
  dom.panels = {
    members: document.getElementById("membersPanel"),
    originAccounts: document.getElementById("originAccountsPanel"),
    budgets: document.getElementById("budgetsPanel"),
    system: document.getElementById("systemPanel"),
  }
}

function setupTheme() {
  const saved = localStorage.getItem("flux-theme")
  if (saved) document.documentElement.setAttribute("data-theme", saved)

  dom.themeToggle?.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark"
    document.documentElement.setAttribute("data-theme", next)
    localStorage.setItem("flux-theme", next)
  })
}

function bindEvents() {
  dom.logoutBtn?.addEventListener("click", logout)
  dom.tabs.forEach((button) => {
    button.addEventListener("click", () => openTab(button.dataset.configTab))
  })
}

async function loadSession() {
  const { data: { session } } = await configClient.auth.getSession()
  if (!session) {
    window.location.href = "./index.html"
    return null
  }

  dom.userEmail.textContent = session.user.email || "Sesion activa"
  dom.userName.textContent = session.user.user_metadata?.full_name || session.user.email || "Usuario"

  const profile = await resolveProfile(session)
  if (profile?.full_name) dom.userName.textContent = profile.full_name
  return session
}

async function resolveProfile(session) {
  const lookups = [
    ["auth_user_id", session.user.id],
    ["email", session.user.email],
  ].filter(([, value]) => value)

  for (const [column, value] of lookups) {
    const { data } = await configClient
      .from("profiles")
      .select("id,email,full_name,auth_user_id,active")
      .eq(column, value)
      .maybeSingle()
    if (data?.id) return data
  }
  return null
}

function updateVisibleTabs() {
  dom.tabs.forEach((button) => {
    const tab = button.dataset.configTab
    const allowed = canAccess(tab)
    button.hidden = !allowed
    button.disabled = !allowed
  })
}

function openInitialTab() {
  const requested = new URLSearchParams(window.location.search).get("tab") || ""
  const tabMap = {
    socios: "members",
    members: "members",
    cuentas: "originAccounts",
    cuentas_origen: "originAccounts",
    "cuentas-origen": "originAccounts",
    originAccounts: "originAccounts",
    budgets: "budgets",
    presupuestos: "budgets",
    system: "system",
    sistema: "system",
  }
  const requestedTab = tabMap[requested] || requested
  const firstAllowed = dom.tabs.find((button) => !button.hidden)?.dataset.configTab

  if (requestedTab && !canAccess(requestedTab)) {
    showPermission(`No tienes permiso para ver ${TAB_LABELS[requestedTab] || "esta seccion"}.`)
    openTab(firstAllowed)
    return
  }

  openTab(canAccess(requestedTab) ? requestedTab : firstAllowed)
}

function openTab(tab) {
  if (!tab) {
    showPermission("No tienes permisos de configuracion disponibles.")
    Object.values(dom.panels).forEach((panel) => panel?.classList.add("hidden"))
    return
  }

  if (!canAccess(tab)) {
    showPermission(`No tienes permiso para ver ${TAB_LABELS[tab] || "esta seccion"}.`)
    return
  }

  hidePermission()
  dom.tabs.forEach((button) => button.classList.toggle("active", button.dataset.configTab === tab))
  Object.entries(dom.panels).forEach(([key, panel]) => panel?.classList.toggle("hidden", key !== tab))

  const params = new URLSearchParams(window.location.search)
  params.set("tab", tab)
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`)
}

function canAccess(tab) {
  return Boolean(window.FluxAuth?.canAccessConfigTab?.(tab))
}

function showPermission(message) {
  if (!dom.permissionMessage) return
  dom.permissionMessage.textContent = message
  dom.permissionMessage.classList.remove("hidden")
}

function hidePermission() {
  dom.permissionMessage?.classList.add("hidden")
}

async function logout() {
  await configClient.auth.signOut()
  window.location.href = "./index.html"
}
