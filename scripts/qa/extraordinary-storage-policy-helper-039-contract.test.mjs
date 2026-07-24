import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"

const read = (path) => readFileSync(path, "utf8")
const sha256 = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex")
const hashText = (algorithm, value) =>
  createHash(algorithm).update(Buffer.from(value, "utf8")).digest("hex")
const canonicalizeHelperBody = (value) =>
  value.replaceAll("\r\n", "\n").replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "")

const scanDollarQuotes = (sql) => {
  const blocks = []
  let index = 0

  while (index < sql.length) {
    if (sql.startsWith("--", index)) {
      const newline = sql.indexOf("\n", index + 2)
      index = newline === -1 ? sql.length : newline + 1
      continue
    }
    if (sql.startsWith("/*", index)) {
      let depth = 1
      index += 2
      while (index < sql.length && depth > 0) {
        if (sql.startsWith("/*", index)) {
          depth += 1
          index += 2
        } else if (sql.startsWith("*/", index)) {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      assert.equal(depth, 0, "unterminated SQL block comment")
      continue
    }
    if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index]
      index += 1
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2
            continue
          }
          index += 1
          break
        }
        index += 1
      }
      continue
    }
    if (sql[index] === "$") {
      const tag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (tag) {
        const bodyStart = index + tag.length
        const bodyEnd = sql.indexOf(tag, bodyStart)
        assert.notEqual(bodyEnd, -1, `unterminated SQL dollar quote ${tag}`)
        blocks.push({
          start: index,
          bodyStart,
          bodyEnd,
          end: bodyEnd + tag.length,
          tag,
        })
        index = bodyEnd + tag.length
        continue
      }
    }
    index += 1
  }

  return blocks
}

const extractFunction = (sql, qualifiedName) => {
  const functionStart = sql
    .toLowerCase()
    .indexOf(`create or replace function ${qualifiedName.toLowerCase()}(`)
  assert.notEqual(functionStart, -1, `missing function ${qualifiedName}`)
  const bodyBlock = scanDollarQuotes(sql).find(
    (block) => block.start > functionStart,
  )
  assert.ok(bodyBlock, `missing dollar-quoted body for ${qualifiedName}`)
  const semicolon = sql.indexOf(";", bodyBlock.end)
  assert.notEqual(semicolon, -1, `missing terminator for ${qualifiedName}`)
  return {
    body: sql.slice(bodyBlock.bodyStart, bodyBlock.bodyEnd),
    definition: sql.slice(functionStart, semicolon + 1),
  }
}

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
const shadowPregrantPath =
  "scripts/qa/shadow/039_pregrant_storage_policy_contracts.sql"
const shadowPostgrantPath =
  "scripts/qa/shadow/039_postgrant_storage_policy_contracts.sql"
const shadowRunnerPath =
  "scripts/qa/shadow/run-extraordinary-migrations.ps1"

const migration037 = read(migration037Path)
const migration038 = read(migration038Path)
const migration039 = read(migration039Path)
const precheck = read(precheckPath)
const postcheck = read(postcheckPath)
const backup = read(backupPath)
const uat = read(uatPath)
const workflow = read(workflowPath)
const shadowPregrant = read(shadowPregrantPath)
const shadowPostgrant = read(shadowPostgrantPath)
const shadowRunner = read(shadowRunnerPath)
const approvedHelper = extractFunction(
  migration037,
  "public.extraordinary_evidence_storage_allowed",
)

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
  const helper = approvedHelper.definition
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

