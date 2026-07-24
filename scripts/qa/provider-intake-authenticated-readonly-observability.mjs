const MODE = "authenticated-read-only-precheck-diagnostic"

export const AUTHENTICATED_READ_ONLY_STAGES = Object.freeze([
  "ENVIRONMENT_VALIDATION",
  "SECRET_PRESENCE_VALIDATION",
  "DB_URL_PARSE",
  "DB_CLIENT_INITIALIZATION",
  "DB_CONNECTION",
  "INITIAL_READ_ONLY_STATE_INSPECTION",
  "SESSION_READ_ONLY_BOOTSTRAP",
  "SESSION_READ_ONLY_ASSERTION",
  "READ_ONLY_TRANSACTION_BEGIN",
  "TRANSACTION_READ_ONLY_ASSERTION",
  "DATABASE_TIME_QUERY",
  "SCHEMA_CONTRACT_INSPECTION",
  "QA_COMPANY_SCOPE_RESOLUTION",
  "INTAKE_LINKS_READ",
  "GLOBAL_LINK_BASELINE_CAPTURE",
  "LINK_STATE_CLASSIFICATION",
  "FRESH_BASELINE_CAPTURE",
  "RESULT_CONTRACT_VALIDATION",
  "ROLLBACK",
  "RESULT_SERIALIZATION",
  "CHILD_PROCESS_EXIT",
  "CALLER_RESULT_PARSE",
])

export const AUTHENTICATED_READ_ONLY_ERROR_CATEGORIES = Object.freeze([
  "BLOCKED_SECRET_UNAVAILABLE",
  "QA_COMPANY_SCOPE_NOT_FOUND",
  "QA_COMPANY_SCOPE_AMBIGUOUS",
  "QA_COMPANY_SCOPE_RESOLUTION_FAILED",
  "QA_COMPANY_SCOPE_PROTECTED_VALUE_MISMATCH",
  "QA_COMPANY_SCOPE_RESULT_INVALID",
  "DB_URL_INVALID",
  "DB_DNS_FAILED",
  "DB_NETWORK_FAILED",
  "DB_CONNECTION_FAILED",
  "DB_TLS_FAILED",
  "DB_AUTH_FAILED",
  "DB_DATABASE_NOT_FOUND",
  "DB_PERMISSION_FAILED",
  "DB_STATEMENT_TIMEOUT",
  "DB_CONNECTION_TERMINATED",
  "SCHEMA_TABLE_MISSING",
  "SCHEMA_COLUMN_MISSING",
  "SCHEMA_CONTRACT_MISMATCH",
  "READ_ONLY_ASSERTION_FAILED",
  "SESSION_READ_ONLY_BOOTSTRAP_FAILED",
  "TRANSACTION_READ_ONLY_ASSERTION_FAILED",
  "PRE_BUSINESS_QUERY_ORDER_VIOLATION",
  "READ_ONLY_ROLLBACK_FAILED",
  "PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT",
  "LINK_STATE_CONTRACT_MISMATCH",
  "ALREADY_NORMALIZED_STATE_NOT_HANDLED",
  "RESULT_CONTRACT_INVALID",
  "RESULT_JSON_PARSE_FAILED",
  "CHILD_PROCESS_EXIT_FAILED",
  "RUNNER_MODE_MISMATCH",
  "AUTHENTICATED_READ_ONLY_PRECHECK_UNCLASSIFIED",
])

const SQLSTATE_CATEGORIES = new Map([
  ["28P01", "DB_AUTH_FAILED"],
  ["3D000", "DB_DATABASE_NOT_FOUND"],
  ["42501", "DB_PERMISSION_FAILED"],
  ["42P01", "SCHEMA_TABLE_MISSING"],
  ["42703", "SCHEMA_COLUMN_MISSING"],
  ["57014", "DB_STATEMENT_TIMEOUT"],
  ["08001", "DB_CONNECTION_FAILED"],
  ["08006", "DB_CONNECTION_FAILED"],
  ["57P01", "DB_CONNECTION_TERMINATED"],
])

const NODE_CODE_CATEGORIES = new Map([
  ["ENOTFOUND", "DB_DNS_FAILED"],
  ["EAI_AGAIN", "DB_DNS_FAILED"],
  ["ECONNREFUSED", "DB_NETWORK_FAILED"],
  ["ENETUNREACH", "DB_NETWORK_FAILED"],
  ["EHOSTUNREACH", "DB_NETWORK_FAILED"],
  ["ETIMEDOUT", "DB_NETWORK_FAILED"],
  ["ECONNRESET", "DB_CONNECTION_TERMINATED"],
  ["UND_ERR_CONNECT_TIMEOUT", "DB_NETWORK_FAILED"],
  ["DEPTH_ZERO_SELF_SIGNED_CERT", "DB_TLS_FAILED"],
  ["ERR_TLS_CERT_ALTNAME_INVALID", "DB_TLS_FAILED"],
  ["CERT_HAS_EXPIRED", "DB_TLS_FAILED"],
  ["SELF_SIGNED_CERT_IN_CHAIN", "DB_TLS_FAILED"],
  ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DB_TLS_FAILED"],
  ["ERR_SSL_WRONG_VERSION_NUMBER", "DB_TLS_FAILED"],
])

const FAILURE_STATUS = new Map([
  ["RESULT_CONTRACT_INVALID", "FAIL"],
  ["RESULT_JSON_PARSE_FAILED", "FAIL"],
  ["CHILD_PROCESS_EXIT_FAILED", "FAIL"],
  ["RUNNER_MODE_MISMATCH", "FAIL"],
  ["READ_ONLY_ASSERTION_FAILED", "FAIL"],
  ["SESSION_READ_ONLY_BOOTSTRAP_FAILED", "FAIL"],
  ["TRANSACTION_READ_ONLY_ASSERTION_FAILED", "FAIL"],
  ["PRE_BUSINESS_QUERY_ORDER_VIOLATION", "BLOCKED"],
  ["READ_ONLY_ROLLBACK_FAILED", "FAIL"],
  ["PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT", "BLOCKED"],
  ["ALREADY_NORMALIZED_STATE_NOT_HANDLED", "FAIL"],
])

