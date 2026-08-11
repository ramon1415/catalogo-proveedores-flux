import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

test("brownfield active migration baseline is unique", async () => {
  const files = (await readdir(new URL("../../supabase/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const versions = files.map((name) => name.split("_", 1)[0]);
  assert.equal(files.length, 1, "active chain must contain only the brownfield baseline before product migrations");
  assert.equal(new Set(versions).size, versions.length, "active migration versions must be unique");
});
