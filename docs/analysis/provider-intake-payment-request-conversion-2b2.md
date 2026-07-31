# 2B.2 — Provider intake draft to payment request conversion contract

Status: CONTRACT_ONLY / MOCKED_ONLY / NOT_CERTIFIED / NO_DEV_INTEGRATION  
Governance manifest: 2B2-C1-CONTRACT-ONLY-2026-07-31  
Repository: ramon1415/catalogo-proveedores-flux  
Pinned DEV source: ce590aca9f291cd27f92e8b1de64f07b0de229a8  
2B.1 contract source: PR #283 candidate 2255574774065ae29a43c6c7a0b5835d71da3a28, tree 1df56ff8ecb3cc5f858a1f9418d6bc46e333f671

This document is a design and review artifact. It does not authorize applying SQL, calling Supabase, creating a real payment request, converting an intake, opening a PR, or running UAT.

## Objective

Define the future atomic conversion of one READY_FOR_CONVERSION provider-intake payment draft into exactly one submitted payment_request while preserving the intake, draft, files, routing snapshot, approval gates, and audit evidence.

The C1 candidate contains only a documentary SQL reference, a deterministic pure model, synthetic contract tests, an isolated mocked UI, and a visual-test contract. It is not an implementation against DEV.

## Source contract audit

The contract was derived only from Git objects.

| Source | Pinned identity | Relevant contract |
| --- | --- | --- |
| DEV | ce590aca9f291cd27f92e8b1de64f07b0de229a8 | Current target schema and versioned behavior |
| Migration 00102 | blob aafed29171b22fc955430c46980a1aee3015425d | Companies, catalogs, providers, company bank accounts |
| Migration 00103 | blob 3fd6669fbdb75bf6c72a342e77c8cf35eed4342b | Budget tables |
| Migration 00104 | blob 367896b25391d502967a6eb1ab6c629b0496b70e | payment_requests and payment_request_approvals |
| Migration 00302 | blob 31d91103b7c22ebf77d24cc57cbf8c506c99a669 | Budget RPC |
| Migration 010 | blob f358a6025598d5eeada71543f9962dc5c10c533a | Payment request notification trigger |
| Migrations 018/019 | blobs 05c038016ee8d507d707a37c6317a414ecafb160 / 45826e9727b6a5917f4462826f4ac931024c9662 | Memberships and routing snapshots |
| Migrations 021/023 | blobs fc7e8b7eb50185f70af73135b6a29e56fe5bc731 / 877b6fc73f7670e61ddfd57ec1d334ea327a7ad9 | Approval batches and single_direction |
| Migration 025 | blob 0eaeabeb41e821dbd6113d29d233937158d7f586 | Intake, files, events, one conversion link |
| Migrations 029/030/031 | blobs 06a8c65a0c96d86a53ac40f99bf0e8740ffc74c1 / 7191c16c5c1ef21be057c71f7c3fef6af99ad547 / 749908184607ae1d57880960afc6d9d991af1b7b | Triage actions, fingerprints, provider matching |
| Migration 041 notifications | blob aaf9c2561365e1c99744bd487668961dbf8a6444 | Versioned internal/external lane isolation candidate |
| 2B.1 Migration 041 | PR #283 blob fdbdba8d8dd00b4f2371fd08013a96992b3463b5 | Unapplied draft table/RPC/readiness contract |
| Batch reconciliation architecture | blob d08ffcb02f13d4ccaf1dfbc7a8d108ac166fc8da | Current single_direction semantics |

The observed discovery DEV SHA and CURRENT_DEV_SHA are identical. PR #283 remains open and Draft. The 2B.1 candidate is not contained in DEV and is used only as a contractual source.

No TARGET_SCHEMA_MISMATCH was found for the required mapping. The future integration still depends on enabling the unapplied 2B.1 migration through a separately authorized gate.

## Preconditions

A future deployment may expose the conversion RPC only after all of these conditions are demonstrated:

1. The 2B.1 draft table, helper contracts, event types, and indexes exist at the reviewed identity.
2. The authenticated actor resolves to an active profile with Finance, Admin, or Sysadmin authority.
3. The actor has access to the intake company; Sysadmin global access remains explicit.
4. payment_intake, payment_intake_conversion_drafts, payment_intake_events, payment_requests, and the target catalog contracts match this review.
5. payment_intake_events_action_id_uidx still uniquely covers payment_intake_id plus metadata.action_id.
6. A reviewed solution exists for the payment_request.created notification trigger if zero notification rows or emails are required.
7. The platform migration-history baseline blocker FLUX_DEV_MIGRATION_HISTORY_BASELINE is closed.
8. DEV application and authenticated UAT receive separate express authorization.

## RPC contract

