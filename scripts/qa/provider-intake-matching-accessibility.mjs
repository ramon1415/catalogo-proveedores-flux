import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export const AXE_CORE_VERSION = "4.10.3"
export const AXE_RUN_ONLY_TAGS = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
])

export const ACCESSIBILITY_STATE_ALIASES = Object.freeze([
  "main_eligible_unlinked",
  "main_set_dialog",
  "main_linked_a",
  "main_replace_dialog",
  "main_linked_b",
  "main_clear_dialog",
  "main_unlinked_after_clear",
  "race_conflict",
  "terminal_rejected",
])

const ACCESSIBILITY_STATE_SET = new Set(ACCESSIBILITY_STATE_ALIASES)
const EVIDENCE_KEYS = Object.freeze([
  "state",
  "axe_version",
  "critical",
  "serious",
  "moderate",
  "minor",
  "incomplete",
  "rule_ids",
  "nodes_total",
  "sanitized",
])
const FORBIDDEN_EVIDENCE_KEYS = new Set([
  "html",
  "target",
  "targets",
  "failureSummary",
  "failure_summary",
  "nodes",
  "selector",
  "selectors",
])
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu

export class AccessibilityGateError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.name = "AccessibilityGateError"
    this.code = code
    this.details = details
  }
}

function fail(code, details = {}) {
  throw new AccessibilityGateError(code, details)
}

function gate(value, code, details = {}) {
  if (!value) fail(code, details)
}

function normalizedOrigin(value) {
  try {
    return new URL(String(value)).origin
  } catch {
    fail("LIVE_ACCESSIBILITY_PREVIEW_ORIGIN_MISMATCH")
  }
}

