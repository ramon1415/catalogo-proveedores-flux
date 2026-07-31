const fixtures = Object.freeze({
  ready: {
    label: 'Ready',
    tone: 'ready',
    icon: '✓',
    title: 'Listo para confirmar',
    message: 'El fixture cumple readiness, routing, FX y cuenta origen.',
    resultTitle: 'Sin ejecución',
    resultMessage: 'Abre la confirmación para simular el contrato.',
    resultTone: 'neutral',
    actionLabel: 'Revisar confirmación',
    actionDisabled: false,
  },
  confirmation: {
    label: 'Confirmation',
    tone: 'info',
    icon: '◇',
    title: 'Confirmación explícita requerida',
    message: 'Revisa el resumen y acepta el alcance MOCKED antes de continuar.',
    resultTitle: 'Esperando confirmación',
    resultMessage: 'Escape o Cancelar cierran el diálogo sin cambiar el fixture.',
    resultTone: 'neutral',
    actionLabel: 'Abrir confirmación',
    actionDisabled: false,
    openDialog: true,
  },
  processing: {
    label: 'Processing',
    tone: 'info',
    icon: '◌',
    title: 'Procesando fixture local',
    message: 'Se modelan request, vínculo y evento dentro de una transacción simulada.',
    resultTitle: 'Simulación en curso',
    resultMessage: 'No hay tráfico ni writes fuera de esta página.',
    resultTone: 'neutral',
    actionLabel: 'Procesando…',
    actionDisabled: true,
    processing: true,
  },
  success: {
    label: 'Success mocked',
    tone: 'ready',
    icon: '✓',
    title: 'Conversión simulada completa',
    message: 'Exactamente un request, un vínculo y un evento en el fixture local.',
    resultTitle: 'SUCCESS MOCKED · submitted',
    resultMessage: 'payment-request-mock-001 · Draft y documentos preservados.',
    resultTone: 'success',
    actionLabel: 'Repetir confirmación',
    actionDisabled: false,
  },
  replay: {
    label: 'Idempotent replay',
    tone: 'info',
    icon: '↻',
    title: 'Replay idempotente',
    message: 'Mismo actor, action ID y fingerprint: se reutiliza el resultado.',
    resultTitle: 'IDEMPOTENT REPLAY',
    resultMessage: '0 writes adicionales · payment-request-mock-001.',
    resultTone: 'success',
    actionLabel: 'Ver confirmación',
    actionDisabled: false,
  },
  conflict: {
    label: 'Conflict',
    tone: 'danger',
    icon: '!',
    title: 'Conflicto de material',
    message: 'El action ID ya existe con un fingerprint diferente.',
    resultTitle: 'ACTION MATERIAL CONFLICT',
    resultMessage: 'Transacción rechazada · 0 writes · ninguna reparación automática.',
    resultTone: 'danger',
    actionLabel: 'Conversión bloqueada',
    actionDisabled: true,
  },
  'stale-intake': {
    label: 'Stale intake',
    tone: 'warning',
    icon: '!',
    title: 'Intake desactualizado',
    message: 'Status o updated_at ya no coincide con la expectativa del comando.',
    resultTitle: 'STALE INTAKE',
    resultMessage: 'Actualiza la vista antes de volver a confirmar.',
    resultTone: 'warning',
    actionLabel: 'Revisión requerida',
    actionDisabled: true,
  },
  'stale-draft': {
    label: 'Stale draft',
    tone: 'warning',
    icon: '!',
    title: 'Versión del draft desactualizada',
    message: 'Se esperaba v7 y el fixture representa una versión posterior.',
    resultTitle: 'STALE DRAFT VERSION',
    resultMessage: 'El draft permanece intacto y no hay transición.',
    resultTone: 'warning',
    actionLabel: 'Revisión requerida',
    actionDisabled: true,
  },
  'fx-required': {
    label: 'FX required',
    tone: 'warning',
    icon: '$',
    title: 'Tipo de cambio requerido',
    message: 'USD nunca asume 1. Captura un FX positivo con hasta 4 decimales.',
    resultTitle: 'FX REQUIRED',
    resultMessage: 'Moneda USD · rango contractual 0.0001 a 99999999999999.9999.',
    resultTone: 'warning',
    actionLabel: 'FX faltante',
    actionDisabled: true,
    fx: 'Requerido para USD',
  },
  'account-mismatch': {
    label: 'Account mismatch',
    tone: 'danger',
    icon: '!',
    title: 'Cuenta origen incompatible',
    message: 'La cuenta no coincide con empresa, moneda o método de transferencia.',
    resultTitle: 'ACCOUNT MISMATCH',
    resultMessage: 'Cuenta rechazada durante revalidación live simulada.',
    resultTone: 'danger',
    actionLabel: 'Cuenta inválida',
    actionDisabled: true,
    account: 'Cuenta de otra empresa · BLOQUEADA',
  },
  'concept-too-long': {
    label: 'Concept too long',
    tone: 'danger',
    icon: '!',
    title: 'Concepto mayor a 120 caracteres',
    message: 'El contrato bloquea el valor completo y nunca lo trunca.',
    resultTitle: 'CONCEPT TOO LONG',
    resultMessage: '121 caracteres detectados · 0 writes.',
    resultTone: 'danger',
    actionLabel: 'Concepto inválido',
    actionDisabled: true,
    concept: 'C'.repeat(121),
  },
  'already-converted': {
    label: 'Already converted',
    tone: 'info',
    icon: '✓',
    title: 'Intake ya convertido',
    message: 'Existe un triple request, vínculo y evento consistente para otra acción.',
    resultTitle: 'ALREADY CONVERTED',
    resultMessage: 'payment-request-mock-previous · 0 writes.',
    resultTone: 'success',
    actionLabel: 'Sin acción',
    actionDisabled: true,
  },
  'rollback-error': {
    label: 'Rollback error',
    tone: 'danger',
    icon: '↶',
    title: 'Fallo después del insert simulado',
    message: 'La transacción completa se revierte; no sobrevive ningún estado parcial.',
    resultTitle: 'ROLLBACK COMPLETE',
    resultMessage: '0 request · 0 vínculo · 0 transición · 0 evento.',
    resultTone: 'danger',
    actionLabel: 'Rollback verificado',
    actionDisabled: true,
  },
  'invariant-conflict': {
    label: 'Invariant conflict',
    tone: 'danger',
    icon: '!',
    title: 'Invariante inconsistente',
    message: 'Request, vínculo, status y evento no forman un único triple válido.',
    resultTitle: 'INVARIANT CONFLICT',
    resultMessage: 'Fail closed · sin reparación automática.',
    resultTone: 'danger',
    actionLabel: 'Intervención requerida',
    actionDisabled: true,
  },
  'provider-invalid': {
    state: 'provider-invalid',
    label: 'Provider invalid',
    tone: 'danger',
    icon: '!',
    title: 'Proveedor vinculado no disponible',
    summary: 'Proveedor ausente o inactivo en la revalidación live simulada.',
    severity: 'blocking',
    message: 'El proveedor vinculado ya no está disponible o activo. Actualiza el matching antes de convertir.',
    syntheticData: Object.freeze({
      providerStatus: 'inactive',
      source: 'local_fixture',
    }),
    simulatedWrites: Object.freeze({
      committedRequests: 0,
      committedLinks: 0,
      committedEvents: 0,
      draftPreserved: true,
    }),
    expectedResult: 'conversion_blocked_draft_preserved',
    resultTitle: 'PROVIDER INVALID',
    resultMessage: 'Conversión bloqueada · 0 request · 0 vínculo · 0 evento · draft intacto.',
    resultTone: 'danger',
    actionLabel: 'Proveedor inválido',
    actionDisabled: true,
    provider: 'Proveedor no disponible · MOCKED',
  },
  'budget-unavailable': {
    state: 'budget-unavailable',
    label: 'Budget unavailable',
    tone: 'warning',
    icon: '!',
    title: 'Presupuesto MOCKED no disponible',
    summary: 'Presupuesto sintético no disponible o no aprobable.',
    severity: 'blocking',
    message: 'El presupuesto MOCKED no está disponible o no es aprobable para esta conversión.',
    syntheticData: Object.freeze({
      budgetStatus: 'unavailable',
      source: 'local_fixture',
    }),
    simulatedWrites: Object.freeze({
      committedRequests: 0,
      committedLinks: 0,
      committedEvents: 0,
      draftPreserved: true,
    }),
    expectedResult: 'conversion_blocked_draft_preserved',
    resultTitle: 'BUDGET UNAVAILABLE',
    resultMessage: 'Conversión bloqueada · 0 request · 0 vínculo · 0 evento · draft intacto.',
    resultTone: 'warning',
    actionLabel: 'Presupuesto bloqueado',
    actionDisabled: true,
    budgetHeading: 'No disponible · MOCKED',
    budgetPercent: '0%',
    budgetAriaLabel: 'Presupuesto mocked no disponible',
    budgetValues: Object.freeze([
      'NO DISPONIBLE · MOCKED',
      '− $12,500.00',
      'NO CALCULADO · MOCKED',
    ]),
  },
  'fx-invalid': {
    state: 'fx-invalid',
    label: 'FX invalid',
    tone: 'danger',
    icon: '!',
    title: 'Tipo de cambio inválido',
    summary: 'USD con tipo de cambio presente, pero inválido.',
    severity: 'blocking',
    message: 'USD tiene un tipo de cambio presente, pero inválido; no se asume 1 ni se normaliza.',
    syntheticData: Object.freeze({
      currency: 'USD',
      exchangeRate: 0,
      source: 'local_fixture',
    }),
    simulatedWrites: Object.freeze({
      committedRequests: 0,
      committedLinks: 0,
      committedEvents: 0,
      draftPreserved: true,
    }),
    expectedResult: 'conversion_blocked_draft_preserved',
    resultTitle: 'FX INVALID',
    resultMessage: 'Conversión bloqueada · 0 request · 0 vínculo · 0 evento · draft intacto.',
    resultTone: 'danger',
    actionLabel: 'FX inválido',
    actionDisabled: true,
    fx: '0.0000 · INVÁLIDO PARA USD',
  },
})

