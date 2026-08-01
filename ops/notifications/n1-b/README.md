# Notifications N1-B — hardened disabled external intake runtime candidate

Status: hardened candidate only. This directory documents `NOTIFICATIONS-N1-B-R1`; it does not authorize applying SQL, running a live dry-run, deploying an Edge Function, changing secrets, invoking a dispatcher or sending email.

## Certified baseline

- `dev`: `8aab86b85255957b899556327b0f93eb2c093df0`
- `main`: `85ec304ba45b9e0531e2cbd1437ba620c7e2ea24`
- PR #282: merged
- PR #284: merged
- PR #285: merged
- N1-A certification: run `30677188504`, attempt 1, `55/55 PASS`
- N1-A artifact: `8810896652`
- N1-A artifact digest: `sha256:2d5c9c09a64e72b15ed9359132160f2db90780959cffa0f988a072bda0b06f32`
- Migration 041: applied once and unchanged
- N1-A object contract: 38 objects
- external events: 0
- external producers: 0 before this candidate
- rollout: `disabled`
- cutoff: `NULL`
- enabled events: 0
- recipient allowlist: 0
- daily cap: 0
- Resend calls in this gate: 0
- emails in this gate: 0

Migration `042_notifications_n1_b_external_runtime.sql` is the next number that is actually free across `dev` and open PRs. Open PR #283 already introduces a different `041`, so this candidate does not reuse that number.

## Surface inventory

Provider intake uses the existing handler, repository, types and unit-test files. Uploads create the intake, write private Storage objects and then call `finalize_provider_intake_submission_v1`. The repository classifies finalization as confirmed completed, confirmed rejected or outcome unknown. Cleanup is permitted only after a confirmed rejection; an unknown result is retried once with identical material and never deletes Storage or marks an upload issue automatically. CAPTCHA, CORS, validation and file-limit sources are unchanged.

The real triage client is `provider_intakes.html` plus `provider_intakes.js`. It is the only application caller of `transition_provider_intake` in scope. A read-only capability RPC makes the UI fail closed across deployment order: before Migration 042 it retains the legacy internal behavior and hides external fields; after the capability is visible it routes correction/rejection through `transition_provider_intake_external_v1`. External copy is never copied into internal notes as a fallback.

Migration 041 already provides the external lane, payload and idempotency validators, rollout table, external claim, recovery isolation, delivery-attempt columns, RLS and grants. The internal dispatcher source is byte-identical to the baseline and continues to claim only `audience='internal'`.

The new dispatcher is independent and lives in `supabase/functions/notification-dispatcher-external`. n8n remains retired.

## Architecture

The internal lane remains:

`notification_events (internal) → internal claim → notification-dispatcher`

The candidate external lane is:

`payment_intake_events → explicit producer → notification_events (external) → external claim → notification-dispatcher-external → Resend`

There is no automatic producer trigger. Received is produced only by an atomic submission-completion RPC. Correction and rejection are produced only by the authenticated versioned triage RPC.

## Zero backlog

The producer inserts an external ledger row only when all of these are true at fact time:

1. rollout `provider-intake-v1` exists;
2. mode is `test_only` or `pilot`;
3. cutoff is non-null;
4. source and notification timestamps are at or after cutoff;
5. the event type is enabled;
6. `notification_external_event_mode_allowed` accepts the event and mode;
7. the normalized recipient hash is allowlisted;
8. payload and idempotency validators pass.
9. `batch_size=1`;
10. `daily_cap>0` and the current Mexico City day still has capacity.

The producer locks the single `provider-intake-v1` rollout row with `FOR UPDATE` and holds that lock through the decision and insert. The claim uses the same rollout row, so producer/producer and producer/claim activity is serialized. The producer counts every pending row plus processing/sent consumption for the current Mexico City day, so historical pending work blocks new enqueue instead of creating next-day backlog. Cap exhaustion returns `daily_cap_reached` and creates neither event nor attempt. If any gate is closed, the domain fact may exist but no pending external row or attempt is created. The migration contains no scan, backfill, replay, top-level producer call, active rollout, cutoff, event enablement or recipient hash.

Correction remains `test_only`-only because Migration 041 prohibits it in pilot until N2. A second correction returns `manual_follow_up_required` and creates no second notification.

