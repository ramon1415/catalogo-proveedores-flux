# Migration 027 rollback guidance

## Before commit

Migration 027 is transactional. Any error before `commit` rolls back the function creation and grants. Stop and retain the error evidence. Do not edit fragments in the SQL Editor and do not retry automatically.

## After a successful commit

Do not rerun or edit migration 027. Do not use `migration repair`, `db push`, destructive SQL, or an improvised rollback.

If a defect is found after commit:

1. Keep `provider-intake` undeployed or disable further QA invocation.
2. Confirm whether any link, intake, file, event, or Storage object was created.
3. Capture function definitions, grants, row counts, bucket state, and affected QA identifiers without PII.
4. Prepare the next free forward migration with explicit prechecks.
5. Apply only after separate authorization.

A future forward migration may replace or revoke the four service-only functions. It must never remove intake domain rows, private files, audit events, migration 025 objects, or core data without a separate approved retention procedure.
