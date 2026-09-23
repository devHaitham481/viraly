/**
 * The written summary — what a crawl actually means.
 *
 * A crawl yields ~35 events and ~85 metric points, and until now a reader had to infer the lesson
 * from a table. This states it.
 *
 * **Deterministic on purpose.** Every sentence is built from data already in the database, so the
 * summary is exactly testable, costs nothing, and cannot invent a fact. A model can later turn this
 * into flowing prose (`lib/narrative.ts`), but it is given *only* these sentences to work from — it
 * writes, it does not decide what is true.
 *
 * The honesty rules from `lib/impact.ts` carry through unchanged. Most steps have no measurable
 * effect, and a summary that quietly implied causation would undo that work, so the attribution
 * sentence states what the data supports and nothing more.
 */

import type { Event, Metric } from "./schema.ts";
import type { Insights } from "./insights.ts";
import type { Step } from "./impact.ts";

export interface Brief {
  /** One line capturing the shape of the story. */
  headline: string;
  /** Ordered paragraphs. Sections with no data are omitted rather than padded. */
  paragraphs: string[];
  /** What the data cannot support. Always present. */
  caveat: string;
}

/**
 * Numbers are formatted `en-US` explicitly, never with the ambient locale.
 *
 * A bare `toLocaleString()` renders 2,385 as "2.385" on a German machine — wrong for English copy,
 * and in Next.js it differs between the server that renders and the browser that hydrates, which is
 * a mismatch rather than a typo. The copy is English, so the number format is too.
 */
const months = (days: number) => Math.round(days / 30.44);

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "roughly every 8 weeks" reads better than "a median of 57 days". */
function cadence(medianDays: number): string {
  if (medianDays <= 10) return "roughly weekly";
  if (medianDays <= 24) return "roughly every two weeks";
  if (medianDays <= 45) return "roughly monthly";
  if (medianDays <= 75) return `roughly every ${Math.round(medianDays / 7)} weeks`;
  return `roughly every ${months(medianDays)} months`;
}

