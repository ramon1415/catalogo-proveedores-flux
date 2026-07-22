import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
  EXPECTED_EXPIRED_LINK_POST_STATE,
  EXPECTED_ALREADY_NORMALIZED_LINK_STATE,
  EXPECTED_EXPIRED_LINK_PRE_STATE,
  MUTABLE_ACCESSIBILITY_HOOKS,
  assertSanitizedProviderEvidence,
  assertExpiredLinkNormalizationTransition,
  assertMutableAuthorization,
  buildLiveProviderTargets,
  classifyExpiredLinkState,
  classifyExpiredLinkStateFromDatabaseFilter,
  classifyNoWriteBrowserRequest,
  normalizationProtectedSnapshot,
  runCapabilityAudit,
  runNoWriteMocked,
  runV6KCleanupMatrix,
  runV6MCleanupMatrix,
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
import {
  ACCESSIBILITY_STATE_ALIASES,
  AXE_CORE_VERSION,
  assertSanitizedAccessibilityEvidence,
  auditAccessibilityPage,
  createAccessibilityHookRecorder,
  createAccessibilityStateManifest,
  createLocalAxeSource,
  injectLocalAxe,
  runAccessibilityStateManifest,
  sanitizedAxeSourceIdentity,
  validateAccessibilityStateManifest,
} from "./provider-intake-matching-accessibility.mjs"
import {
  CANONICAL_IDEMPOTENCY_HEADER,
  RESPONSE_HEADER_ALLOWLIST,
  PublicSubmitObservabilityError,
  assertSanitizedObservabilityEvidence,
  buildPublicSubmitRequest,
  captureFinalizedPublicSubmitRequest,
  capturePublicSubmitResponse,
  classifyAuthorizedPublicSubmitEndpoint,
  classifyPublicSubmitResponse,
  derivePreviewOrigin,
  flushResponseEvidenceBeforeThrow,
  persistSanitizedEvidenceAtomically,
  runPublicSubmitLoopbackNoWrite,
  runPublicSubmitObservabilityAudit,
  runSyntheticResponseMatrix,
} from "./provider-intake-public-submit-observability.mjs"
import {
  AuthenticatedReadOnlyObservabilityError,
  assertReadOnlySql,
  assertSanitizedAuthenticatedReadOnlyEvidence,
  buildAuthenticatedReadOnlyFailureEnvelope,
  classifyAuthenticatedLinkState,
  classifyAuthenticatedReadOnlyError,
  createAuthenticatedReadOnlyEnvelope,
  parseAuthenticatedReadOnlyChildResult,
  runAuthenticatedReadOnlyPrecheck,
  validateAuthenticatedReadOnlyEnvelope,
} from "./provider-intake-authenticated-readonly-observability.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const bytes = (relative) => fs.readFileSync(path.join(root, relative))

const migrationPath = "supabase/migrations/031_provider_intake_matching.sql"
const loadPath = "ops/provider-intake/apply-031-matching/03_LOAD_031_EXACT.sql"
const migration = read(migrationPath)
const runner = read("scripts/qa/provider-intake-matching-gate2-uat.mjs")
const authenticatedReadonly = read("scripts/qa/provider-intake-authenticated-readonly-observability.mjs")

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
  assert.equal(Object.keys(audit.capabilities).length, 63)
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
  assert.match(authenticatedReadonly, /begin transaction read only/)
  assert.match(authenticatedReadonly, /show transaction_read_only/)
  assert.match(authenticatedReadonly, /read_only_sql_scan/)
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

