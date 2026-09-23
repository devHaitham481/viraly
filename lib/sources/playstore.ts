/**
 * Google Play listings — a second, independent growth series.
 *
 * Everything in `QUESTIONS.md` marked ⚠ is limited by how sparsely the App Store is archived, not by
 * a missing source. Play adds two things the App Store cannot:
 *
 *   - **Install brackets** (`10,000+` → `100,000+` → `500,000+`). Coarse, but each step is an
 *     *exact-dated fact* about user count rather than a proxy, and it is the closest thing to a
 *     download number that exists publicly.
 *   - A second review series, from a different audience, that can corroborate or contradict the iOS one.
 *
 * **Scoping is the hazard**, as it was for the App Store. A Play page carries the install bracket and
 * review count of every app in its "similar apps" carousels — on HabitKit's page the subject's own
 * bracket sits 562 characters from a package-id mention while a neighbour's sits 8,107 away. Numbers
 * are therefore only accepted close to a mention of *our* package, and the monotonic `play_installs`
 * invariant in `lib/audit.ts` catches it when that heuristic is wrong: a bracket that goes down is a
 * bracket belonging to somebody else.
 */

import type { Metric, Event } from "../schema.ts";
import type { Ctx } from "../fetcher.ts";
import type { Source, SourceResult } from "./registry.ts";

const CDX = "http://web.archive.org/cdx/search/cdx";

export const playUrl = (pkg: string) =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}&hl=en&gl=US`;

export const playCdxUrl = (pkg: string) =>
  `${CDX}?url=${encodeURIComponent(`play.google.com/store/apps/details?id=${pkg}`)}` +
  `&output=json&filter=statuscode:200&collapse=timestamp:6&fl=timestamp,original&limit=200`;

export const playCaptureUrl = (ts: string, url: string) =>
  `http://web.archive.org/web/${ts}id_/${url}`;

export const playViewUrl = (ts: string, url: string) =>
  `https://web.archive.org/web/${ts}/${url}`;

const MAX_CAPTURES = 16;

/** How close a number must be to a mention of our package to be treated as ours. */
const SCOPE_CHARS = 2_500;

export interface PlaySnapshot {
  installs: string | null;
  reviews: number | null;
}

/** `500,000+` → 500000, for ordering and monotonicity checks. */
export function bracketValue(bracket: string): number {
  return Number(bracket.replace(/[+,\s]/g, "")) || 0;
}

/**
 * The upper edge of an install bracket.
 *
 * `100,000+` does not mean 100,000 — it means somewhere under the next bracket. Play's steps are
 * 1/5/10/50/100/500 per decade, so the ceiling is the next step up. Without this the bracket reads
 * as a point value and every ratio derived from it is overstated by up to 5×.
 */
export function bracketCeiling(bracket: string): number | null {
  const floor = bracketValue(bracket);
  if (!floor) return null;
  const decade = 10 ** Math.floor(Math.log10(floor));
  const lead = Math.round(floor / decade);
  const next: Record<number, number> = { 1: 5, 5: 10 };
  return next[lead] ? next[lead] * decade : 10 * decade;
}

/**
 * `8.61K` → 8610, `1.2M` → 1200000, `7,575` → 7575.
 *
 * Play abbreviates the headline count to three significant figures, so the value carries the
 * rounding of its last digit — ~0.6% at 8.61K, far tighter than the install bracket it gets divided
 * by. Rounding preserves ordering, so a monotonic series stays monotonic.
 */
export function parseCount(raw: string): number | null {
  const m = /^(\d[\d,]*(?:\.\d+)?)\s*([KM])?$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * (m[2] === "M" ? 1e6 : m[2] === "K" ? 1e3 : 1));
}

function positionsOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1 && out.length < 2_000) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

const nearest = (marks: number[], at: number) =>
  marks.reduce((best, m) => Math.min(best, Math.abs(m - at)), Infinity);

/**
 * Read the subject app's install bracket and review count.
 *
 * Returns nulls rather than a guess when nothing sits close enough to a package mention — a wrong
 * install bracket is far worse than a missing one, because it looks like a real user count.
 */
