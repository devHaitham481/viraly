import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { blog, postUrlsFromSitemap, publishedDate } from "../lib/sources/blog.ts";
import { github } from "../lib/sources/github.ts";
import { FROZEN_NOW, offlineCtx } from "./helpers.ts";
import { replayCtx } from "../lib/fetcher.ts";
import type { AppIdentity } from "../lib/schema.ts";

const habitkit: AppIdentity = {
  name: "HabitKit", domain: "habitkit.app", ios_id: "6443918070", play_id: null,
  founder: "Sebastian Roehl", founder_source: null, artwork: null, store_url: null,
  handles: { github: "sebastianroehl" },
};

describe("postUrlsFromSitemap", () => {
  test("keeps posts and drops policy pages", () => {
    const xml = `<urlset>
      <url><loc>https://habitkit.app/blog/one</loc></url>
      <url><loc>https://habitkit.app/privacy</loc></url>
      <url><loc>https://habitkit.app/changelog/v2</loc></url>
      <url><loc>https://other.com/blog/two</loc></url></urlset>`;
    assert.deepEqual(postUrlsFromSitemap(xml, "habitkit.app"), [
      "https://habitkit.app/blog/one",
      "https://habitkit.app/changelog/v2",
    ]);
  });
});

describe("publishedDate", () => {
  test("prefers JSON-LD, then meta, then the slug", () => {
    assert.equal(publishedDate('{"datePublished":"2024-07-23T10:00:00Z"}', "u"), "2024-07-23");
    assert.equal(
      publishedDate('<meta property="article:published_time" content="2023-01-02T00:00:00Z">', "u"),
      "2023-01-02",
    );
    assert.equal(publishedDate("<p>nothing</p>", "https://x.com/blog/2022/05/06/post/"), "2022-05-06");
  });

  test("no date at all yields null rather than a guess", () => {
    assert.equal(publishedDate("<p>nothing</p>", "https://x.com/blog/post"), null);
  });
});

describe("blog source", () => {
  test("finds the product's own dated posts", async () => {
    const { events, coverage } = await blog.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "ok");
    assert.ok(events.length >= 4);
    assert.ok(events.every((e) => e.kind === "own_content"));
    // These are the product's own moves, not someone else writing about it.
    assert.ok(events.every((e) => e.by_founder === true));
    assert.ok(events.every((e) => e.date_exact === true));
  });

  test("posts are ordered and carry their own URL", async () => {
    const { events } = await blog.collect(habitkit, await offlineCtx());
    for (let i = 1; i < events.length; i++) assert.ok(events[i].date >= events[i - 1].date);
    // A per-post URL, not the blog index — an index link is not evidence of a specific post.
    assert.ok(events.every((e) => /\/blog\/.+/.test(e.url)));
  });

  test("no sitemap is `empty`, not `failed`", async () => {
    const { coverage } = await blog.collect(
      { ...habitkit, domain: "zzz-nothing.example" },
      replayCtx({}, FROZEN_NOW),
    );
    assert.equal(coverage.status, "empty");
    assert.match(coverage.note!, /no sitemap/);
  });
});

describe("github source", () => {
  test("an account with no public repos is `empty`", async () => {
    const { coverage, events } = await github.collect(habitkit, await offlineCtx());
    assert.equal(coverage.status, "empty");
    assert.deepEqual(events, []);
  });

  test("is skipped entirely when no github handle was resolved", () => {
    assert.equal(github.needsHandle, "github");
  });

  test("a broken API is `failed`, never a throw", async () => {
    const dead = { fetchText: async () => { throw new Error("rate limited"); }, now: () => new Date(FROZEN_NOW) };
    const { coverage } = await github.collect(habitkit, dead);
    assert.equal(coverage.status, "failed");
  });
});
