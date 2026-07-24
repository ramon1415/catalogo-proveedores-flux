import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex")

const migration036Path =
  "supabase/migrations/036_quarantine_legacy_extraordinary_authorizations.sql"
const migration037Path =
  "supabase/migrations/037_secure_extraordinary_external_authorization.sql"
const migration038Path =
  "supabase/migrations/038_materialize_only_released_batch_items.sql"
const migration039Path =
  "supabase/migrations/039_enable_extraordinary_evidence_storage_policy_helper.sql"
const precheckPath =
  "scripts/qa/extraordinary-039-dev-precheck-readonly.sql"
const postcheckPath =
  "scripts/qa/extraordinary-039-dev-postcheck-readonly.sql"
const backupPath =
  "scripts/qa/extraordinary-039-private-logical-backup.sql"
const uatPath = "scripts/qa/extraordinary-039-dev-uat.mjs"
const workflowPath =
  ".github/workflows/extraordinary-039-dev-precheck-readonly.yml"

const migration037 = read(migration037Path)
const migration038 = read(migration038Path)
const migration039 = read(migration039Path)
const precheck = read(precheckPath)
const postcheck = read(postcheckPath)
const backup = read(backupPath)
const uat = read(uatPath)
const workflow = read(workflowPath)

test("migrations 036-038 remain byte-identical to the applied branch head", () => {
  assert.equal(
    sha256(migration036Path),
    "844d98c16c56ff97976c64b6db20aeb35e90fe9720f45b91844dd5d3e23a7547",
  )
  assert.equal(
    sha256(migration037Path),
    "266542d2b587c46f99a64eabe3b362f7cb039249b7efda1479572bffbded7c87",
  )
  assert.equal(
    sha256(migration038Path),
    "72b926c71204bc6ca76a3d06b97c5549d5d321eda69161d661cafdeaaff8f8bf",
  )
})

test("037 policies depend on the helper in write and read modes", () => {
  assert.match(
    migration037,
    /create policy extraordinary_evidence_insert[\s\S]*extraordinary_evidence_storage_allowed\(name,\s*true\)/i,
  )
  assert.match(
    migration037,
    /create policy extraordinary_evidence_select[\s\S]*extraordinary_evidence_storage_allowed\(name,\s*false\)/i,
  )
  assert.match(
    migration037,
    /revoke all on function public\.extraordinary_evidence_storage_allowed\(text,boolean\)[\s\S]*from public,\s*anon,\s*authenticated/i,
  )
})

