import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURE_DIR, replayCtx } from "../lib/fetcher.ts";
import {
  appstore, extractOffers, extractSnapshot, extractVersions, modelOf, periodOf, sampleEvenly,
  summarizeOffers, extractLanguages, type Offer,
} from "../lib/sources/appstore.ts";
import { missingNeeds } from "../lib/sources/registry.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import type { AppIdentity } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "Habit Tracker - HabitKit", domain: "habitkit.app", ios_id: "6443918070",
  play_id: null, founder: "Sebastian Roehl", founder_source: null, artwork: null,
  store_url: "https://apps.apple.com/us/app/habit-tracker-habitkit/id6443918070",
  handles: {},
};

describe("extractSnapshot", () => {
  test("reads rating, name, description and price from JSON-LD", () => {
    // Apple emits an Organization block and a breadcrumb list before the app's own.
    const html = `
      <script type="application/ld+json">{"@type":"Organization","name":"App Store"}</script>
      <script type="application/ld+json">{"@type":"SoftwareApplication","name":"Thing",
        "description":"Does things","offers":{"price":0,"priceCurrency":"USD"},
        "aggregateRating":{"ratingValue":4.9,"reviewCount":2410}}</script>`;
    const s = extractSnapshot(html, "123456789");
    assert.equal(s.ratingCount, 2410);
    assert.equal(s.ratingValue, 4.9);
    assert.equal(s.name, "Thing");
    assert.equal(s.price, 0);
    assert.equal(s.currency, "USD");
  });

  test("skips malformed blocks instead of failing the capture", () => {
    const html = `
      <script type="application/ld+json">{ not json </script>
      <script type="application/ld+json">{"aggregateRating":{"reviewCount":7}}</script>`;
    assert.equal(extractSnapshot(html, "1").ratingCount, 7);
  });

  test("an unparseable page yields nothing rather than throwing", () => {
    const s = extractSnapshot("<html><body>nothing</body></html>", "1");
    assert.equal(s.ratingCount, undefined);
    assert.deepEqual(s.versions, []);
  });
});

describe("extractVersions", () => {
  test("ignores version histories belonging to other apps", () => {
    // Regression: a store page embeds a versionHistory for every app it links to (sixteen of them on
    // a typical capture). An unscoped scan returned versions 17.7 and 2025.10 from unrelated apps and
    // produced a confident, fictional release timeline.
    const html =
      `"id":"6443918070" ... "versionHistory":[{"versionDisplay":"1.4.0","releaseDate":"2023-03-18"}]` +
      `"id":"1604437305" ... "versionHistory":[{"versionDisplay":"17.7","releaseDate":"2025-04-06"}]`;
    const v = extractVersions(html, "6443918070");
    assert.deepEqual(v, [{ version: "1.4.0", date: "2023-03-18" }]);
  });

  test("keeps the earliest date when captures repeat a version", () => {
    const html =
      `"id":"6443918070" "versionHistory":[{"versionDisplay":"2.0","releaseDate":"2024-05-05"}]` +
      `"id":"6443918070" "versionHistory":[{"versionDisplay":"2.0","releaseDate":"2024-09-09"}]`;
    assert.deepEqual(extractVersions(html, "6443918070"), [{ version: "2.0", date: "2024-05-05" }]);
  });

  test("an id too short to be an App Store id owns nothing", () => {
    // App Store ids are 6–12 digits. A stray `"id":"1"` elsewhere on the page must not claim a block.
    const html = `"id":"1" "versionHistory":[{"versionDisplay":"9.9","releaseDate":"2024-01-01"}]`;
    assert.deepEqual(extractVersions(html, "1"), []);
  });

  test("a capture without the blob yields nothing, not an error", () => {
    assert.deepEqual(extractVersions("<html>no blob here</html>", "6443918070"), []);
  });
});

describe("sampleEvenly", () => {
  test("caps and keeps both ends", () => {
    const picked = sampleEvenly(Array.from({ length: 100 }, (_, i) => i), 20);
    assert.equal(picked.length, 20);
    assert.equal(picked[0], 0);
    assert.equal(picked.at(-1), 99);
  });
});

