# Apply migration 025 foundation in DEV

## Scope

This package applies only the provider-intake data foundation. It creates four empty tables, one internal folio sequence/helper, read-only internal RLS, and the private empty bucket `intake-uploads`.

It does not create links, intakes, files, events, public endpoints, Edge Functions, navigation, or payment requests.

## Target and hard stop

- Supabase project: `scsirgbuqjcwoaxfacth`
- Environment: DEV only
- Never run this package in PROD.
- Do not use `db push`.
- Do not use migration-history repair.
- Do not edit SQL in the Supabase editor.
- Stop on the first `STOP`, `FAIL`, SQL error, or unexpected object.

## Integrity

- Migration file: `supabase/migrations/025_provider_intake_foundation.sql`
- Exact load file: `03_LOAD_025_EXACT.sql`
- SHA-256: `40f1ee4a0b9da2c789883709e30e3d87129b34cce33088f954f8baa97e460ade`

Before execution, verify that both files produce the SHA above and are byte-identical.

## Exact order

1. Open Supabase project `scsirgbuqjcwoaxfacth` and visibly confirm DEV.
2. Run `01_PRECHECK_READ_ONLY.sql`.
3. Continue only when every row is `PASS`.
4. Run `02_BACKUP_DEV.sql` and export every result grid as evidence.
5. Record the baseline counts for `companies`, `profiles`, `proveedores`, `payment_requests`, and `notification_events`.
6. In a fresh SQL Editor tab, load the unedited contents of `03_LOAD_025_EXACT.sql`.
7. Execute once. The file owns its `begin` and `commit` transaction.
8. Do not retry if any statement fails. Preserve the exact error and stop.
9. Run `04_POSTCHECK_READ_ONLY.sql` in a fresh tab.
10. Review every `PASS` and the three `INFO` count rows against the exported baseline.
11. Confirm the bucket has zero objects and all intake tables have zero rows.
12. Keep the GitHub PR in Draft until Ramon approves the evidence.

## Expected precheck

The precheck must report:

- required base relations and canonical helpers exist;
- Supabase roles exist;
- `gen_random_uuid()` is available;
- all four intake tables and migration helpers are absent;
- `intake-uploads` is absent, or already private and exactly compatible;
- no object or Storage policy already targets `intake-uploads`.

## Expected postcheck

The postcheck must report `PASS` for schema, constraints, indexes, RLS, grants, function protection, token handling, active-link uniqueness, private bucket configuration, zero Storage objects, and zero intake rows.

The following rows are `INFO` because a read-only script cannot persist the baseline across SQL Editor sessions:

- `notification_events_unchanged`
- `payment_requests_unchanged`
- `proveedores_unchanged`

Compare their counts manually with the exported output from `02_BACKUP_DEV.sql`. Any difference is a stop condition.

## Storage interpretation

PostgreSQL grants on `storage.objects` are table-wide, not bucket-specific. Migration 025 therefore adds no Storage policy for `intake-uploads`; bucket isolation is confirmed through the private bucket row, zero matching policies, and zero objects. Future uploads and signed reads will occur server-side only.

## Failure handling

The load is transactional. A failure before `commit` rolls back all statements in the load. Follow `05_ROLLBACK_GUIDANCE.md`; do not patch the SQL in place or improvise a manual unwind.
