# Supabase CLI migration workflow

## Decision

Flux keeps product schema in `supabase/migrations/` as the source of truth. The custom GitHub Actions ceremony around per-migration `precheck.sql`, `load.sql`, `postcheck.sql`, custom SQL runners, and evidence artifacts is deprecated.

Feature work stays in migrations and application code. Deployment should use the standard Supabase CLI flow with explicit human authorization per environment.

## What stays

Keep the migration ledger and product schema, including:

- `supabase/migrations/00110_number_sequences.sql`
- `supabase/migrations/00401_historical_actuals.sql`
- `supabase/migrations/00402_payment_receipts_policies.sql`
- `supabase/migrations/00403_fase2_payment_method_closure.sql`
- `supabase/migrations/007_notifications.sql`

The notifications feature stays as product architecture:

- `public.notification_events`
- `public.notification_delivery_attempts`
- enqueue / claim / mark processed / mark failed functions
- trigger and RLS/policies
- future n8n/Resend worker integration

## What is deprecated

The following operational ceremony is deprecated and should not be extended:

- per-migration `ops/**/precheck.sql`, `load.sql`, `postcheck.sql` packages
- manual GitHub Actions that apply SQL through custom scripts
- custom SQL runner scripts for deployment
- custom deployment evidence artifacts as the primary deployment control

## DEV flow

1. Confirm the branch and migration diff.
2. Review the remote migration history in Supabase before applying changes.
3. Run a dry run:

```bash
supabase db push --dry-run
```

4. Apply only after reviewing the dry-run output:

```bash
supabase db push
```

5. Run a short manual smoke test in DEV.
6. Document any mismatch between `supabase/migrations/` and the remote migration history.

## PROD flow

1. Get explicit Carlos/Ramon authorization for the production window.
2. Take a backup from Supabase Dashboard before applying schema changes.
3. Confirm the target project is PROD.
4. Review the remote migration history.
5. Run a dry run:

```bash
supabase db push --dry-run
```

6. Apply only after approval of the dry-run output:

```bash
supabase db push
```

7. Run production smoke tests:

- login
- dashboard
- proveedores
- solicitudes
- aprobaciones
- layouts
- pagos y comprobaciones
- runtime config

## PROD read-only audit from GitHub Actions

The protected workflow `Supabase PROD Read-only Schema Audit` can be used only to inspect PROD metadata before deciding whether a future Supabase CLI dry-run is safe.

Because GitHub-hosted runners may not resolve or reach the direct Supabase database host over IPv4, the audit workflow uses an environment secret named:

- `SUPABASE_PROD_AUDIT_DB_URL`

This secret must be configured in the GitHub Environment `supabase-production`. It should contain a Supabase Pooler connection string from Supabase Dashboard > Connect, preferably the Session Pooler / IPv4-compatible URL.

Rules for this secret:

- Do not commit it.
- Do not paste it in chat.
- Do not expose it in frontend code.
- Do not use it for n8n.
- Do not use it as a substitute for authorization to run migrations.
- Do not print the full URL in logs or artifacts.

The audit workflow remains read-only and must keep:

- `confirm_mode=audit`
- `confirm_prod` matching the PROD project ref
- branch restricted to `dev`
- `PGOPTIONS` with `default_transaction_read_only=on`
- metadata-only `SELECT` queries
- sanitized artifacts

This workflow does not run `supabase db push`, does not run `supabase migration repair`, and does not apply migrations.

## Migration history risk

Some schema changes were previously applied through custom workflows. Before relying on Supabase CLI for DEV or PROD, compare the real database state with `supabase_migrations.schema_migrations`.

If the database already contains objects from a migration but the migration history does not record that version, Supabase CLI may try to apply an already-present migration. In that case, document the mismatch and prepare a separate, reviewed `supabase migration repair` plan.

Do not run migration repair without explicit authorization.

## n8n scripts

The scripts under `scripts/n8n/` are not removed by this cleanup. They are classified as `review later` because they may still be useful for future n8n workflow import automation, but they should not be part of the Supabase schema migration path.

## PR #151

PR #151 proposed a manual Supabase PROD deployment workflow. Under the Supabase CLI strategy, that PR is considered superseded unless Carlos/Ramon explicitly decide to keep a protected PROD workflow for a different purpose.

Do not merge PR #151 while this strategy is active.
