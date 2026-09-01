import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const layouts = readFileSync(new URL("../../layouts.js", import.meta.url), "utf8")
const layoutsHtml = readFileSync(new URL("../../layouts.html", import.meta.url), "utf8")
const batches = readFileSync(new URL("../../approval_batches.js", import.meta.url), "utf8")
const migration = readFileSync(
  new URL("../../supabase/migrations/20260811035345_flux_dev_authoritative_brownfield_baseline_v2.sql", import.meta.url),
  "utf8",
)

test("layout correction errors persist in-dialog, focus the field and preserve input", () => {
  assert.match(layoutsHtml, /id="layoutCompletionError"[\s\S]*role="alert"/)
  assert.match(layouts, /showLayoutCompletionError\(message\)/)
  assert.match(layouts, /focusLayoutCompletionError\(error\)/)
  assert.match(layouts, /layoutCompletionSubmitting/)
  assert.match(layouts, /if \(!activeLayoutCompletionRequest \|\| layoutCompletionSubmitting\) return/)
  const submitBody = layouts.slice(
    layouts.indexOf("async function submitLayoutCompletion"),
    layouts.indexOf("function layoutCompletionFieldError"),
  )
  const catchBody = submitBody.match(/catch \(error\) \{([\s\S]*?)\n\s*\} finally \{/m)?.[1] || ""
  assert.doesNotMatch(catchBody, /reset\(\)|close\(\)/)
})

test("rejected requests expose the exact correction CTA and retain review context", () => {
  assert.match(layouts, /Corregir y enviar nuevamente/)
  assert.match(batches, /Corregir y enviar nuevamente/)
  assert.match(batches, /previous_reject_reason/)
  assert.match(batches, /previous_correction_note/)
  assert.match(batches, /review_sequence/)
  assert.match(layouts, /layoutRebatchSubmitting/)
  assert.match(layouts, /release_and_rebatch_rejected_request/)
})

test("mixed close previews and releases only valid items", () => {
  assert.match(batches, /preview_approval_batch_close/)
  assert.match(migration, /finance_release_status/)
  assert.match(migration, /approval_batch_item_release_block_reason/)
  assert.match(migration, /batch_no_releasable_items/)
  assert.match(migration, /finance_release_status = 'released'/)
  assert.match(migration, /finance_release_status = 'blocked'/)
  assert.match(migration, /item\.finance_release_status = 'released'/)
  assert.match(migration, /v_released = 0 then raise exception 'batch_no_releasable_items'/)
})
