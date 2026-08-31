import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveFinalRecipient } from "../../supabase/functions/notification-dispatcher/index.ts";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260831210159_notification_dev_dynamic_business_recipients.sql",
    import.meta.url,
  ),
  "utf8",
);

const dispatcher = readFileSync(
  new URL(
    "../../supabase/functions/notification-dispatcher/index.ts",
    import.meta.url,
  ),
  "utf8",
);

test("DEV business recipient authorization is service-only and fail-closed", () => {
  assert.match(migration, /security definer/i);
  assert.match(migration, /event\.status = 'processing'/);
  assert.match(migration, /event\.audience = 'internal'/);
  assert.match(migration, /recipient\.active is true/);
  assert.match(migration, /event\.recipient_profile_id = request\.approver_id/);
  assert.match(migration, /company_director\.active is true/);
  assert.match(migration, /membership\.active is true/);
  assert.match(
    migration,
    /event\.recipient_profile_id = request\.requested_by/,
  );
  assert.match(migration, /receipt_link\.payment_request_id/);
  assert.match(
    migration,
    /revoke all on function public\.notification_dev_business_recipient_authorized\(uuid, text\)[\s\S]*from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.notification_dev_business_recipient_authorized\(uuid, text\)[\s\S]*to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /RESEND_API_KEY|NOTIFICATION_DISPATCHER_SECRET|sb_secret_|eyJ[A-Za-z0-9_-]{20,}/,
  );
});

test("dispatcher validates every dynamic business recipient before preserving it", () => {
  assert.match(dispatcher, /devBusinessRecipientEventTypes/);
  assert.match(dispatcher, /payment_request\.created/);
  assert.match(dispatcher, /payment_request\.approved/);
  assert.match(dispatcher, /payment_receipt\.linked/);
  assert.match(dispatcher, /notification_dev_business_recipient_authorized/);
  assert.match(dispatcher, /dev_business_recipient_not_authorized/);
  assert.match(dispatcher, /authorized !== true/);
});

test("an authorized selected Director or request owner is preserved in test_only", () => {
  assert.equal(
    resolveFinalRecipient(
      "payment_request.created",
      "cesar@quantta.mx",
      "test_only",
      "ramon.hipo1@gmail.com",
      true,
    ),
    "cesar@quantta.mx",
  );
  assert.equal(
    resolveFinalRecipient(
      "payment_request.approved",
      "ramon@quantta.mx",
      "test_only",
      "ramon.hipo1@gmail.com",
      true,
    ),
    "ramon@quantta.mx",
  );
  assert.equal(
    resolveFinalRecipient(
      "payment_request.created",
      "cesar@quantta.mx",
      "test_only",
      "ramon.hipo1@gmail.com",
    ),
    "ramon.hipo1@gmail.com",
  );
});
