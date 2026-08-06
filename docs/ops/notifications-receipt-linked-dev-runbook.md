# NOTIFICATIONS-RECEIPT-LINKED — DEV runbook

## Scope and immutable baseline

- Baseline: `main@2c5c15ef1419001398b9fb2f36ef874c88703321`.
- Branch: `feature/ramon-notifications-receipt-linked`.
- Trigger: successful, atomic `public.link_payment_receipt_to_request(uuid,uuid,text)`.
- Production is out of scope. The pull request remains Draft.
- No historical backfill or replay is permitted.
- Portal, N1-A, N1-B, PR #147, PR #283, PR #286, and PR #321 are out of scope.

## Contract defects corrected before publication

| File | Function/block | Expected contract | Defective scratch behavior | Correction | Proof |
|---|---|---|---|---|---|
| migration scratch | requester-only insert | Compile and reuse the existing event ID on conflict | Referenced undefined `v_existing_event_key` | Replaced duplicated branches with one grouped recipient loop and a declared `v_event_id` | Node contract test plus PostgreSQL parser |
| migration scratch | no-recipient branch | Zero `notification_events`; audit only in append-only financial outbox | Inserted a `dead_letter` notification with a fictitious audience | Emits no ledger row when no address is eligible; writes sanitized `notification_resolution` into `financial_outbox_events.payload` | `no-recipient is audited...` test and DEV UAT |
| migration scratch | financial RPC grants | Preserve authenticated PostgREST execution and deny anon | Revoked the established authenticated grant and granted only service roles | `CREATE OR REPLACE` preserves the existing ACL; postcheck requires authenticated EXECUTE and denies anon | Financial RPC static comparison and migration postcheck |
| migration scratch | financial outbox | Record requester/provider eligibility without full email | Resolution existed only in notification payload and disappeared when no recipient existed | Adds only the sanitized resolution object to the existing `payment_receipt.linked` outbox payload | Static no-recipient test and DEV outbox query |
| migration scratch | source identity | Bind each email and attachment to the exact 1:1 receipt link | Used `payment_requests` as source and later selected a link by request | Uses `source_table=payment_request_receipt_links` and `source_id=receipt_link_id`; resolver follows that exact chain | Attachment resolver static test and DEV UAT |
| migration scratch | external folio | Prefer `payment_intake.public_folio`, otherwise `payment_requests.request_number`; never expose UUID | Fell back to `payment_requests.id::text` | Uses the two canonical readable folios only; missing folio blocks only notification production and is audited | Static source scan and DEV UAT |
| migration scratch | attachment resolver | Fail closed on bucket, path, MIME, page count, size, and SHA-256 | Coalesced missing MIME/hash/size to apparently valid values | Requires exact private bucket/path, `application/pdf`, one page, attestation, bounded nonzero size, and 64-character SHA-256 | Metadata rejection tests and DEV hash comparison |
| migration scratch | attachment chain | Verify event, link, request, operation, and evidence are the same resource | Trusted request source and selected the latest link | Verifies every ID and company relationship from the exact notification source link | Resolver static test and foreign-evidence DEV case |
| migration scratch | claim v2 | Explicit allowlist and explicit cutoff; no historical backlog | Defaulted to a broad list and silently substituted `now()` | Rejects empty event types, missing cutoff, and unsupported event types; retains `FOR UPDATE SKIP LOCKED` and max attempts | Claim static test and DEV cutoff UAT |
| migration scratch | migration safety | Atomic DDL, dependency precheck, ACL/contract postcheck | Had no migration transaction, precheck, or postcheck | Adds one `BEGIN`/`COMMIT`, dependency precheck, recipient/grant/function postchecks | PostgreSQL parser and static transaction test |
| DEV preflight | recipient constraint drift | Add `proveedor` without changing the paused Portal audience | DEV already allowed `external_provider`, while `main` did not | Rebuilds the constraint conditionally: preserves `external_provider` only where already present and never introduces it where absent | DEV pre/post constraint comparison and migration postcheck |
| dispatcher scratch | receipt contract | Render requester/provider templates and attach the individual PDF | Had no `payment_receipt.linked` template or attachment path | Adds audience-specific templates, service-only resolver call, private download, memory-only Base64 attachment | Template and end-to-end mocked dispatcher tests |
| dispatcher scratch | attachment integrity | Validate actual bytes before Resend | Did not check Storage response, PDF signature, byte count, MIME, or SHA-256 | Validates all metadata, `%PDF-`, response size, MIME, and computed SHA-256 before send | Correct-hash and wrong-hash tests |
| dispatcher scratch | delivery idempotency | A timeout or mark failure must not duplicate email | Resend request had no idempotency key | Sends stable `Idempotency-Key: notification/{event_id}` | Dispatcher idempotency test |
| dispatcher scratch | UAT isolation | Claim only explicit post-cutoff events | Called legacy unbounded claim RPC | Calls claim v2 with explicit event types and cutoff supplied by authenticated request or environment | Test-only claim payload assertion |
| dispatcher scratch | server-to-server surface | No browser CORS exposure without a demonstrated browser consumer | Returned wildcard CORS | Removed CORS and kept secret-authenticated POST only | Method/secret/CORS tests |

