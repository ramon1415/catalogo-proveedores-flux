# Supabase PROD baseline / migration repair plan

## Status

This document is a planning artifact only. It does not authorize execution.

It was prepared after two successful read-only audits of Supabase PROD:

- Fine audit: `Supabase PROD Read-only Schema Audit` run `#14 / 28718851977`.
- Fine artifact: `supabase-prod-fine-audit-evidence`.
- Base audit: `Supabase PROD Read-only Schema Audit` run `#15 / 28720259191`.
- Base artifact: `supabase-prod-base-migrations-audit-evidence`.
- PROD project ref: `ucantptjhwttexzmslvm`.

Current classification: **B - PROD has base schema represented, partial newer schema, and no Supabase CLI history**.

Blocked until explicit Carlos/Ramon approval:

- release PR #147 merge;
- `supabase db push`;
- `supabase migration repair`;
- applying migrations;
- PROD notification tests;
- n8n real activation.

## Executive summary

PROD already contains the expected metadata objects for the base migration range `00101` through `00307`, but PROD does not contain Supabase CLI migration history:

- `supabase_migrations`: not present in PROD.
- `supabase_migrations.schema_migrations`: not present in PROD.
- Base migration objects `00101` through `00307` were found by read-only metadata audit.
- Newer release migrations are either missing or partial.

A direct `supabase db push` is still blocked. Without a baseline or selective repair decision, the CLI may try to apply migrations over objects that already exist outside `schema_migrations`.

This plan proposes a cautious baseline / `migration repair` strategy for human review. It does not execute anything.

## Evidence summary

### Fine audit evidence

Run: `#14 / 28718851977`

| Migration | Audited PROD state | Summary |
| --- | --- | --- |
| `00110_number_sequences.sql` | applied | `payment_request_number_seq` and `payment_layout_number_seq` exist |
| `00401_historical_actuals.sql` | not applied | `historical_actuals` is absent |
| `00402_payment_receipts_policies.sql` | partial | `payment_receipts` exists and RLS is active, but expected policies are missing |
| `00403_fase2_payment_method_closure.sql` | partial | `request_type` exists, but `payment_method` closure objects are missing |
| `007_notifications.sql` | not applied | notification tables/functions/trigger/RLS are absent |

### Base audit evidence

Run: `#15 / 28720259191`

Read-only guard:

- `transaction_read_only=on`.
- Every query wrapped in `BEGIN READ ONLY`.
- No `db push`.
- No `migration repair`.
- No DDL/DML.

| Migration | State | Object evidence |
| --- | --- | --- |
| `00101_extensions_and_types.sql` | applied | 30/30 objects |
| `00102_core_tables.sql` | applied | 17/17 objects |
| `00103_budget_tables.sql` | applied | 4/4 objects |
| `00104_payment_tables.sql` | applied | 5/5 objects |
| `00105_layout_tables.sql` | applied | 2/2 objects |
| `00106_cash_tables.sql` | applied | 3/3 objects |
| `00107_income_tables.sql` | applied | 25/25 objects |
| `00108_closure_dashboard_tables.sql` | applied | 11/11 objects |
| `00109_views.sql` | applied | 3/3 objects |
| `00110_number_sequences.sql` | applied | 2/2 objects |
| `00301_helper_functions.sql` | applied | 6/6 objects |
| `00302_budget_rpcs.sql` | applied | 1/1 objects |
| `00303_payment_request_rpcs.sql` | applied | 3/3 objects |
| `00304_layout_rpcs.sql` | applied | 4/4 objects |
| `00305_cash_rpcs.sql` | applied | 5/5 objects |
| `00306_income_invoice_rpcs.sql` | applied | 7/7 objects |
| `00307_dashboard_rpcs.sql` | applied | 10/10 objects |

Important limitation: the audit confirms presence of expected metadata objects. It does not prove line-by-line DDL equality, exact grants, exact policies, comments, ownership, or all behavioral details.

## Candidate migrations for repair as applied

These migrations are candidates only because their expected metadata objects were found in PROD. They still require human equivalence review before any repair command is executed.

