import { createHash } from 'node:crypto'

export const CONTRACT_VERSION = 1
export const ACTION_KIND = 'convert_provider_intake_payment_draft'
export const FX_SCALE = 4
export const FX_MIN = '0.0001'
export const FX_MAX = '99999999999999.9999'

class ContractError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = 'ContractError'
    this.code = code
    this.details = details
  }
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function fail(code, details) {
  throw new ContractError(code, details)
}

function normalizeText(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized === '' ? null : normalized
}

function normalizeCurrency(value) {
  const currency = normalizeText(value)?.toUpperCase() ?? null
  if (!currency || !/^[A-Z]{3}$/.test(currency)) fail('currency_invalid')
  return currency
}

function normalizeMethod(value) {
  const method = normalizeText(value)?.toLowerCase() ?? null
  if (!['transfer', 'cash', 'check', 'other'].includes(method)) {
    fail('payment_method_invalid')
  }
  return method
}

function parseFixed(value, scale, maximumScaled, code) {
  if (value === null || value === undefined || value === '') fail(code)
  const source = String(value).trim()
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(source)
  if (!match || (match[2]?.length ?? 0) > scale) fail(code)

  const integer = match[1].replace(/^0+(?=\d)/, '')
  const fraction = (match[2] ?? '').padEnd(scale, '0')
  const scaled = BigInt(integer + fraction)
  if (scaled > maximumScaled) fail(code)

  return {
    source,
    scaled,
    canonical: integer + '.' + fraction,
  }
}

function normalizeAmount(value) {
  const amount = parseFixed(
    value,
    2,
    999999999999999999n,
    'amount_invalid',
  )
  if (amount.scaled <= 0n) fail('amount_invalid')
  return amount
}

function normalizeFx(currency, input) {
  if (currency === 'MXN') {
    if (input === null || input === undefined || input === '') {
      return { scaled: 10000n, canonical: '1.0000', persisted: '1' }
    }
    const supplied = parseFixed(
      input,
      FX_SCALE,
      999999999999999999n,
      'fx_invalid',
    )
    if (supplied.scaled !== 10000n) fail('fx_invalid')
    return { scaled: 10000n, canonical: '1.0000', persisted: '1' }
  }

  if (input === null || input === undefined || input === '') {
    fail('fx_required')
  }
  const fx = parseFixed(
    input,
    FX_SCALE,
    999999999999999999n,
    'fx_invalid',
  )
  if (fx.scaled < 1n) fail('fx_invalid')
  return { ...fx, persisted: fx.canonical }
}

function normalizeConcept(value) {
  const concept = normalizeText(value)
  if (
    !concept ||
    concept.length < 3 ||
    /[\u0000-\u001f\u007f]/.test(concept) ||
    /<[^>]*>/.test(concept)
  ) {
    fail('concept_invalid')
  }
  if (concept.length > 120) fail('concept_too_long')
  return concept
}

function normalizeNotes(value) {
  const notes = normalizeText(value)
  if (
    notes &&
    (
      notes.length > 2000 ||
      /[\u0000-\u001f\u007f]/.test(notes) ||
      /<[^>]*>/.test(notes)
    )
  ) {
    fail('notes_invalid')
  }
  return notes
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    )
  }
  return value
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value))
}

export function fingerprintMaterial(material) {
  return createHash('sha256')
    .update(stableStringify(material), 'utf8')
    .digest('hex')
}

function budgetSnapshot(amount, fx, liveBudget) {
  const product = amount.scaled * fx.scaled
  const budgetAmount = (product + 5000n) / 10000n
  const before = parseFixed(
    liveBudget.availableBefore,
    2,
    999999999999999999n,
    'budget_invalid',
  )
  const after = before.scaled - budgetAmount
  const shortfall = after < 0n ? -after : 0n
  const cents = (scaled) => {
    const sign = scaled < 0n ? '-' : ''
    const absolute = scaled < 0n ? -scaled : scaled
    const digits = absolute.toString().padStart(3, '0')
    return sign + digits.slice(0, -2) + '.' + digits.slice(-2)
  }

  return {
    budgetAmount: cents(budgetAmount),
    decision: after >= 0n ? 'aprobable' : 'bloqueado',
    blockReason: after >= 0n ? null : 'insufficient_budget',
    availableBefore: cents(before.scaled),
    availableAfter: cents(after),
    shortfall: cents(shortfall),
    result: {
      status: after >= 0n ? 'aprobable' : 'bloqueado',
      motivo: after >= 0n ? null : 'insufficient_budget',
      disponible_actual: cents(before.scaled),
      disponible_despues: cents(after),
      faltante: cents(shortfall),
    },
  }
}

