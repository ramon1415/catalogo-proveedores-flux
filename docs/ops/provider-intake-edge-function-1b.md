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
- a request above 12 MB is rejected either by the application with HTTP 413 JSON `payload_too_large` or by the perimeter with non-JSON HTTP 413, 502, or 503, always with zero persistence;
- a request below 12 MB continues to the next applicable validation gate;
- XML containing `DOCTYPE` or `ENTITY` is blocked by the function with HTTP 415 JSON, or by the perimeter with HTTP 403, with zero persistence in either case.

## Platform boundary and Phase 1C client behavior

`INTAKE_MAX_TOTAL_MB` remains 12 MB in DEV. This is the functional limit exposed by `link-info`, not a guaranteed physical gateway threshold. If an oversized body reaches `provider-intake`, the function returns HTTP 413 JSON `payload_too_large`. The hosting perimeter may reject the body first with a non-JSON HTTP 413, 502, or 503. This is classified as **Accepted Platform Boundary / P2 residual operativo** when the request creates no database or Storage persistence and exposes no sensitive information.

Phase 1C must read `max_total_mb` from `link-info`, calculate the total upload size before sending, block submissions above 12 MB, and translate non-JSON HTTP 413, 502, or 503 responses to `El tamaño total de los archivos excede el límite permitido.` It must never show an infrastructure response body or retry the oversized request automatically.

## Roll-forward rule

After migration 027 is applied successfully, never edit or rerun it. A later defect requires the next free migration and a new controlled package.