test("V6N no-write mocked recertifies the post-V6H baseline and 48 cleanup cases without leakage", async () => {
  const result = await runNoWriteMocked()
  assert.equal(result.status, "PASS")
  assert.equal(result.baseline.intake_links, 3)
  assert.equal(result.baseline.link_state, "ALREADY_NORMALIZED")
  assert.equal(result.expired_link_normalization.writes, 0)
  assert.equal(result.simulation.main, "PASS")
  assert.equal(result.simulation.race, "PASS")
  assert.equal(result.simulation.provider_matched_final, 9)
  assert.equal(result.simulation.payment_intake_events_final, 50)
  assert.equal(result.cleanup_matrix.status, "PASS")
  assert.equal(result.cleanup_matrix.total, 48)
  assert.equal(result.capability_count, 63)
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

const validAccessibilityEvidence = (state = ACCESSIBILITY_STATE_ALIASES[0]) => ({
  state,
  axe_version: AXE_CORE_VERSION,
  critical: 0,
  serious: 0,
  moderate: 0,
  minor: 0,
  incomplete: 0,
  rule_ids: [],
  nodes_total: 0,
  sanitized: true,
})

const localAxeFixture = () => createLocalAxeSource({
  source: `/* axe local fixture */${"x".repeat(1_100)}`,
  version: AXE_CORE_VERSION,
  sourcePath: "C:/isolated/node_modules/axe-core/axe.min.js",
})

test("Axe source identity is local pinned hashed and never exports source", () => {
  const localAxe = localAxeFixture()
  const identity = sanitizedAxeSourceIdentity(localAxe)
  assert.equal(identity.version, "4.10.3")
  assert.equal(identity.source_type, "local_dependency")
  assert.equal(identity.network_downloads, 0)
  assert.equal(identity.source_exported, false)
  assert.match(identity.sha256, /^[0-9a-f]{64}$/)
  assert.equal(Object.keys(localAxe).includes("source"), false)
})

test("local Axe injection uses script content and confirms pinned browser version", async () => {
  const localAxe = localAxeFixture()
  let version = null
  let injections = 0
  const page = {
    async evaluate() { return version },
    async addScriptTag({ content }) {
      assert.equal(content, localAxe.source)
      injections += 1
      version = AXE_CORE_VERSION
    },
  }
  assert.equal(await injectLocalAxe(page, localAxe), AXE_CORE_VERSION)
  assert.equal(injections, 1)
})

test("accessibility manifest requires the exact ordered nine-state contract", () => {
  const handlers = Object.fromEntries(ACCESSIBILITY_STATE_ALIASES.map((state) => [state, {
    prepare: async () => state,
    ready: async () => true,
    cleanup: async () => true,
  }]))
  const manifest = createAccessibilityStateManifest(handlers)
  assert.equal(validateAccessibilityStateManifest(manifest), true)
  assert.deepEqual(manifest.map((entry) => entry.stateAlias), ACCESSIBILITY_STATE_ALIASES)
})

test("accessibility manifest fails closed when one required state is absent", () => {
  const handlers = Object.fromEntries(ACCESSIBILITY_STATE_ALIASES.slice(0, -1).map((state) => [state, {
    prepare: async () => state,
    ready: async () => true,
    cleanup: async () => true,
  }]))
  assert.throws(() => createAccessibilityStateManifest(handlers), /LIVE_ACCESSIBILITY_STATE_MISSING/)
})

test("mutable accessibility hooks preserve MAIN RACE terminal ordering", () => {
  assert.deepEqual(
    [...MUTABLE_ACCESSIBILITY_HOOKS.main, ...MUTABLE_ACCESSIBILITY_HOOKS.race, ...MUTABLE_ACCESSIBILITY_HOOKS.terminal],
    ACCESSIBILITY_STATE_ALIASES,
  )
  assert.equal(MUTABLE_ACCESSIBILITY_HOOKS.main.length, 7)
  assert.deepEqual(MUTABLE_ACCESSIBILITY_HOOKS.race, ["race_conflict"])
  assert.deepEqual(MUTABLE_ACCESSIBILITY_HOOKS.terminal, ["terminal_rejected"])
})

test("accessibility recorder accepts all nine sanitized states exactly once", () => {
  const recorder = createAccessibilityHookRecorder()
  for (const state of ACCESSIBILITY_STATE_ALIASES) recorder.record(state, validAccessibilityEvidence(state))
  assert.equal(recorder.assertComplete(), true)
  assert.deepEqual(recorder.sanitizedSummary(), {
    status: "PASS",
    states_required: 9,
    states_audited: 9,
    state_aliases: ACCESSIBILITY_STATE_ALIASES,
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    incomplete: 0,
    sanitized: true,
  })
})

test("accessibility recorder rejects duplicate state evidence", () => {
  const recorder = createAccessibilityHookRecorder()
  recorder.record(ACCESSIBILITY_STATE_ALIASES[0], validAccessibilityEvidence())
  assert.throws(
    () => recorder.record(ACCESSIBILITY_STATE_ALIASES[0], validAccessibilityEvidence()),
    /LIVE_ACCESSIBILITY_STATE_DUPLICATE/,
  )
})

test("accessibility evidence rejects HTML and selector payloads", () => {
  assert.throws(
    () => assertSanitizedAccessibilityEvidence({ ...validAccessibilityEvidence(), html: "<main>secret</main>" }),
    /LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED/,
  )
})

test("accessibility evidence rejects UUID and live-alias leakage", () => {
  assert.throws(
    () => assertSanitizedAccessibilityEvidence(
      validAccessibilityEvidence(),
      [JSON.stringify(validAccessibilityEvidence())],
    ),
    /LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED/,
  )
  assert.throws(
    () => assertSanitizedAccessibilityEvidence({
      ...validAccessibilityEvidence(),
      state: "11111111-1111-4111-8111-111111111111",
    }),
    /LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED/,
  )
})

const fakeAccessibilityPage = ({ critical = 0, serious = 0, axePresent = true } = {}) => {
  let version = axePresent ? AXE_CORE_VERSION : null
  return {
    url: () => "https://preview.example.test/provider_intakes",
    async waitForLoadState() {},
    async waitForTimeout() {},
    async addScriptTag() { version = AXE_CORE_VERSION },
    async evaluate(_callback, tags) {
      if (Array.isArray(tags)) {
        return {
          critical,
          serious,
          moderate: 0,
          minor: 0,
          incomplete: 0,
          rule_ids: critical || serious ? ["color-contrast"] : [],
          nodes_total: critical + serious,
        }
      }
      const source = String(_callback)
      if (source.includes("requestAnimationFrame")) return true
      return version
    },
  }
}

test("critical accessibility violations fail closed", async () => {
  await assert.rejects(
    auditAccessibilityPage(fakeAccessibilityPage({ critical: 1 }), {
      stateAlias: ACCESSIBILITY_STATE_ALIASES[0],
      environment: "LIVE_PREVIEW_NO_WRITE",
      evidenceMode: "SANITIZED",
      authorizedOrigin: "https://preview.example.test",
      localAxe: localAxeFixture(),
    }),
    /LIVE_ACCESSIBILITY_VIOLATION/,
  )
})

test("serious accessibility violations fail closed", async () => {
  await assert.rejects(
    auditAccessibilityPage(fakeAccessibilityPage({ serious: 1 }), {
      stateAlias: ACCESSIBILITY_STATE_ALIASES[0],
      environment: "LIVE_PREVIEW_NO_WRITE",
      evidenceMode: "SANITIZED",
      authorizedOrigin: "https://preview.example.test",
      localAxe: localAxeFixture(),
    }),
    /LIVE_ACCESSIBILITY_VIOLATION/,
  )
})

test("accessibility audit rejects an unauthorized page origin", async () => {
  await assert.rejects(
    auditAccessibilityPage(fakeAccessibilityPage(), {
      stateAlias: ACCESSIBILITY_STATE_ALIASES[0],
      environment: "LIVE_PREVIEW_NO_WRITE",
      evidenceMode: "SANITIZED",
      authorizedOrigin: "https://different.example.test",
      localAxe: localAxeFixture(),
    }),
    /LIVE_ACCESSIBILITY_PREVIEW_ORIGIN_MISMATCH/,
  )
})

test("state manifest always cleans the prepared state after an audit failure", async () => {
  const cleaned = []
  const handlers = Object.fromEntries(ACCESSIBILITY_STATE_ALIASES.map((state) => [state, {
    prepare: async () => state,
    ready: async () => true,
    cleanup: async () => cleaned.push(state),
  }]))
  await assert.rejects(
    runAccessibilityStateManifest(createAccessibilityStateManifest(handlers), async () => {
      throw new Error("AUDIT_STOP")
    }),
    /AUDIT_STOP/,
  )
  assert.deepEqual(cleaned, [ACCESSIBILITY_STATE_ALIASES[0]])
})

test("Preview GET and HEAD assets are the only allowed real network class", () => {
  for (const method of ["GET", "HEAD"]) {
    assert.equal(classifyNoWriteBrowserRequest({
      url: "https://preview.example.test/assets/app.js",
      method,
      previewUrl: "https://preview.example.test/provider_intakes",
    }), "ALLOW_PREVIEW_ASSET")
  }
})

test("Supabase browser library is fulfilled only from the in-memory mock", () => {
  assert.equal(classifyNoWriteBrowserRequest({
    url: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
    method: "GET",
    previewUrl: "https://preview.example.test/provider_intakes",
  }), "FULFILL_MEMORY_SUPABASE_CLIENT")
})

test("every mutable browser verb is blocked in Preview no-write", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(classifyNoWriteBrowserRequest({
      url: "https://preview.example.test/rest/v1/payment_intake",
      method,
      previewUrl: "https://preview.example.test/provider_intakes",
    }), "BLOCK_MUTABLE")
  }
})