function completedInvariant(state) {
  const link = state.intake.createdPaymentRequestId
  const statusConverted = state.intake.status === 'converted'
  const linkedRequest = link
    ? state.paymentRequests.find((request) => request.id === link)
    : null
  const convertedEvents = state.events.filter(
    (event) =>
      event.paymentIntakeId === state.intake.id &&
      event.eventType === 'converted',
  )
  const anyCompletionSignal =
    statusConverted || Boolean(link) || Boolean(linkedRequest) || convertedEvents.length > 0
  const complete =
    statusConverted &&
    Boolean(link) &&
    Boolean(linkedRequest) &&
    convertedEvents.length === 1 &&
    convertedEvents[0].metadata.paymentRequestId === link

  return {
    anyCompletionSignal,
    complete,
    linkedRequest,
    convertedEvents,
  }
}

function buildMaterial(state, command, normalized) {
  const { intake, draft, actor } = state
  return {
    contractVersion: CONTRACT_VERSION,
    actionKind: ACTION_KIND,
    paymentIntakeId: intake.id,
    expectedIntakeStatus: command.expectedIntakeStatus,
    expectedIntakeUpdatedAt: command.expectedIntakeUpdatedAt,
    draftId: draft.id,
    expectedDraftVersion: command.expectedDraftVersion,
    actorProfileId: actor.profileId,
    proveedorId: intake.matchedProveedorId,
    companyId: draft.companyId,
    costCenterId: draft.costCenterId,
    budgetCategoryId: draft.budgetCategoryId,
    budgetMonth: draft.budgetMonth,
    requestedBy: draft.requestedByProfileId,
    approverId: draft.approverProfileId,
    approverAssignmentId: draft.approverAssignmentId,
    approverSelectionSource: draft.approverAssignmentId
      ? 'assigned'
      : 'approval_rules',
    amountRequested: normalized.amount.canonical,
    currency: normalized.currency,
    exchangeRate: normalized.fx.canonical,
    companyBankAccountId: draft.companyBankAccountId,
    paymentMethod: normalized.method,
    scheduledPaymentDate: draft.scheduledPaymentDate,
    concept: normalized.concept,
    description: normalizeText(intake.description),
    notes: normalized.notes,
    requestType: 'provider_payment',
    status: 'submitted',
    isExtraordinaryAdjustment: false,
  }
}

function normalizeMaterialInputs(state, command) {
  const currency = normalizeCurrency(state.draft.currency)
  const amount = normalizeAmount(state.draft.finalAmount)
  const fx = normalizeFx(currency, command.exchangeRate)
  const method = normalizeMethod(state.draft.paymentMethod)
  const concept = normalizeConcept(state.draft.internalConcept)
  const notes = normalizeNotes(state.draft.internalNotes)
  return { currency, amount, fx, method, concept, notes }
}

function validateAuthorization(state) {
  const { actor } = state
  if (!actor?.authenticated || !actor.profileId) fail('not_authenticated')
  if (!['finance', 'admin', 'sysadmin'].includes(actor.role)) {
    fail('conversion_role_required')
  }
  if (!actor.globalAccess && !actor.companyIds?.includes(state.intake.companyId)) {
    fail('company_access_required')
  }
}

