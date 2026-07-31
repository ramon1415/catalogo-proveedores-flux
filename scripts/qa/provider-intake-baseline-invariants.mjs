const SAFE_ENUM = /^[A-Z][A-Z0-9_:-]{0,63}$/u
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu
const SECRET_PATTERN =
  /(?:postgres(?:ql)?:\/\/|eyJ[a-zA-Z0-9_-]{12,}|sb_(?:secret|publishable)_|sbp_|bearer\s+)/iu
const SQL_PATTERN =
  /\b(?:select|insert|update|delete|merge|truncate|drop|create|alter|grant|revoke|call)\b/iu
const STACK_PATTERN = /(?:\bat\s+\S+\s+\(|file:\/\/|node:internal|\.mjs:\d+:\d+)/iu
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu

export const BASELINE_INVARIANT_DIAGNOSTIC_MODE =
  "authenticated-read-only-baseline-invariant-diagnostic"

export const BASELINE_INVARIANT_CODES = Object.freeze([
  "BASELINE_SCALAR_NOT_FINITE",
  "BASELINE_SCALAR_NEGATIVE",
  "GLOBAL_LINK_COUNT_MISMATCH",
  "GLOBAL_COMPANY_SCOPE_COUNT_NOT_INTEGER",
  "GLOBAL_COMPANY_SCOPE_COUNT_INVALID",
  "LINK_STATE_TOTAL_MISMATCH",
  "LINK_STATE_ACTIVE_EXPIRED_MISMATCH",
  "LINK_STATE_EXPIRED_MISMATCH",
  "LINK_STATE_REVOKED_MISMATCH",
  "OTHER_COMPANY_LINK_MISSING",
  "IAM_QA_PRINCIPAL_COUNT_INVALID",
  "IAM_PROFILE_INACTIVE_COUNT_INVALID",
  "IAM_AUTH_BLOCKED_COUNT_INVALID",
  "IAM_ROLE_COUNT_INVALID",
  "IAM_MEMBERSHIP_COUNT_INVALID",
  "IAM_SESSION_COUNT_INVALID",
  "IAM_REFRESH_TOKEN_COUNT_INVALID",
  "STATIC_INTEGRITY_BOOLEAN_INVALID",
  "STATIC_INTEGRITY_COUNT_NONZERO",
  "LINK_STATE_UNSAFE",
  "SNAPSHOT_HASH_INVALID",
  "POST_BASELINE_ENVELOPE_OBJECT_INVALID",
  "POST_BASELINE_ENVELOPE_FIELD_MISSING",
  "POST_BASELINE_STATUS_INVALID",
  "POST_BASELINE_WRITE_DELTA_INVALID",
  "POST_BASELINE_TOKEN_FLAG_INVALID",
  "POST_BASELINE_PROVIDER_CALLS_INVALID",
  "POST_BASELINE_RAW_ERROR_FLAG_INVALID",
  "POST_BASELINE_RAW_DETAIL_FLAG_INVALID",
  "POST_BASELINE_QA_ID_EXPORTED",
  "POST_BASELINE_ROLLBACK_MISSING",
  "POST_BASELINE_CONNECTION_MISSING",
  "POST_BASELINE_TRANSACTION_MISSING",
  "POST_BASELINE_TRANSACTION_NOT_READ_ONLY",
  "POST_BASELINE_QUERY_MISSING",
  "POST_BASELINE_FRESH_CAPTURE_MISSING",
  "POST_BASELINE_SNAPSHOT_CAPTURE_MISSING",
  "POST_BASELINE_SNAPSHOT_SHAPE_INVALID",
  "POST_BASELINE_SNAPSHOT_HASH_INVALID",
  "POST_BASELINE_STATIC_INTEGRITY_INVALID",
  "POST_BASELINE_IAM_INVALID",
  "POST_BASELINE_ABSOLUTE_BASELINE_INVALID",
  "POST_BASELINE_STATE_INVALID",
  "POST_BASELINE_INITIAL_READ_ONLY_STATE_INVALID",
  "POST_BASELINE_SESSION_BOOTSTRAP_INVALID",
  "POST_BASELINE_SESSION_READ_ONLY_INVALID",
  "POST_BASELINE_QA_SCOPE_SOURCE_INVALID",
  "POST_BASELINE_QA_SCOPE_NOT_APPLIED",
  "POST_BASELINE_QA_CANDIDATE_COUNT_INVALID",
  "POST_BASELINE_GLOBAL_LINK_COUNT_NOT_INTEGER",
  "POST_BASELINE_GLOBAL_LINK_COUNT_INVALID",
  "POST_BASELINE_COMPANY_SCOPE_COUNT_NOT_INTEGER",
  "POST_BASELINE_COMPANY_SCOPE_COUNT_INVALID",
  "POST_BASELINE_QA_LINK_COUNT_NOT_INTEGER",
  "POST_BASELINE_QA_LINK_COUNT_INVALID",
  "POST_BASELINE_FAILURE_CONTEXT_MISSING",
])

const BASELINE_INVARIANT_CODE_SET = new Set(BASELINE_INVARIANT_CODES)
const ALLOWED_STAGES = new Set([
  "FRESH_BASELINE_CAPTURE",
  "RESULT_CONTRACT_VALIDATION",
  "RESULT_SERIALIZATION",
])
const ALLOWED_DIMENSIONS = new Set([
  "GLOBAL",
  "QA_COMPANY",
  "INTAKE_STATES",
  "LINK_STATE",
  "IAM",
  "SNAPSHOT",
  "ENVELOPE",
])

function valueClass(value) {
  if (value === undefined) return "missing"
  if (value === null) return "missing"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "invalid"
    return Number.isInteger(value) ? "integer" : "number"
  }
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "object") return "object"
  if (typeof value === "string" && SAFE_ENUM.test(value)) return "string"
  return "invalid"
}

