import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  EXPECTED_EXPIRED_LINK_POST_STATE,
  EXPECTED_EXPIRED_LINK_PRE_STATE,
  assertSanitizedProviderEvidence,
  assertExpiredLinkNormalizationTransition,
  assertMutableAuthorization,
  buildLiveProviderTargets,
  classifyExpiredLinkState,
  classifyExpiredLinkStateFromDatabaseFilter,
  normalizationProtectedSnapshot,
  runCapabilityAudit,
  runNoWriteMocked,
  sanitizedProviderAlignment,
  validateExpiredLinkNormalizationEvidence,
  validateNormalizationApplyResult,
  validateNormalizationDryRunResult,
  validateNormalizationMutation,
  validateNormalizationOptimisticSnapshot,
} from "./provider-intake-matching-gate2-uat.mjs"
import {
  assertLiveProviderLocatorInputs,
  classifyProviderCardHeadings,
  exactNormalizedText,
  normalizeLiveProviderText,
} from "./provider-intake-matching-flow.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const bytes = (relative) => fs.readFileSync(path.join(root, relative))

const migrationPath = "supabase/migrations/031_provider_intake_matching.sql"
const loadPath = "ops/provider-intake/apply-031-matching/03_LOAD_031_EXACT.sql"
const migration = read(migrationPath)
const runner = read("scripts/qa/provider-intake-matching-gate2-uat.mjs")

const functionDefinition = (name) => {
  const pattern = new RegExp(
    `create function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  )
  const match = migration.match(pattern)
  assert.ok(match, `missing function definition for ${name}`)
  return match[0]
}

test("Migration 031 and its operational LOAD are byte-identical", () => {
  assert.deepEqual(bytes(migrationPath), bytes(loadPath))
})

test("Migration 031 has a stable SHA-256 recorded in the runbook", () => {
  const digest = crypto.createHash("sha256").update(bytes(migrationPath)).digest("hex")
  const readme = read("ops/provider-intake/apply-031-matching/00_README.md")
  assert.match(digest, /^[0-9a-f]{64}$/)
  assert.match(readme, new RegExp(digest))
})

test("three authenticated matching RPCs use definer rights and a fixed search path", () => {
  for (const name of [
    "find_provider_intake_candidates",
    "get_provider_intake_match_comparison",
    "set_provider_intake_match",
  ]) {
    const definition = functionDefinition(name)
    assert.match(definition, /security definer\s+set search_path = public, pg_temp/i)
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}\\([\\s\\S]*?to authenticated;`, "i"),
    )
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]{0,180}\bto anon\b/i)
  assert.match(migration, /privilege\.grantee = 0[\s\S]*privilege\.privilege_type = 'EXECUTE'/i)
})

