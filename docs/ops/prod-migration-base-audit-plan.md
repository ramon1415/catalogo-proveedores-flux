# Supabase PROD base migrations audit plan

## Status

This document is a planning artifact only. It does not authorize execution.

Prepared after:

- PR #178 merge commit: `387955180a953801ccd4244538dd7501d31fb0d8`.
- Fine read-only PROD audit classified PROD as **B - partial schema with no Supabase CLI history**.
- `docs/ops/prod-reconciliation-execution-plan.md` identified an open prerequisite: audit base migrations before any repair, baseline or push decision.

Still blocked:

- release PR #147 merge;
- `supabase db push`;
- `supabase migration repair`;
- applying migrations;
- PROD notification tests;
- n8n real activation.

## Non-goals

This audit does not:

- run SQL outside the protected GitHub workflow;
- run write SQL;
- run `supabase db push`;
- run `supabase migration repair`;
- apply migrations;
- change Supabase DEV or PROD;
- change n8n;
- change secrets or variables;
- modify frontend code;
- modify files under `supabase/migrations`.

## Audit scope

The workflow `Supabase PROD Read-only Schema Audit` now supports an input:

```text
audit_scope = base_migrations
```

Expected workflow inputs for a future authorized run:

```text
Branch: dev
confirm_mode: audit
confirm_prod: ucantptjhwttexzmslvm
audit_scope: base_migrations
```

Expected artifact:

```text
supabase-prod-base-migrations-audit-evidence
```

## Migration inventory

The migration names were read from the repo indexes and real files under `supabase/migrations/`.

Included migrations:

| Migration | Static object group | Audit object kinds |
| --- | --- | --- |
| `00101_extensions_and_types.sql` | extensions and public enum types | extensions, types |
| `00102_core_tables.sql` | core identity, provider, document and activity tables | tables |
| `00103_budget_tables.sql` | budget import and budget line tables | tables |
| `00104_payment_tables.sql` | approval, payment request and receipt tables | tables |
| `00105_layout_tables.sql` | payment layout tables | tables |
| `00106_cash_tables.sql` | cash fund and reconciliation tables | tables |
| `00107_income_tables.sql` | income, event, venue, production, invoice and ticket tables | tables |
| `00108_closure_dashboard_tables.sql` | monthly closure tables and representative foreign keys | tables, constraints |
| `00109_views.sql` | budget and event views | views |
| `00110_number_sequences.sql` | payment request and layout sequences | sequences |
| `00301_helper_functions.sql` | role/profile helper functions | functions |
| `00302_budget_rpcs.sql` | budget availability RPC | functions |
| `00303_payment_request_rpcs.sql` | payment request number/create/decision RPCs | functions |
| `00304_layout_rpcs.sql` | layout creation/status RPCs | functions |
| `00305_cash_rpcs.sql` | cash fund and reconciliation RPCs | functions |
| `00306_income_invoice_rpcs.sql` | income, invoice and incident RPCs | functions |
| `00307_dashboard_rpcs.sql` | dashboard and closure RPCs | functions |

## Read-only query sources

The audit uses only metadata/catalog queries, including:

- `pg_extension`
- `pg_type`
- `pg_namespace`
- `pg_class`
- `pg_proc`
- `pg_constraint`
- `information_schema.views`
- `supabase_migrations` metadata presence checks

It does not inspect operational rows from business tables.

## Classification rules

Each migration is scored by expected metadata objects.

| Classification | Meaning |
| --- | --- |
| `aplicada` | All expected metadata objects for that migration are present in PROD. This only makes the migration a candidate for human equivalence review. It does not authorize `migration repair`. |
| `parcial` | Some expected objects exist and some are missing. Do not mark as applied. Review differences and decide whether a patch or controlled application is needed. |
| `no aplicada` | None of the expected objects are present. Keep pending. Do not mark as applied. |
| `no concluyente` | The workflow could not classify safely. Stop and review artifact/logs. |

## Important interpretation notes

- `00110_number_sequences.sql` was already classified as applied by the fine audit. It remains in this base audit to keep the 001-series ledger picture complete.
- `00108_closure_dashboard_tables.sql` includes a representative foreign key sample rather than every foreign key, because the migration contains many foreign keys. If it comes back partial, review the detailed object output before deciding any repair.
- Function checks use function names in `public` with `prokind = 'f'`. They do not call the functions and do not inspect data returned by runtime RPCs.
- A result of `aplicada` is not the same as permission to run `supabase migration repair`. It only means the migration can be considered in a later human-approved baseline/repair plan.

## Relationship to reconciliation plan

This Route A audit is a prerequisite before proposing exact repair/baseline commands for PROD.

Recommended decision flow:

1. Merge the PR that adds this read-only audit mode to `dev`.
2. Run the workflow manually with `audit_scope = base_migrations` only after explicit authorization.
3. Review the artifact with Carlos/Ramon.
4. Decide which base migrations, if any, are equivalent enough to be candidates for baseline or selective repair.
5. Keep partial or absent migrations pending; do not mark them as applied.
6. Only after documented approval, prepare exact repair/baseline commands in a separate step.

## Guardrails preserved

The workflow keeps:

- branch restricted to `dev`;
- environment `supabase-production`;
- `SUPABASE_PROD_AUDIT_DB_URL` as the connection source;
- `confirm_mode = audit`;
- `confirm_prod` matching the PROD project ref;
- `BEGIN READ ONLY` around every query;
- `transaction_read_only=on` verification;
- `PGOPTIONS` read-only default;
- `--no-psqlrc`;
- `--echo-errors`;
- `ON_ERROR_STOP=1`;
- `VERBOSITY=verbose`;
- artifact upload with `if: always()`;
- sanitization of passwords, connection strings, tokens and secret-like values.

## Future recommendation

Do not execute anything from this document yet.

After the artifact exists, the next planning step should be one of:

- prepare a selective baseline/repair proposal for migrations proven equivalent;
- prepare patch migrations for partial areas;
- keep migration history unrepaired and continue investigation if results are inconclusive;
- stop release #147 until PROD history and schema are reconciled.

## Confirmations

This document confirms the intended PR does not:

- execute SQL;
- execute GitHub Actions;
- run `db push`;
- run `migration repair`;
- apply migrations;
- change PROD data;
- touch `main`;
- merge #147;
- touch Supabase DEV/PROD;
- touch n8n;
- change secrets or variables.
