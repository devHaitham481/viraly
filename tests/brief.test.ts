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
