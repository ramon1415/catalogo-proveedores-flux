import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")

const migration = read("supabase/migrations/033_separate_approval_material_from_payment_execution_data.sql")
const precheck = read("scripts/qa/approval-execution-layout-hotfix-precheck.sql")
const config = read("config.js")
const configurationHtml = read("configuracion.html")
const configurationClient = read("configuracion.js")
const batchesHtml = read("approval_batches.html")
const batchesClient = read("approval_batches.js")
const layoutsHtml = read("layouts.html")
const layoutsClient = read("layouts.js")
const frontend = [
  config,
  configurationHtml,
  configurationClient,
  batchesHtml,
  batchesClient,
  layoutsHtml,
  layoutsClient,
].join("\n")

const materialFields = Object.freeze([
  "company_id",
  "requested_by",
  "proveedor_id",
  "provider_id",
  "cost_center_id",
  "budget_category_id",
  "budget_month",
  "amount_requested",
  "currency",
  "exchange_rate",
  "request_type",
  "payment_method",
  "is_extraordinary_adjustment",
  "concept",
  "description",
])

const requestExecutionFields = Object.freeze([
  "provider_bank_account_id",
  "company_bank_account_id",
  "due_date",
  "scheduled_payment_date",
  "payment_reference",
  "payment_concept",
])

const providerExecutionFields = Object.freeze([
  "destination_type",
  "clabe",
  "cuenta_bancaria",
  "convenio_number",
  "beneficiary_name",
  "banco",
])

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function sqlFunction(name) {
  const marker = new RegExp(
    `create(?:\\s+or\\s+replace)?\\s+function\\s+public\\.${escapeRegex(name)}\\s*\\(`,
    "i",
  )
  const match = marker.exec(migration)
  assert.ok(match, `missing SQL function public.${name}`)
  const tail = migration.slice(match.index)
  const bodyStart = tail.search(/\bas\s+\$\$/i)
  assert.notEqual(bodyStart, -1, `missing dollar-quoted body for public.${name}`)
  const end = tail.indexOf("\n$$;", bodyStart)
  assert.notEqual(end, -1, `unterminated SQL function public.${name}`)
  return tail.slice(0, end + 4)
}

function jsFunction(source, name) {
  const marker = new RegExp(`(?:async\\s+)?function\\s+${escapeRegex(name)}\\s*\\(`)
  const match = marker.exec(source)
  assert.ok(match, `missing JavaScript function ${name}`)
  const parameterOpen = source.indexOf("(", match.index)
  let parameterDepth = 0
  let parameterQuote = ""
  let parameterEscaped = false
  let parameterClose = -1
  for (let index = parameterOpen; index < source.length; index += 1) {
    const character = source[index]
    if (parameterQuote) {
      if (parameterEscaped) parameterEscaped = false
      else if (character === "\\") parameterEscaped = true
      else if (character === parameterQuote) parameterQuote = ""
      continue
    }
    if (character === "'" || character === '"' || character === "`") {
      parameterQuote = character
      continue
    }
    if (character === "(") parameterDepth += 1
    if (character === ")") {
      parameterDepth -= 1
      if (parameterDepth === 0) {
        parameterClose = index
        break
      }
    }
  }
  assert.notEqual(parameterClose, -1, `unterminated parameters for JavaScript function ${name}`)
  const open = source.indexOf("{", parameterClose)
  assert.notEqual(open, -1, `missing body for JavaScript function ${name}`)

  let depth = 0
  let quote = ""
  let escaped = false
  let lineComment = false
  let blockComment = false

  for (let index = open; index < source.length; index += 1) {
    const character = source[index]
    const next = source[index + 1]

    if (lineComment) {
      if (character === "\n") lineComment = false
      continue
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (character === "\\") {
        escaped = true
      } else if (character === quote) {
        quote = ""
      }
      continue
    }
    if (character === "/" && next === "/") {
      lineComment = true
      index += 1
      continue
    }
    if (character === "/" && next === "*") {
      blockComment = true
      index += 1
      continue
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character
      continue
    }
    if (character === "{") depth += 1
    if (character === "}") {
      depth -= 1
      if (depth === 0) return source.slice(match.index, index + 1)
    }
  }

  assert.fail(`unterminated JavaScript function ${name}`)
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim()
}

function folded(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "")
}

function idsIn(html) {
  return [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1])
}

function returnedJsonKeys(definition) {
  const match = definition.match(/return\s+jsonb_build_object\s*\(([\s\S]*?)\n\s*\);\s*\nend/i)
  assert.ok(match, "missing final jsonb_build_object return")
  return [...match[1].matchAll(/'([a-z][a-z0-9_]*)'\s*,/g)].map((entry) => entry[1])
}

function sqlCallArguments(source, functionName) {
  const calls = []
  const marker = new RegExp(`\\b${escapeRegex(functionName)}\\s*\\(`, "gi")
  let match

  while ((match = marker.exec(source))) {
    const open = source.indexOf("(", match.index)
    let depth = 1
    let argumentStart = open + 1
    let quote = ""
    let lineComment = false
    let blockComment = false
    const args = []

    for (let index = open + 1; index < source.length; index += 1) {
      const character = source[index]
      const next = source[index + 1]

      if (lineComment) {
        if (character === "\n") lineComment = false
        continue
      }
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false
          index += 1
        }
        continue
      }
      if (quote) {
        if (character === quote && next === quote) {
          index += 1
          continue
        }
        if (character === quote) quote = ""
        continue
      }
      if (character === "-" && next === "-") {
        lineComment = true
        index += 1
        continue
      }
      if (character === "/" && next === "*") {
        blockComment = true
        index += 1
        continue
      }
      if (character === "'" || character === '"') {
        quote = character
        continue
      }
      if (character === "(") {
        depth += 1
        continue
      }
      if (character === ")") {
        depth -= 1
        if (depth === 0) {
          args.push(source.slice(argumentStart, index).trim())
          calls.push(args)
          marker.lastIndex = index + 1
          break
        }
        continue
      }
      if (character === "," && depth === 1) {
        args.push(source.slice(argumentStart, index).trim())
        argumentStart = index + 1
      }
    }
  }

  return calls
}

