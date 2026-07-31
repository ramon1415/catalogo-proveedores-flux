# Notifications N1-A: external isolation contract

Status: hardened Draft candidate for a separately authorized transactional dry-run.
Nothing in this directory was applied to DEV by NOTIFICATIONS-N1-A-C1-R1 or
NOTIFICATIONS-N1-A-R1.

## Baseline and migration number

The candidate was authored from the exact remote baseline:

- dev: 2deae2cddf8ebb22fffd76e7a648483e2b3cc609
- main: 85ec304ba45b9e0531e2cbd1437ba620c7e2ea24
- repository governance file: absent in the complete dev tree
- migration namespace inspected: 62 SQL files
- active three-digit sequence maximum: 040
- Matching migration 031: present and reconciled without modification
- Matching migration 031 blob: 749908184607ae1d57880960afc6d9d991af1b7b
- historical duplicate numbers: 033 and 034, deliberately untouched
- selected number: 041
- 041 and all five N1-A target paths were absent
- no related open PR, branch, or open-PR path collision was present at the original preflight
- hardening branch initial head: edd8f737e57c531a7c867eed857bca4fa70761a6
- hardening target: the existing Draft PR #282; no new branch or PR

Migration 041 is a schema candidate. It is not an authorization to apply SQL, call a
dispatcher, activate a rollout, or send mail.

## Scope

This gate adds only the database contract needed to review same-ledger isolation:

1. A lane discriminator on notification_events.
2. A fail-closed external rollout record.
3. Separate internal and external claim contracts.
4. Aggregate idempotency for three future provider-intake event types.
5. A terminal no_recipient state.
6. Delivery-attempt uniqueness and stale-processing recovery structure.
7. A future submission_completed source contract.
8. Sanitized external message and canonical field-code contracts.
9. Read-only precheck and postcheck plus synthetic contract tests.
10. Pre-apply hardening for the N2 correction gate, atomic daily cap, three-attempt
    ceiling, recovery safety, message privacy, and complete policy inventory.

It adds no external producer, no external notification row, no historical source event,
no backfill, no replay, no reminder, no provider call, no link, and no token. The current
dispatcher and all Edge code remain unchanged.

## N1-A-R1 hardening

The same Draft PR is hardened without applying SQL:

- provider_intake.correction_requested remains part of the schema and may be structurally
  eligible only in test_only;
- pilot mode cannot include correction_requested in rollout configuration, and the external
  claim independently enforces the same event/mode rule;
- N2 must explicitly migrate both barriers before any correction pilot is possible;
- the external claim locks the exact notification_external_rollouts row with FOR UPDATE
  before evaluating the daily count, so concurrent claims on that rollout serialize;
- each external event has max_attempts=3 and must be inserted with attempt_count=0, no locks,
  no processing timestamp, no last-attempt timestamp, and no delivery attempt;
- stale recovery refuses automatic requeue after any provider request start, completion,
  provider message ID, or sent attempt;
- external_message normalizes spaces and hyphens before detecting long numeric sequences and
  rejects both physical-person and legal-entity RFC patterns;
- precheck and postcheck inventory every notification policy using sanitized counts and fail
  closed on additional permissive authenticated policies;
- authenticated visibility remains explicitly audience=internal, anon has no SELECT, and
  rollout configuration remains service-only.

No claim, producer, provider call, event, attempt, or email is executed by this hardening gate.

## Matching 031 reconciliation

Migration 031 is preserved byte-for-byte and remains an internal workflow. It touches
payment_intake, payment_intake_events, and proveedores through six functions:

- normalize_provider_match_text(text)
- normalize_provider_match_digits(text)
- provider_intake_match_fingerprint(integer,text,uuid,uuid,text,timestamptz,uuid,uuid,text,text)
- find_provider_intake_candidates(uuid,text,integer)
- get_provider_intake_match_comparison(uuid,uuid)
- set_provider_intake_match(uuid,text,timestamptz,uuid,uuid,text,text,uuid)

The three public Matching RPCs remain SECURITY DEFINER with explicit search_path and
authenticated-only EXECUTE. The three helper functions remain SECURITY INVOKER with no direct
EXECUTE grant to anon, authenticated, or service_role. N1-A neither replaces nor grants any
Matching function.

set_provider_intake_match continues to operate only while the intake is in_review, rejects
an intake with created_payment_request_id, updates only matched_proveedor_id and updated_at,
and appends provider_matched with contract_version 3. Its internal metadata, including score,
confidence, action kind, previous/new provider IDs, reason code, and notes, is never admitted
to an external payload.

provider_matched is explicitly constrained to keep external_message, external_field_codes,
and external_contract_version null. It is absent from the external event-type validator,
rollout allowlist, source mapping, and external claim. There is no generic intake-event
fallback.

submission_completed is independent of Matching: it does not require matched_proveedor_id and
does not alter Matching status or function contracts.


## Same-ledger isolation

notification_events gains audience with NOT NULL and default internal. PostgreSQL can
classify all existing rows through the added default; migration 041 contains no historical
UPDATE. Internal rows must keep all external-only columns null.

