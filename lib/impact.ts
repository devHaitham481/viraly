/**
 * What each step did to growth.
 *
 * A list of things that happened is not what a founder needs. They need "they shipped widgets at
 * 40 ratings and nothing changed" versus "they shipped widgets and velocity tripled" — the second
 * is a lesson, the first is trivia, and a timeline that cannot tell them apart is decoration.
 *
 * **The measurement is usually impossible, and saying so is the feature.** Archived store captures
 * land roughly every two months, so most events have no reading close enough on either side to
 * compare. Reporting a verdict anyway is the exact failure this codebase keeps having to fix — the
 * confident number derived from data that cannot support it. `unknown` is the common, correct answer.
 */

import type { Event, Metric } from "./schema.ts";

/** How far either side of an event we will look for readings. */
const WINDOW_DAYS = 120;
/** Below this, month-to-month noise swamps any real change. */
const MIN_BASELINE = 2;
/** A change smaller than this is not distinguishable from sampling noise. */
const FACTOR = 1.6;

export type Verdict = "accelerated" | "slowed" | "steady" | "unknown";

export interface Impact {
  /** Ratings at the time of the event — where they were when they did this. */
  ratings_at: number | null;
  velocity_before: number | null;
  velocity_after: number | null;
  verdict: Verdict;
  /** Why the verdict is `unknown`, so the gap is legible rather than blank. */
  reason?: string;
}

export type TimelineEntry = Event & { impact: Impact };

const toTime = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (a: string, b: string) => (toTime(b) - toTime(a)) / 86_400_000;

interface Reading {
  date: string;
  value: number;
}

/** Ratings per month across a run of readings, or null if fewer than two. */
function velocity(readings: Reading[]): number | null {
  if (readings.length < 2) return null;
  const span = days(readings[0].date, readings.at(-1)!.date);
  if (span <= 0) return null;
  return ((readings.at(-1)!.value - readings[0].value) / span) * 30;
}

export function impactOf(event: Event, readings: Reading[]): Impact {
  if (readings.length === 0) {
    return { ratings_at: null, velocity_before: null, velocity_after: null, verdict: "unknown",
             reason: "no growth data" };
  }

  // Nearest reading in either direction — context, not a claim about the exact day.
  const nearest = readings.reduce((best, r) =>
    Math.abs(days(event.date, r.date)) < Math.abs(days(event.date, best.date)) ? r : best,
  );
  const ratingsAt = Math.abs(days(event.date, nearest.date)) <= WINDOW_DAYS ? nearest.value : null;

  const before = readings.filter((r) => {
    const d = days(r.date, event.date);
    return d >= 0 && d <= WINDOW_DAYS;
  });
  const after = readings.filter((r) => {
    const d = days(event.date, r.date);
    return d >= 0 && d <= WINDOW_DAYS;
  });

  const vBefore = velocity(before);
  const vAfter = velocity(after);

  if (vBefore === null || vAfter === null) {
    return {
      ratings_at: ratingsAt, velocity_before: vBefore, velocity_after: vAfter, verdict: "unknown",
      // The archive is sparse; this is the normal case, not an error.
      reason: `needs two readings within ${WINDOW_DAYS} days on each side`,
    };
  }

  if (vBefore < MIN_BASELINE) {
    return {
      ratings_at: ratingsAt, velocity_before: vBefore, velocity_after: vAfter, verdict: "unknown",
      reason: "growth before this was too small to compare against",
    };
  }

  const ratio = vAfter / vBefore;
  const verdict: Verdict = ratio >= FACTOR ? "accelerated" : ratio <= 1 / FACTOR ? "slowed" : "steady";
  return { ratings_at: ratingsAt, velocity_before: vBefore, velocity_after: vAfter, verdict };
}

export function buildTimeline(events: Event[], metrics: Metric[]): TimelineEntry[] {
  const readings: Reading[] = metrics
    .filter((m) => m.metric === "ios_rating_count" && typeof m.value === "number")
    .map((m) => ({ date: m.date, value: m.value as number }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return [...events]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ ...e, impact: impactOf(e, readings) }));
}

/** One-line summary of what the whole timeline supports, for the top of the page. */
export function attributionSummary(timeline: TimelineEntry[]): string {
  const measurable = timeline.filter((e) => e.impact.verdict !== "unknown");
  const moved = measurable.filter((e) => e.impact.verdict === "accelerated");

  if (measurable.length === 0) {
    return "No event has enough growth data around it to say whether it changed anything.";
  }
  if (moved.length === 0) {
    return `Of ${measurable.length} events with usable data either side, none coincides with a step change in growth — the pattern is compounding, not spikes.`;
  }
  return `${moved.length} of ${measurable.length} measurable events coincide with a marked pickup in growth. Coincidence is not cause; the archive samples roughly every two months.`;
}
