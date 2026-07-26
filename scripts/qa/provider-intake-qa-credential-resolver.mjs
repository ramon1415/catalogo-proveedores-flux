import crypto from "node:crypto"

export const QA_CREDENTIAL_STAGE = Object.freeze({
  READ_ONLY_BASELINE: "READ_ONLY_BASELINE",
  LINK_PREPARATION: "LINK_PREPARATION",
  PUBLIC_SUBMIT: "PUBLIC_SUBMIT",
  IAM_AND_TERMINAL_CLEANUP: "IAM_AND_TERMINAL_CLEANUP",
})

export const QA_DEV_PROJECT_REF = "scsirgbuqjcwoaxfacth"
export const QA_MANAGEMENT_API_ORIGIN = "https://api.supabase.com"
export const CANONICAL_DEV_PORTAL_ORIGIN =
  "https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app"
export const CANONICAL_DEV_PORTAL_URL = `${CANONICAL_DEV_PORTAL_ORIGIN}/solicitar.html`
export const CANONICAL_PUBLIC_SUBMIT_ENDPOINT =
  `https://${QA_DEV_PROJECT_REF}.supabase.co/functions/v1/provider-intake/submit`

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SAFE_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/iu
const CAPTCHA_PATTERN = /^\S{8,4096}$/u

export class QaCredentialResolutionError extends Error {
  constructor(code, { category = "FAIL", details = {} } = {}) {
    super(code)
    this.name = "QaCredentialResolutionError"
    this.code = code
    this.category = category
    this.details = details
  }
}

function gate(value, code, options = {}) {
  if (!value) throw new QaCredentialResolutionError(code, options)
}

function text(value) {
  return String(value ?? "").trim()
}

function required(env, name) {
  const value = text(env?.[name])
  gate(Boolean(value), `MISSING_ENVIRONMENT_${name}`)
  return value
}

function base64UrlJson(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))
  } catch {
    throw new QaCredentialResolutionError("API_KEY_FORMAT_INVALID", {
      category: "BLOCKED_API_KEY_CONTRACT",
    })
  }
}

function validateLegacyApiKey(value, expectedRole, projectRef) {
  const raw = text(value)
  const segments = raw.split(".")
  gate(
    segments.length === 3 && segments.every(Boolean),
    "API_KEY_FORMAT_INVALID",
    { category: "BLOCKED_API_KEY_CONTRACT" },
  )
  const payload = base64UrlJson(segments[1])
  gate(
    payload?.role === expectedRole,
    "API_KEY_ROLE_INVALID",
    { category: "BLOCKED_API_KEY_CONTRACT" },
  )
  if (text(payload?.ref)) {
    gate(
      text(payload.ref) === projectRef,
      "API_KEY_PROJECT_MISMATCH",
      { category: "BLOCKED_API_KEY_CONTRACT" },
    )
  }
  return raw
}

export function createProtectedQaValue(value, {
  label,
  singleUse = false,
} = {}) {
  gate(Boolean(text(label)), "PROTECTED_VALUE_LABEL_REQUIRED")
  const bytes = Buffer.from(String(value), "utf8")
  gate(bytes.byteLength > 0, "PROTECTED_VALUE_EMPTY")
  let cleared = false
  let consumed = false
  const use = async (callback) => {
    gate(!cleared, "PROTECTED_VALUE_CLEARED")
    gate(!singleUse || !consumed, "PROTECTED_VALUE_ALREADY_CONSUMED")
    gate(typeof callback === "function", "PROTECTED_VALUE_CALLBACK_REQUIRED")
    if (singleUse) consumed = true
    const material = bytes.toString("utf8")
    try {
      return await callback(material)
    } finally {
      if (singleUse) {
        bytes.fill(0)
        cleared = true
      }
    }
  }
  return Object.freeze({
    label: text(label),
    present: () => !cleared && bytes.byteLength > 0,
    consumed: () => consumed,
    use,
    clear: () => {
      if (!cleared) bytes.fill(0)
      cleared = true
    },
    toJSON: () => ({
      protected_value: true,
      label: text(label),
      value_exported: false,
    }),
  })
}

