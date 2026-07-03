# Ledger convergence before company-level F1

This document records the release blocker found before merging PR #147 to `main` and before starting company-level F1.

## Current decision

Do not merge PR #147 until the release description and production migration procedure match the current strategy.

Current strategy:

- Keep `supabase/migrations/` as the schema source of truth.
- Retire custom `ops/precheck/load/postcheck` packages and manual SQL deployment workflows.
- Apply future schema changes with Supabase CLI, dry-run first, with explicit authorization by environment.

See:

```text
docs/ops/supabase-cli-migrations.md
```

Company-level F1 must start later as:

```text
008_company_level
```

Do not implement company-level F1 in this cleanup/release step.

## CLAUDE.md

`CLAUDE.md` was requested by the process, but it does not exist in `dev` or `main` at the time of this audit. The repository's established ops rules and prior PR guardrails were used instead.

## Sequences

Status: versioned.

`supabase/migrations/001j_number_sequences.sql` includes:

```sql
CREATE SEQUENCE IF NOT EXISTS public.payment_request_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.payment_layout_number_seq;
```

This is safe for environments where the sequences already exist manually, including PROD. It does not drop, restart, or reset numbering.

## Historical actuals

Status: versioned.

`supabase/migrations/004a_historical_actuals.sql` versions the audited DEV structure:

- `public.historical_actuals`
- primary key on `id`
- unique key on `(company_id, account_code, period_month)`
- FK to `public.companies(id)`
- RLS enabled
- `historical_actuals_select`
- `historical_actuals_write`
- grants to `authenticated`

Important: `company_id` remains nullable because the DEV audit showed it as nullable. Any future `NOT NULL` decision belongs in a separate data-quality PR after auditing null rows.

## Transfer receipts

Status: versioned.

The ledger contains:

- `public.payment_receipts` in `001d_payment_tables.sql`
- transfer receipt write policies in `004b_payment_receipts_policies.sql`

The old operational packages for applying 004b/004c are retired by the cleanup strategy. Future application should use Supabase CLI.

The known pending item remains:

```text
payment_receipts.notes
```

Prior DEV validation reported that `payment_receipts.notes` does not exist in DEV. Decide later whether the app should stop expecting that column or whether a separate migration should add it.

## Notifications

Status: versioned.

`supabase/migrations/007_notifications.sql` now versions:

- 2 notification tables
- 8 notification functions
- 1 trigger
- RLS / policies
- grants and EXECUTE hardening
- idempotent DDL
- no operational data
- no real sends activated by the migration itself

The read-only export packages and manual workflow evidence were used to build 007. They are historical evidence, not the current deployment procedure.

## Future 008

After the ledger is clean and release #147 is re-described with the Supabase CLI strategy, company-level F1 can start as:

```text
008_company_level
```

That work is explicitly out of scope here.

## Release #147 recommendation

Keep PR #147 Ready for review but do not merge it to `main` until:

1. PR #155 cleanup is reviewed and either merged or explicitly rejected.
2. PR #147 description is updated to remove `ops` packages and custom workflows as current release procedure.
3. The production migration procedure is confirmed as Supabase CLI with backup, dry-run, approval, apply, and smoke test.
4. The migration history risk is reviewed for DEV/PROD because earlier SQL was applied by custom workflows.

## Confirmations

This cleanup strategy does not:

- merge PR #147
- touch `main`
- touch production
- touch Supabase PROD
- touch n8n real
- change variables or secrets
- execute SQL
- execute Actions
- include PR #129
