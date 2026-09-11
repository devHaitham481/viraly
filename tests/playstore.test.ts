import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bracketValue, extractPlay, playstore, playUrl } from "../lib/sources/playstore.ts";
import { missingNeeds } from "../lib/sources/registry.ts";
import { auditCrawl } from "../lib/audit.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { replayCtx } from "../lib/fetcher.ts";
import type { AppIdentity } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "HabitKit", domain: "habitkit.app", ios_id: "6443918070", play_id: "com.roehl.habitkit",
  founder: "Sebastian Roehl", founder_source: null, artwork: null, store_url: null, handles: {},
};

describe("bracketValue", () => {
  test("orders brackets numerically", () => {
    assert.ok(bracketValue("500,000+") > bracketValue("100,000+"));
    assert.ok(bracketValue("1,000,000+") > bracketValue("500,000+"));
  });
});

describe("extractPlay scoping", () => {
  test("ignores numbers belonging to neighbouring apps", () => {
    // A Play page carries the install bracket of every app in its "similar apps" carousels. On the
    // real HabitKit page the subject's own bracket sits 562 chars from a package mention and a
    // neighbour's sits 8,107 away.
    const mine = `"com.roehl.habitkit" ... "100,000+"`;
    const theirs = `${"x".repeat(9000)}"com.someone.else" "10,000,000+"`;
    const snap = extractPlay(mine + theirs, "com.roehl.habitkit");
    assert.equal(snap.installs, "100,000+");
  });

  test("returns null rather than guessing when nothing is in range", () => {
    // A wrong install bracket is far worse than a missing one — it reads as a real user count.
    const far = `"com.roehl.habitkit"${"x".repeat(9000)}"500,000+"`;
    assert.deepEqual(extractPlay(far, "com.roehl.habitkit"), { installs: null, reviews: null });
  });

  test("a page that never mentions the package yields nothing", () => {
    assert.deepEqual(extractPlay(`"50,000+" reviews`, "com.roehl.habitkit"),
      { installs: null, reviews: null });
  });
});

describe("playstore source", () => {
  test("produces a dated install-bracket series", async () => {
    const { metrics, coverage } = await playstore.collect(habitkit, await offlineCtx());
    const installs = metrics.filter((m) => m.metric === "play_installs");
    assert.ok(installs.length >= 8, `only ${installs.length} readings`);
    assert.equal(coverage.status, "partial"); // some captures are genuinely unreachable
  });

  test("the bracket series never goes backwards", async () => {
    // The real safety net for the proximity heuristic: a bracket that falls is a bracket belonging
    // to a different app. `auditCrawl` enforces the same rule at runtime.
    const { metrics } = await playstore.collect(habitkit, await offlineCtx());
    const installs = metrics.filter((m) => m.metric === "play_installs");
    for (let i = 1; i < installs.length; i++) {
      assert.ok(
        bracketValue(installs[i].value as string) >= bracketValue(installs[i - 1].value as string),
        `bracket fell at ${installs[i].date} — scoping picked up another app`,
      );
    }
  });

  test("its output passes the invariants", async () => {
    const { events, metrics } = await playstore.collect(habitkit, await offlineCtx());
    assert.deepEqual(auditCrawl(events, metrics, { today: "2026-12-31" }), []);
  });

  test("bracket crossings are events, dated inexactly", async () => {
    const { events } = await playstore.collect(habitkit, await offlineCtx());
    assert.ok(events.length > 0);
    // The crossing happened between two captures, not on the capture date.
    assert.ok(events.every((e) => e.date_exact === false));
    assert.ok(events.every((e) => /Play installs passed/.test(e.title)));
  });

  test("needs a play_id and is skipped without one", () => {
    assert.deepEqual(playstore.needs, ["play_id"]);
    assert.deepEqual(missingNeeds(playstore, { ...habitkit, play_id: null }), ["play_id"]);
  });

  test("an unverifiable package is `blocked`, not `empty`", async () => {
    // `play_id` is copied from the iOS bundle id, which is a guess. NGL's bundle is `fun.ask` — a
    // valid iOS identifier that 404s on Play. Reporting `empty` there claims "we looked and there
    // is genuinely nothing" about an app that may have an Android listing under another package.
    const no404 = {
      fetchText: async (u: string) => {
        if (u === playUrl("fun.ask")) throw new Error("play.google.com 404 Not Found");
        return "[]";
      },
      now: () => new Date(FROZEN_NOW),
    };
    const { coverage } = await playstore.collect({ ...habitkit, play_id: "fun.ask" }, no404);
    assert.equal(coverage.status, "blocked");
    assert.match(coverage.note!, /inferred from the iOS bundle id/);
  });

  test("a broken CDX is `failed`, never a throw", async () => {
    // The listing check passes; only the index is down. That is "could not look", not "no listing".
    const cdxDown = {
      fetchText: async (u: string) => {
        if (u === playUrl("com.roehl.habitkit")) return "<html>ok</html>";
        throw new Error("web.archive.org 504 Gateway Time-out");
      },
      now: () => new Date(FROZEN_NOW),
    };
    const { coverage } = await playstore.collect(habitkit, cdxDown);
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /504/);
  });

  test("never reaches the network", async () => {
    // With no fixtures at all, the listing check itself cannot run — reported as unverifiable
    // rather than as a confident "this app has no Android listing".
    const { coverage } = await playstore.collect(habitkit, replayCtx({}, FROZEN_NOW));
    assert.equal(coverage.status, "blocked");
  });
});
