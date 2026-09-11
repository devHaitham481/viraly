import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rdap, registrationDate } from "../lib/sources/rdap.ts";
import { computeInsights } from "../lib/insights.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { replayCtx } from "../lib/fetcher.ts";
import type { AppIdentity, Event } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "HabitKit", domain: "habitkit.app", ios_id: "6443918070", play_id: null,
  founder: "Sebastian Roehl", founder_source: null, artwork: null, store_url: null, handles: {},
};

describe("registrationDate", () => {
  test("reads the registration event", () => {
    const body = JSON.stringify({
      events: [
        { eventAction: "expiration", eventDate: "2027-07-31T00:00:00Z" },
        { eventAction: "registration", eventDate: "2021-07-31T12:00:00Z" },
      ],
    });
    assert.equal(registrationDate(body), "2021-07-31");
  });

  test("malformed or dateless responses yield null, not a guess", () => {
    assert.equal(registrationDate("not json"), null);
    assert.equal(registrationDate(JSON.stringify({ events: [] })), null);
  });
});

describe("rdap source", () => {
  test("dates the project's real start", async () => {
    const { events, coverage } = await rdap.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "ok");
    assert.equal(events.length, 1);
    // Two weeks before the first Wayback capture, sixteen months before the App Store launch.
    assert.equal(events[0].date, "2021-07-31");
    assert.equal(events[0].date_exact, true);
  });

  test("is NOT a launch event", () => {
    // `computeInsights` anchors on the first `kind: "launch"`. Registering a domain is not shipping,
    // and treating it as one would silently move every milestone and the pre-launch figure with it.
    const base: Event = {
      date: "2021-07-31", kind: "product_change", title: "Domain habitkit.app registered",
      source: "rdap", by: null, by_founder: true, url: "https://rdap.org/domain/habitkit.app",
      number: null, date_exact: true,
    };
    const launch: Event = { ...base, date: "2022-11-26", kind: "launch", source: "itunes",
      title: "iOS app released on the App Store" };

    const i = computeInsights([base, launch], []);
    assert.equal(i.launch_date, "2022-11-26", "domain registration hijacked the launch anchor");
    // It does count as the project's first public trace.
    assert.equal(i.pre_launch_days, 483);
  });

  test("a broken upstream is `failed`, never a throw", async () => {
    const dead = { fetchText: async () => { throw new Error("rdap.org 403"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage } = await rdap.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
  });

  test("never reaches the network", async () => {
    const { coverage } = await rdap.collect(habitkit, replayCtx({}, FROZEN_NOW));
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /no fixture for/);
  });
});
