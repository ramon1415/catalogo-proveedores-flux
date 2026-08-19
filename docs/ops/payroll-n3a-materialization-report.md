# Payroll N3A — server verification and atomic materialization

Evidence date: 2026-08-18 UTC. Base DEV: `c3b3514ed2510b4eb63b334f06b2cf8692af519a`.

## Baseline and scope

Read-only DEV inspection found 121 payment requests and zero rows/objects in every payroll surface: capture sessions, capture files, `payroll-private`, payroll requests, channels, run files and run lines. N2B migration `20260817162934` is present once. PROD and `main` were not queried or changed.

N3A creates a draft migration and an undeployed Edge Function. It does not apply the migration, materialize data, grant temporary Finance, enable approval, create a layout, disperse money or send a notification.

## Trust boundary

The public operation accepts only capture session id, expected version and an idempotency key. It authenticates the user and reuses the N2B user-scoped Finance RPC. Director, SysAdmin, SuperAdmin, generic authenticated and anonymous callers do not obtain authority unless they independently satisfy the certified Finance gate.

The server then loads the inventory using a service-role-only RPC, validates the opaque company/request/file path, downloads each object from the private bucket, compares Storage metadata, recalculates SHA-256 over downloaded bytes and reparses SPEI with the canonical N2A `payroll_parser.js`. Browser hash, count and amount remain diagnostic only. No service-role value is returned or exposed to frontend code.

The server never logs raw bytes, names, identifiers, accounts or amounts. Error responses are allowlisted codes.

## Capability gate

| Source | N3A authority | Result |
| --- | --- | --- |
| SPEI TXT | Server download + canonical certified N2A parser | supported |
| Cover XLSX | No certified physical adapter | `PAYROLL_COVER_SHEET_FORMAT_UNVERIFIED` |
| BBVA same-bank TXT | Format not certified | `PAYROLL_SAME_BANK_FORMAT_UNVERIFIED` |
| TOKA XML | Employee breakdown contract pending | `PAYROLL_TOKA_FORMAT_UNVERIFIED` when required |

Because the cover is mandatory, a real capture cannot materialize in N3A. This is the intended fail-closed result, not a test gap.

## Atomic transaction and provenance

The internal materializer is executable only by `service_role`; authenticated users cannot call it. It locks the capture session, verifies version/expiry/state/idempotency and consumes only the Edge Function's server result. One database transaction inserts the draft payroll request, positive real channels, frozen file provenance and employee lines, then marks the capture `materialized`. Any exception rolls everything back.

`reserved_payment_request_id` becomes the definitive request id. A unique materialized request reference and a unique `capture_file_id` prevent duplication. Same-key retry returns `already_materialized`; a different key fails. The three-segment N2B object remains in place and is accepted only when company, reserved request, capture metadata, size and hash agree. Browser update/move/upsert remains blocked. Finance can read frozen evidence after capture expiry only through the definitive provenance relation.

The staging model gains nullable accounting context because N0 requires a cost center. A Finance-only optimistic-lock RPC sets an active cost center and optional active budget category/month. Materialization fails if that context is absent.

## Notification and approval audit

Live DEV has an unconditional `payment_request_created_notification_event` AFTER INSERT trigger and an approver-required BEFORE INSERT trigger. No payment-request INSERT trigger creates approval rows or batch items.

The N3A migration recreates both INSERT triggers with a narrow `WHEN` exclusion only for `request_type=nomina AND status=draft`. A constraint requires that such a draft has no approver, submission or approval timestamps. The atomic function also checks that notification events, approval rows and batch items remain zero; any side effect causes transaction rollback. Submission remains a future N3B operation.

Existing `payroll_uses_separate_flow`, payroll layout guards and Finance-only RLS on run files/lines are untouched. Payroll remains excluded from PAGOSBBV, PAGOSINT and CIE.

## Open dependencies

- Certify the cover XLSX physical contract and implement its server parser.
- Certify BBVA same-bank before accepting that channel.
- Validate TOKA employee breakdown before accepting vales.
- Provision an active recurring Finance profile before any future UAT.
- N3B must design submission/approval as a separate transition; materialization does not imply approval.

## Gate status

This change is ready for static review, Preview and migration dry-run only. DEV database apply and Edge deployment require a separate authorization.
