# Notifications N0 — sanitized DEV evidence

This directory defines a fail-closed, read-only discovery path for the approved architecture:

```text
notification_events
→ Supabase Edge Function notification-dispatcher
→ Resend
→ notification_delivery_attempts
```

n8n is retired and out of scope. The audit does not invoke or deploy the dispatcher, call Resend, send email, read runtime secret values, change `SEND_MODE`, or enable product behavior. `SEND_MODE` remains `UNKNOWN_BY_DESIGN`.

## Gate boundary

Pull requests run only `static_checks`: no environment, secrets, DEV connection, psql, Management API request, or artifact upload. The future live job remains limited to the exact repository and `refs/heads/dev`, requires the protected `DEV` environment, accepts no inputs, and can use only the three approved DEV credentials.

R2A-R3 prepares R2B; it does not execute R2B and does not enable N1. The expected Draft PR deployment context is `EXPECTED_AUTOMATIC_PREVIEW`; no manual Vercel action belongs to this workflow.

## DEV identity

Before PostgreSQL, the validator binds the project-ref hash, parsed database URL, official Supabase host shape, and exact Management API project metadata. Invalid format, unsafe connection options, or any mismatch returns `DEV_IDENTITY_PRECHECK_FAILED`. Raw project headers and metadata are removed before `DEV_ENVIRONMENT_IDENTITY_VERIFIED`.

The artifact stores only closed booleans. It never stores or prints the project ref, DB URL, host, username, token, or raw metadata.

## Receipt and Storage security evidence

The sole artifact now uses `notifications-n0-evidence/v4` and adds the closed `receipt_security_contract` section. It reports only booleans and non-negative aggregate counts for:

- presence and privacy of the exact expected receipt bucket;
- existence of the evidence and receipt-link tables;
- evidence inside or outside the expected bucket;
- shareable evidence with invalid page count, missing individual attestation, or missing individual hash;
- bucket, storage-path, single-page, and attestation constraints;
- one-to-one uniqueness for operation, payment request, and evidence;
- exact select and insert Storage policies;
- policies restricted to the authenticated role, expected bucket, and guarded helper;
- helper existence, `SECURITY DEFINER`, contract shape, and execute grants;
- direct authenticated table `SELECT` privileges.

The SQL may inspect constraint definitions, policy expressions, and function definitions only inside boolean predicates. Those texts never enter JSON. The artifact contains no bucket identifier, Storage object path, filename, UUID, policy expression, function definition, or individual row.

A valid artifact is not a claim that the live contract is safe. **False is evidence** of drift or absence, positive violation counts are valid findings, and unsafe direct privileges remain reportable. Validation fails only for malformed shape, invalid types, unknown fields, negative counts, or privacy violations.

If a source table is absent, its existence field is false, related counts are null, and related controls are false. `available` means the contract query executed; it does not mean every control passed.

## Official Supabase multipart paths

The dispatcher body is fetched only by GET with `Accept: multipart/form-data`. The standard-library parser supports metadata, `entrypoint_path`, `deno2_entrypoint_path`, `filename`, `filename*`, `Supabase-Path`, relative paths, absolute paths, and `file://` entrypoints.

A trusted root is derived only from multipart entrypoint metadata or the exact Function metadata response. Relative paths are normalized against that root. Absolute POSIX paths are accepted only when they remain strictly inside the derived root and are converted to canonical relative paths. The parser rejects missing roots, traversal, Windows paths, NUL or line breaks, incompatible path headers, collisions after normalization, files outside the root, symlinks, empty filesets, ambiguous metadata, and size or part-limit violations.

No root, filename, source path, source bytes, transport headers, or multipart metadata appears in the artifact.

## Canonical manifest

Runtime files and the recursive GitHub directory use the same canonical manifest:

- normalized relative path;
- UTF-8 byte ordering;
- 8-byte big-endian path length;
- NUL and path bytes;
- NUL and 8-byte big-endian content length;
- NUL and content bytes.

The transport body and boundary never participate. Runtime and GitHub source manifests are comparable; the optional bundle digest remains separate.

Comparison states remain `match`, `mismatch`, `metadata_only`, `body_unavailable`, `parse_failed`, `github_source_unavailable`, and `unavailable`. Only `match` produces `source_match=true`; only `mismatch` produces false. Unknown evidence remains null.

## Artifact v4 privacy contract

The closed root contains:

`schema_version`, `generated_at_utc`, `environment`, `github`, `environment_identity`, `delivery_architecture`, `migrations`, `database_schema`, `notification_aggregates`, `intake_aggregates`, `payment_receipt_aggregates`, `receipt_security_contract`, `storage`, `dispatcher_runtime`, `resend_source_contract`, `send_mode`, `source_status`, `privacy_validation`, and `cleanup`.

The recursive privacy validator rejects unknown keys, project-ref-like values, email addresses, UUIDs, URLs, connection strings, JWTs, tokens, payloads, raw errors, signed URLs, and SHA-256 values outside the three dispatcher digest fields. Legacy n8n names remain allowed only as `LEGACY_SCHEMA_ONLY` database structure.

The single sanitized artifact is uploaded only after privacy validation and is retained for at most seven days.

## Static verification and cleanup

Synthetic in-memory suites retain the 17 identity cases and 20 canonical-manifest cases, and add 13 receipt-security cases plus 16 official multipart-path cases. They prove that security drift is valid evidence while malformed or privacy-unsafe output fails closed.

The SQL remains `REPEATABLE READ READ ONLY`, explicitly enables `default_transaction_read_only`, uses timeouts, returns only catalogs and sanitized aggregates, and ends with `COMMIT`. It contains no DDL, DML, application RPC, claim, state transition, individual identifier, path, filename, or raw error output.

Raw project metadata, dispatcher metadata, response headers, multipart body, database JSONL, and private runner storage are deleted before or after artifact construction. The final artifact contains no PII.

## Remaining gate

R2B remains pending and requires separate explicit authorization. Until then: no Ready transition, merge, live workflow dispatch, secret use, DEV read, dispatcher body download, dispatcher invocation, Resend call, email, `SEND_MODE` read or change, or N1.
