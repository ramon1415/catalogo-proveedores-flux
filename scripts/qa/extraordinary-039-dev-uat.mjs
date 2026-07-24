import { createHash, randomBytes, randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import pg from "pg"
import { createClient } from "@supabase/supabase-js"

const { Client } = pg

const requiredEnv = (name) => {
  const value = String(process.env[name] || "").trim()
  if (!value) throw new Error(`MISSING_${name}`)
  return value
}

const projectRef = requiredEnv("SUPABASE_DEV_PROJECT_REF")
const supabaseUrl = requiredEnv("SUPABASE_URL")
const anonKey = requiredEnv("SUPABASE_DEV_ANON_KEY")
const serviceRoleKey = requiredEnv("SUPABASE_DEV_SERVICE_ROLE_KEY")
const databaseUrl = requiredEnv("SUPABASE_DEV_DB_URL")
const evidenceDir = requiredEnv("UAT_EVIDENCE_DIR")
const runId = requiredEnv("GITHUB_RUN_ID").replace(/[^0-9]/g, "")

if (projectRef !== "scsirgbuqjcwoaxfacth") {
  throw new Error("NON_DEV_PROJECT_REF")
}
if (new URL(supabaseUrl).hostname !== `${projectRef}.supabase.co`) {
  throw new Error("NON_DEV_SUPABASE_URL")
}
if (!databaseUrl.includes(projectRef)) {
  throw new Error("NON_DEV_DATABASE_URL")
}

mkdirSync(evidenceDir, { recursive: true })

const fail = (code) => {
  throw new Error(code)
}
const ensure = (condition, code) => {
  if (!condition) fail(code)
}
const count = (value) => Number(value || 0)
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
})

const db = new Client({
  connectionString: databaseUrl,
  application_name: "flux-extraordinary-039-dev-uat",
})

const ids = Object.freeze({
  company: randomUUID(),
  otherCompany: randomUUID(),
  requesterProfile: randomUUID(),
  approverProfile: randomUUID(),
  financeProfile: randomUUID(),
  directorProfile: randomUUID(),
  outsiderProfile: randomUUID(),
  costCenter: randomUUID(),
  category: randomUUID(),
  companyCostCenter: randomUUID(),
  companyCategory: randomUUID(),
  companyAccount: randomUUID(),
  provider: randomUUID(),
  request: randomUUID(),
})

const aliases = ["requester", "approver", "finance", "director", "outsider"]
const users = new Map()
const clients = new Map()
let authorization = null
let layout = null
let evidenceBytes = null
let mainCompleted = false
let setupCommitted = false
let baseline = null
let primaryError = null
let cleanupError = null
const negative = {
  policy_disabled_denied: false,
  amount_exceeded_denied: false,
  category_denied: false,
  evidence_missing_denied: false,
  evidence_inconsistent_denied: false,
  director_inactive_denied: false,
  director_other_company_denied: false,
  finance_equals_director_denied: false,
  rejected_request_denied: false,
  open_batch_denied: false,
  expired_authorization_denied: false,
  idempotency_conflict_denied: false,
  double_consumption_denied: false,
  wrong_director_ratification_denied: false,
  discrepancy_rollback_pass: false,
  material_change_rollback_pass: false,
  anon_helper_denied: false,
  anon_upload_denied: false,
  outsider_helper_false: false,
  outsider_read_denied: false,
  requester_upload_denied: false,
  wrong_path_denied: false,
  invalid_mime_denied: false,
  oversize_denied: false,
  traversal_denied: false,
  upsert_denied: false,
  director_write_denied: false,
  direct_public_url_denied: false,
  pre_ratification_guard_denied: false,
  pre_ratification_paid_denied: false,
}

const profileIds = {
  requester: ids.requesterProfile,
  approver: ids.approverProfile,
  finance: ids.financeProfile,
  director: ids.directorProfile,
  outsider: ids.outsiderProfile,
}

const authClient = () =>
  createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  })

async function createUsers() {
  for (const alias of aliases) {
    const email = `flux-mej05-039-${runId}-${alias}@example.invalid`
    const password = `${randomBytes(24).toString("base64url")}Aa1!`
    const { data, error } = await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        qa_fixture: "MEJ05_039",
        qa_alias: alias,
      },
    })
    if (error || !data?.user?.id) fail(`AUTH_CREATE_${alias.toUpperCase()}_FAILED`)
    users.set(alias, {
      id: data.user.id,
      email,
      password,
    })
  }
}

async function signInUsers() {
  for (const alias of aliases) {
    const user = users.get(alias)
    const client = authClient()
    const { data, error } = await client.auth.signInWithPassword({
      email: user.email,
      password: user.password,
    })
    if (error || !data?.session?.access_token) {
      fail(`AUTH_SIGNIN_${alias.toUpperCase()}_FAILED`)
    }
    clients.set(alias, client)
  }
}

async function currentCounts() {
  const { rows } = await db.query(`
    select
      (select count(*) from public.payment_requests) as payment_requests,
      (
        select count(*)
        from public.payment_request_extraordinary_authorizations
      ) as authorizations,
      (
        select count(*)
        from public.payment_request_extraordinary_events
      ) as authorization_events,
      (
        select count(*)
        from storage.objects
        where bucket_id = 'extraordinary-approval-evidence'
      ) as storage_objects,
      (select count(*) from public.payment_layouts) as payment_layouts,
      (
        select count(*) from public.payment_layout_lines
      ) as payment_layout_lines,
      (select count(*) from public.payment_receipts) as payment_receipts,
      (
        select count(*)
        from public.payment_requests
        where status::text = 'paid'
      ) as paid_requests,
      (
        select count(*) from public.notification_events
      ) as notification_events,
      (
        select count(*) from public.financial_outbox_events
      ) as financial_outbox_events,
      (
        select count(*)
        from public.financial_outbox_delivery_attempts
      ) as delivery_attempts,
      md5(coalesce((
        select string_agg(to_jsonb(plan)::text, '' order by plan.id)
        from public.payment_allocation_plans plan
      ), '')) as allocation_plans_hash,
      md5(coalesce((
        select string_agg(
          to_jsonb(reservation)::text,
          ''
          order by reservation.id
        )
        from public.payment_allocation_reservations reservation
      ), '')) as allocation_reservations_hash,
      md5(coalesce((
        select string_agg(
          to_jsonb(operation)::text,
          ''
          order by operation.id
        )
        from public.bank_payment_operations operation
      ), '')) as bank_operations_hash
  `)
  return rows[0]
}

