import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { firstSeenPaths, structure } from "../lib/sources/structure.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { replayCtx } from "../lib/fetcher.ts";
import type { AppIdentity } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "HabitKit", domain: "habitkit.app", ios_id: "6443918070", play_id: null,
  founder: "Sebastian Roehl", founder_source: null, artwork: null, store_url: null, handles: {},
};

const row = (ts: string, url: string) => [ts, url];

describe("firstSeenPaths", () => {
  test("keeps the earliest sighting of each path", () => {
    const out = firstSeenPaths([
      row("20240101000000", "https://x.com/blog/a"),
      row("20230101000000", "https://x.com/blog/a"),
    ]);
    assert.deepEqual(out, [{ path: "/blog/a", date: "2023-01-01" }]);
  });

  test("keeps assets — they are filtered where pages are counted, not here", () => {
    // `/presskit.zip` is a marketing artifact with a date on it. Excluding it by extension deleted
    // the clearest press-effort signal on the site.
    const out = firstSeenPaths([row("20230205000000", "https://x.com/presskit.zip")]);
    assert.equal(out[0].path, "/presskit.zip");
  });
});

describe("structure source", () => {
  test("dates the press kit, not an icon whose name contains kit", async () => {
    // `habitkit_icon_sm.png` matches a naive /kit/ search. Landmarks match path segments.
    const { events } = await structure.collect(habitkit, await offlineCtx());
    const press = events.filter((e) => /press kit/i.test(e.title));
    assert.equal(press.length, 1);
    assert.equal(press[0].date, "2023-02-05");
  });

  test("dates when the content play began", async () => {
    const { events } = await structure.collect(habitkit, await offlineCtx());
    const content = events.find((e) => /Started publishing content/.test(e.title))!;
    assert.match(content.date, /^2024-/);
    assert.equal(content.kind, "own_content");
  });

  test("structural dates are inexact by nature", async () => {
    // A first capture bounds when a page appeared; it does not date its publication.
    const { events } = await structure.collect(habitkit, await offlineCtx());
    assert.ok(events.every((e) => e.date_exact === false));
  });

  test("reports no affiliate programme when there is none", async () => {
    // Absence is the answer, and it is a real one: HabitKit never ran a creator programme.
    const { events } = await structure.collect(habitkit, await offlineCtx());
    assert.equal(events.filter((e) => /affiliate|creator/i.test(e.title)).length, 0);
  });

  test("tracks the site's page count over time", async () => {
    const { metrics } = await structure.collect(habitkit, await offlineCtx());
    const pages = metrics.filter((m) => m.metric === "site_pages");
    assert.ok(pages.length > 3);
    // Cumulative: a site does not shrink in the archive's record of it.
    for (let i = 1; i < pages.length; i++) {
      assert.ok((pages[i].value as number) >= (pages[i - 1].value as number));
    }
  });

  test("a broken CDX is `failed`, never a throw", async () => {
    const dead = { fetchText: async () => { throw new Error("504"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage } = await structure.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
  });

  test("never reaches the network", async () => {
    const { coverage } = await structure.collect(habitkit, replayCtx({}, FROZEN_NOW));
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /no fixture for/);
  });
});