export function extractPlay(html: string, pkg: string): PlaySnapshot {
  const marks = positionsOf(html, pkg);
  if (marks.length === 0) return { installs: null, reviews: null };

  let installs: string | null = null;
  let bestInstallDist = Infinity;
  for (const m of html.matchAll(/"(\d[\d,]*\+)"/g)) {
    const d = nearest(marks, m.index!);
    if (d < bestInstallDist && d <= SCOPE_CHARS) {
      bestInstallDist = d;
      installs = m[1];
    }
  }

  let reviews: number | null = null;
  let bestReviewDist = Infinity;
  // Unquoted and possibly abbreviated. The previous pattern required a quoted, comma-only number,
  // which matches nothing Play has ever served: the headline reads `8.61K reviews` in plain text.
  // `play_rating_count` was therefore silently empty on every crawl — a source returning zero rows
  // for a field it can read, which is the failure this codebase keeps having to catch.
  for (const m of html.matchAll(/(\d[\d,]*(?:\.\d+)?\s*[KM]?)\s*reviews?\b/gi)) {
    const d = nearest(marks, m.index!);
    const n = parseCount(m[1]);
    if (n !== null && d < bestReviewDist && d <= SCOPE_CHARS) {
      bestReviewDist = d;
      reviews = n;
    }
  }

  return { installs, reviews };
}

function sample<T>(rows: T[], max = MAX_CAPTURES): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => rows[Math.round(i * step)]);
}

export const playstore: Source = {
  id: "playstore",
  tier: 0,
  hosts: ["web.archive.org"],
  needs: ["play_id"],

  async collect(app, ctx: Ctx): Promise<SourceResult> {
    const pkg = app.play_id!;
    try {
      // `play_id` is copied from the iOS bundle id, which is a *guess*: NGL's bundle is `fun.ask`,
      // a valid iOS identifier that 404s on Play. Without this check the source reports
      // "no archived Play captures" — `empty`, meaning "we looked and there is genuinely nothing" —
      // for an app that may well have an Android listing under a different package entirely.
      try {
        await ctx.fetchText(playUrl(pkg));
      } catch {
        return {
          events: [], metrics: [],
          coverage: {
            status: "blocked",
            note: `no Play listing at "${pkg}" — the package id is inferred from the iOS bundle id and may be wrong`,
          },
        };
      }

      const rows = JSON.parse(await ctx.fetchText(playCdxUrl(pkg))) as string[][];
      if (rows.length <= 1) {
        return {
          events: [], metrics: [],
          coverage: { status: "empty", note: `no archived Play captures for ${pkg}` },
        };
      }

      const picked = sample(rows.slice(1));
      const metrics: Metric[] = [];
      const events: Event[] = [];
      let failed = 0;
      let unscoped = 0;
      let done = 0;
      let lastBracket: string | null = null;

      for (const [ts, original] of picked) {
        ctx.progress?.(`reading capture ${++done}/${picked.length}`);
        const date = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
        try {
          const snap = extractPlay(await ctx.fetchText(playCaptureUrl(ts, original)), pkg);
          const url = playViewUrl(ts, original);

          if (!snap.installs && snap.reviews === null) {
            unscoped++;
            continue;
          }
          if (snap.installs) {
            metrics.push({ date, metric: "play_installs", value: snap.installs, url });
            // Each bracket step is a dated fact about user count — the nearest thing to a download
            // number that is public anywhere.
            if (lastBracket && bracketValue(snap.installs) > bracketValue(lastBracket)) {
              events.push({
                date, kind: "product_change",
                title: `Play installs passed ${snap.installs}`,
                source: "playstore", by: null, by_founder: false, url, number: null,
                // The crossing happened between this capture and the previous one.
                date_exact: false,
              });
            }
            if (!lastBracket || bracketValue(snap.installs) >= bracketValue(lastBracket)) {
              lastBracket = snap.installs;
            }
          }
          if (snap.reviews !== null) {
            metrics.push({ date, metric: "play_rating_count", value: snap.reviews, url });
          }
        } catch {
          failed++;
        }
      }

      metrics.sort((a, b) => a.date.localeCompare(b.date));
      const note =
        `${rows.length - 1} captures, sampled ${picked.length}, ` +
        `${metrics.filter((m) => m.metric === "play_installs").length} install readings` +
        (failed ? `, ${failed} unreachable` : "") +
        (unscoped ? `, ${unscoped} unscopeable` : "");

      return {
        events, metrics,
        coverage: {
          status: failed || unscoped ? "partial" : metrics.length ? "ok" : "empty",
          note,
        },
      };
    } catch (err) {
      return {
        events: [], metrics: [],
        coverage: { status: "failed", note: err instanceof Error ? err.message : String(err) },
      };
    }
  },
};
