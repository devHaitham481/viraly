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
import { wayback } from "../lib/sources/wayback.ts";
import { appstore } from "../lib/sources/appstore.ts";
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
const HABITKIT = {
  name: "Habit Tracker - HabitKit", domain: "habitkit.app", ios_id: "6443918070",
  play_id: null, founder: "Sebastian Roehl", founder_source: null, artwork: null,
  store_url: "https://apps.apple.com/us/app/habit-tracker-habitkit/id6443918070",
  handles: {},
};

const wb = await wayback.collect(HABITKIT, ctx);
const as = await appstore.collect(HABITKIT, ctx);
await writeFile(path.join(OUT, "appstore-habitkit.json"),
  JSON.stringify({ events: as.events, metrics: as.metrics }, null, 2) + "\n");
console.log(`  appstore     ${as.events.length} events, ${as.metrics.length} metric points`);
await writeFile(path.join(OUT, "wayback-habitkit.json"), JSON.stringify(wb.events, null, 2) + "\n");
console.log(`  wayback      ${wb.events.length} positioning changes`);

console.log(`\n${Object.keys(GOLDEN).length + 2} golden files → fixtures/golden/`);
