#!/usr/bin/env node

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 2B2 mocked visual validation contract.
// CONTRACT_ONLY: --run certifies only the isolated R3 Preview authorized by the
// consolidated cycle-closure gate. It never authenticates users or performs UAT.

const STATES = Object.freeze([
  'ready',
  'confirmation',
  'processing',
  'success',
  'replay',
  'conflict',
  'stale-intake',
  'stale-draft',
  'fx-required',
  'account-mismatch',
  'concept-too-long',
  'already-converted',
  'rollback-error',
  'invariant-conflict',
  'provider-invalid',
  'budget-unavailable',
  'fx-invalid',
])

const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-320', width: 320, height: 720 },
])

const ZOOM_200_VIEWPORTS = new Set(['desktop', 'tablet'])

const REQUIRED_LABELS = Object.freeze([
  'MOCKED',
  'NO DEV',
  'NO UAT',
  'NO REAL PAYMENT REQUEST',
])

const STATE_EXPECTATIONS = Object.freeze({
  'provider-invalid': Object.freeze({
    title: 'Proveedor vinculado no disponible',
    message: 'El proveedor vinculado ya no está disponible o activo. Actualiza el matching antes de convertir.',
    resultTitle: 'PROVIDER INVALID',
    resultMessage: 'Conversión bloqueada · 0 request · 0 vínculo · 0 evento · draft intacto.',
    actionDisabled: true,
    provider: 'Proveedor no disponible · MOCKED',
  }),
  'budget-unavailable': Object.freeze({
    title: 'Presupuesto MOCKED no disponible',
    message: 'El presupuesto MOCKED no está disponible o no es aprobable para esta conversión.',
    resultTitle: 'BUDGET UNAVAILABLE',
    resultMessage: 'Conversión bloqueada · 0 request · 0 vínculo · 0 evento · draft intacto.',
    actionDisabled: true,
    budgetHeading: 'No disponible · MOCKED',
  }),
  'fx-invalid': Object.freeze({
    title: 'Tipo de cambio inválido',
    message: 'USD tiene un tipo de cambio presente, pero inválido; no se asume 1 ni se normaliza.',
    resultTitle: 'FX INVALID',
    resultMessage: 'Conversión bloqueada · 0 request · 0 vínculo · 0 evento · draft intacto.',
    actionDisabled: true,
    fx: '0.0000 · INVÁLIDO PARA USD',
  }),
})

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAFE_PREVIEW_METHODS = new Set(['GET', 'HEAD'])

const MUTABLE_METHODS = new Set([
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'CONNECT',
  'TRACE',
])

function argument(name) {
  const prefix = '--' + name + '='
  const item = process.argv.find((value) => value.startsWith(prefix))
  return item ? item.slice(prefix.length) : null
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))]
}

function difference(left, right) {
  const rightSet = new Set(right)
  return left.filter((value) => !rightSet.has(value))
}

function sameOrder(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

async function auditStateMatrixSources() {
  const [htmlSource, fixtureSource] = await Promise.all([
    readFile(resolve(REPO_ROOT, 'provider_intake_conversion_mock.html'), 'utf8'),
    readFile(resolve(REPO_ROOT, 'provider_intake_conversion_mock.js'), 'utf8'),
  ])
  const normalizedFixtureSource = fixtureSource.replaceAll('\r\n', '\n')

  const htmlStates = [
    ...htmlSource.matchAll(/<option\s+value="([^"]+)"/g),
  ].map((match) => match[1])

  const fixtureStart = normalizedFixtureSource.indexOf(
    'const fixtures = Object.freeze({',
  )
  const fixtureEnd = normalizedFixtureSource.indexOf(
    '\n})\n\nconst elements =',
    fixtureStart,
  )
  assert(
    fixtureStart >= 0 && fixtureEnd > fixtureStart,
    'fixture root could not be parsed',
  )
  const fixtureRoot = normalizedFixtureSource.slice(fixtureStart, fixtureEnd)
  const fixtureStates = [
    ...fixtureRoot.matchAll(
      /^ {2}(?:'([^']+)'|([a-z][a-z0-9-]*)):\s*\{/gm,
    ),
  ].map((match) => match[1] || match[2])

  const runnerStates = [...STATES]
  const duplicateStateKeys = {
    runner: duplicateValues(runnerStates),
    html: duplicateValues(htmlStates),
    fixtures: duplicateValues(fixtureStates),
  }
  const missingRequiredStates = {
    html: difference(runnerStates, htmlStates),
    fixtures: difference(runnerStates, fixtureStates),
  }
  const unexpectedStates = {
    html: difference(htmlStates, runnerStates),
    fixtures: difference(fixtureStates, runnerStates),
  }

  assert(runnerStates.length === 17, 'runner state count mismatch', {
    expected: 17,
    actual: runnerStates.length,
  })
  assert(htmlStates.length === 17, 'HTML state count mismatch', {
    expected: 17,
    actual: htmlStates.length,
  })
  assert(fixtureStates.length === 17, 'fixture state count mismatch', {
    expected: 17,
    actual: fixtureStates.length,
  })
  assert(
    Object.values(duplicateStateKeys).every((values) => values.length === 0),
    'duplicate visual state keys found',
    { duplicateStateKeys },
  )
  assert(
    Object.values(missingRequiredStates).every((values) => values.length === 0),
    'required visual states are missing',
    { missingRequiredStates },
  )
  assert(
    Object.values(unexpectedStates).every((values) => values.length === 0),
    'unexpected visual states found',
    { unexpectedStates },
  )
  assert(
    sameOrder(runnerStates, htmlStates) &&
      sameOrder(runnerStates, fixtureStates),
    'visual state order mismatch',
    { runnerStates, htmlStates, fixtureStates },
  )

  return {
    status: 'PASS',
    exactSetParity: true,
    exactOrderParity: true,
    counts: {
      runner: runnerStates.length,
      html: htmlStates.length,
      fixtures: fixtureStates.length,
    },
    states: {
      runner: runnerStates,
      html: htmlStates,
      fixtures: fixtureStates,
    },
    duplicateStateKeys,
    missingRequiredStates,
    unexpectedStates,
  }
}

