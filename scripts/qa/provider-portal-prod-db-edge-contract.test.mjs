import fs from "node:fs";
import path from "node:path";

const fail = (message) => { throw new Error(message); };
const manifest = JSON.parse(fs.readFileSync("docs/ops/provider-portal-prod-runtime-manifest.json", "utf8"));
const migrationFiles = fs.readdirSync("supabase/migrations").filter((f) => /_provider_portal_prod_.*\.sql$/.test(f)).sort();
if (migrationFiles.length !== 4) fail("expected 4 forward migrations; got " + migrationFiles.length);
const versions = migrationFiles.map((f) => f.slice(0, 14));
if (new Set(versions).size !== 4 || versions.some((v) => v <= "20260817230000")) fail("invalid forward migration versions");
const sql = migrationFiles.map((f) => fs.readFileSync(path.join("supabase/migrations", f), "utf8")).join("\n");

for (const required of [
  "provider_intake_runtime_control", "disabled", "sysadmin_only", "full",
  "provider_intake_public_access_allowed", "provider_intake_internal_access_allowed",
  "payment_intake_conversion_drafts", "convert_provider_intake_to_payment_request",
  "create_provider_intake_link_v2", "resolve_provider_aware_intake_link_internal",
  "create_provider_aware_intake_internal", "MASTER_CONFIRMED", "CHANGE_DECLARED",
]) if (!sql.includes(required)) fail("missing SQL contract: " + required);
for (const forbidden of [
  "create function public.create_provider_intake_link(",
  "create function public.regenerate_provider_intake_link(",
  "create function public.resolve_provider_intake_link_internal(",
  "notification_outbox", "enqueue_notification", "n8n", "resend",
]) if (sql.toLowerCase().includes(forbidden.toLowerCase())) fail("forbidden SQL delta: " + forbidden);
if (!/default 'disabled'/.test(sql) || !sql.includes("values (true, 'disabled')")) fail("runtime does not fail closed");
if (!sql.includes("provider_intake_require_emergency_sysadmin_access")) fail("emergency revoke contract missing");

const edge = fs.readdirSync("supabase/functions/provider-intake");
for (const required of ["index.ts","handler.ts","repository.ts","captcha.ts","cors.ts","files.ts","validation.ts","prod-config.ts","prod-config_test.ts"]) {
  if (!edge.includes(required)) fail("missing Edge source: " + required);
}
const edgeText = edge.filter((f) => f.endsWith(".ts")).map((f) => fs.readFileSync(path.join("supabase/functions/provider-intake", f), "utf8")).join("\n");
for (const required of [
  "INTAKE_ALLOW_QUERY_TOKEN", "INTAKE_ALLOWED_ORIGINS", "CAPTCHA_EXPECTED_HOSTNAME",
  "CAPTCHA_EXPECTED_ACTION", "INTAKE_PRIVACY_NOTICE_URL", "intake-uploads",
  "resolve_provider_aware_intake_link_internal", "create_provider_aware_intake_internal",
]) if (!edgeText.includes(required)) fail("missing Edge contract: " + required);
for (const forbidden of ["scsirgbuqjcwoaxfacth", "catalogo-proveedores-flux-git-dev", "Ambiente DEV", "?token=", "notification_outbox", "enqueue_notification", "resend.com"]) {
  if (edgeText.toLowerCase().includes(forbidden.toLowerCase())) fail("forbidden Edge delta: " + forbidden);
}
const nonTestEdge = edge.filter((f) => f.endsWith(".ts") && !f.endsWith("_test.ts") && f !== "prod-config.ts")
  .map((f) => fs.readFileSync(path.join("supabase/functions/provider-intake", f), "utf8")).join("\n");
if (nonTestEdge.includes("1x0000000000000000000000000000000AA")) fail("Turnstile test secret in runtime source");
const prodConfig = fs.readFileSync("supabase/functions/provider-intake/prod-config.ts", "utf8");
if (!prodConfig.includes("TURNSTILE_TEST_SECRETS") || !prodConfig.includes("test_key_forbidden")) fail("Turnstile test-key denylist missing");
if (!fs.readFileSync("supabase/config.toml", "utf8").includes("verify_jwt = false")) fail("public Edge JWT contract missing");
if (manifest.default_mode !== "disabled" || manifest.legal_content_approval_pending !== true) fail("release manifest is not fail-closed");
if (manifest.provider_intake_notification_release_delta !== 0) fail("notification release delta is non-zero");
console.log("PROVIDER_PORTAL_PROD_DB_EDGE_CONTRACT_PASS=true");
