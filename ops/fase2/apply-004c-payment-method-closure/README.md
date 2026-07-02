# Apply 004c Fase 2 payment method closure in DEV

## Purpose

This package applies only:

```text
supabase/migrations/004c_fase2_payment_method_closure.sql
```

to Supabase DEV through the authorized GitHub Actions workflow.

It exists because `Deploy Supabase DEV Manual` expects a folder with:

```text
precheck.sql
load.sql
postcheck.sql
```

Do not run the migration file directly through the workflow.

## Workflow input

Use this exact `script_path`:

```text
ops/fase2/apply-004c-payment-method-closure
```

Required workflow confirmation:

```text
confirm_dev: scsirgbuqjcwoaxfacth
```

## Files

- `precheck.sql`: validates required tables, columns, enums, function signature, RLS on `payment_requests`, absence of public/anon policies, and invalid legacy `payment_method` values before applying `004c`.
- `load.sql`: contains the exact SQL from `supabase/migrations/004c_fase2_payment_method_closure.sql`.
- `postcheck.sql`: validates `online_purchase`, `payment_requests.payment_method`, the check constraint, index, transfer-only layout function filter, RLS, policies, grants, and approved request method summary.

## Safety rules

- DEV only.
- Do not run on `main`.
- Do not run against Supabase PROD.
- Do not configure or print secrets.
- Do not touch n8n.
- Do not modify production.
- Do not run this package without explicit approval.

## Expected result

After a successful run:

- `public.payment_requests.payment_method` exists.
- `online_purchase` exists in `public.payment_request_type`.
- `payment_method` is limited to `transfer`, `cash`, `check`, or `other`.
- `public.create_payment_layout` includes only approved transfer payment requests.
- Cash, check, and other requests do not enter the bank layout.
- RLS remains active on `public.payment_requests`.
- No public/anon policy exists on `public.payment_requests`.

## DEV validation after applying

Validate with a real DEV user at:

```text
https://catalogo-proveedores-flux-git-dev-quantta-team.vercel.app/
```

Checklist:

1. Provider with preferred method Transfer creates request, approval sends it to layout.
2. Provider with preferred method Cash creates request and does not enter layout.
3. Transfer provider with request method changed to Check respects Check and does not enter layout.
4. Online purchase stores request type and payment method separately.
5. Reimbursement stores request type and payment method separately.
6. Quick provider creation from request preloads preferred method.
7. Approvals shows request type and payment method separately.
8. Layouts includes only approved transfers.
9. Payments and receipts shows the correct method.
10. Browser console has no errors.