## Producers and business idempotency

Supported events and exact keys are:

- `provider_intake.received`: `external:provider_intake.received:{payment_intake_id}:v1`
- `provider_intake.correction_requested`: `external:provider_intake.correction_requested:{payment_intake_id}:v1`
- `provider_intake.rejected`: `external:provider_intake.rejected:{payment_intake_id}:v1`

`payment_intake_id` is the business subject; the append-only domain-event ID is only `source_id`. Template changes and retries cannot create a new business event.

The only recipient source is `lower(trim(payment_intake.provider_email))`. `proveedores.email` is never queried and email is never included in the payload. A missing or invalid recipient returns `no_recipient` without creating an external ledger row or attempt.

## Atomic submission completion

`finalize_provider_intake_submission_v1` is service-only and performs in one transaction:

- intake lock and received-state validation;
- closed metadata validation;
- private Storage-object existence checks;
- exact expected and actual file counts;
- upload-issue exclusion;
- file metadata and append-only `file_uploaded` facts;
- `expected_file_count` and `submission_completed_at` update;
- one `submission_completed` fact;
- conditional received producer call.

A confirmed rejected RPC rolls back file metadata, completion and any notification row, after which the Edge cleanup path may remove the uploaded objects. A transport failure or lost response is `RPC_OUTCOME_UNKNOWN`: the handler retries the same RPC once with the same intake, count and metadata. Exact repetition returns `already_completed` only when file IDs, paths, names, MIME types, sizes, kinds, hashes, Storage objects and the single completion fact all match. Two unknown outcomes preserve Storage and return the generic safe failure `submission_outcome_unknown` for operational reconciliation.

Duplicate intake creation is followed by the service-only `provider_intake_submission_state_v1`. A complete duplicate returns its canonical current intake status. An incomplete or inconsistent duplicate never returns a false `received` success and instead fails safely for reconciliation.

## Triage contract

The UI separates:

- optional internal notes, visible only to Flux;
- mandatory 10–1000 character plain-text external message;
- canonical correction field-code checkboxes.

The external message rejects HTML, URLs, email addresses, RFC-like values, long account/CLABE-like digits and control characters. It is never prefilled from notes. Correction requires one or more canonical codes; rejection accepts no field codes.

After Migration 042, the legacy RPC supports only `received → in_review` and `needs_correction → in_review`. Any legacy attempt to reach `needs_correction` or `rejected` fails with `provider_intake_external_transition_requires_v1`, closing the bypass. Before the migration, capability detection fails closed and the already-deployed UI continues the existing legacy flow without external fields or notification claims. Schema-cache lag produces a maintenance error and never copies external text into notes.

The UI states: “Envío externo deshabilitado hasta que el rollout sea autorizado.” It never claims that a message was sent. A second correction is shown as requiring manual follow-up.

## Dispatcher authentication and modes

The external function accepts POST only, has no CORS response, requires `application/json` with optional UTF-8 charset, reads at most 64 bytes and enforces the exact canonical body `{"limit":1}`. Method, content type, size and body are validated before the disabled-mode short circuit; disabled still returns before HMAC, DB, claim or Resend.

Future runtime configuration is referenced but not created or read in this gate:

- `NOTIFICATION_EXTERNAL_DISPATCHER_HMAC_KEY`
- `NOTIFICATION_EXTERNAL_DISPATCHER_HMAC_KEY_ID`
- `NOTIFICATION_EXTERNAL_SEND_MODE`

The default external send mode is `disabled`; allowed active values are only `test_only` and `pilot`. `NOTIFICATION_SEND_MODE` is not referenced. Disabled returns before authentication, replay registration, claim, attempt or Resend. Active execution requires exact environment/DB rollout agreement.

HMAC headers are `x-flux-key-id`, `x-flux-timestamp`, `x-flux-invocation-id` and `x-flux-signature`. The canonical value is:

```text
METHOD
PATHNAME
TIMESTAMP
INVOCATION_ID
SHA256_RAW_BODY
```