| Migration | Audited state | Evidence | Risk | Recommendation | Future command proposal |
| --- | --- | --- | --- | --- | --- |
| `00101_extensions_and_types.sql` | applied | 30/30 objects | Medium: object presence does not prove exact enum/type equivalence | Candidate for repair only after human review | `supabase migration repair 00101 --status applied --linked` |
| `00102_core_tables.sql` | applied | 17/17 objects | High: table existence does not prove exact columns, constraints, indexes, RLS or grants | Candidate for baseline/repair only after deeper human acceptance | `supabase migration repair 00102 --status applied --linked` |
| `00103_budget_tables.sql` | applied | 4/4 objects | Medium: table presence does not prove exact constraints/RLS | Candidate after human review | `supabase migration repair 00103 --status applied --linked` |
| `00104_payment_tables.sql` | applied | 5/5 objects | High: payment tables exist but later payment policies are partial | Candidate only for base table history, not for 00402 | `supabase migration repair 00104 --status applied --linked` |
| `00105_layout_tables.sql` | applied | 2/2 objects | Medium: table presence does not prove exact indexes/RLS | Candidate after human review | `supabase migration repair 00105 --status applied --linked` |
| `00106_cash_tables.sql` | applied | 3/3 objects | Medium: table presence does not prove exact policies/RPC behavior | Candidate after human review | `supabase migration repair 00106 --status applied --linked` |
| `00107_income_tables.sql` | applied | 25/25 objects | High: many operational tables; presence is not full DDL equality | Candidate only after accepting metadata-level equivalence | `supabase migration repair 00107 --status applied --linked` |
| `00108_closure_dashboard_tables.sql` | applied | 11/11 representative objects | Medium: audit sampled representative constraints, not every constraint | Candidate after review of representative coverage | `supabase migration repair 00108 --status applied --linked` |
| `00109_views.sql` | applied | 3/3 views | Medium: view existence does not prove exact view definition | Candidate only after view definition acceptance | `supabase migration repair 00109 --status applied --linked` |
| `00110_number_sequences.sql` | applied | 2/2 sequences | Low/medium: sequence existence matches expected objects | Stronger candidate for repair after approval | `supabase migration repair 00110 --status applied --linked` |
| `00301_helper_functions.sql` | applied | 6/6 functions | High: function existence does not prove exact function body/security | Candidate only after accepting current function equivalence | `supabase migration repair 00301 --status applied --linked` |
| `00302_budget_rpcs.sql` | applied | 1/1 function | Medium: function body not compared | Candidate after human review | `supabase migration repair 00302 --status applied --linked` |
| `00303_payment_request_rpcs.sql` | applied | 3/3 functions | High: payment request behavior may differ from ledger | Candidate after human review | `supabase migration repair 00303 --status applied --linked` |
| `00304_layout_rpcs.sql` | applied | 4/4 functions | High: later 00403 modifies layout backend behavior; do not treat as 00403 | Candidate for base RPC history only | `supabase migration repair 00304 --status applied --linked` |
| `00305_cash_rpcs.sql` | applied | 5/5 functions | Medium: function bodies not compared | Candidate after human review | `supabase migration repair 00305 --status applied --linked` |
| `00306_income_invoice_rpcs.sql` | applied | 7/7 functions | Medium/high: function bodies not compared | Candidate after human review | `supabase migration repair 00306 --status applied --linked` |
| `00307_dashboard_rpcs.sql` | applied | 10/10 functions | Medium/high: function bodies not compared | Candidate after human review | `supabase migration repair 00307 --status applied --linked` |

## Proposed repair commands

The following commands are examples derived from the normalized migration file versions. They are intentionally listed for review only.

**NO EJECUTAR SIN AUTORIZACION RAMON/CARLOS.**

```bash
# NO EJECUTAR - proposed baseline/repair commands only
supabase migration repair 00101 --status applied --linked
supabase migration repair 00102 --status applied --linked
supabase migration repair 00103 --status applied --linked
supabase migration repair 00104 --status applied --linked
supabase migration repair 00105 --status applied --linked
supabase migration repair 00106 --status applied --linked
supabase migration repair 00107 --status applied --linked
supabase migration repair 00108 --status applied --linked
supabase migration repair 00109 --status applied --linked
supabase migration repair 00110 --status applied --linked
supabase migration repair 00301 --status applied --linked
supabase migration repair 00302 --status applied --linked
supabase migration repair 00303 --status applied --linked
supabase migration repair 00304 --status applied --linked
supabase migration repair 00305 --status applied --linked
supabase migration repair 00306 --status applied --linked
supabase migration repair 00307 --status applied --linked
```

Recommended operational rule: if these are ever authorized, execute them in a controlled window after backup and then immediately run `supabase migration list --linked` and `supabase db push --dry-run`. Do not run `supabase db push` in the same authorization unless Carlos/Ramon explicitly approve that next step.

## Migrations not candidates for repair as applied yet

These migrations must not be marked as applied in their current PROD state.

| Migration | Audited state | Objects found | Objects missing | Risk of incorrect repair | Proposed strategy |
| --- | --- | --- | --- | --- | --- |
| `00401_historical_actuals.sql` | not applied | none | `historical_actuals`, columns, constraints, RLS/policies | Marking as applied would permanently hide a missing table from CLI planning | Keep pending. Let CLI apply after baseline/repair, or prepare controlled patch only if dry-run shows dependency risk |
| `00402_payment_receipts_policies.sql` | partial | `payment_receipts`; RLS active; helper functions exist | expected policies `payment_receipts_select`, `payment_receipts_write_authorized`; intentional grants hardening still needs review | Marking as applied would hide missing RLS policy work and possible grant issues | Do not repair. Apply 00402 or prepare a dedicated payment receipts policy/grants patch after baseline decision |
| `00403_fase2_payment_method_closure.sql` | partial | `payment_requests.request_type`; enum type exists; existing `create_payment_layout` exists | `payment_requests.payment_method`; check constraint; index; `online_purchase`; backend layout guard by `payment_method = transfer` | Marking as applied would hide the core Fase 2 backend closure | Do not repair. Apply 00403 or prepare a dedicated Fase 2 patch after dry-run |
| `007_notifications.sql` | not applied | none | `notification_events`; `notification_delivery_attempts`; notification functions; trigger; RLS/policies/grants | Marking as applied would hide the entire notification ledger from CLI planning | Keep pending. Apply only after reconciliation and DEV notification validation |

