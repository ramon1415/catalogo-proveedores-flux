(() => {
  const state = {
    currentRequest: null,
    currentContext: null,
    tableRequestIds: [],
    pendingRequestId: null,
    deepLinkRequestId: new URLSearchParams(window.location.search).get("request_id"),
    deepLinkHandled: false,
    tableSignature: "",
    extraordinarySubmitting: false,
    extraordinaryDraft: null,
    extraordinaryIdempotencyKey: null,
    extraordinaryFacultyCompanyIds: new Set(),
    cancelIntentMode: false,
  }
  const dom = {}
  const executionContextCache = new Map()

  window.FluxBatchExecutionContext = {
    get: getExecutionContext,
    clear: clearExecutionContext,
  }

  document.addEventListener("DOMContentLoaded", init)

  function init() {
    ;[
      "extraordinaryDialog", "extraordinaryForm", "extraordinarySubtitle", "extraordinarySummary", "extraordinaryCategory",
      "extraordinaryReason", "extraordinaryDirector", "extraordinaryAuthorizedAt",
      "extraordinaryAuthorizationMedium", "extraordinaryAuthorizationReference",
      "extraordinaryEvidenceFile", "extraordinaryEvidenceAttestation", "extraordinaryEvidenceAttestationRow",
      "extraordinaryEvidenceStatus", "extraordinaryDirectorAbsent",
      "extraordinaryConfirm", "closeExtraordinaryBtn", "cancelExtraordinaryBtn",
      "submitExtraordinaryBtn", "revokeExtraordinaryDialog", "revokeExtraordinaryForm",
      "revokeExtraordinaryReason", "closeRevokeExtraordinaryBtn", "cancelRevokeExtraordinaryBtn",
      "submitRevokeExtraordinaryBtn",
    ].forEach((id) => { dom[id] = document.getElementById(id) })

    dom.closeExtraordinaryBtn?.addEventListener("click", closeExtraordinaryDialog)
    dom.cancelExtraordinaryBtn?.addEventListener("click", closeExtraordinaryDialog)
    dom.extraordinaryForm?.addEventListener("submit", authorizeExtraordinary)
    dom.closeRevokeExtraordinaryBtn?.addEventListener("click", closeRevokeDialog)
    dom.cancelRevokeExtraordinaryBtn?.addEventListener("click", closeRevokeDialog)
    dom.revokeExtraordinaryForm?.addEventListener("submit", revokeExtraordinary)
    document.getElementById("detailContent")?.addEventListener("click", handleDetailAction)
    dom.extraordinaryEvidenceFile?.addEventListener("change", syncOptionalEvidence)
    document.addEventListener("flux:extraordinary-intent-created", handleCreatedIntent)
    loadExtraordinaryFaculties()
    startDomAdapter()
  }

  function startDomAdapter() {
    const tableBody = document.getElementById("requestsTableBody")
    const detailDialog = document.getElementById("detailDialog")
    document.addEventListener("click", captureRequestDetailClick, true)

    if (tableBody) {
      new MutationObserver(syncRequestRows).observe(tableBody, { childList: true, subtree: true })
      syncRequestRows()
    }
    if (detailDialog) {
      new MutationObserver(() => {
        if (detailDialog.open) handleDetailDialogOpened()
        else resetDetailState()
      }).observe(detailDialog, { attributes: true, attributeFilter: ["open"] })
    }
  }

  function captureRequestDetailClick(event) {
    const button = event.target.closest("button[onclick*='openRequestDetail']")
    if (!button) return
    const requestId = requestIdFromDetailButton(button)
    if (requestId) state.pendingRequestId = requestId
  }

  function requestIdFromDetailButton(button) {
    const source = button?.getAttribute("onclick") || ""
    return source.match(/openRequestDetail\(['\"]([^'\"]+)['\"]\)/)?.[1] || null
  }

  function syncRequestRows() {
    const rows = [...document.querySelectorAll("#requestsTableBody tr")]
    const requestIds = []
    rows.forEach((row) => {
      const button = row.querySelector("button[onclick*='openRequestDetail']")
      const requestId = requestIdFromDetailButton(button)
      if (!requestId) return
      row.dataset.paymentRequestId = requestId
      requestIds.push(requestId)
    })

    const signature = requestIds.join("|")
    state.tableRequestIds = requestIds
    if (signature !== state.tableSignature) {
      state.tableSignature = signature
      decorateExtraordinaryRows(requestIds)
    }

    if (!state.deepLinkHandled && state.deepLinkRequestId) {
      const target = rows.find((row) => row.dataset.paymentRequestId === state.deepLinkRequestId)
      const button = target?.querySelector("button[onclick*='openRequestDetail']")
      if (button) {
        state.deepLinkHandled = true
        state.pendingRequestId = state.deepLinkRequestId
        window.setTimeout(() => button.click(), 0)
      }
    }
  }

  async function handleDetailDialogOpened() {
    const requestId = state.pendingRequestId || state.deepLinkRequestId
    if (!requestId) return
    const request = await loadRequestSummary(requestId)
    if (!document.getElementById("detailDialog")?.open || state.pendingRequestId !== requestId) return
    state.currentRequest = request
    await loadExecutionContext()
  }

  async function loadRequestSummary(requestId) {
    const { data: request, error } = await supabaseClient
      .from("payment_requests")
      .select("id,request_number,company_id,proveedor_id,request_type,payment_method,amount_requested,currency,status,extraordinary_state")
      .eq("id", requestId)
      .maybeSingle()
    if (error || !request) return null

    const [companyResult, providerResult] = await Promise.all([
      request.company_id
        ? supabaseClient.from("companies").select("name,legal_name").eq("id", request.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      request.proveedor_id
        ? supabaseClient.from("proveedores").select("alias,nombre_completo").eq("id", request.proveedor_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const company = companyResult.data || {}
    const provider = providerResult.data || {}
    return {
      id: request.id,
      companyId: request.company_id,
      extraordinaryState: request.extraordinary_state || "normal",
      requestNumber: request.request_number,
      companyName: company.legal_name || company.name || "Sin empresa",
      providerName: provider.alias || provider.nombre_completo || "Sin proveedor",
      amount: request.amount_requested,
      currency: request.currency || "MXN",
      paymentMethod: request.payment_method || request.request_type || "-",
      status: request.status,
    }
  }

  function resetDetailState() {
    const requestId = state.currentRequest?.id || state.pendingRequestId
    state.currentRequest = null
    state.currentContext = null
    state.pendingRequestId = null
    clearExecutionContext(requestId)
    removeExecutionPanel()
  }

  function clearExecutionContext(requestId) {
    if (requestId) executionContextCache.delete(requestId)
    else executionContextCache.clear()
  }

  async function getExecutionContext(requestId, options = {}) {
    if (!requestId) return { data: null, error: new Error("payment_request_id_required") }
    if (options.force) executionContextCache.delete(requestId)
    if (!executionContextCache.has(requestId)) {
      const request = Promise.resolve(supabaseClient.rpc("get_payment_request_execution_context", {
        p_payment_request_id: requestId,
      })).catch((error) => ({ data: null, error }))
      executionContextCache.set(requestId, request)
    }
    return executionContextCache.get(requestId)
  }

  async function decorateExtraordinaryRows(requestIds) {
    if (!requestIds.length) return
    requestIds.forEach((requestId) => {
      document.querySelector(`[data-payment-request-id="${cssEscape(requestId)}"] [data-extraordinary-row-badge]`)?.remove()
    })
    const { data, error } = await supabaseClient
      .from("payment_request_extraordinary_authorizations")
      .select("payment_request_id,category,status,authorized_at")
      .in("payment_request_id", requestIds)
      .in("status", ["draft", "active", "consumed_pending_ratification", "ratified", "disputed"])
      .order("authorized_at", { ascending: true })
    if (error) return

    const active = new Map((data || []).map((row) => [row.payment_request_id, row]))
    requestIds.forEach((requestId) => {
      const row = document.querySelector(`[data-payment-request-id="${cssEscape(requestId)}"]`)
      const record = active.get(requestId)
      if (!row || !record || row.querySelector("[data-extraordinary-row-badge]")) return
      const folio = row.querySelector("td:first-child .cell-main")
      folio?.insertAdjacentHTML(
        "afterend",
        `<span class="badge warning extraordinary-row-badge" data-extraordinary-row-badge>${record.status === "draft" ? "Evidencia pendiente" : "Extraordinario"}</span>`
      )
    })
  }

  async function loadExecutionContext() {
    const requestId = state.currentRequest?.id
    if (!requestId) return
    removeExecutionPanel()
    const { data, error } = await getExecutionContext(requestId)
    if (state.currentRequest?.id !== requestId) return
    if (error) return
    state.currentContext = data || null
    renderExecutionPanel()
  }

  function renderExecutionPanel() {
    removeExecutionPanel()
    const context = state.currentContext
    const request = state.currentRequest
    const host = document.getElementById("detailContent")
    if (!context || !request || !host) return
    const extra = context.extraordinary
    const extraordinaryUiReady = Boolean(dom.extraordinaryDialog && dom.extraordinaryForm)
    const batch = context.latest_batch
    const hasExplicitFaculty = state.extraordinaryFacultyCompanyIds.has(request.companyId)
    const intentOpen = ["extraordinary_requested", "extraordinary_draft"].includes(request.extraordinaryState)
    if (!hasExplicitFaculty && !extra && !batch) return

    const panel = document.createElement("section")
    panel.id = "batchExecutionPanel"
    panel.className = `batch-execution-panel${extra ? " extraordinary" : ""}`
    if (extra) {
      const secure = extra.secure_contract === true
      const status = extraordinaryStatusLabel(extra.status, secure)
      const tone = ["active", "ratified"].includes(extra.status)
        ? "success"
        : ["disputed", "legacy_quarantined", "revoked", "expired"].includes(extra.status)
          ? "danger"
          : "warning"
      const director = secure
        ? `<span>Dirección externa: ${escapeHtml(extra.external_director_name || "Sin identificar")}</span>`
        : ""
      const validity = extra.valid_until
        ? `<span>Vigente hasta ${escapeHtml(formatDateTime(extra.valid_until))}</span>`
        : ""
      const ratification = extra.ratification_due_at && ["consumed_pending_ratification", "ratified", "disputed"].includes(extra.status)
        ? `<span>Ratificación límite ${escapeHtml(formatDateTime(extra.ratification_due_at))}</span>`
        : ""
      const evidence = extra.evidence_finalized
        ? `<span>Evidencia privada verificada · SHA-256 ${escapeHtml(String(extra.evidence_sha256 || "").slice(0, 12))}…</span>`
        : secure && extra.status === "draft"
          ? `<span>Falta cargar y validar la evidencia.</span>`
          : ""
      const resume = secure && extra.status === "draft" && extra.can_resume
        ? `<button class="primary-btn" type="button" data-batch-execution-action="authorize">Continuar carga de evidencia</button>`
        : ""
      const revoke = extra.can_revoke
        ? `<button class="secondary-btn" type="button" data-batch-execution-action="revoke">Revocar autorización</button>`
        : ""
      panel.innerHTML = `
        <div class="batch-execution-head"><div><strong>${secure ? "Contingencia extraordinaria con autorización externa" : "Autorización extraordinaria histórica"}</strong><span>${escapeHtml(categoryLabel(extra.category))}</span></div><span class="badge ${tone}">${escapeHtml(status)}</span></div>
        <div class="batch-execution-meta"><span>Registró ${escapeHtml(extra.authorized_by_name || "Finanzas")}</span><span>${escapeHtml(formatDateTime(extra.authorized_at))}</span>${director}${validity}${ratification}${evidence}</div>
        <p>${escapeHtml(extra.reason || "Sin motivo registrado")}</p>
        ${extra.status === "disputed" ? `<div class="batch-execution-meta"><span>Discrepancia: ${escapeHtml(extra.dispute_reason || "Requiere revisión.")}</span></div>` : ""}
        ${resume || revoke ? `<div class="batch-execution-actions">${resume}${revoke}</div>` : ""}`
    } else {
      const batchText = batch
        ? `${escapeHtml(batch.batch_label || "Corte")} - ${escapeHtml(batchStatusLabel(batch.batch_status, batch.director_status))}`
        : "Sin corte activo"
      const staleDirectionNotice = context.direction_approval_stale
        ? `<div class="batch-execution-meta"><span>Los datos de la solicitud cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.</span></div>`
        : ""
      const budgetLabel = context.budget_validation_current ? "Presupuesto validado" : "Presupuesto por revisar"
      panel.innerHTML = `
        <div class="batch-execution-head"><div><strong>Ruta de autorizacion y pago</strong><span>${batchText}</span></div>${context.budget_validation_current ? `<span class="badge success">${budgetLabel}</span>` : `<span class="badge warning">${budgetLabel}</span>`}</div>
        ${staleDirectionNotice}
        ${renderApprovalTimeline(context.approval_history)}
        ${hasExplicitFaculty && intentOpen && extraordinaryUiReady ? `<div class="batch-execution-actions"><button class="primary-btn" type="button" data-batch-execution-action="authorize">Completar autorización externa</button><button class="secondary-btn" type="button" data-batch-execution-action="cancel-intent">Cancelar intención extraordinaria</button></div>` : `<div class="batch-execution-meta"><span>${escapeHtml(intentOpen ? blockReasonLabel(context.authorization_block_reason) : "La solicitud sigue el flujo ordinario.")}</span></div>`}
      `
    }
    const firstCard = host.querySelector(".decision-card")
    if (firstCard) host.insertBefore(panel, firstCard)
    else host.appendChild(panel)
  }

  function renderApprovalTimeline(history) {
    const rows = Array.isArray(history) ? history : []
    if (!rows.length) return `<div class="batch-execution-meta"><span>Aun no se incorpora a un corte semanal.</span></div>`
    return `<div class="batch-history-timeline" aria-label="Historial de revisiones de Direccion">${rows.map((row) => `<div class="batch-history-step"><span class="batch-history-dot ${escapeHtml(row.director_status || "pending")}"></span><div><strong>${escapeHtml(reviewLabel(row.review_sequence))} · ${escapeHtml(row.batch_label || "Corte")}</strong><span>${escapeHtml(batchStatusLabel(row.batch_status, row.director_status))}${row.decided_at ? ` · ${escapeHtml(formatDateTime(row.decided_at))}` : ""}</span>${row.reject_reason ? `<small>Motivo: ${escapeHtml(row.reject_reason)}</small>` : ""}${row.correction_note || row.resubmission_note ? `<small>Correccion: ${escapeHtml(row.correction_note || row.resubmission_note)}</small>` : ""}</div></div>`).join("")}</div>`
  }

  function reviewLabel(value) {
    const sequence = Math.max(1, Number(value || 1))
    return sequence === 1 ? "Primera revision" : `Revision ${sequence}`
  }

  function removeExecutionPanel() {
    document.getElementById("batchExecutionPanel")?.remove()
  }

  function handleDetailAction(event) {
    const button = event.target.closest("[data-batch-execution-action]")
    if (!button) return
    if (button.dataset.batchExecutionAction === "authorize") openExtraordinaryDialog()
    if (button.dataset.batchExecutionAction === "revoke") openRevokeDialog()
    if (button.dataset.batchExecutionAction === "cancel-intent") openRevokeDialog(true)
  }

  function openExtraordinaryDialog() {
    const request = state.currentRequest
    const context = state.currentContext
    const existing = context?.extraordinary
    const canResume = existing?.secure_contract === true && existing.status === "draft" && existing.can_resume
    const canStart = request
      && request.extraordinaryState === "extraordinary_requested"
      && state.extraordinaryFacultyCompanyIds.has(request.companyId)
    if (!request || (!canStart && !canResume)) return
    dom.extraordinaryForm.reset()
    state.extraordinaryDraft = canResume
      ? {
          authorization_id: existing.id,
          storage_bucket: existing.storage_bucket,
          storage_path: existing.storage_path,
        }
      : null
    state.extraordinaryIdempotencyKey = `external-auth:${request.id}:${crypto.randomUUID()}`
    const policy = context.extraordinary_policy || {}
    const directors = Array.isArray(context.eligible_external_directors)
      ? context.eligible_external_directors
      : []
    dom.extraordinaryDirector.innerHTML = `<option value="">Selecciona...</option>${directors.map((director) => `<option value="${escapeHtml(director.profile_id)}">${escapeHtml(director.name || "Director")}</option>`).join("")}`
    const allowedCategories = new Set(Array.isArray(policy.allowed_categories) ? policy.allowed_categories : [])
    Array.from(dom.extraordinaryCategory.options).forEach((option) => {
      if (!option.value) return
      option.disabled = allowedCategories.size > 0 && !allowedCategories.has(option.value)
      option.hidden = option.disabled
    })
    dom.extraordinarySubtitle.textContent = canResume
      ? "Completa la evidencia pendiente. La solicitud aún no está habilitada para layout."
      : `La autorización tendrá una vigencia máxima de ${Number(policy.authorization_valid_hours || 0)} horas.`
    dom.extraordinarySummary.innerHTML = [
      summaryItem("Folio", request.requestNumber || "Sin folio"),
      summaryItem("Empresa", request.companyName || "Sin empresa"),
      summaryItem("Proveedor", request.providerName || "Sin proveedor"),
      summaryItem("Monto", formatMoney(request.amount, request.currency)),
      summaryItem("Moneda", request.currency || "MXN"),
      summaryItem("Límite de política", formatMoney(policy.max_amount_mxn || 0, "MXN")),
    ].join("")
    ;[
      dom.extraordinaryDirector,
      dom.extraordinaryAuthorizedAt,
      dom.extraordinaryAuthorizationMedium,
      dom.extraordinaryAuthorizationReference,
      dom.extraordinaryCategory,
      dom.extraordinaryReason,
    ].forEach((field) => { field.disabled = canResume })
    if (canResume) {
      dom.extraordinaryDirector.value = existing.external_director_profile_id || ""
      dom.extraordinaryAuthorizedAt.value = toLocalDateTimeInput(existing.external_authorized_at)
      dom.extraordinaryCategory.value = existing.category || ""
      dom.extraordinaryReason.value = existing.reason || ""
      dom.extraordinaryAuthorizationMedium.value = existing.authorization_medium || ""
      dom.extraordinaryAuthorizationReference.value = existing.authorization_reference || ""
      dom.extraordinaryDirectorAbsent.checked = existing.director_absence_confirmed !== false
      dom.extraordinaryConfirm.checked = existing.cannot_wait_confirmed !== false
      showExtraordinaryStatus("Borrador recuperado. Puedes activar sin evidencia o adjuntar un archivo opcional.", "warning")
    } else {
      dom.extraordinaryAuthorizedAt.value = toLocalDateTimeInput(new Date())
      hideExtraordinaryStatus()
    }
    dom.extraordinaryDialog.showModal()
    syncOptionalEvidence()
    setTimeout(() => (canResume ? dom.extraordinaryEvidenceFile : dom.extraordinaryDirector)?.focus(), 0)
  }

  function closeExtraordinaryDialog() {
    if (state.extraordinarySubmitting) return
    if (dom.extraordinaryDialog?.open) dom.extraordinaryDialog.close()
  }

  async function authorizeExtraordinary(event) {
    event.preventDefault()
    if (state.extraordinarySubmitting) return

    const context = state.currentContext
    const existing = context?.extraordinary
    const canResume = existing?.secure_contract === true && existing.status === "draft"
    const category = dom.extraordinaryCategory.value
    const reason = dom.extraordinaryReason.value.trim()
    const directorId = dom.extraordinaryDirector.value
    const externalAuthorizedAt = dom.extraordinaryAuthorizedAt.value
    const authorizationMedium = dom.extraordinaryAuthorizationMedium.value
    const authorizationReference = dom.extraordinaryAuthorizationReference.value.trim()
    const evidenceFile = dom.extraordinaryEvidenceFile.files?.[0] || null

    if (!canResume) {
      if (!directorId) return extraordinaryFieldError(dom.extraordinaryDirector, "Selecciona a la persona que autorizó externamente.")
      if (!externalAuthorizedAt) return extraordinaryFieldError(dom.extraordinaryAuthorizedAt, "Captura la fecha y hora de la autorización.")
      if (!authorizationMedium) return extraordinaryFieldError(dom.extraordinaryAuthorizationMedium, "Selecciona el medio de autorización.")
      if (authorizationReference.length < 8) return extraordinaryFieldError(dom.extraordinaryAuthorizationReference, "Captura una referencia completa de al menos 8 caracteres.")
      if (!category) return extraordinaryFieldError(dom.extraordinaryCategory, "Selecciona una categoría permitida por la política.")
      if (reason.length < 20) return extraordinaryFieldError(dom.extraordinaryReason, "Explica el motivo de urgencia en al menos 20 caracteres.")
    }
    if (!dom.extraordinaryDirectorAbsent.checked) {
      return extraordinaryFieldError(dom.extraordinaryDirectorAbsent, "Confirma la ausencia del Director.")
    }
    if (!dom.extraordinaryConfirm.checked) {
      return extraordinaryFieldError(dom.extraordinaryConfirm, "Confirma que el pago no puede esperar.")
    }
    if (evidenceFile) {
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(evidenceFile.type)) {
        return extraordinaryFieldError(dom.extraordinaryEvidenceFile, "El archivo debe ser PDF, JPG, PNG o WEBP.")
      }
      if (evidenceFile.size < 1 || evidenceFile.size > 5242880) {
        return extraordinaryFieldError(dom.extraordinaryEvidenceFile, "La evidencia debe pesar entre 1 byte y 5 MB.")
      }
      if (!dom.extraordinaryEvidenceAttestation.checked) {
        return extraordinaryFieldError(dom.extraordinaryEvidenceAttestation, "Confirma que la evidencia coincide con la solicitud.")
      }
    }

    state.extraordinarySubmitting = true
    setLoading(dom.submitExtraordinaryBtn, true, "Validando...")
    dom.closeExtraordinaryBtn.disabled = true
    dom.cancelExtraordinaryBtn.disabled = true
    try {
      let draft = state.extraordinaryDraft
      if (!draft) {
        showExtraordinaryStatus("Paso 1 de 3: validando facultad, presupuesto y gobernanza.", "warning")
        const { data, error } = await supabaseClient.rpc("begin_extraordinary_authorization", {
          p_payment_request_id: state.currentRequest.id,
          p_category: category,
          p_reason: reason,
          p_external_director_profile_id: directorId,
          p_external_authorized_at: new Date(externalAuthorizedAt).toISOString(),
          p_idempotency_key: state.extraordinaryIdempotencyKey,
          p_authorization_medium: authorizationMedium,
          p_authorization_reference: authorizationReference,
          p_director_absence_confirmed: true,
          p_cannot_wait_confirmed: true,
        })
        if (error) throw error
        draft = data
        state.extraordinaryDraft = draft
      }

      if (!draft?.authorization_id) {
        throw new Error("extraordinary_draft_contract_missing")
      }

      let evidenceSha256 = null
      let evidenceType = null
      if (evidenceFile) {
        if (!draft.storage_bucket || !draft.storage_path) {
          throw new Error("extraordinary_draft_storage_contract_missing")
        }
        evidenceSha256 = await sha256Hex(evidenceFile)
        evidenceType = evidenceTypeFromMedium(authorizationMedium)
        showExtraordinaryStatus("Paso 2 de 3: cargando evidencia opcional al repositorio privado.", "warning")
        const { error: uploadError } = await supabaseClient.storage
          .from(draft.storage_bucket)
          .upload(draft.storage_path, evidenceFile, {
            contentType: evidenceFile.type,
            upsert: false,
            metadata: { sha256: evidenceSha256 },
          })
        if (uploadError) throw uploadError
      } else {
        showExtraordinaryStatus("Paso 2 de 3: sin evidencia adjunta; se conserva la referencia externa.", "warning")
      }

      showExtraordinaryStatus("Paso 3 de 3: revalidando presupuesto y activando.", "warning")
      const { data: activated, error: activateError } = await supabaseClient.rpc("activate_extraordinary_authorization", {
        p_authorization_id: draft.authorization_id,
        p_evidence_type: evidenceType,
        p_evidence_sha256: evidenceSha256,
        p_evidence_mime_type: evidenceFile?.type || null,
        p_evidence_size_bytes: evidenceFile?.size || null,
        p_evidence_matches_request: Boolean(evidenceFile),
        p_idempotency_key: `${state.extraordinaryIdempotencyKey}:activate`,
      })
      if (activateError) throw activateError
      if (activated?.status !== "active") throw new Error("extraordinary_authorization_not_activated")

      state.extraordinaryDraft = null
      if (dom.extraordinaryDialog?.open) dom.extraordinaryDialog.close()
      toast(
        "Extraordinaria activa",
        evidenceFile
          ? "La autorización quedó activa con evidencia privada."
          : "La autorización quedó activa sin evidencia; la referencia externa quedó auditada.",
        "success"
      )
      await refreshCurrentState()
    } catch (error) {
      const message = friendlyError(error)
      showExtraordinaryStatus(message, "danger")
      focusExtraordinaryError(error)
      toast("No se pudo activar el tratamiento extraordinario", message, "danger")
      if (state.extraordinaryDraft) await refreshCurrentState()
    } finally {
      state.extraordinarySubmitting = false
      dom.closeExtraordinaryBtn.disabled = false
      dom.cancelExtraordinaryBtn.disabled = false
      setLoading(dom.submitExtraordinaryBtn, false, "Activar tratamiento extraordinario")
    }
  }

  function openRevokeDialog(cancelIntent = false) {
    const stateName = state.currentRequest?.extraordinaryState
    const canCancelIntent = ["extraordinary_requested", "extraordinary_draft"].includes(stateName)
    if (!cancelIntent && !state.currentContext?.extraordinary?.can_revoke) return
    if (cancelIntent && !canCancelIntent) return
    state.cancelIntentMode = Boolean(cancelIntent)
    dom.revokeExtraordinaryForm.reset()
    dom.revokeExtraordinaryDialog.showModal()
  }

  function closeRevokeDialog() {
    state.cancelIntentMode = false
    if (dom.revokeExtraordinaryDialog?.open) dom.revokeExtraordinaryDialog.close()
  }

  async function revokeExtraordinary(event) {
    event.preventDefault()
    const reason = dom.revokeExtraordinaryReason.value.trim()
    if (reason.length < 10) return toast("Motivo requerido", "Explica el motivo en al menos 10 caracteres.", "warning")
    setLoading(dom.submitRevokeExtraordinaryBtn, true, state.cancelIntentMode ? "Cancelando..." : "Revocando...")
    try {
      const rpcName = state.cancelIntentMode
        ? "cancel_payment_request_extraordinary_intent"
        : "revoke_payment_request_extraordinary"
      const { error } = await supabaseClient.rpc(rpcName, {
        p_payment_request_id: state.currentRequest.id,
        p_reason: reason,
      })
      if (error) throw error
      const cancelled = state.cancelIntentMode
      closeRevokeDialog()
      toast(
        cancelled ? "Intención cancelada" : "Autorización revocada",
        cancelled
          ? "La solicitud regresó al flujo ordinario y nunca habilitó bypass."
          : "La autorización dejó de habilitar el pago y conserva su historial.",
        "success"
      )
      const refreshed = await loadRequestSummary(state.currentRequest.id)
      if (refreshed) state.currentRequest = refreshed
      await refreshCurrentState()
    } catch (error) {
      toast("No se pudo completar la acción", friendlyError(error), "danger")
    } finally {
      setLoading(dom.submitRevokeExtraordinaryBtn, false, "Confirmar")
    }
  }

  async function refreshCurrentState() {
    clearExecutionContext(state.currentRequest?.id)
    await loadExecutionContext()
    await decorateExtraordinaryRows(state.tableRequestIds)
  }

  async function loadExtraordinaryFaculties() {
    const { data, error } = await supabaseClient.rpc("current_extraordinary_faculty_company_ids")
    state.extraordinaryFacultyCompanyIds = new Set(
      error || !Array.isArray(data) ? [] : data.filter(Boolean)
    )
  }

  async function handleCreatedIntent(event) {
    const requestId = event.detail?.paymentRequestId
    if (!requestId) return
    state.pendingRequestId = requestId
    const request = await loadRequestSummary(requestId)
    if (!request) return
    state.currentRequest = request
    await loadExecutionContext()
    if (state.currentRequest?.extraordinaryState === "extraordinary_requested") {
      openExtraordinaryDialog()
    }
  }

  function syncOptionalEvidence() {
    const hasFile = Boolean(dom.extraordinaryEvidenceFile?.files?.[0])
    dom.extraordinaryEvidenceAttestationRow?.classList.toggle("hidden", !hasFile)
    if (!hasFile && dom.extraordinaryEvidenceAttestation) {
      dom.extraordinaryEvidenceAttestation.checked = false
    }
  }

  function evidenceTypeFromMedium(value) {
    return ({
      whatsapp: "whatsapp_export",
      email: "email",
      signed_document: "signed_document",
    })[value] || "other"
  }

  function extraordinaryStatusLabel(status, secure) {
    if (!secure) {
      return ({
        legacy_consumed_unverified: "Histórico consumido · sin verificación nueva",
        legacy_quarantined: "Histórico en cuarentena",
        revoked: "Histórico revocado",
      })[status] || "Histórico contenido"
    }
    return ({
      draft: "Extraordinaria solicitada",
      active: "Extraordinaria activa",
      consumed_pending_ratification: "Extraordinaria / pendiente de ratificación",
      ratified: "Ratificada",
      revoked: "Revocada",
      expired: "Vencida",
      disputed: "En discrepancia",
      materially_invalidated: "Invalidada por cambio material",
    })[status] || status || "Sin estado"
  }

  function categoryLabel(value) {
    return ({
      operational_emergency: "Emergencia operativa / fuga",
      urgent_reimbursement: "Reembolso urgente",
      urgent_termination: "Desvinculacion o finiquito urgente",
      critical_service: "Servicio critico",
      other: "Otro",
    })[value] || value || "Sin categoria"
  }

  function paymentMethodLabel(value) {
    return ({
      transfer: "Transferencia",
      cash: "Efectivo",
      check: "Cheque",
      online_purchase: "Compra en linea",
      provider_payment: "Pago a proveedor",
    })[String(value || "").toLowerCase()] || value || "No especificado"
  }

  function summaryItem(label, value) {
    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
  }

  function batchStatusLabel(batchStatus, directorStatus) {
    if (directorStatus === "rejected") return "Rechazada por Dirección"
    return ({
      draft: "Borrador",
      submitted: "Pendiente de decisión de Dirección",
      approved: "Dirección aprobó · pendiente de liberación",
      partially_approved: "Dirección decidió con rechazos · pendiente de liberación",
      closed: "Aprobada y liberada para pago",
    })[batchStatus] || batchStatus || "Sin estado"
  }

  function blockReasonLabel(value) {
    return ({
      finance_role_required: "Solo Finanzas puede autorizar extraordinarios.",
      extraordinary_policy_disabled: "La contingencia extraordinaria está deshabilitada para esta empresa.",
      external_director_not_active_for_company: "La empresa no tiene un Director activo elegible para esta contingencia.",
      extraordinary_authorization_already_open: "La solicitud ya tiene una contingencia abierta o pendiente de ratificación.",
      payment_request_must_be_finance_approved: "La solicitud requiere validacion de presupuesto antes de continuar.",
      finance_reapproval_required: "Los datos cambiaron y requieren revalidacion de presupuesto.",
      direction_reapproval_required: "Los datos cambiaron despues de la autorizacion de Direccion. Debe enviarse nuevamente a un corte.",
      payment_request_already_executed: "La solicitud ya tiene ejecucion registrada.",
      extraordinary_authorization_already_active: "La solicitud ya tiene autorizacion extraordinaria activa.",
      direction_rejected_request_cannot_be_extraordinary: "Un rechazo de Direccion no puede omitirse como extraordinario.",
      submitted_batch_request_cannot_be_extraordinary: "El corte ya fue enviado a Direccion.",
      remove_request_from_draft_batch_first: "Retira primero la solicitud del corte en borrador.",
      batch_approved_request_cannot_be_extraordinary: "La solicitud ya fue decidida dentro de un corte.",
    })[value] || "No disponible para autorizacion extraordinaria."
  }

  function friendlyError(error) {
    const raw = String(error?.message || error || "Error no identificado")
    const known = {
      explicit_extraordinary_faculty_required: "Tu perfil no tiene una facultad extraordinaria explícita y vigente para esta empresa.",
      extraordinary_intent_required_before_draft: "La solicitud debe estar marcada como Extraordinaria solicitada.",
      external_authorization_medium_required: "Selecciona el medio de autorización externa.",
      external_authorization_reference_required: "Captura una referencia externa completa.",
      director_absence_confirmation_required: "Confirma la ausencia del Director.",
      cannot_wait_confirmation_required: "Confirma que el pago no puede esperar.",
      optional_evidence_must_be_complete_when_present: "Cuando adjuntas evidencia debes completar y confirmar todos sus datos.",
      extraordinary_governance_fields_incomplete: "Faltan datos obligatorios de gobernanza.",
      extraordinary_draft_contract_missing: "El servidor no devolvió un borrador válido.",
      finance_role_required: "Se requiere rol de Finanzas.",
      extraordinary_policy_disabled: "La política extraordinaria está deshabilitada para esta empresa.",
      extraordinary_amount_exceeds_policy: "El importe o la moneda exceden la política extraordinaria de la empresa.",
      extraordinary_category_not_allowed: "La categoría no está permitida por la política de la empresa.",
      extraordinary_reason_too_short: "Explica el motivo operativo en al menos 20 caracteres.",
      external_authorization_time_invalid: "La fecha de autorización es futura, anterior al último cambio material o ya venció.",
      external_director_not_active_for_company: "El Director seleccionado ya no está activo para la empresa.",
      finance_actor_must_differ_from_external_director: "Finanzas y el Director externo deben ser personas distintas.",
      invalid_idempotency_key: "No se pudo establecer la clave idempotente. Cierra y vuelve a abrir el diálogo.",
      idempotency_key_payload_mismatch: "La clave idempotente ya corresponde a otros datos. Cierra y vuelve a abrir el diálogo.",
      extraordinary_authorization_already_open: "Ya existe una contingencia abierta para esta solicitud.",
      request_has_rejection_or_open_batch: "La solicitud tiene un rechazo o un corte abierto y no puede usar la contingencia.",
      budget_revalidation_required: "El presupuesto debe revalidarse antes de registrar la contingencia.",
      evidence_request_match_attestation_required: "Confirma que la evidencia coincide con la solicitud.",
      invalid_evidence_type: "Selecciona un tipo de evidencia permitido.",
      invalid_evidence_sha256: "No se pudo validar la huella SHA-256 del archivo.",
      invalid_evidence_file: "La evidencia debe ser PDF, JPG, PNG o WEBP y pesar como máximo 5 MB.",
      extraordinary_evidence_object_not_found: "La evidencia no quedó disponible en el repositorio privado.",
      extraordinary_evidence_object_metadata_mismatch: "El tipo o tamaño cargado no coincide con el archivo validado.",
      extraordinary_authorization_expired_or_stale: "La autorización externa venció o la solicitud cambió antes de activarse.",
      extraordinary_policy_no_longer_matches: "La política cambió y esta contingencia ya no cumple sus límites.",
      extraordinary_draft_storage_contract_missing: "El servidor no devolvió una ruta privada válida para la evidencia.",
      extraordinary_authorization_not_activated: "La evidencia se procesó, pero la autorización no quedó activa.",
      finance_reapproval_required: "Los datos cambiaron y requieren revalidacion de presupuesto.",
      payment_request_must_be_finance_approved: "La solicitud requiere validacion de presupuesto antes de continuar.",
      payment_request_already_executed: "La solicitud ya tiene ejecucion registrada.",
      extraordinary_authorization_already_active: "Ya existe una autorizacion extraordinaria activa.",
      direction_rejected_request_cannot_be_extraordinary: "No se puede omitir un rechazo previo de Direccion.",
      submitted_batch_request_cannot_be_extraordinary: "No se puede autorizar mientras el corte esta enviado.",
      remove_request_from_draft_batch_first: "Retira primero la solicitud del corte en borrador.",
      batch_approved_request_cannot_be_extraordinary: "La solicitud ya fue aprobada dentro de un corte.",
      extraordinary_already_materialized: "No se puede revocar porque ya fue incorporado a un layout, fondo de efectivo o registro de pago.",
    }
    const key = Object.keys(known).find((item) => raw.includes(item))
    return key ? known[key] : raw
  }

  function focusExtraordinaryError(error) {
    const raw = String(error?.message || error || "")
    const field = [
      [["director", "finance_actor_must_differ"], dom.extraordinaryDirector],
      [["authorization_time", "expired_or_stale"], dom.extraordinaryAuthorizedAt],
      [["category"], dom.extraordinaryCategory],
      [["reason_too_short"], dom.extraordinaryReason],
      [["authorization_medium"], dom.extraordinaryAuthorizationMedium],
      [["authorization_reference"], dom.extraordinaryAuthorizationReference],
      [["evidence", "storage", "sha256", "mime", "metadata"], dom.extraordinaryEvidenceFile],
      [["attestation"], dom.extraordinaryEvidenceAttestation],
    ].find(([keys]) => keys.some((key) => raw.includes(key)))?.[1]
    field?.focus()
  }

  function extraordinaryFieldError(field, message) {
    showExtraordinaryStatus(message, "danger")
    field?.focus()
    toast("Revisa la contingencia", message, "warning")
  }

  function showExtraordinaryStatus(message, tone = "warning") {
    if (!dom.extraordinaryEvidenceStatus) return
    dom.extraordinaryEvidenceStatus.textContent = message
    dom.extraordinaryEvidenceStatus.classList.remove("hidden", "warning", "danger")
    dom.extraordinaryEvidenceStatus.classList.add(tone)
  }

  function hideExtraordinaryStatus() {
    if (!dom.extraordinaryEvidenceStatus) return
    dom.extraordinaryEvidenceStatus.textContent = ""
    dom.extraordinaryEvidenceStatus.classList.add("hidden")
    dom.extraordinaryEvidenceStatus.classList.remove("warning", "danger")
  }

  async function sha256Hex(file) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer())
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  }

  function toLocalDateTimeInput(value) {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    return local.toISOString().slice(0, 16)
  }

  function setLoading(button, loading, label) {
    if (!button) return
    button.disabled = loading
    button.textContent = label
  }

  function toast(title, desc, variant) {
    if (window.Components?.showToast) window.Components.showToast({ title, desc, variant, duration: 6 })
  }

  function formatMoney(value, currency = "MXN") {
    try {
      return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0))
    } catch {
      return `${Number(value || 0).toFixed(2)} ${currency}`
    }
  }

  function formatDateTime(value) {
    if (!value) return "-"
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  }

  function cssEscape(value) {
    return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&")
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char])
  }
})()
