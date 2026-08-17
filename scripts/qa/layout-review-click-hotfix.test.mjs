import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")
const html = read("layouts.html")
const js = read("layouts.js")

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const end = source.indexOf(`function ${nextName}`, start + 1)
  assert.notEqual(end, -1, `${nextName} must exist after ${name}`)
  return source.slice(start, end)
}

test("layout review click keeps its scroll helpers defined", () => {
  assert.match(js, /function layoutModalScrollContainer\(\)/)
  assert.match(js, /function resetLayoutPreviewScrollPositions\(\)/)
  assert.match(js, /function scrollLayoutModalToSection\(section\)/)

  const review = functionBody(js, "reviewLayoutEligibility", "previewRows")
  assert.match(review, /resetLayoutPreviewScrollPositions\(\)/)
  assert.match(review, /supabaseClient\.rpc\("preview_payment_layout_eligibility", params\)/)
  assert.match(review, /finally[\s\S]*inFlightLayoutPreviewRequestId = null/)
})

test("layout preview and created result scroll only inside the modal", () => {
  const action = functionBody(js, "handleLayoutPreviewAction", "layoutModalScrollContainer")
  assert.match(action, /scrollLayoutModalToSection\(section\)/)
  assert.doesNotMatch(action, /scrollIntoView/)

  const reset = functionBody(js, "resetLayoutPreviewScrollPositions", "scrollLayoutModalToSection")
  assert.match(reset, /container\.scrollTop = 0/)
  assert.match(reset, /querySelectorAll\("\.layout-preview-list"\)/)

  assert.match(html, /layouts\.js\?v=20260817-budget-exception-layout/)
})