## Proposed sequence after approval

### Phase A - Mandatory PROD backup

Before any actual repair or migration action:

1. Confirm target project `ucantptjhwttexzmslvm`.
2. Create/download backup from Supabase Dashboard.
3. Record date/time, backup type and approver.
4. Confirm exact next action with Carlos/Ramon.

### Phase B - Selective baseline / repair

If Carlos/Ramon accept the base audit as sufficient evidence, run only the approved `supabase migration repair --status applied` commands for `00101` through `00110` and `00301` through `00307`.

Do not include:

- `00401`;
- `00402`;
- `00403`;
- `007`.

### Phase C - Dry-run after repair

After repair/baseline only, run:

```bash
supabase migration list --linked
supabase db push --dry-run
```

Review whether the CLI plans only true pending work:

- `00401_historical_actuals.sql`;
- `00402_payment_receipts_policies.sql`;
- `00403_fase2_payment_method_closure.sql`;
- `007_notifications.sql`;
- any other unexpected migrations.

### Phase D - Decide pending / partial migrations

If dry-run is clean:

- Decide whether to apply `00401`, `00402`, `00403`, and `007` through normal CLI flow.

If dry-run reports conflicts:

- Stop.
- Do not force push.
- Prepare dedicated patch migrations for partial areas.

Expected likely review points:

- `00402`: policies and grants for `payment_receipts`.
- `00403`: `payment_method`, `online_purchase`, constraint/index and `create_payment_layout` backend guard.
- `007`: notification ledger should remain inert until DEV tests are complete.

### Phase E - Apply only with explicit authorization

Only after clean dry-run and explicit Carlos/Ramon approval:

```bash
supabase db push
```

This document does not authorize that command.

### Phase F - PROD smoke test

After any approved application:

- runtime config PROD;
- login;
- menu by role;
- dashboard;
- proveedores;
- solicitudes;
- aprobaciones;
- layouts only transferencias;
- pagos y comprobaciones;
- BBVA layout download;
- transfer receipt flow;
- n8n real not activated automatically;
- no real notification emails unless separately authorized.

## Risks

- The audits confirm object presence, not exact line-by-line DDL equality.
- `migration repair` changes only migration history. It does not apply SQL.
- Marking an incomplete migration as applied can hide real missing objects.
- `00402` and `00403` are partial and require careful handling.
- `007` is not applied in PROD.
- #147 must remain blocked until PROD history and required migrations are reconciled.
- Existing grants or function definitions may differ even if object names exist.
- A post-repair dry-run is mandatory before any push.

## Notifications

`007_notifications.sql` is not applied in PROD.

Do not test notifications in PROD yet.

Recommended notification rollout order:

1. Reconcile PROD migration history.
2. Run authorized dry-run.
3. Apply pending migration(s) only after approval.
4. Validate notifications in DEV first:
   - enqueue event;
   - row in `notification_events`;
   - claim pending;
   - mark processed / failed;
   - n8n manual, no cron;
   - Resend with controlled recipient.
5. Consider PROD notification validation only after separate authorization.

## Decision required from Ramon/Carlos

Carlos/Ramon must choose one of the following before any execution:

### Option A - Authorize selective repair for base migrations

Authorize repair as applied for:

- `00101` through `00110`;
- `00301` through `00307`.

Then run `supabase migration list --linked` and `supabase db push --dry-run` as a separate authorized step.

### Option B - Request deeper DDL/hash audit

Do not repair yet. Prepare a deeper read-only comparison of table columns, constraints, indexes, function definitions, view definitions, policies and grants.

### Option C - Keep #147 blocked

Do not repair or push. Keep the release candidate blocked until business/technical owners decide.

### Option D - Recreate PROD cleanly

Not recommended unless a severe inconsistency is found. This would require a separate data/backup/restore plan and explicit business approval.

## Recommended decision

Recommended path:

1. Carlos/Ramon review and accept the read-only base audit as sufficient for baseline of `00101` through `00110` and `00301` through `00307`.
2. Authorize a separate, controlled repair-only execution for those versions.
3. Do not repair `00401`, `00402`, `00403`, or `007`.
4. Run `supabase db push --dry-run` after repair.
5. Decide pending/partial migrations based on dry-run output.
6. Keep #147 blocked until the PROD database plan is safe.

## Confirmations

This document confirms:

- no SQL was executed;
- no GitHub Actions were executed;
- no `db push` was executed;
- no `migration repair` was executed;
- no migrations were applied;
- no DDL/DML was executed;
- no production data was modified;
- `main` was not touched;
- #147 was not merged;
- Supabase DEV/PROD were not changed;
- n8n was not touched;
- secrets and variables were not changed;
- frontend/app code was not modified;
- files under `supabase/migrations` were not modified.