const elements = {
  scenario: document.querySelector('#scenario-select'),
  statePill: document.querySelector('#state-pill'),
  stateBanner: document.querySelector('#state-banner'),
  stateIcon: document.querySelector('.state-icon'),
  stateTitle: document.querySelector('#state-title'),
  stateMessage: document.querySelector('#state-message'),
  resultPanel: document.querySelector('#result-panel'),
  resultTitle: document.querySelector('#result-title'),
  resultMessage: document.querySelector('#result-message'),
  actionCopy: document.querySelector('#action-copy'),
  openButton: document.querySelector('#open-confirmation'),
  dialog: document.querySelector('#confirmation-dialog'),
  confirmation: document.querySelector('#explicit-confirmation'),
  confirmationHelp: document.querySelector('#confirmation-help'),
  confirmButton: document.querySelector('#confirm-conversion'),
  cancelButton: document.querySelector('#cancel-confirmation'),
  concept: document.querySelector('#concept-value'),
  fx: document.querySelector('#fx-value'),
  account: document.querySelector('#account-value'),
  provider: document.querySelector('.detail-grid dd'),
  budgetHeading: document.querySelector('#budget-heading'),
  budgetRing: document.querySelector('.budget-ring'),
  budgetValues: document.querySelectorAll('.budget-values dd'),
}

