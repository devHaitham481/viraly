import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { DEMO } from "../lib/demo.ts";
import { auditCrawl } from "../lib/audit.ts";
import { SOURCES } from "../lib/sources/registry.ts";

/**
 * The landing page ships a recorded crawl as its worked example, which makes it the most visible
 * output the project has. Rule #1 applies hardest here: a fabricated row on the front page is worse
 * than a fabricated row anywhere else, and the file is generated, so nothing else would catch it.
 */
describe("the landing page example", () => {
  test("passes the same invariants as a live crawl", () => {
    assert.deepEqual(auditCrawl(DEMO.events, DEMO.metrics, { today: "2026-12-31" }), []);
  });

  test("every event points at something real", () => {
    // No placeholders, and no raw Wayback links that render as an unstyled broken page.
    for (const e of DEMO.events) {
      assert.match(e.url, /^https?:\/\//, `${e.source}: ${e.title}`);
      assert.equal(e.url.includes("id_/"), false, `${e.source}: raw capture link`);
    }
  });

  test("it is actually populated", () => {
    // A page that says "a real crawl, start to finish" over four events is worse than no page.
    assert.ok(DEMO.events.length > 30, `${DEMO.events.length} events`);
    assert.ok(DEMO.metrics.length > 50, `${DEMO.metrics.length} metrics`);
    assert.ok(DEMO.steps.length > 10, `${DEMO.steps.length} steps`);
    assert.ok(DEMO.brief.paragraphs.length >= 6);
    assert.ok(DEMO.brief.caveat.length > 0);
  });

  test("it accounts for every registered source", () => {
    // Adding a source and forgetting to regenerate leaves the page quietly describing an older
    // product. `npm run golden` is the fix, and this is what says so.
    const covered = new Set(DEMO.coverage.map((c) => c.source));
    for (const s of SOURCES) {
      assert.ok(covered.has(s.id), `${s.id} missing — run npm run golden`);
    }
  });

  test("the stated source count matches the coverage rows", () => {
    const answered = DEMO.coverage.filter((c) => c.status === "ok" || c.status === "partial").length;
    assert.equal(DEMO.sources_ok, answered);
  });

  test("the span shown in the copy comes from the data", () => {
    const dates = DEMO.events.map((e) => e.date).sort();
    assert.equal(DEMO.span.from, dates[0].slice(0, 4));
    assert.equal(DEMO.span.to, dates.at(-1)!.slice(0, 4));
  });
});
