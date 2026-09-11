import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hackernews, hnSearchUrl } from "../lib/sources/hackernews.ts";
import { missingNeeds } from "../lib/sources/registry.ts";
import type { AppIdentity } from "../lib/schema.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { replayCtx } from "../lib/fetcher.ts";

const habitkit: AppIdentity = {
  name: "Habit Tracker - HabitKit", domain: "habitkit.app", ios_id: "6443918070",
  play_id: "com.roehl.habitkit", founder: "Sebastian Roehl",
  founder_source: "itunes lookup sellerName", artwork: null,
  store_url: "https://apps.apple.com/us/app/habit-tracker-habitkit/id6443918070",
  handles: {},
};

describe("hackernews", () => {
  test("domain-anchored search returns signal, not noise", async () => {
    const { events, coverage } = await hackernews.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "ok");
    // The measured result from research: `habitkit` → 12,135 hits; `habitkit.app` → 1 (PRD §6.3).
    assert.ok(events.length < 10, `${events.length} hits — the domain anchor is not working`);
    assert.ok(events.some((e) => e.date === "2024-03-17"));
  });

  test("events point at HN item pages, not the submitted link", async () => {
    const { events } = await hackernews.collect(habitkit, await offlineCtx());
    for (const e of events) {
      assert.match(e.url, /^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/);
      assert.equal(e.source, "hackernews");
      // Attribution is unknowable from HN alone until handles are resolved at E5.
      assert.equal(e.by_founder, false);
    }
  });

  test("no hits is `empty`, not `failed`", async () => {
    const none = { ...habitkit, domain: "zzqxwv-no-such-domain.example" };
    const { coverage, events } = await hackernews.collect(none, await offlineCtx());
    assert.equal(coverage.status, "empty");
    assert.deepEqual(events, []);
  });

  test("a broken upstream is `failed` and never throws", async () => {
    const dead = { fetchText: async () => { throw new Error("boom"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage } = await hackernews.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
    assert.equal(coverage.note, "boom");
  });

  test("declares its host so the limiter can throttle it", async () => {
    assert.deepEqual(hackernews.hosts, ["hn.algolia.com"]);
    assert.equal(hackernews.tier, 0);
  });

  test("without a domain the source is skipped, not run", () => {
    // The impostor HabitKit has no sellerUrl. That is `empty` with a reason, never `failed`.
    assert.deepEqual(missingNeeds(hackernews, { ...habitkit, domain: null }), ["domain"]);
    assert.deepEqual(missingNeeds(hackernews, habitkit), []);
  });

  test("never reaches the network for an unrecorded domain", async () => {
    const ctx = replayCtx({}, FROZEN_NOW);
    const { coverage } = await hackernews.collect(habitkit, ctx);
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /no fixture for/);
  });
});