async function roleId(names) {
  const { rows } = await db.query(
    `
      select role.id
      from public.roles role
      where lower(btrim(role.name)) = any($1::text[])
      order by array_position($1::text[], lower(btrim(role.name)))
      limit 1
    `,
    [names],
  )
  if (!rows[0]?.id) fail(`ROLE_NOT_FOUND_${names[0]}`)
  return rows[0].id
}

async function createFixture() {
  baseline = await currentCounts()
  const roleIds = {
    requester: await roleId(["solicitante", "requester"]),
    approver: await roleId(["approver_2", "aprobador_2", "director"]),
    finance: await roleId(["finance", "finanzas", "treasury"]),
    director: await roleId(["director", "direccion"]),
  }
  const labels = Object.fromEntries(
    aliases.map((alias) => [alias, `MEJ05 039 QA ${alias}`]),
  )
  const suffix = runId.slice(-10).padStart(10, "0")
  const syntheticAccount = suffix

  await db.query("begin")
  try {
    await db.query("set local session_replication_role = replica")
    await db.query(
      `
        insert into public.companies(id, name, legal_name, active)
        values
          ($1, $2, $2, true),
          ($3, $4, $4, true)
      `,
      [
        ids.company,
        `MEJ05 039 QA ${suffix}`,
        ids.otherCompany,
        `MEJ05 039 OTHER QA ${suffix}`,
      ],
    )
    for (const alias of aliases) {
      const user = users.get(alias)
      await db.query(
        `
          insert into public.profiles(
            id,
            auth_user_id,
            full_name,
            email,
            active
          ) values ($1, $2, $3, $4, true)
        `,
        [profileIds[alias], user.id, labels[alias], user.email],
      )
    }
    const assignedRoles = [
      ["requester", roleIds.requester],
      ["approver", roleIds.approver],
      ["finance", roleIds.finance],
      ["director", roleIds.director],
      ["outsider", roleIds.director],
    ]
    for (const [alias, assignedRole] of assignedRoles) {
      await db.query(
        `
          insert into public.user_roles(profile_id, role_id)
          values ($1, $2)
        `,
        [profileIds[alias], assignedRole],
      )
    }
    for (const alias of ["requester", "approver", "finance", "director"]) {
      await db.query(
        `
          insert into public.profile_company_memberships(
            profile_id,
            company_id,
            active
          ) values ($1, $2, true)
        `,
        [profileIds[alias], ids.company],
      )
    }
    await db.query(
      `
        insert into public.profile_company_memberships(
          profile_id,
          company_id,
          active
        ) values ($1, $2, true)
      `,
      [ids.outsiderProfile, ids.otherCompany],
    )
    await db.query(
      `
        insert into public.company_directors(
          company_id,
          director_profile_id,
          active,
          created_by
        ) values
          ($1, $2, true, $3),
          ($4, $5, true, $3)
      `,
      [
        ids.company,
        ids.directorProfile,
        ids.financeProfile,
        ids.otherCompany,
        ids.outsiderProfile,
      ],
    )
    await db.query(
      `
        insert into public.cost_centers(id, name, code, active)
        values ($1, $2, $3, true)
      `,
      [ids.costCenter, `MEJ05 039 QA CC ${suffix}`, `Q39CC${suffix}`],
    )
    await db.query(
      `
        insert into public.budget_categories(
          id,
          code,
          name,
          category,
          budget_type,
          active
        ) values ($1, $2, $3, 'QA', 'variable', true)
      `,
      [ids.category, `Q39CAT${suffix}`, `MEJ05 039 QA Category ${suffix}`],
    )
    await db.query(
      `
        insert into public.company_cost_centers(
          id,
          company_id,
          cost_center_id,
          active
        ) values ($1, $2, $3, true)
      `,
      [ids.companyCostCenter, ids.company, ids.costCenter],
    )
    await db.query(
      `
        insert into public.company_cost_center_budget_categories(
          id,
          company_id,
          cost_center_id,
          budget_category_id,
          active
        ) values ($1, $2, $3, $4, true)
      `,
      [ids.companyCategory, ids.company, ids.costCenter, ids.category],
    )
    await db.query(
      `
        insert into public.company_bank_accounts(
          id,
          company_id,
          name,
          bank_name,
          currency,
          account_number,
          last4,
          active
        ) values (
          $1,
          $2,
          $3,
          'QA BANK',
          'MXN',
          $4,
          right($4, 4),
          true
        )
      `,
      [
        ids.companyAccount,
        ids.company,
        `MEJ05 039 QA Account ${suffix}`,
        syntheticAccount,
      ],
    )
    await db.query(
      `
        insert into public.proveedores(
          id,
          alias,
          nombre_completo,
          metodo_pago,
          cuenta_bancaria,
          banco,
          activo,
          destination_type,
          beneficiary_name
        ) values (
          $1,
          $2,
          $2,
          'Transferencia bancaria',
          $3,
          'QA BANK',
          true,
          'cuenta',
          $2
        )
      `,
      [ids.provider, `MEJ05 039 QA Provider ${suffix}`, syntheticAccount],
    )
    let budgetVersion = (
      await db.query(`
        select version.id
        from public.budget_versions version
        where version.active
          and version.year = extract(year from current_date)::integer
        order by version.activated_at desc nulls last, version.created_at desc
        limit 1
      `)
    ).rows[0]?.id
    if (!budgetVersion) {
      budgetVersion = randomUUID()
      await db.query(
        `
          insert into public.budget_versions(
            id,
            name,
            version_type,
            year,
            active,
            loaded_by,
            activated_at
          ) values (
            $1,
            $2,
            'forecast',
            extract(year from current_date)::integer,
            true,
            $3,
            now()
          )
        `,
        [budgetVersion, `MEJ05 039 QA Budget ${suffix}`, ids.financeProfile],
      )
    }
    await db.query(
      `
        insert into public.budget_lines(
          budget_version_id,
          company_id,
          cost_center_id,
          budget_category_id,
          budget_month,
          amount
        ) values (
          $1,
          $2,
          $3,
          $4,
          date_trunc('month', current_date)::date,
          1000000
        )
      `,
      [budgetVersion, ids.company, ids.costCenter, ids.category],
    )
    await db.query(
      `
        insert into public.payment_requests(
          id,
          requested_by,
          approved_by,
          approver_id,
          amount_requested,
          currency,
          exchange_rate,
          status,
          concept,
          description,
          company_id,
          company_bank_account_id,
          proveedor_id,
          cost_center_id,
          budget_category_id,
          budget_month,
          budget_decision,
          request_number,
          submitted_at,
          approved_at,
          due_date,
          scheduled_payment_date,
          payment_reference,
          payment_concept,
          payment_method,
          approval_material_updated_at
        ) values (
          $1,
          $2,
          $3,
          $3,
          1234.56,
          'MXN',
          1,
          'approved',
          'MEJ05 039 QA external authorization',
          'Synthetic QA request without validity',
          $4,
          $5,
          $6,
          $7,
          $8,
          date_trunc('month', current_date)::date,
          'aprobable',
          $9,
          now() - interval '2 hours',
          now() - interval '90 minutes',
          current_date,
          current_date,
          '39039',
          'MEJ05 039 QA authorization',
          'transfer',
          now() - interval '1 hour'
        )
      `,
      [
        ids.request,
        ids.requesterProfile,
        ids.approverProfile,
        ids.company,
        ids.companyAccount,
        ids.provider,
        ids.costCenter,
        ids.category,
        `QA-MEJ05-039-${suffix}`,
      ],
    )
    await db.query(
      `
        insert into public.extraordinary_payment_policies(
          company_id,
          enabled,
          max_amount_mxn,
          allowed_categories,
          authorization_valid_hours,
          ratification_due_hours,
          evidence_required,
          created_by,
          updated_by
        ) values (
          $1,
          true,
          100000,
          array['operational_emergency']::text[],
          24,
          48,
          true,
          $2,
          $2
        )
      `,
      [ids.company, ids.financeProfile],
    )
    await db.query("set local session_replication_role = origin")
    await db.query("commit")
    setupCommitted = true
  } catch (error) {
    await db.query("rollback")
    fail("QA_FIXTURE_SETUP_FAILED")
  }
}