test("all non-Preview external reads are blocked", () => {
  assert.equal(classifyNoWriteBrowserRequest({
    url: "https://example.invalid/tracker.js",
    method: "GET",
    previewUrl: "https://preview.example.test/provider_intakes",
  }), "BLOCK_EXTERNAL")
})

test("visual harness uses the shared local Axe helper without CDN injection", () => {
  const visual = read("scripts/qa/provider-intake-matching-visual.mjs")
  assert.match(visual, /loadLocalAxeSource/)
  assert.match(visual, /auditAccessibilityPage/)
  assert.doesNotMatch(visual, /cdnjs\.cloudflare\.com\/ajax\/libs\/axe-core|addScriptTag\(\{\s*url:/)
})

const V6K_PREVIEW_URL =
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app"
const V6K_ENDPOINT = "https://scsirgbuqjcwoaxfacth.supabase.co/functions/v1/provider-intake/submit"
const v6kRequestInput = (overrides = {}) => ({
  endpoint: V6K_ENDPOINT,
  previewOrigin: V6K_PREVIEW_URL,
  intakeToken: "v6k_contract_token_0000000000000001",
  idempotencyKey: "v6k-contract-idempotency-0001",
  captchaToken: "v6k-contract-captcha",
  payload: {
    provider_name: "QA Contract",
    provider_email: "qa-contract@example.invalid",
    concept: "V6K contract validation",
    amount_requested: 1,
    currency: "MXN",
  },
  ...overrides,
})

test("V6N capability audit executes 63 concrete QA capabilities", async () => {
  const audit = await runCapabilityAudit()
  assert.equal(audit.status, "PASS")
  assert.equal(audit.capability_count, 63)
  assert.equal(Object.keys(audit.capabilities).length, 63)
  for (const capability of [
    "canonical_idempotency_header",
    "finalized_request_capture",
    "loopback_wire_contract",
    "response_metadata_capture",
    "public_error_code_capture",
    "cors_header_presence_capture",
    "correlation_id_sanitization",
    "gateway_edge_classification",
    "evidence_flush_before_throw",
    "post_v6h_baseline_support",
    "already_normalized_link_idempotency",
  ]) assert.equal(audit.capabilities[capability], true)
})

const invalidOrigins = [
  "http://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app",
  "https://preview.example.invalid",
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app:8443",
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app/path",
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app?query=1",
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app#fragment",
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app/",
  "HTTPS://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app",
  " https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app",
]

for (const [index, origin] of invalidOrigins.entries()) {
  test("V6K rejects invalid Preview Origin variant " + index, () => {
    assert.throws(() => derivePreviewOrigin(origin), /PREVIEW_ORIGIN_INVALID/)
  })
}

const invalidEndpoints = [
  "http://scsirgbuqjcwoaxfacth.supabase.co/functions/v1/provider-intake/submit",
  "https://other.supabase.co/functions/v1/provider-intake/submit",
  "https://scsirgbuqjcwoaxfacth.supabase.co:443/functions/v1/provider-intake/submit",
  "https://scsirgbuqjcwoaxfacth.supabase.co/functions/v1/provider-intake/submit?x=1",
  "https://scsirgbuqjcwoaxfacth.supabase.co/functions/v1/provider-intake/submit#part",
  "https://scsirgbuqjcwoaxfacth.supabase.co/functions/v1/provider-intake",
  "https://scsirgbuqjcwoaxfacth.supabase.co/rest/v1/provider-intake/submit",
  "not-a-url",
]

for (const [index, endpoint] of invalidEndpoints.entries()) {
  test("V6K rejects invalid DEV public endpoint variant " + index, () => {
    assert.throws(() => classifyAuthorizedPublicSubmitEndpoint(endpoint))
  })
}

const invalidRequestInputs = [
  ["empty token", { intakeToken: "" }],
  ["short token", { intakeToken: "short" }],
  ["token spaces", { intakeToken: "v6k invalid token with spaces 00000000" }],
  ["empty idempotency", { idempotencyKey: "" }],
  ["short idempotency", { idempotencyKey: "short" }],
  ["idempotency spaces", { idempotencyKey: "bad key value" }],
  ["empty captcha", { captchaToken: "" }],
  ["array payload", { payload: [] }],
]

for (const [name, overrides] of invalidRequestInputs) {
  test("V6K request builder fails closed for " + name, () => {
    assert.throws(() => buildPublicSubmitRequest(v6kRequestInput(overrides)))
  })
}

const finalRequestHeaderFailures = [
  ["content-type", "PUBLIC_SUBMIT_FINAL_REQUEST_INVALID", (headers) => headers.delete("content-type")],
  ["token", "PUBLIC_SUBMIT_TOKEN_INVALID", (headers) => headers.delete("x-intake-token")],
  ["idempotency", "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED", (headers) => headers.delete("idempotency-key")],
  ["origin", "PREVIEW_ORIGIN_INVALID", (headers) => headers.delete("origin")],
  ["authorization", "PUBLIC_SUBMIT_AUTHORIZATION_FORBIDDEN", (headers) => headers.set("authorization", "forbidden")],
  ["apikey", "PUBLIC_SUBMIT_APIKEY_FORBIDDEN", (headers) => headers.set("apikey", "forbidden")],
  ["legacy idempotency", "CANONICAL_IDEMPOTENCY_HEADER_REQUIRED", (headers) => headers.set("x-idempotency-key", "legacy")],
]

for (const [name, code, mutate] of finalRequestHeaderFailures) {
  test("V6K finalized Request rejects " + name, async () => {
    const base = buildPublicSubmitRequest(v6kRequestInput())
    const headers = new Headers(base.headers)
    mutate(headers)
    const request = new Request(base.url, { method: "POST", headers, body: await base.clone().text() })
    await assert.rejects(
      captureFinalizedPublicSubmitRequest(request, { previewOrigin: V6K_PREVIEW_URL }),
      new RegExp(code),
    )
  })
}

const v6kResponseCases = [
  ["origin_required", 403, "application/json", JSON.stringify({ error: "origin_required", message: "required" }), {}, "EDGE_ORIGIN_REQUIRED", "HIGH"],
  ["origin_not_allowed", 403, "application/json", JSON.stringify({ error: "origin_not_allowed" }), {}, "EDGE_ORIGIN_NOT_ALLOWED", "HIGH"],
  ["application_other", 403, "application/json", JSON.stringify({ error: "invalid_request" }), { server: "edge-runtime" }, "EDGE_APPLICATION_403_OTHER", "MEDIUM"],
  ["plain_unclassified", 403, "text/plain", "blocked", {}, "PUBLIC_SUBMIT_403_UNCLASSIFIED", "LOW"],
  ["html_gateway", 403, "text/html", "<html>blocked</html>", { server: "kong" }, "GATEWAY_OR_PLATFORM_403", "MEDIUM"],
  ["request_id", 403, "text/plain", "blocked", { "x-request-id": "synthetic-request-id" }, "PUBLIC_SUBMIT_403_UNCLASSIFIED", "LOW"],
  ["captcha", 400, "application/json", JSON.stringify({ error: "captcha_failed" }), {}, "NON_403_RESPONSE", "HIGH"],
  ["link", 404, "application/json", JSON.stringify({ error: "link_not_available" }), {}, "NON_403_RESPONSE", "HIGH"],
  ["content_type", 415, "application/json", JSON.stringify({ error: "content_type_not_supported" }), {}, "NON_403_RESPONSE", "HIGH"],
  ["rate_limit", 429, "application/json", JSON.stringify({ error: "rate_limit_exceeded" }), {}, "NON_403_RESPONSE", "HIGH"],
  ["edge_exception", 500, "text/plain", "internal", { server: "edge-runtime" }, "NON_403_RESPONSE", "HIGH"],
  ["success", 201, "application/json", JSON.stringify({ status: "created" }), {}, "NON_403_RESPONSE", "HIGH"],
]

for (const [name, status, contentType, body, headers, expected, confidence] of v6kResponseCases) {
  test("V6K classifies synthetic response " + name, async () => {
    const response = new Response(body, {
      status,
      headers: { "content-type": contentType, ...headers },
    })
    const metadata = await capturePublicSubmitResponse(response, { previewOrigin: V6K_PREVIEW_URL })
    assert.deepEqual(classifyPublicSubmitResponse(metadata), {
      classification: expected,
      classification_confidence: confidence,
    })
  })
  test("V6K sanitizes synthetic response " + name, async () => {
    const response = new Response(body, {
      status,
      headers: { "content-type": contentType, ...headers },
    })
    const metadata = await capturePublicSubmitResponse(response, { previewOrigin: V6K_PREVIEW_URL })
    const serialized = JSON.stringify(metadata)
    assert.equal(metadata.response_body_exported, false)
    assert.equal(metadata.response_headers_exported, false)
    assert.equal(serialized.includes("<html>blocked</html>"), false)
    assert.equal(serialized.includes("synthetic-request-id"), false)
  })
}

for (const header of RESPONSE_HEADER_ALLOWLIST) {
  test("V6K response allowlist sanitizes " + header, async () => {
    const value = header === "content-type" ? "application/json"
      : header === "access-control-allow-origin" ? V6K_PREVIEW_URL
        : header === "vary" ? "Origin"
          : header === "server" ? "edge-runtime"
            : header === "via" ? "gateway"
              : "synthetic-" + header
    const metadata = await capturePublicSubmitResponse(
      new Response(JSON.stringify({ error: "origin_required" }), {
        status: 403,
        headers: { "content-type": "application/json", [header]: value },
      }),
      { previewOrigin: V6K_PREVIEW_URL },
    )
    assert.equal(assertSanitizedObservabilityEvidence(metadata), true)
    assert.equal(JSON.stringify(metadata).includes(value), false)
  })
}

const validIdempotencyKeys = Array.from({ length: 20 }, (_value, index) =>
  "v6k-idempotency-" + String(index).padStart(2, "0") + ".test")

for (const idempotencyKey of validIdempotencyKeys) {
  test("V6K emits only canonical idempotency header for " + idempotencyKey, async () => {
    const input = v6kRequestInput({ idempotencyKey })
    const request = buildPublicSubmitRequest(input)
    const metadata = await captureFinalizedPublicSubmitRequest(request, {
      previewOrigin: V6K_PREVIEW_URL,
      sensitiveValues: [idempotencyKey],
    })
    assert.equal(metadata.idempotency_header_name, CANONICAL_IDEMPOTENCY_HEADER)
    assert.equal(metadata.idempotency_present, true)
    assert.equal(request.headers.has("x-idempotency-key"), false)
  })
}

const validTokens = Array.from({ length: 12 }, (_value, index) =>
  "v6k_token_" + String(index).padStart(2, "0") + "_abcdefghijklmnopqrstuvwxyz")

for (const intakeToken of validTokens) {
  test("V6K validates and redacts token format variant " + intakeToken.slice(0, 12), async () => {
    const request = buildPublicSubmitRequest(v6kRequestInput({ intakeToken }))
    const metadata = await captureFinalizedPublicSubmitRequest(request, {
      previewOrigin: V6K_PREVIEW_URL,
      sensitiveValues: [intakeToken],
    })
    assert.equal(metadata.token_format_valid, true)
    assert.equal(JSON.stringify(metadata).includes(intakeToken), false)
  })
}

for (let index = 0; index < 12; index += 1) {
  test("V6K fingerprints payload schema variant " + index + " without body export", async () => {
    const payload = {
      provider_name: "QA " + index,
      concept: "Concept " + index,
      amount_requested: index + 1,
      ["custom_field_" + index]: "synthetic",
    }
    const request = buildPublicSubmitRequest(v6kRequestInput({ payload }))
    const metadata = await captureFinalizedPublicSubmitRequest(request, {
      previewOrigin: V6K_PREVIEW_URL,
      sensitiveValues: ["Concept " + index],
    })
    assert.match(metadata.payload_schema_fingerprint, /^sha256:[0-9a-f]{12}$/)
    assert.equal(JSON.stringify(metadata).includes("custom_field_"), false)
    assert.equal(JSON.stringify(metadata).includes("Concept "), false)
  })
}

for (const code of ["unknown_alpha", "unknown_beta", "unknown_gamma", "unknown_delta"]) {
  test("V6K never exports unrecognized public error " + code, async () => {
    const metadata = await capturePublicSubmitResponse(
      new Response(JSON.stringify({ error: code }), {
        status: 403, headers: { "content-type": "application/json" },
      }),
      { previewOrigin: V6K_PREVIEW_URL },
    )
    assert.equal(metadata.public_error_code, "unrecognized_public_code")
    assert.equal(JSON.stringify(metadata).includes(code), false)
  })
}

for (const status of [200, 201, 400, 401, 404, 405, 409, 415, 422, 429, 500, 502, 503, 504]) {
  test("V6K classifies non-403 status " + status + " without overclaiming root cause", async () => {
    const metadata = await capturePublicSubmitResponse(
      new Response("synthetic-" + status, { status, headers: { "content-type": "text/plain" } }),
      { previewOrigin: V6K_PREVIEW_URL },
    )
    assert.deepEqual(classifyPublicSubmitResponse(metadata), {
      classification: "NON_403_RESPONSE",
      classification_confidence: "HIGH",
    })
  })
}

test("V6K observability audit flushes evidence before controlled failure", async () => {
  const result = await runPublicSubmitObservabilityAudit({ previewUrl: V6K_PREVIEW_URL })
  assert.equal(result.status, "PASS")
  assert.equal(result.evidence_flush_before_throw, true)
  assert.equal(result.evidence_persistence_failure_blocks, true)
  assert.equal(result.evidence_temp_file_removed, true)
})

test("V6K loopback verifies the actual finalized wire contract locally", async () => {
  const result = await runPublicSubmitLoopbackNoWrite({ previewUrl: V6K_PREVIEW_URL })
  assert.equal(result.status, "WIRE_CONTRACT_LOOPBACK_PASS")
  assert.equal(result.server_closed, true)
  assert.equal(result.external_network_requests, 0)
  assert.equal(result.provider_intake_calls, 0)
  assert.equal(result.wire.legacy_idempotency_present, false)
})

test("V6K synthetic response matrix executes all required response families", async () => {
  const result = await runSyntheticResponseMatrix({ previewUrl: V6K_PREVIEW_URL })
  assert.equal(result.status, "PASS")
  assert.equal(result.total, 12)
  assert.equal(result.response_bodies_exported, false)
})

test("V6K cleanup matrix closes 34 no-write resource scenarios", async () => {
  const result = await runV6KCleanupMatrix()
  assert.equal(result.status, "PASS")
  assert.equal(result.total, 34)
  assert.equal(result.failures, 0)
  assert.equal(result.loopback_server_closed, true)
})

const readonlyError = (code, category = null) =>
  new AuthenticatedReadOnlyObservabilityError(code, { category })

const validBlockedReadonlyEnvelope = (category = "DB_AUTH_FAILED") =>
  buildAuthenticatedReadOnlyFailureEnvelope(
    readonlyError(category, category),
    "DB_CONNECTION",
  )

const validPassReadonlyEnvelope = () => ({
  ...createAuthenticatedReadOnlyEnvelope(),
  status: "PASS",
  result_code: "AUTHENTICATED_READ_ONLY_PRECHECK_VALIDATED",
  state: "ALREADY_NORMALIZED",
  initial_default_transaction_read_only: "off",
  last_completed_stage: "RESULT_SERIALIZATION",
  session_read_only_bootstrap_applied: true,
  session_default_transaction_read_only: true,
  session_configuration_applied: true,
  transaction_read_only: true,
  transaction_isolation: "read committed",
  credential_present: true,
  connection_established: true,
  transaction_started: true,
  query_completed: true,
  rollback_completed: true,
  fresh_baseline_completed: true,
  fresh_baseline: {},
})

test("V6M classifies missing database secret without connection", async () => {
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: {},
    createClient: () => assert.fail("client must not be created"),
  })
  assert.equal(result.status, "BLOCKED")
  assert.equal(result.failure_category, "BLOCKED_SECRET_UNAVAILABLE")
  assert.equal(result.connection_established, false)
})