function inspectedFunctionTokens(source) {
  return sqlCallArguments(source, "strpos")
    .filter((args) => (
      args.length === 2
      && compact(args[0]).toLowerCase() === "lower(function_info.prosrc)"
    ))
    .map((args) => {
      const token = args[1].match(/^'((?:''|[^'])*)'$/)
      assert.ok(token, `unexpected strpos needle: ${args[1]}`)
      return token[1].replace(/''/g, "'")
    })
}

function functionDefinitionInspectionChunks(source) {
  const firstProcedure = "public.mark_payment_request_material_change()"
  const firstProcedureIndex = source.indexOf(`'${firstProcedure}'::regprocedure`)
  assert.ok(firstProcedureIndex > 0, "missing material-change precheck procedure")
  const blockStart = source.lastIndexOf("if not exists (", firstProcedureIndex)
  const blockEnd = source.indexOf(
    "function definitions drift from the expected 022/023 baseline",
    firstProcedureIndex,
  )
  assert.ok(blockStart >= 0 && blockEnd > blockStart, "missing function-definition drift block")
  const block = source.slice(blockStart, blockEnd)
  const procedures = [...block.matchAll(/'(public\.[a-z][a-z0-9_]*\([^']*\))'::regprocedure/gi)]

  return procedures.map((entry, index) => {
    const chunkStart = entry.index
    const chunkEnd = procedures[index + 1]?.index ?? block.length
    return {
      regprocedure: entry[1],
      source: block.slice(chunkStart, chunkEnd),
    }
  })
}

function functionDefinitionInspectionContract(source) {
  return functionDefinitionInspectionChunks(source).map((chunk) => ({
    regprocedure: chunk.regprocedure,
    tokens: inspectedFunctionTokens(chunk.source),
  }))
}

function assertExactStrposPredicate(source, haystack, needle, operator, context) {
  const escapedNeedle = needle.replaceAll("'", "''")
  const predicate = new RegExp(
    `\\bstrpos\\s*\\(\\s*${escapeRegex(haystack)}\\s*,\\s*'${escapeRegex(escapedNeedle)}'\\s*\\)\\s*${escapeRegex(operator)}\\s*0\\b`,
    "gi",
  )
  const matches = [...source.matchAll(predicate)]
  assert.equal(
    matches.length,
    1,
    `${context} must contain exactly one ${haystack}/${needle} ${operator} 0 predicate`,
  )
}