function containsSensitiveString(value) {
  return UUID_PATTERN.test(value) ||
    SECRET_PATTERN.test(value) ||
    SQL_PATTERN.test(value) ||
    STACK_PATTERN.test(value) ||
    EMAIL_PATTERN.test(value)
}

export function sanitizeBaselineInvariantValue(value) {
  const classification = valueClass(value)
  if (classification === "integer" || classification === "number") {
    return Object.freeze({ value })
  }
  if (classification === "boolean") {
    return Object.freeze({ value })
  }
  if (classification === "string" && !containsSensitiveString(value)) {
    return Object.freeze({ value })
  }
  if (classification === "missing") {
    return Object.freeze({ missing: true })
  }
  if (classification === "object") {
    const values = Array.isArray(value) ? value : Object.values(value)
    return Object.freeze({
      kind: Array.isArray(value) ? "array" : "object",
      entries: values.length,
      integers: values.filter((item) => Number.isInteger(item)).length,
      booleans: values.filter((item) => typeof item === "boolean").length,
      nested: values.filter((item) => item !== null && typeof item === "object").length,
      sensitive_values_exported: false,
    })
  }
  return Object.freeze({ invalid: true, sensitive_values_exported: false })
}

function sanitizedContext(context) {
  const normalized = String(context || "").trim().toUpperCase()
  return SAFE_ENUM.test(normalized) ? normalized : "UNSPECIFIED"
}

function buildEntry({ code, condition, stage, dimension, context, actual, expected }) {
  if (!BASELINE_INVARIANT_CODE_SET.has(code)) {
    throw new Error("BASELINE_INVARIANT_CODE_UNAUTHORIZED")
  }
  if (!ALLOWED_STAGES.has(stage)) {
    throw new Error("BASELINE_INVARIANT_STAGE_UNAUTHORIZED")
  }
  if (!ALLOWED_DIMENSIONS.has(dimension)) {
    throw new Error("BASELINE_INVARIANT_DIMENSION_UNAUTHORIZED")
  }
  return Object.freeze({
    code,
    stage,
    dimension,
    context: sanitizedContext(context),
    passed: condition === true,
    actual_class: valueClass(actual),
    expected_class: valueClass(expected),
    actual_sanitized: sanitizeBaselineInvariantValue(actual),
    expected_sanitized: sanitizeBaselineInvariantValue(expected),
    sensitive_values_exported: false,
  })
}

