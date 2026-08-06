# NOTIFICATIONS-RECEIPT-LINKED — DEV evidence and PROD release package

## Scope and immutable baseline

- Current production baseline: `main@ecfe0b6a69661ccc14931ab0851b93d8099a4ed9`.
- Branch reconciliation merge: `285e6481b706fa9b27fff419206f89604826aa59`.
- Branch: `feature/ramon-notifications-receipt-linked`.
- Trigger: successful, atomic `public.link_payment_receipt_to_request(uuid,uuid,text)`.
- Production execution is out of scope for this packaging gate. The pull request remains Draft; no workflow in this package has been run.
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
| `20260806023116_notifications_receipt_linked.sql` | `claim_notification_events_for_dispatcher_v2` event-type normalization | Resolve the `unnest` alias independently from the `RETURNS TABLE` output variable | The unqualified `event_type` in `array_agg` was ambiguous at runtime, so PostgreSQL aborted before claiming any event | Follow-up migration `20260806030202_notifications_receipt_linked_claim_v2_fix.sql` qualifies every normalization reference as `requested.event_type` without changing allowlist, cutoff, locks, retry policy, return shape, or ACL | PostgreSQL parser, dedicated static regression, and rolled-back DEV UAT proving the original native failure and corrected claim |
| migration scratch | migration safety | Atomic DDL, dependency precheck, ACL/contract postcheck | Had no migration transaction, precheck, or postcheck | Adds one `BEGIN`/`COMMIT`, dependency precheck, recipient/grant/function postchecks | PostgreSQL parser and static transaction test |
| DEV preflight | recipient constraint drift | Add `proveedor` without changing the paused Portal audience | DEV already allowed `external_provider`, while `main` did not | Rebuilds the constraint conditionally: preserves `external_provider` only where already present and never introduces it where absent | DEV pre/post constraint comparison and migration postcheck |
| dispatcher scratch | receipt contract | Render requester/provider templates and attach the individual PDF | Had no `payment_receipt.linked` template or attachment path | Adds audience-specific templates, service-only resolver call, private download, memory-only Base64 attachment | Template and end-to-end mocked dispatcher tests |
| dispatcher scratch | attachment integrity | Validate actual bytes before Resend | Did not check Storage response, PDF signature, byte count, MIME, or SHA-256 | Validates all metadata, `%PDF-`, response size, MIME, and computed SHA-256 before send | Correct-hash and wrong-hash tests |
| dispatcher scratch | delivery idempotency | A timeout or mark failure must not duplicate email | Resend request had no idempotency key | Sends stable `Idempotency-Key: notification/{event_id}` | Dispatcher idempotency test |
| dispatcher scratch | UAT isolation | Claim only explicit post-cutoff events | Called legacy unbounded claim RPC | Calls claim v2 with explicit event types and cutoff supplied by authenticated request or environment | Test-only claim payload assertion |
| dispatcher scratch | server-to-server surface | No browser CORS exposure without a demonstrated browser consumer | Returned wildcard CORS | Removed CORS and kept secret-authenticated POST only | Method/secret/CORS tests |
| release package | normal dispatch latency | Begin dispatch in seconds after the financial COMMIT without coupling payment to HTTP or Resend | Only the five-minute scheduler could wake the dispatcher | Adds an `AFTER INSERT` trigger on pending `payment_receipt.linked` events; `pg_net` queues the authenticated HTTP request and starts it only after COMMIT | Migration contract test plus controlled DEV primary-path UAT |
| release package | wake-up credential handling | Keep server-to-server credentials out of SQL, ledgers, payloads, logs, and browsers | No database-side credential contract existed | Reads URL, fixed cutoff, enable flag, and dispatcher credential from Supabase Vault; values are provisioned by the protected workflow and never committed | Static secret scan, Vault name postcheck, and DEV request metadata reconciliation |
| release package | wake-up failure isolation | A wake-up failure must not roll back payment or delete the pending event | No primary wake-up existed | The trigger catches enqueue/config errors and returns the inserted ledger row; the five-minute worker remains the recovery fallback | Failure-path static test and controlled DEV fallback UAT |
| release package | primary/fallback race | Concurrent workers must send each event at most once | The race had not been exercised for this release path | Retains claim v2 `FOR UPDATE SKIP LOCKED`, processing status, delivery tracking, and `Idempotency-Key: notification/{event_id}` | Concurrent mocked dispatcher test and controlled DEV race UAT |

## Static validation

Run against a clean checkout of the published branch:

```text
node --test scripts/qa/notifications-receipt-linked-contract.test.mjs
```

In addition:

1. Parse all three published migrations with a PostgreSQL grammar parser.
2. Compare the financial RPC in the new migration with migration 033 after removing only the declared notification delta.
3. Confirm the PR changes only the three allowlisted migrations, dispatcher, contract test, this runbook, the dedicated protected Phase A workflow, and the permanent scheduler.
4. Confirm no changed path belongs to Portal, Comprobantes UI, Solicitudes UI, Cortes, Permisos, extraordinary 01C, or any historical workflow.
5. Parse both new workflow files as YAML and verify their immutable project, cutoff, allowlist, environment, permissions, concurrency, and branch guards.

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
2. Apply `20260806030202_notifications_receipt_linked_claim_v2_fix` once in DEV; this is required because the first DEV UAT exposed an ambiguous PL/pgSQL identifier before any event was claimed.
3. Store the DEV dispatcher URL, dispatcher secret, fixed UAT cutoff, and disabled wake-up flag under their four canonical Supabase Vault names without printing values.
4. Apply `20260806212757_notifications_receipt_linked_immediate_dispatch` once in DEV and verify `pg_net`, the filtered trigger, its revoked ACL, and Vault access.
5. Run migration postchecks and security/performance advisors.
6. Deploy only `notification-dispatcher` to DEV with JWT verification unchanged from the deployed internal dispatcher contract.
7. Invoke with an authenticated secret and body containing:
   - `event_types: ["payment_receipt.linked"]`
   - `created_at_from: <recorded QA cutoff>`
   - a limit no greater than 5.
8. Verify every Resend request is redirected to `NOTIFICATION_TEST_EMAIL`.

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
- Primary path: enable the Vault kill switch, create a valid receipt-linked event through the committed financial flow, do not invoke the scheduler, and measure COMMIT/event/dispatch/Resend-accepted timestamps.
- Primary failure/fallback: disable or invalidate only the wake-up in a controlled way, prove the financial link and pending event remain committed, then run the recovery worker once and send one test-only email.
- Race: start primary and fallback against one eligible event; combined logical sends remain at most one.
- Wake-up idempotency: repeat the authenticated wake-up and produce zero additional emails for an already processed event.

## Evidence and stop conditions

Capture only remote URLs/SHAs, project ref, migration version, Edge Function version, masked intended/final emails, counts, and SHA-256. Never capture secrets, Base64, private Storage paths, full addresses, bank data, or PDF contents.

Stop without touching PROD if migration history drifts, the function cannot remain `test_only`, any historical event is claimed, the full batch PDF is requested, a real recipient is selected, or an out-of-scope path changes.

## PROD release package (defined, not executed)

### Immutable identity and zero-replay boundary

- PROD project ref: `ucantptjhwttexzmslvm`.
- Current `main`: `ecfe0b6a69661ccc14931ab0851b93d8099a4ed9`.
- Fixed initial cutoff: `2026-08-06T20:11:17.823134Z`.
- Initial event allowlist: only `payment_receipt.linked`.
- Dispatch limit: 5.
- Preflight baseline: zero `payment_receipt.linked` rows, zero `notification_delivery_attempts`, and receipt-linked producer, attachment resolver, and claim v2 absent.
- The cutoff is immutable for the initial release. Do not substitute deployment time, `now()`, or a scheduler-run timestamp.
- No historical backfill or replay is allowed.

### Exact release scope

Only these eight paths may differ from current `main`:

1. `supabase/migrations/20260806023116_notifications_receipt_linked.sql`
2. `supabase/migrations/20260806030202_notifications_receipt_linked_claim_v2_fix.sql`
3. `supabase/migrations/20260806212757_notifications_receipt_linked_immediate_dispatch.sql`
4. `supabase/functions/notification-dispatcher/index.ts`
5. `scripts/qa/notifications-receipt-linked-contract.test.mjs`
6. `docs/ops/notifications-receipt-linked-dev-runbook.md`
7. `.github/workflows/supabase-prod-notifications-receipt-linked-release.yml`
8. `.github/workflows/supabase-prod-notification-dispatcher.yml`

The migration allowlist is exactly three versions, in this order: primary `20260806023116`, corrective `20260806030202`, then immediate dispatch `20260806212757`. No generic PROD release workflow, Portal path, frontend path, or unrelated migration is part of this package.

### PROD secret and variable contract

Required GitHub Environment: `supabase-production`.

Presence is required; values must never be printed:

- Secret `SUPABASE_ACCESS_TOKEN`.
- Secret `SUPABASE_PROD_SESSION_POOLER_DB_URL`.
- Secret `NOTIFICATION_DISPATCHER_SECRET`.
- Existing Supabase runtime secret `RESEND_API_KEY`.
- Existing Supabase runtime secret `NOTIFICATION_FROM_EMAIL`.
- Variable `SUPABASE_PROJECT_REF_PROD`, exactly `ucantptjhwttexzmslvm`.
- Variable `NOTIFICATION_PROD_SCHEDULER_ENABLED`; it must be absent or `false` throughout Phase A.

Phase A writes only these static runtime values during a separately authorized future execution:

```text
NOTIFICATION_SEND_MODE=disabled
NOTIFICATION_EVENT_TYPES=payment_receipt.linked
NOTIFICATION_CUTOFF_AT=2026-08-06T20:11:17.823134Z
NOTIFICATION_WORKER_ID=edge-notification-dispatcher-prod
```

