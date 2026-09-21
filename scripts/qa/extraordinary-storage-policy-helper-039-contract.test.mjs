import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")
const postcheckPath =
  "scripts/qa/extraordinary-039-dev-postcheck-readonly.sql"
const backupPath =
  "scripts/qa/extraordinary-039-private-logical-backup.sql"
const uatPath = "scripts/qa/extraordinary-039-dev-uat.mjs"
const workflowPath =
  ".github/workflows/extraordinary-039-dev-precheck-readonly.yml"
const workflow040Path =
  ".github/workflows/extraordinary-040-dev-one-shot.yml"
const shadowPregrantPath =
  "scripts/qa/shadow/039_pregrant_storage_policy_contracts.sql"
const shadowPostgrantPath =
  "scripts/qa/shadow/039_postgrant_storage_policy_contracts.sql"
const shadowRunnerPath =
  "scripts/qa/shadow/run-extraordinary-migrations.ps1"
const postcheck = read(postcheckPath)
const backup = read(backupPath)
const uat = read(uatPath)
const workflow = read(workflowPath)
const workflow040 = read(workflow040Path)
const shadowPregrant = read(shadowPregrantPath)
const shadowPostgrant = read(shadowPostgrantPath)
const shadowRunner = read(shadowRunnerPath)

test("shadow reproduces the audited CRLF body and Supabase service ACL", () => {
  assert.match(shadowRunner, /migration 037 audited CRLF transport copy/i)
  assert.match(
    shadowRunner,
    /alter default privileges[\s\S]*grant execute on functions to service_role/i,
  )
  assert.match(shadowRunner, /\.Replace\("`n",\s*"`r`n"\)/)
  assert.match(
    shadowRunner,
    /266542d2b587c46f99a64eabe3b362f7cb039249b7efda1479572bffbded7c87/i,
  )
  for (const source of [shadowPregrant, shadowPostgrant]) {
    assert.match(source, /a7879f8dcc683cb5b552387bedb0d499/i)
    assert.match(
      source,
      /c3a6a4d1b447323a320f5663bef28a201b420826485f47eba41c0118faf0d86e/i,
    )
    assert.match(
      source,
      /53042a2a564b84c8e19620bbbd487b8e3f33b9a47cc31faadedda992918e978c/i,
    )
    assert.match(source, /service_role/i)
    assert.match(source, /aclexplode/i)
  }
  assert.match(shadowPostgrant, /v_actor_null/i)
  assert.match(shadowPostgrant, /v_wrong_company/i)
  assert.match(shadowPostgrant, /v_finance_write/i)
  assert.match(shadowPostgrant, /v_finance_non_owner_write/i)
  assert.match(shadowPostgrant, /v_director_read/i)
  assert.match(shadowPostgrant, /v_requester_read/i)
  assert.match(shadowPostgrant, /v_inactive_membership_read/i)
  assert.match(shadowPostgrant, /v_sysadmin_read/i)
  assert.match(shadowPostgrant, /v_non_draft_write/i)
  assert.match(shadowPostgrant, /SHADOW_039_LIVE_BODY_CONTRACT_PASS/i)
})

test("private backup and remote postcheck are read-only and sanitized", () => {
  for (const source of [backup, postcheck]) {
    assert.match(
      source,
      /set session characteristics as transaction read only/i,
    )
    assert.match(source, /begin transaction read only/i)
    assert.match(source, /\brollback;/i)
    assert.doesNotMatch(
      source,
      /^\s*(insert|update|delete|truncate|merge|grant|revoke|alter|create|drop)\b/im,
    )
    assert.doesNotMatch(
      source,
      /\b(email|rfc|clabe|account_number|storage_path|authorization_id)\b/i,
    )
  }
  assert.match(backup, /EXTRAORDINARY_039_PRIVATE_LOGICAL_BACKUP/)
  assert.match(postcheck, /MIGRATION_039_POSTCHECK_PASS/)
})