const STAGE_FALLBACK = new Map([
  ["ENVIRONMENT_VALIDATION", "RUNNER_MODE_MISMATCH"],
  ["SECRET_PRESENCE_VALIDATION", "BLOCKED_SECRET_UNAVAILABLE"],
  ["DB_URL_PARSE", "DB_URL_INVALID"],
  ["DB_CLIENT_INITIALIZATION", "DB_CONNECTION_FAILED"],
  ["DB_CONNECTION", "DB_CONNECTION_FAILED"],
  ["INITIAL_READ_ONLY_STATE_INSPECTION", "READ_ONLY_ASSERTION_FAILED"],
  ["SESSION_READ_ONLY_BOOTSTRAP", "SESSION_READ_ONLY_BOOTSTRAP_FAILED"],
  ["SESSION_READ_ONLY_ASSERTION", "SESSION_READ_ONLY_BOOTSTRAP_FAILED"],
  ["READ_ONLY_TRANSACTION_BEGIN", "READ_ONLY_ASSERTION_FAILED"],
  ["TRANSACTION_READ_ONLY_ASSERTION", "TRANSACTION_READ_ONLY_ASSERTION_FAILED"],
  ["DATABASE_TIME_QUERY", "DB_CONNECTION_FAILED"],
  ["SCHEMA_CONTRACT_INSPECTION", "SCHEMA_CONTRACT_MISMATCH"],
  ["QA_COMPANY_SCOPE_RESOLUTION", "QA_COMPANY_SCOPE_RESOLUTION_FAILED"],
  ["INTAKE_LINKS_READ", "DB_PERMISSION_FAILED"],
  ["GLOBAL_LINK_BASELINE_CAPTURE", "SCHEMA_CONTRACT_MISMATCH"],
  ["LINK_STATE_CLASSIFICATION", "LINK_STATE_CONTRACT_MISMATCH"],
  ["FRESH_BASELINE_CAPTURE", "SCHEMA_CONTRACT_MISMATCH"],
  ["RESULT_CONTRACT_VALIDATION", "RESULT_CONTRACT_INVALID"],
  ["ROLLBACK", "READ_ONLY_ROLLBACK_FAILED"],
  ["RESULT_SERIALIZATION", "RESULT_CONTRACT_INVALID"],
  ["CHILD_PROCESS_EXIT", "CHILD_PROCESS_EXIT_FAILED"],
  ["CALLER_RESULT_PARSE", "RESULT_JSON_PARSE_FAILED"],
])

const REQUIRED_INTAKE_LINK_COLUMNS = Object.freeze([
  "company_id",
  "created_at",
  "expires_at",
  "label",
  "status",
])

const FORBIDDEN_SQL = /\b(?:insert|update|delete|merge|truncate|drop|create|call)\b/iu
const PERSISTENT_CONFIGURATION_SQL = /\b(?:alter\s+role|alter\s+database|alter\s+system|set\s+global|set\s+default_transaction_read_only|set\s+session\s+authorization|set\s+role)\b/iu
const ALLOWED_READ_ONLY_SQL = [
  /^(?:show)\s+(?:default_transaction_read_only|transaction_read_only|transaction_isolation)\b/iu,
  /^(?:select)\s+.+/iu,
  /^(?:with)\s+.+\sselect\s+.+/iu,
  /^(?:set)\s+session\s+characteristics\s+as\s+transaction\s+read\s+only\b/iu,
  /^(?:set)\s+application_name\s*(?:=|to)\s+/iu,
  /^(?:set)\s+local\s+statement_timeout\s*(?:=|to)\s+/iu,
  /^(?:set)\s+local\s+lock_timeout\s*(?:=|to)\s+/iu,
  /^(?:begin)\s+(?:transaction\s+)?read\s+only\b/iu,
  /^(?:rollback)\b/iu,
]
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu
const UUID_VALUE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SECRET_PATTERN = /(?:postgres(?:ql)?:\/\/|eyJhbGci|sb_secret_|bearer\s+[a-z0-9._-]{12,})/iu
const QA_LABEL_PREFIX = "QA V6B "

export class AuthenticatedReadOnlyObservabilityError extends Error {
  constructor(code, { stage = null, category = null } = {}) {
    super(code)
    this.name = "AuthenticatedReadOnlyObservabilityError"
    this.code = code
    this.stage = stage
    this.category = category
  }
}

function normalizedCode(error) {
  for (const candidate of [error?.code, error?.cause?.code]) {
    const code = String(candidate || "").trim().toUpperCase()
    if (SQLSTATE_CATEGORIES.has(code) || NODE_CODE_CATEGORIES.has(code)) return code
  }
  return null
}

function messageCategory(error) {
  const message = String(error?.message || error?.cause?.message || "").toLowerCase()
  if (/password authentication failed|authentication failed|invalid password/u.test(message)) {
    return "DB_AUTH_FAILED"
  }
  if (/getaddrinfo|name or service not known|dns/u.test(message)) return "DB_DNS_FAILED"
  if (/certificate|tls|ssl/u.test(message)) return "DB_TLS_FAILED"
  if (/connection refused|network is unreachable|connect timeout/u.test(message)) {
    return "DB_NETWORK_FAILED"
  }
  if (/permission denied/u.test(message)) return "DB_PERMISSION_FAILED"
  if (/statement timeout|canceling statement/u.test(message)) return "DB_STATEMENT_TIMEOUT"
  return null
}

export function classifyAuthenticatedReadOnlyError(error, stage) {
  const safeStage = AUTHENTICATED_READ_ONLY_STAGES.includes(stage)
    ? stage
    : "ENVIRONMENT_VALIDATION"
  const explicit = AUTHENTICATED_READ_ONLY_ERROR_CATEGORIES.includes(error?.category)
    ? error.category
    : AUTHENTICATED_READ_ONLY_ERROR_CATEGORIES.includes(error?.code)
      ? error.code
      : null
  const technicalCode = normalizedCode(error)
  const category = explicit ||
    (technicalCode && (SQLSTATE_CATEGORIES.get(technicalCode) || NODE_CODE_CATEGORIES.get(technicalCode))) ||
    messageCategory(error) ||
    STAGE_FALLBACK.get(safeStage) ||
    "AUTHENTICATED_READ_ONLY_PRECHECK_UNCLASSIFIED"
  return Object.freeze({
    failed_stage: safeStage,
    failure_category: category,
    sanitized_code: technicalCode,
    sqlstate_class: technicalCode && SQLSTATE_CATEGORIES.has(technicalCode)
      ? technicalCode
      : null,
    status: FAILURE_STATUS.get(category) || "BLOCKED",
    raw_detail_exported: false,
  })
}

