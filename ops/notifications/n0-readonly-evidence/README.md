# Notifications N0 — sanitized DEV evidence

This directory defines a fail-closed, read-only discovery path for the approved delivery architecture:

```text
notification_events
→ Supabase Edge Function notification-dispatcher
→ Resend
→ notification_delivery_attempts
```

n8n is retired and out of scope. The audit does not invoke or deploy the dispatcher, call Resend, send email, read runtime secret values, change `SEND_MODE`, or enable product behavior. `SEND_MODE` remains `UNKNOWN_BY_DESIGN`.

## Gate and execution boundary

Pull requests run only `static_checks`: no environment, no secrets, no DEV connection, and no artifact upload. The future live job is limited to the exact repository and `refs/heads/dev`, requires the `DEV` environment, accepts no inputs, uses three DEV credentials only, and uploads one sanitized artifact with retention of at most seven days.

This R2A-R2 change prepares R2B; it does not execute R2B and does not enable N1. The expected Vercel context for the Draft PR is `EXPECTED_AUTOMATIC_PREVIEW`; no manual Vercel action is part of this workflow.

## DEV environment identity

Before any PostgreSQL command, the validator performs all of these checks:

1. The project ref is exactly 20 lowercase letters.
2. `SHA-256(UTF-8("supabase-project-ref:" + ref))` matches the authorized constant using constant-time comparison.
3. The parsed PostgreSQL URL is bound to the same ref through either the official direct host shape or the official pooler username shape.
4. The database is `postgres`, the port is 5432 or 6543, and only safe TLS and timeout query options are accepted.
5. A GET of the exact Supabase project resource returns metadata whose `ref` equals the same ref.
6. Raw project response headers and body are deleted before the safe marker `DEV_ENVIRONMENT_IDENTITY_VERIFIED` is emitted.

Any failure returns `DEV_IDENTITY_PRECHECK_FAILED`. This is fail-before-connect: PostgreSQL cannot run until ref hash, DB URL, host allowlist, and Management API metadata all agree. The artifact keeps only closed booleans; it never keeps or prints the project ref, DB URL, database host, username, token, or raw metadata.

## Dispatcher source provenance

The exact dispatcher metadata resource and its `body` resource are fetched only with GET. The body request declares `Accept: multipart/form-data`. Transport headers, metadata, and body remain in runner-private temporary storage and are removed before artifact validation.

The parser uses the standard library, validates the multipart boundary, distinguishes metadata from files, and derives each file path from `Supabase-Path` or `Content-Disposition`. It normalizes separators and rejects absolute paths, traversal, malformed or ambiguous headers, missing paths, duplicates, symlinks, non-regular files, too many parts, and size-limit violations. Source is never imported, executed, or emitted.

### Canonical manifest

Runtime files and the recursive GitHub directory `supabase/functions/notification-dispatcher/` use the same canonical manifest algorithm:

- normalize each relative path;
- sort paths by their UTF-8 bytes;
- for each path feed SHA-256 with the 8-byte big-endian path length, NUL, path bytes, NUL, 8-byte big-endian content length, NUL, and content bytes.

Only regular files participate, symlinks are fail-closed, and the artifact records counts and digests but no source paths or source bytes.

These digest types are intentionally different:

- **transport body:** the raw multipart envelope; it is never hashed for source comparison;
- **source manifest:** the canonical per-file digest used for runtime-to-GitHub comparison;
- **bundle digest:** optional deployment metadata such as a valid `ezbr_sha256`; it is retained separately and never compared with a source manifest.

Comparison states are `match`, `mismatch`, `metadata_only`, `body_unavailable`, `parse_failed`, `github_source_unavailable`, and `unavailable`. Unknown evidence remains null: only `match` yields `source_match=true`, only `mismatch` yields `source_match=false`, and `metadata_only` never claims source verification.

## Artifact contract

The sole artifact uses `notifications-n0-evidence/v3` and the closed root allowlist:

`schema_version`, `generated_at_utc`, `environment`, `github`, `environment_identity`, `delivery_architecture`, `migrations`, `database_schema`, `notification_aggregates`, `intake_aggregates`, `payment_receipt_aggregates`, `storage`, `dispatcher_runtime`, `resend_source_contract`, `send_mode`, `source_status`, `privacy_validation`, and `cleanup`.

`environment_identity` contains only verified booleans. `dispatcher_runtime` separates metadata availability, multipart parsing, runtime and GitHub manifest digests, path-set comparison, optional bundle digest, and exact comparison state. `source_status` separately reports database, project identity, dispatcher metadata, dispatcher body, dispatcher manifest, GitHub source, and Resend source-contract provenance.

The recursive privacy validator rejects unknown keys, project-ref-like values, email addresses, UUIDs, URLs, connection strings, JWTs, tokens, secrets, payloads, raw errors, storage paths, signed URLs, and SHA-256 values outside the three dispatcher digest fields. Legacy n8n names are accepted only as `LEGACY_SCHEMA_ONLY` database structure.

## Static verification and cleanup

In-memory self-tests cover 17 identity and DB URL cases plus 20 multipart and canonical manifest cases, including changing boundaries and part order, malformed transport, unsafe paths, duplicate paths, size limits, symlinks, unavailable-source states, and non-equivalence of bundle and source digests.

The SQL begins with a repeatable-read, read-only transaction, explicitly enables `default_transaction_read_only`, applies timeouts, returns only catalog metadata and sanitized aggregates, and commits. It contains no DDL, DML, RPC, claim, state transition, PII, business identifier, filename, or raw error output.

Raw project metadata, request headers, dispatcher metadata, dispatcher headers, multipart body, database output, and the private directory are deleted before upload or by the always-run cleanup step. The final artifact contains no PII and only the single allowlisted JSON file.

## Remaining gate

R2B remains pending and requires separate explicit authorization. Until then: no merge, no Ready transition, no live workflow dispatch, no secrets, no DEV read, no dispatcher body download, no dispatcher invocation, no Resend call, no email, no `SEND_MODE` read or change, and no N1.
