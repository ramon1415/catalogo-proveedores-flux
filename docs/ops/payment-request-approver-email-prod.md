# Payment request approver email — selective PROD forward

Status: candidate only. Not deployed, not activated, and no production cutoff exists.

## Release identity

- Base: current `main` at `7573ef86ba8d55f96343a772d94de38e89cb4d88`.
- DEV-certified functional source: Draft PR #365 at
  `7f5aa222c790ed6a031fcac73860bf0fd0e5b454`.
- PR #147 is closed and not part of this release path.
- No DEV merge is included.
- Forward migration:
  `20260817230000_payment_request_approver_email_prod.sql`.

## Closed product contract

Only `payment_request.created` is eligible. The recipient snapshot is exclusively
`payment_requests.approver_id -> profiles.id -> profiles.email`. The producer
uses one stable idempotency key per request and approver notification, so the
maximum is one email per newly created request.

The release does not add notifications for approvals, rejections, requested
changes, exceptions, extraordinary authorizations, reminders, or any other
`payment_request.*` event. It does not email the requester and does not fall
back or broadcast to an approver pool.

## Historical isolation

The authoritative activation boundary is:

```sql
event.event_type = 'payment_request.created'
and event.created_at > activation_cutoff
```

The boundary is strictly greater-than. Events before or exactly at the future
cutoff are permanently ineligible. The migration does not update, delete,
archive, claim, or create delivery attempts for existing events.

The C2-R2 read-only PROD observation at
`2026-08-17T22:58:34.971567Z` found:

- created events: 9;
- pending: 9;
- delivery attempts: 0;
- duplicate idempotency keys: 0;
- recipient snapshot mismatches: 0;
- missing profile/email snapshots: 0.

This timestamp is evidence only and is not an activation cutoff.

## no_recipient

The forward migration extends the notification status constraint with the
terminal status `no_recipient`. Only `recipient_email_missing` uses it.
Missing approver identity, missing profile, ineligible approver, and unexpected
producer exceptions preserve their existing `dead_letter` semantics.

A `no_recipient` event has no email address, no next attempt, is excluded by
the strict claim, creates zero delivery attempts, and makes zero Resend calls.
There is no fallback recipient.

## Dispatcher delta

The dispatcher delta is the byte-certified C1 dispatcher source from PR #365.
It adds:

- an exclusive `payment_request.created` request scope;
- the strict created-event claim RPC while preserving raw cutoff microseconds;
- a branded approver renderer;
- the subject `Nueva solicitud de pago: {folio}`;
- header `Nueva solicitud por revisar`;
- copy `Se generó una solicitud de pago que requiere tu revisión.`;
- CTA `Revisar solicitud` to
  `https://flux.quantta.mx/aprobaciones.html`;
- folio, company, requester, provider, amount, currency, cost center, and budget
  category;
- text and HTML versions;
- zero attachments.

The dispatcher rejects mixed created-event scopes. Existing event types keep
their current route.

## payment_receipt.linked regression boundary

The receipt renderer, individual-PDF attachment resolver, Resend transport,
generic claim v2 route, receipt wake-up, receipt trigger, receipt cutoff, and
the existing five-minute receipt recovery workflow are unchanged.

The migration fails closed against the observed PROD receipt fingerprints and
does not redefine any receipt function or trigger. C2-R2 observed six receipt
events, six sent events, and six delivery attempts.

## Wake-up design

The new trigger listens only to inserted, pending
`payment_request.created` events. It reads one authoritative cutoff from Vault,
requires the created-specific enable flag, parses the cutoff, and returns
without a network request unless:

```text
new.created_at > activation_cutoff
```

The wake-up uses `pg_net`, so the HTTP request is released only after the
database transaction commits. The migration creates no Vault entries and leaves
the wake-up unconfigured and disabled for C3.

## Recovery design

The isolated workflow
`.github/workflows/supabase-prod-payment-request-created-recovery.yml` runs on
a five-minute schedule but its job is disabled unless the separate production
environment variable
`NOTIFICATION_PROD_PAYMENT_REQUEST_CREATED_RECOVERY_ENABLED` is explicitly
`true`.

When a later gate enables it, the workflow reads the same authoritative cutoff
and dispatcher URL from Vault in a read-only transaction. It invokes the
dispatcher once with only `payment_request.created`, limit 5, and no blind
retry. It never reads or changes the receipt scheduler.

The recovery flag remains absent/false through C3 and may be activated only
after the controlled C4 smoke.

## Write-once activation plan

This candidate prepares the Vault name
`notification_payment_request_created_cutoff_at` as the single source used by
the wake-up and recovery lane. The claim receives that exact value through the
dispatcher request.

The migration does not create or update this name. C4 must capture a fresh
microsecond-precision timestamp and create it once under a separate,
fail-if-present write-once procedure. No DEV cutoff is embedded in PROD source.

## Release sequence

1. C3: after separate authorization, merge the reviewed PR, apply exactly the
   new forward migration, deploy the dispatcher, and leave cutoff, wake-up, and
   recovery absent/disabled.
2. C4: after separate authorization, capture and write the fresh cutoff once,
   activate the primary wake-up, create one controlled new request, prove one
   email to its selected approver, then enable recovery.
3. Rollback: disable created-specific wake-up and recovery first, preserve the
   append-only ledger, redeploy the prior dispatcher if needed, and use a
   forward fix for schema changes. Do not replay historical events.

## Candidate safety

```text
BACKFILL=0
HISTORICAL_REPLAY=0
OLD_PENDING_REPROCESS=0
REMINDERS=0
MAX_EMAILS_PER_REQUEST=1

PROD_NOT_DEPLOYED=1
PROD_NOT_ACTIVATED=1
ACTIVATION_CUTOFF_CREATED=0
PROD_DDL=0
PROD_DML=0
DISPATCHER_INVOCATIONS=0
RESEND_CALLS=0
EMAILS=0
```
