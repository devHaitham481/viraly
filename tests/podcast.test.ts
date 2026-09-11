import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isSearchable, mentionsBrand, podcast } from "../lib/sources/podcast.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { replayCtx } from "../lib/fetcher.ts";
import type { AppIdentity } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "Habit Tracker - HabitKit", domain: "habitkit.app", ios_id: "6443918070", play_id: null,
  founder: "Sebastian Roehl", founder_source: null, artwork: null, store_url: null, handles: {},
};

describe("mentionsBrand", () => {
  test("a search hit is not a mention", () => {
    // Searching the founder's name returns Wisconsin Badgers basketball commentary. A hit only
    // becomes an event once the brand appears in the episode's own text.
    assert.equal(
      mentionsBrand({ trackName: "3-14-25 UW BASKETBALL VS UCLA", collectionName: "Badgers" }, "habitkit"),
      false,
    );
    assert.ok(mentionsBrand({ trackName: "84: HabitKit – Sebastian Röhl" }, "habitkit"));
  });

  test("matches on a word boundary, not a substring", () => {
    // Otherwise "bear" matches "bearing", "unbearable", "Bear Grylls".
    assert.equal(mentionsBrand({ trackName: "The bearing of witness" }, "bear"), false);
    assert.ok(mentionsBrand({ trackName: "Bear the note taking app" }, "bear"));
  });

  test("checks the description too, not only the title", () => {
    assert.ok(
      mentionsBrand({ trackName: "Episode 12", shortDescription: "we talk about habitkit" }, "habitkit"),
    );
  });
});

describe("isSearchable", () => {
  test("refuses brands too short to search on", () => {
    assert.equal(isSearchable("ngl"), false);
    assert.equal(isSearchable("x"), false);
    assert.ok(isSearchable("habitkit"));
  });
});

describe("podcast source", () => {
  test("finds the founder interview record", async () => {
    const { events, coverage } = await podcast.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "ok");
    assert.ok(events.length >= 3, `only ${events.length} episodes`);
    assert.ok(events.every((e) => e.kind === "earned_media"));
    // The show is a third party even when the founder is the guest.
    assert.ok(events.every((e) => e.by_founder === false));
    assert.ok(events.every((e) => e.date_exact === true));
  });

  test("drops the unrelated majority", async () => {
    const { coverage } = await podcast.collect(habitkit, await offlineCtx());
    // 23 hits, 4 relevant — without the filter this source is mostly noise.
    assert.match(coverage.note!, /unrelated/);
  });

  test("every episode links to its own page", async () => {
    const { events } = await podcast.collect(habitkit, await offlineCtx());
    assert.ok(events.every((e) => /^https:\/\/podcasts\.apple\.com\//.test(e.url)));
  });

  test("an unsearchable brand is `blocked`, not `empty`", async () => {
    // "ngl" would return thousands of unrelated shows. Saying so beats reporting "nobody has
    // talked about this app".
    const { coverage } = await podcast.collect(
      { ...habitkit, domain: "ngl.link" },
      replayCtx({}, FROZEN_NOW),
    );
    assert.equal(coverage.status, "blocked");
  });

  test("a broken upstream is `failed`, never a throw", async () => {
    const dead = { fetchText: async () => { throw new Error("down"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage } = await podcast.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
  });

  test("never reaches the network", async () => {
    const { coverage } = await podcast.collect(habitkit, replayCtx({}, FROZEN_NOW));
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /no fixture for/);
  });
});