function escapeWorkflowCommand(value) {
  return String(value)
    .replace(/%/gu, "%25")
    .replace(/\r/gu, "%0D")
    .replace(/\n/gu, "%0A")
}

export function maskGitHubActionsSecret(value, {
  env = process.env,
  writeCommand = (command) => process.stdout.write(command),
} = {}) {
  if (text(env.GITHUB_ACTIONS).toLowerCase() !== "true") return false
  gate(typeof writeCommand === "function", "API_KEY_MASK_UNAVAILABLE", {
    category: "BLOCKED_ACCESS",
  })
  writeCommand(`::add-mask::${escapeWorkflowCommand(value)}\n`)
  return true
}

function managementApiKeyRows(value) {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.keys)) return value.keys
  if (Array.isArray(value?.data)) return value.data
  return []
}

function findLegacyKey(rows, role) {
  const matches = rows.filter((row) => {
    const name = text(row?.name || row?.role).toLowerCase()
    const type = text(row?.type).toLowerCase()
    return name === role && (!type || type === "legacy")
  })
  gate(matches.length === 1, "LEGACY_KEYS_UNAVAILABLE", {
    category: "BLOCKED_API_KEY_CONTRACT",
  })
  return text(matches[0]?.api_key || matches[0]?.key || matches[0]?.value)
}

export async function resolveQaApiKeys(env = process.env, {
  projectRef = QA_DEV_PROJECT_REF,
  fetchImpl = globalThis.fetch,
  maskSecret = (value) => maskGitHubActionsSecret(value, { env }),
  readPublicAnonKey = null,
} = {}) {
  gate(projectRef === QA_DEV_PROJECT_REF, "UNAUTHORIZED_PROJECT_REF")
  gate(typeof fetchImpl === "function", "MANAGEMENT_API_FETCH_UNAVAILABLE", {
    category: "BLOCKED_ACCESS",
  })
  let anon = text(env.SUPABASE_DEV_ANON_KEY)
  let serviceRole = text(env.SUPABASE_DEV_SERVICE_ROLE_KEY)
  let source = "DIRECT_PROTECTED_ENV"
  let accessToken = null
  if (!anon || !serviceRole) {
    source = "SUPABASE_MANAGEMENT_API"
    accessToken = required(env, "SUPABASE_ACCESS_TOKEN")
    const response = await fetchImpl(
      `${QA_MANAGEMENT_API_ORIGIN}/v1/projects/${projectRef}/api-keys?reveal=true`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    )
    if ([401, 403].includes(Number(response?.status))) {
      throw new QaCredentialResolutionError("API_GATEWAY_KEYS_READ_UNAVAILABLE", {
        category: "BLOCKED_ACCESS",
      })
    }
    gate(response?.ok === true, "MANAGEMENT_API_KEY_RESOLUTION_FAILED", {
      category: "BLOCKED_ACCESS",
    })
    const rows = managementApiKeyRows(await response.json())
    anon = findLegacyKey(rows, "anon")
    serviceRole = findLegacyKey(rows, "service_role")
  }
  anon = validateLegacyApiKey(anon, "anon", projectRef)
  serviceRole = validateLegacyApiKey(serviceRole, "service_role", projectRef)
  maskSecret(anon)
  maskSecret(serviceRole)
  let publicKeyProjectMatch = null
  if (typeof readPublicAnonKey === "function") {
    const publicValue = text(await readPublicAnonKey({ projectRef }))
    gate(Boolean(publicValue), "PUBLIC_KEY_CONFIG_UNAVAILABLE", {
      category: "BLOCKED_API_KEY_CONTRACT",
    })
    publicKeyProjectMatch =
      publicValue.length === anon.length &&
      crypto.timingSafeEqual(Buffer.from(publicValue), Buffer.from(anon))
    gate(publicKeyProjectMatch, "API_KEY_PROJECT_MISMATCH", {
      category: "BLOCKED_API_KEY_CONTRACT",
    })
  }
  const anonKey = createProtectedQaValue(anon, { label: "anon_key" })
  const serviceRoleKey = createProtectedQaValue(serviceRole, {
    label: "service_role_key",
  })
  anon = null
  serviceRole = null
  accessToken = null
  return Object.freeze({
    source,
    anonKey,
    serviceRoleKey,
    sanitized: Object.freeze({
      api_key_source: source,
      anon_key_present: true,
      service_role_present: true,
      public_key_project_match: publicKeyProjectMatch,
      api_key_values_exported: false,
      access_token_exported: false,
    }),
    clear: () => {
      anonKey.clear()
      serviceRoleKey.clear()
    },
  })
}

