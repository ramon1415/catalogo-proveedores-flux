# Approval Batch Quick Approval — DEV

## Scope

This gate adds a second CTA only to `approval_batch.submitted` when
`APPROVAL_BATCH_QUICK_APPROVE_ENABLED=true`. The default and final DEV state is `false`.
With the flag off, the current single-CTA email remains byte-for-byte at the renderer level.

Quick Approval only approves every active pending item. Rejection, partial decisions, edits,
motives, item changes and payment release remain in Flux.

## Security contract

- URL: `approval_batch_quick_approve.html#token=<signed-token>`; never `?token=`.
- Token: `base64url(payload).base64url(HMAC-SHA256(payload))`.
- Claims: version, notification event, batch, Director, submitted timestamp, snapshot hash,
  expiry and deterministic event-bound JTI.
- Default TTL: 72 hours from `notification_events.created_at`; configurable from 1 hour up
  to 7 days.
- The page removes the fragment with `history.replaceState` and keeps the token only in
  memory. It uses no cookies, analytics, SDK, anon key, localStorage or sessionStorage.
- GET is always 405. OPTIONS is 204. Preview and approve are POST actions; only approve can
  call the mutation RPC.
- The Edge Function accepts browser CORS only from the exact DEV Vercel origin.
- HMAC is verified in the Edge Function. The database then independently rebinds every
  signed claim to the event, batch, active Direction profile, current snapshot and expiry.

## Database contract

Migration `20260826201712_approval_batch_quick_approve_dev.sql` creates the forced-RLS,
service-only one-time ledger and service-only RPCs. Raw tokens are never persisted.

`approve_entire_batch(uuid)` keeps its signature, authenticated grant, actor checks, errors,
output and business behavior. It now calls `approve_entire_batch_internal(uuid, uuid)`, the
same core called after Quick Approval validation.

Quick Approval locks the event, batch, active items and their payment requests in one RPC
transaction. It requires a submitted batch with at least one active item and every active item
pending. The core changes the batch to `approved`; it never calls `close_approval_batch`.

The existing status trigger remains the only producer of `approval_batch.approved`, addressed
to `approval_batches.submitted_by`.

## Runtime configuration

- `APPROVAL_BATCH_QUICK_APPROVE_ENABLED=false` (final gate state)
- `APPROVAL_BATCH_QUICK_APPROVE_SECRET` (at least 32 characters; never log or commit)
- `APPROVAL_BATCH_QUICK_APPROVE_TTL_HOURS=72` (optional; maximum 168)

The secret can be supplied as an Edge secret. DEV also supports the service-only Vault entry
with the same name so both functions can retrieve it without exposing it to the page. Any
configuration or signing failure silently falls back to the current email and cannot fail
delivery.

## Deployment boundary

Deploy only:

1. `approval-batch-quick-approve` with `verify_jwt=false` because its custom HMAC contract is
   enforced before any RPC;
2. `approval-batch-submitted-dispatcher` with its existing auth and delivery contract.

Do not deploy `notification-dispatcher`, `provider-intake` or any payroll function. Do not
invoke UAT automatically. Keep the feature flag off and the PR in Draft after certification.