export class BaselineInvariantViolation extends Error {
  constructor(entry, summary) {
    super("RESULT_CONTRACT_INVALID")
    this.name = "BaselineInvariantViolation"
    this.code = "RESULT_CONTRACT_INVALID"
    this.category = "RESULT_CONTRACT_INVALID"
    this.stage = entry.stage
    this.baselineInvariant = Object.freeze({
      ...summary,
      first_failed_invariant: entry.code,
      failed_invariant_stage: entry.stage,
      failed_invariant_dimension: entry.dimension,
      failed_invariant_context: entry.context,
      failed_actual_sanitized: entry.actual_sanitized,
      failed_expected_sanitized: entry.expected_sanitized,
      sensitive_values_exported: false,
    })
  }
}

export function createBaselineInvariantTracker() {
  const matrix = []
  let failed = false
  return Object.freeze({
    assert(specification) {
      if (failed) throw new Error("BASELINE_INVARIANT_SHORT_CIRCUIT_VIOLATION")
      const entry = buildEntry(specification)
      matrix.push(entry)
      if (!entry.passed) {
        failed = true
        const passed = matrix.filter((item) => item.passed).length
        throw new BaselineInvariantViolation(entry, {
          baseline_invariant_matrix: Object.freeze([...matrix]),
          last_passed_invariant: passed > 0 ? matrix[passed - 1].code : null,
          invariants_evaluated: matrix.length,
          invariants_passed: passed,
          invariants_failed: 1,
        })
      }
      return true
    },
    summary() {
      const firstFailed = matrix.find((item) => !item.passed) || null
      const passed = matrix.filter((item) => item.passed).length
      return Object.freeze({
        baseline_invariant_matrix: Object.freeze([...matrix]),
        first_failed_invariant: firstFailed?.code || null,
        last_passed_invariant: passed > 0 ? matrix[passed - 1].code : null,
        invariants_evaluated: matrix.length,
        invariants_passed: passed,
        invariants_failed: firstFailed ? 1 : 0,
        failed_invariant_stage: firstFailed?.stage || null,
        failed_invariant_dimension: firstFailed?.dimension || null,
        failed_invariant_context: firstFailed?.context || null,
        failed_actual_sanitized: firstFailed?.actual_sanitized || null,
        failed_expected_sanitized: firstFailed?.expected_sanitized || null,
        sensitive_values_exported: false,
      })
    },
  })
}

export function assertBaselineInvariant(tracker, specification) {
  if (!tracker || typeof tracker.assert !== "function") {
    throw new Error("BASELINE_INVARIANT_TRACKER_REQUIRED")
  }
  return tracker.assert(specification)
}

export function assertSanitizedBaselineInvariantEvidence(value) {
  const serialized = JSON.stringify(value || {})
  if (UUID_PATTERN.test(serialized) ||
      SECRET_PATTERN.test(serialized) ||
      SQL_PATTERN.test(serialized) ||
      STACK_PATTERN.test(serialized) ||
      EMAIL_PATTERN.test(serialized)) {
    throw new Error("BASELINE_INVARIANT_EVIDENCE_LEAKAGE")
  }
  if (value?.sensitive_values_exported !== false) {
    throw new Error("BASELINE_INVARIANT_EVIDENCE_LEAKAGE")
  }
  for (const entry of value?.baseline_invariant_matrix || []) {
    if (entry?.sensitive_values_exported !== false) {
      throw new Error("BASELINE_INVARIANT_EVIDENCE_LEAKAGE")
    }
  }
  return true
}
