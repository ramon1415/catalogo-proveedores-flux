;(function paymentBatchFinalReconciliation() {
  "use strict"

  const RPC = Object.freeze({
    context: "get_payment_batch_context",
    preview: "get_payment_operation_confirmation_preview",
    prepareEvidence: "prepare_payment_operation_evidence",
    finalizeEvidence: "finalize_payment_operation_evidence",
    reviewEvidence: "review_payment_operation_evidence",
    confirm: "confirm_payment_operation",
    evidenceAccess: "get_payment_operation_evidence_access",
    batchSummary: "get_payment_batch_reconciliation_summary",
  })
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const state = {
    enabled: false,
    busy: false,
    operationLookupId: null,
    operationId: null,
    batchId: null,
    preview: null,
    commandKeys: new Map(),
    operationRefreshQueued: false,
    batchRefreshQueued: false,
  }

  document.addEventListener("DOMContentLoaded", init)

  async function init() {
    if (!client || !window.FluxAuth) return
    if (window.FluxAuth.ready) await window.FluxAuth.ready()
    if (!window.FluxAuth.state?.session) return
    const { data, error } = await client.rpc(RPC.context)
    if (error) return
    state.enabled = object(data?.capabilities).can_confirm === true
    if (!state.enabled) return
    installConfirmationDialog()
    bindEvents()
    enableCutoverNotice()
  }

  function bindEvents() {
    const batchList = document.getElementById("batchList")
    const batchDetail = document.getElementById("batchDetail")
    const operationDialog = document.getElementById("operationDialog")
    const operationContent = document.getElementById("operationContent")
    const reasonInput = document.getElementById("operationReasonInput")
    const confirmButton = document.getElementById("confirmOperationBtn")

    batchList?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-batch-id]")
      if (!button) return
      state.batchId = button.dataset.batchId
      queueBatchRefresh()
    })
    batchDetail?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-operation-id]")
      if (!button) return
      state.operationLookupId = button.dataset.operationId
      queueOperationRefresh()
    })
    document.addEventListener("click", handleActionClick)
    confirmButton?.addEventListener("click", openConfirmationDialog)
    reasonInput?.addEventListener("input", () => {
      if (state.preview) applyConfirmationAvailability()
    })
    operationDialog?.addEventListener("close", () => {
      state.operationLookupId = null
      state.operationId = null
      state.preview = null
    })

    if (operationContent) {
      new MutationObserver((mutations) => {
        if (mutations.every((mutation) => mutation.target.closest?.(".payment-final-panel"))) return
        if (operationDialog?.open && state.operationLookupId) queueOperationRefresh()
      }).observe(operationContent, { childList: true, subtree: true })
    }
    if (batchDetail) {
      new MutationObserver((mutations) => {
        if (mutations.every((mutation) => mutation.target.closest?.(".payment-final-batch-summary"))) return
        if (state.batchId) queueBatchRefresh()
      }).observe(batchDetail, { childList: true, subtree: true })
    }
  }

  function enableCutoverNotice() {
    const notice = document.getElementById("cutoverNotice")
    const title = notice?.querySelector(".notice-title")
    const description = notice?.querySelector(".notice-desc")
    if (!notice || !title || !description) return
    notice.classList.remove("warning")
    notice.classList.add("success")
    title.textContent = "Conciliación financiera disponible"
    description.textContent = "La confirmación es atómica por operación y exige una evidencia individual revisada."
  }

  function queueOperationRefresh() {
    if (state.operationRefreshQueued) return
    state.operationRefreshQueued = true
    queueMicrotask(async () => {
      state.operationRefreshQueued = false
      await refreshOperation()
    })
  }

  function queueBatchRefresh() {
    if (state.batchRefreshQueued) return
    state.batchRefreshQueued = true
    queueMicrotask(async () => {
      state.batchRefreshQueued = false
      await refreshBatchSummary()
    })
  }

  async function refreshOperation() {
    if (!state.enabled || !state.operationLookupId || state.busy) return
    const { data, error } = await client.rpc(RPC.preview, {
      p_operation_id: state.operationLookupId,
    })
    if (error) return renderOperationUnavailable(friendlyError(error))
    state.preview = object(data)
    state.operationId = state.preview.operation_id
    state.operationLookupId = state.operationId
    renderEvidencePanel()
    applyConfirmationAvailability()
  }

  async function refreshBatchSummary() {
    if (!state.enabled || !state.batchId) return
    const { data, error } = await client.rpc(RPC.batchSummary, {
      p_batch_id: state.batchId,
    })
    if (error) return
    const detail = document.getElementById("batchDetail")
    const heading = detail?.querySelector(".receipt-batch-detail-head")
    if (!detail || !heading) return
    let panel = detail.querySelector(".payment-final-batch-summary")
    if (!panel) {
      panel = document.createElement("section")
      panel.className = "payment-final-batch-summary"
      heading.insertAdjacentElement("afterend", panel)
    }
    const signature = JSON.stringify(data)
    if (panel.dataset.signature === signature) return
    panel.dataset.signature = signature
    panel.innerHTML = `
      <div><span>Estado de conciliación</span><strong>${escapeHtml(batchStatusLabel(data.derived_reconciliation_status))}</strong></div>
      <div><span>Operaciones conciliadas</span><strong>${escapeHtml(data.reconciled_operations || 0)} de ${escapeHtml(data.expected_operations || 0)}</strong></div>
      <p>Cada operación del lote se confirma de forma independiente; dentro de una operación todas sus asignaciones se confirman juntas o ninguna.</p>
    `
  }

  function renderOperationUnavailable(message) {
    const content = document.getElementById("operationContent")
    if (!content || content.querySelector(".payment-final-panel")) return
    content.insertAdjacentHTML("beforeend", `
      <section class="payment-final-panel payment-final-panel-muted">
        <div class="payment-final-heading"><div><span>Paso final</span><h3>Conciliar y publicar evidencia</h3></div></div>
        <p>${escapeHtml(message)}</p>
      </section>
    `)
  }

  function renderEvidencePanel() {
    const content = document.getElementById("operationContent")
    if (!content || !state.preview) return
    let panel = content.querySelector(".payment-final-panel")
    if (!panel) {
      panel = document.createElement("section")
      panel.className = "payment-final-panel"
      content.append(panel)
    }
    const evidence = object(state.preview.evidence)
    const plan = object(state.preview.plan)
    const items = array(plan.items)
    const signature = JSON.stringify({
      evidence,
      canConfirm: state.preview.can_confirm,
      block: state.preview.confirmation_block_reason,
      items,
    })
    if (panel.dataset.signature === signature) return
    panel.dataset.signature = signature
    panel.innerHTML = `
      <div class="payment-final-heading">
        <div><span>Paso final</span><h3>Conciliar y publicar evidencia</h3></div>
        ${statusPill(evidence.status || "not_created")}
      </div>
      <p class="payment-final-intro">Flux genera un PDF privado con una sola página. Finanzas debe abrirlo y confirmar que contiene únicamente esta operación antes de conciliar.</p>
      <div class="payment-final-facts">
        <div><span>Operación</span><strong>${formatMinor(state.preview.amount_minor, state.preview.currency)}</strong></div>
        <div><span>Asignaciones</span><strong>${items.length}</strong></div>
        <div><span>Evidencia</span><strong>${escapeHtml(evidenceLabel(evidence.status))}</strong></div>
      </div>
      ${renderEvidenceActions(evidence)}
      <div class="payment-final-guard ${state.preview.can_confirm ? "ready" : ""}">
        <strong>${state.preview.can_confirm ? "Todo listo para conciliar" : "Aún no se puede conciliar"}</strong>
        <span>${escapeHtml(state.preview.can_confirm ? "La operación, sus asignaciones y la evidencia serán confirmadas en una sola transacción." : blockReason(state.preview.confirmation_block_reason))}</span>
      </div>
      <p class="payment-final-provider-note"><strong>Acceso del proveedor:</strong> deshabilitado hasta contar con una relación de identidad segura entre usuario y proveedor. La evidencia solo es visible para Finanzas.</p>
    `
  }

  function renderEvidenceActions(evidence) {
    const status = evidence.status
    if (!status || status === "not_shareable") {
      return `
        ${status === "not_shareable" ? `<p class="payment-final-rejected">La evidencia anterior se marcó como no compartible: ${escapeHtml(evidence.review_reason || "sin detalle")}</p>` : ""}
        <button class="primary-btn" type="button" data-payment-final-action="generate" ${state.preview.can_prepare_evidence ? "" : "disabled"}>
          ${status === "not_shareable" ? "Generar nueva versión" : "Generar evidencia individual"}
        </button>
      `
    }
    if (status === "pending_upload") {
      return `<button class="primary-btn" type="button" data-payment-final-action="generate">Completar carga de evidencia</button>`
    }
    if (status === "pending_review") {
      return `
        <div class="payment-final-review">
          <button class="secondary-btn" type="button" data-payment-final-action="open">Abrir evidencia individual</button>
          <label class="payment-final-attestation">
            <input type="checkbox" data-payment-final-attestation>
            <span>Confirmo que el PDF contiene una sola operación bancaria y corresponde a las solicitudes mostradas.</span>
          </label>
          <label><span class="f-label">Motivo si no es compartible</span><input class="f-ctrl" data-payment-final-reason maxlength="500" placeholder="Describe el problema (mínimo 10 caracteres)"></label>
          <div class="payment-final-review-actions">
            <button class="secondary-btn" type="button" data-payment-final-action="reject">No es compartible</button>
            <button class="primary-btn" type="button" data-payment-final-action="approve">Aprobar evidencia</button>
          </div>
        </div>
      `
    }
    return `
      <div class="payment-final-shareable">
        <button class="secondary-btn" type="button" data-payment-final-action="open">Ver o descargar evidencia</button>
        <span>Revisada ${formatDateTime(evidence.reviewed_at)}. La descarga usa un enlace privado de 5 minutos.</span>
      </div>
    `
  }

  function applyConfirmationAvailability() {
    const button = document.getElementById("confirmOperationBtn")
    const reason = document.getElementById("confirmDisabledReason")
    if (!button || !state.preview) return
    button.hidden = false
    button.textContent = "Conciliar y publicar evidencia"
    button.disabled = state.busy || state.preview.can_confirm !== true
    if (reason) {
      reason.textContent = state.preview.can_confirm
        ? "Confirma todas las asignaciones de esta operación en una sola transacción y deja la evidencia disponible para Finanzas."
        : blockReason(state.preview.confirmation_block_reason)
    }
  }

  async function handleActionClick(event) {
    const action = event.target.closest("[data-payment-final-action]")?.dataset.paymentFinalAction
    if (!action || state.busy) return
    if (action === "generate") await generateEvidence()
    if (action === "open") await openEvidence(state.preview?.evidence?.id)
    if (action === "approve") await reviewEvidence(true)
    if (action === "reject") await reviewEvidence(false)
  }

  async function generateEvidence() {
    const preview = state.preview
    const source = object(preview?.source_document)
    if (!preview || !source.storage_path || !window.PDFLib?.PDFDocument) {
      return toast("Evidencia no disponible", "No se pudo preparar el PDF individual.", "danger")
    }
    setBusy(true)
    try {
      const sourceDownload = await client.storage.from(source.storage_bucket).download(source.storage_path)
      if (sourceDownload.error) throw sourceDownload.error
      const sourcePdf = await window.PDFLib.PDFDocument.load(
        await sourceDownload.data.arrayBuffer(),
        { ignoreEncryption: false },
      )
      const pageNumber = Number(source.page_number)
      if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > sourcePdf.getPageCount()) {
        throw new Error("source_page_out_of_range")
      }
      const evidencePdf = await window.PDFLib.PDFDocument.create()
      const [copiedPage] = await evidencePdf.copyPages(sourcePdf, [pageNumber - 1])
      evidencePdf.addPage(copiedPage)
      evidencePdf.setTitle("Comprobante de pago")
      evidencePdf.setProducer("Flux Operadora")
      const evidenceDate = new Date(`${preview.application_date}T00:00:00.000Z`)
      if (!Number.isNaN(evidenceDate.getTime())) {
        evidencePdf.setCreationDate(evidenceDate)
        evidencePdf.setModificationDate(evidenceDate)
      }
      const bytes = await evidencePdf.save({ useObjectStreams: false })
      const derivedSha256 = await sha256Hex(bytes)

      let evidence = object(preview.evidence)
      if (evidence.status !== "pending_upload") {
        const prepared = await rpcIdempotent(
          "evidence.prepare",
          preview.operation_id,
          RPC.prepareEvidence,
          { p_operation_id: preview.operation_id },
        )
        evidence = {
          id: prepared.evidence_id,
          status: prepared.status,
          storage_bucket: prepared.storage_bucket,
          storage_path: prepared.storage_path,
        }
      }

      const bucket = client.storage.from(evidence.storage_bucket)
      let finalBytes = bytes
      let finalSha256 = derivedSha256
      const existingObject = await bucket.download(evidence.storage_path)
      if (!existingObject.error) {
        finalBytes = new Uint8Array(await existingObject.data.arrayBuffer())
        const existingPdf = await window.PDFLib.PDFDocument.load(finalBytes, {
          ignoreEncryption: false,
        })
        if (existingPdf.getPageCount() !== 1) throw new Error("existing_evidence_not_single_page")
        finalSha256 = await sha256Hex(finalBytes)
        if (finalSha256 !== derivedSha256) throw new Error("existing_evidence_hash_mismatch")
      } else {
        const missingDetail = `${existingObject.error.statusCode || ""} ${existingObject.error.message || ""}`
        if (!/404|not found|object not found/i.test(missingDetail)) throw existingObject.error
        const upload = await bucket.upload(
          evidence.storage_path,
          new Blob([bytes], { type: "application/pdf" }),
          { contentType: "application/pdf", upsert: false },
        )
        if (upload.error) throw upload.error
      }
      await rpcIdempotent(
        "evidence.finalize",
        evidence.id,
        RPC.finalizeEvidence,
        {
          p_evidence_id: evidence.id,
          p_derived_sha256: finalSha256,
          p_file_size_bytes: finalBytes.byteLength,
        },
      )
      toast("Evidencia generada", "Abre el PDF individual y revisa que solo contenga esta operación.", "success")
      setBusy(false)
      await refreshOperation()
    } catch (error) {
      toast("No se pudo generar la evidencia", friendlyError(error), "danger")
    } finally {
      setBusy(false)
    }
  }

  async function reviewEvidence(shareable) {
    const evidence = object(state.preview?.evidence)
    const panel = document.querySelector(".payment-final-panel")
    const attested = panel?.querySelector("[data-payment-final-attestation]")?.checked === true
    const reason = panel?.querySelector("[data-payment-final-reason]")?.value?.trim() || ""
    if (shareable && !attested) {
      return toast("Revisión requerida", "Confirma que el PDF contiene una sola operación.", "warning")
    }
    if (!shareable && reason.length < 10) {
      return toast("Motivo requerido", "Describe el problema con al menos 10 caracteres.", "warning")
    }
    setBusy(true)
    try {
      await rpcIdempotent(
        "evidence.review",
        evidence.id,
        RPC.reviewEvidence,
        {
          p_evidence_id: evidence.id,
          p_shareable: shareable,
          p_single_operation_attested: shareable && attested,
          p_reason: shareable ? null : reason,
        },
      )
      toast(
        shareable ? "Evidencia aprobada" : "Evidencia no compartible",
        shareable ? "La operación ya puede pasar a conciliación." : "Puedes generar una nueva versión corregida.",
        shareable ? "success" : "warning",
      )
      setBusy(false)
      await refreshOperation()
    } catch (error) {
      toast("No se pudo revisar la evidencia", friendlyError(error), "danger")
    } finally {
      setBusy(false)
    }
  }

  async function openEvidence(evidenceId) {
    if (!evidenceId) return
    setBusy(true)
    try {
      const { data, error } = await client.rpc(RPC.evidenceAccess, {
        p_evidence_id: evidenceId,
      })
      if (error) throw error
      const signed = await client.storage
        .from(data.storage_bucket)
        .createSignedUrl(data.storage_path, Number(data.url_ttl_seconds || 300))
      if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error("evidence_url_unavailable")
      window.open(signed.data.signedUrl, "_blank", "noopener,noreferrer")
    } catch (error) {
      toast("No se pudo abrir la evidencia", friendlyError(error), "danger")
    } finally {
      setBusy(false)
    }
  }

  function installConfirmationDialog() {
    if (document.getElementById("paymentFinalConfirmDialog")) return
    document.body.insertAdjacentHTML("beforeend", `
      <dialog class="payment-final-confirm-dialog" id="paymentFinalConfirmDialog" aria-labelledby="paymentFinalConfirmTitle">
        <div class="modal-content">
          <div class="modal-header">
            <div><p class="receipt-batch-eyebrow">Confirmación financiera</p><h2 id="paymentFinalConfirmTitle">Conciliar operación</h2><p>Esta acción confirma todas las asignaciones de la operación o ninguna.</p></div>
            <button class="icon-btn" type="button" data-payment-final-confirm-close aria-label="Cerrar">×</button>
          </div>
          <div class="modal-scroll" id="paymentFinalConfirmContent"></div>
          <div class="modal-actions">
            <button class="secondary-btn" type="button" data-payment-final-confirm-close>Cancelar</button>
            <button class="primary-btn" id="paymentFinalConfirmSubmit" type="button" disabled>Confirmar conciliación atómica</button>
          </div>
        </div>
      </dialog>
    `)
    const dialog = document.getElementById("paymentFinalConfirmDialog")
    dialog.querySelectorAll("[data-payment-final-confirm-close]").forEach((button) => {
      button.addEventListener("click", () => dialog.close())
    })
    document.getElementById("paymentFinalConfirmSubmit").addEventListener("click", executeConfirmation)
  }

  function openConfirmationDialog() {
    if (!state.preview?.can_confirm || state.busy) return
    const dialog = document.getElementById("paymentFinalConfirmDialog")
    const content = document.getElementById("paymentFinalConfirmContent")
    const items = array(state.preview.plan?.items)
    content.innerHTML = `
      <div class="payment-final-confirm-summary">
        <div><span>Importe total</span><strong>${formatMinor(state.preview.remaining_minor, state.preview.currency)}</strong></div>
        <div><span>Evidencia</span><strong>PDF individual revisado</strong></div>
      </div>
      <h3>Solicitudes que quedarán vinculadas</h3>
      <ul class="payment-final-confirm-list">
        ${items.map((item) => `<li><span>${escapeHtml(item.request_number || "Solicitud")}</span><strong>${formatMinor(item.amount_minor, item.currency)}</strong></li>`).join("")}
      </ul>
      <label class="payment-final-attestation payment-final-confirm-check">
        <input id="paymentFinalConfirmCheck" type="checkbox">
        <span>Confirmo que revisé la operación, los importes y la evidencia. Entiendo que todas estas asignaciones se registrarán juntas.</span>
      </label>
    `
    const check = document.getElementById("paymentFinalConfirmCheck")
    const submit = document.getElementById("paymentFinalConfirmSubmit")
    submit.disabled = true
    check.addEventListener("change", () => { submit.disabled = !check.checked || state.busy })
    dialog.showModal()
  }

  async function executeConfirmation() {
    const dialog = document.getElementById("paymentFinalConfirmDialog")
    const check = document.getElementById("paymentFinalConfirmCheck")
    if (!state.preview?.can_confirm || !check?.checked || state.busy) return
    setBusy(true)
    try {
      const result = await rpcIdempotent(
        "operation.confirm",
        state.preview.operation_id,
        RPC.confirm,
        { p_operation_id: state.preview.operation_id },
      )
      dialog.close()
      toast(
        "Operación conciliada",
        `${formatMinor(result.amount_minor, result.currency)} quedó registrado con evidencia y auditoría.`,
        "success",
      )
      setBusy(false)
      await refreshOperation()
      document.getElementById("refreshBtn")?.click()
    } catch (error) {
      toast("No se pudo conciliar", friendlyError(error), "danger")
    } finally {
      setBusy(false)
    }
  }

  async function rpcIdempotent(scope, targetId, rpcName, args) {
    const mapKey = `${scope}:${targetId}`
    const idempotencyKey = state.commandKeys.get(mapKey) || commandId()
    state.commandKeys.set(mapKey, idempotencyKey)
    const { data, error } = await client.rpc(rpcName, {
      ...args,
      p_idempotency_key: idempotencyKey,
    })
    if (error) throw error
    state.commandKeys.delete(mapKey)
    return object(data)
  }

  function setBusy(busy) {
    state.busy = busy
    document.querySelectorAll("[data-payment-final-action]").forEach((button) => {
      button.disabled = busy
    })
    applyConfirmationAvailability()
  }

  function statusPill(status) {
    const tone = status === "shareable" ? "success"
      : status === "not_shareable" ? "danger"
        : status === "pending_review" ? "warning" : "neutral"
    return `<span class="payment-final-status ${tone}">${escapeHtml(evidenceLabel(status))}</span>`
  }

  function evidenceLabel(status) {
    return ({
      not_created: "Sin generar",
      pending_upload: "Pendiente de carga",
      pending_review: "Pendiente de revisión",
      shareable: "Lista para compartir",
      not_shareable: "No compartible",
    })[status] || "Sin generar"
  }

  function batchStatusLabel(status) {
    return ({
      completed: "Completado",
      partially_completed: "Parcialmente completado",
      failed: "Fallido",
      pending: "Pendiente",
    })[status] || "Pendiente"
  }

  function blockReason(reason) {
    return ({
      bank_operation_already_reconciled: "Esta operación ya fue conciliada.",
      bank_operation_not_reserved: "Primero reserva el importe de la operación.",
      payment_allocation_plan_not_reserved: "La asignación todavía no está reservada.",
      payment_allocation_items_required: "Selecciona al menos una solicitud pagable.",
      payment_allocation_items_stale: "Las solicitudes o sus saldos cambiaron; vuelve a buscarlas.",
      operation_requires_full_atomic_allocation: "Debes asignar todo el remanente de esta operación. No se permiten confirmaciones parciales dentro de una operación.",
      payment_reservation_not_active: "La reserva ya no está activa.",
      payment_reservation_expired: "La reserva venció. Libérala y crea una nueva.",
      payment_reservation_owned_by_another_actor: "La reserva pertenece a otra persona. Quien reservó debe completar la conciliación.",
      payment_reservation_amount_mismatch: "El importe reservado ya no coincide con la asignación.",
      shareable_single_page_evidence_required: "Genera, abre y aprueba la evidencia individual antes de conciliar.",
    })[reason] || "El servidor revalidará estado, permisos, saldos y evidencia antes de confirmar."
  }

  function friendlyError(error) {
    const key = error?.message || error?.code
    const known = {
      source_page_out_of_range: "La página fuente ya no coincide con el PDF.",
      evidence_url_unavailable: "No se pudo generar el enlace privado de cinco minutos.",
      payment_evidence_open_version_exists: "Ya existe una evidencia abierta para esta operación.",
      payment_evidence_not_pending_upload: "La evidencia ya no está pendiente de carga.",
      payment_evidence_not_pending_review: "La evidencia ya fue revisada en otra sesión.",
      existing_evidence_not_single_page: "La carga anterior no contiene exactamente una página y no se reutilizó.",
      existing_evidence_hash_mismatch: "La carga anterior no coincide con la evidencia regenerada y no se sobrescribió.",
      single_operation_attestation_required: "Debes confirmar que el PDF contiene una sola operación.",
      operation_requires_full_atomic_allocation: "Asigna el remanente completo; una operación no admite confirmación parcial.",
      payment_reservation_owned_by_another_actor: "La reserva pertenece a otra persona.",
      bank_operation_already_reconciled: "La operación ya fue conciliada.",
      idempotency_key_conflict: "La misma clave de reintento recibió datos distintos.",
      legacy_payment_receipts_read_only_after_cutover: "La autoridad legacy quedó en modo solo lectura.",
      PGRST202: "El contrato final todavía no está instalado en este ambiente.",
    }
    if (known[key]) return known[key]
    const detail = [error?.message, error?.code].filter(Boolean).join(" ")
    if (/duplicate|409|already exists/i.test(detail)) {
      return "La evidencia privada ya existe y no se sobrescribió. Actualiza el estado antes de continuar."
    }
    if (/permission|42501|row-level|not authorized/i.test(detail)) {
      return "No tienes permisos de Finanzas para esta operación."
    }
    return error?.message || error?.code || String(error || "Error")
  }

  function toast(title, desc, variant) {
    if (window.Components?.showToast) return window.Components.showToast({ title, desc, variant })
    const node = document.createElement("div")
    node.className = `toast-v2 ${variant}`
    node.textContent = `${title}: ${desc}`
    document.getElementById("toastStack")?.append(node)
    setTimeout(() => node.remove(), 5000)
  }

  function commandId() {
    if (!crypto?.randomUUID) throw new Error("secure_id_unavailable")
    return crypto.randomUUID()
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  }

  function formatMinor(value, currency = "MXN") {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: currency || "MXN",
      minimumFractionDigits: 2,
    }).format(Number(value || 0) / 100)
  }

  function formatDateTime(value) {
    if (!value) return "sin fecha"
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? "sin fecha"
      : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date)
  }

  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  }
  function array(value) { return Array.isArray(value) ? value : [] }
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#039;")
  }
})()
