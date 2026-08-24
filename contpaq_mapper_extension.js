;(function installContpaqMapperExtension() {
  "use strict"

  const PAGE = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (PAGE !== "configuracion.html") return
  if (window.__FLUX_CONTPAQ_MAPPER_INSTALLED__) return
  window.__FLUX_CONTPAQ_MAPPER_INSTALLED__ = true

  const IDS = Object.freeze({
    tab: "contpaqMapperTab",
    panel: "contpaqMapperPanel",
    company: "contpaqMapperCompany",
    filter: "contpaqMapperFilter",
    search: "contpaqMapperSearch",
    body: "contpaqMapperBody",
    counter: "contpaqMapperCounter",
    notice: "contpaqMapperNotice",
    datalist: "contpaqMapperAccountOptions",
    dialog: "contpaqMapperDialog",
    dialogTitle: "contpaqMapperDialogTitle",
    accountInput: "contpaqMapperAccountInput",
    method: "contpaqMapperMethod",
    evidence: "contpaqMapperEvidence",
    reason: "contpaqMapperReason",
    review: "contpaqMapperNeedsReview",
    validation: "contpaqMapperValidation",
    save: "contpaqMapperSave",
    remove: "contpaqMapperRemove",
    close: "contpaqMapperClose",
    groupDialog: "contpaqGroupDialog",
    groupTitle: "contpaqGroupDialogTitle",
    groupSelect: "contpaqGroupSelect",
    groupNewWrap: "contpaqGroupNewWrap",
    groupNew: "contpaqGroupNew",
    groupSave: "contpaqGroupSave",
    groupClose: "contpaqGroupClose",
  })

  const state = {
    client: null,
    profileId: null,
    sysadmin: false,
    companies: [],
    companyId: "",
    categories: [],
    accounts: new Map(),
    mappings: new Map(),
    loadedCompanyId: "",
    editingCategoryId: "",
    collapsedGroups: new Set(),
    loading: false,
  }

  const $ = (id) => document.getElementById(id)
  const text = (value) => String(value ?? "")
  const normalizeCode = (value) => text(value).split("—")[0].replace(/[^0-9A-Za-z]/g, "").toUpperCase()
  const errorMessage = (error) => text(error?.message || error?.details || error || "Error desconocido")

  function allowed() {
    return window.FluxAuth?.isAdminFinance?.() === true
  }

  function showToast(title, message = "", tone = "info") {
    if (window.Components?.showToast) {
      window.Components.showToast(title, message, tone)
      return
    }
    window.alert([title, message].filter(Boolean).join("\n"))
  }

  function setNotice(message, tone = "info") {
    const notice = $(IDS.notice)
    if (!notice) return
    notice.className = `notice-v2 ${tone}`
    const title = notice.querySelector(".notice-title")
    const description = notice.querySelector(".notice-desc")
    if (title) title.textContent = tone === "warning" ? "Atención" : tone === "danger" ? "No disponible" : "Catálogo CONTPAQ"
    if (description) description.textContent = message
    notice.classList.toggle("hidden", !message)
  }

  function injectStyles() {
    if ($("contpaqMapperStyles")) return
    const style = document.createElement("style")
    style.id = "contpaqMapperStyles"
    style.textContent = `
      #${IDS.panel} .contpaq-toolbar{display:grid;grid-template-columns:minmax(190px,.8fr) 170px minmax(210px,1fr);gap:8px;padding:13px 16px;border-bottom:1px solid var(--border)}
      #${IDS.panel} .contpaq-toolbar label{display:flex;flex-direction:column;gap:5px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.35px}
      #${IDS.panel} .contpaq-toolbar select,#${IDS.panel} .contpaq-toolbar input{min-height:36px;padding:0 11px;background:var(--bg-input);border:1px solid var(--border);border-radius:7px;color:var(--text-1);font-size:12.5px;outline:none}
      #${IDS.panel} table{min-width:1080px}
      #${IDS.panel} tr.contpaq-group-row td{padding:8px 14px;background:var(--bg-surface);border-top:1px solid var(--border-strong)}
      #${IDS.panel} .contpaq-group-toggle{border:0;background:transparent;color:var(--text-1);font:inherit;font-weight:800;cursor:pointer;padding:2px 0}
      #${IDS.panel} .contpaq-main{display:block;color:var(--text-1);font-weight:700}
      #${IDS.panel} .contpaq-sub{display:block;color:var(--text-3);font-size:10.5px;margin-top:2px}
      #${IDS.panel} .contpaq-actions{display:flex;gap:6px;flex-wrap:wrap}
      #${IDS.panel} .contpaq-validation{display:flex;gap:5px;flex-wrap:wrap}
      #${IDS.panel} .contpaq-empty{padding:44px 20px;text-align:center;color:var(--text-3)}
      .contpaq-dialog-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      .contpaq-dialog-grid label{display:flex;flex-direction:column;gap:5px;font-size:10.5px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.35px}
      .contpaq-dialog-grid label.full{grid-column:1/-1}
      .contpaq-dialog-grid input,.contpaq-dialog-grid select,.contpaq-dialog-grid textarea{min-height:36px;padding:0 11px;background:var(--bg-input);border:1px solid var(--border);border-radius:7px;color:var(--text-1);font-size:12.5px;outline:none}
      .contpaq-dialog-grid textarea{padding:9px 11px;min-height:92px;resize:vertical}
      .contpaq-dialog-grid textarea[readonly]{opacity:.78;cursor:not-allowed;resize:none;background:var(--bg-surface)}
      .contpaq-field-note{font-size:10.5px;font-weight:500;line-height:1.45;color:var(--text-3);text-transform:none;letter-spacing:0}
      .contpaq-check{display:flex!important;flex-direction:row!important;align-items:center;gap:8px!important;text-transform:none!important;font-size:12.5px!important;color:var(--text-2)!important}
      .contpaq-check input{min-height:auto!important;width:15px;height:15px;accent-color:var(--accent)}
      @media(max-width:900px){#${IDS.panel} .contpaq-toolbar{grid-template-columns:1fr}.contpaq-dialog-grid{grid-template-columns:1fr}.contpaq-dialog-grid label.full{grid-column:auto}}
    `
    document.head.appendChild(style)
  }

  function injectUi() {
    if ($(IDS.tab) || $(IDS.panel)) return
    const tabs = document.querySelector(".config-tabs")
    const page = document.querySelector("section.page")
    const systemTab = tabs?.querySelector('[data-config-tab="system"]')
    const systemPanel = $("systemPanel")
    if (!tabs || !page) return

    const tab = document.createElement("button")
    tab.type = "button"
    tab.id = IDS.tab
    tab.className = "config-tab"
    tab.dataset.configTab = "contpaq"
    tab.innerHTML = 'Mapeo CONTPAQ <span class="tab-badge">Adm/SysAdmin</span>'
    if (systemTab) tabs.insertBefore(tab, systemTab)
    else tabs.appendChild(tab)

    const panel = document.createElement("div")
    panel.id = IDS.panel
    panel.className = "config-panel"
    panel.innerHTML = `
      <div id="${IDS.notice}" class="notice-v2 info hidden" role="status" aria-live="polite">
        <span class="notice-icon">·</span>
        <span class="notice-text"><span class="notice-title">Catálogo CONTPAQ</span><span class="notice-sep">—</span><span class="notice-desc"></span></span>
      </div>
      <section class="table-card">
        <div class="panel-toolbar">
          <div>
            <h2>Mapeo de partidas a cuentas CONTPAQ</h2>
            <p id="${IDS.counter}" aria-live="polite">Selecciona una empresa.</p>
          </div>
        </div>
        <div class="contpaq-toolbar">
          <label>Empresa<select id="${IDS.company}"><option value="">Seleccionar empresa...</option></select></label>
          <label>Estado<select id="${IDS.filter}"><option value="all">Todas</option><option value="mapped">Mapeadas</option><option value="review">Por revisar</option><option value="unmapped">Sin mapear</option></select></label>
          <label>Buscar<input id="${IDS.search}" type="search" placeholder="Partida, grupo, código o cuenta"></label>
        </div>
        <div class="table-wrapper" style="max-height:calc(100vh - 345px)">
          <table>
            <caption class="sr-only">Mapeo entre partidas presupuestales y cuentas contables CONTPAQ</caption>
            <thead><tr><th>Partida</th><th>Grupo</th><th>Cuenta CONTPAQ</th><th>Validación</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody id="${IDS.body}"><tr><td colspan="6" class="contpaq-empty">Selecciona una empresa.</td></tr></tbody>
          </table>
        </div>
        <datalist id="${IDS.datalist}"></datalist>
      </section>
    `
    if (systemPanel) page.insertBefore(panel, systemPanel)
    else page.appendChild(panel)

    injectMappingDialog()
    injectGroupDialog()
  }

  function injectMappingDialog() {
    if ($(IDS.dialog)) return
    const dialog = document.createElement("dialog")
    dialog.id = IDS.dialog
    dialog.className = "narrow"
    dialog.innerHTML = `
      <div class="modal-content">
        <div class="modal-header"><div><h2 id="${IDS.dialogTitle}" style="color:var(--text-1)">Editar mapeo</h2><p>Solo se aceptan cuentas activas, de detalle, de gasto y sin descendientes.</p></div><button type="button" id="${IDS.close}" class="icon-btn" aria-label="Cerrar">✕</button></div>
        <div class="contpaq-dialog-grid">
          <label class="full">Cuenta CONTPAQ<input id="${IDS.accountInput}" list="${IDS.datalist}" autocomplete="off" placeholder="Código — nombre"></label>
          <label>Método<select id="${IDS.method}"><option value="exact_name">Coincidencia exacta</option><option value="judgment">Criterio contable</option><option value="manual">Manual</option><option value="imported">Importado</option></select></label>
          <label class="contpaq-check"><input id="${IDS.review}" type="checkbox">Requiere revisión de Finanzas</label>
          <label class="full">Evidencia técnica del seed<textarea id="${IDS.evidence}" readonly aria-readonly="true" placeholder="Sin evidencia derivada"></textarea><span class="contpaq-field-note">Dato reproducible generado desde los nombres de partida y cuenta. No equivale a una aprobación de Finanzas.</span></label>
          <label class="full">Razón formal de Finanzas<textarea id="${IDS.reason}" maxlength="1000" placeholder="Captura la justificación aprobada por Finanzas"></textarea><span class="contpaq-field-note">Es obligatoria para resolver una bandera de revisión o crear un criterio nuevo sin evidencia versionada.</span></label>
          <div id="${IDS.validation}" class="notice-v2 neutral full" role="status" aria-live="polite"></div>
        </div>
        <div class="modal-actions"><button type="button" id="${IDS.remove}" class="small-btn danger">Quitar mapeo</button><button type="button" id="${IDS.save}" class="primary-btn">Guardar mapeo</button></div>
      </div>
    `
    document.body.appendChild(dialog)
  }

  function injectGroupDialog() {
    if ($(IDS.groupDialog)) return
    const dialog = document.createElement("dialog")
    dialog.id = IDS.groupDialog
    dialog.className = "narrow"
    dialog.innerHTML = `
      <div class="modal-content">
        <div class="modal-header"><div><h2 id="${IDS.groupTitle}" style="color:var(--text-1)">Cambiar agrupación</h2><p>La agrupación organiza la matriz del Dashboard anual.</p></div><button type="button" id="${IDS.groupClose}" class="icon-btn" aria-label="Cerrar">✕</button></div>
        <div class="contpaq-dialog-grid">
          <label class="full">Agrupación<select id="${IDS.groupSelect}"></select></label>
          <label class="full hidden" id="${IDS.groupNewWrap}">Nueva agrupación<input id="${IDS.groupNew}" maxlength="120"></label>
        </div>
        <div class="modal-actions"><button type="button" id="${IDS.groupSave}" class="primary-btn">Guardar agrupación</button></div>
      </div>
    `
    document.body.appendChild(dialog)
  }

  function bindUi() {
    $(IDS.tab)?.addEventListener("click", openMapperTab)
    $(IDS.company)?.addEventListener("change", (event) => loadCompany(event.target.value))
    $(IDS.filter)?.addEventListener("change", renderRows)
    $(IDS.search)?.addEventListener("input", renderRows)
    $(IDS.body)?.addEventListener("click", handleTableClick)
    $(IDS.close)?.addEventListener("click", closeMappingDialog)
    $(IDS.save)?.addEventListener("click", saveMapping)
    $(IDS.remove)?.addEventListener("click", removeMapping)
    $(IDS.accountInput)?.addEventListener("input", updateDialogValidation)
    $(IDS.groupClose)?.addEventListener("click", () => $(IDS.groupDialog)?.close())
    $(IDS.groupSelect)?.addEventListener("change", toggleNewGroupInput)
    $(IDS.groupSave)?.addEventListener("click", saveCategoryGroup)

    document.querySelectorAll(".config-tabs .config-tab").forEach((button) => {
      if (button.id === IDS.tab) return
      button.addEventListener("click", () => $(IDS.panel)?.classList.remove("active"))
    })
  }

  function openMapperTab() {
    if (!allowed()) return
    document.querySelectorAll(".config-tab").forEach((button) => button.classList.remove("active"))
    document.querySelectorAll(".config-panel").forEach((panel) => panel.classList.remove("active"))
    $(IDS.tab)?.classList.add("active")
    $(IDS.panel)?.classList.add("active")
    $("permissionMessage")?.classList.add("hidden")
    const params = new URLSearchParams(window.location.search)
    params.set("tab", "contpaq")
    window.history.replaceState({}, "", `${window.location.pathname}?${params}`)
    if (!state.companies.length) loadCompanies()
    else if (state.companyId && state.loadedCompanyId !== state.companyId) loadCompany(state.companyId)
  }

  async function loadCompanies() {
    if (state.loading) return
    state.loading = true
    try {
      let companies = []
      if (state.sysadmin) {
        const { data, error } = await state.client.from("companies").select("id,name,active").eq("active", true).order("name")
        if (error) throw error
        companies = data || []
      } else {
        const { data: memberships, error: membershipError } = await state.client
          .from("profile_company_memberships")
          .select("company_id")
          .eq("profile_id", state.profileId)
          .eq("active", true)
        if (membershipError) throw membershipError
        const companyIds = [...new Set((memberships || []).map((row) => row.company_id).filter(Boolean))]
        if (companyIds.length) {
          const { data, error } = await state.client.from("companies").select("id,name,active").in("id", companyIds).eq("active", true).order("name")
          if (error) throw error
          companies = data || []
        }
      }

      state.companies = companies
      const select = $(IDS.company)
      if (select) {
        select.replaceChildren(new Option("Seleccionar empresa...", ""))
        companies.forEach((company) => select.add(new Option(company.name, company.id)))
      }
      if (!companies.length) {
        setNotice("No tienes una membresía activa en una empresa con catálogo CONTPAQ.", "warning")
        return
      }
      state.companyId = companies[0].id
      if (select) select.value = state.companyId
      await loadCompany(state.companyId)
    } catch (error) {
      setNotice(friendlyError(error), "danger")
    } finally {
      state.loading = false
    }
  }

  async function fetchAll(factory, pageSize = 1000) {
    const rows = []
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await factory().range(start, start + pageSize - 1)
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < pageSize) break
    }
    return rows
  }

  async function loadCompany(companyId) {
    state.companyId = companyId || ""
    state.loadedCompanyId = ""
    state.accounts = new Map()
    state.mappings = new Map()
    if (!companyId) {
      renderRows()
      return
    }

    setLoadingRow("Cargando catálogo y mapeos...")
    try {
      const [categoriesResult, accounts, mappings] = await Promise.all([
        state.client.from("budget_categories").select("id,name,category,code,active").eq("active", true).order("category").order("name"),
        fetchAll(() => state.client.from("contpaq_account_mapper_candidates").select("company_id,code,name,is_detail,sat_group,cta_sup,cta_mayor,tipo,rubro_nif,activo,sincronizado_el,es_hoja,elegible_mapper").eq("company_id", companyId).order("code")),
        fetchAll(() => state.client.from("budget_account_mappings").select("id,company_id,budget_category_id,contpaq_account_code,needs_review,mapping_method,mapping_evidence,mapping_reason,created_at,updated_at,updated_by").eq("company_id", companyId).order("budget_category_id")),
      ])
      if (categoriesResult.error) throw categoriesResult.error
      state.categories = categoriesResult.data || []
      state.accounts = new Map(accounts.map((account) => [account.code, account]))
      state.mappings = new Map(mappings.map((mapping) => [mapping.budget_category_id, mapping]))
      state.loadedCompanyId = companyId
      renderAccountDatalist()
      renderRows()

      const eligible = accounts.filter((account) => account.elegible_mapper).length
      if (!accounts.length) {
        setNotice("La estructura está lista, pero esta empresa aún no tiene catálogo CONTPAQ cargado.", "warning")
      } else if (!eligible) {
        setNotice("El catálogo existe, pero falta re-sincronizarlo con cta_sup, cta_mayor, tipo, rubro NIF y sincronizado_el. El guard de hoja permanece cerrado.", "warning")
      } else {
        setNotice(`${accounts.length.toLocaleString("es-MX")} cuentas cargadas; ${eligible.toLocaleString("es-MX")} son elegibles para mapear.`, "info")
      }
    } catch (error) {
      setLoadingRow(friendlyError(error))
      setNotice(friendlyError(error), "danger")
    }
  }

  function renderAccountDatalist() {
    const datalist = $(IDS.datalist)
    if (!datalist) return
    datalist.replaceChildren()
    ;[...state.accounts.values()]
      .filter((account) => account.elegible_mapper)
      .sort((a, b) => a.code.localeCompare(b.code))
      .forEach((account) => {
        const option = document.createElement("option")
        option.value = `${account.code} — ${account.name}`
        option.label = `${account.name} · ${account.rubro_nif || "Sin rubro NIF"}`
        datalist.appendChild(option)
      })
  }

  function filteredCategories() {
    const query = text($(IDS.search)?.value).trim().toLowerCase()
    const filter = $(IDS.filter)?.value || "all"
    return state.categories.filter((category) => {
      const mapping = state.mappings.get(category.id)
      if (filter === "mapped" && !mapping) return false
      if (filter === "review" && !mapping?.needs_review) return false
      if (filter === "unmapped" && mapping) return false
      if (!query) return true
      const account = mapping ? state.accounts.get(mapping.contpaq_account_code) : null
      return [category.name, category.code, category.category, mapping?.contpaq_account_code, account?.name]
        .some((value) => text(value).toLowerCase().includes(query))
    })
  }

  function renderRows() {
    const body = $(IDS.body)
    if (!body) return
    body.replaceChildren()
    if (!state.companyId) {
      appendEmptyRow(body, "Selecciona una empresa.")
      updateCounter([])
      return
    }
    const categories = filteredCategories()
    if (!categories.length) {
      appendEmptyRow(body, "No hay partidas para los filtros seleccionados.")
      updateCounter(categories)
      return
    }

    const groups = new Map()
    categories.forEach((category) => {
      const group = text(category.category).trim() || "Sin agrupación"
      if (!groups.has(group)) groups.set(group, [])
      groups.get(group).push(category)
    })

    ;[...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "es")).forEach(([group, groupCategories]) => {
      const groupRow = document.createElement("tr")
      groupRow.className = "contpaq-group-row"
      const groupCell = document.createElement("td")
      groupCell.colSpan = 6
      const toggle = document.createElement("button")
      toggle.type = "button"
      toggle.className = "contpaq-group-toggle"
      toggle.dataset.action = "toggle-group"
      toggle.dataset.group = group
      toggle.textContent = `${state.collapsedGroups.has(group) ? "▸" : "▾"} ${group} (${groupCategories.length})`
      groupCell.appendChild(toggle)
      groupRow.appendChild(groupCell)
      body.appendChild(groupRow)
      if (state.collapsedGroups.has(group)) return
      groupCategories.sort((a, b) => a.name.localeCompare(b.name, "es")).forEach((category) => body.appendChild(buildCategoryRow(category)))
    })
    updateCounter(categories)
  }

  function buildCategoryRow(category) {
    const mapping = state.mappings.get(category.id)
    const account = mapping ? state.accounts.get(mapping.contpaq_account_code) : null
    const row = document.createElement("tr")

    const categoryCell = document.createElement("td")
    appendMainSub(categoryCell, category.name, category.code || "Sin código presupuestal")

    const groupCell = document.createElement("td")
    groupCell.textContent = category.category || "Sin agrupación"

    const accountCell = document.createElement("td")
    if (mapping) appendMainSub(accountCell, account?.name || "Cuenta no disponible", mapping.contpaq_account_code)
    else accountCell.textContent = "Sin mapear"

    const validationCell = document.createElement("td")
    validationCell.className = "contpaq-validation"
    if (!mapping) {
      validationCell.textContent = "—"
    } else if (!account) {
      validationCell.appendChild(badge("Cuenta faltante", "danger"))
    } else {
      validationCell.appendChild(badge(account.cta_mayor === 2 ? "Detalle" : "No detalle", account.cta_mayor === 2 ? "success" : "danger"))
      validationCell.appendChild(badge(account.tipo === "G" ? "Gasto" : `Tipo ${account.tipo || "?"}`, account.tipo === "G" ? "success" : "danger"))
      validationCell.appendChild(badge(account.es_hoja ? "Hoja" : "Con hijos", account.es_hoja ? "success" : "danger"))
      if (!account.activo) validationCell.appendChild(badge("Inactiva", "warning"))
    }

    const statusCell = document.createElement("td")
    if (!mapping) statusCell.appendChild(badge("Sin mapear", "neutral"))
    else if (mapping.needs_review) statusCell.appendChild(badge("Por revisar", "warning"))
    else statusCell.appendChild(badge("Mapeada", "success"))

    const actionsCell = document.createElement("td")
    actionsCell.className = "contpaq-actions"
    const edit = document.createElement("button")
    edit.type = "button"
    edit.className = "small-btn"
    edit.dataset.action = "edit"
    edit.dataset.categoryId = category.id
    edit.textContent = mapping ? "Editar mapeo" : "Mapear"
    const group = document.createElement("button")
    group.type = "button"
    group.className = "small-btn"
    group.dataset.action = "edit-group"
    group.dataset.categoryId = category.id
    group.textContent = "Cambiar grupo"
    actionsCell.append(edit, group)

    row.append(categoryCell, groupCell, accountCell, validationCell, statusCell, actionsCell)
    return row
  }

  function appendMainSub(cell, main, sub) {
    const mainEl = document.createElement("span")
    mainEl.className = "contpaq-main"
    mainEl.textContent = text(main)
    const subEl = document.createElement("span")
    subEl.className = "contpaq-sub"
    subEl.textContent = text(sub)
    cell.append(mainEl, subEl)
  }

  function badge(label, tone) {
    const element = document.createElement("span")
    element.className = `badge ${tone}`
    element.textContent = text(label)
    return element
  }

  function appendEmptyRow(body, message) {
    const row = document.createElement("tr")
    const cell = document.createElement("td")
    cell.colSpan = 6
    cell.className = "contpaq-empty"
    cell.textContent = message
    row.appendChild(cell)
    body.appendChild(row)
  }

  function updateCounter(visibleCategories) {
    const counter = $(IDS.counter)
    if (!counter) return
    const total = state.categories.length
    const mapped = state.categories.filter((category) => state.mappings.has(category.id)).length
    const review = [...state.mappings.values()].filter((mapping) => mapping.needs_review).length
    counter.textContent = `${mapped} de ${total} partidas mapeadas · ${review} por revisar · ${visibleCategories.length} visibles`
  }

  function setLoadingRow(message) {
    const body = $(IDS.body)
    if (!body) return
    body.replaceChildren()
    appendEmptyRow(body, message)
  }

  function handleTableClick(event) {
    const button = event.target.closest("button[data-action]")
    if (!button) return
    if (button.dataset.action === "toggle-group") {
      const group = button.dataset.group || ""
      if (state.collapsedGroups.has(group)) state.collapsedGroups.delete(group)
      else state.collapsedGroups.add(group)
      renderRows()
      return
    }
    if (button.dataset.action === "edit") openMappingDialog(button.dataset.categoryId)
    if (button.dataset.action === "edit-group") openGroupDialog(button.dataset.categoryId)
  }

  function openMappingDialog(categoryId) {
    const category = state.categories.find((item) => item.id === categoryId)
    if (!category) return
    state.editingCategoryId = categoryId
    const mapping = state.mappings.get(categoryId)
    const account = mapping ? state.accounts.get(mapping.contpaq_account_code) : null
    $(IDS.dialogTitle).textContent = category.name
    $(IDS.accountInput).value = account ? `${account.code} — ${account.name}` : mapping?.contpaq_account_code || ""
    $(IDS.method).value = mapping?.mapping_method || "manual"
    $(IDS.evidence).value = mapping?.mapping_evidence || ""
    $(IDS.reason).value = mapping?.mapping_reason || ""
    $(IDS.review).checked = mapping?.needs_review === true
    $(IDS.remove).disabled = !mapping
    updateDialogValidation()
    $(IDS.dialog)?.showModal()
  }

  function closeMappingDialog() {
    $(IDS.dialog)?.close()
    state.editingCategoryId = ""
  }

  function updateDialogValidation() {
    const code = normalizeCode($(IDS.accountInput)?.value)
    const account = state.accounts.get(code)
    const box = $(IDS.validation)
    if (!box) return
    if (!code) {
      box.textContent = "Selecciona una cuenta del catálogo."
      return
    }
    if (!account) {
      box.textContent = "La cuenta no existe en el catálogo permitido para esta empresa."
      return
    }
    const checks = [
      account.activo ? "activa" : "inactiva",
      account.cta_mayor === 2 ? "detalle" : `CtaMayor ${account.cta_mayor ?? "sin dato"}`,
      account.tipo === "G" ? "gasto" : `tipo ${account.tipo || "sin dato"}`,
      account.es_hoja ? "hoja" : "tiene descendientes",
      account.sincronizado_el ? "sincronizada" : "sin sincronización de árbol",
    ]
    box.textContent = `${account.code} · ${account.name} · ${checks.join(" · ")}`
    box.className = `notice-v2 ${account.elegible_mapper ? "info" : "danger"} full`
  }

  async function saveMapping() {
    const category = state.categories.find((item) => item.id === state.editingCategoryId)
    if (!category || !state.companyId) return
    const code = normalizeCode($(IDS.accountInput)?.value)
    const account = state.accounts.get(code)
    const mapping = state.mappings.get(category.id)
    const method = $(IDS.method)?.value || "manual"
    const evidence = text(mapping?.mapping_evidence).trim()
    const reason = text($(IDS.reason)?.value).trim()
    const needsReview = $(IDS.review)?.checked === true
    const wasReview = mapping?.needs_review === true

    if (!account) {
      showToast("Cuenta no encontrada", "Elige una cuenta del catálogo CONTPAQ de esta empresa.", "danger")
      return
    }
    if (!account.elegible_mapper) {
      showToast("Cuenta no elegible", "Debe estar activa, sincronizada, ser CtaMayor=2, tipo G y no tener hijos.", "danger")
      return
    }
    if (wasReview && !needsReview && reason.length < 8) {
      showToast("Falta la razón formal", "Para resolver la revisión, Finanzas debe documentar su decisión con al menos 8 caracteres.", "warning")
      return
    }
    if ((method === "judgment" || needsReview) && evidence.length < 8 && reason.length < 8) {
      showToast("Falta sustento", "Captura una razón formal con al menos 8 caracteres. La evidencia técnica solo puede venir de una semilla versionada.", "warning")
      return
    }

    setDialogBusy(true)
    try {
      const payload = {
        company_id: state.companyId,
        budget_category_id: category.id,
        contpaq_account_code: account.code,
        needs_review: needsReview,
        mapping_method: method,
        mapping_reason: reason || null,
      }
      const { error } = await state.client.from("budget_account_mappings").upsert(payload, { onConflict: "company_id,budget_category_id" })
      if (error) throw error
      closeMappingDialog()
      showToast("Mapeo guardado", `${category.name} → ${account.code}`, "success")
      await loadCompany(state.companyId)
    } catch (error) {
      showToast("No se pudo guardar", friendlyError(error), "danger")
    } finally {
      setDialogBusy(false)
    }
  }

  async function removeMapping() {
    const category = state.categories.find((item) => item.id === state.editingCategoryId)
    if (!category || !state.companyId || !state.mappings.has(category.id)) return
    if (!window.confirm(`¿Quitar el mapeo de "${category.name}"?`)) return
    setDialogBusy(true)
    try {
      const { error } = await state.client.from("budget_account_mappings")
        .delete().eq("company_id", state.companyId).eq("budget_category_id", category.id)
      if (error) throw error
      closeMappingDialog()
      showToast("Mapeo eliminado", category.name, "success")
      await loadCompany(state.companyId)
    } catch (error) {
      showToast("No se pudo eliminar", friendlyError(error), "danger")
    } finally {
      setDialogBusy(false)
    }
  }

  function setDialogBusy(busy) {
    ;[$(IDS.save), $(IDS.remove)].forEach((button) => { if (button) button.disabled = busy || (button.id === IDS.remove && !state.mappings.has(state.editingCategoryId)) })
  }

  function openGroupDialog(categoryId) {
    const category = state.categories.find((item) => item.id === categoryId)
    if (!category) return
    state.editingCategoryId = categoryId
    $(IDS.groupTitle).textContent = `Agrupación · ${category.name}`
    const groups = [...new Set(state.categories.map((item) => text(item.category).trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"))
    const select = $(IDS.groupSelect)
    select.replaceChildren()
    groups.forEach((group) => select.add(new Option(group, group)))
    select.add(new Option("+ Nueva agrupación", "__new__"))
    const current = text(category.category).trim()
    if (current && groups.includes(current)) select.value = current
    else select.value = "__new__"
    $(IDS.groupNew).value = current && !groups.includes(current) ? current : ""
    toggleNewGroupInput()
    $(IDS.groupDialog)?.showModal()
  }

  function toggleNewGroupInput() {
    const isNew = $(IDS.groupSelect)?.value === "__new__"
    $(IDS.groupNewWrap)?.classList.toggle("hidden", !isNew)
    if (isNew) $(IDS.groupNew)?.focus()
  }

  async function saveCategoryGroup() {
    const category = state.categories.find((item) => item.id === state.editingCategoryId)
    if (!category) return
    let group = $(IDS.groupSelect)?.value || ""
    if (group === "__new__") group = text($(IDS.groupNew)?.value).trim()
    if (!group) {
      showToast("Falta la agrupación", "Selecciona o escribe un nombre.", "warning")
      return
    }
    $(IDS.groupSave).disabled = true
    try {
      const { error } = await state.client.from("budget_categories").update({ category: group }).eq("id", category.id)
      if (error) throw error
      category.category = group
      $(IDS.groupDialog)?.close()
      renderRows()
      showToast("Agrupación actualizada", `${category.name} → ${group}`, "success")
    } catch (error) {
      showToast("No se pudo cambiar", friendlyError(error), "danger")
    } finally {
      $(IDS.groupSave).disabled = false
    }
  }

  function friendlyError(error) {
    const message = errorMessage(error)
    if (/relation .* does not exist|schema cache|contpaq_account_mapper_candidates/i.test(message)) return "La migración versionada del mapper CONTPAQ aún no está aplicada en este ambiente."
    if (/contpaq_catalog_tree_metadata_incomplete/i.test(message)) return "El catálogo aún no fue re-sincronizado con árbol y naturaleza contable."
    if (/contpaq_mapping_account_has_children/i.test(message)) return "La cuenta tiene descendientes y causaría doble conteo."
    if (/contpaq_mapping_account_not_detail/i.test(message)) return "La cuenta no es de detalle (CtaMayor=2)."
    if (/contpaq_mapping_account_not_expense/i.test(message)) return "La cuenta no es de naturaleza gasto (tipo G)."
    if (/contpaq_mapping_account_inactive/i.test(message)) return "La cuenta está inactiva."
    if (/contpaq_mapping_review_reason_required/i.test(message)) return "Para resolver una revisión, captura una razón formal de Finanzas."
    if (/contpaq_mapping_evidence_required/i.test(message)) return "Este criterio requiere evidencia versionada o una razón formal."
    if (/contpaq_mapping_evidence_server_managed/i.test(message)) return "La evidencia técnica es administrada por el servidor y no puede editarse desde el navegador."
    if (/contpaq_mapper_company_access_denied/i.test(message)) return "Tu rol o membresía de empresa no permite usar el mapper CONTPAQ."
    if (/row-level security|permission denied|42501/i.test(message)) return "Tu rol o membresía de empresa no permite esta operación."
    return message
  }

  async function init() {
    injectStyles()
    if (!window.FluxAuth?.ready) return
    await window.FluxAuth.ready()
    if (!allowed()) return
    state.sysadmin = window.FluxAuth?.isSysadmin?.() === true
    state.profileId = window.FluxAuth?.getProfile?.()?.id || null
    state.client = window.getFluxSupabaseClient?.() || window.supabase?.createClient?.(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    if (!state.client) return
    injectUi()
    bindUi()
    if (new URLSearchParams(window.location.search).get("tab") === "contpaq") {
      window.setTimeout(openMapperTab, 0)
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true })
  else init()
})()