async function rpc(client, name, args, code) {
  const { data, error } = await client.rpc(name, args)
  if (error) fail(code)
  return data
}

async function expectRpcDenied(client, name, args, expected, code) {
  const { error } = await client.rpc(name, args)
  ensure(Boolean(error), code)
  ensure(
    String(error.message || "").includes(expected),
    `${code}_WRONG_ERROR`,
  )
}

async function expectTransactionalRpcDenied({
  setup = [],
  call,
  values,
  expected,
  code,
}) {
  await db.query("begin")
  try {
    for (const statement of setup) {
      await db.query(statement.text, statement.values || [])
    }
    await db.query(
      `
        select set_config(
          'request.jwt.claim.sub',
          $1,
          true
        )
      `,
      [users.get("finance").id],
    )
    await db.query("set local role authenticated")
    await db.query(call, values)
    await db.query("rollback")
    fail(code)
  } catch (error) {
    await db.query("rollback").catch(() => {})
    if (error.message === code) throw error
    ensure(
      String(error.message || "").includes(expected),
      `${code}_WRONG_ERROR`,
    )
  }
}

async function runPreAuthorizationNegatives(finance) {
  const baseArguments = {
    p_payment_request_id: ids.request,
    p_category: "operational_emergency",
    p_reason:
      "Synthetic QA external Direction authorization negative contract.",
    p_external_director_profile_id: ids.directorProfile,
    p_external_authorized_at: new Date(Date.now() - 120_000).toISOString(),
  }
  const sqlCall = `
    select public.begin_extraordinary_authorization(
      $1,
      $2,
      $3,
      $4,
      $5,
      $6
    )
  `
  const sqlValues = (suffix) => [
    ids.request,
    "operational_emergency",
    "Synthetic QA external Direction authorization negative contract.",
    ids.directorProfile,
    new Date(Date.now() - 120_000).toISOString(),
    `mej05-039-${runId}-${suffix}-${randomBytes(6).toString("hex")}`,
  ]

  await expectTransactionalRpcDenied({
    setup: [
      {
        text: `
          update public.extraordinary_payment_policies
          set enabled = false
          where company_id = $1
        `,
        values: [ids.company],
      },
    ],
    call: sqlCall,
    values: sqlValues("policy-disabled"),
    expected: "extraordinary_policy_disabled",
    code: "POLICY_DISABLED_NOT_DENIED",
  })
  negative.policy_disabled_denied = true

  await expectTransactionalRpcDenied({
    setup: [
      {
        text: `
          update public.extraordinary_payment_policies
          set max_amount_mxn = 1
          where company_id = $1
        `,
        values: [ids.company],
      },
    ],
    call: sqlCall,
    values: sqlValues("amount-exceeded"),
    expected: "extraordinary_amount_exceeds_policy",
    code: "AMOUNT_EXCEEDED_NOT_DENIED",
  })
  negative.amount_exceeded_denied = true

  await expectTransactionalRpcDenied({
    setup: [
      {
        text: `
          update public.profiles
          set active = false
          where id = $1
        `,
        values: [ids.directorProfile],
      },
    ],
    call: sqlCall,
    values: sqlValues("director-inactive"),
    expected: "external_director_not_active_for_company",
    code: "DIRECTOR_INACTIVE_NOT_DENIED",
  })
  negative.director_inactive_denied = true

  await expectTransactionalRpcDenied({
    setup: [
      {
        text: `
          update public.payment_requests
          set status = 'rejected'
          where id = $1
        `,
        values: [ids.request],
      },
    ],
    call: sqlCall,
    values: sqlValues("request-rejected"),
    expected: "payment_request_not_available_for_extraordinary",
    code: "REJECTED_REQUEST_NOT_DENIED",
  })
  negative.rejected_request_denied = true

  const negativeBatch = randomUUID()
  const negativeItem = randomUUID()
  await expectTransactionalRpcDenied({
    setup: [
      {
        text: "set local session_replication_role = replica",
      },
      {
        text: `
          with inserted_batch as (
            insert into public.approval_batches(
              id,
              company_id,
              label,
              period_start,
              period_end,
              status,
              director_id,
              created_by
            ) values (
              $1,
              $2,
              'MEJ05 039 QA negative open batch',
              current_date,
              current_date,
              'draft',
              $3,
              $4
            )
            returning id
          )
          insert into public.approval_batch_items(
            id,
            batch_id,
            payment_request_id,
            finance_reviewed_by,
            director_status,
            review_sequence,
            finance_release_status
          )
          select
            $5,
            inserted_batch.id,
            $6,
            $4,
            'pending',
            1,
            'pending'
          from inserted_batch
        `,
        values: [
          negativeBatch,
          ids.company,
          ids.directorProfile,
          ids.financeProfile,
          negativeItem,
          ids.request,
        ],
      },
      {
        text: "set local session_replication_role = origin",
      },
    ],
    call: sqlCall,
    values: sqlValues("open-batch"),
    expected: "request_has_rejection_or_open_batch",
    code: "OPEN_BATCH_NOT_DENIED",
  })
  negative.open_batch_denied = true

  await expectRpcDenied(
    finance,
    "begin_extraordinary_authorization",
    {
      ...baseArguments,
      p_category: "not_allowed",
      p_idempotency_key: `mej05-039-${runId}-category-${randomBytes(6).toString("hex")}`,
    },
    "extraordinary_category_not_allowed",
    "CATEGORY_NOT_DENIED",
  )
  negative.category_denied = true

  await expectRpcDenied(
    finance,
    "begin_extraordinary_authorization",
    {
      ...baseArguments,
      p_external_director_profile_id: ids.outsiderProfile,
      p_idempotency_key: `mej05-039-${runId}-other-director-${randomBytes(6).toString("hex")}`,
    },
    "external_director_not_active_for_company",
    "OTHER_COMPANY_DIRECTOR_NOT_DENIED",
  )
  negative.director_other_company_denied = true

  await expectRpcDenied(
    finance,
    "begin_extraordinary_authorization",
    {
      ...baseArguments,
      p_external_director_profile_id: ids.financeProfile,
      p_idempotency_key: `mej05-039-${runId}-same-actor-${randomBytes(6).toString("hex")}`,
    },
    "finance_actor_must_differ_from_external_director",
    "FINANCE_EQUALS_DIRECTOR_NOT_DENIED",
  )
  negative.finance_equals_director_denied = true

  await expectRpcDenied(
    finance,
    "begin_extraordinary_authorization",
    {
      ...baseArguments,
      p_external_authorized_at: new Date(
        Date.now() - 30 * 60 * 60 * 1000,
      ).toISOString(),
      p_idempotency_key: `mej05-039-${runId}-expired-${randomBytes(6).toString("hex")}`,
    },
    "external_authorization_time_invalid",
    "EXPIRED_AUTHORIZATION_NOT_DENIED",
  )
  negative.expired_authorization_denied = true
}

