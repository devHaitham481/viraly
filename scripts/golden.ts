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
import { missingNeeds, SOURCES } from "../lib/sources/registry.ts";
import type { Coverage, Event, Metric } from "../lib/schema.ts";
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

/**
 * One complete crawl, every source merged — what the landing page shows.
 *
 * The page needs a real result to display, and a fabricated one would violate rule #1 on the most
 * visible surface the project has. This is the recorded HabitKit crawl, run offline through the
 * same registry the worker uses, so what a visitor sees is what a crawl produces.
 */
const DEMO_APP = {
  ...HABITKIT,
  name: "HabitKit",
  play_id: "com.roehl.habitkit",
  founder_source: "itunes",
  artwork: null,
};

const demoEvents: Event[] = [];
const demoMetrics: Metric[] = [];
const demoCoverage: Coverage[] = [];

const resolved = await lookupApp(GOLDEN.habitkit, ctx);
demoEvents.push(...resolved.events);
demoMetrics.push(...resolved.metrics);
demoCoverage.push({ ...resolved.coverage, source: "itunes" });

for (const source of SOURCES) {
  const missing = missingNeeds(source, DEMO_APP);
  if (missing.length) {
    demoCoverage.push({ source: source.id, status: "blocked", note: `missing ${missing.join(", ")}` });
    continue;
  }
  const out = await source.collect(DEMO_APP, ctx);
  demoEvents.push(...out.events);
  demoMetrics.push(...out.metrics);
  demoCoverage.push({ ...out.coverage, source: source.id });
}

demoEvents.sort((a, b) => a.date.localeCompare(b.date));
demoMetrics.sort((a, b) => a.date.localeCompare(b.date));

await writeFile(
  path.join(OUT, "demo-habitkit.json"),
  JSON.stringify(
    {
      // Stamped so the page can say when, rather than implying the data is live.
      recorded_at: FROZEN_NOW.slice(0, 10),
      app: { ...DEMO_APP, artwork: resolved.app.artwork },
      events: demoEvents,
      metrics: demoMetrics,
      coverage: demoCoverage,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `  demo         ${demoEvents.length} events, ${demoMetrics.length} metrics, ` +
    `${demoCoverage.filter((c) => c.status === "ok" || c.status === "partial").length}/${demoCoverage.length} sources`,
);

console.log(`\n${Object.keys(GOLDEN).length + 3} golden files → fixtures/golden/`);
