# Migration 026 - rollback guidance

## Default rule

Migration 026 is forward-only. Do not overwrite the function manually after a successful application.

The exact load runs in one transaction. If a precheck, replacement, grant or postcheck inside the load fails before `commit`, PostgreSQL rolls the transaction back. Stop, preserve the exact error and do not retry with edited SQL.

## If the load succeeds

1. Run `04_POSTCHECK_READ_ONLY.sql` before any functional mutation.
2. Compare the `payment_requests` and `cash_funds` counts with `02_BACKUP_DEV.sql`.
3. Confirm both QA requests still have no fund.
4. Preserve the exported precheck, backup and postcheck evidence.
5. Keep the Draft PR blocked until Ramon authorizes the controlled functional retest.

## If a forward correction is required

Do not restore the old request-type-only gate. Prepare a separately reviewed forward migration using the next free migration number. Start from the `pg_get_functiondef` and ACL snapshots exported by `02_BACKUP_DEV.sql`, preserve the batch trigger, and include its own precheck, exact load, postcheck and hash.

No destructive rollback SQL, `DROP FUNCTION`, data delete, migration repair or database push is included in this package.