describe("appstore source", () => {
  test("produces a dated growth series", async () => {
    // The E4 gate: a real curve, not a single live reading.
    const { metrics, coverage } = await appstore.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "ok");
    const counts = metrics.filter((m) => m.metric === "ios_rating_count");
    assert.ok(counts.length >= 8, `only ${counts.length} dated points`);
  });

  test("the series is chronological and monotonic", async () => {
    const { metrics } = await appstore.collect(habitkit, await offlineCtx());
    const counts = metrics.filter((m) => m.metric === "ios_rating_count");
    for (let i = 1; i < counts.length; i++) {
      assert.ok(counts[i].date > counts[i - 1].date, "out of order");
      // Cumulative review counts only go up. A drop means we parsed the wrong app's page.
      assert.ok(
        (counts[i].value as number) >= (counts[i - 1].value as number),
        `count fell at ${counts[i].date} — wrong page parsed?`,
      );
    }
  });

  test("spans the app's life, starting near zero", async () => {
    const { metrics } = await appstore.collect(habitkit, await offlineCtx());
    const counts = metrics.filter((m) => m.metric === "ios_rating_count");
    assert.ok((counts[0].value as number) < 10, "series should start at launch, near zero");
    assert.ok((counts.at(-1)!.value as number) > 1000);
    assert.match(counts[0].date, /^2022-/);
  });

  test("every point cites the capture it came from", async () => {
    const { metrics } = await appstore.collect(habitkit, await offlineCtx());
    for (const m of metrics) assert.match(m.url, /^https:\/\/web\.archive\.org\/web\/\d+\//);
  });

  test("reconstructs the release timeline with Apple's own exact dates", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const releases = events.filter((e) => e.title.startsWith("Version "));
    assert.ok(releases.length >= 10, `only ${releases.length} releases`);
    // Apple states these dates, so unlike a capture date they are exact.
    assert.ok(releases.every((e) => e.date_exact === true));
    assert.equal(releases[0].title, "Version 1.0 released");
    assert.match(releases[0].date, /^2022-11/);
  });

  test("release versions belong to this app only", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const versions = events
      .filter((e) => e.title.startsWith("Version "))
      .map((e) => e.title.replace(/^Version | released$/g, ""));
    // HabitKit has never shipped a 2.x, let alone a 17.x or a 2025.x.
    assert.ok(versions.every((v) => v.startsWith("1.")), `foreign versions: ${versions.join(", ")}`);
  });

  test("detects App Store copy changes as ASO work", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const aso = events.filter((e) => e.kind === "aso");
    assert.ok(aso.length > 0);
    // A capture only bounds when copy changed, so these are inexact by nature.
    assert.ok(aso.every((e) => e.date_exact === false));
  });

  test("links the rendered replay page, never the raw id_ form", async () => {
    const { events, metrics } = await appstore.collect(habitkit, await offlineCtx());
    for (const u of [...events.map((e) => e.url), ...metrics.map((m) => m.url)]) {
      assert.ok(!u.includes("id_/"), `linked a raw capture that renders broken: ${u}`);
    }
  });

  test("needs store_url, and declares the throttled host", () => {
    assert.deepEqual(appstore.needs, ["store_url"]);
    assert.deepEqual(appstore.hosts, ["web.archive.org"]);
    assert.deepEqual(missingNeeds(appstore, { ...habitkit, store_url: null }), ["store_url"]);
  });

  test("a broken CDX is `failed`, never a throw", async () => {
    const dead = { fetchText: async () => { throw new Error("down"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage, metrics } = await appstore.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
    assert.deepEqual(metrics, []);
  });

  test("matches the committed golden file", async () => {
    const { events, metrics } = await appstore.collect(habitkit, await offlineCtx());
    const expected = JSON.parse(
      await readFile(path.join(FIXTURE_DIR, "golden", "appstore-habitkit.json"), "utf8"),
    );
    assert.deepEqual({ events, metrics }, expected);
  });

  test("never reaches the network", async () => {
    const { coverage } = await appstore.collect(habitkit, replayCtx({}, FROZEN_NOW));
    assert.equal(coverage.status, "failed");
    assert.match(coverage.note!, /no fixture for/);
  });
});

const offer = (over: Partial<Offer> = {}): Offer => ({
  id: "sku_0199_1m", label: "Pro", price: 1.99, currency: "USD", formatted: "$1.99",
  period: "month", ...over,
});

describe("monetization model", () => {
  test("an unreadable catalogue is `unknown`, not `free`", () => {
    // Apple drops the embedded blob on newer layouts. HabitKit's last seven captures were labelled
    // `free` for an app that has been freemium throughout — wrong rather than absent.
    assert.equal(modelOf(0, [], false), "unknown");
    assert.equal(modelOf(0, [], true), "free");
  });

  test("names the shape, not just the number", () => {
    assert.equal(modelOf(0, []), "free");
    assert.equal(modelOf(0, [offer()]), "freemium");
    assert.equal(modelOf(4.99, []), "paid");
    assert.equal(modelOf(4.99, [offer()]), "paid_plus_iap");
    assert.equal(modelOf(undefined, []), "unknown");
  });
});