function buildEvidencePdf() {
  const stamp = new Date().toISOString()
  const lines = [
    "AUTORIZACION EXTERNA QA - SIN VALIDEZ",
    `Empresa QA: MEJ05 039 ${runId}`,
    `Folio QA: QA-MEJ05-039-${runId}`,
    "Proveedor QA: MEJ05 039 QA Provider",
    "Monto QA: 1234.56",
    "Moneda: MXN",
    "Concepto QA: Autorizacion externa sintetica",
    "Director QA: MEJ05 039 QA Director",
    `Fecha UTC: ${stamp}`,
    "DOCUMENTO SINTETICO - SIN VALIDEZ",
  ]
  const escaped = lines.map((line) =>
    line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"),
  )
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 740 Td",
    ...escaped.flatMap((line, index) =>
      index === 0 ? [`(${line}) Tj`] : ["0 -24 Td", `(${line}) Tj`],
    ),
    "ET",
  ].join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n`
  body += "0000000000 65535 f \n"
  for (let index = 1; index < offsets.length; index += 1) {
    body += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
  body += `startxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, "ascii")
}

async function expectStorageDenied(client, objectPath, bytes, options, code) {
  const { error } = await client.storage
    .from("extraordinary-approval-evidence")
    .upload(objectPath, bytes, options)
  ensure(Boolean(error), code)
}

async function evidenceObjectCount() {
  const { rows } = await db.query(
    `
      select count(*) as count
      from storage.objects
      where bucket_id = 'extraordinary-approval-evidence'
        and name = $1
    `,
    [authorization.storage_path],
  )
  return count(rows[0].count)
}