test("migration 033 separates the exact material and request-execution fields", () => {
  const material = sqlFunction("mark_payment_request_material_change")
  assert.doesNotMatch(material, /security\s+definer/i)

  for (const field of materialFields) {
    assert.match(material, new RegExp(`\\bold\\.${field}\\b`, "i"), `${field} must be material`)
    assert.match(material, new RegExp(`\\bnew\\.${field}\\b`, "i"), `${field} must be material`)
  }
  for (const field of requestExecutionFields) {
    assert.doesNotMatch(
      material,
      new RegExp(`\\b(?:old|new)\\.${field}\\b`, "i"),
      `${field} must not advance approval materiality`,
    )
  }
  assert.match(
    material,
    /else\s+new\.approval_material_updated_at\s*:=\s*old\.approval_material_updated_at/i,
  )

  const guard = sqlFunction("guard_payment_request_execution_data_update")
  for (const field of requestExecutionFields) {
    assert.match(guard, new RegExp(`\\bold\\.${field}\\b`, "i"))
    assert.match(guard, new RegExp(`\\bnew\\.${field}\\b`, "i"))
  }
  assert.match(guard, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(guard, /flux\.payment_execution_rpc/i)
  assert.match(guard, /payment_execution_rpc_required/i)
  assert.match(guard, /company_account\.company_id\s*=\s*new\.company_id/i)
  assert.match(guard, /coalesce\s*\(\s*company_account\.active\s*,\s*false\s*\)/i)
})

test("provider banking completion is validated and audited without touching approval timestamps", () => {
  const provider = sqlFunction("mark_provider_payment_material_change")
  for (const field of providerExecutionFields) {
    assert.match(provider, new RegExp(`\\bold\\.${field}\\b`, "i"))
    assert.match(provider, new RegExp(`\\bnew\\.${field}\\b`, "i"))
    assert.match(provider, new RegExp(`then\\s+'${field}'`, "i"))
  }
  assert.match(provider, /security\s+definer/i)
  assert.match(provider, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(provider, /insert\s+into\s+public\.activity_log/i)
  assert.match(provider, /provider_payment_execution_missing_fields\s*\(\s*new\s*\)/i)
  assert.match(provider, /flux\.provider_payment_execution_rpc/i)
  assert.match(provider, /provider_payment_execution_rpc_required/i)
  assert.doesNotMatch(provider, /approval_material_updated_at/i)
  assert.doesNotMatch(provider, /update\s+public\.payment_requests/i)
  assert.doesNotMatch(provider, /notification_events/i)
  assert.doesNotMatch(provider, /to_jsonb\s*\(\s*(?:old|new)\s*\)/i)

  const completion = sqlFunction("complete_provider_payment_execution_data")
  assert.match(completion, /security\s+definer/i)
  assert.match(completion, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(completion, /pg_advisory_xact_lock/i)
  assert.match(completion, /from\s+public\.proveedores[\s\S]{0,140}for\s+update/i)
  assert.match(completion, /flux\.provider_payment_execution_rpc/i)
  assert.match(completion, /update\s+public\.proveedores/i)
  const keys = returnedJsonKeys(completion)
  assert.deepEqual(keys.sort(), [
    "changed_fields",
    "completed_fields",
    "execution_data_updated",
    "history_preserved",
    "missing_fields",
    "proveedor_id",
  ].sort())
  for (const sensitiveKey of [
    "clabe",
    "cuenta_bancaria",
    "convenio_number",
    "beneficiary_name",
    "banco",
  ]) {
    assert.equal(keys.includes(sensitiveKey), false, `${sensitiveKey} leaked in provider RPC response`)
  }
  assert.match(layoutsClient, /\.rpc\s*\(\s*["']complete_provider_payment_execution_data["']/i)
  for (const field of [
    "company_bank_account_company_mismatch",
    "source_account_number_invalid",
    "payment_reference_invalid",
    "payment_concept_invalid",
    "destination_type_invalid",
    "clabe_invalid",
    "cuenta_bancaria_invalid",
    "convenio_number_invalid",
    "beneficiary_name_invalid",
    "banco_invalid",
  ]) {
    assert.match(layoutsClient, new RegExp(`["']${field}["']`, "i"), `${field} must be actionable`)
  }

  const insertGuard = sqlFunction("guard_provider_payment_execution_data_insert")
  assert.match(insertGuard, /security\s+definer/i)
  assert.match(insertGuard, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(insertGuard, /flux\.provider_payment_execution_rpc/i)
  assert.match(insertGuard, /provider_payment_execution_rpc_required/i)
  assert.match(
    migration,
    /create\s+trigger\s+provider_payment_execution_data_insert_guard\s+before\s+insert\s+on\s+public\.proveedores/i,
  )

  const catalogSave = sqlFunction("save_provider_catalog_with_payment_execution_data")
  assert.match(catalogSave, /security\s+definer/i)
  assert.match(catalogSave, /provider_payload_contains_unsupported_fields/i)
  assert.match(catalogSave, /jsonb_populate_record/i)
  assert.match(catalogSave, /approval_batch_require_actor\s*\(\s*\)/i)
  assert.match(catalogSave, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(
    catalogSave,
    /v_execution_changed[\s\S]{0,180}not\s+coalesce\s*\(\s*v_after\.activo\s*,\s*false\s*\)[\s\S]{0,120}proveedor_not_found_or_inactive/i,
  )
  assert.match(catalogSave, /pg_advisory_xact_lock/i)
  assert.match(catalogSave, /flux\.provider_payment_execution_rpc/i)
  assert.match(catalogSave, /insert\s+into\s+public\.proveedores/i)
  assert.match(catalogSave, /update\s+public\.proveedores/i)
  assert.match(catalogSave, /return\s+jsonb_build_object\s*\(\s*['"]id['"]\s*,\s*v_after\.id\s*\)/i)
  assert.doesNotMatch(catalogSave, /\bexecute\s+(?:format|immediate)|notification_events/i)

  const providerAdapter = jsFunction(config, "applyProviderCatalogRpcCompatibility")
  assert.doesNotMatch(providerAdapter, /pageName\s*!==/i)
  assert.match(
    providerAdapter,
    /\.rpc\s*\(\s*["']save_provider_catalog_with_payment_execution_data["']/i,
  )
  assert.match(providerAdapter, /tableName\s*!==\s*["']proveedores["']/i)
  assert.match(providerAdapter, /\["alias",\s*"nombre_completo",\s*"metodo_pago"\]/i)
  assert.match(providerAdapter, /builder\.insert[\s\S]{0,220}isCatalogFormPayload/i)
  assert.match(providerAdapter, /builder\.update[\s\S]{0,220}isCatalogFormPayload/i)
  assert.match(providerAdapter, /originalInsert\s*\(\s*payload\s*,\s*options\s*\)/i)
  assert.match(providerAdapter, /originalUpdate\s*\(\s*payload\s*,\s*options\s*\)/i)
})

test("provider catalog adapter routes full saves atomically and leaves narrow updates direct", async () => {
  const rpcCalls = []
  const directMutations = []
  const client = {
    from(tableName) {
      const builder = {
        insert(payload) {
          directMutations.push({ kind: "insert", tableName, payload })
          return builder
        },
        update(payload) {
          directMutations.push({ kind: "update", tableName, payload })
          return builder
        },
        eq() {
          return builder
        },
        select() {
          return builder
        },
        single() {
          return builder
        },
        maybeSingle() {
          return builder
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data: { id: "direct" }, error: null })
            .then(onFulfilled, onRejected)
        },
      }
      return builder
    },
    rpc(name, args) {
      rpcCalls.push({ name, args })
      return Promise.resolve({
        data: { id: args.p_proveedor_id || "created-provider" },
        error: null,
      })
    },
  }
  const windowMock = { getFluxSupabaseClient: () => client }
  const adapterSource = jsFunction(config, "applyProviderCatalogRpcCompatibility")
  const installAdapter = Function(
    "pageName",
    "window",
    `"use strict"; ${adapterSource}; return applyProviderCatalogRpcCompatibility;`,
  )("proveedores.html", windowMock)
  installAdapter()

  const fullPayload = {
    alias: "Proveedor QA",
    nombre_completo: "Proveedor Sintético",
    metodo_pago: "transfer",
    destination_type: "clabe",
    clabe: "000000000000000000",
  }
  const created = await client
    .from("proveedores")
    .insert(fullPayload)
    .select("id")
    .single()
  const quickCreated = await client
    .from("proveedores")
    .insert({ ...fullPayload, alias: "Proveedor rápido" })
    .select("id,alias,nombre_completo,metodo_pago")
    .maybeSingle()
  const updated = await client
    .from("proveedores")
    .update(fullPayload)
    .eq("id", "provider-1")
    .select("id")
    .single()
  await client
    .from("proveedores")
    .update({ activo: false, updated_at: "2026-07-23T00:00:00Z" })
    .eq("id", "provider-1")
  await client
    .from("proveedores")
    .update({ csf_file_path: "private/path", csf_uploaded_by: "actor" })
    .eq("id", "provider-1")

  assert.deepEqual(created.data, { id: "created-provider" })
  assert.equal(quickCreated.data.id, "created-provider")
  assert.equal(quickCreated.data.alias, "Proveedor rápido")
  assert.deepEqual(updated.data, { id: "provider-1" })
  assert.equal(created.error, null)
  assert.equal(quickCreated.error, null)
  assert.equal(updated.error, null)
  assert.deepEqual(rpcCalls.map(({ name }) => name), [
    "save_provider_catalog_with_payment_execution_data",
    "save_provider_catalog_with_payment_execution_data",
    "save_provider_catalog_with_payment_execution_data",
  ])
  assert.equal(rpcCalls[0].args.p_proveedor_id, null)
  assert.equal(rpcCalls[1].args.p_proveedor_id, null)
  assert.equal(rpcCalls[2].args.p_proveedor_id, "provider-1")
  assert.deepEqual(
    directMutations.map(({ kind, payload }) => [kind, Object.keys(payload).sort()]),
    [
      ["update", ["activo", "updated_at"]],
      ["update", ["csf_file_path", "csf_uploaded_by"]],
    ],
  )
})

test("layout completion RPC is finance-only, locked, approval-preserving, and response-safe", () => {
  const complete = sqlFunction("complete_payment_request_layout_data")
  assert.match(complete, /security\s+definer/i)
  assert.match(complete, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(complete, /pg_advisory_xact_lock/i)
  assert.match(complete, /flux\.payment_execution_rpc/i)
  assert.match(complete, /from\s+public\.payment_requests[\s\S]{0,180}for\s+update/i)
  assert.match(complete, /approval_batch_request_has_any_execution_record/i)
  assert.match(complete, /payment_request_layout_data_locked/i)
  assert.match(complete, /provider\.id\s*=\s*v_request_before\.proveedor_id[\s\S]{0,100}provider\.activo/i)
  assert.match(
    complete,
    /company_account\.company_id\s*=\s*v_request_before\.company_id[\s\S]{0,120}company_account\.active/i,
  )
  assert.match(complete, /approval_material_updated_at\s+is\s+distinct\s+from\s+v_material_before/i)
  assert.match(complete, /operational_update_changed_approval_material_timestamp/i)
  assert.match(complete, /v_direction_was_current\s+and\s+not\s+v_direction_is_current/i)
  assert.match(complete, /operational_update_invalidated_direction_approval/i)
  assert.match(
    complete,
    /v_direction_reapproval_required\s*:=\s*not\s+v_direction_is_current\s+and\s+exists/i,
  )

  const keys = returnedJsonKeys(complete)
  assert.deepEqual(keys.sort(), [
    "approval_preserved",
    "changed_fields",
    "completed_fields",
    "direction_approval_current",
    "direction_reapproval_required",
    "direction_was_current",
    "execution_data_updated",
    "history_preserved",
    "missing_fields",
    "payment_request_id",
  ].sort())
  for (const sensitiveKey of [
    "company_bank_account_id",
    "payment_reference",
    "payment_concept",
    "account_number",
    "clabe",
    "cuenta_bancaria",
  ]) {
    assert.equal(keys.includes(sensitiveKey), false, `${sensitiveKey} leaked in RPC response`)
  }
})

test("Solicitudes execution editor routes through the finance RPC and leaves material updates direct", async () => {
  const adapter = jsFunction(config, "applyPaymentRequestExecutionRpcCompatibility")
  assert.doesNotMatch(adapter, /pageName\s*!==/i)
  assert.match(adapter, /tableName\s*!==\s*["']payment_requests["']/i)
  assert.match(adapter, /\.rpc\s*\(\s*["']complete_payment_request_layout_data["']/i)
  assert.match(adapter, /payment_execution_rpc_requires_exact_id/i)
  for (const field of [
    "company_bank_account_id",
    "scheduled_payment_date",
    "payment_reference",
    "payment_concept",
  ]) {
    assert.match(adapter, new RegExp(`["']${field}["']`, "i"))
  }

  const rpcCalls = []
  const directMutations = []
  const client = {
    from(tableName) {
      const builder = {
        update(payload) {
          directMutations.push({ tableName, payload })
          return builder
        },
        eq() {
          return builder
        },
        select() {
          return builder
        },
        single() {
          return builder
        },
        maybeSingle() {
          return builder
        },
        then(onFulfilled, onRejected) {
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
        },
      }
      return builder
    },
    rpc(name, args) {
      rpcCalls.push({ name, args })
      return Promise.resolve({
        data: {
          payment_request_id: args.p_payment_request_id,
          approval_preserved: true,
        },
        error: null,
      })
    },
  }
  const windowMock = { getFluxSupabaseClient: () => client }
  const installAdapter = Function(
    "window",
    `"use strict"; ${adapter}; return applyPaymentRequestExecutionRpcCompatibility;`,
  )(windowMock)
  installAdapter()

  const operationalPayload = {
    company_bank_account_id: "account-1",
    scheduled_payment_date: "2026-07-24",
    payment_reference: "12345",
    payment_concept: "Pago QA",
    updated_at: "2026-07-23T00:00:00Z",
  }
  const routed = await client
    .from("payment_requests")
    .update(operationalPayload)
    .eq("id", "request-1")
  const selected = await client
    .from("payment_requests")
    .update(operationalPayload)
    .eq("id", "request-2")
    .select("id,payment_reference")
    .single()
  const missingId = await client
    .from("payment_requests")
    .update(operationalPayload)
  await client
    .from("payment_requests")
    .update({ amount_requested: 100, updated_at: "2026-07-23T00:00:00Z" })
    .eq("id", "request-1")
  await client
    .from("payment_requests")
    .update({ amount_requested: 100, payment_concept: "Cambio mixto" })
    .eq("id", "request-1")

  assert.equal(routed.error, null)
  assert.deepEqual(selected.data, { id: "request-2", payment_reference: "12345" })
  assert.equal(missingId.error?.message, "payment_execution_rpc_requires_exact_id")
  assert.deepEqual(rpcCalls, [
    {
      name: "complete_payment_request_layout_data",
      args: {
        p_payment_request_id: "request-1",
        p_company_bank_account_id: "account-1",
        p_scheduled_payment_date: "2026-07-24",
        p_payment_reference: "12345",
        p_payment_concept: "Pago QA",
      },
    },
    {
      name: "complete_payment_request_layout_data",
      args: {
        p_payment_request_id: "request-2",
        p_company_bank_account_id: "account-1",
        p_scheduled_payment_date: "2026-07-24",
        p_payment_reference: "12345",
        p_payment_concept: "Pago QA",
      },
    },
  ])
  assert.deepEqual(
    directMutations.map(({ payload }) => Object.keys(payload).sort()),
    [
      ["amount_requested", "updated_at"],
      ["amount_requested", "payment_concept"],
    ],
  )
})

test("layout classifier keeps stale material changes critical and fresh closed approvals ready", () => {
  const classifier = compact(sqlFunction("approval_batch_payment_layout_candidates")).toLowerCase()
  const stale = classifier.indexOf(
    "when b.director_status = 'approved' and not b.direction_decision_fresh then 'direction_reapproval_required'",
  )
  assert.notEqual(stale, -1, "missing stale-Direction classification")
  const regularMissing = classifier.indexOf(
    "when cardinality(b.missing_fields) > 0 then 'invalid_data'",
    stale,
  )
  assert.ok(
    regularMissing > stale,
    "a real stale approval must remain critical even when execution data is incomplete",
  )
  assert.match(
    classifier,
    /when b\.director_status = 'approved' and b\.source_batch_status = 'closed' and b\.direction_approval_current then 'ready_regular'/,
  )
  assert.match(classifier, /payment_request_layout_missing_fields\(pr\) as missing_fields/)
  assert.match(classifier, /when m\.classification = 'direction_reapproval_required' then 'direction_reapproval_required'/)
})

test("future-Director RPC is atomic, role/profile checked, unique, and enforcement-neutral", () => {
  const director = sqlFunction("set_company_director_for_future_batches")
  assert.match(director, /security\s+definer/i)
  assert.match(director, /approval_batch_require_finance\s*\(\s*\)/i)
  assert.match(
    director,
    /p_director_profile_id\s*=\s*v_actor[\s\S]{0,100}director_self_assignment_not_allowed/i,
  )
  assert.match(director, /pg_advisory_xact_lock/i)
  assert.match(director, /from\s+public\.companies[\s\S]{0,160}company\.active[\s\S]{0,80}for\s+update/i)
  assert.match(director, /from\s+public\.profiles[\s\S]{0,120}profile\.active/i)
  assert.match(director, /from\s+public\.user_roles[\s\S]{0,100}join\s+public\.roles/i)
  assert.match(director, /approval_batch_direction_roles\s*\(\s*\)/i)
  assert.match(
    director,
    /from\s+public\.profile_company_memberships[\s\S]{0,180}profile_id\s*=\s*p_director_profile_id[\s\S]{0,120}company_id\s*=\s*p_company_id[\s\S]{0,80}membership\.active/i,
  )
  assert.match(director, /director_company_membership_required/i)
  assert.match(
    director,
    /update\s+public\.company_directors[\s\S]{0,180}set\s+active\s*=\s*false/i,
  )
  assert.match(director, /insert\s+into\s+public\.company_directors/i)
  assert.match(director, /insert\s+into\s+public\.activity_log/i)
  assert.doesNotMatch(director, /approval_batch_company_settings/i)
  assert.doesNotMatch(director, /approval_batches/i)
  assert.doesNotMatch(director, /regular_payments_require_closed_batch|enforcement_started_at/i)

  assert.match(
    migration,
    /create\s+unique\s+index\s+company_directors_one_active_per_company_uidx\s+on\s+public\.company_directors\s*\(\s*company_id\s*\)\s+where\s+active\s*;/i,
  )
  assert.match(
    migration,
    /from\s+public\.company_directors[\s\S]{0,180}where\s+director_assignment\.active[\s\S]{0,120}group\s+by\s+director_assignment\.company_id[\s\S]{0,80}having\s+count\(\*\)\s*>\s*1/i,
  )
})

test("Director modal uses the isolated RPC and contains no legacy enforcement controls", () => {
  const combined = `${batchesHtml}\n${batchesClient}`
  for (const forbidden of [
    "directorActive",
    "batchEnforcementEnabled",
    "batchEnforcementHelp",
    "set_company_batch_configuration",
    "regular_payments_require_closed_batch",
    "Activar corte cerrado obligatorio",
    "Compatibilidad legacy",
    "Corte cerrado obligatorio",
    "Pagos regulares",
  ]) {
    assert.equal(combined.includes(forbidden), false, `legacy Director UI remains: ${forbidden}`)
  }

  for (const id of [
    "directorCompanyId",
    "directorCurrentName",
    "directorCurrentStatus",
    "directorProfileId",
    "directorCandidateStatus",
    "saveDirectorBtn",
  ]) {
    assert.match(batchesHtml, new RegExp(`\\bid=["']${id}["']`, "i"), `missing #${id}`)
  }
  assert.match(batchesHtml, />Guardar Director</i)
  assert.match(batchesClient, /\.rpc\s*\(\s*["']set_company_director_for_future_batches["']/i)
  assert.match(batchesClient, /\bp_company_id\s*:\s*companyId/i)
  assert.match(batchesClient, /\bp_director_profile_id\s*:\s*directorProfileId/i)
  assert.match(batchesClient, /No hay perfiles activos con rol Dirección disponibles\./i)
  assert.match(
    batchesClient,
    /current[\s\S]{0,120}directorCandidates\.some[\s\S]{0,160}directorProfileId\.value\s*=\s*current\.director_profile_id/i,
  )
  assert.doesNotMatch(batchesClient, /directorCandidates\s*\[\s*0\s*\]/i)
  assert.doesNotMatch(
    jsFunction(batchesClient, "saveDirector"),
    /finally\s*\{[\s\S]{0,100}(?:submit|saveDirectorBtn)\.disabled\s*=\s*false/i,
  )
})

test("inactive profiles remain historical, are excluded from memberships, and cannot reuse role cache", () => {
  assert.match(configurationHtml, /Estado del perfil/i)
  assert.match(
    configurationHtml,
    /Solo los perfiles activos pueden recibir una membresía\.\s*El rol y el estado del perfil son controles independientes\./i,
  )
  assert.match(configurationClient, /u\.active\s*===\s*true\s*\?\s*["']Activo["']\s*:\s*["']Inactivo["']/i)
  assert.match(
    configurationClient,
    /Este perfil conserva historial, pero no puede agregarse a una membresía ni utilizarse como aprobador\./i,
  )
  const selectors = jsFunction(configurationClient, "populateRoutingBaseSelectors")
  assert.match(selectors, /allUsers\.filter\s*\(\s*user\s*=>\s*user\.active\s*===\s*true\s*\)/i)

  const roleSave = jsFunction(configurationClient, "saveAssignRole")
  assert.match(roleSave, /await\s+loadSystemAdministration\s*\(\s*\)/i)
  assert.doesNotMatch(roleSave, /\.from\s*\(\s*["']profiles["']\s*\)/i)
  const systemReload = jsFunction(configurationClient, "loadSystemAdministration")
  assert.match(systemReload, /await\s+loadUsers\s*\(\s*\)/i)
  assert.match(systemReload, /await\s+loadApproverRoutingAdmin\s*\(\s*\)/i)

  assert.match(config, /INACTIVE\s*:\s*["']inactive["']/i)
  assert.match(config, /isInactive\s*:\s*\(\)\s*=>\s*roleState\.group\s*===\s*ROLE_GROUPS\.INACTIVE/i)
  const loadRole = jsFunction(config, "loadRoleState")
  assert.match(
    loadRole,
    /roleState\.profile\s*&&\s*roleState\.profile\.active\s*!==\s*true[\s\S]{0,180}roleState\.roles\s*=\s*\[\][\s\S]{0,120}ROLE_GROUPS\.INACTIVE[\s\S]{0,120}clearRoleStateCache\s*\(\s*\)/i,
  )
  const hydrate = jsFunction(config, "hydrateRoleStateFromCache")
  assert.match(hydrate, /clearRoleStateCache\s*\(\s*\)/i)
  assert.doesNotMatch(hydrate, /sessionStorage\.getItem|JSON\.parse/i)
  assert.match(jsFunction(config, "fallbackFirstPaintModules"), /return\s+\[\]/i)
  assert.match(jsFunction(config, "readCachedNavHtml"), /return\s+["']{2}/i)
  assert.match(
    jsFunction(config, "resolveRoleAccess"),
    /ROLE_GROUPS\.INACTIVE[\s\S]{0,240}location\.replace\s*\(\s*["']\.\/pending\.html["']\s*\)[\s\S]{0,240}new\s+Promise\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/i,
  )
  assert.match(config, /defaultLandingForRole[\s\S]{0,220}ROLE_GROUPS\.INACTIVE[\s\S]{0,80}pending\.html/i)
  assert.match(folded(config), /Perfil inactivo[\s\S]{0,220}no puede acceder a modulos operativos/i)
})

test("layout preview invalidates filters, ignores stale responses, and reevaluates completion once", () => {
  assert.match(layoutsClient, /let\s+layoutPreviewRequestSequence\s*=\s*0/i)
  assert.match(layoutsClient, /let\s+activeLayoutPreviewRequestId\s*=\s*0/i)
  assert.match(layoutsClient, /let\s+inFlightLayoutPreviewRequestId\s*=\s*null/i)
  assert.match(
    layoutsClient,
    /\[\s*dom\.layoutPeriodStart\s*,\s*dom\.layoutPeriodEnd\s*\][\s\S]{0,180}invalidateLayoutPreview\s*\(\s*\{\s*filtersChanged\s*:\s*true\s*\}\s*\)/i,
  )
  assert.match(
    layoutsClient,
    /layoutCompanyId\?\.addEventListener\s*\(\s*["']change["'][\s\S]{0,180}invalidateLayoutPreview\s*\(\s*\{\s*filtersChanged\s*:\s*true\s*\}\s*\)/i,
  )
  assert.match(
    layoutsClient,
    /layoutBankAccountId\?\.addEventListener\s*\(\s*["']change["'][\s\S]{0,140}invalidateLayoutPreview\s*\(\s*\{\s*filtersChanged\s*:\s*true\s*\}\s*\)/i,
  )

  const invalidate = jsFunction(layoutsClient, "invalidateLayoutPreview")
  assert.match(invalidate, /activeLayoutPreviewRequestId\s*=\s*\+\+layoutPreviewRequestSequence/i)
  assert.match(invalidate, /layoutEligibilityPreview\s*=\s*null/i)
  assert.match(invalidate, /layoutEligibilityPreviewParamsKey\s*=\s*null/i)
  assert.match(invalidate, /layoutEligibilityPreview\.innerHTML\s*=\s*["']/i)
  assert.match(invalidate, /submitNewLayoutBtn\.disabled\s*=\s*true/i)
  assert.match(invalidate, /resetLayoutPreviewScrollPositions\s*\(\s*\)/i)
  assert.match(invalidate, /Los filtros cambiaron\. Revisa nuevamente las solicitudes\./i)

  const review = jsFunction(layoutsClient, "reviewLayoutEligibility")
  assert.match(review, /if\s*\(\s*inFlightLayoutPreviewRequestId\s*!==\s*null\s*\)\s*return/i)
  assert.match(review, /const\s+requestId\s*=\s*\+\+layoutPreviewRequestSequence/i)
  assert.match(
    review,
    /requestId\s*!==\s*activeLayoutPreviewRequestId\s*\|\|\s*paramsKey\s*!==\s*layoutPreviewParamsKey\s*\(\s*\)/i,
  )
  assert.match(review, /inFlightLayoutPreviewRequestId\s*===\s*requestId[\s\S]{0,100}=\s*null/i)

  const complete = jsFunction(layoutsClient, "submitLayoutCompletion")
  assert.equal(
    (complete.match(/await\s+reviewLayoutEligibility\s*\(\s*\)/g) || []).length,
    1,
    "completion must issue exactly one fresh preview",
  )
  assert.match(
    folded(complete),
    /Datos de ejecucion completados\. La autorizacion de Direccion se conserva\./i,
  )
})

test("layout ready count is independent of invalid rows and empty states are specific", () => {
  const render = jsFunction(layoutsClient, "renderLayoutEligibilityPreview")
  assert.match(render, /const\s+ready\s*=\s*\[\s*\.\.\.regular\s*,\s*\.\.\.extraordinary\s*,\s*\.\.\.legacy\s*\]/i)
  assert.match(render, /submitNewLayoutBtn\.disabled\s*=\s*ready\.length\s*===\s*0/i)
  assert.match(render, /`Crear layout con \$\{ready\.length\}/i)
  assert.doesNotMatch(render, /ready\.length\s*===\s*0\s*\|\||invalid\.length\s*&&\s*ready/i)

  const normalized = folded(render)
  for (const message of [
    "Completa los datos pendientes",
    "Finanzas debe cerrar el corte",
    "Pendiente de decision de Direccion",
    "Requiere nueva autorizacion de Direccion",
    "No hay pagos liberados",
  ]) {
    assert.ok(normalized.includes(message), `missing layout state: ${message}`)
  }
})

test("layout dialog scroll is container-scoped, resettable, and responsive", () => {
  assert.doesNotMatch(layoutsClient, /\.scrollIntoView\s*\(/i)
  const resetScroll = jsFunction(layoutsClient, "resetLayoutPreviewScrollPositions")
  assert.match(resetScroll, /container\.scrollTop\s*=\s*0/i)
  assert.match(resetScroll, /layout-preview-list[\s\S]{0,100}list\.scrollTop\s*=\s*0/i)
  const scroll = jsFunction(layoutsClient, "scrollLayoutModalToSection")
  assert.match(scroll, /layoutModalScrollContainer\s*\(\s*\)/i)
  assert.match(scroll, /container\.getBoundingClientRect\s*\(\s*\)/i)
  assert.match(scroll, /container\.scrollTo\s*\(/i)
  assert.doesNotMatch(scroll, /window\.scroll|scrollIntoView/i)

  const css = compact(layoutsHtml)
  assert.match(css, /#newLayoutDialog \.modal-content\{[^}]*max-height:[^}]*min-height:0/i)
  assert.match(css, /#newLayoutDialog \.modal-header,#newLayoutDialog \.modal-actions\{[^}]*flex:0 0 auto/i)
  assert.match(css, /#newLayoutDialog \.modal-scroll\{[^}]*min-height:0[^}]*overflow:auto/i)
  assert.match(css, /#newLayoutDialog \.modal-scroll>\*\{[^}]*flex:0 0 auto/i)
  assert.match(css, /\.layout-preview-list\{[^}]*max-height:[^}]*min-height:0[^}]*overflow:auto/i)
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*760px\s*\)/i)
  assert.match(layoutsHtml, /<dialog\s+id=["']newLayoutDialog["'][^>]*aria-labelledby=["']newLayoutDialogTitle["']/i)
  assert.match(layoutsHtml, /<h2\s+id=["']newLayoutDialogTitle["']/i)
  assert.match(layoutsHtml, /id=["']closeNewLayoutModalBtn["'][^>]*aria-label=["']Cerrar diálogo["']/i)
})

test("all touched HTML files have unique IDs", () => {
  for (const [name, html] of [
    ["configuracion.html", configurationHtml],
    ["approval_batches.html", batchesHtml],
    ["layouts.html", layoutsHtml],
  ]) {
    const ids = idsIn(html)
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
    assert.ok(ids.length > 0, `${name} has no IDs`)
    assert.deepEqual(duplicates, [], `${name} has duplicate IDs: ${duplicates.join(", ")}`)
  }
})

test("new SQL functions pin search_path and expose the exact authenticated RPC surface", () => {
  const functionNames = [...migration.matchAll(
    /create(?:\s+or\s+replace)?\s+function\s+public\.([a-z][a-z0-9_]*)\s*\(/gi,
  )].map((match) => match[1])
  assert.ok(functionNames.length >= 9, "expected all migration 033 functions")
  for (const name of functionNames) {
    assert.match(
      sqlFunction(name),
      /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i,
      `public.${name} must pin search_path`,
    )
  }

  for (const name of [
    "payment_request_layout_missing_fields",
    "guard_payment_request_execution_data_update",
    "audit_payment_request_execution_data_update",
    "mark_provider_payment_material_change",
    "guard_provider_payment_execution_data_insert",
    "approval_batch_payment_layout_candidates",
    "complete_provider_payment_execution_data",
    "save_provider_catalog_with_payment_execution_data",
    "complete_payment_request_layout_data",
    "set_company_director_for_future_batches",
    "list_company_directors",
    "list_approval_batch_director_candidates",
  ]) {
    assert.match(sqlFunction(name), /security\s+definer/i, `public.${name} must be SECURITY DEFINER`)
  }

  const grants = [...migration.matchAll(
    /grant\s+execute\s+on\s+function\s+public\.([a-z][a-z0-9_]*)\s*\([^;]*?\)\s+to\s+authenticated\s*;/gi,
  )].map((match) => match[1])
  assert.deepEqual(grants.sort(), [
    "complete_payment_request_layout_data",
    "complete_provider_payment_execution_data",
    "list_approval_batch_director_candidates",
    "list_company_directors",
    "save_provider_catalog_with_payment_execution_data",
    "set_company_director_for_future_batches",
  ].sort())
  assert.doesNotMatch(migration, /grant\s+execute[\s\S]{0,180}\bto\s+(?:public|anon|service_role)\b/i)
  for (const name of [
    "complete_payment_request_layout_data",
    "complete_provider_payment_execution_data",
    "list_approval_batch_director_candidates",
    "list_company_directors",
    "save_provider_catalog_with_payment_execution_data",
    "set_company_director_for_future_batches",
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}\\s*\\([^;]*?\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role\\s*;`,
        "i",
      ),
    )
  }
  assert.match(
    migration,
    /revoke\s+insert\s*,\s*update\s*,\s*delete\s*,\s*truncate\s+on\s+table\s+public\.activity_log\s+from\s+public\s*,\s*anon\s*,\s*authenticated(?:\s*,\s*service_role)?\s*;/i,
  )
})

test("read-only precheck is independently executable and drift-aware", () => {
  assert.match(precheck, /begin\s*;\s*set\s+transaction\s+read\s+only\s*;/i)
  assert.match(precheck, /rollback\s*;\s*$/i)
  assert.doesNotMatch(precheck, /^\s*(?:insert|update|delete|alter|create|drop|truncate|commit)\b/im)
  assert.match(precheck, /trigger_info\.tgtype\s*=\s*23/i)
  assert.match(precheck, /trigger_info\.tgtype\s*=\s*17/i)
  assert.match(precheck, /trigger_info\.tgattr::smallint\[\]/i)
  assert.match(precheck, /function definitions drift from the expected 022\/023 baseline/i)
  assert.match(precheck, /stale_closed_direction_requests/i)
  assert.match(precheck, /AMBIGUOUS_UNTIL_AUDITED/i)
})

test("migration and standalone prechecks use valid PostgreSQL search syntax with semantic parity", () => {
  for (const [name, sql] of [
    ["migration 033", migration],
    ["standalone precheck", precheck],
  ]) {
    const invalidPositionCalls = sqlCallArguments(sql, "position")
      .filter((args) => args.length > 1)
    assert.deepEqual(
      invalidPositionCalls,
      [],
      `${name} contains prohibited position(argument_1, argument_2) syntax`,
    )
  }

  const expectedInspectionContract = [
    {
      regprocedure: "public.mark_payment_request_material_change()",
      tokens: [
        "old.provider_bank_account_id",
        "old.company_bank_account_id",
        "old.due_date",
        "old.scheduled_payment_date",
        "old.payment_reference",
        "old.payment_concept",
      ],
    },
    {
      regprocedure: "public.mark_provider_payment_material_change()",
      tokens: [
        "update public.payment_requests",
        "approval_material_updated_at",
      ],
    },
    {
      regprocedure:
        "public.complete_payment_request_layout_data(uuid,uuid,text,text,date)",
      tokens: [
        "approval_batch_require_finance",
        "update public.payment_requests",
        "direction_reapproval_required",
      ],
    },
    {
      regprocedure:
        "public.approval_batch_payment_layout_candidates(date,date,uuid,uuid)",
      tokens: [
        "direction_reapproval_required",
        "ready_regular",
        "legacy_eligible",
      ],
    },
  ]
  const standaloneContract = functionDefinitionInspectionContract(precheck)
  const embeddedContract = functionDefinitionInspectionContract(migration)
  assert.deepEqual(standaloneContract, expectedInspectionContract)
  assert.deepEqual(embeddedContract, expectedInspectionContract)
  assert.deepEqual(embeddedContract, standaloneContract)
  for (const [name, sql] of [
    ["migration 033 embedded precheck", migration],
    ["standalone precheck", precheck],
  ]) {
    const chunks = functionDefinitionInspectionChunks(sql)
    for (const procedure of expectedInspectionContract) {
      const chunk = chunks.find(({ regprocedure }) => regprocedure === procedure.regprocedure)
      assert.ok(chunk, `${name} is missing ${procedure.regprocedure}`)
      for (const token of procedure.tokens) {
        assertExactStrposPredicate(
          chunk.source,
          "lower(function_info.prosrc)",
          token,
          ">",
          `${name} ${procedure.regprocedure}`,
        )
      }
    }
  }

  for (const [haystack, needle] of [
    ["v_provider_insert_guard.source", "approval_batch_require_finance"],
    ["v_provider_insert_guard.source", "flux.provider_payment_execution_rpc"],
    ["v_provider_insert_guard.source", "provider_payment_execution_data_invalid"],
    ["v_director_candidates.source", "approval_batch_require_finance"],
    ["v_director_candidates.source", "profile_company_memberships"],
  ]) {
    assertExactStrposPredicate(
      migration,
      haystack,
      needle,
      "=",
      "migration 033 postcheck",
    )
  }

  const standaloneCorrections = sqlCallArguments(precheck, "strpos")
  const migrationCorrections = sqlCallArguments(migration, "strpos")
  assert.equal(standaloneCorrections.length, 14)
  assert.equal(migrationCorrections.length, 19)
  assert.equal(
    standaloneCorrections.length + migrationCorrections.length,
    33,
    "all 33 invalid PostgreSQL calls must remain corrected",
  )
})

test("hotfix adds no frontend privilege, notification, receipt mutation, or destructive SQL path", () => {
  assert.doesNotMatch(frontend, /service_role|serviceRole|notification_events/i)
  assert.doesNotMatch(
    migration,
    /\b(?:create\s+table|insert\s+into|update|delete\s+from|alter\s+table|drop\s+table)\s+public\.notification_events\b/i,
  )
  assert.doesNotMatch(migration, /\bdrop\s+(?:table|schema|column|function|index)\b/i)
  assert.doesNotMatch(migration, /\btruncate\s+(?:table\s+)?public\./i)
  assert.doesNotMatch(migration, /\bdelete\s+from\s+public\./i)
  assert.doesNotMatch(
    migration,
    /\b(?:insert\s+into|update|delete\s+from|alter\s+table|drop\s+table|truncate\s+table)\s+public\.payment_receipts\b/i,
  )
  assert.doesNotMatch(
    migration,
    /update\s+public\.payment_requests[\s\S]{0,260}\bset\b[\s\S]{0,360}\bapproval_material_updated_at\s*=/i,
  )
  assert.match(migration, /(?:^|\n)\s*begin\s*;/i)
  assert.match(migration, /commit\s*;\s*$/i)
})
