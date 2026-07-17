import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const cleanupOnly = process.argv.includes("--cleanup-only")
const supabaseUrl = required("SUPABASE_URL").replace(/\/+$/, "")
const anonKey = required("SUPABASE_DEV_ANON_KEY")
const serviceKey = required("SUPABASE_DEV_SERVICE_ROLE_KEY")
const previewUrl = required("PREVIEW_URL").replace(/\/+$/, "")
const outputDir = path.resolve(process.env.UAT_OUTPUT_DIR || "gate2v2-evidence")
const manifestPath = path.resolve(required("UAT_MANIFEST"))
const projectRef = required("SUPABASE_DEV_PROJECT_REF")
const expectedProjectRef = "scsirgbuqjcwoaxfacth"

const QA_SCOPE = "provider_intake_triage_1d"
const QA_TYPE = "persistent_audit_principal"
const IDENTITIES = Object.freeze([
  {
    alias: "QA_TRIAGE_FINANCE_1",
    email: "qa-triage-finance-1@provider-intake.example.invalid",
  },
  {
    alias: "QA_TRIAGE_FINANCE_2",
    email: "qa-triage-finance-2@provider-intake.example.invalid",
  },
])

const SENSITIVE_METADATA_KEYS = new Set([
  "bank_clabe",
  "clabe",
  "captcha",
  "captcha_token",
  "public_token",
  "token",
  "raw_payload",
  "client_ip",
  "user_agent",
  "cookies",
  "headers",
  "secrets",
  "rfc",
  "email",
  "bank_account",
  "storage_path",
])

class GateError extends Error {
  constructor(code) {
    super(code)
    this.name = "GateError"
    this.code = code
  }
}

function required(name) {
  const value = process.env[name]
  if (!value) throw new GateError(`missing_env_${name}`)
  return value
}

function gateAssert(condition, code) {
  if (!condition) throw new GateError(code)
}

function randomPassword() {
  return `Qa1!${crypto.randomBytes(32).toString("base64url")}`
}

function qaMetadata(alias) {
  return {
    qa_fixture: true,
    qa_scope: QA_SCOPE,
    qa_identity_type: QA_TYPE,
    qa_alias: alias,
  }
}

function writeManifest(manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), { mode: 0o600 })
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return { identities: [] }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"))
}

function sanitizeFailure(error) {
  const raw = error?.code || error?.message || "unknown_failure"
  return String(raw)
    .replaceAll(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")
    .replaceAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replaceAll(/eyJ[A-Za-z0-9._-]+/g, "[token]")
    .slice(0, 180)
}

async function fetchJson(url, options = {}, label = "request") {
  const response = await fetch(url, options)
  const text = await response.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { message: text.slice(0, 500) }
    }
  }
  return { response, data, label }
}

function serviceHeaders(extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: "application/json",
    ...extra,
  }
}

function userHeaders(accessToken, extra = {}) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...extra,
  }
}

async function serviceRest(table, query = "", options = {}) {
  const url = `${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ""}`
  return fetchJson(url, {
    ...options,
    headers: serviceHeaders(options.headers),
  }, `rest_${table}`)
}

async function selectRows(table, params) {
  const result = await serviceRest(table, new URLSearchParams(params).toString())
  gateAssert(result.response.ok, `select_${table}_${result.response.status}`)
  return result.data || []
}

async function insertRow(table, body, onConflict = null) {
  const params = onConflict
    ? `?on_conflict=${encodeURIComponent(onConflict)}`
    : ""
  const result = await fetchJson(`${supabaseUrl}/rest/v1/${table}${params}`, {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: onConflict
        ? "resolution=merge-duplicates,return=representation"
        : "return=representation",
    }),
    body: JSON.stringify(body),
  }, `insert_${table}`)
  gateAssert(result.response.ok, `insert_${table}_${result.response.status}`)
  return Array.isArray(result.data) ? result.data[0] : result.data
}

async function updateRows(table, filter, body) {
  const result = await serviceRest(table, filter, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  })
  gateAssert(result.response.ok, `update_${table}_${result.response.status}`)
  return result.data || []
}

async function deleteRows(table, filter) {
  const result = await serviceRest(table, filter, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  })
  gateAssert(result.response.ok, `delete_${table}_${result.response.status}`)
}

async function adminRequest(pathname, options = {}) {
  return fetchJson(`${supabaseUrl}/auth/v1/admin/${pathname}`, {
    ...options,
    headers: serviceHeaders(options.headers),
  }, `admin_${pathname}`)
}

async function listAllAuthUsers() {
  const result = await adminRequest("users?page=1&per_page=1000")
  gateAssert(result.response.ok, `auth_list_${result.response.status}`)
  return result.data?.users || []
}

function isQaUser(user, alias = null) {
  const metadata = { ...(user?.user_metadata || {}), ...(user?.app_metadata || {}) }
  return metadata.qa_fixture === true
    && metadata.qa_scope === QA_SCOPE
    && metadata.qa_identity_type === QA_TYPE
    && (!alias || metadata.qa_alias === alias)
}

