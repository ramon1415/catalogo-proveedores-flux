# Notifications N0 — sanitized DEV evidence path

## Purpose

This directory defines the R2A observability gate for Notifications N0. It exists because N0-R1 ended with `STOP / READ_ONLY_DEV_EVIDENCE_PATH_UNAVAILABLE`. It creates a reviewable, read-only route for future collection of sanitized DEV evidence. The pull request phase performs static checks only: it does not connect to DEV, run n8n, invoke or deploy the dispatcher, send email, or upload a live artifact.

R2A does not enable N1. It does not change product behavior, database objects, migrations, notification state, provider data, or external services.

## Execution split

The workflow has two independent jobs:

1. `static_checks` runs for pull requests to `dev`. It has read-only repository permissions, no GitHub environment, no secrets, and no live-system access. It verifies the four-file R2A allowlist, workflow syntax, immutable action pins, trigger guards, SQL read-only controls, artifact retention, and this contract.
2. `collect_dev_evidence` is a future live job. It is eligible only for this exact repository on `refs/heads/dev`, after static checks, on a `push` to `dev` or an input-free manual dispatch, and under the protected `DEV` environment. It is intentionally not eligible on a pull request.

The live job requires the PostgreSQL command-line client, installed from the runner's operating-system package repository. Runtime credentials are scoped only to that job and are never printed or copied into the artifact.

## Read-only sources

The database script starts a `REPEATABLE READ READ ONLY` transaction, applies statement, lock, and idle-transaction timeouts, and ends with `COMMIT`. It reads catalog structure and aggregate counts only. It contains no data-definition, data-modification, lock-taking, or function-invocation statement.

Dispatcher inspection uses only the official management plane with authenticated `GET` requests for function metadata and body. The body is held in private runner storage only long enough to compute a SHA-256 digest. The route never invokes, deploys, updates, or deletes a function.

n8n inspection uses a `GET` request for workflow metadata. Raw responses remain in private runner storage and are summarized into boolean capabilities and counts. The route never activates, deactivates, creates, updates, deletes, or executes a workflow.

## Artifact contract

A successful live job uploads exactly one file named `artifact.json`, retained for at most seven days. The JSON has an exact recursive allowlist and may contain only:

- repository revision and UTC generation time;
- migration versions, sanitized migration names, duplicate counts, and required-version presence;
- table, column, constraint, index, policy, grant, trigger, function, and enum metadata;
- aggregate notification, intake, provider, payment-receipt, evidence, outbox, request, and storage counts;
- dispatcher presence, deployment/JWT flags, and SHA-256 digests;
- n8n workflow counts and boolean trigger/capability summaries;
- source availability, cleanup, and privacy-validation states.

The artifact contains no PII, email addresses, provider or payment identifiers, UUIDs, project references, hosts, URLs, connection strings, credentials, secret values, payloads, error text, stack traces, database row samples, storage object names or paths, signed links, dispatcher source, or raw n8n data.

`SEND_MODE` is exactly `UNKNOWN_BY_DESIGN`. The audit does not read a runtime secret merely to classify its value; doing so would expand exposure without being necessary for this gate.

## Fail-closed behavior

The validator is fail-closed. It checks the complete schema, every allowed nested key, value types, safe-name patterns, digest shapes, and forbidden sensitive patterns. It also compares the final serialization against any sensitive runtime value available to the job without printing that value. A parse error, unknown key, unexpected file, prohibited pattern, failed source read, or cleanup problem prevents upload. On privacy-validation failure, the artifact is deleted and only the generic failure marker is emitted.

Private database, dispatcher, and n8n responses are removed before final validation. An always-run cleanup step removes remaining private material and removes output after any failed job. Logs and the step summary contain status, byte count, digest, retention, and validation result only.

## Unknowns and the R2B gate

`UNKNOWN` or `unavailable` means that a supported read-only source or fact could not be established; it remains open and is never converted into a guessed true or false result. `CONTRACT_CONFLICT` means that a source response cannot be represented by the allowlisted schema or violates the expected shape; collection fails and no artifact is uploaded. Uncertain sanitization is also a hard failure. Database evidence is mandatory because it is the core of this audit path.

Even after a future successful run, this audit does not prove notification delivery correctness, recipient authorization, template suitability, link isolation, or readiness for external email. Those remain product and security decisions outside R2A.

R2B is a separate approval gate. Reviewers must approve the branch protections, `DEV` environment controls, secret placement, SQL scope, JSON allowlist, GET-only integrations, cleanup behavior, and static-check result before anyone manually dispatches the live job or relies on a post-merge run. Passing R2A means only that the sanitized read-only audit pull request is ready for review; it is not authorization to merge, execute live collection, send notifications, or proceed to N1.