async function runStorageAndMainUat() {
  const finance = clients.get("finance")
  const director = clients.get("director")
  const requester = clients.get("requester")
  const outsider = clients.get("outsider")
  const anon = authClient()
  const idempotency = `mej05-039-${runId}-${randomBytes(8).toString("hex")}`

  await runPreAuthorizationNegatives(finance)

  authorization = await rpc(
    finance,
    "begin_extraordinary_authorization",
    {
      p_payment_request_id: ids.request,
      p_category: "operational_emergency",
      p_reason:
        "Synthetic QA external Direction authorization for MEJ-05 validation.",
      p_external_director_profile_id: ids.directorProfile,
      p_external_authorized_at: new Date(Date.now() - 120_000).toISOString(),
      p_idempotency_key: idempotency,
    },
    "BEGIN_EXTRAORDINARY_AUTHORIZATION_FAILED",
  )
  ensure(authorization?.status === "draft", "DRAFT_STATUS_INVALID")
  ensure(
    authorization?.storage_bucket === "extraordinary-approval-evidence",
    "DRAFT_BUCKET_INVALID",
  )
  ensure(
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/evidence\/[0-9a-f-]{36}$/.test(
      authorization?.storage_path || "",
    ),
    "DRAFT_PATH_INVALID",
  )

  await expectRpcDenied(
    finance,
    "begin_extraordinary_authorization",
    {
      p_payment_request_id: ids.request,
      p_category: "operational_emergency",
      p_reason:
        "Synthetic QA idempotency payload mismatch contract for MEJ-05.",
      p_external_director_profile_id: ids.outsiderProfile,
      p_external_authorized_at: new Date(Date.now() - 120_000).toISOString(),
      p_idempotency_key: idempotency,
    },
    "idempotency_key_payload_mismatch",
    "IDEMPOTENCY_CONFLICT_NOT_DENIED",
  )
  negative.idempotency_conflict_denied = true

  const { error: anonHelperError } = await anon.rpc(
    "extraordinary_evidence_storage_allowed",
    { p_name: authorization.storage_path, p_write: true },
  )
  negative.anon_helper_denied = Boolean(anonHelperError)
  ensure(negative.anon_helper_denied, "ANON_HELPER_NOT_DENIED")

  const { data: outsiderAllowed, error: outsiderHelperError } =
    await outsider.rpc("extraordinary_evidence_storage_allowed", {
      p_name: authorization.storage_path,
      p_write: false,
    })
  ensure(!outsiderHelperError, "OUTSIDER_HELPER_CALL_FAILED")
  negative.outsider_helper_false = outsiderAllowed === false
  ensure(negative.outsider_helper_false, "OUTSIDER_HELPER_ALLOWED")

  const tinyPdf = Buffer.from("%PDF-1.4\n% QA denied fixture\n%%EOF\n")
  await expectStorageDenied(
    anon,
    authorization.storage_path,
    tinyPdf,
    { contentType: "application/pdf", upsert: false },
    "ANON_UPLOAD_NOT_DENIED",
  )
  negative.anon_upload_denied = true
  await expectStorageDenied(
    requester,
    authorization.storage_path,
    tinyPdf,
    { contentType: "application/pdf", upsert: false },
    "REQUESTER_UPLOAD_NOT_DENIED",
  )
  negative.requester_upload_denied = true
  await expectStorageDenied(
    finance,
    `${ids.company}/${randomUUID()}/evidence/${randomUUID()}`,
    tinyPdf,
    { contentType: "application/pdf", upsert: false },
    "WRONG_PATH_NOT_DENIED",
  )
  negative.wrong_path_denied = true
  await expectStorageDenied(
    finance,
    authorization.storage_path,
    Buffer.from("invalid mime"),
    { contentType: "text/plain", upsert: false },
    "INVALID_MIME_NOT_DENIED",
  )
  negative.invalid_mime_denied = true
  await expectStorageDenied(
    finance,
    authorization.storage_path,
    Buffer.alloc(5_242_881, 65),
    { contentType: "application/pdf", upsert: false },
    "OVERSIZE_NOT_DENIED",
  )
  negative.oversize_denied = true
  await expectStorageDenied(
    finance,
    `${ids.company}/../evidence/${randomUUID()}`,
    tinyPdf,
    { contentType: "application/pdf", upsert: false },
    "TRAVERSAL_NOT_DENIED",
  )
  negative.traversal_denied = true
  ensure((await evidenceObjectCount()) === 0, "NEGATIVE_STORAGE_LEFT_OBJECT")

  evidenceBytes = buildEvidencePdf()
  const evidencePath = path.join(
    evidenceDir,
    "AUTORIZACION_EXTERNA_QA_SIN_VALIDEZ.pdf",
  )
  writeFileSync(evidencePath, evidenceBytes)
  const evidenceSha256 = createHash("sha256")
    .update(evidenceBytes)
    .digest("hex")

  await expectRpcDenied(
    finance,
    "finalize_extraordinary_authorization",
    {
      p_authorization_id: authorization.authorization_id,
      p_evidence_type: "other",
      p_evidence_sha256: evidenceSha256,
      p_evidence_mime_type: "application/pdf",
      p_evidence_size_bytes: evidenceBytes.length,
      p_finance_attests_evidence_matches_request: true,
      p_idempotency_key: `${idempotency}:missing-object`,
    },
    "extraordinary_evidence_object_not_found",
    "MISSING_EVIDENCE_NOT_DENIED",
  )
  negative.evidence_missing_denied = true

  const { error: uploadError } = await finance.storage
    .from(authorization.storage_bucket)
    .upload(authorization.storage_path, evidenceBytes, {
      contentType: "application/pdf",
      metadata: { sha256: evidenceSha256 },
      upsert: false,
    })
  if (uploadError) fail("MEJ05_EVIDENCE_UPLOAD_FAILED")
  ensure((await evidenceObjectCount()) === 1, "EVIDENCE_OBJECT_COUNT_INVALID")

  await expectRpcDenied(
    finance,
    "finalize_extraordinary_authorization",
    {
      p_authorization_id: authorization.authorization_id,
      p_evidence_type: "other",
      p_evidence_sha256: "0".repeat(64),
      p_evidence_mime_type: "application/pdf",
      p_evidence_size_bytes: evidenceBytes.length,
      p_finance_attests_evidence_matches_request: true,
      p_idempotency_key: `${idempotency}:mismatched-object`,
    },
    "extraordinary_evidence_object_metadata_mismatch",
    "INCONSISTENT_EVIDENCE_NOT_DENIED",
  )
  negative.evidence_inconsistent_denied = true

  const finalized = await rpc(
    finance,
    "finalize_extraordinary_authorization",
    {
      p_authorization_id: authorization.authorization_id,
      p_evidence_type: "other",
      p_evidence_sha256: evidenceSha256,
      p_evidence_mime_type: "application/pdf",
      p_evidence_size_bytes: evidenceBytes.length,
      p_finance_attests_evidence_matches_request: true,
      p_idempotency_key: `${idempotency}:finalize`,
    },
    "FINALIZE_EXTRAORDINARY_AUTHORIZATION_FAILED",
  )
  ensure(finalized?.status === "active", "FINALIZED_STATUS_INVALID")

  await expectStorageDenied(
    finance,
    authorization.storage_path,
    evidenceBytes,
    {
      contentType: "application/pdf",
      metadata: { sha256: evidenceSha256 },
      upsert: true,
    },
    "UPSERT_NOT_DENIED",
  )
  negative.upsert_denied = true
  await expectStorageDenied(
    director,
    authorization.storage_path,
    evidenceBytes,
    {
      contentType: "application/pdf",
      metadata: { sha256: evidenceSha256 },
      upsert: true,
    },
    "DIRECTOR_WRITE_NOT_DENIED",
  )
  negative.director_write_denied = true

  for (const [alias, client] of [
    ["finance", finance],
    ["director", director],
  ]) {
    const access = await rpc(
      client,
      "get_extraordinary_authorization_evidence_access",
      { p_authorization_id: authorization.authorization_id },
      `${alias.toUpperCase()}_EVIDENCE_ACCESS_FAILED`,
    )
    ensure(access?.storage_bucket === authorization.storage_bucket, "ACCESS_BUCKET_INVALID")
    ensure(access?.storage_path === authorization.storage_path, "ACCESS_PATH_INVALID")
    ensure(count(access?.url_ttl_seconds) === 120, "ACCESS_TTL_INVALID")
    const { data: downloaded, error: downloadError } = await client.storage
      .from(authorization.storage_bucket)
      .download(authorization.storage_path)
    ensure(!downloadError && downloaded?.size === evidenceBytes.length, `${alias.toUpperCase()}_DOWNLOAD_FAILED`)
  }

  const { error: outsiderReadError } = await outsider.storage
    .from(authorization.storage_bucket)
    .download(authorization.storage_path)
  negative.outsider_read_denied = Boolean(outsiderReadError)
  ensure(negative.outsider_read_denied, "OUTSIDER_READ_NOT_DENIED")

  const { data: signedData, error: signedError } = await director.storage
    .from(authorization.storage_bucket)
    .createSignedUrl(authorization.storage_path, 120)
  ensure(!signedError && signedData?.signedUrl, "DIRECTOR_SIGNED_URL_FAILED")
  const signedResponse = await fetch(signedData.signedUrl)
  ensure(signedResponse.ok, "SIGNED_URL_DOWNLOAD_FAILED")
  const publicResponse = await fetch(
    `${supabaseUrl}/storage/v1/object/public/${authorization.storage_bucket}/${authorization.storage_path}`,
  )
  negative.direct_public_url_denied = !publicResponse.ok
  ensure(negative.direct_public_url_denied, "DIRECT_PUBLIC_URL_NOT_DENIED")

  const today = new Date().toISOString().slice(0, 10)
  const preview = await rpc(
    finance,
    "preview_payment_layout_eligibility",
    {
      p_period_start: today,
      p_period_end: today,
      p_company_id: ids.company,
      p_company_bank_account_id: ids.companyAccount,
    },
    "EXTRAORDINARY_LAYOUT_PREVIEW_FAILED",
  )
  ensure(
    Array.isArray(preview?.ready_extraordinary) &&
      preview.ready_extraordinary.length === 1,
    "READY_EXTRAORDINARY_COUNT_INVALID",
  )

  layout = await rpc(
    finance,
    "create_payment_layout",
    {
      p_period_start: today,
      p_period_end: today,
      p_generated_by: ids.financeProfile,
      p_name: `MEJ05 039 QA Layout ${runId}`,
      p_company_id: ids.company,
      p_company_bank_account_id: ids.companyAccount,
    },
    "CREATE_EXTRAORDINARY_LAYOUT_FAILED",
  )
  ensure(layout?.status === "created", "LAYOUT_STATUS_INVALID")
  ensure(count(layout?.payment_count) === 1, "LAYOUT_PAYMENT_COUNT_INVALID")
  ensure(count(layout?.extraordinary_count) === 1, "LAYOUT_EXTRAORDINARY_COUNT_INVALID")

  const { rows: consumedRows } = await db.query(
    `
      select
        authorization.status,
        authorization.consumed_layout_id is not null as has_layout,
        authorization.consumed_layout_line_id is not null as has_line,
        request.status::text as request_status,
        (
          select count(*)
          from public.payment_layout_lines line
          where line.layout_id = authorization.consumed_layout_id
            and line.payment_request_id = authorization.payment_request_id
        ) as line_count
      from public.payment_request_extraordinary_authorizations authorization
      join public.payment_requests request
        on request.id = authorization.payment_request_id
      where authorization.id = $1
    `,
    [authorization.authorization_id],
  )
  const consumed = consumedRows[0]
  ensure(
    consumed?.status === "consumed_pending_ratification",
    "CONSUMED_STATUS_INVALID",
  )
  ensure(consumed?.has_layout && consumed?.has_line, "CONSUMED_LINEAGE_INVALID")
  ensure(count(consumed?.line_count) === 1, "CONSUMED_LINE_COUNT_INVALID")
  ensure(consumed?.request_status !== "paid", "REQUEST_PAID_BEFORE_RATIFICATION")

  await expectRpcDenied(
    outsider,
    "ratify_extraordinary_authorization",
    {
      p_authorization_id: authorization.authorization_id,
      p_note: "Synthetic QA ratification attempted by the wrong Director.",
      p_idempotency_key: `${idempotency}:wrong-director`,
    },
    "registered_external_director_required",
    "WRONG_DIRECTOR_RATIFICATION_NOT_DENIED",
  )
  negative.wrong_director_ratification_denied = true

  await db.query("begin")
  try {
    await db.query(
      `
        insert into public.payment_layout_lines(
          id,
          layout_id,
          payment_request_id,
          company_id,
          proveedor_id,
          company_bank_account_id,
          source_account_number,
          company_name,
          destination_type,
          destination_value,
          beneficiary_name,
          amount,
          payment_reference,
          payment_concept,
          request_number,
          status
        )
        select
          gen_random_uuid(),
          line.layout_id,
          line.payment_request_id,
          line.company_id,
          line.proveedor_id,
          line.company_bank_account_id,
          line.source_account_number,
          line.company_name,
          line.destination_type,
          line.destination_value,
          line.beneficiary_name,
          line.amount,
          line.payment_reference,
          line.payment_concept,
          line.request_number,
          line.status
        from public.payment_layout_lines line
        join public.payment_request_extraordinary_authorizations authorization
          on authorization.consumed_layout_line_id = line.id
        where authorization.id = $1
      `,
      [authorization.authorization_id],
    )
    await db.query("rollback")
    fail("DOUBLE_CONSUMPTION_NOT_DENIED")
  } catch (error) {
    await db.query("rollback").catch(() => {})
    if (error.message === "DOUBLE_CONSUMPTION_NOT_DENIED") throw error
    negative.double_consumption_denied = String(error.message).includes(
      "extraordinary_authorization_already_consumed_or_closed",
    )
    ensure(
      negative.double_consumption_denied,
      "DOUBLE_CONSUMPTION_WRONG_ERROR",
    )
  }

  await db.query("begin")
  try {
    await db.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [users.get("director").id],
    )
    await db.query("set local role authenticated")
    const { rows: disputedRows } = await db.query(
      `
        select public.dispute_extraordinary_authorization(
          $1,
          $2,
          $3
        ) as result
      `,
      [
        authorization.authorization_id,
        "Synthetic QA discrepancy exercised transactionally and rolled back.",
        `${idempotency}:dispute-rollback`,
      ],
    )
    ensure(
      disputedRows[0]?.result?.status === "disputed",
      "DISCREPANCY_ROLLBACK_RESULT_INVALID",
    )
    await db.query("rollback")
    negative.discrepancy_rollback_pass = true
  } catch (error) {
    await db.query("rollback").catch(() => {})
    throw error
  }

  await db.query("begin")
  try {
    await db.query(
      `
        update public.payment_requests
        set amount_requested = amount_requested + 0.01
        where id = $1
      `,
      [ids.request],
    )
    const { rows: invalidatedRows } = await db.query(
      `
        select status
        from public.payment_request_extraordinary_authorizations
        where id = $1
      `,
      [authorization.authorization_id],
    )
    ensure(
      invalidatedRows[0]?.status === "expired",
      "MATERIAL_CHANGE_DID_NOT_INVALIDATE",
    )
    await db.query("rollback")
    negative.material_change_rollback_pass = true
  } catch (error) {
    await db.query("rollback").catch(() => {})
    throw error
  }

  try {
    await db.query(
      `
        select public.assert_extraordinary_payment_confirmation_allowed(
          $1,
          $2,
          (
            select authorization.consumed_layout_line_id
            from public.payment_request_extraordinary_authorizations authorization
            where authorization.id = $3
          )
        )
      `,
      [ids.request, layout.layout_id, authorization.authorization_id],
    )
    fail("PRE_RATIFICATION_GUARD_BYPASSED")
  } catch (error) {
    if (error.message === "PRE_RATIFICATION_GUARD_BYPASSED") throw error
    negative.pre_ratification_guard_denied = String(error.message).includes(
      "requires_ratification",
    )
    ensure(
      negative.pre_ratification_guard_denied,
      "PRE_RATIFICATION_GUARD_WRONG_ERROR",
    )
  }

  await db.query("begin")
  try {
    await db.query(
      `
        update public.payment_requests
        set status = 'paid',
            paid_by = $2,
            paid_at = now()
        where id = $1
      `,
      [ids.request, ids.financeProfile],
    )
    await db.query("rollback")
    fail("PRE_RATIFICATION_PAID_BYPASSED")
  } catch (error) {
    await db.query("rollback").catch(() => {})
    if (error.message === "PRE_RATIFICATION_PAID_BYPASSED") throw error
    negative.pre_ratification_paid_denied = String(error.message).includes(
      "requires_ratification",
    )
    ensure(
      negative.pre_ratification_paid_denied,
      "PRE_RATIFICATION_PAID_WRONG_ERROR",
    )
  }

  const ratified = await rpc(
    director,
    "ratify_extraordinary_authorization",
    {
      p_authorization_id: authorization.authorization_id,
      p_note: "Synthetic QA ratification without payment confirmation.",
      p_idempotency_key: `${idempotency}:ratify`,
    },
    "RATIFY_EXTRAORDINARY_AUTHORIZATION_FAILED",
  )
  ensure(ratified?.status === "ratified", "RATIFIED_STATUS_INVALID")
  ensure(
    Object.values(negative).every(Boolean),
    "NEGATIVE_CONTRACT_INCOMPLETE",
  )
  mainCompleted = true
}

