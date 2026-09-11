import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR } from "../lib/fetcher.ts";
import { auditCrawl } from "../lib/audit.ts";
import type { Event, Metric } from "../lib/schema.ts";

const ev = (over: Partial<Event> = {}): Event => ({
  date: "2023-05-05", kind: "product_change", title: "x", source: "appstore",
  by: null, by_founder: true, url: "https://example.com/x", number: null, date_exact: true, ...over,
});
const mt = (date: string, value: number, metric = "ios_rating_count"): Metric => ({
  date, metric, value, url: "https://example.com/x",
});

const rules = (v: { rule: string }[]) => v.map((x) => x.rule);

/**
 * Each case below is a bug this project actually shipped and then fixed. The unit tests pin the fix;
 * these pin the *class*, so the same shape of error is caught on an app nobody has looked at.
 */
describe("invariants catch the bugs we have already had", () => {
  test("another app's version history", () => {
    // Shipped: a store page embeds the versionHistory of every app it links to.
    const v = auditCrawl(
      [1, 9, 12, 17, 2025].map((n) => ev({ title: `Version ${n}.1.0 released` })),
      [],
    );
    assert.ok(rules(v).includes("version_families"));
  });

  test("a cumulative series that falls", () => {
    // The signature of parsing the wrong app's page, or of two crawls mixed together.
    const v = auditCrawl([], [mt("2024-01-01", 500), mt("2024-06-01", 120)]);
    assert.ok(rules(v).includes("series_decreased"));
  });

  test("a raw id_ capture linked to a human", () => {
    // Shipped: `id_` renders unstyled and broken.
    const v = auditCrawl([ev({ url: "http://web.archive.org/web/2022id_/https://x.com/" })], []);
    assert.ok(rules(v).includes("raw_capture_link"));
  });

  test("a date that cannot be real", () => {
    const v = auditCrawl([ev({ date: "1998-01-01" }), ev({ date: "2099-01-01" })], []);
    assert.ok(rules(v).includes("date_before_epoch"));
    assert.ok(rules(v).includes("date_in_future"));
  });

  test("a placeholder evidence URL", () => {
    // REVIEW.md rule #1: every event needs a real fetched URL.
    const v = auditCrawl([ev({ url: "<wayback capture>" })], []);
    assert.ok(rules(v).includes("evidence_url"));
  });

  test("the same event reported twice", () => {
    // Shipped: two SKUs at one price each emitted "Added plan: Pro $1.99/month".
    const v = auditCrawl([ev({ title: "Added plan" }), ev({ title: "Added plan" })], []);
    assert.ok(rules(v).includes("duplicate_event"));
  });

  test("an archive interstitial that became an event", () => {
    const v = auditCrawl(
      [ev({ title: 'Positioning changed to: "Wayback Machine"', source: "wayback" })],
      [],
    );
    assert.ok(rules(v).includes("archive_interstitial"));
  });

  test("App Store events but no growth series", () => {
    // Would fire if Apple moved the JSON-LD and the rating parse silently stopped working.
    const v = auditCrawl([ev({ source: "appstore" })], []);
    assert.ok(rules(v).includes("appstore_no_growth"));
  });
});

describe("real HabitKit output is clean", () => {
  test("no violations across the golden corpus", async () => {
    const read = async (f: string) =>
      JSON.parse(await readFile(path.join(FIXTURE_DIR, "golden", f), "utf8"));
    const [wb, as, it] = await Promise.all([
      read("wayback-habitkit.json"), read("appstore-habitkit.json"), read("habitkit.json"),
    ]);
    const v = auditCrawl(
      [...wb, ...as.events, ...it.events],
      [...as.metrics, ...it.metrics],
      { today: "2026-12-31" },
    );
    assert.deepEqual(v, [], `violations: ${JSON.stringify(v, null, 2)}`);
  });
});
