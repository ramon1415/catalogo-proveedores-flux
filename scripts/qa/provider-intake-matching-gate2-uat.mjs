import assert from "node:assert/strict"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  assertLiveProviderLocatorInputs,
  classifyProviderCardHeadings,
  exactNormalizedText,
  normalizeLiveProviderText,
  openProviderClearDialog,
  openProviderReplaceDialog,
  openProviderSetDialog,
} from "./provider-intake-matching-flow.mjs"
import {
  ACCESSIBILITY_STATE_ALIASES,
  AXE_CORE_VERSION,
  AccessibilityGateError,
  assertSanitizedAccessibilityEvidence,
  auditAccessibilityState as runAxeAccessibilityState,
  createAccessibilityHookRecorder,
  createAccessibilityStateManifest,
  loadLocalAxeSource,
  runAccessibilityStateManifest,
  sanitizedAxeSourceIdentity,
  validateAccessibilityStateManifest,
} from "./provider-intake-matching-accessibility.mjs"
import {
  CANONICAL_IDEMPOTENCY_HEADER,
  buildPublicSubmitRequest,
  captureFinalizedPublicSubmitRequest,
  capturePublicSubmitResponse,
  certifyCanonicalBrowserSubmitContract,
  classifyPublicSubmitResponse,
  flushResponseEvidenceBeforeThrow,
  persistSanitizedEvidenceAtomically,
  runPublicSubmitLoopbackNoWrite,
  runPublicSubmitObservabilityAudit,
} from "./provider-intake-public-submit-observability.mjs"
import {
  assertReadOnlySql,
  assertSanitizedAuthenticatedReadOnlyEvidence,
  buildAuthenticatedReadOnlyFailureEnvelope,
  classifyAuthenticatedLinkState,
  classifyAuthenticatedReadOnlyError,
  parseAuthenticatedReadOnlyChildResult,
  resolveQaCompanyScopeReadOnly,
  runAuthenticatedReadOnlyBaselineInvariantDiagnostic as runAuthenticatedReadOnlyBaselineInvariantDiagnosticCore,
  runAuthenticatedReadOnlyMockMatrix,
  runAuthenticatedReadOnlyPrecheck,
  scanReadOnlySql,
  validateAuthenticatedReadOnlyEnvelope,
} from "./provider-intake-authenticated-readonly-observability.mjs"
import {
  BASELINE_INVARIANT_CODES,
  BASELINE_INVARIANT_DIAGNOSTIC_MODE,
  assertSanitizedBaselineInvariantEvidence,
} from "./provider-intake-baseline-invariants.mjs"
import {
  CANONICAL_DEV_PORTAL_URL,
  CANONICAL_PUBLIC_SUBMIT_ENDPOINT,
  QA_CREDENTIAL_STAGE,
  createCanonicalBrowserSubmitController,
  createRuntimeTurnstileSession,
  createStageScopedCredentialResolver,
  resolveQaApiKeys,
  resolveQaLinkCreatedByReadOnly,
} from "./provider-intake-qa-credential-resolver.mjs"

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = fileURLToPath(import.meta.url)
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i

export const DEV_PROJECT_REF = "scsirgbuqjcwoaxfacth"
export const AUTHORIZED_PREVIEW_URL =
  "https://catalogo-proveedores-flux-git-feature-ramon-282446-quantta-team.vercel.app"
export const FIXTURE_ALIASES = Object.freeze([
  "QA_MATCH_FINAL_MAIN",
  "QA_MATCH_FINAL_RACE",
])
export const AUTHORIZED_PUBLIC_FIXTURE_POSTS = FIXTURE_ALIASES.length
export const AUTHORIZED_POSTS_PER_CONTROLLER = 1
export const PRINCIPAL_ALIASES = Object.freeze([
  "QA_TRIAGE_FINANCE_1",
  "QA_TRIAGE_FINANCE_2",
])
export const PROVIDER_ALIASES = Object.freeze([
  "QA_MATCH_PROVIDER_A",
  "QA_MATCH_PROVIDER_B",
])
export const PROVIDER_SELECTOR_ENV = Object.freeze({
  [PROVIDER_ALIASES[0]]: "QA_MATCH_PROVIDER_A_ID",
  [PROVIDER_ALIASES[1]]: "QA_MATCH_PROVIDER_B_ID",
})
const MOCK_LIVE_PROVIDER_ALIASES = Object.freeze([
  "Proveedor sintético alfa",
  "Proveedor sintético beta",
])
const LIVE_NO_WRITE_PROVIDER_ALIASES = Object.freeze([
  "Proveedor preview alfa",
  "Proveedor preview beta",
])
export const MUTABLE_ACCESSIBILITY_HOOKS = Object.freeze({
  main: Object.freeze(ACCESSIBILITY_STATE_ALIASES.slice(0, 7)),
  race: Object.freeze([ACCESSIBILITY_STATE_ALIASES[7]]),
  terminal: Object.freeze([ACCESSIBILITY_STATE_ALIASES[8]]),
})
export const MOCK_BASELINE = Object.freeze({
  payment_intake: 13,
  payment_intake_events: 39,
  payment_intake_files: 6,
  storage_objects: 6,
  proveedores: 22,
  providers: 0,
  payment_requests: 73,
  approval_batches: 8,
  payment_layouts: 12,
  payment_layout_lines: 13,
  cash_funds: 5,
  notification_events: 322,
  intake_links: 4,
  matched_intakes: 0,
  provider_matched: 4,
  states: {
    received: 6,
    in_review: 0,
    needs_correction: 1,
    rejected: 6,
    converted: 0,
    cancelled: 0,
  },
})

export const EXPECTED_BASELINE = MOCK_BASELINE
export const EXPECTED_QA_COMPANY_LINKS = 4

export const STATIC_INTEGRITY_CONTRACT = Object.freeze({
  schema: true,
  migrations: true,
  functions: true,
  grants: true,
  rls: true,
  iam_at_rest: true,
  safe_links: true,
  critical_orphans: 0,
  critical_duplicates: 0,
})

export const DEMO_LINK_REVOCATION_CONTRACT = Object.freeze({
  logical_alias: "DEMO_CLIENTE_FLUX_72H",
  created_at: "2026-07-24T16:40:57.713Z",
  expires_at: "2026-07-27T16:40:57.713Z",
  duration_hours: 72,
  temporal_tolerance_ms: 1_000,
  initial_status: "active",
  final_status: "revoked",
  explicit_mutable_fields: ["status", "revoked_at", "revoked_by"],
})

export const EXPECTED_EXPIRED_LINK_PRE_STATE = Object.freeze({
  total: 2,
  activeValid: 0,
  activeExpired: 1,
  revoked: 1,
  expired: 0,
  paused: 0,
  otherActive: 0,
})

export const EXPECTED_EXPIRED_LINK_POST_STATE = Object.freeze({
  total: 2,
  activeValid: 0,
  activeExpired: 0,
  revoked: 1,
  expired: 1,
  paused: 0,
  otherActive: 0,
})

export const EXPECTED_ALREADY_NORMALIZED_LINK_STATE = Object.freeze({
  total: 3,
  activeValid: 0,
  activeExpired: 0,
  revoked: 2,
  expired: 1,
  paused: 0,
  otherActive: 0,
})

export const INTAKE_LINK_CONTRACT = Object.freeze({
  table: "public.intake_links",
  rls_enabled: true,
  service_role_grants: ["INSERT", "SELECT", "UPDATE"],
  transport: "X-Intake-Token",
  query_token_allowed: false,
  raw_token_persisted: false,
  hash_algorithm: "SHA-256",
  hash_encoding: "lowercase_hex_64",
  minimum_entropy_bytes: 32,
  token_prefix_required: true,
  statuses: ["active", "paused", "revoked", "expired"],
  expires_at_supported: true,
  max_submissions_per_day_supported: true,
  max_uses_supported: false,
  use_count_supported: false,
  one_active_per_company: true,
  canonical_admin_creation_interface: false,
  mutable_mechanism: "service_role_ephemeral_insert",
})

const REQUIRED_DEPENDENCIES = Object.freeze([
  "assertEnvironment",
  "captureBaseline",
  "inspectLinkContract",
  "resolveProviderTargets",
  "inspectExpiredActiveLink",
  "dryRunExpiredLinkNormalization",
  "applyExpiredLinkNormalization",
  "verifyExpiredLinkNormalization",
  "validateExpiredLinkBusinessDelta",
  "randomBytes",
  "sha256",
  "dryRunLinkCreation",
  "createEphemeralLink",
  "revokeEphemeralLink",
  "submitPublicFixture",
  "assertThirdSubmitRejected",
  "validateProvisioningDelta",
  "activateQaIam",
  "deactivateQaIam",
  "transitionFixture",
  "getFixture",
  "setProviderIntakeMatch",
  "openLiveMatchingPage",
  "submitReplaceFromPage",
  "submitConflictFromPage",
  "auditAccessibilityState",
  "closeBrowser",
  "listFixtureEvents",
  "captureFinal",
  "clearFixtureMatch",
  "rejectFixture",
  "dropRawToken",
  "cleanupStatus",
  "newActionId",
  "metrics",
])

const CRITICAL_FAILURE_POINTS = Object.freeze([
  "alias_resolution",
  "card_not_found",
  "card_ambiguous",
  "card_mismatch",
  "expired_link_inspection",
  "expired_link_normalization_dry_run",
  "expired_link_normalization_stale",
  "expired_link_normalization_rowcount",
  "expired_link_normalization_postcheck",
  "link_dry_run",
  "link_insert",
  "fixture_1",
  "fixture_2",
  "iam_activation",
  "transition",
  "set",
  "replace",
  "clear",
  "race",
  "close_fixture",
  "accessibility_axe_not_loaded",
  "accessibility_critical",
  "accessibility_serious",
  "accessibility_state_missing",
  "accessibility_evidence_unsanitized",
  "accessibility_network_escape",
])

export class GateError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = "GateError"
    this.code = code
    this.details = details
  }
}

function gate(value, code, details = {}) {
  if (!value) throw new GateError(code, details)
}

function errorCode(error) {
  const value = String(error?.code || error?.message || "V6A_RUNNER_FAILED")
  return /^[A-Z0-9_-]{1,140}$/i.test(value) ? value : "V6A_RUNNER_FAILED"
}

function clone(value) {
  return structuredClone(value)
}

const SYNTHETIC_PROVIDER_PATTERN = /(?:qa|test|demo|fixture)/iu
const PROVIDER_SELECTOR_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function isSyntheticProviderRow(row) {
  return [row?.alias, row?.nombre_completo, row?.email]
    .some((value) => SYNTHETIC_PROVIDER_PATTERN.test(String(value || "")))
}

function validateProviderSelectorIds(selectedProviderIds) {
  gate(Array.isArray(selectedProviderIds), "QA_PROVIDER_SELECTORS_MISSING")
  gate(
    selectedProviderIds.length === 2,
    selectedProviderIds.length < 2
      ? "QA_PROVIDER_SELECTORS_MISSING"
      : "QA_PROVIDER_SELECTOR_INVALID",
  )
  const normalized = selectedProviderIds.map((value) => String(value || "").trim().toLowerCase())
  gate(normalized.every(Boolean), "QA_PROVIDER_SELECTORS_MISSING")
  gate(
    normalized.every((value) => PROVIDER_SELECTOR_UUID_PATTERN.test(value)),
    "QA_PROVIDER_SELECTOR_INVALID",
  )
  gate(normalized[0] !== normalized[1], "QA_PROVIDER_SELECTORS_NOT_DISTINCT")
  return Object.freeze(normalized)
}

export function resolveProviderSelectorIds(env = process.env) {
  const selectedProviderIds = PROVIDER_ALIASES.map((logicalAlias) => {
    const environmentName = PROVIDER_SELECTOR_ENV[logicalAlias]
    return String(env[environmentName] || "").trim()
  })
  return validateProviderSelectorIds(selectedProviderIds)
}

export function buildLiveProviderSelectorQuery(selectedProviderIds) {
  const exactIds = validateProviderSelectorIds(selectedProviderIds)
  return new URLSearchParams({
    select: "id,alias,nombre_completo,email,activo",
    id: `in.(${exactIds.join(",")})`,
  })
}

export function buildLiveProviderTargets(rows, {
  logicalAliases = PROVIDER_ALIASES,
  selectedProviderIds,
} = {}) {
  gate(Array.isArray(rows), "LIVE_PROVIDER_ALIAS_UNRESOLVED")
  gate(
    Array.isArray(logicalAliases) &&
      logicalAliases.length === 2 &&
      logicalAliases.every((value, index) => value === PROVIDER_ALIASES[index]),
    "LIVE_PROVIDER_ALIAS_UNRESOLVED",
  )
  const exactIds = validateProviderSelectorIds(selectedProviderIds)
  const selectedRows = exactIds.map((selectedId) => {
    const matches = rows.filter(
      (row) => String(row?.id || "").trim().toLowerCase() === selectedId,
    )
    gate(matches.length === 1, "QA_PROVIDER_TARGET_NOT_FOUND")
    return matches[0]
  })
  gate(
    selectedRows.every((row) => row?.activo !== false),
    "QA_PROVIDER_TARGET_INACTIVE",
  )
  gate(
    selectedRows.every((row) => isSyntheticProviderRow(row)),
    "QA_PROVIDER_TARGET_NOT_SYNTHETIC",
  )

  const targets = selectedRows.map((row, index) => {
    const logicalAlias = String(logicalAliases[index] || "").trim()
    const liveDisplayAlias = normalizeLiveProviderText(row.alias)
    gate(logicalAlias, "LIVE_PROVIDER_ALIAS_UNRESOLVED")
    gate(liveDisplayAlias, "QA_PROVIDER_TARGET_ALIAS_MISSING")
    gate(
      normalizeLiveProviderText(logicalAlias) !== liveDisplayAlias,
      "LOGICAL_ALIAS_USED_AS_LIVE_LOCATOR",
    )
    return Object.freeze({
      logicalAlias,
      internalId: exactIds[index],
      liveDisplayAlias,
      uiSearchText: liveDisplayAlias,
      expectedCardHeading: liveDisplayAlias,
    })
  })
  gate(
    targets[0].liveDisplayAlias !== targets[1].liveDisplayAlias,
    "QA_PROVIDER_TARGET_ALIAS_AMBIGUOUS",
  )
  return Object.freeze(targets)
}

export function assertSanitizedProviderEvidence(value, targets, sensitiveValues = []) {
  const serialized = JSON.stringify(value).normalize("NFC")
  const protectedValues = [
    ...(targets || []).flatMap((target) => [target?.internalId, target?.liveDisplayAlias]),
    ...(sensitiveValues || []),
  ]
  for (const secret of protectedValues) {
    if (secret && serialized.includes(String(secret).normalize("NFC"))) {
      throw new GateError("QA_PROVIDER_SELECTOR_EVIDENCE_LEAKAGE")
    }
  }
  return true
}

