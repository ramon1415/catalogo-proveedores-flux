# Weekly request digest

Approved schedule: Wednesday 17:00 **America/Mexico_City**.

- PROD (`ucantptjhwttexzmslvm`): `lisette@dezdez.earth`.
- DEV (`scsirgbuqjcwoaxfacth`): `ramon@quantta.mx`.
- First period: **2026-09-18 00:00 inclusive to 2026-09-23 17:00 exclusive**, CDMX.
- Following periods: previous cutoff inclusive to current cutoff exclusive; no gaps.
- Select requests by `created_at` from Operadora Tlacatecpan and Soporte Fersana, whether or not an approval batch exists. All request types/states are included except rejected requests, rejected exceptions and blocked director rejections. Draft/pending/cancelled/paid status is displayed explicitly. Amounts are requested amounts, never a claim of authorization or payment. Currency totals stay separate.
- Empty snapshot: record an `empty` run, advance the period and send nothing.
- One executive email, approved Flux branding, company counts/totals and one landscape PDF with a section per company and every request. No application login or links required.
- Generating the report does not create an approval batch, approve or mark requests paid.

## Scheduling and retry behavior

`cron.job` `weekly-request-digest` calls `private.wake_weekly_request_digest()` every five minutes. It only invokes the Edge Function when the configured Wednesday 17:00 cutoff is due, or a previous attempt needs recovery. Timezone calculation is in the database, independent of the cron server timezone. The first call at the due time snapshots requests; later changes do not alter the stored digest.

The existing Vault dispatcher endpoint identifies the environment; its secret authenticates `weekly-request-digest`. Deploy this function with `verify_jwt=false` (CLI `--no-verify-jwt`); the worker validates the dispatcher secret before any data access. This is already configured in both live deployments. Keep the shared `supabase/config.toml` unchanged: unrelated historical release workflows attach to that file. Public RPCs are executable only by `service_role`; private tables enable RLS and revoke anonymous/authenticated access. The recipient cannot be supplied by the caller.

A row lock on settings advances each period once. Runs use a 10-minute claim lease, an immutable document and a frozen complete email payload including the PDF. Retries reuse a stable Resend idempotency key. Automatic retries stop after 12 attempts or 20 hours from first send preparation, before the provider's 24-hour deduplication window expires. Failures remain `needs_review`; PDFs are never silently omitted. Oversized PDF (>20 MiB) fails visibly instead of sending links or partial content.

## Deployment / verification

Deploy `supabase/functions/weekly-request-digest/` with `deno.json`, `render.ts`, `pdfLogo.ts` and `fonts.ts`; apply migration `20260917221717_weekly_request_digest.sql` and `20260917221734_weekly_request_digest_preflight.sql` to each approved environment. No app/Vercel UI change is needed.

Tests: `node --test scripts/qa/weekly-request-digest.test.mjs`.

The first cron tick automatically runs a no-send preflight; its request ID is saved in settings. Owner-only repeat preflight: `select private.wake_weekly_request_digest(true);`. This calls the deployed worker, checks environment, configuration and current snapshot, renders a PDF if there are rows, and sends no email. Read its result from `net._http_response` by the returned request ID, without exposing headers/secrets.

Operational checks (database owner):

```sql
select environment, recipient, enabled,
  period_start at time zone 'America/Mexico_City' period_start_cdmx,
  next_cutoff at time zone 'America/Mexico_City' next_cutoff_cdmx
from private.weekly_request_digest_settings;
select id, period_start, period_end, status, attempts, provider_id, error_code
from private.weekly_request_digest_runs order by period_end desc;
select jobname, schedule, active from cron.job where jobname='weekly-request-digest';
```

Disable if needed: set `enabled=false` on the singleton settings row. This only pauses this digest. For `needs_review`, check provider delivery before any manual retry; do not reset the first-send timestamp after an uncertain result. Existing notification dispatchers are unchanged.

## Applied versions (2026-09-17)

Canonical migration filenames match PROD history. Management API assigned DEV versions `20260917221501` / `20260917221648`; their SQL is equivalent to PROD `20260917221717` / `20260917221734`, respectively. Do not blindly push migration history across environments or reapply these creates.

Both Edge deployments: version 2, identical bundle SHA `c1678930df6a0b0536456e1e8c1a1dbab941b70757425cc5b1cf5fc73f6e556c`. First automatic preflight renders a synthetic PDF if the requested first period has not opened; it never sends an email or stores synthetic payment requests.

Public GitHub publication explicitly authorized by the user on 2026-09-17 after disclosure of recipient and infrastructure configuration. Supabase deployment is independently authorized and active. Publish isolated PRs against dev and main; do not promote unrelated branch differences or reapply already deployed migrations.

Final live verification at 2026-09-17 22:20 UTC: the scheduler invoked both workers successfully (HTTP 200). Each reported `configured=true`, `enabled=true`, the correct recipient and first cutoff, `sent=0`, and zero digest runs. The deployed PDF runtime generated its internal no-send probe successfully (DEV 32,722 bytes; PROD 32,462 bytes). Eleven focused tests passed, including first-window boundaries, pending/rejected filtering, empty periods, duplicate claims, recipient isolation and immutable retry payloads. No payment requests or approval batches were modified.
