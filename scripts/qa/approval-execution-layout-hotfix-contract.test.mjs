import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..", "..")
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8")
const precheck = read("scripts/qa/approval-execution-layout-hotfix-precheck.sql")
const precheck034 = read("scripts/qa/approval-execution-layout-034-precheck.sql")
const postcheck034 = read("scripts/qa/approval-execution-layout-034-postcheck.sql")
const config = read("config.js")
const configurationHtml = read("configuracion.html")
const configurationClient = read("configuracion.js")
const batchesHtml = read("approval_batches.html")
const batchesClient = read("approval_batches.js")
const layoutsHtml = read("layouts.html")
const layoutsClient = read("layouts.js")

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

test("Director modal uses add/remove RPCs and contains no replacement or enforcement controls", () => {
  const combined = `${batchesHtml}\n${batchesClient}`
  for (const forbidden of [
    "batchEnforcementEnabled",
    "batchEnforcementHelp",
    "set_company_batch_configuration",
    "regular_payments_require_closed_batch",
    "Activar corte cerrado obligatorio",
    "Compatibilidad legacy",
    "Corte cerrado obligatorio",
    "Pagos regulares",
    "set_company_director_for_future_batches",
  ]) {
    assert.equal(combined.includes(forbidden), false, `legacy Director UI remains: ${forbidden}`)
  }

  for (const id of [
    "directorCompanyId",
    "directorActiveCount",
    "directorActiveList",
    "directorProfileId",
    "directorCandidateStatus",
    "saveDirectorBtn",
  ]) {
    assert.match(batchesHtml, new RegExp(`\\bid=["']${id}["']`, "i"), `missing #${id}`)
  }
  assert.match(batchesHtml, /Directores activos para futuros cortes/i)
  assert.match(batchesHtml, />Agregar Director</i)
  assert.match(batchesClient, />Quitar</i)
  assert.match(batchesClient, /\.rpc\s*\(\s*["']add_company_director_for_future_batches["']/i)
  assert.match(batchesClient, /\.rpc\s*\(\s*["']remove_company_director_for_future_batches["']/i)
  assert.match(batchesClient, /\bp_company_id\s*:\s*companyId/i)
  assert.match(batchesClient, /\bp_director_profile_id\s*:\s*directorProfileId/i)
  assert.match(batchesClient, /No hay Directores elegibles pendientes de agregar\./i)
  assert.match(batchesClient, /activeRows\.length\s*<=\s*1\s*\?\s*["']disabled["']/i)
  assert.match(batchesClient, /Agregar un Director no reemplaza a los existentes/i)
  assert.doesNotMatch(batchesClient, /directorCandidates\s*\[\s*0\s*\]/i)
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
  assert.match(css, /#newLayoutDialog \.modal-content,#layoutCompletionDialog \.modal-content\{[^}]*max-height:[^}]*min-width:0[^}]*min-height:0/i)
  assert.match(css, /#newLayoutDialog \.modal-header,#newLayoutDialog \.modal-actions,[^}]*\{[^}]*flex:0 0 auto[^}]*min-width:0/i)
  assert.match(css, /#newLayoutDialog \.modal-scroll,#layoutCompletionDialog \.modal-scroll\{[^}]*min-width:0[^}]*min-height:0[^}]*overflow:auto/i)
  assert.match(css, /#newLayoutDialog \.modal-scroll>\*,#layoutCompletionDialog \.modal-scroll>\*\{[^}]*flex:0 0 auto[^}]*min-width:0/i)
  assert.match(css, /\.layout-preview-list\{[^}]*max-height:[^}]*min-height:0[^}]*overflow:auto/i)
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*760px\s*\)/i)
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*360px\s*\)/i)
  assert.match(css, /\.layout-preview-summary,\.layout-preview-row,\.layout-completion-summary\{grid-template-columns:minmax\(0,1fr\)/i)
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

test("034 precheck is read-only, project-specific, and preserves critical manifests", () => {
  assert.match(precheck034, /begin\s*;\s*set\s+transaction\s+read\s+only\s*;/i)
  assert.match(precheck034, /rollback\s*;\s*$/i)
  assert.doesNotMatch(
    precheck034,
    /^\s*(?:insert|update|delete|alter|create|drop|truncate|commit)\b/im,
  )
  assert.match(precheck034, /scsirgbuqjcwoaxfacth/i)
  assert.match(precheck034, /629081c0c25d2cbd43214f92ffd03a9f4ec1f27c84bc33694e05a913a63084dc/i)
  assert.match(precheck034, /company_directors_one_active_per_company_uidx/i)
  assert.match(precheck034, /company_directors_active_uidx/i)
  assert.match(precheck034, /approval_batches_manifest/i)
  assert.match(precheck034, /approval_batch_items_manifest/i)
  assert.match(precheck034, /payment_receipts_manifest/i)
  assert.match(precheck034, /enforcement_settings_manifest/i)
  assert.match(precheck034, /active_ramon_count/i)
  assert.match(precheck034, /active_denise_count/i)
})

test("034 postcheck is read-only and verifies snapshot authorization and manifests", () => {
  assert.match(postcheck034, /begin\s*;\s*set\s+transaction\s+read\s+only\s*;/i)
  assert.match(postcheck034, /rollback\s*;\s*$/i)
  assert.doesNotMatch(
    postcheck034,
    /^\s*(?:insert|update|delete|alter|create|drop|truncate|commit)\b/im,
  )
  assert.match(postcheck034, /one_active_index_removed/i)
  assert.match(postcheck034, /active_pair_index_present/i)
  assert.match(postcheck034, /add_rpc_present/i)
  assert.match(postcheck034, /remove_rpc_present/i)
  assert.match(postcheck034, /replacement_rpc_removed/i)
  assert.match(postcheck034, /approval_batch_require_active_direction/i)
  assert.match(postcheck034, /position\('company_directors' in v_function_source\)\s*>\s*0/i)
  for (const manifest of [
    "approval_batches_manifest",
    "approval_batch_items_manifest",
    "payment_receipts_manifest",
    "enforcement_settings_manifest",
  ]) {
    assert.match(postcheck034, new RegExp(manifest, "i"))
  }
})