export function createLocalAxeSource({
  source,
  version = AXE_CORE_VERSION,
  sourcePath = "axe.min.js",
} = {}) {
  gate(typeof source === "string" && source.length > 1_000, "LOCAL_AXE_SOURCE_UNAVAILABLE")
  gate(version === AXE_CORE_VERSION, "LOCAL_AXE_VERSION_MISMATCH")
  const identity = {
    version,
    sha256: crypto.createHash("sha256").update(source).digest("hex"),
    filename: path.basename(sourcePath),
    source_type: "local_dependency",
    network_downloads: 0,
  }
  Object.defineProperty(identity, "source", {
    value: source,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(identity)
}

export function loadLocalAxeSource(env = process.env) {
  let sourcePath = String(env.AXE_CORE_PATH || "").trim()
  let version = String(env.AXE_CORE_VERSION || "").trim()
  try {
    if (!sourcePath) sourcePath = require.resolve("axe-core/axe.min.js")
    if (!version) version = require("axe-core/package.json").version
  } catch {
    fail("LOCAL_AXE_SOURCE_UNAVAILABLE")
  }
  let source
  try {
    source = fs.readFileSync(sourcePath, "utf8")
  } catch {
    fail("LOCAL_AXE_SOURCE_UNAVAILABLE")
  }
  return createLocalAxeSource({ source, version, sourcePath })
}

export function sanitizedAxeSourceIdentity(localAxe) {
  gate(localAxe?.version === AXE_CORE_VERSION, "LOCAL_AXE_VERSION_MISMATCH")
  gate(/^[0-9a-f]{64}$/.test(localAxe.sha256), "LOCAL_AXE_SOURCE_UNAVAILABLE")
  return {
    version: localAxe.version,
    sha256: localAxe.sha256,
    filename: localAxe.filename,
    source_type: "local_dependency",
    injection: "playwright_add_script_tag_content",
    network_downloads: 0,
    source_exported: false,
  }
}

export function assertSanitizedAccessibilityEvidence(value, sensitiveValues = []) {
  gate(value && typeof value === "object" && !Array.isArray(value), "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  gate(
    Object.keys(value).length === EVIDENCE_KEYS.length &&
      EVIDENCE_KEYS.every((key) => Object.hasOwn(value, key)),
    "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED",
  )
  gate(
    typeof value.state === "string" && /^[a-z][a-z0-9_]{2,80}$/.test(value.state),
    "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED",
  )
  gate(value.axe_version === AXE_CORE_VERSION, "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  for (const key of ["critical", "serious", "moderate", "minor", "incomplete", "nodes_total"]) {
    gate(Number.isInteger(value[key]) && value[key] >= 0, "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  }
  gate(
    Array.isArray(value.rule_ids) && value.rule_ids.every(
      (rule) => typeof rule === "string" && /^[a-z0-9-]{1,120}$/.test(rule),
    ),
    "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED",
  )
  gate(value.sanitized === true, "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  const serialized = JSON.stringify(value)
  gate(!UUID_PATTERN.test(serialized), "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  for (const forbidden of sensitiveValues) {
    const candidate = String(forbidden || "").trim()
    if (candidate) gate(!serialized.includes(candidate), "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  }
  const inspectKeys = (entry) => {
    if (!entry || typeof entry !== "object") return
    for (const [key, nested] of Object.entries(entry)) {
      gate(!FORBIDDEN_EVIDENCE_KEYS.has(key), "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
      inspectKeys(nested)
    }
  }
  inspectKeys(value)
  return true
}

export function validateAccessibilityStateManifest(manifest) {
  gate(Array.isArray(manifest), "LIVE_ACCESSIBILITY_STATE_MISSING")
  gate(manifest.length === ACCESSIBILITY_STATE_ALIASES.length, "LIVE_ACCESSIBILITY_STATE_MISSING")
  for (const [index, expected] of ACCESSIBILITY_STATE_ALIASES.entries()) {
    const state = manifest[index]
    gate(state?.stateAlias === expected, "LIVE_ACCESSIBILITY_STATE_MISSING")
    for (const operation of ["prepare", "ready", "cleanup"]) {
      gate(typeof state[operation] === "function", "LIVE_ACCESSIBILITY_STATE_MISSING")
    }
  }
  return true
}

export function createAccessibilityStateManifest(handlers = {}) {
  const manifest = ACCESSIBILITY_STATE_ALIASES.map((stateAlias) => {
    const state = handlers[stateAlias] || {}
    return Object.freeze({
      stateAlias,
      prepare: state.prepare,
      ready: state.ready,
      cleanup: state.cleanup,
    })
  })
  validateAccessibilityStateManifest(manifest)
  return Object.freeze(manifest)
}

export function createAccessibilityHookRecorder() {
  const results = new Map()
  return Object.freeze({
    record(stateAlias, evidence) {
      gate(ACCESSIBILITY_STATE_SET.has(stateAlias), "LIVE_ACCESSIBILITY_STATE_MISSING")
      gate(!results.has(stateAlias), "LIVE_ACCESSIBILITY_STATE_DUPLICATE")
      assertSanitizedAccessibilityEvidence(evidence)
      results.set(stateAlias, structuredClone(evidence))
      return evidence
    },
    assertComplete() {
      for (const stateAlias of ACCESSIBILITY_STATE_ALIASES) {
        gate(results.has(stateAlias), "LIVE_ACCESSIBILITY_STATE_MISSING", { state: stateAlias })
      }
      return true
    },
    sanitizedSummary() {
      return {
        status: results.size === ACCESSIBILITY_STATE_ALIASES.length ? "PASS" : "INCOMPLETE",
        states_required: ACCESSIBILITY_STATE_ALIASES.length,
        states_audited: results.size,
        state_aliases: ACCESSIBILITY_STATE_ALIASES.filter((state) => results.has(state)),
        critical: Array.from(results.values()).reduce((total, item) => total + item.critical, 0),
        serious: Array.from(results.values()).reduce((total, item) => total + item.serious, 0),
        moderate: Array.from(results.values()).reduce((total, item) => total + item.moderate, 0),
        minor: Array.from(results.values()).reduce((total, item) => total + item.minor, 0),
        incomplete: Array.from(results.values()).reduce((total, item) => total + item.incomplete, 0),
        sanitized: true,
      }
    },
  })
}

export async function injectLocalAxe(page, localAxe) {
  gate(page && typeof page.addScriptTag === "function", "LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
  gate(localAxe?.source && localAxe.version === AXE_CORE_VERSION, "LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
  const existing = await page.evaluate(() => window.axe?.version || null)
  if (!existing) await page.addScriptTag({ content: localAxe.source })
  const version = await page.evaluate(() => window.axe?.version || null)
  gate(version === AXE_CORE_VERSION, "LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
  return version
}

async function waitForStableDom(page) {
  await page.waitForLoadState("domcontentloaded")
  await page.evaluate(() => new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))
  }))
  await page.waitForTimeout(40)
}

export async function auditAccessibilityPage(page, {
  stateAlias,
  environment,
  evidenceMode,
  authorizedOrigin,
  localAxe,
  sensitiveValues = [],
} = {}) {
  gate(environment === "LIVE_PREVIEW_NO_WRITE" || environment === "MUTABLE_DEV" || environment === "VISUAL_LOCAL", "LIVE_ACCESSIBILITY_ENVIRONMENT_INVALID")
  gate(evidenceMode === "SANITIZED", "LIVE_ACCESSIBILITY_EVIDENCE_UNSANITIZED")
  gate(typeof stateAlias === "string" && /^[a-z][a-z0-9_]{2,80}$/.test(stateAlias), "LIVE_ACCESSIBILITY_STATE_MISSING")
  gate(normalizedOrigin(page.url()) === normalizedOrigin(authorizedOrigin), "LIVE_ACCESSIBILITY_PREVIEW_ORIGIN_MISMATCH")
  await waitForStableDom(page)
  const axeVersion = await injectLocalAxe(page, localAxe)
  const raw = await page.evaluate(async (tags) => {
    const result = await window.axe.run(document, {
      runOnly: { type: "tag", values: tags },
    })
    const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
    const rules = new Set()
    let nodesTotal = 0
    for (const violation of result.violations || []) {
      if (Object.hasOwn(counts, violation.impact)) counts[violation.impact] += 1
      rules.add(String(violation.id || "unknown-rule"))
      nodesTotal += Array.isArray(violation.nodes) ? violation.nodes.length : 0
    }
    const incomplete = (result.incomplete || []).reduce(
      (total, item) => total + (Array.isArray(item.nodes) ? item.nodes.length : 0),
      0,
    )
    return {
      critical: counts.critical,
      serious: counts.serious,
      moderate: counts.moderate,
      minor: counts.minor,
      incomplete,
      rule_ids: Array.from(rules).sort(),
      nodes_total: nodesTotal,
    }
  }, AXE_RUN_ONLY_TAGS)
  const evidence = {
    state: stateAlias,
    axe_version: axeVersion,
    critical: raw.critical,
    serious: raw.serious,
    moderate: raw.moderate,
    minor: raw.minor,
    incomplete: raw.incomplete,
    rule_ids: raw.rule_ids,
    nodes_total: raw.nodes_total,
    sanitized: true,
  }
  assertSanitizedAccessibilityEvidence(evidence, sensitiveValues)
  gate(evidence.critical === 0 && evidence.serious === 0, "LIVE_ACCESSIBILITY_VIOLATION", {
    state: stateAlias,
    critical: evidence.critical,
    serious: evidence.serious,
    rule_ids: evidence.rule_ids,
    sanitized: true,
  })
  return evidence
}

export async function auditAccessibilityState(page, options = {}) {
  gate(ACCESSIBILITY_STATE_SET.has(options.stateAlias), "LIVE_ACCESSIBILITY_STATE_MISSING")
  return auditAccessibilityPage(page, options)
}

export async function runAccessibilityStateManifest(manifest, auditor) {
  validateAccessibilityStateManifest(manifest)
  gate(typeof auditor === "function", "LIVE_ACCESSIBILITY_INSTRUMENTATION_ABSENT")
  const evidence = []
  for (const state of manifest) {
    let prepared
    try {
      prepared = await state.prepare()
      gate(await state.ready(prepared), "LIVE_ACCESSIBILITY_STATE_UNREACHABLE", {
        state: state.stateAlias,
      })
      evidence.push(await auditor(prepared, state.stateAlias))
    } finally {
      await state.cleanup(prepared)
    }
  }
  return evidence
}
