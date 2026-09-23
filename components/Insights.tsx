import type { Insights, Milestone, Quality } from "@/lib/insights";

const fmtDays = (d: number | null) =>
  d === null ? "—" : d < 90 ? `${d} days` : `${Math.round(d / 30.44)} months`;

/**
 * A milestone crossed before our earliest reading has no knowable date. Where the first reading is
 * close to launch an upper bound is still useful; where the archive starts years late it is not.
 */
function milestoneText(m: Milestone | undefined): { value: string; hint?: string } {
  if (!m) return { value: "—" };
  if (m.already_passed) {
    const b = m.days_upper_bound;
    return b !== undefined && b <= 180
      ? { value: `under ${fmtDays(b)}`, hint: "already passed at our first reading" }
      : { value: "before our data", hint: "the archive does not reach back that far" };
  }
  // A tight bracket is a measurement; a wide one is a range, and saying so beats picking its far edge.
  if (m.days !== null) return { value: fmtDays(m.days), hint: m.date ?? undefined };
  if (m.days_min !== null && m.days_max !== null) {
    return {
      value: `${fmtDays(m.days_min)} – ${fmtDays(m.days_max)}`,
      hint: "crossed between two archived readings",
    };
  }
  return { value: "—" };
}

/**
 * Quality read against scale, because neither half means much alone.
 *
 * "4.9" is a vanity number; "4.9 while ratings went 1 → 2,385" is the finding — the app got a
 * hundred times more users without getting worse. A `declined` verdict against a rising count is
 * the inverse and the more urgent one.
 */
function qualityHint(q: Quality): string {
  const move =
    q.first.value === q.last.value
      ? `flat at ${q.last.value}`
      : `${q.first.value} → ${q.last.value}`;
  const scale =
    q.scale_from !== null && q.scale_to !== null
      ? ` while ratings went ${q.scale_from.toLocaleString("en-US")} → ${q.scale_to.toLocaleString("en-US")}`
      : "";
  const dip = q.low.value < q.last.value ? `, low of ${q.low.value} in ${q.low.date.slice(0, 7)}` : "";
  return `${move}${scale}${dip}`;
}

/** Within ~3 months of the anniversary is close enough to label a reading "year one". */
const nearAnniversary = (day: number) => Math.abs(day - 365) <= 90;

function Figure({
  label,
  value,
  hint,
  loud = false,
}: {
  label: string;
  value: string;
  hint?: string;
  loud?: boolean;
}) {
  return (
    <div className="border-t border-[var(--color-line)] py-3">
      <dt className="text-xs text-[var(--color-muted)]">{label}</dt>
      <dd
        className={`mt-0.5 tabular-nums ${loud ? "text-2xl font-semibold text-[var(--color-accent)]" : "text-lg"}`}
      >
        {value}
      </dd>
      {hint && <p className="mt-0.5 text-xs text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/**
 * The benchmark panel.
 *
 * Everything here is arithmetic on rows already collected — no extra request — and it is the part a
 * founder actually acts on. "33 ratings at the end of year one" answers *am I failing, or is this
 * normal?*, which a chronological list never does.
 */
export function InsightsPanel({ insights: i, name }: { insights: Insights; name: string }) {
  if (!i.launch_date) return null;

  const m100 = i.milestones.find((m) => m.ratings === 100);
  const m1k = i.milestones.find((m) => m.ratings === 1_000);

  return (
    <section className="mt-12">
      <h2 className="text-sm font-medium text-[var(--color-muted)]">Benchmarks</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Derived from the timeline and growth curve above — no extra sources.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-8 sm:grid-cols-3">
        {i.year_one && (
          <Figure
            // Only call it "after year 1" when the reading is actually near the anniversary.
            label={nearAnniversary(i.year_one.day) ? "Ratings after year 1" : `Ratings at day ${i.year_one.day}`}
            value={i.year_one.value.toLocaleString("en-US")}
            hint={
              nearAnniversary(i.year_one.day)
                ? "the number most teardowns leave out"
                : `nearest reading to the 1-year mark (${i.year_one.measured_on})`
            }
            loud
          />
        )}
        <Figure label="To 100 ratings" {...milestoneText(m100)} />
        <Figure label="To 1,000 ratings" {...milestoneText(m1k)} />

        {i.pre_launch_days !== null && (
          <Figure
            label="Public before launch"
            value={fmtDays(i.pre_launch_days)}
            hint="site live before the store release"
          />
        )}
        <Figure
          label="Feature releases"
          value={String(i.feature_releases)}
          hint={
            i.median_days_between_releases
              ? `~1 every ${i.median_days_between_releases} days (median)`
              : undefined
          }
        />
        {i.growth_multiple !== null && (
          <Figure
            label="Growth acceleration"
            value={`${i.growth_multiple.toFixed(1)}×`}
            hint={`${Math.round(i.growth_early!)} → ${Math.round(i.growth_recent!)} ratings/month`}
          />
        )}
        {i.content_posts > 0 && (
          <Figure
            label="First blog post"
            value={i.first_content_day !== null ? `day ${i.first_content_day}` : "—"}
            hint={`${i.content_posts} posts total`}
          />
        )}
        {i.current_pricing.length > 0 && (
          <Figure
            label="Cheapest plan"
            value={i.current_pricing
              .map((p) => `$${p.price}${p.period === "lifetime" ? "" : `/${p.period.slice(0, 2)}`}`)
              .join(" · ")}
            hint={
              i.price_change
                ? `${i.price_change.period} went $${i.price_change.from} → $${i.price_change.to}`
                : "lowest tier; see the timeline for plans added since"
            }
          />
        )}
        <Figure
          label="Repositionings"
          value={String(i.repositionings)}
          hint="landing-page message changes"
        />
        {i.quality && (
          <Figure
            label={
              i.quality.verdict === "held"
                ? "Rating average (held)"
                : `Rating average (${i.quality.verdict})`
            }
            value={i.quality.last.value.toFixed(1)}
            hint={qualityHint(i.quality)}
          />
        )}
        {i.engagement && (
          <Figure
            label="Reviews per 1,000 installs"
            // A range, not a number: Play publishes installs as `500,000+`, so the floor would
            // overstate the rate by up to 5×.
            value={`${Math.round(i.engagement.per_1k_min)}–${Math.round(i.engagement.per_1k_max)}`}
            hint={`${i.engagement.reviews.toLocaleString("en-US")} reviews against ${i.engagement.installs} Android installs (${i.engagement.date})`}
          />
        )}
      </dl>

      {/* The honest reading of the numbers, stated once rather than implied. */}
      {/* Only assert a slow first year when a reading actually near the anniversary shows one. The
          earlier version asserted "nearly flat" from the growth multiple alone, which would have
          said it of an app with 50,000 ratings in year one. */}
      {i.growth_multiple !== null &&
        i.growth_multiple > 3 &&
        i.year_one !== null &&
        nearAnniversary(i.year_one.day) &&
        i.growth_early !== null &&
        i.growth_recent !== null &&
        i.growth_early < i.growth_recent / 3 && (
          <p className="mt-4 rounded-lg border border-[var(--color-line)] bg-white px-4 py-3 text-sm">
            {name} grew slowly for its first year —{" "}
            <span className="font-medium">{i.year_one.value.toLocaleString("en-US")} ratings</span> — then
            compounded {i.growth_multiple.toFixed(0)}×. No single event in the timeline explains
            that, which is the usual shape: growth compounds more often than it spikes.
          </p>
        )}
    </section>
  );
}
