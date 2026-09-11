/**
 * Requires Postgres (`docker-compose up -d`). Kept out of `npm test` on purpose — the offline suite
 * must stay dependency-free (REVIEW.md rule #3). Run with `npm run test:db`.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { applySchema, db } from "../../lib/db/index.ts";
import { acquire, policyFor, trySpend } from "../../lib/queue/limiter.ts";

const HOST = "test.example";

describe("token bucket", () => {
  before(async () => {
    await applySchema();
    await db()`DELETE FROM host_buckets WHERE host = ${HOST}`;
  });

  // Without this the pool keeps the process alive and the run never exits.
  after(async () => {
    await db()`DELETE FROM host_buckets WHERE host = ${HOST}`;
    await db().end();
  });

  test("a fresh bucket allows a burst up to capacity, then refuses", async () => {
    const cap = policyFor(HOST).capacity;
    let allowed = 0;
    for (let i = 0; i < cap + 3; i++) if (await trySpend(HOST)) allowed++;
    assert.equal(allowed, cap, `expected exactly ${cap} tokens in the initial burst`);
    assert.equal(await trySpend(HOST), false, "bucket should be dry");
  });

  test("concurrent callers are serialised, not double-spent", async () => {
    await db()`DELETE FROM host_buckets WHERE host = ${HOST}`;
    const cap = policyFor(HOST).capacity;
    // 20 simultaneous attempts against a bucket holding `cap`. Without atomicity this over-grants.
    const results = await Promise.all(Array.from({ length: 20 }, () => trySpend(HOST)));
    assert.equal(results.filter(Boolean).length, cap, "over-granted — the UPDATE is not atomic");
  });

  test("acquire() waits for refill rather than failing", async () => {
    await db()`DELETE FROM host_buckets WHERE host = ${HOST}`;
    const { capacity, refillPerSec } = policyFor(HOST);
    for (let i = 0; i < capacity; i++) await trySpend(HOST); // drain

    const t0 = Date.now();
    await acquire(HOST, 10_000);
    const waited = Date.now() - t0;
    const expected = (1 / refillPerSec) * 1000;
    assert.ok(waited >= expected * 0.6, `returned too fast (${waited}ms < ~${expected}ms)`);
  });

  test("archive.org is throttled harder than the rest", async () => {
    // The one host that has already cut us off.
    assert.ok(policyFor("web.archive.org").refillPerSec < policyFor("itunes.apple.com").refillPerSec);
  });
});
