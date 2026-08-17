# PAYMENT-REQUEST-APPROVER-EMAIL-C1 — DEV

## Closed scope

- Event: `payment_request.created` only.
- Recipient: the immutable request snapshot `payment_requests.approver_id → profiles.email`.
- Maximum delivery: one email for one new request event.
- Backfill: 0.
- Historical replay: 0.
- Reminders: 0.
- Existing pending reprocessing: 0.
- Eligibility: `notification_events.created_at > activation_cutoff`.
- The boundary is exclusive. An event at the cutoff is ineligible.
- DEV send mode: `test_only`.
- PROD and `main`: out of scope.

## Architecture

1. The canonical payment-request RPC inserts `payment_requests`.
2. The existing AFTER INSERT producer creates one idempotent `payment_request.created` event for the selected approver snapshot.
3. The new event-specific wake-up queues `notification-dispatcher` through `pg_net`; network execution begins only after COMMIT.
4. The dispatcher routes `payment_request.created` to an event-specific claim RPC.
5. The claim RPC accepts no event-type parameter and uses the strict predicate `created_at > p_created_at_after`.
6. A recovery invocation uses the same fixed cutoff and the same event-only contract.
7. Resend idempotency remains `notification/{event_id}`.

## Isolation

The following `payment_receipt.linked` contracts are unchanged:

- claim v2;
- fixed receipt cutoff;
- immediate wake-up function and trigger;
- recovery scheduler block;
- receipt renderer;
- attachment resolver and hash validation.

No other `payment_request.*` event is enabled by this slice.

## Email

- Subject: `Nueva solicitud de pago: {folio}` (with `[DEV TEST]` in test-only mode).
- Heading: `Nueva solicitud por revisar`.
- CTA: `Revisar solicitud`.
- Destination: `https://flux.quantta.mx/aprobaciones.html`.
- Attachments: 0.
- No requester fallback, approver-pool broadcast, or secondary recipient.
- Text and HTML are both rendered.

## DEV activation

The exact activation cutoff will be captured from the DEV database clock immediately before enabling the wake-up. It will then be written once to the event-specific Vault contract and to the recovery workflow. It must not be reused from another notification lane.

The DEV UAT must prove:

- one canonical synthetic payment request;
- one `payment_request.created` event;
- one test-only delivery attempt;
- one Resend provider message ID;
- zero real recipients;
- zero delivery-attempt delta for events at or before the cutoff;
- zero duplicate event, attempt, or send on recovery;
- `payment_receipt.linked` regression PASS.

## Rollback

1. Set only `notification_payment_request_created_immediate_enabled` to `false`.
2. Stop only the created-event recovery invocation.
3. Preserve payment requests, notification events, and delivery attempts.
4. Do not delete or replay history.
5. Redeploy the prior dispatcher if renderer/dispatch behavior must be rolled back.
6. Forward-fix database functions; do not alter receipt-linked primitives.