It also provisions four named values in Supabase Vault: `notification_dispatcher_url`, `notification_dispatcher_secret`, `notification_dispatcher_cutoff_at`, and `notification_receipt_linked_immediate_enabled`. Phase A forces the final value to `false`; the secret value is never printed or stored in Git.

### Phase A — disabled first deploy

The protected manual workflow is `supabase-prod-notifications-receipt-linked-release.yml`. It is `workflow_dispatch` only, requires the exact approved `main` SHA and explicit PROD/phase/cutoff confirmations, runs in `supabase-production`, and refuses to run if the permanent scheduler is enabled.

A future, separately authorized Phase A run must:

1. prove current `main`, exact source blobs, PROD identity, backup/PITR availability, and the exact three-migration allowlist;
2. re-run the read-only zero-state and prerequisite precheck;
3. force `NOTIFICATION_SEND_MODE=disabled`;
4. deploy only `notification-dispatcher`;
5. provision the four encrypted Vault values with the immediate wake-up disabled;
6. apply exactly the primary migration, corrective migration, and immediate-dispatch migration in order;
7. verify all three migration-history rows, functions, trigger, pg_net, ACLs, disabled wake-up, zero receipt events, and zero delivery attempts;
8. perform an unauthenticated 401 smoke and an authenticated disabled smoke returning `processed=0`, `sent=0`, `failed=0`;
9. stop with immediate wake-up disabled, the scheduler disabled, zero Resend calls, and zero emails.

No Phase A execution is authorized by this packaging gate.

### Phase B — real mode and permanent automatic dispatch

Phase B is a distinct, later authorization. It must never be combined with Phase A.

The primary path is the `notification_receipt_linked_immediate_dispatch_after_insert` trigger. It fires only for a newly inserted pending `payment_receipt.linked` ledger row. `pg_net` does not start HTTP until the surrounding transaction commits, authenticates to the unchanged dispatcher with the Vault-held dispatcher secret, and sends the same fixed-cutoff, receipt-only, bounded claim request. The trigger never calls Resend and never sends by event ID.

The permanent workflow is `supabase-prod-notification-dispatcher.yml`. Its explicit role is `ROLE=RECOVERY_FALLBACK`. Its schedule is `3-58/5 * * * *`, providing one invocation every five minutes. It runs only from `main`, is serialized with `cancel-in-progress: false`, uses the `supabase-production` Environment, and requires `NOTIFICATION_PROD_SCHEDULER_ENABLED=true`.

Every invocation is exactly:

```json
{"event_types":["payment_receipt.linked"],"created_at_from":"2026-08-06T20:11:17.823134Z","limit":5}
```

The workflow performs a single authenticated invocation and has no blind retry. Runtime queue idempotency, locks, retry policy, and the provider idempotency key remain authoritative. Enabling real mode and the scheduler requires a separate Ramón execution authorization after Phase A evidence is approved.

### Minimal PROD smoke plan

Phase A smoke:

- unauthenticated request returns 401;
- authenticated request in disabled mode returns 200;
- `processed=0`;
- `sent=0`;
- `failed=0`;
- ledger and attempts remain zero;
- Resend calls and emails remain zero.

Phase B smoke, only after separate authorization:

1. capture a fresh observation timestamp while retaining the fixed release cutoff;
2. create one normal post-commit `payment_receipt.linked` event through the financial workflow—never from upload, extraction, candidate display, or selection;
3. allow the post-commit wake-up to invoke the dispatcher without manually running the scheduler;
4. reconcile one expected event/attempt/provider ID, its one-page individual PDF, and the COMMIT-to-dispatch latency;
5. prove that no earlier event was claimed and that the batch PDF was never fetched or sent;
6. stop the rollout immediately if any count, recipient, attachment, or cutoff invariant differs.

### Rollback and forward-fix

Operational stop/containment is:

1. set `NOTIFICATION_PROD_SCHEDULER_ENABLED=false`;
2. set the Vault value `notification_receipt_linked_immediate_enabled=false`;
3. set `NOTIFICATION_SEND_MODE=disabled`;
4. confirm neither primary nor fallback can dispatch and perform only read-only reconciliation;
5. preserve all financial and notification evidence.

Data rollback is prohibited:

- No revertir pagos ni receipt links.
- No borrar notification_events.
- No borrar delivery_attempts.
- No hacer replay.
- Do not remove append-only financial outbox rows.

Database corrections use **Forward-fix** migrations only. Function rollback, if required and separately authorized, redeploys a previously certified dispatcher while send mode remains disabled. Never roll back the financial commit because notification delivery failed.

### PROD execution stop conditions

Stop before or during an authorized release if `main` or any certified blob drifts; either migration is already present unexpectedly; initial ledger counts are nonzero; backup/PITR cannot be proven; a required secret name is absent; the project ref differs; the scheduler is enabled during Phase A; disabled smoke claims work; or any Portal/frontend/unrelated path appears in scope.

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
