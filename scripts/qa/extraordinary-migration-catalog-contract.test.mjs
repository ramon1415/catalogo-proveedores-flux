import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
const devCatalog = JSON.parse(
  readFileSync(new URL("./extraordinary-dev-catalog-contract.json", import.meta.url), "utf8"),
)

const canonicalStatus = "payment_request_extraordinary_status_check"

test("sanitized DEV inventory records the canonical pre-036 catalog", () => {
  assert.equal(devCatalog.project_ref, "scsirgbuqjcwoaxfacth")
  assert.deepEqual(devCatalog.status_counts, { active: 8, revoked: 1 })
  assert.equal(devCatalog.identifier_over_63_bytes, 0)
  assert.deepEqual(
    devCatalog.constraints.map(({ name }) => name),
    [
      "payment_request_extraordinary_authoriza_payment_request_id_fkey",
      "payment_request_extraordinary_authorizations_authorized_by_fkey",
      "payment_request_extraordinary_authorizations_pkey",
      "payment_request_extraordinary_authorizations_revoked_by_fkey",
      "payment_request_extraordinary_category_check",
      "payment_request_extraordinary_reason_check",
      "payment_request_extraordinary_revoke_check",
      canonicalStatus,
    ],
  )
  assert.deepEqual(
    devCatalog.indexes.map(({ name }) => name),
    [
      "payment_request_extraordinary_active_uidx",
      "payment_request_extraordinary_authorizations_pkey",
      "payment_request_extraordinary_request_idx",
    ],
  )
  assert.deepEqual(
    devCatalog.triggers.map(({ name }) => name),
    [
      "enqueue_extraordinary_payment_notification",
      "materialize_extraordinary_payable_snapshot",
      "set_payment_request_extraordinary_updated_at",
    ],
  )
  assert.equal(devCatalog.functions.length, 9)
  assert.equal(devCatalog.function_grants.length, 18)
  assert.equal(
    devCatalog.function_grants.filter(
      ({ grantee, function: functionName }) =>
        grantee === "authenticated"
        && functionName.startsWith(
          "public.authorize_payment_request_extraordinary(",
        ),
    ).length,
    1,
  )
})
