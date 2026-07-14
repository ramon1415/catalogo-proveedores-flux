# Cash-fund payment-method gate - migration 026

## Objective

Migration 026 aligns `public.create_cash_fund` with the model already used by the current UI and batch eligibility logic:

```text
request_type = provider_payment
payment_method = cash | check
```

The legacy RPC read only `request_type`, so canonical requests failed with `payment_request_must_be_cash_or_check` before the `cash_funds` insert could reach the batch execution trigger.

## Inspected baseline

Repository baseline: `8ec701d26fdfe43dd2f0fd3d9c8b8eb23eb31e15`, the merge commit of PR #251 and migration 025.

The repository migration chain defines `create_cash_fund` once, in `00305_cash_rpcs.sql`, with:

- identity arguments: `uuid, uuid, date, text, uuid, text`;
- two defaulted trailing arguments;
- return type `jsonb`;
- PL/pgSQL and `SECURITY DEFINER`;
- row lock on `payment_requests`;
- approved-status, positive-amount, responsible and delivered-by checks;
- one-fund check plus database uniqueness on `cash_funds.payment_request_id`;
- `cash_funds` insert and request operational comment;
- JSON response containing fund, request, amount, due date, method and status.

Migrations 021–023 add the execution gate as the `require_batch_for_cash_fund` trigger. Its current function checks existing execution, extraordinary state, batch enforcement, current Direction approval and closed-batch authorization. Migration 026 does not replace or disable that trigger.

Migration 024 affects fully rejected batch decisions and does not redefine the cash-fund RPC or trigger. Migration 025 creates provider-intake objects only; 026 checks those semantic objects before changing the function.

## Exact behavior change

The effective request method is now resolved in this order:

1. trimmed, lowercased `payment_requests.payment_method`;
2. trimmed, lowercased legacy `payment_requests.request_type` when the canonical value is blank;
3. historical `efectivo`/`cheque` normalize to `cash`/`check`;
4. every other value, including transfer, payroll, unknown, null, or provider_payment without a canonical cash/check method, is rejected.

The caller-supplied delivery method must also be cash/check and must match the resolved request method.

## Security findings and hardening

The inspected legacy body did not call a Finance actor helper. It also originated before the repository moved sensitive RPCs away from the broad function grants introduced by migration 004. Leaving those properties untouched would conflict with the explicit 026 guardrails for a `SECURITY DEFINER` function.

Migration 026 therefore:

- calls `approval_batch_require_finance()`;
- sets `search_path = public, pg_temp`;
- revokes execution from PUBLIC, `anon` and `authenticated`, then grants only `authenticated`;
- verifies the effective ACL after replacement.

The owning database role retains its inherent function privileges. No frontend credential, service-role value or secret is added.

## Preserved controls

- exact function identity and JSON return contract;
- row lock before validation and insertion;
- approved request status;
- positive amount and original company/currency sourcing;
- active responsible and delivered-by profiles;
- duplicate error `cash_fund_already_exists`;
- unique request-to-fund constraint;
- cash/check delivery constraint;
- batch execution trigger and current Direction/closure rules;
- extraordinary, material-change and existing-execution gates enforced by the trigger;
- pending-receipt status and no automatic paid status;
- existing operational comment and response shape.

## QA records

- Cash: `SOL-2026-0073`, MXN 12.12.
- Check: `SOL-2026-0074`, MXN 13.13.
- Batch: `QA-CIERRE-BATCH-012-013-20260713`.
- Batch ID: `4fc82585-a4b6-478d-bcf9-1c0aaeb427d9`.

The migration and manual package do not create a fund. The precheck and immediate postcheck require both QA funds to remain absent.

## Manual DEV procedure

Use only `ops/cash-funds/apply-026-payment-method-gate/`:

1. read-only precheck;
2. read-only evidence snapshot;
3. exact transactional load;
4. immediate read-only postcheck;
5. manual baseline-count comparison;
6. separate authorization for functional retesting.

Do not use `db push`, migration repair, a modified SQL Editor copy, or PROD.

Migration/load SHA-256: `2f6f12ef2abc76d8b1d424891ec0320d9b172c9e710739c89c2cd8d5335e492c`.

## Validation strategy

Local validation covers PostgreSQL parsing, PL/pgSQL block structure, exact byte comparison, SHA-256, function identity, security-definer/search-path settings, ACL intent, required method and approval clauses, batch trigger preservation, idempotency, forbidden destructive statements, hardcoded service-role values and scope isolation.

Database truth remains gated by the manual DEV precheck and postcheck. Local parsing does not prove that DEV has applied the migration.

## Residual risks

- The live function definition or ACL may differ from the repository-derived baseline; the migration aborts if its semantic contract does not match.
- Functional BATCH-012/013 behavior cannot be marked PASS until migration 026 is applied and the authenticated DEV gate is tested before and after closure.
- The UI currently supplies delivery metadata; no real cash/check delivery is authorized by this migration package.
- PR #252 remains separate and Draft until 026, notifications, requester-only coverage and authenticated Preview retests are complete.
