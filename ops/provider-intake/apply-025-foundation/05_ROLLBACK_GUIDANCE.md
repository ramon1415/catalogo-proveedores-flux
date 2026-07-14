# Migration 025 - rollback guidance

## Default rule

Migration 025 is forward-only. Do not remove intake objects manually after a successful application.

The load is wrapped in one transaction. If any precheck, statement, or postcheck fails before `commit`, PostgreSQL rolls the full transaction back. Stop and preserve the exact error; do not retry with edited SQL.

## If the load succeeds

1. Run `04_POSTCHECK_READ_ONLY.sql`.
2. Compare the three core-table counts with the export from `02_BACKUP_DEV.sql`.
3. Confirm all domain tables and the bucket are empty.
4. Keep the Draft PR blocked until every PASS/INFO result is reviewed.

## If an unwind is ever required

Do not improvise in the SQL Editor. First verify that no link, intake, file metadata, event, or Storage object exists. Then prepare a separately reviewed, explicitly authorized forward migration that removes only the objects introduced by 025. That follow-up must include its own precheck, evidence snapshot, and postcheck.

No destructive rollback SQL is included in this package by design.