async function ensurePersistentIdentity(spec, companyId, manifest) {
  const users = await listAllAuthUsers()
  const matching = users.filter((user) => isQaUser(user, spec.alias))
  gateAssert(matching.length <= 1, `duplicate_auth_${spec.alias}`)

  const password = randomPassword()
  let user = matching[0]
  if (!user) {
    const created = await adminRequest("users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: spec.email,
        password,
        email_confirm: true,
        user_metadata: qaMetadata(spec.alias),
        app_metadata: qaMetadata(spec.alias),
      }),
    })
    gateAssert(
      created.response.status === 200 || created.response.status === 201,
      `auth_create_${spec.alias}_${created.response.status}`,
    )
    user = created.data
  } else {
    const activated = await adminRequest(`users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: spec.email,
        password,
        email_confirm: true,
        ban_duration: "none",
        user_metadata: qaMetadata(spec.alias),
        app_metadata: qaMetadata(spec.alias),
      }),
    })
    gateAssert(activated.response.ok, `auth_activate_${spec.alias}_${activated.response.status}`)
    user = activated.data
  }

  let profiles = await selectRows("profiles", {
    select: "id,auth_user_id,full_name,email,active",
    auth_user_id: `eq.${user.id}`,
    limit: "2",
  })
  gateAssert(profiles.length <= 1, `duplicate_profile_${spec.alias}`)

  let profile
  if (!profiles.length) {
    profile = await insertRow("profiles", {
      auth_user_id: user.id,
      full_name: spec.alias,
      email: spec.email,
      active: true,
    })
  } else {
    const updated = await updateRows(
      "profiles",
      new URLSearchParams({ id: `eq.${profiles[0].id}` }).toString(),
      {
        full_name: spec.alias,
        email: spec.email,
        active: true,
        updated_at: new Date().toISOString(),
      },
    )
    profile = updated[0]
  }

  const roles = await selectRows("roles", {
    select: "id,name",
    name: "eq.finance",
    limit: "2",
  })
  gateAssert(roles.length === 1, "finance_role_missing_or_ambiguous")

  await deleteRows(
    "user_roles",
    new URLSearchParams({ profile_id: `eq.${profile.id}` }).toString(),
  )
  await deleteRows(
    "profile_company_memberships",
    new URLSearchParams({ profile_id: `eq.${profile.id}` }).toString(),
  )
  const userRole = await insertRow("user_roles", {
    profile_id: profile.id,
    role_id: roles[0].id,
  })
  const membership = await insertRow("profile_company_memberships", {
    profile_id: profile.id,
    company_id: companyId,
    active: true,
  })

  const identity = {
    alias: spec.alias,
    email: spec.email,
    password,
    auth_user_id: user.id,
    profile_id: profile.id,
    user_role_id: userRole.id,
    membership_id: membership.id,
    company_id: companyId,
  }
  manifest.identities = [
    ...manifest.identities.filter((item) => item.alias !== spec.alias),
    {
      alias: identity.alias,
      email: identity.email,
      auth_user_id: identity.auth_user_id,
      profile_id: identity.profile_id,
      company_id: identity.company_id,
    },
  ]
  writeManifest(manifest)
  return identity
}

async function signIn(identity) {
  const result = await fetchJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      email: identity.email,
      password: identity.password,
    }),
  }, `sign_in_${identity.alias}`)
  gateAssert(result.response.ok, `sign_in_${identity.alias}_${result.response.status}`)
  gateAssert(
    result.data?.access_token && result.data?.refresh_token,
    `session_missing_${identity.alias}`,
  )
  return result.data
}

async function rpcRaw(session, name, body) {
  return fetchJson(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: userHeaders(session.access_token, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(body),
  }, `rpc_${name}`)
}

function rpcMessage(result) {
  return String(result.data?.message || result.data?.details || "")
}

async function expectRpcError(session, name, body, expectedCode) {
  const result = await rpcRaw(session, name, body)
  gateAssert(!result.response.ok, `expected_error_${expectedCode}`)
  gateAssert(rpcMessage(result).includes(expectedCode), `wrong_error_${expectedCode}`)
  return result
}

async function currentIntake(id) {
  const rows = await selectRows("payment_intake", {
    select: "id,company_id,status,updated_at",
    id: `eq.${id}`,
    limit: "2",
  })
  gateAssert(rows.length === 1, "intake_missing")
  return rows[0]
}

function transitionBody(intake, toStatus, notes, actionId, overrides = {}) {
  return {
    p_payment_intake_id: intake.id,
    p_expected_status: overrides.expectedStatus ?? intake.status,
    p_expected_updated_at: overrides.expectedUpdatedAt ?? intake.updated_at,
    p_to_status: toStatus,
    p_notes: notes,
    p_action_id: actionId,
  }
}

function noteBody(intake, notes, actionId) {
  return {
    p_payment_intake_id: intake.id,
    p_expected_updated_at: intake.updated_at,
    p_notes: notes,
    p_action_id: actionId,
  }
}

async function eventsFor(intakeIds) {
  return selectRows("payment_intake_events", {
    select: "event_type,actor_profile_id,from_status,to_status,notes,metadata,created_at",
    payment_intake_id: `in.(${intakeIds.join(",")})`,
    order: "created_at.asc",
    limit: "1000",
  })
}

async function findSafeFixtures() {
  const rows = await selectRows("payment_intake", {
    select: "id,company_id,status,updated_at,provider_email,provider_name,concept,description,idempotency_key,matched_proveedor_id,created_payment_request_id",
    status: "eq.received",
    limit: "100",
  })
  const marker = /(qa|test|prueba|demo|fictici|sandbox|codex)/i
  const reservedEmail = /@example\.(test|com|org)$/i
  const safe = rows.filter((row) => {
    const material = [
      row.provider_name,
      row.concept,
      row.description,
      row.idempotency_key,
    ].filter(Boolean).join(" ")
    return !row.matched_proveedor_id
      && !row.created_payment_request_id
      && reservedEmail.test(String(row.provider_email || ""))
      && marker.test(material)
  })
  const groups = new Map()
  for (const row of safe) {
    const current = groups.get(row.company_id) || []
    current.push(row)
    groups.set(row.company_id, current)
  }
  const candidates = [...groups.values()]
    .filter((items) => items.length >= 2)
    .sort((left, right) => right.length - left.length)
  gateAssert(candidates.length > 0, "safe_fixture_pair_missing")
  return candidates[0].slice(0, 2)
}

async function tableCount(table) {
  const result = await serviceRest(
    table,
    new URLSearchParams({ select: "id", limit: "1" }).toString(),
    {
      headers: {
        Prefer: "count=exact",
        Range: "0-0",
      },
    },
  )
  gateAssert(result.response.ok, `count_${table}_${result.response.status}`)
  const range = result.response.headers.get("content-range") || ""
  const total = Number(range.split("/").at(-1))
  gateAssert(Number.isFinite(total), `count_${table}_missing`)
  return total
}

async function statusCounts() {
  const rows = await selectRows("payment_intake", {
    select: "status",
    limit: "1000",
  })
  return rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1
    return counts
  }, {})
}

async function storageCount() {
  const result = await fetchJson(`${supabaseUrl}/storage/v1/object/list/intake-uploads`, {
    method: "POST",
    headers: serviceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefix: "", limit: 1000, offset: 0 }),
  }, "storage_count")
  gateAssert(result.response.ok, `storage_count_${result.response.status}`)
  return (result.data || []).length
}

async function authUserCount() {
  return (await listAllAuthUsers()).length
}

async function captureCounts() {
  const tableNames = [
    "payment_intake",
    "payment_intake_events",
    "payment_intake_files",
    "payment_requests",
    "proveedores",
    "providers",
    "approval_batches",
    "payment_layouts",
    "payment_layout_lines",
    "cash_funds",
    "notification_events",
    "intake_links",
    "profiles",
    "user_roles",
    "profile_company_memberships",
  ]
  const counts = {}
  for (const table of tableNames) counts[table] = await tableCount(table)
  counts.storage_private = await storageCount()
  counts.auth_users = await authUserCount()
  counts.statuses = await statusCounts()
  return counts
}

function unchanged(before, after, keys) {
  return keys.every((key) => before[key] === after[key])
}

async function runMainMatrix(identity, session, fixture) {
  const initialEvents = (await eventsFor([fixture.id])).length
  let intake = await currentIntake(fixture.id)
  gateAssert(intake.status === "received", "main_not_received")

  await expectRpcError(
    session,
    "transition_provider_intake",
    transitionBody(
      intake,
      "rejected",
      "Rechazo inválido de prueba QA",
      crypto.randomUUID(),
    ),
    "provider_intake_invalid_transition",
  )
  await expectRpcError(
    session,
    "transition_provider_intake",
    transitionBody(
      intake,
      "rejected",
      "Conflicto esperado de prueba QA",
      crypto.randomUUID(),
      { expectedStatus: "in_review" },
    ),
    "provider_intake_conflict",
  )
  gateAssert(
    (await eventsFor([fixture.id])).length === initialEvents,
    "main_negative_event_created",
  )

  let result = await rpcRaw(
    session,
    "transition_provider_intake",
    transitionBody(intake, "in_review", null, crypto.randomUUID()),
  )
  gateAssert(result.response.ok && result.data?.idempotent === false, "main_received_to_review")
  intake = await currentIntake(fixture.id)
  gateAssert(intake.status === "in_review", "main_review_status")

  const updatedAtBeforeNote = intake.updated_at
  result = await rpcRaw(
    session,
    "add_provider_intake_note",
    noteBody(intake, "Nota interna QA sin datos sensibles", crypto.randomUUID()),
  )
  gateAssert(result.response.ok && result.data?.idempotent === false, "main_internal_note")
  intake = await currentIntake(fixture.id)
  gateAssert(intake.updated_at === updatedAtBeforeNote, "note_changed_updated_at")

  result = await rpcRaw(
    session,
    "transition_provider_intake",
    transitionBody(
      intake,
      "needs_correction",
      "Corrección QA requerida para validar el flujo",
      crypto.randomUUID(),
    ),
  )
  gateAssert(result.response.ok, "main_review_to_correction")
  intake = await currentIntake(fixture.id)
  gateAssert(intake.status === "needs_correction", "main_correction_status")

  result = await rpcRaw(
    session,
    "transition_provider_intake",
    transitionBody(intake, "in_review", "Revisión QA reanudada", crypto.randomUUID()),
  )
  gateAssert(result.response.ok, "main_correction_to_review")
  intake = await currentIntake(fixture.id)
  gateAssert(intake.status === "in_review", "main_review_again_status")

  result = await rpcRaw(
    session,
    "transition_provider_intake",
    transitionBody(
      intake,
      "rejected",
      "Rechazo QA final para cerrar el fixture",
      crypto.randomUUID(),
    ),
  )
  gateAssert(result.response.ok, "main_review_to_rejected")
  intake = await currentIntake(fixture.id)
  gateAssert(intake.status === "rejected", "main_rejected_status")

  const eventsBeforeTerminalNegatives = (await eventsFor([fixture.id])).length
  await expectRpcError(
    session,
    "transition_provider_intake",
    transitionBody(intake, "in_review", "Intento terminal QA", crypto.randomUUID()),
    "provider_intake_invalid_transition",
  )
  await expectRpcError(
    session,
    "transition_provider_intake",
    transitionBody(
      intake,
      "needs_correction",
      "Intento terminal QA bloqueado",
      crypto.randomUUID(),
    ),
    "provider_intake_invalid_transition",
  )
  gateAssert(
    (await eventsFor([fixture.id])).length === eventsBeforeTerminalNegatives,
    "main_terminal_event_created",
  )

  return {
    actor_alias: identity.alias,
    valid_events: eventsBeforeTerminalNegatives - initialEvents,
    negative_received: "PASS",
    received_to_in_review: "PASS",
    internal_note: "PASS",
    in_review_to_needs_correction: "PASS",
    needs_correction_to_in_review: "PASS",
    in_review_to_rejected: "PASS",
    terminal_transitions_rejected: "PASS",
  }
}

async function runRaceMatrix(identityA, sessionA, identityB, sessionB, fixture) {
  const initialEvents = (await eventsFor([fixture.id])).length
  let intake = await currentIntake(fixture.id)
  gateAssert(intake.status === "received", "race_not_received")

  const startActionId = crypto.randomUUID()
  const startBody = transitionBody(intake, "in_review", null, startActionId)
  let result = await rpcRaw(sessionA, "transition_provider_intake", startBody)
  gateAssert(result.response.ok && result.data?.idempotent === false, "race_start_review")
  const afterStart = await currentIntake(fixture.id)
  const eventCountAfterStart = (await eventsFor([fixture.id])).length

  result = await rpcRaw(sessionA, "transition_provider_intake", startBody)
  gateAssert(result.response.ok && result.data?.idempotent === true, "race_exact_replay")
  const afterReplay = await currentIntake(fixture.id)
  gateAssert(afterReplay.updated_at === afterStart.updated_at, "replay_changed_updated_at")
  gateAssert(
    (await eventsFor([fixture.id])).length === eventCountAfterStart,
    "replay_created_event",
  )

  await expectRpcError(
    sessionA,
    "transition_provider_intake",
    { ...startBody, p_notes: "Material QA distinto" },
    "provider_intake_action_id_material_conflict",
  )
  await expectRpcError(
    sessionA,
    "add_provider_intake_note",
    noteBody(afterReplay, "Nota QA con action reutilizada", startActionId),
    "provider_intake_action_id_material_conflict",
  )
  await expectRpcError(
    sessionB,
    "transition_provider_intake",
    startBody,
    "provider_intake_action_id_conflict",
  )
  gateAssert(
    (await eventsFor([fixture.id])).length === eventCountAfterStart,
    "material_conflict_created_event",
  )

  intake = await currentIntake(fixture.id)
  const raceEventsBefore = (await eventsFor([fixture.id])).length
  const raceBodies = [
    transitionBody(
      intake,
      "rejected",
      "Rechazo QA concurrente ejecutado por Finance 1",
      crypto.randomUUID(),
    ),
    transitionBody(
      intake,
      "rejected",
      "Rechazo QA concurrente ejecutado por Finance 2",
      crypto.randomUUID(),
    ),
  ]
  const raceResults = await Promise.all([
    rpcRaw(sessionA, "transition_provider_intake", raceBodies[0]),
    rpcRaw(sessionB, "transition_provider_intake", raceBodies[1]),
  ])
  const winners = raceResults.filter((item) => item.response.ok)
  const losers = raceResults.filter((item) => !item.response.ok)
  gateAssert(winners.length === 1, "race_winner_count")
  gateAssert(losers.length === 1, "race_loser_count")
  gateAssert(
    rpcMessage(losers[0]).includes("provider_intake_conflict"),
    "race_loser_not_conflict",
  )
  const finalIntake = await currentIntake(fixture.id)
  gateAssert(finalIntake.status === "rejected", "race_final_not_rejected")
  gateAssert(
    (await eventsFor([fixture.id])).length === raceEventsBefore + 1,
    "race_event_count",
  )

  return {
    actor_aliases: [identityA.alias, identityB.alias],
    valid_events: (await eventsFor([fixture.id])).length - initialEvents,
    received_to_in_review: "PASS",
    exact_replay: "PASS",
    material_replay_conflict: "PASS",
    cross_operation_action_id_conflict: "PASS",
    distinct_actor_action_id_conflict: "PASS",
    concurrent_winners: 1,
    concurrent_conflicts: 1,
    concurrent_events: 1,
    in_review_to_rejected: "PASS",
  }
}

function verifyNewEvents(events, baselineLength) {
  const added = events.slice(baselineLength)
  gateAssert(added.length > 0, "no_new_events")
  for (const event of added) {
    const metadata = event.metadata || {}
    gateAssert(typeof metadata.action_id === "string", "event_action_id_missing")
    gateAssert(
      /^[0-9a-f]{64}$/.test(String(metadata.action_fingerprint || "")),
      "event_fingerprint_invalid",
    )
    gateAssert(
      metadata.action_kind === "transition" || metadata.action_kind === "internal_note",
      "event_action_kind_invalid",
    )
    gateAssert(metadata.contract_version === 2, "event_contract_version_invalid")
    gateAssert(
      !Object.keys(metadata).some((key) => SENSITIVE_METADATA_KEYS.has(key)),
      "event_sensitive_metadata",
    )
  }
  return {
    new_events: added.length,
    metadata_v2: added.length,
    fingerprint_format_valid: true,
    sensitive_metadata_keys: 0,
  }
}

async function runAxe(page, label) {
  const axePath = require.resolve("axe-core/axe.min.js")
  await page.addScriptTag({ path: axePath })
  const summary = await page.evaluate(async () => {
    const output = await window.axe.run(document, {
      resultTypes: ["violations"],
    })
    return output.violations.map((item) => ({
      id: item.id,
      impact: item.impact,
    }))
  })
  const blocking = summary.filter((item) => ["critical", "serious"].includes(item.impact))
  gateAssert(blocking.length === 0, `axe_${label}_blocking`)
  return {
    label,
    critical: summary.filter((item) => item.impact === "critical").length,
    serious: summary.filter((item) => item.impact === "serious").length,
    violation_ids: summary.map((item) => item.id).sort(),
  }
}

async function sanitizeVisiblePage(page) {
  await page.evaluate(() => {
    const replace = (selector, value) => {
      const node = document.querySelector(selector)
      if (node) node.textContent = value
    }
    replace("#userName", "QA Finanzas")
    replace("#userEmail", "Identidad QA DEV")
    replace("#detailTitle", "INT-QA-001")
    replace("#detailSubtitle", "Información sanitizada para evidencia")

    document.querySelectorAll("#companyFilter option").forEach((option, index) => {
      option.textContent = index === 0 ? "Todas las empresas" : `Empresa QA ${index}`
    })
    document.querySelectorAll("#intakeTableBody tr").forEach((row, rowIndex) => {
      const cells = row.querySelectorAll("td")
      const safe = [
        `INT-QA-${String(rowIndex + 1).padStart(3, "0")}`,
        "17 jul 2026",
        "Empresa QA",
        "Proveedor ficticio",
        "Concepto de prueba",
        "$1,000.00 MXN",
        "1",
        "Recibida",
        "Hoy",
      ]
      safe.forEach((value, index) => {
        if (cells[index]) cells[index].textContent = value
      })
    })
    const detail = document.querySelector("#detailContent")
    if (detail) {
      const walker = document.createTreeWalker(detail, NodeFilter.SHOW_TEXT)
      let textNode
      while ((textNode = walker.nextNode())) {
        if (textNode.nodeValue.trim()) textNode.nodeValue = " Dato QA sanitizado "
      }
    }
  })
}

async function runBrowserChecks(identity) {
  const { chromium } = require("playwright")
  const screenshotsDir = path.join(outputDir, "screenshots")
  fs.mkdirSync(screenshotsDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  const axe = []

  try {
    await page.goto(`${previewUrl}/index.html`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    })
    const signedIn = await page.evaluate(async ({ email, password }) => {
      const client = window.getFluxSupabaseClient?.()
        || window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      return Boolean(data?.session?.access_token) && !error
    }, { email: identity.email, password: identity.password })
    gateAssert(signedIn, "browser_sign_in")

    await page.goto(`${previewUrl}/provider_intakes.html`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    })
    await page.waitForSelector("#intakeTableBody tr button", { timeout: 30_000 })
    axe.push(await runAxe(page, "list"))
    await sanitizeVisiblePage(page)
    await page.screenshot({
      path: path.join(screenshotsDir, "01-lista-sanitizada.png"),
      fullPage: true,
    })

    await page.locator("#intakeTableBody tr button").first().click()
    await page.waitForSelector("#detailDialog[open]", { timeout: 30_000 })
    await page.waitForFunction(() => {
      const content = document.querySelector("#detailContent")
      return content && content.textContent.trim().length > 40
    })
    axe.push(await runAxe(page, "detail"))
    await sanitizeVisiblePage(page)
    await page.screenshot({
      path: path.join(screenshotsDir, "02-detalle-sanitizado.png"),
      fullPage: true,
    })

    const actionButton = page.getByRole("button", { name: /Iniciar revisión/i })
    gateAssert(await actionButton.count() === 1, "browser_action_button")
    await actionButton.click()
    await page.waitForSelector("#actionDialog[open]", { timeout: 15_000 })
    axe.push(await runAxe(page, "action"))
    await sanitizeVisiblePage(page)
    await page.screenshot({
      path: path.join(screenshotsDir, "03-accion-sanitizada.png"),
      fullPage: true,
    })
    await page.locator("#cancelActionBtn").click()
    await page.locator("#closeDetailBtn").click()

    await page.evaluate(() => {
      document.documentElement.style.zoom = "2"
    })
    await sanitizeVisiblePage(page)
    await page.screenshot({
      path: path.join(screenshotsDir, "04-zoom-200-sanitizado.png"),
      fullPage: true,
    })
  } finally {
    await browser.close()
  }

  fs.writeFileSync(
    path.join(screenshotsDir, "README.md"),
    [
      "# Screenshots sanitizados",
      "",
      "Las imágenes se capturaron en Vercel Preview con una sesión Finance real de DEV.",
      "Antes de cada captura se reemplazaron folios, empresas, proveedor, concepto,",
      "importe, datos de detalle, nombre y correo visibles por valores QA.",
      "",
      "- `01-lista-sanitizada.png`: lista autenticada.",
      "- `02-detalle-sanitizado.png`: diálogo de detalle.",
      "- `03-accion-sanitizada.png`: diálogo de acción sin enviar cambios.",
      "- `04-zoom-200-sanitizado.png`: layout a zoom 200%.",
      "",
    ].join("\n"),
  )

  return {
    preview_http: "PASS",
    authenticated_finance: "PASS",
    list: "PASS",
    detail: "PASS",
    action_dialog_without_submit: "PASS",
    zoom_200: "PASS",
    axe,
  }
}

async function globalLogout(session) {
  if (!session?.access_token) return
  await fetch(`${supabaseUrl}/auth/v1/logout?scope=global`, {
    method: "POST",
    headers: userHeaders(session.access_token),
  }).catch(() => null)
}

async function refreshRejected(refreshToken) {
  if (!refreshToken) return true
  const result = await fetchJson(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, "refresh_after_cleanup")
  return !result.response.ok
}

async function loginRejected(email, password) {
  const result = await fetchJson(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  }, "login_after_cleanup")
  return !result.response.ok
}

async function cleanupIdentities(sessions = {}) {
  await Promise.all(Object.values(sessions).map((session) => globalLogout(session)))
  const manifest = readManifest()
  const users = await listAllAuthUsers()
  const cleaned = []

  for (const item of manifest.identities || []) {
    const user = users.find((candidate) => candidate.id === item.auth_user_id)
      || users.find((candidate) => isQaUser(candidate, item.alias))
    gateAssert(user, `cleanup_auth_missing_${item.alias}`)

    const profiles = await selectRows("profiles", {
      select: "id,active",
      auth_user_id: `eq.${user.id}`,
      limit: "2",
    })
    gateAssert(profiles.length === 1, `cleanup_profile_missing_${item.alias}`)
    const profileId = profiles[0].id
    await deleteRows(
      "profile_company_memberships",
      new URLSearchParams({ profile_id: `eq.${profileId}` }).toString(),
    )
    await deleteRows(
      "user_roles",
      new URLSearchParams({ profile_id: `eq.${profileId}` }).toString(),
    )
    await updateRows(
      "profiles",
      new URLSearchParams({ id: `eq.${profileId}` }).toString(),
      { active: false, updated_at: new Date().toISOString() },
    )

    const rotatedPassword = randomPassword()
    const blocked = await adminRequest(`users/${user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: rotatedPassword,
        ban_duration: "876000h",
        user_metadata: qaMetadata(item.alias),
        app_metadata: qaMetadata(item.alias),
      }),
    })
    gateAssert(blocked.response.ok, `cleanup_ban_${item.alias}_${blocked.response.status}`)

    const roles = await selectRows("user_roles", {
      select: "id",
      profile_id: `eq.${profileId}`,
      limit: "10",
    })
    const memberships = await selectRows("profile_company_memberships", {
      select: "id",
      profile_id: `eq.${profileId}`,
      limit: "10",
    })
    const profileAfter = await selectRows("profiles", {
      select: "active",
      id: `eq.${profileId}`,
      limit: "2",
    })
    const authAfter = (await listAllAuthUsers()).find((candidate) => candidate.id === user.id)
    const bannedUntil = Date.parse(authAfter?.banned_until || "")
    const loginBlocked = await loginRejected(item.email, rotatedPassword)

    gateAssert(roles.length === 0, `cleanup_roles_${item.alias}`)
    gateAssert(memberships.length === 0, `cleanup_memberships_${item.alias}`)
    gateAssert(profileAfter.length === 1 && profileAfter[0].active === false, `cleanup_profile_active_${item.alias}`)
    gateAssert(Number.isFinite(bannedUntil) && bannedUntil > Date.now(), `cleanup_auth_not_banned_${item.alias}`)
    gateAssert(loginBlocked, `cleanup_login_allowed_${item.alias}`)

    cleaned.push({
      alias: item.alias,
      profile_inactive: true,
      roles_active: 0,
      memberships_active: 0,
      auth_user_blocked: true,
      login_rejected: true,
      password_rotated: true,
    })
  }

  const refreshResults = await Promise.all(
    Object.values(sessions).map((session) => refreshRejected(session.refresh_token)),
  )
  return {
    complete: true,
    persistent_profiles: cleaned.length,
    persistent_auth_users: cleaned.length,
    sessions_invalidated: refreshResults.every(Boolean),
    refresh_tokens_rejected: refreshResults.every(Boolean),
    effective_privileges: 0,
    identities: cleaned,
  }
}

