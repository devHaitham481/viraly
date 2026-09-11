/**
 * Derived metrics — the part a founder actually acts on.
 *
 * A timeline says what happened; this says whether it was fast. "HabitKit had 33 ratings at the end
 * of year one" answers the only question someone mid-launch really has — *am I failing, or is this
 * normal?* — and it is the thing no teardown ever publishes, because the story reads better without
 * it.
 *
 * Pure functions over `events` and `metrics`. No fetching, no I/O, no model: everything here is
 * arithmetic on data already collected, which is why it costs nothing and is exactly testable.
 */

import type { Event, Metric } from "./schema.ts";

const RATING = "ios_rating_count";

/** Milestones worth comparing across apps. */
export const MILESTONES = [100, 1_000, 10_000] as const;

export interface Milestone {
  ratings: number;
  /**
   * Days from launch to the crossing — populated **only when the bracket is tight enough to be a
   * measurement**. Archived captures are sparse, so the crossing usually happened somewhere between
   * two readings; reporting the later one as the answer turns an upper bound into a claim.
   */
  days: number | null;
  /** The crossing happened somewhere in [days_min, days_max]. */
  days_min: number | null;
  days_max: number | null;
  date: string | null;
  /**
   * True when the app was already past this milestone at our earliest reading, so the real crossing
   * happened before anything we can see.
   */
  already_passed?: boolean;
  /**
   * When `already_passed`, how long after launch our first reading was — an honest upper bound.
   * "Within 30 days" is useful; "3,896 days" (Hinge, whose archive starts a decade late) is not,
   * and the UI can decide which to show from the size of the bound.
   */
  days_upper_bound?: number;
}

export interface Insights {
  launch_date: string | null;
  /** The earliest growth reading we hold. Everything before it is unobserved, not zero. */
  observed_from: { date: string; value: number } | null;
  /** How long a public presence existed before the store launch — the quiet build. */
  pre_launch_days: number | null;
  milestones: Milestone[];
  /**
   * The reading nearest the one-year mark, with how far off it actually was. A bare number invites
   * "ratings after year 1" when the reading may be six months stale.
   */
  year_one: { value: number; measured_on: string; day: number } | null;
  feature_releases: number;
  /** Median, not mean: one four-month gap should not hide an otherwise steady cadence. */
  median_days_between_releases: number | null;
  first_content_day: number | null;
  content_posts: number;
  repositionings: number;
  /** Ratings per month early and late, over disjoint windows. Null when the series is too short. */
  growth_early: number | null;
  growth_recent: number | null;
  growth_multiple: number | null;
  /** Series keyed by months since launch, for comparing apps of different ages. */
  age_series: { month: number; value: number }[];
  /**
   * The most recent *cheapest* plan per billing period.
   *
   * Deliberately the floor, not "what a new user pays": apps add a higher-priced SKU family while
   * leaving the old one live for existing subscribers, and nothing in the listing says which one is
   * offered today. The timeline carries the added tiers; this carries the floor.
   */
  current_pricing: { period: string; price: number }[];
  /** Cheapest yearly-equivalent price seen, and the latest — did they raise prices? */
  price_change: { period: string; from: number; to: number } | null;
}

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const daysBetween = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86_400_000);