describe("periodOf", () => {
  test("the SKU suffix beats a scanned duration", () => {
    // Regression: the ISO duration is read from a fixed window that can overlap the next offer,
    // which made habitkit_3499_lt read as `month` in one capture and `lifetime` in another.
    assert.equal(periodOf("P1M", "habitkit_3499_lt"), "lifetime");
    assert.equal(periodOf(undefined, "habitkit_0599_1y"), "year");
    assert.equal(periodOf(undefined, "habitkit_0099_1m"), "month");
  });

  test("falls back to the duration when the SKU says nothing", () => {
    assert.equal(periodOf("P1Y", "premium_unlock"), "year");
    assert.equal(periodOf(undefined, "premium_unlock"), null);
  });
});

describe("summarizeOffers", () => {
  test("collapses duplicate SKUs at one price, ordered by term", () => {
    // Apps commonly run a legacy SKU and its replacement at the same price.
    const s = summarizeOffers([
      offer({ id: "a_0199_1m" }), offer({ id: "b_0199_1m" }),
      offer({ id: "c_1499_lt", price: 14.99, formatted: "$14.99", period: "lifetime", label: null }),
    ]);
    assert.equal(s.length, 2);
    assert.equal(s[0].period, "month");
    assert.equal(s[1].period, "lifetime");
  });
});

describe("extractOffers", () => {
  test("ignores the catalogue of other apps on the page", () => {
    const html =
      '{"buyParams":"price=199&offerName=mine_0199_1m&appAdamId=6443918070","priceFormatted":"$1.99","price":1.99,"currencyCode":"USD","subscriptionFamilyName":"Mine"}' +
      '{"buyParams":"price=999&offerName=theirs_0999_1m&appAdamId=111111111","priceFormatted":"$9.99","price":9.99,"currencyCode":"USD"}';
    const o = extractOffers(html, "6443918070");
    assert.equal(o.length, 1);
    assert.equal(o[0].id, "mine_0199_1m");
    assert.equal(o[0].label, "Mine");
  });

  test("reads the real HabitKit catalogue", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const money = events.filter((e) => /plan|Freemium|Monetization|Price changed/i.test(e.title));
    assert.ok(money.length >= 3, "no monetization history extracted");
    // Freemium with three tiers, then a second SKU family at roughly double.
    assert.match(money[0].title, /Freemium/);
    assert.match(money[0].title, /\$0\.99\/month/);
    assert.ok(money.some((e) => /\$29\.99 lifetime/.test(e.title)));
  });

  test("does not report the same plan twice on one day", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const keys = events.map((e) => `${e.date}|${e.title}`);
    assert.equal(new Set(keys).size, keys.length, "duplicate events emitted");
  });

  test("a capture with no legible catalogue is skipped, not read as a teardown", async () => {
    // Apple's newer pages drop the embedded blob. Comparing against one would emit a fake
    // "retired every plan" followed by a fake relaunch.
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    assert.equal(events.filter((e) => e.title.startsWith("Retired plan")).length, 0);
  });

  test("emits price metrics per billing period", async () => {
    const { metrics } = await appstore.collect(habitkit, await offlineCtx());
    const prices = metrics.filter((m) => m.metric.startsWith("ios_price_"));
    assert.ok(prices.length > 10);
    assert.ok(prices.every((m) => typeof m.value === "number"));
    assert.ok(new Set(prices.map((m) => m.metric)).size >= 2, "expected several billing periods");
  });
});

describe("ASO fields", () => {
  test("the subtitle belongs to our app, not a neighbour", async () => {
    // Six HabitKit captures reported "Study & Routine Planner" — an unrelated app's subtitle — by
    // taking the first match on a page that carries one per linked app.
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const subtitles = events.filter((e) => /subtitle changed/.test(e.title));
    assert.ok(subtitles.length > 0, "no subtitle history extracted");
    for (const e of subtitles) {
      assert.ok(
        /Streaks|Accountability|Consistency/i.test(e.title),
        `foreign subtitle leaked in: ${e.title}`,
      );
    }
  });

  test("subtitle changes are ASO events, dated inexactly", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    const subs = events.filter((e) => /subtitle changed/.test(e.title));
    assert.ok(subs.every((e) => e.kind === "aso"));
    // A capture bounds when the change happened; it does not date it.
    assert.ok(subs.every((e) => e.date_exact === false));
  });

  test("unicode escapes are decoded", async () => {
    const { events } = await appstore.collect(habitkit, await offlineCtx());
    assert.ok(!events.some((e) => e.title.includes("\\u00")), "raw \\uXXXX escape in a title");
  });

  test("extractLanguages reads the rendered list, or nothing", () => {
    const html = `<dt class="x">Languages</dt><dd class="y"><p>English, German</p></dd>`;
    assert.equal(extractLanguages(html), "English, German");
    // Apple restyles the page periodically; two of twenty captures return nothing. Absence, not error.
    assert.equal(extractLanguages("<p>no information list here</p>"), null);
  });
});
