# Migration 028 rollback guidance

Migration 028 changes function definitions and grants only. It does not change request status, create a fund, register delivery, create a reconciliation, or execute a payment.

Do not rollback automatically and do not delete rows to simulate a rollback.

## Before rollback

1. Stop new cash/check fund creation temporarily at the application level.
2. Preserve the full output from `02_BACKUP_DEV.sql` and `04_POSTCHECK_READ_ONLY.sql`.
3. Confirm whether any fund was legitimately created after migration 028. Do not delete it.
4. Confirm the target is DEV `scsirgbuqjcwoaxfacth`.
5. Obtain explicit approval for the rollback transaction.

## Restore order

Use the exact pre-028 definitions captured by `02_BACKUP_DEV.sql`:

1. Restore `public.approval_batch_assert_execution_authorized()`.
2. Restore `public.get_payment_request_execution_context(uuid)`.
3. Restore `public.create_cash_fund(uuid,uuid,date,text,uuid,text)`.
4. Drop `public.get_payment_request_execution_readiness(uuid)` only after no restored function references it.
5. Restore the captured grants exactly.
6. Confirm `require_batch_for_cash_fund` and `require_batch_for_payment_layout_line` remain present and enabled.

Perform those DDL statements in one reviewed transaction. Do not modify migrations 021-027 and do not rewrite migration history.

## Required verification

- Exact six-argument `create_cash_fund` signature and two defaults restored.
- `SECURITY DEFINER` and `search_path = public, pg_temp` restored.
- `authenticated` retains only the captured public RPC grants; `anon` and `PUBLIC` have no execution grant.
- Cash-fund unique constraint remains present.
- Counts match the pre-rollback snapshot except for legitimate runtime activity.
- SOL-2026-0073 and SOL-2026-0074 are not mutated or deleted.
- No fund, delivery, reconciliation, payment, notification, or request status is fabricated as part of rollback.

After rollback, repeat the authenticated BATCH-012/BATCH-013 diagnosis before deciding the next implementation.
