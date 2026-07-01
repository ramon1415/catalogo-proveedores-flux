;(function transferReceiptFollowUpFix() {
  const pageName = (window.location.pathname.split("/").pop() || "").toLowerCase()
  if (pageName !== "pagos_comprobaciones.html") return

  const PERMISSION_MESSAGE = "No tienes permisos para registrar este comprobante. Contacta a un administrador."

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init)
  } else {
    init()
  }

  function init() {
    observeToastStack()
    document.addEventListener("submit", handleSubmitStart, true)
    document.addEventListener("input", handleModalInput, true)
  }

  function observeToastStack() {
    const stack = document.getElementById("toastStack")
    if (!stack || !window.MutationObserver) return
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => handleToastNode(node))
      })
    })
    observer.observe(stack, { childList: true })
  }

  function handleSubmitStart(event) {
    if (event.target?.id !== "transferReceiptForm") return
    clearModalFeedback()
  }

  function handleModalInput(event) {
    if (!event.target?.closest?.("#transferReceiptDialog")) return
    clearModalFeedback()
  }

  function handleToastNode(node) {
    if (!node || node.nodeType !== 1 || !node.classList?.contains("toast")) return
    const titleNode = node.querySelector("strong")
    const messageNode = node.querySelector("span")
    let title = cleanText(titleNode?.textContent) || "Aviso"
    let message = cleanText(messageNode?.textContent)
    let type = toastType(node)

    if (isPermissionMessage(title, message)) {
      title = "No se pudo guardar"
      message = PERMISSION_MESSAGE
      type = "error"
      node.classList.add("error")
      if (titleNode) titleNode.textContent = title
      if (messageNode) messageNode.textContent = message
    }

    const dialog = document.getElementById("transferReceiptDialog")
    if (!dialog?.open) return
    renderModalFeedback(dialog, title, message, type)
  }

  function renderModalFeedback(dialog, title, message, type) {
    const feedback = ensureFeedbackNode(dialog)
    if (!feedback) return
    feedback.className = `transfer-receipt-feedback ${type || "error"}`
    feedback.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`
  }

  function ensureFeedbackNode(dialog) {
    let feedback = dialog.querySelector("[data-transfer-receipt-feedback]")
    if (feedback) return feedback

    feedback = document.createElement("div")
    feedback.dataset.transferReceiptFeedback = ""
    feedback.className = "transfer-receipt-feedback hidden"
    feedback.setAttribute("role", "alert")
    feedback.setAttribute("aria-live", "assertive")

    const scroll = dialog.querySelector(".modal-scroll")
    const introNotice = scroll?.querySelector(".notice")
    if (introNotice?.parentNode) {
      introNotice.parentNode.insertBefore(feedback, introNotice.nextSibling)
    } else if (scroll) {
      scroll.prepend(feedback)
    }
    return feedback
  }

  function clearModalFeedback() {
    const feedback = document.querySelector("#transferReceiptDialog [data-transfer-receipt-feedback]")
    if (!feedback) return
    feedback.className = "transfer-receipt-feedback hidden"
    feedback.textContent = ""
  }

  function isPermissionMessage(title, message) {
    const text = normalize(`${title} ${message}`)
    return text.includes("row-level security") ||
      text.includes("42501") ||
      text.includes("permission") ||
      text.includes("permis") ||
      text.includes("denied") ||
      text.includes("not authorized") ||
      text.includes("consultar esta informacion")
  }

  function toastType(node) {
    if (node.classList.contains("success")) return "success"
    if (node.classList.contains("warning")) return "warning"
    if (node.classList.contains("error")) return "error"
    return "error"
  }

  function cleanText(value) {
    return String(value || "").trim()
  }

  function normalize(value) {
    return cleanText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
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