test("UAT uses real Auth sessions, private Storage and no payment confirmation", () => {
  assert.match(uat, /auth\.signInWithPassword/i)
  assert.match(uat, /auth\.admin\.createUser/i)
  assert.match(uat, /layout\?\.status === "draft"/i)
  assert.doesNotMatch(uat, /layout\?\.status === "created"/i)
  assert.match(uat, /searchParams\.set\("sslmode",\s*"require"\)/i)
  assert.match(uat, /searchParams\.set\("uselibpqcompat",\s*"true"\)/i)
  assert.doesNotMatch(uat, /rejectUnauthorized\s*:\s*false/i)
  assert.doesNotMatch(uat, /NODE_TLS_REJECT_UNAUTHORIZED/i)
  assert.doesNotMatch(
    uat,
    /\b(from|join)\s+public\.[a-z0-9_]+\s+authorization\b/i,
  )
  assert.match(workflow, /pg@8\.22\.0/i)
  assert.match(uat, /\.storage[\s\S]*\.upload\(/i)
  assert.match(uat, /contentType:\s*"application\/pdf"/i)
  assert.match(uat, /metadata:\s*\{\s*sha256:/i)
  assert.match(uat, /upsert:\s*false/i)
  assert.match(uat, /begin_extraordinary_authorization/i)
  assert.match(uat, /finalize_extraordinary_authorization/i)
  assert.match(uat, /ratify_extraordinary_authorization/i)
  assert.match(uat, /createSignedUrl\([^,]+,\s*120\)/i)
  assert.match(uat, /consumed_pending_ratification/i)
  assert.match(uat, /payable_snapshots:\s*1/i)
  assert.match(uat, /financial_outbox_events:\s*1/i)
  assert.match(uat, /snapshot\.payment_request_id = \$1/i)
  assert.doesNotMatch(uat, /object\.name like \$2::text/i)
  assert.doesNotMatch(uat, /event\.company_id::text\s*=\s*\$2/i)
  assert.doesNotMatch(uat, /event\.company_id\s*=\s*\$2::text/i)
  assert.match(uat, /object\.name like \$4::text/i)
  assert.match(uat, /`\$\{ids\.company\}\/%`/)

  const companyUuidComparisons =
    uat.match(/event\.company_id\s*=\s*\$2::uuid/g) ?? []
  assert.equal(companyUuidComparisons.length, 2)
  assert.match(
    uat,
    /\[\s*ids\.request,\s*ids\.company,\s*Object\.values\(profileIds\),\s*`\$\{ids\.company\}\/%`,\s*\]/,
  )

  const runStart = uat.indexOf("async function run()")
  const entrypointStart = uat.indexOf("\ntry {\n  await run()", runStart)
  assert.notEqual(runStart, -1)
  assert.notEqual(entrypointStart, -1)
  const runSource = uat.slice(runStart, entrypointStart)
  const connect = runSource.indexOf("await db.connect()")
  const preflight = runSource.indexOf("await currentCounts()")
  const preflightPassed = runSource.indexOf(
    "currentCountsPreflightPassed = true",
  )
  const preflightMarker = runSource.indexOf(
    'console.log("CURRENT_COUNTS_PREFLIGHT_PASS")',
  )
  const createUsers = runSource.indexOf("await createUsers()")
  assert(connect >= 0)
  assert(preflight > connect)
  assert(preflightPassed > preflight)
  assert(preflightMarker > preflightPassed)
  assert(createUsers > preflightMarker)
  assert.match(
    runSource,
    /current_counts_preflight:\s*currentCountsPreflightPassed/,
  )

  const triggerEnd = workflow040.indexOf("\npermissions:")
  const pathsStart = workflow040.indexOf("    paths:")
  assert(pathsStart >= 0)
  assert(triggerEnd > pathsStart)
  const triggerPaths = workflow040.slice(pathsStart, triggerEnd)
  assert.equal((triggerPaths.match(/^\s{6}- /gm) ?? []).length, 3)
  for (const path of [
    ".github/workflows/extraordinary-040-dev-one-shot.yml",
    "scripts/qa/extraordinary-039-dev-uat.mjs",
    "scripts/qa/extraordinary-storage-policy-helper-039-contract.test.mjs",
  ]) {
    assert.match(triggerPaths, new RegExp(path.replaceAll(".", "\\.")))
  }
  assert.doesNotMatch(workflow040.slice(0, triggerEnd), /workflow_dispatch/)
  assert.equal((workflow040.match(/GITHUB_RUN_ATTEMPT/g) ?? []).length, 2)

  const stateGateStart = workflow040.indexOf(
    "      - name: Classify the one-shot state",
  )
  const precheckStart = workflow040.indexOf(
    "      - name: Archived installation precheck",
    stateGateStart,
  )
  assert(stateGateStart >= 0)
  assert(precheckStart > stateGateStart)
  const stateGate = workflow040.slice(stateGateStart, precheckStart)
  assert.match(
    stateGate,
    /if \[ "\$mode" != "already_applied_exact" \]; then/,
  )
  assert.match(stateGate, /STATE_GATE_040_ALREADY_APPLIED_EXACT/)

  const backupStart = workflow040.indexOf(
    "      - name: Archived pre-install backup",
    precheckStart,
  )
  const migrationStart = workflow040.indexOf(
    "      - name: Archived migration 040 step",
    backupStart,
  )
  const postcheckStart = workflow040.indexOf(
    "\n      - name:",
    migrationStart + 8,
  )
  assert(backupStart > precheckStart)
  assert(migrationStart > backupStart)
  assert(postcheckStart > migrationStart)
  assert.match(
    workflow040.slice(precheckStart, backupStart),
    /if:\s*\$\{\{\s*github\.run_attempt == 0\s*\}\}/,
  )
  assert.match(
    workflow040.slice(backupStart, migrationStart),
    /if:\s*\$\{\{\s*github\.run_attempt == 0\s*\}\}/,
  )
  assert.match(
    workflow040.slice(migrationStart, postcheckStart),
    /if:\s*\$\{\{\s*false\s*\}\}/,
  )
  assert.match(
    workflow040,
    /uat-mej05-after-040:[\s\S]*?needs:\s*apply-040-once[\s\S]*?outputs\.initial_mode ==[\s\S]*?'already_applied_exact'/,
  )
  assert.match(
    workflow040,
    /\.current_counts_preflight ==[\s\S]*?"CURRENT_COUNTS_PREFLIGHT_PASS"/,
  )

  const expectedFilesStart = workflow040.indexOf("expected_files=(")
  const expectedFilesEnd = workflow040.indexOf(
    "\n          )",
    expectedFilesStart,
  )
  assert(expectedFilesStart >= 0)
  assert(expectedFilesEnd > expectedFilesStart)
  const expectedFiles = workflow040.slice(
    expectedFilesStart,
    expectedFilesEnd,
  )
  assert.equal((expectedFiles.match(/^\s{12}"/gm) ?? []).length, 3)
  assert.match(
    expectedFiles,
    /scripts\/qa\/extraordinary-storage-policy-helper-039-contract\.test\.mjs/,
  )
  assert.match(uat, /PRE_RATIFICATION_PAID/i)
  assert.doesNotMatch(uat, /\bservice_role\b/i)
  assert.doesNotMatch(uat, /eyJ[A-Za-z0-9_-]{20,}/)
  assert.doesNotMatch(uat, /postgres(?:ql)?:\/\//i)
  assert.doesNotMatch(uat, /supabase\.co\/storage\/v1\/object\/public\/.*token/i)
})

test("UAT exercises the fail-closed business and evidence matrix", () => {
  for (const marker of [
    "policy_disabled_denied",
    "amount_exceeded_denied",
    "category_denied",
    "evidence_missing_denied",
    "evidence_inconsistent_denied",
    "director_inactive_denied",
    "director_other_company_denied",
    "finance_equals_director_denied",
    "rejected_request_denied",
    "open_batch_denied",
    "expired_authorization_denied",
    "idempotency_conflict_denied",
    "double_consumption_denied",
    "wrong_director_ratification_denied",
    "discrepancy_rollback_pass",
    "material_change_rollback_pass",
  ]) {
    assert.match(uat, new RegExp(`negative\\.${marker}\\b`, "i"))
  }
  assert.match(uat, /runPreAuthorizationNegatives\(finance\)/)
  assert.match(uat, /extraordinary_evidence_object_not_found/)
  assert.match(uat, /extraordinary_evidence_object_metadata_mismatch/)
  assert.match(uat, /extraordinary_authorization_already_consumed_or_closed/)
  assert.match(uat, /dispute_extraordinary_authorization/)
  assert.match(uat, /set amount_requested = amount_requested \+ 0\.01/)
  assert.match(uat, /Object\.values\(negative\)\.every\(Boolean\)/)
})

test("UAT cleanup blocks users and removes effective QA IAM", () => {
  assert.match(uat, /auth\.signOut\(\{\s*scope:\s*"global"/i)
  assert.match(uat, /ban_duration:\s*"876000h"/i)
  assert.match(uat, /set active = false/i)
  assert.match(uat, /delete from public\.user_roles/i)
  assert.match(uat, /set enabled = false/i)
  assert.match(uat, /QA_AUTHORIZATION_REVOKE_FAILED/i)
  assert.match(uat, /QA_ORPHAN_STORAGE_REMOVE_FAILED/i)
  assert.match(uat, /QA_ORPHAN_STORAGE_OBJECT_REMAINS/i)
  assert.match(uat, /QA_REFRESH_TOKENS_REMAIN/i)
  assert.match(uat, /OPERADORA_POLICY_ENABLED/i)
})