test("helper comparison accepts only CRLF transport and outer whitespace", () => {
  const lfBody = approvedHelper.body
  const crlfBody = lfBody.replaceAll("\n", "\r\n")
  const canonicalBody = canonicalizeHelperBody(lfBody)

  assert.equal(Buffer.byteLength(lfBody), 1247)
  assert.equal(hashText("md5", lfBody), "9295f516acb33ab9a9f9e5df67ce707b")
  assert.equal(
    hashText("sha256", lfBody),
    "6e7db4df1e8f4aa44ffd2cc710ee49823761b7f801975616945cfb81c9dd475d",
  )
  assert.equal(Buffer.byteLength(crlfBody), 1289)
  assert.equal(hashText("md5", crlfBody), "a7879f8dcc683cb5b552387bedb0d499")
  assert.equal(
    hashText("sha256", crlfBody),
    "c3a6a4d1b447323a320f5663bef28a201b420826485f47eba41c0118faf0d86e",
  )
  assert.equal(Buffer.byteLength(canonicalBody), 1245)
  assert.equal(
    hashText("md5", canonicalBody),
    "1cdbbec6f293ca5a546e3fb993f1a4c4",
  )
  assert.equal(
    hashText("sha256", canonicalBody),
    "53042a2a564b84c8e19620bbbd487b8e3f33b9a47cc31faadedda992918e978c",
  )
  assert.equal(
    canonicalizeHelperBody(crlfBody),
    canonicalBody,
    "audited CRLF transport must canonicalize to the approved LF body",
  )

  const interiorMutation = crlfBody.replace(
    "v_authorization.status = 'draft'",
    "v_authorization.status  = 'draft'",
  )
  assert.notEqual(
    canonicalizeHelperBody(interiorMutation),
    canonicalBody,
    "interior whitespace must remain byte-significant",
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
    assert.match(source, /1cdbbec6f293ca5a546e3fb993f1a4c4/i)
    assert.match(
      source,
      /53042a2a564b84c8e19620bbbd487b8e3f33b9a47cc31faadedda992918e978c/i,
    )
    assert.match(
      source,
      /replace\(v_function_source,\s*E'\\r\\n',\s*E'\\n'\)/i,
    )
    assert.match(source, /\bbtrim\(/i)
    assert.doesNotMatch(
      source,
      /regexp_replace\(\s*v_function_source[\s\S]{0,120}'\\s\+'/i,
    )
    assert.match(source, /function_info\.prosrc/i)
    assert.doesNotMatch(source, /md5\(pg_get_functiondef/i)
    assert.match(source, /authenticated already has EXECUTE/i)
    assert.match(source, /anon or PUBLIC unexpectedly has EXECUTE/i)
    assert.match(source, /extraordinary_evidence_insert/i)
    assert.match(source, /extraordinary_evidence_select/i)
    assert.match(source, /extraordinary-approval-evidence/i)
    assert.match(source, /file_size_limit = 5242880/i)
    assert.match(source, /service_role/i)
    assert.match(source, /aclexplode/i)
    assert.match(source, /proparallel/i)
    assert.match(source, /proleakproof/i)
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
  assert.match(precheck, /MEJ05_039_RECONCILED_PRECHECK_PASS/i)
  for (const source of [precheck, migration039]) {
    assert.match(source, /event_type = 'legacy_revoked_preserved'/i)
    assert.match(source, /migration-036:revoked:/i)
    assert.match(source, /migration_036_governance/i)
    assert.doesNotMatch(
      source,
      /count\(\*\)\s+filter\s*\(\s*where status = 'revoked'\s*\)\s*<> 1/i,
    )
  }
  assert.doesNotMatch(
    precheck,
    /^\s*(insert|update|delete|truncate|merge|grant|revoke|alter|create|drop)\b/im,
  )
})

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

test("postgrant recovery locks both 039 replay and the blocked UAT", () => {
  assert.match(workflow, /permissions:[\s\S]*deployments:\s*read/i)
  assert.match(workflow, /permissions:[\s\S]*pull-requests:\s*read/i)
  assert.match(workflow, /permissions:[\s\S]*statuses:\s*read/i)
  assert.match(workflow, /outputs:[\s\S]*state_gate\.outputs\.mode/i)
  assert.match(workflow, /id:\s*state_gate/i)
  assert.match(
    workflow,
    /state="\$\([\s\S]*begin transaction read only;[\s\S]*has_function_privilege\([\s\S]*authenticated[\s\S]*postgrant[\s\S]*pregrant/i,
  )
  assert.match(
    workflow,
    /sql_file="scripts\/qa\/extraordinary-039-dev-postcheck-readonly\.sql"/i,
  )
  assert.match(
    workflow,
    /migrate:\s*[\s\S]*?needs:\s*precheck\s*[\s\S]*?if:\s*\$\{\{\s*false\s*\}\}/i,
  )
  assert.match(
    workflow,
    /Archived migration step - permanently unreachable[\s\S]*?if:\s*\$\{\{\s*false\s*\}\}/i,
  )
  assert.match(workflow, /test "\$state" = "postgrant"/i)
  assert.doesNotMatch(
    workflow,
    /needs\.precheck\.outputs\.mode == 'pregrant'/i,
  )
  assert.match(
    workflow,
    /uat:\s*[\s\S]*?needs:\s*\[precheck,\s*migrate\]\s*[\s\S]*?if:\s*\$\{\{\s*false\s*\}\}/i,
  )
  assert.match(
    workflow,
    /blocker:\s*[\s\S]*?needs:\s*\[precheck,\s*migrate,\s*uat\][\s\S]*?BLOCKED_MEJ05_CONSUMPTION_TRIGGER_RECHECK_DECISION_REQUIRED/i,
  )
  assert.doesNotMatch(workflow, /needs\.migrate\.result == 'success'/i)
  assert.doesNotMatch(workflow, /needs\.precheck\.outputs\.mode == 'pregrant'/i)
  assert.equal(
    (workflow.match(/fetch-depth:\s*4\b/g) ?? []).length,
    2,
    "precheck and migration checkouts must include EXPECTED_BASE",
  )
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
  assert.match(workflow, /BLOCKED_MIGRATION_039_RECONCILED_ATTEMPT_FAILED/i)
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
  assert.match(uat, /event\.company_id = \$2/i)
  assert.match(uat, /object\.name like \$2::text \|\| '\/%'/i)
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