async function auditCspSource() {
  const htmlSource = await readFile(
    resolve(REPO_ROOT, 'provider_intake_conversion_mock.html'),
    'utf8',
  )
  const metaMatch = htmlSource.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*>/i,
  )
  assert(metaMatch, 'CSP meta could not be parsed', {
    assertionName: 'CSP_META_PRESENT',
    expected: 1,
    actual: 0,
    element: 'meta[http-equiv="Content-Security-Policy"]',
  })

  const content = metaMatch[1]
  const requiredDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ]
  const missingDirectives = requiredDirectives.filter(
    (directive) => !content.includes(directive),
  )
  const frameAncestorsPresent = /(?:^|;)\s*frame-ancestors\b/i.test(content)
  const requiredCommentPresent = htmlSource.includes(
    'frame-ancestors must be delivered as an HTTP response header in a real integration.',
  )

  assert(!frameAncestorsPresent, 'frame-ancestors remains in CSP meta', {
    assertionName: 'META_FRAME_ANCESTORS_PRESENT',
    expected: false,
    actual: frameAncestorsPresent,
    element: 'meta[http-equiv="Content-Security-Policy"]',
    evidence: content,
  })
  assert(missingDirectives.length === 0, 'required CSP directives are missing', {
    assertionName: 'CSP_REQUIRED_DIRECTIVES_PRESENT',
    expected: requiredDirectives,
    actual: requiredDirectives.filter((directive) => content.includes(directive)),
    element: 'meta[http-equiv="Content-Security-Policy"]',
    missingDirectives,
  })
  assert(requiredCommentPresent, 'real-integration frame-ancestors note is missing', {
    assertionName: 'REAL_INTEGRATION_FRAME_ANCESTORS_HEADER_REQUIRED',
    expected: true,
    actual: requiredCommentPresent,
    element: 'HTML comment adjacent to CSP meta',
  })
  assert(!content.includes("'unsafe-eval'"), 'CSP contains unsafe-eval', {
    assertionName: 'CSP_UNSAFE_EVAL_ABSENT',
    expected: false,
    actual: true,
    element: 'meta[http-equiv="Content-Security-Policy"]',
  })

  return {
    status: 'PASS',
    content,
    metaFrameAncestorsPresent: frameAncestorsPresent,
    connectSrcNonePresent: content.includes("connect-src 'none'"),
    requiredDirectives,
    missingDirectives,
    realIntegrationFrameAncestorsHeaderRequired: requiredCommentPresent,
  }
}

function printPlan(stateMatrixAudit, cspMetaAudit) {
  process.stdout.write(
    JSON.stringify(
      {
        status: 'READY_FOR_AUTHORIZED_R3_CYCLE_CLOSURE',
        executed: false,
        contractOnly: true,
        mockedOnly: true,
        states: STATES,
        viewports: VIEWPORTS,
        zoom: '200%',
        visualStateMatrixParity: 'PASS',
        stateMatrixAudit,
        cspMetaAudit,
        checks: [
          'keyboard',
          'focus',
          'modal',
          'Escape',
          'return_of_focus',
          'labels',
          'aria-live',
          'contrast',
          'responsive',
          'critical_overflow',
          'axe_critical_serious',
          'console_errors',
          'mutable_requests',
          'resource_http_200',
        ],
      },
      null,
      2,
    ) + '\n',
  )
}

function assert(condition, message, details = {}) {
  if (!condition) {
    const error = new Error(message)
    error.details = details
    throw error
  }
}

async function overflowAudit(page) {
  return page.evaluate(() => {
    const root = document.documentElement
    const body = document.body
    const offenders = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const style = getComputedStyle(element)
        if (
          style.position === 'fixed' ||
          style.visibility === 'hidden' ||
          style.display === 'none'
        ) {
          return false
        }
        const rect = element.getBoundingClientRect()
        return rect.right > root.clientWidth + 2 || rect.left < -2
      })
      .slice(0, 20)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className:
          typeof element.className === 'string' ? element.className : null,
        rect: element.getBoundingClientRect().toJSON(),
      }))

    return {
      documentOverflow:
        Math.max(root.scrollWidth, body.scrollWidth) >
        root.clientWidth + 2,
      clientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      offenders,
    }
  })
}

const selectorCardinalityRecords = []

async function assertUniqueLocator(name, locator, context = {}) {
  const count = await locator.count()
  const record = {
    assertionName: name,
    selector: context.selector || locator.toString(),
    expectedCount: 1,
    actualCount: count,
    unique: count === 1,
    state: context.state || null,
    viewport: context.viewport || null,
  }
  selectorCardinalityRecords.push(record)
  assert(record.unique, 'singleton locator cardinality mismatch', {
    ...record,
    expected: 1,
    actual: count,
    locator: record.selector,
    evidence: 'selector-cardinality-audit.json',
  })
  return locator
}

async function singleton(page, name, selector, context = {}) {
  return assertUniqueLocator(name, page.locator(selector), {
    ...context,
    selector,
  })
}

async function assertLabels(page, context = {}) {
  for (const label of REQUIRED_LABELS) {
    const locator = page.getByText(label, { exact: true })
    await assertUniqueLocator('SAFETY_LABEL_' + label.replaceAll(' ', '_'), locator, {
      ...context,
      selector: `getByText(${JSON.stringify(label)}, exact=true)`,
    })
  }
}

async function activeElementId(page) {
  return page.evaluate(() => document.activeElement?.id || null)
}

async function waitForFocusTrapCleanup(page) {
  await page.waitForFunction(() => {
    const application = globalThis.__PROVIDER_INTAKE_MOCK_A11Y_AUDIT__
    const instrumentation = globalThis.__R3_AUTOMATION_AUDIT__?.focusTrap
    return (
      application?.activeHandlers === 0 &&
      application?.focusTrapAttached === false &&
      (!instrumentation || instrumentation.activeHandlers === 0)
    )
  })
}

