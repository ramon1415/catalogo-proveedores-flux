import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";

// El 11-ago-2026 (commit 7e0aa3d) se consolidaron 86 migraciones en un único
// baseline autoritativo de DEV. La versión previa de este contrato afirmaba
// `files.length === 1`, cierto SOLO el día de la consolidación: cada migración
// de producto posterior lo rompía. El invariante que importa es otro y no
// caduca: hay exactamente UN baseline, es el primero de la cadena, y ninguna
// versión se repite (dos archivos con el mismo timestamp aplican en orden
// indefinido).
const BASELINE = /brownfield_baseline/;

test("brownfield active migration baseline is unique", async () => {
  const files = (await readdir(new URL("../../supabase/migrations/", import.meta.url)))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const baselines = files.filter((name) => BASELINE.test(name));
  assert.equal(baselines.length, 1, `active chain must contain exactly one brownfield baseline, found: ${baselines.join(", ") || "none"}`);
  assert.equal(files[0], baselines[0], "the baseline must be the first migration of the active chain");

  const versions = files.map((name) => name.split("_", 1)[0]);
  const repetidas = versions.filter((v, i) => versions.indexOf(v) !== i);
  assert.deepEqual(repetidas, [], `active migration versions must be unique, repeated: ${repetidas.join(", ")}`);
});