## Static validation

Run against a clean checkout of the published branch:

```text
node --test scripts/qa/notifications-receipt-linked-contract.test.mjs
```

In addition:

1. Parse the published migration with a PostgreSQL grammar parser.
2. Compare the financial RPC in the new migration with migration 033 after removing only the declared notification delta.
3. Confirm the PR changes only the migration, dispatcher, contract test, and this runbook.
4. Confirm no changed path belongs to Portal, workflows, Comprobantes UI, Solicitudes UI, Cortes, Permisos, or extraordinary 01C.

## Controlled DEV gate

### Preconditions

- Draft PR static checks pass with P0=0 and P1=0.
- DEV project ref is explicitly identified; PROD ref is not used.
- Migration version is absent from DEV migration history.
- `NOTIFICATION_SEND_MODE=test_only`.
- Existing `NOTIFICATION_TEST_EMAIL`, dispatcher secret, service key, Resend key, and sender are present; values are never printed.
- UAT cutoff is recorded immediately before fixture creation.

### One-shot execution

1. Apply `20260806023116_notifications_receipt_linked` once in DEV.
2. Run migration postchecks and security/performance advisors.
3. Deploy only `notification-dispatcher` to DEV with JWT verification unchanged from the deployed internal dispatcher contract.
4. Invoke with an authenticated secret and body containing:
   - `event_types: ["payment_receipt.linked"]`
   - `created_at_from: <recorded QA cutoff>`
   - a limit no greater than 5.
5. Verify every Resend request is redirected to `NOTIFICATION_TEST_EMAIL`.

### UAT matrix

- Valid requester plus distinct valid provider: two events, two test deliveries.
- Same normalized email: one event with both recipient roles.
- Requester only: one event and provider `missing`/`invalid` in financial outbox.
- Provider only: one event and requester `missing`/`invalid` in financial outbox.
- No eligible recipient: zero notification events and zero delivery attempts; financial link remains paid and outbox is audited.
- Replay with the same financial idempotency key: same financial result, no new link/outbox/notification/delivery.
- Correct one-page PDF: one memory-only attachment; response hash equals evidence hash.
- Wrong hash, MIME, size, page count, non-shareable, or foreign evidence: no Resend request; failed attempt follows existing retry policy.
- Historical event before cutoff: never claimed.

## Evidence and stop conditions

Capture only remote URLs/SHAs, project ref, migration version, Edge Function version, masked intended/final emails, counts, and SHA-256. Never capture secrets, Base64, private Storage paths, full addresses, bank data, or PDF contents.

Stop without touching PROD if migration history drifts, the function cannot remain `test_only`, any historical event is claimed, the full batch PDF is requested, a real recipient is selected, or an out-of-scope path changes.

## Release flags

```text
PORTAL_DELTA=0
PR147_DELTA=0
PR283_DELTA=0
PR286_DELTA=0
PR321_DELTA=0
PROD_MUTATIONS=0
READY=0
MERGE=0
```
