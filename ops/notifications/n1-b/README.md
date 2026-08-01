# Notifications N1-B release candidate path

Status: `IN_DEVELOPMENT`. This slice prepares a disabled external notification path and its DEV/UAT/PROD release plan. It does not authorize a merge, a DEV apply, an Edge deployment, UAT, a rollout change, Resend, email, or PROD activity.

## Product outcome

N1-B adds an explicit, isolated external path for two provider-intake facts:

- `provider_intake.received` after atomic submission completion;
- `provider_intake.rejected` after an authenticated triage transition.

`provider_intake.correction_requested` remains `test_only` and blocked from pilot until N2. `provider_matched` remains internal. The PR alone cannot enable email: rollout defaults to `disabled`, cutoff is null, event types and recipient hashes are empty, daily cap is zero, and batch size is one.

The external dispatcher is separate from the internal dispatcher. It is POST-only, HMAC-authenticated, replay-protected, idempotent at the provider boundary, has no CORS path and sends no attachments. n8n remains retired.

## User value and release slice

Release slice: `NOTIFICATIONS-N1-INTAKE-EMAILS`.

The provider can eventually receive timely confirmation without manual Finance follow-up. Finance can reduce repetitive status emails while retaining a terminal ledger for missing or invalid recipients.

Proposed PROD week: `2026-W33 / 10-16 August 2026`, subject to Ramon and Carlos approving the release after DEV validation and UAT.

## Functional contract

- Producers are explicit RPC calls; Migration 042 creates no producer trigger, backfill, replay scan, reminder, or top-level enqueue.
- Business idempotency permits at most one material external event per supported intake fact.
- A missing or invalid recipient creates one terminal `no_recipient` ledger row and zero delivery attempts after all earlier rollout and cap gates pass.
- Pending external work expires after 24 hours with `external_dispatch_window_expired`; it is never reactivated or replayed.
- Provider retries retain the same Resend `Idempotency-Key`.
- Ambiguous provider acknowledgement requires manual review and never causes a second provider send.
- Provider authentication failure must validate the circuit-breaker pause result.
- Raw provider errors, payloads, email addresses and business UUIDs are not release evidence.

## Minimal disposable baseline

The integration job starts Supabase local with PostgreSQL 17 and applies this exact ordered `BASELINE_MIGRATIONS` allowlist from canonical `origin/dev`:

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_enums_triggers_indexes.sql`
3. `supabase/migrations/003_functions_rpcs.sql`
4. `supabase/migrations/007_notifications.sql`
5. `supabase/migrations/010_payment_request_notification_events.sql`
6. `supabase/migrations/011_notification_dispatcher_service_rpcs.sql`
7. `supabase/migrations/012_notification_decision_comments_payload.sql`
8. `supabase/migrations/013_notification_decision_event_dedupe.sql`
9. `supabase/migrations/014_notification_decision_event_dedupe_v2.sql`
10. `supabase/migrations/015_disable_legacy_direct_payment_notification_enqueue.sql`
11. `supabase/migrations/018_payment_request_approver_routing.sql`
12. `supabase/migrations/020_normalize_proveedores_canonical.sql`
13. `supabase/migrations/025_provider_intake_foundation.sql`
14. `supabase/migrations/027_provider_intake_edge_support.sql`
15. `supabase/migrations/029_provider_intake_triage.sql`
16. `supabase/migrations/030_provider_intake_action_fingerprint.sql`
17. `supabase/migrations/031_provider_intake_matching.sql`
18. `supabase/migrations/041_notifications_external_isolation.sql`

The first three files are atomic canonical foundations for the required companies, profiles, providers, payments, helpers, triggers and indexes. Migrations 007 and 010-015 provide the ledger, both internal claim RPCs, and the notification helper chain referenced by Migration 018. Migration 018 provides company membership, 020 provides the canonical provider shape, 025/027/029/030/031 provide the intake, triage, action-id and Matching dependencies, and 041 leaves the certified N1-A contract installed. Migration 042, unrelated 033/034 files, unmerged PR migrations and all wildcards are excluded.

The job then runs, in order:

1. N1-B precheck;
2. local Migration 042 with exactly one `BEGIN` and one `COMMIT`;
3. N1-B postcheck;
4. a focused controlled-state snapshot;
5. all 60 SQL contract cases inside their terminal rollback;
6. the postcheck and snapshot comparison again;
7. unconditional sandbox cleanup.

It never links to Supabase, dumps or restores DEV, pushes migrations, uses project secrets, calls Resend or deploys an Edge Function.

## Source validation

The same focal workflow performs:

- an authenticated open-PR inventory proving migration slot 042 has one owner;
- byte-level protection of Migration 041 and the internal dispatcher relative to `origin/dev`;
- minimal product safety checks and `git diff --check`;
- 34/34 triage tests;
- Deno type-checking and the current 55/55 deterministic tests;
- the disposable PostgreSQL integration;
- one sanitized release-readiness artifact retained for three days.

Fingerprints, fingerprint self-tests, live schema clones, anonymous GitHub API calls, temporary runners, per-phase artifacts and R2 taxonomies are outside the critical path.

## Product ratio

The workflow calculates `PRODUCT / (PRODUCT + TEST + WORKFLOW + DOCS_OPS)` from added lines relative to `origin/dev`.

Current consolidated result: `51.1%` (`2972 / 5821` added lines).

`PRODUCT_RATIO_EXCEPTION: DOCUMENTED`

The expected result remains between 50% and 60% because this is an integration-sensitive database and external-delivery slice with Deno tests, 60 transactional SQL contracts, three SQL checks and one disposable workflow. The release-candidate consolidation removes prior ceremony without deleting product tests. Ramon approval is required before the PR can be marked Ready.

## DEV plan

1. Revalidate slot 042 and run the DEV precheck.
2. Merge PR #286 only when separately authorized.
3. Apply Migration 042 once in DEV and run the postcheck.
4. Prove external rows remain zero and rollout remains disabled.
5. Deploy provider-intake and certify source/runtime.
6. Deploy the external dispatcher disabled and certify source/runtime.
7. Configure the HMAC and send-mode secrets with sending disabled.

## Preview and UAT plan

Preview is technically available but is not functional UAT. UAT remains `NOT_EXECUTED`.

Future `test_only` UAT covers received, rejected, idempotency, `no_recipient`, cutoff, allowlist, daily cap, retry/ACK, circuit breaker and zero replay. Correction remains blocked until N2.

## PROD plan and smoke

Promote only the approved `NOTIFICATIONS-N1-INTAKE-EMAILS` slice after DEV validation, UAT, P0=0, P1=0, and Ramon/Carlos approval. PROD smoke covers one received, one rejected, no duplicates, `no_recipient`, daily cap, circuit breaker and safe observability.

## Rollback and observability

Rollback order:

1. pause or disable rollout;
2. redeploy the previous application code;
3. preserve the ledger;
4. do not replay or resend events;
5. forward-fix the additive migration;
6. use a down migration only under separate approval.

Observe event status, attempts, terminal `no_recipient`, retries, manual review, circuit-breaker state and duplicate count. Never expose raw payloads or provider responses.

## Readiness and scope

Definition of Ready is `NOT_READY`; Definition of Done is `NOT_DONE`. Dependencies still include disposable integration PASS, authorized DEV apply, disabled deploys, secrets, UAT and Ramon/Carlos approval.

Out of scope: correction before N2, reminders, backfill, replay, `provider_matched`, converted, payment receipts, N2, N3 and an external portal.

Next action after a passing release-candidate workflow: `NOTIFICATIONS-N1-B-DEV-VALIDATION`.
