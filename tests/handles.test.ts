import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleFromUrl, handlesFromHtml, isPlausible } from "../lib/handles.ts";

describe("handleFromUrl", () => {
  test("reads the common profile shapes", () => {
    assert.deepEqual(handleFromUrl("https://twitter.com/SebastianRoehl"), { key: "x", value: "SebastianRoehl" });
    assert.deepEqual(handleFromUrl("https://x.com/flighty"), { key: "x", value: "flighty" });
    assert.deepEqual(handleFromUrl("https://github.com/marcoarment"), { key: "github", value: "marcoarment" });
    assert.deepEqual(handleFromUrl("https://www.reddit.com/user/spez"), { key: "reddit", value: "spez" });
    assert.deepEqual(handleFromUrl("https://www.linkedin.com/in/someone"), { key: "linkedin", value: "someone" });
    assert.deepEqual(handleFromUrl("https://youtube.com/@channelname"), { key: "youtube", value: "channelname" });
  });

  test("rejects share links and marketing paths that look like profiles", () => {
    assert.equal(handleFromUrl("https://twitter.com/intent/tweet?text=hi"), null);
    assert.equal(handleFromUrl("https://twitter.com/share"), null);
    assert.equal(handleFromUrl("https://github.com/pricing"), null);
    assert.equal(handleFromUrl("https://youtube.com/watch?v=abc"), null);
    assert.equal(handleFromUrl("https://instagram.com/p/xyz"), null);
  });

  test("a subreddit is a community, not a person", () => {
    assert.equal(handleFromUrl("https://reddit.com/r/productivity"), null);
  });

  test("ignores unrelated hosts and malformed URLs", () => {
    assert.equal(handleFromUrl("https://example.com/someone"), null);
    assert.equal(handleFromUrl("not a url"), null);
  });
});

describe("isPlausible", () => {
  test("accepts a handle matching the brand", () => {
    assert.ok(isPlausible("bearnotesapp", "bear", "Shiny Frog Ltd."));
    assert.ok(isPlausible("flighty", "flighty", "Flighty LLC"));
  });

  test("accepts a person's name split across the handle", () => {
    assert.ok(isPlausible("SebastianRoehl", "habitkit", "Sebastian Roehl"));
  });

  test("rejects an unrelated account", () => {
    // Regression: overcast.fm links a JS library's repo, and taking it as the founder's GitHub
    // would attribute a stranger's entire history to them.
    assert.equal(isPlausible("yui", "overcast", "Overcast Radio, LLC"), false);
  });

  test("a generic corporate suffix alone is not a match", () => {
    assert.equal(isPlausible("llc", "something", "Some Company LLC"), false);
  });
});

describe("handlesFromHtml", () => {
  test("keeps plausible accounts and records what it rejected", () => {
    const html = `
      <a href="https://twitter.com/SebastianRoehl">follow</a>
      <a href="https://github.com/some-random-lib">a dependency</a>`;
    const scan = handlesFromHtml(html, "habitkit", "Sebastian Roehl");
    assert.deepEqual(scan.handles, { x: "SebastianRoehl" });
    // Silently dropping a candidate would hide why Axis B came back empty.
    assert.ok(scan.rejected.some((r) => r.startsWith("github:")));
  });

  test("no social links yields nothing rather than guessing", () => {
    assert.deepEqual(handlesFromHtml("<p>plain page</p>", "x", null).handles, {});
  });
});
