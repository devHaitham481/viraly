import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ownerAt, ownerIndex, scopedMatches, scopedValue } from "../lib/sources/scope.ts";

const OURS = "6443918070";
const THEIRS = "1604437305";

/**
 * A store page embeds the full record of every app it links to. Reading the first match is reading a
 * stranger's data, and it has been the same bug four times — version histories, the purchase
 * catalogue, subtitles and Play install brackets.
 */
describe("owner attribution", () => {
  const page =
    `"id":"${OURS}" ... "subtitle":"Streaks & Accountability" ... ` +
    `"id":"${THEIRS}" ... "subtitle":"Progressive Overload Tracking"`;

  test("a field belongs to the nearest id before it", () => {
    const idx = ownerIndex(page);
    assert.equal(ownerAt(idx, page.indexOf("Streaks")), OURS);
    assert.equal(ownerAt(idx, page.indexOf("Progressive")), THEIRS);
  });

  test("scopedValue returns ours, not the first on the page", () => {
    assert.equal(scopedValue(page, OURS, /"subtitle":"([^"]+)"/g), "Streaks & Accountability");
    assert.equal(scopedValue(page, THEIRS, /"subtitle":"([^"]+)"/g), "Progressive Overload Tracking");
  });

  test("a page carrying the field only for others yields null", () => {
    // Absence is correct. Six HabitKit captures once reported "Study & Routine Planner", which
    // belongs to an unrelated app, because the first match was taken.
    const foreignOnly = `"id":"${THEIRS}" "subtitle":"Study & Routine Planner"`;
    assert.equal(scopedValue(foreignOnly, OURS, /"subtitle":"([^"]+)"/g), null);
  });

  test("text before any id has no owner", () => {
    // Page chrome sits above the first app block; nothing there belongs to anyone.
    const withHeader = `<head><title>App Store</title></head>${page}`;
    assert.equal(ownerAt(ownerIndex(withHeader), 5), null);
    // And a position inside the first block does belong to it.
    assert.equal(ownerAt(ownerIndex(withHeader), withHeader.indexOf("Streaks")), OURS);
  });

  test("scopedMatches returns every match we own", () => {
    const many = `"id":"${OURS}" "v":"a" "v":"b" "id":"${THEIRS}" "v":"c"`;
    assert.deepEqual(scopedMatches(many, OURS, /"v":"([^"]+)"/g).map((m) => m[1]), ["a", "b"]);
  });
});
