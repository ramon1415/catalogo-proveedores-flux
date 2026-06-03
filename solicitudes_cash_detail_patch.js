;(function solicitudesCashDetailPatch() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "solicitudes.html") return

  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  if (!client) return

  let profiles = []

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  async function init() {
    await loadProfiles()
    bindCashMetadataCapture()
    observeCashDetail()
  }

  async function loadProfiles() {
    const { data } = await client.from("profiles").select("id,full_name,email,active").order("full_name", { ascending: true })
    profiles = (data || []).filter((profile) => profile.active !== false)
  }

  function bindCashMetadataCapture() {
    const form = document.getElementById("requestForm")
    if (!form || form.dataset.cashMetadataPatchBound) return
    form.dataset.cashMetadataPatchBound = "true"
    form.addEventListener("submit", () => {
      const type = document.getElementById("requestType")?.value || "provider_payment"
      if (type !== "cash" && type !== "check") return
      const notes = document.getElementById("notes")
      if (!notes) return
      notes.value = notesWithCashMetadata(notes.value, {
        request_type: type,
        responsible_profile_id: value("cashResponsibleProfileId"),
        due_date: value("cashDueDate"),
        delivery_method: value("cashDeliveryMethod") || type,
      }) || ""
    }, true)
  }

  function observeCashDetail() {
    const target = document.getElementById("detailContent")
    if (!target) return
    const observer = new MutationObserver(() => window.setTimeout(renderCashSection, 120))
    observer.observe(target, { childList: true, subtree: false })
  }

  async function renderCashSection() {
    const target = document.getElementById("detailContent")
    if (!target || target.querySelector("[data-cash-detail-patch]")) return

    const requestNumber = document.getElementById("detailTitle")?.textContent?.trim()
    if (!requestNumber || requestNumber === "Detalle de solicitud") return

    const { data: request } = await client
      .from("payment_requests")
      .select("id,request_number,request_type,status,amount_requested,currency,notes")
      .eq("request_number", requestNumber)
      .maybeSingle()

    if (!request || !["cash", "check"].includes(request.request_type)) return

    Array.from(target.querySelectorAll("section"))
      .filter((section) => /Fondo y comprobacion/i.test(section.textContent || ""))
      .forEach((section) => section.remove())

    const { data: funds } = await client.from("cash_funds").select("*").eq("payment_request_id", request.id).order("created_at", { ascending: false })
    const fund = funds?.[0] || null
    const draft = getDraft(request.id) || cashMetadataFromNotes(request.notes)
    const missing = cashMissingItems(request, fund, draft)
    const method = request.request_type === "check" ? "check" : "cash"
    const canAttempt = request.status === "approved" && !fund && Boolean(window.FluxAuth?.canApprove?.())
    const canCreate = canAttempt && !missing.length
    const typeLabel = method === "check" ? "Cheque" : "Efectivo"

    target.insertAdjacentHTML("beforeend", `
      <section class="decision-card" data-cash-detail-patch>
        <h3>Fondo y comprobacion</h3>
        <p>Esta solicitud se opera como ${escapeHtml(typeLabel.toLowerCase())}. La entrega crea un fondo que despues debe comprobarse con tickets o comprobantes.</p>
        <div class="decision-note ${fund ? "success" : request.status === "approved" ? "warning" : "neutral"}">
          ${fund ? "El fondo ya fue creado y esta disponible para comprobacion." : request.status === "approved" ? "Solicitud aprobada, pendiente de registrar entrega." : "El fondo podra crearse cuando la solicitud este aprobada."}
        </div>
        <div class="detail-grid">
          ${detailCard("Tipo de entrega", typeLabel)}
          ${detailCard("Responsable del gasto", fund ? profileName(fund.responsible_profile_id) : profileName(draft?.responsible_profile_id))}
          ${detailCard("Fecha limite", fund ? formatDate(fund.due_date) : formatDate(draft?.due_date))}
          ${detailCard("Estado del fondo", fund ? cashStatusLabel(fund.status) : "Sin fondo creado")}
          ${detailCard("Monto entregado", fund ? formatCurrency(fund.assigned_amount) : "Sin entrega")}
          ${detailCard("Monto comprobado", fund ? formatCurrency(fund.verified_amount) : "Sin comprobacion")}
          ${detailCard("Saldo pendiente", fund ? formatCurrency(fund.pending_amount) : "Pendiente de crear fondo")}
          ${detailCard("Accion siguiente", cashNextAction(request, fund, missing))}
        </div>
        ${!fund && missing.length ? missingChecklist(missing) : ""}
        <div class="decision-actions">
          ${canCreate ? `<button type="button" class="decision-btn approve" onclick="openCashFundModal('${escapeHtml(request.id)}')">${method === "check" ? "Registrar entrega de cheque" : "Registrar entrega de efectivo"}</button>` : ""}
          ${!canCreate && canAttempt ? `<button type="button" class="decision-btn change" onclick="openCashFundModal('${escapeHtml(request.id)}')">Completar datos y registrar entrega</button>` : ""}
          ${fund ? `<button type="button" class="decision-btn change" onclick="window.location.href='./efectivo.html?fund_id=${escapeHtml(fund.id)}'">Ver en Efectivo y comprobaciones</button>` : `<button type="button" class="decision-btn change" onclick="window.location.href='./pagos_comprobaciones.html'">Ver en Pagos y comprobaciones</button>`}
        </div>
      </section>
    `)
  }

  function cashMissingItems(request, fund, draft) {
    if (fund) return []
    const missing = []
    if (request.status !== "approved") missing.push("La solicitud debe estar aprobada.")
    if (!draft?.responsible_profile_id) missing.push("Falta responsable del gasto.")
    if (!draft?.due_date) missing.push("Falta fecha limite de comprobacion.")
    if (!window.FluxAuth?.canApprove?.()) missing.push("No tienes permisos para registrar entrega.")
    return missing
  }

  function cashNextAction(request, fund, missing) {
    if (fund?.status === "closed") return "Fondo cerrado. La comprobacion fue aprobada."
    if (fund?.status === "receipt_review") return "La comprobacion esta enviada y pendiente de revision."
    if (fund) return "Fondo entregado. El responsable debe comprobarlo."
    if (request.status !== "approved") return "Esperar aprobacion de la solicitud."
    if (missing.length) return "Completar datos de entrega antes de crear el fondo."
    return "Listo para registrar entrega y crear fondo."
  }

  function missingChecklist(items) {
    return `
      <div class="decision-note warning">
        <strong>No se puede registrar la entrega todavia:</strong>
        <ul style="margin:8px 0 0 18px;">
          ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
        </ul>
      </div>`
  }

  function notesWithCashMetadata(notes, payload) {
    const cleanNotes = stripCashMetadata(notes)
    const metadata = [
      `responsible_profile_id=${payload.responsible_profile_id || ""}`,
      `due_date=${payload.due_date || ""}`,
      `delivery_method=${payload.delivery_method || payload.request_type || ""}`,
    ].join("; ")
    return [cleanNotes, `[Cash fund metadata: ${metadata}]`].filter(Boolean).join("\n")
  }

  function stripCashMetadata(notes) {
    return String(notes || "").replace(/\n?\[Cash fund metadata:[^\]]+\]/g, "").trim()
  }

  function cashMetadataFromNotes(notes) {
    const match = String(notes || "").match(/\[Cash fund metadata:\s*([^\]]+)\]/)
    if (!match) return null
    const metadata = {}
    match[1].split(";").forEach((part) => {
      const [key, ...rest] = part.split("=")
      if (!key) return
      metadata[key.trim()] = rest.join("=").trim() || null
    })
    if (!metadata.responsible_profile_id && !metadata.due_date && !metadata.delivery_method) return null
    return {
      responsible_profile_id: metadata.responsible_profile_id || null,
      due_date: metadata.due_date || null,
      delivery_method: metadata.delivery_method || null,
    }
  }

  function getDraft(requestId) {
    try {
      return JSON.parse(localStorage.getItem(`flux-cash-request-${requestId}`) || "null")
    } catch (_) {
      return null
    }
  }

  function profileName(id) {
    if (!id) return "Sin responsable"
    const profile = profiles.find((item) => item.id === id)
    return profile?.full_name || profile?.email || "Sin responsable"
  }

  function cashStatusLabel(status) {
    const labels = {
      active: "Fondo creado",
      pending_receipt: "Pendiente de comprobacion",
      blocked: "Bloqueado",
      receipt_review: "Comprobacion en revision",
      verified: "Verificado",
      closed: "Cerrado",
      cancelled: "Cancelado",
    }
    return labels[status] || status || "Sin estatus"
  }

  function detailCard(label, value) {
    return `<div class="detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`
  }

  function value(id) {
    return String(document.getElementById(id)?.value || "").trim()
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value || 0))
  }

  function formatDate(value) {
    if (!value) return "Sin fecha"
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`)
    return Number.isNaN(date.getTime()) ? "Sin fecha" : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(date)
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;")
  }
})()
