import assert from "node:assert/strict";
import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260825040134_approval_batch_decision_submitter_email_pdf_prod.sql";
const wakeupMigrationPath =
  "supabase/migrations/20260825040140_approval_batch_decision_wakeup_prod.sql";
const dispatcherPath = process.env.DISPATCHER_PATH ||
  "supabase/functions/notification-dispatcher/index.prod.ts";
const pdfModulePath =
  "supabase/functions/notification-dispatcher/approval_batch_decision_pdf.ts";
const migration = fs.readFileSync(migrationPath, "utf8");
const wakeupMigration = fs.readFileSync(wakeupMigrationPath, "utf8");
const dispatcher = fs.readFileSync(dispatcherPath, "utf8");
const pdfModule = fs.readFileSync(pdfModulePath, "utf8");
const decisionImplementation = `${dispatcher}\n${pdfModule}`;
const deno = JSON.parse(
  fs.readFileSync(
    "supabase/functions/notification-dispatcher/deno.json",
    "utf8",
  ),
);

assert.ok(
  migration.includes("new.status in ('approved', 'partially_approved')"),
);
assert.ok(migration.includes("profile.id = new.submitted_by"));
assert.ok(migration.includes("v_submitter.id, v_submitter.email"));
assert.ok(
  migration.includes("coalesce(new.submitted_by::text, 'missing_submitter')"),
);
assert.doesNotMatch(migration, /flux_finance_roles/);
assert.doesNotMatch(migration, /for v_recipient in/i);
assert.match(migration, /get_approval_batch_decision_notification_document/);
assert.ok(
  migration.includes("recipient_profile_id is distinct from v_submitter.id"),
);
assert.match(migration, /from public, anon, authenticated/);
assert.match(migration, /to service_role/);

assert.match(dispatcher, /approval_batch.approved/);
assert.match(dispatcher, /approval_batch.partially_approved/);
assert.match(dispatcher, /prepareApprovalBatchDecisionAttachment/);
assert.match(dispatcher, /get_approval_batch_decision_notification_document/);
assert.match(decisionImplementation, /"Decision", "Motivo"/);
assert.match(dispatcher, /PDF final adjunto incluye la decisión y el motivo/);
assert.match(dispatcher, /max-width:560px/);
assert.match(dispatcher, /Flux Operadora &middot; Powered by Quantta/);
assert.match(dispatcher, /Idempotency-Key/);
assert.match(
  dispatcher,
  /payment_request_created_dispatch_scope_must_be_exclusive/,
);
assert.match(dispatcher, /claim_payment_request_created_events_for_dispatcher/);
assert.match(dispatcher, /createdAtAfterExclusive/);
assert.match(dispatcher, /claim_approval_batch_decision_events_for_dispatcher/);
assert.match(dispatcher, /decisionOnly/);
assert.match(
  dispatcher,
  /catalogo-proveedores-flux-git-dev-quantta-team\.vercel\.app/,
);
assert.equal(deno.imports["jspdf-core"], "npm:jspdf@2.5.2");
assert.equal(deno.imports["jspdf-autotable"], "npm:jspdf-autotable@3.8.4");

assert.match(wakeupMigration, /event\.created_at > p_created_at_after/);
assert.match(
  wakeupMigration,
  /event\.recipient_profile_id = batch\.submitted_by/,
);
assert.match(wakeupMigration, /notification_approval_batch_decision_cutoff_at/);
assert.match(
  wakeupMigration,
  /notification_approval_batch_decision_immediate_enabled/,
);
assert.match(
  wakeupMigration,
  /notification_approval_batch_decision_dispatch_after_insert/,
);
assert.ok(!wakeupMigration.includes("set status = 'pending'"));

assert.match(wakeupMigration, /PROD activation cutoff/);
assert.match(wakeupMigration, /edge-notification-dispatcher-prod/);

console.log("approval batch decision PROD notification contract: PASS");
