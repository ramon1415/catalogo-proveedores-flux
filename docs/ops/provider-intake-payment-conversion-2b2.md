# Provider intake payment conversion 2B.2

## Product boundary

`convert_provider_intake_to_payment_request` converts one `READY_FOR_CONVERSION` intake into exactly one normal Flux `payment_request`. It reuses `create_payment_request`; therefore request numbering, budget validation, approver routing and the initial `submitted` state remain authoritative in the existing product flow.

The operation does not approve a request, create a batch or layout, execute a payment, mutate the provider master, or call an external notification service.

## Atomic contract

The RPC locks `payment_intake` first and its conversion draft second. Under those locks it revalidates the draft, provider, requester, company catalogs, amount and approver option. Request creation, operational-field completion, intake linkage, status transition and the append-only `converted` event execute in one transaction.

`payment_intake_created_request_uidx` and the locked intake row enforce the one-to-one link. A replay or a concurrent loser returns the already-linked request with `idempotent=true` and creates nothing.

## Migration

- Active file: `supabase/migrations/20260811214145_044_provider_intake_payment_conversion.sql`
- Target: Supabase DEV `scsirgbuqjcwoaxfacth`
- Required predecessor: `20260811035346_043_provider_intake_payment_draft`
- Application: official Supabase migration mechanism only; never run the body as an ad-hoc product query.

The migration creates only the conversion RPC, its grant and comments. It does not add a table, rewrite history, or change a historical migration.

## Postcheck

After application verify:

1. migration history includes `20260811214145_044_provider_intake_payment_conversion` once;
2. the RPC is `SECURITY DEFINER`, `VOLATILE`, has `search_path=public, pg_temp`, and is executable only by `authenticated`;
3. the append-only intake-event trigger and `payment_intake_created_request_uidx` remain active;
4. the target intake is still unconverted before UAT;
5. schema changes are limited to the new function, ACL and comment.

## UAT evidence

Capture the target intake, draft version, provider-master fingerprint, payment-request count, batch/layout/execution counts, notification-delivery attempts and migration head before conversion.

For the controlled concurrency test, issue two authenticated calls with the same expected intake timestamp and draft version. Exactly one result may report `created=true`; both must reference the same request ID. A subsequent replay must return that same ID with `idempotent=true` and leave the payment-request count unchanged.

Validate the created request has the draft's company, provider, requester, amount, currency, cost center, category, month, payment method, scheduled date and approver routing. Its status must be `submitted`; no batch, layout, receipt, payment execution or external delivery attempt may be created.

## Rollback boundary

Before any intake has been converted, rollback is limited to revoking and dropping the new RPC. After a conversion, do not delete or unlink product records mechanically: stop and use a separately authorized product correction because request, budget and audit records are material business state.
