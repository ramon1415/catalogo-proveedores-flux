# Migration 028 manual package - cash/check batch readiness

Target: Supabase DEV project `scsirgbuqjcwoaxfacth` only.

This package aligns cash/check fund creation with the execution authorization already established by the batch model. It does not change `payment_requests.status`, create funds, register deliveries, create reconciliations, or execute payments.

## Scope

- Adds internal `public.get_payment_request_execution_readiness(uuid)`.
- Reuses current Direction approval, closed-batch, extraordinary, enforcement, material-change, and execution helpers.
- Keeps `require_batch_for_cash_fund` enabled and makes its trigger function consume the same readiness helper.
- Extends `public.get_payment_request_execution_context(uuid)` without removing existing fields.
- Replaces the exclusive `payment_requests.status = approved` gate in `public.create_cash_fund` with canonical readiness.
- Preserves the exact six-argument `create_cash_fund` signature, defaults, row lock, Finance actor check, amount/method/responsible validation, duplicate protection, insert, operational comment, return value, and grants.

Migration 027 is not a dependency and is not modified by this package.

## Files and order

1. `01_PRECHECK_READ_ONLY.sql`
2. `02_BACKUP_DEV.sql`
3. `03_LOAD_028_EXACT.sql`
4. `04_POSTCHECK_READ_ONLY.sql`
5. `05_ROLLBACK_GUIDANCE.md`

Run `01`, review every `STOP`, then capture `02`. Apply `03` exactly once only after explicit authorization. Run `04` immediately afterward and compare its count snapshot with `02`.

Do not run `03` from Codex. The package intentionally separates read-only inspection from the write step.

## Byte identity

`03_LOAD_028_EXACT.sql` must be byte-identical to:

`supabase/migrations/028_cash_fund_batch_execution_readiness.sql`

Expected SHA-256 (both files):

`06256F51BE2DB37754E952933FEE42ADC3DCA3709BD3A57E0DCC3287F7E72611`

The repository pins both SQL files to LF so this hash remains stable across checkouts.

## Stop conditions

Stop before applying when:

- the project is not `scsirgbuqjcwoaxfacth`;
- any precheck reports `STOP`;
- migration 028 already appears applied;
- `require_batch_for_cash_fund` is absent or disabled;
- the inspected 026 `create_cash_fund` contract differs;
- SOL-2026-0073 or SOL-2026-0074 is missing, already has a fund, lacks a current Direction approval, or is not in a closed batch;
- the load file hash differs from the migration hash.

## Expected post-application readiness

- SOL-2026-0073: `can_execute=true`, source `closed_batch`, method `cash`, no fund created by the migration.
- SOL-2026-0074: `can_execute=true`, source `closed_batch`, method `check`, no fund created by the migration.
- A Finance-authenticated frontend context may use `can_create_cash_fund` after the separate frontend change in PR #252.
- A second fund for the same request remains blocked by `cash_fund_already_exists` and the unique constraint.

## Out of scope

- Applying migration 028.
- Frontend changes in PR #252.
- Migration 027 or PR #254 provider intake.
- BATCH-017 requester credential work.
- Delivery, reconciliation, payment, notification audit, PROD, main, or PR #147.
