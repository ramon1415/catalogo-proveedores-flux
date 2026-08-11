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
  "../../.github/workflows/supabase-dev-notification-dispatcher.yml",
  import.meta.url,
);
const sourceBytes = readFileSync(sourcePath);
const source = sourceBytes.toString("utf8");
const workflow = readFileSync(workflowPath, "utf8");

function gitBlobSha(bytes) {
  const canonicalBytes = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return createHash("sha1")
    .update(`blob ${canonicalBytes.length}\0`)
    .update(canonicalBytes)
    .digest("hex");
}

test("certified dispatcher source is the branded receipt renderer", () => {
  assert.equal(gitBlobSha(sourceBytes), expectedBlob);
  assert.match(source, /role="presentation"/);
  assert.match(source, /max-width:560px/);
  assert.match(source, /background:#16322d/);
  assert.match(source, />Flux<\/td>/);
  assert.match(source, /Flux Operadora &middot; Powered by Quantta/);
  assert.doesNotMatch(source, /<div><p>El pago fue confirmado\.<\/p><table>/);
});

test("DEV workflow deploys only the certified dispatcher to the immutable DEV head", () => {
  assert.match(workflow, /GITHUB_REF\}" != "refs\/heads\/dev"/);
  assert.match(workflow, /scsirgbuqjcwoaxfacth/);
  assert.match(workflow, new RegExp(`EXPECTED_FUNCTION_BLOB: ${expectedBlob}`));
  assert.match(workflow, /current_dev=.*git\/ref\/heads\/dev/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(workflow, /git hash-object "supabase\/functions\/\$\{FUNCTION_NAME\}\/index\.ts"/);
  assert.match(workflow, /actual != \{"verify_jwt": False\}/);
  assert.match(workflow, /function_files\[0\].*supabase\/functions\/\$\{FUNCTION_NAME\}\/index\.ts/);
  assert.match(workflow, /version: 2\.113\.0/);

  const deployCommands = workflow.match(/\bsupabase functions deploy\b/g) ?? [];
  assert.equal(deployCommands.length, 1);
  assert.doesNotMatch(workflow, /\bsupabase\s+(?:db|migration|secrets|functions\s+invoke)\b/);
  assert.doesNotMatch(workflow, /\/functions\/v1\//);
  assert.doesNotMatch(workflow, /\b(?:psql|curl|wget|pg_dump)\b/);
});