function validateReadiness(state, command, normalized) {
  const { intake, draft, live } = state

  if (intake.status !== command.expectedIntakeStatus) {
    fail('stale_intake_status')
  }
  if (
    command.expectedIntakeStatus !== 'in_review' ||
    intake.status !== 'in_review'
  ) {
    fail('intake_not_in_review')
  }
  if (intake.updatedAt !== command.expectedIntakeUpdatedAt) {
    fail('stale_intake_updated_at')
  }
  if (draft.version !== command.expectedDraftVersion) {
    fail('stale_draft_version')
  }
  if (draft.companyId !== intake.companyId) fail('company_mismatch')
  if (!live.company?.active) fail('company_invalid')

  if (
    !intake.matchedProveedorId ||
    !live.provider?.active ||
    live.provider.id !== intake.matchedProveedorId
  ) {
    fail('provider_invalid')
  }

  if (!draft.costCenterId || !live.catalog?.costCenterValid) {
    fail('catalog_invalid')
  }
  if (!draft.budgetCategoryId || !live.catalog?.budgetCategoryValid) {
    fail('catalog_invalid')
  }
  if (
    !draft.budgetMonth ||
    !/^\d{4}-\d{2}-01$/.test(draft.budgetMonth) ||
    !live.catalog?.budgetMonthValid
  ) {
    fail('budget_month_invalid')
  }

  if (
    !draft.requestedByProfileId ||
    !live.requester?.active ||
    !live.requester?.membershipActive
  ) {
    fail('membership_invalid')
  }
  if (
    !draft.approverProfileId ||
    draft.approverProfileId === draft.requestedByProfileId ||
    !live.approver?.active ||
    !live.approver?.membershipActive ||
    !live.approver?.eligible
  ) {
    fail('routing_invalid')
  }

  if (live.routing?.poolActive) {
    if (
      !draft.approverAssignmentId ||
      !live.routing.assignmentActive ||
      !live.routing.assignmentMatches
    ) {
      fail('routing_invalid')
    }
  } else if (
    draft.approverAssignmentId ||
    !live.routing?.approvalRuleAllows
  ) {
    fail('routing_invalid')
  }

  if (!draft.scheduledPaymentDate || !/^\d{4}-\d{2}-\d{2}$/.test(draft.scheduledPaymentDate)) {
    fail('scheduled_date_invalid')
  }

  if (normalized.method === 'transfer') {
    if (!draft.companyBankAccountId) fail('account_required')
    if (!live.account?.active) fail('account_inactive')
    if (live.account.companyId !== intake.companyId) {
      fail('account_company_mismatch')
    }
    if (String(live.account.currency).toUpperCase() !== normalized.currency) {
      fail('account_currency_mismatch')
    }
    if (
      live.account.accountType !== 'bank' ||
      !live.account.accountNumberPresent
    ) {
      fail('account_method_mismatch')
    }
  } else if (draft.companyBankAccountId) {
    fail('account_method_mismatch')
  }

  if (live.readiness !== 'READY_FOR_CONVERSION') {
    fail('draft_not_ready_for_conversion')
  }
}

function buildRequest(state, command, normalized, budget, fingerprint) {
  const { intake, draft } = state
  return {
    id: command.requestId,
    requestNumber: command.requestNumber,
    providerId: null,
    proveedorId: intake.matchedProveedorId,
    companyId: draft.companyId,
    costCenterId: draft.costCenterId,
    budgetCategoryId: draft.budgetCategoryId,
    budgetMonth: draft.budgetMonth,
    requestType: 'provider_payment',
    requestedBy: draft.requestedByProfileId,
    approverId: draft.approverProfileId,
    approverAssignmentId: draft.approverAssignmentId,
    approverSelectionSource: draft.approverAssignmentId
      ? 'assigned'
      : 'approval_rules',
    amountRequested: normalized.amount.canonical,
    currency: normalized.currency,
    exchangeRate: normalized.fx.persisted,
    companyBankAccountId: draft.companyBankAccountId,
    paymentMethod: normalized.method,
    scheduledPaymentDate: draft.scheduledPaymentDate,
    requiresInvoice: false,
    invoiceReceived: false,
    status: 'submitted',
    concept: normalized.concept,
    description: normalizeText(intake.description),
    notes: normalized.notes,
    submittedAt: command.now,
    createdAt: command.now,
    updatedAt: command.now,
    budgetDecision: budget.decision,
    budgetBlockReason: budget.blockReason,
    budgetAvailableBefore: budget.availableBefore,
    budgetAvailableAfter: budget.availableAfter,
    budgetShortfall: budget.shortfall,
    budgetCheckedAt: command.now,
    budgetResult: budget.result,
    isExtraordinaryAdjustment: false,
    conversionFingerprint: fingerprint,
  }
}

function resultFailure(initialState, error, trace, rollbackComplete = false) {
  return {
    state: clone(initialState),
    result: {
      ok: false,
      status: error.code,
      code: error.code,
      writes: {
        paymentRequests: 0,
        intakeLinks: 0,
        convertedEvents: 0,
        approvals: 0,
        batches: 0,
        layouts: 0,
        payments: 0,
        receipts: 0,
        providers: 0,
        files: 0,
        storage: 0,
        notifications: 0,
      },
      rollbackComplete,
      trace,
      details: error.details,
    },
  }
}

