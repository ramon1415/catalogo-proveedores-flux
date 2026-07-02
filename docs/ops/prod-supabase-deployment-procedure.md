# Supabase PROD deployment procedure

This document defines the controlled production procedure for applying approved SQL packages after a release is authorized.

## Current blocker

`main` previously only registered DEV workflows:

- `deploy-supabase-dev-manual.yml`
- `import-n8n-dev-workflow-manual.yml`

Those workflows must not be used for production.

This PR adds a separate manual PROD workflow:

```text
Deploy Supabase PROD Manual
```

Workflow file:

```text
.github/workflows/deploy-supabase-prod-manual.yml
```

## Required GitHub Environment

The workflow uses:

```text
environment: production
```

Recommended protection:

- Required reviewers enabled.
- Carlos/Ramon or designated release owner as approver.
- No automatic approval for production SQL.

## Required secrets

Configure these only in the protected `production` environment:

```text
SUPABASE_PROD_DB_URL
SUPABASE_PROD_PROJECT_REF
```

Do not store production secrets in repository-level plain variables. Do not paste secret values into prompts, PRs, docs, logs, or issues.

## Workflow inputs

When running the workflow from GitHub Actions:

```text
Branch: main
script_path: ops/prod/fase2/apply-004b-004c-payment-receipts-method
confirm_prod: production
confirm_project_ref: <Supabase PROD project ref>
```

`confirm_project_ref` must match the protected environment secret `SUPABASE_PROD_PROJECT_REF`. The workflow masks both values.

## Path restrictions

The workflow only accepts deployment folders under:

```text
ops/prod/
```

It requires the folder to contain:

```text
precheck.sql
load.sql
postcheck.sql
```

The workflow rejects:

- URLs
- absolute paths
- paths containing `..`
- paths outside `ops/prod/`
- missing SQL phase files

## Execution order

The workflow executes:

1. `precheck.sql`
2. `load.sql`
3. `postcheck.sql`

If any phase fails, the workflow stops.

## Release sequence for PR #147

After final approval:

1. Confirm PR #147 is Ready for review, mergeable clean, and Vercel success.
2. Confirm PR #129 remains outside the release.
3. Merge PR #147 to `main`.
4. Wait for Vercel production deployment success.
5. Validate runtime production:
   - `FLUX_ENV=prod`
   - `source=vercel-env`
   - Supabase host is PROD
   - no fallback DEV
   - no Supabase DEV
6. Run `Deploy Supabase PROD Manual` from branch `main`.
7. Use script path:

```text
ops/prod/fase2/apply-004b-004c-payment-receipts-method
```

8. Confirm precheck, load, and postcheck success.
9. Run production smoke tests.

## Expected 004b/004c postcheck outcomes

The package should confirm:

- `payment_receipts` RLS is active.
- `payment_receipts_write_authorized` exists.
- writes are limited by `flux_approver_roles()`.
- `payment_method` exists.
- `payment_requests_payment_method_check` is validated.
- `online_purchase` exists.
- `create_payment_layout` filters backend candidates to transfer only.
- cash, check, and other payment methods do not enter the bank layout.
- no public/anon dangerous policy exists.

## Evidence

The workflow uploads sanitized evidence as an artifact:

```text
supabase-prod-deployment-evidence
```

Retention:

```text
30 days
```

The evidence should include:

- plan
- SQL phase logs with secrets redacted
- summary JSON

## Smoke test production

URL:

```text
https://catalogo-proveedores-flux.vercel.app
```

Minimum manual validation:

- login
- dashboard
- proveedores
- solicitudes
- aprobaciones
- layouts
- pagos y comprobaciones
- comprobante de transferencia
- configuracion
- runtime config prod

Do not create real operational data unless separately authorized. If test data is required, use controlled folios and document them.

## Rollback guidance

If the production deployment fails before SQL:

- Do not run the SQL package.
- Revert or redeploy application release as appropriate.

If `precheck.sql` fails:

- Stop.
- Do not run `load.sql`.
- Review the missing prerequisite.

If `load.sql` fails:

- Stop.
- Do not retry blindly.
- Capture the exact error and phase log.
- Decide between a reviewed forward fix and database restore/PITR depending on partial state.

If `postcheck.sql` fails:

- Stop smoke testing.
- Do not patch production manually.
- Compare actual state to expected 004b/004c state.
- Use a reviewed forward fix or restore procedure.

If frontend/runtime fails but DB package was not executed:

- Revert the merge commit or redeploy the previous production build.

If DB package was executed:

- Treat application rollback and database rollback as separate decisions.
- Do not drop columns, enum values, policies, or functions manually without a reviewed rollback plan.

## Prohibitions

- Do not use the DEV workflow for production.
- Do not run from `dev`.
- Do not use repository-level unprotected secrets.
- Do not paste secrets into logs or prompts.
- Do not touch n8n real.
- Do not change Vercel variables during this workflow.
- Do not run ad hoc SQL outside the approved procedure.