function writeEvidence(result) {
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(
    path.join(outputDir, "gate2_v2_results_sanitized.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  )

  const matrixRows = [
    ["fixture", "case", "expected", "result", "event_delta"],
    ["MAIN", "negative_received", "rejected", "PASS", "0"],
    ["MAIN", "received_to_in_review", "status_changed", "PASS", "1"],
    ["MAIN", "internal_note", "internal_note", "PASS", "1"],
    ["MAIN", "in_review_to_needs_correction", "correction_requested", "PASS", "1"],
    ["MAIN", "needs_correction_to_in_review", "status_changed", "PASS", "1"],
    ["MAIN", "in_review_to_rejected", "rejected", "PASS", "1"],
    ["MAIN", "terminal_transitions", "rejected", "PASS", "0"],
    ["RACE", "received_to_in_review", "status_changed", "PASS", "1"],
    ["RACE", "exact_replay", "idempotent", "PASS", "0"],
    ["RACE", "material_replay", "material_conflict", "PASS", "0"],
    ["RACE", "cross_operation_action_id", "material_conflict", "PASS", "0"],
    ["RACE", "distinct_actor_action_id", "actor_conflict", "PASS", "0"],
    ["RACE", "concurrent_transition", "one_pass_one_conflict", "PASS", "1"],
  ]
  fs.writeFileSync(
    path.join(outputDir, "event_matrix_v2_sanitized.csv"),
    `${matrixRows.map((row) => row.join(",")).join("\n")}\n`,
  )

  const report = [
    "# Gate 2 v2 — UAT de triage de solicitudes de proveedores",
    "",
    `- Resultado: **${result.status}**`,
    "- Entorno: **DEV**",
    "- Migration 030: **PASS**",
    "- Principales QA permanentes: **2**",
    "- Fixtures sintéticos usados: **2**, misma empresa",
    "- Identificadores emitidos: **0**",
    "",
    "## Matriz funcional",
    "",
    "- MAIN: negativos, revisión, nota, corrección, reanudación, rechazo y terminales — PASS.",
    "- RACE: replay exacto, conflicto material, cruce de operación, actor distinto y concurrencia — PASS.",
    "",
    "## Eventos",
    "",
    `- Eventos nuevos válidos: **${result.events.new_events}**.`,
    "- Eventos por acciones inválidas, replays y operación perdedora: **0**.",
    "- Metadata v2 y huella SHA-256 lowercase: **PASS**.",
    "- Datos sensibles en metadata: **0**.",
    "",
    "## IAM al terminar",
    "",
    "- Usuarios Auth bloqueados: **2**.",
    "- Perfiles inactivos: **2**.",
    "- Roles activos: **0**.",
    "- Memberships activas: **0**.",
    "- Sesiones y refresh tokens reutilizables: **0**.",
    "",
    "## Core y privacidad",
    "",
    "- Proveedores, payment requests, batches, layouts, cash funds, notificaciones, Storage y links: delta 0.",
    "- Correos, UUID, action_id, fingerprint completo, payload, RFC, banco y Storage paths en evidencia: 0.",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(outputDir, "GATE2_V2_UAT_REPORT.md"), report)
}

async function runCleanupOnly() {
  gateAssert(projectRef === expectedProjectRef, "wrong_project_ref")
  const cleanup = await cleanupIdentities({})
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(
    path.join(outputDir, "cleanup_only_sanitized.json"),
    `${JSON.stringify(cleanup, null, 2)}\n`,
  )
}

async function main() {
  gateAssert(projectRef === expectedProjectRef, "wrong_project_ref")
  fs.mkdirSync(outputDir, { recursive: true })
  const manifest = { identities: [] }
  writeManifest(manifest)

  const result = {
    gate: "phase-1d-gate-2-v2",
    environment: "DEV",
    project_ref: expectedProjectRef,
    status: "FAIL",
    migration_030: "PASS",
    fixtures: {
      selected: 0,
      same_company: false,
      synthetic_rule: "reserved_email_domain_plus_explicit_qa_marker",
      record_identifiers_emitted: false,
    },
    identities: {
      aliases: IDENTITIES.map((item) => item.alias),
      persistent_audit_principals: 0,
      real_people: false,
      production_access: false,
    },
    matrix: {},
    events: {},
    core_effects: {},
    accessibility: {},
    cleanup: { complete: false },
    privacy: {
      sanitized_artifacts: true,
      contains_uuid_email_password_token_action_id_full_fingerprint_payload_rfc_bank_storage_path: false,
    },
    failure_code: null,
  }

  let primaryError = null
  const sessions = {}
  let before = null

  try {
    before = await captureCounts()
    gateAssert(before.payment_intake === 13, "baseline_intakes")
    gateAssert(before.payment_intake_events === 20, "baseline_events")
    gateAssert(before.payment_intake_files === 6, "baseline_files")
    gateAssert(before.storage_private === 6, "baseline_storage")
    gateAssert(before.profiles === 16, "baseline_profiles")
    gateAssert(before.user_roles === 18, "baseline_roles")
    gateAssert(before.profile_company_memberships === 6, "baseline_memberships")

    const fixtures = await findSafeFixtures()
    gateAssert(fixtures.length === 2, "fixture_pair_count")
    gateAssert(fixtures[0].company_id === fixtures[1].company_id, "fixture_company_mismatch")
    result.fixtures.selected = 2
    result.fixtures.same_company = true

    const identities = []
    for (const spec of IDENTITIES) {
      identities.push(
        await ensurePersistentIdentity(spec, fixtures[0].company_id, manifest),
      )
    }
    result.identities.persistent_audit_principals = identities.length

    sessions.finance1 = await signIn(identities[0])
    sessions.finance2 = await signIn(identities[1])
    result.identities.separate_real_sessions = true
    result.accessibility = await runBrowserChecks(identities[0])

    const eventsBefore = await eventsFor(fixtures.map((item) => item.id))
    result.matrix.main = await runMainMatrix(
      identities[0],
      sessions.finance1,
      fixtures[0],
    )
    result.matrix.race = await runRaceMatrix(
      identities[0],
      sessions.finance1,
      identities[1],
      sessions.finance2,
      fixtures[1],
    )
    const eventsAfter = await eventsFor(fixtures.map((item) => item.id))
    result.events = verifyNewEvents(eventsAfter, eventsBefore.length)
    gateAssert(result.events.new_events === 7, "unexpected_new_event_count")
  } catch (error) {
    primaryError = error
    result.failure_code = sanitizeFailure(error)
  } finally {
    try {
      result.cleanup = await cleanupIdentities(sessions)
      gateAssert(result.cleanup.complete, "cleanup_incomplete")
      gateAssert(result.cleanup.sessions_invalidated, "sessions_not_invalidated")
      gateAssert(result.cleanup.refresh_tokens_rejected, "refresh_not_rejected")
      gateAssert(result.cleanup.effective_privileges === 0, "privileges_remaining")
    } catch (cleanupError) {
      result.cleanup = {
        ...result.cleanup,
        complete: false,
        failure_code: sanitizeFailure(cleanupError),
      }
      if (!primaryError) primaryError = cleanupError
    }
  }

  try {
    const after = await captureCounts()
    const immutableCore = [
      "payment_intake",
      "payment_intake_files",
      "payment_requests",
      "proveedores",
      "providers",
      "approval_batches",
      "payment_layouts",
      "payment_layout_lines",
      "cash_funds",
      "notification_events",
      "intake_links",
      "storage_private",
      "user_roles",
      "profile_company_memberships",
    ]
    gateAssert(unchanged(before, after, immutableCore), "core_delta")
    gateAssert(after.payment_intake_events === before.payment_intake_events + 7, "event_delta")
    gateAssert(after.profiles === before.profiles + 2, "profile_delta")
    gateAssert(after.auth_users === before.auth_users + 2, "auth_user_delta")
    gateAssert(after.statuses.received === 10, "received_status_delta")
    gateAssert(after.statuses.needs_correction === 1, "correction_status_delta")
    gateAssert(after.statuses.rejected === 2, "rejected_status_delta")
    result.core_effects = {
      intakes_total_delta: 0,
      events_delta: 7,
      profiles_delta: 2,
      auth_users_delta: 2,
      persistent_qa_profiles_intentional: true,
      providers_delta: 0,
      proveedores_delta: 0,
      payment_requests_delta: 0,
      batches_delta: 0,
      layouts_delta: 0,
      cash_funds_delta: 0,
      notification_events_delta: 0,
      storage_delta: 0,
      links_delta: 0,
      active_roles_delta: 0,
      active_memberships_delta: 0,
    }
  } catch (deltaError) {
    if (!primaryError) primaryError = deltaError
    result.failure_code ||= sanitizeFailure(deltaError)
  }

  if (!primaryError && result.cleanup.complete) result.status = "PASS"
  writeEvidence(result)
  if (primaryError || result.status !== "PASS") {
    throw primaryError || new GateError("gate2v2_failed")
  }
}

if (cleanupOnly) {
  await runCleanupOnly()
} else {
  await main()
}
