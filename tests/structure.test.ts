import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { firstSeenPaths, livePageUrl, retirementCandidates, structure, structureCdxUrl } from "../lib/sources/structure.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { httpStatus, replayCtx } from "../lib/fetcher.ts";
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

describe("httpStatus", () => {
  test("tells a refusal apart from a bad minute", () => {
    // Everything that reasons from absence depends on this distinction.
    assert.equal(httpStatus(new Error("habitkit.app 404 Not Found — https://habitkit.app/x")), 404);
    assert.equal(httpStatus(new Error("web.archive.org 504 Gateway Time-out — http://x")), 504);
    assert.equal(httpStatus(new Error("timeout after 90s — http://x")), null);
    assert.equal(httpStatus(new Error("no fixture for https://x/\n  Record it with: npm run record")), null);
  });
});

describe("retirementCandidates", () => {
  test("skips the root and anything that is not a page", () => {
    // A rotated hero image is not a strategy, and the root is the liveness check, not a candidate.
    const out = retirementCandidates([
      { path: "/", date: "2021-01-01" },
      { path: "/logo.png", date: "2021-01-01" },
      { path: "/site.webmanifest", date: "2021-01-01" },
      { path: "/sebsn", date: "2021-08-15" },
    ]);
    assert.deepEqual(out.map((c) => c.path), ["/sebsn"]);
  });
});

describe("what they tried and dropped (A3)", () => {
  test("a page the live site 404s is reported, dated at its first capture", async () => {
    // habitkit.app/sebsn — the founder's own page, up in Aug 2021, gone now. Nobody publishes
    // their retreats; the archive plus a live 404 is the only way to see one.
    const { events } = await structure.collect(habitkit, await offlineCtx());
    const gone = events.filter((e) => /since removed/.test(e.title));
    assert.equal(gone.length, 1);
    assert.equal(gone[0].date, "2021-08-15");
    assert.match(gone[0].title, /\/sebsn/);
    // The date is when it appeared — the only date we hold. When it came down is unknown.
    assert.equal(gone[0].date_exact, false);
    assert.match(gone[0].url, /web\.archive\.org/);
  });

  test("pages that still answer are left alone", async () => {
    const { events } = await structure.collect(habitkit, await offlineCtx());
    assert.equal(events.filter((e) => /\/blog|\/changelog|\/contact/.test(e.title) && /removed/.test(e.title)).length, 0);
  });

  test("a site that does not answer at all claims no removals", async () => {
    // Without this guard a parked domain or a DNS outage reports that the team deleted every page
    // they ever had — a confident, catastrophic, wrong finding.
    const manifest = await (await import("../lib/fetcher.ts")).loadManifest();
    const offline = replayCtx(manifest, FROZEN_NOW);
    const siteDown = {
      fetchText: async (u: string) => {
        if (u.startsWith("https://habitkit.app/")) throw new Error("habitkit.app 503 Service Unavailable — " + u);
        return offline.fetchText(u);
      },
      now: () => new Date(FROZEN_NOW),
    };
    const { events, coverage } = await structure.collect(habitkit, siteDown);
    assert.equal(events.filter((e) => /removed/.test(e.title)).length, 0);
    assert.match(coverage.note!, /removals not assessed/);
  });

  test("a page that times out is not called deleted", async () => {
    // The root answers, so the check runs; the individual pages fail with no status. That is "we
    // could not look", and it must not become "they took it down".
    const manifest = await (await import("../lib/fetcher.ts")).loadManifest();
    const offline = replayCtx(manifest, FROZEN_NOW);
    const flaky = {
      fetchText: async (u: string) => {
        if (u === livePageUrl("habitkit.app", "/")) return "<html>ok</html>";
        if (u.startsWith("https://habitkit.app/")) throw new Error("timeout after 15s — " + u);
        return offline.fetchText(u);
      },
      now: () => new Date(FROZEN_NOW),
    };
    const { events, coverage } = await structure.collect(habitkit, flaky);
    assert.equal(events.filter((e) => /removed/.test(e.title)).length, 0);
    assert.match(coverage.note!, /unreachable, not counted/);
  });

  test("the removal check never invents evidence it did not fetch", async () => {
    const { events } = await structure.collect(habitkit, await offlineCtx());
    // REVIEW.md rule #1: every event points at something real.
    assert.ok(events.every((e) => /^https:\/\//.test(e.url)));
  });
});

describe("recorded refusals replay as refusals", () => {
  test("a 404 fixture throws rather than reporting a missing fixture", async () => {
    const { loadManifest } = await import("../lib/fetcher.ts");
    const ctx = replayCtx(await loadManifest(), FROZEN_NOW);
    await assert.rejects(
      () => ctx.fetchText("https://habitkit.app/sebsn"),
      (err: Error) => httpStatus(err) === 404,
    );
  });

  test("an unrecorded URL still reports a missing fixture", async () => {
    const { loadManifest } = await import("../lib/fetcher.ts");
    const ctx = replayCtx(await loadManifest(), FROZEN_NOW);
    await assert.rejects(
      () => ctx.fetchText("https://habitkit.app/never-recorded"),
      /no fixture for/,
    );
  });
});
