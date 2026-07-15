# Provider intake Edge Function - Phase 1B

## Gate 1B.1

Gate 1B.1 prepared the code without deploying the function or creating a link, intake, or file. Migrations 025, 026, 027, and 028 are now integrated and applied in DEV. They must not be rerun or edited.

## Required runtime configuration

Names only; never commit values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CAPTCHA_PROVIDER=turnstile`
- `CAPTCHA_SECRET`
- `CAPTCHA_EXPECTED_HOSTNAME` (optional)
- `CAPTCHA_EXPECTED_ACTION` (optional)
- `INTAKE_HASH_PEPPER`
- `INTAKE_ALLOWED_ORIGINS`
- `INTAKE_ALLOW_NO_ORIGIN=false`
- `INTAKE_ALLOW_QUERY_TOKEN=false`
- `INTAKE_MAX_TOTAL_MB` (12 in DEV and the code default; never greater than 15 for this MVP)
- `INTAKE_MAX_FILES` (0-3)
- `INTAKE_MAX_AMOUNT`
- `INTAKE_ALLOWED_CURRENCIES`
- `INTAKE_PRIVACY_NOTICE_URL`
- `INTAKE_RATE_LIMIT_WINDOW_SECONDS` (60-86400)

`SUPABASE_SERVICE_ROLE_KEY` and `INTAKE_HASH_PEPPER` are server-only secrets. They must never appear in HTML, browser JavaScript, examples, logs, artifacts, or chat.

## Gate 1B.2 order

1. Confirm migrations 025, 026, 027, and 028 are integrated and already applied in DEV. Do not rerun any load script.
2. Confirm the target is DEV `scsirgbuqjcwoaxfacth`.
3. Run only `ops/provider-intake/apply-027-edge-support/04_POSTCHECK_READ_ONLY.sql` and reconcile protected counts.
4. Configure runtime secrets in Supabase DEV without printing values.
5. Confirm the PR branch is clean and record the exact branch name, commit SHA, and function source tree hash from `git rev-parse HEAD:supabase/functions/provider-intake`.
6. Deploy only `provider-intake` from that exact validated PR head. Do not deploy an uncommitted local copy or a different branch.
7. Record the deployed branch, commit SHA, function source tree hash, deployment timestamp, and deployment/version identifier.
8. Create one controlled QA link through a separately authorized server-side procedure.
9. Execute token, CAPTCHA, CORS, payload, idempotency, file, concurrency, privacy, and logging QA.
10. Do not merge until the real DEV battery is reviewed and Ramon explicitly authorizes the merge.
11. After merge, confirm the merged function tree is identical to the validated deployed tree. Redeploy from `dev` only if the code differs or the release process requires the merge commit to be recorded as the deployment source.

Do not use `db push`, `migration repair`, PROD, n8n, cron, Database Webhooks, or `notification-dispatcher`.

## Expected QA

The functional battery must prove:

- unavailable links share one public error;
- no internal IDs or emails leak from `link-info`;
- query-string tokens are rejected;
- CAPTCHA fails closed;
- unknown/internal payload fields are rejected;
- concurrent identical submissions produce one intake and one folio;
- link rate limits cannot be bypassed by a race;
- each accepted file has matching extension, MIME, magic bytes, size, opaque path, SHA-256, and pending quarantine status;
- upload failure retains the intake as `needs_correction` without misleading metadata;
- logs contain no token, payload, RFC, email, phone, account, CLABE, filenames, IP, User-Agent, CAPTCHA, or service key;
- tables remain RLS protected and the bucket remains private;
- no `notification_events` row is created until its event type is supported safely.
- `link-info` exposes `max_total_mb=12` without internal identifiers;
- a total request just above 12 MB but below the calibrated platform boundary returns HTTP 413 JSON `payload_too_large` with zero persistence;
- a request below 12 MB continues to the next applicable validation gate;
- XML containing `DOCTYPE` or `ENTITY` is blocked by the function with HTTP 415 JSON, or by the perimeter with HTTP 403, with zero persistence in either case.

## Platform boundary and Phase 1C client behavior

DEV calibration reached `provider-intake` at approximately 10, 12, 14, 16, and 18 MB. The known non-JSON relay rejection occurs above 20 MB. `SAFE_TOTAL_MB` is therefore 12 MB: it stays at least 40% below the known boundary, respects the MVP cap, leaves multipart headroom around a 10 MB file, and permits a reproducible DEV retest above the functional limit without approaching the platform boundary.

The Edge Function enforces the full request size before link lookup or persistence. The platform may still reject a larger body before the handler. Phase 1C must read JSON only when the response advertises `application/json`; map non-JSON 403 to a security-content rejection, non-JSON 413 to an oversized request, and non-JSON 502/503/relay failures to a generic unprocessed-request message. It must not show infrastructure bodies or automatically retry oversized requests.

## Roll-forward rule

After migration 027 is applied successfully, never edit or rerun it. A later defect requires the next free migration and a new controlled package.
