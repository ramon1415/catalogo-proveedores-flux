import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION = path.join(
  ROOT,
  "supabase/migrations/20260903234917_payment_request_exception_quick_service_role_guard.sql",
);

test("forward migration accepts the effective PostgREST service role", () => {
  assert.equal(fs.existsSync(MIGRATION), true);
  const sql = fs.readFileSync(MIGRATION, "utf8");

  assert.match(
    sql,
    /current_setting\('role',\s*true\)[\s\S]*?<>\s*'service_role'/,
  );
  assert.match(
    sql,
    /current_setting\('request\.jwt\.claim\.role',\s*true\)[\s\S]*?<>\s*'service_role'/,
  );
  assert.match(sql, /quick_approval_service_role_required/);
});

test("the internal guard remains private", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");

  assert.match(
    sql,
    /revoke all on function public\.payment_request_exception_quick_require_service_role\(\)[\s\S]*?from public, anon, authenticated, service_role;/i,
  );
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.payment_request_exception_quick_require_service_role\(\)/i,
  );
});