const LINK_CONTRACT_SQL = `
  select
    c.data_type,
    c.udt_name,
    c.is_nullable,
    rn.nspname as referenced_schema,
    rc.relname as referenced_table,
    ra.attname as referenced_column
  from information_schema.columns c
  left join pg_constraint fk
    on fk.conrelid = 'public.intake_links'::regclass
   and fk.contype = 'f'
   and array_position(fk.conkey, (
     select attnum from pg_attribute
      where attrelid = 'public.intake_links'::regclass
        and attname = 'created_by'
   )) is not null
  left join pg_class rc on rc.oid = fk.confrelid
  left join pg_namespace rn on rn.oid = rc.relnamespace
  left join pg_attribute ra
    on ra.attrelid = fk.confrelid
   and ra.attnum = fk.confkey[1]
  where c.table_schema = 'public'
    and c.table_name = 'intake_links'
    and c.column_name = 'created_by'
`

const LINK_ACTOR_HISTORY_SQL = `
  select distinct created_by::text as actor_id
    from public.intake_links
   where company_id = $1::uuid
     and label like 'QA V6B %'
     and created_by is not null
   order by created_by::text
`

async function query(client, sql, params = []) {
  gate(client && typeof client.query === "function", "READ_ONLY_CLIENT_REQUIRED")
  gate(/^\s*(?:select|with|show)\b/iu.test(sql), "READ_ONLY_SQL_REQUIRED")
  return await client.query(sql, params)
}

export async function resolveQaLinkCreatedByReadOnly(client, qaCompanyId) {
  const companyId = text(qaCompanyId)
  gate(UUID_PATTERN.test(companyId), "QA_COMPANY_SCOPE_RESULT_INVALID", {
    category: "BLOCKED_DATA",
  })
  const contractResult = await query(client, LINK_CONTRACT_SQL)
  const contracts = Array.isArray(contractResult?.rows) ? contractResult.rows : []
  gate(contracts.length === 1, "QA_LINK_CREATED_BY_CONTRACT_INVALID", {
    category: "BLOCKED_DATA",
  })
  const contract = contracts[0]
  const schema = text(contract.referenced_schema)
  const table = text(contract.referenced_table)
  const column = text(contract.referenced_column)
  gate(
    SAFE_IDENTIFIER_PATTERN.test(schema) &&
      SAFE_IDENTIFIER_PATTERN.test(table) &&
      SAFE_IDENTIFIER_PATTERN.test(column),
    "QA_LINK_CREATED_BY_FK_INVALID",
    { category: "BLOCKED_DATA" },
  )
  const historyResult = await query(client, LINK_ACTOR_HISTORY_SQL, [companyId])
  const actors = (Array.isArray(historyResult?.rows) ? historyResult.rows : [])
    .map((row) => text(row?.actor_id))
    .filter(Boolean)
  if (actors.length === 0) {
    throw new QaCredentialResolutionError("QA_LINK_CREATED_BY_NOT_FOUND", {
      category: "BLOCKED_DATA",
    })
  }
  if (actors.length > 1) {
    throw new QaCredentialResolutionError("QA_LINK_CREATED_BY_AMBIGUOUS", {
      category: "BLOCKED_DATA",
    })
  }
  gate(UUID_PATTERN.test(actors[0]), "QA_LINK_CREATED_BY_FK_INVALID", {
    category: "BLOCKED_DATA",
  })
  const deletedColumn = await query(
    client,
    `select column_name
       from information_schema.columns
      where table_schema = $1 and table_name = $2 and column_name = 'deleted_at'`,
    [schema, table],
  )
  const excludesDeleted = Array.isArray(deletedColumn?.rows) &&
    deletedColumn.rows.length === 1
  const actorResult = await query(
    client,
    `select count(*)::int as count
       from ${schema}.${table}
      where ${column}::text = $1${excludesDeleted ? " and deleted_at is null" : ""}`,
    [actors[0]],
  )
  const actorCount = Number(actorResult?.rows?.[0]?.count)
  gate(actorCount === 1, "QA_LINK_CREATED_BY_FK_INVALID", {
    category: "BLOCKED_DATA",
  })
  const actor = createProtectedQaValue(actors[0], { label: "link_created_by" })
  return Object.freeze({
    actor,
    sanitized: Object.freeze({
      link_created_by_source: "QA_LINK_HISTORY",
      candidate_count: 1,
      column_type: text(contract.udt_name || contract.data_type),
      nullable: text(contract.is_nullable).toUpperCase() === "YES",
      foreign_key_valid: true,
      actor_not_deleted: true,
      id_exported: false,
    }),
    clear: () => actor.clear(),
  })
}

