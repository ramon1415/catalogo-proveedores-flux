import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ACTION_KIND,
  CONTRACT_VERSION,
  convertProviderIntakePaymentDraft,
  fingerprintMaterial,
  makeReadyCommand,
  makeReadyFixture,
} from './provider-intake-payment-request-conversion-model.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const read = (relativePath) =>
  readFileSync(resolve(root, relativePath), 'utf8')

const sql = read(
  'docs/analysis/provider-intake-payment-request-conversion-contract.sql',
)
const analysis = read(
  'docs/analysis/provider-intake-payment-request-conversion-2b2.md',
)
const architecture = read(
  'docs/architecture/provider-intake-batch-reconciliation.md',
)
const modelSource = read(
  'scripts/qa/provider-intake-payment-request-conversion-model.mjs',
)
const html = read('provider_intake_conversion_mock.html')
const css = read('provider_intake_conversion_mock.css')
const frontend = read('provider_intake_conversion_mock.js')

const clone = (value) => JSON.parse(JSON.stringify(value))

function failure(state, command, mutate) {
  const nextState = clone(state)
  const nextCommand = clone(command)
  mutate(nextState, nextCommand)
  const pristineState = clone(nextState)
  const pristineCommand = clone(nextCommand)
  const outcome = convertProviderIntakePaymentDraft(nextState, nextCommand)
  assert.deepEqual(nextState, pristineState, 'input state must not mutate')
  assert.deepEqual(nextCommand, pristineCommand, 'command must not mutate')
  assert.deepEqual(outcome.state, pristineState, 'failed transaction must roll back')
  assert.equal(outcome.result.ok, false)
  assert.deepEqual(outcome.result.writes, {
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
  })
  return outcome
}

function countReferenceStatement(pattern) {
  return (sql.match(pattern) ?? []).length
}

test('documentary SQL has the exact non-deployment warning and no executable lines', () => {
  assert.deepEqual(sql.split(/\r?\n/).slice(0, 4), [
    '-- NON_DEPLOYMENT_REFERENCE',
    '-- DO_NOT_APPLY',
    '-- CONTRACT_ONLY',
    '-- NO_SUPABASE_DEV',
  ])

  const nonCommentLines = sql
    .split(/\r?\n/)
    .slice(4)
    .filter((line) => line.trim() && !line.trimStart().startsWith('--'))
  assert.deepEqual(nonCommentLines, [])
  assert.doesNotMatch(
    sql,
    /\bsupabase\s+(?:db|migration)|\bpsql\b|migration\s+repair/i,
  )
})

test('RPC signature, roles, SECURITY DEFINER, and search path are explicit', () => {
  assert.match(
    sql,
    /convert_provider_intake_payment_draft\(\s*--\s+p_payment_intake_id uuid,\s*--\s+p_expected_intake_status text,\s*--\s+p_expected_intake_updated_at timestamptz,\s*--\s+p_expected_draft_version integer,\s*--\s+p_exchange_rate numeric,\s*--\s+p_action_id uuid\s*--\s+\) returns jsonb/i,
  )
  assert.match(sql, /security definer/i)
  assert.match(sql, /set search_path = public, pg_temp/i)
  assert.match(sql, /not_authenticated/i)
  assert.match(sql, /flux_finance_roles/)
  assert.match(sql, /array\['admin'\]::text\[\]/)
  assert.match(sql, /flux_sysadmin_roles/)
  assert.match(sql, /provider_intake_assert_company_access/)
})

test('lock order is intake first and draft second', () => {
  const intakeLock = sql.indexOf('--   from public.payment_intake\n')
  const draftLock = sql.indexOf(
    '--   from public.payment_intake_conversion_drafts\n',
  )
  const firstForUpdate = sql.indexOf('--   for update;', intakeLock)
  const secondForUpdate = sql.indexOf('--   for update;', draftLock)
  assert.ok(intakeLock >= 0)
  assert.ok(firstForUpdate > intakeLock)
  assert.ok(draftLock > firstForUpdate)
  assert.ok(secondForUpdate > draftLock)
})