The existing claim_notification_events_for_dispatcher(integer,text) keeps its signature,
return shape, limit, ordering, locking, SKIP LOCKED behavior, attempt rules, and service-only
grants. Its only selection change is audience = internal. The older admin/manual
claim_pending_notification_events(integer,text) is also preserved exactly except for the same
internal-lane filter, so no existing claim surface can capture an external row.

The external claim is a separate service-only RPC. It has no audience parameter and a hard
maximum batch of one. It selects and locks the exact eligible rollout row with FOR UPDATE
SKIP LOCKED before counting daily processing/sent events and before claiming the event. That
row lock is the per-rollout serialization point; there is no global or caller-derived advisory
lock and no count-then-claim window. It can consider only pending external rows for the exact
event allowlist and only when every rollout gate is satisfied. It also checks both the source
timestamp and notification timestamp against the cutoff, a hashed recipient allowlist,
attempts, max_attempts=3, and the daily cap. Initial configuration makes it return zero:

- mode: disabled
- cutoff: null
- enabled event types: empty
- recipient allowlist hashes: empty
- batch size: 1
- daily cap: 0

No plaintext recipient allowlist is stored. Population and operational governance of the
hash allowlist remain a later, separately authorized N1-B/UAT decision.

correction_requested is additionally blocked from pilot in two places: a rollout CHECK rejects
pilot plus that event type, and the event/mode helper used by the claim accepts correction only
for test_only. received and rejected remain structurally compatible with pilot, but the seeded
disabled rollout makes every event ineligible. N2 must change this database contract explicitly;
there is no default capability switch and no backlog is created.

Authenticated read policies are narrowed to internal rows. The migration precheck rejects any
additional permissive SELECT/ALL policy for authenticated or public beyond the two approved
internal notification policies. The postcheck inventories all policies on notification_events,
notification_delivery_attempts, and notification_external_rollouts and requires every
permissive notification policy applicable directly or through role membership to authenticated
to contain the internal audience restriction.
Anon retains no SELECT and service_role retains its operational table privileges. External rollout configuration,
external payloads, and external attempts remain service-only.

## Antispam and aggregate identity

Only these future external event types are admitted:

- provider_intake.received
- provider_intake.correction_requested
- provider_intake.rejected

The aggregate subject is payment_intake. One partial unique index admits at most one row per
audience, event type, payment intake, and event version. notification_events.idempotency_key
remains globally unique and must equal:

- external:provider_intake.received:{payment_intake_id}:v1
- external:provider_intake.correction_requested:{payment_intake_id}:v1
- external:provider_intake.rejected:{payment_intake_id}:v1

The payment_intake_events row remains source evidence, but its id is never the aggregate
deduplication dimension. A retry reuses the same notification event and the same provider
idempotency key. A new technical correction cycle cannot create a second automatic external
correction. A new version cannot be used to evade the cap without a future versioned contract.

There is no backfill, replay, reminder, or historical eligibility.

## Submission completion

The early payment_intake_events.received row is not a valid source for an external received
notification. The external contract maps provider_intake.received only to a unique
submission_completed source event.

Migration 041 adds nullable structure only:

- payment_intake.expected_file_count, constrained to 0 through 3
- payment_intake.submission_completed_at
- payment_intake_events event type submission_completed
- one partial unique index per payment intake
- a guard that requires system authorship, a received intake, completion timestamp, exact
  attached-file count, and no recorded upload issue
- no dependency on matched_proveedor_id

No producer is included and no historical completion event is created.

The current GitHub ledger proves upload issues are terminal for the existing intake contract:

- handler.ts creates the intake before Storage upload and file-metadata attachment;
- on upload or metadata failure it performs best-effort cleanup and calls
  mark_provider_intake_upload_issue_internal;
- Migration 027 moves the intake to needs_correction and appends status_changed with issue_code;
- provider-intake-edge-contract-v1.md states that failed uploads require a later correction
  flow and an idempotent retry does not silently attach a second file set;
- the current handler and RPC surface contain no issue-resolution operation.

Migration 041 therefore retains the historical issue veto. It does not invent resolution
semantics, weaken the exact file-count check, or add a submission_completed producer. A future
authorized correction flow must define resolution-aware completion before changing this veto.

The current remote handler also proves expected_file_count is knowable before intake creation:
handler.ts validates the incoming file collection before createIntake. A future N1-B transaction
can store that already-known count; this PR does not change the handler.

## External message contract

payment_intake_events gains three nullable columns for future correction and rejection source
evidence:

- external_message
- external_field_codes
- external_contract_version

Legacy rows may keep all three null. provider_matched rows must keep all three null. Future
external fields require contract version 1. external_message is trimmed plain text, 10 through
1000 characters, and rejects control characters, HTML, URLs, email addresses, Matching terms,
scoring terms, provider IDs, and internal-governance terms. It also removes spaces and hyphens
for validation and rejects normalized numeric sequences of ten or more digits, covering phone,
account, card-like, and CLABE formats. Mexican RFC patterns for both personas físicas and
personas morales are rejected while safe instructions such as “Corrige el RFC registrado.”
remain valid. Values stay out of the message; correction meaning is carried by field_codes.
The message must be distinct from internal notes.

