const fs = require("fs")
const path = require("path")
const { execFileSync } = require("child_process")

const root = path.resolve(__dirname, "..")
const isolatedRelease = process.env.APPROVAL_BATCH_ISOLATED_RELEASE === "1"
const runtimeFiles = [
  "config.js",
  "supabase/migrations/021_approval_batches_mvp.sql",
  "supabase/migrations/022_batch_execution_resubmission_extraordinary.sql",
  "approval_batches.html",
  "approval_batches.js",
  "layouts.html",
  "layouts.js",
  "solicitudes.html",
  "solicitudes_batch_execution.js",
  "supabase/functions/notification-dispatcher/index.ts",
]
const prFiles = [
  "approval_batches.html",
  "approval_batches.js",
  "docs/ops/approval-batch-execution-022.md",
  "layouts.html",
  "layouts.js",
  "scripts/check_approval_batch_independence.js",
  "solicitudes.html",
  "solicitudes_batch_execution.js",
  "supabase/functions/notification-dispatcher/index.ts",
  "supabase/migrations/022_batch_execution_resubmission_extraordinary.sql",
]
const forbidden = [
  "approver_" + "id",
  "approver_" + "assignment_id",
  "approver_" + "selection_source",
  "approver_" + "assignments",
  "profile_" + "company_memberships",
  "list_payment_request_" + "approver_options",
]
const requiredSql = [
  "approval_batch_request_base_eligible",
  "approval_batch_assert_execution_authorized",
  "rebatch_status",
  "approval_batch_totals_by_currency",
  "approval_batch_direction_roles",
  "approval_batch.submitted",
  "approval_batch.item_rejected",
]
const requiredRpcs = [
  "create_approval_batch",
  "list_batch_eligible_requests",
  "add_request_to_approval_batch",
  "remove_request_from_approval_batch",
  "submit_approval_batch",
  "get_approval_batch_detail",
  "approve_entire_batch",
  "decide_approval_batch_items",
  "close_approval_batch",
  "list_finance_approval_batches",
  "list_director_approval_batches",
  "list_approval_batch_director_candidates",
  "release_rejected_batch_item_for_rebatch",
]
const required022Rpcs = [
  "set_approval_batch_company_enforcement",
  "set_company_batch_configuration",
  "authorize_payment_request_extraordinary",
  "revoke_payment_request_extraordinary",
  "release_and_rebatch_rejected_request",
  "preview_payment_layout_eligibility",
  "get_payment_request_execution_context",
  "create_payment_layout",
]

function functionBlock(source, name) {
  const marker = `create or replace function public.${name}(`
  const start = source.toLowerCase().indexOf(marker)
  if (start < 0) return ""
  const next = source.toLowerCase().indexOf("create or replace function public.", start + marker.length)
  return source.slice(start, next < 0 ? source.length : next)
}

let failed = false
if (!isolatedRelease) {
  try {
    const changedFiles = execFileSync("git", ["diff", "--name-only", "origin/dev", "--"], {
      cwd: root,
      encoding: "utf8",
    }).split(/\r?\n/).filter(Boolean).sort()
    const expectedFiles = [...prFiles].sort()
    if (JSON.stringify(changedFiles) !== JSON.stringify(expectedFiles)) {
      console.error(`PR runtime manifest mismatch. Expected ${expectedFiles.join(", ")}; found ${changedFiles.join(", ")}`)
      failed = true
    }
    if (changedFiles.includes("solicitudes.js")) {
      console.error("solicitudes.js must remain unchanged for an isolated release without migrations 018/019")
      failed = true
    }
  } catch (error) {
    console.error(`Unable to verify the PR file manifest: ${error.message}`)
    failed = true
  }
}
for (const relative of runtimeFiles) {
  const absolute = path.join(root, relative)
  const contents = fs.readFileSync(absolute, "utf8")
  for (const token of forbidden) {
    if (contents.includes(token)) {
      console.error(`Forbidden batch dependency in ${relative}: ${token}`)
      failed = true
    }
  }
}

