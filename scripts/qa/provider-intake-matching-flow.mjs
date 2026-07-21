import assert from "node:assert/strict"

const LIVE_ALIAS_ERROR_CODES = new Set([
  "LIVE_PROVIDER_ALIAS_UNRESOLVED",
  "LIVE_PROVIDER_ALIAS_AMBIGUOUS",
  "LIVE_PROVIDER_CARD_NOT_FOUND",
  "LIVE_PROVIDER_CARD_MISMATCH",
  "LOGICAL_ALIAS_USED_AS_LIVE_LOCATOR",
])

export class LiveProviderFlowError extends Error {
  constructor(code) {
    super(LIVE_ALIAS_ERROR_CODES.has(code) ? code : "LIVE_PROVIDER_ALIAS_UNRESOLVED")
    this.name = "LiveProviderFlowError"
    this.code = this.message
  }
}

function fail(code) {
  throw new LiveProviderFlowError(code)
}

export function normalizeLiveProviderText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function exactNormalizedText(value) {
  const normalized = normalizeLiveProviderText(value)
  if (!normalized) fail("LIVE_PROVIDER_ALIAS_UNRESOLVED")
  return new RegExp(
    `^${normalized.split(" ").map(escapeRegExp).join("\\s+")}$`,
    "u",
  )
}

export function assertLiveProviderLocatorInputs({
  sanitizedTargetAlias,
  searchText,
  expectedCardHeading,
} = {}) {
  const logical = normalizeLiveProviderText(sanitizedTargetAlias)
  const search = normalizeLiveProviderText(searchText)
  const heading = normalizeLiveProviderText(expectedCardHeading)
  if (!logical || !search || !heading) fail("LIVE_PROVIDER_ALIAS_UNRESOLVED")
  if (search !== heading) fail("LIVE_PROVIDER_CARD_MISMATCH")
  if (search === logical || heading === logical) {
    fail("LOGICAL_ALIAS_USED_AS_LIVE_LOCATOR")
  }
  return { logical, search, heading }
}

export function classifyProviderCardHeadings(headings, expectedCardHeading) {
  const expected = normalizeLiveProviderText(expectedCardHeading)
  if (!expected) fail("LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const normalized = Array.from(headings || [], normalizeLiveProviderText)
    .filter(Boolean)
  if (normalized.length === 0) fail("LIVE_PROVIDER_CARD_NOT_FOUND")
  if (normalized.length > 1) fail("LIVE_PROVIDER_ALIAS_AMBIGUOUS")
  if (normalized[0] !== expected) fail("LIVE_PROVIDER_CARD_MISMATCH")
  return normalized[0]
}

async function liveAction(operation, code) {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof LiveProviderFlowError) throw error
    fail(code)
  }
}