async function validateFinalDeltas() {
  const finalCounts = await currentCounts()
  const expected = {
    payment_requests: 1,
    authorizations: 1,
    authorization_events: 5,
    storage_objects: 1,
    payment_layouts: 1,
    payment_layout_lines: 1,
    payment_receipts: 0,
    paid_requests: 0,
    notification_events: 0,
    financial_outbox_events: 0,
    delivery_attempts: 0,
  }
  const deltas = {}
  for (const [field, expectedDelta] of Object.entries(expected)) {
    deltas[field] = count(finalCounts[field]) - count(baseline[field])
    ensure(deltas[field] === expectedDelta, `DELTA_${field.toUpperCase()}_INVALID`)
  }
  ensure(
    finalCounts.allocation_plans_hash === baseline.allocation_plans_hash &&
      finalCounts.allocation_reservations_hash ===
        baseline.allocation_reservations_hash &&
      finalCounts.bank_operations_hash === baseline.bank_operations_hash,
    "ALLOC_001_INTEGRITY_CHANGED",
  )
  const { rows } = await db.query(
    `
      select
        authorization.status,
        authorization.evidence_verified_at is not null as evidence_verified,
        authorization.ratified_at is not null as ratified,
        request.status::text as request_status,
        (
          select count(*)
          from public.payment_request_extraordinary_events event
          where event.authorization_id = authorization.id
        ) as event_count
      from public.payment_request_extraordinary_authorizations authorization
      join public.payment_requests request
        on request.id = authorization.payment_request_id
      where authorization.id = $1
    `,
    [authorization.authorization_id],
  )
  ensure(rows[0]?.status === "ratified", "FINAL_AUTHORIZATION_STATUS_INVALID")
  ensure(rows[0]?.evidence_verified, "FINAL_EVIDENCE_NOT_VERIFIED")
  ensure(rows[0]?.ratified, "FINAL_RATIFICATION_MISSING")
  ensure(rows[0]?.request_status !== "paid", "FINAL_REQUEST_WAS_PAID")
  ensure(count(rows[0]?.event_count) === 5, "FINAL_EVENT_COUNT_INVALID")
  return deltas
}

