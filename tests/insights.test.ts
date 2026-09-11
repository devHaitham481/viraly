import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR } from "../lib/fetcher.ts";
import { computeInsights } from "../lib/insights.ts";
import type { Event, Metric } from "../lib/schema.ts";

const ev = (date: string, over: Partial<Event> = {}): Event => ({
  date, kind: "product_change", title: "x", source: "appstore",
  by: null, by_founder: true, url: "https://example.com", number: null, date_exact: true, ...over,
});
const mt = (date: string, value: number): Metric => ({
  date, metric: "ios_rating_count", value, url: "https://example.com",
});

async function habitkit() {
  const read = async (f: string) =>
    JSON.parse(await readFile(path.join(FIXTURE_DIR, "golden", f), "utf8"));
  const [wb, as, it] = await Promise.all([
    read("wayback-habitkit.json"), read("appstore-habitkit.json"), read("habitkit.json"),
  ]);
  return computeInsights([...wb, ...as.events, ...it.events], [...as.metrics, ...it.metrics]);
}

describe("computeInsights on real HabitKit data", () => {
  test("reports the quiet build before launch", async () => {
    const i = await habitkit();
    assert.equal(i.launch_date, "2022-11-26");
    assert.equal(i.pre_launch_days, 468);
  });

  test("the year-one reading carries how far off the anniversary it was", async () => {
    // This test previously asserted a bare `33` and was named "year one is the number that matters".
    // The reading was taken on day 175 — 190 days before the anniversary — so calling it the
    // year-one figure was wrong. The value is still useful; the staleness has to travel with it.
    const i = await habitkit();
    // The old code took the last reading *at or before* the cutoff: 33, on day 175, 190 days stale.
    // The nearest reading to the anniversary in either direction is day 457 — still 92 days out, so
    // the UI must not label it "after year 1" either. Both facts now travel with the number.
    assert.equal(i.year_one!.value, 184);
    assert.equal(i.year_one!.measured_on, "2024-02-26");
    assert.equal(i.year_one!.day, 457);
    assert.ok(Math.abs(i.year_one!.day - 365) > 90, "too far out to be called a year-one figure");
  });

  test("a milestone crossed inside a gap is a range, not a measurement", async () => {
    // Readings jump 2023-05-20 (33) → 2024-02-26 (184). The 100-crossing is somewhere in those 282
    // days. This previously reported the far edge, 457 days, as the answer.
    const i = await habitkit();
    const m100 = i.milestones.find((m) => m.ratings === 100)!;
    assert.equal(m100.days, null, "a 282-day bracket is not a measurement");
    assert.equal(m100.days_min, 175);
    assert.equal(m100.days_max, 457);
  });

  test("a milestone between two close readings is reported exactly", () => {
    const i = computeInsights(
      [ev("2023-01-01", { kind: "launch" })],
      [mt("2023-01-01", 1), mt("2023-02-01", 80), mt("2023-02-20", 140)],
    );
    const m100 = i.milestones.find((m) => m.ratings === 100)!;
    assert.equal(m100.days, 50, "a 19-day bracket is tight enough to state");
  });

  test("pre-launch time comes from the website, not from any source", async () => {
    // A founder's oldest GitHub repo can predate the product by years, which rendered as
    // "public 79 months before launch · site live before the store release".
    const i = await habitkit();
    assert.equal(i.pre_launch_days, 468);

    const withOldRepo = computeInsights(
      [
        ev("2016-01-01", { source: "github", kind: "own_content" }),
        ev("2022-11-01", { source: "wayback" }),
        ev("2022-11-26", { kind: "launch", source: "itunes" }),
      ],
      [],
    );
    assert.equal(withOldRepo.pre_launch_days, 25, "a 2016 repo must not become the site's birth");
  });

  test("a milestone already passed at the first reading is reported as unknown", () => {
    // Hinge launched in 2013; the archive has no App Store captures from then, so our earliest
    // reading is already past 100k. Claiming "3,896 days to 100 ratings" would be flatly wrong.
    const i = computeInsights(
      [ev("2013-02-06", { kind: "launch" })],
      [mt("2023-10-01", 120_000), mt("2024-10-01", 180_000)],
    );
    const m100 = i.milestones.find((m) => m.ratings === 100)!;
    assert.equal(m100.days, null);
    assert.equal(m100.already_passed, true);
    assert.deepEqual(i.observed_from, { date: "2023-10-01", value: 120_000 });
  });

  test("growth accelerated rather than spiked", async () => {
    const i = await habitkit();
    assert.ok(i.growth_early! < 15);
    assert.ok(i.growth_recent! > 50);
    assert.ok(i.growth_multiple! > 5);
  });

  test("shipping cadence uses the median", async () => {
    const i = await habitkit();
    // Counts releases whether or not the title carries release notes — a copy change must not
    // silently alter a metric.
    assert.equal(i.feature_releases, 16);
    assert.ok(i.median_days_between_releases! > 30 && i.median_days_between_releases! < 120);
  });

  test("a release is counted from its version prefix, not its prose", () => {
    const withNotes = computeInsights(
      [
        ev("2023-01-01", { kind: "launch" }),
        ev("2023-02-01", { title: "Version 1.1.0 released" }),
        ev("2023-03-01", { title: "Version 1.2.0: adds Home Screen Widgets" }),
      ],
      [],
    );
    assert.equal(withNotes.feature_releases, 2);
  });

  test("age_series is keyed by months since launch, for cross-app comparison", async () => {
    const i = await habitkit();
    assert.ok(i.age_series.length > 10);
    assert.equal(i.age_series[0].month, 0);
    for (let n = 1; n < i.age_series.length; n++) {
      assert.ok(i.age_series[n].month >= i.age_series[n - 1].month);
    }
  });
});

