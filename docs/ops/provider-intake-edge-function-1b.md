# Provider intake Edge Function - Phase 1B

## Gate 1B.1

This repository change prepares code only. It must not execute SQL, configure secrets, deploy the function, create a link, create an intake, or upload a file.

Migration 026 is reserved by another Draft PR and must be integrated before the manual 027 gate. Migration 025 must not be rerun or edited.

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
- `INTAKE_MAX_TOTAL_MB`
- `INTAKE_MAX_FILES` (0-3)
- `INTAKE_MAX_AMOUNT`
- `INTAKE_ALLOWED_CURRENCIES`
- `INTAKE_PRIVACY_NOTICE_URL`
- `INTAKE_RATE_LIMIT_WINDOW_SECONDS` (60-86400)

`SUPABASE_SERVICE_ROLE_KEY` and `INTAKE_HASH_PEPPER` are server-only secrets. They must never appear in HTML, browser JavaScript, examples, logs, artifacts, or chat.

## Gate 1B.2 order

1. Confirm migration 026 has been integrated and its gate is closed.
2. Confirm the target is DEV `scsirgbuqjcwoaxfacth`.
3. Run `ops/provider-intake/apply-027-edge-support/01_PRECHECK_READ_ONLY.sql`.
4. Capture `02_BACKUP_DEV.sql` evidence without PII.
5. Verify the exact-load SHA documented in `00_README.md`.
6. Execute `03_LOAD_027_EXACT.sql` once.
7. Run `04_POSTCHECK_READ_ONLY.sql` and reconcile protected counts.
8. Configure runtime secrets in Supabase DEV without printing values.
9. Deploy only `provider-intake` from branch `dev` after separate authorization.
10. Create one controlled QA link through a separately authorized server-side procedure.
11. Execute token, CAPTCHA, CORS, payload, idempotency, file, concurrency, privacy, and logging QA.
12. Do not merge until the real DEV battery is reviewed.

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

## Roll-forward rule

After migration 027 is applied successfully, never edit or rerun it. A later defect requires the next free migration and a new controlled package.