Future signature:

    convert_provider_intake_payment_draft(
      p_payment_intake_id uuid,
      p_expected_intake_status text,
      p_expected_intake_updated_at timestamptz,
      p_expected_draft_version integer,
      p_exchange_rate numeric,
      p_action_id uuid
    ) returns jsonb

Security contract:

- LANGUAGE plpgsql.
- SECURITY DEFINER.
- Fixed search_path = public, pg_temp.
- PUBLIC, anon, and service_role do not receive EXECUTE.
- authenticated may execute only after the integration migration is approved.
- Actor identity comes from current_profile_id and may not be supplied by the caller.
- Finance/Admin/Sysadmin role and company scope are checked before any business write.
- The RPC is a single database transaction; it does not contain transaction-control commands.

## Locks and ordering

The lock order is fixed:

1. Select the payment_intake row FOR UPDATE.
2. Select its payment_intake_conversion_drafts row FOR UPDATE.
3. Revalidate intake and draft optimistic expectations.
4. Revalidate provider, company, memberships, catalogs, routing, account, amount, currency, FX, and budget inputs.
5. Calculate the canonical conversion fingerprint.
6. Resolve action replay or conflict.
7. Insert exactly one payment_requests row.
8. Update exactly one payment_intake row.
9. Insert exactly one append-only converted event.
10. Return after the surrounding transaction commits.

No code path locks the draft before the intake. No partial state is a successful result.

## Readiness recalculation

The conversion RPC does not trust a previously displayed READY_FOR_CONVERSION value. It recalculates readiness under the locks.

Required state:

- intake exists;
- intake.status = in_review;
- expected status equals the locked status;
- expected updated_at equals the locked updated_at;
- created_payment_request_id is null;
- draft exists and its version equals p_expected_draft_version;
- draft.company_id equals intake.company_id;
- all required draft fields are present;
- matched provider exists and is active;
- requester, memberships, approver, and routing are currently valid;
- company-scoped cost center and budget category links are active;
- budget month is the first day of its month;
- method, origin account, amount, currency, FX, date, concept, and notes are valid;
- derived state is READY_FOR_CONVERSION.

Any drift fails closed without writes.

## Mapping

Every row below is material and therefore enters the fingerprint unless marked as generated output.

| Target field | Source type → target type | Nullable | Transformation | Live validation | Invalid result |
| --- | --- | --- | --- | --- | --- |
| proveedor_id | intake.matched_proveedor_id uuid? → uuid? | Target nullable; conversion required | Exact UUID | proveedores row exists and activo is true | provider_invalid |
| company_id | draft.company_id uuid → uuid? | Source required | Exact UUID | Equals intake.company_id; company active; actor scope | company_mismatch / company_invalid |
| cost_center_id | draft.cost_center_id uuid? → uuid? | Conversion required | Exact UUID | Active company_cost_centers link and active cost center | catalog_invalid |
| budget_category_id | draft.budget_category_id uuid? → uuid? | Conversion required | Exact UUID | Active company+center+category link and active category | catalog_invalid |
| budget_month | draft.budget_month date? → date? | Conversion required | No silent month normalization | Must equal date_trunc(month, value) | budget_month_invalid |
| requested_by | draft.requested_by_profile_id uuid? → uuid? | Conversion required | Exact UUID snapshot | Active profile and company membership | requester_invalid |
| approver_id | draft.approver_profile_id uuid? → uuid? | Conversion required | Exact UUID routing snapshot | Different from requester; current membership/role eligibility | approver_invalid |
| approver_assignment_id | draft.approver_assignment_id uuid? → uuid? | Conditional | Exact UUID snapshot | Active matching assignment when a pool exists; null plus approval rule when no pool exists | routing_invalid |
| amount_requested | draft.final_amount numeric(18,2)? → numeric | Required | Preserve exact value; never round the request amount | > 0, scale <= 2, <= 9999999999999999.99 | amount_invalid |
| currency | draft.currency text? → text | Required | Trim and uppercase | Exactly three ASCII uppercase letters | currency_invalid |
| exchange_rate | command numeric → numeric? | Required after normalization | MXN null or 1 becomes 1; non-MXN preserves canonical numeric(18,4) value | See FX policy below | fx_required / fx_invalid |
| company_bank_account_id | draft.company_bank_account_id uuid? → uuid? | Required only for transfer | Exact UUID | Transfer: same company, active, same currency, bank account, account number present. Other methods: null | account_invalid / account_company_mismatch / account_currency_mismatch |
| payment_method | draft.payment_method text? → text? | Required | Trim and lowercase | transfer, cash, check, or other | payment_method_invalid |
| scheduled_payment_date | draft.scheduled_payment_date date? → date? | Required | Exact date | Valid date under the reviewed draft contract | scheduled_date_invalid |
| concept | draft.internal_concept text? → text | Required | Trim only; never truncate | 3..120 characters; no control characters or HTML-like tags | concept_invalid / concept_too_long |
| description | intake.description text? → text? | Optional | Preserve normalized intake value | Locked intake is the source | description_invalid |
| notes | draft.internal_notes text? → text? | Optional | Trim-empty to null | <= 2000; no control characters or HTML-like tags | notes_invalid |
| request_type | constant → payment_request_type | Required | provider_payment | Enum value exists | target_contract_conflict |
| status | constant → payment_request_status | Required | submitted | Enum value exists | target_contract_conflict |