export async function openProviderSetDialog(page, {
  sanitizedTargetAlias,
  searchText,
  expectedCardHeading,
  timeout = 30_000,
} = {}) {
  if (!page) fail("LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const target = assertLiveProviderLocatorInputs({
    sanitizedTargetAlias,
    searchText,
    expectedCardHeading,
  })
  await page.locator(".provider-match-section").waitFor({ state: "visible", timeout })
  const providerSearch = page.locator("#providerMatchSearch")
  await providerSearch.waitFor({ state: "visible", timeout })
  await liveAction(async () => {
    await providerSearch.fill(target.search)
    await providerSearch.press("Enter")
  }, "LIVE_PROVIDER_CARD_NOT_FOUND")
  await liveAction(
    () => page.waitForFunction(
      () => Array.from(
        document.querySelectorAll(".candidate-card .candidate-card-header strong"),
      ).some((node) => node.getClientRects().length > 0),
      null,
      { timeout },
    ),
    "LIVE_PROVIDER_CARD_NOT_FOUND",
  )
  const headerSelector = ".candidate-card .candidate-card-header strong"
  const headings = await liveAction(
    () => page.locator(headerSelector).evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.textContent || "")),
    "LIVE_PROVIDER_CARD_NOT_FOUND",
  )
  const exact = classifyProviderCardHeadings(
    headings.filter((heading) => normalizeLiveProviderText(heading) === target.heading),
    target.heading,
  )
  const exactHeading = page
    .locator(headerSelector)
    .filter({ hasText: exactNormalizedText(exact) })
    .filter({ visible: true })
  if (await liveAction(() => exactHeading.count(), "LIVE_PROVIDER_CARD_NOT_FOUND") !== 1) {
    fail("LIVE_PROVIDER_ALIAS_AMBIGUOUS")
  }
  const candidateCard = exactHeading.locator(
    "xpath=ancestor::article[contains(concat(' ', normalize-space(@class), ' '), ' candidate-card ')]",
  )
  const trigger = candidateCard.getByRole("button", {
    name: "Seleccionar proveedor",
    exact: true,
  })
  if (await liveAction(() => trigger.count(), "LIVE_PROVIDER_CARD_NOT_FOUND") !== 1) {
    fail("LIVE_PROVIDER_CARD_NOT_FOUND")
  }
  await liveAction(() => trigger.click(), "LIVE_PROVIDER_CARD_NOT_FOUND")
  const dialog = page.locator("#matchDialog")
  await liveAction(
    () => page.waitForFunction(
      () => document.querySelector("#matchDialog")?.open === true,
      null,
      { timeout },
    ),
    "LIVE_PROVIDER_CARD_MISMATCH",
  )
  const title = page.locator("#matchTitle")
  const reasonCode = page.locator("#matchReasonCode")
  const reason = page.locator("#matchReason")
  const confirmButton = page.locator("#confirmMatchBtn")
  for (const control of [title, reasonCode, reason, confirmButton]) {
    await control.waitFor({ state: "visible", timeout })
  }
  if ((await title.textContent())?.trim() !== "Comparar proveedor") {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  if ((await confirmButton.textContent())?.trim() !== "Confirmar vínculo") {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  assert.equal(await reasonCode.inputValue(), "candidate_selected")
  const comparisonHeadings = await liveAction(
    () => page.locator("#comparisonContent .comparison-summary strong").allTextContents(),
    "LIVE_PROVIDER_CARD_MISMATCH",
  )
  classifyProviderCardHeadings(comparisonHeadings, target.heading)
  return {
    operation: "set",
    sanitizedTargetAlias: target.logical,
    providerSearch,
    candidateCard,
    trigger,
    dialog,
    title,
    reasonCode,
    reason,
    confirmButton,
  }
}

export async function openProviderClearDialog(page, { timeout = 30_000 } = {}) {
  if (!page) fail("LIVE_PROVIDER_ALIAS_UNRESOLVED")
  await page.getByText("Vinculado", { exact: true }).waitFor({ state: "visible", timeout })
  const trigger = page.getByRole("button", { name: "Retirar vínculo", exact: true })
  if (await trigger.count() !== 1) fail("LIVE_PROVIDER_CARD_NOT_FOUND")
  await liveAction(() => trigger.click(), "LIVE_PROVIDER_CARD_NOT_FOUND")
  await liveAction(
    () => page.waitForFunction(
      () => document.querySelector("#matchDialog")?.open === true,
      null,
      { timeout },
    ),
    "LIVE_PROVIDER_CARD_MISMATCH",
  )
  const dialog = page.locator("#matchDialog")
  const title = page.locator("#matchTitle")
  const reasonCode = page.locator("#matchReasonCode")
  const reason = page.locator("#matchReason")
  const confirmButton = page.locator("#confirmMatchBtn")
  for (const control of [title, reasonCode, reason, confirmButton]) {
    await control.waitFor({ state: "visible", timeout })
  }
  if ((await title.textContent())?.trim() !== "Retirar vínculo") {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  if ((await confirmButton.textContent())?.trim() !== "Retirar vínculo") {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  assert.equal(await reasonCode.inputValue(), "no_longer_matches")
  if (!/obligatoria/.test((await page.locator("#matchReasonRequired").textContent()) || "")) {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  return {
    operation: "clear",
    sanitizedTargetAlias: null,
    trigger,
    dialog,
    title,
    reasonCode,
    reason,
    confirmButton,
  }
}

export async function openProviderReplaceDialog(page, {
  providerAlias: legacyVisualFixtureAlias,
  sanitizedTargetAlias,
  searchText,
  expectedCardHeading,
  timeout = 30_000,
} = {}) {
  if (!page) fail("LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const visualFixtureCompatibility = normalizeLiveProviderText(legacyVisualFixtureAlias)
  const target = assertLiveProviderLocatorInputs({
    sanitizedTargetAlias: sanitizedTargetAlias ||
      (visualFixtureCompatibility ? "QA_VISUAL_FIXTURE_TARGET" : ""),
    searchText: searchText || visualFixtureCompatibility,
    expectedCardHeading: expectedCardHeading || visualFixtureCompatibility,
  })

  const linkedState = page.getByText("Vinculado", { exact: true })
  await linkedState.waitFor({ state: "visible", timeout })

  const changeButton = page.getByRole("button", { name: "Cambiar vínculo", exact: true })
  if (await changeButton.count() !== 1) fail("LIVE_PROVIDER_CARD_NOT_FOUND")
  await changeButton.click()

  const providerSearch = page.locator("#providerMatchSearch")
  await providerSearch.waitFor({ state: "visible", timeout })
  await page.waitForFunction(
    () => document.activeElement?.id === "providerMatchSearch",
    null,
    { timeout },
  )
  if (!await providerSearch.evaluate((node) => document.activeElement === node)) {
    fail("LIVE_PROVIDER_CARD_NOT_FOUND")
  }

  await liveAction(async () => {
    await providerSearch.fill(target.search)
    await providerSearch.press("Enter")
  }, "LIVE_PROVIDER_CARD_NOT_FOUND")

  await liveAction(
    () => page.waitForFunction(
      () => Array.from(
        document.querySelectorAll(".candidate-card .candidate-card-header strong"),
      ).some((node) => node.getClientRects().length > 0),
      null,
      { timeout },
    ),
    "LIVE_PROVIDER_CARD_NOT_FOUND",
  )

  const headerSelector = ".candidate-card .candidate-card-header strong"
  const headings = await liveAction(
    () => page.locator(headerSelector).evaluateAll((nodes) =>
      nodes
        .filter((node) => node.getClientRects().length > 0)
        .map((node) => node.textContent || "")),
    "LIVE_PROVIDER_CARD_NOT_FOUND",
  )
  classifyProviderCardHeadings(headings, target.heading)

  const exactHeading = page
    .locator(headerSelector)
    .filter({ hasText: exactNormalizedText(target.heading) })
    .filter({ visible: true })
  if (await liveAction(() => exactHeading.count(), "LIVE_PROVIDER_CARD_NOT_FOUND") !== 1) {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }

  const candidateCard = exactHeading.locator(
    "xpath=ancestor::article[contains(concat(' ', normalize-space(@class), ' '), ' candidate-card ')]",
  )
  if (await liveAction(() => candidateCard.count(), "LIVE_PROVIDER_CARD_NOT_FOUND") !== 1) {
    fail("LIVE_PROVIDER_ALIAS_AMBIGUOUS")
  }

  const trigger = candidateCard.getByRole("button", {
    name: "Seleccionar para cambio",
    exact: true,
  })
  if (await liveAction(() => trigger.count(), "LIVE_PROVIDER_CARD_NOT_FOUND") !== 1) {
    fail("LIVE_PROVIDER_CARD_NOT_FOUND")
  }
  await liveAction(() => trigger.click(), "LIVE_PROVIDER_CARD_NOT_FOUND")

  const dialog = page.locator("#matchDialog")
  await liveAction(
    () => page.waitForFunction(
      () => document.querySelector("#matchDialog")?.open === true,
      null,
      { timeout },
    ),
    "LIVE_PROVIDER_CARD_MISMATCH",
  )
  if (!await dialog.evaluate((node) => node.open === true)) {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }

  const title = page.locator("#matchTitle")
  const description = page.locator("#matchDescription")
  const reasonCode = page.locator("#matchReasonCode")
  const reason = page.locator("#matchReason")
  const confirmButton = page.locator("#confirmMatchBtn")

  for (const control of [title, description, reasonCode, reason, confirmButton]) {
    await control.waitFor({ state: "visible", timeout })
  }

  if ((await title.textContent())?.trim() !== "Comparar proveedor") {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  if (!/Revisa los datos declarados y maestros/.test((await description.textContent()) || "")) {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  assert.equal(await reasonCode.inputValue(), "match_corrected")
  if ((await confirmButton.textContent())?.trim() !== "Confirmar cambio") {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }
  if (!/obligatoria/.test((await page.locator("#matchReasonRequired").textContent()) || "")) {
    fail("LIVE_PROVIDER_CARD_MISMATCH")
  }

  const comparisonHeadings = await liveAction(
    () => page.locator("#comparisonContent .comparison-summary strong").allTextContents(),
    "LIVE_PROVIDER_CARD_MISMATCH",
  )
  classifyProviderCardHeadings(comparisonHeadings, target.heading)

  return {
    operation: "replace",
    sanitizedTargetAlias: target.logical,
    changeButton,
    providerSearch,
    candidateCard,
    trigger,
    dialog,
    title,
    description,
    reasonCode,
    reason,
    confirmButton,
  }
}
