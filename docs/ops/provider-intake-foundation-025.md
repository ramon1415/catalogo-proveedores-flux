# Provider intake foundation - migration 025

## Objective

Migration 025 introduces the secure, empty data foundation for a future public provider portal. It creates no public endpoint and grants no anonymous table or Storage access.

## Architecture

The future flow is intentionally split:

`public form -> server-side Edge Function -> intake tables/private bucket -> internal triage -> future controlled conversion`

The public browser will never write directly to PostgreSQL or Storage. Phase 1A supplies only the server-side persistence boundary needed by later phases.

## Objects

### `public.intake_links`

Stores one active configuration per company. Only a SHA-256 token hash and a short non-secret prefix are stored. Revocation fields must be complete when status is `revoked`. File limits cannot exceed the private bucket limit.

### `public.payment_intake`

Stores provider-declared data before an internal payment request exists. Company identity is constrained to match the selected intake link. RFC, email, currency, hashes, and optional CLABE are normalized before constraints run.

No raw request payload is stored. In particular, the schema has no place for public tokens, CAPTCHA tokens, cookies, request headers, plain IP addresses, or full user-agent strings.

### `public.payment_intake_files`

Stores metadata only. The path format is opaque and constrained to:

`{payment_intake_uuid}/{file_uuid}[.extension]`

It cannot contain the supplier name, RFC, email, phone, or CLABE. Original filenames remain metadata protected by company-scoped RLS. Files start in quarantine.

### `public.payment_intake_events`

Provides an append-only audit ledger. Direct authenticated writes are absent and an immutable trigger rejects updates or removals. Event metadata must be a JSON object and must not contain sensitive raw payloads.

## States

Intake states:

- `received`
- `in_review`
- `needs_correction`
- `rejected`
- `converted`
- `cancelled`

`rejected` requires a reason. `converted` requires exactly one linked `created_payment_request_id`; the field is reserved for Phase 2.

Link states:

- `active`
- `paused`
- `revoked`
- `expired`

Only one active link is permitted per company.

## Public folio

The internal helper generates `INT-YYYY-NNNNNN` with a non-cycling sequence. It is `SECURITY DEFINER`, uses `search_path = public, pg_temp`, is unavailable to PUBLIC, `anon`, and `authenticated`, and is executable only by the backend `service_role` plus the owning database role.

Migration 025 does not call the helper and creates no folio.

## RLS and grants

| Object | anon | authenticated internal read | authenticated mutation | backend service |
| --- | --- | --- | --- | --- |
| `intake_links` | none | admin/sysadmin | none | select/insert/update |
| `payment_intake` | none | Finance roles with active company membership; admin/sysadmin bypass membership | none | select/insert/update |
| `payment_intake_files` | none | Same company scope through parent intake | none | select/insert/update |
| `payment_intake_events` | none | Same company scope through parent intake | none | select only through RLS grant; backend insert | select/insert |

The table policies reuse:

- `current_profile_id()`
- `current_user_has_role(text[])`
- `flux_sysadmin_roles()`
- `flux_finance_roles()`
- `has_active_company_membership(uuid, uuid)`

No new membership model is introduced. Requesters and Direction do not receive intake access in Phase 1A.

## Storage

Bucket: `intake-uploads`

- private;
- 10 MB maximum object size;
- PDF, XML, JPEG, PNG, and WebP only;
- no Storage policy for `anon`;
- no direct Storage policy for `authenticated`;
- zero objects after migration.

Future writes use an Edge Function with server-side credentials. Future reads use short-lived signed URLs generated server-side after internal authorization.

PostgreSQL does not support bucket-specific table grants on `storage.objects`; bucket security is enforced by private bucket configuration plus the deliberate absence of matching Storage policies.

## Sensitive data

- `token_hash`, fingerprints, IP hash, user-agent hash, and optional file SHA use lowercase SHA-256 hex.
- Full IP addresses and full user agents are not stored.
- CLABE is optional, normalized to 18 digits, declarative only, and never copied to `proveedores` by this migration.
- No raw CLABE index is created. This is intentional: Phase 1A has no operational lookup requiring it, and indexing would broaden the footprint of a sensitive value.
- File paths are opaque and contain no supplier identifiers.
- Storage paths are visible only to the authorized company-scoped internal read policy and backend service.

## Index rationale

The migration indexes token lookup, one active link per company, company/status triage ordering, RFC matching, idempotency, submission fingerprints, one-to-one conversion, file quarantine, and audit chronology.

No raw CLABE index is included. If Phase 2 proves a matching need, use a separately reviewed derived fingerprint rather than adding an unqualified raw-value index.

## Relationship with batches

`payment_intake` never enters `approval_batches`. Phase 2 must first create a normal `payment_request`. That request is submitted, budget-validated, and only then may appear in the company batch through the canonical eligibility RPC. No individual regular approver is selected during intake triage.

See `docs/architecture/provider-intake-batch-reconciliation.md`.

## Relationship with the future Edge Function

Phase 1B will own token validation, CAPTCHA, rate limiting, idempotency, input validation, file upload, and initial audit-event creation. The Edge Function will use backend credentials and will not expose them to the browser.

Migration 025 does not deploy or modify an Edge Function.

## DEV procedure

Use only `ops/provider-intake/apply-025-foundation/` and follow `00_README.md` exactly. The exact load file must remain byte-identical to the migration and must match the documented SHA-256.

The manual gate is:

1. read-only precheck;
2. read-only evidence snapshot;
3. one exact transactional load;
4. read-only consolidated postcheck;
5. manual count comparison and approval.

Do not use an automated database push or migration-history repair for this gate.

## Forward-only recovery

An error before the migration commit rolls back the full transaction. After success, do not improvise a destructive rollback. Any unwind requires a new, reviewed forward migration after proving the four tables and bucket are empty.

## Test coverage

Local checks cover:

- PostgreSQL parsing for the migration and every SQL package file;
- exact byte comparison and SHA-256;
- required tables, columns, constraints, indexes, and RLS;
- zero anonymous grants and policies;
- zero direct authenticated mutations;
- fixed search path and restricted helper execution;
- private compatible bucket with zero policies and objects;
- zero intake rows;
- unchanged core-table counts by manual baseline comparison.

## Limitations and pending decisions

Phase 1A does not include token creation, portal UI, Edge Function, triage mutations, notifications, provider creation, matching, conversion, signed URLs, CAPTCHA implementation, persistent rate limiting, malware scanning, or retention automation.

These require separate approval and later phases.