async function assertModalAndKeyboard(page, viewport) {
  const context = { viewport }
  const trigger = await singleton(
    page,
    'FOCUS_TRIGGER',
    '#open-confirmation',
    context,
  )
  await trigger.focus()
  assert(
    (await activeElementId(page)) === 'open-confirmation',
    'trigger did not receive focus',
    {
      assertionName: 'TRIGGER_FOCUS',
      expected: 'open-confirmation',
      actual: await activeElementId(page),
      element: '#open-confirmation',
      viewport,
    },
  )

  await page.keyboard.press('Enter')
  const dialog = await singleton(
    page,
    'CONFIRMATION_DIALOG',
    '#confirmation-dialog',
    context,
  )
  await dialog.waitFor({ state: 'visible' })
  assert(await dialog.evaluate((node) => node.open), 'dialog is not modal-open', {
    assertionName: 'DIALOG_MODAL_OPEN',
    expected: true,
    actual: false,
    element: '#confirmation-dialog',
    viewport,
  })

  const first = await singleton(
    page,
    'FOCUS_TRAP_FIRST',
    '#explicit-confirmation',
    context,
  )
  const last = await singleton(
    page,
    'FOCUS_TRAP_LAST',
    '#confirm-conversion',
    context,
  )
  const initialFocus = await activeElementId(page)
  assert(initialFocus === 'explicit-confirmation', 'initial modal focus mismatch', {
    assertionName: 'INITIAL_FOCUS',
    expected: 'explicit-confirmation',
    actual: initialFocus,
    element: '#confirmation-dialog',
    viewport,
  })

  await last.focus()
  await page.keyboard.press('Tab')
  const forwardFocus = await activeElementId(page)
  assert(forwardFocus === 'explicit-confirmation', 'forward focus trap failed', {
    assertionName: 'FOCUS_TRAP_FORWARD',
    expected: 'explicit-confirmation',
    actual: forwardFocus,
    element: '#confirmation-dialog',
    viewport,
  })

  await first.focus()
  await page.keyboard.press('Shift+Tab')
  const reverseFocus = await activeElementId(page)
  assert(reverseFocus === 'confirm-conversion', 'reverse focus trap failed', {
    assertionName: 'FOCUS_TRAP_REVERSE',
    expected: 'confirm-conversion',
    actual: reverseFocus,
    element: '#confirmation-dialog',
    viewport,
  })

  await page.evaluate(() => {
    document.querySelector('#cancel-confirmation').disabled = true
    document.querySelector('#confirm-conversion').disabled = true
  })
  await first.focus()
  await page.keyboard.press('Tab')
  const singleForwardFocus = await activeElementId(page)
  await page.keyboard.press('Shift+Tab')
  const singleReverseFocus = await activeElementId(page)
  assert(
    singleForwardFocus === 'explicit-confirmation' &&
      singleReverseFocus === 'explicit-confirmation',
    'single-focusable focus trap failed',
    {
      assertionName: 'FOCUS_TRAP_SINGLE_ELEMENT',
      expected: {
        forward: 'explicit-confirmation',
        reverse: 'explicit-confirmation',
      },
      actual: {
        forward: singleForwardFocus,
        reverse: singleReverseFocus,
      },
      element: '#confirmation-dialog',
      viewport,
    },
  )
  await page.evaluate(() => {
    document.querySelector('#cancel-confirmation').disabled = false
    document.querySelector('#confirm-conversion').disabled = false
  })

  const openListenerAudit = await page.evaluate(
    () => globalThis.__R3_AUTOMATION_AUDIT__.focusTrap,
  )
  assert(openListenerAudit.activeHandlers === 1, 'focus trap handler count while open', {
    assertionName: 'FOCUS_TRAP_ACTIVE_HANDLER_COUNT',
    expected: 1,
    actual: openListenerAudit.activeHandlers,
    element: '#confirmation-dialog',
    viewport,
    evidence: openListenerAudit,
  })

  const closeButton = await singleton(
    page,
    'DIALOG_CLOSE_BUTTON',
    '#cancel-confirmation',
    context,
  )
  await closeButton.click()
  await dialog.waitFor({ state: 'hidden' })
  await waitForFocusTrapCleanup(page)
  await page.waitForFunction(
    () => document.activeElement?.id === 'open-confirmation',
  )
  const closeReturnFocus = await activeElementId(page)
  assert(closeReturnFocus === 'open-confirmation', 'close button did not return focus', {
    assertionName: 'CLOSE_BUTTON_FOCUS_RETURN',
    expected: 'open-confirmation',
    actual: closeReturnFocus,
    element: '#cancel-confirmation',
    viewport,
  })

  await trigger.click()
  await dialog.waitFor({ state: 'visible' })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await waitForFocusTrapCleanup(page)
  await page.waitForFunction(
    () => document.activeElement?.id === 'open-confirmation',
  )
  const escapeReturnFocus = await activeElementId(page)
  assert(
    escapeReturnFocus === 'open-confirmation',
    'focus did not return to trigger after Escape',
    {
      assertionName: 'ESCAPE_FOCUS_RETURN',
      expected: 'open-confirmation',
      actual: escapeReturnFocus,
      element: '#confirmation-dialog',
      viewport,
    },
  )

  await trigger.click()
  await dialog.waitFor({ state: 'visible' })
  await last.focus()
  await page.keyboard.press('Tab')
  const reopenForwardFocus = await activeElementId(page)
  assert(
    reopenForwardFocus === 'explicit-confirmation',
    'focus trap failed after reopening',
    {
      assertionName: 'REOPEN_FOCUS_TRAP_FORWARD',
      expected: 'explicit-confirmation',
      actual: reopenForwardFocus,
      element: '#confirmation-dialog',
      viewport,
    },
  )
  await closeButton.click()
  await dialog.waitFor({ state: 'hidden' })
  await waitForFocusTrapCleanup(page)
  await page.waitForFunction(
    () => document.activeElement?.id === 'open-confirmation',
  )

  const diagnostics = await page.evaluate(() => ({
    application: globalThis.__PROVIDER_INTAKE_MOCK_A11Y_AUDIT__,
    instrumentation: globalThis.__R3_AUTOMATION_AUDIT__.focusTrap,
    focusInsideClosedDialog: Boolean(
      document.activeElement?.closest('#confirmation-dialog'),
    ),
  }))
  assert(
    diagnostics.application.duplicateFocusHandlers === 0 &&
      diagnostics.instrumentation.duplicateRegistrations === 0,
    'duplicate focus handlers found',
    {
    assertionName: 'DUPLICATE_FOCUS_HANDLERS',
    expected: 0,
    actual: Math.max(
      diagnostics.application.duplicateFocusHandlers,
      diagnostics.instrumentation.duplicateRegistrations,
    ),
    element: '#confirmation-dialog',
    viewport,
    evidence: diagnostics,
    },
  )
  assert(
    diagnostics.application.activeHandlers === 0 &&
      diagnostics.application.attachments ===
        diagnostics.application.detachments &&
      diagnostics.instrumentation.activeHandlers === 0 &&
      diagnostics.instrumentation.addCalls ===
        diagnostics.instrumentation.removeCalls,
    'focus trap listener cleanup failed',
    {
      assertionName: 'FOCUS_TRAP_LISTENER_CLEANUP',
      expected: { activeHandlers: 0, balanced: true },
      actual: diagnostics,
      element: '#confirmation-dialog',
      viewport,
    },
  )
  assert(!diagnostics.focusInsideClosedDialog, 'focus remained in closed dialog', {
    assertionName: 'NO_FOCUS_IN_HIDDEN_DIALOG',
    expected: false,
    actual: diagnostics.focusInsideClosedDialog,
    element: '#confirmation-dialog',
    viewport,
  })

  return {
    viewport,
    keyboardPass: true,
    focusPass: true,
    initialFocusPass: initialFocus === 'explicit-confirmation',
    focusTrapForwardPass: forwardFocus === 'explicit-confirmation',
    focusTrapReversePass: reverseFocus === 'confirm-conversion',
    singleFocusablePass:
      singleForwardFocus === 'explicit-confirmation' &&
      singleReverseFocus === 'explicit-confirmation',
    escapePass: escapeReturnFocus === 'open-confirmation',
    focusReturnPass:
      closeReturnFocus === 'open-confirmation' &&
      escapeReturnFocus === 'open-confirmation',
    reopenPass: reopenForwardFocus === 'explicit-confirmation',
    diagnostics,
  }
}