test("internal normalization and fingerprint helpers are invoker-only and ungranted", () => {
  for (const name of [
    "normalize_provider_match_text",
    "normalize_provider_match_digits",
    "provider_intake_match_fingerprint",
  ]) {
    const definition = functionDefinition(name)
    assert.match(definition, /security invoker\s+set search_path = public, pg_temp/i)
    assert.doesNotMatch(definition, /security definer/i)
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public, anon, authenticated, service_role;`, "i"),
    )
  }
})

test("candidate engine is server-side, bounded, deterministic, and explains score", () => {
  const definition = functionDefinition("find_provider_intake_candidates")
  assert.match(definition, /least\(greatest\(coalesce\(p_limit, 12\), 1\), 25\)/)
  assert.match(definition, /case when rfc_exact then 70 else 0 end/)
  assert.match(definition, /case when clabe_exact then 45 else 0 end/)
  assert.match(definition, /case when account_exact then 30 else 0 end/)
  assert.match(definition, /when c\.score >= 70 then 'high'/)
  assert.match(definition, /when c\.score >= 40 then 'medium'/)
  assert.match(definition, /'reasons'/)
  assert.match(definition, /'differences'/)
  assert.match(definition, /'duplicate_rfc_count'/)
  assert.doesNotMatch(definition, /pg_trgm|similarity\s*\(/i)
})

test("inactive providers are warning-only unless a critical exact signal exists", () => {
  const definition = functionDefinition("find_provider_intake_candidates")
  assert.match(
    definition,
    /where coalesce\(activo, true\)\s+or rfc_exact\s+or clabe_exact\s+or account_exact/i,
  )
  assert.match(definition, /'selectable', coalesce\(c\.activo, true\)/)
  assert.match(functionDefinition("set_provider_intake_match"), /provider_intake_provider_inactive/)
})

test("comparison returns eight labeled rows and masks bank identifiers", () => {
  const definition = functionDefinition("get_provider_intake_match_comparison")
  for (const field of [
    "Razón social", "RFC", "Banco", "Cuenta", "CLABE",
    "Beneficiario", "Correo", "Teléfono",
  ]) {
    assert.match(definition, new RegExp(`'field', '${field}'`))
  }
  assert.match(definition, /provider_intake_mask_value\(v_intake\.bank_account\)/)
  assert.match(definition, /provider_intake_mask_value\(v_provider\.cuenta_bancaria\)/)
  assert.match(definition, /provider_intake_mask_value\(v_intake\.bank_clabe\)/)
  assert.match(definition, /provider_intake_mask_value\(v_provider\.clabe\)/)
  assert.doesNotMatch(definition, /'declared',\s*v_intake\.bank_(?:account|clabe)\b/)
  assert.doesNotMatch(definition, /'master',\s*v_provider\.(?:cuenta_bancaria|clabe)\b/)
})

test("set replace and clear require explicit optimistic material", () => {
  const definition = functionDefinition("set_provider_intake_match")
  assert.match(definition, /v_action_kind := 'match_set'/)
  assert.match(definition, /v_action_kind := 'match_replace'/)
  assert.match(definition, /v_action_kind := 'match_clear'/)
  assert.match(definition, /v_intake\.status <> 'in_review'/)
  assert.match(definition, /v_intake\.created_payment_request_id is not null/)
  assert.match(definition, /v_intake\.updated_at is distinct from p_expected_updated_at/)
  assert.match(definition, /v_intake\.matched_proveedor_id is distinct from p_expected_current_match/)
  assert.match(definition, /provider_intake_match_reason_required/)
  assert.match(definition, /provider_intake_match_reason_sensitive/)
})

test("matching uses contract-v3 material idempotency and one append-only event", () => {
  const definition = functionDefinition("set_provider_intake_match")
  assert.match(definition, /provider_intake_match_fingerprint\(/)
  assert.match(definition, /'contract_version', 3/)
  assert.match(definition, /action_fingerprint is distinct from v_action_fingerprint/)
  assert.match(definition, /action_kind is distinct from v_action_kind/)
  assert.match(definition, /actor_profile_id is distinct from v_actor_profile_id/)
  assert.equal(definition.match(/insert into public\.payment_intake_events/g)?.length, 1)
  assert.match(definition, /'provider_matched'/)
  assert.match(definition, /'previous_match_present'/)
  assert.match(definition, /'new_match_present'/)
  assert.match(definition, /'match_confidence'/)
  assert.match(definition, /'reason_code'/)
  assert.match(definition.split("when unique_violation then")[1], /provider_intake_action_id_material_conflict/)
})

test("migration cannot create or mutate providers, requests, batches, layouts, or notifications", () => {
  assert.doesNotMatch(migration, /\bdrop\s+table\b/i)
  assert.doesNotMatch(migration, /\b(delete|truncate)\b/i)
  assert.doesNotMatch(
    migration,
    /\binsert\s+into\s+public\.(proveedores|providers|payment_requests|approval_batches|payment_layouts|payment_layout_lines|notification_events)\b/i,
  )
  assert.doesNotMatch(
    migration,
    /\bupdate\s+public\.(proveedores|providers|payment_requests|approval_batches|payment_layouts|payment_layout_lines|notification_events)\b/i,
  )
  assert.doesNotMatch(migration, /\bupdate\s+public\.payment_intake\s+set\s+status\b/i)
})

test("public provider intake Edge Function remains outside Migration 031", () => {
  assert.doesNotMatch(migration, /supabase\/functions\/provider-intake|edge function/i)
})

test("permanent Gate 2 runner connects every mutable capability behind the explicit gate", async () => {
  const audit = await runCapabilityAudit()
  assert.equal(audit.status, "PASS")
  assert.equal(audit.network_requests, 0)
  assert.equal(Object.keys(audit.capabilities).length, 27)
  assert.deepEqual(
    Object.values(audit.capabilities),
    Object.values(audit.capabilities).map(() => true),
  )
  assert.throws(
    () => assertMutableAuthorization({}),
    /MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED/,
  )
})

const normalizationRows = () => [
  {
    id: "link-revoked",
    company_id: "company-authorized",
    label: "Historical revoked",
    token_hash: "a".repeat(64),
    token_prefix: "revoked-prefix",
    status: "revoked",
    expires_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    created_by: "creator-internal",
  },
  {
    id: "link-active-expired",
    company_id: "company-authorized",
    label: "Historical expired active",
    token_hash: "b".repeat(64),
    token_prefix: "expired-prefix",
    status: "active",
    expires_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    created_by: "creator-internal",
  },
]

const normalizationInput = (rows = normalizationRows(), expected = EXPECTED_EXPIRED_LINK_PRE_STATE) =>
  classifyExpiredLinkState(rows, {
    companyId: "company-authorized",
    databaseNow: "2026-07-20T12:00:00.000Z",
    expected,
  })

const validDryRun = () => ({
  status: "PASS",
  rowCount: 1,
  inTransactionStatus: "expired",
  rolledBack: true,
  realStatus: "active",
  writes: 0,
  businessDelta: 0,
  protectedFieldsInvariant: true,
  databaseTimeAuthoritative: true,
  optimisticGuard: true,
})

const appliedRow = (candidate) => ({
  ...structuredClone(candidate),
  status: "expired",
  updated_at: "2026-07-20T12:01:00.000Z",
})

test("expired-link normalization classifies the authorized pre and post states", () => {
  const before = normalizationInput()
  assert.deepEqual(before.classification, EXPECTED_EXPIRED_LINK_PRE_STATE)
  const databaseFiltered = classifyExpiredLinkStateFromDatabaseFilter(
    normalizationRows(),
    [normalizationRows()[1]],
  )
  assert.deepEqual(databaseFiltered.classification, EXPECTED_EXPIRED_LINK_PRE_STATE)
  assert.equal(databaseFiltered.databaseTimeAuthoritative, true)
  const afterRows = normalizationRows()
  afterRows[1] = appliedRow(afterRows[1])
  const after = normalizationInput(afterRows, EXPECTED_EXPIRED_LINK_POST_STATE)
  assert.deepEqual(after.classification, EXPECTED_EXPIRED_LINK_POST_STATE)
  assert.equal(after.candidate, null)
})

test("normalization SQL is parameterized guarded timed and rollback-capable", () => {
  assert.match(runner, /where id = \$1::uuid/)
  assert.match(runner, /company_id = \$2::uuid/)
  assert.match(runner, /expires_at = \$3::timestamptz/)
  assert.match(runner, /updated_at = \$4::timestamptz/)
  assert.match(runner, /expires_at < current_timestamp/)
  assert.match(runner, /expires_at: "lt\.now"/)
  assert.match(runner, /set local statement_timeout = '15s'/)
  assert.match(runner, /await client\.query\("rollback"\)/)
  assert.doesNotMatch(runner, /update public\.intake_links[\s\S]*?\$\{candidate\./)
})

test("normalization protects every non-status non-updated field", () => {
  const candidate = normalizationInput().candidate
  const after = appliedRow(candidate)
  assert.deepEqual(normalizationProtectedSnapshot(after), normalizationProtectedSnapshot(candidate))
  assert.equal(validateNormalizationMutation(candidate, after), true)
})

const negativeNormalizationCases = [
  ["no active expired", () => {
    const rows = normalizationRows(); rows[1].status = "expired"; return normalizationInput(rows)
  }],
  ["active valid exists", () => {
    const rows = normalizationRows(); rows[0].status = "active"; rows[0].expires_at = "2027-01-01T00:00:00.000Z"; return normalizationInput(rows)
  }],
  ["two active expired links", () => {
    const rows = normalizationRows(); rows[0].status = "active"; return normalizationInput(rows)
  }],
  ["candidate belongs to another company", () => {
    const rows = normalizationRows(); rows[1].company_id = "other-company"; return normalizationInput(rows)
  }],
  ["expires_at is null", () => {
    const rows = normalizationRows(); rows[1].expires_at = null; return normalizationInput(rows)
  }],
  ["expires_at is not expired", () => {
    const rows = normalizationRows(); rows[1].expires_at = "2027-01-01T00:00:00.000Z"; return normalizationInput(rows)
  }],
  ["status changed before apply", () => {
    const expected = normalizationInput().candidate; const actual = { ...expected, status: "expired" }; return validateNormalizationOptimisticSnapshot(expected, actual)
  }],
  ["updated_at changed before apply", () => {
    const expected = normalizationInput().candidate; const actual = { ...expected, updated_at: "2026-07-20T12:02:00.000Z" }; return validateNormalizationOptimisticSnapshot(expected, actual)
  }],
  ["expires_at changed before apply", () => {
    const expected = normalizationInput().candidate; const actual = { ...expected, expires_at: "2026-01-03T00:00:00.000Z" }; return validateNormalizationOptimisticSnapshot(expected, actual)
  }],
  ["update rowcount zero", () => validateNormalizationDryRunResult({ ...validDryRun(), rowCount: 0 }, normalizationInput().candidate)],
  ["update rowcount greater than one", () => validateNormalizationDryRunResult({ ...validDryRun(), rowCount: 2 }, normalizationInput().candidate)],
  ["postcheck remains active", () => validateNormalizationDryRunResult({ ...validDryRun(), inTransactionStatus: "active" }, normalizationInput().candidate)],
  ["protected field changed", () => {
    const candidate = normalizationInput().candidate; return validateNormalizationApplyResult({ status: "expired", rowCount: 1, row: { ...appliedRow(candidate), label: "changed" }, protectedFieldsInvariant: true }, candidate)
  }],
  ["business delta is nonzero", () => validateNormalizationDryRunResult({ ...validDryRun(), businessDelta: 1 }, normalizationInput().candidate)],
  ["dry-run omitted rollback", () => validateNormalizationDryRunResult({ ...validDryRun(), rolledBack: false }, normalizationInput().candidate)],
  ["token_hash changed", () => {
    const candidate = normalizationInput().candidate; return validateNormalizationMutation(candidate, { ...appliedRow(candidate), token_hash: "c".repeat(64) })
  }],
  ["token_prefix changed", () => {
    const candidate = normalizationInput().candidate; return validateNormalizationMutation(candidate, { ...appliedRow(candidate), token_prefix: "changed-prefix" })
  }],
  ["revoked used instead of expired", () => {
    const candidate = normalizationInput().candidate; return validateNormalizationApplyResult({ status: "revoked", rowCount: 1, row: { ...appliedRow(candidate), status: "revoked" }, protectedFieldsInvariant: true }, candidate)
  }],
  ["expired link reactivation", () => assertExpiredLinkNormalizationTransition("expired", "active")],
  ["evidence exports internal link material", () => {
    const candidate = normalizationInput().candidate; return validateExpiredLinkNormalizationEvidence({ leaked: candidate.id }, candidate)
  }],
]

for (const [name, operation] of negativeNormalizationCases) {
  test(`normalization fails closed: ${name}`, () => {
    assert.throws(operation, (error) => {
      assert.match(error.code, /^EXPIRED_LINK_/)
      return true
    })
  })
}

const providerRows = (aliases = ["Proveedor sintético alfa", "Proveedor sintético beta"]) =>
  aliases.map((alias, index) => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    alias,
    nombre_completo: `QA fixture ${index + 1}`,
    email: `qa-provider-${index + 1}@example.invalid`,
    activo: true,
  }))

test("provider target model separates logical internal and live visual identities", () => {
  const targets = buildLiveProviderTargets(providerRows())
  assert.equal(targets.length, 2)
  assert.equal(targets[0].logicalAlias, "QA_MATCH_PROVIDER_A")
  assert.equal(targets[1].logicalAlias, "QA_MATCH_PROVIDER_B")
  assert.notEqual(targets[0].logicalAlias, targets[0].liveDisplayAlias)
  assert.equal(targets[1].uiSearchText, targets[1].liveDisplayAlias)
  assert.equal(targets[1].expectedCardHeading, targets[1].liveDisplayAlias)
  assert.notEqual(targets[0].internalId, targets[1].internalId)
  assert.deepEqual(sanitizedProviderAlignment(targets), {
    status: "PASS",
    eligible_targets: 2,
    logical_aliases: ["QA_MATCH_PROVIDER_A", "QA_MATCH_PROVIDER_B"],
    live_aliases_present: true,
    live_aliases_distinct: true,
    logical_alias_used_as_live_locator: false,
    provider_ids_exported: false,
    live_aliases_exported: false,
    writes: 0,
  })
})

test("provider target resolution rejects missing empty duplicate and logical live aliases", () => {
  assert.throws(
    () => buildLiveProviderTargets(providerRows().slice(0, 1)),
    /LIVE_PROVIDER_ALIAS_UNRESOLVED/,
  )
  assert.throws(
    () => buildLiveProviderTargets(providerRows(["", "Proveedor sintético beta"])),
    /LIVE_PROVIDER_ALIAS_UNRESOLVED/,
  )
  assert.throws(
    () => buildLiveProviderTargets(providerRows(["Proveedor sintético", "Proveedor sintético"])),
    /LIVE_PROVIDER_ALIAS_AMBIGUOUS/,
  )
  assert.throws(
    () => buildLiveProviderTargets(providerRows(["QA_MATCH_PROVIDER_A", "Proveedor sintético"])),
    /LOGICAL_ALIAS_USED_AS_LIVE_LOCATOR/,
  )
})

test("live alias normalization handles Unicode whitespace and regex metacharacters safely", () => {
  assert.equal(
    normalizeLiveProviderText("  Proveedor\tSinte\u0301tico   Beta  "),
    "Proveedor Sintético Beta",
  )
  const exact = exactNormalizedText("Proveedor [QA] + (Beta)?")
  assert.equal(exact.test("Proveedor [QA] + (Beta)?"), true)
  assert.equal(exact.test("Proveedor QA + Beta"), false)
})

test("logical aliases can never be passed as live search or heading text", () => {
  assert.throws(
    () => assertLiveProviderLocatorInputs({
      sanitizedTargetAlias: "QA_MATCH_PROVIDER_B",
      searchText: "QA_MATCH_PROVIDER_B",
      expectedCardHeading: "QA_MATCH_PROVIDER_B",
    }),
    /LOGICAL_ALIAS_USED_AS_LIVE_LOCATOR/,
  )
})

test("exact-card validation fails closed for missing ambiguous and mismatched cards", () => {
  assert.throws(
    () => classifyProviderCardHeadings([], "Proveedor sintético beta"),
    /LIVE_PROVIDER_CARD_NOT_FOUND/,
  )
  assert.throws(
    () => classifyProviderCardHeadings(
      ["Proveedor sintético beta", "Proveedor sintético beta"],
      "Proveedor sintético beta",
    ),
    /LIVE_PROVIDER_ALIAS_AMBIGUOUS/,
  )
  assert.throws(
    () => classifyProviderCardHeadings(
      ["Proveedor sintético alfa"],
      "Proveedor sintético beta",
    ),
    /LIVE_PROVIDER_CARD_MISMATCH/,
  )
})

test("provider evidence and exported errors reject live aliases and internal IDs", () => {
  const targets = buildLiveProviderTargets(providerRows())
  for (const leaked of [targets[0].liveDisplayAlias, targets[1].internalId]) {
    assert.throws(
      () => assertSanitizedProviderEvidence({ leaked }, targets),
      (error) =>
        error.code === "LIVE_PROVIDER_EVIDENCE_LEAKAGE" &&
        !error.message.includes(leaked),
    )
  }
})

test("updated capability audit certifies alias separation without network or writes", async () => {
  const audit = await runCapabilityAudit()
  assert.equal(audit.network_requests, 0)
  assert.equal(audit.writes, 0)
  for (const capability of [
    "live_provider_alias_resolution",
    "logical_visual_identity_separation",
    "live_alias_not_logged",
    "logical_alias_not_used_as_live_locator",
    "exact_card_validation",
    "ambiguous_card_failure",
    "missing_alias_failure",
    "sanitization_before_evidence",
  ]) {
    assert.equal(audit.capabilities[capability], true)
  }
})

test("no-write mocked recertifies normalization MAIN RACE and 20 cleanup cases without leakage", async () => {
  const result = await runNoWriteMocked()
  assert.equal(result.status, "PASS")
  assert.equal(result.main.status, "PASS")
  assert.equal(result.race.status, "PASS")
  assert.equal(result.cleanup_matrix.status, "PASS")
  assert.equal(result.cleanup_matrix.total, 20)
  assert.equal(result.expired_link_normalization.dry_run, "PASS")
  assert.equal(result.expired_link_normalization.apply, "expired")
  assert.deepEqual(result.link_inventory, {
    historical_expired: 1,
    qa_revoked: 1,
    active: 0,
  })
  assert.equal(result.actual_mutable_supabase_requests, 0)
  assert.equal(result.actual_dev_writes, 0)
  const serialized = JSON.stringify(result)
  for (const forbidden of [
    "Proveedor sintético alfa",
    "Proveedor sintético beta",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden))
  }
})