test("V6M rejects an invalid database URL before client initialization", async () => {
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: { SUPABASE_DEV_DB_URL: "not-a-database-url" },
    createClient: () => assert.fail("client must not be created"),
  })
  assert.equal(result.failure_category, "DB_URL_INVALID")
  assert.equal(result.failed_stage, "DB_URL_PARSE")
})

test("V6M classifies DNS failure", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "ENOTFOUND" }, "DB_CONNECTION").failure_category,
    "DB_DNS_FAILED",
  )
})

test("V6M classifies connection refused", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "ECONNREFUSED" }, "DB_CONNECTION").failure_category,
    "DB_NETWORK_FAILED",
  )
})

test("V6M classifies TLS failure", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError(
      { code: "ERR_TLS_CERT_ALTNAME_INVALID" },
      "DB_CONNECTION",
    ).failure_category,
    "DB_TLS_FAILED",
  )
})

test("V6M classifies authentication failure", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "28P01" }, "DB_CONNECTION").failure_category,
    "DB_AUTH_FAILED",
  )
})

test("V6M classifies permission failure", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "42501" }, "INTAKE_LINKS_READ").failure_category,
    "DB_PERMISSION_FAILED",
  )
})

test("V6M classifies missing table", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "42P01" }, "SCHEMA_CONTRACT_INSPECTION").failure_category,
    "SCHEMA_TABLE_MISSING",
  )
})