async function assertConfirmationContract(page, viewport) {
  const context = { viewport }
  const trigger = await singleton(
    page,
    'CONFIRMATION_CONTRACT_TRIGGER',
    '#open-confirmation',
    context,
  )
  const confirm = await singleton(
    page,
    'CONFIRMATION_CONTRACT_ACTION',
    '#confirm-conversion',
    context,
  )
  await trigger.click()
  await confirm.click()
  const help = await singleton(
    page,
    'EXPLICIT_CONFIRMATION_HELP',
    '#confirmation-help',
    context,
  )
  await help.waitFor({ state: 'visible' })
  const helpText = ((await help.textContent()) || '').trim()
  assert(
    helpText === 'Confirma explícitamente el alcance MOCKED para continuar.',
    'explicit confirmation help text mismatch',
    {
      assertionName: 'EXPLICIT_CONFIRMATION_HELP_TEXT',
      expected: 'Confirma explícitamente el alcance MOCKED para continuar.',
      actual: helpText,
      element: '#confirmation-help',
      viewport,
    },
  )
  const invalidFocus = await activeElementId(page)
  assert(
    invalidFocus === 'explicit-confirmation',
    'invalid confirmation did not focus checkbox',
    {
      assertionName: 'INVALID_CONFIRMATION_FOCUS',
      expected: 'explicit-confirmation',
      actual: invalidFocus,
      element: '#explicit-confirmation',
      viewport,
    },
  )
  await page.keyboard.press('Escape')
  const dialog = await singleton(
    page,
    'CONFIRMATION_CONTRACT_DIALOG',
    '#confirmation-dialog',
    context,
  )
  await dialog.waitFor({ state: 'hidden' })
  await waitForFocusTrapCleanup(page)
  await page.waitForFunction(
    () => document.activeElement?.id === 'open-confirmation',
  )
}

async function assertAria(page, context = {}) {
  const live = await singleton(page, 'ARIA_LIVE_RESULT', '#result-panel', context)
  const ariaLive = await live.getAttribute('aria-live')
  const ariaAtomic = await live.getAttribute('aria-atomic')
  assert(ariaLive === 'polite', 'aria-live missing', {
    assertionName: 'ARIA_LIVE',
    expected: 'polite',
    actual: ariaLive,
    element: '#result-panel',
    ...context,
  })
  assert(ariaAtomic === 'true', 'aria-atomic missing', {
    assertionName: 'ARIA_ATOMIC',
    expected: 'true',
    actual: ariaAtomic,
    element: '#result-panel',
    ...context,
  })
  const scenario = await singleton(
    page,
    'STATE_SELECTOR_LABEL_TARGET',
    '#scenario-select',
    context,
  )
  await scenario.waitFor({ state: 'visible' })
}

async function textOf(page, name, selector, context = {}) {
  const locator = await singleton(page, name, selector, context)
  return ((await locator.textContent()) || '').trim()
}