Verification uses HMAC-SHA256, constant-time comparison, a 32-byte-minimum key, a closed 3–64 character key ID, lowercase 64-hex signatures, UUID-v4 invocation IDs and a ±300 second timestamp window. Active configuration accepts only an HTTPS `*.supabase.co` project origin without credentials, port, path, query or fragment before attaching the service-role key. The service-only replay RPC registers the key/invocation pair before claim. Its table stores no signature, key, request body, recipient or payload, and `service_role` has no direct table privileges; access is only through the SECURITY DEFINER RPC.

## Renderer and privacy

The external renderer is independent from the internal renderer. Subjects and text are derived from fixed Spanish templates; ledger `subject` is ignored. Allowed payload data is limited to public folio, event date, sanitized external message and canonical field labels.

Templates contain no internal note, amount, company, provider name, requester, RFC, cost center, budget, approval, internal ID, URL or attachment. HTML is generated by code with strict escaping. Correction has no link in N1.

## Attempts and provider delivery

The external lifecycle is service-only and separates provider delivery from persistence:

1. reserve one attempt for the claimed external event;
2. mark the provider request started;
3. send once to Resend;
4. mark sent with a persisted provider message ID; or
5. mark failed with an allowlisted safe error only when the provider phase failed.

The provider idempotency key is always the event business idempotency key and is reused across retries. Resend receives it in `Idempotency-Key`; attempts do not derive new keys. There are no attachments. After Resend returns an ID, a DB acknowledgement failure retries only `mark_external_notification_sent` once. The sent RPC returns `already_sent` for identical material and rejects a different provider ID. If both acknowledgements remain unknown, the provider is not called again, the failed RPC is not called, and the started marker blocks automatic recovery pending manual review.

Allowlisted errors are `provider_rate_limited`, `provider_server_error`, `provider_timeout_unknown`, `provider_auth_failed`, `provider_contract_rejected`, `provider_network_unavailable`, `provider_response_invalid`, `renderer_contract_failed` and `manual_review_required`. Raw SQL errors and provider bodies are not persisted or returned. A 2xx response with invalid JSON/ID is terminal manual review because delivery may have been accepted. A 401/403 marks the attempt/event terminal and pauses `provider-intake-v1` in the same transaction without clearing cutoff, enabled events or allowlist; subsequent producer, claim and recovery calls fail closed. Retryable 429/network/5xx failures use 5 minutes after attempt 1, 30 minutes after attempt 2 and terminate after attempt 3.

HTTP responses and logs contain only aggregate counts, safe codes and a duration bucket. They contain no event ID, source ID, folio, recipient, provider message ID or raw body.

## Static verification

- `precheck.sql`: future read-only baseline and collision check.
- `postcheck.sql`: future immediate post-apply zero-row, grant and contract check.
- `contract-tests.sql`: a numbered 60-case catalog plus executable synthetic fixtures that call the real finalization, producer, claim, reserve, started, sent, failed, replay and capability functions. It proves zero backlog, idempotent completion/sent, circuit pause and 5/30 retry scheduling, then terminates with `ROLLBACK`.
- `notification-dispatcher-external_test.ts`: deterministic HMAC, parser, mode, replay, renderer, privacy, safe-error and Resend-header tests with synthetic keys, a fake repository and no network.
- provider-intake tests: verify confirmed rejection cleanup, unknown-outcome retry, no destructive cleanup, duplicate incomplete/reconciliation handling and repository outcome classification.
- triage QA: the remote workflow runs both existing suites with `node --test`; their exact inventory is 19 + 15 = `34/34` tests.
- static workflow: PR-only, contents-read, no environment, secrets, Supabase, Resend, deploy, dispatch or artifacts.

## Gate boundary

This candidate does not apply Migration 042, query DEV, deploy Edge Functions, configure secrets, activate rollout, define a cutoff, enable events, populate an allowlist, invoke either dispatcher, call Resend, send email, start UAT, or implement N2/N3.

## Future deployment order

A later, separately authorized gate must use this order: disposable dry-run of Migration 042; apply; DB certification; PostgREST schema readiness; capability certification; provider-intake deploy/digest; external-dispatcher deploy/digest while disabled; rollout remains disabled. UI activation must not precede capability readiness.

The next gate is `NOTIFICATIONS-N1-B-R2`, only with Ramón’s explicit authorization. R1 does not execute any step in that deployment order.
