# Provider intake and batch reconciliation

## Reviewed baseline

- Repository: `ramon1415/catalogo-proveedores-flux`
- Branch baseline: `origin/dev`
- Commit reviewed: `0876623b37cc74bdf43bb42afea9a56207add210`
- Relevant migrations: `023_batch_single_direction_approval_and_resubmission.sql` and `024_allow_fully_rejected_approval_batches.sql`
- `CLAUDE.md`: not present in the repository at the reviewed commit.

This document reconciles the local Phase 0 portal analysis with the final batch model in DEV. The ten Phase 0 files remain unchanged as historical design evidence.

## Final regular-payment contract

The current regular flow is:

1. An internal requester submits a `payment_request`.
2. Budget availability is validated automatically.
3. Finance prepares the company batch.
4. Direction approves or rejects items in that batch.
5. Finance closes/releases the approved work.
6. Execution occurs through the existing layout, cash, or check controls.

Finance does not provide a separate human approval for each regular request. Direction is resolved by company and weekly batch, not by the public link or intake triage.

## Differences from Phase 0

| Phase 0 assumption | Reconciled decision |
| --- | --- |
| Triage selects an individual approver. | Triage never selects an individual approver for a regular request. |
| Conversion depends on `list_payment_request_approver_options`. | Regular conversion must not depend on that legacy individual-approver path. |
| An intake without an approver cannot convert. | A future conversion requires internal classification and a valid requester, then creates a submitted request that passes budget validation and may become batch-eligible. |
| The conversion wireframe includes an approver control. | The control is removed from the future regular conversion contract. |
| Approval is attached directly to the request during intake conversion. | Direction decides only after the converted request is added to the applicable company batch. |

## Impact of migration 023

Migration 023 established `single_direction` as the regular approval model. Its batch eligibility RPC evaluates actual `payment_requests`, current budget data, company scope, missing operational fields, prior Direction decisions, and execution history. It also preserves rejected-item history and supports corrected resubmission without overwriting the prior decision.

Consequences for provider intake:

- `payment_intake` is not an approval object.
- It is never passed to `list_batch_eligible_requests` or `add_request_to_approval_batch`.
- Only a future converted `payment_request` can be evaluated for a batch.
- Conversion cannot bypass current budget validation, batch state, Direction, Finance release, or execution guards.

## Impact of migration 024

Migration 024 allows Direction to reject every item in a submitted batch while preserving each item for correction and later resubmission. A fully rejected decision set is represented through the existing partially-approved final-state path with rejected items blocked for correction.

This does not make intake batch-aware. Any correction/rebatch lifecycle begins only after a real `payment_request` exists and has entered a batch.

## Phase 1A boundary

Migration 025 creates only the secure intake foundation:

- link configuration with token hashes;
- unconverted intake records;
- private file metadata;
- an append-only intake event ledger;
- RLS-scoped internal reads;
- the private `intake-uploads` bucket.

It does not create public links, public data, Edge Functions, frontend routes, providers, payment requests, notifications, or batch items.

## Future conversion contract

Phase 2 may convert an intake only after internal triage has resolved:

- canonical provider matching or an explicitly authorized provider-creation path;
- company, cost center, budget category, budget month, amount, and currency;
- an internal `requested_by` profile with active company membership;
- required payment data and validated documents;
- budget outcome under the current request workflow.

The conversion must be idempotent, set `created_payment_request_id` once, and leave the resulting request submitted and eligible for the normal company batch only when the canonical batch RPC says it is eligible.

The future conversion must not:

- assign an individual approver for a regular request;
- add `payment_intake` itself to a batch;
- mark a request approved;
- update canonical provider banking data automatically;
- bypass budget, Direction, Finance release, or execution controls.

## Decisions still pending

- Which internal profile becomes `requested_by` during conversion.
- Whether that profile is the Finance operator or a configured technical requester per company.
- Final triage RPC contracts and status-transition rules.
- Provider matching and authorized provider creation.
- CAPTCHA provider and persistent rate-limit design.
- File malware scanning and retention policy.
- Supplier acknowledgement and status communication in later phases.

None of these pending decisions is implemented by migration 025.