export function buildBrief(
  name: string,
  events: Event[],
  metrics: Metric[],
  insights: Insights,
  steps: Step[],
): Brief {
  const paragraphs: string[] = [];
  const evs = [...events].sort((a, b) => a.date.localeCompare(b.date));

  // ---- how long before they launched -------------------------------------
  if (insights.pre_launch_days !== null && insights.launch_date) {
    const registered = evs.find((e) => e.source === "rdap");
    paragraphs.push(
      `${name} was public for ${plural(months(insights.pre_launch_days), "month")} before it ` +
        `launched — ${registered ? `the domain was registered ${registered.date}` : "the site was live"}, ` +
        `and the app shipped ${insights.launch_date}.`,
    );
  }

  // ---- the first year ------------------------------------------------------
  const m1k = insights.milestones.find((m) => m.ratings === 1_000);
  if (insights.year_one) {
    const { value, day } = insights.year_one;
    const near = Math.abs(day - 365) <= 90;
    let s =
      `At ${near ? "the one-year mark" : `day ${day}`} it had ${value.toLocaleString("en-US")} ratings` +
      (near ? "" : " — the nearest reading to its first anniversary");
    if (m1k?.days_min !== null && m1k?.days_max !== undefined && m1k?.days_max !== null) {
      s +=
        `, and it crossed 1,000 somewhere between month ${months(m1k.days_min!)} and ` +
        `month ${months(m1k.days_max)}`;
    }
    paragraphs.push(`${s}.`);
  }

  // ---- shipping ------------------------------------------------------------
  if (insights.feature_releases > 0 && insights.median_days_between_releases) {
    const notable = evs.filter((e) => /^Version [\d.]+: /.test(e.title)).length;
    paragraphs.push(
      `They shipped ${plural(insights.feature_releases, "feature release")} at a pace of ` +
        `${cadence(insights.median_days_between_releases)}` +
        (notable ? `, ${notable} of which announced something beyond bug fixes` : "") +
        `.`,
    );
  }

  // ---- money ---------------------------------------------------------------
  const firstPricing = evs.find((e) => /^(Freemium|free|paid|paid_plus_iap) —/.test(e.title));
  const priceMoves = evs.filter((e) => /^(Added plan|Price changed|Retired plan)/.test(e.title));
  if (firstPricing || insights.current_pricing.length) {
    const plans = insights.current_pricing
      .map((p) => `$${p.price}${p.period === "lifetime" ? " lifetime" : `/${p.period}`}`)
      .join(", ");
    const opening = firstPricing
      ? `Monetization was legible from ${firstPricing.date}: ${firstPricing.title.replace(/^\w+ — /, "")}.`
      : "";
    // Repeating an identical plan list as "today" reads as a second fact when it is the same one.
    const today = plans && !opening.includes(plans) ? ` The cheapest plans today are ${plans}.` : "";
    const moves = priceMoves.length
      ? ` ${plural(priceMoves.length, "further pricing change")} followed.`
      : " Pricing has not moved since.";
    paragraphs.push(`${opening}${today}${moves}`.trim());
  }

  // ---- positioning ---------------------------------------------------------
  if (insights.repositionings > 0) {
    const last = [...evs].reverse().find((e) => e.title.startsWith("Positioning changed"));
    paragraphs.push(
      `The landing page message changed ${plural(insights.repositionings, "time")}` +
        (last ? `, most recently to ${last.title.replace(/^Positioning changed to: /, "")}` : "") +
        `.`,
    );
  }

  // ---- distribution --------------------------------------------------------
  const content = evs.filter((e) => e.kind === "own_content" && e.source === "blog");
  const press = evs.filter((e) => e.kind === "earned_media");
  const outside = evs.filter((e) => !e.by_founder && e.kind === "mention");
  const dist: string[] = [];
  if (content.length) {
    const years = new Set(content.map((e) => e.date.slice(0, 4)));
    dist.push(
      `published ${plural(content.length, "post")}` +
        (years.size === 1 ? `, all in ${[...years][0]}` : ` across ${years.size} years`),
    );
  }
  if (press.length) dist.push(`appeared on ${plural(press.length, "podcast")}`);
  if (outside.length) dist.push(`drew ${plural(outside.length, "unprompted mention")}`);
  if (dist.length) {
    paragraphs.push(`On distribution they ${dist.join(", ")}.`);
  }

  // ---- what they tried and dropped -----------------------------------------
  // The only part of the record that shows a retreat. Everything else a team publishes about
  // itself is a thing that worked.
  const removed = evs
    .map((e) => (e.source === "structure" ? /^Published (\S+) — since removed/.exec(e.title) : null))
    .filter((m): m is RegExpExecArray => m !== null);
  if (removed.length) {
    paragraphs.push(
      `${plural(removed.length, "page")} they put up ${removed.length === 1 ? "has" : "have"} since ` +
        `come down — ${removed.map((m) => m[1]).join(", ")}. The archive holds ` +
        `${removed.length === 1 ? "it" : "them"}; the live site returns 404.`,
    );
  }

  // ---- quality under scale -------------------------------------------------
  // The finding is the pairing: a rating average alone is a vanity number, and a rating count alone
  // says nothing about whether the product survived the users it gained.
  if (insights.quality) {
    const q = insights.quality;
    const scaled =
      q.scale_from !== null && q.scale_to !== null && q.scale_to > q.scale_from * 2
        ? ` while the count went from ${q.scale_from.toLocaleString("en-US")} to ${q.scale_to.toLocaleString("en-US")}`
        : "";
    const verb =
      q.verdict === "held"
        ? `held at ${q.last.value}`
        : q.verdict === "improved"
          ? `rose from ${q.first.value} to ${q.last.value}`
          : `slipped from ${q.first.value} to ${q.last.value}`;
    paragraphs.push(`The App Store rating average ${verb}${scaled}.`);
  }

  // ---- how many users ever say anything -------------------------------------
  if (insights.engagement) {
    const e = insights.engagement;
    paragraphs.push(
      `On Android, ${e.reviews.toLocaleString("en-US")} reviews against ${e.installs} installs puts the ` +
        `review rate between ${Math.round(e.per_1k_min)} and ${Math.round(e.per_1k_max)} per 1,000 ` +
        `— a range, because Play publishes installs in brackets.`,
    );
  }

  // ---- growth shape --------------------------------------------------------
  if (insights.growth_multiple !== null && insights.growth_early !== null && insights.growth_recent !== null) {
    paragraphs.push(
      `Growth went from about ${Math.round(insights.growth_early)} to ` +
        `${Math.round(insights.growth_recent)} ratings a month, accelerating ` +
        `${insights.growth_multiple.toFixed(1)}×.`,
    );
  }

  // ---- what the data will and will not support -----------------------------
  const measurable = steps.filter((s) => s.impact.verdict !== "unknown");
  const moved = measurable.filter((s) => s.impact.verdict === "accelerated");
  const caveat =
    measurable.length === 0
      ? `No step has enough growth data around it to say whether it changed anything. Archived ` +
        `readings land roughly every two months, which is coarser than most of this timeline.`
      : moved.length === 0
        ? `Of ${steps.length} steps, ${measurable.length} have usable growth data either side and ` +
          `none coincides with a step change. The shape is compounding, not spikes — no single ` +
          `event here explains the curve.`
        : `Of ${steps.length} steps, only ${measurable.length} have usable growth data either side, ` +
          `and ${moved.length === 1 ? "one of those coincides" : `${moved.length} of those coincide`} ` +
          `with a marked pickup. Coincidence is not cause: ` +
          `readings are roughly two months apart, so anything closer together than that cannot be ` +
          `told apart.`;

  // ---- headline ------------------------------------------------------------
  const quiet =
    insights.year_one && insights.growth_multiple !== null && insights.growth_multiple > 3
      ? `Slow for a year, then ${insights.growth_multiple.toFixed(0)}×`
      : insights.growth_multiple !== null && insights.growth_multiple > 1.5
        ? `Accelerating ${insights.growth_multiple.toFixed(1)}×`
        : `${plural(events.length, "recorded step")}`;
  const headline =
    insights.pre_launch_days !== null
      ? `${plural(months(insights.pre_launch_days), "month")} in public before launch. ${quiet}.`
      : `${quiet}.`;

  return { headline, paragraphs, caveat };
}