describe("edge cases", () => {
  test("no launch event leaves relative figures null rather than guessing", () => {
    const i = computeInsights([ev("2023-01-01")], [mt("2023-01-01", 50)]);
    assert.equal(i.launch_date, null);
    assert.equal(i.pre_launch_days, null);
    assert.deepEqual(i.age_series, []);
    assert.ok(i.milestones.every((m) => m.days === null));
  });

  test("ratings before launch are ignored", () => {
    // A store page archived before release can carry a stale count; it must not anchor the series.
    const i = computeInsights(
      [ev("2023-06-01", { kind: "launch" })],
      [mt("2023-01-01", 5_000), mt("2023-07-01", 120)],
    );
    assert.deepEqual(i.observed_from, { date: "2023-07-01", value: 120 });
  });

  test("an early first reading gives a useful upper bound, not a false exact date", () => {
    const i = computeInsights(
      [ev("2023-06-01", { kind: "launch" })],
      [mt("2023-07-01", 120), mt("2023-09-01", 300)],
    );
    const m100 = i.milestones[0];
    // We cannot say when it crossed 100 — only that it had within 30 days.
    assert.equal(m100.days, null);
    assert.equal(m100.already_passed, true);
    assert.equal(m100.days_upper_bound, 30);
  });

  test("a near-zero early rate does not produce an absurd multiple", () => {
    // Without the guard, 0.15/month → 90/month reports a 600x acceleration.
    const flat = ["2023-01-01", "2023-03-01", "2023-05-01", "2023-07-01"].map((d, n) => mt(d, 1 + n));
    const fast = ["2024-01-01", "2024-03-01", "2024-05-01", "2024-07-01"].map((d, n) => mt(d, 200 + n * 200));
    const i = computeInsights([ev("2023-01-01", { kind: "launch" })], [...flat, ...fast]);
    assert.equal(i.growth_multiple, null, "a sub-1/month early rate is not a usable baseline");
    assert.ok(i.growth_recent! > 50);
  });

  test("growth windows never overlap", () => {
    // A three-point series cannot support an early-vs-late comparison; saying so beats reporting 1.0.
    const i = computeInsights(
      [ev("2023-01-01", { kind: "launch" })],
      [mt("2023-01-01", 1), mt("2023-02-01", 1), mt("2024-01-01", 900)],
    );
    assert.equal(i.growth_multiple, null);
  });

  test("an empty crawl computes without throwing", () => {
    const i = computeInsights([], []);
    assert.equal(i.feature_releases, 0);
    assert.equal(i.median_days_between_releases, null);
  });
});