test("V6M classifies missing column", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "42703" }, "SCHEMA_CONTRACT_INSPECTION").failure_category,
    "SCHEMA_COLUMN_MISSING",
  )
})

test("V6M classifies statement timeout", () => {
  assert.equal(
    classifyAuthenticatedReadOnlyError({ code: "57014" }, "INTAKE_LINKS_READ").failure_category,
    "DB_STATEMENT_TIMEOUT",
  )
})

test("V6M classifies nonzero child process exit", () => {
  const result = parseAuthenticatedReadOnlyChildResult({ stdout: "", exitCode: 2 })
  assert.equal(result.failure_category, "CHILD_PROCESS_EXIT_FAILED")
  assert.equal(result.failed_stage, "CHILD_PROCESS_EXIT")
})

test("V6M classifies empty child stdout", () => {
  const result = parseAuthenticatedReadOnlyChildResult({ stdout: "", exitCode: 0 })
  assert.equal(result.failure_category, "RESULT_JSON_PARSE_FAILED")
})

test("V6M classifies truncated child JSON", () => {
  const result = parseAuthenticatedReadOnlyChildResult({ stdout: '{"status":', exitCode: 0 })
  assert.equal(result.failure_category, "RESULT_JSON_PARSE_FAILED")
})

test("V6M classifies invalid child JSON", () => {
  const result = parseAuthenticatedReadOnlyChildResult({ stdout: "not-json", exitCode: 0 })
  assert.equal(result.failure_category, "RESULT_JSON_PARSE_FAILED")
})

