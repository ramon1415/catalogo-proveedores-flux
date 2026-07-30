# Notifications N0 — Resend-only sanitized DEV evidence path

## Purpose and architecture

This directory defines the corrected R2A-R1 observability gate created after N0-R1 ended with `STOP / READ_ONLY_DEV_EVIDENCE_PATH_UNAVAILABLE`. The canonical notification architecture is:

```text
notification_events
→ Supabase Edge Function notification-dispatcher
→ Resend
→ notification_delivery_attempts
```

The ledger is `notification_events`, delivery history is `notification_delivery_attempts`, the dispatcher is `notification-dispatcher`, the email provider is Resend, and exactly one consumer is required. The audit never acts as a consumer: provider API calls and emails sent by the audit are always false.

n8n is retired and outside the canonical notification architecture (RETIRED / OUT_OF_SCOPE). This audit does not query it, use its secrets, depend on its state, or treat it as a scheduler or consumer; a legacy schema name is classified `LEGACY_SCHEMA_ONLY` and does not prove active use.

R2A-R1 performs static checks only. It does not connect to DEV, read runtime secrets, invoke Resend, invoke or deploy the dispatcher, execute SQL, or upload live evidence. It does not enable N1.

## Execution split

The workflow contains two isolated jobs:

1. `static_checks` runs on pull requests to `dev`. It has read-only repository permissions, no environment, no secrets, and no authenticated live access. It validates the four-file allowlist, workflow and Python syntax, SQL safety, artifact schema, supply-chain pins, and in-memory positive and negative validator fixtures.
2. `collect_dev_evidence` is implemented for a separate, expressly authorized R2B gate. It is eligible only in the exact repository on `refs/heads/dev`, after static checks, on a qualifying push or input-free manual dispatch, under the protected `DEV` environment.

The future live job may use only the minimum database and official management-plane credentials required for read-only evidence. It has no Resend credential and no dispatcher invocation credential.

## Read-only evidence sources

The database script begins with `REPEATABLE READ READ ONLY`, applies statement, lock, and idle-transaction timeouts, and ends with `COMMIT`. The runner also sets `default_transaction_read_only`. Queries are limited to structural catalogs and sanitized aggregates; there is no DDL, DML, application RPC, queue claim, or state transition.

The dispatcher is inspected in two ways: versioned source is scanned locally in the runner for the Resend integration contract, and an official management-plane GET may later provide deployment metadata and temporary source material for a digest comparison. The function is never invoked, deployed, updated, or retained.

The Resend source contract records whether the versioned dispatcher contains a provider reference, a send-mode guard, and an idempotency header. These are read-only observations. Absence of an idempotency header is an N1 concern and does not authorize its implementation here. Resend is never called.

`SEND_MODE` remains exactly `UNKNOWN_BY_DESIGN` because runtime secret values are not read, hashed, inferred, or tested by this audit. A separate authorized gate must establish `test_only` before any future delivery test.

## Artifact v2

A successful future live job uploads exactly one `artifact.json`, retained for no more than seven days. Its schema is `notifications-n0-evidence/v2` and its top-level allowlist is:

- generation metadata, environment, and GitHub revision;
- canonical delivery architecture;
- migrations and database schema;
- sanitized notification, intake, payment, receipt, and Storage aggregates;
- dispatcher runtime metadata and allowlisted SHA-256 digests;
- the Resend source contract;
- send mode, source status, privacy validation, and cleanup.

The artifact contains no PII, email addresses, UUID values, business identifiers, project references, hosts, URLs, connection strings, tokens, secret values, payloads, raw errors, paths, filenames, provider response identifiers, source code, API responses, or raw logs.

Structural column, constraint, and index names may be inventoried without values. Any historical name associated with the retired component must be marked `LEGACY_SCHEMA_ONLY`; it is not a runtime dependency.

## Fail-closed validation and cleanup

The validator uses an exact recursive allowlist and permits SHA-256 only in dispatcher digest fields. It rejects unknown keys, prohibited providers or dispatchers, unsafe architecture flags, sensitive patterns, retained runtime source, function invocation, function deployment, provider API use, email sending, and runtime secret reads.

Positive and negative in-memory fixtures exercise schema v2, provider and dispatcher invariants, SEND_MODE, sensitive patterns, unknown fields, digest placement, and legacy structural classification. Fixtures are not versioned.

Raw database and dispatcher responses are stored only in private runner space and removed before final artifact validation. Failed validation deletes the artifact and emits only a generic failure marker. No raw response or stderr file is uploaded.

## Vercel and next gate

`EXPECTED_AUTOMATIC_PREVIEW` is the classification for a non-production Preview created automatically by the repository's existing pull-request integration. It is not a manual deployment or direct production interaction, and R2A-R1 does not cancel, redeploy, promote, configure, or clean it up. Production evidence, a productive alias, or a manual promotion would require an immediate stop.

R2B requires separate human authorization to integrate and execute the read-only audit. Until then the Draft PR remains unmerged, the live job remains skipped, N0 remains open, N1 remains blocked, and this route must send zero emails.
