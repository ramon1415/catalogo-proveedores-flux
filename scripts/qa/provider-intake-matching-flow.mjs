import assert from "node:assert/strict"

const exactText = (value) => new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)

export async function openProviderReplaceDialog(page, {
  providerAlias,
  search = providerAlias,
  timeout = 30_000,
} = {}) {
  assert.ok(page, "replace flow requires a Playwright page")
  assert.ok(String(providerAlias || "").trim(), "replace flow requires an exact provider alias")

  const linkedState = page.getByText("Vinculado", { exact: true })
  await linkedState.waitFor({ state: "visible", timeout })

  const changeButton = page.getByRole("button", { name: "Cambiar vínculo", exact: true })
  assert.equal(await changeButton.count(), 1, "replace flow requires one Cambiar vínculo action")
  await changeButton.click()

  const providerSearch = page.locator("#providerMatchSearch")
  await providerSearch.waitFor({ state: "visible", timeout })
  await page.waitForFunction(
    () => document.activeElement?.id === "providerMatchSearch",
    null,
    { timeout },
  )
  assert.equal(
    await providerSearch.evaluate((node) => document.activeElement === node),
    true,
    "Cambiar vínculo must focus provider search",
  )

  if (search !== null && search !== undefined) {
    await providerSearch.fill(String(search))
    await providerSearch.press("Enter")
  }

  const exactAlias = page
    .locator(".candidate-card .candidate-card-header strong")
    .filter({ hasText: exactText(providerAlias) })
  await exactAlias.waitFor({ state: "visible", timeout })
  assert.equal(await exactAlias.count(), 1, "replace flow requires one exact provider card")

  const candidateCard = exactAlias.locator(
    "xpath=ancestor::article[contains(concat(' ', normalize-space(@class), ' '), ' candidate-card ')]",
  )
  assert.equal(await candidateCard.count(), 1, "exact provider alias must resolve to one candidate card")

  const trigger = candidateCard.getByRole("button", {
    name: "Seleccionar para cambio",
    exact: true,
  })
  assert.equal(await trigger.count(), 1, "exact provider card must expose one replace action")
  await trigger.click()

  const dialog = page.locator("#matchDialog")
  await page.waitForFunction(
    () => document.querySelector("#matchDialog")?.open === true,
    null,
    { timeout },
  )
  assert.equal(await dialog.evaluate((node) => node.open === true), true)

  const title = page.locator("#matchTitle")
  const description = page.locator("#matchDescription")
  const reasonCode = page.locator("#matchReasonCode")
  const reason = page.locator("#matchReason")
  const confirmButton = page.locator("#confirmMatchBtn")

  for (const control of [title, description, reasonCode, reason, confirmButton]) {
    await control.waitFor({ state: "visible", timeout })
  }

  assert.equal((await title.textContent())?.trim(), "Comparar proveedor")
  assert.match((await description.textContent()) || "", /Revisa los datos declarados y maestros/)
  assert.equal(await reasonCode.inputValue(), "match_corrected")
  assert.equal((await confirmButton.textContent())?.trim(), "Confirmar cambio")
  assert.match(
    (await page.locator("#matchReasonRequired").textContent()) || "",
    /obligatoria/,
  )
  await page
    .locator("#comparisonContent .comparison-summary strong")
    .getByText(providerAlias, { exact: true })
    .waitFor({ state: "visible", timeout })

  return {
    operation: "replace",
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
