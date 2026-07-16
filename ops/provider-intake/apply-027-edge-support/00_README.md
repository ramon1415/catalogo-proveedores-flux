# Manual DEV gate - migration 027

This package applies private transactional support for `provider-intake` only.

## Hard prerequisites

- Target project: Supabase DEV `scsirgbuqjcwoaxfacth`.
- Migration 025 is already installed and must not be rerun.
- Migration 026 must be integrated and its order confirmed before this package is used.
- Intake tables and `intake-uploads` must still be empty.
- Do not use PROD, `db push`, or `migration repair`.
- Do not deploy `provider-intake` before the postcheck is reconciled.

## Exact load integrity

- Migration: `supabase/migrations/027_provider_intake_edge_support.sql`
- Exact load: `03_LOAD_027_EXACT.sql`
- SHA-256: `4d3892d97179d0da58af62c2a64656d05d8f6f99dee62436e5aa56b3ce7c0bcf`

The migration and exact load must be byte-identical. Stop if the local hash differs.

## Order

1. Run `01_PRECHECK_READ_ONLY.sql`.
2. Stop on any `STOP`, `FAIL`, or SQL error.
3. Export all result sets from `02_BACKUP_DEV.sql` to a private evidence folder.
4. Compare the SHA-256 and byte identity locally.
5. Execute `03_LOAD_027_EXACT.sql` once.
6. Run `04_POSTCHECK_READ_ONLY.sql`.
7. Compare intake, Storage, notification, payment request, provider, and batch counts with the backup.
8. Stop. Secrets, deploy, link creation, and QA require a separate 1B.2 authorization.

Never paste credentials into SQL, repository files, artifacts, logs, or chat.
