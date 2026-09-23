import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR } from "../lib/fetcher.ts";
import { buildBrief } from "../lib/brief.ts";
import { computeInsights } from "../lib/insights.ts";
import { buildSteps } from "../lib/impact.ts";
import type { Event, Metric } from "../lib/schema.ts";

const ev = (date: string, over: Partial<Event> = {}): Event => ({
  date, kind: "product_change", title: "x", source: "appstore",
  by: null, by_founder: true, url: "https://example.com", number: null, date_exact: true, ...over,
});
const mt = (date: string, value: number): Metric => ({
  date, metric: "ios_rating_count", value, url: "https://example.com",
});

async function habitkitBrief() {
  const read = async (f: string) =>
    JSON.parse(await readFile(path.join(FIXTURE_DIR, "golden", f), "utf8"));
  const [wb, as, it] = await Promise.all([
    read("wayback-habitkit.json"), read("appstore-habitkit.json"), read("habitkit.json"),
  ]);
  const events = [...wb, ...as.events, ...it.events];
  const metrics = [...as.metrics, ...it.metrics];
  return buildBrief("HabitKit", events, metrics, computeInsights(events, metrics), buildSteps(events, metrics));
}

describe("buildBrief on real data", () => {
  test("states the quiet build, the cadence and the acceleration", async () => {
    const b = await habitkitBrief();
    const all = b.paragraphs.join(" ");
    assert.match(all, /public for 15 months before it launched/);
    assert.match(all, /16 feature releases/);
    assert.match(all, /accelerating 11\.\d×/);
  });

  test("the caveat carries the honesty rules through", async () => {
    // Most steps are unmeasurable; a summary that implied causation would undo lib/impact.ts.
    const b = await habitkitBrief();
    assert.match(b.caveat, /Coincidence is not cause/);
    assert.match(b.caveat, /only 5 have usable growth data/);
  });

  test("never claims a milestone it cannot date", async () => {
    // The 1,000 crossing sits inside a gap between readings, so it must be stated as a range.
    const b = await habitkitBrief();
    assert.match(b.paragraphs.join(" "), /crossed 1,000 somewhere between month \d+ and month \d+/);
  });
});

describe("honesty under sparse data", () => {
  test("says plainly when nothing is measurable", () => {
    const events = [ev("2023-01-01", { kind: "launch" }), ev("2023-06-01")];
    const b = buildBrief("X", events, [], computeInsights(events, []), buildSteps(events, []));
    assert.match(b.caveat, /No step has enough growth data/);
    // And it must not assert any effect.
    assert.equal(/picked up|caused|drove|led to/i.test(b.paragraphs.join(" ")), false);
  });

  test("reports compounding rather than spikes when nothing coincides", () => {
    const events = [ev("2023-01-01", { kind: "launch" }), ev("2023-07-01")];
    const metrics = ["2023-05-01", "2023-06-01", "2023-08-01", "2023-09-01"].map((d, i) =>
      mt(d, 100 + i * 30),
    );
    const b = buildBrief("X", events, metrics, computeInsights(events, metrics), buildSteps(events, metrics));
    assert.match(b.caveat, /compounding, not spikes/);
  });
});

describe("sections are omitted, not padded", () => {
  test("an empty crawl produces a caveat and nothing invented", () => {
    const b = buildBrief("X", [], [], computeInsights([], []), buildSteps([], []));
    assert.deepEqual(b.paragraphs, []);
    assert.ok(b.caveat.length > 0);
    assert.ok(b.headline.length > 0);
  });

  test("no pricing data means no pricing sentence", () => {
    const events = [ev("2023-01-01", { kind: "launch" })];
    const b = buildBrief("X", events, [], computeInsights(events, []), buildSteps(events, []));
    assert.equal(/plan|pricing|\$/i.test(b.paragraphs.join(" ")), false);
  });
});

describe("the brief states quality against scale", () => {
  test("it pairs the average with the count, never the average alone", async () => {
    // "4.9" on its own is a vanity number. The finding is that it held while the count rose 2,000×.
    const b = await habitkitBrief();
    assert.match(b.paragraphs.join(" "), /rating average held at 4\.9 while the count went from 1 to 2,385/);
  });

  test("a real decline is not softened", () => {
    const metrics: Metric[] = [
      { date: "2023-01-01", metric: "ios_rating_avg", value: 4.8, url: "https://example.com" },
      { date: "2024-01-01", metric: "ios_rating_avg", value: 3.6, url: "https://example.com" },
    ];
    const b = buildBrief("X", [], metrics, computeInsights([], metrics), buildSteps([], metrics));
    assert.match(b.paragraphs.join(" "), /slipped from 4\.8 to 3\.6/);
  });

  test("the review rate is stated as a range, with the reason", () => {
    const metrics: Metric[] = [
      { date: "2026-02-15", metric: "play_installs", value: "500,000+", url: "https://example.com" },
      { date: "2026-02-15", metric: "play_rating_count", value: 10_100, url: "https://example.com" },
    ];
    const b = buildBrief("X", [], metrics, computeInsights([], metrics), buildSteps([], metrics));
    const all = b.paragraphs.join(" ");
    assert.match(all, /between 10 and 20 per 1,000/);
    assert.match(all, /Play publishes installs in brackets/);
  });
});
