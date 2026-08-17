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

The immutable DEV activation cutoff is `2026-08-17T21:20:56.735024Z`, captured from the DEV database clock immediately before enabling the wake-up. The event-specific Vault contract and recovery workflow must use this exact value. It is not shared with any other notification lane.

## DEV certification

PASS was recorded in [run 32071060527](https://github.com/ramon1415/catalogo-proveedores-flux/actions/runs/32071060527) against candidate `e6fc568a503e76f215dae8064344363d55180de3`.

- Synthetic request: `SOL-2026-0112`, created through the canonical insert path, status `submitted`.
- Producer: the existing AFTER INSERT trigger emitted exactly one `payment_request.created` event.
- Recipient resolver: event profile and email both equal the request's selected approver snapshot.
- Primary post-COMMIT wake-up: PASS; the event reached `sent` without a manual recovery dispatch.
- Delivery: one event, one delivery attempt, one provider message ID, `test_only`.
- Real recipients: 0.
- Exclusive boundary: the event is strictly after `2026-08-17T21:20:56.735024Z`; a transactional boundary test proved an event exactly at the cutoff is not claimable.
- Historical guard: 54 old pending events remained ineligible; delivery attempts for events at or before the cutoff remained 97 before and after.
- Historical state fingerprint remained `88d98389de9394766cf066d7023dc092`.
- Recovery invocation after the successful primary send returned `processed=0`, `sent=0`, `failed=0`.
- Duplicate events, attempts, and sends: 0.
- Other post-cutoff `payment_request.created` events: 0.
- Migration `20260817211825_payment_request_approver_email_c1.sql`: one DEV history row.
- Dispatcher: DEV active version 39. Secret reprovisioning advanced the runtime revision, while the active entrypoint remains source deployment 35; byte-for-byte comparison (BOM/line-ending normalized) equals candidate blob `b4bcf88a109f38eca5c44dfe217750a5bd3f0d82`.
- `payment_receipt.linked` regression: PASS. Claim, wake-up, and trigger hashes stayed `694e143204841f79e0724ad234ac79d5`, `dda802d2b5d6a204fd5010c7a5fb8b0a`, and `05e5649de2b2e44120f938e1999d89d6`.
- Temporary UAT workflow removed after certification; net workflow delta: 0.

The event-specific DEV Vault activation remains enabled with the fixed cutoff above, and DEV remains `test_only`. No PROD or `main` mutation occurred.

## Rollback

1. Set only `notification_payment_request_created_immediate_enabled` to `false`.
2. Stop only the created-event recovery invocation.
3. Preserve payment requests, notification events, and delivery attempts.
4. Do not delete or replay history.
5. Redeploy the prior dispatcher if renderer/dispatch behavior must be rolled back.
6. Forward-fix database functions; do not alter receipt-linked primitives.