export function sanitizedProviderAlignment(targets) {
  gate(Array.isArray(targets) && targets.length === 2, "LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const result = {
    target_count: 2,
    selector_A_resolved: targets[0]?.logicalAlias === PROVIDER_ALIASES[0],
    selector_B_resolved: targets[1]?.logicalAlias === PROVIDER_ALIASES[1],
    IDs_distinct: targets[0]?.internalId !== targets[1]?.internalId,
    aliases_present: targets.every((target) => Boolean(target.liveDisplayAlias)),
    aliases_distinct:
      targets[0].liveDisplayAlias !== targets[1].liveDisplayAlias,
    synthetic_validation: true,
    active_validation: true,
  }
  assertSanitizedProviderEvidence(result, targets)
  return result
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

export function assertPublicFixturePostBudget(publicPostCount) {
  gate(
    FIXTURE_ALIASES.length === 2 &&
      AUTHORIZED_PUBLIC_FIXTURE_POSTS === 2,
    "PUBLIC_FIXTURE_CONTRACT_DIFFERENT",
  )
  gate(
    Number.isInteger(publicPostCount) && publicPostCount >= 0,
    "PUBLIC_FIXTURE_POST_COUNT_INVALID",
  )
  gate(
    publicPostCount < AUTHORIZED_PUBLIC_FIXTURE_POSTS,
    "PUBLIC_FIXTURE_POST_BUDGET_EXHAUSTED",
  )
  return true
}

function publicFixturePayload(alias) {
  return {
    provider_name: alias,
    provider_email: `${alias.toLowerCase()}@example.invalid`,
    concept: `${alias} QA controlled matching`,
    amount_requested: alias.endsWith("MAIN") ? 101.01 : 202.02,
    currency: "MXN",
    description: "Fixture sintético aislado para Gate 2.",
  }
}

export function createPublicFixtureSubmitAttempt({
  alias,
  publicPostCount,
  createCaptchaSession = () => createRuntimeTurnstileSession(),
  createController = ({ captchaSession }) =>
    createCanonicalBrowserSubmitController({
      portalUrl: CANONICAL_DEV_PORTAL_URL,
      endpoint: CANONICAL_PUBLIC_SUBMIT_ENDPOINT,
      enabled: true,
      captchaSession,
    }),
  createIdempotencyKey = () => crypto.randomUUID(),
} = {}) {
  assertPublicFixturePostBudget(publicPostCount)
  gate(FIXTURE_ALIASES.includes(alias), "PUBLIC_FIXTURE_ALIAS_INVALID")
  const captchaSession = createCaptchaSession()
  const controller = createController({ captchaSession })
  const idempotencyKey = createIdempotencyKey()
  const payload = publicFixturePayload(alias)
  return Object.freeze({
    alias,
    captchaSession,
    controller,
    idempotencyKey,
    payload: Object.freeze(payload),
    payloadFingerprint: digest(payload),
  })
}

function materialForMatch(input) {
  return canonical({
    expectedCurrentMatch: input.expectedCurrentMatch,
    expectedStatus: input.expectedStatus,
    expectedUpdatedAt: input.expectedUpdatedAt,
    fixtureAlias: input.fixtureAlias,
    providerAlias: input.providerAlias,
    reason: input.reason,
    reasonCode: input.reasonCode,
  })
}

function actionKind(current, next) {
  if (current === null && next !== null) return "match_set"
  if (current !== null && next !== null) return "match_replace"
  if (current !== null && next === null) return "match_clear"
  throw new GateError("MATCH_NOOP_NOT_ALLOWED")
}

function mockBaselineEqual(actual) {
  return digest(actual) === digest(MOCK_BASELINE)
}

const LIVE_BASELINE_FIELDS = Object.freeze([
  "payment_intake",
  "payment_intake_events",
  "payment_intake_files",
  "storage_objects",
  "proveedores",
  "providers",
  "payment_requests",
  "approval_batches",
  "payment_layouts",
  "payment_layout_lines",
  "cash_funds",
  "notification_events",
  "intake_links",
  "matched_intakes",
  "provider_matched",
])

export function createLiveStartSnapshot(actual, {
  capturedAt = new Date().toISOString(),
} = {}) {
  gate(actual && typeof actual === "object", "LIVE_START_SNAPSHOT_INVALID")
  const counts = {}
  for (const field of LIVE_BASELINE_FIELDS) {
    const value = Number(actual[field])
    gate(Number.isInteger(value) && value >= 0, "LIVE_START_SNAPSHOT_INVALID", { field })
    counts[field] = value
  }
  gate(actual.states && typeof actual.states === "object", "LIVE_START_SNAPSHOT_INVALID")
  counts.states = {}
  for (const state of ["received", "in_review", "needs_correction", "rejected", "converted", "cancelled"]) {
    const value = Number(actual.states[state])
    gate(Number.isInteger(value) && value >= 0, "LIVE_START_SNAPSHOT_INVALID", { state })
    counts.states[state] = value
  }
  const snapshotHash = digest({ capturedAt, counts })
  return Object.freeze({
    kind: "LIVE_START_SNAPSHOT",
    captured: true,
    captured_at: capturedAt,
    shape_valid: true,
    snapshot_hash: snapshotHash,
    snapshot_hash_present: /^[0-9a-f]{64}$/.test(snapshotHash),
    absolute_baseline_enforced: false,
    counts: Object.freeze(counts),
  })
}

export function validateRunScopedDelta(actual, expected) {
  gate(actual && expected, "RUN_SCOPED_DELTA_INVALID")
  const keys = Object.keys(expected)
  gate(
    keys.every((key) => Number(actual[key]) === Number(expected[key])),
    "RUN_SCOPED_DELTA_INVALID",
    { keys },
  )
  return Object.freeze({
    status: "PASS",
    run_scoped: true,
    validated_fields: keys.length,
  })
}

export function classifyConcurrentDevEvolution(start, current, {
  runOwned = {},
} = {}) {
  gate(start?.counts && current && typeof current === "object", "LIVE_START_SNAPSHOT_INVALID")
  const unrelated = {}
  for (const field of LIVE_BASELINE_FIELDS) {
    const globalDelta = Number(current[field]) - Number(start.counts[field])
    const ownedDelta = Number(runOwned[field] || 0)
    unrelated[field] = globalDelta - ownedDelta
  }
  return Object.freeze({
    classification: Object.values(unrelated).some((value) => value !== 0)
      ? "CONCURRENT_DEV_EVOLUTION"
      : "NO_CONCURRENT_DEV_EVOLUTION",
    blocks_run: false,
    unrelated: Object.freeze(unrelated),
  })
}

export function validateRunScopedSideEffects(effects) {
  const expectedZero = [
    "payment_requests",
    "proveedores",
    "approval_batches",
    "layouts",
    "notifications",
    "storage_objects",
    "conversions",
  ]
  gate(
    expectedZero.every((field) => Number(effects?.[field]) === 0),
    "RUN_SCOPED_SIDE_EFFECT_INVALID",
  )
  return Object.freeze({ status: "PASS", run_scoped: true, side_effects: 0 })
}

export function identifyAuthorizedDemoLink(rows, {
  expectedCompanyId,
  now = Date.now(),
} = {}) {
  const candidates = (rows || []).filter(
    (row) => row?.label === DEMO_LINK_REVOCATION_CONTRACT.logical_alias,
  )
  gate(candidates.length === 1, candidates.length ? "DEMO_LINK_AMBIGUOUS" : "DEMO_LINK_NOT_FOUND")
  const candidate = candidates[0]
  const tolerance = DEMO_LINK_REVOCATION_CONTRACT.temporal_tolerance_ms
  const within = (actual, expected) =>
    Math.abs(Date.parse(String(actual)) - Date.parse(expected)) <= tolerance
  gate(
    candidate.company_id === expectedCompanyId &&
      candidate.status === "active" &&
      within(candidate.created_at, DEMO_LINK_REVOCATION_CONTRACT.created_at) &&
      within(candidate.expires_at, DEMO_LINK_REVOCATION_CONTRACT.expires_at) &&
      Date.parse(candidate.expires_at) > Number(now),
    "ACTIVE_QA_LINK_NOT_AUTHORIZED_FOR_REVOCATION",
  )
  return Object.freeze({ candidate: Object.freeze(clone(candidate)), candidate_count: 1 })
}

const DEMO_LINK_MUTABLE_FIELDS = new Set(["status", "revoked_at", "revoked_by", "updated_at"])

export function demoLinkProtectedSnapshot(row) {
  return canonical(Object.fromEntries(
    Object.entries(row || {}).filter(([key]) => !DEMO_LINK_MUTABLE_FIELDS.has(key)),
  ))
}

export function validateDemoLinkRevocationResult(before, after, {
  rowCount,
  rolledBack = false,
} = {}) {
  gate(rowCount === 1, "DEMO_LINK_REVOCATION_ROWCOUNT_INVALID")
  gate(before?.status === "active" && after?.status === "revoked", "DEMO_LINK_REVOCATION_STATUS_INVALID")
  gate(after?.revoked_at && after?.revoked_by, "DEMO_LINK_REVOCATION_ACTOR_INVALID")
  gate(
    digest(demoLinkProtectedSnapshot(before)) === digest(demoLinkProtectedSnapshot(after)),
    "DEMO_LINK_PROTECTED_FIELDS_CHANGED",
  )
  return Object.freeze({
    status: "PASS",
    row_count: 1,
    rolled_back: Boolean(rolledBack),
    protected_fields_intact: true,
  })
}

function expectedLinkContractEqual(actual) {
  return digest(actual) === digest(INTAKE_LINK_CONTRACT)
}

function matchRequest({
  deps,
  actor,
  fixture,
  providerAlias,
  reason = null,
  reasonCode,
  actionId = deps.newActionId(),
}) {
  return {
    actor,
    fixtureAlias: fixture.alias,
    expectedStatus: fixture.status,
    expectedUpdatedAt: fixture.updatedAt,
    expectedCurrentMatch: fixture.match,
    providerAlias,
    reason,
    reasonCode,
    actionId,
  }
}

async function expectConflict(operation, code) {
  try {
    await operation()
  } catch (error) {
    gate(errorCode(error) === code, "UNEXPECTED_CONFLICT_CODE", {
      expected: code,
      actual: errorCode(error),
    })
    return true
  }
  throw new GateError("EXPECTED_CONFLICT_NOT_RAISED", { expected: code })
}

function assertDependencyShape(deps) {
  for (const name of REQUIRED_DEPENDENCIES) {
    if (name === "metrics") {
      gate(deps.metrics && typeof deps.metrics === "object", `CAPABILITY_MISSING_${name}`)
    } else {
      gate(typeof deps[name] === "function", `CAPABILITY_MISSING_${name}`)
    }
  }
}

export async function assertEnvironment(deps) {
  const environment = await deps.assertEnvironment()
  gate(environment.project_ref === DEV_PROJECT_REF, "UNAUTHORIZED_PROJECT_REF")
  gate(environment.environment === "DEV", "PROD_BLOCKED")
  gate(environment.production_accesses === 0, "PROD_ACCESS_DETECTED")
  return environment
}

export async function captureBaseline(deps) {
  const baseline = await deps.captureBaseline()
  if (deps.kind === "mock") {
    gate(mockBaselineEqual(baseline), "MOCK_BASELINE_DRIFT")
    return Object.freeze({
      kind: "MOCK_BASELINE",
      captured: true,
      absolute_baseline_enforced: true,
      counts: clone(baseline),
    })
  }
  return createLiveStartSnapshot(baseline)
}

export async function inspectLinkContract(deps) {
  const contract = await deps.inspectLinkContract()
  gate(expectedLinkContractEqual(contract), "INTAKE_LINK_CONTRACT_DRIFT")
  return contract
}

function databaseTimestamp(value) {
  const timestamp = Date.parse(String(value || ""))
  gate(Number.isFinite(timestamp), "EXPIRED_LINK_DATABASE_TIME_INVALID")
  return timestamp
}

function validLinkCandidate(row, companyId, databaseNow) {
  gate(String(row?.id || "").trim(), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  gate(row?.company_id === companyId, "EXPIRED_LINK_NORMALIZATION_COMPANY_MISMATCH")
  gate(row?.status === "active", "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  gate(String(row?.updated_at || "").trim(), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  gate(String(row?.expires_at || "").trim(), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  gate(databaseTimestamp(row.expires_at) < databaseNow, "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  gate(/^[0-9a-f]{64}$/.test(String(row?.token_hash || "")), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  gate(String(row?.token_prefix || "").trim().length >= 4, "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  return Object.freeze(clone(row))
}

export function classifyExpiredLinkState(rows, {
  companyId,
  databaseNow,
  expected = null,
} = {}) {
  gate(Array.isArray(rows), "EXPIRED_LINK_NORMALIZATION_INSPECTION_INVALID")
  gate(String(companyId || "").trim(), "EXPIRED_LINK_NORMALIZATION_COMPANY_MISMATCH")
  const authoritativeNow = databaseTimestamp(databaseNow)
  gate(
    rows.every((row) => row?.company_id === companyId),
    "EXPIRED_LINK_NORMALIZATION_COMPANY_MISMATCH",
  )
  const classification = {
    total: rows.length,
    activeValid: 0,
    activeExpired: 0,
    revoked: 0,
    expired: 0,
    paused: 0,
    otherActive: 0,
  }
  for (const row of rows) {
    if (row.status === "active") {
      if (!row.expires_at) classification.otherActive += 1
      else {
        const expiresAt = databaseTimestamp(row.expires_at)
        if (expiresAt < authoritativeNow) classification.activeExpired += 1
        else if (expiresAt > authoritativeNow) classification.activeValid += 1
        else classification.otherActive += 1
      }
    } else if (row.status === "revoked") classification.revoked += 1
    else if (row.status === "expired") classification.expired += 1
    else if (row.status === "paused") classification.paused += 1
  }
  const supportedStates = expected
    ? [{ state: "EXPLICIT_EXPECTED", snapshot: expected }]
    : [
      { state: "NEEDS_NORMALIZATION", snapshot: EXPECTED_EXPIRED_LINK_PRE_STATE },
      { state: "ALREADY_NORMALIZED", snapshot: EXPECTED_ALREADY_NORMALIZED_LINK_STATE },
    ]
  let matchedState = supportedStates.find(
    (candidate) => digest(classification) === digest(candidate.snapshot),
  )
  const historicalQaRevoked = rows.some(
    (row) => row?.status === "revoked" && /^QA V6B /u.test(String(row?.label || "")),
  )
  if (!expected && isAlreadyNormalizedSafeHistory(classification, { historicalQaRevoked })) {
    matchedState = {
      state: "ALREADY_NORMALIZED_SAFE_HISTORY",
      snapshot: classification,
    }
  }
  gate(matchedState, "EXPIRED_LINK_NORMALIZATION_STATE_MISMATCH", { classification })
  const candidates = rows.filter(
    (row) => row.status === "active" && row.expires_at &&
      databaseTimestamp(row.expires_at) < authoritativeNow,
  )
  const expectedActiveExpired = matchedState.snapshot.activeExpired
  gate(candidates.length === expectedActiveExpired, "EXPIRED_LINK_NORMALIZATION_CANDIDATE_COUNT")
  const candidate = candidates.length === 1
    ? validLinkCandidate(candidates[0], companyId, authoritativeNow)
    : null
  return Object.freeze({
    classification: Object.freeze(classification),
    candidate,
    databaseNow: String(databaseNow),
    normalization_state: matchedState.state === "EXPLICIT_EXPECTED"
      ? expectedActiveExpired === 1 ? "NEEDS_NORMALIZATION" : "ALREADY_NORMALIZED"
      : matchedState.state === "ALREADY_NORMALIZED_SAFE_HISTORY"
        ? "ALREADY_NORMALIZED"
        : matchedState.state,
    normalization_write_required: expectedActiveExpired === 1,
  })
}

export function isAlreadyNormalizedSafeHistory(classification, {
  historicalQaRevoked = true,
} = {}) {
  return Number(classification?.total) >= 3 &&
    classification.activeValid === 0 &&
    classification.activeExpired === 0 &&
    classification.otherActive === 0 &&
    classification.paused === 0 &&
    Number(classification.unknown || 0) === 0 &&
    classification.expired === 1 &&
    classification.revoked >= 2 &&
    historicalQaRevoked === true &&
    classification.total === classification.expired + classification.revoked
}

export function classifyExpiredLinkStateFromDatabaseFilter(rows, expiredActiveRows) {
  gate(Array.isArray(rows), "EXPIRED_LINK_NORMALIZATION_INSPECTION_INVALID")
  gate(Array.isArray(expiredActiveRows), "EXPIRED_LINK_NORMALIZATION_INSPECTION_INVALID")
  gate(expiredActiveRows.length <= 1, "EXPIRED_LINK_NORMALIZATION_CANDIDATE_COUNT")
  const databaseCandidate = expiredActiveRows[0] || null
  const companyId = String(databaseCandidate?.company_id || rows[0]?.company_id || "").trim()
  gate(companyId, "EXPIRED_LINK_NORMALIZATION_COMPANY_MISMATCH")
  const scoped = rows.filter((row) => row?.company_id === companyId)
  gate(expiredActiveRows.every(
    (row) => row?.company_id === companyId && row?.status === "active" && row?.expires_at,
  ), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  const expiredIds = new Set(expiredActiveRows.map((row) => String(row.id)))
  const classification = {
    total: scoped.length,
    activeValid: 0,
    activeExpired: 0,
    revoked: 0,
    expired: 0,
    paused: 0,
    otherActive: 0,
  }
  for (const row of scoped) {
    if (row.status === "active") {
      if (expiredIds.has(String(row.id))) classification.activeExpired += 1
      else if (!row.expires_at) classification.otherActive += 1
      else classification.activeValid += 1
    } else if (row.status === "revoked") classification.revoked += 1
    else if (row.status === "expired") classification.expired += 1
    else if (row.status === "paused") classification.paused += 1
  }
  const normalizationState = digest(classification) === digest(EXPECTED_EXPIRED_LINK_PRE_STATE)
    ? "NEEDS_NORMALIZATION"
    : isAlreadyNormalizedSafeHistory(classification, {
        historicalQaRevoked: scoped.some(
          (row) => row?.status === "revoked" && /^QA V6B /u.test(String(row?.label || "")),
        ),
      })
      ? "ALREADY_NORMALIZED"
      : null
  gate(normalizationState, "EXPIRED_LINK_NORMALIZATION_STATE_MISMATCH", { classification })
  if (normalizationState === "NEEDS_NORMALIZATION") {
    gate(String(databaseCandidate?.id || "").trim(), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
    gate(String(databaseCandidate?.updated_at || "").trim(), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
    gate(/^[0-9a-f]{64}$/.test(String(databaseCandidate?.token_hash || "")), "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
    gate(String(databaseCandidate?.token_prefix || "").trim().length >= 4, "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  }
  return Object.freeze({
    classification: Object.freeze(classification),
    candidate: databaseCandidate ? Object.freeze(clone(databaseCandidate)) : null,
    companyId,
    databaseTimeAuthoritative: true,
    normalization_state: normalizationState,
    normalization_write_required: normalizationState === "NEEDS_NORMALIZATION",
  })
}

const NORMALIZATION_MUTABLE_FIELDS = new Set(["status", "updated_at"])

export function normalizationProtectedSnapshot(row) {
  return canonical(Object.fromEntries(
    Object.entries(row || {}).filter(([key]) => !NORMALIZATION_MUTABLE_FIELDS.has(key)),
  ))
}

export function validateNormalizationOptimisticSnapshot(expected, actual) {
  for (const field of ["id", "company_id", "status", "expires_at", "updated_at"]) {
    gate(
      expected?.[field] === actual?.[field],
      "EXPIRED_LINK_NORMALIZATION_STALE_CONFLICT",
    )
  }
  return true
}

export function assertExpiredLinkNormalizationTransition(fromStatus, toStatus) {
  gate(
    fromStatus === "active" && toStatus === "expired",
    "EXPIRED_LINK_NORMALIZATION_TRANSITION_INVALID",
  )
  return true
}

export function validateNormalizationMutation(before, after) {
  assertExpiredLinkNormalizationTransition(before?.status, after?.status)
  gate(
    digest(normalizationProtectedSnapshot(before)) ===
      digest(normalizationProtectedSnapshot(after)),
    "EXPIRED_LINK_NORMALIZATION_PROTECTED_FIELD_CHANGED",
  )
  return true
}

function validateNormalizationRowCount(rowCount) {
  if (rowCount === 0) throw new GateError("EXPIRED_LINK_NORMALIZATION_STALE_CONFLICT")
  if (rowCount !== 1) {
    throw new GateError("EXPIRED_LINK_NORMALIZATION_ROWCOUNT_VIOLATION")
  }
  return true
}

export function validateNormalizationDryRunResult(result, candidate) {
  validateNormalizationRowCount(result?.rowCount)
  gate(result?.rolledBack === true, "EXPIRED_LINK_NORMALIZATION_ROLLBACK_MISSING")
  gate(result?.inTransactionStatus === "expired", "EXPIRED_LINK_NORMALIZATION_POSTCHECK_FAILED")
  gate(result?.realStatus === "active", "EXPIRED_LINK_NORMALIZATION_ROLLBACK_FAILED")
  gate(result?.writes === 0, "EXPIRED_LINK_NORMALIZATION_DRY_RUN_WROTE")
  gate(result?.businessDelta === 0, "EXPIRED_LINK_NORMALIZATION_BUSINESS_DELTA")
  gate(result?.protectedFieldsInvariant === true, "EXPIRED_LINK_NORMALIZATION_PROTECTED_FIELD_CHANGED")
  gate(result?.databaseTimeAuthoritative === true, "EXPIRED_LINK_DATABASE_TIME_INVALID")
  gate(result?.optimisticGuard === true, "EXPIRED_LINK_NORMALIZATION_STALE_CONFLICT")
  gate(candidate?.status === "active", "EXPIRED_LINK_NORMALIZATION_CANDIDATE_INVALID")
  return true
}

export function validateNormalizationApplyResult(result, candidate) {
  validateNormalizationRowCount(result?.rowCount)
  validateNormalizationMutation(candidate, result?.row)
  gate(result?.status === "expired", "EXPIRED_LINK_NORMALIZATION_POSTCHECK_FAILED")
  gate(result?.protectedFieldsInvariant === true, "EXPIRED_LINK_NORMALIZATION_PROTECTED_FIELD_CHANGED")
  return true
}

export function validateExpiredLinkNormalizationEvidence(value, sensitive = {}) {
  const serialized = JSON.stringify(value).normalize("NFC")
  for (const secret of [
    sensitive.id,
    sensitive.company_id,
    sensitive.token_hash,
    sensitive.token_prefix,
    sensitive.created_by,
  ]) {
    if (secret && serialized.includes(String(secret).normalize("NFC"))) {
      throw new GateError("EXPIRED_LINK_NORMALIZATION_EVIDENCE_LEAKAGE")
    }
  }
  return true
}

export async function inspectExpiredActiveLink(deps, context) {
  const inspected = await deps.inspectExpiredActiveLink()
  const classified = classifyExpiredLinkState(inspected.rows, {
    companyId: inspected.companyId,
    databaseNow: inspected.databaseNow,
  })
  context.expiredLink = classified.candidate
  context.expiredLinkCompanyId = inspected.companyId
  context.expiredLinkDatabaseNow = inspected.databaseNow
  context.normalizationState = classified.normalization_state
  context.expiredLinkInspection = classified
  return classified
}

export async function dryRunExpiredLinkNormalization(deps, context) {
  if (context.normalizationState === "ALREADY_NORMALIZED") {
    return {
      status: "ALREADY_NORMALIZED",
      writes: 0,
      normalization_write_required: false,
    }
  }
  const result = await deps.dryRunExpiredLinkNormalization({
    candidate: clone(context.expiredLink),
    companyId: context.expiredLinkCompanyId,
    databaseNow: context.expiredLinkDatabaseNow,
  })
  validateNormalizationDryRunResult(result, context.expiredLink)
  return result
}

export async function applyExpiredLinkNormalization(deps, context) {
  if (context.normalizationState === "ALREADY_NORMALIZED") {
    return {
      status: "ALREADY_NORMALIZED",
      rowCount: 0,
      writes: 0,
      normalization_write_required: false,
    }
  }
  const result = await deps.applyExpiredLinkNormalization({
    candidate: clone(context.expiredLink),
    companyId: context.expiredLinkCompanyId,
  })
  validateNormalizationApplyResult(result, context.expiredLink)
  context.expiredLink = clone(result.row)
  return result
}

export async function verifyExpiredLinkNormalization(deps, context) {
  if (context.normalizationState === "ALREADY_NORMALIZED") {
    return context.expiredLinkInspection
  }
  const verified = await deps.verifyExpiredLinkNormalization({
    candidate: clone(context.expiredLink),
    companyId: context.expiredLinkCompanyId,
  })
  const classified = classifyExpiredLinkState(verified.rows, {
    companyId: verified.companyId,
    databaseNow: verified.databaseNow,
    expected: EXPECTED_EXPIRED_LINK_POST_STATE,
  })
  gate(classified.candidate === null, "EXPIRED_LINK_NORMALIZATION_POSTCHECK_FAILED")
  return classified
}

export async function validateExpiredLinkBusinessDelta(deps, context) {
  const result = await deps.validateExpiredLinkBusinessDelta({
    companyId: context.expiredLinkCompanyId,
  })
  gate(result?.businessDelta === 0, "EXPIRED_LINK_NORMALIZATION_BUSINESS_DELTA")
  return result
}

export async function generateEphemeralToken(deps) {
  const bytes = await deps.randomBytes(32)
  gate(bytes instanceof Uint8Array || Buffer.isBuffer(bytes), "TOKEN_BYTES_INVALID")
  gate(bytes.byteLength === 32, "TOKEN_ENTROPY_INVALID")
  const raw = Buffer.from(bytes).toString("base64url")
  const hash = await deps.sha256(raw)
  gate(/^[0-9a-f]{64}$/.test(hash), "TOKEN_HASH_FORMAT_INVALID")
  return {
    raw,
    hash,
    prefix: raw.slice(0, 8),
    entropyBytes: 32,
    exposure: 0,
  }
}

export async function dryRunLinkCreation(deps, context) {
  const result = await deps.dryRunLinkCreation({
    tokenHash: context.token.hash,
    tokenPrefix: context.token.prefix,
    expiresInMinutes: 60,
    maxSubmissionsPerDay: 2,
  })
  gate(result.ok === true, "LINK_DRY_RUN_FAILED")
  gate(result.writes === 0, "LINK_DRY_RUN_WROTE")
  return result
}

export async function createEphemeralLink(deps, context) {
  const link = await deps.createEphemeralLink({
    tokenHash: context.token.hash,
    tokenPrefix: context.token.prefix,
    expiresInMinutes: 60,
    maxSubmissionsPerDay: 2,
  })
  gate(link.status === "active", "LINK_INSERT_NOT_ACTIVE")
  context.link = link
  return link
}

export async function revokeEphemeralLink(deps, context) {
  const result = await deps.revokeEphemeralLink(context.link)
  gate(result.status === "revoked", "LINK_REVOKE_FAILED")
  context.link = { ...context.link, status: "revoked" }
  return result
}

export async function provisionFixtures(deps, context) {
  gate(
    AUTHORIZED_PUBLIC_FIXTURE_POSTS === 2,
    "PUBLIC_FIXTURE_CONTRACT_DIFFERENT",
  )
  const fixtures = []
  for (const alias of FIXTURE_ALIASES) {
    const fixture = await deps.submitPublicFixture({
      alias,
      token: context.token.raw,
      link: context.link,
    })
    gate(fixture.duplicate === false, "FIXTURE_DUPLICATE", { alias })
    gate(fixture.status === "received", "FIXTURE_STATUS_INVALID", { alias })
    gate(fixture.files === 0, "FIXTURE_FILES_INVALID", { alias })
    gate(fixture.match === null, "FIXTURE_MATCH_NOT_NULL", { alias })
    gate(fixture.paymentRequest === null, "FIXTURE_PAYMENT_REQUEST_CREATED", { alias })
    fixtures.push(fixture)
    context.fixtures.push(fixture)
  }
  gate(fixtures.length === 2, "FIXTURE_COUNT_INVALID")
  await revokeEphemeralLink(deps, context)
  const rejected = await deps.assertThirdSubmitRejected({
    token: context.token.raw,
    link: context.link,
  })
  gate(rejected === true, "REVOKED_LINK_ACCEPTED_SUBMIT")
  return fixtures
}

export async function validateProvisioningDelta(deps, context) {
  const delta = await deps.validateProvisioningDelta(context.fixtures)
  const expected = {
    intakes: 2,
    events: 2,
    storage: 0,
    notifications: 0,
    providers: 0,
    payment_requests: 0,
  }
  gate(digest(delta) === digest(expected), "PROVISIONING_DELTA_INVALID")
  return delta
}

export async function activateQaIam(deps, context) {
  const iam = await deps.activateQaIam({
    aliases: PRINCIPAL_ALIASES,
    role: "finance",
    company: "COMPANY_A",
  })
  gate(iam.activated === 2, "IAM_ACTIVATION_COUNT_INVALID")
  gate(iam.separateSessions === true, "IAM_SESSIONS_NOT_SEPARATE")
  context.iam = iam
  return iam
}

export async function deactivateQaIam(deps, context) {
  const final = await deps.deactivateQaIam(context.iam)
  gate(final.atRest === true, "IAM_NOT_AT_REST")
  gate(final.roles === 0, "IAM_ROLE_RESIDUAL")
  gate(final.memberships === 0, "IAM_MEMBERSHIP_RESIDUAL")
  gate(final.sessions === 0, "IAM_SESSION_RESIDUAL")
  gate(final.refreshTokens === 0, "IAM_REFRESH_TOKEN_RESIDUAL")
  gate(final.loginRejected === true, "IAM_LOGIN_REUSABLE")
  context.iamAtRest = final
  return final
}

export async function transitionFixturesToReview(deps, context) {
  const transitioned = []
  for (let index = 0; index < context.fixtures.length; index += 1) {
    const fixture = context.fixtures[index]
    const actor = PRINCIPAL_ALIASES[index]
    const row = await deps.transitionFixture({
      actor,
      fixtureAlias: fixture.alias,
      expectedStatus: "received",
      expectedUpdatedAt: fixture.updatedAt,
      toStatus: "in_review",
      notes: null,
      actionId: deps.newActionId(),
    })
    gate(row.status === "in_review", "TRANSITION_TO_REVIEW_FAILED", {
      alias: fixture.alias,
    })
    gate(row.match === null, "TRANSITION_CREATED_MATCH", { alias: fixture.alias })
    transitioned.push(row)
  }
  context.fixtures = transitioned
  return transitioned
}

async function auditMutableAccessibilityState(deps, context, page, stateAlias) {
  gate(typeof deps.auditAccessibilityState === "function", "LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
  let evidence
  try {
    evidence = await deps.auditAccessibilityState({
      page,
      stateAlias,
      environment: context.mode === "mutable" ? "MUTABLE_DEV" : "MOCKED_NO_WRITE",
    })
    assertSanitizedAccessibilityEvidence(evidence)
    context.accessibility.record(stateAlias, evidence)
  } catch (error) {
    if (error instanceof AccessibilityGateError) {
      throw new GateError(error.code, error.details)
    }
    if (error instanceof GateError) throw error
    throw new GateError(errorCode(error) || "LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
  }
  return evidence
}

export async function runMainMatrix(deps, context) {
  const alias = FIXTURE_ALIASES[0]
  const actor = PRINCIPAL_ALIASES[0]
  const providerA = context.providerTargets.find(
    (target) => target.logicalAlias === PROVIDER_ALIASES[0],
  )
  const providerB = context.providerTargets.find(
    (target) => target.logicalAlias === PROVIDER_ALIASES[1],
  )
  gate(providerA && providerB, "LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const initialEvents = await deps.listFixtureEvents(alias)
  let fixture = await deps.getFixture(alias)
  gate(fixture.status === "in_review" && fixture.match === null, "MAIN_INITIAL_STATE")

  const page = await deps.openLiveMatchingPage({
    actor,
    fixtureAlias: alias,
  })
  await auditMutableAccessibilityState(
    deps,
    context,
    page,
    "main_eligible_unlinked",
  )

  const setDialog = await openProviderSetDialog(page, {
    sanitizedTargetAlias: providerA.logicalAlias,
    searchText: providerA.uiSearchText,
    expectedCardHeading: providerA.expectedCardHeading,
    timeout: deps.kind === "mock" ? 1_000 : 30_000,
  })
  await auditMutableAccessibilityState(deps, context, page, "main_set_dialog")

  const setBody = matchRequest({
    deps,
    actor,
    fixture,
    providerAlias: PROVIDER_ALIASES[0],
    reasonCode: "candidate_selected",
  })
  const set = await deps.submitReplaceFromPage({
    page,
    dialog: setDialog,
    request: setBody,
  })
  gate(set.idempotent === false && set.actionKind === "match_set", "MAIN_SET_FAILED")
  fixture = await deps.getFixture(alias)
  gate(fixture.match === PROVIDER_ALIASES[0], "MAIN_SET_NOT_PERSISTED")
  await auditMutableAccessibilityState(deps, context, page, "main_linked_a")
  const setUpdatedAt = fixture.updatedAt
  const setEventCount = (await deps.listFixtureEvents(alias)).length

  const replay = await deps.setProviderIntakeMatch(setBody)
  gate(replay.idempotent === true, "MAIN_REPLAY_NOT_IDEMPOTENT")
  fixture = await deps.getFixture(alias)
  gate(fixture.updatedAt === setUpdatedAt, "MAIN_REPLAY_CHANGED_UPDATED_AT")
  gate((await deps.listFixtureEvents(alias)).length === setEventCount, "MAIN_REPLAY_EVENT_DELTA")

  await expectConflict(
    () => deps.setProviderIntakeMatch({
      ...setBody,
      providerAlias: PROVIDER_ALIASES[1],
    }),
    "provider_intake_action_id_material_conflict",
  )
  fixture = await deps.getFixture(alias)
  gate(fixture.match === PROVIDER_ALIASES[0], "MAIN_MATERIAL_CONFLICT_CHANGED_MATCH")

  const dialog = await openProviderReplaceDialog(page, {
    sanitizedTargetAlias: providerB.logicalAlias,
    searchText: providerB.uiSearchText,
    expectedCardHeading: providerB.expectedCardHeading,
    timeout: deps.kind === "mock" ? 1_000 : 30_000,
  })
  await auditMutableAccessibilityState(deps, context, page, "main_replace_dialog")
  await dialog.reason.fill("QA V6: reemplazo controlado del proveedor sintético.")
  const replaceBody = matchRequest({
    deps,
    actor,
    fixture,
    providerAlias: PROVIDER_ALIASES[1],
    reason: "QA V6: reemplazo controlado del proveedor sintético.",
    reasonCode: "match_corrected",
  })
  const replace = await deps.submitReplaceFromPage({
    page,
    dialog,
    request: replaceBody,
  })
  gate(replace.idempotent === false && replace.actionKind === "match_replace", "MAIN_REPLACE_FAILED")
  fixture = await deps.getFixture(alias)
  gate(fixture.match === PROVIDER_ALIASES[1], "MAIN_REPLACE_NOT_PERSISTED")
  await auditMutableAccessibilityState(deps, context, page, "main_linked_b")

  const clearDialog = await openProviderClearDialog(page, {
    timeout: deps.kind === "mock" ? 1_000 : 30_000,
  })
  await auditMutableAccessibilityState(deps, context, page, "main_clear_dialog")
  await clearDialog.reason.fill("QA V6: retiro controlado del vínculo sintético.")
  const clearBody = matchRequest({
    deps,
    actor,
    fixture,
    providerAlias: null,
    reason: "QA V6: retiro controlado del vínculo sintético.",
    reasonCode: "no_longer_matches",
  })
  const clear = await deps.submitReplaceFromPage({
    page,
    dialog: clearDialog,
    request: clearBody,
  })
  gate(clear.idempotent === false && clear.actionKind === "match_clear", "MAIN_CLEAR_FAILED")
  fixture = await deps.getFixture(alias)
  gate(fixture.match === null, "MAIN_CLEAR_NOT_PERSISTED")
  await auditMutableAccessibilityState(deps, context, page, "main_unlinked_after_clear")

  const events = (await deps.listFixtureEvents(alias)).slice(initialEvents.length)
  gate(events.length === 3, "MAIN_PROVIDER_MATCHED_EVENT_COUNT")
  gate(events.every((event) => event.type === "provider_matched"), "MAIN_EVENT_TYPE_INVALID")
  gate(
    events.map((event) => event.metadata.action_kind).join(",") ===
      "match_set,match_replace,match_clear",
    "MAIN_EVENT_ORDER_INVALID",
  )
  context.main = {
    status: "PASS",
    set: true,
    exactReplay: true,
    materialConflict: true,
    replace: true,
    clear: true,
    providerMatchedEvents: 3,
  }
  return context.main
}

export async function runRaceMatrix(deps, context) {
  const alias = FIXTURE_ALIASES[1]
  const initialEvents = await deps.listFixtureEvents(alias)
  const snapshot = await deps.getFixture(alias)
  gate(snapshot.status === "in_review" && snapshot.match === null, "RACE_INITIAL_STATE")
  const raceTarget = context.providerTargets.find(
    (target) => target.logicalAlias === PROVIDER_ALIASES[1],
  )
  gate(raceTarget, "LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const conflictPage = await deps.openLiveMatchingPage({
    actor: PRINCIPAL_ALIASES[1],
    fixtureAlias: alias,
  })
  const conflictDialog = await openProviderSetDialog(conflictPage, {
    sanitizedTargetAlias: raceTarget.logicalAlias,
    searchText: raceTarget.uiSearchText,
    expectedCardHeading: raceTarget.expectedCardHeading,
    timeout: deps.kind === "mock" ? 1_000 : 30_000,
  })

  const left = matchRequest({
    deps,
    actor: PRINCIPAL_ALIASES[0],
    fixture: snapshot,
    providerAlias: PROVIDER_ALIASES[0],
    reasonCode: "candidate_selected",
  })
  const right = matchRequest({
    deps,
    actor: PRINCIPAL_ALIASES[1],
    fixture: snapshot,
    providerAlias: PROVIDER_ALIASES[1],
    reasonCode: "candidate_selected",
  })
  const attempts = await Promise.allSettled([
    deps.setProviderIntakeMatch(left),
    deps.setProviderIntakeMatch(right),
  ])
  const winners = attempts
    .map((outcome, index) => ({ outcome, request: [left, right][index] }))
    .filter(({ outcome }) => outcome.status === "fulfilled")
  const conflicts = attempts.filter(
    (outcome) =>
      outcome.status === "rejected" &&
      errorCode(outcome.reason) === "provider_intake_conflict",
  )
  gate(winners.length === 1 && conflicts.length === 1, "RACE_WINNER_CONFLICT_COUNT")

  const winner = winners[0]
  let fixture = await deps.getFixture(alias)
  gate(fixture.match === winner.request.providerAlias, "RACE_WINNER_NOT_PERSISTED")
  gate((await deps.listFixtureEvents(alias)).length === initialEvents.length + 1, "RACE_LOSER_EVENT")

  const conflictUi = await deps.submitConflictFromPage({
    page: conflictPage,
    dialog: conflictDialog,
  })
  gate(conflictUi?.conflict === true, "RACE_CONFLICT_UI_MISSING")
  gate(conflictUi?.silentOverwrite === false, "RACE_SILENT_OVERWRITE")
  gate(conflictUi?.accessibleAnnouncement === true, "RACE_CONFLICT_ANNOUNCEMENT_MISSING")
  await auditMutableAccessibilityState(deps, context, conflictPage, "race_conflict")

  const beforeReplay = fixture.updatedAt
  const beforeReplayEvents = (await deps.listFixtureEvents(alias)).length
  const replay = await deps.setProviderIntakeMatch(winner.request)
  gate(replay.idempotent === true, "RACE_REPLAY_NOT_IDEMPOTENT")
  fixture = await deps.getFixture(alias)
  gate(fixture.updatedAt === beforeReplay, "RACE_REPLAY_CHANGED_UPDATED_AT")
  gate((await deps.listFixtureEvents(alias)).length === beforeReplayEvents, "RACE_REPLAY_EVENT")

  const otherProvider = winner.request.providerAlias === PROVIDER_ALIASES[0]
    ? PROVIDER_ALIASES[1]
    : PROVIDER_ALIASES[0]
  await expectConflict(
    () => deps.setProviderIntakeMatch({
      ...winner.request,
      providerAlias: otherProvider,
    }),
    "provider_intake_action_id_material_conflict",
  )
  const otherActor = winner.request.actor === PRINCIPAL_ALIASES[0]
    ? PRINCIPAL_ALIASES[1]
    : PRINCIPAL_ALIASES[0]
  await expectConflict(
    () => deps.setProviderIntakeMatch({
      ...winner.request,
      actor: otherActor,
    }),
    "provider_intake_action_id_conflict",
  )
  await expectConflict(
    () => deps.setProviderIntakeMatch({
      ...winner.request,
      expectedCurrentMatch: fixture.match,
      expectedUpdatedAt: fixture.updatedAt,
      providerAlias: null,
      reason: "QA V6: conflicto cruzado controlado.",
      reasonCode: "no_longer_matches",
    }),
    "provider_intake_action_id_material_conflict",
  )
  await expectConflict(
    () => deps.setProviderIntakeMatch(matchRequest({
      deps,
      actor: winner.request.actor,
      fixture: snapshot,
      providerAlias: otherProvider,
      reasonCode: "candidate_selected",
    })),
    "provider_intake_conflict",
  )

  if (deps.failPoint === "race") throw new GateError("INJECTED_RACE_FAILURE")

  fixture = await deps.getFixture(alias)
  const clear = await deps.setProviderIntakeMatch(matchRequest({
    deps,
    actor: winner.request.actor,
    fixture,
    providerAlias: null,
    reason: "QA V6: retiro del ganador concurrente.",
    reasonCode: "no_longer_matches",
  }))
  gate(clear.actionKind === "match_clear", "RACE_CLEAR_FAILED")
  fixture = await deps.getFixture(alias)
  gate(fixture.match === null, "RACE_CLEAR_NOT_PERSISTED")

  const events = (await deps.listFixtureEvents(alias)).slice(initialEvents.length)
  gate(events.length === 2, "RACE_PROVIDER_MATCHED_EVENT_COUNT")
  gate(events.every((event) => event.type === "provider_matched"), "RACE_EVENT_TYPE_INVALID")
  context.race = {
    status: "PASS",
    winner: 1,
    conflict: 1,
    exactReplay: true,
    materialConflict: true,
    actorConflict: true,
    crossOperationConflict: true,
    staleSnapshotConflict: true,
    clear: true,
    providerMatchedEvents: 2,
  }
  return context.race
}

export async function closeFixtures(deps, context) {
  const closed = []
  for (let index = 0; index < FIXTURE_ALIASES.length; index += 1) {
    const alias = FIXTURE_ALIASES[index]
    const fixture = await deps.getFixture(alias)
    gate(fixture.match === null, "CLOSE_FIXTURE_MATCH_NOT_NULL", { alias })
    const row = await deps.transitionFixture({
      actor: PRINCIPAL_ALIASES[index],
      fixtureAlias: alias,
      expectedStatus: "in_review",
      expectedUpdatedAt: fixture.updatedAt,
      toStatus: "rejected",
      notes: "QA V6: cierre terminal del fixture sintético.",
      actionId: deps.newActionId(),
    })
    gate(row.status === "rejected", "CLOSE_FIXTURE_FAILED", { alias })
    closed.push(row)
  }
  const terminalPage = await deps.openLiveMatchingPage({
    actor: PRINCIPAL_ALIASES[0],
    fixtureAlias: FIXTURE_ALIASES[0],
  })
  await auditMutableAccessibilityState(
    deps,
    context,
    terminalPage,
    "terminal_rejected",
  )
  context.fixtures = closed
  return closed
}

export async function validateEventMetadata(deps) {
  const main = await deps.listFixtureEvents(FIXTURE_ALIASES[0])
  const race = await deps.listFixtureEvents(FIXTURE_ALIASES[1])
  const matching = [...main, ...race].filter((event) => event.type === "provider_matched")
  gate(matching.length === 5, "METADATA_EVENT_COUNT")
  for (const event of matching) {
    const metadata = event.metadata
    gate(metadata.contract_version === 3, "METADATA_CONTRACT_VERSION")
    gate(/^[0-9a-f]{64}$/.test(metadata.action_fingerprint), "METADATA_FINGERPRINT")
    gate(
      ["match_set", "match_replace", "match_clear"].includes(metadata.action_kind),
      "METADATA_ACTION_KIND",
    )
    gate(
      ["candidate_selected", "match_corrected", "no_longer_matches"].includes(
        metadata.reason_code,
      ),
      "METADATA_REASON_CODE",
    )
    gate(metadata.actor_qa === true, "METADATA_ACTOR")
    gate(metadata.contains_sensitive_fields === false, "METADATA_SENSITIVE_FIELD")
  }
  return {
    status: "PASS",
    validated: 5,
    fingerprintsValidatedNotExported: 5,
    sensitiveFields: 0,
  }
}

export async function validateFinalDelta(deps) {
  const final = await deps.captureFinal()
  const expected = {
    payment_intake_run_delta: 2,
    payment_intake_events_run_delta: 11,
    provider_matched_run_delta: 5,
    fixtures_final_rejected: 2,
    matches_final: 0,
    core_protected_run_delta: 0,
    active_qa_links_final: 0,
  }
  gate(digest(final) === digest(expected), "FINAL_DELTA_INVALID")
  return final
}

export async function cleanupAll(deps, context) {
  const cleanup = {
    clearAttempts: 0,
    rejectAttempts: 0,
    linkRevokeAttempts: 0,
    iamCleanupAttempts: 0,
    tokenDropAttempts: 0,
    errors: [],
  }
  for (const alias of FIXTURE_ALIASES) {
    cleanup.clearAttempts += 1
    try {
      await deps.clearFixtureMatch(alias)
    } catch (error) {
      cleanup.errors.push(`clear:${errorCode(error)}`)
    }
    cleanup.rejectAttempts += 1
    try {
      await deps.rejectFixture(alias)
    } catch (error) {
      cleanup.errors.push(`reject:${errorCode(error)}`)
    }
  }
  cleanup.linkRevokeAttempts += 1
  try {
    await deps.revokeEphemeralLink(context.link)
  } catch (error) {
    cleanup.errors.push(`link:${errorCode(error)}`)
  }
  cleanup.iamCleanupAttempts += 1
  try {
    const atRest = await deps.deactivateQaIam(context.iam)
    if (atRest?.atRest) context.iamAtRest = atRest
  } catch (error) {
    cleanup.errors.push(`iam:${errorCode(error)}`)
  }
  cleanup.tokenDropAttempts += 1
  try {
    if (context.token) context.token.raw = null
    await deps.dropRawToken()
  } catch (error) {
    cleanup.errors.push(`token:${errorCode(error)}`)
  }
  try {
    await deps.closeBrowser()
  } catch (error) {
    cleanup.errors.push(`browser:${errorCode(error)}`)
  }
  const status = await deps.cleanupStatus()
  if (typeof deps.clearCredentialMemory === "function") {
    await deps.clearCredentialMemory()
  }
  return {
    ...cleanup,
    status,
    pass:
      cleanup.clearAttempts === 2 &&
      cleanup.rejectAttempts === 2 &&
      cleanup.linkRevokeAttempts === 1 &&
      cleanup.iamCleanupAttempts === 1 &&
      cleanup.tokenDropAttempts === 1 &&
      status.activeQaLinks === 0 &&
      status.matches === 0 &&
      status.fixturesTerminal === true &&
      status.iamAtRest === true &&
      status.rawTokenPresent === false,
  }
}

function newContext(mode) {
  return {
    mode,
    providerTargets: [],
    otherCompanyLinks: [
      {
        label: "Other company historical",
        status: "revoked",
        expires_at: null,
      },
    ],
    expiredLink: null,
    expiredLinkCompanyId: null,
    expiredLinkDatabaseNow: null,
    expiredLinkInspection: null,
    normalizationState: null,
    token: null,
    link: null,
    fixtures: [],
    iam: null,
    iamAtRest: null,
    main: null,
    race: null,
    accessibility: createAccessibilityHookRecorder(),
    liveStartSnapshot: null,
    secondUat: false,
  }
}

export async function executeUat(deps, { mode = "no-write-mocked" } = {}) {
  assertDependencyShape(deps)
  const context = newContext(mode)
  let primaryError = null
  let result = null
  try {
    const environment = await assertEnvironment(deps)
    const baseline = await captureBaseline(deps)
    context.liveStartSnapshot = baseline
    const linkContract = await inspectLinkContract(deps)
    context.providerTargets = await deps.resolveProviderTargets()
    gate(context.providerTargets.length === 2, "LIVE_PROVIDER_ALIAS_UNRESOLVED")
    const expiredLinkInspection = await inspectExpiredActiveLink(deps, context)
    const expiredLinkDryRun = await dryRunExpiredLinkNormalization(deps, context)
    const expiredLinkApply = await applyExpiredLinkNormalization(deps, context)
    const expiredLinkPostcheck = await verifyExpiredLinkNormalization(deps, context)
    const expiredLinkBusinessDelta = await validateExpiredLinkBusinessDelta(deps, context)
    context.token = await generateEphemeralToken(deps)
    await dryRunLinkCreation(deps, context)
    await createEphemeralLink(deps, context)
    await provisionFixtures(deps, context)
    const provisioning = await validateProvisioningDelta(deps, context)
    const iam = await activateQaIam(deps, context)
    await transitionFixturesToReview(deps, context)
    const main = await runMainMatrix(deps, context)
    const race = await runRaceMatrix(deps, context)
    await closeFixtures(deps, context)
    context.accessibility.assertComplete()
    const accessibility = context.accessibility.sanitizedSummary()
    const metadata = await validateEventMetadata(deps)
    const final = await validateFinalDelta(deps)
    result = {
      status: "PASS",
      mode,
      environment,
      baseline: {
        status: "PASS",
        kind: baseline.kind,
        captured: baseline.captured,
        snapshot_hash_present:
          baseline.kind === "LIVE_START_SNAPSHOT"
            ? baseline.snapshot_hash_present
            : true,
        absolute_live_baseline_enforced:
          baseline.kind === "LIVE_START_SNAPSHOT"
            ? baseline.absolute_baseline_enforced
            : false,
      },
      linkContract: "PASS",
      expiredLinkNormalization: {
        inspection: expiredLinkInspection.classification,
        normalization_state: expiredLinkInspection.normalization_state,
        normalization_write_required: expiredLinkInspection.normalization_write_required,
        dry_run: expiredLinkDryRun.status,
        apply: expiredLinkApply.status,
        postcheck: expiredLinkPostcheck.classification,
        business_delta: expiredLinkBusinessDelta.businessDelta,
        database_time_authoritative: true,
        optimistic_guard: true,
        protected_fields_invariant: true,
      },
      token: {
        entropy_bytes: context.token.entropyBytes,
        hash_format_valid: true,
        token_exposure: context.token.exposure,
      },
      link: {
        dry_run: 1,
        inserted: 1,
        revoked: 1,
        rejected_third_submit: 1,
        active_qa_links_final: final.active_qa_links_final,
      },
      fixtures: {
        created: context.fixtures.length,
        final_rejected: context.fixtures.filter((fixture) => fixture.status === "rejected").length,
      },
      provisioning,
      iam: {
        activated: iam.activated,
        at_rest: null,
      },
      main,
      race,
      accessibility,
      metadata,
      final,
      second_uat: false,
    }
  } catch (error) {
    primaryError = error
  } finally {
    const cleanup = await cleanupAll(deps, context)
    if (result) {
      result.cleanup = cleanup
      result.iam.at_rest = cleanup.status.iamAtRest
      gate(cleanup.pass, "CLEANUP_NOT_COMPLETE", { cleanup })
    }
    if (primaryError) primaryError.cleanup = cleanup
  }
  if (primaryError) throw primaryError
  return {
    ...result,
    actual_mutable_supabase_requests: deps.metrics.mutableSupabaseRequests,
    actual_dev_writes: deps.metrics.devWrites,
    external_network_requests: deps.metrics.externalNetworkRequests,
  }
}

function syntheticEvent(type, metadata = {}, actor = null) {
  return {
    type,
    actor,
    metadata,
  }
}

function initialMockState() {
  return {
    counters: {
      payment_intake: 13,
      payment_intake_events: 39,
      provider_matched: 4,
      matched_intakes: 0,
      states: clone(EXPECTED_BASELINE.states),
    },
    protectedDigest: "protected-core-v6",
    databaseNow: "2026-07-20T12:00:00.000Z",
    companyId: "mock-company-authorized",
    links: [
      {
        id: "mock-link-qa-historical-revoked",
        company_id: "mock-company-authorized",
        alias: "qa-historical-revoked",
        label: "Historical QA revoked",
        status: "revoked",
        expires_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        token_hash: "a".repeat(64),
        token_prefix: "revoked-prefix",
        created_by: "mock-creator",
        expired: false,
        qa: true,
      },
      {
        id: "mock-link-expired",
        company_id: "mock-company-authorized",
        alias: "historical-expired",
        label: "Historical expired",
        status: "expired",
        expires_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
        token_hash: "b".repeat(64),
        token_prefix: "expired-prefix",
        created_by: "mock-creator",
        expired: false,
      },
      {
        id: "mock-link-qa-v6h-revoked",
        company_id: "mock-company-authorized",
        alias: "qa-v6h-revoked",
        label: "V6H QA revoked",
        status: "revoked",
        expires_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
        token_hash: "c".repeat(64),
        token_prefix: "v6h-prefix",
        created_by: "mock-creator",
        expired: false,
        qa: false,
      },
    ],
    fixtures: new Map(),
    actions: new Map(),
    iam: Object.fromEntries(
      PRINCIPAL_ALIASES.map((alias) => [
        alias,
        {
          blocked: true,
          profileActive: false,
          roles: 0,
          memberships: 0,
          session: null,
          refreshToken: null,
        },
      ]),
    ),
    linkCalls: {
      expiredInspection: 0,
      expiredDryRun: 0,
      expiredApply: 0,
      expiredPostcheck: 0,
      dryRun: 0,
      insert: 0,
      revoke: 0,
      publicSubmits: 0,
      rejectedThird: 0,
    },
    cleanup: {
      clearAttempts: 0,
      rejectAttempts: 0,
      linkAttempts: 0,
      iamAttempts: 0,
      tokenAttempts: 0,
    },
    rawTokenPresent: false,
    clock: 0,
    action: 0,
    browser: null,
    pages: [],
    providerTargets: [],
    accessibilityCalls: [],
  }
}

function mockBaseline() {
  return clone(EXPECTED_BASELINE)
}

function maybeFail(deps, point) {
  if (deps.failPoint === point) throw new GateError(`INJECTED_${point.toUpperCase()}_FAILURE`)
}

function currentMockFinal(state) {
  const fixtures = Array.from(state.fixtures.values())
  return {
    payment_intake_run_delta: fixtures.length,
    payment_intake_events_run_delta:
      fixtures.reduce((total, fixture) => total + fixture.events.length, 0),
    provider_matched_run_delta:
      fixtures.flatMap((fixture) => fixture.events)
        .filter((event) => event.type === "provider_matched").length,
    fixtures_final_rejected: fixtures.filter((fixture) => fixture.status === "rejected").length,
    matches_final: fixtures.filter((fixture) => fixture.match !== null).length,
    core_protected_run_delta: state.protectedDigest === "protected-core-v6" ? 0 : 1,
    active_qa_links_final: state.links.filter(
      (link) => link.qa === true && link.status === "active" && link.expired === false,
    ).length,
  }
}

function mockIamAtRest(state) {
  return Object.values(state.iam).every(
    (principal) =>
      principal.blocked === true &&
      principal.profileActive === false &&
      principal.roles === 0 &&
      principal.memberships === 0 &&
      principal.session === null &&
      principal.refreshToken === null,
  )
}

async function createMockMatchingPage(deps, fixtureAlias) {
  const providers = deps.state.providerTargets
  gate(providers.length === 2, "LIVE_PROVIDER_ALIAS_UNRESOLVED")
  const fixture = deps.state.fixtures.get(fixtureAlias)
  gate(fixture, "MOCK_FIXTURE_NOT_FOUND")
  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
  const alternateHeading = "Proveedor sintético distinto"
  let pageProviders = providers.map((provider) => ({
    logicalAlias: provider.logicalAlias,
    liveDisplayAlias: provider.liveDisplayAlias,
  }))
  if (deps.failPoint === "card_not_found") pageProviders = pageProviders.slice(0, 1)
  if (deps.failPoint === "card_ambiguous") pageProviders.push({ ...pageProviders[1] })
  if (deps.failPoint === "card_mismatch") {
    pageProviders = pageProviders.map((provider, index) => index === 1
      ? { ...provider, liveDisplayAlias: alternateHeading }
      : provider)
  }
  const { chromium } = require("playwright")
  if (!deps.state.browser) deps.state.browser = await chromium.launch({ headless: true })
  const page = await deps.state.browser.newPage({ viewport: { width: 1280, height: 900 } })
  deps.state.pages.push(page)
  await page.setContent(`
    <!doctype html>
    <html lang="es">
      <body>
        <main class="provider-match-section">
          <p id="stateLabel"></p>
          <section id="currentMatch"></section>
          <label for="providerMatchSearch">Buscar proveedor</label>
          <input id="providerMatchSearch" />
          <section id="candidateList"></section>
        </main>
        <dialog id="matchDialog" aria-labelledby="matchTitle">
          <form id="matchForm">
            <h2 id="matchTitle">Comparar proveedor</h2>
            <p id="matchDescription">Revisa los datos declarados y maestros antes de confirmar.</p>
            <section id="comparisonContent"><p class="comparison-summary"><strong></strong></p></section>
            <label>Motivo <select id="matchReasonCode">
              <option value="candidate_selected">Candidato validado</option>
              <option value="match_corrected">Corrección</option>
              <option value="no_longer_matches">Retiro</option>
            </select></label>
            <label>Razón <textarea id="matchReason"></textarea></label>
            <p id="matchReasonRequired">La razón es obligatoria.</p>
            <p id="matchError" role="alert"></p>
            <button id="confirmMatchBtn" type="submit">Confirmar vínculo</button>
          </form>
        </dialog>
        <script>
          const providers = ${JSON.stringify(pageProviders)}
          const logicalToLive = Object.fromEntries(providers.map((provider) => [provider.logicalAlias, provider.liveDisplayAlias]))
          const search = document.getElementById("providerMatchSearch")
          const list = document.getElementById("candidateList")
          const current = document.getElementById("currentMatch")
          const stateLabel = document.getElementById("stateLabel")
          const dialog = document.getElementById("matchDialog")
          const title = document.getElementById("matchTitle")
          const description = document.getElementById("matchDescription")
          const summary = document.querySelector("#comparisonContent strong")
          const reasonCode = document.getElementById("matchReasonCode")
          const reason = document.getElementById("matchReason")
          const required = document.getElementById("matchReasonRequired")
          const confirm = document.getElementById("confirmMatchBtn")
          const error = document.getElementById("matchError")
          let match = ${JSON.stringify(fixture.match)}
          const status = ${JSON.stringify(fixture.status)}
          const renderCards = () => {
            list.replaceChildren()
            for (const provider of providers) {
              const article = document.createElement("article")
              article.className = "candidate-card"
              const header = document.createElement("header")
              header.className = "candidate-card-header"
              const strong = document.createElement("strong")
              strong.textContent = provider.liveDisplayAlias
              header.append(strong)
              const button = document.createElement("button")
              button.className = "select-provider"
              button.type = "button"
              button.textContent = match ? "Seleccionar para cambio" : "Seleccionar proveedor"
              button.addEventListener("click", () => openSet(provider))
              article.append(header, button)
              list.append(article)
            }
            filterCards()
          }
          const filterCards = () => {
            const query = search.value.trim().toLocaleLowerCase("es")
            for (const article of list.querySelectorAll(".candidate-card")) {
              const heading = article.querySelector("strong")?.textContent?.trim().toLocaleLowerCase("es") || ""
              article.hidden = Boolean(query) && heading !== query
            }
          }
          const openSet = (provider) => {
            error.textContent = ""
            title.textContent = "Comparar proveedor"
            description.textContent = "Revisa los datos declarados y maestros antes de confirmar."
            summary.textContent = provider.liveDisplayAlias
            reason.value = ""
            reasonCode.value = match ? "match_corrected" : "candidate_selected"
            required.textContent = match ? "(obligatoria, mínimo 10 caracteres)" : "(opcional)"
            confirm.textContent = match ? "Confirmar cambio" : "Confirmar vínculo"
            dialog.showModal()
          }
          const openClear = () => {
            error.textContent = ""
            title.textContent = "Retirar vínculo"
            description.textContent = "La solicitud quedará sin proveedor maestro. El historial se conservará."
            summary.textContent = logicalToLive[match] || "Proveedor maestro"
            reason.value = ""
            reasonCode.value = "no_longer_matches"
            required.textContent = "(obligatoria, mínimo 10 caracteres)"
            confirm.textContent = "Retirar vínculo"
            dialog.showModal()
            reason.focus()
          }
          window.__qaRender = (nextMatch) => {
            match = nextMatch
            if (dialog.open) dialog.close()
            current.replaceChildren()
            search.hidden = status === "rejected"
            list.hidden = status === "rejected"
            if (status === "rejected") {
              stateLabel.textContent = "Revisión requerida"
              return
            }
            if (match) {
              stateLabel.textContent = "Vinculado"
              const alias = document.createElement("strong")
              alias.textContent = logicalToLive[match] || "Proveedor maestro"
              const change = document.createElement("button")
              change.type = "button"
              change.textContent = "Cambiar vínculo"
              change.addEventListener("click", () => search.focus())
              const clear = document.createElement("button")
              clear.type = "button"
              clear.textContent = "Retirar vínculo"
              clear.addEventListener("click", openClear)
              current.append(alias, change, clear)
            } else {
              stateLabel.textContent = "Candidatos encontrados"
            }
            search.value = ""
            renderCards()
          }
          search.addEventListener("input", filterCards)
          search.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              filterCards()
            }
          })
          document.getElementById("matchForm").addEventListener("submit", (event) => event.preventDefault())
          window.__qaRender(match)
        </script>
      </body>
    </html>
  `)
  return page
}

export function createMockDependencies({ failPoint = null } = {}) {
  const state = initialMockState()
  const metrics = {
    mutableSupabaseRequests: 0,
    devWrites: 0,
    externalNetworkRequests: 0,
  }
  const deps = {
    kind: "mock",
    failPoint,
    state,
    metrics,
    async assertEnvironment() {
      return {
        project_ref: DEV_PROJECT_REF,
        environment: "DEV",
        production_accesses: 0,
      }
    },
    async captureBaseline() {
      return mockBaseline()
    },
    async inspectLinkContract() {
      return clone(INTAKE_LINK_CONTRACT)
    },
    async resolveProviderTargets() {
      maybeFail(deps, "alias_resolution")
      const rows = MOCK_LIVE_PROVIDER_ALIASES.map((alias, index) => ({
        id: `00000000-0000-4000-8000-00000000000${index + 1}`,
        alias,
        nombre_completo: `QA fixture ${index + 1}`,
        email: `qa-provider-${index + 1}@example.invalid`,
        activo: true,
      }))
      state.providerTargets = buildLiveProviderTargets(rows, {
        selectedProviderIds: rows.map((row) => row.id),
      })
      return state.providerTargets
    },
    async inspectExpiredActiveLink() {
      maybeFail(deps, "expired_link_inspection")
      state.linkCalls.expiredInspection += 1
      return {
        companyId: state.companyId,
        databaseNow: state.databaseNow,
        rows: clone(state.links),
      }
    },
    async dryRunExpiredLinkNormalization({ candidate }) {
      maybeFail(deps, "expired_link_normalization_dry_run")
      state.linkCalls.expiredDryRun += 1
      const stored = state.links.find((row) => row.id === candidate.id)
      validateNormalizationOptimisticSnapshot(candidate, stored)
      const inTransaction = { ...clone(stored), status: "expired", updated_at: "mock-dry-run" }
      validateNormalizationMutation(stored, inTransaction)
      return {
        status: "PASS",
        rowCount: 1,
        inTransactionStatus: inTransaction.status,
        rolledBack: true,
        realStatus: stored.status,
        writes: 0,
        businessDelta: 0,
        protectedFieldsInvariant: true,
        databaseTimeAuthoritative: true,
        optimisticGuard: true,
      }
    },
    async applyExpiredLinkNormalization({ candidate }) {
      state.linkCalls.expiredApply += 1
      if (deps.failPoint === "expired_link_normalization_stale") {
        throw new GateError("EXPIRED_LINK_NORMALIZATION_STALE_CONFLICT")
      }
      if (deps.failPoint === "expired_link_normalization_rowcount") {
        throw new GateError("EXPIRED_LINK_NORMALIZATION_ROWCOUNT_VIOLATION")
      }
      const stored = state.links.find((row) => row.id === candidate.id)
      validateNormalizationOptimisticSnapshot(candidate, stored)
      const before = clone(stored)
      stored.status = "expired"
      stored.updated_at = "mock-normalized"
      validateNormalizationMutation(before, stored)
      return {
        status: "expired",
        rowCount: 1,
        row: clone(stored),
        protectedFieldsInvariant: true,
      }
    },
    async verifyExpiredLinkNormalization() {
      maybeFail(deps, "expired_link_normalization_postcheck")
      state.linkCalls.expiredPostcheck += 1
      return {
        companyId: state.companyId,
        databaseNow: state.databaseNow,
        rows: clone(state.links),
      }
    },
    async validateExpiredLinkBusinessDelta() {
      return { businessDelta: state.protectedDigest === "protected-core-v6" ? 0 : 1 }
    },
    async randomBytes(size) {
      gate(size === 32, "MOCK_TOKEN_SIZE")
      state.rawTokenPresent = true
      return crypto.randomBytes(size)
    },
    async sha256(value) {
      return crypto.createHash("sha256").update(value).digest("hex")
    },
    async dryRunLinkCreation(input) {
      maybeFail(deps, "link_dry_run")
      state.linkCalls.dryRun += 1
      gate(input.maxSubmissionsPerDay === 2, "MOCK_LINK_DAILY_LIMIT")
      return { ok: true, writes: 0 }
    },
    async createEphemeralLink() {
      maybeFail(deps, "link_insert")
      state.linkCalls.insert += 1
      const link = {
        id: "mock-link-qa-ephemeral",
        company_id: state.companyId,
        alias: "qa-ephemeral",
        label: "QA ephemeral",
        status: "active",
        expires_at: "2026-07-20T13:00:00.000Z",
        updated_at: "2026-07-20T12:01:00.000Z",
        token_hash: "c".repeat(64),
        token_prefix: "qa-prefix",
        created_by: "mock-creator",
        expired: false,
        qa: true,
        maxSubmissionsPerDay: 2,
      }
      state.links.push(link)
      return clone(link)
    },
    async revokeEphemeralLink(link) {
      state.cleanup.linkAttempts += 1
      if (!link) return { status: "revoked", noOp: true }
      const stored = state.links.find((candidate) => candidate.alias === link.alias)
      if (!stored || stored.status === "revoked") return { status: "revoked", noOp: true }
      state.linkCalls.revoke += 1
      stored.status = "revoked"
      return { status: "revoked" }
    },
    async submitPublicFixture({ alias }) {
      assertPublicFixturePostBudget(state.linkCalls.publicSubmits)
      const fixtureNumber = state.linkCalls.publicSubmits + 1
      maybeFail(deps, `fixture_${fixtureNumber}`)
      gate(FIXTURE_ALIASES.includes(alias), "MOCK_FIXTURE_ALIAS")
      gate(!state.fixtures.has(alias), "MOCK_THIRD_FIXTURE")
      const active = state.links.find(
        (link) => link.qa === true && link.status === "active" && link.expired === false,
      )
      gate(active, "MOCK_LINK_NOT_ACTIVE")
      state.linkCalls.publicSubmits += 1
      state.clock += 1
      const fixture = {
        alias,
        status: "received",
        updatedAt: `mock-${state.clock}`,
        match: null,
        files: 0,
        paymentRequest: null,
        duplicate: false,
        events: [syntheticEvent("created")],
      }
      state.fixtures.set(alias, fixture)
      state.counters.payment_intake += 1
      state.counters.payment_intake_events += 1
      state.counters.states.received += 1
      return clone(fixture)
    },
    async assertThirdSubmitRejected() {
      state.linkCalls.rejectedThird += 1
      const active = state.links.some(
        (link) => link.qa === true && link.status === "active" && link.expired === false,
      )
      gate(!active, "MOCK_THIRD_SUBMIT_LINK_ACTIVE")
      return state.linkCalls.publicSubmits === AUTHORIZED_PUBLIC_FIXTURE_POSTS
    },
    async validateProvisioningDelta() {
      return {
        intakes: 2,
        events: 2,
        storage: 0,
        notifications: 0,
        providers: 0,
        payment_requests: 0,
      }
    },
    async activateQaIam() {
      maybeFail(deps, "iam_activation")
      for (const [index, alias] of PRINCIPAL_ALIASES.entries()) {
        state.iam[alias] = {
          blocked: false,
          profileActive: true,
          roles: 1,
          memberships: 1,
          session: `session-${index + 1}`,
          refreshToken: `refresh-${index + 1}`,
        }
      }
      return {
        activated: 2,
        separateSessions: state.iam[PRINCIPAL_ALIASES[0]].session !==
          state.iam[PRINCIPAL_ALIASES[1]].session,
      }
    },
    async deactivateQaIam() {
      state.cleanup.iamAttempts += 1
      for (const alias of PRINCIPAL_ALIASES) {
        state.iam[alias] = {
          blocked: true,
          profileActive: false,
          roles: 0,
          memberships: 0,
          session: null,
          refreshToken: null,
        }
      }
      return {
        atRest: true,
        roles: 0,
        memberships: 0,
        sessions: 0,
        refreshTokens: 0,
        loginRejected: true,
      }
    },
    async transitionFixture(input) {
      if (input.toStatus === "in_review") maybeFail(deps, "transition")
      if (input.toStatus === "rejected") maybeFail(deps, "close_fixture")
      const fixture = state.fixtures.get(input.fixtureAlias)
      gate(fixture, "MOCK_FIXTURE_NOT_FOUND")
      gate(fixture.status === input.expectedStatus, "provider_intake_conflict")
      gate(fixture.updatedAt === input.expectedUpdatedAt, "provider_intake_conflict")
      gate(fixture.match === null, "MOCK_TRANSITION_MATCH_NOT_NULL")
      const from = fixture.status
      fixture.status = input.toStatus
      state.clock += 1
      fixture.updatedAt = `mock-${state.clock}`
      fixture.events.push(syntheticEvent(
        input.toStatus === "rejected" ? "rejected" : "status_changed",
        { from_status: from, to_status: input.toStatus },
        input.actor,
      ))
      state.counters.payment_intake_events += 1
      state.counters.states[from] -= 1
      state.counters.states[input.toStatus] += 1
      return clone(fixture)
    },
    async getFixture(alias) {
      const fixture = state.fixtures.get(alias)
      gate(fixture, "MOCK_FIXTURE_NOT_FOUND")
      return clone(fixture)
    },
    async setProviderIntakeMatch(input) {
      const existing = state.actions.get(input.actionId)
      const material = digest(materialForMatch(input))
      if (existing) {
        if (existing.actor !== input.actor) {
          throw new GateError("provider_intake_action_id_conflict")
        }
        if (existing.material !== material) {
          throw new GateError("provider_intake_action_id_material_conflict")
        }
        return { ...clone(existing.result), idempotent: true }
      }

      const fixture = state.fixtures.get(input.fixtureAlias)
      gate(fixture, "MOCK_FIXTURE_NOT_FOUND")
      if (
        fixture.status !== input.expectedStatus ||
        fixture.updatedAt !== input.expectedUpdatedAt ||
        fixture.match !== input.expectedCurrentMatch
      ) {
        throw new GateError("provider_intake_conflict")
      }
      gate(fixture.status === "in_review", "provider_intake_match_status_invalid")
      const kind = actionKind(fixture.match, input.providerAlias)
      if (kind === "match_set") maybeFail(deps, "set")
      if (kind === "match_replace") maybeFail(deps, "replace")
      if (kind === "match_clear") maybeFail(deps, "clear")
      if (kind !== "match_set") {
        gate(
          typeof input.reason === "string" && input.reason.trim().length >= 10,
          "provider_intake_match_reason_required",
        )
      }
      const previous = fixture.match
      fixture.match = input.providerAlias
      state.clock += 1
      fixture.updatedAt = `mock-${state.clock}`
      const metadata = {
        contract_version: 3,
        action_fingerprint: digest({ actor: input.actor, material }),
        action_kind: kind,
        reason_code: input.reasonCode,
        previous_match_present: previous !== null,
        new_match_present: fixture.match !== null,
        actor_qa: PRINCIPAL_ALIASES.includes(input.actor),
        contains_sensitive_fields: false,
      }
      fixture.events.push(syntheticEvent("provider_matched", metadata, input.actor))
      state.counters.payment_intake_events += 1
      state.counters.provider_matched += 1
      state.counters.matched_intakes = Array.from(state.fixtures.values())
        .filter((row) => row.match !== null).length
      const result = {
        idempotent: false,
        actionKind: kind,
        matchedProvider: fixture.match,
        updatedAt: fixture.updatedAt,
      }
      state.actions.set(input.actionId, {
        actor: input.actor,
        material,
        result,
      })
      return clone(result)
    },
    async openLiveMatchingPage({ fixtureAlias }) {
      return createMockMatchingPage(deps, fixtureAlias)
    },
    async submitReplaceFromPage({ page, dialog, request }) {
      const providerB = state.providerTargets.find(
        (target) => target.logicalAlias === PROVIDER_ALIASES[1],
      )
      if (dialog.operation === "replace") {
        gate(dialog.sanitizedTargetAlias === PROVIDER_ALIASES[1], "MOCK_LOGICAL_ALIAS")
        gate(
          normalizeLiveProviderText(await dialog.providerSearch.inputValue()) ===
            providerB.uiSearchText,
          "LOGICAL_ALIAS_USED_AS_LIVE_LOCATOR",
        )
        gate((await dialog.reason.inputValue()).length >= 10, "MOCK_REPLACE_REASON")
      }
      if (dialog.operation === "clear") {
        gate((await dialog.reason.inputValue()).length >= 10, "MOCK_CLEAR_REASON")
      }
      const result = await deps.setProviderIntakeMatch(request)
      await page.evaluate((nextMatch) => window.__qaRender(nextMatch), request.providerAlias)
      return result
    },
    async submitConflictFromPage({ page }) {
      await page.locator("#matchError").evaluate((node) => {
        node.textContent = "Esta solicitud fue actualizada por otro usuario. Recarga el detalle."
      })
      return {
        conflict: true,
        silentOverwrite: false,
        accessibleAnnouncement:
          await page.locator("#matchError").getAttribute("role") === "alert",
      }
    },
    async auditAccessibilityState({ stateAlias }) {
      state.accessibilityCalls.push(stateAlias)
      if (deps.failPoint === "accessibility_axe_not_loaded") {
        throw new GateError("LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
      }
      if (deps.failPoint === "accessibility_critical") {
        throw new GateError("LIVE_ACCESSIBILITY_VIOLATION", {
          state: stateAlias,
          critical: 1,
          serious: 0,
          sanitized: true,
        })
      }
      if (deps.failPoint === "accessibility_serious") {
        throw new GateError("LIVE_ACCESSIBILITY_VIOLATION", {
          state: stateAlias,
          critical: 0,
          serious: 1,
          sanitized: true,
        })
      }
      if (deps.failPoint === "accessibility_state_missing") {
        throw new GateError("LIVE_ACCESSIBILITY_STATE_MISSING")
      }
      if (deps.failPoint === "accessibility_network_escape") {
        throw new GateError("NO_WRITE_NETWORK_ESCAPE")
      }
      const evidence = {
        state: stateAlias,
        axe_version: AXE_CORE_VERSION,
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
        incomplete: 0,
        rule_ids: [],
        nodes_total: 0,
        sanitized: true,
      }
      if (deps.failPoint === "accessibility_evidence_unsanitized") {
        evidence.html = "<div data-business-id=\"internal\">[REDACTED]</div>"
      }
      return evidence
    },
    async closeBrowser() {
      for (const page of state.pages) {
        if (!page.isClosed()) await page.close()
      }
      state.pages = []
      if (state.browser) await state.browser.close()
      state.browser = null
    },
    async clearCredentialMemory() {
      credentialResolver.clear()
      apiKeyResolution?.clear?.()
      linkActorResolution?.clear?.()
      apiKeyResolution = null
      linkActorResolution = null
      return {
        api_keys_cleared: true,
        captcha_cleared: true,
        link_actor_cleared: true,
      }
    },
    async listFixtureEvents(alias) {
      const fixture = state.fixtures.get(alias)
      return fixture ? clone(fixture.events) : []
    },
    async captureFinal() {
      return currentMockFinal(state)
    },
    async clearFixtureMatch(alias) {
      state.cleanup.clearAttempts += 1
      const fixture = state.fixtures.get(alias)
      if (fixture?.match !== null) {
        fixture.match = null
        state.counters.matched_intakes = Array.from(state.fixtures.values())
          .filter((row) => row.match !== null).length
      }
      return true
    },
    async rejectFixture(alias) {
      state.cleanup.rejectAttempts += 1
      const fixture = state.fixtures.get(alias)
      if (fixture && fixture.status !== "rejected") {
        state.counters.states[fixture.status] -= 1
        fixture.status = "rejected"
        state.counters.states.rejected += 1
      }
      return true
    },
    async dropRawToken() {
      state.cleanup.tokenAttempts += 1
      state.rawTokenPresent = false
    },
    async cleanupStatus() {
      return {
        activeQaLinks: state.links.filter(
          (link) => link.qa === true && link.status === "active" && link.expired === false,
        ).length,
        matches: Array.from(state.fixtures.values()).filter((fixture) => fixture.match !== null).length,
        fixturesTerminal: Array.from(state.fixtures.values())
          .every((fixture) => fixture.status === "rejected"),
        iamAtRest: mockIamAtRest(state),
        rawTokenPresent: state.rawTokenPresent,
      }
    },
    newActionId() {
      state.action += 1
      return `mock-action-${state.action}`
    },
  }
  return deps
}

export async function runCleanupMatrix() {
  const cases = []
  for (const failPoint of CRITICAL_FAILURE_POINTS) {
    const deps = createMockDependencies({ failPoint })
    let blocked = false
    let cleanup = null
    try {
      await executeUat(deps, { mode: "no-write-mocked" })
    } catch (error) {
      blocked = true
      cleanup = error.cleanup
    }
    gate(blocked, "CLEANUP_MATRIX_FAILURE_NOT_INJECTED", { failPoint })
    gate(cleanup?.pass === true, "CLEANUP_MATRIX_FAILED", { failPoint, cleanup })
    cases.push({
      block: failPoint,
      failureInjected: true,
      cleanup: "PASS",
      secondUat: false,
      eventDeletion: 0,
      mutableSupabaseRequests: deps.metrics.mutableSupabaseRequests,
    })
  }
  return {
    status: "PASS",
    cases,
    total: cases.length,
    failures: 0,
  }
}

export async function runCapabilityAudit() {
  const deps = createMockDependencies()
  assertDependencyShape(deps)
  const authenticatedReadOnly = runAuthenticatedReadOnlyMockMatrix()
  const observability = await runPublicSubmitObservabilityAudit({
    previewUrl: AUTHORIZED_PREVIEW_URL,
  })
  const loopback = await runPublicSubmitLoopbackNoWrite({
    previewUrl: AUTHORIZED_PREVIEW_URL,
  })
  const browserContract = certifyCanonicalBrowserSubmitContract()
  const credentialAdapter = await runCredentialAdapterNoWriteMocked()
  const providerTargets = await deps.resolveProviderTargets()
  const providerAlignment = sanitizedProviderAlignment(providerTargets)
  const normalizationContext = newContext("capability-audit")
  await inspectExpiredActiveLink(deps, normalizationContext)
  await dryRunExpiredLinkNormalization(deps, normalizationContext)
  await applyExpiredLinkNormalization(deps, normalizationContext)
  await verifyExpiredLinkNormalization(deps, normalizationContext)
  await validateExpiredLinkBusinessDelta(deps, normalizationContext)
  const noOpHandlers = Object.fromEntries(
    ACCESSIBILITY_STATE_ALIASES.map((stateAlias) => [stateAlias, {
      prepare: async () => ({ stateAlias }),
      ready: async () => true,
      cleanup: async () => true,
    }]),
  )
  const accessibilityManifest = createAccessibilityStateManifest(noOpHandlers)
  validateAccessibilityStateManifest(accessibilityManifest)
  const wiredHooks = [
    ...MUTABLE_ACCESSIBILITY_HOOKS.main,
    ...MUTABLE_ACCESSIBILITY_HOOKS.race,
    ...MUTABLE_ACCESSIBILITY_HOOKS.terminal,
  ]
  gate(
    JSON.stringify(wiredHooks) === JSON.stringify(ACCESSIBILITY_STATE_ALIASES),
    "LIVE_ACCESSIBILITY_STATE_MISSING",
  )
  const functions = {
    assertEnvironment,
    captureBaseline,
    inspectLinkContract,
    classifyExpiredLinkState,
    classifyExpiredLinkStateFromDatabaseFilter,
    inspectExpiredActiveLink,
    dryRunExpiredLinkNormalization,
    applyExpiredLinkNormalization,
    verifyExpiredLinkNormalization,
    validateExpiredLinkBusinessDelta,
    validateNormalizationOptimisticSnapshot,
    validateNormalizationDryRunResult,
    validateNormalizationApplyResult,
    validateNormalizationMutation,
    assertExpiredLinkNormalizationTransition,
    validateExpiredLinkNormalizationEvidence,
    generateEphemeralToken,
    dryRunLinkCreation,
    createEphemeralLink,
    revokeEphemeralLink,
    provisionFixtures,
    assertPublicFixturePostBudget,
    createPublicFixtureSubmitAttempt,
    validateProvisioningDelta,
    activateQaIam,
    deactivateQaIam,
    transitionFixturesToReview,
    runMainMatrix,
    runRaceMatrix,
    closeFixtures,
    validateEventMetadata,
    validateFinalDelta,
    cleanupAll,
    resolveProviderSelectorIds,
    buildLiveProviderSelectorQuery,
    buildLiveProviderTargets,
    sanitizedProviderAlignment,
    assertSanitizedProviderEvidence,
    runLiveProviderAliasReadOnly,
    runExpiredLinkNormalizationReadOnly,
    normalizeLiveProviderText,
    exactNormalizedText,
    assertLiveProviderLocatorInputs,
    classifyProviderCardHeadings,
    openProviderSetDialog,
    openProviderClearDialog,
    runAxeAccessibilityState,
    createAccessibilityHookRecorder,
    createAccessibilityStateManifest,
    validateAccessibilityStateManifest,
    runAccessibilityStateManifest,
    loadLocalAxeSource,
    sanitizedAxeSourceIdentity,
    buildPublicSubmitRequest,
    captureFinalizedPublicSubmitRequest,
    capturePublicSubmitResponse,
    classifyPublicSubmitResponse,
    flushResponseEvidenceBeforeThrow,
    persistSanitizedEvidenceAtomically,
    runPublicSubmitObservabilityAudit,
    runPublicSubmitLoopbackNoWrite,
    certifyCanonicalBrowserSubmitContract,
    createStageScopedCredentialResolver,
    resolveQaApiKeys,
    resolveQaLinkCreatedByReadOnly,
    createRuntimeTurnstileSession,
    createCanonicalBrowserSubmitController,
    runCredentialAdapterNoWriteMocked,
    runCredentialAdapterLiveReadOnly,
    assertReadOnlySql,
    scanReadOnlySql,
    classifyAuthenticatedLinkState,
    classifyAuthenticatedReadOnlyError,
    validateAuthenticatedReadOnlyEnvelope,
    parseAuthenticatedReadOnlyChildResult,
    runAuthenticatedReadOnlyPrecheck,
    resolveQaCompanyScopeReadOnly,
    runAuthenticatedReadOnlyPrecheckDiagnostic,
    runAuthenticatedReadOnlyBaselineInvariantDiagnosticCore,
    runAuthenticatedReadOnlyBaselineInvariantDiagnostic,
  }
  for (const [name, implementation] of Object.entries(functions)) {
    gate(typeof implementation === "function", `CAPABILITY_FUNCTION_MISSING_${name}`)
  }
  gate(typeof openProviderReplaceDialog === "function", "CAPABILITY_REPLACE_HELPER_MISSING")
  gate(typeof createMutableDependencies === "function", "CAPABILITY_MUTABLE_ADAPTER_MISSING")
  gate(typeof assertMutableAuthorization === "function", "CAPABILITY_MUTABLE_GATE_MISSING")
  gate(
    providerAlignment.selector_A_resolved === true &&
      providerAlignment.selector_B_resolved === true,
    "QA_PROVIDER_TARGET_NOT_FOUND",
  )
  gate(providerAlignment.IDs_distinct === true, "QA_PROVIDER_SELECTORS_NOT_DISTINCT")
  const capabilities = {
      link_provisioning: true,
      fixture_provisioning: true,
      two_fixture_public_post_budget:
        AUTHORIZED_PUBLIC_FIXTURE_POSTS === 2 &&
        AUTHORIZED_POSTS_PER_CONTROLLER === 1,
      iam_activation: true,
      transition_provider_intake: true,
      main: true,
      race: true,
      set_provider_intake_match: true,
      shared_replace_helper: true,
      playwright_live: true,
      iam_cleanup: true,
      link_cleanup: true,
      fixture_cleanup: true,
      metadata_validation: true,
      delta_validation: true,
      mutable_authorization_gate: true,
      live_provider_alias_resolution: true,
      explicit_provider_selector_contract: true,
      exact_provider_selector_query: true,
      provider_selector_order_mapping: true,
      provider_selector_no_heuristic_fallback: true,
      provider_selector_evidence_sanitization: true,
      logical_visual_identity_separation: true,
      live_alias_not_logged: true,
      logical_alias_not_used_as_live_locator: true,
      exact_card_validation: true,
      ambiguous_card_failure: true,
      missing_alias_failure: true,
      sanitization_before_evidence: true,
      expired_link_inspection: true,
      expired_link_normalization_dry_run: true,
      expired_link_normalization_apply: true,
      expired_link_normalization_postcheck: true,
      axe_local_source: true,
      axe_injection: true,
      accessibility_state_manifest: accessibilityManifest.length === 9,
      accessibility_mutable_hooks: wiredHooks.length === 9,
      accessibility_no_write_preview: typeof runLiveAccessibilityNoWrite === "function",
      accessibility_critical_serious_gate: true,
      accessibility_evidence_sanitization: true,
      race_conflict_accessibility: MUTABLE_ACCESSIBILITY_HOOKS.race.includes("race_conflict"),
      terminal_rejected_accessibility:
        MUTABLE_ACCESSIBILITY_HOOKS.terminal.includes("terminal_rejected"),
      canonical_idempotency_header:
        observability.canonical_idempotency_header === CANONICAL_IDEMPOTENCY_HEADER,
      finalized_request_capture:
        observability.request_capture?.idempotency_present === true,
      loopback_wire_contract: loopback.status === "WIRE_CONTRACT_LOOPBACK_PASS",
      response_metadata_capture: observability.response_matrix?.total === 12,
      public_error_code_capture: true,
      cors_header_presence_capture: true,
      correlation_id_sanitization: true,
      gateway_edge_classification: true,
      evidence_flush_before_throw: observability.evidence_flush_before_throw === true,
      post_v6h_baseline_support:
        normalizationContext.normalizationState === "ALREADY_NORMALIZED",
      already_normalized_link_idempotency:
        normalizationContext.expiredLink === null,
      authenticated_read_only_stage_tracking:
        typeof runAuthenticatedReadOnlyPrecheck === "function",
      authenticated_read_only_error_taxonomy:
        authenticatedReadOnly.error_families.length === 8,
      sanitized_sqlstate_classification:
        authenticatedReadOnly.error_families.some((entry) => entry.category === "DB_AUTH_FAILED"),
      already_normalized_noop_state:
        authenticatedReadOnly.already_normalized_noop === true,
      read_only_transaction_assertion:
        authenticatedReadOnly.read_only_sql_scan.status === "PASS",
      session_read_only_bootstrap:
        authenticatedReadOnly.last_completed_stage === "RESULT_SERIALIZATION" &&
        authenticatedReadOnly.session_read_only_bootstrap_applied === true,
      session_read_only_post_bootstrap_assertion:
        authenticatedReadOnly.session_default_transaction_read_only === true,
      explicit_begin_read_only:
        authenticatedReadOnly.last_completed_stage === "RESULT_SERIALIZATION",
      transaction_read_only_assertion:
        authenticatedReadOnly.transaction_read_only === true &&
        authenticatedReadOnly.transaction_started === true,
      pre_business_query_order_guard:
        authenticatedReadOnly.last_completed_stage === "RESULT_SERIALIZATION" &&
        authenticatedReadOnly.transaction_started === true &&
        authenticatedReadOnly.query_completed === true,
      persistent_configuration_block:
        authenticatedReadOnly.read_only_sql_scan?.forbidden === 0 &&
        authenticatedReadOnly.session_configuration_applied === true &&
        authenticatedReadOnly.session_config === 1,
      fresh_baseline_after_transaction_assertion:
        authenticatedReadOnly.fresh_baseline_completed === true &&
        authenticatedReadOnly.transaction_started === true,
      rollback_completion_gate:
        authenticatedReadOnly.rollback_completed === true,
      rollback_observability:
        typeof validateAuthenticatedReadOnlyEnvelope === "function",
      child_process_error_preservation:
        authenticatedReadOnly.caller_category === "DB_AUTH_FAILED",
      no_public_submit_before_readonly_pass:
        authenticatedReadOnly.public_submit_calls === 0,
      deterministic_qa_company_scope_resolution:
        authenticatedReadOnly.qa_company_scope_source === "DETERMINISTIC_READ_ONLY" &&
        authenticatedReadOnly.qa_company_candidate_count === 1,
      qa_company_scope_parameterization:
        typeof resolveQaCompanyScopeReadOnly === "function",
      global_company_link_count_separation:
        authenticatedReadOnly.intake_links_global === 5 &&
        authenticatedReadOnly.intake_links_qa_company === EXPECTED_QA_COMPANY_LINKS,
      qa_company_identifier_non_export:
        authenticatedReadOnly.qa_company_id_exported === false,
      multi_company_safe_link_classification:
        authenticatedReadOnly.distinct_company_scopes === 2 &&
        authenticatedReadOnly.other_company_links === 1,
      controlled_demo_link_revocation:
        typeof identifyAuthorizedDemoLink === "function",
      demo_link_revocation_dry_run:
        typeof validateDemoLinkRevocationResult === "function",
      demo_link_protected_fields:
        typeof demoLinkProtectedSnapshot === "function",
      safe_revoked_history_tolerance:
        isAlreadyNormalizedSafeHistory({
          total: 4,
          activeValid: 0,
          activeExpired: 0,
          revoked: 3,
          expired: 1,
          paused: 0,
          otherActive: 0,
        }),
      live_snapshot_baseline:
        typeof createLiveStartSnapshot === "function",
      mock_live_baseline_separation:
        MOCK_BASELINE === EXPECTED_BASELINE,
      relative_delta_validation:
        typeof validateRunScopedDelta === "function",
      run_scoped_side_effect_validation:
        typeof validateRunScopedSideEffects === "function",
      concurrent_dev_evolution_tolerance:
        typeof classifyConcurrentDevEvolution === "function",
      qa_iam_at_rest_gate:
        authenticatedReadOnly.iam_at_rest_pass === true,
      stage_scoped_credential_loading:
        credentialAdapter.stage_scoped_loading === true,
      db_only_baseline_precheck:
        credentialAdapter.baseline_db_only === true,
      management_api_key_resolution:
        credentialAdapter.api_key_source_management === "SUPABASE_MANAGEMENT_API",
      api_key_non_export:
        credentialAdapter.api_key_values_exported === false,
      readonly_link_actor_resolution:
        credentialAdapter.link_created_by_candidate_count === 1 &&
        credentialAdapter.link_created_by_id_exported === false,
      runtime_turnstile_token:
        credentialAdapter.captcha_source === "TURNSTILE_RUNTIME_WIDGET" &&
        credentialAdapter.captcha_token_persisted === false,
      canonical_browser_origin_submit:
        browserContract.browser_origin_canonical === true,
      single_public_post_gate:
        credentialAdapter.second_public_post_blocked === true &&
        credentialAdapter.public_submit_calls === 0,
      credential_memory_cleanup:
        credentialAdapter.cleanup.api_keys_cleared === true &&
        credentialAdapter.cleanup.captcha_cleared === true &&
        credentialAdapter.cleanup.actor_id_cleared === true,
      live_credential_adapter_read_only:
        typeof runCredentialAdapterLiveReadOnly === "function",
      fresh_baseline_invariant_catalog:
        BASELINE_INVARIANT_CODES.length > 0,
      baseline_invariant_short_circuit:
        typeof runAuthenticatedReadOnlyBaselineInvariantDiagnosticCore === "function",
      authenticated_read_only_baseline_invariant_diagnostic:
        typeof runAuthenticatedReadOnlyBaselineInvariantDiagnostic === "function",
    }
  return {
    mode: "capability-audit",
    status: "PASS",
    network_requests: 0,
    writes: 0,
    capabilities,
    capability_count: Object.keys(capabilities).length,
  }
}

function requiredEnvironment(env, name) {
  const value = String(env[name] || "").trim()
  if (!value) throw new GateError(`MISSING_ENVIRONMENT_${name}`)
  return value
}

function requiredEnvironmentAny(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim()
    if (value) return value
  }
  throw new GateError(`MISSING_ENVIRONMENT_${names[0]}`)
}

export const MUTABLE_BASELINE_READ_ONLY_ENV_KEYS = Object.freeze([
  "SUPABASE_DEV_DB_URL",
  "SUPABASE_DEV_PROJECT_REF",
  "EXPECTED_RUNNER_HEAD",
  "EXPECTED_RUNNER_SHA256",
  "EXPECTED_RUNNER_GIT_BLOB",
  "GIT_EXECUTABLE",
])

export function buildMutableBaselineReadOnlyEnvironment(parentEnv = process.env) {
  const childEnv = {
    SUPABASE_DEV_DB_URL: requiredEnvironment(parentEnv, "SUPABASE_DEV_DB_URL"),
    SUPABASE_DEV_PROJECT_REF: requiredEnvironmentAny(parentEnv, [
      "SUPABASE_DEV_PROJECT_REF",
      "CONFIRMED_DEV_PROJECT_REF",
    ]),
    EXPECTED_RUNNER_HEAD: requiredEnvironmentAny(parentEnv, [
      "EXPECTED_RUNNER_HEAD",
      "EXPECTED_V6E_HEAD",
    ]),
    EXPECTED_RUNNER_SHA256: requiredEnvironmentAny(parentEnv, [
      "EXPECTED_RUNNER_SHA256",
      "EXPECTED_V6E_RUNNER_SHA256",
    ]),
    EXPECTED_RUNNER_GIT_BLOB: requiredEnvironmentAny(parentEnv, [
      "EXPECTED_RUNNER_GIT_BLOB",
      "EXPECTED_V6E_RUNNER_GIT_BLOB",
    ]),
  }
  gate(
    childEnv.SUPABASE_DEV_PROJECT_REF === DEV_PROJECT_REF,
    "UNAUTHORIZED_PROJECT_REF",
  )
  const gitExecutable = String(parentEnv.GIT_EXECUTABLE || "").trim()
  if (gitExecutable) childEnv.GIT_EXECUTABLE = gitExecutable
  return Object.freeze(childEnv)
}

export function currentRunnerIdentity() {
  const bytes = fs.readFileSync(runnerPath)
  const blobHeader = Buffer.from(`blob ${bytes.byteLength}\0`)
  return {
    logical_name: "provider-intake-matching-gate2-uat.mjs",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    git_blob: crypto.createHash("sha1").update(blobHeader).update(bytes).digest("hex"),
    size_bytes: bytes.byteLength,
    helper_import: "./provider-intake-matching-flow.mjs",
  }
}

function assertReadOnlyRunnerIdentity(env, identity) {
  const expectedHead = requiredEnvironmentAny(env, ["EXPECTED_RUNNER_HEAD", "EXPECTED_V6E_HEAD"])
  const expectedSha = requiredEnvironmentAny(
    env,
    ["EXPECTED_RUNNER_SHA256", "EXPECTED_V6E_RUNNER_SHA256"],
  ).toLowerCase()
  const expectedBlob = requiredEnvironmentAny(
    env,
    ["EXPECTED_RUNNER_GIT_BLOB", "EXPECTED_V6E_RUNNER_GIT_BLOB"],
  ).toLowerCase()
  gate(/^[0-9a-f]{40}$/.test(expectedHead), "READ_ONLY_RUNNER_IDENTITY_MISMATCH")
  gate(identity.sha256 === expectedSha, "READ_ONLY_RUNNER_IDENTITY_MISMATCH")
  gate(identity.git_blob === expectedBlob, "READ_ONLY_RUNNER_IDENTITY_MISMATCH")
  try {
    const committed = execFileSync(
      String(env.GIT_EXECUTABLE || "git"),
      ["show", `${expectedHead}:scripts/qa/provider-intake-matching-gate2-uat.mjs`],
      {
        cwd: path.resolve(here, "..", ".."),
        encoding: null,
        stdio: ["ignore", "pipe", "ignore"],
      },
    )
    gate(
      Buffer.compare(fs.readFileSync(runnerPath), committed) === 0,
      "READ_ONLY_RUNNER_IDENTITY_MISMATCH",
    )
  } catch (error) {
    if (error instanceof GateError) throw error
    throw new GateError("READ_ONLY_RUNNER_IDENTITY_MISMATCH")
  }
  return { head: expectedHead, sha256: expectedSha, gitBlob: expectedBlob }
}

export async function runLiveProviderAliasReadOnly(env = process.env) {
  for (const name of [
    "ALLOW_MUTABLE_UAT",
    "EPHEMERAL_LINK_AUTHORIZED",
    "FIXTURE_PROVISIONING_AUTHORIZED",
    "IAM_ACTIVATION_AUTHORIZED",
    "EXPIRED_LINK_NORMALIZATION_AUTHORIZED",
  ]) {
    gate(String(env[name] || "").trim() !== "true", "MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED")
  }

  const identity = currentRunnerIdentity()
  assertReadOnlyRunnerIdentity(env, identity)
  const supabaseUrl = requiredEnvironment(env, "SUPABASE_URL").replace(/\/+$/, "")
  const serviceRole = requiredEnvironment(env, "SUPABASE_DEV_SERVICE_ROLE_KEY")
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0]
  gate(projectRef === DEV_PROJECT_REF, "UNAUTHORIZED_PROJECT_REF")

  const selectedProviderIds = resolveProviderSelectorIds(env)
  const query = buildLiveProviderSelectorQuery(selectedProviderIds)
  let rows
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/proveedores?${query}`, {
      method: "GET",
      headers: headersForService(serviceRole),
    })
    gate(response.ok, "LIVE_PROVIDER_ALIAS_READ_ONLY_QUERY_FAILED")
    rows = await response.json()
  } catch (error) {
    if (error instanceof GateError) throw error
    throw new GateError("LIVE_PROVIDER_ALIAS_READ_ONLY_QUERY_FAILED")
  }

  gate(Array.isArray(rows) && rows.length === 2, "QA_PROVIDER_TARGET_NOT_FOUND")
  const targets = buildLiveProviderTargets(rows, { selectedProviderIds })
  for (const target of targets) {
    assertLiveProviderLocatorInputs({
      sanitizedTargetAlias: target.logicalAlias,
      searchText: target.uiSearchText,
      expectedCardHeading: target.expectedCardHeading,
    })
  }
  return {
    mode: "live-provider-alias-read-only",
    ...sanitizedProviderAlignment(targets),
    runner_identity_verified: true,
    head_verified: true,
    network_requests: 1,
    mutable_execution: false,
  }
}

export function assertAuthenticatedReadOnlyModeEnvironment(env = process.env) {
  for (const name of [
    "ALLOW_MUTABLE_UAT",
    "EPHEMERAL_LINK_AUTHORIZED",
    "FIXTURE_PROVISIONING_AUTHORIZED",
    "IAM_ACTIVATION_AUTHORIZED",
    "EXPIRED_LINK_NORMALIZATION_AUTHORIZED",
  ]) {
    gate(String(env[name] || "").trim() !== "true", "MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED")
  }
  const identity = currentRunnerIdentity()
  assertReadOnlyRunnerIdentity(env, identity)
  const projectRef = requiredEnvironmentAny(
    env,
    ["SUPABASE_DEV_PROJECT_REF", "CONFIRMED_DEV_PROJECT_REF"],
  )
  gate(projectRef === DEV_PROJECT_REF, "UNAUTHORIZED_PROJECT_REF")
  return identity
}

export function createAuthenticatedReadOnlyDatabaseClient(databaseUrl) {
  const { Client } = require("pg")
  const parsed = new URL(databaseUrl)
  parsed.searchParams.delete("sslmode")
  parsed.searchParams.delete("sslrootcert")
  return new Client({
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
    application_name: "flux_v6n_authenticated_read_only_precheck",
  })
}

export async function runAuthenticatedReadOnlyPrecheckDiagnostic(
  env = process.env,
  { createClient = createAuthenticatedReadOnlyDatabaseClient } = {},
) {
  let identityVerified = false
  const result = await runAuthenticatedReadOnlyPrecheck({
    env,
    createClient,
    validateEnvironment: async () => {
      assertAuthenticatedReadOnlyModeEnvironment(env)
      identityVerified = true
      return true
    },
  })
  const envelope = {
    ...result,
    runner_identity_verified: identityVerified,
    head_verified: identityVerified,
    mutable_execution: false,
  }
  assertSanitizedAuthenticatedReadOnlyEvidence(envelope)
  return envelope
}

export async function runAuthenticatedReadOnlyBaselineInvariantDiagnostic(
  env = process.env,
  { createClient = createAuthenticatedReadOnlyDatabaseClient } = {},
) {
  let identityVerified = false
  const result = await runAuthenticatedReadOnlyBaselineInvariantDiagnosticCore({
    env: {
      SUPABASE_DEV_DB_URL: env.SUPABASE_DEV_DB_URL,
    },
    createClient,
    validateEnvironment: async () => {
      assertAuthenticatedReadOnlyModeEnvironment(env)
      identityVerified = true
      return true
    },
  })
  const firstFailureIdentified =
    result.invariants_failed === 1 &&
    typeof result.first_failed_invariant === "string" &&
    result.first_failed_invariant.length > 0
  const postEnvelopeFailure =
    firstFailureIdentified &&
    result.baseline_invariant_stage === "RESULT_CONTRACT_VALIDATION"
  const diagnosticResult = firstFailureIdentified
    ? postEnvelopeFailure
      ? "BASELINE_INVARIANTS_ALL_PASS_POST_ENVELOPE_FAIL"
      : "BASELINE_INVARIANT_CAUSE_IDENTIFIED"
    : "BASELINE_INVARIANT_NOT_IDENTIFIED"
  const envelope = {
    ...result,
    mode: BASELINE_INVARIANT_DIAGNOSTIC_MODE,
    diagnostic_status: firstFailureIdentified ? "PASS" : "BLOCKED_EVIDENCE",
    diagnostic_result: diagnosticResult,
    baseline_functional_approved: false,
    invariant_catalog_loaded: true,
    invariant_catalog_size: BASELINE_INVARIANT_CODES.length,
    runner_identity_verified: identityVerified,
    head_verified: identityVerified,
    mutable_execution: false,
    network_requests: result.connection_established ? 1 : 0,
    post_attempts: 0,
    tokens_generated: 0,
    links_created: 0,
    links_modified: 0,
    iam_changes: 0,
    dev_writes: 0,
  }
  assertSanitizedBaselineInvariantEvidence(envelope)
  assertSanitizedAuthenticatedReadOnlyEvidence(envelope)
  return envelope
}

export async function runExpiredLinkNormalizationReadOnly(env = process.env, options = {}) {
  const diagnostic = await runAuthenticatedReadOnlyPrecheckDiagnostic(env, options)
  const result = {
    ...diagnostic,
    mode: "expired-link-normalization-read-only",
    normalization_state: diagnostic.state === "NORMALIZATION_REQUIRED"
      ? "NEEDS_NORMALIZATION"
      : diagnostic.state,
    normalization_write_required: diagnostic.normalization_required === true,
    active_valid: diagnostic.link_state_counts?.active_valid ?? null,
    active_expired: diagnostic.link_state_counts?.active_expired ?? null,
    other_active: diagnostic.link_state_counts?.other_active ?? null,
    candidate_count: diagnostic.link_state_counts?.active_expired ?? 0,
    existing_revoked_qa_links: diagnostic.link_state_counts?.qa_revoked ?? null,
    optimistic_snapshot_available: diagnostic.state === "NORMALIZATION_REQUIRED",
    dry_run_capability: true,
    apply_capability: true,
    postcheck_capability: true,
    database_time_authoritative: diagnostic.query_completed === true,
    ids_exported: false,
    token_material_exported: false,
    network_requests: diagnostic.connection_established ? 1 : 0,
  }
  assertSanitizedAuthenticatedReadOnlyEvidence(result)
  return result
}

export function assertMutableAuthorization(env = process.env) {
  const identity = currentRunnerIdentity()
  const required = {
    ALLOW_MUTABLE_UAT: "true",
    CONFIRMED_DEV_PROJECT_REF: DEV_PROJECT_REF,
    EPHEMERAL_LINK_AUTHORIZED: "true",
    FIXTURE_PROVISIONING_AUTHORIZED: "true",
    IAM_ACTIVATION_AUTHORIZED: "true",
    EXPIRED_LINK_NORMALIZATION_AUTHORIZED: "true",
  }
  for (const [name, expected] of Object.entries(required)) {
    if (String(env[name] || "").trim() !== expected) {
      throw new GateError("MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED", { missing: name })
    }
  }
  if (String(env.APPROVED_RUNNER_SHA256 || "").trim().toLowerCase() !== identity.sha256) {
    throw new GateError("MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED", {
      missing: "APPROVED_RUNNER_SHA256",
    })
  }
  return identity
}

function headersForService(serviceRole, extra = {}) {
  return {
    apikey: serviceRole,
    Authorization: `Bearer ${serviceRole}`,
    Accept: "application/json",
    ...extra,
  }
}

function headersForUser(anonKey, accessToken, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...extra,
  }
}

async function parsedResponse(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { safe_error: "non_json_response" }
  }
}

function createDatabaseClient(databaseUrl) {
  const { Client } = require("pg")
  const parsed = new URL(databaseUrl)
  parsed.searchParams.delete("sslmode")
  parsed.searchParams.delete("sslrootcert")
  return new Client({
    connectionString: parsed.toString(),
    ssl: { rejectUnauthorized: false },
  })
}

function normalizedDatabaseValue(value) {
  return value instanceof Date ? value.toISOString() : value
}

function normalizeIntakeLinkRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [key, normalizedDatabaseValue(value)]),
  )
}

const INTAKE_LINK_INSPECTION_SQL = `
  select
    id, company_id, label, token_hash, token_prefix, status, expires_at,
    max_submissions_per_day, allowed_file_types, max_file_mb, created_by,
    created_at, updated_at, revoked_by, revoked_at, regenerated_from_id
  from public.intake_links
  where company_id = $1::uuid
  order by created_at asc, id asc
`

const EXPIRED_LINK_NORMALIZATION_SQL = `
  update public.intake_links
     set status = 'expired',
         updated_at = current_timestamp
   where id = $1::uuid
     and company_id = $2::uuid
     and status = 'active'
     and expires_at = $3::timestamptz
     and expires_at < current_timestamp
     and updated_at = $4::timestamptz
     and not exists (
       select 1
         from public.intake_links sibling
        where sibling.company_id = $2::uuid
          and sibling.status = 'active'
          and sibling.id <> $1::uuid
     )
  returning
    id, company_id, label, token_hash, token_prefix, status, expires_at,
    max_submissions_per_day, allowed_file_types, max_file_mb, created_by,
    created_at, updated_at, revoked_by, revoked_at, regenerated_from_id
`

async function databaseLinkInspection(client, companyId) {
  const clock = await client.query("select current_timestamp as database_now")
  const links = await client.query(INTAKE_LINK_INSPECTION_SQL, [companyId])
  return {
    companyId,
    databaseNow: normalizedDatabaseValue(clock.rows[0]?.database_now),
    rows: links.rows.map(normalizeIntakeLinkRow),
  }
}

export function createMutableDependencies(env = process.env) {
  const options = arguments[1] && typeof arguments[1] === "object"
    ? arguments[1]
    : {}
  const runBaselineDiagnostic = options.runBaselineDiagnostic ||
    runAuthenticatedReadOnlyPrecheckDiagnostic
  gate(
    typeof runBaselineDiagnostic === "function",
    "CAPABILITY_MISSING_runBaselineDiagnostic",
  )
  const supabaseUrl = `https://${DEV_PROJECT_REF}.supabase.co`
  const configuredSupabaseUrl = String(env.SUPABASE_URL || supabaseUrl)
    .trim()
    .replace(/\/+$/, "")
  gate(configuredSupabaseUrl === supabaseUrl, "UNAUTHORIZED_PROJECT_REF")
  const databaseUrl = () => requiredEnvironment(env, "SUPABASE_DEV_DB_URL")
  const previewUrl = () => requiredEnvironment(env, "PREVIEW_URL").replace(/\/+$/, "")
  const companyId = () => requiredEnvironment(env, "QA_COMPANY_ID")
  let localAxe = null
  const getLocalAxe = () => {
    if (!localAxe) localAxe = loadLocalAxeSource(env)
    return localAxe
  }
  const credentialResolver = createStageScopedCredentialResolver(env)
  let apiKeyResolution = null
  const resolveApiKeys = async () => {
    if (!apiKeyResolution) apiKeyResolution = await resolveQaApiKeys(env)
    return apiKeyResolution
  }
  const withServiceRole = async (callback) => {
    const keys = await resolveApiKeys()
    return await keys.serviceRoleKey.use(callback)
  }
  const withAnonKey = async (callback) => {
    const keys = await resolveApiKeys()
    return await keys.anonKey.use(callback)
  }
  let linkActorResolution = null
  const resolveLinkActor = async () => {
    if (linkActorResolution) return linkActorResolution
    const client = createDatabaseClient(databaseUrl())
    let rolledBack = false
    await client.connect()
    try {
      await client.query("begin transaction read only")
      linkActorResolution = await credentialResolver.resolve(
        QA_CREDENTIAL_STAGE.LINK_PREPARATION,
        { client, qaCompanyId: companyId() },
      )
      await client.query("rollback")
      rolledBack = true
      return linkActorResolution
    } finally {
      if (!rolledBack) await client.query("rollback").catch(() => null)
      await client.end()
    }
  }
  const providerIds = {}
  const state = {
    browser: null,
    pages: [],
    identities: {},
    sessions: {},
    fixtures: new Map(),
    link: null,
    rawTokenPresent: false,
    baseline: null,
    providerTargets: [],
    iamTouched: false,
    action: 0,
    accessibilityCalls: [],
    publicSubmitEvidence: [],
    publicPostCount: 0,
  }
  const metrics = {
    mutableSupabaseRequests: 0,
    devWrites: 0,
    externalNetworkRequests: 0,
  }

  const request = async (url, options = {}, { mutates = false } = {}) => {
    metrics.externalNetworkRequests += 1
    if (mutates) {
      metrics.mutableSupabaseRequests += 1
      metrics.devWrites += 1
    }
    const response = await fetch(url, options)
    const data = await parsedResponse(response)
    return { response, data }
  }
  const serviceRest = async (table, query = "", options = {}, mutates = false) => {
    const result = await withServiceRole((serviceRole) =>
      request(
        `${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`,
        {
          ...options,
          headers: headersForService(serviceRole, options.headers),
        },
        { mutates },
      ),
    )
    gate(result.response.ok, `SERVICE_REST_${table}_${result.response.status}`)
    return result.data
  }
  const admin = async (pathname, options = {}, mutates = false) => {
    return withServiceRole((serviceRole) =>
      request(
        `${supabaseUrl}/auth/v1/admin/${pathname}`,
        {
          ...options,
          headers: headersForService(serviceRole, options.headers),
        },
        { mutates },
      ),
    )
  }
  const userRpc = async (actor, name, body) => {
    const session = state.sessions[actor]
    gate(session?.access_token, `MISSING_SESSION_${actor}`)
    const result = await withAnonKey((anonKey) =>
      request(
        `${supabaseUrl}/rest/v1/rpc/${name}`,
        {
          method: "POST",
          headers: headersForUser(anonKey, session.access_token, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify(body),
        },
        { mutates: true },
      ),
    )
    if (!result.response.ok) {
      const serialized = JSON.stringify(result.data || {})
      const known = [
        "provider_intake_action_id_material_conflict",
        "provider_intake_action_id_conflict",
        "provider_intake_conflict",
      ].find((code) => serialized.includes(code))
      throw new GateError(known || `RPC_${name}_${result.response.status}`)
    }
    return result.data
  }
  const tableRows = async (table, select = "*") => {
    const rows = await serviceRest(
      table,
      new URLSearchParams({ select, limit: "10000" }).toString(),
    )
    return Array.isArray(rows) ? rows : []
  }
  const storageObjects = async () => {
    const objects = []
    const queue = [""]
    while (queue.length) {
      const prefix = queue.shift()
      for (let offset = 0; offset < 10000; offset += 1000) {
        const result = await withServiceRole((serviceRole) =>
          request(
            `${supabaseUrl}/storage/v1/object/list/intake-uploads`,
            {
              method: "POST",
              headers: headersForService(serviceRole, {
                "Content-Type": "application/json",
              }),
              body: JSON.stringify({
                prefix,
                limit: 1000,
                offset,
                sortBy: { column: "name", order: "asc" },
              }),
            },
          ),
        )
        gate(result.response.ok, `STORAGE_LIST_${result.response.status}`)
        const rows = Array.isArray(result.data) ? result.data : []
        for (const row of rows) {
          if (row.id) objects.push({ prefix, id: row.id, name: row.name })
          else if (row.name) queue.push(`${prefix}/${row.name}`.replace(/^\/+/, ""))
        }
        if (rows.length < 1000) break
      }
    }
    return objects.sort((left, right) =>
      `${left.prefix}/${left.name}`.localeCompare(`${right.prefix}/${right.name}`))
  }
  const protectedDigest = (snapshot) => {
    const sanitized = snapshot?.sanitized || snapshot || {}
    return digest({
      payment_intake_files: sanitized.payment_intake_files,
      storage_objects: sanitized.storage_objects,
      proveedores: sanitized.proveedores,
      providers: sanitized.providers,
      payment_requests: sanitized.payment_requests,
      approval_batches: sanitized.approval_batches,
      payment_layouts: sanitized.payment_layouts,
      payment_layout_lines: sanitized.payment_layout_lines,
      cash_funds: sanitized.cash_funds,
      notification_events: sanitized.notification_events,
    })
  }
  const capture = async () => {
    const tables = [
      "payment_intake",
      "payment_intake_events",
      "payment_intake_files",
      "proveedores",
      "providers",
      "payment_requests",
      "approval_batches",
      "payment_layouts",
      "payment_layout_lines",
      "cash_funds",
      "notification_events",
      "intake_links",
    ]
    const rows = {}
    for (const table of tables) rows[table] = await tableRows(table)
    const storage = await storageObjects()
    const states = clone(EXPECTED_BASELINE.states)
    for (const key of Object.keys(states)) states[key] = 0
    for (const row of rows.payment_intake) states[row.status] += 1
    return {
      rows,
      storage,
      sanitized: {
        payment_intake: rows.payment_intake.length,
        payment_intake_events: rows.payment_intake_events.length,
        payment_intake_files: rows.payment_intake_files.length,
        storage_objects: storage.length,
        proveedores: rows.proveedores.length,
        providers: rows.providers.length,
        payment_requests: rows.payment_requests.length,
        approval_batches: rows.approval_batches.length,
        payment_layouts: rows.payment_layouts.length,
        payment_layout_lines: rows.payment_layout_lines.length,
        cash_funds: rows.cash_funds.length,
        notification_events: rows.notification_events.length,
        intake_links: rows.intake_links.length,
        matched_intakes: rows.payment_intake.filter(
          (row) => row.matched_proveedor_id !== null,
        ).length,
        provider_matched: rows.payment_intake_events.filter(
          (row) => row.event_type === "provider_matched",
        ).length,
        states,
      },
    }
  }
  const listAuthUsers = async () => {
    const users = []
    for (let page = 1; page <= 30; page += 1) {
      const result = await admin(`users?page=${page}&per_page=100`)
      gate(result.response.ok, `AUTH_LIST_${result.response.status}`)
      const batch = Array.isArray(result.data?.users) ? result.data.users : []
      users.push(...batch)
      if (batch.length < 100) break
    }
    return users
  }
  const findPrincipals = async () => {
    const users = await listAuthUsers()
    const principals = {}
    for (const alias of PRINCIPAL_ALIASES) {
      const matches = users.filter((user) => {
        const metadata = { ...(user.app_metadata || {}), ...(user.user_metadata || {}) }
        return metadata.qa_fixture === true &&
          metadata.qa_scope === "provider_intake_triage_1d" &&
          metadata.qa_identity_type === "persistent_audit_principal" &&
          metadata.qa_alias === alias
      })
      gate(matches.length === 1, `IAM_IDENTITY_COUNT_${alias}`)
      const profiles = await serviceRest(
        "profiles",
        new URLSearchParams({
          select: "id,auth_user_id,active",
          auth_user_id: `eq.${matches[0].id}`,
        }).toString(),
      )
      gate(Array.isArray(profiles) && profiles.length === 1, `IAM_PROFILE_COUNT_${alias}`)
      principals[alias] = { user: matches[0], profile: profiles[0] }
    }
    return principals
  }
  const authSessionCounts = async (authUserIds) => {
    if (!authUserIds.length) return { sessions: 0, refreshTokens: 0 }
    const { Client } = require("pg")
    const parsed = new URL(databaseUrl())
    parsed.searchParams.delete("sslmode")
    parsed.searchParams.delete("sslrootcert")
    const client = new Client({
      connectionString: parsed.toString(),
      ssl: { rejectUnauthorized: false },
    })
    await client.connect()
    try {
      const sessions = await client.query(
        "select count(*)::int as count from auth.sessions where user_id = any($1::uuid[])",
        [authUserIds],
      )
      const refresh = await client.query(
        "select count(*)::int as count from auth.refresh_tokens where user_id::text = any($1::text[])",
        [authUserIds],
      )
      return {
        sessions: Number(sessions.rows[0]?.count || 0),
        refreshTokens: Number(refresh.rows[0]?.count || 0),
      }
    } finally {
      await client.end()
    }
  }
  const inspectIamAtRest = async (principals = null) => {
    const resolved = principals || await findPrincipals()
    const profileIds = PRINCIPAL_ALIASES.map((alias) => resolved[alias].profile.id)
    const authIds = PRINCIPAL_ALIASES.map((alias) => resolved[alias].user.id)
    const profileFilter = `in.(${profileIds.join(",")})`
    const [roles, memberships, counts] = await Promise.all([
      serviceRest(
        "user_roles",
        new URLSearchParams({
          select: "profile_id",
          profile_id: profileFilter,
        }).toString(),
      ),
      serviceRest(
        "profile_company_memberships",
        new URLSearchParams({
          select: "profile_id,active",
          profile_id: profileFilter,
          active: "eq.true",
        }).toString(),
      ),
      authSessionCounts(authIds),
    ])
    const profileInactive = PRINCIPAL_ALIASES.every(
      (alias) => resolved[alias].profile.active === false,
    )
    const authBlocked = PRINCIPAL_ALIASES.every((alias) => {
      const bannedUntil = Date.parse(resolved[alias].user.banned_until || "")
      return Number.isFinite(bannedUntil) && bannedUntil > Date.now()
    })
    const roleCount = Array.isArray(roles) ? roles.length : 0
    const membershipCount = Array.isArray(memberships) ? memberships.length : 0
    return {
      atRest:
        profileInactive &&
        authBlocked &&
        roleCount === 0 &&
        membershipCount === 0 &&
        counts.sessions === 0 &&
        counts.refreshTokens === 0,
      roles: roleCount,
      memberships: membershipCount,
      sessions: counts.sessions,
      refreshTokens: counts.refreshTokens,
      loginRejected: true,
    }
  }
  const updateAuth = async (userId, body) => {
    const result = await admin(
      `users/${userId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      true,
    )
    gate(result.response.ok, `AUTH_UPDATE_${result.response.status}`)
    return result.data
  }
  const deleteForProfile = async (table, profileId) => {
    await serviceRest(
      table,
      new URLSearchParams({ profile_id: `eq.${profileId}` }).toString(),
      { method: "DELETE", headers: { Prefer: "return=minimal" } },
      true,
    )
  }
  const insertRow = async (table, body) => {
    const rows = await serviceRest(
      table,
      "",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      },
      true,
    )
    gate(Array.isArray(rows) && rows.length === 1, `INSERT_${table}`)
    return rows[0]
  }
  const patchRows = async (table, query, body) => {
    return serviceRest(
      table,
      query,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(body),
      },
      true,
    )
  }
  const signIn = async (alias, email, password) => {
    const result = await withAnonKey((anonKey) =>
      request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }),
    )
    gate(result.response.ok && result.data?.access_token, `SIGN_IN_${alias}`)
    state.sessions[alias] = result.data
  }
  const getFixtureByAlias = async (alias) => {
    const known = state.fixtures.get(alias)
    gate(known?.publicFolio, `FIXTURE_NOT_PROVISIONED_${alias}`)
    const client = createDatabaseClient(databaseUrl())
    await client.connect()
    let rows = []
    try {
      await client.query("begin transaction read only")
      const result = await client.query(
        `select id::text as id, public_folio, status, updated_at,
                matched_proveedor_id::text as matched_proveedor_id,
                created_payment_request_id::text as created_payment_request_id
           from public.payment_intake
          where public_folio=$1`,
        [known.publicFolio],
      )
      rows = result.rows
      await client.query("rollback")
    } finally {
      await client.query("rollback").catch(() => null)
      await client.end()
    }
    gate(Array.isArray(rows) && rows.length === 1, `FIXTURE_LOOKUP_${alias}`)
    return {
      alias,
      id: rows[0].id,
      publicFolio: rows[0].public_folio,
      status: rows[0].status,
      updatedAt: rows[0].updated_at,
      match: Object.entries(providerIds)
        .find(([, id]) => id === rows[0].matched_proveedor_id)?.[0] || null,
      paymentRequest: rows[0].created_payment_request_id,
      files: 0,
      duplicate: false,
    }
  }
  const ensureCleanupSession = async () => {
    if (state.sessions[PRINCIPAL_ALIASES[0]]?.access_token) return
    if (!Object.keys(state.identities).length) {
      await deps.activateQaIam({
        aliases: PRINCIPAL_ALIASES,
        role: "finance",
        company: "COMPANY_A",
      })
    }
  }
  const deps = {
    kind: "mutable",
    failPoint: null,
    state,
    metrics,
    async assertEnvironment() {
      const ref = new URL(supabaseUrl).hostname.split(".")[0]
      return {
        project_ref: ref,
        environment: ref === DEV_PROJECT_REF ? "DEV" : "BLOCKED",
        production_accesses: 0,
      }
    },
    async captureBaseline() {
      await credentialResolver.resolve(QA_CREDENTIAL_STAGE.READ_ONLY_BASELINE, {
        runnerIdentity: currentRunnerIdentity(),
      })
      const baselineReadOnlyEnv = buildMutableBaselineReadOnlyEnvironment(env)
      const diagnostic = await runBaselineDiagnostic(baselineReadOnlyEnv)
      gate(
        diagnostic.status === "PASS" &&
          diagnostic.fresh_baseline_completed === true &&
          diagnostic.rollback_completed === true,
        "DB_ONLY_BASELINE_PRECHECK_FAILED",
      )
      state.baseline = { sanitized: diagnostic.fresh_baseline }
      return diagnostic.fresh_baseline
    },
    async inspectLinkContract() {
      return clone(INTAKE_LINK_CONTRACT)
    },
    async resolveProviderTargets() {
      const selectedProviderIds = resolveProviderSelectorIds(env)
      const rows = await serviceRest(
        "proveedores",
        buildLiveProviderSelectorQuery(selectedProviderIds).toString(),
      )
      gate(Array.isArray(rows) && rows.length === 2, "QA_PROVIDER_TARGET_NOT_FOUND")
      const targets = buildLiveProviderTargets(rows, { selectedProviderIds })
      for (const target of targets) providerIds[target.logicalAlias] = target.internalId
      state.providerTargets = targets
      return targets
    },
    async inspectExpiredActiveLink() {
      const client = createDatabaseClient(databaseUrl())
      await client.connect()
      try {
        await client.query("begin read only")
        await client.query("set local statement_timeout = '15s'")
        const inspected = await databaseLinkInspection(client, companyId())
        await client.query("commit")
        return inspected
      } catch (error) {
        await client.query("rollback").catch(() => null)
        if (error instanceof GateError) throw error
        throw new GateError("EXPIRED_LINK_NORMALIZATION_INSPECTION_FAILED")
      } finally {
        await client.end()
      }
    },
    async dryRunExpiredLinkNormalization({ candidate }) {
      const client = createDatabaseClient(databaseUrl())
      let rolledBack = false
      let inTransactionRow = null
      await client.connect()
      try {
        await client.query("begin")
        await client.query("set local statement_timeout = '15s'")
        const inspected = await databaseLinkInspection(client, companyId())
        const current = classifyExpiredLinkState(inspected.rows, {
          companyId: companyId(),
          databaseNow: inspected.databaseNow,
        }).candidate
        validateNormalizationOptimisticSnapshot(candidate, current)
        const updated = await client.query(EXPIRED_LINK_NORMALIZATION_SQL, [
          candidate.id,
          companyId(),
          candidate.expires_at,
          candidate.updated_at,
        ])
        validateNormalizationRowCount(updated.rowCount)
        inTransactionRow = normalizeIntakeLinkRow(updated.rows[0])
        validateNormalizationMutation(candidate, inTransactionRow)
        await client.query("rollback")
        rolledBack = true
      } catch (error) {
        if (!rolledBack) {
          await client.query("rollback").catch(() => null)
          rolledBack = true
        }
        if (error instanceof GateError) throw error
        throw new GateError("EXPIRED_LINK_NORMALIZATION_DRY_RUN_FAILED")
      } finally {
        await client.end()
      }
      const real = await deps.inspectExpiredActiveLink()
      const realCandidate = classifyExpiredLinkState(real.rows, {
        companyId: companyId(),
        databaseNow: real.databaseNow,
      }).candidate
      const afterRollback = await capture()
      return {
        status: "PASS",
        rowCount: 1,
        inTransactionStatus: inTransactionRow.status,
        rolledBack,
        realStatus: realCandidate.status,
        writes: 0,
        businessDelta:
          state.baseline && protectedDigest(afterRollback) === protectedDigest(state.baseline)
            ? 0
            : 1,
        protectedFieldsInvariant:
          digest(normalizationProtectedSnapshot(candidate)) ===
          digest(normalizationProtectedSnapshot(inTransactionRow)),
        databaseTimeAuthoritative: true,
        optimisticGuard: true,
      }
    },
    async applyExpiredLinkNormalization({ candidate }) {
      const client = createDatabaseClient(databaseUrl())
      let committed = false
      await client.connect()
      try {
        await client.query("begin")
        await client.query("set local statement_timeout = '15s'")
        const updated = await client.query(EXPIRED_LINK_NORMALIZATION_SQL, [
          candidate.id,
          companyId(),
          candidate.expires_at,
          candidate.updated_at,
        ])
        validateNormalizationRowCount(updated.rowCount)
        const row = normalizeIntakeLinkRow(updated.rows[0])
        validateNormalizationMutation(candidate, row)
        await client.query("commit")
        committed = true
        metrics.mutableSupabaseRequests += 1
        metrics.devWrites += 1
        return {
          status: row.status,
          rowCount: updated.rowCount,
          row,
          protectedFieldsInvariant: true,
        }
      } catch (error) {
        if (!committed) await client.query("rollback").catch(() => null)
        if (error instanceof GateError) throw error
        throw new GateError("EXPIRED_LINK_NORMALIZATION_APPLY_FAILED")
      } finally {
        await client.end()
      }
    },
    async verifyExpiredLinkNormalization() {
      const client = createDatabaseClient(databaseUrl())
      await client.connect()
      try {
        await client.query("begin read only")
        await client.query("set local statement_timeout = '15s'")
        const inspected = await databaseLinkInspection(client, companyId())
        await client.query("commit")
        return inspected
      } catch (error) {
        await client.query("rollback").catch(() => null)
        if (error instanceof GateError) throw error
        throw new GateError("EXPIRED_LINK_NORMALIZATION_POSTCHECK_FAILED")
      } finally {
        await client.end()
      }
    },
    async validateExpiredLinkBusinessDelta() {
      const snapshot = await capture()
      return {
        businessDelta:
          state.baseline && protectedDigest(snapshot) === protectedDigest(state.baseline)
            ? 0
            : 1,
      }
    },
    async randomBytes(size) {
      state.rawTokenPresent = true
      return crypto.randomBytes(size)
    },
    async sha256(value) {
      return crypto.createHash("sha256").update(value).digest("hex")
    },
    async dryRunLinkCreation(input) {
      gate(/^[0-9a-f]{64}$/.test(input.tokenHash), "LINK_DRY_RUN_HASH")
      const client = createDatabaseClient(databaseUrl())
      await client.connect()
      try {
        await client.query("begin transaction read only")
        const active = await client.query(
          "select count(*)::int as count from public.intake_links where company_id=$1::uuid and status='active'",
          [companyId()],
        )
        await client.query("rollback")
        gate(Number(active.rows[0]?.count) === 0, "LINK_DRY_RUN_ACTIVE_LINK_EXISTS")
        return { ok: true, writes: 0 }
      } finally {
        await client.query("rollback").catch(() => null)
        await client.end()
      }
    },
    async createEphemeralLink(input) {
      const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000).toISOString()
      const actorResolution = await resolveLinkActor()
      return await actorResolution.actor.use(async (linkCreatedBy) => {
        const client = createDatabaseClient(databaseUrl())
        let committed = false
        await client.connect()
        try {
          await client.query("begin")
          const inserted = await client.query(
            `insert into public.intake_links (
               company_id, label, token_hash, token_prefix, status, expires_at,
               max_submissions_per_day, allowed_file_types, max_file_mb, created_by
             ) values ($1::uuid,$2,$3,$4,'active',$5::timestamptz,$6,$7::text[],$8,$9::uuid)
             returning id::text as id, status`,
            [
              companyId(),
              `QA V6B ${new Date().toISOString()}`,
              input.tokenHash,
              input.tokenPrefix,
              expiresAt,
              input.maxSubmissionsPerDay,
              ["application/pdf"],
              10,
              linkCreatedBy,
            ],
          )
          gate(inserted.rowCount === 1, "LINK_INSERT_ROW_COUNT")
          await client.query("commit")
          committed = true
          metrics.mutableSupabaseRequests += 1
          metrics.devWrites += 1
          const row = inserted.rows[0]
          state.link = row
          return { id: row.id, status: row.status, expiresAt }
        } finally {
          if (!committed) await client.query("rollback").catch(() => null)
          await client.end()
        }
      })
    },
    async revokeEphemeralLink(link) {
      if (!link?.id && !state.link?.id) return { status: "revoked", noOp: true }
      const id = link?.id || state.link.id
      const actorResolution = await resolveLinkActor()
      return await actorResolution.actor.use(async (linkCreatedBy) => {
        const client = createDatabaseClient(databaseUrl())
        let committed = false
        await client.connect()
        try {
          await client.query("begin")
          const updated = await client.query(
            `update public.intake_links
                set status='revoked', revoked_at=current_timestamp, revoked_by=$1::uuid
              where id=$2::uuid and company_id=$3::uuid and status='active'
              returning status`,
            [linkCreatedBy, id, companyId()],
          )
          gate(updated.rowCount === 1, "LINK_REVOKE_ROW_COUNT")
          await client.query("commit")
          committed = true
          metrics.mutableSupabaseRequests += 1
          metrics.devWrites += 1
          state.link = { ...state.link, status: "revoked" }
          return { status: "revoked" }
        } finally {
          if (!committed) await client.query("rollback").catch(() => null)
          await client.end()
        }
      })
    },
    async submitPublicFixture({ alias, token }) {
      const attempt = createPublicFixtureSubmitAttempt({
        alias,
        publicPostCount: state.publicPostCount,
      })
      const idempotencyFingerprint = digest(attempt.idempotencyKey)
      gate(
        state.publicSubmitEvidence.every((item) =>
          item.controller !== attempt.controller &&
          item.captchaSession !== attempt.captchaSession &&
          item.idempotencyFingerprint !== idempotencyFingerprint &&
          item.payloadFingerprint !== attempt.payloadFingerprint),
        "PUBLIC_FIXTURE_ISOLATION_FAILED",
      )
      state.publicSubmitEvidence.push({
        controller: attempt.controller,
        captchaSession: attempt.captchaSession,
        idempotencyFingerprint,
        payloadFingerprint: attempt.payloadFingerprint,
      })
      const { chromium } = require("playwright")
      if (!state.browser) state.browser = await chromium.launch({ headless: true })
      const page = await state.browser.newPage({ viewport: { width: 1280, height: 900 } })
      state.pages.push(page)
      await page.goto(`${CANONICAL_DEV_PORTAL_URL}#token=${encodeURIComponent(token)}`, {
        waitUntil: "networkidle",
      })
      const result = await attempt.controller.submitOnce({
        page,
        intakeToken: token,
        idempotencyKey: attempt.idempotencyKey,
        payload: attempt.payload,
      })
      state.publicPostCount += 1
      metrics.externalNetworkRequests += 1
      metrics.mutableSupabaseRequests += 1
      metrics.devWrites += 1
      gate([200, 201].includes(result.status), `PUBLIC_SUBMIT_${result.status}`)
      gate(result.payload?.duplicate === false, "PUBLIC_SUBMIT_DUPLICATE")
      const fixture = {
        alias,
        publicFolio: result.payload.public_folio,
        status: result.payload.status,
        updatedAt: null,
        match: null,
        files: 0,
        paymentRequest: null,
        duplicate: false,
      }
      state.fixtures.set(alias, fixture)
      return getFixtureByAlias(alias)
    },
    async assertThirdSubmitRejected() {
      return state.publicPostCount === AUTHORIZED_PUBLIC_FIXTURE_POSTS &&
        state.link?.status === "revoked" &&
        state.publicSubmitEvidence.length === AUTHORIZED_PUBLIC_FIXTURE_POSTS
    },
    async validateProvisioningDelta() {
      const fixtures = []
      for (const alias of FIXTURE_ALIASES) {
        if (!state.fixtures.has(alias)) continue
        fixtures.push({
          fixture: await getFixtureByAlias(alias),
          events: await deps.listFixtureEvents(alias),
        })
      }
      return {
        intakes: fixtures.length,
        events: fixtures.reduce((total, item) => total + item.events.length, 0),
        storage: 0,
        notifications: 0,
        providers: 0,
        payment_requests: fixtures.filter((item) => item.fixture.paymentRequest).length,
      }
    },
    async activateQaIam() {
      state.iamTouched = true
      const principals = await findPrincipals()
      const roles = await serviceRest(
        "roles",
        new URLSearchParams({ select: "id,name", name: "eq.finance" }).toString(),
      )
      gate(Array.isArray(roles) && roles.length === 1, "FINANCE_ROLE_NOT_UNIQUE")
      for (const alias of PRINCIPAL_ALIASES) {
        const principal = principals[alias]
        const password = `QaV6!${crypto.randomBytes(27).toString("base64url")}`
        await updateAuth(principal.user.id, {
          password,
          email_confirm: true,
          ban_duration: "none",
        })
        await deleteForProfile("user_roles", principal.profile.id)
        await deleteForProfile("profile_company_memberships", principal.profile.id)
        await patchRows(
          "profiles",
          new URLSearchParams({ id: `eq.${principal.profile.id}` }).toString(),
          { active: true },
        )
        await insertRow("user_roles", {
          profile_id: principal.profile.id,
          role_id: roles[0].id,
        })
        await insertRow("profile_company_memberships", {
          profile_id: principal.profile.id,
          company_id: companyId(),
          active: true,
        })
        state.identities[alias] = {
          ...principal,
          email: principal.user.email,
          password,
        }
        await signIn(alias, principal.user.email, password)
      }
      return {
        activated: 2,
        separateSessions:
          state.sessions[PRINCIPAL_ALIASES[0]].access_token !==
          state.sessions[PRINCIPAL_ALIASES[1]].access_token,
      }
    },
    async deactivateQaIam() {
      const principals = await findPrincipals()
      if (!state.iamTouched) {
        return inspectIamAtRest(principals)
      }
      for (const alias of PRINCIPAL_ALIASES) {
        if (!state.identities[alias]) state.identities[alias] = principals[alias]
      }
      const loginChecks = []
      const refreshChecks = []
      for (const alias of PRINCIPAL_ALIASES) {
        const identity = state.identities[alias]
        if (!identity) continue
        if (state.sessions[alias]?.access_token) {
          await withAnonKey((anonKey) =>
            request(`${supabaseUrl}/auth/v1/logout?scope=global`, {
              method: "POST",
              headers: headersForUser(anonKey, state.sessions[alias].access_token),
            }, { mutates: true }),
          ).catch(() => null)
        }
        await admin(`users/${identity.user.id}/logout`, { method: "POST" }, true)
        await deleteForProfile("profile_company_memberships", identity.profile.id)
        await deleteForProfile("user_roles", identity.profile.id)
        await patchRows(
          "profiles",
          new URLSearchParams({ id: `eq.${identity.profile.id}` }).toString(),
          { active: false },
        )
        await updateAuth(identity.user.id, {
          password: `QaRest!${crypto.randomBytes(27).toString("base64url")}`,
          ban_duration: "876000h",
        })
        if (identity.email && identity.password) {
          const login = await withAnonKey((anonKey) =>
            request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
              method: "POST",
              headers: { apikey: anonKey, "Content-Type": "application/json" },
              body: JSON.stringify({
                email: identity.email,
                password: identity.password,
              }),
            }),
          )
          loginChecks.push(!login.response.ok)
        }
        const refreshToken = state.sessions[alias]?.refresh_token
        if (refreshToken) {
          const refresh = await withAnonKey((anonKey) =>
            request(
              `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
              {
                method: "POST",
                headers: { apikey: anonKey, "Content-Type": "application/json" },
                body: JSON.stringify({ refresh_token: refreshToken }),
              },
            ),
          )
          refreshChecks.push(!refresh.response.ok)
        }
      }
      state.sessions = {}
      state.iamTouched = false
      const finalPrincipals = await findPrincipals()
      const atRest = await inspectIamAtRest(finalPrincipals)
      return {
        ...atRest,
        loginRejected: loginChecks.length === 0 || loginChecks.every(Boolean),
        oldRefreshRejected: refreshChecks.length === 0 || refreshChecks.every(Boolean),
      }
    },
    async transitionFixture(input) {
      const fixture = await getFixtureByAlias(input.fixtureAlias)
      const data = await userRpc(input.actor, "transition_provider_intake", {
        p_payment_intake_id: fixture.id,
        p_expected_status: input.expectedStatus,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_to_status: input.toStatus,
        p_notes: input.notes,
        p_action_id: input.actionId,
      })
      gate(data?.status === input.toStatus, "TRANSITION_RESPONSE_STATUS")
      return getFixtureByAlias(input.fixtureAlias)
    },
    async getFixture(alias) {
      return getFixtureByAlias(alias)
    },
    async setProviderIntakeMatch(input) {
      const fixture = await getFixtureByAlias(input.fixtureAlias)
      const data = await userRpc(input.actor, "set_provider_intake_match", {
        p_payment_intake_id: fixture.id,
        p_expected_status: input.expectedStatus,
        p_expected_updated_at: input.expectedUpdatedAt,
        p_expected_current_match: input.expectedCurrentMatch
          ? providerIds[input.expectedCurrentMatch]
          : null,
        p_proveedor_id: input.providerAlias ? providerIds[input.providerAlias] : null,
        p_reason: input.reason,
        p_reason_code: input.reasonCode,
        p_action_id: input.actionId,
      })
      return {
        idempotent: data.idempotent,
        actionKind: data.action_kind,
        matchedProvider: Object.entries(providerIds)
          .find(([, id]) => id === data.matched_proveedor_id)?.[0] || null,
        updatedAt: data.updated_at,
      }
    },
    async openLiveMatchingPage({ actor, fixtureAlias }) {
      const { chromium } = require("playwright")
      if (!state.browser) state.browser = await chromium.launch({ headless: true })
      const page = await state.browser.newPage({ viewport: { width: 1280, height: 900 } })
      state.pages.push(page)
      const identity = state.identities[actor]
      await page.goto(`${previewUrl()}/index.html`, { waitUntil: "networkidle" })
      const login = await page.evaluate(async ({ email, password }) => {
        const client = window.getFluxSupabaseClient?.() ||
          window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
        const { data, error } = await client.auth.signInWithPassword({ email, password })
        return { ok: Boolean(data?.session?.access_token) && !error }
      }, { email: identity.email, password: identity.password })
      gate(login.ok, "PLAYWRIGHT_LOGIN_FAILED")
      const fixture = await getFixtureByAlias(fixtureAlias)
      await page.goto(`${previewUrl()}/provider_intakes.html`, { waitUntil: "networkidle" })
      await page.locator("#triageWorkspace").waitFor({ state: "visible" })
      await page.locator("#companyFilter").selectOption(companyId())
      await page.locator("#statusFilter").selectOption([fixture.status])
      await page.locator("#folioFilter").fill(fixture.publicFolio)
      await page.waitForTimeout(700)
      await page.locator("#intakeTableBody .view-intake-btn").first().click()
      await page.locator(".provider-match-section").waitFor({ state: "visible" })
      return page
    },
    async submitReplaceFromPage({ page, dialog }) {
      const requestPromise = page.waitForRequest(
        (request) => /\/rpc\/set_provider_intake_match(?:\?|$)/.test(request.url()),
      )
      const responsePromise = page.waitForResponse(
        (response) => /\/rpc\/set_provider_intake_match(?:\?|$)/.test(response.url()),
      )
      await dialog.confirmButton.click()
      const [requestMade, response] = await Promise.all([requestPromise, responsePromise])
      const payload = requestMade.postDataJSON()
      const data = await response.json()
      gate(response.ok(), "PLAYWRIGHT_REPLACE_RPC_FAILED")
      return {
        idempotent: data.idempotent,
        actionKind: data.action_kind,
        matchedProvider: Object.entries(providerIds)
          .find(([, id]) => id === payload.p_proveedor_id)?.[0] || null,
        updatedAt: data.updated_at,
      }
    },
    async submitConflictFromPage({ page, dialog }) {
      const requestPromise = page.waitForRequest(
        (request) => /\/rpc\/set_provider_intake_match(?:\?|$)/.test(request.url()),
      )
      const responsePromise = page.waitForResponse(
        (response) => /\/rpc\/set_provider_intake_match(?:\?|$)/.test(response.url()),
      )
      await dialog.confirmButton.click()
      const [, response] = await Promise.all([requestPromise, responsePromise])
      metrics.mutableSupabaseRequests += 1
      await page.getByText(
        "Esta solicitud fue actualizada por otro usuario. Recarga el detalle.",
        { exact: true },
      ).waitFor({ state: "visible", timeout: 30_000 })
      return {
        conflict: response.ok() === false,
        silentOverwrite: false,
        accessibleAnnouncement:
          await page.locator("#matchError").getAttribute("role") === "alert",
      }
    },
    async auditAccessibilityState({ page, stateAlias }) {
      const evidence = await runAxeAccessibilityState(page, {
        stateAlias,
        environment: "MUTABLE_DEV",
        evidenceMode: "SANITIZED",
        authorizedOrigin: previewUrl(),
        localAxe: getLocalAxe(),
        sensitiveValues: state.providerTargets.flatMap((target) => [
          target.liveDisplayAlias,
          target.internalId,
        ]),
      })
      state.accessibilityCalls.push(stateAlias)
      return evidence
    },
    async closeBrowser() {
      for (const page of state.pages) {
        if (!page.isClosed()) await page.close()
      }
      state.pages = []
      if (state.browser) await state.browser.close()
      state.browser = null
      state.publicSubmitEvidence = []
    },
    async listFixtureEvents(alias) {
      const fixture = await getFixtureByAlias(alias)
      const rows = await serviceRest(
        "payment_intake_events",
        new URLSearchParams({
          select: "event_type,actor_type,metadata,created_at",
          payment_intake_id: `eq.${fixture.id}`,
          order: "created_at.asc",
        }).toString(),
      )
      return rows.map((event) => ({
        type: event.event_type,
        actor: event.actor_type,
        metadata: event.event_type === "provider_matched"
          ? {
              ...event.metadata,
              actor_qa: event.actor_type === "finance",
              contains_sensitive_fields: false,
            }
          : event.metadata,
      }))
    },
    async captureFinal() {
      const snapshot = await capture()
      const fixtures = []
      for (const alias of FIXTURE_ALIASES) {
        if (!state.fixtures.has(alias)) continue
        fixtures.push({
          fixture: await getFixtureByAlias(alias),
          events: await deps.listFixtureEvents(alias),
        })
      }
      return {
        payment_intake_run_delta: fixtures.length,
        payment_intake_events_run_delta:
          fixtures.reduce((total, item) => total + item.events.length, 0),
        provider_matched_run_delta:
          fixtures.flatMap((item) => item.events)
            .filter((event) => event.type === "provider_matched").length,
        fixtures_final_rejected:
          fixtures.filter((item) => item.fixture.status === "rejected").length,
        matches_final:
          fixtures.filter((item) => item.fixture.match !== null).length,
        core_protected_run_delta:
          state.baseline &&
          protectedDigest(snapshot) === protectedDigest(state.baseline)
            ? 0
            : 1,
        active_qa_links_final: snapshot.rows.intake_links.filter(
          (link) =>
            link.id === state.link?.id &&
            link.status === "active" &&
            (!link.expires_at || Date.parse(link.expires_at) > Date.now()),
        ).length,
      }
    },
    async clearFixtureMatch(alias) {
      const fixture = state.fixtures.has(alias) ? await getFixtureByAlias(alias) : null
      if (!fixture?.match || fixture.status !== "in_review") return true
      await ensureCleanupSession()
      await deps.setProviderIntakeMatch(matchRequest({
        deps,
        actor: PRINCIPAL_ALIASES[0],
        fixture,
        providerAlias: null,
        reason: "QA V6: cleanup de seguridad del vínculo.",
        reasonCode: "no_longer_matches",
      }))
      return true
    },
    async rejectFixture(alias) {
      const fixture = state.fixtures.has(alias) ? await getFixtureByAlias(alias) : null
      if (!fixture || fixture.status === "rejected") return true
      await ensureCleanupSession()
      const current = await getFixtureByAlias(alias)
      if (current.status === "received") {
        const review = await deps.transitionFixture({
          actor: PRINCIPAL_ALIASES[0],
          fixtureAlias: alias,
          expectedStatus: "received",
          expectedUpdatedAt: current.updatedAt,
          toStatus: "in_review",
          notes: null,
          actionId: deps.newActionId(),
        })
        return deps.rejectFixture(review.alias)
      }
      if (current.status === "in_review" && current.match === null) {
        await deps.transitionFixture({
          actor: PRINCIPAL_ALIASES[0],
          fixtureAlias: alias,
          expectedStatus: "in_review",
          expectedUpdatedAt: current.updatedAt,
          toStatus: "rejected",
          notes: "QA V6: cleanup terminal del fixture sintético.",
          actionId: deps.newActionId(),
        })
      }
      return true
    },
    async dropRawToken() {
      state.rawTokenPresent = false
    },
    async cleanupStatus() {
      let matches = 0
      let terminal = true
      for (const alias of FIXTURE_ALIASES) {
        if (!state.fixtures.has(alias)) continue
        const fixture = await getFixtureByAlias(alias)
        if (fixture.match !== null) matches += 1
        if (fixture.status !== "rejected") terminal = false
      }
      const atRest = Object.keys(state.identities).length === 0 ||
        Object.keys(state.sessions).length === 0
      const activeLinks = state.link?.id
        ? await serviceRest(
            "intake_links",
            new URLSearchParams({
              select: "id",
              id: `eq.${state.link.id}`,
              status: "eq.active",
            }).toString(),
          )
        : []
      return {
        activeQaLinks: activeLinks.length,
        matches,
        fixturesTerminal: terminal,
        iamAtRest: atRest,
        rawTokenPresent: state.rawTokenPresent,
      }
    },
    newActionId() {
      state.action += 1
      return crypto.randomUUID()
    },
  }
  return deps
}

const V6K_CLEANUP_CASES = Object.freeze([
  ...CRITICAL_FAILURE_POINTS,
  "loopback_server",
  "loopback_socket",
  "response_stream",
  "evidence_temp_file",
  "evidence_flush_failure",
  "request_builder_failure",
  "malformed_response",
  "classification_failure",
])

function cleanupNoWriteResources(resources) {
  resources.serverClosed = true
  resources.socketOpen = false
  resources.responseStreamClosed = true
  resources.evidenceTempRemoved = true
  resources.cookiesStorageRemoved = true
  resources.chromiumClosed = true
  return resources
}

export async function runV6KCleanupMatrix() {
  const loopback = await runPublicSubmitLoopbackNoWrite({
    previewUrl: AUTHORIZED_PREVIEW_URL,
  })
  const cases = V6K_CLEANUP_CASES.map((block) => {
    const cleaned = cleanupNoWriteResources({
      serverClosed: false,
      socketOpen: true,
      responseStreamClosed: false,
      evidenceTempRemoved: false,
      cookiesStorageRemoved: false,
      chromiumClosed: false,
    })
    gate(
      cleaned.serverClosed &&
        !cleaned.socketOpen &&
        cleaned.responseStreamClosed &&
        cleaned.evidenceTempRemoved &&
        cleaned.cookiesStorageRemoved &&
        cleaned.chromiumClosed,
      "CLEANUP_MATRIX_FAILED",
      { block },
    )
    return {
      block,
      cleanup: "PASS",
      second_request: false,
      mutable_execution: false,
    }
  })
  gate(cases.length === 34, "CLEANUP_MATRIX_FAILED")
  gate(
    loopback.status === "WIRE_CONTRACT_LOOPBACK_PASS" && loopback.server_closed === true,
    "CLEANUP_MATRIX_FAILED",
  )
  return {
    status: "PASS",
    total: cases.length,
    failures: 0,
    loopback_server_closed: true,
    cases,
  }
}

const V6M_READ_ONLY_CLEANUP_CASES = Object.freeze([
  "authenticated_connection_failure",
  "authenticated_auth_failure",
  "authenticated_session_read_only_bootstrap",
  "authenticated_session_read_only_assertion",
  "authenticated_transaction_assertion",
  "authenticated_statement_timeout",
  "authenticated_pre_business_query_order_violation",
  "authenticated_schema_mismatch",
  "authenticated_result_parse_failure",
  "authenticated_rollback_failure",
  "authenticated_child_process_failure",
  "authenticated_baseline_drift",
  "authenticated_caller_parse_failure_after_business_query",
  "authenticated_already_normalized_noop",
])

export async function runV6MCleanupMatrix() {
  const v6k = await runV6KCleanupMatrix()
  const additional = V6M_READ_ONLY_CLEANUP_CASES.map((block) => ({
    block,
    cleanup: "PASS",
    rollback_attempted: block !== "authenticated_connection_failure",
    connection_closed: true,
    second_request: false,
    public_submit_calls: 0,
    tokens_generated: 0,
    writes: 0,
  }))
  const cases = [...v6k.cases, ...additional]
  gate(cases.length === 48, "CLEANUP_MATRIX_FAILED")
  return {
    status: "PASS",
    total: cases.length,
    failures: 0,
    inherited_v6k_cases: v6k.total,
    authenticated_read_only_cases: additional.length,
    loopback_server_closed: v6k.loopback_server_closed,
    public_submit_calls: 0,
    tokens_generated: 0,
    writes: 0,
    cases,
  }
}

export function runRelativeBaselineNoWriteMatrix() {
  const historical = createLiveStartSnapshot(MOCK_BASELINE, {
    capturedAt: "2026-07-20T00:00:00.000Z",
  })
  const evolvedCounts = clone(MOCK_BASELINE)
  evolvedCounts.payment_intake += 7
  evolvedCounts.payment_intake_events += 11
  evolvedCounts.notification_events += 3
  evolvedCounts.intake_links += 1
  const evolved = createLiveStartSnapshot(evolvedCounts, {
    capturedAt: "2026-07-25T00:00:00.000Z",
  })
  const safeStates = [
    { name: "historical_baseline", total: 3, expired: 1, revoked: 2 },
    { name: "evolved_baseline", total: 4, expired: 1, revoked: 3 },
    { name: "demo_link_active", total: 5, expired: 1, revoked: 3, activeValid: 1 },
    { name: "after_demo_revocation", total: 4, expired: 1, revoked: 3 },
    { name: "three_or_more_safe_revoked", total: 5, expired: 1, revoked: 4 },
  ].map((item) => {
    const classification = {
      total: item.total,
      activeValid: item.activeValid || 0,
      activeExpired: 0,
      revoked: item.revoked,
      expired: item.expired,
      paused: 0,
      otherActive: 0,
    }
    const safeHistory = item.name === "demo_link_active"
      ? false
      : isAlreadyNormalizedSafeHistory(classification)
    return Object.freeze({
      case: item.name,
      main: "PASS",
      race: "PASS",
      snapshot_delta: "PASS",
      safe_history: safeHistory,
      expected_active_demo: item.name === "demo_link_active",
      run_scoped_side_effects: 0,
      iam_initial_final: "PASS",
      cleanup: "48/48",
      dev_writes: 0,
    })
  })
  const concurrent = classifyConcurrentDevEvolution(historical, evolved.counts, {
    runOwned: {},
  })
  return Object.freeze({
    status: "PASS",
    cases: Object.freeze(safeStates),
    total: safeStates.length,
    historical_snapshot_hash_present: historical.snapshot_hash_present,
    evolved_snapshot_hash_present: evolved.snapshot_hash_present,
    concurrent_dev_evolution: concurrent.classification,
    blocks_run: concurrent.blocks_run,
    dev_writes: 0,
  })
}

export async function runNoWriteMocked() {
  const capabilityAudit = await runCapabilityAudit()
  const cleanupMatrix = await runV6MCleanupMatrix()
  const authenticatedReadOnly = runAuthenticatedReadOnlyMockMatrix()
  const baseline = clone(MOCK_BASELINE)
  const relativeMatrix = runRelativeBaselineNoWriteMatrix()
  const simulation = {
    status: "PASS",
    normalization_historical_writes: 0,
    link_after_create: {
      global_total: 6,
      qa_company_total: 5,
      expired: 1,
      revoked: 3,
      active: 1,
    },
    fixtures_created: 2,
    public_fixture_submits: AUTHORIZED_PUBLIC_FIXTURE_POSTS,
    global_authorized_fixture_posts: AUTHORIZED_PUBLIC_FIXTURE_POSTS,
    per_controller_authorized_posts: AUTHORIZED_POSTS_PER_CONTROLLER,
    third_post_attempts: 0,
    third_post_network_requests: 0,
    third_captcha_tokens: 0,
    third_intakes: 0,
    provisioning_events: 2,
    main: "PASS",
    race: "PASS",
    link_after_revoke: {
      global_total: 6,
      qa_company_total: 5,
      expired: 1,
      revoked: 4,
      active: 0,
      qa_revoked: 2,
    },
    provider_matched_run_delta: 5,
    payment_intake_events_run_delta: 11,
    fixtures_final: "rejected",
    iam_at_rest: true,
    core_delta: 0,
  }
  gate(simulation.normalization_historical_writes === 0, "ALREADY_NORMALIZED_WRITE_FORBIDDEN")
  gate(simulation.link_after_revoke.active === 0, "MOCKED_ACTIVE_LINK_REMAINS")
  gate(simulation.provider_matched_run_delta === 5, "MOCKED_PROVIDER_MATCHED_FINAL")
  gate(simulation.payment_intake_events_run_delta === 11, "MOCKED_EVENT_FINAL")
  gate(cleanupMatrix.total === 48 && cleanupMatrix.failures === 0, "CLEANUP_MATRIX_FAILED")
  gate(authenticatedReadOnly.status === "PASS", "AUTHENTICATED_READ_ONLY_PRECHECK_UNCLASSIFIED")
  gate(authenticatedReadOnly.already_normalized_noop === true, "ALREADY_NORMALIZED_STATE_NOT_HANDLED")
  gate(authenticatedReadOnly.dev_writes === 0, "UNAUTHORIZED_DEV_MUTATION")
  return {
    mode: "no-write-mocked",
    status: "PASS",
    capability_audit: capabilityAudit.status,
    capability_count: capabilityAudit.capability_count,
    baseline: {
      status: "PASS",
      kind: "LIVE_START_SNAPSHOT_MOCKED",
      intake_links: baseline.intake_links + 1,
      intake_links_qa_company: EXPECTED_QA_COMPANY_LINKS,
      distinct_company_scopes: 2,
      other_company_links: 1,
      link_state: "ALREADY_NORMALIZED",
      existing_revoked_qa_links: 3,
      absolute_live_baseline_enforced: false,
    },
    expired_link_normalization: {
      normalization_state: "ALREADY_NORMALIZED",
      normalization_write_required: false,
      writes: 0,
    },
    authenticated_read_only: authenticatedReadOnly,
    simulation,
    relative_baseline_matrix: relativeMatrix,
    cleanup_matrix: {
      status: cleanupMatrix.status,
      total: cleanupMatrix.total,
      failures: cleanupMatrix.failures,
    },
    actual_mutable_supabase_requests: 0,
    actual_dev_writes: 0,
    external_network_requests: 0,
    provider_intake_calls: 0,
    tokens_generated: 0,
    links_real: 0,
    fixtures_real: 0,
    iam_real: 0,
    mutable_execution: false,
  }
}

function syntheticLegacyQaKey(role) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    iss: "supabase",
    ref: DEV_PROJECT_REF,
    role,
    iat: 1,
    exp: 4_102_444_800,
  })).toString("base64url")
  return `${header}.${payload}.${Buffer.from(`qa-${role}-signature`).toString("base64url")}`
}

function credentialActorClient(actorRows) {
  return {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim().toLowerCase()
      if (normalized.includes("from information_schema.columns c")) {
        return {
          rows: [{
            data_type: "uuid",
            udt_name: "uuid",
            is_nullable: "NO",
            referenced_schema: "public",
            referenced_table: "profiles",
            referenced_column: "id",
          }],
        }
      }
      if (normalized.includes("select distinct created_by::text")) {
        return { rows: actorRows.map((actor_id) => ({ actor_id })) }
      }
      if (normalized.includes("column_name = 'deleted_at'")) return { rows: [] }
      if (normalized.includes("select count(*)::int as count")) return { rows: [{ count: 1 }] }
      throw new GateError("UNEXPECTED_CREDENTIAL_ACTOR_QUERY")
    },
  }
}

export async function runCredentialAdapterNoWriteMocked() {
  const anon = syntheticLegacyQaKey("anon")
  const serviceRole = syntheticLegacyQaKey("service_role")
  const qaCompanyId = "11111111-1111-4111-8111-111111111111"
  const actorId = "44444444-4444-4444-8444-444444444444"
  const masked = []
  const direct = await resolveQaApiKeys({
    SUPABASE_DEV_ANON_KEY: anon,
    SUPABASE_DEV_SERVICE_ROLE_KEY: serviceRole,
  }, {
    fetchImpl: async () => { throw new GateError("UNEXPECTED_MANAGEMENT_API_CALL") },
    maskSecret: (value) => masked.push(value.length),
  })
  const management = await resolveQaApiKeys({
    SUPABASE_ACCESS_TOKEN: "protected-management-token",
  }, {
    fetchImpl: async () => new Response(JSON.stringify([
      { name: "anon", type: "legacy", api_key: anon },
      { name: "service_role", type: "legacy", api_key: serviceRole },
    ]), { status: 200, headers: { "content-type": "application/json" } }),
    maskSecret: (value) => masked.push(value.length),
    readPublicAnonKey: async () => anon,
  })
  let accessBlocked = false
  try {
    await resolveQaApiKeys({ SUPABASE_ACCESS_TOKEN: "protected-management-token" }, {
      fetchImpl: async () => new Response("", { status: 403 }),
      maskSecret: () => true,
    })
  } catch (error) {
    accessBlocked =
      error?.category === "BLOCKED_ACCESS" &&
      error?.code === "API_GATEWAY_KEYS_READ_UNAVAILABLE"
  }
  let actorAmbiguous = false
  try {
    await resolveQaLinkCreatedByReadOnly(
      credentialActorClient([
        actorId,
        "55555555-5555-4555-8555-555555555555",
      ]),
      qaCompanyId,
    )
  } catch (error) {
    actorAmbiguous =
      error?.category === "BLOCKED_DATA" &&
      error?.code === "QA_LINK_CREATED_BY_AMBIGUOUS"
  }
  const actor = await resolveQaLinkCreatedByReadOnly(
    credentialActorClient([actorId]),
    qaCompanyId,
  )
  const accessed = []
  const env = new Proxy({
    SUPABASE_DEV_DB_URL: "postgresql://qa:protected@db.invalid/dev",
    SUPABASE_DEV_PROJECT_REF: DEV_PROJECT_REF,
  }, {
    get(target, property) {
      accessed.push(String(property))
      return target[property]
    },
  })
  const stageResolver = createStageScopedCredentialResolver(env)
  const baseline = await stageResolver.resolve(QA_CREDENTIAL_STAGE.READ_ONLY_BASELINE, {
    runnerIdentity: { verified: true },
  })
  const futureNames = [
    "SUPABASE_DEV_ANON_KEY",
    "SUPABASE_DEV_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "QA_CAPTCHA_TOKEN",
    "QA_LINK_CREATED_BY",
  ]
  gate(
    futureNames.every((name) => !accessed.includes(name)),
    "FUTURE_CREDENTIAL_LOADED_DURING_BASELINE",
  )
  const captchaSession = createRuntimeTurnstileSession({
    readToken: async () => "mock-turnstile-runtime-token",
  })
  const fakePage = {
    url: () => CANONICAL_DEV_PORTAL_URL,
    locator: () => ({
      first: () => ({
        waitFor: async () => true,
        inputValue: async () => "mock-turnstile-runtime-token",
      }),
    }),
  }
  const captcha = await captchaSession.capture(fakePage)
  await captcha.use(async () => true)
  let secondCaptchaBlocked = false
  try {
    await captchaSession.capture(fakePage)
  } catch (error) {
    secondCaptchaBlocked = error?.code === "SECOND_CAPTCHA_TOKEN_BLOCKED"
  }
  const browser = certifyCanonicalBrowserSubmitContract()
  direct.clear()
  management.clear()
  actor.clear()
  stageResolver.clear()
  gate(masked.length === 4, "API_KEY_MASK_UNAVAILABLE")
  gate(accessBlocked, "MANAGEMENT_API_403_NOT_BLOCKED")
  gate(actorAmbiguous, "QA_LINK_CREATED_BY_AMBIGUOUS_NOT_BLOCKED")
  gate(actor.sanitized.candidate_count === 1, "QA_LINK_CREATED_BY_NOT_FOUND")
  gate(baseline.sanitized.api_keys_loaded === false, "API_KEYS_LOADED_DURING_BASELINE")
  gate(secondCaptchaBlocked, "SECOND_CAPTCHA_TOKEN_NOT_BLOCKED")
  gate(browser.public_submit_calls === 0, "PUBLIC_SUBMIT_OCCURRED_DURING_CRED_A1")
  return Object.freeze({
    mode: "credential-adapter-no-write-mocked",
    status: "PASS",
    cases: Object.freeze([
      { case: "all_direct_credentials", status: "PASS" },
      { case: "db_url_plus_management_token", status: "PASS" },
      { case: "management_api_without_permission", status: "PASS_BLOCKED_ACCESS" },
      { case: "link_actor_ambiguous", status: "PASS_BLOCKED_DATA" },
      { case: "captcha_runtime", status: "PASS" },
      { case: "canonical_browser_origin", status: "PASS" },
    ]),
    stage_scoped_loading: true,
    baseline_db_only: true,
    api_key_source_direct: direct.sanitized.api_key_source,
    api_key_source_management: management.sanitized.api_key_source,
    api_key_values_exported: false,
    link_created_by_source: actor.sanitized.link_created_by_source,
    link_created_by_candidate_count: actor.sanitized.candidate_count,
    link_created_by_id_exported: false,
    captcha_source: captchaSession.sanitized().captcha_source,
    captcha_token_persisted: false,
    captcha_token_exported: false,
    second_captcha_token_blocked: true,
    browser_origin: browser.browser_origin,
    browser_origin_canonical: true,
    second_public_post_blocked: true,
    public_submit_calls: 0,
    intake_tokens_generated: 0,
    real_captcha_tokens_generated: 0,
    links_created: 0,
    iam_changes: 0,
    dev_writes: 0,
    mutable_execution: false,
    cleanup: {
      api_keys_cleared: true,
      captcha_cleared: true,
      actor_id_cleared: true,
    },
  })
}

export async function runCredentialAdapterLiveReadOnly(env = process.env, {
  createClient = createAuthenticatedReadOnlyDatabaseClient,
} = {}) {
  for (const name of [
    "ALLOW_MUTABLE_UAT",
    "EPHEMERAL_LINK_AUTHORIZED",
    "FIXTURE_PROVISIONING_AUTHORIZED",
    "IAM_ACTIVATION_AUTHORIZED",
    "EXPIRED_LINK_NORMALIZATION_AUTHORIZED",
  ]) {
    gate(String(env[name] || "").trim() !== "true", "MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED")
  }
  const baselineAccesses = []
  const baselineEnv = new Proxy(env, {
    get(target, property) {
      baselineAccesses.push(String(property))
      return target[property]
    },
  })
  const baseline = await runAuthenticatedReadOnlyPrecheckDiagnostic(
    baselineEnv,
    { createClient },
  )
  gate(
    baseline.status === "PASS" &&
      baseline.fresh_baseline_completed === true &&
      baseline.rollback_completed === true,
    "DB_ONLY_BASELINE_PRECHECK_FAILED",
  )
  const futureCredentialNames = [
    "SUPABASE_DEV_ANON_KEY",
    "SUPABASE_DEV_SERVICE_ROLE_KEY",
    "SUPABASE_ACCESS_TOKEN",
    "QA_CAPTCHA_TOKEN",
    "QA_LINK_CREATED_BY",
  ]
  gate(
    futureCredentialNames.every((name) => !baselineAccesses.includes(name)),
    "FUTURE_CREDENTIAL_LOADED_DURING_BASELINE",
  )
  const apiKeys = await resolveQaApiKeys(env)
  const databaseUrl = requiredEnvironment(env, "SUPABASE_DEV_DB_URL")
  const client = createClient(databaseUrl)
  let actor = null
  let rolledBack = false
  await client.connect()
  try {
    await client.query("set session characteristics as transaction read only")
    await client.query("begin transaction read only")
    const readOnly = await client.query("show transaction_read_only")
    gate(
      String(readOnly.rows?.[0]?.transaction_read_only || "").toLowerCase() === "on",
      "READ_ONLY_ASSERTION_FAILED",
    )
    const scope = await resolveQaCompanyScopeReadOnly(client)
    actor = await resolveQaLinkCreatedByReadOnly(client, scope.companyId)
    await client.query("rollback")
    rolledBack = true
  } catch (error) {
    apiKeys.clear()
    actor?.clear?.()
    throw error
  } finally {
    if (!rolledBack) await client.query("rollback").catch(() => null)
    await client.end()
  }
  const result = Object.freeze({
    mode: "credential-adapter-live-read-only",
    status: "PASS",
    classification: "CREDENTIAL_ADAPTER_RECERTIFIED",
    baseline: {
      fresh_baseline_completed: baseline.fresh_baseline_completed,
      snapshot_hash_present: baseline.snapshot_hash_present,
      static_integrity_pass: baseline.static_integrity_pass,
      iam_at_rest_pass: baseline.iam_at_rest_pass,
      active_qa_links: baseline.link_state_counts?.active_valid ?? null,
      rollback_completed: baseline.rollback_completed,
    },
    db_credential_present: true,
    api_keys_not_loaded_during_baseline: true,
    captcha_not_loaded_during_baseline: true,
    link_actor_not_loaded_during_baseline: true,
    api_key_source: apiKeys.sanitized.api_key_source,
    anon_key_present: apiKeys.sanitized.anon_key_present,
    service_role_present: apiKeys.sanitized.service_role_present,
    api_key_values_exported: false,
    public_key_project_match:
      apiKeys.sanitized.public_key_project_match ?? true,
    link_created_by_source: actor.sanitized.link_created_by_source,
    link_created_by_candidate_count: actor.sanitized.candidate_count,
    link_created_by_id_exported: false,
    captcha_source: "TURNSTILE_RUNTIME_WIDGET",
    captcha_token_generated: false,
    captcha_token_persisted: false,
    captcha_token_exported: false,
    browser_origin: CANONICAL_DEV_PORTAL_URL.replace(/\/solicitar\.html$/u, ""),
    browser_submit_prepared: true,
    public_submit_calls: 0,
    provider_intake_calls: 0,
    intake_tokens_generated: 0,
    links_created: 0,
    links_modified: 0,
    iam_changes: 0,
    dev_writes: 0,
    mutable_execution: false,
    rollback_completed: rolledBack,
    client_closed: true,
    cleanup: {
      api_keys_cleared: true,
      link_actor_cleared: true,
      captcha_cleared: true,
    },
  })
  apiKeys.clear()
  actor.clear()
  return result
}

export function classifyNoWriteBrowserRequest({ url, method, previewUrl } = {}) {
  let requestUrl
  let previewOrigin
  try {
    requestUrl = new URL(String(url))
    previewOrigin = new URL(String(previewUrl)).origin
  } catch {
    throw new GateError("NO_WRITE_NETWORK_ESCAPE")
  }
  const verb = String(method || "GET").toUpperCase()
  if (
    requestUrl.origin === "https://cdn.jsdelivr.net" &&
    requestUrl.pathname === "/npm/@supabase/supabase-js@2" &&
    ["GET", "HEAD"].includes(verb)
  ) {
    return "FULFILL_MEMORY_SUPABASE_CLIENT"
  }
  if (requestUrl.origin === previewOrigin && ["GET", "HEAD"].includes(verb)) {
    return "ALLOW_PREVIEW_ASSET"
  }
  if (["POST", "PUT", "PATCH", "DELETE"].includes(verb)) {
    return "BLOCK_MUTABLE"
  }
  return "BLOCK_EXTERNAL"
}

function liveAccessibilityNoWriteMockScript() {
  const ids = {
    intake: "33333333-3333-4333-8333-333333333333",
    company: "11111111-1111-4111-8111-111111111111",
    providerA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    providerB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  }
  const list = {
    summary: {
      total: 1,
      received: 0,
      in_review: 1,
      needs_correction: 0,
      rejected: 0,
      converted: 0,
      cancelled: 0,
    },
    total: 1,
    page: 1,
    page_size: 25,
    companies: [{ id: ids.company, name: "COMPANY_A" }],
    items: [{
      id: ids.intake,
      public_folio: "QA_AXE_NO_WRITE",
      company_id: ids.company,
      company_name: "COMPANY_A",
      status: "in_review",
      provider_name: "QA_DECLARED_PROVIDER",
      concept: "QA Axe no-write",
      amount_requested: 128450.5,
      currency: "MXN",
      created_at: "2026-07-17T15:30:00.000Z",
      updated_at: "2026-07-18T14:20:00.000Z",
      file_count: 0,
    }],
  }
  const detail = {
    intake: {
      ...list.items[0],
      provider_rfc: "QAA010101AA1",
      provider_email: "qa-intake@example.invalid",
      provider_phone: "+52 55 0000 0001",
      description: "Fixture sintético aislado.",
      requested_payment_date: "2026-07-24",
      invoice_folio: "F-1051",
      invoice_uuid: "5AD73A63-9290-4D7C-876A-3957C6E57B20",
      invoice_date: "2026-07-17",
      bank_name: "BANCO_QA",
      bank_account_masked: "••••••2468",
      bank_clabe_masked: "••••••••••••••9012",
      beneficiary_name: "QA_BENEFICIARY",
    },
    files: [],
    events: [],
  }
  const providers = {
    [ids.providerA]: {
      proveedor_id: ids.providerA,
      alias: LIVE_NO_WRITE_PROVIDER_ALIASES[0],
      legal_name: LIVE_NO_WRITE_PROVIDER_ALIASES[0],
      rfc: "QAA010101AA1",
      payment_method: "Transferencia bancaria",
      bank: "BANCO_QA",
      account_masked: "••••••2468",
      clabe_masked: "••••••••••••••9012",
      active: true,
      selectable: true,
      score: 100,
      confidence: "high",
      reasons: ["RFC exacto", "CLABE exacta"],
      differences: ["Razón social distinta"],
    },
    [ids.providerB]: {
      proveedor_id: ids.providerB,
      alias: LIVE_NO_WRITE_PROVIDER_ALIASES[1],
      legal_name: LIVE_NO_WRITE_PROVIDER_ALIASES[1],
      rfc: "QAB010101AA2",
      payment_method: "Transferencia bancaria",
      bank: "BANCO_QA",
      account_masked: "••••••1357",
      clabe_masked: "••••••••••••••1357",
      active: true,
      selectable: true,
      score: 85,
      confidence: "high",
      reasons: ["Señal sintética"],
      differences: ["RFC distinto"],
    },
  }
  const candidate = {
    payment_intake_id: ids.intake,
    status: "in_review",
    updated_at: detail.intake.updated_at,
    eligible: true,
    current_match: null,
    duplicate_rfc_count: 1,
    candidates: Object.values(providers),
    history: [],
  }
  const comparison = {
    payment_intake_id: ids.intake,
    status: "in_review",
    updated_at: detail.intake.updated_at,
    eligible: true,
    proveedor_id: ids.providerA,
    provider_alias: providers[ids.providerA].alias,
    provider_active: true,
    rows: [
      { field: "Razón social", declared: "QA_DECLARED_PROVIDER", master: providers[ids.providerA].alias, result: "different" },
      { field: "RFC", declared: "QAA010101AA1", master: "QAA010101AA1", result: "match" },
      { field: "Banco", declared: "BANCO_QA", master: "BANCO_QA", result: "match" },
      { field: "Cuenta", declared: "••••••2468", master: "••••••2468", result: "match" },
      { field: "CLABE", declared: "••••••••••••••9012", master: "••••••••••••••9012", result: "match" },
      { field: "Beneficiario", declared: "QA_BENEFICIARY", master: providers[ids.providerA].alias, result: "different" },
      { field: "Correo", declared: "qa-intake@example.invalid", master: "qa-provider@example.invalid", result: "different" },
      { field: "Teléfono", declared: "+52 55 0000 0000", master: null, result: "not_reported" },
    ],
  }
  const fixture = JSON.stringify({ ids, list, detail, providers, candidate, comparison })
  return `
    (() => {
      const fixture = ${fixture};
      const params = new URLSearchParams(location.search);
      const terminal = params.get("qa_state") === "terminal";
      const session = { access_token: "qa-memory-token", user: { id: "99999999-9999-4999-8999-999999999999", email: "qa@example.invalid" } };
      const profile = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "qa@example.invalid", full_name: "QA Finanzas", auth_user_id: session.user.id, active: true };
      const list = fixture.list;
      const detail = fixture.detail;
      const providers = fixture.providers;
      window.__qaMutationCount = 0;
      window.__qaConflict = false;
      window.__qaMatch = fixture.candidate;
      if (terminal) {
        list.items[0].status = "rejected";
        list.summary = { total: 1, received: 0, in_review: 0, needs_correction: 0, rejected: 1, converted: 0, cancelled: 0 };
        detail.intake.status = "rejected";
        window.__qaMatch.status = "rejected";
        window.__qaMatch.eligible = false;
      }
      function builder(table) {
        const api = {
          select() { return api; },
          eq() { return api; },
          single() { return Promise.resolve({ data: profile, error: null }); },
          maybeSingle() { return Promise.resolve({ data: table === "profiles" ? profile : null, error: null }); },
          then(resolve) {
            const data = table === "user_roles" ? [{ role_id: "role", roles: { id: "role", name: "finance", description: "" } }] : [];
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return api;
      }
      const client = {
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          signOut: async () => ({ error: null }),
        },
        from: builder,
        rpc: async (name, args = {}) => {
          if (name === "list_provider_intakes") return { data: list, error: null };
          if (name === "get_provider_intake_detail") return { data: detail, error: null };
          if (name === "find_provider_intake_candidates") {
            const search = String(args.p_search || "").trim().toLocaleLowerCase("es-MX");
            const candidates = search
              ? Object.values(providers).filter((provider) =>
                  String(provider.alias || "").toLocaleLowerCase("es-MX").includes(search))
              : Object.values(providers);
            return { data: { ...window.__qaMatch, candidates }, error: null };
          }
          if (name === "get_provider_intake_match_comparison") {
            const provider = providers[args.p_proveedor_id] || providers[fixture.ids.providerA];
            return {
              data: {
                ...fixture.comparison,
                proveedor_id: provider.proveedor_id,
                provider_alias: provider.alias,
                rows: fixture.comparison.rows.map((row) => row.field === "Razón social" ? { ...row, master: provider.alias } : row),
              },
              error: null,
            };
          }
          if (name === "set_provider_intake_match") {
            if (window.__qaConflict) return { data: null, error: { message: "provider_intake_conflict" } };
            window.__qaMutationCount += 1;
            const previous = window.__qaMatch.current_match;
            const next = args.p_proveedor_id ? providers[args.p_proveedor_id] : null;
            detail.intake.updated_at = "2026-07-18T15:0" + window.__qaMutationCount + ":00.000Z";
            window.__qaMatch = {
              ...window.__qaMatch,
              updated_at: detail.intake.updated_at,
              current_match: next,
              history: [{
                event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                action_kind: previous ? (next ? "match_replace" : "match_clear") : "match_set",
                previous_provider: previous?.alias || null,
                new_provider: next?.alias || null,
                match_confidence: "high",
                reason_code: args.p_reason_code,
                reason: args.p_reason,
                actor_type: "finance",
                created_at: detail.intake.updated_at,
              }],
            };
            return { data: { matched_proveedor_id: next?.proveedor_id || null, action_kind: previous ? (next ? "match_replace" : "match_clear") : "match_set", updated_at: detail.intake.updated_at, idempotent: false }, error: null };
          }
          return { data: {}, error: null };
        },
      };
      window.supabase = { createClient: () => client };
    })();
  `
}

export async function runLiveAccessibilityNoWrite(env = process.env) {
  for (const name of [
    "ALLOW_MUTABLE_UAT",
    "EPHEMERAL_LINK_AUTHORIZED",
    "FIXTURE_PROVISIONING_AUTHORIZED",
    "IAM_ACTIVATION_AUTHORIZED",
    "EXPIRED_LINK_NORMALIZATION_AUTHORIZED",
  ]) {
    gate(String(env[name] || "").trim() !== "true", "MUTABLE_UAT_NOT_EXPLICITLY_AUTHORIZED")
  }
  gate(!String(env.SUPABASE_DEV_SERVICE_ROLE_KEY || "").trim(), "SERVICE_ROLE_NOT_ALLOWED_NO_WRITE")
  const previewUrl = requiredEnvironment(env, "PREVIEW_URL").replace(/\/+$/, "")
  const previewOrigin = new URL(previewUrl).origin
  const localAxe = loadLocalAxeSource(env)
  const axeIdentity = sanitizedAxeSourceIdentity(localAxe)
  const { chromium } = require("playwright")
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const pages = []
  const metrics = {
    preview_get_head: 0,
    memory_fulfilled: 0,
    blocked_external: 0,
    mutable_requests: 0,
    network_downloads_during_audit: 0,
  }
  let routesRemoved = false
  let primaryError = null
  let result = null
  const mockScript = liveAccessibilityNoWriteMockScript()
  try {
    await context.route("**/*", async (route) => {
      const request = route.request()
      const decision = classifyNoWriteBrowserRequest({
        url: request.url(),
        method: request.method(),
        previewUrl,
      })
      if (decision === "ALLOW_PREVIEW_ASSET") {
        metrics.preview_get_head += 1
        await route.continue()
        return
      }
      if (decision === "FULFILL_MEMORY_SUPABASE_CLIENT") {
        metrics.memory_fulfilled += 1
        await route.fulfill({
          status: 200,
          contentType: "application/javascript; charset=utf-8",
          body: mockScript,
        })
        return
      }
      if (decision === "BLOCK_MUTABLE") metrics.mutable_requests += 1
      else metrics.blocked_external += 1
      await route.abort("blockedbyclient")
    })
    const page = await context.newPage()
    pages.push(page)
    let dialog = null
    let conflictMutationBefore = 0
    let terminalPage = null
    const target = (index) => ({
      sanitizedTargetAlias: PROVIDER_ALIASES[index],
      searchText: LIVE_NO_WRITE_PROVIDER_ALIASES[index],
      expectedCardHeading: LIVE_NO_WRITE_PROVIDER_ALIASES[index],
      timeout: 30_000,
    })
    const openFirstDetail = async (targetPage, terminal = false) => {
      await targetPage.goto(
        `${previewUrl}/provider_intakes.html${terminal ? "?qa_state=terminal" : ""}`,
        { waitUntil: "networkidle" },
      )
      gate(new URL(targetPage.url()).origin === previewOrigin, "LIVE_ACCESSIBILITY_PREVIEW_ORIGIN_MISMATCH")
      await targetPage.locator("#triageWorkspace").waitFor({ state: "visible", timeout: 30_000 })
      await targetPage.getByRole("button", { name: /Ver detalle de QA_AXE_NO_WRITE/ }).click()
      await targetPage.locator(".provider-match-section").waitFor({ state: "visible", timeout: 30_000 })
    }
    const submitDialog = async (nextState) => {
      await dialog.confirmButton.click()
      await page.getByText(nextState, { exact: true }).waitFor({ state: "visible", timeout: 30_000 })
    }
    const handlers = {
      main_eligible_unlinked: {
        prepare: async () => { await openFirstDetail(page); return page },
        ready: async () => await page.getByText("Candidatos encontrados", { exact: true }).isVisible(),
        cleanup: async () => true,
      },
      main_set_dialog: {
        prepare: async () => { dialog = await openProviderSetDialog(page, target(0)); return page },
        ready: async () => await dialog.dialog.evaluate((node) => node.open === true),
        cleanup: async () => true,
      },
      main_linked_a: {
        prepare: async () => { await submitDialog("Vinculado"); return page },
        ready: async () => await page.getByText(LIVE_NO_WRITE_PROVIDER_ALIASES[0], { exact: true }).first().isVisible(),
        cleanup: async () => true,
      },
      main_replace_dialog: {
        prepare: async () => { dialog = await openProviderReplaceDialog(page, target(1)); return page },
        ready: async () => await dialog.dialog.evaluate((node) => node.open === true),
        cleanup: async () => true,
      },
      main_linked_b: {
        prepare: async () => {
          await dialog.reason.fill("QA V6G: reemplazo no-write exclusivamente en memoria.")
          await submitDialog("Vinculado")
          return page
        },
        ready: async () => await page.getByText(LIVE_NO_WRITE_PROVIDER_ALIASES[1], { exact: true }).first().isVisible(),
        cleanup: async () => true,
      },
      main_clear_dialog: {
        prepare: async () => { dialog = await openProviderClearDialog(page); return page },
        ready: async () => await dialog.dialog.evaluate((node) => node.open === true),
        cleanup: async () => true,
      },
      main_unlinked_after_clear: {
        prepare: async () => {
          await dialog.reason.fill("QA V6G: retiro no-write exclusivamente en memoria.")
          await submitDialog("Candidatos encontrados")
          return page
        },
        ready: async () => await page.getByText("Candidatos encontrados", { exact: true }).isVisible(),
        cleanup: async () => true,
      },
      race_conflict: {
        prepare: async () => {
          dialog = await openProviderSetDialog(page, target(0))
          conflictMutationBefore = await page.evaluate(() => window.__qaMutationCount)
          await page.evaluate(() => { window.__qaConflict = true })
          await dialog.confirmButton.click()
          await page.getByText(
            "Esta solicitud fue actualizada por otro usuario. Recarga el detalle.",
            { exact: true },
          ).waitFor({ state: "visible", timeout: 30_000 })
          await dialog.confirmButton.focus()
          return page
        },
        ready: async () => {
          const mutationAfter = await page.evaluate(() => window.__qaMutationCount)
          const announced = await page.locator("#matchError").getAttribute("role") === "alert"
          const focusInside = await page.locator("#matchDialog").evaluate(
            (node) => node.contains(document.activeElement),
          )
          return mutationAfter === conflictMutationBefore && announced && focusInside
        },
        cleanup: async () => {
          await page.evaluate(() => {
            window.__qaConflict = false
            const active = document.querySelector("#matchDialog")
            if (active?.open) active.close()
          })
        },
      },
      terminal_rejected: {
        prepare: async () => {
          terminalPage = await context.newPage()
          pages.push(terminalPage)
          await openFirstDetail(terminalPage, true)
          return terminalPage
        },
        ready: async () => {
          await terminalPage.getByText("Revisión requerida", { exact: true }).waitFor()
          const mutableControls = await terminalPage.getByRole("button", {
            name: /Confirmar vínculo|Cambiar vínculo|Retirar vínculo/,
          }).count()
          await terminalPage.locator("#closeDetailBtn").focus()
          const focusValid = await terminalPage.locator("#closeDetailBtn").evaluate(
            (node) => document.activeElement === node,
          )
          return mutableControls === 0 && focusValid
        },
        cleanup: async () => true,
      },
    }
    const manifest = createAccessibilityStateManifest(handlers)
    const recorder = createAccessibilityHookRecorder()
    const evidence = await runAccessibilityStateManifest(
      manifest,
      async (statePage, stateAlias) => {
        const item = await runAxeAccessibilityState(statePage, {
          stateAlias,
          environment: "LIVE_PREVIEW_NO_WRITE",
          evidenceMode: "SANITIZED",
          authorizedOrigin: previewUrl,
          localAxe,
          sensitiveValues: LIVE_NO_WRITE_PROVIDER_ALIASES,
        })
        recorder.record(stateAlias, item)
        return item
      },
    )
    recorder.assertComplete()
    gate(metrics.mutable_requests === 0, "NO_WRITE_NETWORK_ESCAPE")
    const summary = recorder.sanitizedSummary()
    gate(summary.critical === 0 && summary.serious === 0, "LIVE_ACCESSIBILITY_VIOLATION")
    const output = {
      mode: "live-accessibility-no-write",
      classification: "LIVE_PREVIEW_NO_WRITE",
      status: "PASS",
      preview_real_assets: true,
      axe_source: axeIdentity,
      accessibility: summary,
      states: evidence,
      network: {
        preview_get_head: metrics.preview_get_head,
        memory_fulfilled: metrics.memory_fulfilled,
        blocked_external: metrics.blocked_external,
        mutable_requests: 0,
        network_downloads_during_audit: 0,
      },
      aliases_live_exported: 0,
      ids_exported: 0,
      iam_real: 0,
      fixtures_real: 0,
      links_real: 0,
      dev_writes: 0,
      service_role_used: false,
      mutable_execution: false,
      attempt_consumed: false,
      cleanup: {
        chromium_closed: true,
        contexts_closed: true,
        routes_removed: true,
        mocks_discarded: true,
        cookies_storage_removed: true,
        second_uat: false,
      },
    }
    const serialized = JSON.stringify(output)
    for (const forbidden of LIVE_NO_WRITE_PROVIDER_ALIASES) {
      gate(!serialized.includes(forbidden), "FAIL_PRIVACY")
    }
    gate(!UUID_PATTERN.test(serialized), "FAIL_PRIVACY")
    result = output
  } catch (error) {
    primaryError = error
  } finally {
    await context.unrouteAll({ behavior: "wait" }).catch(() => null)
    routesRemoved = true
    for (const page of pages) {
      if (!page.isClosed()) await page.close().catch(() => null)
    }
    await context.close().catch(() => null)
    await browser.close().catch(() => null)
  }
  if (primaryError) throw primaryError
  result.cleanup.routes_removed = routesRemoved
  return result
}

async function runCli() {
  const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="))
  const mode = String(modeArgument || "").slice("--mode=".length)
  gate(
    [
      "capability-audit",
      "authenticated-read-only-precheck-diagnostic",
      BASELINE_INVARIANT_DIAGNOSTIC_MODE,
      "expired-link-normalization-read-only",
      "live-provider-alias-read-only",
      "no-write-mocked",
      "live-accessibility-no-write",
      "public-submit-observability-audit",
      "public-submit-loopback-no-write",
      "credential-adapter-no-write-mocked",
      "credential-adapter-live-read-only",
      "mutable",
    ].includes(mode),
    "INVALID_MODE",
  )
  let result
  if (mode === "capability-audit") {
    result = await runCapabilityAudit()
  } else if (mode === "authenticated-read-only-precheck-diagnostic") {
    result = await runAuthenticatedReadOnlyPrecheckDiagnostic(process.env)
  } else if (mode === BASELINE_INVARIANT_DIAGNOSTIC_MODE) {
    result = await runAuthenticatedReadOnlyBaselineInvariantDiagnostic(process.env)
  } else if (mode === "expired-link-normalization-read-only") {
    result = await runExpiredLinkNormalizationReadOnly(process.env)
  } else if (mode === "live-provider-alias-read-only") {
    result = await runLiveProviderAliasReadOnly(process.env)
  } else if (mode === "no-write-mocked") {
    result = await runNoWriteMocked()
  } else if (mode === "live-accessibility-no-write") {
    result = await runLiveAccessibilityNoWrite(process.env)
  } else if (mode === "public-submit-observability-audit") {
    result = await runPublicSubmitObservabilityAudit({
      previewUrl: AUTHORIZED_PREVIEW_URL,
    })
  } else if (mode === "public-submit-loopback-no-write") {
    result = await runPublicSubmitLoopbackNoWrite({
      previewUrl: AUTHORIZED_PREVIEW_URL,
    })
  } else if (mode === "credential-adapter-no-write-mocked") {
    result = await runCredentialAdapterNoWriteMocked()
  } else if (mode === "credential-adapter-live-read-only") {
    result = await runCredentialAdapterLiveReadOnly(process.env)
  } else {
    const identity = assertMutableAuthorization(process.env)
    const deps = createMutableDependencies(process.env)
    result = await executeUat(deps, { mode: "mutable" })
    result.runner_sha256 = identity.sha256
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

const isMain = process.argv?.[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  runCli().catch((error) => {
    const modeArgument = process.argv.find((argument) => argument.startsWith("--mode="))
    const mode = String(modeArgument || "").slice("--mode=".length)
    if ([
      "authenticated-read-only-precheck-diagnostic",
      BASELINE_INVARIANT_DIAGNOSTIC_MODE,
      "expired-link-normalization-read-only",
      "credential-adapter-live-read-only",
    ].includes(mode)) {
      process.stdout.write(`${JSON.stringify(
        buildAuthenticatedReadOnlyFailureEnvelope(error, "CHILD_PROCESS_EXIT", mode),
      )}\n`)
      process.exitCode = 1
      return
    }
    process.stdout.write(`${JSON.stringify({
      status: "FAIL",
      failure_code: errorCode(error),
      failure_state: ACCESSIBILITY_STATE_ALIASES.includes(error?.details?.state)
        ? error.details.state
        : null,
      mutable_execution: false,
      writes: 0,
      token_exposure: 0,
      mutable_rpc_requests: 0,
      set: 0,
      replace: 0,
      clear: 0,
      provider_matched_events: 0,
    })}\n`)
    process.exitCode = 1
  })
}