Additional target fields are derived from current Git contracts:

- approver_selection_source is assigned when approver_assignment_id is non-null, otherwise approval_rules.
- request_number comes from generate_payment_request_number for the budget year.
- submitted_at, created_at, and updated_at use the transaction timestamp and are generated outputs, not caller input.
- requires_invoice, invoice_received, and is_extraordinary_adjustment are false.
- verify_budget_availability produces budget_result, budget_decision, budget block reason, and before/after/shortfall snapshots.
- budget verification uses round(amount_requested * exchange_rate, 2), matching the current request creation pattern.

The current 14-argument create_payment_request RPC cannot be reused blindly. It is not SECURITY DEFINER, has no fixed search_path, and cannot receive payment_method, origin account, scheduled date, or the distinct internal concept required here.

## FX contract

The operational FX envelope is semantic numeric(18,4):

- minimum positive value: 0.0001;
- maximum value: 99999999999999.9999;
- maximum scale: 4 decimal places;
- MXN accepts only null or a numeric representation equal to 1 and persists 1;
- every non-MXN currency requires a supplied positive value inside the envelope;
- no non-MXN currency defaults to 1;
- the canonical currency and canonical four-decimal FX value enter the fingerprint.

The four-decimal scale and 0.0001 minimum align with the current payment-request UI step/min hints. The database currently constrains only positivity, so the maximum is an explicit 2B.2 contract decision rather than a claim about an existing DB constraint.

## Origin account contract

For transfer:

- company_bank_account_id is required;
- the row must belong to the draft/intake company;
- active must be true;
- normalized account currency must equal request currency;
- account_type must be bank;
- account_number must be non-empty.

For cash, check, and other, the draft precedent requires company_bank_account_id to remain null. No account data is copied or mutated.

The current 2B.1 readiness checks company and active status but not currency. The conversion therefore performs the stronger live currency revalidation.

## Routing snapshot and approval semantics

requested_by, approver_id, and approver_assignment_id are immutable routing evidence captured from the draft. They are not an approval decision.

Conversion:

- creates no payment_request_approvals row;
- does not set approved_by or approved_at;
- does not make the request approved;
- does not add the request or intake to a batch;
- does not bypass single_direction;
- returns a request whose status is submitted.

Direction still decides later through the company batch. Finance still prepares, closes, releases, and executes through existing gates. The snapshot may be used for traceability and target-trigger compatibility but cannot substitute for the canonical batch decision.

## Budget

The future RPC recalculates budget under the transaction using the current verify_budget_availability contract. A blocked budget result is preserved as a submitted request with its budget snapshot; it is not transformed into an approval or exception approval. Later eligibility and exception handling remain under current workflow gates.

Budget output fields and generated request numbers are not caller-controlled. Their source inputs and the conversion contract version are fingerprinted.

## Idempotency and concurrency

Canonical action identity is the pair payment_intake_id plus p_action_id, enforced by payment_intake_events_action_id_uidx whenever metadata.action_id is present.

The converted event stores non-null:

- contract_version = 1;
- action_kind = convert_provider_intake_payment_draft;
- action_id;
- action_fingerprint;
- actor_profile_id;
- payment_request_id;
- draft_version;
- contains_sensitive_fields = false.

Resolution rules:

| Condition | Result | Writes |
| --- | --- | --- |
| Same intake, actor, action kind, contract version, action ID, and fingerprint with a consistent completed triple | idempotent_replay | 0 |
| Same intake/action ID with different actor, action kind, contract version, or fingerprint | action_material_conflict | 0 |
| Valid link/status/request/event already exists for a different action | already_converted | 0 |
| Expected intake status differs | stale_intake_status | 0 |
| Expected intake updated_at differs | stale_intake_updated_at | 0 |
| Expected draft version differs | stale_draft_version | 0 |
| Two concurrent clicks | One conversion; loser resolves from the unique action event/link | 1 total conversion |
| Partial or contradictory request/link/status/event state | invariant_conflict | 0 |
| Failure after request insertion | raised error; transaction rollback | 0 committed |

