# Notifications N1-B — disabled external intake runtime candidate

Status: candidate only. This directory documents `NOTIFICATIONS-N1-B-C1`; it does not authorize applying SQL, deploying an Edge Function, changing secrets, invoking a dispatcher or sending email.

## Certified baseline

- `dev`: `8aab86b85255957b899556327b0f93eb2c093df0`
- `main`: `85ec304ba45b9e0531e2cbd1437ba620c7e2ea24`
- PR #282: merged
- PR #284: merged
- PR #285: merged
- N1-A certification: run `30677188504`, attempt 1, `55/55 PASS`
- N1-A artifact: `8810896652`
- N1-A artifact digest: `sha256:2d5c127ddca0fd58256dd32032751381666e203c4a50ce19600e167b71c16f32`
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

Provider intake uses the existing handler, repository, types and unit-test files. Uploads currently create the intake, write private Storage objects and then attach metadata. This candidate replaces that final metadata-only step with `finalize_provider_intake_submission_v1`. Storage cleanup remains best-effort in the Edge handler if upload or finalization fails. CAPTCHA, CORS, validation and file-limit sources are unchanged.

The real triage client is `provider_intakes.html` plus `provider_intakes.js`. It is the only application caller of `transition_provider_intake` in scope. The candidate keeps internal transitions on that legacy RPC and routes correction/rejection through `transition_provider_intake_external_v1`.

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

If a gate is closed, the domain fact may exist but no pending external row or attempt is created. The migration contains no scan, backfill, replay, top-level producer call, active rollout, cutoff, event enablement or recipient hash.

Correction remains `test_only`-only because Migration 041 prohibits it in pilot until N2. A second correction returns `manual_follow_up_required` and creates no second notification.

## Producers and business idempotency

Supported events and exact keys are:

- `provider_intake.received`: `external:provider_intake.received:{payment_intake_id}:v1`
- `provider_intake.correction_requested`: `external:provider_intake.correction_requested:{payment_intake_id}:v1`
- `provider_intake.rejected`: `external:provider_intake.rejected:{payment_intake_id}:v1`

`payment_intake_id` is the business subject; the append-only domain-event ID is only `source_id`. Template changes and retries cannot create a new business event.

The only recipient source is `lower(trim(payment_intake.provider_email))`. `proveedores.email` is never queried and email is never included in the payload. When an otherwise eligible source has no valid recipient, the ledger receives one terminal `no_recipient` row with no recipient snapshot and no attempts.

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

A failed RPC rolls back file metadata, completion and any notification row. SQL never deletes Storage objects; the existing Edge cleanup path handles uploaded objects on failure. A duplicate public submission skips finalization and cannot create another completion or notification.

## Triage contract

The UI separates:

- optional internal notes, visible only to Flux;
- mandatory 10–1000 character plain-text external message;
- canonical correction field-code checkboxes.

The external message rejects HTML, URLs, email addresses, RFC-like values, long account/CLABE-like digits and control characters. It is never prefilled from notes. Correction requires one or more canonical codes; rejection accepts no field codes.

The legacy RPC still supports `received → in_review` and `needs_correction → in_review`. Any legacy attempt to reach `needs_correction` or `rejected` fails with `provider_intake_external_transition_requires_v1`, closing the bypass.

The UI states: “Envío externo deshabilitado hasta que el rollout sea autorizado.” It never claims that a message was sent. A second correction is shown as requiring manual follow-up.

## Dispatcher authentication and modes

The external function accepts POST only, has no CORS response and enforces a closed body of `{ "limit": 1 }`.

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

Verification uses HMAC-SHA256, constant-time comparison, an exact key ID, UUID-v4 invocation IDs and a ±300 second timestamp window. The service-only replay RPC registers the key/invocation pair before claim. Its table stores no signature, key, request body, recipient or payload.

## Renderer and privacy

The external renderer is independent from the internal renderer. Subjects and text are derived from fixed Spanish templates; ledger `subject` is ignored. Allowed payload data is limited to public folio, event date, sanitized external message and canonical field labels.

Templates contain no internal note, amount, company, provider name, requester, RFC, cost center, budget, approval, internal ID, URL or attachment. HTML is generated by code with strict escaping. Correction has no link in N1.

## Attempts and provider delivery

The external lifecycle is service-only:

1. reserve one attempt for the claimed external event;
2. mark the provider request started;
3. mark sent with a persisted provider message ID; or
4. mark failed with an allowlisted safe error.

The provider idempotency key is always the event business idempotency key and is reused across retries. Resend receives it in `Idempotency-Key`; attempts do not derive new keys. There are no attachments.

Allowlisted errors are `provider_rate_limited`, `provider_server_error`, `provider_timeout_unknown`, `provider_auth_failed`, `provider_contract_rejected`, `provider_network_unavailable`, `provider_response_invalid`, `renderer_contract_failed` and `manual_review_required`. Raw SQL errors and provider bodies are not persisted or returned. Unknown timeouts require manual review; authentication failures require a circuit breaker; retryable 429/network/5xx failures reuse the same event up to three attempts.

HTTP responses and logs contain only aggregate counts, safe codes and a duration bucket. They contain no event ID, source ID, folio, recipient, provider message ID or raw body.

## Static verification

- `precheck.sql`: future read-only baseline and collision check.
- `postcheck.sql`: future immediate post-apply zero-row, grant and contract check.
- `contract-tests.sql`: 60 synthetic contract cases in a temporary table with terminal rollback.
- `notification-dispatcher-external_test.ts`: deterministic HMAC, parser, mode, replay, renderer, privacy, safe-error and Resend-header tests with synthetic keys, a fake repository and no network.
- provider-intake tests: verify zero-file completion, duplicate suppression and Storage cleanup on atomic-finalization failure.
- static workflow: PR-only, contents-read, no environment, secrets, Supabase, Resend, deploy, dispatch or artifacts.

## Gate boundary

This candidate does not apply Migration 042, query DEV, deploy Edge Functions, configure secrets, activate rollout, define a cutoff, enable events, populate an allowlist, invoke either dispatcher, call Resend, send email, start UAT, or implement N2/N3.

The next gate is `NOTIFICATIONS-N1-B-R1`, only with Ramón’s explicit authorization.
