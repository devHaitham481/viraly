import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR, replayCtx } from "../lib/fetcher.ts";
import { isApp, lookupApp, searchApps, searchUrl } from "../lib/sources/itunes.ts";
import { FROZEN_NOW, GOLDEN, offlineCtx } from "./helpers.ts";

describe("searchApps", () => {
  test("finds both apps named HabitKit", async () => {
    const c = await searchApps("HabitKit", await offlineCtx());
    const habitkits = c.filter((x) => x.name.toLowerCase().includes("habitkit"));
    assert.ok(habitkits.length >= 2, `expected 2+ HabitKits, got ${habitkits.length}`);

    // The whole reason disambiguation exists (DECISIONS.md D3): same name, different product.
    const ids = new Set(habitkits.map((x) => x.ios_id));
    assert.ok(ids.has("6443918070"), "real HabitKit missing");
    assert.ok(ids.has("6761298880"), "impostor HabitKit missing");
  });

  test("candidates carry enough to tell them apart", async () => {
    const c = await searchApps("HabitKit", await offlineCtx());
    const real = c.find((x) => x.ios_id === "6443918070")!;
    const impostor = c.find((x) => x.ios_id === "6761298880")!;

    assert.equal(real.developer, "Sebastian Roehl");
    assert.equal(real.domain, "habitkit.app");
    assert.equal(real.released, "2022-11-26");
    assert.ok(real.rating_count > 1000);

    assert.notEqual(impostor.developer, real.developer);
    assert.notEqual(impostor.released, real.released);
  });

  test("an ambiguous name returns many candidates without crashing", async () => {
    // "ngl" means "not gonna lie" — the pathological case from PRD §9.2.
    const c = await searchApps("ngl", await offlineCtx());
    assert.ok(c.length > 1);
    assert.ok(c.every((x) => /^\d+$/.test(x.ios_id)));
  });

  test("a blank query does not reach the network", async () => {
    // replayCtx throws on any unrecorded URL, so an empty manifest proves no fetch happened.
    const c = await searchApps("   ", replayCtx({}, FROZEN_NOW));
    assert.deepEqual(c, []);
  });
});

describe("lookupApp", () => {
  test("resolves identity from one call", async () => {
    const { app } = await lookupApp(GOLDEN.habitkit, await offlineCtx());
    assert.equal(app.name, "Habit Tracker - HabitKit");
    assert.equal(app.founder, "Sebastian Roehl");
    assert.equal(app.domain, "habitkit.app");
    assert.equal(app.play_id, "com.roehl.habitkit");
    assert.equal(app.founder_source, "itunes lookup sellerName");
  });

  test("every event carries a real evidence URL", async () => {
    const { events } = await lookupApp(GOLDEN.habitkit, await offlineCtx());
    assert.ok(events.length > 0);
    for (const e of events) {
      // REVIEW.md rule #1: no invented data.
      assert.match(e.url, /^https:\/\/apps\.apple\.com\//, `bad evidence url: ${e.url}`);
      assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test("the release date is exact and correct", async () => {
    const { events } = await lookupApp(GOLDEN.habitkit, await offlineCtx());
    const launch = events.find((e) => e.kind === "launch")!;
    assert.equal(launch.date, "2022-11-26");
    assert.equal(launch.date_exact, true);
    assert.equal(launch.by_founder, true);
  });

  test("the metric date comes from the injected clock, not the wall clock", async () => {
    const { metrics } = await lookupApp(GOLDEN.habitkit, await offlineCtx());
    assert.equal(metrics[0].date, FROZEN_NOW.slice(0, 10));
    assert.equal(metrics[0].metric, "ios_rating_count");
  });

  test("a non-app id is rejected rather than made into a target", () => {
    // The lookup endpoint resolves ANY iTunes id. A song id (1596550178) once produced a fully
    // formed "app" — named target, crawl row, six sources all reporting nothing found.
    assert.equal(isApp({ wrapperType: "track", kind: "song" }), false);
    assert.equal(isApp({ wrapperType: "artist" }), false);
    assert.equal(isApp({ wrapperType: "software", kind: "software" }), true);
    assert.equal(isApp({ kind: "mac-software" }), true);
    assert.equal(isApp({}), false);
  });

  test("a missing app is `empty`, not `failed`", async () => {
    // Distinct states on purpose: "we looked and there is nothing" is not "we could not look".
    const { coverage, events } = await lookupApp("1", await offlineCtx());
    assert.equal(coverage.status, "empty");
    assert.deepEqual(events, []);
  });

  test("a network failure is `failed` and never throws", async () => {
    const dead = {
      fetchText: async () => {
        throw new Error("fetch failed");
      },
      now: () => new Date(FROZEN_NOW),
    };
    const { coverage, events, metrics } = await lookupApp(GOLDEN.habitkit, dead);
    assert.equal(coverage.status, "failed");
    assert.equal(coverage.note, "fetch failed");
    assert.deepEqual(events, []);
    assert.deepEqual(metrics, []);
  });
});

describe("golden output", () => {
  for (const [name, iosId] of Object.entries(GOLDEN)) {
    test(`${name} matches the committed golden file`, async () => {
      const { app, events, metrics, coverage } = await lookupApp(iosId, await offlineCtx());
      const actual = {
        app,
        events: events.sort((a, b) => a.date.localeCompare(b.date)),
        metrics,
        coverage: [coverage],
      };
      const expected = JSON.parse(
        await readFile(path.join(FIXTURE_DIR, "golden", `${name}.json`), "utf8"),
      );
      assert.deepEqual(
        actual,
        expected,
        "Output drifted from the golden file. If this change was intentional, run `npm run golden` " +
          "and commit the diff. If it was not, this is the bug.",
      );
    });
  }

  test("the two HabitKits produce different timelines", async () => {
    const ctx = await offlineCtx();
    const real = await lookupApp(GOLDEN.habitkit, ctx);
    const impostor = await lookupApp(GOLDEN.impostor, ctx);
    // The id is the key, not the name.
    assert.notEqual(real.events[0].date, impostor.events[0].date);
    assert.notEqual(real.app.founder, impostor.app.founder);
  });
});

describe("the suite is offline", () => {
  test("an unrecorded URL fails loudly instead of hitting the network", async () => {
    const ctx = replayCtx({}, FROZEN_NOW);
    await assert.rejects(() => ctx.fetchText(searchUrl("anything")), /no fixture for/);
  });
});
