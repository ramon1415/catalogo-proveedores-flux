import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const html = read("layouts.html")
const js = read("layouts.js")

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const end = nextName ? source.indexOf(`function ${nextName}`, start + 1) : source.length
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`)
  return source.slice(start, end)
}

test("Nuevo Layout has one scoped vertical scroll and no nested preview scroll", () => {
  assert.match(
    html,
    /#newLayoutDialog \.modal-scroll[^}]*overflow-x:hidden;overflow-y:auto[^}]*overscroll-behavior:contain/i,
  )
  assert.match(
    html,
    /#newLayoutDialog \.layout-preview-list\{[^}]*max-height:none;overflow:visible/i,
  )
  assert.match(html, /#newLayoutDialog[^}]*max-height:calc\(100dvh - 16px\)[^}]*overflow:hidden/i)
  assert.match(html, /id="layoutCreatedResult"[^>]*aria-live="polite"/i)
})

test("completion reevaluates inside the same modal without resetting its fields", () => {
  const completion = functionBody(js, "submitLayoutCompletion", "layoutCompletionFieldError")
  assert.match(completion, /if \(dom\.layoutCompletionDialog\?\.open\) dom\.layoutCompletionDialog\.close\(\)/)
  assert.match(completion, /await reviewLayoutEligibility\(\)/)
  assert.doesNotMatch(completion, /resetNewLayoutForm\s*\(/)
  for (const field of [
    "layoutPeriodStart",
    "layoutPeriodEnd",
    "layoutName",
    "layoutCompanyId",
    "layoutBankAccountId",
  ]) {
    assert.match(js, new RegExp(`dom\\.${field}`))
  }
  assert.match(js, /requestId !== activeLayoutPreviewRequestId \|\| paramsKey !== layoutPreviewParamsKey\(\)/)
})

test("create uses the returned layout id and cannot create a second layout", () => {
  const create = functionBody(js, "submitNewLayout", "setNewLayoutCreationBusy")
  assert.match(create, /if \(activeCreatedLayout\)[\s\S]*return/)
  assert.match(create, /const layoutId = cleanText\(data\?\.layout_id\)/)
  assert.match(create, /activeCreatedLayout = \{[\s\S]*id: layoutId/)
  assert.match(create, /await fetchLayoutLines\(layoutId\)/)
  assert.match(create, /singleReadyCreatedLayoutFormat\(activeCreatedLayout\.lines\)/)
  assert.match(create, /await downloadLayoutBbvaFormat\(layoutId, autoFormat\)/)
  assert.match(js, /Crear y descargar layout con \$\{ready\.length\}/)
  assert.match(js, /data-created-layout-action="download"/)
})
