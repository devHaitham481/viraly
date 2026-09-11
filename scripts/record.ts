/**
 * Record live HTTP responses into `fixtures/`, so the eval suite can run offline.
 *
 * Run deliberately — `npm run record` — never as part of a test. The whole value of the suite is
 * that it does NOT touch the network; re-recording is how a fixture is intentionally refreshed, and
 * the resulting diff is how a real upstream change becomes visible.
 *
 * Be sparing. Recording hits real, rate-limited services (PRD §9.9).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR, fixtureKey, liveCtx, type Manifest } from "../lib/fetcher.ts";
import { lookupUrl, searchUrl } from "../lib/sources/itunes.ts";
import { hnSearchUrl } from "../lib/sources/hackernews.ts";

/** Every URL the eval suite is allowed to see. Add a case here before writing a test for it. */
const TARGETS: { label: string; url: string }[] = [
  { label: "search-habitkit", url: searchUrl("HabitKit") },
  { label: "search-ngl", url: searchUrl("ngl") },
  { label: "search-empty-ish", url: searchUrl("zzqxwvnothingapp") },
  { label: "lookup-habitkit", url: lookupUrl("6443918070") },
  { label: "lookup-impostor", url: lookupUrl("6761298880") },
  { label: "lookup-missing", url: lookupUrl("1") },
  { label: "hn-habitkit", url: hnSearchUrl("habitkit.app") },
  { label: "hn-nothing", url: hnSearchUrl("zzqxwv-no-such-domain.example") },
];

async function main() {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const ctx = liveCtx();
  const manifest: Manifest = {};

  for (const { label, url } of TARGETS) {
    process.stdout.write(`  ${label.padEnd(20)} `);
    try {
      const body = await ctx.fetchText(url);
      const file = `${label}.${fixtureKey(url)}.json`;
      await writeFile(path.join(FIXTURE_DIR, file), body);
      manifest[fixtureKey(url)] = {
        url,
        file,
        recorded_at: new Date().toISOString(),
        status: 200,
        bytes: body.length,
      };
      console.log(`ok  ${body.length.toLocaleString()} bytes`);
    } catch (err) {
      console.log(`FAILED  ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    // Deliberate pacing. These are shared, rate-limited services.
    await new Promise((r) => setTimeout(r, 600));
  }

  await writeFile(
    path.join(FIXTURE_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`\n${Object.keys(manifest).length} fixtures → fixtures/manifest.json`);
}

main();
