# Ledger convergence before company-level F1

This document records the release blocker found before merging PR #147 to `main` and before starting company-level F1.

## Current decision

Do not merge PR #147 yet.

Resolve these blockers first:

1. Bring the DB migration ledger in line with the real DB objects.
2. Add or approve a production Supabase deployment procedure.

Company-level F1 must start later as:

```text
008_company_level
```

Do not implement company-level F1 in this PR.

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

## Transfer receipts / PR #134

Status: base objects versioned; `payment_receipts.notes` remains a separate pending decision.

The ledger contains:

- `public.payment_receipts` in `001d_payment_tables.sql`
- transfer receipt write policies in `004b_payment_receipts_policies.sql`
- DEV and PROD operational packages for applying/validating 004b

The known pending item is:

```text
payment_receipts.notes
```

Prior DEV validation reported that `payment_receipts.notes` does not exist in DEV. This PR does not add it. Decide later whether the app should stop expecting that column or whether a separate migration should add it.

## Notifications

Status: not versioned yet.

Static repo audit found references to:

- `public.notification_events`
- `public.notification_delivery_attempts`

The references appear in operational/audit files and n8n artifacts, but there is no exact DDL in `supabase/migrations/` for:

- notification tables
- notification functions
- notification trigger
- notification RLS / policies
- notification grants

Carlos reported DEV has ad-hoc notification objects:

- 2 tables
- 8 functions
- 1 trigger
- RLS / policies

Because the exact DDL is not present in the repo, this PR intentionally does not create `supabase/migrations/007_notifications.sql`.

Instead, it adds a read-only export package:

```text
ops/schema-audit/notifications-ledger-export/
```

Use that package to collect catalog definitions from DEV. Then create `007_notifications.sql` in a separate reviewed PR from the exported DDL.

## Future 007

The next migration needed for ledger convergence is expected to be:

```text
supabase/migrations/007_notifications.sql
```

It must be created only from exact DEV DDL evidence, not inferred from n8n workflows or SQL that merely references the tables.

Expected contents after export:

- 2 notification tables
- 8 notification functions
- 1 trigger
- RLS / policies
- grants
- idempotent DDL
- no secrets
- no service_role in frontend
- no operational data
- no real sends activated by the migration itself

## Future 008

After `007_notifications.sql` exists and is reviewed, company-level F1 can start as:

```text
008_company_level
```

That work is explicitly out of scope here.

## Release #147 recommendation

Keep PR #147 Ready for review but do not merge it to `main` until:

1. The notification DDL export has been run in DEV.
2. `007_notifications.sql` has been created from the export, reviewed, and merged to `dev`.
3. A production Supabase workflow or external procedure is approved.
4. The release PR is updated or rechecked after those PRs land.

## Confirmations

This PR only prepares ledger convergence.

It does not:

- merge PR #147
- touch `main`
- touch production
- touch Supabase PROD
- touch n8n real
- change variables or secrets
- execute SQL
- execute Actions
- include PR #129
