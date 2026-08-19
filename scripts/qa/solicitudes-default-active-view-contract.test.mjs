import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const root = new URL("../../", import.meta.url)
const solicitudes = readFileSync(new URL("solicitudes.js", root), "utf8")
const workboard = readFileSync(
  new URL("solicitudes_workboard_extension.js", root),
  "utf8",
)
const html = readFileSync(new URL("solicitudes.html", root), "utf8")
const config = readFileSync(new URL("config.js", root), "utf8")
const batchExecution = readFileSync(
  new URL("solicitudes_batch_execution.js", root),
  "utf8",
)

function loadPrimaryViewContract() {
  const window = {
    supabase: { createClient: () => ({}) },
  }
  const document = {
    documentElement: {},
    addEventListener() {},
  }
  const context = vm.createContext({
    window,
    document,
    SUPABASE_URL: "https://example.invalid",
    SUPABASE_ANON_KEY: "test-only",
    console,
  })
  vm.runInContext(solicitudes, context)
  return window.FluxPaymentRequestsView
}

test("normal navigation starts with active requests and no secondary view", () => {
  assert.match(html, /<option value="activas" selected>Activas<\/option>/)
  assert.match(workboard, /view: "default"/)
  assert.match(
    workboard,
    /\["default", "manual"\]\.includes\(state\.view\)[\s\S]*renderPrimaryFilterState\(\)/,
  )
  assert.doesNotMatch(workboard, /view: "attention",/)
})

test("active table uses exactly the same status contract as the KPI", () => {
  const contract = loadPrimaryViewContract()
  assert.ok(contract)
  assert.deepEqual(
    [...contract.activeStatuses],
    ["submitted", "approved", "changes_requested", "finance_validation", "scheduled"],
  )

  const requests = [
    { status: "submitted" },
    { status: "approved" },
    { status: "scheduled" },
    { status: "changes_requested" },
    { status: "paid" },
    { status: "rejected" },
  ]
  assert.equal(
    requests.filter((request) => contract.statusMatches(request, "activas")).length,
    4,
  )
  assert.match(
    workboard,
    /window\.FluxPaymentRequestsView\?\.statusMatches/,
  )
})

test("default state hides the chip while explicit primary filters remain supported", () => {
  const contract = loadPrimaryViewContract()
  assert.equal(contract.isDefaultFilterState({
    search: "",
    status: "activas",
    budget: "todos",
    company: "todos",
  }), true)

  for (const filters of [
    { search: "SOL-2026", status: "activas", budget: "todos", company: "todos" },
    { search: "", status: "paid", budget: "todos", company: "todos" },
    { search: "", status: "activas", budget: "aprobable", company: "todos" },
    { search: "", status: "activas", budget: "todos", company: "company-1" },
  ]) {
    assert.equal(contract.isDefaultFilterState(filters), false)
  }

  assert.match(workboard, /state\.view = "manual"/)
  assert.match(workboard, /searchable\.includes\(search\)/)
  assert.match(workboard, /budgetMatches/)
  assert.match(workboard, /companyFilter === "todos"/)
})

test("reload cannot restore the legacy attention view from browser storage", () => {
  assert.doesNotMatch(workboard, /localStorage|sessionStorage/)
  assert.match(workboard, /view: "default"/)
  assert.match(
    workboard,
    /state\.view !== "default" && state\.view !== "manual"/,
  )
})

test("existing request deep link remains explicit and unchanged", () => {
  assert.match(
    batchExecution,
    /new URLSearchParams\(window\.location\.search\)\.get\("request_id"\)/,
  )
  assert.match(batchExecution, /state\.deepLinkHandled = true/)
  assert.doesNotMatch(workboard, /URLSearchParams|location\.hash/)
})

test("changed browser assets have coordinated cache busters", () => {
  assert.match(
    config,
    /solicitudes_workboard_extension\.js\?v=20260818-default-active/,
  )
  assert.match(html, /config\.js\?v=20260818-provider-portal-reconciled/)
  assert.match(html, /solicitudes\.js\?v=20260818-default-active/)
})