A unique_violation on the action event or one-link constraints is never treated as success without rereading the completed invariant and comparing the exact fingerprint. No automatic repair is permitted.

## Material fingerprint

The SHA-256 fingerprint is computed from a stable, versioned JSON object containing at least:

- contract version and action kind;
- intake ID plus the caller's expected status and expected updated_at optimistic tokens;
- draft ID and expected/current version;
- actor profile ID;
- canonical target key `proveedor_id` sourced from `intake.matched_proveedor_id`;
- every required mapping source;
- description and notes;
- request_type and submitted status constants;
- approver_selection_source;
- normalized currency, payment method, concept, and FX;
- budget inputs and the extraordinary=false constant.

The provider material uses exactly one canonical key: `TARGET_KEY = proveedor_id`, with `SOURCE_PATH = intake.matched_proveedor_id`. The source name is not emitted as a second fingerprint key.

Generated request number, generated payment request ID, and transaction timestamps are excluded because they are outputs.

## Transactional invariants and rollback

Successful completion has exactly:

- one new payment_requests row;
- one payment_intake row updated to status converted and linked to that request;
- one new payment_intake_events row with event_type converted;
- the existing draft unchanged;
- existing payment_intake_files unchanged.

Every thrown error, including an injected failure after request insertion, rolls back the request, link, status transition, and event together. There is no partial-success result.

The RPC performs no repair of old invariant conflicts.

## Events

payment_intake_events remains append-only. Conversion appends one converted event with from_status in_review and to_status converted. It includes action identity and safe IDs only; it does not include amounts, bank data, document paths, raw notes, secrets, or provider contact data.

The draft itself is not updated. Its post-conversion derived display state becomes ALREADY_CONVERTED because the intake link/status changed.

## Documents and Storage

No file is copied. No Storage object is read, written, moved, or deleted. No documents or document_links rows are created.

Traceability is preserved by:

    payment_intake
      -> payment_intake_files
      -> payment_intake.created_payment_request_id
      -> payment_requests.id

The draft remains evidence. Any future document-copy or document-linking design requires a separate contract and authorization.

## Existing side effects

The target table has these relevant triggers in the reviewed Git contract:

| Trigger | Timing/object | Function/effect | Contract decision |
| --- | --- | --- | --- |
| validate_payment_request_approver_scope_insert | BEFORE INSERT payment_requests | Validates requester, membership, approver, assignment/source snapshot | Must remain enabled and pass |
| mark_payment_request_material_change | payment_requests write | Records material-change timestamp | Internal target behavior; do not bypass |
| payment_request_created_notification_event | AFTER INSERT payment_requests | Calls enqueue_payment_request_created_notification and inserts one or more payment_request.created notification_events for internal roles | REAL_DEV_INTEGRATION_BLOCKER when zero notification rows/emails are required |

The notification trigger catches failures as warnings, has no per-call GUC or bypass, and does not roll back the request when enqueue fails. This contract neither disables nor modifies it.

Migration 041 for notifications defines audience=internal for legacy payment-request events and a separate external-provider lane whose rollout starts disabled. However, its header says draft/unapplied, and this gate does not query DEV. Therefore actual runtime isolation cannot be certified here.

Required future decision: provide and review a transactional, concurrency-safe isolation mechanism for the existing payment_request.created trigger, or explicitly authorize its internal queue effect for integration. Disabling a global trigger inside the conversion RPC is not acceptable.

## Exclusions

This candidate does not:

- deploy SQL or create a migration;
- call Supabase or use DEV configuration;
- create a real payment_request;
- modify a real intake, draft, provider, file, account, approval, batch, layout, payment, receipt, or notification;
- copy Storage objects;
- authenticate users;
- run UAT;
- modify PR #283 or its branch;
- open a 2B.2 PR;
- mark anything Ready or merge.

## Real integration blockers

1. FLUX_DEV_MIGRATION_HISTORY_BASELINE.
2. 2B.1 migration is not applied and real DEV UAT is incomplete.
3. Runtime existence and identity of all reviewed objects remain unverified because Supabase reads are prohibited.
4. The payment_request.created notification trigger has no safe suppression contract.
5. FX policy must be accepted in the future integration review.
6. Document-copy behavior remains explicitly excluded.
7. The routing snapshot versus single_direction reconciliation must remain visible in implementation review.
8. Future reconciliation must prove the request/link/event triple and notification behavior under concurrency.

## Future handoff

The next possible gate is 2B2-CERTIFICATION-C2-CONTRACT-ONLY. It may certify only the mocked, non-write candidate and is not automatically authorized.

A later integration gate must independently pin its source SHAs, close platform blockers, implement a migration, solve or authorize notification behavior, apply SQL only with express approval, and run authenticated DEV UAT under a separate mandate.
