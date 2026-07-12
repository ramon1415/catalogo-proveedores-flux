const fs = require("fs")
const path = require("path")

const root = path.resolve(__dirname, "..")
const runtimeFiles = [
  "supabase/migrations/021_approval_batches_mvp.sql",
  "approval_batches.html",
  "approval_batches.js",
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
]

let failed = false
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

const sql = fs.readFileSync(path.join(root, runtimeFiles[0]), "utf8")
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
const policyCount = (sql.match(/\bcreate\s+policy\b/gi) || []).length
if (policyCount !== 3) {
  console.error(`Expected exactly 3 read policies, found ${policyCount}`)
  failed = true
}
if ((sql.match(/\balter\s+table\s+public\.(?:company_directors|approval_batches|approval_batch_items)\s+enable\s+row\s+level\s+security\b/gi) || []).length !== 3) {
  console.error("All three batch tables must enable RLS")
  failed = true
}
const executableSql = sql
  .split(/\r?\n/)
  .filter((line) => !/^\s*revoke\b/i.test(line))
  .join("\n")
if (/\b(delete\s+from|truncate\s+(?:table\s+)?public\.|drop\s+table)\b/i.test(executableSql)) {
  console.error("Destructive SQL is not allowed in the batch migration")
  failed = true
}

if (failed) process.exit(1)
console.log(`approval_batch_independence=ok files=${runtimeFiles.length}`)
