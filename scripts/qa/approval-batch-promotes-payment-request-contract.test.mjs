import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260830231333_approval_batch_promotes_payment_request.sql",
  import.meta.url,
);

const sql = await readFile(migrationUrl, "utf8");

function functionBlock(name) {
  const marker = new RegExp(
    `create or replace function public\\.${name}\\(`,
    "i",
  );
  const start = sql.search(marker);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = sql.indexOf("\ncreate or replace function public.", start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
}

test("weekly-cut approval bridge is private, audited and transactional", () => {
  const helper = functionBlock("approval_batch_promote_request_approved");
  const auditIndex = helper.search(/insert into public\.payment_request_approvals/i);
  const statusIndex = helper.search(/update public\.payment_requests[\s\S]*status = 'approved'/i);

  assert.match(helper, /security definer/i);
  assert.match(helper, /set search_path = pg_catalog, public, pg_temp/i);
  assert.match(helper, /for update/i);
  assert.match(helper, /payment_request_approver_role_names\(\)/i);
  assert.match(helper, /payment_request_not_approvable_from_batch/i);
  assert.match(helper, /payroll_batch_requires_authenticated_selected_approver/i);
  assert.match(helper, /'finance_validation'[\s\S]*'scheduled'[\s\S]*'paid'[\s\S]*return false;/i);
  assert.ok(auditIndex >= 0, "approval audit insert is missing");
  assert.ok(statusIndex > auditIndex, "audit must be inserted before status changes");
  assert.match(helper, /from_status[\s\S]*to_status[\s\S]*'approved'/i);
  assert.match(
    sql,
    /revoke all on function public\.approval_batch_promote_request_approved\(uuid,uuid,uuid\)[\s\S]*from public, anon, authenticated, service_role/i,
  );
});

test("both weekly-cut decision paths promote approved requests", () => {
  const approveAll = functionBlock("approve_entire_batch_internal");
  const decideItems = functionBlock("decide_approval_batch_items");

  assert.match(approveAll, /approval_batch_promote_request_approved\(/i);
  assert.match(approveAll, /for update of item/i);
  assert.match(approveAll, /'promoted_requests', v_promoted/i);
  assert.match(decideItems, /if v_status = 'approved'[\s\S]*approval_batch_promote_request_approved\(/i);
  assert.match(decideItems, /for update/i);
  assert.match(decideItems, /'promoted_requests', v_promoted/i);
  assert.doesNotMatch(decideItems, /v_status = 'rejected'[\s\S]{0,300}approval_batch_promote_request_approved\(/i);
});

test("weekly-cut approval never creates or populates a payment layout", () => {
  assert.doesNotMatch(sql, /create_payment_layout/i);
  assert.doesNotMatch(sql, /insert into public\.payment_layouts/i);
  assert.doesNotMatch(sql, /insert into public\.payment_layout_lines/i);
  assert.match(sql, /It never creates a payment layout/i);
});

test("public RPC grant remains scoped to authenticated directors", () => {
  assert.match(
    sql,
    /revoke all on function public\.decide_approval_batch_items\(uuid,jsonb\)[\s\S]*from public, anon, service_role/i,
  );
  assert.match(
    sql,
    /grant execute on function public\.decide_approval_batch_items\(uuid,jsonb\)[\s\S]*to authenticated/i,
  );
  assert.match(sql, /approval_batch_require_active_direction\(\)/i);
  assert.match(sql, /v_batch\.director_id <> v_actor/i);
});
