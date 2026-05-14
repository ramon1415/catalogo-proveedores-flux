const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
let proveedores = []
let currentEditingId = null
const tableBody = document.getElementById("suppliersTableBody")
const searchInput = document.getElementById("searchInput")
const statusFilter = document.getElementById("statusFilter")
const messageBox = document.getElementById("messageBox")
const dialog = document.getElementById("supplierDialog")
const form = document.getElementById("supplierForm")
init()
async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession()
  if (!session) { window.location.href = "./index.html"; return }
  document.getElementById("userEmail").textContent = session.user.email || "Sesión activa"
  document.getElementById("userName").textContent = session.user.user_metadata?.full_name || "Usuario Flux"
  document.getElementById("logoutBtn").addEventListener("click", logout)
  document.getElementById("newSupplierBtn").addEventListener("click", openCreateModal)
  document.getElementById("closeModalBtn").addEventListener("click", closeModal)
  document.getElementById("cancelBtn").addEventListener("click", closeModal)
  searchInput.addEventListener("input", renderTable)
  statusFilter.addEventListener("change", renderTable)
  form.addEventListener("submit", saveSupplier)
  await loadSuppliers()
}
async function loadSuppliers() {
  showMessage("Cargando proveedores...")
  const { data, error } = await supabaseClient.from("proveedores").select("*").order("alias", { ascending: true })
  if (error) { showMessage(`Error al cargar proveedores: ${error.message}`, true); tableBody.innerHTML = `<tr><td colspan="9" class="empty">No fue posible cargar proveedores.</td></tr>`; return }
  proveedores = data || []
  hideMessage(); renderStats(); renderTable()
}
function renderStats() {
  document.getElementById("totalCount").textContent = proveedores.length
  document.getElementById("activeCount").textContent = proveedores.filter(p => p.activo).length
  document.getElementById("inactiveCount").textContent = proveedores.filter(p => !p.activo).length
  document.getElementById("transferCount").textContent = proveedores.filter(p => normalize(p.metodo_pago).includes("transferencia")).length
}
function renderTable() {
  const query = normalize(searchInput.value), filter = statusFilter.value
  const rows = proveedores.filter(p => {
    const searchable = normalize([p.alias,p.nombre_completo,p.rfc,p.banco,p.email,p.telefono,p.metodo_pago].join(" "))
    return searchable.includes(query) && (filter === "todos" || (filter === "activos" && p.activo) || (filter === "inactivos" && !p.activo))
  })
  if (!rows.length) { tableBody.innerHTML = `<tr><td colspan="9" class="empty">No se encontraron proveedores.</td></tr>`; return }
  tableBody.innerHTML = rows.map(p => `<tr><td><strong>${escapeHtml(p.alias || "")}</strong></td><td>${escapeHtml(p.nombre_completo || "")}${p.es_personal_eventual ? `<br><span class="badge badge-inactive">Personal eventual</span>` : ""}</td><td>${escapeHtml(p.metodo_pago || "")}</td><td>${escapeHtml(p.banco || "")}</td><td>${escapeHtml(p.clabe || p.cuenta_bancaria || "")}${p.tipo_cuenta ? `<br><small>${escapeHtml(p.tipo_cuenta)}</small>` : ""}</td><td>${escapeHtml(p.rfc || "")}</td><td>${escapeHtml(p.email || "")}${p.telefono ? `<br><small>${escapeHtml(p.telefono)}</small>` : ""}</td><td><span class="badge ${p.activo ? "badge-active" : "badge-inactive"}">${p.activo ? "Activo" : "Inactivo"}</span></td><td><div class="actions"><button class="small-btn" onclick="openEditModal('${p.id}')">Editar</button>${p.activo ? `<button class="small-btn danger" onclick="toggleSupplier('${p.id}', false)">Desactivar</button>` : `<button class="small-btn success" onclick="toggleSupplier('${p.id}', true)">Reactivar</button>`}</div></td></tr>`).join("")
}
function openCreateModal() { currentEditingId = null; document.getElementById("modalTitle").textContent = "Nuevo proveedor"; form.reset(); document.getElementById("activo").checked = true; dialog.showModal() }
window.openEditModal = function(id) {
  const p = proveedores.find(item => item.id === id); if (!p) return
  currentEditingId = id; document.getElementById("modalTitle").textContent = "Editar proveedor"
  ;["alias","nombre_completo","metodo_pago","tipo_cuenta","banco","clabe","cuenta_bancaria","rfc","email","telefono","tipo_proveedor","notas"].forEach(k => setValue(k, p[k]))
  document.getElementById("es_personal_eventual").checked = Boolean(p.es_personal_eventual)
  document.getElementById("activo").checked = Boolean(p.activo)
  dialog.showModal()
}
async function saveSupplier(event) {
  event.preventDefault()
  const payload = { alias:getValue("alias"), nombre_completo:getValue("nombre_completo"), metodo_pago:getValue("metodo_pago"), tipo_cuenta:getValue("tipo_cuenta"), banco:getValue("banco"), clabe:getValue("clabe"), cuenta_bancaria:getValue("cuenta_bancaria"), rfc:getValue("rfc"), email:getValue("email"), telefono:getValue("telefono"), tipo_proveedor:getValue("tipo_proveedor"), notas:getValue("notas"), es_personal_eventual:document.getElementById("es_personal_eventual").checked, activo:document.getElementById("activo").checked, updated_at:new Date().toISOString() }
  if (!payload.alias || !payload.nombre_completo || !payload.metodo_pago) { showMessage("Alias, nombre completo y método de pago son obligatorios.", true); return }
  if (payload.metodo_pago === "Transferencia bancaria" && (!payload.banco || (!payload.clabe && !payload.cuenta_bancaria))) { showMessage("Para transferencia bancaria captura banco y CLABE o cuenta bancaria.", true); return }
  const result = currentEditingId ? await supabaseClient.from("proveedores").update(payload).eq("id", currentEditingId) : await supabaseClient.from("proveedores").insert(payload)
  if (result.error) { showMessage(`Error guardando proveedor: ${result.error.message}`, true); return }
  closeModal(); showMessage("Proveedor guardado correctamente."); await loadSuppliers()
}
window.toggleSupplier = async function(id, activo) {
  if (!confirm(`¿Seguro que deseas ${activo ? "reactivar" : "desactivar"} este proveedor?`)) return
  const { error } = await supabaseClient.from("proveedores").update({ activo, updated_at:new Date().toISOString() }).eq("id", id)
  if (error) { showMessage(`Error al actualizar proveedor: ${error.message}`, true); return }
  showMessage(`Proveedor ${activo ? "reactivado" : "desactivado"} correctamente.`); await loadSuppliers()
}
async function logout() { await supabaseClient.auth.signOut(); window.location.href = "./index.html" }
function closeModal() { dialog.close(); currentEditingId = null }
function getValue(id) { return document.getElementById(id).value.trim() || null }
function setValue(id, value) { document.getElementById(id).value = value || "" }
function showMessage(message, isError = false) { messageBox.textContent = message; messageBox.classList.remove("hidden", "error"); if (isError) messageBox.classList.add("error") }
function hideMessage() { messageBox.classList.add("hidden") }
function normalize(value) { return String(value || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") }
function escapeHtml(value) { return String(value || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;") }
