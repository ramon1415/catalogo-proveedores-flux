# Supabase PROD reconciliation execution plan

## Status

This document is a planning artifact only. It does not authorize execution.

Current evidence:

- Fine read-only PROD audit: `Supabase PROD Read-only Schema Audit` run `#14 / 28718851977`.
- Result: `success`.
- Guardrail confirmed: `BEGIN READ ONLY` and `transaction_read_only=on`.
- Global classification: **B - PROD has a partial schema but no Supabase CLI history**.
- `supabase_migrations`: not present in PROD.
- `supabase_migrations.schema_migrations`: not present in PROD.

Still blocked:

- `supabase db push`.
- `supabase migration repair`.
- applying migrations.
- merge of release PR #147.
- PROD notification tests.
- n8n real activation.

## Non-goals

This document does not:

- run SQL;
- run GitHub Actions;
- run `supabase db push`;
- run `supabase migration repair`;
- apply migrations;
- change Supabase DEV or PROD;
- change n8n;
- change secrets or variables;
- modify frontend code;
- modify files under `supabase/migrations`.

## Supabase CLI facts used by this plan

Supabase CLI `migration repair` changes only the remote migration history table. It does not apply SQL and does not revert SQL. It should only be used when the actual database state is already known to match the migration version being marked.

Because PROD has no CLI history, a direct `db push` would risk applying migrations over objects that already exist outside `schema_migrations`.

## Audit input matrix

| Migration | Audited PROD state | Key evidence | Current recommendation |
| --- | --- | --- | --- |
| `00110_number_sequences.sql` | Applied | `payment_request_number_seq` and `payment_layout_number_seq` exist | Candidate for selective repair as applied, after backup and approval |
| `00401_historical_actuals.sql` | Not applied | `historical_actuals` does not exist | Pending real migration; do not repair as applied |
| `00402_payment_receipts_policies.sql` | Partial | `payment_receipts` exists and RLS is enabled, but expected policies are missing | Do not repair as applied; complete through controlled migration/patch strategy |
| `00403_fase2_payment_method_closure.sql` | Partial | `request_type` exists; `payment_method`, constraint, index, `online_purchase`, and layout guard are missing | Do not repair as applied; apply/patch after history is reconciled |
| `007_notifications.sql` | Not applied | notification tables, functions, trigger, RLS and policies are absent | Pending real migration; apply only after reconciliation and DEV validation |

## Static migration review

### `00110_number_sequences.sql`

Static content:

- `CREATE SEQUENCE IF NOT EXISTS public.payment_request_number_seq;`
- `CREATE SEQUENCE IF NOT EXISTS public.payment_layout_number_seq;`

Audit result:

- Both sequences exist in PROD.
- Sequence defaults from the fine audit match normal bigint sequence defaults.

Decision:

- This migration is a candidate for repair as already applied.
- It should not be applied again by `db push` if Carlos/Ramon accept object equivalence.

Future command proposal, **NO EJECUTAR**:

```bash
supabase migration repair 00110 --status applied --linked
```

Required before execution:

- PROD backup.
- Carlos/Ramon approval.
- Confirmation that only version `00110` is being repaired.
- Confirmation that earlier base migrations have their own reconciliation decision, because PROD has no CLI history at all.

### `00401_historical_actuals.sql`

Static content:

- Creates `public.historical_actuals` if missing.
- Adds primary key, unique key and FK to `public.companies(id)`.
- Enables RLS.
- Creates `historical_actuals_select` and `historical_actuals_write` only if absent.
- Grants table access to `authenticated`.

Audit result:

- `public.historical_actuals` does not exist in PROD.
- No columns, constraints, RLS or policies were found.

Decision:

- This migration is not applied.
- Do not mark it as applied with repair.
- It can be treated as a pending real migration after history/baseline is resolved, assuming dependencies exist in PROD.

Future command proposal:

```text
No repair command proposed for 00401.
Let the authorized migration flow apply it after reconciliation, or prepare a controlled patch if dry-run shows dependency risk.
```

Risks to review before execution:

- `public.companies` must exist.
- `current_user_has_role`, `flux_member_roles`, and `flux_finance_roles` must exist.
- Business must accept `company_id` nullable, matching the DEV audit decision.