function assertCanonicalPortal(pageUrl) {
  let parsed
  try {
    parsed = new URL(String(pageUrl || ""))
  } catch {
    throw new QaCredentialResolutionError("CANONICAL_BROWSER_ORIGIN_REQUIRED")
  }
  gate(
    parsed.origin === CANONICAL_DEV_PORTAL_ORIGIN &&
      parsed.pathname === "/solicitar.html",
    "CANONICAL_BROWSER_ORIGIN_REQUIRED",
  )
  return parsed
}

export function createRuntimeTurnstileSession({
  readToken = async (page) => {
    const locator = page.locator(
      'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]',
    ).first()
    await locator.waitFor({ state: "attached" })
    return await locator.inputValue()
  },
} = {}) {
  let captures = 0
  let protectedToken = null
  return Object.freeze({
    async capture(page) {
      gate(captures === 0, "SECOND_CAPTCHA_TOKEN_BLOCKED")
      gate(page && typeof page.url === "function", "CAPTCHA_PAGE_REQUIRED")
      assertCanonicalPortal(page.url())
      const token = text(await readToken(page))
      gate(CAPTCHA_PATTERN.test(token), "CAPTCHA_RUNTIME_TOKEN_INVALID")
      captures += 1
      protectedToken = createProtectedQaValue(token, {
        label: "turnstile_runtime_token",
        singleUse: true,
      })
      return protectedToken
    },
    clear() {
      protectedToken?.clear()
    },
    sanitized() {
      return Object.freeze({
        captcha_source: "TURNSTILE_RUNTIME_WIDGET",
        captcha_token_captures: captures,
        captcha_token_persisted: false,
        captcha_token_exported: false,
      })
    },
  })
}

function safeBrowserResponse(value) {
  return {
    status: Number(value?.status || 0),
    ok: value?.ok === true,
    content_type_class: text(value?.contentType).toLowerCase().includes("application/json")
      ? "JSON"
      : "OTHER",
    payload: value?.payload && typeof value.payload === "object"
      ? value.payload
      : null,
  }
}

export function createCanonicalBrowserSubmitController({
  portalUrl = CANONICAL_DEV_PORTAL_URL,
  endpoint = CANONICAL_PUBLIC_SUBMIT_ENDPOINT,
  enabled = false,
  captchaSession = createRuntimeTurnstileSession(),
} = {}) {
  const portal = assertCanonicalPortal(portalUrl)
  const target = new URL(endpoint)
  gate(
    target.href === CANONICAL_PUBLIC_SUBMIT_ENDPOINT,
    "PUBLIC_SUBMIT_ENDPOINT_INVALID",
  )
  let postAttempts = 0
  return Object.freeze({
    async submitOnce({ page, intakeToken, idempotencyKey, payload } = {}) {
      gate(enabled === true, "PUBLIC_SUBMIT_DISABLED_CRED_A1")
      gate(postAttempts === 0, "SECOND_PUBLIC_POST_BLOCKED")
      gate(page && typeof page.evaluate === "function", "PUBLIC_SUBMIT_PAGE_REQUIRED")
      assertCanonicalPortal(page.url())
      const token = await captchaSession.capture(page)
      postAttempts += 1
      return await token.use(async (captchaToken) => {
        const response = await page.evaluate(async (input) => {
          const result = await fetch(input.endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Intake-Token": input.intakeToken,
              "Idempotency-Key": input.idempotencyKey,
            },
            body: JSON.stringify({
              payload: input.payload,
              captcha_token: input.captchaToken,
              honeypot: "",
            }),
          })
          const contentType = result.headers.get("content-type") || ""
          let responsePayload = null
          if (contentType.toLowerCase().includes("application/json")) {
            responsePayload = await result.json()
          }
          return {
            status: result.status,
            ok: result.ok,
            contentType,
            payload: responsePayload,
          }
        }, {
          endpoint: target.href,
          intakeToken: text(intakeToken),
          idempotencyKey: text(idempotencyKey),
          captchaToken,
          payload,
        })
        return safeBrowserResponse(response)
      })
    },
    clear() {
      captchaSession.clear()
    },
    sanitized() {
      return Object.freeze({
        browser_origin: portal.origin,
        browser_path: portal.pathname,
        browser_origin_canonical: true,
        public_submit_endpoint_class: "SUPABASE_DEV_PUBLIC_SUBMIT",
        public_submit_enabled: enabled === true,
        public_submit_calls: postAttempts,
        second_public_post_blocked: true,
        ...captchaSession.sanitized(),
      })
    },
  })
}