export function convertProviderIntakePaymentDraft(initialState, command) {
  const baseline = clone(initialState)
  const working = clone(initialState)
  const trace = []

  try {
    if (!command || typeof command !== 'object') fail('command_required')
    if (!command.actionId) fail('action_id_required')
    if (!command.requestId || !command.requestNumber || !command.now) {
      fail('deterministic_outputs_required')
    }

    validateAuthorization(working)
    trace.push('lock_intake_for_update')
    if (!working.intake) fail('payment_intake_not_found')
    trace.push('lock_draft_after_intake')
    if (!working.draft) fail('conversion_draft_not_found')

    const normalized = normalizeMaterialInputs(working, command)
    const material = buildMaterial(working, command, normalized)
    const fingerprint = fingerprintMaterial(material)
    const invariant = completedInvariant(working)

    if (invariant.anyCompletionSignal && !invariant.complete) {
      fail('invariant_conflict')
    }

    const actionEvent = working.events.find(
      (event) =>
        event.paymentIntakeId === working.intake.id &&
        event.metadata?.actionId === command.actionId,
    )

    if (actionEvent) {
      if (
        !invariant.complete ||
        actionEvent.eventType !== 'converted' ||
        actionEvent.actorProfileId !== working.actor.profileId ||
        actionEvent.metadata.actionKind !== ACTION_KIND ||
        actionEvent.metadata.contractVersion !== CONTRACT_VERSION ||
        actionEvent.metadata.actionFingerprint !== fingerprint ||
        actionEvent.metadata.paymentRequestId !==
          working.intake.createdPaymentRequestId
      ) {
        fail('action_material_conflict')
      }

      return {
        state: baseline,
        result: {
          ok: true,
          status: 'idempotent_replay',
          idempotent: true,
          writes: {
            paymentRequests: 0,
            intakeLinks: 0,
            convertedEvents: 0,
          },
          paymentRequestId: working.intake.createdPaymentRequestId,
          actionFingerprint: fingerprint,
          trace,
        },
      }
    }

    if (invariant.complete) {
      return {
        state: baseline,
        result: {
          ok: true,
          status: 'already_converted',
          idempotent: false,
          writes: {
            paymentRequests: 0,
            intakeLinks: 0,
            convertedEvents: 0,
          },
          paymentRequestId: working.intake.createdPaymentRequestId,
          trace,
        },
      }
    }

    validateReadiness(working, command, normalized)
    trace.push('revalidate_live_contracts')

    const budget = budgetSnapshot(normalized.amount, normalized.fx, working.live.budget)
    const request = buildRequest(
      working,
      command,
      normalized,
      budget,
      fingerprint,
    )

    working.paymentRequests.push(request)
    trace.push('insert_exactly_one_payment_request')

    if (command.failurePoint === 'after_request_insert') {
      fail('failure_after_request_insert')
    }

    working.intake.status = 'converted'
    working.intake.createdPaymentRequestId = request.id
    working.intake.updatedAt = command.now
    trace.push('update_exactly_one_intake_link')

    working.events.push({
      id: command.eventId,
      paymentIntakeId: working.intake.id,
      eventType: 'converted',
      actorProfileId: working.actor.profileId,
      actorType: working.actor.role,
      fromStatus: 'in_review',
      toStatus: 'converted',
      notes: null,
      createdAt: command.now,
      metadata: {
        contractVersion: CONTRACT_VERSION,
        actionKind: ACTION_KIND,
        actionId: command.actionId,
        actionFingerprint: fingerprint,
        actorProfileId: working.actor.profileId,
        paymentRequestId: request.id,
        draftVersion: working.draft.version,
        containsSensitiveFields: false,
      },
    })
    trace.push('append_exactly_one_converted_event')

    const after = completedInvariant(working)
    if (!after.complete) fail('invariant_conflict')
    if (working.paymentRequests.length !== baseline.paymentRequests.length + 1) {
      fail('exactly_one_request_invariant_failed')
    }
    if (working.events.length !== baseline.events.length + 1) {
      fail('exactly_one_event_invariant_failed')
    }

    trace.push('commit_atomic_transaction')
    return {
      state: working,
      result: {
        ok: true,
        status: 'converted',
        idempotent: false,
        paymentRequestId: request.id,
        requestStatus: 'submitted',
        actionFingerprint: fingerprint,
        draftPreserved:
          stableStringify(working.draft) === stableStringify(baseline.draft),
        filesPreserved:
          stableStringify(working.files) === stableStringify(baseline.files),
        writes: {
          paymentRequests: 1,
          intakeLinks: 1,
          convertedEvents: 1,
          approvals: 0,
          batches: 0,
          layouts: 0,
          payments: 0,
          receipts: 0,
          providers: 0,
          files: 0,
          storage: 0,
          notifications: 0,
        },
        trace,
      },
    }
  } catch (error) {
    const contractError =
      error instanceof ContractError
        ? error
        : new ContractError('contract_model_internal_error', {
            message: error.message,
          })
    return resultFailure(
      baseline,
      contractError,
      trace,
      contractError.code === 'failure_after_request_insert',
    )
  }
}