Correction requires one or more unique canonical field codes. Rejection requires no field
codes. The notification payload copies only the sanitized external message and allowed field
codes from its exact source evidence.

## Canonical field-code mapping

Only codes with an exact current column, property, or file_kind are allowed:

| Canonical code | Current contract source | Future provider label |
| --- | --- | --- |
| provider_name | payment_intake.provider_name | Nombre o razón social |
| provider_rfc | payment_intake.provider_rfc | RFC |
| provider_email | payment_intake.provider_email | Correo |
| provider_phone | payment_intake.provider_phone | Teléfono |
| concept | payment_intake.concept | Concepto |
| description | payment_intake.description | Descripción |
| amount_requested | payment_intake.amount_requested | Importe solicitado |
| currency | payment_intake.currency | Moneda |
| requested_payment_date | payment_intake.requested_payment_date | Fecha solicitada |
| invoice_folio | payment_intake.invoice_folio | Folio de factura |
| invoice_uuid | payment_intake.invoice_uuid | UUID fiscal |
| invoice_date | payment_intake.invoice_date | Fecha de factura |
| invoice_pdf | payment_intake_files.file_kind | Factura PDF |
| invoice_xml | payment_intake_files.file_kind | Factura XML |
| bank_document | payment_intake_files.file_kind | Documento bancario |
| beneficiary_name | payment_intake.beneficiary_name | Beneficiario |

provider_rfc is the sole canonical RFC code. Generic amount, invoice-reference, and
banking-information aliases were rejected because they do not map exactly to one current
column or safe file kind. bank_account and bank_clabe are deliberately not exposed as field
codes. support and other are also excluded because they are not stable semantic fields.

Final Carlos copy and labels remain N1-B work and do not block isolation review.

## External payload allowlist

Common exact keys:

- event_version
- template_version
- locale
- public_folio
- occurred_on

Correction adds only external_message and field_codes. Rejection adds only external_message.
Received adds nothing. Unknown keys fail closed.

Payloads cannot contain internal notes, recipient email, business UUID values, provider
matching data, scores, approvers, budget, amount values, RFC values, accounts, CLABE, files,
paths, tokens, arbitrary metadata, or third-party data. subject remains null for external
rows.

The source guard also verifies payment-intake ownership, event-type mapping, public folio,
occurred date, recipient, message, and field-code equality.

## no_recipient and delivery attempts

no_recipient is external-only, terminal, and immutable. Every external event has
max_attempts=3. On INSERT it requires attempt_count=0, cleared locks, null processed_at, null
last_attempt_at, and no delivery attempt. no_recipient additionally requires a null recipient,
null next attempt, cleared locks, and terminal_reason no_recipient. The external claim selects
pending only. A trigger rejects every delivery attempt for a no_recipient event.

notification_delivery_attempts gains a unique index on notification_event_id and
attempt_number. Optional external columns record the provider idempotency key, a safe error
code, and request start/completion timestamps. Migration 041 performs no historical attempt
UPDATE.

The service-only recovery RPC is limited to one stale external processing row and a minimum
10-minute lease. It reopens the same event without changing its idempotency key or attempt
count only when no delivery attempt records provider_request_started_at,
provider_request_completed_at, provider_message_id, or status=sent. Any evidence of a started,
accepted, or unknown-result provider call leaves the event untouched for future manual review.
Recovery cannot see internal/no_recipient rows, requires an enabled rollout window, and never
calls a provider or inserts an attempt. No caller is added.

## Files

- supabase/migrations/041_notifications_external_isolation.sql: unapplied database candidate
- ops/notifications/n1-a/precheck.sql: read-only baseline and duplicate guard
- ops/notifications/n1-a/postcheck.sql: read-only structural and zero-row verification
- ops/notifications/n1-a/contract-tests.sql: 55 synthetic/catalog contract cases with rollback
- ops/notifications/n1-a/README.md: scope, invariants, evidence, and future runbook

## Future authorized apply sequence

Do not execute this sequence during N1-A-R1. In the separately authorized N1-A-R2 gate:

1. Revalidate the exact dev baseline and migration number.
2. Run precheck.sql read-only and retain only sanitized aggregates.
3. Review migration 041 and its plan in an isolated non-live environment.
4. Apply the candidate only with explicit authorization.
5. Run postcheck.sql read-only and compare aggregate history counts.
6. Run contract-tests.sql only in an isolated disposable environment.
7. Keep rollout disabled and create no external producer.
8. Stop for review.

The immediate next gate is NOTIFICATIONS-N1-A-R2 only with Ramón's express authorization.
That gate may perform a transactional dry-run with ROLLBACK and zero persistent change.
N1-B, rollout activation, any dispatcher consumer, any provider call, and any email remain
outside this PR.