async function assertSpecificState(page, state, viewport) {
  const expected = STATE_EXPECTATIONS[state]
  const context = { state, viewport }
  if (!expected) {
    await assertLabels(page, context)
    return
  }

  const actual = {
    title: await textOf(page, 'STATE_TITLE', '#state-title', context),
    message: await textOf(page, 'STATE_MESSAGE', '#state-message', context),
    resultTitle: await textOf(page, 'RESULT_TITLE', '#result-title', context),
    resultMessage: await textOf(
      page,
      'RESULT_MESSAGE',
      '#result-message',
      context,
    ),
    actionDisabled: await (
      await singleton(page, 'STATE_ACTION', '#open-confirmation', context)
    ).isDisabled(),
  }

  for (const field of [
    'title',
    'message',
    'resultTitle',
    'resultMessage',
    'actionDisabled',
  ]) {
    assert(actual[field] === expected[field], 'visual state expectation mismatch', {
      assertionName: 'VISUAL_STATE_' + field.toUpperCase(),
      state,
      viewport,
      field,
      expected: expected[field],
      actual: actual[field],
      element: field === 'actionDisabled' ? '#open-confirmation' : field,
    })
  }

  if (expected.provider) {
    const provider = await textOf(
      page,
      'PROVIDER_VALIDATION_STATUS',
      '[data-testid="provider-validation-status"]',
      context,
    )
    assert(provider === expected.provider, 'provider fixture value mismatch', {
      assertionName: 'PROVIDER_INVALID_TEXT',
      state,
      viewport,
      expected: expected.provider,
      actual: provider,
      locator: '[data-testid="provider-validation-status"]',
    })
  }
  if (expected.budgetHeading) {
    const budgetHeading = await textOf(
      page,
      'BUDGET_HEADING',
      '#budget-heading',
      context,
    )
    assert(
      budgetHeading === expected.budgetHeading,
      'budget fixture value mismatch',
      {
        assertionName: 'BUDGET_UNAVAILABLE_TEXT',
        state,
        viewport,
        expected: expected.budgetHeading,
        actual: budgetHeading,
        locator: '#budget-heading',
      },
    )
  }
  if (expected.fx) {
    const fx = await textOf(page, 'FX_VALUE', '#fx-value', context)
    assert(fx === expected.fx, 'FX invalid fixture value mismatch', {
      assertionName: 'FX_INVALID_TEXT',
      state,
      viewport,
      expected: expected.fx,
      actual: fx,
      locator: '#fx-value',
    })
  }

  const dialog = await singleton(
    page,
    'BLOCKED_STATE_DIALOG',
    '#confirmation-dialog',
    context,
  )
  assert(
    !(await dialog.evaluate((node) => node.open)),
    'blocked visual state opened the confirmation modal',
    {
      assertionName: 'BLOCKED_STATE_DIALOG_CLOSED',
      expected: false,
      actual: true,
      element: '#confirmation-dialog',
      state,
      viewport,
    },
  )
  await assertLabels(page, context)
}

async function auditState(page, state, viewport, AxeBuilder, screenshotsDir) {
  const context = { state, viewport: viewport.name }
  const scenario = await singleton(
    page,
    'STATE_SELECTOR',
    '#scenario-select',
    context,
  )
  await scenario.selectOption(state)
  await page.waitForFunction(
    (expected) => document.body.dataset.mockState === expected,
    state,
  )

  let confirmationDialog = null
  if (state === 'confirmation') {
    confirmationDialog = await singleton(
      page,
      'CONFIRMATION_STATE_DIALOG',
      '#confirmation-dialog',
      context,
    )
    await confirmationDialog.waitFor({ state: 'visible' })
    const focusedInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('#confirmation-dialog')),
    )
    assert(focusedInside, 'confirmation state did not trap initial focus', {
      assertionName: 'CONFIRMATION_STATE_INITIAL_FOCUS',
      expected: true,
      actual: focusedInside,
      element: '#confirmation-dialog',
      ...context,
    })
  }

  const banner = await singleton(page, 'STATE_BANNER', '#state-banner', context)
  const resultPanel = await singleton(
    page,
    'STATE_RESULT_PANEL',
    '#result-panel',
    context,
  )
  const bannerVisible = await banner.isVisible()
  const resultVisible = await resultPanel.isVisible()
  assert(bannerVisible && resultVisible, 'state regions are not visible', {
    assertionName: 'STATE_REGIONS_VISIBLE',
    expected: { bannerVisible: true, resultVisible: true },
    actual: { bannerVisible, resultVisible },
    element: '#state-banner, #result-panel',
    state,
    viewport: viewport.name,
  })
  await assertSpecificState(page, state, viewport.name)

  const overflow = await overflowAudit(page)
  assert(!overflow.documentOverflow, 'critical horizontal overflow', {
    assertionName: 'STATE_CRITICAL_OVERFLOW',
    expected: false,
    actual: overflow.documentOverflow,
    element: 'document',
    state,
    viewport: viewport.name,
    evidence: overflow,
  })

  const axe = await axeAudit(page, AxeBuilder)
  assert(axe.critical === 0, 'axe critical violations found', {
    assertionName: 'AXE_CRITICAL',
    expected: 0,
    actual: axe.critical,
    state,
    viewport: viewport.name,
    evidence: axe,
  })
  assert(axe.serious === 0, 'axe serious violations found', {
    assertionName: 'AXE_SERIOUS',
    expected: 0,
    actual: axe.serious,
    state,
    viewport: viewport.name,
    evidence: axe,
  })

  const screenshotPath = screenshotsDir
    ? resolve(screenshotsDir, `${viewport.name}-${state}.png`)
    : null
  const image = await page.screenshot({
    fullPage: true,
    ...(screenshotPath ? { path: screenshotPath } : {}),
  })
  assert(image.byteLength > 1000, 'in-memory screenshot is unexpectedly empty', {
    assertionName: 'STATE_SCREENSHOT_NONEMPTY',
    expected: '>1000',
    actual: image.byteLength,
    element: 'page',
    state,
    viewport: viewport.name,
  })

  if (confirmationDialog) {
    await page.keyboard.press('Escape')
    await confirmationDialog.waitFor({ state: 'hidden' })
    await waitForFocusTrapCleanup(page)
  }

  return {
    state,
    viewport: viewport.name,
    passed: true,
    bannerVisible,
    resultVisible,
    overflow,
    axe,
    screenshotBytes: image.byteLength,
    screenshot: screenshotPath,
  }
}

async function axeAudit(page, AxeBuilder) {
  const result = await new AxeBuilder({ page }).analyze()
  const severe = result.violations.filter((violation) =>
    ['critical', 'serious'].includes(violation.impact),
  )
  return {
    critical: severe.filter((item) => item.impact === 'critical').length,
    serious: severe.filter((item) => item.impact === 'serious').length,
    violations: severe.map((item) => ({
      id: item.id,
      impact: item.impact,
      nodes: item.nodes.length,
    })),
  }
}