export function createStageScopedCredentialResolver(env = process.env, options = {}) {
  const cache = new Map()
  const accessedStages = []
  return Object.freeze({
    async resolve(stage, context = {}) {
      gate(Object.values(QA_CREDENTIAL_STAGE).includes(stage), "INVALID_CREDENTIAL_STAGE")
      if (cache.has(stage)) return cache.get(stage)
      let value
      if (stage === QA_CREDENTIAL_STAGE.READ_ONLY_BASELINE) {
        const databaseUrl = required(env, "SUPABASE_DEV_DB_URL")
        const projectRef = text(
          env.SUPABASE_DEV_PROJECT_REF || env.CONFIRMED_DEV_PROJECT_REF || QA_DEV_PROJECT_REF,
        )
        gate(projectRef === QA_DEV_PROJECT_REF, "UNAUTHORIZED_PROJECT_REF")
        value = Object.freeze({
          databaseUrl: createProtectedQaValue(databaseUrl, { label: "dev_db_url" }),
          projectRef,
          runnerIdentity: context.runnerIdentity || null,
          sanitized: Object.freeze({
            stage,
            db_credential_present: true,
            project_ref_verified: true,
            api_keys_loaded: false,
            captcha_loaded: false,
            link_actor_loaded: false,
          }),
        })
      } else if (stage === QA_CREDENTIAL_STAGE.LINK_PREPARATION) {
        gate(context.client, "READ_ONLY_CLIENT_REQUIRED")
        value = await resolveQaLinkCreatedByReadOnly(
          context.client,
          context.qaCompanyId,
        )
      } else if (stage === QA_CREDENTIAL_STAGE.PUBLIC_SUBMIT) {
        const apiKeys = context.transportRequiresApiKey === true
          ? await resolveQaApiKeys(env, options)
          : null
        const captchaSession = context.captchaSession || createRuntimeTurnstileSession()
        value = Object.freeze({
          apiKeys,
          captchaSession,
          sanitized: Object.freeze({
            stage,
            transport_requires_api_key: context.transportRequiresApiKey === true,
            api_keys_loaded: apiKeys !== null,
            captcha_source: "TURNSTILE_RUNTIME_WIDGET",
          }),
        })
      } else {
        const apiKeys = await resolveQaApiKeys(env, options)
        value = Object.freeze({ apiKeys })
      }
      cache.set(stage, value)
      accessedStages.push(stage)
      return value
    },
    clear() {
      for (const value of cache.values()) {
        value?.clear?.()
        value?.apiKeys?.clear?.()
        value?.captchaSession?.clear?.()
        value?.databaseUrl?.clear?.()
      }
      cache.clear()
    },
    sanitized() {
      return Object.freeze({
        stage_scoped_credential_loading: true,
        stages_loaded: [...accessedStages],
        api_key_values_exported: false,
        captcha_values_exported: false,
        internal_actor_ids_exported: false,
      })
    },
  })
}