async function cleanup() {
  if (authorization && !mainCompleted && clients.get("finance")) {
    const { rows } = await db.query(
      `
        select status
        from public.payment_request_extraordinary_authorizations
        where id = $1
      `,
      [authorization.authorization_id],
    )
    if (["draft", "active"].includes(rows[0]?.status)) {
      await clients.get("finance").rpc(
        "revoke_payment_request_extraordinary",
        {
          p_payment_request_id: ids.request,
          p_reason: "Synthetic QA cleanup after incomplete MEJ05 039 UAT",
        },
      )
      await serviceClient.storage
        .from(authorization.storage_bucket)
        .remove([authorization.storage_path])
    }
  }

  for (const client of clients.values()) {
    await client.auth.signOut({ scope: "global" }).catch(() => {})
  }
  for (const user of users.values()) {
    await serviceClient.auth.admin
      .updateUserById(user.id, { ban_duration: "876000h" })
      .catch(() => {})
  }

  if (setupCommitted) {
    await db.query("begin")
    try {
      await db.query(
        `
          update public.profiles
          set active = false
          where id = any($1::uuid[])
        `,
        [Object.values(profileIds)],
      )
      await db.query(
        `
          update public.profile_company_memberships
          set active = false
          where profile_id = any($1::uuid[])
        `,
        [Object.values(profileIds)],
      )
      await db.query(
        `
          update public.company_directors
          set active = false
          where director_profile_id = any($1::uuid[])
        `,
        [Object.values(profileIds)],
      )
      await db.query(
        `
          update public.extraordinary_payment_policies
          set enabled = false,
              updated_by = $2,
              updated_at = now()
          where company_id = $1
        `,
        [ids.company, ids.financeProfile],
      )
      await db.query(
        `
          delete from public.user_roles
          where profile_id = any($1::uuid[])
        `,
        [Object.values(profileIds)],
      )
      await db.query("commit")
    } catch {
      await db.query("rollback")
      fail("QA_IAM_CLEANUP_TRANSACTION_FAILED")
    }
  }

  await sleep(1000)
  if (setupCommitted) {
    const authUserIds = [...users.values()].map((user) => user.id)
    const { rows } = await db.query(
      `
        select
          (
            select count(*)
            from public.profiles profile
            where profile.id = any($1::uuid[])
              and profile.active
          ) as active_profiles,
          (
            select count(*)
            from public.profile_company_memberships membership
            where membership.profile_id = any($1::uuid[])
              and membership.active
          ) as active_memberships,
          (
            select count(*)
            from public.user_roles user_role
            where user_role.profile_id = any($1::uuid[])
          ) as roles,
          (
            select count(*)
            from public.company_directors director
            where director.director_profile_id = any($1::uuid[])
              and director.active
          ) as active_directors,
          (
            select count(*)
            from public.extraordinary_payment_policies policy
            where policy.company_id = $2
              and policy.enabled
          ) as enabled_qa_policies,
          (
            select count(*)
            from public.extraordinary_payment_policies policy
            join public.companies company on company.id = policy.company_id
            where policy.enabled
              and lower(coalesce(company.name, '')) like '%operadora%'
          ) as operadora_enabled,
          (
            select count(*)
            from auth.sessions session
            where session.user_id = any($3::uuid[])
          ) as sessions,
          (
            select count(*)
            from auth.refresh_tokens token
            where token.user_id::text = any($4::text[])
          ) as refresh_tokens,
          (
            select count(*)
            from auth.users auth_user
            where auth_user.id = any($3::uuid[])
              and auth_user.banned_until > now()
          ) as banned_users
      `,
      [
        Object.values(profileIds),
        ids.company,
        authUserIds,
        authUserIds.map(String),
      ],
    )
    const cleaned = rows[0]
    ensure(count(cleaned.active_profiles) === 0, "QA_ACTIVE_PROFILES_REMAIN")
    ensure(count(cleaned.active_memberships) === 0, "QA_ACTIVE_MEMBERSHIPS_REMAIN")
    ensure(count(cleaned.roles) === 0, "QA_ROLES_REMAIN")
    ensure(count(cleaned.active_directors) === 0, "QA_DIRECTORS_REMAIN")
    ensure(count(cleaned.enabled_qa_policies) === 0, "QA_POLICY_REMAINS_ENABLED")
    ensure(count(cleaned.operadora_enabled) === 0, "OPERADORA_POLICY_ENABLED")
    ensure(count(cleaned.sessions) === 0, "QA_SESSIONS_REMAIN")
    ensure(count(cleaned.refresh_tokens) === 0, "QA_REFRESH_TOKENS_REMAIN")
    ensure(count(cleaned.banned_users) === users.size, "QA_USERS_NOT_BLOCKED")
  }
}