test("the approved helper is boolean, stable, definer and side-effect-free", () => {
  const helper = migration037.match(
    /create or replace function public\.extraordinary_evidence_storage_allowed\([\s\S]*?\n\$\$;/i,
  )?.[0]
  assert.ok(helper)
  assert.match(helper, /returns boolean/i)
  assert.match(helper, /\bstable\b/i)
  assert.match(helper, /\bsecurity definer\b/i)
  assert.match(helper, /set search_path = public,\s*pg_temp/i)
  assert.doesNotMatch(
    helper,
    /^\s*(insert|update|delete|truncate|merge|execute)\b/im,
  )
  assert.doesNotMatch(helper, /\bformat\s*\(/i)
  assert.doesNotMatch(helper, /\bset_config\s*\(/i)
  assert.match(
    helper,
    /p_name !~ '\^\[0-9a-f-\]\{36\}\/\[0-9a-f-\]\{36\}\/evidence\/\[0-9a-f-\]\{36\}\$'/i,
  )
  assert.match(helper, /evidence_storage_path = p_name/i)
  assert.match(helper, /v_authorization\.status = 'draft'/i)
  assert.match(helper, /v_authorization\.authorized_by = v_actor/i)
  assert.match(helper, /extraordinary_profile_is_active_member/i)
  assert.match(
    helper,
    /v_actor = v_authorization\.external_director_profile_id/i,
  )
})

test("039 is transactional, forward-only and changes only helper ACL/comment", () => {
  assert.match(migration039, /^\s*begin;/im)
  assert.match(migration039, /\bcommit;\s*[\r\n]+[\r\n]*select\s+'MIGRATION_039_POSTCHECK_PASS'/i)
  assert.doesNotMatch(migration039, /\brollback\b/i)
  assert.doesNotMatch(migration039, /^\s*create\s+(or\s+replace\s+)?function\b/im)
  assert.doesNotMatch(
    migration039,
    /^\s*(insert|update|delete|truncate|merge)\b/im,
  )
  assert.doesNotMatch(migration039, /^\s*(alter|drop|create)\s+table\b/im)
  assert.doesNotMatch(migration039, /^\s*(create|alter|drop)\s+policy\b/im)
  assert.doesNotMatch(migration039, /^\s*(alter|drop)\s+function\b/im)
})

test("039 grants exactly EXECUTE to authenticated and keeps anon/PUBLIC denied", () => {
  const grants = migration039.match(/\bgrant\s+execute\b/gi) ?? []
  assert.equal(grants.length, 1)
  assert.match(
    migration039,
    /grant execute\s+on function public\.extraordinary_evidence_storage_allowed\(text,boolean\)\s+to authenticated;/i,
  )
  assert.match(
    migration039,
    /revoke execute\s+on function public\.extraordinary_evidence_storage_allowed\(text,boolean\)\s+from public,\s*anon;/i,
  )
  assert.doesNotMatch(migration039, /\bgrant\s+all\b/i)
  assert.doesNotMatch(migration039, /\bgrant\b[\s\S]{0,120}\bon\s+table\b/i)
  assert.doesNotMatch(migration039, /\bto\s+(anon|public|service_role)\b/i)
})

test("039 fail-closes on definition, policies, bucket and prior ACL", () => {
  for (const source of [migration039, precheck]) {
    assert.match(source, /4cf587cd26796af6bb9f75c36002757a/i)
    assert.match(
      source,
      /978d2cdac722a202389e151250c5b972a0e1bec43a74e0f5ae59fd1996174cdb/i,
    )
    assert.match(source, /authenticated already has EXECUTE/i)
    assert.match(source, /anon or PUBLIC unexpectedly has EXECUTE/i)
    assert.match(source, /extraordinary_evidence_insert/i)
    assert.match(source, /extraordinary_evidence_select/i)
    assert.match(source, /extraordinary-approval-evidence/i)
    assert.match(source, /file_size_limit = 5242880/i)
    assert.match(source, /Operadora extraordinary policy is enabled/i)
  }
})

test("039 contains no unauthorized identifiers or additional grants", () => {
  const identifiers = [
    ...migration039.matchAll(
      /\b(?:constraint|function|policy|trigger|table)\s+([a-z_][a-z0-9_]*)/gi,
    ),
  ].map((match) => match[1])
  for (const identifier of identifiers) {
    assert.ok(
      Buffer.byteLength(identifier, "utf8") <= 63,
      `identifier exceeds PostgreSQL limit: ${identifier}`,
    )
  }
  assert.equal(
    (migration039.match(/\bgrant\s+execute\b/gi) ?? []).length,
    1,
  )
})

test("038 released-only materialization remains intact", () => {
  assert.match(
    migration038,
    /item\.finance_release_status = 'released'/i,
  )
  assert.match(migration038, /MIGRATION_038_POSTCHECK_PASS/i)
})

test("DEV precheck is session and transaction read-only with rollback", () => {
  assert.match(
    precheck,
    /set session characteristics as transaction read only/i,
  )
  assert.match(precheck, /begin transaction read only/i)
  assert.match(precheck, /set local statement_timeout = '30s'/i)
  assert.match(precheck, /set local lock_timeout = '5s'/i)
  assert.match(precheck, /\brollback;/i)
  assert.doesNotMatch(
    precheck,
    /^\s*(insert|update|delete|truncate|merge|grant|revoke|alter|create|drop)\b/im,
  )
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

test("one-shot workflow prechecks, backs up privately, applies once and then runs UAT", () => {
  assert.match(workflow, /permissions:[\s\S]*deployments:\s*read/i)
  assert.match(workflow, /permissions:[\s\S]*pull-requests:\s*read/i)
  assert.match(workflow, /permissions:[\s\S]*statuses:\s*read/i)
  assert.match(workflow, /needs:\s*precheck/i)
  assert.match(workflow, /needs:\s*migrate/i)
  assert.match(
    workflow,
    /Verify real-session UAT credentials before migration[\s\S]*api-keys\?reveal=true/i,
  )
  assert.match(workflow, /auth\/v1\/admin\/users\?page=1&per_page=1/i)
  assert.match(
    workflow,
    /Install ephemeral DEV API keys[\s\S]*SUPABASE_DEV_SERVICE_ROLE_KEY=\$service_key/i,
  )
  assert.match(
    workflow,
    new RegExp(`EXPECTED_MIGRATION_SHA256:\\s*${sha256(migration039Path)}`),
  )
  assert.match(workflow, /BLOCKED_MIGRATION_039_FIRST_ATTEMPT_FAILED/i)
  assert.equal(
    (workflow.match(/--file "\$MIGRATION_FILE"/g) ?? []).length,
    1,
  )
  assert.match(workflow, /private-backup\.json/i)
  assert.doesNotMatch(
    workflow,
    /path:[\s\S]{0,200}private-backup\.(json|raw)/i,
  )
  assert.match(workflow, /uat-result-sanitized\.json/i)
  assert.match(workflow, /READY_FOR_RAMON_REVIEW/i)
})

test("UAT uses real Auth sessions, private Storage and no payment confirmation", () => {
  assert.match(uat, /auth\.signInWithPassword/i)
  assert.match(uat, /auth\.admin\.createUser/i)
  assert.match(uat, /\.storage[\s\S]*\.upload\(/i)
  assert.match(uat, /contentType:\s*"application\/pdf"/i)
  assert.match(uat, /metadata:\s*\{\s*sha256:/i)
  assert.match(uat, /upsert:\s*false/i)
  assert.match(uat, /begin_extraordinary_authorization/i)
  assert.match(uat, /finalize_extraordinary_authorization/i)
  assert.match(uat, /ratify_extraordinary_authorization/i)
  assert.match(uat, /createSignedUrl\([^,]+,\s*120\)/i)
  assert.match(uat, /consumed_pending_ratification/i)
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
  assert.match(uat, /QA_REFRESH_TOKENS_REMAIN/i)
  assert.match(uat, /OPERADORA_POLICY_ENABLED/i)
})