test('optimistic guards, readiness, and live revalidation are present', () => {
  for (const token of [
    'p_expected_intake_status',
    'p_expected_intake_updated_at',
    'p_expected_draft_version',
    'stale_intake_status',
    'stale_intake_updated_at',
    'stale_draft_version',
    'READY_FOR_CONVERSION',
    'public.proveedores',
    'public.companies',
    'public.company_cost_centers',
    'public.cost_centers',
    'public.company_cost_center_budget_categories',
    'public.budget_categories',
    'public.approver_assignments',
    'public.company_bank_accounts',
    'has_active_company_membership',
    'is_payment_request_approver_for_company',
    'payment_request_rule_allows',
  ]) {
    assert.ok(sql.includes(token), 'missing contract token: ' + token)
  }
})

test('mapping, FX, account, concept, and fingerprint contracts are complete', () => {
  for (const token of [
    "'proveedor_id',",
    "'company_id',",
    "'cost_center_id',",
    "'budget_category_id',",
    "'budget_month',",
    "'requested_by',",
    "'approver_id',",
    "'approver_assignment_id',",
    "'amount_requested',",
    "'currency',",
    "'exchange_rate',",
    "'company_bank_account_id',",
    "'payment_method',",
    "'scheduled_payment_date',",
    "'concept',",
    "'description',",
    "'notes',",
    "'request_type',",
    "'status',",
  ]) {
    assert.ok(sql.includes(token), 'missing fingerprint mapping: ' + token)
  }

  assert.match(sql, /numeric\(18,4\)/)
  assert.match(sql, /0\.0001/)
  assert.match(sql, /99999999999999\.9999/)
  assert.match(sql, /v_currency = 'MXN'/)
  assert.match(sql, /v_exchange_rate := 1\.0000/)
  assert.match(sql, /fx_required/)
  assert.match(sql, /scale\(p_exchange_rate\) > 4/)
  assert.match(sql, /account_company_mismatch/)
  assert.match(sql, /account_currency_mismatch/)
  assert.match(sql, /account_method_mismatch/)
  assert.match(sql, /char_length\(v_concept\) > 120/)
  assert.match(sql, /concept_too_long/)
  assert.doesNotMatch(sql, /\b(?:left|substr|substring)\s*\(\s*v_concept/i)
  assert.match(sql, /extensions\.digest/)
  assert.match(sql, /sha256/i)
})

test('idempotency, replay, material conflict, and invariant conflict are explicit', () => {
  assert.match(sql, /payment_intake_events_action_id_uidx/)
  assert.match(sql, /metadata ->> 'action_id'/)
  assert.match(sql, /action_fingerprint/)
  assert.match(sql, /actor_profile_id/)
  assert.match(sql, /idempotent_replay/)
  assert.match(sql, /action_material_conflict/)
  assert.match(sql, /already_converted/)
  assert.match(sql, /invariant_conflict/)
  assert.match(sql, /writes', 0/)
})

test('reference contains exactly one request, link, and event mutation and no forbidden direct mutation', () => {
  assert.equal(
    countReferenceStatement(/--   insert into public\.payment_requests \(/g),
    1,
  )
  assert.equal(
    countReferenceStatement(/--   update public\.payment_intake\n/g),
    1,
  )
  assert.equal(
    countReferenceStatement(/--   insert into public\.payment_intake_events \(/g),
    1,
  )

  for (const table of [
    'payment_request_approvals',
    'approval_batches',
    'approval_batch_items',
    'payment_layouts',
    'payment_layout_lines',
    'payments',
    'payment_receipts',
    'proveedores',
    'payment_intake_files',
    'notification_events',
    'notification_delivery_attempts',
  ]) {
    const directInsert = new RegExp(
      '--\\s+insert into public\\.' + table + '\\b',
      'i',
    )
    const directUpdate = new RegExp(
      '--\\s+update public\\.' + table + '\\b',
      'i',
    )
    const directDelete = new RegExp(
      '--\\s+delete from public\\.' + table + '\\b',
      'i',
    )
    assert.doesNotMatch(sql, directInsert)
    assert.doesNotMatch(sql, directUpdate)
    assert.doesNotMatch(sql, directDelete)
  }

  assert.doesNotMatch(sql, /--\s+(?:insert|update|delete)[^\n]*storage\./i)
  assert.match(sql, /draft is untouched/i)
  assert.match(sql, /rolls back request/i)
  assert.match(sql, /'submitted'::public\.payment_request_status/)
})

test('analysis and architecture preserve single_direction and routing snapshot semantics', () => {
  for (const token of [
    'routing snapshot',
    'not an approval',
    'payment_request_approvals',
    'status is submitted',
    'single_direction',
    'No batch is created',
    'Direction',
    'Finance',
  ]) {
    assert.ok(
      (analysis + '\n' + architecture).toLowerCase().includes(token.toLowerCase()),
      'missing routing semantic: ' + token,
    )
  }
  assert.match(analysis, /REAL_DEV_INTEGRATION_BLOCKER/)
  assert.match(analysis, /payment_request_created_notification_event/)
})

test('pure model has no filesystem, network, randomness, clock, or Supabase dependency', () => {
  assert.doesNotMatch(
    modelSource,
    /node:(?:fs|http|https|net|tls|dgram|child_process)|@supabase|createClient/i,
  )
  assert.doesNotMatch(
    modelSource,
    /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
  )
  assert.doesNotMatch(
    modelSource,
    /Date\.now|new Date|Math\.random|randomUUID|randomBytes/i,
  )
  assert.match(modelSource, /node:crypto/)
  assert.match(modelSource, /failure_after_request_insert/)
  assert.match(modelSource, /rollbackComplete/)
})

test('ready conversion maps every field and commits exactly one request link and event', () => {
  const state = makeReadyFixture()
  const command = makeReadyCommand()
  const pristineState = clone(state)
  const pristineCommand = clone(command)
  const outcome = convertProviderIntakePaymentDraft(state, command)

  assert.deepEqual(state, pristineState)
  assert.deepEqual(command, pristineCommand)
  assert.equal(outcome.result.ok, true)
  assert.equal(outcome.result.status, 'converted')
  assert.equal(outcome.result.requestStatus, 'submitted')
  assert.deepEqual(outcome.result.writes, {
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
  })

  assert.equal(outcome.state.paymentRequests.length, 1)
  assert.equal(outcome.state.events.length, 1)
  assert.equal(outcome.state.intake.status, 'converted')
  assert.equal(
    outcome.state.intake.createdPaymentRequestId,
    'payment-request-001',
  )

  const request = outcome.state.paymentRequests[0]
  assert.deepEqual(
    {
      proveedorId: request.proveedorId,
      companyId: request.companyId,
      costCenterId: request.costCenterId,
      budgetCategoryId: request.budgetCategoryId,
      budgetMonth: request.budgetMonth,
      requestedBy: request.requestedBy,
      approverId: request.approverId,
      approverAssignmentId: request.approverAssignmentId,
      amountRequested: request.amountRequested,
      currency: request.currency,
      exchangeRate: request.exchangeRate,
      companyBankAccountId: request.companyBankAccountId,
      paymentMethod: request.paymentMethod,
      scheduledPaymentDate: request.scheduledPaymentDate,
      concept: request.concept,
      description: request.description,
      notes: request.notes,
      requestType: request.requestType,
      status: request.status,
    },
    {
      proveedorId: 'provider-001',
      companyId: 'company-001',
      costCenterId: 'cost-center-001',
      budgetCategoryId: 'budget-category-001',
      budgetMonth: '2026-08-01',
      requestedBy: 'profile-finance-001',
      approverId: 'profile-routing-001',
      approverAssignmentId: 'assignment-001',
      amountRequested: '12500.00',
      currency: 'MXN',
      exchangeRate: '1',
      companyBankAccountId: 'company-account-001',
      paymentMethod: 'transfer',
      scheduledPaymentDate: '2026-08-07',
      concept: 'Pago de producción agosto',
      description: 'Servicio de producción para evento privado',
      notes: 'Fixture sintético sin datos personales',
      requestType: 'provider_payment',
      status: 'submitted',
    },
  )

  assert.equal(outcome.state.approvals.length, 0)
  assert.equal(outcome.state.batches.length, 0)
  assert.equal(outcome.result.draftPreserved, true)
  assert.equal(outcome.result.filesPreserved, true)
  assert.deepEqual(outcome.state.draft, pristineState.draft)
  assert.deepEqual(outcome.state.files, pristineState.files)
  assert.deepEqual(outcome.state.notifications, pristineState.notifications)
})

test('MXN accepts null or one, persists one, and rejects any other FX', () => {
  for (const exchangeRate of [null, '1', '1.0000']) {
    const outcome = convertProviderIntakePaymentDraft(
      makeReadyFixture(),
      makeReadyCommand({ exchangeRate }),
    )
    assert.equal(outcome.result.status, 'converted')
    assert.equal(outcome.state.paymentRequests[0].exchangeRate, '1')
  }

  const invalid = failure(
    makeReadyFixture(),
    makeReadyCommand({ exchangeRate: '1.0001' }),
    () => {},
  )
  assert.equal(invalid.result.code, 'fx_invalid')
})

test('non-MXN FX is required, positive, within numeric(18,4), and fingerprinted', () => {
  const usdState = makeReadyFixture({
    draft: { currency: 'USD' },
    live: { account: { currency: 'USD' } },
  })

  const required = failure(usdState, makeReadyCommand(), () => {})
  assert.equal(required.result.code, 'fx_required')

  for (const exchangeRate of ['0', '-1', '1.00001', '100000000000000.0000']) {
    const invalid = failure(
      usdState,
      makeReadyCommand({ exchangeRate }),
      () => {},
    )
    assert.equal(invalid.result.code, 'fx_invalid')
  }

  const first = convertProviderIntakePaymentDraft(
    usdState,
    makeReadyCommand({ exchangeRate: '17.2500' }),
  )
  const other = convertProviderIntakePaymentDraft(
    usdState,
    makeReadyCommand({
      actionId: 'action-convert-002',
      requestId: 'payment-request-002',
      eventId: 'intake-event-converted-002',
      exchangeRate: '17.3000',
    }),
  )
  assert.equal(first.result.status, 'converted')
  assert.equal(other.result.status, 'converted')
  assert.notEqual(first.result.actionFingerprint, other.result.actionFingerprint)
})

test('provider, membership, and catalog drift fail closed', () => {
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.provider.active = false
    }).result.code,
    'provider_invalid',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.requester.membershipActive = false
    }).result.code,
    'membership_invalid',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.catalog.budgetCategoryValid = false
    }).result.code,
    'catalog_invalid',
  )
})