test("V6M rejects result missing required envelope fields", () => {
  const envelope = validBlockedReadonlyEnvelope()
  delete envelope.query_completed
  assert.throws(() => validateAuthenticatedReadOnlyEnvelope(envelope), /RESULT_CONTRACT_INVALID/)
})

test("V6M rejects a started transaction without rollback", () => {
  const envelope = validBlockedReadonlyEnvelope()
  envelope.transaction_started = true
  envelope.rollback_completed = false
  assert.throws(() => validateAuthenticatedReadOnlyEnvelope(envelope), /RESULT_CONTRACT_INVALID/)
})

test("V6M rejects a PASS transaction that is not read-only", () => {
  const envelope = validPassReadonlyEnvelope()
  envelope.transaction_read_only = false
  assert.throws(() => validateAuthenticatedReadOnlyEnvelope(envelope), /RESULT_CONTRACT_INVALID/)
})

test("V6M rejects SQL containing DML", () => {
  assert.throws(
    () => assertReadOnlySql("update public.intake_links set status='expired'"),
    /READ_ONLY_ASSERTION_FAILED/,
  )
})

test("V6N blocks ALTER ROLE/DATABASE/SYSTEM in SQL scan", () => {
  assert.throws(
    () => assertReadOnlySql("alter role test in database postgres"),
    /PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT/,
  )
  assert.throws(
    () => assertReadOnlySql("ALTER DATABASE foo SET statement_timeout='5s'"),
    /PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT/,
  )
  assert.throws(
    () => assertReadOnlySql("ALTER SYSTEM SET max_connections = 1"),
    /PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT/,
  )
})

test("V6N permite transaccionalidad read only explícita y conserva orden de consultas", async () => {
  const calls = []
  const client = {
    connected: false,
    closed: false,
    async connect() {
      this.connected = true
    },
    async end() {
      this.closed = true
    },
    async query(sql) {
      const normalized = String(sql).replace(/\s+/gu, " ").trim().toLowerCase()
      calls.push(normalized)
      if (normalized === "show default_transaction_read_only") {
        return calls.length === 1 ? { rows: [{ default_transaction_read_only: "off" }] }
          : { rows: [{ default_transaction_read_only: "on" }] }
      }
      if (normalized === "show transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] }
      }
      if (normalized === "show transaction_isolation") {
        return { rows: [{ transaction_isolation: "read committed" }] }
      }
      if (normalized.includes("select current_timestamp as database_now")) {
        return { rows: [{ database_now: "2026-07-21T00:00:00Z" }] }
      }
      if (normalized.includes("from information_schema.columns")) {
        return {
          rows: ["company_id", "created_at", "expires_at", "label", "status"]
            .map((column_name) => ({ column_name })),
        }
      }
      if (normalized.includes("from public.intake_links") &&
          normalized.includes("order by created_at asc")) {
        return { rows: [
          { company_scope: "scope", label: "historical", status: "expired", expires_at: "2026-07-20T00:00:00Z" },
          { company_scope: "scope", label: "other", status: "revoked", expires_at: null },
          { company_scope: "scope", label: "QA V6B historical", status: "revoked", expires_at: null },
        ] }
      }
      if (normalized.includes("from auth.users au")) return { rows: [] }
      if (normalized.startsWith("select count(*)::int")) {
        if (normalized.includes("from public.intake_links where status='active' and")) {
          return { rows: [{ count: 0 }] }
        }
        if (normalized.includes("from public.intake_links where status='expired'")) {
          return { rows: [{ count: 1 }] }
        }
        if (normalized.includes("from public.intake_links where status='revoked'")) {
          return { rows: [{ count: 2 }] }
        }
        if (normalized.includes("from public.intake_links")) {
          return { rows: [{ count: 3 }] }
        }
        return { rows: [{ count: 0 }] }
      }
      return { rows: [] }
    },
  }
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: { SUPABASE_DEV_DB_URL: "postgresql://qa:secret@db.invalid/dev" },
    createClient: async () => client,
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.initial_default_transaction_read_only, "off")
  assert.equal(result.session_read_only_bootstrap_applied, true)
  assert.equal(result.session_default_transaction_read_only, true)
  assert.equal(result.transaction_started, true)
  assert.equal(result.transaction_read_only, true)
  const normalizedQuery = calls.map((statement) =>
    /from public\.intake_links/.test(statement))
  assert.equal(normalizedQuery.includes(true), true)
  const idxBegin = calls.findIndex((statement) => statement === "begin transaction read only")
  const idxReadOnly = calls.findIndex((statement) => statement === "show transaction_read_only")
  const idxTimeout = calls.findIndex((statement) => statement === "set local statement_timeout = '15s'")
  const idxLockTimeout = calls.findIndex((statement) => statement === "set local lock_timeout = '5s'")
  const idxBootstrap = calls.findIndex((statement) => statement === "set session characteristics as transaction read only")
  const idxBusiness = calls.findIndex((statement) => /from public\.intake_links/.test(statement))
  assert.ok(idxBegin > -1)
  assert.ok(idxTimeout > -1)
  assert.ok(idxLockTimeout > -1)
  assert.ok(idxReadOnly > idxBootstrap)
  assert.ok(idxBegin < idxTimeout)
  assert.ok(idxBegin < idxLockTimeout)
  assert.ok(idxBusiness > idxReadOnly)
  assert.ok(idxTimeout < idxBusiness)
  assert.ok(idxLockTimeout < idxBusiness)
  assert.equal(calls.filter((sql) => sql === "rollback").length, 1)
})

test("V6N falla si el bootstrap no deja la sesión en read only", async () => {
  const client = {
    connected: false,
    closed: false,
    async connect() {
      this.connected = true
    },
    async end() {
      this.closed = true
    },
    async query(sql) {
      const normalized = String(sql).replace(/\s+/gu, " ").trim().toLowerCase()
      if (normalized === "show default_transaction_read_only") {
        return { rows: [{ default_transaction_read_only: "off" }] }
      }
      if (normalized === "set session characteristics as transaction read only") {
        return {}
      }
      if (normalized.startsWith("set local")) return {}
      if (normalized === "begin read only") {
        return {}
      }
      if (normalized.startsWith("begin transaction read only")) {
        return {}
      }
      if (normalized === "show transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] }
      }
      if (normalized === "show transaction_isolation") {
        return { rows: [{ transaction_isolation: "read committed" }] }
      }
      if (normalized.startsWith("select")) return { rows: [{}] }
      throw new AuthenticatedReadOnlyObservabilityError("READ_ONLY_ASSERTION_FAILED", {
        category: "READ_ONLY_ASSERTION_FAILED",
      })
    },
  }
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: { SUPABASE_DEV_DB_URL: "postgresql://qa:secret@db.invalid/dev" },
    createClient: async () => client,
  })
  assert.equal(result.status, "FAIL")
  assert.equal(result.failure_category, "SESSION_READ_ONLY_BOOTSTRAP_FAILED")
  assert.equal(result.failed_stage, "SESSION_READ_ONLY_ASSERTION")
})