export function makeReadyFixture(overrides = {}) {
  const fixture = {
    actor: {
      authenticated: true,
      profileId: 'profile-finance-001',
      role: 'finance',
      globalAccess: false,
      companyIds: ['company-001'],
    },
    intake: {
      id: 'intake-001',
      companyId: 'company-001',
      status: 'in_review',
      updatedAt: '2026-07-31T12:00:00.000Z',
      matchedProveedorId: 'provider-001',
      createdPaymentRequestId: null,
      description: 'Servicio de producción para evento privado',
    },
    draft: {
      id: 'draft-001',
      paymentIntakeId: 'intake-001',
      companyId: 'company-001',
      costCenterId: 'cost-center-001',
      budgetCategoryId: 'budget-category-001',
      budgetMonth: '2026-08-01',
      companyBankAccountId: 'company-account-001',
      paymentMethod: 'transfer',
      requestedByProfileId: 'profile-finance-001',
      approverProfileId: 'profile-routing-001',
      approverAssignmentId: 'assignment-001',
      finalAmount: '12500.00',
      currency: 'MXN',
      scheduledPaymentDate: '2026-08-07',
      internalConcept: 'Pago de producción agosto',
      internalNotes: 'Fixture sintético sin datos personales',
      version: 7,
    },
    live: {
      company: { active: true },
      provider: { id: 'provider-001', active: true },
      requester: { active: true, membershipActive: true },
      approver: {
        active: true,
        membershipActive: true,
        eligible: true,
      },
      routing: {
        poolActive: true,
        assignmentActive: true,
        assignmentMatches: true,
        approvalRuleAllows: false,
      },
      catalog: {
        costCenterValid: true,
        budgetCategoryValid: true,
        budgetMonthValid: true,
      },
      account: {
        id: 'company-account-001',
        active: true,
        companyId: 'company-001',
        currency: 'MXN',
        accountType: 'bank',
        accountNumberPresent: true,
      },
      budget: { availableBefore: '50000.00' },
      readiness: 'READY_FOR_CONVERSION',
    },
    paymentRequests: [],
    events: [],
    files: [
      {
        id: 'intake-file-001',
        paymentIntakeId: 'intake-001',
        kind: 'invoice_pdf',
      },
    ],
    approvals: [],
    batches: [],
    layouts: [],
    payments: [],
    receipts: [],
    providersMutated: [],
    storageWrites: [],
    notifications: [],
  }

  return mergeFixture(fixture, overrides)
}

function mergeFixture(base, overrides) {
  if (!overrides || typeof overrides !== 'object') return clone(base)
  const output = clone(base)
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = mergeFixture(output[key], value)
    } else {
      output[key] = clone(value)
    }
  }
  return output
}

export function makeReadyCommand(overrides = {}) {
  return {
    expectedIntakeStatus: 'in_review',
    expectedIntakeUpdatedAt: '2026-07-31T12:00:00.000Z',
    expectedDraftVersion: 7,
    exchangeRate: null,
    actionId: 'action-convert-001',
    requestId: 'payment-request-001',
    requestNumber: 'SOL-2026-0001',
    eventId: 'intake-event-converted-001',
    now: '2026-07-31T12:05:00.000Z',
    ...clone(overrides),
  }
}