async function installAutomationAudit(context) {
  await context.addInitScript(() => {
    const audit = {
      networkClients: [],
      focusTrap: {
        addCalls: 0,
        removeCalls: 0,
        activeHandlers: 0,
        maximumActiveHandlers: 0,
        duplicateRegistrations: 0,
      },
    }
    Object.defineProperty(globalThis, '__R3_AUTOMATION_AUDIT__', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: audit,
    })

    const recordNetworkClient = (client, method, url) => {
      audit.networkClients.push({
        client,
        method,
        url: String(url || ''),
      })
    }

    const nativeAdd = EventTarget.prototype.addEventListener
    const nativeRemove = EventTarget.prototype.removeEventListener
    const dialogKeydownListeners = new Set()
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (
        type === 'keydown' &&
        this instanceof HTMLDialogElement &&
        this.id === 'confirmation-dialog'
      ) {
        audit.focusTrap.addCalls += 1
        if (dialogKeydownListeners.has(listener)) {
          audit.focusTrap.duplicateRegistrations += 1
        } else {
          dialogKeydownListeners.add(listener)
        }
        audit.focusTrap.activeHandlers = dialogKeydownListeners.size
        audit.focusTrap.maximumActiveHandlers = Math.max(
          audit.focusTrap.maximumActiveHandlers,
          audit.focusTrap.activeHandlers,
        )
      }
      return nativeAdd.call(this, type, listener, options)
    }
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      if (
        type === 'keydown' &&
        this instanceof HTMLDialogElement &&
        this.id === 'confirmation-dialog'
      ) {
        audit.focusTrap.removeCalls += 1
        dialogKeydownListeners.delete(listener)
        audit.focusTrap.activeHandlers = dialogKeydownListeners.size
      }
      return nativeRemove.call(this, type, listener, options)
    }

    const nativeFetch = globalThis.fetch
    globalThis.fetch = function (input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url
      recordNetworkClient('fetch', String(init.method || input?.method || 'GET').toUpperCase(), url)
      return nativeFetch.call(this, input, init)
    }

    const nativeXhrOpen = XMLHttpRequest.prototype.open
    const nativeXhrSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__r3AuditMethod = String(method || 'GET').toUpperCase()
      this.__r3AuditUrl = String(url || '')
      return nativeXhrOpen.call(this, method, url, ...rest)
    }
    XMLHttpRequest.prototype.send = function (...args) {
      recordNetworkClient('XMLHttpRequest', this.__r3AuditMethod, this.__r3AuditUrl)
      return nativeXhrSend.apply(this, args)
    }

    if (typeof navigator.sendBeacon === 'function') {
      const nativeBeacon = navigator.sendBeacon.bind(navigator)
      navigator.sendBeacon = function (url, data) {
        recordNetworkClient('Beacon', 'POST', url)
        return nativeBeacon(url, data)
      }
    }

    if (typeof globalThis.WebSocket === 'function') {
      globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
        construct(target, args, newTarget) {
          recordNetworkClient('WebSocket', 'CONNECT', args[0])
          return Reflect.construct(target, args, newTarget)
        },
      })
    }
    if (typeof globalThis.EventSource === 'function') {
      globalThis.EventSource = new Proxy(globalThis.EventSource, {
        construct(target, args, newTarget) {
          recordNetworkClient('EventSource', 'GET', args[0])
          return Reflect.construct(target, args, newTarget)
        },
      })
    }
  })
}

