# Apply migration 026 cash-fund gate in DEV

## Scope

This package replaces only `public.create_cash_fund(uuid,uuid,date,text,uuid,text)`.

It resolves the request method from canonical `payment_requests.payment_method`, falls back to historical `request_type`, and accepts only normalized `cash` or `check`. It preserves the existing row lock, approved-status check, responsible/delivered-by validation, duplicate prevention, amount/company/currency behavior, `cash_funds` insertion, operational comment, JSON return, and the external batch-authorization trigger.

The inspected legacy RPC had no in-body Finance actor check and inherited broad EXECUTE grants. Migration 026 adds the canonical `approval_batch_require_finance()` guard, fixes `search_path` to `public, pg_temp`, revokes PUBLIC/anon execution, and grants execution only to `authenticated`.

It creates no fund, delivery, reconciliation, payment, bank file, notification, user, role, table, trigger, or frontend change.

## Target and hard stop

- Supabase project: `scsirgbuqjcwoaxfacth`
- Environment: DEV only
- Baseline: `8ec701d26fdfe43dd2f0fd3d9c8b8eb23eb31e15`
- Migration 025 must already be present.
- Never run this package in PROD.
- Do not use `db push`.
- Do not use migration-history repair.
- Do not edit SQL in the Supabase editor.
- Stop on the first `STOP`, `FAIL`, SQL error, unexpected object, count change or hash mismatch.

## Integrity

- Migration file: `supabase/migrations/026_cash_fund_payment_method_gate.sql`
- Exact load file: `03_LOAD_026_EXACT.sql`
- SHA-256: `2f6f12ef2abc76d8b1d424891ec0320d9b172c9e710739c89c2cd8d5335e492c`

Before execution, verify that both files produce the SHA above and are byte-identical.

## Exact application order

1. Open Supabase project `scsirgbuqjcwoaxfacth` and visibly confirm DEV.
2. Run `01_PRECHECK_READ_ONLY.sql`.
3. Continue only when every operational row is `PASS`; review the grant snapshot `INFO` row.
4. Run `02_BACKUP_DEV.sql` and export every result grid as evidence.
5. Record the baseline counts for `payment_requests`, `cash_funds`, `approval_batches` and `approval_batch_items`.
6. Confirm `SOL-2026-0073` and `SOL-2026-0074` have no `cash_fund`.
7. Independently verify the two SHA-256 values and byte identity.
8. In a fresh SQL Editor tab, load the unedited contents of `03_LOAD_026_EXACT.sql`.
9. Execute once. The file owns its `begin` and `commit` transaction.
10. Do not retry if any statement fails. Preserve the exact error and stop.
11. Run `04_POSTCHECK_READ_ONLY.sql` immediately, before any functional retest.
12. Require every operational row to be `PASS` and compare both `INFO` counts with the backup export.
13. Preserve the precheck, backup, load result and postcheck exports.
14. Keep the Draft PR blocked until Ramon reviews and authorizes the functional retest.

## Expected precheck

The precheck confirms:

- migration 025 semantic objects exist;
- the exact six-argument `create_cash_fund` signature returns `jsonb` and is `SECURITY DEFINER`;
- the inspected legacy request-type gate is still present and 026 has not already been applied;
- row lock, approved status, responsible, duplicate and insert/update contracts are recognizable;
- the batch execution trigger and its helper functions exist;
- `cash_funds.payment_request_id` remains unique;
- QA cash/check requests use the canonical model and have no fund.

The current grant snapshot is informational because 026 deliberately narrows execution to `authenticated`.

## Expected postcheck

The postcheck must return `PASS` for:

- migration 025 presence and unchanged function signature;
- `SECURITY DEFINER` and `search_path = public, pg_temp`;
- authenticated-only execution;
- canonical `payment_method` gate and legacy fallback;
- normalized cash/check-only behavior and delivery-method match;
- Finance actor guard;
- approved-status, closed-batch trigger and idempotency gates;
- both QA requests present and both QA funds absent before retest.

The two count rows are `INFO` because a read-only script cannot persist the exported baseline. Compare them manually. Any change before functional retesting is a stop condition.

## Functional retest boundary

This package does not execute BATCH-012 or BATCH-013. After Ramon accepts the database evidence, use the authenticated DEV UI and the existing QA records to test the gate before and after batch closure. Do not deliver cash or a check, submit a reconciliation, generate a bank file, mark a bank payment, or delete QA records.

## Failure handling

The load is transactional. A failure before `commit` rolls back the complete migration. Follow `05_ROLLBACK_GUIDANCE.md`; do not patch SQL in place or improvise destructive recovery.
