import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const expectedBlob = "a45a3c099cf267575b587a195e1747ce12492323";
const sourcePath = new URL(
  "../../supabase/functions/notification-dispatcher/index.ts",
  import.meta.url,
);
const workflowPath = new URL(
  "../../.github/workflows/supabase-prod-notification-dispatcher-deploy.yml",
  import.meta.url,
);
const runbookPath = new URL(
  "../../docs/ops/notification-dispatcher-presentation-only-deploy.md",
  import.meta.url,
);
const sourceBytes = readFileSync(sourcePath);
const source = sourceBytes.toString("utf8");
const workflow = readFileSync(workflowPath, "utf8");
const runbook = readFileSync(runbookPath, "utf8");

function gitBlobSha(bytes) {
  const canonicalBytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return createHash("sha1")
    .update(`blob ${canonicalBytes.length}\0`)
    .update(canonicalBytes)
    .digest("hex");
}

test("certified PROD source is the same branded receipt renderer proven in DEV", () => {
  assert.equal(gitBlobSha(sourceBytes), expectedBlob);
  assert.match(source, /role="presentation"/);
  assert.match(source, /max-width:560px/);
  assert.match(source, /background:#16322d/);
  assert.match(source, />Flux<\/td>/);
  assert.match(source, /Flux Operadora &middot; Powered by Quantta/);
  assert.doesNotMatch(source, /<div><p>El pago fue confirmado\.<\/p><table>/);
});

test("PROD workflow is immutable, deploy-only, and cannot replay notifications", () => {
  assert.match(workflow, /\[\[ "\$\{GITHUB_REF\}" = "refs\/heads\/main" \]\]/);
  assert.match(workflow, /ucantptjhwttexzmslvm/);
  assert.match(workflow, /FORBIDDEN_DEV_REF: scsirgbuqjcwoaxfacth/);
  assert.match(workflow, new RegExp(`EXPECTED_FUNCTION_BLOB: ${expectedBlob}`));
  assert.match(workflow, /current_main=.*git\/ref\/heads\/main/);
  assert.match(workflow, /ref: \$\{\{ inputs\.target_git_sha \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git hash-object "supabase\/functions\/\$\{FUNCTION_NAME\}\/index\.ts"/);
  assert.match(workflow, /\[\[ ! -e "supabase\/config\.toml" \]\]/);
  assert.match(workflow, /find "supabase\/functions" -type f/);
  assert.match(workflow, /function_files\[0\].*supabase\/functions\/\$\{FUNCTION_NAME\}\/index\.ts/);
  assert.match(workflow, /--no-verify-jwt/);
  assert.match(workflow, /--use-api/);
  assert.match(workflow, /version: 2\.113\.0/);

  const deployCommands = workflow.match(/\bsupabase functions deploy\b/g) ?? [];
  assert.equal(deployCommands.length, 1);
  assert.doesNotMatch(workflow, /\bsupabase\s+(?:db|migration|secrets|functions\s+invoke)\b/);
  assert.doesNotMatch(workflow, /\/functions\/v1\//);
  assert.doesNotMatch(workflow, /\b(?:psql|curl|wget|pg_dump)\b/);
  assert.doesNotMatch(workflow, /NOTIFICATION_(?:SEND_MODE|TEST_EMAIL|DISPATCHER_SECRET)/);
  assert.doesNotMatch(workflow, /supabase\/migrations\//);
  assert.doesNotMatch(workflow, /receipt_linked_phase_a_disabled/);
});

test("runbook preserves DEV-first order and forbids Phase A reuse or replay", () => {
  assert.match(runbook, /DEV first/i);
  assert.match(runbook, /a45a3c099cf267575b587a195e1747ce12492323/);
  assert.match(runbook, /Do not run.*Phase A/is);
  assert.match(runbook, /do not invoke.*PROD/is);
  assert.match(runbook, /do not requeue.*sent/is);
});