/** Average ratings/month across consecutive readings. */
function ratePerMonth(points: { date: string; value: number }[]): number | null {
  const rates: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const days = daysBetween(points[i - 1].date, points[i].date);
    if (days > 0) rates.push(((points[i].value - points[i - 1].value) / days) * 30);
  }
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function computeInsights(events: Event[], metrics: Metric[]): Insights {
  const evs = [...events].sort((a, b) => a.date.localeCompare(b.date));

  const ratings = metrics
    .filter((m) => m.metric === RATING && typeof m.value === "number")
    .map((m) => ({ date: m.date, value: m.value as number }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const launch = evs.find((e) => e.kind === "launch")?.date ?? null;

  // Everything below is relative to launch; without it only counts are meaningful.
  const afterLaunch = launch ? ratings.filter((r) => r.date >= launch) : ratings;

  const firstReading = afterLaunch[0] ?? null;

  /** A bracket wider than this is a range, not a measurement. */
  const TIGHT_DAYS = 45;

  const milestones: Milestone[] = MILESTONES.map((n) => {
    // Already past it at our earliest reading: the crossing predates the archive entirely.
    if (firstReading && firstReading.value >= n) {
      return {
        ratings: n, date: null, days: null, days_min: null, days_max: null, already_passed: true,
        ...(launch ? { days_upper_bound: daysBetween(launch, firstReading.date) } : {}),
      };
    }

    const hitIndex = afterLaunch.findIndex((r) => r.value >= n);
    if (hitIndex < 0 || !launch) {
      return { ratings: n, date: null, days: null, days_min: null, days_max: null };
    }

    const hit = afterLaunch[hitIndex];
    const before = afterLaunch[hitIndex - 1];
    const daysMax = daysBetween(launch, hit.date);
    const daysMin = before ? daysBetween(launch, before.date) : 0;

    return {
      ratings: n,
      date: hit.date,
      // Only a measurement when the two readings are close together. HabitKit's readings jump
      // 2023-05-20 (33) → 2024-02-26 (184): the 100-crossing is somewhere in a 282-day hole, and
      // "457 days" was the far edge of that hole presented as the answer.
      days: daysMax - daysMin <= TIGHT_DAYS ? daysMax : null,
      days_min: daysMin,
      days_max: daysMax,
    };
  });

  // The reading nearest the anniversary, in either direction, carrying how far off it was — so a
  // consumer can decide whether "after year 1" is an honest label for it.
  let yearOne: Insights["year_one"] = null;
  if (launch && afterLaunch.length) {
    const target = 365;
    let best = afterLaunch[0];
    let bestGap = Infinity;
    for (const r of afterLaunch) {
      const gap = Math.abs(daysBetween(launch, r.date) - target);
      if (gap < bestGap) {
        bestGap = gap;
        best = r;
      }
    }
    yearOne = { value: best.value, measured_on: best.date, day: daysBetween(launch, best.date) };
  }

  /**
   * Releases are identified by the version prefix, not the whole sentence.
   *
   * The previous pattern required the title to *end* in "released", so adding release notes to the
   * title — a pure copy change — silently dropped five releases from the count. Classifying events
   * by parsing their prose is fragile; anchoring on the structured part is the least-bad version of
   * it until `Event` carries a subtype.
   */
  const releases = evs.filter((e) => /^Version \d[\d.]*\b/.test(e.title));
  const gaps: number[] = [];
  for (let i = 1; i < releases.length; i++) {
    gaps.push(daysBetween(releases[i - 1].date, releases[i].date));
  }

  const posts = evs.filter((e) => e.kind === "own_content");
  const repositionings = evs.filter((e) => e.title.startsWith("Positioning changed")).length;

  /**
   * Early and late growth must be measured over *disjoint* windows. Taking the first five and last
   * five readings of a six-point series compares a set with itself and reports an acceleration of
   * 1.0 no matter what the app did.
   */
  const window = Math.min(5, Math.floor(afterLaunch.length / 2));
  const comparable = window >= 2;
  const early = comparable ? ratePerMonth(afterLaunch.slice(0, window)) : null;
  const recent = comparable ? ratePerMonth(afterLaunch.slice(-window)) : null;

  // The project's own first trace — NOT the earliest event of any source. With GitHub enabled the
  // oldest starred repo can predate the product by years, which rendered as "public 79 months
  // before launch". Domain registration counts and usually predates the first capture.
  const firstSiteEvent =
    evs.find((e) => e.source === "rdap" || e.source === "wayback")?.date ?? null;

  // Pricing comes in as one metric series per billing period, e.g. `ios_price_month`.
  const priceSeries = new Map<string, { date: string; value: number }[]>();
  for (const m of metrics) {
    if (!m.metric.startsWith("ios_price_") || typeof m.value !== "number") continue;
    const period = m.metric.replace("ios_price_", "");
    const list = priceSeries.get(period) ?? [];
    list.push({ date: m.date, value: m.value });
    priceSeries.set(period, list);
  }
  for (const list of priceSeries.values()) list.sort((a, b) => a.date.localeCompare(b.date));

  const currentPricing = [...priceSeries]
    .map(([period, list]) => ({ period, price: list[list.length - 1].value }))
    .sort((a, b) => a.price - b.price);

  // Report a reprice only where we have readings at both ends; a single reading proves nothing.
  let priceChange: Insights["price_change"] = null;
  for (const [period, list] of priceSeries) {
    if (list.length >= 2 && list[0].value !== list[list.length - 1].value) {
      priceChange = { period, from: list[0].value, to: list[list.length - 1].value };
      break;
    }
  }

  return {
    launch_date: launch,
    observed_from: firstReading ? { date: firstReading.date, value: firstReading.value } : null,
    pre_launch_days:
      launch && firstSiteEvent && firstSiteEvent < launch
        ? daysBetween(firstSiteEvent, launch)
        : null,
    milestones,
    year_one: yearOne,
    feature_releases: releases.length,
    median_days_between_releases: median(gaps),
    first_content_day: launch && posts.length ? daysBetween(launch, posts[0].date) : null,
    content_posts: posts.length,
    repositionings,
    growth_early: early,
    growth_recent: recent,
    // Guard against a near-zero denominator: early growth of 0.1/month would report a 900× multiple.
    growth_multiple: early !== null && recent !== null && early >= 1 ? recent / early : null,
    current_pricing: currentPricing,
    price_change: priceChange,
    age_series: launch
      ? afterLaunch.map((r) => ({
          month: Math.round(daysBetween(launch, r.date) / 30.44),
          value: r.value,
        }))
      : [],
  };
}
