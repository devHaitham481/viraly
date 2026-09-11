import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR, replayCtx } from "../lib/fetcher.ts";
import {
  cdxUrl, diffPositioning, extractPositioning, headline, looksLikeInterstitial, sampleCaptures,
  stripTags, wayback,
} from "../lib/sources/wayback.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import type { AppIdentity } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "Habit Tracker - HabitKit", domain: "habitkit.app", ios_id: "6443918070",
  play_id: null, founder: "Sebastian Roehl", founder_source: null, artwork: null,
  store_url: "https://apps.apple.com/us/app/habit-tracker-habitkit/id6443918070",
  handles: {},
};

describe("stripTags", () => {
  test("survives a `>` inside a quoted attribute", () => {
    // Regression: Alpine's `@scroll.window="scrolled = window.scrollY > 24"` closed the tag early
    // under a naive /<[^>]+>/ and spilled markup into the extracted copy.
    const html = `<div @scroll.window="scrolled = window.scrollY > 24" class="x">Real Copy</div>`;
    assert.equal(stripTags(html).replace(/\s+/g, " ").trim(), "Real Copy");
  });

  test("handles single quotes and unterminated tags", () => {
    assert.equal(stripTags(`<a href='a>b'>Hi</a>`).replace(/\s+/g, " ").trim(), "Hi");
    assert.equal(stripTags(`text <broken`).trim(), "text");
  });
});

describe("headline", () => {
  test("uses the title when the title IS the positioning", () => {
    const s = { date: "2026-09-05", ts: "20260905000000", original: "https://habitkit.app/", title: "HabitKit · The Habit Tracker You Can Actually See", hero: "HabitKit · The Habit Tracker You Can Actually See Habit Kit Features Reviews" };
    assert.equal(headline(s, "habitkit.app"), "HabitKit · The Habit Tracker You Can Actually See");
  });

  test("falls through to the copy when the title is only branding", () => {
    const s = { date: "2022-12-07", ts: "20221207000000", original: "https://habitkit.app/", title: "HabitKit", hero: "HabitKit Habit Kit Consistency Tracker The coolest way to track your habits" };
    assert.match(headline(s, "habitkit.app"), /^Consistency Tracker/);
  });

  test("never eats more than six leading words", () => {
    const s = { date: "x", ts: "20220101000000", original: "https://habitkit.app/", title: "HabitKit", hero: "HabitKit HabitKit HabitKit HabitKit HabitKit HabitKit HabitKit Survivor" };
    assert.ok(headline(s, "habitkit.app").length > 0);
  });
});

describe("sampleCaptures", () => {
  test("returns everything when under the cap, keeping order", () => {
    assert.deepEqual(sampleCaptures([1, 2, 3], 24), [1, 2, 3]);
  });
  test("caps the count and keeps both ends", () => {
    const rows = Array.from({ length: 200 }, (_, i) => i);
    const picked = sampleCaptures(rows, 24);
    assert.equal(picked.length, 24);
    assert.equal(picked[0], 0);
    assert.equal(picked.at(-1), 199);
  });
});

describe("wayback source", () => {
  test("reproduces the HabitKit positioning pivot", async () => {
    // The E3 gate. This is PRD §6.2 — the finding no manual pass had.
    const { events, coverage } = await wayback.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "ok");

    const byDate = Object.fromEntries(events.map((e) => [e.date.slice(0, 7), e.title]));

    // Aug 2021: a *social* habit-sharing web app, 15 months before the iOS release.
    assert.match(byDate["2021-08"], /simple and social/i);
    // Dec 2022: relaunched as a private tile-grid tracker, social framing dropped.
    assert.match(byDate["2022-12"], /Consistency Tracker/i);
    // Jun 2024 and Sep 2026: two later repositionings.
    assert.match(byDate["2024-06"], /Change Your Life/i);
    assert.match(byDate["2026-09"], /Actually See/i);
  });

  test("reports a change only when the tagline really changed", async () => {
    const { events } = await wayback.collect(habitkit, await offlineCtx());
    const lines = events.map((e) => e.title.replace(/^[^“]*“|”$/g, ""));
    assert.equal(new Set(lines).size, lines.length, "the same tagline was reported twice");
    assert.ok(events.length <= 8, `${events.length} changes from 24 captures — diff is too sensitive`);
  });

  test("capture dates are marked inexact", async () => {
    const { events } = await wayback.collect(habitkit, await offlineCtx());
    // A capture dates when we *saw* a change, not when it shipped.
    assert.ok(events.every((e) => e.date_exact === false));
    // Linked URLs must be the rewritten replay form — `id_` renders as a broken, unstyled page.
    assert.ok(events.every((e) => e.url.startsWith("https://web.archive.org/web/")));
    assert.ok(events.every((e) => !e.url.includes("id_/")), "linked an id_ URL, which renders broken");
    assert.ok(events.every((e) => e.kind === "product_change"));
  });

  test("needs a domain, and declares the throttled host", () => {
    assert.deepEqual(wayback.needs, ["domain"]);
    assert.deepEqual(wayback.hosts, ["web.archive.org"]);
  });

  test("a broken CDX is `failed`, never a throw", async () => {
    const dead = { fetchText: async () => { throw new Error("cdx down"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage, events } = await wayback.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
    assert.deepEqual(events, []);
  });

  test("no captures is `empty`", async () => {
    const nothing = {
      fetchText: async () => JSON.stringify([["timestamp", "original"]]),
      now: () => new Date(FROZEN_NOW),
    };
    const { coverage } = await wayback.collect(habitkit, nothing);
    assert.equal(coverage.status, "empty");
  });

  test("matches the committed golden file", async () => {
    const { events } = await wayback.collect(habitkit, await offlineCtx());
    const expected = JSON.parse(
      await readFile(path.join(FIXTURE_DIR, "golden", "wayback-habitkit.json"), "utf8"),
    );
    assert.deepEqual(events, expected);
  });

  test("never reaches the network", async () => {
    const { coverage } = await wayback.collect(habitkit, replayCtx({}, FROZEN_NOW));
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /no fixture for/);
  });
});

describe("archive interstitials", () => {
  test("an archive.org notice is not a positioning change", () => {
    // These are served with HTTP 200. Treated as content, one mid-sample invents a change *to* the
    // notice and another back, plus two phantom repositionings.
    assert.ok(looksLikeInterstitial("Wayback Machine", "Got an HTTP 302 response at crawl time"));
    assert.ok(looksLikeInterstitial("Internet Archive", "This page is not available"));
  });

  test("a real landing page is never mistaken for one", () => {
    assert.equal(
      looksLikeInterstitial(
        "HabitKit",
        "Consistency Tracker The coolest way to track your habits and streaks Build new habits by " +
          "tracking your progress in awesome tile-based grid charts and keep your streak alive every day",
      ),
      false,
    );
  });

  test("a page merely mentioning the archive is kept if it has real copy", () => {
    // The length floor matters: the phrase alone must not disqualify a genuine page.
    const long = "Internet Archive ".padEnd(500, "x");
    assert.equal(looksLikeInterstitial("Some Product", long), false);
  });
});
