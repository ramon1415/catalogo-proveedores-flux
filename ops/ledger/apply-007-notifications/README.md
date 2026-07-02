# Apply 007 notifications ledger in DEV

This package applies the versioned notifications ledger migration in Supabase DEV through the authorized manual pipeline.

## Scope

- Target migration: `supabase/migrations/007_notifications.sql`
- Target environment: Supabase DEV project `scsirgbuqjcwoaxfacth`
- Workflow script path: `ops/ledger/apply-007-notifications`
- Source DDL evidence: DEV artifact `8031309875` from the notifications ledger export

The package is part of ledger convergence before company-level Fase 1 work starts as a separate `008_company_level` effort.

## Files

- `precheck.sql`: validates DEV prerequisites, current notification object state, partial-table risks, incompatible objects, and dangerous PUBLIC/anon policies before loading 007.
- `load.sql`: invokes the exact versioned migration file `supabase/migrations/007_notifications.sql` through `psql`.
- `postcheck.sql`: validates notification tables, the 8 functions, trigger, RLS, policies, and hardened EXECUTE grants after loading 007.

## Execution

Use only the authorized DEV workflow:

```text
Workflow: Deploy Supabase DEV Manual
Branch: dev
script_path: ops/ledger/apply-007-notifications
confirm_dev: scsirgbuqjcwoaxfacth
```

Do not run this package from `main`. The DEV workflow is guarded to abort on `main`.

## Safety notes

- This package does not activate n8n.
- This package does not send emails.
- This package does not include secrets or credentials.
- This package does not use a `service_role` key in frontend/runtime code.
- This package does not create `008_company_level`.
- This package does not copy operational data.
- PR #147 remains unmerged to `main` until the release blocker is cleared.

## Expected result

After authorized execution in DEV, the postcheck should return:

```text
NOTIFICATIONS_007_POSTCHECK_OK
```

After that, Fase 1 company-level work can proceed separately as `008_company_level` only after explicit authorization.