### `00402_payment_receipts_policies.sql`

Static content:

- Enables RLS on `public.payment_receipts`.
- Drops/recreates `payment_receipts_select`.
- Drops/recreates `payment_receipts_write_authorized`.
- Grants select/insert/update/delete to `authenticated`.

Audit result:

- `public.payment_receipts` exists.
- RLS is enabled.
- Expected policies are missing.
- Broad grants to `anon` and `authenticated` were detected by the audit.
- `flux_member_roles()` and `flux_approver_roles()` exist.

Decision:

- This migration is partial.
- Do not mark it as applied with repair.
- Applying the existing migration may create the expected policies, but it does not explicitly revoke the broad `anon` grants observed in PROD.
- A security patch may be required to revoke unsafe `anon` privileges and keep access aligned with RLS/policies.

Future command proposal:

```text
No repair command proposed for 00402 in its current partial state.
Prepare either:
1. authorized application of 00402 plus a follow-up grants hardening patch; or
2. a dedicated reconciliation patch that creates expected policies and fixes grants.
```

Risks to review before execution:

- Existing broad `anon` privileges on `payment_receipts` may remain if only 00402 runs.
- RLS helps, but table grants should still be made intentional.
- The release should not rely on payment receipt writes until this is closed in PROD.

### `00403_fase2_payment_method_closure.sql`

Static content:

- Adds enum value `online_purchase` to `public.payment_request_type` if missing.
- Adds `payment_requests.payment_method` if missing.
- Adds and validates `payment_requests_payment_method_check`.
- Creates `idx_payment_requests_payment_method`.
- Replaces `public.create_payment_layout(...)` with backend filtering for transfer payment method.

Audit result:

- `payment_requests.request_type` exists.
- `payment_requests.payment_method` does not exist.
- Constraint does not exist.
- Index does not exist.
- `online_purchase` enum value does not exist.
- `create_payment_layout(...)` exists but does not reference `payment_method` or transfer filtering.

Decision:

- This migration is partial.
- Do not mark it as applied with repair.
- It is functionally required before releasing Fase 2 to PROD.
- It may be safe to apply after history is reconciled, but only after dry-run and dependency checks.

Future command proposal:

```text
No repair command proposed for 00403 in its current partial state.
Let the authorized migration flow apply it after baseline/repair, or prepare a dedicated Fase 2 patch if dry-run shows conflict.
```

Risks to review before execution:

- `payment_request_type` already exists and lacks `online_purchase`; `add value if not exists` should address that, but must be validated by dry-run.
- Existing `payment_requests` rows will get `payment_method = null`; the check allows null.
- The function replacement changes backend layout eligibility and must be smoke-tested after application.

### `007_notifications.sql`

Static content:

- Creates `notification_events` and `notification_delivery_attempts` if missing.
- Creates constraints and indexes.
- Creates notification helper/runtime functions.
- Creates trigger `set_updated_at_notification_events`.
- Enables RLS.
- Creates select policies for recipient/admin visibility.
- Grants table access to `authenticated`, `service_role`, and `postgres` as defined.
- Revokes broad function execute access before adding explicit grants.

Audit result:

- Notification tables do not exist.
- Notification functions do not exist.
- Trigger does not exist.
- RLS/policies do not exist.

Decision:

- This migration is not applied.
- Do not mark it as applied with repair.
- It is a pending real migration, but it should not be the first PROD action.
- Apply only after history is reconciled and DEV notification tests are complete.

Future command proposal:

```text
No repair command proposed for 007.
Apply only through the authorized migration flow after reconciliation, dry-run, and DEV notification validation.
```

## Recommended execution strategy

### Phase A - Mandatory backup

Required before any actual change:

1. Confirm project: `ucantptjhwttexzmslvm`.
2. Create/download backup from Supabase Dashboard.
3. Record date/time, backup type and approver.
4. Confirm Carlos/Ramon approval for the exact next step.

### Phase B - History reconciliation / baseline

Recommended minimum scoped decision:

- Mark `00110` as applied only if Carlos/Ramon accept that the two sequences in PROD are equivalent to the migration.
- Do not mark `00401`, `00402`, `00403` or `007` as applied.

Future command, **NO EJECUTAR**:

```bash
supabase migration repair 00110 --status applied --linked
```

Important caveat:

PROD has no CLI history at all. This plan only covers the five fine-audited migrations. Before a full `db push`, Carlos/Ramon must also decide how to baseline or repair earlier base migrations (`00101` through `00307`) if they are already represented in PROD. Do not assume that repairing `00110` alone makes the full ledger safe.

### Phase C - Dry-run after reconciliation

Only after authorized repair/baseline:

```bash
supabase migration list --linked
supabase db push --dry-run
```

Expected review points:

- Does CLI still attempt to recreate existing base objects?
- Does CLI plan only truly pending migrations/patches?
- Does it include `00401`, `00402`, `00403`, `007` as expected?
- Does it surface conflicts on existing `payment_receipts`, `payment_requests` or functions?

### Phase D - Application

Only after clean dry-run and explicit approval:

```bash
supabase db push
```

No execution is authorized by this document.

If dry-run shows conflicts in partial migrations:

- Stop.
- Do not force push.
- Prepare dedicated patch migration(s) for partial areas:
  - `payment_receipts` policies/grants.
  - Fase 2 `payment_method` closure and `create_payment_layout` backend guard.

### Phase E - Smoke test PROD

After approved application only:

- runtime config PROD;
- login;
- menu by role;
- dashboard;
- proveedores;
- solicitudes;
- aprobaciones;
- layouts;
- pagos y comprobaciones;
- BBVA layout download;
- transfer receipt flow;
- confirm n8n real did not activate automatically;
- confirm notifications are not sending real emails unless explicitly authorized.

## Decision matrix

| Migration | Audited state | Direct db push risk | Recommendation | Future command proposal | Requires backup | Requires Carlos/Ramon approval |
| --- | --- | --- | --- | --- | --- | --- |
| `00110_number_sequences.sql` | Applied | Medium: CLI history is absent and may try to apply existing sequences | Repair as applied only after equivalence approval | `supabase migration repair 00110 --status applied --linked` | Yes | Yes |
| `00401_historical_actuals.sql` | Not applied | Medium: new table/FK/RLS depends on existing base objects | Keep pending; apply after reconciliation/dry-run | No repair; pending migration | Yes | Yes |
| `00402_payment_receipts_policies.sql` | Partial | High: policies missing and broad grants detected | Do not repair; apply or patch policies/grants deliberately | No repair; likely patch/grants hardening | Yes | Yes |
| `00403_fase2_payment_method_closure.sql` | Partial | High: backend layout guard missing | Do not repair; apply or patch after dry-run | No repair; pending/patch strategy | Yes | Yes |
| `007_notifications.sql` | Not applied | Medium: new notification ledger; should remain inert until tested | Keep pending; apply after reconciliation and DEV validation | No repair; pending migration | Yes | Yes |

## Notification rollout order

`007_notifications.sql` is not applied in PROD. Do not test notifications in PROD yet.

Correct order:

1. Reconcile PROD history.
2. Run authorized dry-run.
3. Apply pending migration(s) only after approval.
4. Validate notifications in DEV first:
   - enqueue event;
   - row in `notification_events`;
   - claim pending;
   - mark processed / failed;
   - n8n manual, no cron;
   - Resend with controlled recipient.
5. Consider PROD notification validation only after a separate authorization.

## Recommended next step

Do not execute anything yet.

Recommended next planning PR/action:

1. Decide whether to audit/base-line earlier migrations `00101` through `00307` before any repair.
2. If approved, prepare a command sheet for selective `migration repair` with exact versions.
3. Keep `00401`, `00402`, `00403`, and `007` un-repaired until they are either applied by CLI or completed by explicit patch migrations.

## Final recommendation

Recommended path for Carlos/Ramon review:

1. Accept classification B: PROD partial schema, no CLI history.
2. Approve no direct `db push` yet.
3. Approve selective repair only for migrations proven equivalent, starting with `00110`.
4. Require a separate decision for earlier base migrations not covered by this fine audit.
5. Treat `00401`, `00402`, `00403`, and `007` as pending or partial, not as applied.
6. Use dry-run only after repair/baseline decisions are documented.
7. Keep #147 blocked until PROD history and required migrations are safely reconciled.

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
- secrets and variables were not changed.