test("V6N bloquea transacciones de negocio antes de aserción de transaction_read_only", async () => {
  const calls = []
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: { SUPABASE_DEV_DB_URL: "postgresql://qa:secret@db.invalid/dev" },
    createClient: async () => ({
      connected: false,
      closed: false,
      async connect() {
        this.connected = true
      },
      async end() {
        this.closed = true
      },
      async query(sql) {
        const normalized = String(sql).replace(/\s+/gu, " ").trim().toLowerCase()
        calls.push(normalized)
        if (normalized === "show default_transaction_read_only") {
          return calls.length === 1 ? { rows: [{ default_transaction_read_only: "off" }] }
            : { rows: [{ default_transaction_read_only: "on" }] }
        }
        if (normalized === "set session characteristics as transaction read only") {
          return {}
        }
        if (normalized.startsWith("set local")) {
          return {}
        }
        if (normalized === "show transaction_isolation") {
          return { rows: [{ transaction_isolation: "read committed" }] }
        }
        if (normalized === "show transaction_read_only") {
          return { rows: [{ transaction_read_only: "off" }] }
        }
        if (normalized.includes("from public.intake_links") &&
            normalized.includes("order by created_at asc")) {
          assert.fail("Consulta de negocio ejecutada antes de transaction_read_only=on")
        }
        if (normalized.startsWith("select count(*)::int")) {
          if (normalized.includes("from public.intake_links where status='active' and")) {
            return { rows: [{ count: 0 }] }
          }
          if (normalized.includes("from public.intake_links where status='expired'")) {
            return { rows: [{ count: 1 }] }
          }
          if (normalized.includes("from public.intake_links where status='revoked'")) {
            return { rows: [{ count: 2 }] }
          }
          if (normalized.includes("from public.intake_links")) {
            return { rows: [{ count: 3 }] }
          }
        }
        return { rows: [] }
      },
    }),
  })
  assert.equal(result.status, "FAIL")
  assert.equal(result.failure_category, "TRANSACTION_READ_ONLY_ASSERTION_FAILED")
  assert.equal(result.failed_stage, "TRANSACTION_READ_ONLY_ASSERTION")
})

test("V6N falla con rollback fallido con categorÃ­a READ_ONLY_ROLLBACK_FAILED", async () => {
  const calls = []
  const client = {
    connected: false,
    closed: false,
    async connect() {
      this.connected = true
    },
    async end() {
      this.closed = true
    },
    async query(sql) {
      const normalized = String(sql).replace(/\s+/gu, " ").trim().toLowerCase()
      calls.push(normalized)
      if (normalized === "show default_transaction_read_only") {
        return calls.length === 1 ? { rows: [{ default_transaction_read_only: "off" }] }
          : { rows: [{ default_transaction_read_only: "on" }] }
      }
      if (normalized === "set session characteristics as transaction read only") {
        return {}
      }
      if (normalized.startsWith("set local") || normalized === "set application_name = 'flux_v6n_authenticated_read_only_precheck'") {
        return {}
      }
      if (normalized === "begin transaction read only") {
        return {}
      }
      if (normalized === "show transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] }
      }
      if (normalized === "show transaction_isolation") {
        return { rows: [{ transaction_isolation: "read committed" }] }
      }
      if (normalized.includes("select current_timestamp")) {
        return { rows: [{ database_now: "2026-07-21T00:00:00Z" }] }
      }
      if (normalized.includes("from information_schema.columns")) {
        return {
          rows: ["company_id", "created_at", "expires_at", "label", "status"].map((column_name) => ({ column_name })),
        }
      }
      if (normalized.includes("from public.intake_links") &&
          normalized.includes("order by created_at asc")) {
        return {
          rows: [
            { company_scope: "scope", label: "historical", status: "expired", expires_at: "2026-07-20T00:00:00Z" },
            { company_scope: "scope", label: "other", status: "revoked", expires_at: null },
            { company_scope: "scope", label: "QA V6B historical", status: "revoked", expires_at: null },
          ],
        }
      }
      if (normalized.includes("from auth.users au")) {
        return { rows: [] }
      }
      if (normalized.startsWith("select count(*)::int")) {
        if (normalized.includes("from public.intake_links where status='active' and")) {
          return { rows: [{ count: 0 }] }
        }
        if (normalized.includes("from public.intake_links where status='expired'")) {
          return { rows: [{ count: 1 }] }
        }
        if (normalized.includes("from public.intake_links where status='revoked'")) {
          return { rows: [{ count: 2 }] }
        }
        if (normalized.includes("from public.intake_links")) {
          return { rows: [{ count: 3 }] }
        }
        return { rows: [{ count: 0 }] }
      }
      if (normalized === "rollback") {
        throw new Error("rollback unavailable")
      }
      return { rows: [] }
    },
  }
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: { SUPABASE_DEV_DB_URL: "postgresql://qa:secret@db.invalid/dev" },
    createClient: async () => client,
  })
  assert.equal(result.status, "FAIL")
  assert.equal(result.failure_category, "READ_ONLY_ROLLBACK_FAILED")
  assert.equal(result.failed_stage, "ROLLBACK")
})

test("V6N recognizes NORMALIZATION_REQUIRED", () => {
  const result = classifyAuthenticatedLinkState([
    { company_scope: "scope", label: "historical", status: "revoked", expires_at: null },
    { company_scope: "scope", label: "active", status: "active", expires_at: "2026-07-20T00:00:00Z" },
  ], "2026-07-21T00:00:00Z")
  assert.equal(result.state, "NORMALIZATION_REQUIRED")
  assert.equal(result.apply_required, true)
})

