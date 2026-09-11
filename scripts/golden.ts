/**
 * Regenerate the golden outputs from the recorded fixtures.
 *
 * Run only when a change to the expected output is the *intent* of the work. Regenerating to make a
 * failing test pass turns the eval suite into a rubber stamp (REVIEW.md rule #4).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR, loadManifest, replayCtx } from "../lib/fetcher.ts";
import { lookupApp } from "../lib/sources/itunes.ts";
import { FROZEN_NOW, GOLDEN } from "../tests/helpers.ts";

const OUT = path.join(FIXTURE_DIR, "golden");

const manifest = await loadManifest();
const ctx = replayCtx(manifest, FROZEN_NOW);
await mkdir(OUT, { recursive: true });

for (const [name, iosId] of Object.entries(GOLDEN)) {
  const { app, events, metrics, coverage } = await lookupApp(iosId, ctx);
  const result = {
    app,
    events: events.sort((a, b) => a.date.localeCompare(b.date)),
    metrics,
    coverage: [coverage],
  };
  await writeFile(path.join(OUT, `${name}.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(`  ${name.padEnd(12)} ${events.length} events, ${metrics.length} metrics`);
}
console.log(`\n${Object.keys(GOLDEN).length} golden files → fixtures/golden/`);