const sql = fs.readFileSync(path.join(root, "supabase/migrations/021_approval_batches_mvp.sql"), "utf8")
const sql022 = fs.readFileSync(path.join(root, "supabase/migrations/022_batch_execution_resubmission_extraordinary.sql"), "utf8")
for (const token of requiredSql) {
  if (!sql.includes(token)) {
    console.error(`Missing required batch guardrail: ${token}`)
    failed = true
  }
}
for (const name of requiredRpcs) {
  if (!sql.includes(`function public.${name}(`)) {
    console.error(`Missing batch RPC: ${name}`)
    failed = true
  }
}
for (const name of required022Rpcs) {
  if (!sql022.includes(`function public.${name}(`)) {
    console.error(`Missing 022 batch RPC: ${name}`)
    failed = true
  }
}
for (const token of [
  "approval_batch_company_settings",
  "approval_batch_company_setting_events",
  "payment_request_extraordinary_authorizations",
  "approval_material_updated_at",
  "approval_batch_request_has_current_direction_approval",
  "direction_reapproval_required",
  "stale_direction_approval",
  "set_company_batch_configuration",
  "batch_enforcement_cannot_be_disabled_in_mvp",
  "request_type",
  "exchange_rate",
  "jsonb_to_recordset(v_candidates)",
  "payment_request.extraordinary_authorized",
  "approval_batch.item_rebatched",
  "ready_extraordinary",
  "pending_finance_close",
  "rejected_by_direction",
]) {
  if (!sql022.includes(token)) {
    console.error(`Missing 022 batch contract: ${token}`)
    failed = true
  }
}
const directionBlock = functionBlock(sql022, "approval_batch_request_has_current_direction_approval")
for (const token of [
  "abi.decided_at >= pr.approval_material_updated_at",
  "ab.status = 'closed'",
  "ab.closed_at >= abi.decided_at",
  "later.director_status in ('pending', 'rejected')",
]) {
  if (!directionBlock.includes(token)) {
    console.error(`Current Direction approval helper is missing: ${token}`)
    failed = true
  }
}
const closeBlock = functionBlock(sql022, "close_approval_batch")
for (const token of [
  "pg_advisory_xact_lock",
  "for update",
  "approval_batch_request_has_current_finance_approval",
  "request_data_changed_after_direction_decision",
  "payment_request_already_executed",
]) {
  if (!closeBlock.toLowerCase().includes(token.toLowerCase())) {
    console.error(`Batch close revalidation is missing: ${token}`)
    failed = true
  }
}
const createLayoutBlock = functionBlock(sql022, "create_payment_layout")
if (!/from\s+public\.payment_requests\s+pr[\s\S]*for\s+update/i.test(createLayoutBlock)) {
  console.error("create_payment_layout must row-lock payment_requests after the advisory lock")
  failed = true
}
if ((createLayoutBlock.match(/from\s+public\.approval_batch_payment_layout_candidates\s*\(/gi) || []).length !== 2) {
  console.error("create_payment_layout must classify once before locks and capture exactly one post-lock snapshot")
  failed = true
}
if ((createLayoutBlock.match(/jsonb_to_recordset\(v_candidates\)/gi) || []).length < 3) {
  console.error("create_payment_layout must reuse its post-lock candidate snapshot")
  failed = true
}
const candidateBlock = functionBlock(sql022, "approval_batch_payment_layout_candidates")
if (!/when\s+b\.director_status\s*=\s*'approved'\s+and\s+not\s+b\.direction_decision_fresh\s+then\s+'direction_reapproval_required'/i.test(candidateBlock)) {
  console.error("Stale Direction approval must be blocked even for a historically legacy request")
  failed = true
}
const configurationBlock = functionBlock(sql022, "set_company_batch_configuration")
for (const token of ["approval_batch_require_finance", "director_role_required", "company_batch_configuration", "batch_enforcement_cannot_be_disabled_in_mvp"]) {
  if (!configurationBlock.includes(token)) {
    console.error(`Atomic company configuration is missing: ${token}`)
    failed = true
  }
}
for (const name of ["set_approval_batch_company_enforcement", "set_company_batch_configuration"]) {
  const block = functionBlock(sql022, name)
  if (!block.includes("batch_enforcement_cannot_be_disabled_in_mvp") || /enforcement_started_at\s*=\s*null/i.test(block)) {
    console.error(`Irreversible enforcement guard is incomplete in ${name}`)
    failed = true
  }
}
const materialChangeBlock = functionBlock(sql022, "mark_payment_request_material_change")
for (const token of ["request_type", "exchange_rate", "payment_method", "scheduled_payment_date", "due_date"]) {
  if (!materialChangeBlock.includes(token)) {
    console.error(`Material-change guard is missing: ${token}`)
    failed = true
  }
}
const policyCount = (sql.match(/\bcreate\s+policy\b/gi) || []).length
if (policyCount !== 3) {
  console.error(`Expected exactly 3 read policies, found ${policyCount}`)
  failed = true
}
if ((sql.match(/\balter\s+table\s+public\.(?:company_directors|approval_batches|approval_batch_items)\s+enable\s+row\s+level\s+security\b/gi) || []).length !== 3) {
  console.error("All three batch tables must enable RLS")
  failed = true
}
const policy022Count = (sql022.match(/\bcreate\s+policy\b/gi) || []).length
if (policy022Count !== 3) {
  console.error(`Expected exactly 3 read policies in 022, found ${policy022Count}`)
  failed = true
}
if ((sql022.match(/\balter\s+table\s+public\.(?:approval_batch_company_settings|approval_batch_company_setting_events|payment_request_extraordinary_authorizations)\s+enable\s+row\s+level\s+security\b/gi) || []).length !== 3) {
  console.error("All three 022 control tables must enable RLS")
  failed = true
}
if (sql.includes("'total_amount'")) {
  console.error("Batch list RPCs must not expose a mixed-currency scalar total")
  failed = true
}
if (!/if\s+not\s+found\s+then\s+return\s+new/i.test(sql)) {
  console.error("Execution gate must preserve the legacy flow for requests never enrolled in a batch")
  failed = true
}
for (const block of `${sql}\n${sql022}`.split(/(?=create\s+or\s+replace\s+function\s+public\.)/gi)) {
  if (/\bsecurity\s+definer\b/i.test(block) && !/\bset\s+search_path\s*=\s*public,\s*pg_temp\b/i.test(block)) {
    const name = block.match(/function\s+public\.([a-z0-9_]+)/i)?.[1] || "unknown"
    console.error(`SECURITY DEFINER function without fixed search_path: ${name}`)
    failed = true
  }
}
const executableSql = `${sql}\n${sql022}`
  .split(/\r?\n/)
  .filter((line) => !/^\s*revoke\b/i.test(line))
  .join("\n")
if (/\b(delete\s+from|truncate\s+(?:table\s+)?public\.|drop\s+table)\b/i.test(executableSql)) {
  console.error("Destructive SQL is not allowed in the batch migration")
  failed = true
}
for (const relative of ["approval_batches.js", "layouts.js", "solicitudes_batch_execution.js"]) {
  const contents = fs.readFileSync(path.join(root, relative), "utf8")
  if (/service_role/i.test(contents)) {
    console.error(`Frontend must not reference service_role: ${relative}`)
    failed = true
  }
}
const approvalBatchesJs = fs.readFileSync(path.join(root, "approval_batches.js"), "utf8")
if (!approvalBatchesJs.includes('rpc("set_company_batch_configuration"')) {
  console.error("Company configuration UI must use the atomic RPC")
  failed = true
}
if (approvalBatchesJs.includes('rpc("set_company_director"') || approvalBatchesJs.includes('rpc("set_approval_batch_company_enforcement"')) {
  console.error("Company configuration UI must not chain the legacy RPCs")
  failed = true
}

if (failed) process.exit(1)
console.log(`approval_batch_independence=ok files=${runtimeFiles.length} mode=${isolatedRelease ? "isolated-main" : "pr"}`)
