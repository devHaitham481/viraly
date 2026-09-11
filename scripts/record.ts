/**
 * Record live HTTP responses into `fixtures/`, so the eval suite can run offline.
 *
 * Run deliberately — `npm run record` — never as part of a test. The whole value of the suite is
 * that it does NOT touch the network; re-recording is how a fixture is intentionally refreshed, and
 * the resulting diff is how a real upstream change becomes visible.
 *
 * Be sparing. Recording hits real, rate-limited services (PRD §9.9).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR, fixtureKey, liveCtx, type Manifest } from "../lib/fetcher.ts";
import { lookupUrl, searchUrl } from "../lib/sources/itunes.ts";
import { hnSearchUrl } from "../lib/sources/hackernews.ts";
import { captureUrl, cdxUrl, sampleCaptures } from "../lib/sources/wayback.ts";
import { sampleEvenly, storeCaptureUrl, storeCdxUrl } from "../lib/sources/appstore.ts";
import { postUrlsFromSitemap, sitemapUrls } from "../lib/sources/blog.ts";
import { reposUrl } from "../lib/sources/github.ts";
import { playCaptureUrl, playCdxUrl, playUrl } from "../lib/sources/playstore.ts";

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
  { label: "site-habitkit", url: "https://habitkit.app/" },
  { label: "sitemap-habitkit", url: sitemapUrls("habitkit.app")[0] },
  { label: "gh-sebastianroehl", url: reposUrl("sebastianroehl") },
  { label: "play-live-habitkit", url: playUrl("com.roehl.habitkit") },
  { label: "play-cdx-habitkit", url: playCdxUrl("com.roehl.habitkit") },
];

/**
 * Wayback targets can't be listed up front — the capture URLs come from CDX. Fetch the index, take
 * the same sample the source would, and record each one so extraction can be tuned offline.
 */
async function waybackTargets(ctx: { fetchText(u: string): Promise<string> }, domain: string) {
  const rows = (JSON.parse(await ctx.fetchText(cdxUrl(domain))) as string[][]).slice(1);
  return sampleCaptures(rows).map(([ts, original], i) => ({
    label: `wb-${domain.split(".")[0]}-${String(i).padStart(2, "0")}-${ts.slice(0, 8)}`,
    url: captureUrl(ts, original),
  }));
}

/** The product's own blog posts, listed by its sitemap. */
async function blogTargets(ctx: { fetchText(u: string): Promise<string> }, domain: string) {
  const xml = await ctx.fetchText(sitemapUrls(domain)[0]);
  return postUrlsFromSitemap(xml, domain).map((url, i) => ({
    label: `post-${domain.split(".")[0]}-${String(i).padStart(2, "0")}`,
    url,
  }));
}

/** Archived Play listings — the second growth series. */
async function playTargets(ctx: { fetchText(u: string): Promise<string> }, pkg: string) {
  const rows = (JSON.parse(await ctx.fetchText(playCdxUrl(pkg))) as string[][]).slice(1);
  const step = Math.max(1, Math.floor((rows.length - 1) / 15));
  return rows
    .filter((_, i) => i % step === 0)
    .slice(0, 16)
    .map(([ts, original], i) => ({
      label: `play-habitkit-${String(i).padStart(2, "0")}-${ts.slice(0, 8)}`,
      url: playCaptureUrl(ts, original),
    }));
}

/** Archived App Store listings, for the growth curve. Same shape as waybackTargets. */
async function storeTargets(ctx: { fetchText(u: string): Promise<string> }, storeUrl: string) {
  const rows = (JSON.parse(await ctx.fetchText(storeCdxUrl(storeUrl))) as string[][]).slice(1);
  return sampleEvenly(rows).map(([ts, original], i) => ({
    label: `as-habitkit-${String(i).padStart(2, "0")}-${ts.slice(0, 8)}`,
    url: storeCaptureUrl(ts, original),
  }));
}

const HABITKIT_STORE = "https://apps.apple.com/us/app/habit-tracker-habitkit/id6443918070";

async function main() {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const ctx = liveCtx({ timeoutMs: 60_000 });
  const force = process.argv.includes("--force");

  // Keep what is already recorded. Re-fetching 24 archive.org captures to add one fixture is how a
  // throttle gets earned (PRD §9.9). `--force` re-records everything.
  let manifest: Manifest = {};
  if (!force) {
    try {
      manifest = JSON.parse(await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8"));
    } catch {
      /* first run */
    }
  }

  const targets = [
    ...TARGETS,
    { label: "wb-cdx-habitkit", url: cdxUrl("habitkit.app") },
    ...(await waybackTargets(ctx, "habitkit.app")),
    { label: "as-cdx-habitkit", url: storeCdxUrl(HABITKIT_STORE) },
    ...(await storeTargets(ctx, HABITKIT_STORE)),
    ...(await blogTargets(ctx, "habitkit.app")),
    ...(await playTargets(ctx, "com.roehl.habitkit")),
  ];

  for (const { label, url } of targets) {
    if (manifest[fixtureKey(url)]) continue;
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
    // Deliberate pacing. These are shared, rate-limited services — archive.org especially.
    await new Promise((r) => setTimeout(r, url.includes("archive.org") ? 2000 : 600));
  }

  await writeFile(
    path.join(FIXTURE_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(`\n${Object.keys(manifest).length} fixtures → fixtures/manifest.json`);
}

main();
