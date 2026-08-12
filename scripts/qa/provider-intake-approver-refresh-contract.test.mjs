import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const frontend = fs.readFileSync(path.join(root, "provider_intakes.js"), "utf8")

function functionBlock(name) {
  const startPattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`)
  const match = startPattern.exec(frontend)
  assert.ok(match, `missing function ${name}`)
  const start = match.index
  const remainder = frontend.slice(start + match[0].length)
  const next = /\n(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/.exec(remainder)
  return frontend.slice(start, next ? start + match[0].length + next.index : frontend.length)
}

const refresh = functionBlock("refreshPaymentDraftApproverOptions")
const render = functionBlock("renderRefreshedPaymentDraftApprovers")
const input = functionBlock("handlePaymentDraftInput")
const submit = functionBlock("submitPaymentDraft")
const dependencies = functionBlock("paymentDraftApproverDependencies")

test("incomplete dependencies disable approver with an explicit explanation", () => {
  assert.match(refresh, /!paymentDraftApproverDependenciesReady\(\)/)
  assert.match(refresh, /Completa centro de costo, monto y solicitante/)
  assert.match(frontend, /paymentDraftApprover\.disabled = true/)
})

test("complete dependencies load options from the canonical server RPC", () => {
  assert.match(refresh, /rpc\("list_payment_request_approver_options"/)
  assert.match(refresh, /p_company_id: dependencies\.company_id/)
  assert.match(refresh, /p_cost_center_id: dependencies\.cost_center_id/)
  assert.match(refresh, /p_amount: dependencies\.final_amount/)
})

test("requester changes invalidate and recalculate options", () => {
  assert.match(input, /dom\.paymentDraftRequester/)
  assert.match(input, /invalidatePaymentDraftApproverOptions\(\)/)
  assert.match(input, /schedulePaymentDraftApproverRefresh/)
})

test("cost center changes invalidate and recalculate options", () => {
  assert.match(input, /dom\.paymentDraftCostCenter/)
  assert.match(frontend, /cost_center_id: dom\.paymentDraftCostCenter\.value/)
})

test("amount changes invalidate and recalculate options", () => {
  assert.match(input, /dom\.paymentDraftFinalAmount/)
  assert.match(frontend, /final_amount: amountRaw.*Number\.isFinite/s)
})

test("a stale approver is cleared and explained when no longer eligible", () => {
  assert.match(render, /previous && !eligiblePrevious/)
  assert.match(render, /El aprobador seleccionado ya no es válido para las reglas actuales/)
  assert.doesNotMatch(frontend, /Aprobador guardado · requiere recarga de reglas/)
  assert.match(frontend, /savedApproverInvalid/)
})

test("an eligible selected approver is preserved after recalculation", () => {
  assert.match(render, /eligiblePrevious/)
  assert.match(render, /paymentDraftApprover\.value = previous/)
})

test("zero server options produce an explicit empty-state message", () => {
  assert.match(render, /No hay aprobadores elegibles para esta combinación/)
})

test("the client does not recreate routing role or assignment rules", () => {
  assert.doesNotMatch(refresh, /director|finance|approver_assignments|user_roles|payment_request_rule_allows/i)
  assert.match(refresh, /list_payment_request_approver_options/)
})

test("partial draft save remains supported while the server owns validation", () => {
  assert.match(submit, /save_provider_intake_payment_draft/)
  assert.doesNotMatch(submit, /if\s*\(\s*!form\.approver_profile_id\s*\)\s*return/)
})

test("provider-new and provider-existing use identical routing semantics", () => {
  assert.doesNotMatch(refresh, /provider|matched_proveedor|proveedor/i)
  assert.match(dependencies, /company_id.*cost_center_id.*requested_by_profile_id.*final_amount/s)
})

test("actor-requester mismatch fails closed before any routing RPC", () => {
  assert.match(refresh, /!paymentDraftActorMatchesRequester\(\)/)
  assert.match(refresh, /La sesión y el solicitante no coinciden/)
  assert.ok(
    refresh.indexOf("!paymentDraftActorMatchesRequester()")
      < refresh.indexOf('rpc("list_payment_request_approver_options"'),
  )
})

test("loading state is explicit and stale results cannot win a race", () => {
  assert.match(frontend, /Calculando aprobadores autorizados…/)
  assert.match(refresh, /refreshVersion !== state\.paymentDraftApproverRefreshVersion/)
  assert.match(refresh, /dependencyKey !== paymentDraftApproverDependencyKey\(\)/)
})