function sqlWithoutCommentsAndLiterals(sql) {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/--[^\n\r]*/gu, " ")
    .replace(/'(?:''|[^'])*'/gu, "''")
    .replace(/\s+/gu, " ")
    .trim()
}

export function assertReadOnlySql(sql) {
  const normalized = sqlWithoutCommentsAndLiterals(sql)
  if (PERSISTENT_CONFIGURATION_SQL.test(normalized)) {
    throw new AuthenticatedReadOnlyObservabilityError(
      "PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT",
      {
        category: "PERSISTENT_READ_ONLY_CONFIGURATION_ATTEMPT",
      },
    )
  }
  if (!normalized || FORBIDDEN_SQL.test(normalized)) {
    throw new AuthenticatedReadOnlyObservabilityError("READ_ONLY_ASSERTION_FAILED", {
      category: "READ_ONLY_ASSERTION_FAILED",
    })
  }
  if (!ALLOWED_READ_ONLY_SQL.some((pattern) => pattern.test(normalized))) {
    throw new AuthenticatedReadOnlyObservabilityError("READ_ONLY_ASSERTION_FAILED", {
      category: "READ_ONLY_ASSERTION_FAILED",
    })
  }
  return true
}

export function scanReadOnlySql(statements) {
  const values = Array.from(statements || [])
  for (const statement of values) assertReadOnlySql(statement)
  return Object.freeze({ status: "PASS", statements_scanned: values.length, forbidden: 0 })
}

function numericTime(value) {
  const timestamp = Date.parse(String(value || ""))
  if (!Number.isFinite(timestamp)) {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  return timestamp
}

export function classifyAuthenticatedLinkState(rows, databaseNow) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AuthenticatedReadOnlyObservabilityError("LINK_STATE_CONTRACT_MISMATCH", {
      category: "LINK_STATE_CONTRACT_MISMATCH",
    })
  }
  const now = numericTime(databaseNow)
  const counts = {
    total: rows.length,
    active_valid: 0,
    active_expired: 0,
    expired: 0,
    revoked: 0,
    paused: 0,
    unknown: 0,
    other_active: 0,
    qa_historical: 0,
    qa_active: 0,
    qa_revoked: 0,
  }
  for (const row of rows) {
    const status = String(row?.status || "")
    const qa = String(row?.label || "").startsWith(QA_LABEL_PREFIX)
    if (qa) counts.qa_historical += 1
    if (status === "active") {
      if (qa) counts.qa_active += 1
      if (!row?.expires_at) counts.other_active += 1
      else if (numericTime(row.expires_at) < now) counts.active_expired += 1
      else counts.active_valid += 1
    } else if (status === "expired") counts.expired += 1
    else if (status === "revoked") {
      counts.revoked += 1
      if (qa) counts.qa_revoked += 1
    } else if (status === "paused") counts.paused += 1
    else counts.unknown += 1
  }
  const normalizationRequired = counts.total === 2 &&
    counts.active_valid === 0 && counts.active_expired === 1 &&
    counts.expired === 0 && counts.revoked === 1 && counts.other_active === 0
  const alreadyNormalized = counts.total === 3 &&
    counts.active_valid === 0 && counts.active_expired === 0 &&
    counts.expired === 1 && counts.revoked === 2 && counts.other_active === 0 &&
    counts.paused === 0 && counts.unknown === 0 &&
    counts.qa_historical === 1 && counts.qa_active === 0 && counts.qa_revoked === 1
  if (!normalizationRequired && !alreadyNormalized) {
    throw new AuthenticatedReadOnlyObservabilityError("LINK_STATE_CONTRACT_MISMATCH", {
      category: "LINK_STATE_CONTRACT_MISMATCH",
    })
  }
  return Object.freeze({
    state: alreadyNormalized ? "ALREADY_NORMALIZED" : "NORMALIZATION_REQUIRED",
    normalization_required: normalizationRequired,
    apply_required: normalizationRequired,
    counts: Object.freeze(counts),
  })
}

export function createAuthenticatedReadOnlyEnvelope(mode = MODE) {
  return {
    status: "BLOCKED",
    result_code: null,
    mode,
    state: "UNKNOWN",
    last_completed_stage: null,
    failed_stage: null,
    failure_category: null,
    sanitized_code: null,
    sqlstate_class: null,
    initial_default_transaction_read_only: "unknown",
    session_read_only_bootstrap_applied: false,
    session_default_transaction_read_only: false,
    session_configuration_applied: false,
    credential_present: false,
    connection_established: false,
    transaction_started: false,
    transaction_read_only: false,
    query_completed: false,
    rollback_completed: false,
    client_closed: false,
    qa_company_scope_source: null,
    qa_company_scope_applied: false,
    qa_company_candidate_count: 0,
    qa_company_id_exported: false,
    intake_links_global: null,
    distinct_company_scopes: null,
    global_company_scope_count: null,
    intake_links_qa_company: null,
    fresh_baseline_completed: false,
    fresh_baseline: null,
    read_only_sql_scan: "PASS",
    read_only_sql_statements: 0,
    writes: 0,
    token_generated: false,
    provider_intake_calls: 0,
    diagnostic_public_submit_attempts: 0,
    diagnostic_call_consumed: false,
    links_created: 0,
    links_modified: 0,
    iam_changes: 0,
    raw_detail_exported: false,
    raw_error_exported: false,
    database_uri_exported: false,
    internal_ids_exported: false,
  }
}

const REQUIRED_ENVELOPE_FIELDS = Object.freeze([
  "status",
  "mode",
  "state",
  "last_completed_stage",
  "failed_stage",
  "failure_category",
  "initial_default_transaction_read_only",
  "session_read_only_bootstrap_applied",
  "session_default_transaction_read_only",
  "session_configuration_applied",
  "credential_present",
  "connection_established",
  "transaction_started",
  "transaction_read_only",
  "query_completed",
  "rollback_completed",
  "qa_company_scope_source",
  "qa_company_scope_applied",
  "qa_company_candidate_count",
  "qa_company_id_exported",
  "intake_links_global",
  "distinct_company_scopes",
  "intake_links_qa_company",
  "writes",
  "token_generated",
  "provider_intake_calls",
  "raw_error_exported",
])