test("V6N recognizes ALREADY_NORMALIZED as PASS no-op", () => {
  const result = classifyAuthenticatedLinkState([
    { company_scope: "scope", label: "historical", status: "expired", expires_at: "2026-07-20T00:00:00Z" },
    { company_scope: "scope", label: "other", status: "revoked", expires_at: null },
    { company_scope: "scope", label: "QA V6B historical", status: "revoked", expires_at: null },
  ], "2026-07-21T00:00:00Z")
  assert.equal(result.state, "ALREADY_NORMALIZED")
  assert.equal(result.normalization_required, false)
  assert.equal(result.apply_required, false)
})

test("V6N completes the authenticated read-only path with explicit rollback", async () => {
  const calls = []
  const client = {
    connected: false,
    closed: false,
    async connect() {
      this.connected = true
    },
    async end() {
      this.closed = true
    },
    async query(sql) {
      const normalized = String(sql).replace(/\s+/gu, " ").trim().toLowerCase()
      calls.push(normalized)
      if (normalized === "show default_transaction_read_only") {
        return { rows: [{ default_transaction_read_only: "on" }] }
      }
      if (normalized === "show transaction_isolation") {
        return { rows: [{ transaction_isolation: "read committed" }] }
      }
      if (normalized === "show transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] }
      }
      if (normalized.includes("select current_timestamp as database_now")) {
        return { rows: [{ database_now: "2026-07-21T00:00:00Z" }] }
      }
      if (normalized.includes("from information_schema.columns")) {
        return {
          rows: ["company_id", "created_at", "expires_at", "label", "status"]
            .map((column_name) => ({ column_name })),
        }
      }
      if (normalized.includes("from public.intake_links") &&
          normalized.includes("order by created_at asc")) {
        return { rows: [
          { company_scope: "scope", label: "historical", status: "expired", expires_at: "2026-07-20T00:00:00Z" },
          { company_scope: "scope", label: "other", status: "revoked", expires_at: null },
          { company_scope: "scope", label: "QA V6B historical", status: "revoked", expires_at: null },
        ] }
      }
      if (normalized.includes("from auth.users au")) return { rows: [] }
      if (normalized.startsWith("select count(*)::int")) {
        let count = 0
        if (normalized.includes("from public.intake_links")) {
          if (!normalized.includes(" where ")) count = 3
          else if (normalized.includes("status='expired'")) count = 1
          else if (normalized.includes("status='revoked'")) count = 2
          if (normalized.includes("label like 'qa v6b %'")) {
            count = normalized.includes("status='active'") ? 0 : 1
          }
        }
        return { rows: [{ count }] }
      }
      return { rows: [] }
    },
  }
  const result = await runAuthenticatedReadOnlyPrecheck({
    env: { SUPABASE_DEV_DB_URL: "postgresql://qa:secret@db.invalid/dev" },
    createClient: async () => client,
  })
  assert.equal(result.status, "PASS")
  assert.equal(result.state, "ALREADY_NORMALIZED")
  assert.equal(result.transaction_read_only, true)
  assert.equal(result.fresh_baseline_completed, true)
  assert.equal(result.rollback_completed, true)
  assert.equal(result.client_closed, true)
  assert.equal(result.writes, 0)
  assert.equal(calls.filter((sql) => sql === "rollback").length, 1)
})

test("V6N rejects zero recognizable links", () => {
  assert.throws(
    () => classifyAuthenticatedLinkState([], "2026-07-21T00:00:00Z"),
    /LINK_STATE_CONTRACT_MISMATCH/,
  )
})

test("V6N rejects two ambiguous historical expired links", () => {
  assert.throws(
    () => classifyAuthenticatedLinkState([
      { company_scope: "scope", label: "one", status: "expired", expires_at: "2026-07-19T00:00:00Z" },
      { company_scope: "scope", label: "two", status: "expired", expires_at: "2026-07-20T00:00:00Z" },
    ], "2026-07-21T00:00:00Z"),
    /LINK_STATE_CONTRACT_MISMATCH/,
  )
})

test("V6N blocks raw error leakage", () => {
  assert.throws(
    () => assertSanitizedAuthenticatedReadOnlyEvidence({ raw_error: "forbidden" }),
    /AUTHENTICATED_READ_ONLY_EVIDENCE_LEAKAGE/,
  )
})

test("V6N blocks database URL leakage", () => {
  assert.throws(
    () => assertSanitizedAuthenticatedReadOnlyEvidence({ database_url: "forbidden" }),
    /AUTHENTICATED_READ_ONLY_EVIDENCE_LEAKAGE/,
  )
})

test("V6N blocks stack leakage", () => {
  assert.throws(
    () => assertSanitizedAuthenticatedReadOnlyEvidence({ stack: "forbidden" }),
    /AUTHENTICATED_READ_ONLY_EVIDENCE_LEAKAGE/,
  )
})

test("V6N preserves allowlisted SQLSTATE", () => {
  const result = classifyAuthenticatedReadOnlyError({ code: "28P01" }, "DB_CONNECTION")
  assert.equal(result.sanitized_code, "28P01")
  assert.equal(result.sqlstate_class, "28P01")
})

test("V6N suppresses non-allowlisted SQLSTATE", () => {
  const result = classifyAuthenticatedReadOnlyError({ code: "99999" }, "DB_CONNECTION")
  assert.equal(result.sanitized_code, null)
  assert.equal(result.sqlstate_class, null)
})

test("V6N caller preserves a classified failure category", () => {
  const envelope = validBlockedReadonlyEnvelope("DB_AUTH_FAILED")
  const parsed = parseAuthenticatedReadOnlyChildResult({ stdout: JSON.stringify(envelope), exitCode: 0 })
  assert.equal(parsed.failure_category, "DB_AUTH_FAILED")
})

test("V6N caller never collapses known flow to V6A_RUNNER_FAILED", () => {
  const result = classifyAuthenticatedReadOnlyError(new Error("unclassified"), "CALLER_RESULT_PARSE")
  assert.equal(result.failure_category, "RESULT_JSON_PARSE_FAILED")
  assert.notEqual(result.failure_category, "V6A_RUNNER_FAILED")
})

test("V6N keeps public submit blocked before read-only PASS", async () => {
  const result = await runAuthenticatedReadOnlyPrecheck({ env: {} })
  assert.equal(result.provider_intake_calls, 0)
  assert.equal(result.diagnostic_public_submit_attempts, 0)
  assert.equal(result.diagnostic_call_consumed, false)
  assert.equal(result.token_generated, false)
})

test("V6N cleanup matrix closes 48 no-write scenarios", async () => {
  const result = await runV6MCleanupMatrix()
  assert.equal(result.status, "PASS")
  assert.equal(result.total, 48)
  assert.equal(result.failures, 0)
  assert.equal(result.public_submit_calls, 0)
})