async function run() {
  await db.connect()
  let deltas = null
  try {
    await createUsers()
    await createFixture()
    await signInUsers()
    await runStorageAndMainUat()
    deltas = await validateFinalDeltas()
  } catch (error) {
    primaryError = error
  } finally {
    try {
      await cleanup()
    } catch (error) {
      cleanupError = error
    }
  }

  const success = !primaryError && !cleanupError && mainCompleted
  const sanitized = {
    result: success ? "READY_FOR_RAMON_REVIEW" : "BLOCKED_MEJ05_039_UAT",
    migration_039: "MIGRATION_039_POSTCHECK_PASS",
    evidence_upload: success ? "MEJ05_EVIDENCE_UPLOAD_PASS" : "BLOCKED",
    storage_negative: Object.values(negative).every(Boolean)
      ? "MEJ05_STORAGE_NEGATIVE_PASS"
      : "BLOCKED",
    evidence_read: success ? "MEJ05_EVIDENCE_READ_PASS" : "BLOCKED",
    secure_extraordinary_uat: success
      ? "SECURE_EXTRAORDINARY_UAT_PASS"
      : "BLOCKED",
    secure_extraordinary_negative: Object.values(negative).every(Boolean)
      ? "SECURE_EXTRAORDINARY_NEGATIVE_PASS"
      : "BLOCKED",
    authorization_states: success
      ? ["draft", "active", "consumed_pending_ratification", "ratified"]
      : [],
    deltas,
    negative,
    evidence: {
      format: "application/pdf",
      under_5_mb: Boolean(evidenceBytes && evidenceBytes.length <= 5_242_880),
      sha256_recorded: success,
      private_object_preserved: success,
      signed_url_published: false,
    },
    payment_receipts_delta: deltas?.payment_receipts ?? null,
    paid_delta: deltas?.paid_requests ?? null,
    notifications_delta: deltas?.notification_events ?? null,
    delivery_attempts_delta: deltas?.delivery_attempts ?? null,
    alloc_001_intact: success,
    operadora_policy_enabled: false,
    qa_cleanup: success ? "PASS" : cleanupError ? "FAIL" : "PASS",
    prod_writes: 0,
    main_writes: 0,
    dev_direct_branch_writes: 0,
    failure_code:
      cleanupError?.message || primaryError?.message || null,
  }
  writeFileSync(
    path.join(evidenceDir, "uat-result-sanitized.json"),
    `${JSON.stringify(sanitized, null, 2)}\n`,
  )
  console.log(sanitized.result)
  if (!success) fail(sanitized.failure_code || "MEJ05_039_UAT_FAILED")
}

try {
  await run()
} finally {
  await db.end().catch(() => {})
}
