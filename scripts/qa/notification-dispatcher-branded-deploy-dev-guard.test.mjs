import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { certifiedDispatcherFiles, verifyDispatcherBundle, gitBlobSha } from './verify-dispatcher-bundle.mjs';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const expectedBlob = certifiedDispatcherFiles['index.ts'];
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
  assert.match(workflow, /node scripts\/qa\/verify-dispatcher-bundle\.mjs/);
  assert.match(workflow, /actual != \{"verify_jwt": False\}/);
  verifyDispatcherBundle(new URL("../../supabase/functions/notification-dispatcher/", import.meta.url));
  assert.match(workflow, /version: 2\.113\.0/);

  const deployCommands = workflow.match(/\bsupabase functions deploy\b/g) ?? [];
  assert.equal(deployCommands.length, 1);
  assert.doesNotMatch(workflow, /\bsupabase\s+(?:db|migration|secrets|functions\s+invoke)\b/);
  assert.doesNotMatch(workflow, /\/functions\/v1\//);
  assert.doesNotMatch(workflow, /\b(?:psql|curl|wget|pg_dump)\b/);
});

for (const change of ['extra', 'changed', 'missing']) {
  test(`dispatcher certificate rejects ${change} bundle content`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'flux-dispatcher-'));
    try {
      cpSync(new URL('../../supabase/functions/notification-dispatcher/', import.meta.url), directory, { recursive: true });
      if (change === 'extra') writeFileSync(join(directory, 'unexpected.ts'), '');
      if (change === 'changed') writeFileSync(join(directory, 'jspdf_edge.ts'), 'changed');
      if (change === 'missing') rmSync(join(directory, 'deno.json'));
      assert.throws(() => verifyDispatcherBundle(directory));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
}
