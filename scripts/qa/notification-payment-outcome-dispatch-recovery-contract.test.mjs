import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260831155017_notification_payment_outcome_dispatch_recovery_dev.sql",
    import.meta.url,
  ),
  "utf8",
);

const retryMigration = readFileSync(
  new URL(
    "../../supabase/migrations/20260831201500_notification_payment_outcome_authorized_retry_dev.sql",
    import.meta.url,
  ),
  "utf8",
);

const dispatcher = readFileSync(
  new URL("../../supabase/functions/notification-dispatcher/index.ts", import.meta.url),
  "utf8",
);

function extractFunction(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = migration.match(
    new RegExp(
      `create or replace function public\\.${escaped}\\(\\)[\\s\\S]*?\\n\\$\\$;`,
      "i",
    ),
  );
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

test("payment outcomes use one fail-closed immediate wake-up", () => {
  const wakeup = extractFunction("notification_payment_outcome_dispatch_wakeup_internal");

  assert.match(migration, /create trigger notification_payment_outcome_dispatch_after_insert/i);
  assert.match(migration, /new\.event_type in \([\s\S]*payment_request\.approved[\s\S]*payment_receipt\.linked/i);
  assert.match(migration, /new\.status = 'pending'/i);
  assert.match(wakeup, /notification_payment_outcome_immediate_enabled/);
  assert.match(wakeup, /notification_payment_outcome_dispatcher_url/);
  assert.match(wakeup, /notification_payment_outcome_cutoff_at/);
  assert.match(wakeup, /notification_dispatcher_secret/);
  assert.match(wakeup, /select net\.http_post\(/i);
  assert.match(wakeup, /'event_types', jsonb_build_array\([\s\S]*payment_request\.approved[\s\S]*payment_receipt\.linked/i);
  assert.match(wakeup, /'created_at_from', v_cutoff/);
  assert.doesNotMatch(wakeup, /api\.resend\.com|insert into public\.notification_events/i);
  assert.doesNotMatch(migration, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/);
});

test("five-minute recovery is gated and calls the same exact event types", () => {
  const recovery = extractFunction("notification_payment_outcome_recovery_wakeup_internal");

  assert.match(migration, /create extension if not exists pg_cron with schema pg_catalog/i);
  assert.match(migration, /'notification-payment-outcome-recovery-dev'/);
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
  assert.match(recovery, /notification_payment_outcome_recovery_enabled/);
  assert.match(recovery, /notification_payment_outcome_cutoff_at/);
  assert.match(recovery, /payment_request\.approved/);
  assert.match(recovery, /payment_receipt\.linked/);
  assert.match(recovery, /exception when others then[\s\S]*return null/i);
  assert.doesNotMatch(recovery, /api\.resend\.com|update public\.notification_events/i);
});

test("trigger and recovery functions are not callable by API roles", () => {
  assert.match(
    migration,
    /revoke all on function public\.notification_payment_outcome_dispatch_wakeup_internal\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.notification_payment_outcome_recovery_wakeup_internal\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
  assert.match(migration, /claim_notification_events_for_dispatcher_v2/);
  assert.match(migration, /notification_payment_outcome_acl_invalid/);
});

test("authorized DEV retries are exact clones and service-only", () => {
  assert.match(retryMigration, /source_folio = 'SOL-2026-0118'/);
  assert.match(retryMigration, /recipient_email\)\) = 'ramon@quantta\.mx'/);
  assert.match(retryMigration, /payment_request\.approved/);
  assert.match(retryMigration, /payment_receipt\.linked/);
  assert.match(retryMigration, /original\.status = 'sent'/);
  assert.match(retryMigration, /retry\.source_id is not distinct from original\.source_id/);
  assert.match(retryMigration, /retry\.recipient_email = original\.recipient_email/);
  assert.match(retryMigration, /dev-intended-recipient-retry:v1:/);
  assert.match(retryMigration, /dev_retry_original_event_id/);
  assert.match(retryMigration, /dev_intended_recipient_retry/);
  assert.match(
    retryMigration,
    /revoke all on function public\.notification_dev_intended_recipient_retry_authorized\(uuid, text\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    retryMigration,
    /grant execute on function public\.notification_dev_intended_recipient_retry_authorized\(uuid, text\)[\s\S]*to service_role/i,
  );
  assert.doesNotMatch(retryMigration, /RESEND_API_KEY|NOTIFICATION_DISPATCHER_SECRET|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/);
});

test("dispatcher preserves a retry recipient only after the database authorization", () => {
  assert.match(dispatcher, /event\.payload\?\.dev_intended_recipient_retry === true/);
  assert.match(dispatcher, /notification_dev_intended_recipient_retry_authorized/);
  assert.match(dispatcher, /authorized !== true/);
  assert.match(dispatcher, /dev_intended_recipient_retry_not_authorized/);
  assert.match(
    dispatcher,
    /preserveAuthorizedIntendedRecipient = false/,
  );
  assert.match(
    dispatcher,
    /return sendMode === "test_only" \? testEmail : intendedRecipient/,
  );
});