export function validateAuthenticatedReadOnlyEnvelope(value) {
  if (!value || typeof value !== "object") {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  for (const field of REQUIRED_ENVELOPE_FIELDS) {
    if (!Object.hasOwn(value, field)) {
      throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
  }
  if (!["PASS", "BLOCKED", "FAIL"].includes(value.status) ||
      value.writes !== 0 || value.token_generated !== false ||
      value.provider_intake_calls !== 0 || value.raw_error_exported !== false ||
      value.raw_detail_exported !== false || value.qa_company_id_exported !== false) {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  if (value.transaction_started && !value.rollback_completed) {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  if (value.status === "PASS") {
    if (!value.connection_established || !value.transaction_started ||
        !value.transaction_read_only || !value.query_completed ||
        !value.rollback_completed || !value.fresh_baseline_completed ||
        !["ALREADY_NORMALIZED", "NORMALIZATION_REQUIRED"].includes(value.state) ||
        !["on", "off", "unknown"].includes(
          String(value.initial_default_transaction_read_only || "").toLowerCase(),
        ) ||
        value.session_read_only_bootstrap_applied !== true ||
        value.session_default_transaction_read_only !== true ||
        !["DETERMINISTIC_READ_ONLY", "PROTECTED_VALUE_VERIFIED"].includes(
          value.qa_company_scope_source,
        ) ||
        value.qa_company_scope_applied !== true ||
        value.qa_company_candidate_count !== 1 ||
        value.intake_links_global !== 4 ||
        value.distinct_company_scopes !== 2 ||
        value.intake_links_qa_company !== 3) {
      throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
  } else if (!value.failed_stage || !value.failure_category) {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  return true
}

export function assertSanitizedAuthenticatedReadOnlyEvidence(value, sensitiveValues = []) {
  const serialized = JSON.stringify(value).normalize("NFC")
  for (const key of ["raw_error", "raw_detail", "stack", "database_url", "host", "password", "sql_raw"] ) {
    if (Object.hasOwn(value || {}, key)) {
      throw new AuthenticatedReadOnlyObservabilityError("AUTHENTICATED_READ_ONLY_EVIDENCE_LEAKAGE", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
  }
  for (const sensitive of sensitiveValues) {
    const normalized = String(sensitive || "").normalize("NFC")
    if (normalized && serialized.includes(normalized)) {
      throw new AuthenticatedReadOnlyObservabilityError("AUTHENTICATED_READ_ONLY_EVIDENCE_LEAKAGE", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
  }
  if (SECRET_PATTERN.test(serialized) || UUID_PATTERN.test(serialized)) {
    throw new AuthenticatedReadOnlyObservabilityError("AUTHENTICATED_READ_ONLY_EVIDENCE_LEAKAGE", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  return true
}

function parseDatabaseUrl(value) {
  let parsed
  try {
    parsed = new URL(String(value || ""))
  } catch {
    throw new AuthenticatedReadOnlyObservabilityError("DB_URL_INVALID", {
      category: "DB_URL_INVALID",
    })
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !parsed.hostname || !parsed.username || !parsed.pathname || parsed.pathname === "/") {
    throw new AuthenticatedReadOnlyObservabilityError("DB_URL_INVALID", {
      category: "DB_URL_INVALID",
    })
  }
  return String(value)
}

  const SQL = Object.freeze({
    sessionReadOnly: "show default_transaction_read_only",
    sessionReadOnlyBootstrap: "set session characteristics as transaction read only",
    sessionReadOnlyBootstrapCheck: "show default_transaction_read_only",
    applicationName: "set application_name = 'flux_v6n_authenticated_read_only_precheck'",
    beginReadOnly: "begin transaction read only",
    transactionReadOnly: "show transaction_read_only",
    transactionIsolation: "show transaction_isolation",
    timeout: "set local statement_timeout = '15s'",
    lockTimeout: "set local lock_timeout = '5s'",
    databaseTime: "select current_timestamp as database_now",
  schema: `
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'intake_links'
     order by column_name
  `,
  qaCompanyScopeCandidates: `
    with company_link_state as (
      select company_id,
             count(*)::int as total,
             count(*) filter (where status = 'active')::int as active,
             count(*) filter (
               where status = 'active' and expires_at is not null and expires_at >= now()
             )::int as active_valid,
             count(*) filter (
               where status = 'active' and expires_at is not null and expires_at < now()
             )::int as active_expired,
             count(*) filter (
               where status = 'active' and expires_at is null
             )::int as other_active,
             count(*) filter (where status = 'expired')::int as expired,
             count(*) filter (where status = 'revoked')::int as revoked,
             count(*) filter (where status = 'paused')::int as paused,
             count(*) filter (
               where status not in ('active', 'expired', 'revoked', 'paused')
             )::int as unknown,
             count(*) filter (
               where status = 'revoked' and label like 'QA V6B %'
             )::int as qa_revoked,
             count(*) filter (
               where status = 'active' and label like 'QA V6B %'
             )::int as qa_active
        from public.intake_links
       group by company_id
    )
    select company_id::text as company_id
      from company_link_state
     where total = 3
       and active = 0
       and active_valid = 0
       and active_expired = 0
       and other_active = 0
       and expired = 1
       and revoked = 2
       and paused = 0
       and unknown = 0
       and qa_revoked = 1
       and qa_active = 0
     order by company_id
  `,
  links: `
    select label, status, expires_at
      from public.intake_links
     where company_id = $1::uuid
     order by created_at asc
  `,
  globalLinkAggregate: `
    select count(*)::int as intake_links_global,
           count(distinct company_id)::int as distinct_company_scopes
      from public.intake_links
  `,
  qaProfiles: `
    select p.id::text as profile_id, au.id::text as auth_user_id,
           p.active, (au.banned_until > now()) as blocked
      from auth.users au
      join public.profiles p on p.auth_user_id = au.id
     where (coalesce(au.raw_app_meta_data, '{}'::jsonb) || coalesce(au.raw_user_meta_data, '{}'::jsonb))
             ->> 'qa_fixture' = 'true'
       and (coalesce(au.raw_app_meta_data, '{}'::jsonb) || coalesce(au.raw_user_meta_data, '{}'::jsonb))
             ->> 'qa_scope' = 'provider_intake_triage_1d'
       and (coalesce(au.raw_app_meta_data, '{}'::jsonb) || coalesce(au.raw_user_meta_data, '{}'::jsonb))
             ->> 'qa_identity_type' = 'persistent_audit_principal'
       and (coalesce(au.raw_app_meta_data, '{}'::jsonb) || coalesce(au.raw_user_meta_data, '{}'::jsonb))
             ->> 'qa_alias' in ('QA_TRIAGE_FINANCE_1','QA_TRIAGE_FINANCE_2')
     order by p.id
  `,
  rollback: "rollback",
})

const BASELINE_SCALARS = Object.freeze({
  payment_intake: "select count(*)::int from public.payment_intake",
  payment_intake_events: "select count(*)::int from public.payment_intake_events",
  payment_intake_files: "select count(*)::int from public.payment_intake_files",
  storage_objects: "select count(*)::int from storage.objects where bucket_id='intake-uploads'",
  proveedores: "select count(*)::int from public.proveedores",
  providers: "select count(*)::int from public.providers",
  payment_requests: "select count(*)::int from public.payment_requests",
  approval_batches: "select count(*)::int from public.approval_batches",
  payment_layouts: "select count(*)::int from public.payment_layouts",
  payment_layout_lines: "select count(*)::int from public.payment_layout_lines",
  cash_funds: "select count(*)::int from public.cash_funds",
  notification_events: "select count(*)::int from public.notification_events",
  intake_links: "select count(*)::int from public.intake_links",
  matched_intakes: "select count(*)::int from public.payment_intake where matched_proveedor_id is not null",
  provider_matched: "select count(*)::int from public.payment_intake_events where event_type='provider_matched'",
})

const STATE_SCALARS = Object.freeze(Object.fromEntries(
  ["received", "in_review", "needs_correction", "rejected", "converted", "cancelled"]
    .map((state) => [state, `select count(*)::int from public.payment_intake where status='${state}'`]),
))

const LINK_SCALARS = Object.freeze({
  active: "select count(*)::int from public.intake_links where company_id=$1::uuid and status='active'",
  active_expired: "select count(*)::int from public.intake_links where company_id=$1::uuid and status='active' and expires_at < now()",
  expired: "select count(*)::int from public.intake_links where company_id=$1::uuid and status='expired'",
  revoked: "select count(*)::int from public.intake_links where company_id=$1::uuid and status='revoked'",
  qa_historical: "select count(*)::int from public.intake_links where company_id=$1::uuid and label like 'QA V6B %'",
  qa_active: "select count(*)::int from public.intake_links where company_id=$1::uuid and label like 'QA V6B %' and status='active'",
  qa_revoked: "select count(*)::int from public.intake_links where company_id=$1::uuid and label like 'QA V6B %' and status='revoked'",
})

function iamScalarSql(table, foreignKey, activeOnly = false) {
  return `select count(*)::int from ${table} where ${foreignKey}::text = any($1::text[])${activeOnly ? " and active = true" : ""}`
}

const IAM_SCALARS = Object.freeze({
  roles: iamScalarSql("public.user_roles", "profile_id"),
  memberships: iamScalarSql("public.profile_company_memberships", "profile_id", true),
  sessions: iamScalarSql("auth.sessions", "user_id"),
  refresh_tokens: iamScalarSql("auth.refresh_tokens", "user_id"),
})

const ALL_READ_ONLY_SQL = Object.freeze([
  ...Object.values(SQL),
  ...Object.values(BASELINE_SCALARS),
  ...Object.values(STATE_SCALARS),
  ...Object.values(LINK_SCALARS),
  ...Object.values(IAM_SCALARS),
])

async function queryReadOnly(client, sql, params = []) {
  assertReadOnlySql(sql)
  return await client.query(sql, params)
}

export async function resolveQaCompanyScopeReadOnly(client, protectedValue = null) {
  let result
  try {
    result = await queryReadOnly(client, SQL.qaCompanyScopeCandidates)
  } catch (error) {
    if (error instanceof AuthenticatedReadOnlyObservabilityError) throw error
    throw new AuthenticatedReadOnlyObservabilityError("QA_COMPANY_SCOPE_RESOLUTION_FAILED", {
      category: "QA_COMPANY_SCOPE_RESOLUTION_FAILED",
    })
  }
  if (!Array.isArray(result?.rows)) {
    throw new AuthenticatedReadOnlyObservabilityError("QA_COMPANY_SCOPE_RESULT_INVALID", {
      category: "QA_COMPANY_SCOPE_RESULT_INVALID",
    })
  }
  const candidates = result.rows.map((row) => String(row?.company_id || "").trim())
  if (candidates.some((candidate) => !UUID_VALUE_PATTERN.test(candidate))) {
    throw new AuthenticatedReadOnlyObservabilityError("QA_COMPANY_SCOPE_RESULT_INVALID", {
      category: "QA_COMPANY_SCOPE_RESULT_INVALID",
    })
  }
  if (candidates.length === 0) {
    throw new AuthenticatedReadOnlyObservabilityError("QA_COMPANY_SCOPE_NOT_FOUND", {
      category: "QA_COMPANY_SCOPE_NOT_FOUND",
    })
  }
  if (candidates.length > 1) {
    throw new AuthenticatedReadOnlyObservabilityError("QA_COMPANY_SCOPE_AMBIGUOUS", {
      category: "QA_COMPANY_SCOPE_AMBIGUOUS",
    })
  }
  const companyId = candidates[0]
  const supplied = String(protectedValue || "").trim()
  if (supplied && !UUID_VALUE_PATTERN.test(supplied)) {
    throw new AuthenticatedReadOnlyObservabilityError("QA_COMPANY_SCOPE_RESULT_INVALID", {
      category: "QA_COMPANY_SCOPE_RESULT_INVALID",
    })
  }
  if (supplied && supplied.toLowerCase() !== companyId.toLowerCase()) {
    throw new AuthenticatedReadOnlyObservabilityError(
      "QA_COMPANY_SCOPE_PROTECTED_VALUE_MISMATCH",
      { category: "QA_COMPANY_SCOPE_PROTECTED_VALUE_MISMATCH" },
    )
  }
  return Object.freeze({
    candidateCount: 1,
    companyId,
    source: supplied ? "PROTECTED_VALUE_VERIFIED" : "DETERMINISTIC_READ_ONLY",
  })
}

async function scalar(client, sql, params = []) {
  const result = await queryReadOnly(client, sql, params)
  const count = Number(result?.rows?.[0]?.count)
  if (!Number.isFinite(count) || count < 0) {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  return count
}

async function captureFreshBaseline(client, linkState, qaCompanyId, globalAggregate) {
  const profileRows = await queryReadOnly(client, SQL.qaProfiles)
  const profiles = Array.isArray(profileRows?.rows) ? profileRows.rows : []
  const profileIds = profiles.map((row) => row.profile_id)
  const authUserIds = profiles.map((row) => row.auth_user_id)
  const baseline = {}
  for (const [key, sql] of Object.entries(BASELINE_SCALARS)) baseline[key] = await scalar(client, sql)
  baseline.states = {}
  for (const [key, sql] of Object.entries(STATE_SCALARS)) baseline.states[key] = await scalar(client, sql)
  baseline.links = {}
  for (const [key, sql] of Object.entries(LINK_SCALARS)) {
    baseline.links[key] = await scalar(client, sql, [qaCompanyId])
  }
  baseline.iam = {
    qa_principals: profiles.length,
    profiles_inactive: profiles.filter((row) => row.active === false).length,
    auth_blocked: profiles.filter((row) => row.blocked === true).length,
    roles: profileIds.length ? await scalar(client, IAM_SCALARS.roles, [profileIds]) : 0,
    memberships: profileIds.length ? await scalar(client, IAM_SCALARS.memberships, [profileIds]) : 0,
    sessions: authUserIds.length ? await scalar(client, IAM_SCALARS.sessions, [authUserIds]) : 0,
    refresh_tokens: authUserIds.length ? await scalar(client, IAM_SCALARS.refresh_tokens, [authUserIds]) : 0,
  }
  baseline.distinct_company_scopes = globalAggregate.distinct_company_scopes
  baseline.intake_links_qa_company = linkState.counts.total
  if (baseline.intake_links !== globalAggregate.intake_links_global ||
      baseline.distinct_company_scopes !== 2 ||
      baseline.intake_links_qa_company !== 3 ||
      baseline.links.active_expired !== linkState.counts.active_expired ||
      baseline.links.expired !== linkState.counts.expired ||
      baseline.links.revoked !== linkState.counts.revoked) {
    throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
      category: "RESULT_CONTRACT_INVALID",
    })
  }
  return baseline
}

function completed(envelope, stage) {
  envelope.last_completed_stage = stage
}

export async function runAuthenticatedReadOnlyPrecheck({
  env = {},
  createClient,
  validateEnvironment = async () => true,
  mode = MODE,
} = {}) {
  const envelope = createAuthenticatedReadOnlyEnvelope(mode)
  let client = null
  let databaseUrl = null
  let qaCompanyId = null
  let protectedQaCompanyId = null
  let currentStage = "ENVIRONMENT_VALIDATION"
  const sqlScan = scanReadOnlySql(ALL_READ_ONLY_SQL)
  envelope.read_only_sql_statements = sqlScan.statements_scanned
  try {
    await validateEnvironment()
    completed(envelope, currentStage)

    currentStage = "SECRET_PRESENCE_VALIDATION"
    databaseUrl = String(env.SUPABASE_DEV_DB_URL || "").trim()
    if (!databaseUrl) {
      throw new AuthenticatedReadOnlyObservabilityError("BLOCKED_SECRET_UNAVAILABLE", {
        category: "BLOCKED_SECRET_UNAVAILABLE",
      })
    }
    envelope.credential_present = true
    completed(envelope, currentStage)

    currentStage = "DB_URL_PARSE"
    parseDatabaseUrl(databaseUrl)
    completed(envelope, currentStage)

    currentStage = "DB_CLIENT_INITIALIZATION"
    if (typeof createClient !== "function") {
      throw new AuthenticatedReadOnlyObservabilityError("DB_CONNECTION_FAILED", {
        category: "DB_CONNECTION_FAILED",
      })
    }
    client = await createClient(databaseUrl)
    if (!client || typeof client.connect !== "function" ||
        typeof client.query !== "function" || typeof client.end !== "function") {
      throw new AuthenticatedReadOnlyObservabilityError("DB_CONNECTION_FAILED", {
        category: "DB_CONNECTION_FAILED",
      })
    }
    completed(envelope, currentStage)

    currentStage = "DB_CONNECTION"
    await client.connect()
    envelope.connection_established = true
    completed(envelope, currentStage)

    currentStage = "INITIAL_READ_ONLY_STATE_INSPECTION"
    const session = await queryReadOnly(client, SQL.sessionReadOnly)
    envelope.initial_default_transaction_read_only = String(
      session?.rows?.[0]?.default_transaction_read_only || "",
    ).toLowerCase() || "unknown"
    if (envelope.initial_default_transaction_read_only !== "on" &&
        envelope.initial_default_transaction_read_only !== "off") {
      throw new AuthenticatedReadOnlyObservabilityError("READ_ONLY_ASSERTION_FAILED", {
        category: "READ_ONLY_ASSERTION_FAILED",
      })
    }
    completed(envelope, currentStage)

  currentStage = "SESSION_READ_ONLY_BOOTSTRAP"
  await queryReadOnly(client, SQL.sessionReadOnlyBootstrap)
  envelope.session_read_only_bootstrap_applied = true
  completed(envelope, currentStage)

    currentStage = "SESSION_READ_ONLY_ASSERTION"
    const postBootstrap = await queryReadOnly(client, SQL.sessionReadOnlyBootstrapCheck)
    envelope.session_default_transaction_read_only = String(
      postBootstrap?.rows?.[0]?.default_transaction_read_only || "",
    ).toLowerCase() === "on"
    if (!envelope.session_default_transaction_read_only) {
      throw new AuthenticatedReadOnlyObservabilityError("SESSION_READ_ONLY_BOOTSTRAP_FAILED", {
        category: "SESSION_READ_ONLY_BOOTSTRAP_FAILED",
      })
    }
    completed(envelope, currentStage)

    currentStage = "READ_ONLY_TRANSACTION_BEGIN"
    await queryReadOnly(client, SQL.applicationName)
    envelope.session_configuration_applied = true
    envelope.session_config = 1
    await queryReadOnly(client, SQL.beginReadOnly)
    envelope.transaction_started = true
    await queryReadOnly(client, SQL.timeout)
    await queryReadOnly(client, SQL.lockTimeout)

    currentStage = "TRANSACTION_READ_ONLY_ASSERTION"
    const transaction = await queryReadOnly(client, SQL.transactionReadOnly)
    envelope.transaction_read_only =
      String(transaction?.rows?.[0]?.transaction_read_only || "").toLowerCase() === "on"
    if (!envelope.transaction_read_only) {
      throw new AuthenticatedReadOnlyObservabilityError("TRANSACTION_READ_ONLY_ASSERTION_FAILED", {
        category: "TRANSACTION_READ_ONLY_ASSERTION_FAILED",
      })
    }
    const transactionIsolation = await queryReadOnly(client, SQL.transactionIsolation)
    if (!transactionIsolation?.rows?.[0]?.transaction_isolation) {
      throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
    envelope.transaction_isolation = String(transactionIsolation.rows[0].transaction_isolation || "")
    completed(envelope, currentStage)

    currentStage = "SCHEMA_CONTRACT_INSPECTION"
    const schema = await queryReadOnly(client, SQL.schema)
    const columns = new Set((schema?.rows || []).map((row) => String(row.column_name)))
    if (!REQUIRED_INTAKE_LINK_COLUMNS.every((column) => columns.has(column))) {
      throw new AuthenticatedReadOnlyObservabilityError("SCHEMA_CONTRACT_MISMATCH", {
        category: "SCHEMA_CONTRACT_MISMATCH",
      })
    }
    completed(envelope, currentStage)

    currentStage = "QA_COMPANY_SCOPE_RESOLUTION"
    protectedQaCompanyId = String(env.QA_COMPANY_ID || "").trim() || null
    const qaScope = await resolveQaCompanyScopeReadOnly(client, protectedQaCompanyId)
    qaCompanyId = qaScope.companyId
    envelope.qa_company_scope_source = qaScope.source
    envelope.qa_company_scope_applied = true
    envelope.qa_company_candidate_count = qaScope.candidateCount
    completed(envelope, currentStage)

    currentStage = "DATABASE_TIME_QUERY"
    const clock = await queryReadOnly(client, SQL.databaseTime)
    const databaseNow = clock?.rows?.[0]?.database_now
    numericTime(databaseNow)
    completed(envelope, currentStage)

    currentStage = "INTAKE_LINKS_READ"
    const links = await queryReadOnly(client, SQL.links, [qaCompanyId])
    if (!Array.isArray(links?.rows)) {
      throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
    envelope.query_completed = true
    envelope.intake_links_qa_company = links.rows.length
    completed(envelope, currentStage)

    currentStage = "GLOBAL_LINK_BASELINE_CAPTURE"
    const globalLinks = await queryReadOnly(client, SQL.globalLinkAggregate)
    const globalAggregate = globalLinks?.rows?.[0]
    envelope.intake_links_global = Number(globalAggregate?.intake_links_global)
    envelope.distinct_company_scopes = Number(globalAggregate?.distinct_company_scopes)
    envelope.global_company_scope_count = envelope.distinct_company_scopes
    if (envelope.intake_links_global !== 4 || envelope.distinct_company_scopes !== 2) {
      throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
    completed(envelope, currentStage)

    currentStage = "LINK_STATE_CLASSIFICATION"
    const linkState = classifyAuthenticatedLinkState(links.rows, databaseNow)
    envelope.state = linkState.state
    envelope.normalization_required = linkState.normalization_required
    envelope.apply_required = linkState.apply_required
    envelope.link_state_counts = linkState.counts
    completed(envelope, currentStage)

    currentStage = "FRESH_BASELINE_CAPTURE"
    envelope.fresh_baseline = await captureFreshBaseline(
      client,
      linkState,
      qaCompanyId,
      {
        intake_links_global: envelope.intake_links_global,
        distinct_company_scopes: envelope.distinct_company_scopes,
      },
    )
    envelope.fresh_baseline_completed = true
    completed(envelope, currentStage)

    currentStage = "RESULT_CONTRACT_VALIDATION"
    if (envelope.state === "ALREADY_NORMALIZED" &&
        (envelope.normalization_required || envelope.apply_required)) {
      throw new AuthenticatedReadOnlyObservabilityError("ALREADY_NORMALIZED_STATE_NOT_HANDLED", {
        category: "ALREADY_NORMALIZED_STATE_NOT_HANDLED",
      })
    }
    completed(envelope, currentStage)

    currentStage = "ROLLBACK"
    await queryReadOnly(client, SQL.rollback)
    envelope.rollback_completed = true
    completed(envelope, currentStage)

    envelope.status = "PASS"
    envelope.result_code = "AUTHENTICATED_READ_ONLY_PRECHECK_VALIDATED"
    currentStage = "RESULT_SERIALIZATION"
    envelope.failed_stage = null
    envelope.failure_category = null
    envelope.sanitized_code = null
    envelope.sqlstate_class = null
    completed(envelope, currentStage)
    validateAuthenticatedReadOnlyEnvelope(envelope)
    assertSanitizedAuthenticatedReadOnlyEvidence(
      envelope,
      [databaseUrl, qaCompanyId, protectedQaCompanyId],
    )
    JSON.stringify(envelope)
    return envelope
  } catch (error) {
    if (envelope.transaction_started && !envelope.rollback_completed && client) {
      try {
        await queryReadOnly(client, SQL.rollback)
        envelope.rollback_completed = true
      } catch (rollbackError) {
        currentStage = "ROLLBACK"
        error = rollbackError
      }
    }
    const classified = classifyAuthenticatedReadOnlyError(error, currentStage)
    envelope.status = classified.status
    envelope.result_code = classified.failure_category
    envelope.failed_stage = classified.failed_stage
    envelope.failure_category = classified.failure_category
    envelope.sanitized_code = classified.sanitized_code
    envelope.sqlstate_class = classified.sqlstate_class
    envelope.raw_detail_exported = false
    envelope.raw_error_exported = false
    if (!envelope.last_completed_stage && currentStage !== "ENVIRONMENT_VALIDATION") {
      envelope.last_completed_stage = "ENVIRONMENT_VALIDATION"
    }
    if (!envelope.fresh_baseline_completed) envelope.fresh_baseline = null
    assertSanitizedAuthenticatedReadOnlyEvidence(
      envelope,
      [databaseUrl, qaCompanyId, protectedQaCompanyId],
    )
    return envelope
  } finally {
    qaCompanyId = null
    protectedQaCompanyId = null
    if (client) {
      try {
        await client.end()
        envelope.client_closed = true
      } catch {
        envelope.client_closed = false
      }
    }
    databaseUrl = null
  }
}

export function buildAuthenticatedReadOnlyFailureEnvelope(error, stage = "CHILD_PROCESS_EXIT", mode = MODE) {
  const envelope = createAuthenticatedReadOnlyEnvelope(mode)
  const classified = classifyAuthenticatedReadOnlyError(error, stage)
  Object.assign(envelope, {
    status: classified.status,
    result_code: classified.failure_category,
    failed_stage: classified.failed_stage,
    failure_category: classified.failure_category,
    sanitized_code: classified.sanitized_code,
    sqlstate_class: classified.sqlstate_class,
  })
  assertSanitizedAuthenticatedReadOnlyEvidence(envelope)
  return envelope
}

export function parseAuthenticatedReadOnlyChildResult({ stdout, exitCode = 0 } = {}) {
  if (Number(exitCode) !== 0) {
    return buildAuthenticatedReadOnlyFailureEnvelope(
      new AuthenticatedReadOnlyObservabilityError("CHILD_PROCESS_EXIT_FAILED", {
        category: "CHILD_PROCESS_EXIT_FAILED",
      }),
      "CHILD_PROCESS_EXIT",
    )
  }
  const text = String(stdout || "").trim()
  if (!text) {
    return buildAuthenticatedReadOnlyFailureEnvelope(
      new AuthenticatedReadOnlyObservabilityError("RESULT_JSON_PARSE_FAILED", {
        category: "RESULT_JSON_PARSE_FAILED",
      }),
      "CALLER_RESULT_PARSE",
    )
  }
  let parsed
  try {
    parsed = JSON.parse(text)
    validateAuthenticatedReadOnlyEnvelope(parsed)
    assertSanitizedAuthenticatedReadOnlyEvidence(parsed)
  } catch {
    return buildAuthenticatedReadOnlyFailureEnvelope(
      new AuthenticatedReadOnlyObservabilityError("RESULT_JSON_PARSE_FAILED", {
        category: "RESULT_JSON_PARSE_FAILED",
      }),
      "CALLER_RESULT_PARSE",
    )
  }
  return parsed
}

export function runAuthenticatedReadOnlyMockMatrix() {
  const now = "2026-07-21T20:00:00.000Z"
  const normalizationRequired = classifyAuthenticatedLinkState([
    { label: "historical", status: "revoked", expires_at: null },
    { label: "active", status: "active", expires_at: "2026-07-20T20:00:00.000Z" },
  ], now)
  const alreadyNormalized = classifyAuthenticatedLinkState([
    { label: "historical", status: "expired", expires_at: "2026-07-20T20:00:00.000Z" },
    { label: "other", status: "revoked", expires_at: null },
    { label: "QA V6B historical", status: "revoked", expires_at: null },
  ], now)
  const families = [
    ["ENOTFOUND", "DB_DNS_FAILED"],
    ["ECONNREFUSED", "DB_NETWORK_FAILED"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "DB_TLS_FAILED"],
    ["28P01", "DB_AUTH_FAILED"],
    ["42501", "DB_PERMISSION_FAILED"],
    ["42P01", "SCHEMA_TABLE_MISSING"],
    ["42703", "SCHEMA_COLUMN_MISSING"],
    ["57014", "DB_STATEMENT_TIMEOUT"],
  ].map(([code, expected]) => {
    const actual = classifyAuthenticatedReadOnlyError({ code }, "DB_CONNECTION")
    if (actual.failure_category !== expected) {
      throw new AuthenticatedReadOnlyObservabilityError("RESULT_CONTRACT_INVALID", {
        category: "RESULT_CONTRACT_INVALID",
      })
    }
    return { category: expected, raw_detail_exported: false }
  })
  const caller = parseAuthenticatedReadOnlyChildResult({
    stdout: JSON.stringify(buildAuthenticatedReadOnlyFailureEnvelope(
      new AuthenticatedReadOnlyObservabilityError("DB_AUTH_FAILED", { category: "DB_AUTH_FAILED" }),
      "DB_CONNECTION",
    )),
    exitCode: 0,
  })
  return Object.freeze({
    status: "PASS",
    mode: "authenticated-read-only-precheck-diagnostic",
    last_completed_stage: "RESULT_SERIALIZATION",
    session_read_only_bootstrap_applied: true,
    session_default_transaction_read_only: true,
    session_configuration_applied: true,
    session_config: 1,
    rollback_completed: true,
    transaction_started: true,
    transaction_read_only: true,
    query_completed: true,
    fresh_baseline_completed: true,
    qa_company_scope_source: "DETERMINISTIC_READ_ONLY",
    qa_company_scope_applied: true,
    qa_company_candidate_count: 1,
    qa_company_id_exported: false,
    intake_links_global: 4,
    distinct_company_scopes: 2,
    intake_links_qa_company: 3,
    other_company_active_valid: 1,
    transaction_isolation: "read committed",
    public_submit_calls: 0,
    diagnostic_public_submit_attempts: 0,
    diagnostic_call_consumed: false,
    operational_dev_writes: 0,
    normalization_required: normalizationRequired.state,
    already_normalized: alreadyNormalized.state,
    already_normalized_noop:
      alreadyNormalized.normalization_required === false && alreadyNormalized.apply_required === false,
    error_families: families,
    caller_category: caller.failure_category,
    read_only_sql_scan: scanReadOnlySql(ALL_READ_ONLY_SQL),
    tokens_generated: 0,
    links_created: 0,
    iam_changes: 0,
    dev_writes: 0,
    raw_leakage: 0,
  })
}