test('account inactive, company mismatch, currency mismatch, and method mismatch fail closed', () => {
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.account.active = false
    }).result.code,
    'account_inactive',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.account.companyId = 'company-999'
    }).result.code,
    'account_company_mismatch',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.account.currency = 'USD'
    }).result.code,
    'account_currency_mismatch',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.live.account.accountType = 'cash'
    }).result.code,
    'account_method_mismatch',
  )
})

test('concept is never truncated: 120 succeeds and 121 fails', () => {
  const exact = 'C'.repeat(120)
  const success = convertProviderIntakePaymentDraft(
    makeReadyFixture({ draft: { internalConcept: exact } }),
    makeReadyCommand(),
  )
  assert.equal(success.result.status, 'converted')
  assert.equal(success.state.paymentRequests[0].concept, exact)

  const tooLong = failure(
    makeReadyFixture({ draft: { internalConcept: 'C'.repeat(121) } }),
    makeReadyCommand(),
    () => {},
  )
  assert.equal(tooLong.result.code, 'concept_too_long')
})

test('stale status, updated_at, and draft version each roll back with zero writes', () => {
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (state) => {
      state.intake.status = 'received'
    }).result.code,
    'stale_intake_status',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (_state, command) => {
      command.expectedIntakeUpdatedAt = '2026-07-31T11:59:59.000Z'
    }).result.code,
    'stale_intake_updated_at',
  )
  assert.equal(
    failure(makeReadyFixture(), makeReadyCommand(), (_state, command) => {
      command.expectedDraftVersion = 6
    }).result.code,
    'stale_draft_version',
  )
})