function forbiddenRequestGroups(requests) {
  const matches = (pattern) => requests.filter((item) => pattern.test(item.url))
  return {
    supabase: matches(/supabase|\/rest\/v1\/|\/storage\/v1\//i),
    dev: matches(/(?:^|[./_-])dev(?:[./_:-]|$)|localhost|127\.0\.0\.1/i),
    prod: matches(/(?:^|[./_-])prod(?:[./_:-]|$)|production/i),
    auth: matches(/\/auth(?:\/|\?|$)|oauth|login|logout/i),
    storage: matches(/\/storage(?:\/|\?|$)|blob\.core|s3[.-]/i),
    notifications: matches(/notification|notificacion/i),
  }
}

async function run(stateMatrixAudit, cspMetaAudit) {
  const url = argument('url')
  const screenshotsDirArgument = argument('screenshots-dir')
  const screenshotsDir = screenshotsDirArgument
    ? resolve(screenshotsDirArgument)
    : null
  assert(url, '--url is required for the authorized R3 visual run')
  assert(
    /^https?:\/\/[^?#]+/i.test(url),
    '--url must be an explicit HTTP(S) Preview URL',
  )
  if (screenshotsDir) await mkdir(screenshotsDir, { recursive: true })

  const [{ chromium }, { default: AxeBuilder }] = await Promise.all([
    import('playwright'),
    import('@axe-core/playwright'),
  ])

  const previewOrigin = new URL(url).origin
  const previewPath = new URL(url).pathname
  const allowedPreviewPaths = new Set([
    previewPath,
    '/provider_intake_conversion_mock.css',
    '/provider_intake_conversion_mock.js',
  ])
  const browser = await chromium.launch({ headless: true })
  const consoleErrors = []
  const pageErrors = []
  const mutableRequests = []
  const crossOriginRequests = []
  const blockedRequests = []
  const networkClientCalls = []
  const requests = []
  const responses = []
  const matrices = []
  const focusAudits = []
  const zoomAudits = []

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
        extraHTTPHeaders: { 'x-vercel-skip-toolbar': '1' },
      })
      await installAutomationAudit(context)
      const page = await context.newPage()

      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push({
            viewport: viewport.name,
            text: message.text(),
          })
        }
      })
      page.on('pageerror', (error) => {
        pageErrors.push({
          viewport: viewport.name,
          message: error.message,
        })
      })
      page.on('request', (request) => {
        const record = {
          viewport: viewport.name,
          method: request.method(),
          resourceType: request.resourceType(),
          url: request.url(),
        }
        requests.push(record)
        if (MUTABLE_METHODS.has(record.method)) mutableRequests.push(record)
        if (new URL(record.url).origin !== previewOrigin) {
          crossOriginRequests.push(record)
        }
      })
      page.on('response', (response) => {
        responses.push({
          viewport: viewport.name,
          status: response.status(),
          url: response.url(),
        })
      })
      await page.route('**/*', async (route) => {
        const request = route.request()
        const method = request.method()
        const requestOrigin = new URL(request.url()).origin
        if (
          MUTABLE_METHODS.has(method) ||
          !SAFE_PREVIEW_METHODS.has(method) ||
          requestOrigin !== previewOrigin ||
          !allowedPreviewPaths.has(new URL(request.url()).pathname)
        ) {
          const record = {
            viewport: viewport.name,
            method,
            resourceType: request.resourceType(),
            url: request.url(),
            blocked: true,
          }
          blockedRequests.push(record)
          await route.abort('blockedbyclient')
          return
        }
        await route.continue()
      })

      const response = await page.goto(url, {
        waitUntil: 'networkidle',
      })
      assert(response && response.status() === 200, 'mock HTML did not return 200', {
        assertionName: 'PREVIEW_HTML_HTTP_200',
        expected: 200,
        actual: response?.status() ?? null,
        element: url,
        viewport: viewport.name,
      })

      const runtimeCsp = await singleton(
        page,
        'CSP_META_RUNTIME',
        'meta[http-equiv="Content-Security-Policy"]',
        { viewport: viewport.name },
      )
      const runtimeCspContent = await runtimeCsp.getAttribute('content')
      assert(runtimeCspContent === cspMetaAudit.content, 'runtime CSP meta mismatch', {
        assertionName: 'CSP_META_RUNTIME_CONTENT',
        expected: cspMetaAudit.content,
        actual: runtimeCspContent,
        element: 'meta[http-equiv="Content-Security-Policy"]',
        viewport: viewport.name,
      })

      await assertLabels(page, { viewport: viewport.name })
      await assertAria(page, { viewport: viewport.name })
      focusAudits.push(await assertModalAndKeyboard(page, viewport.name))
      await assertConfirmationContract(page, viewport.name)

      const stateResults = []
      for (const state of STATES) {
        stateResults.push(
          await auditState(
            page,
            state,
            viewport,
            AxeBuilder,
            screenshotsDir,
          ),
        )
      }

      const overflow = await overflowAudit(page)
      assert(!overflow.documentOverflow, 'critical horizontal overflow', {
        assertionName: 'VIEWPORT_CRITICAL_OVERFLOW',
        expected: false,
        actual: overflow.documentOverflow,
        element: 'document',
        viewport: viewport.name,
        evidence: overflow,
      })

      let zoom200 = null
      if (ZOOM_200_VIEWPORTS.has(viewport.name)) {
        await page.evaluate(() => {
          document.documentElement.style.zoom = '2'
        })
        zoom200 = await overflowAudit(page)
        assert(!zoom200.documentOverflow, 'critical overflow at 200% zoom', {
          assertionName: 'ZOOM_200_CRITICAL_OVERFLOW',
          expected: false,
          actual: zoom200.documentOverflow,
          element: 'document.documentElement',
          viewport: viewport.name,
          evidence: zoom200,
        })
        zoomAudits.push({
          viewport: viewport.name,
          zoom: '200%',
          passed: !zoom200.documentOverflow,
          overflow: zoom200,
        })
        await page.evaluate(() => {
          document.documentElement.style.zoom = ''
        })
      }

      const automationAudit = await page.evaluate(
        () => globalThis.__R3_AUTOMATION_AUDIT__,
      )
      networkClientCalls.push(
        ...automationAudit.networkClients.map((item) => ({
          ...item,
          viewport: viewport.name,
        })),
      )
      assert(
        automationAudit.focusTrap.activeHandlers === 0 &&
          automationAudit.focusTrap.duplicateRegistrations === 0,
        'focus trap lifecycle not clean after state matrix',
        {
          assertionName: 'FINAL_FOCUS_TRAP_LIFECYCLE',
          expected: { activeHandlers: 0, duplicateRegistrations: 0 },
          actual: automationAudit.focusTrap,
          element: '#confirmation-dialog',
          viewport: viewport.name,
        },
      )

      matrices.push({
        viewport,
        states: stateResults,
        overflow,
        zoom200,
        automationAudit,
      })

      await context.close()
    }
  } finally {
    await browser.close()
  }

  const frameAncestorsConsoleDiagnostics = consoleErrors.filter((item) =>
    /frame-ancestors.*(?:ignored|meta)/i.test(item.text),
  )
  assert(consoleErrors.length === 0, 'console errors found', {
    assertionName: 'CONSOLE_ERRORS',
    expected: 0,
    actual: consoleErrors.length,
    evidence: consoleErrors,
  })
  assert(pageErrors.length === 0, 'page errors found', {
    assertionName: 'PAGE_ERRORS',
    expected: 0,
    actual: pageErrors.length,
    evidence: pageErrors,
  })
  assert(mutableRequests.length === 0, 'mutable requests found', {
    assertionName: 'MUTABLE_REQUESTS',
    expected: 0,
    actual: mutableRequests.length,
    evidence: mutableRequests,
  })
  assert(crossOriginRequests.length === 0, 'cross-origin requests found', {
    assertionName: 'CROSS_ORIGIN_REQUESTS',
    expected: 0,
    actual: crossOriginRequests.length,
    evidence: crossOriginRequests,
  })
  assert(blockedRequests.length === 0, 'unauthorized requests were blocked', {
    assertionName: 'BLOCKED_UNAUTHORIZED_REQUESTS',
    expected: 0,
    actual: blockedRequests.length,
    evidence: blockedRequests,
  })
  assert(networkClientCalls.length === 0, 'application network client calls found', {
    assertionName: 'NETWORK_CLIENT_CALLS',
    expected: 0,
    actual: networkClientCalls.length,
    evidence: networkClientCalls,
  })

  const forbidden = forbiddenRequestGroups(requests)
  for (const [name, matching] of Object.entries(forbidden)) {
    assert(matching.length === 0, `${name} requests found`, {
      assertionName: name.toUpperCase() + '_REQUESTS',
      expected: 0,
      actual: matching.length,
      evidence: matching,
    })
  }

  for (const resource of [
    'provider_intake_conversion_mock.html',
    'provider_intake_conversion_mock.css',
    'provider_intake_conversion_mock.js',
  ]) {
    const matching = responses.filter((item) => item.url.includes(resource))
    assert(matching.length > 0, 'resource was not requested', {
      assertionName: 'RESOURCE_REQUESTED',
      expected: '>0',
      actual: matching.length,
      element: resource,
    })
    assert(
      matching.every((item) => item.status === 200),
      'resource did not return HTTP 200',
      {
        assertionName: 'RESOURCE_HTTP_200',
        expected: 200,
        actual: matching.map((item) => item.status),
        element: resource,
        evidence: matching,
      },
    )
  }

  const stateRecords = matrices.flatMap((matrix) => matrix.states)
  const screenshotsCaptured = stateRecords.filter(
    (record) => record.screenshotBytes > 1000,
  ).length
  assert(stateRecords.length === 68, 'viewport-state record count mismatch', {
    assertionName: 'VIEWPORT_STATE_RECORDS',
    expected: 68,
    actual: stateRecords.length,
    evidence: matrices.map((matrix) => ({
      viewport: matrix.viewport.name,
      states: matrix.states.length,
    })),
  })
  assert(screenshotsCaptured === 68, 'screenshot count mismatch', {
    assertionName: 'SCREENSHOTS_CAPTURED',
    expected: 68,
    actual: screenshotsCaptured,
    evidence: stateRecords.map((record) => ({
      state: record.state,
      viewport: record.viewport,
      bytes: record.screenshotBytes,
    })),
  })

  const ambiguousSingletonLocators = selectorCardinalityRecords.filter(
    (record) => !record.unique,
  )
  const providerLocatorRecords = selectorCardinalityRecords.filter(
    (record) => record.assertionName === 'PROVIDER_VALIDATION_STATUS',
  )
  assert(
    providerLocatorRecords.length === VIEWPORTS.length &&
      providerLocatorRecords.every((record) => record.actualCount === 1),
    'provider locator cardinality audit incomplete',
    {
      assertionName: 'PROVIDER_LOCATOR_COUNT',
      expected: { records: VIEWPORTS.length, eachCount: 1 },
      actual: providerLocatorRecords,
      locator: '[data-testid="provider-validation-status"]',
    },
  )
  const selectorCardinalityAudit = {
    status: 'PASS',
    checks: selectorCardinalityRecords,
    providerLocatorCount: 1,
    providerLocatorRecords: providerLocatorRecords.length,
    ambiguousSingletonLocators: ambiguousSingletonLocators.length,
    strictModeViolations: 0,
  }

  const duplicateFocusHandlers = Math.max(
    ...focusAudits.map((item) =>
      Math.max(
        item.diagnostics.application.duplicateFocusHandlers,
        item.diagnostics.instrumentation.duplicateRegistrations,
      ),
    ),
  )
  const focusTrapAudit = {
    status: 'PASS',
    keyboardPass: focusAudits.every((item) => item.keyboardPass),
    focusPass: focusAudits.every((item) => item.focusPass),
    initialFocusPass: focusAudits.every((item) => item.initialFocusPass),
    focusTrapForwardPass: focusAudits.every(
      (item) => item.focusTrapForwardPass,
    ),
    focusTrapReversePass: focusAudits.every(
      (item) => item.focusTrapReversePass,
    ),
    singleFocusablePass: focusAudits.every(
      (item) => item.singleFocusablePass,
    ),
    escapePass: focusAudits.every((item) => item.escapePass),
    focusReturnPass: focusAudits.every((item) => item.focusReturnPass),
    reopenPass: focusAudits.every((item) => item.reopenPass),
    duplicateFocusHandlers,
    viewports: focusAudits,
  }

  const severeAxe = stateRecords.flatMap((record) => record.axe.violations)
  const responsiveAudit = {
    status: 'PASS',
    viewportWidths: VIEWPORTS.map((viewport) => viewport.width),
    viewportStateRecords: stateRecords.length,
    criticalOverflow: stateRecords.filter(
      (record) => record.overflow.documentOverflow,
    ).length,
    zoom200Pass:
      zoomAudits.length === ZOOM_200_VIEWPORTS.size &&
      zoomAudits.every((audit) => audit.passed),
    zoomAudits,
  }
  assert(responsiveAudit.zoom200Pass, '200% zoom audit incomplete', {
    assertionName: 'ZOOM_200_PASS',
    expected: true,
    actual: responsiveAudit.zoom200Pass,
    evidence: zoomAudits,
  })

  const networkAudit = {
    status: 'PASS',
    instrumentedClients: [
      'fetch',
      'XMLHttpRequest',
      'Beacon',
      'WebSocket',
      'EventSource',
    ],
    networkClientCalls: networkClientCalls.length,
    mutableRequests: mutableRequests.length,
    crossOriginRequests: crossOriginRequests.length,
    supabaseRequests: forbidden.supabase.length,
    devRequests: forbidden.dev.length,
    prodRequests: forbidden.prod.length,
    authRequests: forbidden.auth.length,
    storageRequests: forbidden.storage.length,
    notificationRequests: forbidden.notifications.length,
    requestMethods: [...new Set(requests.map((item) => item.method))],
    requestOrigins: [
      ...new Set(requests.map((item) => new URL(item.url).origin)),
    ],
  }

  const runtimeCspAudit = {
    ...cspMetaAudit,
    frameAncestorsConsoleDiagnostics:
      frameAncestorsConsoleDiagnostics.length,
    consoleErrors: consoleErrors.length,
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: 'PASS',
        executed: true,
        contractOnly: true,
        mockedOnly: true,
        visualStateMatrixParity: 'PASS',
        stateMatrixAudit,
        statesAudited: STATES.length,
        statesExecuted: STATES.length,
        statesPassed: STATES.length,
        statesFailed: 0,
        viewportsAudited: VIEWPORTS.length,
        viewportStateRecords: stateRecords.length,
        screenshotsCaptured,
        labels: REQUIRED_LABELS,
        consoleErrors: 0,
        pageErrors: 0,
        mutableRequests: 0,
        axeCritical: severeAxe.filter((item) => item.impact === 'critical').length,
        axeSerious: severeAxe.filter((item) => item.impact === 'serious').length,
        selectorCardinalityAudit,
        focusTrapAudit,
        cspMetaAudit: runtimeCspAudit,
        responsiveAudit,
        networkAudit,
        matrices,
      },
      null,
      2,
    ) + '\n',
  )
}

async function main() {
  const [stateMatrixAudit, cspMetaAudit] = await Promise.all([
    auditStateMatrixSources(),
    auditCspSource(),
  ])
  if (!process.argv.includes('--run')) {
    printPlan(stateMatrixAudit, cspMetaAudit)
    return
  }
  await run(stateMatrixAudit, cspMetaAudit)
}

main().catch((error) => {
  process.stderr.write(
    JSON.stringify(
      {
        status: 'FAIL',
        message: error.message,
        details: error.details || {},
      },
      null,
      2,
    ) + '\n',
  )
  process.exitCode = 1
})
