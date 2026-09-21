import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

test("required extension bootstrap precedes every dependent schema object", async () => {
  const root = new URL("../../supabase/migrations/", import.meta.url);
  // Ver brownfield-baseline-uniqueness: la cadena activa ya no es un solo
  // archivo desde la consolidación del 11-ago-2026. El bootstrap de
  // extensiones vive en el baseline, que es lo que hay que leer.
  const files = (await readdir(root)).filter((name) => name.endsWith(".sql")).sort();
  const baselines = files.filter((name) => /brownfield_baseline/.test(name));
  assert.equal(baselines.length, 1, "expected exactly one active brownfield baseline");
  const sql = await readFile(new URL(baselines[0], root), "utf8");
  const extension = /create\s+extension\s+if\s+not\s+exists\s+"?btree_gist"?\s+with\s+schema\s+"?[^";\s]+"?\s*;/i.exec(sql);
  const consumer = /add\s+constraint\s+"?no_double_blocked_booking_same_space"?\s+exclude\s+using\s+"?gist"?/i.exec(sql);
  assert.ok(extension, "btree_gist bootstrap must be present using the discovered DEV schema");
  assert.ok(consumer, "venue booking exclusion constraint must remain semantically intact");
  assert.ok(extension.index < consumer.index, "btree_gist must be installed before UUID GiST consumer");
});
