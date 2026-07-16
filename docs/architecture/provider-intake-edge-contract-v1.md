# Provider intake Edge contract v1

## Boundary

`provider-intake` is a public HTTP Edge Function backed by server-only Supabase credentials. The browser never receives `service_role`, never writes directly to PostgreSQL or Storage, and never receives internal UUIDs or object paths.

This phase persists an unconverted intake only. It does not create providers, `payment_requests`, approval assignments, batch items, signed URLs, triage decisions, or public status tracking.

## Token transport

The canonical transport is:

```text
X-Intake-Token: <opaque token>
```

Tokens are not accepted from the query string. A future public page must keep the token in the URL fragment (`solicitar.html#t=...`) and move it into the header for API calls. `INTAKE_ALLOW_QUERY_TOKEN` must remain `false` in every deployed environment.

Only SHA-256 token hashes are sent to PostgreSQL. Invalid, missing, expired, paused, revoked, and unknown tokens all produce `link_not_available` without exposing the underlying reason.

## `GET /functions/v1/provider-intake/link-info`

Required header: `X-Intake-Token`.

The response contains only:

- company display name;
- maximum file size;
- maximum total request size (`max_total_mb`);
- maximum number of files configured by the Edge Function, capped at three;
- allowed MIME types from the link;
- privacy notice URL.

It never returns company, link, profile, membership, role, or Supabase IDs.

## `POST /functions/v1/provider-intake/submit`

Required headers:

- `X-Intake-Token`;
- `Content-Type`;
- optional `Idempotency-Key`.

Accepted bodies:

- `multipart/form-data` with `payload`, `captcha_token`, `honeypot`, `file_kinds`, and zero to three `files`;
- `application/json` with `payload`, `captcha_token`, and `honeypot`, only when no files exist.

Unknown envelope and payload fields are rejected. This prevents callers from supplying company, link, status, requester, approver, batch, triage, timestamp, token, or Storage fields.

`max_file_mb` applies to each file. `max_total_mb` applies to the complete HTTP request, including multipart metadata, and remains 12 MB in DEV for this MVP. It is the functional application limit advertised by `link-info`; it is not a promise about the physical body limit of the hosting perimeter. When an oversized request reaches the Edge Function, the application returns HTTP 413 JSON `payload_too_large`. The platform may instead reject the body before the handler with a non-JSON HTTP 413, 502, or 503. Either route is acceptable only when it produces zero persistence and no information leak. Configuration remains hard-capped at 15 MB.

The JSON application contract is guaranteed only after a request reaches the Edge Function. A client must inspect `Content-Type` before parsing a response, must never expose an infrastructure response body, and must never retry an oversized body automatically. Phase 1C must read `max_total_mb` from `link-info`, calculate the total before upload, block submissions above 12 MB, and map a non-JSON HTTP 413, 502, or 503 to `El tamaño total de los archivos excede el límite permitido.` This behavior is recorded as **Accepted Platform Boundary / P2 residual operativo**, not as an open P1.

New submissions return HTTP 201. Idempotent retries return HTTP 200 with the same public folio. Neither response contains the internal intake UUID.

## Transaction and idempotency

Migration 027 supplies service-only RPCs:

- `resolve_provider_intake_link_internal(text)`;
- `create_provider_intake_internal(text,jsonb,text,text,text,text,text,integer)`;
- `attach_provider_intake_files_internal(uuid,jsonb)`;
- `mark_provider_intake_upload_issue_internal(uuid,text)`.

Creation locks the link row before checking duplicates and rate limits. It checks the HMAC-derived idempotency hash first, then the HMAC submission fingerprint inside the configured rolling window, then the link's Mexico City calendar-day limit. When a client IP is available, the same cap is also enforced for its HMAC within the rolling window. The same transaction creates the folio, intake row, and append-only `received` event.

Because the link row is locked, concurrent submissions cannot pass a separate count-before-insert race. Requests without a platform-provided client IP still receive the per-link daily limit, but cannot receive the additional IP-scoped limit.

## Privacy hashes

- Public token lookup: SHA-256.
- IP and User-Agent: HMAC-SHA256 with `INTAKE_HASH_PEPPER`.
- Submission fingerprint and idempotency key: HMAC-SHA256 with the same private pepper and domain-separated inputs.

Raw IP, User-Agent, token, CAPTCHA response, cookies, headers, and raw payload are never persisted or logged.

## Files

Files are validated before intake creation for declared MIME, extension, size, count, total size, `file_kind`, safe filename, and basic magic bytes. HTML, SVG, archives, executables, generic binary files, path traversal, and mismatched signatures are rejected.

XML is treated as bytes and is never parsed or used to resolve namespaces or external resources. Case-insensitive `DOCTYPE` and `ENTITY` declarations are rejected with `file_type_not_allowed` when the request reaches the function. A perimeter HTTP 403 for the same content is also accepted security behavior when it produces no persistence and no information leak. A normal XML declaration and escaped text such as `&lt;!DOCTYPE` remain valid.

Objects use only opaque paths:

```text
<intake_uuid>/<file_uuid>.<extension>
```

Files are written only to private bucket `intake-uploads`. The metadata RPC verifies that each opaque object path exists in that bucket before recording it. Metadata includes SHA-256 and starts with `quarantine_status = pending`. No signed URL or public Storage policy is created.

If upload or metadata attachment fails, the intake is retained and marked `needs_correction` with a sanitized issue code. Compensation is limited to paths generated and uploaded by that same request.

## CAPTCHA and abuse controls

Cloudflare Turnstile is the initial adapter. Deployed execution fails closed when its secret is missing. It validates success, challenge timestamp, and optional expected hostname/action. The provider response is never returned publicly.

The honeypot causes a neutral `invalid_request` before persistence. Invalid-token, failed-CAPTCHA, and invalid-payload attempt throttling remains best-effort at the Edge boundary; the race-safe persistent limit applies only after a valid link is resolved.

## Notifications

`provider_intake.received` is deliberately deferred. The current canonical enqueue helper rejects non-`payment_request.*` event types, while the dispatcher would render unknown types as a generic email. Migration 027 therefore creates only `payment_intake_events.received` and does not enqueue `notification_events`.

Status: **BLOCKED/N/A until the notification contract and template are explicitly extended.**

## Residual risks

- Malware scanning and content disarm are not implemented; files remain quarantined for later review.
- The physical request-body limit belongs to the Supabase platform and may produce a non-JSON infrastructure response before function code runs; the 12 MB functional limit and future client-side gate reduce this exposure.
- Failed uploads require a later correction flow; an idempotent retry does not silently attach a second file set.
- Invalid-token and pre-transaction abuse controls need platform-level rate limiting before production.
- The public form, link issuance, internal triage, matching, conversion, and public tracking remain later phases.
