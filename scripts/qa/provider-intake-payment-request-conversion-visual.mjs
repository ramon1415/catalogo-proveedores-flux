#!/usr/bin/env node

// 2B2 mocked visual validation contract.
// CONTRACT_ONLY: this runner is prepared for a later C2 authorization.
// C1 must not invoke --run, authenticate users, or perform UAT.

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
])

const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
])

const REQUIRED_LABELS = Object.freeze([
  'MOCKED',
  'NO DEV',
  'NO UAT',
  'NO REAL PAYMENT REQUEST',
])

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

function printPlan() {
  process.stdout.write(
    JSON.stringify(
      {
        status: 'READY_FOR_LATER_C2',
        executed: false,
        contractOnly: true,
        mockedOnly: true,
        states: STATES,
        viewports: VIEWPORTS,
        zoom: '200%',
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

async function assertLabels(page) {
  for (const label of REQUIRED_LABELS) {
    const count = await page.getByText(label, { exact: true }).count()
    assert(count > 0, 'missing safety label', { label })
  }
}

async function assertModalAndKeyboard(page) {
  const trigger = page.locator('#open-confirmation')
  await trigger.focus()
  assert(
    (await page.evaluate(() => document.activeElement?.id)) ===
      'open-confirmation',
    'trigger did not receive focus',
  )

  await page.keyboard.press('Enter')
  const dialog = page.locator('#confirmation-dialog')
  await dialog.waitFor({ state: 'visible' })
  assert(await dialog.evaluate((node) => node.open), 'dialog is not modal-open')

  const focusedInside = await page.evaluate(() =>
    Boolean(document.activeElement?.closest('#confirmation-dialog')),
  )
  assert(focusedInside, 'focus did not move into modal')

  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert(
    (await page.evaluate(() => document.activeElement?.id)) ===
      'open-confirmation',
    'focus did not return to trigger after Escape',
  )
}

async function assertConfirmationContract(page) {
  await page.locator('#open-confirmation').click()
  await page.locator('#confirm-conversion').click()
  await page.getByText(
    'Confirma explícitamente el alcance MOCKED para continuar.',
    { exact: true },
  ).waitFor({ state: 'visible' })
  assert(
    (await page.evaluate(() => document.activeElement?.id)) ===
      'explicit-confirmation',
    'invalid confirmation did not focus checkbox',
  )
  await page.keyboard.press('Escape')
}

async function assertAria(page) {
  const live = page.locator('#result-panel')
  assert((await live.getAttribute('aria-live')) === 'polite', 'aria-live missing')
  assert((await live.getAttribute('aria-atomic')) === 'true', 'aria-atomic missing')
  await page.getByLabel('Estado visual').waitFor({ state: 'visible' })
}

async function auditState(page, state) {
  await page.locator('#scenario-select').selectOption(state)
  await page.waitForFunction(
    (expected) => document.body.dataset.mockState === expected,
    state,
  )

  if (state === 'confirmation') {
    const dialog = page.locator('#confirmation-dialog')
    await dialog.waitFor({ state: 'visible' })
    const focusedInside = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('#confirmation-dialog')),
    )
    assert(focusedInside, 'confirmation state did not trap initial focus')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
  }

  const bannerVisible = await page.locator('#state-banner').isVisible()
  const resultVisible = await page.locator('#result-panel').isVisible()
  assert(bannerVisible && resultVisible, 'state regions are not visible', {
    state,
  })

  const image = await page.screenshot({ fullPage: true })
  assert(image.byteLength > 1000, 'in-memory screenshot is unexpectedly empty', {
    state,
  })

  return {
    state,
    bannerVisible,
    resultVisible,
    screenshotBytes: image.byteLength,
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

async function run() {
  const url = argument('url')
  assert(url, '--url is required for the later authorized visual run')
  assert(
    /^https?:\/\/[^?#]+/i.test(url),
    '--url must be an explicit HTTP(S) Preview URL',
  )

  const [{ chromium }, { default: AxeBuilder }] = await Promise.all([
    import('playwright'),
    import('@axe-core/playwright'),
  ])

  const browser = await chromium.launch({ headless: true })
  const consoleErrors = []
  const pageErrors = []
  const mutableRequests = []
  const requests = []
  const responses = []
  const matrices = []

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        reducedMotion: 'reduce',
      })
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
      })
      page.on('response', (response) => {
        responses.push({
          viewport: viewport.name,
          status: response.status(),
          url: response.url(),
        })
      })
      await page.route('**/*', async (route) => {
        if (MUTABLE_METHODS.has(route.request().method())) {
          mutableRequests.push({
            viewport: viewport.name,
            method: route.request().method(),
            resourceType: route.request().resourceType(),
            url: route.request().url(),
            blocked: true,
          })
          await route.abort('blockedbyclient')
          return
        }
        await route.continue()
      })

      const response = await page.goto(url, {
        waitUntil: 'networkidle',
      })
      assert(response && response.status() === 200, 'mock HTML did not return 200', {
        viewport: viewport.name,
        status: response?.status() ?? null,
      })

      await assertLabels(page)
      await assertAria(page)

      if (viewport.name === 'desktop') {
        await assertModalAndKeyboard(page)
        await assertConfirmationContract(page)
      }

      const stateResults = []
      for (const state of STATES) {
        stateResults.push(await auditState(page, state))
      }

      const overflow = await overflowAudit(page)
      assert(!overflow.documentOverflow, 'critical horizontal overflow', {
        viewport: viewport.name,
        overflow,
      })

      const axe = await axeAudit(page, AxeBuilder)
      assert(axe.critical === 0, 'axe critical violations found', {
        viewport: viewport.name,
        axe,
      })
      assert(axe.serious === 0, 'axe serious violations found', {
        viewport: viewport.name,
        axe,
      })

      await page.evaluate(() => {
        document.documentElement.style.zoom = '2'
      })
      const zoomOverflow = await overflowAudit(page)
      assert(!zoomOverflow.documentOverflow, 'critical overflow at 200% zoom', {
        viewport: viewport.name,
        zoomOverflow,
      })

      matrices.push({
        viewport,
        states: stateResults,
        overflow,
        zoom200: zoomOverflow,
        axe,
      })

      await context.close()
    }
  } finally {
    await browser.close()
  }

  assert(consoleErrors.length === 0, 'console errors found', { consoleErrors })
  assert(pageErrors.length === 0, 'page errors found', { pageErrors })
  assert(mutableRequests.length === 0, 'mutable requests found', {
    mutableRequests,
  })

  for (const resource of [
    'provider_intake_conversion_mock.html',
    'provider_intake_conversion_mock.css',
    'provider_intake_conversion_mock.js',
  ]) {
    const matching = responses.filter((item) => item.url.includes(resource))
    assert(matching.length > 0, 'resource was not requested', { resource })
    assert(
      matching.every((item) => item.status === 200),
      'resource did not return HTTP 200',
      { resource, matching },
    )
  }

  process.stdout.write(
    JSON.stringify(
      {
        status: 'PASS',
        executed: true,
        contractOnly: true,
        mockedOnly: true,
        statesAudited: STATES.length,
        viewportsAudited: VIEWPORTS.length,
        labels: REQUIRED_LABELS,
        consoleErrors: 0,
        pageErrors: 0,
        mutableRequests: 0,
        requestMethods: [...new Set(requests.map((item) => item.method))],
        matrices,
      },
      null,
      2,
    ) + '\n',
  )
}

if (!process.argv.includes('--run')) {
  printPlan()
} else {
  run().catch((error) => {
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
}