test('double click creates one conversion and then an exact zero-write replay', () => {
  const command = makeReadyCommand()
  const first = convertProviderIntakePaymentDraft(makeReadyFixture(), command)
  const beforeReplay = clone(first.state)
  const replay = convertProviderIntakePaymentDraft(first.state, command)

  assert.equal(replay.result.status, 'idempotent_replay')
  assert.equal(replay.result.idempotent, true)
  assert.deepEqual(replay.state, beforeReplay)
  assert.deepEqual(replay.result.writes, {
    paymentRequests: 0,
    intakeLinks: 0,
    convertedEvents: 0,
  })
  assert.equal(replay.state.paymentRequests.length, 1)
  assert.equal(
    replay.state.events.filter((event) => event.eventType === 'converted').length,
    1,
  )
})

test('same action with different material conflicts and another action is already converted', () => {
  const usdState = makeReadyFixture({
    draft: { currency: 'USD' },
    live: { account: { currency: 'USD' } },
  })
  const command = makeReadyCommand({ exchangeRate: '17.2500' })
  const first = convertProviderIntakePaymentDraft(usdState, command)

  const materialConflict = convertProviderIntakePaymentDraft(
    first.state,
    makeReadyCommand({ exchangeRate: '17.3000' }),
  )
  assert.equal(materialConflict.result.code, 'action_material_conflict')
  assert.deepEqual(materialConflict.state, first.state)

  const already = convertProviderIntakePaymentDraft(
    first.state,
    makeReadyCommand({
      actionId: 'action-convert-other',
      exchangeRate: '17.2500',
    }),
  )
  assert.equal(already.result.status, 'already_converted')
  assert.deepEqual(already.state, first.state)
})

