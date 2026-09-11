/**
 * Attributing a field on a store page to the app it belongs to.
 *
 * An App Store page embeds the full record of every app it links to — "You Might Also Like", "More
 * by this developer", a dozen or more per page. Every field on it therefore has an owner, and
 * reading the first match is reading a stranger's data.
 *
 * This has now been the same bug four times: version histories (returned 17.7 and 2025.10 from
 * unrelated apps), the in-app purchase catalogue, App Store subtitles (six captures of HabitKit
 * reported "Study & Routine Planner", which belongs to a different app entirely), and the Play
 * install brackets. It is the single most reliable way to produce a confident, well-formed,
 * completely wrong timeline — so it gets one shared implementation rather than a fifth bespoke one.
 */

/** Where each app id is mentioned, in document order. */
export interface OwnerIndex {
  marks: { at: number; id: string }[];
}

const ID_PATTERN = /(?:"id":"?|\/id)(\d{6,12})/g;

export function ownerIndex(text: string): OwnerIndex {
  const marks: { at: number; id: string }[] = [];
  for (const m of text.matchAll(ID_PATTERN)) marks.push({ at: m.index!, id: m[1] });
  return { marks };
}

/** The app whose block a position falls inside — the nearest id mentioned before it. */
export function ownerAt(index: OwnerIndex, at: number): string | null {
  let owner: string | null = null;
  for (const mark of index.marks) {
    if (mark.at > at) break;
    owner = mark.id;
  }
  return owner;
}

/**
 * Matches of `pattern` that belong to `iosId`.
 *
 * Returns an empty array when the page carries the field only for other apps — absence, which is
 * correct, rather than a neighbour's value.
 */
export function scopedMatches(
  text: string,
  iosId: string,
  pattern: RegExp,
): RegExpMatchArray[] {
  const index = ownerIndex(text);
  const out: RegExpMatchArray[] = [];
  for (const m of text.matchAll(pattern)) {
    if (ownerAt(index, m.index!) === iosId) out.push(m);
  }
  return out;
}

/** The first value of `pattern` belonging to `iosId`, or null. */
export function scopedValue(text: string, iosId: string, pattern: RegExp): string | null {
  return scopedMatches(text, iosId, pattern)[0]?.[1] ?? null;
}
