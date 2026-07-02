# PROD apply 004b + 004c payment receipts and payment method

This package prepares the production execution of the two database changes required by release PR #147.

Required migrations, in order:

1. `supabase/migrations/004b_payment_receipts_policies.sql`
2. `supabase/migrations/004c_fase2_payment_method_closure.sql`

This package must not be executed without explicit Carlos/Ramon authorization and a coordinated production window.

## Scope

This package is only for Supabase PROD execution planning. It does not contain application changes, n8n changes, secrets, credentials, or operational data.

It applies:

- `payment_receipts` RLS policies for authorized transfer receipt writes.
- `payment_requests.payment_method` closure for Fase 2.
- `online_purchase` support in `payment_request_type`.
- `create_payment_layout` backend filtering so only transfer payment requests can enter the bank layout.

## Script path

If an authorized production workflow supports `script_path`, use:

```text
ops/prod/fase2/apply-004b-004c-payment-receipts-method
```

Do not use the DEV workflow for production. If no authorized PROD workflow exists, create and approve the production runner separately before execution.

## Files

- `precheck.sql`: read-only validations before applying changes.
- `load.sql`: applies 004b and then 004c, copied inline for a self-contained package.
- `postcheck.sql`: validates the applied state without creating operational rows.

## Precheck

`precheck.sql` validates:

- `public.payment_receipts` exists and RLS is active.
- `public.payment_requests` exists and RLS is active.
- `flux_member_roles()`, `flux_approver_roles()`, and `current_user_has_role(text[])` exist.
- Required operational roles are present in `flux_approver_roles()`.
- Required Fase 2 tables, columns, enum, sequence, and `create_payment_layout` signature exist.
- No public or anon policy is present on `payment_receipts` or `payment_requests`.
- If `payment_method` already exists, it is `text` and has no invalid legacy values.
- If `payment_method` does not exist, the script reports that 004c will create it.
- Any existing `payment_requests_payment_method_check` constraint matches the 004c expected values.

## Load

`load.sql` applies exactly these migrations in this order:

1. `004b_payment_receipts_policies.sql`
2. `004c_fase2_payment_method_closure.sql`

The file is self-contained. It does not depend on psql includes or external paths.

## Postcheck

`postcheck.sql` validates:

- `payment_receipts` still has RLS active.
- `payment_receipts_select` exists and uses `flux_member_roles()`.
- `payment_receipts_write_authorized` exists and uses `flux_approver_roles()` for both `using` and `with check`.
- No public or anon policy exists on `payment_receipts` or `payment_requests`.
- `authenticated` has the expected table grants.
- `payment_method` exists on `payment_requests`.
- `payment_requests_payment_method_check` is validated for `transfer`, `cash`, `check`, and `other`.
- `online_purchase` exists in `payment_request_type`.
- `idx_payment_requests_payment_method` exists.
- `create_payment_layout` keeps `SECURITY DEFINER`, pins `search_path=public`, and contains the transfer-only backend filter.
- Approved requests are summarized by normalized payment method without printing row details.

The postcheck does not create layouts, receipts, payment requests, or smoke-test rows.

## Recommended production sequence

Preferred sequence for the final release window:

1. Confirm PR #147 is approved and ready to merge.
2. Confirm production backup or restore point is available.
3. Merge PR #147 to `main`.
4. Confirm Vercel production deploy starts and completes.
5. Execute this package against Supabase PROD through the authorized production process.
6. Confirm `precheck.sql`, `load.sql`, and `postcheck.sql` all succeed.
7. Run production smoke tests.
8. Keep monitoring payments, layouts, approvals, and transfer receipts.

Do not execute this package before merging PR #147 unless Carlos/Ramon explicitly decide to apply the database changes ahead of the application release.

## Risks

Executing before PR #147:

- Database changes would exist before the production frontend/runtime is released.
- `payment_method` would be available but older UI code may not fully manage it.
- The new layout RPC filter would be live before the release UI is live.

Executing after PR #147 without a coordinated window:

- Transfer receipt writes may still fail until 004b is applied.
- Layout behavior may differ until 004c is applied.
- Users could hit a short mismatch between released frontend and database capabilities.

Recommended approach: coordinated window with release merge, production deploy, package execution, and smoke test in one controlled sequence.

## Rollback plan

Before execution:

- Confirm a production backup, PITR, or restore point.
- Confirm the exact release commit and package commit.
- Confirm who can pause user testing if postcheck fails.

If `precheck.sql` fails:

- Stop.
- Do not run `load.sql`.
- Review the failed prerequisite and decide on a separate corrective PR or DBA action.

If `load.sql` fails before completion:

- Stop.
- Capture the exact error and statement.
- Do not retry blindly.
- Use backup/PITR or a reviewed forward-fix procedure depending on the partial state.

If `postcheck.sql` fails:

- Stop release validation.
- Do not create ad hoc policies or functions manually.
- Compare actual state with 004b/004c expected state.
- Use a reviewed forward fix or restore procedure.

Notes:

- 004b policy changes are generally reversible by restoring the previous policies from backup or by a reviewed rollback migration.
- 004c is not cleanly reversible because enum additions are not normally removed safely and `create_payment_layout` is replaced. Prefer PITR or a forward fix over manual rollback.
- Application rollback and database rollback are separate decisions.

## Production smoke tests after execution

Minimum checks:

- Login as an authorized operations user.
- Register a transfer receipt from `Pagos y comprobaciones`.
- Confirm success message, persisted receipt status, and dark modal rendering.
- Confirm `Ver layout` still works.
- Confirm layouts include only approved transfer payment requests.
- Confirm cash, check, and other payment methods do not enter the bank layout.
- Confirm approvals display request type and payment method separately.
- Confirm no console errors during these flows.

## Email Pilot release note

PRs #125 and #128 are already in `dev`, so their artifacts travel with release PR #147. They are expected to remain inert in production because:

- The n8n workflow artifact is `active=false`.
- It uses Manual Trigger only.
- It does not include schedule, cron, or interval triggers.
- It contains no real secrets.
- It does not configure production n8n credentials.
- PR #129 remains outside this release.

Accept this explicitly during release review. If the business wants zero Email Pilot artifacts in production, create a separate corrective PR before merging #147.