test('same action from another actor is a material conflict', () => {
  const command = makeReadyCommand()
  const first = convertProviderIntakePaymentDraft(makeReadyFixture(), command)
  const secondState = clone(first.state)
  secondState.actor.profileId = 'profile-finance-002'
  secondState.actor.companyIds = ['company-001']
  const conflict = convertProviderIntakePaymentDraft(secondState, command)
  assert.equal(conflict.result.code, 'action_material_conflict')
  assert.deepEqual(conflict.state, secondState)
})

test('partial conversion is an invariant conflict and is never repaired', () => {
  const outcome = failure(makeReadyFixture(), makeReadyCommand(), (state) => {
    state.intake.status = 'converted'
    state.intake.createdPaymentRequestId = 'missing-payment-request'
  })
  assert.equal(outcome.result.code, 'invariant_conflict')
})

test('failure after request insertion rolls back the full transaction', () => {
  const state = makeReadyFixture()
  const pristine = clone(state)
  const outcome = convertProviderIntakePaymentDraft(
    state,
    makeReadyCommand({ failurePoint: 'after_request_insert' }),
  )
  assert.equal(outcome.result.code, 'failure_after_request_insert')
  assert.equal(outcome.result.rollbackComplete, true)
  assert.deepEqual(outcome.state, pristine)
  assert.equal(outcome.state.paymentRequests.length, 0)
  assert.equal(outcome.state.intake.createdPaymentRequestId, null)
  assert.equal(outcome.state.intake.status, 'in_review')
  assert.equal(outcome.state.events.length, 0)
  assert.deepEqual(outcome.state.draft, pristine.draft)
  assert.deepEqual(outcome.state.files, pristine.files)
})

test('fingerprint is deterministic, canonical, and includes FX', () => {
  const material = {
    contractVersion: CONTRACT_VERSION,
    actionKind: ACTION_KIND,
    amount: '1.00',
    exchangeRate: '17.2500',
    nested: { b: 2, a: 1 },
  }
  assert.equal(
    fingerprintMaterial(material),
    fingerprintMaterial({
      nested: { a: 1, b: 2 },
      exchangeRate: '17.2500',
      amount: '1.00',
      actionKind: ACTION_KIND,
      contractVersion: CONTRACT_VERSION,
    }),
  )
  assert.notEqual(
    fingerprintMaterial(material),
    fingerprintMaterial({ ...material, exchangeRate: '17.3000' }),
  )
})

test('mock UI is isolated, visibly labeled, and uses only local synthetic fixtures', () => {
  const combined = html + '\n' + css + '\n' + frontend
  for (const label of [
    'MOCKED',
    'NO DEV',
    'NO UAT',
    'NO REAL PAYMENT REQUEST',
  ]) {
    assert.ok(combined.includes(label), 'missing mocked label: ' + label)
  }
  assert.match(html, /connect-src 'none'/)
  assert.doesNotMatch(
    combined,
    /@supabase|createClient|supabaseUrl|service[_-]?role/i,
  )
  assert.doesNotMatch(
    combined,
    /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i,
  )
  assert.doesNotMatch(combined, /https?:\/\/|wss?:\/\//i)
})