let returnFocus = elements.openButton
let completionTimer = null

function fixtureFor(key) {
  return fixtures[key] || fixtures.ready
}

function render(key, options = {}) {
  const fixture = fixtureFor(key)
  document.body.dataset.mockState = key

  elements.statePill.textContent = fixture.label
  elements.statePill.dataset.tone = fixture.tone
  elements.stateBanner.dataset.tone = fixture.tone
  elements.stateBanner.classList.toggle('is-processing', Boolean(fixture.processing))
  elements.stateIcon.textContent = fixture.icon
  elements.stateTitle.textContent = fixture.title
  elements.stateMessage.textContent = fixture.message

  elements.resultPanel.dataset.tone = fixture.resultTone
  elements.resultTitle.textContent = fixture.resultTitle
  elements.resultMessage.textContent = fixture.resultMessage

  elements.openButton.textContent = fixture.actionLabel
  elements.openButton.disabled = fixture.actionDisabled
  elements.actionCopy.textContent = fixture.actionDisabled
    ? 'La validación falla cerrada y conserva todo el estado.'
    : 'El resultado solo modificará este fixture en memoria.'

  elements.concept.textContent = fixture.concept || 'Pago de producción agosto'
  elements.fx.textContent = fixture.fx || '1.0000'
  elements.account.textContent =
    fixture.account || 'BBVA Operación · •••• 2468'
  elements.provider.textContent =
    fixture.provider || 'Producciones Horizonte · MOCK'
  elements.budgetHeading.textContent = fixture.budgetHeading || 'Aprobable'
  elements.budgetRing.textContent = fixture.budgetPercent || '75%'
  elements.budgetRing.setAttribute(
    'aria-label',
    fixture.budgetAriaLabel || '75 por ciento disponible',
  )
  const budgetValues = fixture.budgetValues || [
    '$50,000.00',
    '− $12,500.00',
    '$37,500.00',
  ]
  elements.budgetValues.forEach((element, index) => {
    element.textContent = budgetValues[index]
  })

  if (fixture.openDialog && options.openDialog !== false) {
    openDialog()
  }
}

function openDialog() {
  returnFocus = document.activeElement || elements.openButton
  elements.confirmation.checked = false
  elements.confirmationHelp.textContent = ''
  if (!elements.dialog.open) {
    elements.dialog.showModal()
  }
  elements.confirmation.focus()
}

function closeDialog() {
  if (elements.dialog.open) {
    elements.dialog.close()
  }
}

function chooseState(key, options = {}) {
  if (!fixtures[key]) return
  elements.scenario.value = key
  render(key, options)
}

elements.scenario.addEventListener('change', () => {
  if (completionTimer) {
    clearTimeout(completionTimer)
    completionTimer = null
  }
  chooseState(elements.scenario.value)
})

elements.openButton.addEventListener('click', () => {
  openDialog()
})

elements.cancelButton.addEventListener('click', () => {
  elements.confirmationHelp.textContent = ''
})

elements.confirmButton.addEventListener('click', () => {
  if (!elements.confirmation.checked) {
    elements.confirmationHelp.textContent =
      'Confirma explícitamente el alcance MOCKED para continuar.'
    elements.confirmation.focus()
    return
  }

  closeDialog()
  chooseState('processing', { openDialog: false })
  completionTimer = setTimeout(() => {
    completionTimer = null
    chooseState('success', { openDialog: false })
    elements.resultPanel.focus()
  }, 650)
})

elements.dialog.addEventListener('close', () => {
  elements.confirmationHelp.textContent = ''
  if (returnFocus && typeof returnFocus.focus === 'function') {
    returnFocus.focus()
  }
})

elements.dialog.addEventListener('cancel', () => {
  elements.confirmationHelp.textContent = ''
})

render('ready')
